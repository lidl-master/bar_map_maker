// A non-square (4x2) map through the whole export: SMF and SMT shapes, DDS sizes from the strip-wise bake, the
// DDS stored south (bottom) row first, and the archive opening back as the same map.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { readArchive, TEMP_ROOT } from '../../src/archive/index.js';
import { exportMap, openMapArchive } from '../../src/bar/index.js';
import { decodeDxt1, readDdsHeader, readSmf, readSmt, TILE_BYTES } from '../../src/formats/index.js';
import { BIOMES, ROLES } from '../../src/look/index.js';
import { TEXTURE_ROOT } from '../../src/look/library-load.js';
import { readMapInfo } from '../../src/lua/index.js';
import { testMap } from '../helpers/test-map.js';

mkdirSync(TEMP_ROOT, { recursive: true });
const outDir = mkdtempSync(join(TEMP_ROOT, 'export-shape-test-'));
after(() => rmSync(outDir, { recursive: true, force: true }));
const skip = !existsSync(join(TEXTURE_ROOT, 'manifest.json')) && 'texture library not built (npm run textures)';

// Mean of each RGBA channel over rows [y0, y1) of level 0 of a BC3 DDS, rows in stored order (bottom first).
function bc3Means(dds, y0, y1) {
  const { width, height } = readDdsHeader(dds), blocks = (width / 4) * (height / 4);
  const colour = new Uint8Array(blocks * 8);
  for (let b = 0; b < blocks; b++) colour.set(dds.subarray(128 + b * 16 + 8, 128 + b * 16 + 16), b * 8);
  const rgba = decodeDxt1(colour, width, height), sum = [0, 0, 0];
  for (let o = y0 * width * 4; o < y1 * width * 4; o += 4) for (let c = 0; c < 3; c++) sum[c] += rgba[o + c];
  return sum.map((s) => s / ((y1 - y0) * width));
}

test('a 4x2 map exports with its own shape, DDS stored south first, and opens back', { skip, timeout: 120_000 }, async () => {
  const doc = testMap({ sx: 4, sz: 2, name: 'Wide Test' });
  // The south half painted with the biome's cliff material: its splat channel dominates there, ground in the north.
  const cliffChannel = BIOMES.temperate.splats.indexOf(BIOMES.temperate.materials.cliff);
  assert.ok(cliffChannel > 0 && cliffChannel < 3, 'the cliff splat is in an RGB channel other than ground');
  doc.paint.fill(0);
  for (let k = ((doc.H + 1) / 2) * doc.W; k < doc.W * doc.H; k++) {
    doc.paint[k] = ROLES.indexOf('cliff') + 1;
    doc.paintWeight[k] = 255;
  }
  const { archivePath } = await exportMap(doc, outDir);
  const files = await readArchive(archivePath);

  const smf = readSmf(files.get('maps/Wide_Test.smf'));
  assert.deepEqual([smf.mapx, smf.mapy], [256, 128]);
  assert.equal(smf.heights.length, 257 * 129);
  assert.equal(smf.tileIndex.length, 64 * 32);
  assert.ok(smf.tileIndex.every((t) => t >= 0 && t < readSmt(files.get('maps/Wide_Test.smt')).length / TILE_BYTES));
  for (let k = 0; k < doc.heights.length; k += 37) { // non-square: a transposed heightmap would not match
    assert.ok(Math.abs(smf.minHeight + (smf.heights[k] * (smf.maxHeight - smf.minHeight)) / 65536 - doc.heights[k]) < 0.01, `height ${k}`);
  }

  const { raw: { resources } } = await readMapInfo(files);
  for (const [key, elmos] of [['specularTex', 4], ['splatDistrTex', 4], ['detailNormalTex', 1]]) {
    const header = readDdsHeader(files.get(`maps/${resources[key.toLowerCase()]}`));
    assert.deepEqual([header.width, header.height], [2048 / elmos, 1024 / elmos], key);
  }
  const splat = files.get(`maps/${resources.splatdistrtex}`), rows = readDdsHeader(splat).height;
  const south = bc3Means(splat, 0, rows / 2 - 4), north = bc3Means(splat, rows / 2 + 4, rows);
  assert.ok(south[cliffChannel] > 150 && north[cliffChannel] < 60, `cliff weight south ${south[cliffChannel]}, north ${north[cliffChannel]}`);
  assert.ok(north[0] > south[0] + 100, `ground weight north ${north[0]}, south ${south[0]}`);

  const { doc: opened } = await openMapArchive(archivePath);
  assert.deepEqual([opened.sx, opened.sz, opened.W, opened.H], [4, 2, 257, 129]);
  assert.ok(opened.heights.every((h, k) => Math.abs(h - doc.heights[k]) < 0.01), 'heights read back');
});
