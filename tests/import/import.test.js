// Opening existing maps: DXT1 decoding, BAR's metal spot maths, and an untouched import of every map in the user's
// BAR maps folder (read-only; extracted to .engine-tmp; skipped when BAR is not installed).
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readArchive } from '../../src/archive/index.js';
import { locateBar, openMapArchive } from '../../src/bar/index.js';
import { buildMetalMap, decodeDxt1, encodeDxt1Mips, TILE_BYTES } from '../../src/formats/index.js';
import { findMetalSpots, importMap, readMapData } from '../../src/import/index.js';
import { readMapInfo } from '../../src/lua/index.js';
import { testMap } from '../helpers/test-map.js';

test('DXT1 decode inverts the encoder and handles both block modes', () => {
  const rgb = new Uint8ClampedArray(8 * 8 * 3).map((_, k) => (k % 3 === 0 ? 40 + (k % 24) * 8 : k % 3 === 1 ? 120 : 200 - (k % 24) * 4));
  const rgba = decodeDxt1(encodeDxt1Mips(rgb, 8), 8, 8);
  for (let p = 0; p < 64; p++) {
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(rgba[p * 4 + c] - rgb[p * 3 + c]) <= 12, `texel ${p} channel ${c}`);
    assert.equal(rgba[p * 4 + 3], 255);
  }
  // c0 = white > c1 = black: indices 0..3 are white, black, 2/3 white, 1/3 white (first row), rest black.
  const four = decodeDxt1(Uint8Array.of(0xff, 0xff, 0, 0, 0b11100100, 0x55, 0x55, 0x55), 4, 4);
  assert.deepEqual([...four.subarray(0, 16)], [255, 255, 255, 255, 0, 0, 0, 255, 170, 170, 170, 255, 85, 85, 85, 255]);
  // c0 <= c1: index 2 is the average, index 3 transparent black.
  const three = decodeDxt1(Uint8Array.of(0, 0, 0xff, 0xff, 0b11100100, 0, 0, 0), 4, 4);
  assert.deepEqual([...three.subarray(0, 16)], [0, 0, 0, 255, 255, 255, 255, 255, 127, 127, 127, 255, 0, 0, 0, 0]);
});

test('metal spots come back from a built metal map with their values, near their positions', () => {
  const doc = testMap();
  const built = buildMetalMap(doc);
  const spots = findMetalSpots(built.data, built.width, built.height, { maxMetal: built.maxMetal, extractorRadius: 90 });
  const metal = doc.objects.filter((o) => o.type === 'metal');
  assert.equal(spots.length, metal.length);
  for (const [i, o] of metal.entries()) {
    const spot = spots.find((s) => Math.hypot(s.x - o.x, s.z - o.z) < 16);
    assert.ok(spot, `spot ${i} at (${o.x}, ${o.z})`);
    assert.ok(Math.abs(spot.metal - built.values[i]) < 1e-9, `spot ${i} value ${spot.metal} vs ${built.values[i]}`);
  }
});

test('metal spots: diagonal pixels join, the outer pixel ring is ignored, a metal field has no spots', () => {
  const metal = new Uint8Array(32 * 32);
  metal[5 * 32 + 5] = metal[6 * 32 + 6] = 100; // one spot, diagonal neighbours
  metal[0 * 32 + 10] = 255; // outer ring: BAR never reads it
  const [spot, ...rest] = findMetalSpots(metal, 32, 32, { maxMetal: 2, extractorRadius: 90 });
  assert.deepEqual(rest, []);
  assert.deepEqual(spot, { x: 96, z: 96, metal: 0.4 });
  metal.fill(10, 32 * 2, 32 * 30); // a 512-elmo-wide blob: more than 6 extractor radii
  assert.deepEqual(findMetalSpots(metal, 32, 32, { maxMetal: 2, extractorRadius: 50 }), []);
});

let mapsDir = null;
try { mapsDir = locateBar().mapsDir; } catch { /* no BAR install: the real-map tests skip */ }
const maps = mapsDir && existsSync(mapsDir) ? readdirSync(mapsDir).filter((name) => /\.sd[7z]$/i.test(name)) : [];

