// Sculpting brushes, ramps, pad flattening and blur. Brushes and ramps follow the doc's symmetry.
import { SQUARE, images, orbit, sampleHeight } from '../core/index.js';
import { fbm, lerp, makeSimplex, smoothstep } from './noise.js';

const ROUGH = makeSimplex(4242); // noise brush pattern (fixed so strokes line up)

/** Dirty rects are grid [x0, z0, x1, z1], inclusive. */
export function union(a, b) {
  if (!b) return a;
  if (!a) return b.slice();
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** Brush weight at normalised distance d (0 centre, 1 edge): full inside `hardness`, then a smoothstep to 0. */
export function falloff(d, hardness) {
  if (d >= 1) return 0;
  const h = Math.min(0.98, hardness);
  if (d <= h) return 1;
  const t = 1 - (d - h) / (1 - h);
  return t * t * (3 - 2 * t);
}

/**
 * One brush dab at world (x, z) and at each of its symmetry images.
 * @param {'raise'|'lower'|'smooth'|'flatten'|'noise'|'paint'} tool
 * @param {{radius:number, strength:number, hardness:number, target?:number, material?:number, noiseScale?:number}} p
 *   radius in elmos, strength 0..1 (negative noise strength subtracts), target height for flatten,
 *   material id for paint (0 erases), noiseScale in elmos for noise.
 * @param {number} dt seconds of brush time
 * @returns dirty rect or null
 */
export function brush(doc, tool, x, z, p, dt) {
  let rect = null;
  const used = [];
  for (const [px, pz] of orbit(doc, x, z)) {
    // Images overlapping on a symmetry axis would apply twice.
    if (used.some(([ux, uz]) => Math.hypot(ux - px, uz - pz) < p.radius * 0.5)) continue;
    used.push([px, pz]);
    rect = union(rect, dab(doc, tool, px, pz, p, dt));
  }
  return rect;
}

function dab(doc, tool, x, z, p, dt) {
  const { W, H, heights: hh } = doc;
  const cx = x / SQUARE, cz = z / SQUARE, r = Math.max(1, p.radius / SQUARE);
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(H - 1, Math.ceil(cz + r));
  if (x0 > x1 || z0 > z1) return null;
  const s = p.strength;

  if (tool === 'paint') {
    const m = p.material | 0, pid = doc.paint, pw = doc.paintWeight, rate = s * dt * 900;
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      const k = j * W + i, delta = Math.round(falloff(Math.hypot(i - cx, j - cz) / r, p.hardness) * rate);
      if (delta <= 0) continue;
      if (m === 0) pw[k] = Math.max(0, pw[k] - delta);
      else if (pid[k] === m || pw[k] === 0) { pid[k] = m; pw[k] = Math.min(255, pw[k] + delta); }
      else if (pw[k] <= delta) { pid[k] = m; pw[k] = Math.min(255, delta - pw[k]); }
      else pw[k] -= delta;
    }
    return [x0, z0, x1, z1];
  }

  let blur = null, bx = 0, bz = 0, bw = 0;
  if (tool === 'smooth') {
    // Box-blurred copy of the region; blur radius grows gently with brush size.
    const br = Math.max(1, Math.min(4, Math.round(r / 6)));
    bx = Math.max(0, x0 - br); bz = Math.max(0, z0 - br);
    bw = Math.min(W - 1, x1 + br) - bx + 1;
    const bh = Math.min(H - 1, z1 + br) - bz + 1;
    blur = new Float32Array(bw * bh);
    for (let j = 0; j < bh; j++) blur.set(hh.subarray((j + bz) * W + bx, (j + bz) * W + bx + bw), j * bw);
    blur = boxBlur(blur, bw, bh, br);
  }
  const ease = 1 - Math.exp(-dt * s * 8);  // flatten / smooth convergence per dab
  const rise = s * dt * 300;               // elmos per second at full strength
  const nscale = 1 / Math.max(16, p.noiseScale ?? 200);

  for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
    const w = falloff(Math.hypot(i - cx, j - cz) / r, p.hardness);
    if (w <= 0) continue;
    const k = j * W + i;
    switch (tool) {
      case 'raise': hh[k] += w * rise; break;
      case 'lower': hh[k] -= w * rise; break;
      case 'flatten': hh[k] += (p.target - hh[k]) * Math.min(1, w * ease * 1.5); break;
      case 'smooth': hh[k] += (blur[(j - bz) * bw + (i - bx)] - hh[k]) * Math.min(1, w * ease * 1.5); break;
      case 'noise': hh[k] += w * rise * fbm(ROUGH, i * SQUARE * nscale, j * SQUARE * nscale, 4, 2, 0.5); break;
      default: throw new RangeError(`unknown brush tool '${tool}'`);
    }
  }
  return [x0, z0, x1, z1];
}

