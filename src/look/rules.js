// Auto-texturing rules: which material covers the ground where, by slope, height and paint. Shared by the bake
// (per texel) and the 2D preview (per heightmap sample), so the editor shows what the export bakes.
import { fbm, makeSimplex } from '../terrain/noise.js';
import { biomeOf, libraryMaterial, MATERIALS, paintMaterialId, ROLES } from './biomes.js';

const tan2 = (degrees) => Math.tan((degrees * Math.PI) / 180) ** 2;
// Squared height gradient (tan² of the slope) around the passability limits, blended over ±2° and bent by the
// edge noise (±~2°): vehicle ground (<= 27°), bot slopes (27-54°) and cliffs (> 54°) still read at a glance, but
// meet along organic, not posterised, edges.
const STEEP = [tan2(25), tan2(29)];
const CLIFF = [tan2(52), tan2(56)];
const EDGE_JITTER = 0.2; // share of tan² the edge noise moves the slope thresholds by
// How much of bot-slope ground (27-54°) shows the slope material: COVER_MIN just past 27° (the rest stays the
// ground material), all of it from ~38°. The cover noise moves that ramp by ±~4° along the contour, so slope bands
// on rolling ground vary in width and break up instead of drawing one even stripe per hillside.
const COVER_MIN = 0.35;
const COVER = [27, 38];
const COVER_SHIFT = 6; // degrees the cover noise (±~0.7) moves COVER by
const PATCH = 0.6; // how far the patch noise moves the lowland/highland split (share of highEnd - highStart)
const PATCH_FINE = 0.12; // the same for the fine edge noise (breaks up flat areas such as start positions)
// Cliffs face the camera, so away from the northern sun: they get ambient light only. Darker cliff albedo is lifted
// to this luminance (at most 1.8x) so its rock still reads in-game.
const CLIFF_LUMINANCE = 80;

// Per library class: splat channel (when the material is not one of the biome's 4 splats), detail-normal relief,
// specular intensity (0..1) and gloss (specularTex alpha: exponent / 16). Specular is a soft sheen (the engine
// caps the exponent at 16) that the bake modulates per texel by the albedo's brightness.
const CLASSES = {
  ground: { channel: 0, relief: 0.5, spec: 0.09, gloss: 0.5 },
  slope: { channel: 1, relief: 0.9, spec: 0.1, gloss: 0.5 },
  cliff: { channel: 2, relief: 1.4, spec: 0.13, gloss: 0.6 },
  shore: { channel: 3, relief: 0.5, spec: 0.22, gloss: 0.9 },
  special: { channel: 3, relief: 1.0, spec: 0.16, gloss: 0.75 },
};

export const smoothstep = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// Seeded noise fields in world elmos, the same for every map so a re-export bakes identical tiles.
const patchNoise = makeSimplex(101), toneNoise = makeSimplex(202), wobbleNoise = makeSimplex(303), swapNoise = makeSimplex(404);
const edgeNoise = makeSimplex(505), coverNoise = makeSimplex(606), mesoNoise = makeSimplex(707);
const accentNoise = [makeSimplex(808), makeSimplex(909)];
/** Lowland/highland patches, ~-0.7..0.7. */
export const patchAt = (x, z) => fbm(patchNoise, x / 900, z / 900, 3, 2, 0.5);
/** Broad brightness variation, ~-0.7..0.7. */
export const toneAt = (x, z) => fbm(toneNoise, x / 2200, z / 2200, 5, 2, 0.6);
/** Height offset (elmos) that bends the topolines. */
export const wobbleAt = (x, z) => 5 * fbm(wobbleNoise, x / 180, z / 180, 2, 2, 0.5);
/** Fine (~60 elmo) noise, ~-0.7..0.7, that frays material edges. */
export const edgeAt = (x, z) => fbm(edgeNoise, x / 64, z / 64, 2, 2, 0.5);
/** 0..1: how much of a material shows as its second, transposed copy (breaks up visible tiling). */
export const swapAt = (x, z) => smoothstep(-0.12, 0.12, fbm(swapNoise, x / 260, z / 260, 2, 2, 0.5));
/** ~-0.7..0.7 at ~250 elmos: moves where bot-slope ground turns into the slope material (see COVER). */
export const coverAt = (x, z) => fbm(coverNoise, x / 250, z / 250, 2, 2, 0.5);
/** Meso brightness variation at ~100 elmos, ~-0.7..0.7: breaks up broad flats between the broad tone and the grain. */
export const mesoAt = (x, z) => fbm(mesoNoise, x / 100, z / 100, 3, 2, 0.55);

