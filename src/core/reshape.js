// Reshaping a map: extend or crop each side by whole units, or resample it to a new size. Pure: both return a new
// MapDoc and leave the input untouched (the editor keeps it for undo).
import { fbm, makeSimplex, smoothstep } from '../terrain/noise.js';
import { SQUARE, UNIT, createMap, sampleHeight } from './map.js';
import { SYMMETRY, enforceSymmetry, tx, tz } from './symmetry.js';

// Grid cells per map unit: heightmap samples (the heightmap has one more closing row and column), SMT tiles, metal pixels.
const SAMPLES = 64, TILES = 16, METAL = 32;

// New ground, distances in heightmap samples. It starts at the edge height and eases to the map's low ground over
// FALLOFF; the edge's own slope carries on over SEAM (no crease), capped at MAX_SLOPE elmos per sample so a cliff at
// the edge does not shoot off. The edge profile is averaged over a window that grows with the distance (BLUR, at most
// MAX_BLUR), so edge detail fades into broad shapes instead of streaking outward.
const FALLOFF = 96, SEAM = 12, MAX_SLOPE = 8, BLUR = 0.5, MAX_BLUR = 48;
const NOISE_SCALE = 80, NOISE_STEP = 4, NOISE_SEED = 0x5eed;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Extend (positive) or crop (negative) each side by whole map units. The kept part is copied exactly; new ground
 * continues the edge and eases towards the map's low ground. Objects shift with the map; those outside a crop are
 * dropped (compare object counts by type to report them). doc.original's tileIndex and metalMap shift too (-1 and 0 in
 * new areas) and its offset (where the archive's map sits, in units) moves by (west, north), so the export can shift
 * the original's other map-wide data. Throws a RangeError when a side of the result is not an even 2..32 units or a
 * crop removes the whole map.
 */
export function extendMap(doc, { west = 0, east = 0, north = 0, south = 0 }) {
  if (![west, east, north, south].every(Number.isInteger)) throw new RangeError('maps extend and crop by whole units');
  if (doc.sx + Math.min(0, west) + Math.min(0, east) < 1 || doc.sz + Math.min(0, north) + Math.min(0, south) < 1) throw new RangeError('the crop removes the whole map');
  const sx = doc.sx + west + east, sz = doc.sz + north + south;
  const placed = [west * UNIT, north * UNIT, (west + doc.sx) * UNIT, (north + doc.sz) * UNIT];
  const next = blank(doc, sx, sz, keptSymmetry(doc, sx, sz, placed));
  for (const k of ['heights', 'paint', 'paintWeight']) paste(doc[k], doc.W, next[k], next.W, SAMPLES * west, SAMPLES * north);
  const kept = [Math.max(0, SAMPLES * west), Math.max(0, SAMPLES * north), Math.min(next.W, doc.W + SAMPLES * west) - 1, Math.min(next.H, doc.H + SAMPLES * north) - 1];
  grow(next, kept, groundLevels(doc.heights));

  const [w, h] = [sx * UNIT, sz * UNIT];
  next.objects = doc.objects.map((o) => ({ ...o, x: o.x + placed[0], z: o.z + placed[1] })).filter((o) => o.x >= 0 && o.z >= 0 && o.x <= w && o.z <= h);
  if (doc.original) {
    const regrid = (src, per, fill) => src && paste(src, doc.sx * per, new src.constructor(sx * per * sz * per).fill(fill), sx * per, west * per, north * per);
    const { tileIndex, metalMap, offset: [ox, oz] } = doc.original;
    next.original = {
      ...doc.original, tilesX: sx * TILES, tilesZ: sz * TILES, tileIndex: regrid(tileIndex, TILES, -1), metalMap: regrid(metalMap, METAL, 0),
      offset: [ox + west, oz + north],
    };
  }
  return next;
}

/**
 * Resample to sx × sz units: heights bilinear (in elmos; nothing is scaled vertically), paint nearest, object positions
 * scaled. Original textures cannot be rescaled, so doc.original keeps its files but its tileIndex and metalMap become
 * null (the export bakes new textures and writes the metal map from the metal objects).
 */
export function resizeMap(doc, sx, sz) {
  const next = blank(doc, sx, sz, keptSymmetry(doc, sx, sz, [0, 0, sx * UNIT, sz * UNIT]));
  const fx = doc.sx / sx, fz = doc.sz / sz; // old elmos per new elmo
  for (let j = 0; j < next.H; j++) {
    for (let i = 0; i < next.W; i++) {
      const k = j * next.W + i, x = i * SQUARE * fx, z = j * SQUARE * fz, n = Math.round(z / SQUARE) * doc.W + Math.round(x / SQUARE);
      next.heights[k] = sampleHeight(doc, x, z);
      next.paint[k] = doc.paint[n];
      next.paintWeight[k] = doc.paintWeight[n];
    }
  }
  next.objects = doc.objects.map((o) => ({ ...o, x: o.x / fx, z: o.z / fz }));
  if (doc.original) next.original = { ...doc.original, tilesX: sx * TILES, tilesZ: sz * TILES, tileIndex: null, metalMap: null };
  return next;
}

// A copy of doc at the new size: fresh zero grids from createMap (which validates the size), no objects yet,
// settings deep-copied (the old doc stays untouched in the undo history), every other field carried over.
function blank(doc, sx, sz, symmetry) {
  return { ...doc, ...createMap({ sx, sz, symmetry }), settings: structuredClone(doc.settings), biome: doc.biome };
}

// The doc's symmetry if it still holds once the old map lands on world rect [x0, z0, x1, z1] of the sx × sz result:
// the mode fits the new shape and maps that rect onto itself (e.g. a left-right mirror needs as much added west as east).
function keptSymmetry(doc, sx, sz, [x0, z0, x1, z1]) {
  const mode = SYMMETRY[doc.symmetry], ex = sx * UNIT, ez = sz * UNIT;
  if (mode.square && sx !== sz) return 'none';
  const fixed = mode.T.every((t) => {
    const ax = tx(t, x0, z0, ex), bx = tx(t, x1, z1, ex), az = tz(t, x0, z0, ez), bz = tz(t, x1, z1, ez);
    return Math.min(ax, bx) === x0 && Math.max(ax, bx) === x1 && Math.min(az, bz) === z0 && Math.max(az, bz) === z1;
  });
  return fixed ? doc.symmetry : 'none';
}

/** Copies grid src (rows of w cells) into dst (rows of nw cells), moved by (dx, dz) cells; cells outside dst are dropped. */
export function paste(src, w, dst, nw, dx, dz) {
  const h = src.length / w, nh = dst.length / nw, x0 = Math.max(0, dx), x1 = Math.min(nw, w + dx);
  for (let z = Math.max(0, dz); z < Math.min(nh, h + dz); z++) dst.set(src.subarray((z - dz) * w + x0 - dx, (z - dz) * w + x1 - dx), z * nw + x0);
  return dst;
}

// The level new ground settles at (the map's lower quartile) and its noise amplitude (from the height spread),
// from a subsample of at most ~64k heights.
function groundLevels(heights) {
  const step = Math.max(1, Math.floor(heights.length / 65536)), sample = new Float32Array(Math.ceil(heights.length / step));
  for (let k = 0, n = 0; k < heights.length; k += step) sample[n++] = heights[k];
  sample.sort();
  const at = (q) => sample[Math.floor(q * (sample.length - 1))];
  return { base: at(0.25), amp: clamp(0.05 * (at(0.9) - at(0.1)), 4, 20) };
}

// Fills every height outside the kept grid rect [x0, z0, x1, z1] (inclusive). Distances and directions come from the
// nearest kept sample, so sides and corners join without seams; at distance 0 the result is the edge height exactly.
function grow(doc, [x0, z0, x1, z1], { base, amp }) {
  const { W, H, heights: h } = doc, S = W + 1, sat = summedArea(h, W, H), rugged = noiseField(doc, [x0, z0, x1, z1]);
  const mean = (a, c, b, d) => { // mean height over [a..b] × [c..d], clamped to the kept rect
    a = Math.max(a, x0); c = Math.max(c, z0); b = Math.min(b, x1); d = Math.min(d, z1);
    return (sat[(d + 1) * S + b + 1] - sat[c * S + b + 1] - sat[(d + 1) * S + a] + sat[c * S + a]) / ((b - a + 1) * (d - c + 1));
  };
  // The edge profile at kept sample (ci, cj), d samples out. The blur radius grows like d² near the seam, so the
  // profile leaves the edge without a kink.
  const edge = (ci, cj, d) => {
    const r = Math.min(MAX_BLUR, (BLUR * d * d) / (d + SEAM)), r0 = Math.floor(r), f = r - r0;
    return mean(ci - r0, cj - r0, ci + r0, cj + r0) * (1 - f) + mean(ci - r0 - 1, cj - r0 - 1, ci + r0 + 1, cj + r0 + 1) * f;
  };
  // The edge's slope towards (ax, az) in elmos per sample: the last two kept samples, averaged over 5 along the edge.
  const slope = (ci, cj, ax, az, d) => {
    const sx = Math.sign(ax), sz = Math.sign(az);
    const gx = sx && (mean(ci, cj - 2, ci, cj + 2) - mean(ci - 2 * sx, cj - 2, ci - 2 * sx, cj + 2)) / 2;
    const gz = sz && (mean(ci - 2, cj, ci + 2, cj) - mean(ci - 2, cj - 2 * sz, ci + 2, cj - 2 * sz)) / 2;
    return clamp((Math.abs(ax) * gx + Math.abs(az) * gz) / d, -MAX_SLOPE, MAX_SLOPE);
  };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const ci = clamp(i, x0, x1), cj = clamp(j, z0, z1), ax = i - ci, az = j - cj;
      if (!ax && !az) continue;
      const k = j * W + i, d = Math.hypot(ax, az), t = smoothstep(0, FALLOFF, d);
      let v = base + amp * rugged[k] * t;
      if (d < FALLOFF) v += (edge(ci, cj, d) - base) * (1 - t);
      if (d < SEAM) v += slope(ci, cj, ax, az, d) * d * (1 - smoothstep(0, SEAM, d));
      h[k] = v;
    }
  }
}

