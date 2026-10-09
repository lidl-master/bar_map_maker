// Install a map archive into a BAR maps folder. Node-only.
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile, rename, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { gzipSync } from 'node:zlib';

const ARCHIVE = /^(.*)\.(sd7|sdz)(\.md5\.gz)?$/i; // an archive or its md5 sidecar

async function md5(path) {
  const hash = createHash('md5');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

// The replace rule, shared by planInstall and installMap: every file in mapsDir that is this map under either
// extension, with or without its sidecar. Same extension: overwritten; other extension: removed.
function sameMap(archivePath, mapsDir) {
  const name = basename(archivePath);
  const match = ARCHIVE.exec(name);
  if (!match || match[3]) throw new Error(`not a map archive (.sd7 or .sdz): ${name}`);
  const files = [];
  for (const entry of readdirSync(mapsDir)) {
    const other = ARCHIVE.exec(entry);
    if (other && other[1].toLowerCase() === match[1].toLowerCase()) {
      files.push({ path: join(mapsDir, entry), otherExtension: other[2].toLowerCase() !== match[2].toLowerCase() });
    }
  }
  return { name, files };
}

/**
 * Throws (code 'BAR_MAPS_DIR') when `dir` is the BAR maps folder or inside it: exports go elsewhere, and only Install
 * (which asks first and writes the md5 sidecar BAR expects) writes there.
 */
export function checkExportDir(dir, mapsDir) {
  const rel = relative(resolve(mapsDir), resolve(dir));
  if (rel === '' || !(rel.startsWith('..') || isAbsolute(rel))) {
    throw Object.assign(new Error(`${dir} is BAR's own maps folder. Choose another export folder, and use Install to BAR to put a map into BAR.`), { code: 'BAR_MAPS_DIR' });
  }
}

/**
 * What installMap would replace, for the user to confirm first.
 * @param {string} archivePath
 * @param {{mapsDir: string}} options
 * @returns {{mapsDir: string, replaces: string[]}}
 */
export function planInstall(archivePath, { mapsDir }) {
  return { mapsDir, replaces: sameMap(archivePath, mapsDir).files.map((file) => file.path) };
}

/**
 * Copies the archive into mapsDir with its `.md5.gz` sidecar (gzip of "<md5>  <file name>\n", as BAR writes it),
 * then removes archives of the same name with the other extension (.sd7 vs .sdz) and their sidecars.
 * @param {string} archivePath
 * @param {{mapsDir: string}} options
 * @returns {Promise<{installedPath: string, removed: string[]}>}
 */
export async function installMap(archivePath, { mapsDir }) {
  const { name, files } = sameMap(archivePath, mapsDir);
  const installedPath = join(mapsDir, name);
  const partial = `${installedPath}.partial`; // BAR only scans .sd7/.sdz, so it never sees a half-copied file
  try {
    await copyFile(archivePath, partial);
    await rename(partial, installedPath);
  } finally {
    await rm(partial, { force: true }); // a failed copy leaves nothing in the maps folder
  }
  writeFileSync(`${installedPath}.md5.gz`, gzipSync(`${await md5(installedPath)}  ${name}\n`));

  const removed = files.filter((file) => file.otherExtension).map((file) => file.path);
  for (const path of removed) rmSync(path);
  return { installedPath, removed };
}
