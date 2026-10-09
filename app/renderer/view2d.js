// Top-down 2D view: the map image (shaded look, or pathing classes over a hillshade) plus overlays (grid, features,
// symmetry guides, markers with metal labels, brush, ramp).
// An opened BAR map shows its own texture where it has one; its image is also the 3D view's texture.
import { SYMMETRY, orbit } from '../../src/core/index.js';
import { originalColor, originalPreview } from '../../src/import/preview.js';
import { previewColor } from '../../src/look/index.js';
import { clamp } from './dom.js';
import { DRAW_MARKER, HOVER, MARKER_SIZE, SELECT, drawMetalLabel, markerRing } from './markers.js';
import { PATHING_LEGEND, SQ, UNIT, pathingClass, worldSize } from './sample.js';

const BACKDROP = '#0e1014';
const LABEL_ZOOM = 1.5; // from 150 % every metal spot shows its value
const PATHING_CLASSES = Object.keys(PATHING_LEGEND);
const PATHING_ALPHA = 0.65; // class colour over the hillshade
const LIGHT = [-0.45, 0.75, -0.48].map((c, _, v) => c / Math.hypot(...v)); // from the north-west, high: relief reads, the sun is in the north
const DRAW_ORDER = ['metal', 'geo', 'start']; // starts last: the strongest marker sits on top

const AXES = {
  mirrorX: (w, h) => [[w / 2, 0, w / 2, h]],
  mirrorZ: (w, h) => [[0, h / 2, w, h / 2]],
  quad: (w, h) => [[w / 2, 0, w / 2, h], [0, h / 2, w, h / 2]],
  diag: (w, h) => [[0, 0, w, h]],
  adiag: (w, h) => [[w, 0, 0, h]],
};
const ROTATIONAL = new Set(['rot180', 'rot90']);

/** 0..1 light on heightmap sample (i, j). */
function hillshade(doc, i, j) {
  const { W, H, heights: h } = doc, k = j * W + i;
  const dx = (h[k + (i < W - 1 ? 1 : 0)] - h[k - (i > 0 ? 1 : 0)]) / (2 * SQ);
  const dz = (h[k + (j < H - 1 ? W : 0)] - h[k - (j > 0 ? W : 0)]) / (2 * SQ);
  return Math.max(0, (-dx * LIGHT[0] + LIGHT[1] - dz * LIGHT[2]) / Math.hypot(dx, 1, dz));
}

/** The most common metal value on the map: spots with another value always show it. */
function usualMetal(objects) {
  const tally = new Map();
  for (const o of objects) if (o.type === 'metal') tally.set(o.metal, (tally.get(o.metal) ?? 0) + 1);
  let best = null, most = 0;
  for (const [v, n] of tally) if (n > most) [best, most] = [v, n];
  return best;
}

// Markers closer than their sizes push apart on screen (display only; a leader line marks the true spot). Starts are
// the anchors and barely move.
function spread(marks) {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let a = 0; a < marks.length; a++) {
      for (let b = a + 1; b < marks.length; b++) {
        const p = marks[a], q = marks[b], need = p.r + q.r + 1;
        let dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
        if (d >= need) continue;
        if (d < 0.01) [dx, dy, d] = [1, 0, 1];
        const push = (need - d) / (p.weight + q.weight);
        p.x -= (dx / d) * push * p.weight;
        p.y -= (dy / d) * push * p.weight;
        q.x += (dx / d) * push * q.weight;
        q.y += (dy / d) * push * q.weight;
        moved = true;
      }
    }
    if (!moved) return;
  }
}

function hatchPattern(ctx) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 8;
  const t = tile.getContext('2d');
  t.strokeStyle = 'rgba(40, 8, 34, 0.6)';
  t.lineWidth = 2;
  t.beginPath();
  for (const o of [-8, 0, 8]) { t.moveTo(o, 8); t.lineTo(o + 8, 0); }
  t.stroke();
  return ctx.createPattern(tile, 'repeat');
}

