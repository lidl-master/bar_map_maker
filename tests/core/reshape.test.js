// extendMap / resizeMap: a mistake here silently corrupts a map (shifted heights, lost objects, misaligned original
// tiles or metal), so the kept data is checked sample by sample.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { History, createMap, extendMap, resizeMap } from '../../src/core/index.js';
import { tx, tz, SYMMETRY } from '../../src/core/symmetry.js';
import { generate } from '../../src/terrain/index.js';
import { testMap } from '../helpers/test-map.js';

const SIDES = ['west', 'east', 'north', 'south'];

// A 4×4 test map with a fake doc.original: tile k has index k, metal pixel k has value k & 255.
function opened() {
  const doc = testMap({ sx: 4, sz: 4 });
  const tilesX = 64, tilesZ = 64, metal = new Uint8Array(128 * 128).map((_, k) => k & 255);
  doc.original = {
    archive: 'x.sd7', info: { name: 'X' }, files: new Map([['maps/x.smf', new Uint8Array(4)]]), tiles: new Uint8Array(680 * 4),
    tilesX, tilesZ, tileIndex: Int32Array.from({ length: tilesX * tilesZ }, (_, k) => k), metalMap: metal, maxMetal: 2,
    size: [4, 4], offset: [0, 0],
  };
  return doc;
}

// Every cell of grid `old` (w × h) sits at (+dx, +dz) in `next` (nw wide); every other cell holds `fill` (unless null).
function assertShifted(old, w, next, nw, dx, dz, fill, label) {
  const h = old.length / w, nh = next.length / nw;
  for (let j = 0; j < nh; j++) {
    for (let i = 0; i < nw; i++) {
      const oi = i - dx, oj = j - dz, inside = oi >= 0 && oj >= 0 && oi < w && oj < h;
      const want = inside ? old[oj * w + oi] : fill;
      if (want !== null && next[j * nw + i] !== want) assert.fail(`${label}: cell ${i},${j} is ${next[j * nw + i]}, expected ${want}`);
    }
  }
}

test('extend by every side combination keeps the old map exactly, shifted', () => {
  const doc = opened(), before = structuredClone({ ...doc, original: null });
  for (let mask = 0; mask < 16; mask++) {
    const sides = Object.fromEntries(SIDES.map((s, k) => [s, mask & (1 << k) ? 2 : 0]));
    const next = extendMap(doc, sides), label = JSON.stringify(sides);
    assert.equal(next.sx, 4 + sides.west + sides.east);
    assert.equal(next.sz, 4 + sides.north + sides.south);
    assert.equal(next.W, next.sx * 64 + 1);
    const dx = sides.west * 64, dz = sides.north * 64;
    assertShifted(doc.heights, doc.W, next.heights, next.W, dx, dz, null, `${label} heights`);
    assertShifted(doc.paint, doc.W, next.paint, next.W, dx, dz, 0, `${label} paint`);
    assertShifted(doc.paintWeight, doc.W, next.paintWeight, next.W, dx, dz, 0, `${label} paintWeight`);
    assert.ok(next.heights.every(Number.isFinite), `${label}: finite heights`);
    assert.deepEqual(next.objects, doc.objects.map((o) => ({ ...o, x: o.x + sides.west * 512, z: o.z + sides.north * 512 })), label);
    assertShifted(doc.original.tileIndex, 64, next.original.tileIndex, next.sx * 16, sides.west * 16, sides.north * 16, -1, `${label} tileIndex`);
    assertShifted(doc.original.metalMap, 128, next.original.metalMap, next.sx * 32, sides.west * 32, sides.north * 32, 0, `${label} metalMap`);
    assert.equal(next.original.tilesX, next.sx * 16);
    assert.equal(next.original.tilesZ, next.sz * 16);
    assert.deepEqual(next.original.offset, [sides.west, sides.north], `${label} offset`);
    assert.equal(next.original.size, doc.original.size, `${label}: original.size is the archive's`);
    for (const k of ['tiles', 'files', 'info']) assert.equal(next.original[k], doc.original[k], `${label}: original.${k} passes through`);
  }
  assert.deepEqual({ ...doc, original: null }, before, 'the input doc is not modified');
});

