// The diffuse bake and the texture-stack layers that must agree with it (splat weights, specular, detail normals,
// grass, minimap), one horizontal strip of SMT tiles at a time. Pure: library albedo comes in as decoded pixels.
//
// Diffuse = library albedo tiled in world space (1 texel per elmo, aligned with the in-engine splat detail
// textures), blended by the rules.js role weights and paint, times broad tone variation, gentle shading from the
// northern sun and thin, wobbly topolines. Traversability reads from the materials themselves: vehicle ground,
// bot slope and cliff materials meet at 27° and 54° with a 2° blend.
import { lookOf, patchAt, roleWeights, smoothstep, swapAt, toneAt, wobbleAt } from './rules.js';

const SQUARE = 8; // elmos between heightmap samples
const TILE = 32; // texels (elmos) per SMT tile side
const SHADING = 0.3; // share of hill-shading baked in (the engine lights the ground as well)
const TONE = 0.1; // broad brightness variation
const TOPO_STEP = 40; // elmos of height between topolines
const TOPO_DARK = 0.12; // darkening at the centre of a topoline
const TOPO_RELIEF = 0.25; // slope of the topoline groove in the detail normals
const GEO_RADIUS = 48; // elmos of scorched ground around a geothermal vent
const GRASS_COVER = 0.6; // share of a 32-elmo grass cell that must be grassy ground
const GRASS_CLEAR = 64; // elmos kept clear of grass around metal spots, geos and start positions
const VENT_GLOW = [150, 60, 20];
const VENT_SCORCH = [24, 20, 18];
const LAVA = [255, 96, 16];
const VOID = [12, 12, 16];
const TABLE_STRIDE = 6; // r, g, b, d(lum)/dx, d(lum)/dz, lum - mean (lum 0..1)

/**
 * A library material's albedo resampled (box filter) to 1 texel per elmo over one repeat of tileElmos, with its
 * luminance gradient: the bake's lookup table.
 * @param {{width: number, height: number, data: Uint8Array}} albedo  RGB, square, seamless
 * @returns {Float32Array} tileElmos² entries of TABLE_STRIDE values
 */
export function materialTable(albedo, tileElmos) {
  const { width: size, data } = albedo, T = tileElmos, scale = size / T;
  const table = new Float32Array(T * T * TABLE_STRIDE), lum = new Float32Array(T * T);
  for (let ty = 0; ty < T; ty++) {
    const y0 = Math.floor(ty * scale), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * scale));
    for (let tx = 0; tx < T; tx++) {
      const x0 = Math.floor(tx * scale), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * scale));
      let r = 0, g = 0, b = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const s = (y * size + x) * 3;
          r += data[s]; g += data[s + 1]; b += data[s + 2];
        }
      }
      const n = (y1 - y0) * (x1 - x0), o = (ty * T + tx) * TABLE_STRIDE;
      table[o] = r / n; table[o + 1] = g / n; table[o + 2] = b / n;
      lum[ty * T + tx] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / n / 255;
    }
  }
  const mean = lum.reduce((sum, l) => sum + l, 0) / lum.length;
  for (let ty = 0; ty < T; ty++) {
    for (let tx = 0; tx < T; tx++) {
      const o = (ty * T + tx) * TABLE_STRIDE, at = (x, y) => lum[((y + T) % T) * T + ((x + T) % T)];
      table[o + 3] = (at(tx + 1, ty) - at(tx - 1, ty)) / 2;
      table[o + 4] = (at(tx, ty + 1) - at(tx, ty - 1)) / 2;
      table[o + 5] = at(tx, ty) - mean;
    }
  }
  return table;
}

/**
 * @typedef {Object} BakeLayers  elmos per texel of the stack layers (powers of two, at most 32)
 * @property {number} diffuse  1 = albedo detail; n > 1 = average material colours in flat n x n blocks
 * @property {number} splat
 * @property {number} spec
 * @property {number} normal
 */
