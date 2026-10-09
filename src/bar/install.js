// Install a map archive into a BAR maps folder. Node-only.
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { gzipSync } from 'node:zlib';

const ARCHIVE = /^(.*)\.(sd7|sdz)(\.md5\.gz)?$/i; // an archive or its md5 sidecar

async function md5(path) {
  const hash = createHash('md5');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Copies the archive into mapsDir with its `.md5.gz` sidecar (gzip of "<md5>  <file name>\n", as BAR writes it),
 * then removes archives of the same name with the other extension (.sd7 vs .sdz) and their sidecars.
 * @param {string} archivePath
 * @param {{mapsDir: string}} options
 * @returns {Promise<{installedPath: string, removed: string[]}>}
 */
export async function installMap(archivePath, { mapsDir }) {
  const name = basename(archivePath);
  const match = ARCHIVE.exec(name);
  if (!match || match[3]) throw new Error(`not a map archive (.sd7 or .sdz): ${name}`);
  const installedPath = join(mapsDir, name);
  const partial = `${installedPath}.partial`; // BAR only scans .sd7/.sdz, so it never sees a half-copied file
  copyFileSync(archivePath, partial);
  renameSync(partial, installedPath);
  writeFileSync(`${installedPath}.md5.gz`, gzipSync(`${await md5(installedPath)}  ${name}\n`));

  const removed = [];
  for (const entry of readdirSync(mapsDir)) {
    const other = ARCHIVE.exec(entry);
    if (other && other[1].toLowerCase() === match[1].toLowerCase() && other[2].toLowerCase() !== match[2].toLowerCase()) {
      rmSync(join(mapsDir, entry));
      removed.push(join(mapsDir, entry));
    }
  }
  return { installedPath, removed };
}
