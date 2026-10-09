// G7: the automatable items of BAR's map checklist (https://www.beyondallreason.info/guide/map-checklist), judged on
// MapFacts read from an exported archive (map-facts.js) and, live, from the open MapDoc (docFacts). Pure: the
// renderer imports this file for the rules and the one-click fixes; only map-facts.js needs Node.
import { SQUARE, UNIT } from '../core/index.js';
import { buildMetalMap } from '../formats/metal.js';
import { blobSpan, findMetalSpots, metalBlobs } from '../import/metal-spots.js';
import { openGroundGrass } from '../look/grass.js';
import { flattenAround, union } from '../terrain/brush.js';
import { placeStartPositions } from '../terrain/place.js';

// BAR's T2 geothermal plants (armageo, corageo, legageo in the game's unitdefs): footprint 5 x 5 (80 elmos),
// maxslope 15 (Armada, the strictest), maxwaterdepth 5. The engine turns maxslope into maxHeightDif =
// 40 * tan(maxslope) and builds only where every footprint corner is within maxHeightDif of one build height:
// a corner height span of at most twice that (21.4 elmos).
export const GEO = { footprint: 80, maxSlope: 15, maxDepth: 5 };
GEO.maxSpan = 2 * 40 * Math.tan((GEO.maxSlope * Math.PI) / 180);

// Limits from the checklist page, or measured on the 19 installed BAR maps (tools/README.md, "Map checklist").
export const LIMITS = {
  units: 32,
  wind: 30,
  tidal: 25,
  sunElevation: [20, 65], // degrees; installed maps 25-54
  dnts: 1024, // px
  normalTexels: 1 / 4, // detail normal texels per elmo; installed maps 1/4-2
  specular: [22, 40], // mean 0..255: warn above the five reference maps' max (19.9), fail above every installed map (34.1)
  minimapLuma: [50, 200], // installed maps 57-143; our arctic exports ~185
  metalValue: [0.5, 6], // installed maps 1.6-4.5
  metalSpan: 2, // extractor radii a blob may span before an extractor cannot cover it (installed maps <= 1.5)
  fogStart: 0.2, // installed maps 0.25-1
  lighting: 1.8, // mean ground ambient + diffuse; installed maps <= 1.75
  startGap: 64, // elmos: closer starts are duplicates
};

const PASS = 'pass', WARN = 'warn', FAIL = 'fail';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (v, digits = 0) => v.toFixed(digits);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const mean3 = (c) => (c[0] + c[1] + c[2]) / 3;
const deg = (rad) => (rad * 180) / Math.PI;

/**
 * @typedef {Object} MapFacts  plain data; a field the source cannot know is left out and its check is skipped
 * @property {number} sx  map width in units
 * @property {number} sz  map height in units
 * @property {number} minWind
 * @property {number} maxWind
 * @property {number} tidal
 * @property {number[]} sunDir  normalized, y up, z < 0 = north
 * @property {{x: number, z: number}[]} starts  mapinfo teams in order
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

/** The facts the open doc decides by itself (the rest come from its last export), live as fixes change it. @returns {Partial<MapFacts>} */
export function docFacts(doc) {
  const s = doc.settings, metal = buildMetalMap(doc);
  return {
    sx: doc.sx,
    sz: doc.sz,
    minWind: s.minWind,
    maxWind: s.maxWind,
    tidal: s.tidalStrength,
    sunDir: normalize(s.sunDir),
    starts: doc.objects.filter((o) => o.type === 'start').map(({ x, z }) => ({ x, z })),
    metal: metalFacts(metal.data, metal.width, metal.height, { maxMetal: metal.maxMetal, extractorRadius: s.extractorRadius }, metal.values.length),
    geos: geoFacts(doc.heights, doc.W, doc.H, doc.objects.filter((o) => o.type === 'geo')),
    // grass on grassy materials comes out of the texture bake (the export's facts); grass on open ground is known here
    ...(s.openGrass ? { grass: share(openGroundGrass(doc)) } : {}),
  };
}

const share = (cells) => cells.reduce((n, c) => n + (c > 0), 0) / cells.length;

const near = (points, x, z) => points.some((p) => Math.hypot(p.x - x, p.z - z) < LIMITS.startGap);
const normalize = (v) => { const n = Math.hypot(...v) || 1; return v.map((c) => c / n); };

