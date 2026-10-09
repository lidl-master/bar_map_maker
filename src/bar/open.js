// Opening map archives for the editor: the BAR maps folder listing, minimap thumbnails and the open itself. Node-only.
// Archives are only ever read (7-Zip extracts into our own temp dir).
import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { listArchive, readArchive } from '../archive/index.js';
import { readSmf } from '../formats/index.js';

export const MAP_ARCHIVE = /\.sd[7z]$/i;
// What the editor reads: mapinfo.lua and any Lua it includes (mapconfig/lava.lua…), the SMF and its tile files.
const EDITOR_FILES = ['*.lua', '*.smf', '*.smt'];
const THUMB_SIZE = 256; // minimap mip used for thumbnails
const THUMB_OFFSET = 1024 * 1024 / 2 + 512 * 512 / 2; // the SMF minimap's 1024 and 512 DXT1 mips come first
const IMPORT_WORKER = new URL('./import-worker.js', import.meta.url);
const IMPORT_SECONDS = 10; // every installed map imports in under 0.5 s; past this the map's Lua is stuck

// importMap in a worker thread (the files move there, not copied), stopped after IMPORT_SECONDS.
async function importInWorker(files, source) {
  const worker = new Worker(IMPORT_WORKER);
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`this map's Lua took too long to read (over ${IMPORT_SECONDS} s)`)), IMPORT_SECONDS * 1000);
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.postMessage({ files, source }, [...files.values()].map((bytes) => bytes.buffer));
    });
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}

/** The map archives in a folder: [{file, name, sizeMB, mtime}], by name. */
export function listMaps(mapsDir) {
  return readdirSync(mapsDir).filter((name) => MAP_ARCHIVE.test(name)).map((name) => {
    const file = join(mapsDir, name), { size, mtimeMs } = statSync(file);
    return { file, name, sizeMB: size / 1048576, mtime: mtimeMs };
  }).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

/**
 * A map archive as a MapDoc with doc.original (src/import). onProgress(fraction, label) reports the steps.
 * @returns {Promise<{doc: import('../core/index.js').MapDoc, seconds: {extract: number, import: number}}>}
 */
export async function openMapArchive(archive, onProgress = () => {}) {
  const start = performance.now();
  onProgress(0.05, `Extracting ${basename(archive)}`);
  const [listing, files] = await Promise.all([listArchive(archive), readArchive(archive, EDITOR_FILES)]);
  const extracted = performance.now();
  onProgress(0.7, 'Reading heights, metal and textures');
  const doc = await importInWorker(files, { archive, listing });
  return { doc, seconds: { extract: (extracted - start) / 1000, import: (performance.now() - extracted) / 1000 } };
}

/** The map's size in units and its minimap's 256x256 DXT1 mip (32 KB), for the open screen's thumbnails. */
export async function readMinimapThumb(archive) {
  const files = await readArchive(archive, ['*.smf']);
  const smfPath = [...files.keys()].find((path) => /^maps\/[^/]+\.smf$/i.test(path));
  if (!smfPath) throw new Error(`${basename(archive)} has no maps/*.smf map file`);
  const smf = readSmf(files.get(smfPath));
  return { sx: smf.mapx / 64, sz: smf.mapy / 64, size: THUMB_SIZE, dxt1: smf.minimap.slice(THUMB_OFFSET, THUMB_OFFSET + THUMB_SIZE * THUMB_SIZE / 2) };
}