test('crop round-trips: extend +2 then -2 gives the same map back', () => {
  const doc = opened();
  for (const sides of [{ east: 2 }, { west: 2, north: 2 }, { west: 1, east: 1, north: 2, south: 2 }, { west: 2, east: -2 }]) {
    const back = Object.fromEntries(Object.entries(sides).map(([s, v]) => [s, -v]));
    const round = extendMap(extendMap(doc, sides), back), label = JSON.stringify(sides);
    for (const k of ['sx', 'sz', 'W', 'H']) assert.deepEqual(round[k], doc[k], `${label} ${k}`);
    if (sides.east === -2) continue; // a shift crops real terrain and objects on the way: only the size comes back
    assert.deepEqual(round.objects, doc.objects, `${label} objects`);
    for (const k of ['heights', 'paint', 'paintWeight']) assert.deepEqual(round[k], doc[k], `${label} ${k}`);
    assert.deepEqual(round.original.tileIndex, doc.original.tileIndex, `${label} tileIndex`);
    assert.deepEqual(round.original.metalMap, doc.original.metalMap, `${label} metalMap`);
  }
});

test('a crop drops the objects outside and slices every grid', () => {
  const doc = opened(), next = extendMap(doc, { west: -1, north: -1, east: -1, south: -1 });
  assert.equal(next.sx, 2);
  const inside = doc.objects.filter((o) => o.x >= 512 && o.x <= 1536 && o.z >= 512 && o.z <= 1536);
  assert.ok(inside.length < doc.objects.length && inside.length > 0);
  assert.deepEqual(next.objects, inside.map((o) => ({ ...o, x: o.x - 512, z: o.z - 512 })));
  assertShifted(doc.heights, doc.W, next.heights, next.W, -64, -64, null, 'heights');
  assertShifted(doc.original.tileIndex, 64, next.original.tileIndex, 32, -16, -16, null, 'tileIndex');
  assertShifted(doc.original.metalMap, 128, next.original.metalMap, 64, -32, -32, null, 'metalMap');
  assert.deepEqual(next.original.offset, [-1, -1]);
  assert.deepEqual(extendMap(next, { west: 3, east: -1 }).original.offset, [2, -1], 'offsets add up');
});

test('invalid results throw', () => {
  const doc = testMap({ sx: 4, sz: 4 });
  assert.throws(() => extendMap(doc, { east: 1 }), /even/);
  assert.throws(() => extendMap(doc, { east: 30 }), /2\.\.32/);
  assert.throws(() => extendMap(doc, { west: -4, east: 2 }), /whole map/);
  assert.throws(() => extendMap(doc, { east: 0.5, west: 1.5 }), /whole units/);
  assert.throws(() => resizeMap(doc, 5, 4), /even/);
  assert.throws(() => resizeMap(doc, 34, 4), /2\.\.32/);
});

