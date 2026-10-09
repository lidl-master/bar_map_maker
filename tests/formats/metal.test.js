import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMetalMap } from '../../src/formats/index.js';

const doc = (spots) => ({ sx: 8, sz: 6, objects: spots.map(([x, z, metal], i) => ({ id: i + 1, type: 'metal', x, z, metal })) });

// What BAR shows for each 8-connected group of metal pixels: sum * maxMetal / 1000.
function shownValues({ data, width, height, maxMetal }) {
  const seen = new Uint8Array(data.length), values = [];
  for (let start = 0; start < data.length; start++) {
    if (!data[start] || seen[start]) continue;
    let sum = 0, pixels = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % width, z = (k - x) / width;
      sum += data[k];
      pixels++;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = (z + dz) * width + x + dx;
          if (x + dx >= 0 && x + dx < width && z + dz >= 0 && z + dz < height && data[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
    }
    values.push({ value: (sum * maxMetal) / 1000, pixels });
  }
  return values;
}

test('typical spot values come out exact with maxMetal 1, as hard-edged 21-pixel discs', () => {
  const asked = [1.8, 2.0, 2.2, 0.9, 3.5, 4.123, 5.355];
  const map = buildMetalMap(doc(asked.map((m, i) => [300 + i * 500, 1000, m])));
  assert.equal(map.maxMetal, 1);
  assert.equal(map.width, 256);
  assert.equal(map.height, 192);
  assert.deepEqual(map.values, asked);
  assert.deepEqual(shownValues(map), asked.map((value) => ({ value, pixels: 21 })));
});

test('rich spots raise maxMetal to the next whole number and stay within 8-bit pixels', () => {
  const map = buildMetalMap(doc([[500, 500, 8.0], [2000, 2000, 2.5]]));
  assert.equal(map.maxMetal, 2);
  assert.deepEqual(shownValues(map).map((s) => s.value), [8.0, 2.5]);
  assert.ok(Math.max(...map.data) <= 255);
});

test('spots at the map edge stay whole', () => {
  const map = buildMetalMap(doc([[0, 0, 2.0], [4096, 3072, 2.0]]));
  assert.deepEqual(shownValues(map), [{ value: 2, pixels: 21 }, { value: 2, pixels: 21 }]);
});
