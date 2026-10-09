// Map-wide textures of an opened map (the engine stretches them over the whole map: splat distribution, specular,
// detail normals, ...) moved with a reshaped map: the original lands at its offset, new ground fades from a mirror
// image of the original's edge into a fill colour. DDS files are edited block by block (untouched blocks are copied,
// so a 10k² normal map moves in about a second); PNG and TGA files are decoded. Node-only (PNG through node:zlib).
import { BLOCK_BYTES, decodeBlock, decodeTga, encodeBlock, encodeTga, readDds, writeDds } from '../formats/index.js';
import { decodePng, encodePng } from '../look/library-load.js';

const UNIT = 512; // elmos per map unit
export const FADE = 128; // elmos over which new ground fades from the original's mirror image into the fill

/**
 * @typedef {Object} Move  where the original map lands in the derivative, in map units
 * @property {[number, number]} from  the original's size
 * @property {[number, number]} to  the derivative's size
 * @property {[number, number]} offset  the original's north-west corner in the derivative (negative: cropped)
 */

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// One axis of the new texture: per texel, the original texel it shows (mirrored back inside for new ground) and how
// far its centre lies outside the original map, in elmos (0 inside). Nearest texel: textures keep their own scale.
function axis(count, oldCount, units, oldUnits, offsetUnits) {
  const src = new Int32Array(count), out = new Float32Array(count), span = oldUnits * UNIT;
  for (let i = 0; i < count; i++) {
    const e = ((i + 0.5) * units * UNIT) / count - offsetUnits * UNIT; // elmos in the original map
    const m = e < 0 ? -e : e > span ? 2 * span - e : e;
    src[i] = Math.min(oldCount - 1, Math.max(0, Math.floor((m * oldCount) / span)));
    out[i] = e < 0 ? -e : e > span ? e - span : 0;
  }
  return { src, out };
}

// Per 4-texel block of an axis: the original block it copies exactly (inside, same scale, block-aligned), or -1.
function alignedBlocks({ src, out }, count) {
  return Int32Array.from({ length: Math.ceil(count / 4) }, (_, b) => {
    const x = b * 4;
    if (x + 3 >= count || src[x] % 4) return -1;
    for (let k = 0; k < 4; k++) if (out[x + k] || src[x + k] !== src[x] + k) return -1;
    return src[x] / 4;
  });
}

// Mean colour of a block-compressed level from up to ~4096 blocks spread over it.
function levelMean(level, format) {
  const size = BLOCK_BYTES[format], blocks = level.length / size, step = Math.max(1, Math.floor(blocks / 4096));
  const sum = [0, 0, 0, 0], texels = new Uint8Array(64);
  let n = 0;
  for (let b = 0; b < blocks; b += step, n += 16) {
    decodeBlock(level, b * size, format, texels);
    for (let p = 0; p < 64; p++) sum[p & 3] += texels[p];
  }
  return sum.map((s) => Math.round(s / n));
}

