// The SMF grids of a derivative export (see derivative.js): the original's tiles where it has them with new ground
// faded in at the seam, the minimap rebuilt from the final tiles, and the metal map with only the edited spots
// rewritten. Pure.
import { buildMetalMap, decodeDxt1, encodeDxt1Mips, MAX_SPOT_SUM, maxMetalFor, metalObjects, stampSpot, TILE_BYTES } from '../formats/index.js';
import { blobSpot, isMetalField, metalBlobs } from '../import/index.js';
import { finishMinimap } from '../look/index.js';

const TILE = 32; // texels (elmos) per SMT tile side
export const SEAM = 4 * TILE; // texels over which new ground fades in from a mirror image of the original's edge

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const mirror = (v, lo, hi) => (v < lo ? Math.min(hi - 1, 2 * lo - 1 - v) : v >= hi ? Math.max(lo, 2 * hi - 1 - v) : v);
// Distance (texels) from texel v's centre to the span [lo, hi) along one axis; 0 inside.
const outside = (v, lo, hi) => (v < lo ? lo - v - 0.5 : v >= hi ? v - hi + 0.5 : 0);

/**
 * Every map tile of the derivative, row-major: the original's tile bytes where tileIndex >= 0, zeros elsewhere (the
 * caller bakes those).
 * @param {Int32Array|null} tileIndex  doc.original.tileIndex (null: no original tile anywhere)
 * @param {Uint8Array} originalTiles  the original's tiles in SMF order (readMapData)
 */
export function placeOriginalTiles(tileIndex, originalTiles, count) {
  const tiles = new Uint8Array(count * TILE_BYTES);
  tileIndex?.forEach((t, n) => {
    if (t >= 0) tiles.set(originalTiles.subarray(t * TILE_BYTES, (t + 1) * TILE_BYTES), n * TILE_BYTES);
  });
  return tiles;
}

/** The [x0, z0, x1, z1) tile rect holding every original tile (extendMap keeps them in one rectangle), or null. */
export function originalRect(tileIndex, tilesX) {
  let x0 = Infinity, z0 = Infinity, x1 = -1, z1 = -1;
  tileIndex?.forEach((t, n) => {
    if (t < 0) return;
    const x = n % tilesX, z = (n - x) / tilesX;
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x + 1); z1 = Math.max(z1, z + 1);
  });
  return x1 < 0 ? null : [x0, z0, x1, z1];
}

// Mean colour of every tile (from its 4x4 mip), RGB.
function tileMeans(tiles, count) {
  const means = new Float32Array(count * 3);
  for (let n = 0; n < count; n++) {
    const rgba = decodeDxt1(tiles.subarray((n + 1) * TILE_BYTES - 8, (n + 1) * TILE_BYTES), 4, 4);
    for (let p = 0; p < 64; p += 4) for (let c = 0; c < 3; c++) means[n * 3 + c] += rgba[p + c] / 16;
  }
  return means;
}

// Box blur (radius r tiles) of the tile means over the tiles where mask(n) holds, defined everywhere a masked tile is
// within reach (elsewhere the mean of all masked tiles).
function maskedBlur(means, w, h, mask, r) {
  const n = w * h, acc = new Float32Array(n * 4), out = new Float32Array(n * 3), total = [0, 0, 0, 0];
  for (let k = 0; k < n; k++) {
    if (!mask(k)) continue;
    for (let c = 0; c < 3; c++) acc[k * 4 + c] = means[k * 3 + c];
    acc[k * 4 + 3] = 1;
    for (let c = 0; c < 4; c++) total[c] += acc[k * 4 + c];
  }
  const pass = (src, step, len, lines, lineStep) => { // running window sums along one axis
    const dst = new Float32Array(n * 4);
    for (let l = 0; l < lines; l++) {
      for (let i = 0; i < len; i++) {
        for (let j = Math.max(0, i - r); j <= Math.min(len - 1, i + r); j++) {
          for (let c = 0; c < 4; c++) dst[(l * lineStep + i * step) * 4 + c] += src[(l * lineStep + j * step) * 4 + c];
        }
      }
    }
    return dst;
  };
  const blurred = pass(pass(acc, 1, w, h, w), w, h, w, 1);
  for (let k = 0; k < n; k++) {
    const count = blurred[k * 4 + 3] || total[3];
    for (let c = 0; c < 3; c++) out[k * 3 + c] = (blurred[k * 4 + 3] ? blurred[k * 4 + c] : total[c]) / count;
  }
  return out;
}

