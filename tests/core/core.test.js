import assert from 'node:assert/strict';
import { test } from 'node:test';
import { History, SYMMETRY, addObject, createMap, moveGroup, orbit, symmetrize } from '../../src/core/index.js';
import { tx, tz } from '../../src/core/symmetry.js';
import { brush } from '../../src/terrain/index.js';

// Every cell equals its image under every transform of the mode.
function assertSymmetric(doc, layer, name) {
  const { W, H } = doc, a = W - 1, b = H - 1;
  for (const t of SYMMETRY[doc.symmetry].T) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const c = layer[j * W + i], d = layer[tz(t, i, j, b) * W + tx(t, i, j, a)];
      if (c !== d) assert.fail(`${doc.symmetry} ${name}: cell ${i},${j} = ${c} but its image (t=${t}) = ${d}`);
    }
  }
}

test('symmetrize is exact for all 8 modes', () => {
  for (const symmetry of Object.keys(SYMMETRY)) {
    const doc = createMap({ sx: 2, sz: 2, symmetry });
    for (let k = 0; k < doc.heights.length; k++) {
      doc.heights[k] = Math.sin(k * 12.9898) * 437.5;
      doc.paint[k] = k % 7;
      doc.paintWeight[k] = (k * 31) & 255;
    }
    symmetrize(doc);
    assertSymmetric(doc, doc.heights, 'heights');
    assertSymmetric(doc, doc.paint, 'paint');
    assertSymmetric(doc, doc.paintWeight, 'paintWeight');
  }
});

test('createMap validates size and square-only modes', () => {
  assert.throws(() => createMap({ sx: 3, sz: 4 }), RangeError);
  assert.throws(() => createMap({ sx: 4, sz: 8, symmetry: 'rot90' }), /square/);
  assert.equal(createMap({ sx: 4, sz: 8, symmetry: 'quad' }).W, 257);
});

test('objects follow symmetry and move as a group', () => {
  const doc = createMap({ sx: 4, sz: 4, symmetry: 'quad' });
  const made = addObject(doc, 'metal', 300, 500, { metal: 2 });
  assert.equal(made.length, 4);
  assert.equal(new Set(made.map((o) => o.group)).size, 1);
  assert.equal(addObject(doc, 'geo', 1024, 1024).length, 1); // centre: one object
  moveGroup(doc, made[3], 2048 - 100, 2048 - 200);
  const pts = made.map((o) => `${o.x},${o.z}`).sort();
  assert.deepEqual(pts, orbit(doc, 100, 200).map(([x, z]) => `${x},${z}`).sort());
});

test('history undoes and redoes a brush stroke and object edits', () => {
  const doc = createMap({ sx: 2, sz: 2, symmetry: 'mirrorX' });
  const h = new History(), before = doc.heights.slice();
  h.begin(doc, 'raise');
  const rect = brush(doc, 'raise', 200, 300, { radius: 120, strength: 1, hardness: 0.5 }, 0.5);
  addObject(doc, 'start', 200, 300);
  h.commit(rect);
  const after = doc.heights.slice();
  assert.notDeepEqual(after, before);
  assert.equal(doc.objects.length, 2);
  h.undo(doc);
  assert.deepEqual(doc.heights, before);
  assert.equal(doc.objects.length, 0);
  h.redo(doc);
  assert.deepEqual(doc.heights, after);
  assert.equal(doc.objects.length, 2);
  // Settings edited outside the history (the Map tab) survive undoing an object edit.
  doc.settings.name = 'Renamed';
  h.undo(doc);
  assert.equal(doc.settings.name, 'Renamed');
});