// One mip level moved. DDS rows run bottom-first, so the z offset counts from the south edge.
function moveLevel(level, [ow, oh], [nw, nh], format, move, fill) {
  const ax = axis(nw, ow, move.to[0], move.from[0], move.offset[0]);
  const az = axis(nh, oh, move.to[1], move.from[1], move.to[1] - move.from[1] - move.offset[1]);
  const cols = alignedBlocks(ax, nw), rows = alignedBlocks(az, nh);
  const size = BLOCK_BYTES[format], obw = Math.ceil(ow / 4), bw = Math.ceil(nw / 4), bh = Math.ceil(nh / 4);
  const out = new Uint8Array(bw * bh * size), texels = new Uint8Array(64), fillBlock = new Uint8Array(size);
  encodeBlock(Uint8Array.from({ length: 64 }, (_, p) => fill[p & 3]), format, fillBlock, 0);
  const cache = new Map(); // decoded original blocks by block number
  const sample = (x, z) => {
    const b = (z >> 2) * obw + (x >> 2);
    let block = cache.get(b);
    if (!block) {
      if (cache.size > 65536) cache.clear();
      block = new Uint8Array(64);
      decodeBlock(level, b * size, format, block);
      cache.set(b, block);
    }
    return block.subarray(((z & 3) * 4 + (x & 3)) * 4);
  };
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const o = (by * bw + bx) * size;
      if (cols[bx] >= 0 && rows[by] >= 0) { // a run of original blocks: one copy
        let end = bx + 1;
        while (end < bw && cols[end] === cols[bx] + end - bx) end++;
        const s = (rows[by] * obw + cols[bx]) * size;
        out.set(level.subarray(s, s + (end - bx) * size), o);
        bx = end - 1;
        continue;
      }
      let near = false;
      for (let p = 0; p < 16; p++) {
        const x = Math.min(bx * 4 + (p & 3), nw - 1), z = Math.min(by * 4 + (p >> 2), nh - 1), t = smooth(Math.hypot(ax.out[x], az.out[z]) / FADE);
        if (t >= 1) {
          texels.set(fill, p * 4);
          continue;
        }
        near = true;
        const src = sample(ax.src[x], az.src[z]);
        for (let c = 0; c < 4; c++) texels[p * 4 + c] = src[c] + (fill[c] - src[c]) * t;
      }
      if (near) encodeBlock(texels, format, out, o);
      else out.set(fillBlock, o);
    }
  }
  return out;
}

const levelSize = (w, h, l) => [Math.max(1, w >> l), Math.max(1, h >> l)];

function moveDds(bytes, move, fill) {
  const { width, height, format, levels } = readDds(bytes);
  const w = Math.round((width * move.to[0]) / move.from[0]), h = Math.round((height * move.to[1]) / move.from[1]);
  const count = levels.length === 1 ? 1 : Math.floor(Math.log2(Math.max(w, h))) + 1; // a chain stays a full chain
  const colour = fill ?? levelMean(levels[0], format);
  const out = Array.from({ length: count }, (_, l) => {
    const s = Math.min(l, levels.length - 1);
    return moveLevel(levels[s], levelSize(width, height, s), levelSize(w, h, l), format, move, colour);
  });
  return writeDds(out, w, h, format);
}

// A decoded image ({width, height, channels, data} top-down) moved.
function moveImage(image, move, fill) {
  const { width, height, channels, data } = image;
  const w = Math.round((width * move.to[0]) / move.from[0]), h = Math.round((height * move.to[1]) / move.from[1]);
  const ax = axis(w, width, move.to[0], move.from[0], move.offset[0]), az = axis(h, height, move.to[1], move.from[1], move.offset[1]);
  const colour = fill ?? Array.from({ length: channels }, (_, c) => {
    let sum = 0;
    for (let k = c; k < data.length; k += channels) sum += data[k];
    return Math.round(sum / (width * height));
  });
  const out = new Uint8Array(w * h * channels);
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const s = (az.src[z] * width + ax.src[x]) * channels, o = (z * w + x) * channels, t = smooth(Math.hypot(ax.out[x], az.out[z]) / FADE);
      for (let c = 0; c < channels; c++) out[o + c] = data[s + c] + (colour[c] - data[s + c]) * t;
    }
  }
  return { ...image, width: w, height: h, data: out };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const starts = (bytes, magic) => magic.every((b, i) => bytes[i] === b);

/**
 * @param {Uint8Array} bytes  a DDS (BC1/BC2/BC3), PNG (8/16-bit, not palette) or TGA (true-colour or grey) file;
 *   anything else throws, saying why
 * @param {Move} move
 * @param {number[]|null} fill  RGBA (or grey) for new ground; null: the texture's mean colour
 * @returns {Uint8Array} the moved texture in the same format (16-bit PNGs come back 8-bit)
 */
export function moveTexture(bytes, move, fill) {
  if (starts(bytes, [0x44, 0x44, 0x53, 0x20])) return moveDds(bytes, move, fill);
  if (starts(bytes, PNG_SIGNATURE)) return new Uint8Array(encodePng(moveImage(decodePng(bytes), move, fill)));
  return encodeTga(moveImage(decodeTga(bytes), move, fill));
}
