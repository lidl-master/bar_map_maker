// Terrain templates: noise-based landscapes plus hand-designed presets. Every template places
// exactly `players` start positions.
import { SQUARE, blendSymmetry, heightRange, symMode, worldSize } from '../core/index.js';
import { smoothAll } from './brush.js';
import { erode } from './erosion.js';
import { scatterFeatures } from './features.js';
import { fbm, makeSimplex, mulberry32, ridged, smoothstep } from './noise.js';
import { placeResources } from './place.js';
import { volcanoKing } from './volcano.js';

// Noise-template knobs (all overridable through generate's options):
// minHeight/maxHeight elmos (< 0 = water), water % of the map under water (needs minHeight < 0),
// featureSize elmos between hills, roughness 0..1, warp 0..2 (organic shapes), terraces (0 = off),
// edges 'none'|'sink'|'raise', erosion 0..1.5.
const BASE = { minHeight: 0, maxHeight: 400, water: 0, featureSize: 1500, roughness: 0.5, warp: 0, terraces: 0, edges: 'none', erosion: 0 };

const noiseTemplate = (id, label, description, params) => ({ id, label, description, params: { ...BASE, ...params }, build: (doc, g) => sculpt(doc, id, g) });

export const TEMPLATES = [
  noiseTemplate('flat', 'Flat', 'A nearly flat plain to sculpt from scratch.', { minHeight: 94, maxHeight: 106, roughness: 0 }),
  // Broad, low-octave and barely warped so most land stays vehicle-passable (<= 27°).
  noiseTemplate('hills', 'Rolling hills', 'Gentle hills with a few ponds.', { minHeight: -40, maxHeight: 350, water: 5, featureSize: 2400, roughness: 0.1, warp: 0.2, erosion: 0.1 }),
  noiseTemplate('mountains', 'Mountains', 'Ridged mountain ranges with eroded valleys.', { minHeight: -30, maxHeight: 700, water: 3, featureSize: 2200, roughness: 0.55, warp: 0.5, erosion: 0.5 }),
  noiseTemplate('mesas', 'Plateaus', 'Flat-topped plateaus separated by cliffs.', { maxHeight: 450, featureSize: 1600, roughness: 0.4, warp: 0.8, terraces: 4, erosion: 0.15 }),
  noiseTemplate('canyons', 'Canyons', 'A high plateau cut by winding canyons.', { minHeight: -20, maxHeight: 500, featureSize: 2500, roughness: 0.45, warp: 0.7, erosion: 0.3 }),
  noiseTemplate('islands', 'Islands', 'An archipelago in a sea that deepens towards the map edges.', { minHeight: -150, maxHeight: 300, water: 45, featureSize: 1800, warp: 0.6, edges: 'sink', erosion: 0.2 }),
  noiseTemplate('continents', 'Two shores', 'Two land masses facing each other across a sea channel.', { minHeight: -120, maxHeight: 350, water: 30, warp: 0.5, erosion: 0.25 }),
  noiseTemplate('craters', 'Craters', 'Moon-like ground pocked with craters.', { warp: 0.2 }),
  {
    id: 'volcano-koth', label: 'Volcano – King of the Hill', short: 'Volcano KotH', symmetry: 'mirrorX', build: volcanoKing,
    description: 'Kings hold a volcano peak; attackers climb from the south.',
    details: 'One-way uphill assault: attackers start in the southern lowlands, the kings hold a volcano summit in the north. '
      + 'Four cliff tiers with ever fewer, narrower ramps; two lava rivers split three lanes. Half the players are kings.',
  },
];

const FEATURE_DENSITY = 0.4; // trees and rocks every new map gets (the UI can rescatter at another density)

/**
 * Replace the terrain, resources and scattered features with a template.
 * @param {{players:number, seed?:number}} opts players 2..16; noise templates also take overrides of their params.
 */
export function generate(doc, templateId, { players, seed = 1, ...overrides }) {
  const t = TEMPLATES.find((t) => t.id === templateId);
  if (!t) throw new RangeError(`unknown template '${templateId}'`);
  doc.settings.lava.enabled = false;
  t.build(doc, { ...t.params, ...overrides, players, seed });
  scatterFeatures(doc, { density: FEATURE_DENSITY, seed });
}

// Style shape functions: (x, z) in feature-size units, (u, v) normalized map position -> raw value.
const field = (n, x, z) => fbm(n.main, x, z, n.oct, 2, n.gain) * 0.5 + 0.5;
const blob = (n, x, z, f) => fbm(n.aux, x * f, z * f, 3, 2, 0.5) * 0.5 + 0.5;
const SHAPES = {
  flat: field,
  hills: field,
  mesas: field,
  mountains: (n, x, z) => Math.pow(ridged(n.main, x * 0.8, z * 0.8, n.oct, 2, 0.5), 1.7) * 0.8 + blob(n, x, z, 0.4) * 0.25,
  canyons: (n, x, z) => 0.75 + 0.12 * fbm(n.aux, x, z, n.oct, 2, n.gain) - 0.6 * smoothstep(0.8, 0.97, 1 - Math.abs(fbm(n.main, x * 0.7, z * 0.7, 4, 2, 0.5))),
  islands: (n, x, z) => field(n, x, z) * 0.55 + blob(n, x, z, 0.35) * 0.65 - 0.2,
  continents: (n, x, z, u, v) => field(n, x, z) * 0.45 + smoothstep(0.08, 0.35, n.channel(u, v) + fbm(n.aux, x * 0.5, z * 0.5, 3, 2, 0.5) * 0.15) * 0.7,
  craters: (n, x, z) => field(n, x, z) * 0.4, // + stampCraters
};