/**
 * @typedef {Object} ChecklistRow
 * @property {string} id
 * @property {string} label
 * @property {'pass'|'warn'|'fail'} status
 * @property {string} detail  plain text
 * @property {{label: string, apply: (doc) => ([number, number, number, number]|null)}} [fix]  an edit of the doc that
 *   makes the check pass; returns the changed grid rect (null: settings or objects only). Callers wrap it in History.
 */

// Each check: the facts it needs, and its verdict on them.
const CHECKS = [
  {
    id: 'size', label: 'Map size at most 32 × 32', needs: ['sx', 'sz'],
    judge: ({ sx, sz }) => (Math.max(sx, sz) > LIMITS.units
      ? [FAIL, `${sx} × ${sz} units: BAR does not accept maps larger than ${LIMITS.units} in either direction. Crop it in Map → Map size.`]
      : [PASS, `${sx} × ${sz} units.`]),
  },
  { id: 'starts', label: 'Start positions cover the players', needs: ['starts', 'sx', 'sz'], judge: judgeStarts },
  {
    id: 'wind', label: 'Wind between 0 and 30', needs: ['minWind', 'maxWind'],
    judge: ({ minWind, maxWind }) => (minWind < 0 || maxWind > LIMITS.wind || minWind > maxWind
      ? [FAIL, `Wind is ${minWind}–${maxWind}; BAR wants 0–${LIMITS.wind} with the minimum below the maximum.`, {
        label: `Clamp wind to 0–${LIMITS.wind}`,
        apply: (doc) => {
          const s = doc.settings;
          s.minWind = clamp(s.minWind, 0, LIMITS.wind);
          s.maxWind = clamp(s.maxWind, s.minWind, LIMITS.wind);
          return null;
        },
      }]
      : [PASS, `Wind ${minWind}–${maxWind}.`]),
  },
  {
    id: 'tidal', label: 'Tidal between 0 and 25', needs: ['tidal'],
    judge: ({ tidal }) => (tidal < 0 || tidal > LIMITS.tidal
      ? [FAIL, `Tidal strength is ${tidal}; BAR wants 0–${LIMITS.tidal}.`, {
        label: `Clamp tidal to 0–${LIMITS.tidal}`,
        apply: (doc) => { doc.settings.tidalStrength = clamp(doc.settings.tidalStrength, 0, LIMITS.tidal); return null; },
      }]
      : [PASS, `Tidal strength ${tidal}.`]),
  },
  { id: 'sun', label: 'Sun in the north, not too low or high', needs: ['sunDir'], judge: judgeSun },
  { id: 'splats', label: 'Splat detail textures at least 1024 px', needs: ['dnts'], judge: judgeSplats },
  { id: 'normals', label: 'Detail normal map', needs: ['normalTex', 'sx'], judge: judgeNormals },
  {
    id: 'specular', label: 'Subtle specular', needs: ['specularMean'],
    judge: ({ specularMean: m }) => {
      if (m === null) return [PASS, 'No specular texture: the ground stays matte.'];
      const [warn, fail] = LIMITS.specular, text = `Mean specular ${fmt(m, 1)} of 255`;
      if (m > fail) return [FAIL, `${text}: much shinier than any installed BAR map (limit ${fail}). Darken the specular texture.`];
      if (m > warn) return [WARN, `${text}: shinier than the reference maps (up to 19.9). Consider darkening the specular texture.`];
      return [PASS, `${text} (limit ${warn}).`];
    },
  },
  {
    id: 'grass', label: 'Grass map used', needs: ['grass'],
    judge: ({ grass }) => (grass > 0
      ? [PASS, `Grass grows on ${fmt(grass * 100)}% of the map.`]
      : [WARN, 'No grass: BAR\'s checklist asks for a grass map (BAR tints the blades with the ground colour).', {
        label: 'Grow grass on open ground',
        apply: (doc) => { doc.settings.openGrass = true; return null; },
      }]),
  },
  {
    id: 'minimap', label: 'Minimap brightness', needs: ['minimapLuma'],
    judge: ({ minimapLuma: l }) => {
      const [lo, hi] = LIMITS.minimapLuma;
      if (l < lo) return [WARN, `The minimap is dark (mean ${fmt(l)} of 255, installed maps 57–143): lighten it slightly.`];
      if (l > hi) return [WARN, `The minimap is very bright (mean ${fmt(l)} of 255, installed maps 57–143).`];
      return [PASS, `Mean brightness ${fmt(l)} of 255.`];
    },
  },
  { id: 'metal', label: 'Metal spots sane', needs: ['metal'], judge: judgeMetal },
  { id: 'geos', label: 'Geos fit a T2 geothermal', needs: ['geos'], judge: judgeGeos },
  {
    id: 'features', label: 'Features follow the ground (no fixed Y)', needs: ['fixedY'],
    judge: ({ fixedY }) => (fixedY > 0
      ? [WARN, `${plural(fixedY, 'feature')} in mapconfig/featureplacer are stored with a fixed height (y): a placer that uses it leaves them floating or buried when the ground or water changes.`]
      : [PASS, 'Features are placed on the ground.']),
  },
  {
    id: 'fog', label: 'Fog', needs: ['fog'],
    judge: ({ fog: { start, end } }) => {
      if (start >= end) return [FAIL, `Fog starts at ${start} and ends at ${end}: it must start before it ends.`];
      if (start < LIMITS.fogStart) return [WARN, `Fog starts at ${fmt(start * 100)}% of the view distance: dense fog hides the map when zoomed out.`];
      return [PASS, `Fog from ${fmt(start * 100)}% to ${fmt(end * 100)}% of the view distance.`];
    },
  },
  {
    id: 'lighting', label: 'Ground lighting not fully bright', needs: ['light'],
    judge: ({ light }) => {
      const sum = mean3(light.ambient) + mean3(light.diffuse);
      return sum > LIMITS.lighting
        ? [WARN, `Ground ambient + diffuse is ${fmt(sum, 2)}: BAR's checklist asks for slightly darkened map lighting (installed maps up to 1.75).`]
        : [PASS, `Ground ambient + diffuse ${fmt(sum, 2)}.`];
    },
  },
];

