// Whole-map hydraulic erosion and slope limiting. Both restore the doc's symmetry afterwards.
import { SQUARE, symMode, symmetrize } from '../core/index.js';
import { mulberry32 } from './noise.js';

const INERTIA = 0.05, CAPACITY = 4, MIN_CAPACITY = 0.01, DEPOSIT = 0.3, ERODE = 0.3;
const EVAPORATE = 0.02, GRAVITY = 4, MAX_STEPS = 48, RADIUS = 3;

/**
 * Particle-based hydraulic erosion (after S. Lague), in grid-height units (elmos / 8).
 * `amount` 1 = 1500 droplets per map unit squared. Droplets only start in the symmetry source
 * domain (the mirrored parts are overwritten by symmetrize anyway) and die near the map edge.
 */
export function erode(doc, { amount, seed }) {
  const { W, H, heights: hh } = doc;
  const rnd = mulberry32(seed);
  const h = new Float32Array(hh.length);
  for (let k = 0; k < hh.length; k++) h[k] = hh[k] / SQUARE;
  // Erosion footprint: flat grid offsets and normalized weights inside RADIUS.
  const offs = [], wts = [];
  for (let z = -RADIUS; z <= RADIUS; z++) for (let x = -RADIUS; x <= RADIUS; x++) {
    const d = Math.hypot(x, z);
    if (d <= RADIUS) { offs.push(z * W + x); wts.push(1 - d / RADIUS); }
  }
  const wsum = wts.reduce((s, w) => s + w, 0), off = Int32Array.from(offs), wt = Float64Array.from(wts, (w) => w / wsum);

  const height = (px, pz) => {
    const ix = px | 0, iz = pz | 0, fx = px - ix, fz = pz - iz, k = iz * W + ix;
    return h[k] * (1 - fx) * (1 - fz) + h[k + 1] * fx * (1 - fz) + h[k + W] * (1 - fx) * fz + h[k + W + 1] * fx * fz;
  };
  const mode = symMode(doc), lo = RADIUS, hiX = W - 1 - RADIUS, hiZ = H - 1 - RADIUS;
  const droplets = Math.round(amount * doc.sx * doc.sz * 1500 / mode.T.length);
  for (let it = 0; it < droplets;) {
    let px = lo + rnd() * (hiX - lo), pz = lo + rnd() * (hiZ - lo), dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
    if (!mode.src(px, pz, W - 1, H - 1)) continue;
    it++;
    for (let step = 0; step < MAX_STEPS; step++) {
      const ix = px | 0, iz = pz | 0, fx = px - ix, fz = pz - iz, k = iz * W + ix;
      const a = h[k], b = h[k + 1], c = h[k + W], d = h[k + W + 1];
      const gx = (b - a) * (1 - fz) + (d - c) * fz, gz = (c - a) * (1 - fx) + (d - b) * fx;
      const h0 = a * (1 - fx) * (1 - fz) + b * fx * (1 - fz) + c * (1 - fx) * fz + d * fx * fz;
      dx = dx * INERTIA - gx * (1 - INERTIA);
      dz = dz * INERTIA - gz * (1 - INERTIA);
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-9) break;
      dx /= len; dz /= len;
      px += dx; pz += dz;
      if (px < lo || pz < lo || px >= hiX || pz >= hiZ) break;
      const dh = height(px, pz) - h0;
      const cap = Math.max(-dh * speed * water * CAPACITY, MIN_CAPACITY);
      if (sed > cap || dh > 0) {
        // Deposit: fill the pit we climbed out of, or drop the excess over capacity.
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * DEPOSIT;
        sed -= amt;
        h[k] += amt * (1 - fx) * (1 - fz); h[k + 1] += amt * fx * (1 - fz);
        h[k + W] += amt * (1 - fx) * fz; h[k + W + 1] += amt * fx * fz;
      } else {
        const amt = Math.min((cap - sed) * ERODE, -dh);
        for (let n = 0; n < off.length; n++) h[k + off[n]] -= amt * wt[n];
        sed += amt; // the weights sum to 1
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * GRAVITY));
      water *= 1 - EVAPORATE;
    }
  }
  for (let k = 0; k < hh.length; k++) hh[k] = h[k] * SQUARE;
  symmetrize(doc, 0.015);
}

/**
 * Cap slopes at `maxDeg`: the terrain becomes the average of the highest surface below it and the
 * lowest surface above it that both respect the limit, so peaks are cut and valleys filled by half.
 */
export function limitSlopes(doc, maxDeg) {
  const t = Math.tan(maxDeg * Math.PI / 180) * SQUARE / 1.0824; // 1.0824: worst gradient between the 8 step directions
  const hh = doc.heights, below = lowerEnvelope(doc, hh, t), above = lowerEnvelope(doc, hh.map((v) => -v), t);
  for (let k = 0; k < hh.length; k++) hh[k] = (below[k] - above[k]) / 2;
  symmetrize(doc, 0.01);
}

// Highest surface <= src whose rise between 8-neighbours stays within t per square (exact with a
// forward and a backward chamfer sweep).
function lowerEnvelope(doc, src, t) {
  const { W, H } = doc, e = Float32Array.from(src), d = t * Math.SQRT2;
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const k = z * W + x;
    let v = e[k];
    if (x > 0) v = Math.min(v, e[k - 1] + t);
    if (z > 0) {
      v = Math.min(v, e[k - W] + t);
      if (x > 0) v = Math.min(v, e[k - W - 1] + d);
      if (x < W - 1) v = Math.min(v, e[k - W + 1] + d);
    }
    e[k] = v;
  }
  for (let z = H - 1; z >= 0; z--) for (let x = W - 1; x >= 0; x--) {
    const k = z * W + x;
    let v = e[k];
    if (x < W - 1) v = Math.min(v, e[k + 1] + t);
    if (z < H - 1) {
      v = Math.min(v, e[k + W] + t);
      if (x < W - 1) v = Math.min(v, e[k + W + 1] + d);
      if (x > 0) v = Math.min(v, e[k + W - 1] + d);
    }
    e[k] = v;
  }
  return e;
}
