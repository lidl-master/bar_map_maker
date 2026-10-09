// Map archives (.sd7 / .sdz) through 7-Zip. Node-only.
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import sevenZip from '7zip-bin';

// shortcut: scratch space lives in the repo's gitignored .engine-tmp (on D:, the user's big drive); a packaged
// app needs a user-chosen work dir instead (revisit with the installer, Wave 4).
export const TEMP_ROOT = resolve(import.meta.dirname, '../../.engine-tmp');
// shortcut: 7zip-bin 5.2.0 (the latest on npm) ships 7-Zip 21.07, which follows link entries out of its output folder;
// checkedEntries keeps it inside. Revisit when a 7-Zip >= 25 build is approved (e.g. npm 7zip-bin-full, ~80 MB).

// Far above any real map file (32x32: SMT ~180 MB, a 16384² BC3 texture with mips ~340 MB; BAR's largest ~320 MB
// in all), far below a full disk: anything bigger is an archive bomb, refused before extraction.
const MAX_ENTRY = 2 ** 30, MAX_TOTAL = 4 * 2 ** 30;
const GB = (bytes) => `${(bytes / 2 ** 30).toFixed(1)} GB`;

const run = promisify(execFile);

async function sevenZ(args, cwd, signal) {
  try {
    // -bsp0: no progress on stdout (callers that do not read stdout add -bso0); errors still go to stderr.
    return (await run(sevenZip.path7za, [...args, '-bsp0', '-y'], { cwd, windowsHide: true, maxBuffer: 64 << 20, signal })).stdout;
  } catch (error) {
    if (signal?.aborted) throw signal.reason; // killed on purpose: not a 7-Zip failure
    // execFile rejects on any non-zero exit (7-Zip: 1 warning, 2 fatal, 7 bad command line, 8 out of memory).
    const action = { a: 'pack', l: 'list', x: 'extract' }[args[0]];
    throw new Error(`7-Zip could not ${action} the archive (exit ${error.code}): ${String(error.stderr || error.message).trim()}`);
  }
}

function tempDir(prefix) {
  mkdirSync(TEMP_ROOT, { recursive: true });
  return mkdtempSync(join(TEMP_ROOT, prefix));
}

// One `7za l -ba -slt` block ("Key = value" lines) as {path, size, folder, windows, unix}. Attributes are
// "<Windows flags>[ <Unix mode>]", e.g. "A", "RD", "D drwxr-xr-x", " lrwxrwxrwx".
function parseEntry(block, name) {
  const fields = Object.fromEntries(block.split(/\r?\n/).map((line) => {
    const at = line.indexOf(' = ');
    if (at < 1) throw new Error(`7-Zip listed ${name} in an unexpected form: "${line}"`);
    return [line.slice(0, at), line.slice(at + 3)];
  }));
  // 7z and zip list Attributes for every entry; formats without them (tar, with its hard links) are refused here.
  if (fields.Path === undefined || fields.Attributes === undefined) throw new Error(`7-Zip listed ${name} in an unexpected form: "${block}"`);
  const [windows, unix = '-'] = fields.Attributes.split(' ');
  return { path: fields.Path.replaceAll('\\', '/'), size: Number(fields.Size || 0), folder: fields.Folder === '+' || windows.includes('D'), windows, unix };
}

// Why an entry must not be extracted, or null. L is a Windows reparse point; a Unix type other than - (file) or
// d (folder) is a link or a device. 7-Zip 21.07 turns Unix link entries into real links and then writes later entries
// through them (CVE-2025-11001 class); it may write a ':' name part as an NTFS stream.
function unsafe(entry, parents) {
  if (entry.windows.includes('L') || !'-d'.includes(entry.unix[0] || '?')) return 'is a link';
  if (/[\x00-\x1f\x7f]/.test(entry.path)) return 'has a control character in its name';
  if (entry.path.startsWith('/') || /^[a-z]:/i.test(entry.path)) return 'has an absolute path';
  if (entry.path.includes(':')) return "has a ':' in its name";
  if (entry.path.split('/').includes('..')) return 'points outside the archive (..)';
  if (!entry.folder && parents.has(entry.path.toLowerCase())) return 'is both a file and a folder';
  if (!(entry.size <= MAX_ENTRY)) return `unpacks to ${GB(entry.size)} (more than any map file)`;
  return null;
}

