'use strict';
// Map data model, symmetry and undo history.
var BMM = window.BMM || (window.BMM = {});

(function () {
  const SQUARE = 8;          // elmos per heightmap square (engine constant)
  const UNIT = 512;          // elmos per map-size unit ("8x8" map = 4096 elmos wide)

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------------------------------------------------------------- Symmetry
  // Transforms take (x, y, ex, ey) where ex/ey are the domain extents (1 for normalized,
  // W-1 for grid indices, worldW for elmos). All modes form groups, so the orbit of a point
  // is {T_k(p)} and inv[k] gives the index of T_k's inverse.
  const I = (x, y) => [x, y];
  const MX = (x, y, ex) => [ex - x, y];
  const MZ = (x, y, ex, ey) => [x, ey - y];
  const R180 = (x, y, ex, ey) => [ex - x, ey - y];
  const R90 = (x, y, ex) => [ex - y, x];
  const R270 = (x, y, ex) => [y, ex - x];
  const DIAG = (x, y) => [y, x];
  const ADIAG = (x, y, ex) => [ex - y, ex - x];

  const SYMMETRY = {
    none:    { label: 'None (free-form)', T: [I], inv: [0], src: () => true },
    mirrorX: { label: 'Mirror left ↔ right', T: [I, MX], inv: [0, 1], src: (i, j, a) => 2 * i <= a },
    mirrorZ: { label: 'Mirror top ↕ bottom', T: [I, MZ], inv: [0, 1], src: (i, j, a, b) => 2 * j <= b },
    rot180:  { label: 'Rotate 180° (point)', T: [I, R180], inv: [0, 1], src: (i, j, a, b) => 2 * i < a || (2 * i === a && 2 * j <= b) },
    diag:    { label: 'Mirror diagonal ╲', square: true, T: [I, DIAG], inv: [0, 1], src: (i, j) => i >= j },
    adiag:   { label: 'Mirror diagonal ╱', square: true, T: [I, ADIAG], inv: [0, 1], src: (i, j, a) => i + j <= a },
    quad:    { label: 'Quad mirror (4 corners)', T: [I, MX, MZ, R180], inv: [0, 1, 2, 3], src: (i, j, a, b) => 2 * i <= a && 2 * j <= b },
    rot90:   { label: 'Rotate 90° (4-way)', square: true, T: [I, R90, R180, R270], inv: [0, 3, 2, 1], src: (i, j, a, b) => 2 * i < a && 2 * j <= b },
  };

  function symMode(map) {
    const m = SYMMETRY[map.symmetry] || SYMMETRY.none;
    if (m.square && map.W !== map.H) return SYMMETRY.none;
    return m;
  }

  // World-space orbit of a point (elmos), de-duplicated.
  function orbit(map, x, z, mode) {
    const m = mode ? (SYMMETRY[mode] || SYMMETRY.none) : symMode(map);
    const ex = map.worldW, ez = map.worldH;
    const out = [];
    for (let k = 0; k < m.T.length; k++) {
      const p = m.T[k](x, z, ex, ez);
      let dup = false;
      for (const q of out) if (Math.abs(q[0] - p[0]) < 1 && Math.abs(q[1] - p[1]) < 1) { dup = true; break; }
      if (!dup) out.push([p[0], p[1], k]);
    }
    return out;
  }

  // Copy the source domain onto all mirrored parts for the given layers.
  function enforceSymmetry(map, layers) {
    const m = symMode(map);
    if (m.T.length === 1) return;
    const W = map.W, H = map.H, a = W - 1, b = H - 1;
    layers = layers || [map.heights, map.paintId, map.paintW];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (m.src(i, j, a, b)) continue;
        for (let k = 1; k < m.T.length; k++) {
          const q = m.T[k](i, j, a, b);
          if (m.src(q[0], q[1], a, b)) {
            const s = q[1] * W + q[0], d = j * W + i;
            for (const L of layers) L[d] = L[s];
            break;
          }
        }
      }
    }
  }

  // How deep (normalized units) a point lies inside each mode's source domain; <0 = outside.
  const DEPTH = {
    mirrorX: (u) => 0.5 - u,
    mirrorZ: (u, v) => 0.5 - v,
    rot180: (u) => 0.5 - u,
    diag: (u, v) => (u - v) * 0.7071,
    adiag: (u, v) => (1 - u - v) * 0.7071,
    quad: (u, v) => Math.min(0.5 - u, 0.5 - v),
    rot90: (u, v) => Math.min(0.5 - u, 0.5 - v),
  };

  // Seamless symmetrisation of a float layer: every cell becomes a weighted average over its
  // orbit, weighted by a smooth "inside the source domain" factor. The result is exactly
  // symmetric (the orbit is a group) and continuous across the symmetry axes.
  function blendSymmetry(map, arr, width) {
    const m = symMode(map);
    if (m.T.length === 1) return;
    const depth = DEPTH[map.symmetry];
    const W = map.W, H = map.H, a = W - 1, b = H - 1, n = m.T.length;
    const bw = width || 0.03;
    const src = arr.slice();
    const qi = new Int32Array(n), wt = new Float32Array(n);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        let sw = 0;
        for (let k = 0; k < n; k++) {
          const q = m.T[k](i, j, a, b);
          qi[k] = q[1] * W + q[0];
          const d = depth(q[0] / a, q[1] / b);
          const t = Math.min(1, Math.max(0, (d + bw) / (2 * bw)));
          wt[k] = t * t * (3 - 2 * t) + 1e-6;
          sw += wt[k];
        }
        let v = 0;
        for (let k = 0; k < n; k++) v += src[qi[k]] * wt[k];
        arr[j * W + i] = v / sw;
      }
    }
  }

  // Make the whole map symmetric: heights blended seamlessly, paint layers copied.
  function symmetrize(map, width) {
    blendSymmetry(map, map.heights, width || 0.02);
    enforceSymmetry(map, [map.paintId, map.paintW]);
  }

  // ---------------------------------------------------------------- Map data
  function defaultSettings() {
    return {
      name: 'My BAR Map',
      version: '1.0',
      author: '',
      description: 'A map made with BAR Map Maker',
      // maxMetal is derived automatically at export so spot values display exactly.
      extractorRadius: 90,
      defaultMetal: 2.0,
      tidalStrength: 15,
      gravity: 130,
      minWind: 5,
      maxWind: 20,
      voidWater: false,
      lava: false,              // BAR lava (mapconfig/lava.lua): terrain below lavaLevel is lava
      lavaLevel: 60,
      lavaDamage: 100,
      // Pathing overlay thresholds (degrees) from BAR gamedata/movedefs.lua:
      // tanks 27, hovers 33, bots 54; land units wade up to 20 elmos of water.
      maxSlopeTank: 27,
      maxSlopeBot: 54,
      maxWaterDepth: 20,
      atmosphereFromPalette: true,
    };
  }

  class MapData {
    constructor(sx, sz) {
      this.sx = sx; this.sz = sz;
      this.W = 64 * sx + 1; this.H = 64 * sz + 1;
      const n = this.W * this.H;
      this.heights = new Float32Array(n);
      this.paintId = new Uint8Array(n);
      this.paintW = new Uint8Array(n);
      this.objects = [];
      this.nextId = 1;
      this.nextGroup = 1;
      this.symmetry = 'none';
      this.settings = defaultSettings();
      this.texture = BMM.Texture.defaultTextureSettings('temperate');
      this.revision = 0;
    }
    get worldW() { return this.sx * UNIT; }
    get worldH() { return this.sz * UNIT; }

    h(i, j) {
      i = i < 0 ? 0 : i >= this.W ? this.W - 1 : i;
      j = j < 0 ? 0 : j >= this.H ? this.H - 1 : j;
      return this.heights[j * this.W + i];
    }
    // Bilinear height at grid coordinates (fractional).
    sampleGrid(gx, gz) {
      const W = this.W, H = this.H;
      gx = clamp(gx, 0, W - 1.0001); gz = clamp(gz, 0, H - 1.0001);
      const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
      const k = j * W + i, hh = this.heights;
      const a = hh[k], b = hh[k + 1], c = hh[k + W], d = hh[k + W + 1];
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    }
    sampleHeight(wx, wz) { return this.sampleGrid(wx / SQUARE, wz / SQUARE); }

    // Terrain slope in degrees at a grid vertex (central differences over 2 squares).
    slopeAt(i, j) {
      const dx = (this.h(i + 1, j) - this.h(i - 1, j)) / (2 * SQUARE);
      const dz = (this.h(i, j + 1) - this.h(i, j - 1)) / (2 * SQUARE);
      return Math.atan(Math.sqrt(dx * dx + dz * dz)) * 57.29578;
    }
    slopeAtWorld(wx, wz) {
      return this.slopeAt(Math.round(wx / SQUARE), Math.round(wz / SQUARE));
    }

    heightRange() {
      let lo = Infinity, hi = -Infinity;
      const hh = this.heights;
      for (let k = 0; k < hh.length; k++) { const v = hh[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
      return [lo, hi];
    }

    // ---- objects (metal spots, geothermal vents, start positions)
    addObject(type, x, z, props) {
      const group = this.nextGroup++;
      const mode = symMode(this) === SYMMETRY.none ? 'none' : this.symmetry;
      const created = [];
      for (const [px, pz, k] of orbit(this, x, z, mode)) {
        const o = Object.assign({ id: this.nextId++, type, x: px, z: pz, group, sym: k, mode }, props || {});
        this.objects.push(o);
        created.push(o);
      }
      return created;
    }
    groupOf(obj) { return this.objects.filter(o => o.group === obj.group); }
    moveObject(obj, x, z) {
      const m = SYMMETRY[obj.mode] || SYMMETRY.none;
      const ex = this.worldW, ez = this.worldH;
      x = clamp(x, 0, ex); z = clamp(z, 0, ez);
      const src = m.T[m.inv[obj.sym]](x, z, ex, ez);
      for (const o of this.groupOf(obj)) {
        const p = m.T[o.sym](src[0], src[1], ex, ez);
        o.x = p[0]; o.z = p[1];
      }
    }
    setGroupProp(obj, key, value) { for (const o of this.groupOf(obj)) o[key] = value; }
    removeGroup(obj) { this.objects = this.objects.filter(o => o.group !== obj.group); }
    objectsOf(type) { return this.objects.filter(o => o.type === type); }
    findObjectNear(x, z, radius, types) {
      let best = null, bd = radius * radius;
      for (const o of this.objects) {
        if (types && types.indexOf(o.type) < 0) continue;
        const d = (o.x - x) ** 2 + (o.z - z) ** 2;
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }

    // Resample all grid layers to a new map size.
    resized(sx, sz) {
      const m = new MapData(sx, sz);
      const fx = (this.W - 1) / (m.W - 1), fz = (this.H - 1) / (m.H - 1);
      for (let j = 0; j < m.H; j++) for (let i = 0; i < m.W; i++) {
        const k = j * m.W + i;
        m.heights[k] = this.sampleGrid(i * fx, j * fz);
        const src = Math.round(j * fz) * this.W + Math.round(i * fx);
        m.paintId[k] = this.paintId[src]; m.paintW[k] = this.paintW[src];
      }
      const sxw = m.worldW / this.worldW, szw = m.worldH / this.worldH;
      m.objects = this.objects.map(o => Object.assign({}, o, { x: o.x * sxw, z: o.z * szw }));
      m.nextId = this.nextId; m.nextGroup = this.nextGroup;
      m.symmetry = this.symmetry;
      m.settings = Object.assign({}, this.settings);
      m.texture = JSON.parse(JSON.stringify(this.texture));
      return m;
    }
  }

  // ---------------------------------------------------------------- History
  // Each entry stores only the changed rectangle of the grid layers plus an optional
  // object-list snapshot, so long sculpting sessions on big maps stay cheap.
  class History {
    constructor(limitBytes) {
      this.undoStack = []; this.redoStack = [];
      this.limitBytes = limitBytes || 400e6;
      this.pending = null;
    }
    clear() { this.undoStack = []; this.redoStack = []; this.pending = null; }

    // Snapshot everything before an edit; call commit() afterwards with the dirty rect.
    begin(map, label) {
      this.pending = {
        label, map,
        heights: map.heights.slice(), paintId: map.paintId.slice(), paintW: map.paintW.slice(),
        objects: JSON.stringify(map.objects), symmetry: map.symmetry,
      };
    }
    commit(rect) {
      const p = this.pending; if (!p) return;
      this.pending = null;
      const map = p.map;
      const entry = { label: p.label, rect: null, bytes: 0 };
      if (rect) {
        const x0 = Math.max(0, rect[0] | 0), z0 = Math.max(0, rect[1] | 0);
        const x1 = Math.min(map.W - 1, Math.ceil(rect[2])), z1 = Math.min(map.H - 1, Math.ceil(rect[3]));
        if (x1 >= x0 && z1 >= z0) {
          entry.rect = [x0, z0, x1, z1];
          entry.before = extract(map, p, entry.rect);
          entry.after = extract(map, map, entry.rect);
          entry.bytes = (x1 - x0 + 1) * (z1 - z0 + 1) * 12;
        }
      }
      const objsNow = JSON.stringify(map.objects);
      if (objsNow !== p.objects || p.symmetry !== map.symmetry) {
        entry.objBefore = p.objects; entry.objAfter = objsNow;
        entry.symBefore = p.symmetry; entry.symAfter = map.symmetry;
        entry.bytes += objsNow.length * 2;
      }
      if (!entry.rect && !entry.objBefore) return;
      this.undoStack.push(entry);
      this.redoStack = [];
      let total = this.undoStack.reduce((s, e) => s + e.bytes, 0);
      while ((total > this.limitBytes || this.undoStack.length > 100) && this.undoStack.length > 1) {
        total -= this.undoStack.shift().bytes;
      }
    }
    cancel() { this.pending = null; }

    undo(map) { return this._apply(map, this.undoStack, this.redoStack, 'before'); }
    redo(map) { return this._apply(map, this.redoStack, this.undoStack, 'after'); }
    _apply(map, from, to, which) {
      const e = from.pop(); if (!e) return null;
      if (e.rect) restore(map, e.rect, e[which]);
      if (e.objBefore) {
        map.objects = JSON.parse(which === 'before' ? e.objBefore : e.objAfter);
        map.symmetry = which === 'before' ? e.symBefore : e.symAfter;
      }
      to.push(e);
      return e;
    }
  }

  function extract(map, src, r) {
    const [x0, z0, x1, z1] = r, w = x1 - x0 + 1, W = map.W;
    const out = { heights: new Float32Array(w * (z1 - z0 + 1)), paintId: new Uint8Array(w * (z1 - z0 + 1)), paintW: new Uint8Array(w * (z1 - z0 + 1)) };
    for (let z = z0; z <= z1; z++) {
      const s = z * W + x0, d = (z - z0) * w;
      out.heights.set(src.heights.subarray(s, s + w), d);
      out.paintId.set(src.paintId.subarray(s, s + w), d);
      out.paintW.set(src.paintW.subarray(s, s + w), d);
    }
    return out;
  }
  function restore(map, r, data) {
    const [x0, z0, x1, z1] = r, w = x1 - x0 + 1, W = map.W;
    for (let z = z0; z <= z1; z++) {
      const d = z * W + x0, s = (z - z0) * w;
      map.heights.set(data.heights.subarray(s, s + w), d);
      map.paintId.set(data.paintId.subarray(s, s + w), d);
      map.paintW.set(data.paintW.subarray(s, s + w), d);
    }
  }

  BMM.SQUARE = SQUARE;
  BMM.UNIT = UNIT;
  BMM.util = { clamp, smoothstep, lerp };
  BMM.SYMMETRY = SYMMETRY;
  BMM.Sym = { orbit, enforceSymmetry, blendSymmetry, symmetrize, symMode };
  BMM.MapData = MapData;
  BMM.History = History;
  BMM.defaultSettings = defaultSettings;
})();