/** Summed-area table of a W × H grid: (W + 1) × (H + 1), entry (i, j) = sum of the cells above and left of it. */
function summedArea(grid, W, H) {
  const S = W + 1, sat = new Float64Array(S * (H + 1));
  for (let j = 0; j < H; j++) {
    let row = 0;
    for (let i = 0; i < W; i++) {
      row += grid[j * W + i];
      sat[(j + 1) * S + i + 1] = sat[j * S + i + 1] + row;
    }
  }
  return sat;
}

// Gentle fBm for the new ground (zero inside the kept rect). It is smooth at NOISE_STEP samples, so it is evaluated
// on that coarser grid and interpolated; then mirrored like the map so a kept symmetry stays exact.
function noiseField(doc, [x0, z0, x1, z1]) {
  const { W, H } = doc, n = NOISE_STEP, cw = (W - 1) / n + 1, ch = (H - 1) / n + 1, simplex = makeSimplex(NOISE_SEED);
  const coarse = new Float32Array(cw * ch), out = new Float32Array(W * H);
  for (let k = 0; k < coarse.length; k++) coarse[k] = fbm(simplex, ((k % cw) * n) / NOISE_SCALE, (Math.floor(k / cw) * n) / NOISE_SCALE, 3, 2, 0.5);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (i >= x0 && i <= x1 && j >= z0 && j <= z1) continue;
      const ci = Math.min(cw - 2, Math.floor(i / n)), cj = Math.min(ch - 2, Math.floor(j / n)), fx = i / n - ci, fz = j / n - cj, c = cj * cw + ci;
      out[j * W + i] = (coarse[c] * (1 - fx) + coarse[c + 1] * fx) * (1 - fz) + (coarse[c + cw] * (1 - fx) + coarse[c + cw + 1] * fx) * fz;
    }
  }
  enforceSymmetry(doc, [out]);
  return out;
}
