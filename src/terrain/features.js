// Trees and rocks: BAR's built-in feature defs (TreeType0..15 fir trees, rocks30_<variant>_01..30) scattered per
// biome in noise-driven groves and rock fields, mirrored by the doc's symmetry. Scattered features carry
// `auto: 'trees' | 'rocks'`; scattering again replaces them and keeps hand-placed features.
import { SQUARE, addGroup, orbit, sampleHeight, slopeAt, symMode, worldSize } from '../core/index.js';
import { MATERIALS } from '../look/index.js';
import { fbm, makeSimplex, mulberry32, smoothstep } from './noise.js';

/**
 * Feature sets per biome (src/look BIOMES keys). trees / rocks: share of candidate spots filled at density 1 in the
 * heart of a grove or rock field; rockVariants: the rocks30_<variant>_NN families to draw from.
 */
export const FEATURE_SETS = {
  temperate: { trees: 0.8, rocks: 0.15, rockVariants: ['moss', 'def'] },
  desert: { trees: 0.03, rocks: 0.45, rockVariants: ['desert'] },
  arctic: { trees: 0.25, rocks: 0.4, rockVariants: ['snow'] },
  volcanic: { trees: 0, rocks: 0.5, rockVariants: ['def'] },
  lunar: { trees: 0, rocks: 0.55, rockVariants: ['def'] },
  redPlanet: { trees: 0, rocks: 0.5, rockVariants: ['desert'] },
  tropical: { trees: 1, rocks: 0.2, rockVariants: ['moss'] },
};

const STEP = 48;           // elmos between candidate spots (a jittered grid)
const VEHICLE_SLOPE = 27;  // degrees: trees only where vehicles drive; steeper ground walls passages in
const ROCK_SLOPE = 50;     // degrees: no rocks on sheer cliff faces
const EDGE = 96;           // elmos kept clear along the map edges
const CLEAR = { start: 600, metal: 110, geo: 160 }; // elmos kept clear around resources (geo: room for a T2 geo)
const CHOKE = 160;         // elmos: drivable passages narrower than this stay clear
const RAMP = 480;          // elmos: sloped passages (ramps) narrower than this, across the slope, stay clear
const RAMP_SLOPE = 9;      // degrees: drivable ground at least this steep may be a ramp
const WALL = 48;           // elmos: undrivable ground at least this thick walls a passage in (thinner = rough ground)
const RING = 96;           // elmos: ring sampled for cliffs rising nearby and for shores
const TREE_R = 12;         // elmos kept free around a tree
const CELL = 80;           // overlap-check bucket, > twice the largest feature radius
const TRAIL = MATERIALS.findIndex((m) => m.key === 'sand') + 1; // painted trails (the volcano paints its ramps with sand)
const D = Math.SQRT1_2, DIRS = [[1, 0], [0, 1], [D, D], [D, -D]]; // one per axis; used with both signs

// rocks30_*_NN has a footprint of floor(NN / 8) + 1 squares; anything else counts as tree-sized.
const radiusOf = (name) => { const m = /^rocks30_\w+_(\d+)$/.exec(name); return m ? 8 * (Math.floor(m[1] / 8) + 1) + 4 : TREE_R; };

// Share of a grove / rock field at noise value n (fBm, median 0) filled at density d: lower densities give fewer,
// smaller and thinner patches (plus a few strays) rather than an even sprinkle.
const cover = (n, d) => (d > 0 ? smoothstep(0.4 - 0.56 * d, 0.55 - 0.56 * d, n) * (0.6 + 0.4 * d) + 0.03 * d : 0);

/**
 * Replace the scattered features of the given kinds with new ones for the doc's biome, terrain and symmetry.
 * @param {{density?: number, seed?: number, kinds?: ('trees'|'rocks')[]}} opts density 0..1 (0 removes them)
 * @returns {{added: number, removed: number}} object counts, mirrored copies included
 */
