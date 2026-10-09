// Map archives (.sd7 / .sdz) through 7-Zip. Node-only.
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import sevenZip from '7zip-bin';

// shortcut: scratch space lives in the repo's gitignored .engine-tmp (on D:, the user's big drive); a packaged
// app needs a user-chosen work dir instead (revisit with the installer, Wave 4).
export const TEMP_ROOT = resolve(import.meta.dirname, '../../.engine-tmp');

const run = promisify(execFile);

async function sevenZ(args, cwd) {
  try {
    // -bsp0: no progress on stdout (callers that do not read stdout add -bso0); errors still go to stderr.
    return (await run(sevenZip.path7za, [...args, '-bsp0', '-y'], { cwd, windowsHide: true, maxBuffer: 64 << 20 })).stdout;
  } catch (error) {
    // execFile rejects on any non-zero exit (7-Zip: 1 warning, 2 fatal, 7 bad command line, 8 out of memory).
    const action = { a: 'pack', l: 'list', x: 'extract' }[args[0]];
    throw new Error(`7-Zip could not ${action} the archive (exit ${error.code}): ${String(error.stderr || error.message).trim()}`);
  }
}

function tempDir(prefix) {
  mkdirSync(TEMP_ROOT, { recursive: true });
  return mkdtempSync(join(TEMP_ROOT, prefix));
}

/** Every file in a .sd7/.sdz archive as [{path, size}] ('/' separators), without extracting anything. */
export async function listArchive(archivePath) {
  const text = await sevenZ(['l', '-slt', resolve(archivePath)]);
  // -slt prints one "Key = value" block per entry after the "----------" line. Folders: attributes "D…" (7z) or "Folder = +" (zip).
  const field = (line) => [line.slice(0, line.indexOf(' = ')), line.slice(line.indexOf(' = ') + 3)];
  return text.split(/\r?\n----------\r?\n/)[1].split(/\r?\n\r?\n/)
    .map((block) => Object.fromEntries(block.split(/\r?\n/).filter((line) => line.includes(' = ')).map(field)))
    .filter((entry) => entry.Path && entry.Folder !== '+' && !entry.Attributes?.startsWith('D'))
    .map((entry) => ({ path: entry.Path.replaceAll('\\', '/'), size: Number(entry.Size) }));
}

/**
 * The files of a .sd7/.sdz archive, keyed by their path inside the archive ('/' separators).
 * @param {string[]} [only]  file name wildcards (e.g. '*.lua'), matched in every folder; every file when omitted
 */
export async function readArchive(archivePath, only = []) {
  const dir = tempDir('extract-');
  try {
    await sevenZ(['x', resolve(archivePath), `-o${dir}`, '-bso0', ...only.map((pattern) => `-ir!${pattern}`)]);
    const files = new Map();
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      files.set(relative(dir, path).split(sep).join('/'), new Uint8Array(readFileSync(path)));
    }
    return files;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Packs files (Map of archive path -> bytes) into a non-solid LZMA2 .sd7, replacing outPath atomically. */
export async function writeSd7(files, outPath) {
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
    await sevenZ(['a', '-t7z', '-m0=LZMA2:c=1m', '-mx=1', '-mmt=on', '-ms=off', '-bso0', partial, '.'], dir);
    renameSync(partial, outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(partial, { force: true });
  }
}
