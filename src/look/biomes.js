// Biomes: which library materials cover each terrain role, the 4 in-engine splat materials, and the matching sky,
// fog, light and water for mapinfo.lua (atmosphere colours are 0..1 as mapinfo.lua wants them).
// Every biome's sunDir points north (z < 0) so slopes facing the player's camera (south) are lit.
import { MATERIAL_LIBRARY } from './library-manifest.js';

/**
 * Terrain roles, in MapDoc.paint order (paint id = role index + 1). The bake picks them from slope and height:
 * ground/high (flat lowland/highland, <= 27°: vehicles), slope (27-54°: bots only), cliff (> 54°: impassable),
 * sand (shore band below sandTop), seabed (below 0), snow (above snowLine).
 */
export const ROLES = ['ground', 'high', 'slope', 'cliff', 'sand', 'seabed', 'snow'];

/**
 * @typedef {Object} Biome
 * @property {string} label
 * @property {Record<string, string>} materials  role -> library material id
 * @property {[string, string, string, string]} splats  in-engine detail materials: ground, slope, cliff, and a
 *   shore/snow/special one (splatDetailNormalTex1..4)
 * @property {number} highStart  elmos: ground turns into high between highStart and highEnd
 * @property {number} highEnd
 * @property {number} sandTop
 * @property {number} snowLine
 * @property {number[]} sky
 * @property {number[]} fog
 * @property {number[]} sunColor
 * @property {number[]} ambient
 * @property {number[]} diffuse
 * @property {{base: number[], min: number[], absorb: number[], surface: number[]}} water
 * @property {[number, number, number]} sunDir  default sun for new maps (y up, z < 0 = north)
 */

const roles = (ground, high, slope, cliff, sand, seabed, snow) => ({ ground, high, slope, cliff, sand, seabed, snow });