/**
 * Every entry of an archive, after refusing archives that are unsafe to extract: links, absolute or '..' paths,
 * a file that is also a folder of another entry, or sizes beyond any real map. `7za l -ba -slt` prints the entries
 * only (no archive comment to spoof them); 7-Zip shows a line break in a name as '_'.
 * @returns {Promise<ReturnType<typeof parseEntry>[]>}
 */
async function checkedEntries(archivePath) {
  const name = basename(archivePath);
  const text = await sevenZ(['l', '-ba', '-slt', resolve(archivePath)]);
  const entries = text.split(/\r?\n\r?\n/).filter((block) => block.trim()).map((block) => parseEntry(block, name));
  // Windows paths are case-insensitive: "maps/X.lua" (a file) and "maps/x.lua/y.lua" collide.
  const parents = new Set(entries.flatMap(({ path }) => path.toLowerCase().split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
  for (const entry of entries) {
    const reason = unsafe(entry, parents);
    if (reason) throw new Error(`Refused ${name}: its entry "${entry.path}" ${reason}. Nothing was extracted.`);
  }
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total > MAX_TOTAL) throw new Error(`Refused ${name}: it unpacks to ${GB(total)}, more than any map. Nothing was extracted.`);
  return entries;
}

/** Every file in a .sd7/.sdz archive as [{path, size}] ('/' separators), without extracting anything. Refuses unsafe archives. */
export async function listArchive(archivePath) {
  return (await checkedEntries(archivePath)).filter((entry) => !entry.folder).map(({ path, size }) => ({ path, size }));
}

/**
 * The files of a .sd7/.sdz archive, keyed by their path inside the archive ('/' separators). Unsafe archives are
 * refused before 7-Zip writes anything (see checkedEntries).
 * @param {string[]} [only]  file name wildcards (e.g. '*.lua'), matched in every folder; every file when omitted
 */
export async function readArchive(archivePath, only = []) {
  // shortcut: listed, then extracted by path: a file swapped in between is not listed again (that needs write access
  // to its folder; the link scan below still runs). Revisit if archives ever come from a shared folder.
  await checkedEntries(archivePath);
  const dir = tempDir('extract-');
  try {
    await sevenZ(['x', resolve(archivePath), `-o${dir}`, '-bso0', ...only.map((pattern) => `-ir!${pattern}`)]);
    const files = new Map();
    // Defence in depth: a link 7-Zip made anyway fails the read. The recursive listing does not follow links.
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      const path = join(entry.parentPath, entry.name), inside = relative(dir, path).split(sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`Refused ${basename(archivePath)}: 7-Zip made a link at "${inside}".`);
      if (entry.isFile()) files.set(inside, new Uint8Array(readFileSync(path)));
    }
    return files;
  } finally {
    rmSync(dir, { recursive: true, force: true }); // removes links themselves, never what they point to
  }
}

/**
 * Packs files (Map of archive path -> bytes) into a non-solid LZMA2 .sd7, replacing outPath atomically.
 * Aborting signal kills 7-Zip, leaves outPath as it was and rejects with signal.reason.
 */
export async function writeSd7(files, outPath, { signal } = {}) {
  const dir = tempDir('pack-');
  const partial = `${resolve(outPath)}.partial`; // 7-Zip `a` appends to an existing archive, so always start fresh
  try {
    for (const [path, bytes] of files) {
      const target = join(dir, path);
      if (!target.startsWith(dir + sep)) throw new Error(`archive path escapes the archive: ${path}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    rmSync(partial, { force: true });
    // -mx=1 (fast) in 1 MB LZMA2 chunks spread over every core: a detailed 32x32 map (310 MB, mostly DXT) packs in
    // ~3 s instead of ~5 s with 8 MB chunks or ~13 s at -mx=3, for 1% and ~10% more bytes (Wave 1 used -mx=7).
    await sevenZ(['a', '-t7z', '-m0=LZMA2:c=1m', '-mx=1', '-mmt=on', '-ms=off', '-bso0', partial, '.'], dir, signal);
    renameSync(partial, outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(partial, { force: true });
  }
}