test('new ground joins the edge without a step, on sides and corners', () => {
  const doc = createMap({ sx: 4, sz: 4 });
  for (let j = 0; j < doc.H; j++) for (let i = 0; i < doc.W; i++) doc.heights[j * doc.W + i] = 100 + 2 * i + 1.5 * j; // a ramp
  const next = extendMap(doc, { west: 2, east: 2, north: 2, south: 2 }), { W, H, heights: h } = next, lo = 128, hi = 128 + 256;
  const dist = (i, j) => Math.hypot(i - Math.min(hi, Math.max(lo, i)), j - Math.min(hi, Math.max(lo, j))); // to the old map
  for (let j = 1; j < H - 1; j++) {
    for (let i = 1; i < W - 1; i++) {
      const d = dist(i, j), k = j * W + i;
      if (d === 0) continue;
      // No step: next to the old edge every step is at most the ramp's own (2 elmos per sample).
      const step = Math.max(...[1, -1, W, -W].map((n) => Math.abs(h[k + n] - h[k])));
      if (d <= 3) assert.ok(step <= 2.01, `step ${step} at ${i},${j}`);
      // No crease: the slope changes gradually across the seam (the ramp itself has none).
      const bend = Math.max(Math.abs(h[k + 1] - 2 * h[k] + h[k - 1]), Math.abs(h[k + W] - 2 * h[k] + h[k - W]));
      if (d <= 16) assert.ok(bend <= 1.5, `bend ${bend} at ${i},${j}`);
      // Further out the ground eases to the base level: no cliffs anywhere.
      assert.ok(step <= 12, `step ${step} at ${i},${j}`);
    }
  }
});

test('symmetry survives a balanced reshape and is dropped otherwise', () => {
  const doc = createMap({ sx: 4, sz: 4, symmetry: 'rot180' });
  generate(doc, 'hills', { players: 2, seed: 3 });
  assert.equal(extendMap(doc, { east: 2 }).symmetry, 'none');
  const next = extendMap(doc, { east: 2, west: 2, north: -1, south: -1 });
  assert.equal(next.symmetry, 'rot180');
  const { W, H, heights: h } = next;
  for (const t of SYMMETRY.rot180.T) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const a = h[j * W + i], b = h[tz(t, i, j, H - 1) * W + tx(t, i, j, W - 1)];
      if (Math.abs(a - b) > 1e-3) assert.fail(`not symmetric at ${i},${j}: ${a} vs ${b}`);
    }
  }
  const square = createMap({ sx: 4, sz: 4, symmetry: 'rot90' });
  assert.equal(extendMap(square, { east: 2 }).symmetry, 'none');
  assert.equal(extendMap(square, { east: 2, west: 2, north: 2, south: 2 }).symmetry, 'rot90');
  assert.equal(resizeMap(square, 8, 4).symmetry, 'none');
  assert.equal(resizeMap(square, 8, 8).symmetry, 'rot90');
});

test('resize resamples heights bilinearly, scales objects and drops the original textures', () => {
  const doc = opened();
  for (let j = 0; j < doc.H; j++) for (let i = 0; i < doc.W; i++) doc.heights[j * doc.W + i] = 3 * i - 2 * j;
  const next = resizeMap(doc, 8, 2);
  assert.equal(next.W, 513);
  assert.equal(next.H, 129);
  for (let j = 0; j < next.H; j++) {
    for (let i = 0; i < next.W - 1; i++) assert.ok(Math.abs(next.heights[j * next.W + i] - (1.5 * i - 4 * j)) < 1e-3, `height at ${i},${j}`);
  }
  assert.deepEqual(next.objects, doc.objects.map((o) => ({ ...o, x: o.x * 2, z: o.z / 2 })));
  assert.equal(next.original.tileIndex, null);
  assert.equal(next.original.metalMap, null);
  assert.equal(next.original.tiles, doc.original.tiles);
  assert.equal(next.original.tilesX, 128);
  assert.equal(next.settings.name, doc.settings.name);
  assert.notEqual(next.settings, doc.settings, 'the new doc owns its settings');
});

test('history swaps a replaced doc back and forth, keeping settings edited since', () => {
  const doc = testMap({ sx: 4, sz: 4 }), history = new History(), next = extendMap(doc, { east: 2 });
  history.replace(doc, next, 'extend map');
  next.settings.name = 'Renamed after';
  const undone = history.undo(next);
  assert.equal(undone.doc, doc);
  assert.equal(undone.label, 'extend map');
  assert.equal(doc.settings.name, 'Renamed after');
  assert.equal(history.redo(doc).doc, next);
  assert.equal(history.undo(next).doc, doc);
});
