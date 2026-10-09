// Top-down 2D view: the map image (look or pathing colours) plus overlays (grid, symmetry axes, objects, brush, ramp).
import { symmetry } from '../../src/core/index.js';
import { previewColor } from '../../src/look/index.js';
import { clamp } from './dom.js';
import { PATHING_LEGEND, SQ, UNIT, pathingClass, worldSize } from './sample.js';

export const TEAM_COLORS = ['#3d8bff', '#ff4d4d', '#38d86b', '#ffd23f', '#c05cff', '#ff8f2e', '#2ee6e6', '#ff66c4',
  '#9be04c', '#7a7aff', '#d9a066', '#ffffff', '#8c8c8c', '#4cc9a0', '#e05c8c', '#b0b0ff'];

const AXES = {
  mirrorX: (w, h) => [[w / 2, 0, w / 2, h]],
  mirrorZ: (w, h) => [[0, h / 2, w, h / 2]],
  quad: (w, h) => [[w / 2, 0, w / 2, h], [0, h / 2, w, h / 2]],
  diag: (w, h) => [[0, 0, w, h]],
  adiag: (w, h) => [[w, 0, 0, h]],
};

export class View2D {
  doc = null;
  mode = 'look'; // 'look' | 'pathing'
  zoom = 1; // screen px per heightmap sample
  ox = 0;
  oy = 0;
  dpr = 1;
  cursor = null; // {x, z} in elmos
  brush = null; // {radius, color}
  rampPreview = null; // {a, b, width}
  selected = null;
  hover = null;
  #raf = 0;

  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas'); // also the 3D view's texture
    this.baseCtx = this.base.getContext('2d');
  }

  setDoc(doc) {
    this.doc = doc;
    this.selected = this.hover = null;
    this.base.width = doc.W;
    this.base.height = doc.H;
    this.image = this.baseCtx.createImageData(doc.W, doc.H);
    this.render();
    this.fit();
  }

  /** Recolours the heightmap samples in rect [x0, z0, x1, z1] (whole map when omitted). */
  render(rect = [0, 0, this.doc.W - 1, this.doc.H - 1]) {
    const doc = this.doc, data = this.image.data;
    // One sample of margin: slope and shading read the neighbours.
    const x0 = Math.max(0, rect[0] - 1), z0 = Math.max(0, rect[1] - 1);
    const x1 = Math.min(doc.W - 1, rect[2] + 1), z1 = Math.min(doc.H - 1, rect[3] + 1);
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const rgb = this.mode === 'pathing' ? PATHING_LEGEND[pathingClass(doc, i, j)].color : previewColor(doc, i, j);
        const o = (j * doc.W + i) * 4;
        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
        data[o + 3] = 255;
      }
    }
    this.baseCtx.putImageData(this.image, 0, 0, x0, z0, x1 - x0 + 1, z1 - z0 + 1);
    this.invalidate();
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.invalidate();
  }

  fit() {
    const cw = this.canvas.width / this.dpr, ch = this.canvas.height / this.dpr;
    this.zoom = Math.max(0.05, Math.min((cw - 40) / this.doc.W, (ch - 40) / this.doc.H));
    this.ox = (cw - this.doc.W * this.zoom) / 2;
    this.oy = (ch - this.doc.H * this.zoom) / 2;
    this.invalidate();
  }

  toWorld(sx, sy) { return { x: ((sx - this.ox) / this.zoom) * SQ, z: ((sy - this.oy) / this.zoom) * SQ }; }
  toScreen(x, z) { return { x: (x / SQ) * this.zoom + this.ox, y: (z / SQ) * this.zoom + this.oy }; }
  /** Screen px per elmo. */
  get scale() { return this.zoom / SQ; }

  zoomAt(sx, sy, factor) {
    const z = clamp(this.zoom * factor, 0.05, 40), f = z / this.zoom;
    this.ox = sx - (sx - this.ox) * f;
    this.oy = sy - (sy - this.oy) * f;
    this.zoom = z;
    this.invalidate();
  }

  invalidate() {
    this.#raf ||= requestAnimationFrame(() => { this.#raf = 0; this.#draw(); });
  }

  #draw() {
    const { ctx, doc } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!doc) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = this.zoom < 2;
    ctx.drawImage(this.base, this.ox, this.oy, doc.W * this.zoom, doc.H * this.zoom);
    this.#drawGrid();
    this.#drawAxes();
    this.#drawObjects();
    if (this.rampPreview) this.#drawRamp();
    if (this.cursor && this.brush) this.#drawBrush();
  }

  #line(x0, z0, x1, z1) {
    const a = this.toScreen(x0, z0), b = this.toScreen(x1, z1);
    this.ctx.moveTo(a.x, a.y);
    this.ctx.lineTo(b.x, b.y);
  }

  #drawGrid() {
    const { ctx, doc } = this, [w, h] = worldSize(doc);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let u = 0; u <= doc.sx; u++) this.#line(u * UNIT, 0, u * UNIT, h);
    for (let v = 0; v <= doc.sz; v++) this.#line(0, v * UNIT, w, v * UNIT);
    ctx.stroke();
  }

  #drawAxes() {
    const { ctx, doc } = this, [w, h] = worldSize(doc);
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = 'rgba(255,220,120,0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const axis of AXES[doc.symmetry]?.(w, h) ?? []) this.#line(...axis);
    if (doc.symmetry === 'rot180' || doc.symmetry === 'rot90') {
      const c = this.toScreen(w / 2, h / 2);
      ctx.moveTo(c.x + 10, c.y);
      ctx.arc(c.x, c.y, 10, 0, Math.PI * 1.6);
    }
    ctx.stroke();
    ctx.restore();
  }

  #label(text, x, y, size) {
    const ctx = this.ctx;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
  }

  #drawObjects() {
    const { ctx, doc } = this, k = this.scale;
    const selectedGroup = this.selected && (this.selected.group ?? this.selected);
    let team = 0;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const o of doc.objects) {
      const s = this.toScreen(o.x, o.z);
      const sel = selectedGroup !== null && (o.group ?? o) === selectedGroup;
      const ring = sel ? '#ffffff' : o === this.hover ? '#ffe9a8' : null;
      ctx.beginPath();
      if (o.type === 'metal') {
        const r = Math.max(4, doc.settings.extractorRadius * k);
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fill();
        ctx.lineWidth = sel ? 2.5 : 1.5;
        ctx.strokeStyle = ring ?? '#d9d9e6';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(3, 24 * k), 0, Math.PI * 2);
        ctx.fillStyle = '#c9ccd6';
        ctx.fill();
        if (r > 12) this.#label(o.metal.toFixed(1), s.x, s.y + r + 8, clamp(r * 0.35, 9, 14));
      } else if (o.type === 'geo') {
        const r = Math.max(6, 40 * k);
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,120,30,0.35)';
        ctx.fill();
        ctx.lineWidth = sel ? 2.5 : 1.5;
        ctx.strokeStyle = ring ?? '#ff9a3d';
        ctx.stroke();
        this.#label('G', s.x, s.y, clamp(r * 0.6, 9, 14));
      } else if (o.type === 'start') {
        const r = Math.max(8, 30 * k);
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = TEAM_COLORS[team % TEAM_COLORS.length];
        ctx.fill();
        ctx.lineWidth = sel ? 3 : 2;
        ctx.strokeStyle = ring ?? 'rgba(0,0,0,0.7)';
        ctx.stroke();
        this.#label(String(++team), s.x, s.y, clamp(r, 10, 16));
      }
    }
    ctx.restore();
  }

  #drawBrush() {
    const { ctx, brush } = this, r = brush.radius * this.scale;
    ctx.save();
    ctx.lineWidth = 1.5;
    symmetry.orbit(this.doc, this.cursor.x, this.cursor.z).forEach(([x, z], k) => {
      const s = this.toScreen(x, z);
      ctx.strokeStyle = k === 0 ? brush.color : 'rgba(255,255,255,0.45)';
      ctx.setLineDash(k === 0 ? [] : [4, 4]); // ghosts show where the mirrored copies of the stroke land
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }

  #drawRamp() {
    const { ctx } = this, { a, b, width } = this.rampPreview;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(80,200,255,0.35)';
    ctx.lineWidth = Math.max(2, width * this.scale);
    ctx.beginPath();
    this.#line(a.x, a.z, b.x, b.z);
    ctx.stroke();
    ctx.strokeStyle = '#5cd0ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}
