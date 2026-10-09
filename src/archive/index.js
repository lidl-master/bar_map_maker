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
    // -bso0 -bsp0: no file list or progress on stdout; errors still go to stderr.
    await run(sevenZip.path7za, [...args, '-bso0', '-bsp0', '-y'], { cwd, windowsHide: true, maxBuffer: 16 << 20 });
  } catch (error) {
    // execFile rejects on any non-zero exit (7-Zip: 1 warning, 2 fatal, 7 bad command line, 8 out of memory).
    throw new Error(`7-Zip ${args[0]} failed (exit ${error.code}): ${String(error.stderr || error.message).trim()}`);
  }
}

function tempDir(prefix) {
  mkdirSync(TEMP_ROOT, { recursive: true });
  return mkdtempSync(join(TEMP_ROOT, prefix));
}

/** Every file in a .sd7/.sdz archive, keyed by its path inside the archive ('/' separators). */
export async function readArchive(archivePath) {
  const dir = tempDir('extract-');
  try {
    await sevenZ(['x', resolve(archivePath), `-o${dir}`]);
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
    await sevenZ(['a', '-t7z', '-m0=LZMA2', '-mx=7', '-ms=off', partial, '.'], dir);
    renameSync(partial, outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(partial, { force: true });
  }
}