/** @type {Record<string, Biome>} */
export const BIOMES = {
  temperate: {
    label: 'Temperate',
    materials: roles('grass_lush', 'grass_patchy', 'dirt_rocky', 'granite', 'sand_wet', 'mud', 'snow'),
    splats: ['grass_lush', 'dirt_rocky', 'granite', 'sand_wet'],
    highStart: 120, highEnd: 380, sandTop: 14, snowLine: 900,
    sky: [0.55, 0.68, 0.85], fog: [0.62, 0.72, 0.85], sunColor: [1.0, 0.96, 0.88],
    ambient: [0.42, 0.45, 0.48], diffuse: [0.85, 0.82, 0.76],
    water: { base: [0.18, 0.32, 0.36], min: [0.02, 0.08, 0.1], absorb: [0.004, 0.0025, 0.0018], surface: [0.75, 0.85, 0.9] },
    sunDir: [0.35, 0.75, -0.55],
  },
  desert: {
    label: 'Desert',
    materials: roles('sand_yellow', 'sand_dunes', 'sandstone_layered', 'granite', 'sand_wet', 'dirt_dry', 'sand_dunes'),
    splats: ['sand_yellow', 'sandstone_layered', 'granite', 'sand_dunes'],
    highStart: 100, highEnd: 400, sandTop: 10, snowLine: 1200,
    sky: [0.78, 0.74, 0.62], fog: [0.86, 0.78, 0.62], sunColor: [1.0, 0.92, 0.78],
    ambient: [0.5, 0.45, 0.38], diffuse: [0.95, 0.85, 0.7],
    water: { base: [0.2, 0.34, 0.32], min: [0.05, 0.1, 0.1], absorb: [0.004, 0.003, 0.002], surface: [0.8, 0.85, 0.8] },
    sunDir: [0.3, 0.8, -0.5],
  },
  arctic: {
    label: 'Arctic',
    materials: roles('snow', 'snow', 'gravel_slate', 'ice_cliff', 'pebbles', 'pebbles', 'snow'),
    splats: ['snow', 'gravel_slate', 'ice_cliff', 'pebbles'],
    highStart: 80, highEnd: 300, sandTop: 8, snowLine: 450,
    sky: [0.7, 0.78, 0.88], fog: [0.82, 0.86, 0.92], sunColor: [0.95, 0.97, 1.0],
    ambient: [0.5, 0.53, 0.58], diffuse: [0.8, 0.82, 0.85],
    water: { base: [0.12, 0.22, 0.3], min: [0.02, 0.05, 0.08], absorb: [0.005, 0.003, 0.002], surface: [0.8, 0.88, 0.95] },
    sunDir: [0.4, 0.55, -0.73],
  },
  volcanic: {
    label: 'Volcanic / lava',
    materials: roles('ash', 'dirt_dark', 'dirt_rocky', 'basalt', 'dirt_dry', 'lava_rock', 'ash'),
    splats: ['ash', 'dirt_rocky', 'basalt', 'lava_rock'],
    highStart: 300, highEnd: 900, sandTop: 20, snowLine: 1400,
    sky: [0.36, 0.24, 0.2], fog: [0.42, 0.28, 0.22], sunColor: [1.0, 0.78, 0.55],
    ambient: [0.36, 0.3, 0.28], diffuse: [1.0, 0.82, 0.66],
    water: { base: [0.15, 0.18, 0.16], min: [0.04, 0.04, 0.04], absorb: [0.005, 0.004, 0.003], surface: [0.7, 0.7, 0.65] },
    sunDir: [0.45, 0.7, -0.55],
  },
  lunar: {
    label: 'Lunar',
    materials: roles('regolith', 'ash', 'gravel_slate', 'basalt', 'regolith', 'regolith', 'regolith'),
    splats: ['regolith', 'gravel_slate', 'basalt', 'ash'],
    highStart: 80, highEnd: 400, sandTop: 4, snowLine: 1200,
    sky: [0.05, 0.05, 0.08], fog: [0.1, 0.1, 0.12], sunColor: [1.0, 1.0, 1.0],
    ambient: [0.3, 0.3, 0.32], diffuse: [1.0, 1.0, 1.0],
    water: { base: [0.1, 0.1, 0.12], min: [0.02, 0.02, 0.03], absorb: [0.005, 0.005, 0.005], surface: [0.6, 0.6, 0.65] },
    sunDir: [0.5, 0.5, -0.7],
  },
  redPlanet: {
    label: 'Red planet',
    materials: roles('dust_red', 'dirt_dry', 'dirt_rocky', 'basalt', 'sand_yellow', 'mud', 'sand_dunes'),
    splats: ['dust_red', 'dirt_rocky', 'basalt', 'dirt_dry'],
    highStart: 100, highEnd: 380, sandTop: 8, snowLine: 1000,
    sky: [0.75, 0.55, 0.42], fog: [0.8, 0.58, 0.45], sunColor: [1.0, 0.9, 0.8],
    ambient: [0.48, 0.38, 0.34], diffuse: [0.95, 0.8, 0.7],
    water: { base: [0.25, 0.2, 0.18], min: [0.06, 0.04, 0.03], absorb: [0.004, 0.004, 0.003], surface: [0.8, 0.7, 0.65] },
    sunDir: [0.35, 0.7, -0.6],
  },
  tropical: {
    label: 'Tropical',
    materials: roles('grass_lush', 'grass_patchy', 'dirt_rocky', 'basalt', 'sand_yellow', 'sand_wet', 'dirt_dark'),
    splats: ['grass_lush', 'dirt_rocky', 'basalt', 'sand_yellow'],
    highStart: 150, highEnd: 450, sandTop: 18, snowLine: 1500,
    sky: [0.5, 0.72, 0.95], fog: [0.65, 0.8, 0.95], sunColor: [1.0, 0.97, 0.9],
    ambient: [0.45, 0.48, 0.5], diffuse: [0.9, 0.88, 0.82],
    water: { base: [0.1, 0.45, 0.5], min: [0.0, 0.12, 0.2], absorb: [0.003, 0.0015, 0.001], surface: [0.75, 0.92, 0.95] },
    sunDir: [0.3, 0.8, -0.5],
  },
};

const ROLE_LABELS = ['Lowland', 'Highland', 'Slope (bots only)', 'Cliff', 'Shore', 'Seabed', 'Snow line'];

/**
 * Paintable materials; MapDoc.paint holds index + 1 (0 = automatic). The first 7 are the biome's own role
 * materials (`role` set, so a map keeps its look when the biome changes), then every library material (`id`).
 * @type {{key: string, label: string, role?: string, id?: string}[]}
 */
export const MATERIALS = [
  ...ROLES.map((role, i) => ({ key: role, label: `${ROLE_LABELS[i]} (biome)`, role })),
  ...MATERIAL_LIBRARY.map((m) => ({ key: m.id, label: m.label, id: m.id })),
];

const LIBRARY = new Map(MATERIAL_LIBRARY.map((m) => [m.id, m]));

/** A library material by id; throws on an unknown id. */
export function libraryMaterial(id) {
  const material = LIBRARY.get(id);
  if (!material) throw new Error(`unknown library material "${id}"`);
  return material;
}

/** @returns {Biome} the doc's biome; throws on an unknown key. */
export function biomeOf(doc) {
  const biome = BIOMES[doc.biome];
  if (!biome) throw new Error(`unknown biome "${doc.biome}" (known: ${Object.keys(BIOMES).join(', ')})`);
  return biome;
}

/** Library material id that paint id `paint` (MATERIALS index + 1) stands for in `biome`; throws on an unknown id. */
export function paintMaterialId(biome, paint) {
  const entry = MATERIALS[paint - 1];
  if (!entry) throw new Error(`unknown paint material id ${paint}`);
  return entry.role ? biome.materials[entry.role] : entry.id;
}
