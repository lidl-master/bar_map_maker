'use strict';
// 2D top-down editor view: colour/height/pathing rendering + overlays.
var BMM = window.BMM || (window.BMM = {});

(function () {
  const { clamp, smoothstep } = BMM.util;
  const SQ = BMM.SQUARE;

  const TEAM_COLORS = ['#3d8bff', '#ff4d4d', '#38d86b', '#ffd23f', '#c05cff', '#ff8f2e', '#2ee6e6', '#ff66c4',
    '#9be04c', '#7a7aff', '#d9a066', '#ffffff', '#8c8c8c', '#4cc9a0', '#e05c8c', '#b0b0ff'];

  class View2D {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.base = document.createElement('canvas');
      this.baseCtx = this.base.getContext('2d');
      this.mode = 'texture';
      this.zoom = 1; this.ox = 0; this.oy = 0; // screen = world/SQ*zoom + offset
      this.map = null;
      this.overlay = { grid: true, symmetry: true, objects: true, contours: false };
      this.cursor = null;      // {x, z} world
      this.brush = null;       // {radius, color}
      this.rampPreview = null; // [ax, az, bx, bz]
      this.selected = null;
      this.hover = null;
      this._needs = true;
    }

    setMap(map) {
      this.map = map;
      this.base.width = map.W; this.base.height = map.H;
      this.img = this.baseCtx.createImageData(map.W, map.H);
      this.renderBase();
      this.fit();
    }

    resize() {
      const r = this.canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
      this.canvas.style.width = r.width + 'px';
      this.canvas.style.height = r.height + 'px';
      this.invalidate();
    }

    fit() {
      if (!this.map) return;
      const cw = this.canvas.width / this.dpr, ch = this.canvas.height / this.dpr;
      const z = Math.min((cw - 40) / this.map.W, (ch - 40) / this.map.H);
      this.zoom = Math.max(0.05, z);
      this.ox = (cw - this.map.W * this.zoom) / 2;
      this.oy = (ch - this.map.H * this.zoom) / 2;
      this.invalidate();
    }

    toWorld(sx, sy) { return { x: (sx - this.ox) / this.zoom * SQ, z: (sy - this.oy) / this.zoom * SQ }; }
    toScreen(wx, wz) { return { x: wx / SQ * this.zoom + this.ox, y: wz / SQ * this.zoom + this.oy }; }

    zoomAt(sx, sy, factor) {
      const nz = clamp(this.zoom * factor, 0.05, 40);
      const f = nz / this.zoom;
      this.ox = sx - (sx - this.ox) * f;
      this.oy = sy - (sy - this.oy) * f;
      this.zoom = nz;
      this.invalidate();
    }

    invalidate() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
    }

    // Recompute colours for a grid rect (all if omitted).
    renderBase(rect) {
      const map = this.map; if (!map) return;
      const W = map.W, H = map.H;
      let [x0, z0, x1, z1] = rect || [0, 0, W - 1, H - 1];
      x0 = Math.max(0, x0 - 1); z0 = Math.max(0, z0 - 1); x1 = Math.min(W - 1, x1 + 1); z1 = Math.min(H - 1, z1 + 1);
      const d = this.img.data;
      const tx = map.texture, f = BMM.Texture.fields(map);
      const sun = BMM.Texture.sunDir(tx);
      const col = [0, 0, 0];
      const hh = map.heights;
      const st = map.settings;
      const mode = this.mode;
      let lo = 0, hi = 1;
      if (mode === 'height') { const r = this._range || (this._range = map.heightRange()); lo = r[0]; hi = Math.max(r[0] + 1, r[1]); }
      for (let j = z0; j <= z1; j++) {
        for (let i = x0; i <= x1; i++) {
          const k = j * W + i, h = hh[k];
          const slope = map.slopeAt(i, j);
          let r, g, b;
          if (mode === 'height') {
            const t = (h - lo) / (hi - lo);
            const v = 30 + t * 225;
            r = g = b = v;
            const step = 50;
            const a = Math.floor(h / step), bR = Math.floor(map.h(i + 1, j) / step), bD = Math.floor(map.h(i, j + 1) / step);
            if (a !== bR || a !== bD) { r = 255; g = 200; b = 60; }
            if (st.lava && h < st.lavaLevel) { r = 255; g = 90; b = 20; }
            else if (h < 0) { r *= 0.55; g *= 0.7; b = Math.min(255, b * 1.1 + 40); }
          } else if (mode === 'slope') {
            if (st.lava && h < st.lavaLevel) { r = 255; g = 110; b = 0; }
            else if (h < 0) {
              const deep = -h > (st.maxWaterDepth || 20);
              if (deep) { r = 40; g = 80; b = 170; } else { r = 90; g = 150; b = 220; }
            } else if (slope <= st.maxSlopeTank) { r = 64; g = 160; b = 80; }
            else if (slope <= st.maxSlopeBot) { r = 220; g = 190; b = 60; }
            else { r = 200; g = 60; b = 50; }
            const sh = BMM.Texture.shadeAt(map, i, j, sun);
            const m = 0.75 + 0.25 * sh;
            r *= m; g *= m; b *= m;
          } else {
            BMM.Texture.ruleColor(col, tx, h, slope, f.jit[k], f.vary[k], map.paintId[k], map.paintW[k]);
            const sh = BMM.Texture.shadeAt(map, i, j, sun);
            const m = 1 + (sh - 1) * 0.75;
            r = col[0] * m; g = col[1] * m; b = col[2] * m;
            if (st.lava && h < st.lavaLevel) {
              BMM.Texture.lavaColor(col, i * SQ, j * SQ, st.lavaLevel - h);
              r = col[0]; g = col[1]; b = col[2];
            } else if (h < 0 && !st.voidWater) {
              // simple water tint by depth
              const wc = this._waterColor(tx);
              const t = clamp(0.35 + (-h) / 120, 0.35, 0.85);
              r += (wc[0] - r) * t; g += (wc[1] - g) * t; b += (wc[2] - b) * t;
            }
          }
          const o = k * 4;
          d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
        }
      }
      this.baseCtx.putImageData(this.img, 0, 0, x0, z0, x1 - x0 + 1, z1 - z0 + 1);
      this.invalidate();
    }
    _waterColor(tx) {
      const p = BMM.Texture.PALETTES[tx.palette] || BMM.Texture.PALETTES.temperate;
      const b = p.water.base;
      return [b[0] * 255 * 1.2 + 10, b[1] * 255 * 1.2 + 20, b[2] * 255 * 1.2 + 30];
    }
    resetRange() { this._range = null; }

    draw() {
      const ctx = this.ctx, map = this.map;
      const dpr = this.dpr || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0d0f12';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (!map) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = this.zoom < 2;
      ctx.drawImage(this.base, this.ox, this.oy, map.W * this.zoom, map.H * this.zoom);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(this.ox - 0.5, this.oy - 0.5, map.W * this.zoom + 1, map.H * this.zoom + 1);

      const ws = SQ / this.zoom; // elmos per screen px (inverse)
      void ws;
      if (this.overlay.grid) this._drawGrid(ctx);
      if (this.overlay.symmetry) this._drawSymmetry(ctx);
      if (this.overlay.objects) this._drawObjects(ctx);
      if (this.rampPreview) this._drawRamp(ctx);
      if (this.cursor && this.brush) this._drawBrush(ctx);
    }

    _drawGrid(ctx) {
      const map = this.map;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.beginPath();
      for (let u = 0; u <= map.sx; u++) {
        const s = this.toScreen(u * BMM.UNIT, 0);
        ctx.moveTo(Math.round(s.x) + 0.5, this.oy); ctx.lineTo(Math.round(s.x) + 0.5, this.oy + map.H * this.zoom);
      }
      for (let v = 0; v <= map.sz; v++) {
        const s = this.toScreen(0, v * BMM.UNIT);
        ctx.moveTo(this.ox, Math.round(s.y) + 0.5); ctx.lineTo(this.ox + map.W * this.zoom, Math.round(s.y) + 0.5);
      }
      ctx.stroke();
      ctx.restore();
    }

    _drawSymmetry(ctx) {
      const map = this.map, m = BMM.Sym.symMode(map);
      if (m.T.length === 1) return;
      const W = map.worldW, H = map.worldH;
      const lines = [];
      switch (map.symmetry) {
        case 'mirrorX': lines.push([W / 2, 0, W / 2, H]); break;
        case 'mirrorZ': lines.push([0, H / 2, W, H / 2]); break;
        case 'quad': lines.push([W / 2, 0, W / 2, H], [0, H / 2, W, H / 2]); break;
        case 'diag': lines.push([0, 0, W, H]); break;
        case 'adiag': lines.push([W, 0, 0, H]); break;
        case 'rot180': case 'rot90': break;
      }
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = 'rgba(255,220,120,0.75)';
      ctx.lineWidth = 1.5;
      for (const l of lines) {
        const a = this.toScreen(l[0], l[1]), b = this.toScreen(l[2], l[3]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      if (map.symmetry === 'rot180' || map.symmetry === 'rot90') {
        const c = this.toScreen(W / 2, H / 2);
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(c.x, c.y, 10, 0.3, Math.PI * 1.7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(c.x - 4, c.y - 12); ctx.lineTo(c.x + 7, c.y - 7); ctx.lineTo(c.x, c.y - 1); ctx.stroke();
        // shade the mirrored area lightly
      }
      // dim the mirrored (non-editable source) region a touch so users see the "master" side
      ctx.restore();
    }

    _drawObjects(ctx) {
      const map = this.map;
      const z = this.zoom / SQ; // px per elmo
      const er = map.settings.extractorRadius || 90;
      let team = 0;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const o of map.objects) {
        const s = this.toScreen(o.x, o.z);
        const isSel = this.selected && this.selected.group === o.group;
        const isHov = this.hover && this.hover.id === o.id;
        if (o.type === 'metal') {
          const rr = Math.max(4, er * z);
          ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
          ctx.lineWidth = isSel ? 2.5 : 1.5;
          ctx.strokeStyle = isSel ? '#ffffff' : isHov ? '#ffe9a8' : '#d9d9e6';
          ctx.stroke();
          const ir = Math.max(3, 24 * z);
          ctx.beginPath(); ctx.arc(s.x, s.y, ir, 0, Math.PI * 2);
          ctx.fillStyle = '#c9ccd6'; ctx.fill();
          ctx.strokeStyle = '#3a3d48'; ctx.lineWidth = 1; ctx.stroke();
          if (rr > 12) {
            ctx.font = 'bold ' + Math.min(14, Math.max(9, rr * 0.35)) + 'px system-ui, sans-serif';
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
            const txt = (+o.metal).toFixed(1);
            ctx.strokeText(txt, s.x, s.y + rr + 8);
            ctx.fillText(txt, s.x, s.y + rr + 8);
          }
        } else if (o.type === 'geo') {
          const rr = Math.max(6, 40 * z);
          ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,120,30,0.35)'; ctx.fill();
          ctx.lineWidth = isSel ? 2.5 : 1.5;
          ctx.strokeStyle = isSel ? '#fff' : '#ff9a3d'; ctx.stroke();
          ctx.fillStyle = '#ffd08a';
          ctx.font = 'bold ' + Math.max(9, Math.min(14, rr * 0.6)) + 'px system-ui, sans-serif';
          ctx.fillText('G', s.x, s.y + 0.5);
        } else if (o.type === 'start') {
          const col = TEAM_COLORS[team % TEAM_COLORS.length];
          const rr = Math.max(8, 30 * z);
          // build area hint
          ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(rr, 260 * z), 0, Math.PI * 2);
          ctx.strokeStyle = col; ctx.globalAlpha = 0.4; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
          ctx.fillStyle = col; ctx.fill();
          ctx.lineWidth = isSel ? 3 : 2; ctx.strokeStyle = isSel ? '#fff' : 'rgba(0,0,0,0.7)'; ctx.stroke();
          ctx.fillStyle = '#000';
          ctx.font = 'bold ' + Math.max(10, Math.min(16, rr)) + 'px system-ui, sans-serif';
          ctx.fillText(String(team + 1), s.x, s.y + 0.5);
          team++;
        }
      }
      ctx.restore();
    }

    _drawBrush(ctx) {
      const map = this.map, b = this.brush;
      const pts = b.symmetric ? BMM.Sym.orbit(map, this.cursor.x, this.cursor.z) : [[this.cursor.x, this.cursor.z, 0]];
      ctx.save();
      for (const [x, z, k] of pts) {
        const s = this.toScreen(x, z);
        const r = b.radius / SQ * this.zoom;
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = k === 0 ? (b.color || '#fff') : 'rgba(255,255,255,0.45)';
        ctx.setLineDash(k === 0 ? [] : [4, 4]);
        ctx.stroke();
        if (b.hardness !== undefined && k === 0) {
          ctx.beginPath(); ctx.arc(s.x, s.y, r * Math.min(0.98, b.hardness), 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.setLineDash([2, 3]); ctx.stroke();
        }
      }
      ctx.restore();
    }

    _drawRamp(ctx) {
      const [ax, az, bx, bz, width] = this.rampPreview;
      const a = this.toScreen(ax, az), b = this.toScreen(bx, bz);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(80,200,255,0.35)';
      ctx.lineWidth = Math.max(2, width / SQ * this.zoom);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = '#5cd0ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    }
  }

  BMM.View2D = View2D;
  BMM.TEAM_COLORS = TEAM_COLORS;
  void smoothstep;
})();
