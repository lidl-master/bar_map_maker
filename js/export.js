'use strict';
// Exporters: playable BAR map archive (.sdz with .smf/.smt written natively), source assets,
// mapinfo.lua generation. Format notes (RecoilEngine rts/Map/SMF/SMFFormat.h):
//  - SMF header 80 bytes; heightmap uint16[(mapx+1)*(mapy+1)], h = min + raw*(max-min)/65536
//  - typemap & metalmap uint8[mapx/2 * mapy/2]; minimap 1024^2 DXT1 + 8 mips = 699048 bytes
//  - tiles: {numTileFiles, numTiles} + per file {int count, cstring name} + int[mapx/4*mapy/4]
//  - SMT: 32-byte header, then 680-byte tiles (DXT1 mips 32/16/8/4)
//  - BAR metal spot value shown in game = sum(metal pixels) * maxMetal / 1000
var BMM = window.BMM || (window.BMM = {});

(function () {
  const { clamp } = BMM.util;
  const N = BMM.Noise;
  const T = BMM.Texture;
  const SQ = BMM.SQUARE;
  const tick = () => new Promise(r => setTimeout(r, 0));

  // ------------------------------------------------------------------ DXT1 (BC1)
  const pal = new Float32Array(12);
  function to565(r, g, b) {
    return ((clamp(Math.round(r * 31 / 255), 0, 31) << 11) | (clamp(Math.round(g * 63 / 255), 0, 63) << 5) | clamp(Math.round(b * 31 / 255), 0, 31));
  }
  function from565(c, out, o) {
    const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
    out[o] = (r << 3) | (r >> 2); out[o + 1] = (g << 2) | (g >> 4); out[o + 2] = (b << 3) | (b >> 2);
  }
  // px: Float32Array(48) RGB of a 4x4 block (row-major). Writes 8 bytes at out[o].
  function compressBlock(px, out, o) {
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < 48; i += 3) { mr += px[i]; mg += px[i + 1]; mb += px[i + 2]; }
    mr /= 16; mg /= 16; mb /= 16;
    let crr = 0, crg = 0, crb = 0, cgg = 0, cgb = 0, cbb = 0;
    for (let i = 0; i < 48; i += 3) {
      const r = px[i] - mr, g = px[i + 1] - mg, b = px[i + 2] - mb;
      crr += r * r; crg += r * g; crb += r * b; cgg += g * g; cgb += g * b; cbb += b * b;
    }
    // principal axis by power iteration
    let ax = 0.577, ay = 0.577, az = 0.577;
    for (let it = 0; it < 4; it++) {
      const nx = crr * ax + crg * ay + crb * az, ny = crg * ax + cgg * ay + cgb * az, nz = crb * ax + cgb * ay + cbb * az;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-6) break;
      ax = nx / l; ay = ny / l; az = nz / l;
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 48; i += 3) {
      const d = (px[i] - mr) * ax + (px[i + 1] - mg) * ay + (px[i + 2] - mb) * az;
      if (d < lo) lo = d; if (d > hi) hi = d;
    }
    // slight inset reduces quantisation error
    const inset = (hi - lo) / 32; lo += inset; hi -= inset;
    let c0 = to565(mr + ax * hi, mg + ay * hi, mb + az * hi);
    let c1 = to565(mr + ax * lo, mg + ay * lo, mb + az * lo);
    if (c0 < c1) { const t = c0; c0 = c1; c1 = t; }
    let idx = 0;
    if (c0 !== c1) {
      from565(c0, pal, 0); from565(c1, pal, 3);
      for (let c = 0; c < 3; c++) { pal[6 + c] = (2 * pal[c] + pal[3 + c]) / 3; pal[9 + c] = (pal[c] + 2 * pal[3 + c]) / 3; }
      for (let p = 15; p >= 0; p--) {
        const r = px[p * 3], g = px[p * 3 + 1], b = px[p * 3 + 2];
        let best = 0, bd = Infinity;
        for (let k = 0; k < 4; k++) {
          const dr = r - pal[k * 3], dg = g - pal[k * 3 + 1], db = b - pal[k * 3 + 2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; best = k; }
        }
        idx = (idx << 2) | best;
      }
    }
    out[o] = c0 & 255; out[o + 1] = c0 >> 8; out[o + 2] = c1 & 255; out[o + 3] = c1 >> 8;
    out[o + 4] = idx & 255; out[o + 5] = (idx >>> 8) & 255; out[o + 6] = (idx >>> 16) & 255; out[o + 7] = (idx >>> 24) & 255;
  }
  const blk = new Float32Array(48);
  // Compress an RGB float image (w x h, multiples of 4) into out at offset o. Returns bytes written.
  function compressImage(img, w, h, out, o) {
    const start = o;
    for (let by = 0; by < h; by += 4) for (let bx = 0; bx < w; bx += 4) {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const s = ((by + y) * w + bx + x) * 3, d = (y * 4 + x) * 3;
        blk[d] = img[s]; blk[d + 1] = img[s + 1]; blk[d + 2] = img[s + 2];
      }
      compressBlock(blk, out, o); o += 8;
    }
    return o - start;
  }
  function downsample(img, w, h) {
    const nw = w >> 1, nh = h >> 1, out = new Float32Array(nw * nh * 3);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      for (let c = 0; c < 3; c++) {
        const a = ((2 * y) * w + 2 * x) * 3 + c;
        out[(y * nw + x) * 3 + c] = (img[a] + img[a + 3] + img[a + w * 3] + img[a + w * 3 + 3]) * 0.25;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ texture sampling
  // Precompute per-vertex fields used by the per-texel colour function.
  function prepareFields(map) {
    const W = map.W, H = map.H, n = W * H;
    const slope = new Float32Array(n), shade = new Float32Array(n);
    const sun = T.sunDir(map.texture);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      slope[j * W + i] = map.slopeAt(i, j);
      shade[j * W + i] = T.shadeAt(map, i, j, sun);
    }
    const f = T.fields(map);
    const pwF = new Float32Array(n);
    for (let k = 0; k < n; k++) pwF[k] = map.paintW[k];
    const geos = map.objectsOf('geo').map(o => [o.x, o.z]);
    return { slope, shade, jit: f.jit, vary: f.vary, pwF, geos };
  }
  function bil(a, W, gx, gz, i, j) {
    const fx = gx - i, fz = gz - j, k = j * W + i;
    const p = a[k], q = a[k + 1], r = a[k + W], s = a[k + W + 1];
    return p + (q - p) * fx + (r - p) * fz + (p - q - r + s) * fx * fz;
  }
  const colTmp = [0, 0, 0];
  // Colour of one texel at world (x, z) in elmos. Writes RGB 0..255 into out[o..o+2].
  function texelColor(map, F, x, z, out, o, opts) {
    const W = map.W, H = map.H, tx = map.texture;
    const gx = Math.min(x / SQ, W - 1.001), gz = Math.min(z / SQ, H - 1.001);
    const i = gx | 0, j = gz | 0;
    const h = bil(map.heights, W, gx, gz, i, j);
    const slope = bil(F.slope, W, gx, gz, i, j);
    const fine = N.valueNoise(x / 5, z / 5, 11) * 0.5 + N.valueNoise(x / 17, z / 17, 23) * 0.35 + N.hash2(x | 0, z | 0, 5) * 0.15 - 0.5;
    const jit = bil(F.jit, W, gx, gz, i, j) + fine * 0.6;
    const vary = bil(F.vary, W, gx, gz, i, j);
    const pid = map.paintId[Math.round(gz) * W + Math.round(gx)];
    const pw = bil(F.pwF, W, gx, gz, i, j);
    T.ruleColor(colTmp, tx, h, slope, jit, vary, pid, pw);
    let m = 1 + fine * 2 * tx.detail;
    const sh = bil(F.shade, W, gx, gz, i, j);
    m *= 1 + (sh - 1) * tx.bakeShading;
    let r = colTmp[0] * m, g = colTmp[1] * m, b = colTmp[2] * m;
    // Geothermal vents are invisible features in BAR, so paint a scorched vent into the texture.
    if (F.geos.length) {
      for (const gp of F.geos) {
        const dx = x - gp[0], dz = z - gp[1];
        const d2 = dx * dx + dz * dz;
        if (d2 < 48 * 48) {
          const d = Math.sqrt(d2) / 48;
          const crack = N.valueNoise(Math.atan2(dz, dx) * 3 + 10, d * 4, 77);
          const dark = (1 - d) * (0.55 + 0.45 * crack);
          r *= 1 - dark * 0.8; g *= 1 - dark * 0.82; b *= 1 - dark * 0.85;
          if (d < 0.25) { const glow = (0.25 - d) * 4; r += glow * 140; g += glow * 50; }
        }
      }
    }
    if (opts && opts.water && map.settings.lava && h < map.settings.lavaLevel) {
      T.lavaColor(colTmp, x, z, map.settings.lavaLevel - h);
      r = colTmp[0]; g = colTmp[1]; b = colTmp[2];
    } else if (opts && opts.water && h < 0 && !map.settings.voidWater) {
      const wc = T.PALETTES[tx.palette] ? T.PALETTES[tx.palette].water.base : [0.2, 0.3, 0.35];
      const t = clamp(0.35 + (-h) / 120, 0.35, 0.85);
      r += (wc[0] * 255 * 1.2 + 10 - r) * t; g += (wc[1] * 255 * 1.2 + 20 - g) * t; b += (wc[2] * 255 * 1.2 + 30 - b) * t;
    }
    out[o] = r < 0 ? 0 : r > 255 ? 255 : r;
    out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }

  // ------------------------------------------------------------------ helpers
  function safeName(s) { return (s || 'map').trim().replace(/[^A-Za-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '') || 'map'; }
  function heightLimits(map) {
    let [lo, hi] = map.heightRange();
    if (hi - lo < 1) hi = lo + 1;
    return [Math.floor(lo), Math.ceil(hi)];
  }
  function quantizeHeights(map, lo, hi) {
    const out = new Uint16Array(map.W * map.H), s = 65536 / (hi - lo);
    for (let k = 0; k < out.length; k++) out[k] = clamp(Math.round((map.heights[k] - lo) * s), 0, 65535);
    return out;
  }

  // Metal map: hard-edged 21-pixel spots (5x5 minus corners) whose pixel sum gives exactly
  // the requested in-game value. maxMetal is chosen so the largest spot fits in 8 bits.
  function buildMetal(map) {
    const mw = (map.W - 1) / 2, mh = (map.H - 1) / 2;
    const spots = map.objectsOf('metal');
    const PIX = [];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dz * dz <= 5) PIX.push([dx, dz]);
    const maxSpot = spots.reduce((m, s) => Math.max(m, +s.metal || 0), 0);
    const maxMetal = Math.max(0.5, Math.ceil(maxSpot * 1000 / (PIX.length * 250) * 100) / 100);
    const data = new Uint8Array(mw * mh);
    const warnings = [];
    for (const s of spots) {
      const cx = clamp(Math.floor(s.x / 16), 2, mw - 3), cz = clamp(Math.floor(s.z / 16), 2, mh - 3);
      const total = Math.round((+s.metal || 0) * 1000 / maxMetal);
      const base = Math.floor(total / PIX.length);
      let rem = total - base * PIX.length;
      for (const [dx, dz] of PIX) {
        const k = (cz + dz) * mw + cx + dx;
        if (data[k]) warnings.push(s);
        data[k] = Math.min(255, base + (rem-- > 0 ? 1 : 0));
      }
    }
    // spots closer than ~6 metal pixels can merge into one in BAR's spot finder
    let close = 0;
    for (let a = 0; a < spots.length; a++) for (let b = a + 1; b < spots.length; b++) {
      if (Math.hypot(spots[a].x - spots[b].x, spots[a].z - spots[b].z) < 96) close++;
    }
    return { data, width: mw, height: mh, maxMetal, closePairs: close };
  }

  // BAR reads mapconfig/lava.lua from the map archive (BAR modules/lava.lua). Static lava:
  // grow 0 and a single tide that holds the level. Uses BAR's built-in lava textures.
  function lavaLua(map) {
    const st = map.settings;
    const lvl = Math.round(st.lavaLevel);
    const uv = Math.max(2, Math.round(Math.max(map.sx, map.sz) / 2));
    return `-- Generated by BAR Map Maker. Read by Beyond All Reason (modules/lava.lua, luarules/gadgets/map_lava.lua).
-- Units below the lava level take damage. Textures are BAR's built-in lava set.
return {
  level = ${lvl},
  grow = 0,
  damage = ${+st.lavaDamage},
  diffuseEmitTex = "LuaUI/images/lava/lava2_diffuseemit.dds",
  normalHeightTex = "LuaUI/images/lava/lava2_normalheight.dds",
  uvScale = ${uv}.0,
  coastWidth = 40.0,
  coastColor = "vec3(2.0, 0.5, 0.0)",
  coastLightBoost = 0.7,
  fogColor = "vec3(2.0, 0.5, 0.0)",
  fogFactor = 0.06,
  fogHeight = 30,
  tideAmplitude = 2,
  tidePeriod = 200,
  -- { target level, speed (elmo/s), hold seconds }: hold the lava at its level all game
  tideRhythm = { { ${lvl - 1}, 1.5, 5 * 6000 } },
}
`;
  }

  function luaColor(c) { return '{' + c.map(v => (+v).toFixed(3)).join(', ') + '}'; }
  function luaStr(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'; }

  function mapinfoLua(map, info) {
    const st = map.settings, tx = map.texture;
    const P = T.PALETTES[tx.palette] || T.PALETTES.temperate;
    const sun = T.sunDir(tx);
    const starts = map.objectsOf('start');
    const fname = info.fileBase;
    const hasWater = info.minH < 0;
    const teams = starts.map((s, i) => `    [${i}] = { startPos = { x = ${Math.round(s.x)}, z = ${Math.round(s.z)} } },`).join('\n');
    const w = P.water;
    return `-- Generated by BAR Map Maker
local mapinfo = {
  name        = ${luaStr(st.name)},
  shortname   = ${luaStr(fname)},
  description = ${luaStr(st.description)},
  author      = ${luaStr(st.author || 'Unknown')},
  version     = ${luaStr(st.version)},
  mapfile     = ${luaStr('maps/' + fname + '.smf')},
  modtype     = 3,
  depend      = { "Map Helper v1" },
  replace     = {},

  maphardness     = 100,
  notDeformable   = false,
  gravity         = ${+st.gravity},
  tidalStrength   = ${+st.tidalStrength},
  maxMetal        = ${info.maxMetal},
  extractorRadius = ${+st.extractorRadius},
  voidWater       = ${st.voidWater ? 'true' : 'false'},
  voidGround      = false,
  autoShowMetal   = true,

  smf = {
    minheight    = ${info.minH},
    maxheight    = ${info.maxH},
    smtFileName0 = ${luaStr('maps/' + fname + '.smt')},
  },

  sound = {
    preset = "default",
  },

  resources = {},

  atmosphere = {
    minWind    = ${+st.minWind},
    maxWind    = ${+st.maxWind},
    fogStart   = 0.75,
    fogEnd     = 1.0,
    fogColor   = ${luaColor(P.fog)},
    skyColor   = ${luaColor(P.sky)},
    sunColor   = ${luaColor(P.sun)},
    cloudColor = ${luaColor(P.fog)},
    cloudDensity = 0.4,
  },

  lighting = {
    sunDir              = { ${sun[0].toFixed(3)}, ${sun[1].toFixed(3)}, ${sun[2].toFixed(3)}, 1e9 },
    groundAmbientColor  = ${luaColor(P.ambient)},
    groundDiffuseColor  = ${luaColor(P.diffuse)},
    groundSpecularColor = { 0.1, 0.1, 0.1 },
    unitAmbientColor    = ${luaColor(P.ambient.map(v => v * 0.9))},
    unitDiffuseColor    = ${luaColor(P.diffuse.map(v => v * 0.95))},
    unitSpecularColor   = ${luaColor(P.diffuse.map(v => v * 0.7))},
    specularExponent    = 100.0,
    groundShadowDensity = 0.8,
    unitShadowDensity   = 0.8,
  },
${hasWater ? `
  water = {
    damage        = 0.0,
    repeatX       = 0.0,
    repeatY       = 0.0,
    absorb        = ${luaColor(w.absorb)},
    baseColor     = ${luaColor(w.base)},
    minColor      = ${luaColor(w.min)},
    surfaceColor  = ${luaColor(w.surface)},
    surfaceAlpha  = 0.25,
    planeColor    = ${luaColor(w.base)},
    fresnelMin    = 0.2,
    fresnelMax    = 0.8,
    fresnelPower  = 4.0,
    reflectionDistortion = 1.0,
    blurBase      = 2.0,
    blurExponent  = 1.5,
    perlinStartFreq  = 8.0,
    perlinLacunarity = 3.0,
    perlinAmplitude  = 0.9,
    numTiles      = 1,
    shoreWaves    = true,
    forceRendering = false,
  },
` : ''}
  teams = {
${teams}
  },

  terrainTypes = {
    [0] = {
      name = "Default",
      hardness = 1.0,
      receiveTracks = true,
      moveSpeeds = { tank = 1.0, kbot = 1.0, hover = 1.0, ship = 1.0 },
    },
  },

  custom = {
    generator = "BAR Map Maker",
  },
}

return mapinfo
`;
  }

  // ------------------------------------------------------------------ SMF / SMT
  async function buildSMT(map, F, progress) {
    const mapx = map.W - 1, mapy = map.H - 1;
    const tw = mapx / 4, th = mapy / 4, numTiles = tw * th;
    const TILE = 680;
    const out = new Uint8Array(32 + numTiles * TILE);
    const dv = new DataView(out.buffer);
    const magic = 'spring tilefile';
    for (let i = 0; i < magic.length; i++) out[i] = magic.charCodeAt(i);
    dv.setInt32(16, 1, true); dv.setInt32(20, numTiles, true); dv.setInt32(24, 32, true); dv.setInt32(28, 1, true);
    const img = new Float32Array(32 * 32 * 3);
    let o = 32, last = performance.now();
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const X0 = tx * 32, Z0 = ty * 32;
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) texelColor(map, F, X0 + x + 0.5, Z0 + y + 0.5, img, (y * 32 + x) * 3);
        o += compressImage(img, 32, 32, out, o);
        let m = img, s = 32;
        for (let lvl = 0; lvl < 3; lvl++) { m = downsample(m, s, s); s >>= 1; o += compressImage(m, s, s, out, o); }
      }
      if (performance.now() - last > 60) { last = performance.now(); progress && progress((ty + 1) / th); await tick(); }
    }
    return { data: out, numTiles };
  }

  async function buildMinimap(map, F) {
    const S = 1024, img = new Float32Array(S * S * 3);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) texelColor(map, F, (x + 0.5) / S * map.worldW, (y + 0.5) / S * map.worldH, img, (y * S + x) * 3, { water: true });
      if ((y & 127) === 0) await tick();
    }
    const out = new Uint8Array(699048);
    let o = 0, m = img, s = S;
    o += compressImage(m, s, s, out, o);
    while (s > 4) { m = downsample(m, s, s); s >>= 1; o += compressImage(m, s, s, out, o); }
    return { dxt: out, rgb: img };
  }

  function buildSMF(map, parts) {
    const mapx = map.W - 1, mapy = map.H - 1;
    const enc = new TextEncoder();
    const hmBytes = (mapx + 1) * (mapy + 1) * 2;
    const typeBytes = (mapx / 2) * (mapy / 2);
    const smtName = enc.encode(parts.smtName + '\0');
    const tileIdx = (mapx / 4) * (mapy / 4);
    const tileBytes = 8 + 4 + smtName.length + tileIdx * 4;
    const geos = map.objectsOf('geo');
    const ftName = enc.encode('GeoVent\0');
    const featBytes = 8 + (geos.length ? ftName.length : 0) + geos.length * 24;

    const off = {};
    let p = 80;
    off.height = p; p += hmBytes;
    off.type = p; p += typeBytes;
    off.minimap = p; p += 699048;
    off.metal = p; p += typeBytes;
    off.tiles = p; p += tileBytes;
    off.feat = p; p += featBytes;
    const out = new Uint8Array(p);
    const dv = new DataView(out.buffer);
    const magic = 'spring map file';
    for (let i = 0; i < magic.length; i++) out[i] = magic.charCodeAt(i);
    dv.setInt32(16, 1, true);
    dv.setInt32(20, (Math.random() * 0x7fffffff) | 0, true);
    dv.setInt32(24, mapx, true); dv.setInt32(28, mapy, true);
    dv.setInt32(32, 8, true); dv.setInt32(36, 8, true); dv.setInt32(40, 32, true);
    dv.setFloat32(44, parts.minH, true); dv.setFloat32(48, parts.maxH, true);
    dv.setInt32(52, off.height, true); dv.setInt32(56, off.type, true); dv.setInt32(60, off.tiles, true);
    dv.setInt32(64, off.minimap, true); dv.setInt32(68, off.metal, true); dv.setInt32(72, off.feat, true);
    dv.setInt32(76, 0, true); // no extra headers (no grass)

    const hq = parts.heights;
    for (let k = 0; k < hq.length; k++) dv.setUint16(off.height + k * 2, hq[k], true);
    // typemap stays zero (terrain type 0)
    out.set(parts.minimap, off.minimap);
    out.set(parts.metal, off.metal);
    let q = off.tiles;
    dv.setInt32(q, 1, true); dv.setInt32(q + 4, parts.numTiles, true); q += 8;
    dv.setInt32(q, parts.numTiles, true); q += 4;
    out.set(smtName, q); q += smtName.length;
    for (let t = 0; t < tileIdx; t++) { dv.setInt32(q, t, true); q += 4; }
    q = off.feat;
    dv.setInt32(q, geos.length ? 1 : 0, true); dv.setInt32(q + 4, geos.length, true); q += 8;
    if (geos.length) { out.set(ftName, q); q += ftName.length; }
    for (const g of geos) {
      dv.setInt32(q, 0, true);
      dv.setFloat32(q + 4, g.x, true); dv.setFloat32(q + 8, map.sampleHeight(g.x, g.z), true);
      dv.setFloat32(q + 12, g.z, true); dv.setFloat32(q + 16, 0, true); dv.setFloat32(q + 20, 1, true);
      q += 24;
    }
    return out;
  }

  // ------------------------------------------------------------------ validation
  function validate(map) {
    const issues = [];
    const starts = map.objectsOf('start'), metal = map.objectsOf('metal');
    if (!map.settings.name.trim()) issues.push({ level: 'error', msg: 'The map needs a name (Map tab).' });
    if (starts.length < 2) issues.push({ level: 'warn', msg: `Only ${starts.length} start position(s). BAR maps should have one per player (Start tool or Generate → Auto-place).` });
    if (metal.length === 0) issues.push({ level: 'warn', msg: 'No metal spots placed — players will have no metal income.' });
    const [lo, hi] = map.heightRange();
    if (hi - lo < 5) issues.push({ level: 'info', msg: 'Terrain is completely flat.' });
    if (lo >= 0 && map.settings.voidWater) issues.push({ level: 'info', msg: 'Void water is on but the map has no water.' });
    for (const s of starts) if (map.sampleHeight(s.x, s.z) < 0) { issues.push({ level: 'warn', msg: 'A start position is underwater.' }); break; }
    if (map.settings.lava) {
      if (map.settings.voidWater) issues.push({ level: 'error', msg: 'BAR disables lava on void-water maps - turn off Void water (Map tab).' });
      const inLava = map.objects.filter(o => map.sampleHeight(o.x, o.z) < map.settings.lavaLevel + 5).length;
      if (inLava) issues.push({ level: 'warn', msg: `${inLava} resource(s) / start position(s) are in or at the edge of the lava.` });
      if (lo < 0) issues.push({ level: 'info', msg: 'Lava map has terrain below 0: engine water physics applies there (hidden under the lava).' });
    }
    let wet = 0; for (const m of metal) if (map.sampleHeight(m.x, m.z) < 0) wet++;
    if (wet) issues.push({ level: 'info', msg: `${wet} metal spot(s) are underwater (only usable with naval/amphibious extractors).` });
    let steep = 0; for (const m of metal) if (map.slopeAtWorld(m.x, m.z) > 15) steep++;
    if (steep) issues.push({ level: 'warn', msg: `${steep} metal spot(s) sit on steep ground — extractors may not be buildable.` });
    const mm = buildMetal(map);
    if (mm.closePairs) issues.push({ level: 'warn', msg: `${mm.closePairs} pair(s) of metal spots are closer than 96 elmos and may merge into one spot.` });
    const units = map.sx * map.sz;
    if (units >= 256) issues.push({ level: 'info', msg: 'Large map: export can take a minute and needs plenty of memory.' });
    return issues;
  }

  // ------------------------------------------------------------------ public exports
  async function exportSDZ(map, progress) {
    const st = map.settings;
    const fileBase = safeName(st.name);
    const [minH, maxH] = heightLimits(map);
    progress('Preparing terrain data…', 0.02);
    await tick();
    const F = prepareFields(map);
    const metal = buildMetal(map);
    progress('Rendering & compressing texture tiles…', 0.05);
    const smt = await buildSMT(map, F, f => progress('Rendering & compressing texture tiles…', 0.05 + f * 0.75));
    progress('Building minimap…', 0.82);
    const mini = await buildMinimap(map, F);
    progress('Writing map file…', 0.88);
    await tick();
    const smf = buildSMF(map, {
      minH, maxH, heights: quantizeHeights(map, minH, maxH), minimap: mini.dxt, metal: metal.data,
      numTiles: smt.numTiles, smtName: fileBase + '.smt',
    });
    const lua = mapinfoLua(map, { fileBase, minH, maxH, maxMetal: metal.maxMetal });
    progress('Packing archive…', 0.92);
    const enc = new TextEncoder();
    const files = [
      { name: 'mapinfo.lua', data: enc.encode(lua) },
      { name: 'maps/' + fileBase + '.smf', data: smf },
      { name: 'maps/' + fileBase + '.smt', data: smt.data },
    ];
    if (st.lava) files.push({ name: 'mapconfig/lava.lua', data: enc.encode(lavaLua(map)) });
    const blob = await BMM.IO.makeZip(files, f => progress('Packing archive…', 0.92 + f * 0.08));
    const archive = (fileBase + '_' + safeName(st.version)).toLowerCase() + '.sdz';
    return { blob, filename: archive };
  }

  async function exportHeightPNG(map) {
    const [minH, maxH] = heightLimits(map);
    const s = 65535 / (maxH - minH);
    const d = new Uint16Array(map.W * map.H);
    for (let k = 0; k < d.length; k++) d[k] = clamp(Math.round((map.heights[k] - minH) * s), 0, 65535);
    return { blob: await BMM.IO.encodePNG(map.W, map.H, 1, d), minH, maxH };
  }

  async function exportSources(map, progress) {
    const st = map.settings;
    const fileBase = safeName(st.name);
    const files = [];
    progress('Heightmap…', 0.02);
    const hp = await exportHeightPNG(map);
    files.push({ name: 'heightmap.png', data: new Uint8Array(await hp.blob.arrayBuffer()) });
    const F = prepareFields(map);
    const metal = buildMetal(map);
    const mrgb = new Uint8Array(metal.width * metal.height * 3);
    for (let k = 0; k < metal.data.length; k++) mrgb[k * 3] = metal.data[k];
    // pymapconv reads metal from the red channel; it does not know our maxMetal scaling,
    // so the readme lists the value to enter.
    files.push({ name: 'metal.png', data: new Uint8Array(await (await BMM.IO.encodePNG(metal.width, metal.height, 3, mrgb)).arrayBuffer()) });
    progress('Full-resolution texture…', 0.1);
    const TW = (map.W - 1) * 8, TH = (map.H - 1) * 8;
    const tex = new Uint8Array(TW * TH * 3);
    const row = new Float32Array(TW * 3);
    let last = performance.now();
    for (let z = 0; z < TH; z++) {
      for (let x = 0; x < TW; x++) texelColor(map, F, x + 0.5, z + 0.5, row, x * 3);
      for (let i = 0; i < TW * 3; i++) tex[z * TW * 3 + i] = row[i];
      if (performance.now() - last > 60) { last = performance.now(); progress('Full-resolution texture…', 0.1 + 0.6 * z / TH); await tick(); }
    }
    progress('Encoding texture PNG…', 0.72); await tick();
    files.push({ name: 'texture.png', data: new Uint8Array(await (await BMM.IO.encodePNG(TW, TH, 3, tex)).arrayBuffer()) });
    progress('Minimap…', 0.85);
    const mini = await buildMinimap(map, F);
    const mm = new Uint8Array(1024 * 1024 * 3);
    for (let i = 0; i < mm.length; i++) mm[i] = mini.rgb[i];
    files.push({ name: 'minimap.png', data: new Uint8Array(await (await BMM.IO.encodePNG(1024, 1024, 3, mm)).arrayBuffer()) });
    const lua = mapinfoLua(map, { fileBase, minH: hp.minH, maxH: hp.maxH, maxMetal: metal.maxMetal });
    const enc = new TextEncoder();
    files.push({ name: 'mapinfo.lua', data: enc.encode(lua) });
    if (st.lava) files.push({ name: 'mapconfig/lava.lua', data: enc.encode(lavaLua(map)) });
    const geos = map.objectsOf('geo').map(g => `GeoVent ${Math.round(g.x)} ${Math.round(g.z)}`).join('\n');
    files.push({ name: 'geovents.txt', data: enc.encode(geos + '\n') });
    files.push({ name: 'README.txt', data: enc.encode(`BAR Map Maker – source assets for "${st.name}"

Map size: ${map.sx} x ${map.sz} (${map.worldW} x ${map.worldH} elmos)
heightmap.png : ${map.W} x ${map.H}, 16-bit greyscale. Black = ${hp.minH}, white = ${hp.maxH} elmos.
texture.png   : ${TW} x ${TH} diffuse texture.
metal.png     : ${metal.width} x ${metal.height}, red channel = metal. Use maxMetal = ${metal.maxMetal}.
minimap.png   : 1024 x 1024.
mapinfo.lua   : ready-made, references maps/${fileBase}.smf and maps/${fileBase}.smt.
geovents.txt  : geothermal vent positions (feature name GeoVent, x z in elmos).

To compile manually with pymapconv (github.com/Beherith/springrts_smf_compiler):
texture = texture.png, heightmap = heightmap.png, metal = metal.png,
min height = ${hp.minH}, max height = ${hp.maxH}, output = ${fileBase}.smf
Then zip mapinfo.lua + maps/${fileBase}.smf + maps/${fileBase}.smt into ${fileBase.toLowerCase()}.sdz.

(The "Playable map (.sdz)" export in BAR Map Maker does all of this for you.)
`) });
    progress('Packing zip…', 0.95);
    const blob = await BMM.IO.makeZip(files);
    return { blob, filename: fileBase.toLowerCase() + '_sources.zip' };
  }

  BMM.Export = { lavaLua, exportSDZ, exportSources, exportHeightPNG, validate, buildMetal, mapinfoLua, safeName, compressBlock, texelColor, prepareFields };
})();
