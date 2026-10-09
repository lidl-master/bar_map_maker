// Top-down 2D view: the map image (look or pathing colours) plus overlays (grid, symmetry axes, features, markers, brush, ramp).
import { orbit } from '../../src/core/index.js';
import { previewColor } from '../../src/look/index.js';
import { clamp } from './dom.js';
import { iconPaths } from './icons.js';
import { PATHING_LEGEND, SQ, UNIT, pathingClass, worldSize } from './sample.js';

export const TEAM_COLORS = ['#3d8bff', '#ff4d4d', '#38d86b', '#ffd23f', '#c05cff', '#ff8f2e', '#2ee6e6', '#ff66c4',
  '#9be04c', '#7a7aff', '#d9a066', '#ffffff', '#8c8c8c', '#4cc9a0', '#e05c8c', '#b0b0ff'];

const BACKDROP = '#0e1014';
const SELECT = '#7aa5ff';
const FONT = '"Inter", "Segoe UI", sans-serif';
const FLAME = iconPaths('flame');

// Light team colours (yellow, cyan, white…) carry dark numbers.
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
const TEAM_TEXT = TEAM_COLORS.map((c) => (luminance(c) > 0.6 ? '#0e1014' : '#ffffff'));

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
  brush = null; // {radius, hardness, color}
  rampPreview = null; // {a, b, width}
  selected = null;
  hover = null;
  showFeatures = true;
  onDraw = null; // called after every frame (zoom read-out)
  #raf = 0;
  #features = {}; // cached feature paths and what they were built from

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

  /** Centres the whole map in the view, below the overlay bar at the top. */
  fit() {
    if (!this.doc) return;
    const [top, side, bottom] = [56, 24, 24];
    const cw = this.canvas.width / this.dpr - 2 * side, ch = this.canvas.height / this.dpr - top - bottom;
    this.zoom = Math.max(0.05, Math.min(cw / this.doc.W, ch / this.doc.H));
    this.ox = side + (cw - this.doc.W * this.zoom) / 2;
    this.oy = top + (ch - this.doc.H * this.zoom) / 2;
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

  /** Zoom around the middle of the view (toolbar buttons). */
  zoomBy(factor) {
    this.zoomAt(this.canvas.width / this.dpr / 2, this.canvas.height / this.dpr / 2, factor);
  }

  invalidate() {
    this.#raf ||= requestAnimationFrame(() => { this.#raf = 0; this.#draw(); });
  }

  #draw() {
    const { ctx, doc } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!doc) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = doc.W * this.zoom, h = doc.H * this.zoom;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#000';
    ctx.fillRect(this.ox, this.oy, w, h);
    ctx.restore();
    ctx.imageSmoothingEnabled = this.zoom < 2;
    ctx.drawImage(this.base, this.ox, this.oy, w, h);
    this.#drawGrid();
    this.#drawFeatures();
    this.#drawAxes();
    this.#drawObjects();
    if (this.rampPreview) this.#drawRamp();
    if (this.cursor && this.brush) this.#drawBrush();
    this.onDraw?.();
  }

  #line(x0, z0, x1, z1) {
    const a = this.toScreen(x0, z0), b = this.toScreen(x1, z1);
    this.ctx.moveTo(a.x, a.y);
    this.ctx.lineTo(b.x, b.y);
  }

  #drawGrid() {
    const { ctx, doc } = this, [w, h] = worldSize(doc);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    for (let u = 1; u < doc.sx; u++) this.#line(u * UNIT, 0, u * UNIT, h);
    for (let v = 1; v < doc.sz; v++) this.#line(0, v * UNIT, w, v * UNIT);
    ctx.stroke();
    const a = this.toScreen(0, 0), b = this.toScreen(w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.strokeRect(Math.round(a.x) - 0.5, Math.round(a.y) - 0.5, Math.round(b.x - a.x) + 1, Math.round(b.y - a.y) + 1);
  }

  // Trees and rocks: 1k-20k dots, so one path per kind in map-sample units, drawn through the view transform and rebuilt
  // only when the objects or the zoom band change. Far out, each dot keeps about one screen pixel.
  #drawFeatures() {
    if (!this.showFeatures) return;
    const { ctx, doc } = this, band = Math.round(Math.log2(this.zoom) * 2);
    const key = this.#features;
    if (key.objects !== doc.objects || key.length !== doc.objects.length || key.band !== band) {
      const tree = new Path2D(), rock = new Path2D(), min = 1.2 / this.zoom;
      for (const o of doc.objects) {
        if (o.type !== 'feature') continue;
        const isRock = o.name.startsWith('rocks'), size = Math.max(min, (isRock ? 20 : 24) / SQ);
        (isRock ? rock : tree).rect(o.x / SQ - size / 2, o.z / SQ - size / 2, size, size);
      }
      this.#features = { objects: doc.objects, length: doc.objects.length, band, tree, rock };
    }
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.zoom, this.zoom);
    ctx.fillStyle = 'rgba(16, 44, 18, 0.8)';
    ctx.fill(this.#features.tree);
    ctx.fillStyle = 'rgba(176, 170, 158, 0.85)';
    ctx.fill(this.#features.rock);
    ctx.restore();
  }

  #drawAxes() {
    const { ctx, doc } = this, [w, h] = worldSize(doc);
    const path = new Path2D();
    for (const [x0, z0, x1, z1] of AXES[doc.symmetry]?.(w, h) ?? []) {
      const a = this.toScreen(x0, z0), b = this.toScreen(x1, z1);
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
    }
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.stroke(path);
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.stroke(path);
    ctx.setLineDash([]);
    if (doc.symmetry === 'rot180' || doc.symmetry === 'rot90') this.#drawRotationCentre(this.toScreen(w / 2, h / 2));
    ctx.restore();
  }

  #drawRotationCentre(c) {
    const ctx = this.ctx, r = 10;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r + 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14, 16, 20, 0.7)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c.x, c.y, r - 3, -Math.PI * 0.35, Math.PI * 1.25);
    ctx.lineWidth = 1.75;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    const tip = { x: c.x + (r - 3) * Math.cos(-Math.PI * 0.35), y: c.y + (r - 3) * Math.sin(-Math.PI * 0.35) };
    ctx.beginPath();
    ctx.moveTo(tip.x - 4, tip.y - 2.5);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(tip.x - 1, tip.y + 4.5);
    ctx.stroke();
  }

  #ring(s, r, color, width) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  #drawObjects() {
    const { ctx, doc } = this, k = this.scale;
    const selectedGroup = this.selected && (this.selected.group ?? this.selected);
    let team = 0;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const o of doc.objects) {
      if (o.type === 'feature') continue;
      const s = this.toScreen(o.x, o.z);
      const sel = selectedGroup !== null && (o.group ?? o) === selectedGroup;
      const highlight = sel ? SELECT : o === this.hover ? 'rgba(255, 255, 255, 0.9)' : null;
      if (o.type === 'metal') this.#drawMetal(o, s, k, highlight);
      else if (o.type === 'geo') this.#drawGeo(s, k, highlight);
      else if (o.type === 'start') this.#drawStart(s, k, team++, highlight);
    }
    ctx.restore();
  }

  // The extractor's reach as a disc with the spot's metal value inside; too small for text, a dot.
  #drawMetal(o, s, k, highlight) {
    const ctx = this.ctx, r = Math.max(5, this.doc.settings.extractorRadius * k);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14, 16, 20, 0.6)';
    ctx.fill();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgba(233, 237, 245, 0.85)';
    ctx.stroke();
    if (highlight) this.#ring(s, r + 2.5, highlight, 2);
    if (r >= 9) {
      ctx.font = `600 ${Math.round(clamp(r * 0.8, 9, 13))}px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(o.metal.toFixed(1), s.x, s.y + 0.5);
      return;
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#e9edf5';
    ctx.fill();
  }

  #drawGeo(s, k, highlight) {
    const ctx = this.ctx, r = clamp(40 * k, 7, 14);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f2782f';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(14, 16, 20, 0.8)';
    ctx.stroke();
    if (highlight) this.#ring(s, r + 3, highlight, 2);
    const f = (r * 1.25) / 24;
    ctx.save();
    ctx.translate(s.x - 12 * f, s.y - 12 * f);
    ctx.scale(f, f);
    ctx.lineWidth = 1.75 / f; // 1.75 screen px, like the UI icons
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff';
    for (const p of FLAME) ctx.stroke(p);
    ctx.restore();
  }

  #drawStart(s, k, team, highlight) {
    const ctx = this.ctx, r = clamp(30 * k, 9, 16), color = TEAM_COLORS[team % TEAM_COLORS.length];
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = `${color}40`;
    ctx.fill();
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    if (highlight) this.#ring(s, r + 5, highlight, 2);
    ctx.font = `700 ${Math.round(r * 1.05)}px ${FONT}`;
    ctx.fillStyle = TEAM_TEXT[team % TEAM_TEXT.length];
    ctx.fillText(String(team + 1), s.x, s.y + 0.5);
  }

  #drawBrush() {
    const { ctx, brush } = this, r = brush.radius * this.scale;
    ctx.save();
    orbit(this.doc, this.cursor.x, this.cursor.z).forEach(([x, z], n) => {
      const s = this.toScreen(x, z);
      if (n > 0) { // ghosts show where the mirrored copies of the stroke land
        ctx.setLineDash([4, 4]);
        this.#ring(s, r, 'rgba(255, 255, 255, 0.5)', 1);
        ctx.setLineDash([]);
        return;
      }
      this.#ring(s, r, 'rgba(0, 0, 0, 0.45)', 3);
      this.#ring(s, r, brush.color, 1.5);
      if (brush.hardness > 0.05) {
        ctx.setLineDash([2, 4]);
        this.#ring(s, r * brush.hardness, brush.color, 1);
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.75, 0, Math.PI * 2);
      ctx.fillStyle = brush.color;
      ctx.fill();
    });
    ctx.restore();
  }

  #drawRamp() {
    const { ctx } = this, { a, b, width } = this.rampPreview;
    const sa = this.toScreen(a.x, a.z), sb = this.toScreen(b.x, b.z);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(122, 215, 255, 0.28)';
    ctx.lineWidth = Math.max(2, width * this.scale);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    ctx.strokeStyle = '#7ad7ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const s of [sa, sb]) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#0e1014';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}
