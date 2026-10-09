// Auto-texturing rules: which material covers the ground where, by slope, height and paint. Shared by the bake
// (per texel) and the 2D preview (per heightmap sample), so the editor shows what the export bakes.
import { fbm, makeSimplex } from '../terrain/noise.js';
import { biomeOf, libraryMaterial, MATERIALS, paintMaterialId, ROLES } from './biomes.js';

const tan2 = (degrees) => Math.tan((degrees * Math.PI) / 180) ** 2;
// Squared height gradient (tan² of the slope) around the passability limits, blended over ±1°: narrow, so
// vehicle ground (<= 27°), bot slopes (27-54°) and cliffs (> 54°) read at a glance.
const STEEP = [tan2(26), tan2(28)];
const CLIFF = [tan2(53), tan2(55)];
const PATCH = 0.6; // how far the patch noise moves the lowland/highland split (share of highEnd - highStart)
// Cliffs face the camera, so away from the northern sun: they get ambient light only. Darker cliff albedo is lifted
// to this luminance (at most 1.6x) so its texture still reads in-game.
const CLIFF_LUMINANCE = 72;

// Per library class: splat channel (when the material is not one of the biome's 4 splats), detail-normal relief,
// specular intensity (0..1) and gloss (specularTex alpha: exponent / 16).
const CLASSES = {
  ground: { channel: 0, relief: 0.5, spec: 0.05, gloss: 0.35 },
  slope: { channel: 1, relief: 0.9, spec: 0.06, gloss: 0.35 },
  cliff: { channel: 2, relief: 1.4, spec: 0.08, gloss: 0.45 },
  shore: { channel: 3, relief: 0.5, spec: 0.18, gloss: 0.85 },
  special: { channel: 3, relief: 1.0, spec: 0.14, gloss: 0.7 },
};

export const smoothstep = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// Seeded noise fields in world elmos, the same for every map so a re-export bakes identical tiles.
const patchNoise = makeSimplex(101), toneNoise = makeSimplex(202), wobbleNoise = makeSimplex(303), swapNoise = makeSimplex(404);
/** Lowland/highland patches, ~-0.7..0.7. */
export const patchAt = (x, z) => fbm(patchNoise, x / 900, z / 900, 3, 2, 0.5);
/** Broad brightness variation, ~-0.7..0.7. */
export const toneAt = (x, z) => fbm(toneNoise, x / 2200, z / 2200, 3, 2, 0.5);
/** Height offset (elmos) that bends the topolines. */
export const wobbleAt = (x, z) => 5 * fbm(wobbleNoise, x / 180, z / 180, 2, 2, 0.5);
/** 0..1: how much of a material shows as its second, transposed copy (breaks up visible tiling). */
export const swapAt = (x, z) => smoothstep(-0.12, 0.12, fbm(swapNoise, x / 260, z / 260, 2, 2, 0.5));

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
 * @property {Int32Array} paintSlot  paint id -> slot (index 0 unused)
 */

const looks = new Map();

/** The doc biome's materials as bake slots (cached per biome). */
export function lookOf(doc) {
  const key = doc.biome;
  if (looks.has(key)) return looks.get(key);
  const biome = biomeOf(doc);
  const ids = [...new Set([...ROLES.map((r) => biome.materials[r]), ...MATERIALS.filter((m) => m.id).map((m) => m.id)])];
  const slots = ids.map((id) => {
    const m = libraryMaterial(id), cls = CLASSES[m.class];
    const splat = biome.splats.indexOf(id);
    const [r, g, b] = m.avgColor, luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const gain = m.class === 'cliff' ? Math.min(1.6, Math.max(1, CLIFF_LUMINANCE / luminance)) : 1;
    return { id, avgColor: m.avgColor.map((c) => c * gain), gain, channel: splat >= 0 ? splat : cls.channel, relief: cls.relief, spec: cls.spec, gloss: cls.gloss, grass: id.startsWith('grass') };
  });
  const slotOf = (id) => ids.indexOf(id);
  const look = {
    biome,
    slots,
    roleSlot: Int32Array.from(ROLES, (r) => slotOf(biome.materials[r])),
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

/**
 * Role weights (sum 1) at height h (elmos) with squared gradient g2, written to out (ROLES order).
 * @param {number} patch  patchAt() at this point
 */
export function roleWeights(biome, h, g2, patch, out) {
  const cliff = smoothstep(CLIFF[0], CLIFF[1], g2), steep = smoothstep(STEEP[0], STEEP[1], g2);
  const flat = 1 - steep; // steep is 1 wherever cliff > 0
  const high = smoothstep(0, 1, (h - biome.highStart) / (biome.highEnd - biome.highStart) + PATCH * patch);
  const sand = h < biome.sandTop ? 1 - smoothstep(biome.sandTop / 2, biome.sandTop, h) : 0;
  const seabed = h < 0 ? smoothstep(0, 24, -h) : 0;
  const snow = smoothstep(biome.snowLine - 25, biome.snowLine + 25, h);
  const keep = flat * (1 - seabed) * (1 - snow); // each later layer covers the ones before it
  out[0] = (1 - high) * (1 - sand) * keep;
  out[1] = high * (1 - sand) * keep;
  out[2] = steep - cliff;
  out[3] = cliff;
  out[4] = sand * keep;
  out[5] = seabed * (1 - snow) * flat;
  out[6] = snow * flat;
}