// Distance (normalized) from the sea channel of the "two shores" template, along the symmetry line.
const CHANNEL = {
  mirrorZ: (u, v) => Math.abs(v - 0.5) * 2,
  diag: (u, v) => Math.abs(u - v) * 1.4,
  adiag: (u, v) => Math.abs(u + v - 1) * 1.4,
  rot180: (u, v) => Math.abs(u + v - 1) * 1.4,
};

const BLEND = 0.06; // half-width of the seam blend across symmetry axes (normalized)

function sculpt(doc, style, g) {
  const { W, H, heights: hh } = doc, n = W * H, [ww, wh] = worldSize(doc);
  const scale = Math.max(100, g.featureSize);
  const ns = {
    main: makeSimplex(g.seed), aux: makeSimplex(g.seed + 202), oct: 3 + Math.round(g.roughness * 4), gain: 0.35 + g.roughness * 0.25,
    channel: CHANNEL[doc.symmetry] ?? ((u) => Math.abs(u - 0.5) * 2),
  };
  const warpN = makeSimplex(g.seed + 101), shape = SHAPES[style], v = new Float32Array(n), depth = symMode(doc).depth;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const wx = i * SQUARE, wz = j * SQUARE;
    if (depth && depth(wx / ww, wz / wh) < -BLEND) continue; // mirrored part: the blend below overwrites it
    let x = wx / scale, z = wz / scale;
    if (g.warp > 0) {
      const qx = fbm(warpN, x * 0.6 + 3.1, z * 0.6 + 7.7, 3, 2, 0.5), qz = fbm(warpN, x * 0.6 - 5.3, z * 0.6 + 1.9, 3, 2, 0.5);
      x += qx * g.warp; z += qz * g.warp;
    }
    let val = shape(ns, x, z, wx / ww, wz / wh);
    if (g.edges !== 'none') {
      const m = smoothstep(0, 0.12, Math.min(wx, ww - wx, wz, wh - wz) / Math.max(ww, wh));
      val = g.edges === 'sink' ? val * (0.25 + 0.75 * m) - (1 - m) * 0.3 : val + (1 - m) * 0.6;
    }
    v[j * W + i] = val;
  }
  if (style === 'craters') stampCraters(doc, v, scale, g.seed);
  // Seamlessly symmetrise the raw field, then map values to elmos (water fills the lowest `water` %).
  blendSymmetry(doc, v, BLEND);
  let lo = Infinity, hi = -Infinity;
  for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
  const { minHeight: minH, maxHeight: maxH } = g, water = Math.min(0.95, Math.max(0, g.water / 100));
  const wet = water > 0 && minH < 0, sample = wet ? v.filter((_, k) => k % 7 === 0).sort() : null; // shortcut: sampled percentile
  const q = wet ? sample[Math.floor(water * (sample.length - 1))] : lo;
  const span = (a, b) => Math.max(1e-6, b - a);
  for (let k = 0; k < n; k++) {
    if (!wet) hh[k] = minH + (maxH - minH) * (v[k] - lo) / span(lo, hi);
    else hh[k] = v[k] < q ? minH * (1 - (v[k] - lo) / span(lo, q)) : maxH * (v[k] - q) / span(q, hi);
  }
  if (g.terraces > 0) terrace(doc, g.terraces, 0.8);
  if (g.erosion > 0) erode(doc, { amount: g.erosion, seed: g.seed + 9 });
  smoothAll(doc, 1);
  blendSymmetry(doc, hh, 0.015);
  if (minH >= 0) for (let k = 0; k < n; k++) if (hh[k] < minH) hh[k] = minH; // dry maps stay dry
  placeResources(doc, { players: g.players, seed: g.seed });
}

// Bowl-shaped craters with raised rims, added onto the raw field (values in field units).
function stampCraters(doc, v, scale, seed) {
  const { W, H } = doc, [ww, wh] = worldSize(doc), rnd = mulberry32(seed + 5);
  const count = Math.round(ww * wh / (scale * scale) * 2.5);
  for (let c = 0; c < count; c++) {
    const big = rnd() < 0.15, cx = rnd() * ww, cz = rnd() * wh, r = (big ? 0.5 + rnd() * 0.7 : 0.08 + rnd() * 0.3) * scale;
    const depth = r / scale * 0.5, reach = 1.6 * r / SQUARE;
    const i0 = Math.max(0, Math.floor(cx / SQUARE - reach)), i1 = Math.min(W - 1, Math.ceil(cx / SQUARE + reach));
    const j0 = Math.max(0, Math.floor(cz / SQUARE - reach)), j1 = Math.min(H - 1, Math.ceil(cz / SQUARE + reach));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dd = Math.hypot(i * SQUARE - cx, j * SQUARE - cz) / r;
      if (dd > 1.6) continue;
      v[j * W + i] += (dd < 1 ? -depth * (1 - dd * dd) * 0.9 : 0) + depth * 0.35 * Math.exp(-((dd - 1) ** 2) / 0.04);
    }
  }
}

// Quantise land heights into flat steps joined by steep cliffs (BAR-style plateaus); water is kept.
function terrace(doc, steps, sharpness) {
  const hh = doc.heights, [lo, hi] = heightRange(doc), base = Math.max(0, lo), span = hi - base, edge = 1 - sharpness;
  if (span <= 1) return;
  for (let k = 0; k < hh.length; k++) {
    if (hh[k] < 0) continue;
    const f = (hh[k] - base) / span * steps, fl = Math.floor(f);
    hh[k] = base + (fl + smoothstep(0.5 - edge / 2, 0.5 + edge / 2, f - fl)) / steps * span;
  }
}
