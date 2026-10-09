import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupeTiles, encodeDxt1Mips, MINIMAP_BYTES, readSmf, readSmt, TILE_BYTES, writeSmf, writeSmt } from '../../src/formats/index.js';

const random = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (Math.imul(i + seed, 2654435761) >>> 24) & 255);

function sampleSmf({ grass }) {
  const mapx = 128, mapy = 256, quarter = (mapx / 4) * (mapy / 4), half = (mapx / 2) * (mapy / 2);
  return {
    mapId: -123456789,
    mapx,
    mapy,
    minHeight: -150.5,
    maxHeight: 850.25,
    heights: Uint16Array.from({ length: (mapx + 1) * (mapy + 1) }, (_, i) => (i * 7919) & 0xffff),
    typeMap: random(half, 1),
    minimap: random(MINIMAP_BYTES, 2),
    metal: random(half, 3),
    tileFiles: [{ name: 'Some_Map.smt', count: 40 }],
    tileIndex: Int32Array.from({ length: quarter }, (_, i) => i % 40),
    features: [
      { name: 'GeoVent', x: 100, y: 20, z: 300, rotation: 0, size: 1 },
      { name: 'TreeType3', x: 512.5, y: 40, z: 1024, rotation: -16384, size: 1 },
      { name: 'GeoVent', x: 900, y: 0, z: 1800, rotation: 32767, size: 1 },
    ],
    grass: grass ? random(quarter, 4) : null,
  };
}

for (const grass of [false, true]) {
  test(`SMF round trip is lossless and stable (grass: ${grass})`, () => {
    const smf = sampleSmf({ grass });
    const bytes = writeSmf(smf);
    assert.deepEqual(readSmf(bytes), smf);
    assert.deepEqual(writeSmf(readSmf(bytes)), bytes);
  });
}

test('SMF header and section layout match the spec', () => {
  const bytes = writeSmf(sampleSmf({ grass: true }));
  const dv = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 16)), 'spring map file\0');
  assert.deepEqual([16, 24, 28, 32, 36, 40, 76].map((o) => dv.getInt32(o, true)), [1, 128, 256, 8, 8, 32, 1]);
  assert.deepEqual([80, 84].map((o) => dv.getInt32(o, true)), [12, 1]); // grass extra header {size 12, type 1, ptr}
  const grassPtr = dv.getInt32(88, true);
  assert.equal(grassPtr + 32 * 64, bytes.length);
  assert.equal(dv.getInt32(52, true), 92); // heightmap right after the header and the grass extra header
});

test('SMF reader rejects files that are not maps or are cut short', () => {
  assert.throws(() => readSmf(new Uint8Array(100)), /not a spring map file/);
  const bytes = writeSmf(sampleSmf({ grass: false }));
  assert.throws(() => readSmf(bytes.subarray(0, bytes.length - 30)), /outside the file/);
});

test('SMT round trip is byte-identical', () => {
  const tiles = random(5 * TILE_BYTES, 9);
  const smt = writeSmt(tiles);
  assert.equal(smt.length, 32 + 5 * TILE_BYTES);
  assert.equal(new DataView(smt.buffer).getInt32(20, true), 5);
  assert.deepEqual(readSmt(smt), tiles);
  assert.deepEqual(writeSmt(readSmt(smt)), smt);
});

test('tile dedupe stores identical tiles once and keeps every map tile resolvable', () => {
  const a = random(TILE_BYTES, 1), b = random(TILE_BYTES, 2), c = random(TILE_BYTES, 3);
  const input = [a, b, a, c, b, a];
  const tiles = new Uint8Array(input.length * TILE_BYTES);
  input.forEach((t, i) => tiles.set(t, i * TILE_BYTES));
  const { tiles: unique, index } = dedupeTiles(tiles);
  assert.equal(unique.length, 3 * TILE_BYTES);
  assert.deepEqual([...index], [0, 1, 0, 2, 1, 0]);
  input.forEach((t, i) => assert.deepEqual(unique.subarray(index[i] * TILE_BYTES, (index[i] + 1) * TILE_BYTES), t));
});

test('DXT1 mip chains have the SMT tile and minimap sizes; a flat colour encodes exactly', () => {
  assert.equal(encodeDxt1Mips(new Uint8Array(32 * 32 * 3), 32).length, TILE_BYTES);
  assert.equal(encodeDxt1Mips(new Uint8Array(1024 * 1024 * 3), 1024).length, MINIMAP_BYTES);
  const grey = encodeDxt1Mips(new Uint8Array(4 * 4 * 3).fill(132), 4); // 132 is exact in 5:6:5
  const c0 = grey[0] | (grey[1] << 8);
  assert.deepEqual([(c0 >> 11) & 31, (c0 >> 5) & 63, c0 & 31], [16, 33, 16]);
});
