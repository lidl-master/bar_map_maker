import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SYMMETRY, createMap, heightRange, orbit, sampleHeight, slopeAt, worldSize } from '../../src/core/index.js';
import { tx, tz } from '../../src/core/symmetry.js';
import { TEMPLATES, generate, limitSlopes, placeResources } from '../../src/terrain/index.js';

const PLAYERS = [2, 4, 8, 16];
const starts = (doc) => doc.objects.filter((o) => o.type === 'start');

function assertSane(doc, label) {
  const [ww, wh] = worldSize(doc), [lo, hi] = heightRange(doc), { W, H, heights: hh } = doc;
  assert.ok(hh.every(Number.isFinite), `${label}: NaN/Infinity in heights`);
  assert.ok(lo >= -700 && hi <= 2500 && hi > lo, `${label}: height range ${lo}..${hi}`);
  for (const o of doc.objects) assert.ok(o.x >= 0 && o.x <= ww && o.z >= 0 && o.z <= wh, `${label}: object off the map ${o.x},${o.z}`);
  for (const t of SYMMETRY[doc.symmetry].T) {
    for (let k = 0; k < hh.length; k++) {
      const i = k % W, j = (k - i) / W;
      if (hh[k] !== hh[tz(t, i, j, H - 1) * W + tx(t, i, j, W - 1)]) assert.fail(`${label}: heights not symmetric at ${i},${j}`);
    }
  }
}

test('every template generates a sane 4x4 map with exactly `players` starts', () => {
  for (const t of TEMPLATES) {
    for (const players of PLAYERS) {
      const doc = createMap({ sx: 4, sz: 4, symmetry: 'rot180' });
      generate(doc, t.id, { players, seed: 7 });
      assertSane(doc, `${t.id}/${players}`);
      assert.equal(starts(doc).length, players, `${t.id}: start count`);
      assert.ok(doc.objects.some((o) => o.type === 'metal' && o.metal > 0), `${t.id}: no metal`);
    }
  }
});

test('placeResources places exactly `players` starts under every symmetry; spots are mirrored', () => {
  for (const symmetry of Object.keys(SYMMETRY)) {
    const doc = createMap({ sx: 4, sz: 4, symmetry });
    generate(doc, 'hills', { players: 2, seed: 3 });
    for (const players of PLAYERS) {
      placeResources(doc, { players, seed: players });
      assertSane(doc, `${symmetry}/${players}`);
      assert.equal(starts(doc).length, players, `${symmetry}: ${players} players`);
      for (const o of doc.objects.filter((o) => o.type !== 'start')) {
        const group = doc.objects.filter((p) => p.group === o.group);
        assert.equal(group.length, orbit(doc, o.x, o.z).length, `${symmetry}: ${o.type} group is not its full orbit`);
      }
    }
  }
});

test('Volcano KotH: kings first in the north, attackers south, nothing in lava, terrain >= 2', () => {
  for (const players of [2, 3, ...PLAYERS.slice(1)]) {
    const doc = createMap({ sx: 4, sz: 4 });
    generate(doc, 'volcano-koth', { players, seed: 11 });
    assertSane(doc, `volcano/${players}`);
    const [ww, wh] = worldSize(doc), s = starts(doc), kings = Math.floor(players / 2);
    assert.equal(s.length, players);
    s.forEach((o, n) => assert.ok(n < kings ? o.z < wh / 2 : o.z > wh / 2, `start ${n} of ${players} on the wrong side`));
    if (players === 2) assert.ok(s.every((o) => o.x === ww / 2), '1v1 starts sit on the mirror axis');
    assert.equal(doc.symmetry, 'mirrorX');
    assert.deepEqual(doc.settings.lava, { enabled: true, level: 60, damage: 100 });
    assert.ok(heightRange(doc)[0] >= 2, 'terrain below 2');
    for (const o of doc.objects) assert.ok(sampleHeight(doc, o.x, o.z) > 60, `${o.type} in lava at ${o.x},${o.z}`);
  }
});

test('limitSlopes caps every slope', () => {
  const doc = createMap({ sx: 4, sz: 4, symmetry: 'diag' });
  generate(doc, 'mountains', { players: 2, seed: 2 });
  limitSlopes(doc, 25);
  assertSane(doc, 'limitSlopes');
  const [ww, wh] = worldSize(doc);
  for (let z = 0; z <= wh; z += 8) for (let x = 0; x <= ww; x += 8) assert.ok(slopeAt(doc, x, z) <= 25.01, `slope ${slopeAt(doc, x, z)} at ${x},${z}`);
});

test('rejects player counts outside 2..16', () => {
  const doc = createMap({ sx: 2, sz: 2 });
  assert.throws(() => generate(doc, 'flat', { players: 1 }), RangeError);
  assert.throws(() => placeResources(doc, { players: 17 }), RangeError);
});