/**
 * @param {import('../core/index.js').MapDoc} doc
 * @param {Map<string, Float32Array>} tables  materialTable() per library id the doc uses (bakeMaterials())
 * @param {BakeLayers} layers
 */
export function prepareBake(doc, tables, layers) {
  const look = lookOf(doc);
  return { doc, look, layers, sun: unitSun(doc), tables: look.slots.map((s) => tables.get(s.id) ?? null) };
}

/** Library ids the bake of `doc` reads: the biome's role materials and every painted material. */
export function bakeMaterials(doc) {
  const look = lookOf(doc), used = new Set(look.roleSlot);
  const painted = new Uint8Array(look.paintSlot.length);
  for (const p of doc.paint) painted[p] = 1;
  painted.forEach((on, p) => { if (on && p) used.add(look.paintSlot[p]); });
  return [...used].map((s) => look.slots[s].id);
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

// Per-sample inputs of heightmap rows j0 .. j0 + rows - 1; light = shading towards the sun times broad tone.
function sampleRows(doc, sun, j0, rows) {
  const { W } = doc, n = W * rows;
  const grid = { h: new Float32Array(n), gx: new Float32Array(n), gz: new Float32Array(n), patch: new Float32Array(n), light: new Float32Array(n), wobble: new Float32Array(n), swap: new Float32Array(n) };
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < W; i++) {
      const k = r * W + i, x = i * SQUARE, z = (j0 + r) * SQUARE;
      grid.h[k] = doc.heights[(j0 + r) * W + i];
      [grid.gx[k], grid.gz[k]] = gradient(doc, i, j0 + r);
      grid.patch[k] = patchAt(x, z);
      grid.light[k] = shade(sun, grid.gx[k], grid.gz[k]) * (1 + TONE * toneAt(x, z));
      grid.wobble[k] = wobbleAt(x, z);
      grid.swap[k] = swapAt(x, z);
    }
  }
  return grid;
}

/**
 * Bakes SMT tile rows tz0 .. tz0 + rows - 1 (the full map width). Layer images are row-major RGBA strips.
 * @returns {{rgb: Uint8Array, splat: Uint8Array, spec: Uint8Array, normal: Uint8Array, minimap: Uint8Array, grass: Uint8Array}}
 *   rgb: the diffuse, 1 texel per elmo (RGB); splat: weights of the 4 splats summing to 255; spec: RGB intensity,
 *   A gloss; normal: tangent-space detail normal (R +x, G +z, B up); minimap: RGB at 8 elmos per pixel;
 *   grass: one density per SMT tile (0 or 255)
 */