// mapinfo teams{} lists one start position per player: the map plays with as many players as it has starts.
function judgeStarts({ starts, sx, sz }) {
  const off = starts.filter(({ x, z }) => x < 0 || z < 0 || x > sx * UNIT || z > sz * UNIT).length;
  const dupes = starts.filter((p, i) => near(starts.slice(0, i), p.x, p.z)).length;
  if (starts.length < 2) {
    return [FAIL, `${plural(starts.length, 'start position')}: teams{} needs one per player, at least 2.`, {
      label: 'Place starts for 2 players',
      apply: (doc) => { placeStartPositions(doc, 2); return null; },
    }];
  }
  if (off) return [FAIL, `${plural(off, 'start position')} outside the map.`];
  if (dupes) return [FAIL, `${plural(dupes, 'start position')} on top of another one: teams{} counts them as separate players.`];
  return [PASS, `${plural(starts.length, 'start position')}: teams{} covers ${starts.length} players.`];
}

function judgeSun({ sunDir: [x, y, z] }) {
  const elevation = deg(Math.asin(clamp(y, -1, 1))), [lo, hi] = LIMITS.sunElevation;
  const fix = {
    label: 'Put the sun in the north',
    apply: (doc) => { doc.settings.sunDir = northernSun(doc.settings.sunDir); return null; },
  };
  if (!(z < 0)) return [FAIL, `The sun shines from the ${z > 0 ? 'south' : 'side'}: BAR wants it in the north (sunDir z < 0) so slopes facing the camera are lit.`, fix];
  if (elevation < lo || elevation > hi) {
    return [WARN, `The sun is ${fmt(elevation)}° high: ${lo}–${hi}° gives readable shadows (installed maps 25–54°).`, { ...fix, label: 'Set the sun 40° high' }];
  }
  return [PASS, `Sun ${fmt(elevation)}° high in the north.`];
}

/** The sun direction with its azimuth moved into the north (at least 30° from east/west) and its height kept in range. */
export function northernSun([x, y, z]) {
  const len = Math.hypot(x, y, z) || 1, h = Math.hypot(x, z);
  let ax = h ? x / h : 0, az = h ? z / h : -1;
  az = -Math.max(Math.abs(az), 0.5);
  ax = Math.sign(ax || 1) * Math.sqrt(1 - az * az);
  const [lo, hi] = LIMITS.sunElevation, e = deg(Math.asin(clamp(y / len, -1, 1)));
  const elevation = ((e < lo || e > hi ? 40 : e) * Math.PI) / 180;
  return [ax * Math.cos(elevation), Math.sin(elevation), az * Math.cos(elevation)].map((v) => Math.round(v * 1e4) / 1e4);
}

