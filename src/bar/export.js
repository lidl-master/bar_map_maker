// Export a MapDoc as a BAR map archive. Node-only: the bake runs on every CPU core in worker threads.
import { statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { writeSd7 } from '../archive/index.js';
import { buildMapFiles, mapFileBase, TILE_BYTES } from '../formats/index.js';

const BAKE_WORKER = new URL('./bake-worker.js', import.meta.url);

// A copy in shared memory, so every worker reads the same array instead of getting its own copy.
function shared(array) {
  const copy = new array.constructor(new SharedArrayBuffer(array.byteLength));
  copy.set(array);
  return copy;
}

// Runs jobs (tile row numbers and 'minimap') across worker threads; onResult(job, bytes) per finished job.
function runBakeJobs(doc, jobs, onResult) {
  return new Promise((done, fail) => {
    const workers = [];
    let next = 0, finished = 0;
    const stopAll = () => workers.forEach((worker) => worker.terminate());
    const feed = (worker) => (next < jobs.length ? worker.postMessage(jobs[next++]) : worker.terminate());
    for (let n = 0; n < Math.min(availableParallelism(), jobs.length); n++) {
      const worker = new Worker(BAKE_WORKER, { workerData: doc });
      workers.push(worker);
      worker.on('message', ({ job, data }) => {
        onResult(job, data);
        if (++finished === jobs.length) done();
        feed(worker);
      });
      worker.on('error', (error) => {
        stopAll();
        fail(error);
      });
      feed(worker);
    }
  });
}

/** `<name>_<version>.sd7`, lower case, as BAR's map archives are named. */
function archiveFileName(settings) {
  return `${mapFileBase(settings.name)}_${mapFileBase(settings.version)}.sd7`.toLowerCase();
}

// Every SMT tile and the minimap, baked and DXT1-encoded on all cores. Reports progress 0..0.8.
async function bakeTexture(doc, onProgress) {
  const tilesX = doc.sx * 16, tilesZ = doc.sz * 16;
  const workerDoc = {
    sx: doc.sx, sz: doc.sz, W: doc.W, H: doc.H, biome: doc.biome, settings: doc.settings, objects: doc.objects,
    heights: shared(doc.heights), paint: shared(doc.paint), paintWeight: shared(doc.paintWeight),
  };
  const tiles = new Uint8Array(tilesX * tilesZ * TILE_BYTES);
  let minimap, finished = 0;
  const jobs = ['minimap', ...Array.from({ length: tilesZ }, (_, row) => row)]; // the minimap is the longest job: start it first
  onProgress(0, 'Baking texture');
  await runBakeJobs(workerDoc, jobs, (job, data) => {
    if (job === 'minimap') minimap = data;
    else tiles.set(data, job * tilesX * TILE_BYTES);
    onProgress((0.8 * ++finished) / jobs.length, 'Baking texture');
  });
  return { tiles, minimap };
}

/**
 * @param {import('../core/index.js').MapDoc} doc
 * @param {string} outDir
 * @param {{onProgress?: (fraction: number, label: string) => void}} [options]
 * @returns {Promise<{archivePath: string, bytes: number}>}
 */
export async function exportMap(doc, outDir, { onProgress = () => {} } = {}) {
  const archivePath = join(resolve(outDir), archiveFileName(doc.settings));
  const files = await buildMapFiles(doc, () => bakeTexture(doc, onProgress));
  onProgress(0.85, 'Packing archive');
  await writeSd7(files, archivePath); // shortcut: no progress inside 7-Zip; it is the last ~15%
  onProgress(1, 'Done');
  return { archivePath, bytes: statSync(archivePath).size };
}