export function bakeStrip(ctx, tz0, rows) {
  const { doc, look, layers, sun, tables } = ctx, { W } = doc, { biome, slots, roleSlot, paintSlot } = look;
  const tilesX = doc.sx * 16, wE = tilesX * TILE, hE = rows * TILE, z0 = tz0 * TILE, j0 = tz0 * 4;
  const grid = sampleRows(doc, sun, j0, rows * 4 + 1);
  const paint = doc.paint.subarray(j0 * W, (j0 + rows * 4 + 1) * W), paintWeight = doc.paintWeight.subarray(j0 * W, (j0 + rows * 4 + 1) * W);
  for (const s of new Set([...roleSlot, ...paintSlot.filter((s, p) => p && paint.includes(p))])) {
    if (!tables[s]) throw new Error(`bake: no albedo for material "${slots[s].id}"`);
  }
  const [sS, pS, nS] = [layers.splat, layers.spec, layers.normal].map(Math.log2);
  const splatAcc = new Float32Array((wE >> sS) * (hE >> sS) * 4), specAcc = new Float32Array((wE >> pS) * (hE >> pS) * 2);
  const normalAcc = new Float32Array((wE >> nS) * (hE >> nS) * 2), grassAcc = new Float32Array(tilesX * rows);
  const rgb = new Uint8Array(wE * hE * 3);
  const sizes = Int32Array.from(tables, (t) => (t ? Math.round(Math.sqrt(t.length / TABLE_STRIDE)) : 0)); // tileElmos
  const channel = Int32Array.from(slots, (s) => s.channel);
  const relief = Float32Array.from(slots, (s) => s.relief), spec = Float32Array.from(slots, (s) => s.spec);
  const gloss = Float32Array.from(slots, (s) => s.gloss), grassy = Uint8Array.from(slots, (s) => s.grass);
  // Share preset (diffuse > 1): average material colours only (the splat detail textures add the grain in-engine).
  const detail = layers.diffuse === 1, avg = Float32Array.from(slots.flatMap((s) => s.avgColor));
  const rw = new Float32Array(7), sw = new Float32Array(11), ss = new Int32Array(11), corner = [0, 1, W, W + 1], cw = new Float32Array(4);
  // The sample fields interpolated to the current texel row (z); per texel only the x interpolation is left.
  const fields = [grid.h, grid.gx, grid.gz, grid.patch, grid.light, grid.wobble, grid.swap];
  const [H, GX, GZ, PATCH, LIGHT, WOB, SWAP] = fields.map(() => new Float32Array(W));
  // Table offsets: rowBase[s] for the current texel row plus column[s][x]; the second copy of each material is
  // transposed and shifted by half a repeat (row2 + column2).
  const rowBase = new Int32Array(slots.length), row2 = new Int32Array(slots.length);
  const column = Array.from(sizes, (T) => (T ? Int32Array.from({ length: wE }, (_, x) => (x % T) * TABLE_STRIDE) : null));
  const column2 = Array.from(sizes, (T) => (T ? Int32Array.from({ length: wE }, (_, x) => ((x + (T >> 1)) % T) * T * TABLE_STRIDE) : null));

  for (let y = 0; y < hE; y++) {
    const zW = z0 + y, fz = (y + 0.5) / SQUARE, b = fz | 0, v = fz - b;
    const sRow = (y >> sS) * (wE >> sS), pRow = (y >> pS) * (wE >> pS), nRow = (y >> nS) * (wE >> nS);
    const gRow = (y >> 5) * tilesX;
    for (let s = 0; s < slots.length; s++) {
      rowBase[s] = sizes[s] ? (zW % sizes[s]) * sizes[s] * TABLE_STRIDE : 0;
      row2[s] = sizes[s] ? ((zW + (sizes[s] >> 1)) % sizes[s]) * TABLE_STRIDE : 0;
    }
    [H, GX, GZ, PATCH, LIGHT, WOB, SWAP].forEach((row, f) => {
      const field = fields[f];
      for (let i = 0; i < W; i++) row[i] = field[b * W + i] * (1 - v) + field[(b + 1) * W + i] * v;
    });
    for (let x = 0; x < wE; x++) {
      const a = x >> 3, u = ((x & 7) + 0.5) / SQUARE, k = b * W + a;
      const h = H[a] + (H[a + 1] - H[a]) * u, gx = GX[a] + (GX[a + 1] - GX[a]) * u, gz = GZ[a] + (GZ[a + 1] - GZ[a]) * u;
      const g2 = gx * gx + gz * gz;
      roleWeights(biome, h, g2, PATCH[a] + (PATCH[a + 1] - PATCH[a]) * u, rw);
      let n = 0;
      for (let r = 0; r < 7; r++) if (rw[r] > 1e-3) { sw[n] = rw[r]; ss[n++] = roleSlot[r]; }
      if (paint[k] | paint[k + 1] | paint[k + W] | paint[k + W + 1]) {
        cw[0] = (1 - u) * (1 - v); cw[1] = u * (1 - v); cw[2] = (1 - u) * v; cw[3] = u * v;
        for (let c = 0; c < 4; c++) {
          const p = paint[k + corner[c]];
          if (!p) continue;
          const amount = (paintWeight[k + corner[c]] / 255) * cw[c];
          for (let i = 0; i < n; i++) sw[i] *= 1 - amount;
          sw[n] = amount; ss[n++] = paintSlot[p];
        }
      }

      let cr = 0, cg = 0, cb = 0, rx = 0, rz = 0, sp = 0, gl = 0, grass = 0;
      const swap = SWAP[a] + (SWAP[a + 1] - SWAP[a]) * u;
      const sPx = (sRow + (x >> sS)) * 4;
      for (let i = 0; i < n; i++) {
        const s = ss[i], w = sw[i], tab = tables[s], o = rowBase[s] + column[s][x];
        if (detail) {
          const o2 = row2[s] + column2[s][x], w1 = w * (1 - swap), w2 = w * swap;
          cr += w1 * tab[o] + w2 * tab[o2]; cg += w1 * tab[o + 1] + w2 * tab[o2 + 1]; cb += w1 * tab[o + 2] + w2 * tab[o2 + 2];
        } else { cr += w * avg[s * 3]; cg += w * avg[s * 3 + 1]; cb += w * avg[s * 3 + 2]; }
        rx += w * relief[s] * tab[o + 3]; rz += w * relief[s] * tab[o + 4];
        sp += w * spec[s] * (1 + 3 * tab[o + 5]); gl += w * gloss[s];
        splatAcc[sPx + channel[s]] += w;
        grass += grassy[s] * w;
      }

      // Topolines on gently sloping ground (~2-26°): thin dark lines every TOPO_STEP elmos of height, bent by
      // the wobble noise, plus a matching groove in the detail normals.
      let m = LIGHT[a] + (LIGHT[a + 1] - LIGHT[a]) * u;
      const slope = Math.sqrt(g2);
      if (slope > 0.03 && slope < 0.5) {
        const f = (h + WOB[a] + (WOB[a + 1] - WOB[a]) * u) / TOPO_STEP, d = f - Math.round(f), dist = (Math.abs(d) * TOPO_STEP) / slope;
        if (dist < 2.5) {
          const fade = smoothstep(0.03, 0.09, slope) * (1 - smoothstep(0.27, 0.5, slope));
          m *= 1 - TOPO_DARK * fade * (1 - smoothstep(0.3, 1.1, dist));
          const tilt = (TOPO_RELIEF * fade * Math.sign(d) * (1 - smoothstep(0, 2.5, dist))) / slope;
          rx += tilt * gx; rz += tilt * gz;
        }
      }
      const o = (y * wE + x) * 3;
      rgb[o] = Math.min(255, cr * m); rgb[o + 1] = Math.min(255, cg * m); rgb[o + 2] = Math.min(255, cb * m);
      const pPx = (pRow + (x >> pS)) * 2, nPx = (nRow + (x >> nS)) * 2;
      specAcc[pPx] += sp; specAcc[pPx + 1] += gl;
      normalAcc[nPx] += rx; normalAcc[nPx + 1] += rz;
      grassAcc[gRow + (x >> 5)] += grass;
    }
  }
  scorchGeoVents(doc, rgb, wE, z0, hE);
  if (layers.diffuse > 1) flattenBlocks(rgb, wE, hE, layers.diffuse);
  return {
    rgb,
    splat: splatBytes(splatAcc, layers.splat ** 2),
    spec: specBytes(specAcc, layers.spec ** 2),
    normal: normalBytes(normalAcc, layers.normal ** 2),
    minimap: boxDown(rgb, wE, hE, SQUARE),
    grass: grassBytes(doc, grassAcc, tz0, tilesX),
  };
}