// Value of accent noise n that a share `cover` of the world lies above (sampled once per accent noise and scale).
const accentLevels = new Map();
function accentLevel(n, scale, cover) {
  const key = `${n}:${scale}`;
  if (!accentLevels.has(key)) {
    const values = new Float32Array(160 * 160);
    for (let i = 0; i < values.length; i++) values[i] = fbm(accentNoise[n], ((i % 160) * 97) / scale, (Math.floor(i / 160) * 97) / scale, 3, 2, 0.55);
    accentLevels.set(key, values.sort());
  }
  const values = accentLevels.get(key);
  return values[Math.min(values.length - 1, Math.floor((1 - cover) * values.length))];
}

/**
 * Weight 0..1 of the biome's accent n (biome.accents[n]) at world (x, z): organic patches covering about
 * `cover` of the map, edges frayed by the edge noise (the bake sharpens them along the material's grain).
 */
export function accentAt(accent, n, x, z, edge) {
  const level = accentLevel(n, accent.scale, accent.cover);
  return smoothstep(level - 0.05, level + 0.05, fbm(accentNoise[n], x / accent.scale, z / accent.scale, 3, 2, 0.55) + 0.12 * edge);
}

/**
 * @typedef {Object} Slot  one library material the bake can use
 * @property {string} id
 * @property {number[]} avgColor  times gain
 * @property {number} gain  brightness applied to the albedo (cliff lift)
 * @property {number} channel  splat channel 0..3 (splatDistrTex RGBA)
 * @property {number} relief  detail-normal strength
 * @property {number} spec
 * @property {number} gloss
 * @property {boolean} grass  grows engine grass
 */
/**
 * @typedef {Object} Look
 * @property {import('./biomes.js').Biome} biome
 * @property {Slot[]} slots  the biome's role materials first, then every other library material
 * @property {Int32Array} roleSlot  ROLES index -> slot
 * @property {Int32Array} accentSlot  biome.accents index -> slot
 * @property {Int32Array} paintSlot  paint id -> slot (index 0 unused)
 */

const looks = new Map();

/** The doc biome's materials as bake slots (cached per biome). */
export function lookOf(doc) {
  const key = doc.biome;
  if (looks.has(key)) return looks.get(key);
  const biome = biomeOf(doc);
  const ids = [...new Set([...ROLES.map((r) => biome.materials[r]), ...biome.accents.map((a) => a.id), ...MATERIALS.filter((m) => m.id).map((m) => m.id)])];
  const slots = ids.map((id) => {
    const m = libraryMaterial(id), cls = CLASSES[m.class];
    const splat = biome.splats.indexOf(id);
    const [r, g, b] = m.avgColor, luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const gain = m.class === 'cliff' ? Math.min(1.8, Math.max(1, CLIFF_LUMINANCE / luminance)) : 1;
    return { id, avgColor: m.avgColor.map((c) => c * gain), gain, channel: splat >= 0 ? splat : cls.channel, relief: cls.relief, spec: cls.spec, gloss: cls.gloss, grass: id.startsWith('grass') };
  });
  const slotOf = (id) => ids.indexOf(id);
  const look = {
    biome,
    slots,
    roleSlot: Int32Array.from(ROLES, (r) => slotOf(biome.materials[r])),
    accentSlot: Int32Array.from(biome.accents, (a) => slotOf(a.id)),
    paintSlot: Int32Array.from({ length: MATERIALS.length + 1 }, (_, p) => (p ? slotOf(paintMaterialId(biome, p)) : -1)),
  };
  looks.set(key, look);
  return look;
}

