// Export a MapDoc as a BAR map archive. Node-only: the bake runs on every CPU core in worker threads.
import { readFileSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { writeSd7 } from '../archive/index.js';
import { assembleDds, buildMapFiles, encodeDxt1Mips, mapFileBase } from '../formats/index.js';
import { bakeMaterials, finishMinimap, materialTable, MATERIAL_LIBRARY } from '../look/index.js';
import { decodePng, TEXTURE_ROOT } from '../look/library-load.js';

const BAKE_WORKER = new URL('./bake-worker.js', import.meta.url);
const STRIP_ROWS = 8; // SMT tile rows per worker job (256 elmos)

// A copy in shared memory, so every worker reads the same array instead of getting its own copy.
function shared(array) {
  const copy = new array.constructor(new SharedArrayBuffer(array.byteLength));
  copy.set(array);
  return copy;
}

// Runs jobs across worker threads; onResult(result) per finished job.
function runBakeJobs(workerData, jobs, onResult) {
  return new Promise((done, fail) => {
    const workers = [];
    let next = 0, finished = 0;
    const stopAll = () => workers.forEach((worker) => worker.terminate());
    const feed = (worker) => (next < jobs.length ? worker.postMessage(jobs[next++]) : worker.terminate());
    for (let n = 0; n < Math.min(availableParallelism(), jobs.length); n++) {
      const worker = new Worker(BAKE_WORKER, { workerData });
      workers.push(worker);
      worker.on('message', (result) => {
        onResult(result);
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

const libraryPath = (id, kind) => join(TEXTURE_ROOT, MATERIAL_LIBRARY.find((m) => m.id === id).files[kind]);

const concat = (arrays) => {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  arrays.reduce((o, a) => { out.set(a, o); return o + a.length; }, 0);
  return out;
};

// The diffuse (SMT tiles), minimap, grass and texture stack, baked and encoded on all cores. Progress 0..0.75.
async function bakeTexture(doc, plan, onProgress) {
  onProgress(0, 'Loading materials');
  const tables = Object.fromEntries(bakeMaterials(doc).map((id) => {
    const m = MATERIAL_LIBRARY.find((entry) => entry.id === id);
    return [id, shared(materialTable(decodePng(readFileSync(libraryPath(id, 'albedo'))), m.tileElmos))];
  }));
  // Splat detail textures: the library PNG as is, or BC3 DDS encoded by the workers alongside the first strips.
  const dntsIds = [...new Set(plan.splats.map((s) => s.id))];
  const dnts = new Map(plan.dnts === 'png' ? dntsIds.map((id) => [id, new Uint8Array(readFileSync(libraryPath(id, 'dnts')))]) : []);
  const workerDoc = {
    sx: doc.sx, sz: doc.sz, W: doc.W, H: doc.H, biome: doc.biome, settings: doc.settings, objects: doc.objects,
    heights: shared(doc.heights), paint: shared(doc.paint), paintWeight: shared(doc.paintWeight),
  };
  const strips = new Array((doc.sz * 16) / STRIP_ROWS);
  const jobs = [...(plan.dnts === 'dds' ? dntsIds : []), ...Array.from(strips, (_, i) => i)];
  const dntsFiles = Object.fromEntries(dntsIds.map((id) => [id, libraryPath(id, 'dnts')]));
  await runBakeJobs({ doc: workerDoc, tables, layers: plan.layers, stripRows: STRIP_ROWS, dntsFiles }, jobs, (result) => {
    if (result.dnts) dnts.set(result.dnts, result.dds);
    else strips[result.strip] = result;
    onProgress((0.75 * strips.filter(Boolean).length) / strips.length, 'Baking texture');
  });
  onProgress(0.75, 'Encoding textures');
  const width = doc.sx * 512, height = doc.sz * 512;
  const dds = (layer, elmos, format) => assembleDds(strips.map((s) => s[layer]), width / elmos, height / elmos, format);
  const grass = concat(strips.map((s) => s.grass));
  return {
    tiles: concat(strips.map((s) => s.tiles)),
    minimap: encodeDxt1Mips(finishMinimap(doc, concat(strips.map((s) => s.minimap))), 1024),
    grass: grass.some((g) => g) ? grass : null,
    textures: {
      splatDistrTex: dds('splat', plan.layers.splat, 'bc3'),
      specularTex: dds('spec', plan.layers.spec, 'bc3'),
      detailNormalTex: dds('normal', plan.layers.normal, 'bc1'),
      ...Object.fromEntries(plan.splats.map(({ id }, i) => [`splatDetailNormalTex${i + 1}`, dnts.get(id)])),
    },
  };
}

/**
 * @param {import('../core/index.js').MapDoc} doc
 * @param {string} outDir
 * @param {{onProgress?: (fraction: number, label: string) => void, quality?: 'standard'|'share'}} [options]
 *   quality: src/look QUALITY preset (Share: flat-colour diffuse and smaller stack textures, <= 50 MB for 32x32)
 * @returns {Promise<{archivePath: string, bytes: number}>}
 */
export async function exportMap(doc, outDir, { onProgress = () => {}, quality = 'standard' } = {}) {
  const archivePath = join(resolve(outDir), archiveFileName(doc.settings));
  const files = await buildMapFiles(doc, (plan) => bakeTexture(doc, plan, onProgress), { quality });
  onProgress(0.85, 'Packing archive');
  await writeSd7(files, archivePath); // shortcut: no progress inside 7-Zip
  onProgress(1, 'Done');
  return { archivePath, bytes: statSync(archivePath).size };
}
