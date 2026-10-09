// The bake's stack layers that the engine reads as data: splat weights, grass, detail normals.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BIOMES, bakeMaterials, bakeStrip, MATERIALS, materialTable, prepareBake, texturePlan } from '../../src/look/index.js';
import { testMap } from '../helpers/test-map.js';

// A small stand-in albedo per material (the real library is generated, not in the repo).
const albedo = { width: 16, height: 16, data: Uint8Array.from({ length: 16 * 16 * 3 }, (_, i) => 60 + ((i * 37) % 120)) };

function bake(doc, quality = 'standard') {
  const plan = texturePlan(doc, quality);
  const tables = new Map(bakeMaterials(doc).map((id) => [id, materialTable(albedo, 32)]));
  return { plan, strip: bakeStrip(prepareBake(doc, tables, plan.layers), 8, 8) };
}

test('every splat distribution pixel sums to exactly 255', () => {
  const doc = testMap({ sx: 4, sz: 4 });
  const gravel = MATERIALS.findIndex((m) => m.id === 'gravel_slate') + 1;
  doc.paint.fill(gravel, 100 * doc.W, 110 * doc.W); // a painted library material across the strip
  doc.paintWeight.fill(180, 100 * doc.W, 110 * doc.W);
  for (const quality of ['standard', 'share']) {
    const { plan, strip } = bake(doc, quality);
    const pixels = ((4 * 512) / plan.layers.splat) * (256 / plan.layers.splat);
    assert.equal(strip.splat.length, pixels * 4);
    for (let p = 0; p < strip.splat.length; p += 4) {
      assert.equal(strip.splat[p] + strip.splat[p + 1] + strip.splat[p + 2] + strip.splat[p + 3], 255, `pixel ${p / 4}`);
    }
  }
});

test('the strip holds the diffuse, minimap, grass and unit-length detail normals at the planned sizes', () => {
  const doc = testMap({ sx: 4, sz: 4 });
  const { plan, strip } = bake(doc);
  assert.equal(strip.rgb.length, 2048 * 256 * 3);
  assert.equal(strip.minimap.length, (2048 / 8) * (256 / 8) * 3);
  assert.equal(strip.grass.length, 64 * 8);
  assert.ok(strip.grass.some((g) => g === 255) && strip.grass.every((g) => g === 0 || g === 255), 'temperate grass grows somewhere');
  for (let p = 0; p < strip.normal.length; p += 4) {
    const n = [0, 1, 2].map((c) => strip.normal[p + c] / 127.5 - 1);
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 0.03 && n[2] > 0, `normal ${p / 4} points up and has unit length`);
  }
  assert.equal(strip.normal.length, (2048 / plan.layers.normal) * (256 / plan.layers.normal) * 4);
});

test('no grass in a biome without grass materials', () => {
  const doc = testMap({ sx: 4, sz: 4 });
  doc.biome = 'desert';
  assert.ok(bake(doc).strip.grass.every((g) => g === 0));
});

test('every biome names 4 splats and only library materials', () => {
  for (const [key, biome] of Object.entries(BIOMES)) {
    assert.equal(biome.splats.length, 4, key);
    const doc = testMap({ sx: 2, sz: 2 });
    doc.biome = key;
    assert.doesNotThrow(() => texturePlan(doc, 'standard'), key);
  }
});
