// An opened map's own texture for the editor views, from the 4x4 mip of each SMT tile: one DXT1 block per 32-elmo
// tile, so one texel per heightmap square. Pure, without Lua: the renderer imports this file directly.
import { decodeDxt1 } from '../formats/dxt.js';
import { BIOMES, MATERIALS } from '../look/biomes.js';

/**
 * @param {{tilesX: number, tilesZ: number, tileIndex: Int32Array, tileMips: Uint8Array}} original  doc.original
 * @returns {{width: number, height: number, rgba: Uint8ClampedArray}} tilesX*4 by tilesZ*4 texels;
 *   alpha 0 where a tile has no original texture (index -1), 255 elsewhere
 */
export function originalPreview({ tilesX, tilesZ, tileIndex, tileMips }) {
  const width = tilesX * 4, height = tilesZ * 4, blocks = new Uint8Array(tileIndex.length * 8);
  for (let n = 0; n < tileIndex.length; n++) {
    const t = tileIndex[n];
    if (t >= 0) for (let b = 0; b < 8; b++) blocks[n * 8 + b] = tileMips[t * 8 + b];
  }
  const rgba = decodeDxt1(blocks, width, height);
  for (let n = 0; n < tileIndex.length; n++) {
    const alpha = tileIndex[n] >= 0 ? 255 : 0, x0 = (n % tilesX) * 4, y0 = ((n - (n % tilesX)) / tilesX) * 4;
    for (let p = 0; p < 16; p++) rgba[((y0 + (p >> 2)) * width + x0 + (p & 3)) * 4 + 3] = alpha;
  }
  return { width, height, rgba };
}

// shortcut: the same lava, void-water and water tint as src/look previewColor, copied because src/look belongs to
// WP 2.2 during Wave 3; fold both into one helper when the waves are merged.
const LAVA = [255, 96, 16];
const VOID = [12, 12, 16];

function mix(rgb, color, w) {
  for (let c = 0; c < 3; c++) rgb[c] += (color[c] - rgb[c]) * w;
}

/**
 * Colour of heightmap sample (i, j) on an opened map: its own texture, with a painted material blended over it and
 * water or lava as the biome preview shows them.
 * @param {ReturnType<typeof originalPreview>} preview
 * @returns {number[] | null} [r, g, b] 0..255, or null where the map has no original texture
 */
export function originalColor(doc, preview, i, j) {
  const { width, height, rgba } = preview;
  const o = (Math.min(j, height - 1) * width + Math.min(i, width - 1)) * 4;
  if (!rgba[o + 3]) return null;
  const rgb = [rgba[o], rgba[o + 1], rgba[o + 2]], k = j * doc.W + i, id = doc.paint[k], h = doc.heights[k];
  const { lava, voidWater } = doc.settings, biome = BIOMES[doc.biome];
  if (id) mix(rgb, biome[MATERIALS[id - 1].key], doc.paintWeight[k] / 255);
  if (lava.enabled && h < lava.level) mix(rgb, LAVA, 0.85);
  else if (h < 0 && voidWater) mix(rgb, VOID, 0.85);
  else if (h < 0) mix(rgb, biome.water.base.map((v) => v * 255), Math.min(0.85, 0.35 + -h / 120));
  return rgb;
}

/** The biome whose lowland and highland colours are closest to the texture's average colour. */
export function closestBiome({ rgba }) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let o = 0; o < rgba.length; o += 4 * 7) { // every 7th texel is plenty for an average
    if (!rgba[o + 3]) continue;
    for (let c = 0; c < 3; c++) sum[c] += rgba[o + c];
    n++;
  }
  const mean = sum.map((v) => v / Math.max(1, n));
  const distance = ({ ground, high }) => mean.reduce((d, v, c) => d + (v - (ground[c] + high[c]) / 2) ** 2, 0);
  return Object.keys(BIOMES).reduce((best, key) => (distance(BIOMES[key]) < distance(BIOMES[best]) ? key : best));
}