export function scatterFeatures(doc, { density = 0.5, seed = 1, kinds = ['trees', 'rocks'] } = {}) {
  const set = FEATURE_SETS[doc.biome];
  if (!set) throw new RangeError(`unknown biome '${doc.biome}'`);
  const before = doc.objects.length;
  doc.objects = doc.objects.filter((o) => !kinds.includes(o.auto));
  const removed = before - doc.objects.length;
  const treeRate = kinds.includes('trees') ? set.trees : 0, rockRate = kinds.includes('rocks') ? set.rocks : 0;
  if (!(density > 0) || !(treeRate || rockRate)) return { added: 0, removed };

  const [ww, wh] = worldSize(doc), mode = symMode(doc), rnd = mulberry32(seed + 71);
  const groves = makeSimplex(seed + 501), fields = makeSimplex(seed + 502);
  const lava = doc.settings.lava.enabled, fluid = lava ? doc.settings.lava.level : 0, open = drivable(doc, fluid);
  const nearResource = resourceCheck(doc), taken = discs(ww);
  for (const o of doc.objects) if (o.type === 'feature') taken.add(o.x, o.z, radiusOf(o.name));
  let added = 0;

  for (let gz = 0; gz < wh; gz += STEP) for (let gx = 0; gx < ww; gx += STEP) {
    const x = gx + STEP * (0.1 + 0.8 * rnd()), z = gz + STEP * (0.1 + 0.8 * rnd());
    if (x < EDGE || z < EDGE || x > ww - EDGE || z > wh - EDGE || !mode.src(x, z, ww, wh)) continue;
    const h = sampleHeight(doc, x, z), slope = slopeAt(doc, x, z);
    if (h < fluid + 4 || slope > ROCK_SLOPE) continue;
    let lo = Infinity, hi = -Infinity; // lowest and highest ground on a ring around the spot
    for (const [dx, dz] of DIRS) for (const s of [RING, -RING]) {
      const v = sampleHeight(doc, x + dx * s, z + dz * s);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // Trees: groves on drivable ground well clear of water and lava.
    const pTree = treeRate && slope <= VEHICLE_SLOPE && lo > fluid + (lava ? 40 : 6)
      ? treeRate * cover(fbm(groves, x / 1400, z / 1400, 4, 2, 0.5), density) : 0;
    // Rocks: fields, plus slopes, the foot of cliffs and lava shores (debris).
    const slopeF = smoothstep(20, 45, slope), baseF = smoothstep(40, 140, hi - h), shoreF = lava && lo < fluid ? 1 : 0;
    const pRock = rockRate && rockRate * Math.min(1,
      cover(fbm(fields, x / 900, z / 900, 3, 2, 0.5) - 0.25, density) + density * (0.2 * slopeF + 0.5 * baseF + 1.5 * shoreF));
    const roll = rnd(), kind = roll < pTree ? 'trees' : roll < pTree + pRock ? 'rocks' : null;
    if (!kind || nearResource(x, z) || onTrail(doc, x, z) || (slope <= VEHICLE_SLOPE && inPassage(doc, open, x, z, slope))) continue;

    const name = featureName(kind, set, Math.max(baseF, shoreF, slopeF / 2), rnd), r = radiusOf(name), imgs = orbit(doc, x, z);
    if (imgs.some(([px, pz], k) => (k > 0 && Math.hypot(px - x, pz - z) < 2 * r) || !taken.free(px, pz, r))) continue;
    const rot = Math.floor(rnd() * 360);
    addGroup(doc, 'feature', imgs, { name, auto: kind }).forEach((o, k) => { o.rot = imageRot(mode.T[imgs[k][2]], rot); });
    for (const [px, pz] of imgs) taken.add(px, pz, r);
    added += imgs.length;
  }
  return { added, removed };
}

// One of BAR's 16 trees, or a rock of the biome's variants: bigger rocks are rarer, less so where big (0..1) is high.
function featureName(kind, set, big, rnd) {
  if (kind === 'trees') return `TreeType${Math.floor(rnd() * 16)}`;
  const variant = set.rockVariants[Math.floor(rnd() * set.rockVariants.length)];
  return `rocks30_${variant}_${String(1 + Math.floor(rnd() ** (2.5 - 1.5 * big) * 30)).padStart(2, '0')}`;
}

/** Drop scattered features standing where a start, metal spot or geo vent needs room (after resources moved). */
export function clearAroundResources(doc) {
  const near = resourceCheck(doc);
  doc.objects = doc.objects.filter((o) => !o.auto || !near(o.x, o.z));
}

function resourceCheck(doc) {
  const res = doc.objects.filter((o) => CLEAR[o.type]);
  return (x, z) => res.some((o) => Math.hypot(o.x - x, o.z - z) < CLEAR[o.type]);
}

function onTrail(doc, x, z) {
  const k = Math.round(z / SQUARE) * doc.W + Math.round(x / SQUARE);
  return doc.paint[k] === TRAIL && doc.paintWeight[k] > 96;
}

// Per heightmap sample: 1 where ground vehicles drive (above the water / lava, at most VEHICLE_SLOPE steep, measured
// like slopeAt); the outermost samples stay 0, so the map edge walls passages in.
function drivable(doc, fluid) {
  const { W, H, heights: hh } = doc, out = new Uint8Array(W * H);
  const max = (Math.tan(VEHICLE_SLOPE * Math.PI / 180) * 2 * SQUARE) ** 2;
  for (let j = 1; j < H - 1; j++) for (let i = 1, k = j * W + 1; i < W - 1; i++, k++) {
    const dx = hh[k + 1] - hh[k - 1], dz = hh[k + W] - hh[k - W];
    out[k] = hh[k] >= fluid && dx * dx + dz * dz <= max ? 1 : 0;
  }
  return out;
}

// Chokes and ramps stay clear: the spot lies in a drivable passage narrower than CHOKE along any axis, or, on sloped
// ground, narrower than RAMP across the slope (a ramp cut through a cliff). Walls are WALL-thick undrivable ground.
// shortcut: a few rays sampled every 16 elmos; revisit with a distance transform if passages need to be exact.
function inPassage(doc, open, x, z, slope) {
  const { W, H } = doc;
  // Distance from the spot to the first wall along (dx, dz), or Infinity when none starts within max elmos.
  const wallAt = (dx, dz, max) => {
    for (let s = 16, run = 0; s <= max + WALL; s += 16) {
      const i = Math.round((x + dx * s) / SQUARE), j = Math.round((z + dz * s) / SQUARE);
      run = i >= 0 && j >= 0 && i < W && j < H && open[j * W + i] ? 0 : run + 16;
      if (run >= WALL) return s - run + 16;
    }
    return Infinity;
  };
  const narrower = (dx, dz, width) => { const a = wallAt(dx, dz, width); return a + wallAt(-dx, -dz, width - a) <= width; };
  if (DIRS.some(([dx, dz]) => narrower(dx, dz, CHOKE))) return true;
  if (slope < RAMP_SLOPE) return false;
  const gx = sampleHeight(doc, x + 8, z) - sampleHeight(doc, x - 8, z), gz = sampleHeight(doc, x, z + 8) - sampleHeight(doc, x, z - 8);
  const g = Math.hypot(gx, gz);
  return g > 0 && narrower(-gz / g, gx / g, RAMP);
}

// Heading in degrees (0 = +z, 90 = +x) of a feature's mirror image under a src/core/symmetry.js transform code.
function imageRot(t, rot) {
  if (t & 4) rot = 90 - rot;
  if (t & 1) rot = -rot;
  if (t & 2) rot = 180 - rot;
  return ((rot % 360) + 360) % 360;
}

// Feature discs bucketed by CELL for overlap checks.
function discs(ww) {
  const cols = Math.ceil(ww / CELL) + 2, cells = new Map();
  return {
    free(x, z, r) {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
        for (const [qx, qz, qr] of cells.get(j * cols + i) ?? []) if (Math.hypot(qx - x, qz - z) < r + qr) return false;
      }
      return true;
    },
    add(x, z, r) {
      const k = Math.floor(z / CELL) * cols + Math.floor(x / CELL);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push([x, z, r]);
    },
  };
}