// Bilinear sample of a per-tile image at texel (x, z).
function lowRes(image, w, h, x, z, c) {
  const fx = Math.min(Math.max((x + 0.5) / TILE - 0.5, 0), w - 1), fz = Math.min(Math.max((z + 0.5) / TILE - 0.5, 0), h - 1);
  const i = Math.min(Math.floor(fx), w - 2), j = Math.min(Math.floor(fz), h - 2), u = fx - i, v = fz - j, k = (j * w + i) * 3 + c;
  return (image[k] * (1 - u) + image[k + 3] * u) * (1 - v) + (image[k + w * 3] * (1 - u) + image[k + w * 3 + 3] * u) * v;
}

// New ground takes on the colour of the original's edge band (EDGE texels deep, blurred over (2 * TINT_BLUR + 1)²
// tiles): fully at the seam, easing to TINT_FAR of it over TINT texels and keeping that further out, so the biome's
// own palette never jumps out next to the original's.
export const TINT = 32 * TILE;
const TINT_FAR = 0.5, EDGE = 8 * TILE, TINT_BLUR = 6;
// Like mirror(), but never more than EDGE texels deep into the original.
const edgeMirror = (v, lo, hi) => (v < lo ? Math.min(hi - 1, lo + Math.min(lo - 1 - v, EDGE)) : v >= hi ? Math.max(lo, hi - 1 - Math.min(v - hi, EDGE)) : v);

/**
 * New ground joins the original without a hard line or a foreign palette: its colour shifts towards the original's
 * edge colours across the seam (keeping its own texture, see TINT), and within SEAM texels it fades from a mirror image
 * of the original ground, continuous at the edge. Changes `tiles` in place.
 */
export function blendSeam(tiles, tileIndex, tilesX) {
  const rect = originalRect(tileIndex, tilesX);
  if (!rect) return;
  const tilesZ = tileIndex.length / tilesX, [X0, Z0, X1, Z1] = rect.map((v) => v * TILE);
  const means = tileMeans(tiles, tileIndex.length);
  const old = maskedBlur(means, tilesX, tilesZ, (n) => tileIndex[n] >= 0, TINT_BLUR);
  const fresh = maskedBlur(means, tilesX, tilesZ, (n) => tileIndex[n] < 0, TINT_BLUR);
  const decoded = new Map(); // original tiles (level 0, RGBA) by map tile number
  const level0 = (n) => decodeDxt1(tiles.subarray(n * TILE_BYTES, n * TILE_BYTES + 512), TILE, TILE);
  const rgb = new Float32Array(TILE * TILE * 3), shift = new Float32Array(8 * 8 * 3);
  const distance = (wx, wz) => Math.hypot(outside(wx, X0, X1), outside(wz, Z0, Z1));
  for (let n = 0; n < tileIndex.length; n++) {
    if (tileIndex[n] >= 0) continue;
    const tx = (n % tilesX) * TILE, tz = Math.floor(n / tilesX) * TILE;
    // The colour shift is smooth: one value per 4x4 texels is plenty.
    for (let b = 0; b < 64; b++) {
      const wx = tx + (b & 7) * 4 + 2, wz = tz + (b >> 3) * 4 + 2, tint = 1 - (1 - TINT_FAR) * smooth(distance(wx, wz) / TINT);
      const ex = edgeMirror(wx, X0, X1), ez = edgeMirror(wz, Z0, Z1);
      for (let c = 0; c < 3; c++) shift[b * 3 + c] = (lowRes(old, tilesX, tilesZ, ex, ez, c) - lowRes(fresh, tilesX, tilesZ, wx, wz, c)) * tint;
    }
    const own = level0(n);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const wx = tx + x, wz = tz + y, p = y * TILE + x, b = (y >> 2) * 8 + (x >> 2), t = smooth(distance(wx, wz) / SEAM);
        const mx = mirror(wx, X0, X1), mz = mirror(wz, Z0, Z1), m = (mz >> 5) * tilesX + (mx >> 5);
        if (t < 1 && !decoded.has(m)) decoded.set(m, level0(m));
        const src = decoded.get(m), s = ((mz & 31) * TILE + (mx & 31)) * 4;
        for (let c = 0; c < 3; c++) {
          const shifted = own[p * 4 + c] + shift[b * 3 + c];
          rgb[p * 3 + c] = Math.min(255, Math.max(0, t < 1 ? src[s + c] + (shifted - src[s + c]) * t : shifted));
        }
      }
    }
    tiles.set(encodeDxt1Mips(rgb, TILE), n * TILE_BYTES);
  }
}