let largest = null; // the biggest map by area, timed below

// Interior metal pixels: BAR's spot finder never reads the outermost ring.
function interiorMetal(data, width, height) {
  let sum = 0;
  for (let z = 1; z < height - 1; z++) for (let x = 1; x < width - 1; x++) sum += data[z * width + x];
  return sum;
}

test('every installed BAR map imports untouched: heights, tiles, metal, features', { skip: !maps.length && 'no BAR maps folder' }, async () => {
  const sizes = [];
  for (const name of maps) {
    const archive = join(mapsDir, name);
    const files = await readArchive(archive, ['*.lua', '*.smf', '*.smt']);
    const doc = await importMap(files, { archive, listing: [] });
    const { smf, tiles } = readMapData(files, await readMapInfo(files));
    const { original } = doc;
    assert.deepEqual([doc.W, doc.H, doc.symmetry], [smf.mapx + 1, smf.mapy + 1, 'none'], name);

    // Heights quantise back to the SMF's own values with the original range, which the export must keep.
    const scale = 65536 / (original.maxHeight - original.minHeight);
    for (let k = 0; k < smf.heights.length; k++) {
      const raw = Math.round((doc.heights[k] - original.minHeight) * scale);
      if (raw !== smf.heights[k]) assert.fail(`${name}: height ${k} quantises to ${raw}, the SMF has ${smf.heights[k]}`);
    }

    assert.deepEqual(original.tileIndex, smf.tileIndex, `${name}: tile index`);
    for (const t of [0, (tiles.length / TILE_BYTES) >> 1, tiles.length / TILE_BYTES - 1]) {
      assert.deepEqual(original.tileMips.subarray(t * 8, t * 8 + 8), tiles.subarray((t + 1) * TILE_BYTES - 8, (t + 1) * TILE_BYTES), `${name}: tile ${t} mip`);
    }

    const width = doc.sx * 32, height = doc.sz * 32, spots = doc.objects.filter((o) => o.type === 'metal');
    const metalSum = interiorMetal(smf.metal, width, height);
    assert.equal(spots.length > 0, metalSum > 0, `${name}: spots exist exactly when the metal map has metal`);
    const total = spots.reduce((s, o) => s + o.metal, 0), expected = (metalSum * original.maxMetal) / 1000;
    assert.ok(Math.abs(total - expected) < 1e-6 * Math.max(1, expected), `${name}: spot values add up to ${total}, the metal map to ${expected}`);
    assert.deepEqual(original.metalMap, smf.metal, `${name}: metal map`);

    const geos = doc.objects.filter((o) => o.type === 'geo').length, features = doc.objects.filter((o) => o.type === 'feature').length;
    assert.equal(geos + features, smf.features.length, `${name}: features`);
    assert.equal(doc.objects.filter((o) => o.type === 'start').length, (await readMapInfo(files)).teams.length, `${name}: starts`);
    assert.equal(new Set(doc.objects.map((o) => o.group)).size, doc.objects.length, `${name}: every object is its own group`);
    sizes.push({ name, units: doc.sx * doc.sz });
  }
  largest = sizes.sort((a, b) => b.units - a.units)[0].name;
});


test('the largest installed map opens in 10 s or less (archive path to doc)', { skip: !maps.length && 'no BAR maps folder' }, async () => {
  const archive = join(mapsDir, largest ?? maps[0]);
  const start = performance.now();
  const { doc, seconds } = await openMapArchive(archive);
  const total = (performance.now() - start) / 1000;
  console.log(`${doc.original.info.name} (${doc.sx} × ${doc.sz}): ${total.toFixed(2)} s = extract ${seconds.extract.toFixed(2)} s + import ${seconds.import.toFixed(2)} s`);
  assert.ok(total <= 10, `${total.toFixed(2)} s`);
  assert.ok(doc.original.files.some((f) => /\.smt$/i.test(f.path) && f.size > 0), 'the listing names every archive file with its size');
});
