import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleDds, encodeDds, encodeStrip, readDdsHeader } from '../../src/formats/index.js';

// RGBA test image: top half white, bottom half black, with a horizontal ramp in alpha.
function image(width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, v = y < height / 2 ? 255 : 0;
      out.set([v, v, v, Math.round((x / (width - 1)) * 255)], o);
    }
  }
  return out;
}

test('DDS headers name the format, size and a full mip chain whose bytes add up', () => {
  for (const [format, fourCC, block] of [['bc1', 'DXT1', 8], ['bc3', 'DXT5', 16]]) {
    const dds = encodeDds(image(64, 32), 64, 32, format);
    const header = readDdsHeader(dds);
    assert.deepEqual([header.width, header.height, header.fourCC, header.mips], [64, 32, fourCC, 7]); // 64x32 .. 1x1
    let bytes = 128;
    for (let w = 64, h = 32; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
      bytes += Math.ceil(w / 4) * Math.ceil(h / 4) * block;
      if (w === 1 && h === 1) break;
    }
    assert.equal(dds.length, bytes);
  }
});

test('DDS files store the bottom row first (the engine flips them on load)', () => {
  const dds = encodeDds(image(16, 16), 16, 16, 'bc1');
  const first = new DataView(dds.buffer, 128, 8); // first block of the top mip level
  assert.equal(first.getUint16(0, true), 0, 'first stored block is from the black (bottom) half');
  const lastTop = new DataView(dds.buffer, 128 + 15 * 8, 8);
  assert.equal(lastTop.getUint16(0, true), 0xffff, 'last block of level 0 is from the white (top) half');
});

test('strip-wise encoding on workers gives the same file as encoding the whole image', () => {
  const width = 96, height = 128, rows = 32, whole = image(width, height);
  for (const format of ['bc1', 'bc3']) {
    const strips = [];
    for (let y = 0; y < height; y += rows) strips.push(encodeStrip(whole.slice(y * width * 4, (y + rows) * width * 4), width, rows, format));
    assert.deepEqual(assembleDds(strips, width, height, format), encodeDds(whole, width, height, format));
  }
});

test('BC3 alpha endpoints span the alpha range of the block', () => {
  const dds = encodeDds(image(4, 4), 4, 4, 'bc3');
  const [a0, a1] = [dds[128], dds[129]];
  assert.deepEqual([a0, a1], [255, 0]);
});