function judgeSplats({ dnts }) {
  if (!dnts.length) return [WARN, 'No splat detail textures (DNTS): the ground has no close-up detail.'];
  const missing = dnts.filter((d) => d.missing), small = dnts.filter((d) => d.width && Math.min(d.width, d.height) < LIMITS.dnts);
  if (missing.length) return [FAIL, `mapinfo names ${missing.map((d) => d.file).join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not in the archive.`];
  if (small.length) return [WARN, `${small.map((d) => `${d.file} (${d.width} px)`).join(', ')}: BAR's checklist asks for at least ${LIMITS.dnts} px.`];
  return [PASS, `${plural(dnts.length, 'splat texture')}, ${Math.min(...dnts.map((d) => d.width ?? Infinity))} px or more.`];
}

function judgeNormals({ normalTex, sx }) {
  if (!normalTex) return [WARN, 'No detail normal map: the ground lighting has no surface detail.'];
  if (normalTex.missing) return [FAIL, `mapinfo names ${normalTex.file}, which is not in the archive.`];
  const texels = normalTex.width / (sx * UNIT);
  if (texels < LIMITS.normalTexels) return [WARN, `${normalTex.width} × ${normalTex.height}: ${fmt(1 / texels)} elmos per texel; ideally 1 texel per elmo.`];
  return [PASS, `${normalTex.width} × ${normalTex.height} (${texels >= 1 ? fmt(texels) : `1/${fmt(1 / texels)}`} texel per elmo).`];
}

function judgeMetal({ metal }) {
  const { expected, found, maxSpan, extractorRadius: r, values } = metal;
  if (maxSpan > 6 * r) return [FAIL, `A metal blob spans ${maxSpan} elmos, more than 6 extractor radii (${6 * r}): BAR then treats the map as a metal map with no spots.`];
  if (found !== expected) return [FAIL, `BAR's spot finder finds ${found} of ${expected} metal spots: spots that touch merge into one. Move them apart.`];
  if (!expected) return [WARN, 'No metal spots in the metal map.'];
  const [lo, hi] = LIMITS.metalValue, odd = values.filter((v) => v < lo || v > hi);
  const range = `${fmt(Math.min(...values), 2)}–${fmt(Math.max(...values), 2)}`;
  if (maxSpan > LIMITS.metalSpan * r) return [WARN, `A metal spot spans ${maxSpan} elmos, wider than one extractor covers (radius ${r}): keep spots small with sharp edges.`];
  if (odd.length) return [WARN, `${plural(odd.length, 'spot')} outside ${lo}–${hi} metal (values ${range}).`];
  return [PASS, `${plural(found, 'spot')}, values ${range}.`];
}

function judgeGeos({ geos }) {
  if (!geos.length) return [PASS, 'No geothermal vents.'];
  const steep = geos.filter((g) => g.span > GEO.maxSpan), wet = geos.filter((g) => g.ground < -GEO.maxDepth);
  if (wet.length) return [FAIL, `${plural(wet.length, 'geo vent')} deeper than ${GEO.maxDepth} elmos under water: a T2 geothermal cannot be built there.`];
  if (steep.length) {
    const worst = Math.max(...steep.map((g) => g.span));
    return [FAIL, `${steep.length} of ${plural(geos.length, 'geo vent')}: the ground under the 5 × 5 T2 geothermal varies by up to ${fmt(worst)} elmos (limit ${fmt(GEO.maxSpan, 1)}).`, {
      label: 'Flatten geo pads',
      apply: (doc) => steep.reduce((rect, g) => union(rect, flattenAround(doc, Math.round(g.x / 16) * 16, Math.round(g.z / 16) * 16, 60, 60, -Infinity)), null),
    }];
  }
  return [PASS, `${plural(geos.length, 'geo vent')} on flat enough ground (≤ ${fmt(GEO.maxSpan, 1)} elmos across the footprint).`];
}

/**
 * The checklist over whatever facts are known; a check whose facts are missing is left out.
 * @param {Partial<MapFacts>} facts  e.g. {...await readMapFacts(archive), ...docFacts(doc)}
 * @returns {ChecklistRow[]}
 */
export function checklist(facts) {
  return CHECKS.filter((check) => check.needs.every((key) => facts[key] !== undefined)).map(({ id, label, judge }) => {
    const [status, detail, fix] = judge(facts);
    return { id, label, status, detail, ...(fix && status !== PASS ? { fix } : {}) };
  });
}
