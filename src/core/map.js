// MapDoc creation, height sampling and symmetric map objects. Pure.
import { symMode, tx, tz } from './symmetry.js';

export const SQUARE = 8;  // elmos per heightmap square (engine constant)
export const UNIT = 512;  // elmos per map-size unit ("8x8" map = 4096 elmos wide)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function defaultSettings() {
  return {
    name: 'My BAR Map', version: '1.0', author: '', description: '',
    minWind: 5, maxWind: 20, tidalStrength: 15, gravity: 130, extractorRadius: 90, voidWater: false,
    lava: { enabled: false, level: 60, damage: 100 },
    sunDir: [0.4, 0.75, -0.5],
  };
}

/** A new flat MapDoc (height 0); the shape is documented in docs/ARCHITECTURE.md. */
export function createMap({ sx, sz, symmetry = 'none', biome = 'temperate' }) {
  for (const s of [sx, sz]) {
    if (!Number.isInteger(s) || s < 2 || s > 32 || s % 2) throw new RangeError(`map size must be an even number of units in 2..32, got ${s}`);
  }
  const W = 64 * sx + 1, H = 64 * sz + 1, n = W * H;
  const doc = {
    sx, sz, W, H, heights: new Float32Array(n), paint: new Uint8Array(n), paintWeight: new Uint8Array(n),
    symmetry, objects: [], settings: defaultSettings(), biome,
  };
  symMode(doc); // validates the symmetry for this size
  return doc;
}

/** Map size in elmos: [width, height]. */
export const worldSize = (doc) => [doc.sx * UNIT, doc.sz * UNIT];

/** Bilinear height at world position (elmos). */
export function sampleHeight(doc, x, z) {
  const { W, H, heights: hh } = doc;
  const gx = clamp(x / SQUARE, 0, W - 1.0001), gz = clamp(z / SQUARE, 0, H - 1.0001);
  const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, k = j * W + i;
  const a = hh[k], b = hh[k + 1], c = hh[k + W], d = hh[k + W + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Terrain slope in degrees at the grid vertex nearest to world (x, z) (central differences). */
export function slopeAt(doc, x, z) {
  const { W, H, heights: hh } = doc;
  const i = clamp(Math.round(x / SQUARE), 1, W - 2), j = clamp(Math.round(z / SQUARE), 1, H - 2), k = j * W + i;
  const dx = (hh[k + 1] - hh[k - 1]) / (2 * SQUARE), dz = (hh[k + W] - hh[k - W]) / (2 * SQUARE);
  return Math.atan(Math.hypot(dx, dz)) * (180 / Math.PI);
}

export function heightRange(doc) {
  let lo = Infinity, hi = -Infinity;
  for (const v of doc.heights) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

/** All symmetry images of a world point, one per transform of the mode (duplicates kept). */
export function images(doc, x, z) {
  const [ex, ez] = worldSize(doc);
  return symMode(doc).T.map((t) => [tx(t, x, z, ex), tz(t, x, z, ez)]);
}

/** Distinct symmetry images of a world point as [x, z, transformIndex], source image first. */
export function orbit(doc, x, z) {
  const out = [];
  images(doc, x, z).forEach(([px, pz], k) => {
    if (!out.some(([qx, qz]) => Math.abs(qx - px) < 1 && Math.abs(qz - pz) < 1)) out.push([px, pz, k]);
  });
  return out;
}

/** Add one object per point, all sharing a new symmetry group. Returns the new objects. */
export function addGroup(doc, type, points, props = {}) {
  let id = 0, group = 0;
  for (const o of doc.objects) { id = Math.max(id, o.id); group = Math.max(group, o.group ?? 0); }
  const made = points.map(([x, z]) => ({ id: ++id, type, x, z, group: group + 1, ...props }));
  doc.objects.push(...made);
  return made;
}

/** Add an object and its mirrored copies (per the doc's symmetry). Returns the new objects. */
export const addObject = (doc, type, x, z, props) => addGroup(doc, type, orbit(doc, x, z), props);

/** Move an object to world (x, z); its group's mirrored copies follow. */
export function moveGroup(doc, obj, x, z) {
  const [ex, ez] = worldSize(doc), T = symMode(doc).T;
  x = clamp(x, 0, ex); z = clamp(z, 0, ez);
  if (obj.group !== undefined) {
    for (const o of doc.objects) {
      if (o === obj || o.group !== obj.group) continue;
      // The transform that maps obj onto o today maps the new position onto o's new position.
      const t = T.find((t) => Math.abs(tx(t, obj.x, obj.z, ex) - o.x) < 1 && Math.abs(tz(t, obj.x, obj.z, ez) - o.z) < 1);
      if (t !== undefined) { o.x = tx(t, x, z, ex); o.z = tz(t, x, z, ez); }
    }
  }
  obj.x = x; obj.z = z;
}