export class View2D {
  doc = null;
  original = null; // an opened map's own texture (src/import originalPreview), or null
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
  overlays = { features: true, labels: true, guides: true };
  onDraw = null; // called after every frame (zoom read-out, scale bar)
  onRender = null; // called after the map image changed (pathing legend)
  #raf = 0;
  #features = {}; // cached feature paths and what they were built from
  #classes = null; // pathing class index per sample (pathing mode)
  #hatch = null; // {layer, pattern}: the impassable hatch, drawn in screen space

  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas'); // also the 3D view's texture
    this.baseCtx = this.base.getContext('2d');
    this.mask = document.createElement('canvas'); // impassable samples, for the hatch
    this.maskCtx = this.mask.getContext('2d');
  }

  setDoc(doc) {
    this.doc = doc;
    this.original = doc.original?.tileIndex ? originalPreview(doc.original) : null;
    this.selected = this.hover = null;
    this.base.width = this.mask.width = doc.W;
    this.base.height = this.mask.height = doc.H;
    this.image = this.baseCtx.createImageData(doc.W, doc.H);
    this.maskImage = this.maskCtx.createImageData(doc.W, doc.H);
    this.#classes = new Uint8Array(doc.W * doc.H);
    this.render();
    this.fit();
  }

  /** Recolours the heightmap samples in rect [x0, z0, x1, z1] (whole map when omitted). */
  render(rect = [0, 0, this.doc.W - 1, this.doc.H - 1]) {
    const doc = this.doc, data = this.image.data, mask = this.maskImage.data, pathing = this.mode === 'pathing';
    // One sample of margin: slope and shading read the neighbours.
    const x0 = Math.max(0, rect[0] - 1), z0 = Math.max(0, rect[1] - 1);
    const x1 = Math.min(doc.W - 1, rect[2] + 1), z1 = Math.min(doc.H - 1, rect[3] + 1);
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const k = j * doc.W + i, o = k * 4;
        let rgb;
        if (pathing) {
          const cls = pathingClass(doc, i, j), grey = 36 + 200 * hillshade(doc, i, j);
          this.#classes[k] = PATHING_CLASSES.indexOf(cls);
          mask[o + 3] = cls === 'none' ? 255 : 0;
          rgb = PATHING_LEGEND[cls].color.map((c) => grey + (c - grey) * PATHING_ALPHA);
        } else {
          // An opened map: its own texture with paint and the water / lava tint (originalColor); else the biome preview.
          rgb = (this.original && originalColor(doc, this.original, i, j)) ?? previewColor(doc, i, j);
        }
        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
        data[o + 3] = 255;
      }
    }
    const args = [x0, z0, x1 - x0 + 1, z1 - z0 + 1];
    this.baseCtx.putImageData(this.image, 0, 0, ...args);
    if (pathing) this.maskCtx.putImageData(this.maskImage, 0, 0, ...args);
    this.invalidate();
    this.onRender?.();
  }

  /** The pathing classes on the map (after a pathing render), in legend order. */
  presentClasses() {
    const seen = new Set(this.#classes);
    return PATHING_CLASSES.filter((_, n) => seen.has(n));
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.invalidate();
  }

  /** Centres the whole map in the view, between the overlay bar at the top and the scale bar at the bottom. */
  fit() {
    if (!this.doc) return;
    const [top, side, bottom] = [56, 24, 44];
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

  /** The symmetry centre's tooltip when (sx, sy) is on it, else null. */
  guideAt(sx, sy) {
    const doc = this.doc;
    if (!this.overlays.guides || doc.symmetry === 'none') return null;
    const [w, h] = worldSize(doc), c = this.toScreen(w / 2, h / 2);
    return Math.hypot(sx - c.x, sy - c.y) <= 14 ? `Symmetry centre · ${SYMMETRY[doc.symmetry].label}` : null;
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
    // A soft drop shadow from a few translucent outlines: canvas shadowBlur on a map-sized rect costs a frame.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    for (const grow of [12, 8, 4]) ctx.fillRect(this.ox - grow, this.oy - grow + 4, w + 2 * grow, h + 2 * grow);
    ctx.imageSmoothingEnabled = this.zoom < 2;
    ctx.drawImage(this.base, this.ox, this.oy, w, h);
    if (this.mode === 'pathing') this.#drawHatch(w, h);
    this.#drawGrid();
    if (this.overlays.features) this.#drawFeatures();
    if (this.overlays.guides) this.#drawGuides();
    this.#drawObjects();
    if (this.rampPreview) this.#drawRamp();
    if (this.cursor && this.brush) this.#drawBrush();
    this.onDraw?.();
  }

  // Diagonal hatching over impassable ground, in screen space so it stays crisp at every zoom.
  #drawHatch(w, h) {
    this.#hatch ??= { layer: document.createElement('canvas') };
    const { layer } = this.#hatch, lctx = layer.getContext('2d');
    if (layer.width !== this.canvas.width || layer.height !== this.canvas.height) [layer.width, layer.height] = [this.canvas.width, this.canvas.height];
    this.#hatch.pattern ??= hatchPattern(lctx);
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.imageSmoothingEnabled = this.zoom < 2;
    lctx.drawImage(this.mask, this.ox * this.dpr, this.oy * this.dpr, w * this.dpr, h * this.dpr);
    lctx.globalCompositeOperation = 'source-in';
    lctx.fillStyle = this.#hatch.pattern;
    lctx.fillRect(0, 0, layer.width, layer.height);
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(layer, 0, 0);
    this.ctx.restore();
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
    const { ctx, doc } = this, band = Math.round(Math.log2(this.zoom) * 2);
    const key = this.#features;
    if (key.objects !== doc.objects || key.length !== doc.objects.length || key.band !== band) {
      const tree = new Path2D(), rock = new Path2D(), min = 1.2 / this.zoom;
      for (const o of doc.objects) {
        if (o.type !== 'feature') continue;
        const isRock = o.name.startsWith('rocks'), size = Math.max(min, (isRock ? 18 : 20) / SQ);
        (isRock ? rock : tree).rect(o.x / SQ - size / 2, o.z / SQ - size / 2, size, size);
      }
      this.#features = { objects: doc.objects, length: doc.objects.length, band, tree, rock };
    }
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.zoom, this.zoom);
    ctx.fillStyle = 'rgba(22, 54, 24, 0.75)';
    ctx.fill(this.#features.tree);
    ctx.fillStyle = 'rgba(176, 170, 158, 0.85)';
    ctx.fill(this.#features.rock);
    ctx.restore();
  }

  // Symmetry guides, under the markers: dashed mirror lines, a thin crosshair on the centre and, for rotational
  // symmetry, a small arc with an arrowhead. Quiet (about 50 % white) so they never read as a control.
  #drawGuides() {
    const { ctx, doc } = this, [w, h] = worldSize(doc);
    if (doc.symmetry === 'none') return;
    const c = this.toScreen(w / 2, h / 2), path = new Path2D();
    for (const [x0, z0, x1, z1] of AXES[doc.symmetry]?.(w, h) ?? []) {
      const a = this.toScreen(x0, z0), b = this.toScreen(x1, z1);
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
    }
    path.moveTo(c.x - 9, c.y);
    path.lineTo(c.x + 9, c.y);
    path.moveTo(c.x, c.y - 9);
    path.lineTo(c.x, c.y + 9);
    if (ROTATIONAL.has(doc.symmetry)) {
      const r = 14, a0 = -Math.PI * 0.8, a1 = -Math.PI * 0.15, tip = [c.x + r * Math.cos(a1), c.y + r * Math.sin(a1)];
      path.moveTo(c.x + r * Math.cos(a0), c.y + r * Math.sin(a0));
      path.arc(c.x, c.y, r, a0, a1);
      path.moveTo(tip[0] - 4.5, tip[1] - 1);
      path.lineTo(...tip);
      path.lineTo(tip[0] - 0.5, tip[1] + 4.5);
    }
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.stroke(path);
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.stroke(path);
    ctx.restore();
  }

  #drawObjects() {
    const { ctx, doc } = this, k = this.scale;
    const selectedGroup = this.selected && (this.selected.group ?? this.selected);
    const marks = [];
    let team = 0;
    for (const o of doc.objects) {
      if (o.type === 'feature') continue;
      const s = this.toScreen(o.x, o.z), sel = selectedGroup !== null && (o.group ?? o) === selectedGroup;
      marks.push({
        o, x: s.x, y: s.y, tx: s.x, ty: s.y, r: MARKER_SIZE[o.type] / 2, weight: o.type === 'start' ? 0.1 : 1,
        team: o.type === 'start' ? team++ : 0, highlight: sel ? SELECT : o === this.hover ? HOVER : null,
      });
    }
    spread(marks);
    ctx.save();
    for (const m of marks) { // the true spot of a nudged marker, and the extractor's reach when it matters
      if (Math.hypot(m.x - m.tx, m.y - m.ty) > 2) {
        ctx.beginPath();
        ctx.moveTo(m.tx, m.ty);
        ctx.lineTo(m.x, m.y);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(m.tx, m.ty, 1.75, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      if (m.o.type === 'metal' && (m.highlight || this.zoom >= LABEL_ZOOM)) {
        ctx.setLineDash([3, 3]);
        markerRing(ctx, m.tx, m.ty, doc.settings.extractorRadius * k - 3, 'rgba(255, 255, 255, 0.35)');
        ctx.setLineDash([]);
      }
    }
    for (const type of DRAW_ORDER) {
      for (const m of marks) {
        if (m.o.type !== type) continue;
        DRAW_MARKER[type](ctx, m.x, m.y, m.team);
        if (m.highlight) markerRing(ctx, m.x, m.y, m.r, m.highlight);
      }
    }
    const usual = usualMetal(doc.objects), labels = this.overlays.labels;
    for (const m of marks) {
      const o = m.o;
      if (o.type === 'metal' && (m.highlight || (labels && (this.zoom >= LABEL_ZOOM || o.metal !== usual)))) drawMetalLabel(ctx, m.x, m.y, o.metal.toFixed(1));
    }
    ctx.restore();
  }

  #ring(s, r, color, width) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
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