/**
 * Level a buildable disc of radius `core` (elmos) at world (x, z), blending back to the terrain
 * over `blend` elmos so no cliff ring forms. Target = mean height of the core, at least `floor`.
 * Not mirrored: callers flatten every image or symmetrize afterwards.
 */
export function flattenAround(doc, x, z, core, blend, floor) {
  let sum = 0, cnt = 0;
  for (let a = 0; a < 24; a++) for (let s = 0; s <= 4; s++) {
    const r = core * s / 4, ang = a / 24 * Math.PI * 2;
    sum += sampleHeight(doc, x + Math.cos(ang) * r, z + Math.sin(ang) * r); cnt++;
  }
  const R = core + blend;
  return dab(doc, 'flatten', x, z, { radius: R, hardness: core / R, strength: 1, target: Math.max(sum / cnt, floor) }, 1);
}

/**
 * Carve/fill a straight corridor from a to b with a linear height profile, at every symmetry image.
 * a, b: {x, z, h?} in elmos; h defaults to the current terrain height there.
 */
export function ramp(doc, a, b, { width, hardness = 0.5 }) {
  const ha = a.h ?? sampleHeight(doc, a.x, a.z), hb = b.h ?? sampleHeight(doc, b.x, b.z);
  const A = images(doc, a.x, a.z), B = images(doc, b.x, b.z), done = [];
  let rect = null;
  A.forEach(([ax, az], k) => {
    const [bx, bz] = B[k];
    if (done.some((d) => Math.hypot(d[0] - ax, d[1] - az) + Math.hypot(d[2] - bx, d[3] - bz) < 1)) return;
    done.push([ax, az, bx, bz]);
    rect = union(rect, segment(doc, ax, az, bx, bz, ha, hb, width, hardness));
  });
  return rect;
}

function segment(doc, ax, az, bx, bz, ha, hb, width, hardness) {
  const { W, H, heights: hh } = doc;
  const half = width / 2, fall = Math.max(8, half * (1 - hardness) * 1.5 + 8), reach = (half + fall) / SQUARE;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) / SQUARE - reach)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) / SQUARE + reach));
  const z0 = Math.max(0, Math.floor(Math.min(az, bz) / SQUARE - reach)), z1 = Math.min(H - 1, Math.ceil(Math.max(az, bz) / SQUARE + reach));
  const dx = bx - ax, dz = bz - az, L2 = Math.max(1, dx * dx + dz * dz);
  for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
    const px = i * SQUARE, pz = j * SQUARE;
    const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / L2));
    const d = Math.hypot(px - ax - dx * t, pz - az - dz * t);
    if (d > half + fall) continue;
    const k = j * W + i;
    hh[k] = lerp(hh[k], ha + (hb - ha) * t, d <= half ? 1 : 1 - smoothstep(0, 1, (d - half) / fall));
  }
  return [x0, z0, x1, z1];
}

/** Separable box blur of a w*h layer with radius r (edge-clamped averages). */
export function boxBlur(a, w, h, r) {
  const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let z = 0; z < h; z++) {
    let sum = 0, cnt = 0;
    for (let x = 0; x <= r && x < w; x++) { sum += a[z * w + x]; cnt++; }
    for (let x = 0; x < w; x++) {
      tmp[z * w + x] = sum / cnt;
      if (x - r >= 0) { sum -= a[z * w + x - r]; cnt--; }
      if (x + r + 1 < w) { sum += a[z * w + x + r + 1]; cnt++; }
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0, cnt = 0;
    for (let z = 0; z <= r && z < h; z++) { sum += tmp[z * w + x]; cnt++; }
    for (let z = 0; z < h; z++) {
      out[z * w + x] = sum / cnt;
      if (z - r >= 0) { sum -= tmp[(z - r) * w + x]; cnt--; }
      if (z + r + 1 < h) { sum += tmp[(z + r + 1) * w + x]; cnt++; }
    }
  }
  return out;
}

export function smoothAll(doc, passes) {
  for (let p = 0; p < passes; p++) doc.heights.set(boxBlur(doc.heights, doc.W, doc.H, 1));
}