function scorchGeoVents(doc, rgb, wE, z0, hE) {
  for (const geo of doc.objects) {
    if (geo.type !== 'geo' || geo.z < z0 - GEO_RADIUS || geo.z > z0 + hE + GEO_RADIUS) continue;
    const xa = Math.max(0, Math.floor(geo.x - GEO_RADIUS)), xb = Math.min(wE - 1, Math.ceil(geo.x + GEO_RADIUS));
    const ya = Math.max(0, Math.floor(geo.z - GEO_RADIUS - z0)), yb = Math.min(hE - 1, Math.ceil(geo.z + GEO_RADIUS - z0));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x + 0.5 - geo.x, z0 + y + 0.5 - geo.z) / GEO_RADIUS;
        if (d >= 1) continue;
        const color = d < 0.3 ? VENT_GLOW : VENT_SCORCH, w = 0.8 * (1 - d * d), o = (y * wE + x) * 3;
        for (let c = 0; c < 3; c++) rgb[o + c] += (color[c] - rgb[o + c]) * w;
      }
    }
  }
}

// Splat weights per pixel, rounded so the four always sum to exactly 255 (largest remainders get the rest).
function splatBytes(acc, texels) {
  const out = new Uint8Array(acc.length), frac = new Float32Array(4);
  for (let p = 0; p < acc.length; p += 4) {
    let total = 0;
    for (let c = 0; c < 4; c++) total += acc[p + c];
    let left = 255;
    for (let c = 0; c < 4; c++) {
      const v = (acc[p + c] / (total || texels)) * 255;
      out[p + c] = Math.floor(v);
      frac[c] = v - out[p + c];
      left -= out[p + c];
    }
    if (!total) { out[p] = 255; continue; }
    for (; left > 0; left--) {
      const c = frac.indexOf(Math.max(...frac));
      out[p + c]++;
      frac[c] = -1;
    }
  }
  return out;
}

