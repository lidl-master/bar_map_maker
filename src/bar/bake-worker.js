// Worker thread for exportMap. A job is either a strip number (bakes that strip of SMT tile rows and encodes what
// can be encoded locally: its DXT1 tiles and the BC1/BC3 mip levels of its part of each stack texture) or a
// library material id (its splat detail texture as BC3 DDS, for the Share preset).
import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { encodeDds, encodeDxt1Mips, encodeStrip, TILE_BYTES } from '../formats/index.js';
import { bakeStrip, prepareBake } from '../look/index.js';
import { decodePng } from '../look/library-load.js';

const { doc, tables, layers, stripRows, dntsFiles } = workerData;
const ctx = prepareBake(doc, new Map(Object.entries(tables)), layers);
const tilesX = doc.sx * 16, width = tilesX * 32, rows = stripRows * 32;
const tile = new Uint8Array(32 * 32 * 3);

function bakeJob(strip) {
  const baked = bakeStrip(ctx, strip * stripRows, stripRows);
  const tiles = new Uint8Array(tilesX * stripRows * TILE_BYTES);
  for (let tz = 0; tz < stripRows; tz++) {
    for (let tx = 0; tx < tilesX; tx++) {
      for (let y = 0; y < 32; y++) tile.set(baked.rgb.subarray(((tz * 32 + y) * width + tx * 32) * 3, ((tz * 32 + y) * width + tx * 32 + 32) * 3), y * 96);
      tiles.set(encodeDxt1Mips(tile, 32), (tz * tilesX + tx) * TILE_BYTES);
    }
  }
  const layer = (data, elmos, format) => encodeStrip(data, width / elmos, rows / elmos, format);
  const result = {
    strip,
    tiles,
    minimap: baked.minimap,
    grass: baked.grass,
    splat: layer(baked.splat, layers.splat, 'bc3'),
    spec: layer(baked.spec, layers.spec, 'bc3'),
    normal: layer(baked.normal, layers.normal, 'bc1'),
  };
  const buffers = [tiles, baked.minimap, baked.grass, ...['splat', 'spec', 'normal'].flatMap((k) => [...result[k].levels, result[k].tail])];
  parentPort.postMessage(result, buffers.map((b) => b.buffer));
}

function dntsJob(id) {
  const { width: w, height: h, data } = decodePng(readFileSync(dntsFiles[id]));
  const dds = encodeDds(data, w, h, 'bc3');
  parentPort.postMessage({ dnts: id, dds }, [dds.buffer]);
}

parentPort.on('message', (job) => (typeof job === 'string' ? dntsJob(job) : bakeJob(job)));
