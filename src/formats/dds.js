// DDS textures (BC1 = DXT1, BC3 = DXT5) with a full box-filtered mip chain, as BAR maps ship them.
// Recoil's DDS loader (nv_dds) flips rows on load, so files store the image bottom row (south) first; callers pass
// images top-down as everywhere else. Big images are encoded in horizontal strips on worker threads: encodeStrip
// does every mip level that is still at least one block row tall inside the strip, and assembleDds joins the strips
// and finishes the small levels.
import { encodeColorBlock } from './dxt.js';

const FOURCC = { bc1: 'DXT1', bc3: 'DXT5' };
const BLOCK_BYTES = { bc1: 8, bc3: 16 };

/** Next mip level of an RGBA image: 2x2 box filter; an odd last row or column is dropped (1 stays 1). */
export function halveRgba(rgba, width, height) {
  const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1), out = new Uint8Array(w * h * 4);
  const dx = width > 1 ? 4 : 0, dy = height > 1 ? width * 4 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = ((y * (dy ? 2 : 1)) * width + x * (dx ? 2 : 1)) * 4, o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = (rgba[a + c] + rgba[a + dx + c] + rgba[a + dy + c] + rgba[a + dx + dy + c] + 2) >> 2;
    }
  }
  return out;
}

const rgb = new Float32Array(48);
const alpha = new Uint8Array(16);

// BC3 alpha block: endpoints max/min (8-value mode), 3-bit indices.
function encodeAlphaBlock(out, o) {
  let lo = 255, hi = 0;
  for (const a of alpha) { if (a < lo) lo = a; if (a > hi) hi = a; }
  out[o] = hi;
  out[o + 1] = lo;
  const index = (p) => {
    const j = Math.round(((alpha[p] - lo) * 7) / (hi - lo)); // 0 = lo .. 7 = hi
    return j === 7 ? 0 : j === 0 ? 1 : 8 - j;
  };
  let first = 0, second = 0; // 24 bits each: texels 0..7 and 8..15, texel 0 in the lowest bits
  if (hi > lo) {
    for (let p = 7; p >= 0; p--) first = (first << 3) | index(p);
    for (let p = 15; p >= 8; p--) second = (second << 3) | index(p);
  }
  out[o + 2] = first & 255; out[o + 3] = (first >> 8) & 255; out[o + 4] = first >> 16;
  out[o + 5] = second & 255; out[o + 6] = (second >> 8) & 255; out[o + 7] = second >> 16;
}

/** One mip level as BC1/BC3 blocks; edge blocks of sizes that are not a multiple of 4 repeat the last texel. */
export function encodeLevel(rgba, width, height, format) {
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4), size = BLOCK_BYTES[format];
  const out = new Uint8Array(bw * bh * size);
  for (let by = 0, o = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, o += size) {
      for (let p = 0; p < 16; p++) {
        const x = Math.min(bx * 4 + (p & 3), width - 1), y = Math.min(by * 4 + (p >> 2), height - 1), s = (y * width + x) * 4;
        rgb[p * 3] = rgba[s]; rgb[p * 3 + 1] = rgba[s + 1]; rgb[p * 3 + 2] = rgba[s + 2];
        alpha[p] = rgba[s + 3];
      }
      if (format === 'bc3') encodeAlphaBlock(out, o);
      encodeColorBlock(rgb, out, o + size - 8);
    }
  }
  return out;
}

function flipRows(rgba, width, rows) {
  const out = new Uint8Array(rgba.length), stride = width * 4;
  for (let y = 0; y < rows; y++) out.set(rgba.subarray(y * stride, (y + 1) * stride), (rows - 1 - y) * stride);
  return out;
}

/**
 * Mip levels of one horizontal strip of a top-down RGBA image, flipped and encoded while the strip is at least
 * 4 rows tall; the first level below that is returned raw for assembleDds. When an image is split into several
 * strips, `rows` must be a power of two.
 * @returns {{levels: Uint8Array[], tail: Uint8Array}}
 */
export function encodeStrip(rgba, width, rows, format) {
  const levels = [];
  rgba = flipRows(rgba, width, rows);
  while (rows >= 4) {
    levels.push(encodeLevel(rgba, width, rows, format));
    rgba = halveRgba(rgba, width, rows);
    width = Math.max(1, width >> 1);
    rows >>= 1;
  }
  return { levels, tail: rgba };
}

/**
 * A DDS file from encodeStrip results (top to bottom) of a width x height image.
 * @param {{levels: Uint8Array[], tail: Uint8Array}[]} strips
 */
export function assembleDds(strips, width, height, format) {
  strips = [...strips].reverse(); // bottom first
  const levels = strips[0].levels.map((_, l) => concat(strips.map((s) => s.levels[l])));
  let w = Math.max(1, width >> levels.length), h = Math.max(1, height >> levels.length);
  let image = concat(strips.map((s) => s.tail));
  if (image.length !== w * h * 4) throw new Error(`DDS: strips hold ${image.length / 4} texels at mip ${levels.length}, expected ${w}x${h}`);
  for (;;) {
    levels.push(encodeLevel(image, w, h, format));
    if (w === 1 && h === 1) break;
    image = halveRgba(image, w, h);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return writeDds(levels, width, height, format);
}

/** A whole image (small ones, such as a 1024² DNTS texture) as a DDS file. */
export const encodeDds = (rgba, width, height, format) => assembleDds([encodeStrip(rgba, width, height, format)], width, height, format);

function writeDds(levels, width, height, format) {
  const out = new Uint8Array(128 + levels.reduce((n, l) => n + l.length, 0));
  const dv = new DataView(out.buffer);
  const u32 = (o, v) => dv.setUint32(o, v, true);
  out.set([68, 68, 83, 32], 0); // "DDS "
  u32(4, 124);
  u32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000); // caps, height, width, pixel format, mip count, linear size
  u32(12, height);
  u32(16, width);
  u32(20, levels[0].length);
  u32(28, levels.length);
  u32(76, 32); // pixel format size
  u32(80, 0x4); // DDPF_FOURCC
  for (let i = 0; i < 4; i++) out[84 + i] = FOURCC[format].charCodeAt(i);
  u32(108, 0x1000 | 0x8 | 0x400000); // texture, complex, mipmap
  let o = 128;
  for (const level of levels) { out.set(level, o); o += level.length; }
  return out;
}

function concat(arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}

/** Mip count and level sizes of a DDS file, for checks. @returns {{width, height, fourCC, mips, bytes}} */
export function readDdsHeader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'DDS ') throw new Error('not a DDS file');
  return {
    height: dv.getUint32(12, true),
    width: dv.getUint32(16, true),
    mips: dv.getUint32(28, true),
    fourCC: String.fromCharCode(...bytes.subarray(84, 88)),
    bytes: bytes.length,
  };
}
