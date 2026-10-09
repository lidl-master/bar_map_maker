// The texture bake on every CPU core (worker threads running bake-worker.js). Node-only.
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { assembleDds, encodeDxt1Mips } from '../formats/index.js';
import { bakeMaterials, finishMinimap, materialTable, MATERIAL_LIBRARY } from '../look/index.js';
import { decodePng, TEXTURE_ROOT } from '../look/library-load.js';
import { EXPORT_STEPS } from './steps.js';

const BAKE_WORKER = new URL('./bake-worker.js', import.meta.url);
export const STRIP_ROWS = 4; // SMT tile rows per worker job (128 elmos): small jobs keep every core busy to the end
const [LOADING, BAKING, ENCODING] = EXPORT_STEPS.map;

// A copy in shared memory, so every worker reads the same array instead of getting its own copy.
function shared(array) {
  const copy = new array.constructor(new SharedArrayBuffer(array.byteLength));
  copy.set(array);
  return copy;
}

// Runs jobs across worker threads; onResult(result) per finished job. An abort stops every worker and rejects with
// the signal's reason.
function runBakeJobs(workerData, jobs, onResult, signal) {
  return new Promise((done, fail) => {
    signal.throwIfAborted();
    if (!jobs.length) return done();
    const workers = [];
    let next = 0, finished = 0;
    const stopAll = () => workers.forEach((worker) => worker.terminate());
    const abort = () => {
      stopAll();
      fail(signal.reason);
    };
    const settle = (fn, value) => {
      signal.removeEventListener('abort', abort);
      fn(value);
    };
    signal.addEventListener('abort', abort, { once: true });
    const feed = (worker) => (next < jobs.length ? worker.postMessage(jobs[next++]) : worker.terminate());
    for (let n = 0; n < Math.min(availableParallelism(), jobs.length); n++) {
      const worker = new Worker(BAKE_WORKER, { workerData });
      workers.push(worker);
      worker.on('message', (result) => {
        onResult(result);
        if (++finished === jobs.length) settle(done);
        feed(worker);
      });
      worker.on('error', (error) => {
        stopAll();
        settle(fail, error);
      });
      feed(worker);
    }
  });
}

const libraryPath = (id, kind) => join(TEXTURE_ROOT, MATERIAL_LIBRARY.find((m) => m.id === id).files[kind]);

// Starts the bake of `jobs` (strip numbers and, for DDS splat detail textures, library ids); see bake-worker.js.
function bakeJobs(doc, plan, jobs, onResult, signal) {
  const tables = Object.fromEntries(bakeMaterials(doc).map((id) => {
    const m = MATERIAL_LIBRARY.find((entry) => entry.id === id);
    return [id, shared(materialTable(decodePng(readFileSync(libraryPath(id, 'albedo'))), m.tileElmos))];
  }));
  const workerDoc = {
    sx: doc.sx, sz: doc.sz, W: doc.W, H: doc.H, biome: doc.biome, settings: doc.settings, objects: doc.objects,
    heights: shared(doc.heights), paint: shared(doc.paint), paintWeight: shared(doc.paintWeight),
  };
  const dntsFiles = Object.fromEntries(plan.splats.map(({ id }) => [id, libraryPath(id, 'dnts')]));
  return runBakeJobs({ doc: workerDoc, tables, layers: plan.layers, stripRows: STRIP_ROWS, dntsFiles }, jobs, onResult, signal);
}

const concat = (arrays) => {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  arrays.reduce((o, a) => { out.set(a, o); return o + a.length; }, 0);
  return out;
};

/**
 * The diffuse (SMT tiles), minimap, grass and texture stack of a new map, baked and encoded on all cores.
 * Progress 0..0.75.
 * @returns {Promise<import('../formats/map-files.js').BakedTexture>}
 */
export async function bakeTexture(doc, plan, onProgress, signal) {
  onProgress(0, LOADING);
  // Splat detail textures: the library PNG as is, or BC3 DDS encoded by the workers alongside the first strips.
  const dntsIds = [...new Set(plan.splats.map((s) => s.id))];
  const dnts = new Map(plan.dnts === 'png' ? dntsIds.map((id) => [id, new Uint8Array(readFileSync(libraryPath(id, 'dnts')))]) : []);
  const strips = new Array((doc.sz * 16) / STRIP_ROWS);
  const jobs = [...(plan.dnts === 'dds' ? dntsIds : []), ...Array.from(strips, (_, i) => i)];
  await bakeJobs(doc, plan, jobs, (result) => {
    if (result.dnts) dnts.set(result.dnts, result.dds);
    else strips[result.strip] = result;
    onProgress((0.75 * strips.filter(Boolean).length) / strips.length, BAKING);
  }, signal);
  onProgress(0.75, ENCODING);
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
 * Only the SMT tiles of some strips (STRIP_ROWS tile rows of the full map width each), for derivative exports.
 * onStrip(strip, tiles) per finished strip (tiles: tilesX * STRIP_ROWS DXT1 tiles, row-major).
 * shortcut: the workers still bake and encode the stack layers of each strip (~10% of the work) and whole strips even
 * when only an east or west band is new; give bakeStrip a column range if derivative exports get slow.
 */
export async function bakeTileStrips(doc, plan, strips, onStrip, signal) {
  if (strips.length) await bakeJobs(doc, plan, strips, (result) => onStrip(result.strip, result.tiles), signal);
}
