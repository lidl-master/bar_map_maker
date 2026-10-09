// Biome palettes: ground colours for the bake and preview, plus the matching sky, fog, light and water for mapinfo.lua.
// Ground colours are 0..255 RGB; atmosphere colours are 0..1 as mapinfo.lua wants them.
// Every biome's sunDir points north (z < 0) so slopes facing the player's camera (south) are lit.

/**
 * @typedef {Object} Biome
 * @property {string} label
 * @property {number[]} ground  flat lowland
 * @property {number[]} high    flat high ground, blended in between highStart and highEnd (elmos)
 * @property {number[]} slope   27-54 degrees: bots climb it, vehicles do not
 * @property {number[]} cliff   over 54 degrees: impassable
 * @property {number[]} sand    shore band below sandTop (elmos)
 * @property {number[]} seabed  below water level (0)
 * @property {number[]} snow    above snowLine (elmos)
 * @property {number} highStart
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

/** @type {Record<string, Biome>} */
export const BIOMES = {
  temperate: {
    label: 'Temperate',
    ground: [82, 112, 50], high: [112, 122, 66], slope: [138, 112, 76], cliff: [98, 94, 90],
    sand: [190, 174, 128], seabed: [92, 96, 76], snow: [234, 237, 241],
    highStart: 120, highEnd: 380, sandTop: 14, snowLine: 900,
    sky: [0.55, 0.68, 0.85], fog: [0.62, 0.72, 0.85], sunColor: [1.0, 0.96, 0.88],
    ambient: [0.42, 0.45, 0.48], diffuse: [0.85, 0.82, 0.76],
    water: { base: [0.18, 0.32, 0.36], min: [0.02, 0.08, 0.1], absorb: [0.004, 0.0025, 0.0018], surface: [0.75, 0.85, 0.9] },
    sunDir: [0.35, 0.75, -0.55],
  },
  desert: {
    label: 'Desert',
    ground: [198, 164, 112], high: [182, 140, 94], slope: [164, 116, 78], cliff: [120, 86, 64],
    sand: [216, 192, 144], seabed: [150, 122, 92], snow: [232, 214, 178],
    highStart: 100, highEnd: 400, sandTop: 10, snowLine: 1200,
    sky: [0.78, 0.74, 0.62], fog: [0.86, 0.78, 0.62], sunColor: [1.0, 0.92, 0.78],
    ambient: [0.5, 0.45, 0.38], diffuse: [0.95, 0.85, 0.7],
    water: { base: [0.2, 0.34, 0.32], min: [0.05, 0.1, 0.1], absorb: [0.004, 0.003, 0.002], surface: [0.8, 0.85, 0.8] },
    sunDir: [0.3, 0.8, -0.5],
  },
  arctic: {
    label: 'Arctic',
    ground: [214, 222, 230], high: [236, 240, 246], slope: [160, 168, 178], cliff: [88, 94, 104],
    sand: [160, 160, 152], seabed: [70, 82, 94], snow: [250, 251, 253],
    highStart: 80, highEnd: 300, sandTop: 8, snowLine: 450,
    sky: [0.7, 0.78, 0.88], fog: [0.82, 0.86, 0.92], sunColor: [0.95, 0.97, 1.0],
    ambient: [0.5, 0.53, 0.58], diffuse: [0.8, 0.82, 0.85],
    water: { base: [0.12, 0.22, 0.3], min: [0.02, 0.05, 0.08], absorb: [0.005, 0.003, 0.002], surface: [0.8, 0.88, 0.95] },
    sunDir: [0.4, 0.55, -0.73],
  },
  volcanic: {
    label: 'Volcanic / lava',
    ground: [74, 66, 60], high: [52, 47, 46], slope: [96, 70, 54], cliff: [40, 34, 34],
    sand: [72, 40, 28], seabed: [40, 36, 34], snow: [128, 120, 112],
    highStart: 300, highEnd: 900, sandTop: 20, snowLine: 1400,
    sky: [0.36, 0.24, 0.2], fog: [0.42, 0.28, 0.22], sunColor: [1.0, 0.78, 0.55],
    ambient: [0.36, 0.3, 0.28], diffuse: [1.0, 0.82, 0.66],
    water: { base: [0.15, 0.18, 0.16], min: [0.04, 0.04, 0.04], absorb: [0.005, 0.004, 0.003], surface: [0.7, 0.7, 0.65] },
    sunDir: [0.45, 0.7, -0.55],
  },
  lunar: {
    label: 'Lunar',
    ground: [126, 126, 124], high: [150, 150, 147], slope: [104, 102, 100], cliff: [72, 72, 72],
    sand: [110, 110, 108], seabed: [80, 80, 80], snow: [178, 178, 174],
    highStart: 80, highEnd: 400, sandTop: 4, snowLine: 1200,
    sky: [0.05, 0.05, 0.08], fog: [0.1, 0.1, 0.12], sunColor: [1.0, 1.0, 1.0],
    ambient: [0.3, 0.3, 0.32], diffuse: [1.0, 1.0, 1.0],
    water: { base: [0.1, 0.1, 0.12], min: [0.02, 0.02, 0.03], absorb: [0.005, 0.005, 0.005], surface: [0.6, 0.6, 0.65] },
    sunDir: [0.5, 0.5, -0.7],
  },
  redPlanet: {
    label: 'Red planet',
    ground: [158, 84, 50], high: [178, 104, 66], slope: [138, 72, 46], cliff: [96, 52, 38],
    sand: [190, 132, 92], seabed: [100, 56, 40], snow: [214, 186, 166],
    highStart: 100, highEnd: 380, sandTop: 8, snowLine: 1000,
    sky: [0.75, 0.55, 0.42], fog: [0.8, 0.58, 0.45], sunColor: [1.0, 0.9, 0.8],
    ambient: [0.48, 0.38, 0.34], diffuse: [0.95, 0.8, 0.7],
    water: { base: [0.25, 0.2, 0.18], min: [0.06, 0.04, 0.03], absorb: [0.004, 0.004, 0.003], surface: [0.8, 0.7, 0.65] },
    sunDir: [0.35, 0.7, -0.6],
  },
  tropical: {
    label: 'Tropical',
    ground: [64, 128, 50], high: [52, 104, 44], slope: [150, 120, 84], cliff: [104, 98, 86],
    sand: [228, 212, 164], seabed: [170, 160, 118], snow: [150, 140, 110],
    highStart: 150, highEnd: 450, sandTop: 18, snowLine: 1500,
    sky: [0.5, 0.72, 0.95], fog: [0.65, 0.8, 0.95], sunColor: [1.0, 0.97, 0.9],
    ambient: [0.45, 0.48, 0.5], diffuse: [0.9, 0.88, 0.82],
    water: { base: [0.1, 0.45, 0.5], min: [0.0, 0.12, 0.2], absorb: [0.003, 0.0015, 0.001], surface: [0.75, 0.92, 0.95] },
    sunDir: [0.3, 0.8, -0.5],
  },
};

/** Paintable materials: MapDoc.paint holds index + 1 (0 = automatic); each names a biome colour. */
export const MATERIALS = [
  { key: 'ground', label: 'Lowland' },
  { key: 'high', label: 'Highland' },
  { key: 'slope', label: 'Slope (bots only)' },
  { key: 'cliff', label: 'Cliff' },
  { key: 'sand', label: 'Sand' },
  { key: 'seabed', label: 'Seabed' },
  { key: 'snow', label: 'Snow' },
];

/** @returns {Biome} the doc's biome; throws on an unknown key. */
export function biomeOf(doc) {
  const biome = BIOMES[doc.biome];
  if (!biome) throw new Error(`unknown biome "${doc.biome}" (known: ${Object.keys(BIOMES).join(', ')})`);
  return biome;
}
