import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addObject, createMap, images, sampleHeight, slopeAt } from '../../src/core/index.js';
import { generate, ramp, scatterFeatures } from '../../src/terrain/index.js';

const CLEAR = { start: 600, metal: 110, geo: 160 }; // elmos kept clear around resources (src/terrain/features.js)
const scattered = (doc) => doc.objects.filter((o) => o.auto);
const key = (name, x, z) => `${name}@${Math.round(x)},${Math.round(z)}`;

test('scatterFeatures: counts scale with density; nothing on starts, pads, water or lava; mirrored copies', () => {
  for (const [template, symmetry, biome] of [['hills', 'rot180', 'temperate'], ['islands', 'quad', 'tropical'], ['volcano-koth', 'mirrorX', 'volcanic']]) {
    const label = `${template}/${biome}`, doc = createMap({ sx: 8, sz: 8, symmetry, biome });
    generate(doc, template, { players: 4, seed: 5 });
    const hand = addObject(doc, 'feature', 1000, 1000, { name: 'TreeType3', rot: 0 });
    const counts = [0, 0.3, 1].map((density) => { scatterFeatures(doc, { density, seed: 5 }); return scattered(doc).length; });
    assert.ok(counts[0] === 0 && counts[1] > 20 && counts[2] > 1.5 * counts[1], `${label}: counts ${counts}`);
    assert.ok(hand.every((o) => doc.objects.includes(o)), `${label}: hand-placed features are kept`);

    const fluid = doc.settings.lava.enabled ? doc.settings.lava.level : 0, resources = doc.objects.filter((o) => CLEAR[o.type]);
    const placed = new Set(doc.objects.map((o) => key(o.name, o.x, o.z)));
    for (const f of scattered(doc)) {
      assert.ok(sampleHeight(doc, f.x, f.z) > fluid, `${label}: ${f.name} under water or lava at ${f.x},${f.z}`);
      if (f.auto === 'trees') assert.ok(slopeAt(doc, f.x, f.z) <= 27, `${label}: tree on undrivable ground at ${f.x},${f.z}`);
      for (const r of resources) assert.ok(Math.hypot(r.x - f.x, r.z - f.z) >= CLEAR[r.type], `${label}: ${f.name} on a ${r.type}`);
      for (const [x, z] of images(doc, f.x, f.z)) assert.ok(placed.has(key(f.name, x, z)), `${label}: no mirror image of ${f.name}`);
    }
  }
});

test('scatterFeatures keeps a ramp through a cliff clear', () => {
  const doc = createMap({ sx: 8, sz: 8 }), { W, heights: hh } = doc;
  for (let k = 0; k < hh.length; k++) hh[k] = Math.min(400, Math.max(100, 400 - (Math.floor(k / W) * 8 - 2000) * 3)); // cliff at z 2000..2100
  ramp(doc, { x: 2048, z: 2700 }, { x: 2048, z: 1500 }, { width: 400 });
  scatterFeatures(doc, { density: 1, seed: 2 });
  assert.ok(scattered(doc).length > 1000);
  assert.deepEqual(scattered(doc).filter((o) => Math.abs(o.x - 2048) < 160 && o.z > 1850 && o.z < 2350), []);
});
