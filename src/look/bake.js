// Simple texture bake: colour from height, slope class and paint, with light hill-shading toward the doc's sun.
// shortcut: no detail noise or texture splats; Wave 2's texture stack replaces this file. Flat ground of one
// colour bakes to identical tiles, which the SMT tile dedupe stores once.
import { biomeOf, MATERIALS } from './biomes.js';

const BOT_SLOPE = 27; // degrees: steeper than this, vehicles cannot climb
const CLIFF_SLOPE = 54; // degrees: steeper than this, nothing climbs
const EDGE = 1; // degrees blended either side of a threshold; narrow so passability reads at a glance
const SHADING = 0.3; // share of hill-shading baked in (the engine lights the ground as well)
const GEO_RADIUS = 48; // elmos of scorched ground painted around a geothermal vent
const SQUARE = 8; // elmos between heightmap samples; one texel per elmo
const TILE = 32; // texels per SMT tile side
const DEG = 180 / Math.PI;
const VENT_GLOW = [150, 60, 20];
const VENT_SCORCH = [24, 20, 18];
const LAVA = [255, 96, 16];
const VOID = [12, 12, 16];

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function mix(out, color, w) {
  out[0] += (color[0] - out[0]) * w;
  out[1] += (color[1] - out[1]) * w;
  out[2] += (color[2] - out[2]) * w;
}

function materialColor(biome, id) {
  const material = MATERIALS[id - 1];
  if (!material) throw new Error(`unknown paint material id ${id}`);
  return biome[material.key];
}

// Unpainted ground colour at height h (elmos) and slope (degrees), written to out.
function groundColor(biome, h, slope, out) {
  const t = smoothstep(biome.highStart, biome.highEnd, h);
  for (let c = 0; c < 3; c++) out[c] = biome.ground[c] + (biome.high[c] - biome.ground[c]) * t;
  if (h < biome.sandTop) mix(out, biome.sand, 1 - smoothstep(biome.sandTop / 2, biome.sandTop, h));
  if (h < 0) mix(out, biome.seabed, smoothstep(0, -24, h));
  const cliff = smoothstep(CLIFF_SLOPE - EDGE, CLIFF_SLOPE + EDGE, slope);
  mix(out, biome.snow, smoothstep(biome.snowLine - 25, biome.snowLine + 25, h) * (1 - cliff));
  mix(out, biome.slope, smoothstep(BOT_SLOPE - EDGE, BOT_SLOPE + EDGE, slope));
  mix(out, biome.cliff, cliff);
}

function unitSun(doc) {
  const [x, y, z] = doc.settings.sunDir;
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

// Brightness of ground with gradient (gx, gz) relative to flat ground, softened to SHADING.
function shade(sun, gx, gz) {
  const lambert = Math.max(0, (-gx * sun[0] + sun[1] - gz * sun[2]) / Math.sqrt(gx * gx + 1 + gz * gz));
  return 1 + (lambert / sun[1] - 1) * SHADING;
}

// Height gradient (elmos per elmo) at heightmap sample (i, j), one-sided at the map edges.
function gradient(doc, i, j) {
  const { W, H, heights } = doc;
  const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, W - 1), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, H - 1);
  return [
    (heights[j * W + i1] - heights[j * W + i0]) / ((i1 - i0) * SQUARE),
    (heights[j1 * W + i] - heights[j0 * W + i]) / ((j1 - j0) * SQUARE),
  ];
}

const slopeDegrees = (gx, gz) => Math.atan(Math.hypot(gx, gz)) * DEG;

/**
 * Colour of one SMT tile (32x32 texels at 1 texel per elmo), tile (tx, tz) counted from the north-west corner.
 * @returns {Uint8ClampedArray} 32*32 RGB texels, row-major
 */
