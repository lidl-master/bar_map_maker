'use strict';
// Sculpting brushes, procedural generators, erosion and whole-map operations.
var BMM = window.BMM || (window.BMM = {});

(function () {
  const { clamp, smoothstep, lerp } = BMM.util;
  const N = BMM.Noise;
  const SQ = BMM.SQUARE;

  function falloff(d, hardness) {
    if (d >= 1) return 0;
    const h = Math.min(0.98, hardness);
    if (d <= h) return 1;
    const t = 1 - (d - h) / (1 - h);
    return t * t * (3 - 2 * t);
  }

  // ------------------------------------------------------------------ Brushes
  // Apply one brush dab centred at world (wx, wz). `dt` is seconds of brush time.
  // Returns the dirty grid rect [x0, z0, x1, z1] or null.
  function dab(map, tool, wx, wz, p, dt, state) {
    const W = map.W, H = map.H;
    const cx = wx / SQ, cz = wz / SQ, r = Math.max(1, p.radius / SQ);
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(H - 1, Math.ceil(cz + r));
    if (x0 > x1 || z0 > z1) return null;
    const hh = map.heights;
    const s = p.strength;

    if (tool === 'paint') {
      const m = p.material | 0, pid = map.paintId, pw = map.paintW;
      const rate = s * dt * 900;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const w = falloff(Math.hypot(x - cx, z - cz) / r, p.hardness);
        if (w <= 0) continue;
        const k = z * W + x;
        let delta = w * rate; delta = Math.floor(delta + Math.random());
        if (delta <= 0) continue;
        if (m === 0) pw[k] = Math.max(0, pw[k] - delta);
        else if (pid[k] === m || pw[k] === 0) { pid[k] = m; pw[k] = Math.min(255, pw[k] + delta); }
        else if (pw[k] <= delta) { pid[k] = m; pw[k] = Math.min(255, delta - pw[k]); }
        else pw[k] -= delta;
      }
      return [x0, z0, x1, z1];
    }

    let src = null, sw = 0, k0x = 0, k0z = 0, br = 0;
    if (tool === 'smooth') {
      // Box-blurred copy of the region (radius scales gently with brush size).
      br = Math.max(1, Math.min(4, Math.round(r / 6)));
      k0x = Math.max(0, x0 - br); k0z = Math.max(0, z0 - br);
      const k1x = Math.min(W - 1, x1 + br), k1z = Math.min(H - 1, z1 + br);
      sw = k1x - k0x + 1;
      const sh = k1z - k0z + 1;
      src = new Float32Array(sw * sh);
      for (let z = 0; z < sh; z++) for (let x = 0; x < sw; x++) src[z * sw + x] = hh[(z + k0z) * W + x + k0x];
      src = boxBlur(src, sw, sh, br);
    }
    const kRate = 1 - Math.exp(-dt * s * 8);       // for flatten / smooth
    const rise = s * dt * (p.speed || 300);         // elmos per second for raise/lower/noise
    const noise = tool === 'noise' ? (state.noise || (state.noise = N.makeSimplex(state.seed || 7))) : null;
    const nscale = 1 / Math.max(16, p.noiseScale || 200);

    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const w = falloff(Math.hypot(x - cx, z - cz) / r, p.hardness);
      if (w <= 0) continue;
      const k = z * W + x;
      switch (tool) {
        case 'raise': hh[k] += w * rise; break;
        case 'lower': hh[k] -= w * rise; break;
        case 'flatten': hh[k] += (state.target - hh[k]) * Math.min(1, w * kRate * 1.5); break;
        case 'smooth': hh[k] += (src[(z - k0z) * sw + (x - k0x)] - hh[k]) * Math.min(1, w * kRate * 1.5); break;
        case 'noise': hh[k] += w * rise * N.fbm(noise, x * SQ * nscale, z * SQ * nscale, 4, 2, 0.5); break;
      }
      if (p.clampMin !== undefined) hh[k] = Math.max(p.clampMin, hh[k]);
    }
    return [x0, z0, x1, z1];
  }

  function boxBlur(a, w, h, r) {
    const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
    for (let z = 0; z < h; z++) {
      let sum = 0, cnt = 0;
      for (let x = -r; x <= r; x++) if (x >= 0 && x < w) { sum += a[z * w + x]; cnt++; }
      for (let x = 0; x < w; x++) {
        tmp[z * w + x] = sum / cnt;
        const xo = x - r, xi = x + r + 1;
        if (xo >= 0) { sum -= a[z * w + xo]; cnt--; }
        if (xi < w) { sum += a[z * w + xi]; cnt++; }
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let z = -r; z <= r; z++) if (z >= 0 && z < h) { sum += tmp[z * w + x]; cnt++; }
      for (let z = 0; z < h; z++) {
        out[z * w + x] = sum / cnt;
        const zo = z - r, zi = z + r + 1;
        if (zo >= 0) { sum -= tmp[zo * w + x]; cnt--; }
        if (zi < h) { sum += tmp[zi * w + x]; cnt++; }
      }
    }
    return out;
  }

  // Ramp: carve/fill a straight corridor from A to B with a linear height profile.
  function ramp(map, ax, az, bx, bz, ha, hb, width, hardness) {
    const W = map.W, H = map.H, hh = map.heights;
    const half = width / 2, fall = Math.max(8, half * (1 - hardness) * 1.5 + 8);
    const reach = (half + fall) / SQ;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) / SQ - reach)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) / SQ + reach));
    const z0 = Math.max(0, Math.floor(Math.min(az, bz) / SQ - reach)), z1 = Math.min(H - 1, Math.ceil(Math.max(az, bz) / SQ + reach));
    const dx = bx - ax, dz = bz - az, L2 = Math.max(1, dx * dx + dz * dz);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const px = x * SQ, pz = z * SQ;
      const t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
      const qx = ax + dx * t, qz = az + dz * t;
      const d = Math.hypot(px - qx, pz - qz);
      if (d > half + fall) continue;
      const w = d <= half ? 1 : 1 - smoothstep(0, 1, (d - half) / fall);
      const k = z * W + x;
      hh[k] = lerp(hh[k], ha + (hb - ha) * t, w);
    }
    return [x0, z0, x1, z1];
  }

  // ------------------------------------------------------------------ Generators
  const STYLES = {
    hills: 'Rolling hills',
    mountains: 'Mountain ridges',
    mesas: 'Plateaus & mesas',
    canyons: 'Canyons',
    islands: 'Islands / archipelago',
    continents: 'Two continents',
    craters: 'Cratered (moon)',
    flat: 'Flat plain',
  };

  function generate(map, g, progress) {
    const W = map.W, H = map.H, n = W * H;
    const seed = g.seed | 0;
    const noise = N.makeSimplex(seed), warpN = N.makeSimplex(seed + 101), aux = N.makeSimplex(seed + 202);
    const v = new Float32Array(n);
    const scale = Math.max(100, g.featureSize);
    const oct = 3 + Math.round(g.roughness * 4);
    const gain = 0.35 + g.roughness * 0.25;
    const ww = map.worldW, wh = map.worldH;
    const rnd = N.mulberry32(seed + 5);
    const craters = [];
    if (g.style === 'craters') {
      const count = Math.round(ww * wh / (scale * scale) * 2.5);
      for (let c = 0; c < count; c++) {
        const big = rnd() < 0.15;
        craters.push({ x: rnd() * ww, z: rnd() * wh, r: (big ? 0.5 + rnd() * 0.7 : 0.08 + rnd() * 0.3) * scale });
      }
    }

    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const wx = i * SQ, wz = j * SQ;
        let x = wx / scale, z = wz / scale;
        if (g.warp > 0) {
          const qx = N.fbm(warpN, x * 0.6 + 3.1, z * 0.6 + 7.7, 3, 2, 0.5);
          const qz = N.fbm(warpN, x * 0.6 - 5.3, z * 0.6 + 1.9, 3, 2, 0.5);
          x += qx * g.warp; z += qz * g.warp;
        }
        let val;
        switch (g.style) {
          case 'mountains': {
            const r = N.ridged(noise, x * 0.8, z * 0.8, oct, 2, 0.5);
            const base = N.fbm(aux, x * 0.4, z * 0.4, 3, 2, 0.5) * 0.5 + 0.5;
            val = Math.pow(r, 1.7) * 0.8 + base * 0.25;
            break;
          }
          case 'mesas': {
            const base = N.fbm(noise, x, z, oct, 2, gain) * 0.5 + 0.5;
            val = base;
            break;
          }
          case 'canyons': {
            const r = 1 - Math.abs(N.fbm(noise, x * 0.7, z * 0.7, 4, 2, 0.5));
            const plateau = 0.75 + 0.12 * N.fbm(aux, x, z, oct, 2, gain);
            const cut = smoothstep(0.8, 0.97, r);
            val = plateau - 0.6 * cut;
            break;
          }
          case 'islands': {
            const base = N.fbm(noise, x, z, oct, 2, gain) * 0.5 + 0.5;
            const blob = N.fbm(aux, x * 0.35, z * 0.35, 3, 2, 0.5) * 0.5 + 0.5;
            val = base * 0.55 + blob * 0.65 - 0.2;
            break;
          }
          case 'continents': {
            // Two land masses separated by a sea channel across the symmetry line.
            const u = wx / ww, w2 = wz / wh;
            const base = N.fbm(noise, x, z, oct, 2, gain) * 0.5 + 0.5;
            let d;
            if (map.symmetry === 'mirrorZ') d = Math.abs(w2 - 0.5) * 2;
            else if (map.symmetry === 'diag') d = Math.abs(u - w2) * 1.4;
            else if (map.symmetry === 'adiag' || map.symmetry === 'rot180') d = Math.abs(u + w2 - 1) * 1.4;
            else d = Math.abs(u - 0.5) * 2;
            d += N.fbm(aux, x * 0.5, z * 0.5, 3, 2, 0.5) * 0.15;
            val = base * 0.45 + smoothstep(0.08, 0.35, d) * 0.7;
            break;
          }
          case 'craters': {
            let hsum = (N.fbm(noise, x, z, oct, 2, gain) * 0.5 + 0.5) * 0.4;
            for (const c of craters) {
              const dd = Math.hypot(wx - c.x, wz - c.z) / c.r;
              if (dd > 1.6) continue;
              const depth = c.r / scale * 0.5;
              if (dd < 1) hsum -= depth * (1 - dd * dd) * 0.9;
              hsum += depth * 0.35 * Math.exp(-((dd - 1) * (dd - 1)) / 0.04);
            }
            val = hsum;
            break;
          }
          case 'flat':
            val = 0.5 + N.fbm(noise, x, z, 3, 2, 0.5) * 0.04;
            break;
          default: // hills
            val = N.fbm(noise, x, z, oct, 2, gain) * 0.5 + 0.5;
        }
        // Edge treatment
        if (g.edges !== 'none') {
          const e = Math.min(wx, ww - wx, wz, wh - wz) / Math.max(ww, wh);
          const m = smoothstep(0, 0.12, e);
          if (g.edges === 'sink') val = val * (0.25 + 0.75 * m) - (1 - m) * 0.3;
          else if (g.edges === 'raise') val = val + (1 - m) * 0.6;
        }
        v[j * W + i] = val;
      }
      if (progress && (j & 63) === 0) progress(j / H * 0.6);
    }
    // Seamlessly symmetrise the raw field, then map value -> elmos.
    BMM.Sym.blendSymmetry(map, v, 0.06);
    const sorted = Float32Array.from(v).sort();
    const lo = sorted[0], hi = sorted[n - 1];
    const minH = g.minHeight, maxH = g.maxHeight;
    const water = clamp(g.water / 100, 0, 0.95);
    const q = water > 0 ? sorted[Math.floor(water * (n - 1))] : lo;
    const hh = map.heights;
    const flatStyle = g.style === 'flat';
    for (let k = 0; k < n; k++) {
      let t;
      if (flatStyle) t = (v[k] - lo) / Math.max(1e-6, hi - lo);
      let h;
      if (water > 0 && minH < 0) {
        if (v[k] < q) h = minH * (1 - (v[k] - lo) / Math.max(1e-6, q - lo));
        else h = maxH * (v[k] - q) / Math.max(1e-6, hi - q);
      } else {
        t = (v[k] - lo) / Math.max(1e-6, hi - lo);
        h = minH + (maxH - minH) * t;
      }
      if (flatStyle) h = (minH + maxH) / 2 + (t - 0.5) * 12;
      hh[k] = h;
    }
    if (g.style === 'mesas' || g.terraces > 0) terrace(map, g.terraces > 0 ? g.terraces : 4, 0.8, true);
    if (progress) progress(0.7);
    if (g.erosion > 0) {
      hydraulicErosion(map, { droplets: Math.round(g.erosion * map.sx * map.sz * 1500), seed: seed + 9 });
    }
    if (progress) progress(0.95);
    smoothAll(map, 1);
    BMM.Sym.blendSymmetry(map, map.heights, 0.015);
    // Dry maps stay dry: erosion/smoothing must not dig puddles below the requested floor.
    if (minH >= 0) for (let k = 0; k < n; k++) if (hh[k] < minH) hh[k] = minH;
  }

  // Quantise heights into flat steps joined by steep cliffs (BAR-style plateaus).
  function terrace(map, steps, sharpness, keepWater) {
    const hh = map.heights;
    const [lo, hi] = map.heightRange();
    const base = keepWater ? Math.max(0, lo) : lo;
    const span = hi - base;
    if (span <= 1) return;
    const sh = clamp(sharpness, 0, 0.98);
    for (let k = 0; k < hh.length; k++) {
      if (keepWater && hh[k] < 0) continue;
      const f = (hh[k] - base) / span * steps;
      const fl = Math.floor(f), fr = f - fl;
      const edge = 1 - sh;
      const s = smoothstep(0.5 - edge / 2, 0.5 + edge / 2, fr);
      hh[k] = base + (fl + s) / steps * span;
    }
  }

  function smoothAll(map, passes, layer) {
    let a = layer || map.heights;
    for (let p = 0; p < passes; p++) a.set(boxBlur(a, map.W, map.H, 1));
  }

  // Particle-based hydraulic erosion (after S. Lague). Works in grid-height units (elmos/8).
  function hydraulicErosion(map, o) {
    const W = map.W, H = map.H, hh = map.heights;
    const opt = Object.assign({ droplets: 50000, inertia: 0.05, capacity: 4, minCapacity: 0.01, deposit: 0.3, erode: 0.3, evaporate: 0.02, gravity: 4, maxSteps: 48, radius: 3, seed: 1 }, o);
    const rnd = N.mulberry32(opt.seed);
    const hmap = new Float32Array(hh.length);
    for (let k = 0; k < hh.length; k++) hmap[k] = hh[k] / SQ;
    // Precompute erosion brush
    const R = opt.radius, offs = [], wts = [];
    let wsum = 0;
    for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, z);
      if (d <= R) { offs.push([x, z]); const w = 1 - d / R; wts.push(w); wsum += w; }
    }
    for (let i = 0; i < wts.length; i++) wts[i] /= wsum;

    function gradHeight(px, pz) {
      const ix = px | 0, iz = pz | 0, fx = px - ix, fz = pz - iz;
      const k = iz * W + ix;
      const a = hmap[k], b = hmap[k + 1], c = hmap[k + W], d = hmap[k + W + 1];
      return [(b - a) * (1 - fz) + (d - c) * fz, (c - a) * (1 - fx) + (d - b) * fx,
        a * (1 - fx) * (1 - fz) + b * fx * (1 - fz) + c * (1 - fx) * fz + d * fx * fz];
    }
    for (let it = 0; it < opt.droplets; it++) {
      let px = rnd() * (W - 2), pz = rnd() * (H - 2);
      let dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
      for (let step = 0; step < opt.maxSteps; step++) {
        const ix = px | 0, iz = pz | 0, fx = px - ix, fz = pz - iz;
        const [gx, gz, h0] = gradHeight(px, pz);
        dx = dx * opt.inertia - gx * (1 - opt.inertia);
        dz = dz * opt.inertia - gz * (1 - opt.inertia);
        const len = Math.hypot(dx, dz);
        if (len < 1e-9) break;
        dx /= len; dz /= len;
        px += dx; pz += dz;
        if (px < 1 || pz < 1 || px >= W - 2 || pz >= H - 2) break;
        const h1 = gradHeight(px, pz)[2];
        const dh = h1 - h0;
        const cap = Math.max(-dh * speed * water * opt.capacity, opt.minCapacity);
        const k = iz * W + ix;
        if (sed > cap || dh > 0) {
          const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * opt.deposit;
          sed -= amt;
          hmap[k] += amt * (1 - fx) * (1 - fz);
          hmap[k + 1] += amt * fx * (1 - fz);
          hmap[k + W] += amt * (1 - fx) * fz;
          hmap[k + W + 1] += amt * fx * fz;
        } else {
          const amt = Math.min((cap - sed) * opt.erode, -dh);
          for (let b = 0; b < offs.length; b++) {
            const xx = ix + offs[b][0], zz = iz + offs[b][1];
            if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
            const kk = zz * W + xx;
            const e = amt * wts[b];
            const d = hmap[kk] < e ? hmap[kk] : e;
            hmap[kk] -= e; sed += e;
            void d;
          }
        }
        speed = Math.sqrt(Math.max(0, speed * speed + dh * opt.gravity * -1));
        water *= 1 - opt.evaporate;
      }
    }
    for (let k = 0; k < hh.length; k++) hh[k] = hmap[k] * SQ;
  }

  // Thermal relaxation: move material downhill until no slope exceeds `maxDeg`.
  function limitSlopes(map, maxDeg, iterations) {
    const W = map.W, H = map.H, hh = map.heights;
    const talus = Math.tan(maxDeg * Math.PI / 180) * SQ;
    const tal2 = talus * Math.SQRT2;
    const nb = [[1, 0, talus], [-1, 0, talus], [0, 1, talus], [0, -1, talus], [1, 1, tal2], [-1, -1, tal2], [1, -1, tal2], [-1, 1, tal2]];
    for (let it = 0; it < iterations; it++) {
      let changed = 0;
      for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
        const k = z * W + x;
        let maxD = 0, mk = -1, mt = 0;
        for (const [ox, oz, t] of nb) {
          const kk = k + oz * W + ox;
          const d = hh[k] - hh[kk] - t;
          if (d > maxD) { maxD = d; mk = kk; mt = t; }
        }
        if (mk >= 0) { const m = maxD * 0.5; hh[k] -= m; hh[mk] += m; changed++; void mt; }
      }
      if (!changed) break;
    }
  }

  // ------------------------------------------------------------------ Auto placement
  // Farthest-point style placement inside the symmetry source domain.
  function isGood(map, x, z, opt) {
    if (x < opt.margin || z < opt.margin || x > map.worldW - opt.margin || z > map.worldH - opt.margin) return false;
    const h = map.sampleHeight(x, z);
    if (!opt.allowWater && h < 2) return false;
    if (map.slopeAtWorld(x, z) > opt.maxSlope) return false;
    return true;
  }

  function placeStarts(map, count, rnd) {
    const sym = BMM.Sym.symMode(map);
    const orbitSize = sym.T.length;
    const perSide = Math.max(1, Math.ceil(count / orbitSize));
    const chosen = [];
    const W = map.worldW, H = map.worldH;
    const opt = { margin: Math.min(W, H) * 0.08, maxSlope: 25, allowWater: false };
    for (let n = 0; n < perSide; n++) {
      let best = null, bestScore = -Infinity;
      for (let t = 0; t < 600; t++) {
        const x = rnd() * W, z = rnd() * H;
        if (!sym.src(x, z, W, H)) continue;
        if (!isGood(map, x, z, opt) && t < 500) continue;
        const pts = BMM.Sym.orbit(map, x, z);
        // Prefer distance from everything already chosen (and from own mirror images).
        let dmin = Infinity;
        for (const c of chosen) for (const q of BMM.Sym.orbit(map, c[0], c[1])) dmin = Math.min(dmin, Math.hypot(q[0] - x, q[1] - z));
        for (let a = 1; a < pts.length; a++) dmin = Math.min(dmin, Math.hypot(pts[a][0] - x, pts[a][1] - z) * 0.9);
        if (pts.length === 1 && chosen.length === 0) dmin = Math.hypot(x - W / 2, z - H / 2);
        // Bases sit somewhat near the map edge.
        const edge = Math.min(x, W - x, z, H - z) / Math.min(W, H);
        if (edge < 0.06 && t < 500) continue;
        const score = dmin - Math.abs(edge - 0.14) * Math.min(W, H) * 4;
        if (score > bestScore) { bestScore = score; best = [x, z]; }
      }
      if (best) chosen.push(best);
    }
    let made = 0;
    for (const c of chosen) {
      if (made >= count) break;
      const objs = map.addObject('start', c[0], c[1]);
      made += objs.length;
    }
    // Trim extras if the orbit produced more than requested.
    const starts = map.objectsOf('start');
    if (starts.length > count) {
      const extra = new Set(starts.slice(count).map(o => o.id));
      map.objects = map.objects.filter(o => !extra.has(o.id));
    }
  }

  // Level a buildable area of radius `core`, blending back to the terrain over `blend`
  // elmos so no cliff ring is created. Target = mean height of the core (stays above water).
  function flattenAround(map, x, z, core, blend) {
    let sum = 0, cnt = 0;
    for (let a = 0; a < 24; a++) for (let r = 0; r <= core; r += core / 4) {
      sum += map.sampleHeight(x + Math.cos(a / 24 * 6.2832) * r, z + Math.sin(a / 24 * 6.2832) * r); cnt++;
    }
    const target = Math.max(sum / cnt, 6);
    const R = core + blend;
    dab(map, 'flatten', x, z, { radius: R, hardness: core / R, strength: 1 }, 1, { target });
  }

  function autoResources(map, o) {
    const rnd = N.mulberry32((o.seed | 0) + 31);
    const sym = BMM.Sym.symMode(map);
    const W = map.worldW, H = map.worldH;
    if (o.clear) map.objects = map.objects.filter(ob => !(ob.type === 'metal' || ob.type === 'geo' || (o.replaceStarts && ob.type === 'start')));
    if (o.replaceStarts || map.objectsOf('start').length === 0) placeStarts(map, o.players, rnd);
    const starts = map.objectsOf('start');
    if (o.flattenStarts) {
      for (const s of starts.filter(s => s.sym === 0)) flattenAround(map, s.x, s.z, 280, 420);
      BMM.Sym.symmetrize(map, 0.01);
    }
    const spots = map.objects.filter(ob => ob.type === 'metal' || ob.type === 'geo').map(ob => [ob.x, ob.z]);
    const tooClose = (x, z, d) => spots.some(s => Math.hypot(s[0] - x, s[1] - z) < d);
    const addSpot = (type, x, z, props) => {
      for (const ob of map.addObject(type, x, z, props)) spots.push([ob.x, ob.z]);
    };
    const metal = o.metalValue;
    const opt = { margin: 96, maxSlope: 13, allowWater: !!o.allowWater };

    // Base metal: ring around each source-domain start position.
    for (const s of starts.filter(s => s.sym === 0)) {
      let placed = 0;
      const a0 = rnd() * Math.PI * 2;
      for (let t = 0; t < 200 && placed < o.nearStart; t++) {
        const ang = a0 + (placed / o.nearStart) * Math.PI * 2 + (rnd() - 0.5) * 0.9 + t * 0.07;
        const dist = 260 + rnd() * 220;
        const x = s.x + Math.cos(ang) * dist, z = s.z + Math.sin(ang) * dist;
        if (sym.T.length > 1 && !sym.src(x, z, W, H) && t < 150) continue;
        if (!isGood(map, x, z, opt) || tooClose(x, z, 150)) continue;
        addSpot('metal', x, z, { metal });
        placed++;
      }
    }
    // Expansion metal: scattered, spread out, away from bases.
    const starPts = starts.map(s => [s.x, s.z]);
    let extra = o.extraMetal;
    for (let n = 0; n < extra; n++) {
      let best = null, bs = -Infinity;
      for (let t = 0; t < 400; t++) {
        const x = rnd() * W, z = rnd() * H;
        if (!sym.src(x, z, W, H)) continue;
        if (!isGood(map, x, z, opt)) continue;
        if (starPts.some(p => Math.hypot(p[0] - x, p[1] - z) < 600)) continue;
        let d = Infinity;
        for (const s of spots) d = Math.min(d, Math.hypot(s[0] - x, s[1] - z));
        // Pair spots now and then (BAR maps often have 2-spot clusters)
        const score = Math.min(d, 900) + rnd() * 120;
        if (d < 180) continue;
        if (score > bs) { bs = score; best = [x, z]; }
      }
      if (!best) break;
      addSpot('metal', best[0], best[1], { metal });
      if (rnd() < (o.pairChance || 0.35) && n + 1 < extra) {
        const ang = rnd() * Math.PI * 2;
        const x2 = best[0] + Math.cos(ang) * 170, z2 = best[1] + Math.sin(ang) * 170;
        if (isGood(map, x2, z2, opt) && sym.src(x2, z2, W, H) && !tooClose(x2, z2, 150)) { addSpot('metal', x2, z2, { metal }); n++; }
      }
    }
    // Level a small pad under every spot so extractors are always buildable.
    for (const ob of map.objects) if ((ob.type === 'metal' || ob.type === 'geo') && ob.sym === 0 && map.slopeAtWorld(ob.x, ob.z) > 6) flattenAround(map, ob.x, ob.z, 40, 70);
    // Geothermal vents
    for (let n = 0; n < o.geos; n++) {
      let best = null, bs = -Infinity;
      for (let t = 0; t < 300; t++) {
        const x = rnd() * W, z = rnd() * H;
        if (!sym.src(x, z, W, H) || !isGood(map, x, z, Object.assign({}, opt, { allowWater: false }))) continue;
        const dStart = Math.min(...starPts.map(p => Math.hypot(p[0] - x, p[1] - z)));
        if (dStart < 500) continue;
        let d = Infinity;
        for (const s of spots) d = Math.min(d, Math.hypot(s[0] - x, s[1] - z));
        if (d < 200) continue;
        const score = -Math.abs(dStart - Math.min(W, H) * 0.3) + rnd() * 200;
        if (score > bs) { bs = score; best = [x, z]; }
      }
      if (best) {
        addSpot('geo', best[0], best[1]);
        if (map.slopeAtWorld(best[0], best[1]) > 6) flattenAround(map, best[0], best[1], 50, 80);
      }
    }
    BMM.Sym.symmetrize(map, 0.01);
  }

  BMM.Terrain = { dab, ramp, falloff, STYLES, generate, terrace, smoothAll, hydraulicErosion, limitSlopes, autoResources, placeStarts, boxBlur };
})();
