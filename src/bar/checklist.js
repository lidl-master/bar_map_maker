// G7: the automatable items of BAR's map checklist (https://www.beyondallreason.info/guide/map-checklist), judged on
// MapFacts read from an exported archive (map-facts.js) and, live, from the open MapDoc (docFacts). Pure: the
// renderer imports this file for the rules and the one-click fixes; only map-facts.js needs Node.
import { SQUARE } from '../core/index.js';
import { buildMetalMap } from '../formats/metal.js';
import { blobSpan, findMetalSpots, metalBlobs } from '../import/metal-spots.js';

// BAR's T2 geothermal plants (armageo, corageo, legageo in the game's unitdefs): footprint 5 x 5 (80 elmos),
// maxslope 15 (Armada, the strictest). The engine turns maxslope into maxHeightDif = 40 * tan(maxslope) and builds
// only where every footprint corner is within maxHeightDif of one build height: a corner span of at most twice that.
export const GEO = { footprint: 80, maxSlope: 15, maxDepth: 5 };
GEO.maxSpan = 2 * 40 * Math.tan((GEO.maxSlope * Math.PI) / 180);

/**
 * @typedef {Object} MapFacts  plain data; a field the source cannot know is undefined and its check is skipped
 * @property {number} sx  map width in units
 * @property {number} sz  map height in units
 * @property {number} minWind
 * @property {number} maxWind
 * @property {number} tidal
 * @property {number[]} sunDir  normalized, y up, z < 0 = north
 * @property {{x: number, z: number}[]} starts  mapinfo teams in order
 * @property {number} [startsImplied]  doc only: start positions the symmetry implies (every start's mirror images)
 * @property {{file: string, width: number|null, height: number|null, missing?: boolean}[]} dnts  splat detail textures
 * @property {{file: string, width: number|null, height: number|null, missing?: boolean}|null} normalTex  detailNormalTex
 * @property {number|null} specularMean  mean RGB of specularTex, 0..255; null without one
 * @property {number} grass  share of grass map cells with grass, 0..1
 * @property {number} minimapLuma  mean luma of the minimap, 0..255
 * @property {{start: number, end: number}} fog
 * @property {{ambient: number[], diffuse: number[]}} light  ground lighting colours
 * @property {MetalFacts} metal
 * @property {{x: number, z: number, span: number, ground: number}[]} geos  each vent's T2 geo footprint: corner
 *   height span and ground height (elmos)
 * @property {number} fixedY  features placed with a fixed height
 */

/**
 * @typedef {Object} MetalFacts
 * @property {number} expected  spots the map means to have (doc: metal objects; archive: metal blobs)
 * @property {number} found  spots BAR's spot finder finds
 * @property {number} maxSpan  largest blob side, elmos
 * @property {number} extractorRadius
 * @property {number[]} values  in-game value of each found spot
 * @property {number[]} pixels  pixel count of each blob
 */

/** @returns {MetalFacts} */
export function metalFacts(metal, width, height, { maxMetal, extractorRadius }, expected) {
  const blobs = metalBlobs(metal, width, height);
  const spots = findMetalSpots(metal, width, height, { maxMetal, extractorRadius });
  return {
    expected: expected ?? blobs.length,
    found: spots.length,
    maxSpan: Math.max(0, ...blobs.map(blobSpan)),
    extractorRadius,
    values: spots.map((s) => s.metal),
    pixels: blobs.map((b) => b.pixels),
  };
}

/** Each vent's T2 geo footprint (centred on the vent, snapped to the 16-elmo build grid) on a corner heightmap. */
export function geoFacts(heights, W, H, vents) {
  const half = GEO.footprint / 2 / SQUARE;
  return vents.map(({ x, z }) => {
    const ci = Math.round(x / 16) * 2, cj = Math.round(z / 16) * 2;
    let lo = Infinity, hi = -Infinity;
    for (let j = Math.max(0, cj - half); j <= Math.min(H - 1, cj + half); j++) {
      for (let i = Math.max(0, ci - half); i <= Math.min(W - 1, ci + half); i++) {
        const h = heights[j * W + i];
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    return { x, z, span: hi - lo, ground: heights[Math.min(H - 1, cj) * W + Math.min(W - 1, ci)] };
  });
}