function specBytes(acc, texels) {
  const out = new Uint8Array((acc.length / 2) * 4);
  for (let p = 0; p < acc.length / 2; p++) {
    const v = Math.max(0, Math.min(255, (acc[p * 2] / texels) * 255));
    out[p * 4] = v; out[p * 4 + 1] = v; out[p * 4 + 2] = v;
    out[p * 4 + 3] = (acc[p * 2 + 1] / texels) * 255;
  }
  return out;
}

function normalBytes(acc, texels) {
  const out = new Uint8Array((acc.length / 2) * 4);
  for (let p = 0; p < acc.length / 2; p++) {
    const nx = -acc[p * 2] / texels, nz = -acc[p * 2 + 1] / texels, len = Math.sqrt(nx * nx + nz * nz + 1);
    out[p * 4] = (nx / len) * 127.5 + 127.5;
    out[p * 4 + 1] = (nz / len) * 127.5 + 127.5;
    out[p * 4 + 2] = (1 / len) * 127.5 + 127.5;
    out[p * 4 + 3] = 255;
  }
  return out;
}

// Every f x f block of the diffuse to its average colour, so DXT1 stores flat blocks (Share preset).
function flattenBlocks(rgb, w, h, f) {
  const small = boxDown(rgb, w, h, f), sw = w / f;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.set(small.subarray(((y / f | 0) * sw + (x / f | 0)) * 3, ((y / f | 0) * sw + (x / f | 0)) * 3 + 3), (y * w + x) * 3);
}

// Box-filtered RGB, factor f smaller in each direction.
function boxDown(rgb, w, h, f) {
  const ow = w / f, oh = h / f, out = new Uint8Array(ow * oh * 3);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) sum += rgb[((y * f + j) * w + x * f + i) * 3 + c];
        out[(y * ow + x) * 3 + c] = sum / (f * f);
      }
    }
  }
  return out;
}