/** Throws on a paint id that names no material, so a bad doc fails before the slow bake. */
export function checkPaint(doc) {
  let max = 0;
  for (const p of doc.paint) if (p > max) max = p;
  if (max > MATERIALS.length) throw new Error(`unknown paint material id ${max}`);
}

/** Index into ROLES of the roles that share flat ground (by height), in flatWeights order. */
export const FLAT_ROLES = [0, 1, 4, 5, 6];

/**
 * How flat ground (<= 27°) at height h splits into ground, high, sand, seabed and snow (sum 1), written to
 * out[0..4] in FLAT_ROLES order. Smooth in h, so the bake computes it per heightmap sample and interpolates.
 * @param {number} patch  patchAt() at this point
 * @param {number} edge  edgeAt() at this point
 */
export function flatWeights(biome, h, patch, edge, out) {
  const split = (h - biome.highStart) / (biome.highEnd - biome.highStart) + PATCH * patch + PATCH_FINE * edge;
  const high = smoothstep(0, 1, split);
  const sand = h < biome.sandTop ? 1 - smoothstep(biome.sandTop / 2, biome.sandTop, h) : 0;
  const seabed = h < 0 ? smoothstep(0, 24, -h) : 0;
  const snow = smoothstep(biome.snowLine - 25, biome.snowLine + 25, h);
  const keep = (1 - seabed) * (1 - snow); // each later layer covers the ones before it
  out[0] = (1 - high) * (1 - sand) * keep;
  out[1] = high * (1 - sand) * keep;
  out[2] = sand * keep;
  out[3] = seabed * (1 - snow);
  out[4] = snow;
}

/** Share of bot slope or cliff (steep) and of cliff alone at squared gradient g2: [steep, cliff] in out. */
export function steepWeights(g2, edge, out) {
  const g2e = g2 * (1 + EDGE_JITTER * edge);
  out[0] = smoothstep(STEEP[0], STEEP[1], g2e); // 1 wherever cliff > 0
  out[1] = smoothstep(CLIFF[0], CLIFF[1], g2e);
}

/**
 * The squared-gradient range over which bot-slope ground turns from COVER_MIN to all slope material, written to
 * out[0..1]. Smooth in position, so the bake computes it per heightmap sample and interpolates.
 * @param {number} cover  coverAt() at this point
 */
export function coverRange(cover, out) {
  const shift = COVER_SHIFT * cover;
  out[0] = tan2(COVER[0] + shift);
  out[1] = tan2(COVER[1] + shift);
}

/** Share 0..1 of bot-slope ground (27-54°) at squared gradient g2 that shows the slope material. */
export const slopeCover = (g2, lo, hi) => COVER_MIN + (1 - COVER_MIN) * smoothstep(lo, hi, g2);
const coverScratch = new Float32Array(2);

const flatScratch = new Float32Array(5), steepScratch = new Float32Array(2);

/** Role weights (sum 1) at height h (elmos) with squared gradient g2, written to out (ROLES order). */
export function roleWeights(biome, h, g2, patch, edge, cover, out) {
  flatWeights(biome, h, patch, edge, flatScratch);
  steepWeights(g2, edge, steepScratch);
  coverRange(cover, coverScratch);
  const [steep, cliff] = steepScratch, slope = (steep - cliff) * slopeCover(g2, coverScratch[0], coverScratch[1]);
  FLAT_ROLES.forEach((r, i) => { out[r] = (1 - cliff - slope) * flatScratch[i]; });
  out[2] = slope;
  out[3] = cliff;
}