export function bakeTile(doc, tx, tz) {
  const biome = biomeOf(doc);
  const sun = unitSun(doc);
  const { W } = doc;
  // The tile spans 4x4 heightmap cells: gather the 5x5 samples around it.
  const vh = new Float32Array(25), vgx = new Float32Array(25), vgz = new Float32Array(25);
  const vpaint = new Uint8Array(25), vweight = new Float32Array(25);
  for (let b = 0; b < 5; b++) {
    for (let a = 0; a < 5; a++) {
      const i = tx * 4 + a, j = tz * 4 + b, k = b * 5 + a;
      vh[k] = doc.heights[j * W + i];
      [vgx[k], vgz[k]] = gradient(doc, i, j);
      vpaint[k] = doc.paint[j * W + i];
      vweight[k] = vpaint[k] ? doc.paintWeight[j * W + i] / 255 : 0;
    }
  }
  const painted = vpaint.some((id) => id);
  const x0 = tx * TILE, z0 = tz * TILE;
  const geos = doc.objects.filter((o) => o.type === 'geo' && o.x > x0 - GEO_RADIUS && o.x < x0 + TILE + GEO_RADIUS
    && o.z > z0 - GEO_RADIUS && o.z < z0 + TILE + GEO_RADIUS);

  const out = new Uint8ClampedArray(TILE * TILE * 3);
  const c = [0, 0, 0];
  const corner = [0, 1, 5, 6]; // offsets of a cell's four samples in the 5x5 grid
  const w = new Float32Array(4); // their bilinear weights
  for (let y = 0; y < TILE; y++) {
    const fz = (y + 0.5) / SQUARE, b = Math.floor(fz), v = fz - b;
    for (let x = 0; x < TILE; x++) {
      const fx = (x + 0.5) / SQUARE, a = Math.floor(fx), u = fx - a, k = b * 5 + a;
      w[0] = (1 - u) * (1 - v); w[1] = u * (1 - v); w[2] = (1 - u) * v; w[3] = u * v;
      let h = 0, gx = 0, gz = 0;
      for (let n = 0; n < 4; n++) {
        h += vh[k + corner[n]] * w[n];
        gx += vgx[k + corner[n]] * w[n];
        gz += vgz[k + corner[n]] * w[n];
      }
      groundColor(biome, h, slopeDegrees(gx, gz), c);
      if (painted) {
        for (let n = 0; n < 4; n++) {
          const id = vpaint[k + corner[n]];
          if (id) mix(c, materialColor(biome, id), vweight[k + corner[n]] * w[n]);
        }
      }
      for (const geo of geos) {
        const d = Math.hypot(x0 + x + 0.5 - geo.x, z0 + y + 0.5 - geo.z) / GEO_RADIUS;
        if (d < 1) mix(c, d < 0.3 ? VENT_GLOW : VENT_SCORCH, 0.8 * (1 - d * d));
      }
      const m = shade(sun, gx, gz), o = (y * TILE + x) * 3;
      out[o] = c[0] * m;
      out[o + 1] = c[1] * m;
      out[o + 2] = c[2] * m;
    }
  }
  return out;
}

/**
 * Preview colour of heightmap sample (i, j) for the 2D view: the bake colour plus water, void water and lava.
 * @returns {[number, number, number]} 0..255
 */
export function previewColor(doc, i, j) {
  const biome = biomeOf(doc);
  const { settings } = doc;
  const k = j * doc.W + i;
  const h = doc.heights[k];
  const [gx, gz] = gradient(doc, i, j);
  const c = [0, 0, 0];
  groundColor(biome, h, slopeDegrees(gx, gz), c);
  if (doc.paint[k]) mix(c, materialColor(biome, doc.paint[k]), doc.paintWeight[k] / 255);
  const m = shade(unitSun(doc), gx, gz);
  for (let n = 0; n < 3; n++) c[n] *= m;
  if (settings.lava.enabled && h < settings.lava.level) mix(c, LAVA, 0.85);
  else if (h < 0 && settings.voidWater) mix(c, VOID, 0.85);
  else if (h < 0) mix(c, biome.water.base.map((v) => v * 255), Math.min(0.85, 0.35 + -h / 120));
  return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
}

/** 1024x1024 RGB minimap (row-major, north up), bilinear over previewColor. */
export function bakeMinimap(doc) {
  const { W, H } = doc;
  const vertex = new Uint8Array(W * H * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) vertex.set(previewColor(doc, i, j), (j * W + i) * 3);
  const size = 1024, out = new Uint8ClampedArray(size * size * 3);
  for (let y = 0; y < size; y++) {
    const gz = Math.min(((y + 0.5) / size) * (H - 1), H - 1.001), j = Math.floor(gz), v = gz - j;
    for (let x = 0; x < size; x++) {
      const gx = Math.min(((x + 0.5) / size) * (W - 1), W - 1.001), i = Math.floor(gx), u = gx - i;
      const p = (j * W + i) * 3, q = p + W * 3;
      for (let c = 0; c < 3; c++) {
        out[(y * size + x) * 3 + c] = (vertex[p + c] * (1 - u) + vertex[p + 3 + c] * u) * (1 - v)
          + (vertex[q + c] * (1 - u) + vertex[q + 3 + c] * u) * v;
      }
    }
  }
  return out;
}