// Grass (SMF vegetation map, one value per SMT tile) where most of the tile is grassy ground, clear of metal
// spots, geos and start positions.
function grassBytes(doc, acc, tz0, tilesX) {
  const out = new Uint8Array(acc.length);
  for (let t = 0; t < acc.length; t++) out[t] = acc[t] / (TILE * TILE) > GRASS_COVER ? 255 : 0;
  for (const o of doc.objects) {
    if (o.type === 'feature') continue;
    const r = GRASS_CLEAR / TILE;
    for (let tz = Math.floor(o.z / TILE - r); tz <= Math.floor(o.z / TILE + r); tz++) {
      if (tz < tz0 || tz >= tz0 + acc.length / tilesX) continue;
      for (let tx = Math.max(0, Math.floor(o.x / TILE - r)); tx <= Math.min(tilesX - 1, Math.floor(o.x / TILE + r)); tx++) {
        out[(tz - tz0) * tilesX + tx] = 0;
      }
    }
  }
  return out;
}

function mix(out, color, w) {
  out[0] += (color[0] - out[0]) * w;
  out[1] += (color[1] - out[1]) * w;
  out[2] += (color[2] - out[2]) * w;
}

/**
 * Preview colour of heightmap sample (i, j) for the 2D view: the bake's materials (average colours), shading,
 * paint, plus water, void water and lava.
 * @returns {[number, number, number]} 0..255
 */
export function previewColor(doc, i, j) {
  const look = lookOf(doc), k = j * doc.W + i, h = doc.heights[k];
  const [gx, gz] = gradient(doc, i, j);
  const rw = new Float32Array(7);
  roleWeights(look.biome, h, gx * gx + gz * gz, patchAt(i * SQUARE, j * SQUARE), rw);
  const c = [0, 0, 0];
  rw.forEach((w, r) => {
    const avg = look.slots[look.roleSlot[r]].avgColor;
    for (let n = 0; n < 3; n++) c[n] += w * avg[n];
  });
  if (doc.paint[k]) {
    const slot = look.slots[look.paintSlot[doc.paint[k]]];
    if (!slot) throw new Error(`unknown paint material id ${doc.paint[k]}`);
    mix(c, slot.avgColor, doc.paintWeight[k] / 255);
  }
  const m = shade(unitSun(doc), gx, gz);
  for (let n = 0; n < 3; n++) c[n] *= m;
  waterTint(doc, h, c);
  return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
}

function waterTint(doc, h, c) {
  const { settings } = doc;
  if (settings.lava.enabled && h < settings.lava.level) mix(c, LAVA, 0.85);
  else if (h < 0 && settings.voidWater) mix(c, VOID, 0.85);
  else if (h < 0) mix(c, lookOf(doc).biome.water.base.map((v) => v * 255), Math.min(0.85, 0.35 + -h / 120));
}

/**
 * The 1024x1024 RGB minimap (north up) from the bake at 8 elmos per pixel ((W-1) x (H-1) RGB): bilinear,
 * slightly lightened, with water, void water and lava drawn in.
 */
export function finishMinimap(doc, rgb8) {
  const w = doc.W - 1, h = doc.H - 1, size = 1024, out = new Uint8Array(size * size * 3), c = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    const fy = Math.min(Math.max((y + 0.5) * (h / size) - 0.5, 0), h - 1.001), j = Math.floor(fy), v = fy - j;
    for (let x = 0; x < size; x++) {
      const fx = Math.min(Math.max((x + 0.5) * (w / size) - 0.5, 0), w - 1.001), i = Math.floor(fx), u = fx - i;
      const p = (j * w + i) * 3, q = p + w * 3;
      for (let n = 0; n < 3; n++) {
        const lin = ((rgb8[p + n] * (1 - u) + rgb8[p + 3 + n] * u) * (1 - v) + (rgb8[q + n] * (1 - u) + rgb8[q + 3 + n] * u) * v) / 255;
        c[n] = 255 * lin ** 0.85; // lighten: the minimap is small and seen against a dark UI
      }
      const gx = (x + 0.5) * ((doc.W - 1) / size), gz = (y + 0.5) * ((doc.H - 1) / size);
      waterTint(doc, doc.heights[Math.round(gz) * doc.W + Math.round(gx)], c);
      out.set(c, (y * size + x) * 3);
    }
  }
  return out;
}