/** The SMF minimap (DXT1, 1024² with mips) from the final tiles' 4x4 mips: one texel per 8 elmos, as the bake's. */
export function tileMinimap(doc, tiles) {
  const tilesX = doc.sx * 16, tilesZ = doc.sz * 16, blocks = new Uint8Array(tilesX * tilesZ * 8);
  for (let n = 0; n < tilesX * tilesZ; n++) blocks.set(tiles.subarray((n + 1) * TILE_BYTES - 8, (n + 1) * TILE_BYTES), n * 8);
  const rgba = decodeDxt1(blocks, tilesX * 4, tilesZ * 4), rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let p = 0; p < rgba.length / 4; p++) rgb.set(rgba.subarray(p * 4, p * 4 + 3), p * 3);
  return encodeDxt1Mips(finishMinimap(doc, rgb), 1024);
}

const SAME = 1e-6;
const sameSpot = (a) => (b) => Math.abs(a.x - b.x) < SAME && Math.abs(a.z - b.z) < SAME && Math.abs(a.metal - b.metal) < SAME;

/**
 * The derivative's metal map. While the doc's metal objects are exactly the spots BAR finds in the original's metal
 * map (shifted with the map), that map is written unchanged. Otherwise only the edits are: blobs of removed or changed
 * spots are cleared, new and changed spots stamped like buildMetalMap, untouched spots keep their own pixels.
 * maxMetal stays the original's unless a new spot needs more (then every pixel is rescaled to keep its value).
 * @param {number} extractorRadius  the original's (BAR's metal-map rule depends on it)
 * @returns {{data: Uint8Array, maxMetal: number, changed: boolean}}
 */
export function deriveMetal(doc, original, extractorRadius) {
  if (!original.metalMap) {
    const { data, maxMetal } = buildMetalMap(doc);
    return { data, maxMetal, changed: true };
  }
  const width = doc.sx * 32, height = doc.sz * 32, wanted = metalObjects(doc);
  const blobs = metalBlobs(original.metalMap, width, height);
  const field = isMetalField(blobs, extractorRadius); // a metal map: no spots to match, its blobs stay
  const left = [...wanted]; // doc spots no original spot matches
  const kept = field ? blobs.map(() => true) : blobs.map((blob) => {
    const i = left.findIndex(sameSpot(blobSpot(blob, original.maxMetal)));
    return i >= 0 && left.splice(i, 1).length > 0;
  });
  if (!left.length && kept.every(Boolean)) return { data: original.metalMap, maxMetal: original.maxMetal, changed: false };
  const richest = Math.max(0, ...left.map((s) => s.metal));
  const maxMetal = (richest * 1000) / MAX_SPOT_SUM <= original.maxMetal ? original.maxMetal : maxMetalFor(richest);
  const data = original.metalMap.slice();
  if (maxMetal !== original.maxMetal) for (let k = 0; k < data.length; k++) data[k] = Math.round((data[k] * original.maxMetal) / maxMetal);
  blobs.forEach((blob, i) => { if (!kept[i]) for (const k of blob.pixels) data[k] = 0; });
  for (const spot of left) stampSpot(data, width, height, spot, maxMetal);
  return { data, maxMetal, changed: true };
}
