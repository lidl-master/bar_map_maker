'use strict';
// Terrain texturing: palettes (colours + matching atmosphere/lighting), height/slope rules,
// hand-painted material overrides. Shared by the 2D preview, 3D preview and the exporter.
var BMM = window.BMM || (window.BMM = {});

(function () {
  const { clamp, smoothstep } = BMM.util;
  const N = BMM.Noise;

  // Paintable materials (paintId = index + 1; 0 = automatic).
  const MATERIALS = [
    { key: 'low', label: 'Lowland' },
    { key: 'high', label: 'Highland' },
    { key: 'rock', label: 'Rock / cliff' },
    { key: 'beach', label: 'Beach / sand' },
    { key: 'snow', label: 'Peak / snow' },
    { key: 'path', label: 'Path / dirt' },
    { key: 'seabed', label: 'Seabed' },
  ];

  const PALETTES = {
    temperate: {
      label: 'Temperate grassland',
      colors: { low: [82, 112, 50], high: [112, 122, 66], rock: [108, 102, 92], beach: [190, 174, 128], snow: [234, 237, 241], path: [126, 104, 76], seabed: [92, 96, 76] },
      rules: { highStart: 120, highEnd: 380, rockSlope: 30, beach: 14, snowLine: 700 },
      sky: [0.55, 0.68, 0.85], fog: [0.62, 0.72, 0.85], sun: [1.0, 0.96, 0.88],
      ambient: [0.42, 0.45, 0.48], diffuse: [0.85, 0.82, 0.76],
      water: { base: [0.18, 0.32, 0.36], min: [0.02, 0.08, 0.1], absorb: [0.004, 0.0025, 0.0018], surface: [0.75, 0.85, 0.9] },
    },
    desert: {
      label: 'Desert',
      colors: { low: [198, 164, 112], high: [182, 140, 94], rock: [146, 104, 74], beach: [216, 192, 144], snow: [232, 214, 178], path: [164, 124, 84], seabed: [150, 122, 92] },
      rules: { highStart: 100, highEnd: 400, rockSlope: 28, beach: 10, snowLine: 900 },
      sky: [0.78, 0.74, 0.62], fog: [0.86, 0.78, 0.62], sun: [1.0, 0.92, 0.78],
      ambient: [0.5, 0.45, 0.38], diffuse: [0.95, 0.85, 0.7],
      water: { base: [0.2, 0.34, 0.32], min: [0.05, 0.1, 0.1], absorb: [0.004, 0.003, 0.002], surface: [0.8, 0.85, 0.8] },
    },
    arctic: {
      label: 'Arctic / snow',
      colors: { low: [214, 222, 230], high: [236, 240, 246], rock: [92, 98, 108], beach: [160, 160, 152], snow: [250, 251, 253], path: [150, 150, 156], seabed: [70, 82, 94] },
      rules: { highStart: 80, highEnd: 300, rockSlope: 27, beach: 8, snowLine: 450 },
      sky: [0.7, 0.78, 0.88], fog: [0.82, 0.86, 0.92], sun: [0.95, 0.97, 1.0],
      ambient: [0.5, 0.53, 0.58], diffuse: [0.8, 0.82, 0.85],
      water: { base: [0.12, 0.22, 0.3], min: [0.02, 0.05, 0.08], absorb: [0.005, 0.003, 0.002], surface: [0.8, 0.88, 0.95] },
    },
    volcanic: {
      label: 'Volcanic / ash',
      colors: { low: [64, 58, 54], high: [44, 40, 40], rock: [78, 64, 58], beach: [36, 34, 34], snow: [124, 118, 112], path: [96, 74, 60], seabed: [40, 36, 34] },
      rules: { highStart: 100, highEnd: 350, rockSlope: 26, beach: 10, snowLine: 650 },
      sky: [0.42, 0.32, 0.3], fog: [0.45, 0.35, 0.32], sun: [1.0, 0.8, 0.62],
      ambient: [0.38, 0.33, 0.32], diffuse: [0.9, 0.75, 0.62],
      water: { base: [0.15, 0.18, 0.16], min: [0.04, 0.04, 0.04], absorb: [0.005, 0.004, 0.003], surface: [0.7, 0.7, 0.65] },
    },
    lava: {
      label: 'Volcano & lava',
      colors: { low: [74, 66, 60], high: [52, 47, 46], rock: [62, 52, 50], beach: [72, 34, 22], snow: [128, 120, 112], path: [104, 82, 64], seabed: [255, 104, 18] },
      rules: { highStart: 300, highEnd: 900, rockSlope: 27, beach: 26, snowLine: 1150 },
      sky: [0.36, 0.24, 0.2], fog: [0.42, 0.28, 0.22], sun: [1.0, 0.78, 0.55],
      ambient: [0.36, 0.3, 0.28], diffuse: [1.0, 0.82, 0.66],
      water: { base: [0.85, 0.3, 0.05], min: [0.5, 0.1, 0.0], absorb: [0.0, 0.0, 0.0], surface: [1.0, 0.6, 0.2] },
    },
    lunar: {
      label: 'Lunar / barren',
      colors: { low: [126, 126, 124], high: [150, 150, 147], rock: [94, 94, 94], beach: [110, 110, 108], snow: [178, 178, 174], path: [102, 100, 98], seabed: [80, 80, 80] },
      rules: { highStart: 80, highEnd: 400, rockSlope: 30, beach: 0, snowLine: 800 },
      sky: [0.05, 0.05, 0.08], fog: [0.1, 0.1, 0.12], sun: [1.0, 1.0, 1.0],
      ambient: [0.3, 0.3, 0.32], diffuse: [1.0, 1.0, 1.0],
      water: { base: [0.1, 0.1, 0.12], min: [0.02, 0.02, 0.03], absorb: [0.005, 0.005, 0.005], surface: [0.6, 0.6, 0.65] },
    },
    mars: {
      label: 'Red planet',
      colors: { low: [158, 84, 50], high: [178, 104, 66], rock: [118, 62, 42], beach: [190, 132, 92], snow: [214, 186, 166], path: [138, 72, 46], seabed: [100, 56, 40] },
      rules: { highStart: 100, highEnd: 380, rockSlope: 29, beach: 8, snowLine: 750 },
      sky: [0.75, 0.55, 0.42], fog: [0.8, 0.58, 0.45], sun: [1.0, 0.9, 0.8],
      ambient: [0.48, 0.38, 0.34], diffuse: [0.95, 0.8, 0.7],
      water: { base: [0.25, 0.2, 0.18], min: [0.06, 0.04, 0.03], absorb: [0.004, 0.004, 0.003], surface: [0.8, 0.7, 0.65] },
    },
    tropical: {
      label: 'Tropical islands',
      colors: { low: [64, 128, 50], high: [52, 104, 44], rock: [112, 104, 90], beach: [228, 212, 164], snow: [150, 140, 110], path: [150, 120, 84], seabed: [170, 160, 118] },
      rules: { highStart: 150, highEnd: 450, rockSlope: 31, beach: 18, snowLine: 1200 },
      sky: [0.5, 0.72, 0.95], fog: [0.65, 0.8, 0.95], sun: [1.0, 0.97, 0.9],
      ambient: [0.45, 0.48, 0.5], diffuse: [0.9, 0.88, 0.82],
      water: { base: [0.1, 0.45, 0.5], min: [0.0, 0.12, 0.2], absorb: [0.003, 0.0015, 0.001], surface: [0.75, 0.92, 0.95] },
    },
  };

  function defaultTextureSettings(paletteKey) {
    const p = PALETTES[paletteKey] || PALETTES.temperate;
    return {
      palette: paletteKey,
      colors: JSON.parse(JSON.stringify(p.colors)),
      rules: Object.assign({ jitter: 1.0 }, p.rules),
      detail: 0.12,        // fine per-texel noise strength
      variation: 0.12,     // large-scale colour variation
      bakeShading: 0.35,   // how much hill-shading is baked into the exported texture
      seed: 1234,
    };
  }

  // Cached per-vertex noise fields (large-scale variation and boundary jitter).
  function fields(map) {
    const tx = map.texture;
    const key = map.W + 'x' + map.H + ':' + tx.seed;
    if (map._fields && map._fields.key === key) return map._fields;
    const W = map.W, H = map.H;
    const vary = new Float32Array(W * H), jit = new Float32Array(W * H);
    const n1 = N.makeSimplex(tx.seed), n2 = N.makeSimplex(tx.seed + 77);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = i * 8, z = j * 8;
      vary[j * W + i] = N.fbm(n1, x / 900, z / 900, 3, 2, 0.5);
      jit[j * W + i] = N.fbm(n2, x / 90, z / 90, 3, 2.1, 0.55);
    }
    map._fields = { key, vary, jit };
    return map._fields;
  }

  // Core colour rule. Writes 0..255 floats to out[0..2].
  function ruleColor(out, tx, h, slope, jit, vary, pid, pw) {
    const C = tx.colors, R = tx.rules, J = R.jitter;
    const low = C.low, high = C.high;
    let t = smoothstep(R.highStart, R.highEnd, h + jit * 60 * J + vary * 80);
    let r = low[0] + (high[0] - low[0]) * t, g = low[1] + (high[1] - low[1]) * t, b = low[2] + (high[2] - low[2]) * t;
    let w;
    if (R.beach > 0) {
      w = 1 - smoothstep(R.beach * 0.5, R.beach * 1.6, h + jit * R.beach * 0.6 * J);
      if (w > 0) { const c = C.beach; r += (c[0] - r) * w; g += (c[1] - g) * w; b += (c[2] - b) * w; }
    }
    if (h < 0) {
      w = smoothstep(0, -Math.max(6, R.beach), h);
      const c = C.seabed; r += (c[0] - r) * w; g += (c[1] - g) * w; b += (c[2] - b) * w;
    }
    const wr = smoothstep(R.rockSlope - 5, R.rockSlope + 5, slope + jit * 5 * J);
    if (wr > 0) { const c = C.rock; r += (c[0] - r) * wr; g += (c[1] - g) * wr; b += (c[2] - b) * wr; }
    w = smoothstep(R.snowLine - 25, R.snowLine + 25, h + jit * 50 * J) * (1 - 0.75 * wr);
    if (w > 0) { const c = C.snow; r += (c[0] - r) * w; g += (c[1] - g) * w; b += (c[2] - b) * w; }
    if (pid > 0 && pw > 0) {
      const c = C[MATERIALS[pid - 1].key]; w = pw / 255;
      r += (c[0] - r) * w; g += (c[1] - g) * w; b += (c[2] - b) * w;
    }
    const v = 1 + vary * tx.variation;
    out[0] = r * v; out[1] = g * v; out[2] = b * v;
  }

  // Sun direction (normalised, y up) derived from the palette; used for preview and baking.
  function sunDir(tx) {
    const s = tx.sunDir || [0.45, 0.75, 0.35];
    const l = Math.hypot(s[0], s[1], s[2]);
    return [s[0] / l, s[1] / l, s[2] / l];
  }

  // Lambert shading factor relative to flat ground at grid vertex.
  function shadeAt(map, i, j, sun) {
    const nx = (map.h(i - 1, j) - map.h(i + 1, j)) / 16;
    const nz = (map.h(i, j - 1) - map.h(i, j + 1)) / 16;
    const l = Math.sqrt(nx * nx + 1 + nz * nz);
    const lam = Math.max(0, (nx * sun[0] + sun[1] + nz * sun[2]) / l);
    return lam / sun[1];
  }

  // Glowing lava (preview / minimap only - in game BAR draws its own animated lava plane).
  function lavaColor(out, x, z, depth) {
    const n = N.valueNoise(x / 60, z / 60, 91) * 0.6 + N.valueNoise(x / 14, z / 14, 92) * 0.4;
    const crust = Math.max(0, n - 0.62) * 2.6;
    const hot = Math.min(1, 0.55 + depth / 80);
    out[0] = 255 * (1 - crust * 0.7); out[1] = (70 + 110 * hot * n) * (1 - crust); out[2] = 10 + 30 * (1 - hot);
  }

  BMM.Texture = { MATERIALS, PALETTES, defaultTextureSettings, fields, ruleColor, sunDir, shadeAt, lavaColor };
})();
