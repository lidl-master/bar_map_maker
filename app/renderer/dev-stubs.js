// TEMPORARY stand-in for src/core, src/terrain and src/look (WP 1.3 / WP 1.1), only so the editor can be smoke-tested
// before those land. app/main.js serves this file for any missing src/ module.
// Smoothing agent: delete this file and its line in app/main.js. Crude on purpose; nothing here is the real algorithm.

const UNIT = 512;
const SQ = 8;

// ---- src/core
export function createMap({ sx, sz, symmetry: mode, biome }) {
  const W = 64 * sx + 1, H = 64 * sz + 1, n = W * H;
  return {
    sx, sz, W, H, heights: new Float32Array(n).fill(100), paint: new Uint8Array(n), paintWeight: new Uint8Array(n),
    symmetry: mode, biome, objects: [],
    settings: {
      name: 'New map', version: '1.0', author: '', description: '', minWind: 5, maxWind: 20, tidalStrength: 15,
      gravity: 130, extractorRadius: 90, voidWater: false, lava: { enabled: false, level: 0, damage: 100 }, sunDir: [0.3, 0.8, -0.5],
    },
  };
}

const T = [
  (x, z) => [x, z], (x, z, w) => [w - x, z], (x, z, w, h) => [x, h - z], (x, z, w, h) => [w - x, h - z],
  (x, z, w) => [w - z, x], (x, z, w) => [z, w - x], (x, z) => [z, x], (x, z, w) => [w - z, w - x],
];
const MODES = { none: [0], mirrorX: [0, 1], mirrorZ: [0, 2], rot180: [0, 3], diag: [0, 6], adiag: [0, 7], quad: [0, 1, 2, 3], rot90: [0, 4, 3, 5] };
export const symmetry = {
  orbit(doc, x, z) {
    const out = [];
    for (const k of MODES[doc.symmetry]) {
      const p = T[k](x, z, doc.sx * UNIT, doc.sz * UNIT);
      if (!out.some((q) => Math.abs(q[0] - p[0]) < 1 && Math.abs(q[1] - p[1]) < 1)) out.push(p);
    }
    return out;
  },
};

const snap = (doc) => ({ heights: doc.heights.slice(), paint: doc.paint.slice(), paintWeight: doc.paintWeight.slice(), objects: structuredClone(doc.objects) });
const restore = (doc, s) => { doc.heights.set(s.heights); doc.paint.set(s.paint); doc.paintWeight.set(s.paintWeight); doc.objects = structuredClone(s.objects); };
export class History {
  undoStack = [];
  redoStack = [];
  #pending = null;
  begin(doc, label) { this.#pending = { label, state: snap(doc) }; }
  commit(rect) { if (this.#pending) this.undoStack.push({ ...this.#pending, rect }); this.#pending = null; this.redoStack = []; }
  cancel() { this.#pending = null; }
  clear() { this.undoStack = []; this.redoStack = []; this.#pending = null; }
  undo(doc) { return this.#move(doc, this.undoStack, this.redoStack); }
  redo(doc) { return this.#move(doc, this.redoStack, this.undoStack); }
  #move(doc, from, to) {
    const e = from.pop();
    if (!e) return null;
    const now = snap(doc);
    restore(doc, e.state);
    to.push({ ...e, state: now });
    return e;
  }
}

// ---- src/terrain
export const TEMPLATES = [
  { id: 'flat', label: 'Flat' },
  { id: 'hills', label: 'Rolling hills' },
  { id: 'volcano', label: 'Volcano – King of the Hill' },
];

export function generate(doc, templateId, { seed }) {
  const w = doc.sx * UNIT, h = doc.sz * UNIT;
  const f = {
    flat: () => 100,
    hills: (x, z) => 120 + 80 * Math.sin(x / 700 + seed) * Math.cos(z / 900 - seed) + 40 * Math.sin((x + z) / 300),
    volcano: (x, z) => { const d = Math.hypot(x - w / 2, z - h / 2) / Math.min(w, h); return d < 0.08 ? 40 : 30 + 500 * Math.max(0, 0.45 - d) + 30 * Math.sin(x / 200) * Math.sin(z / 230); },
  }[templateId];
  for (let j = 0; j < doc.H; j++) for (let i = 0; i < doc.W; i++) {
    const images = symmetry.orbit(doc, i * SQ, j * SQ);
    doc.heights[j * doc.W + i] = images.reduce((s, [x, z]) => s + f(x, z), 0) / images.length;
  }
  if (templateId === 'volcano') doc.settings.lava = { enabled: true, level: 60, damage: 100 };
}

export function placeResources(doc, { players }) {
  const w = doc.sx * UNIT, h = doc.sz * UNIT;
  doc.objects = [];
  let id = 1;
  for (let p = 0; p < players; p++) {
    const a = (p / players) * Math.PI * 2, x = w / 2 + Math.cos(a) * w * 0.35, z = h / 2 + Math.sin(a) * h * 0.35;
    doc.objects.push({ id: id++, type: 'start', x, z });
    for (let m = 0; m < 3; m++) doc.objects.push({ id: id++, type: 'metal', x: x + Math.cos(m * 2.1) * 260, z: z + Math.sin(m * 2.1) * 260, metal: 2 });
  }
  doc.objects.push({ id: id++, type: 'geo', x: w / 2 + 400, z: h / 2 });
}

function dabWalk(doc, x, z, radius, visit) {
  const r = radius / SQ, ci = x / SQ, cj = z / SQ;
  const i0 = Math.max(0, Math.floor(ci - r)), i1 = Math.min(doc.W - 1, Math.ceil(ci + r));
  const j0 = Math.max(0, Math.floor(cj - r)), j1 = Math.min(doc.H - 1, Math.ceil(cj + r));
  if (i0 > i1 || j0 > j1) return null;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) visit(j * doc.W + i, i, j, Math.hypot(i - ci, j - cj) / r);
  return [i0, j0, i1, j1];
}

export function brush(doc, tool, x, z, p, dt) {
  const h = doc.heights;
  return dabWalk(doc, x, z, p.radius, (k, i, j, d) => {
    if (d >= 1) return;
    const f = d < p.hardness ? 1 : 1 - (d - p.hardness) / (1 - p.hardness), s = f * p.strength * dt;
    if (tool === 'raise') h[k] += s * 300;
    else if (tool === 'lower') h[k] -= s * 300;
    else if (tool === 'flatten') h[k] += (p.target - h[k]) * Math.min(1, s * 10);
    else if (tool === 'smooth') h[k] += ((h[k - 1] + h[k + 1] + h[k - doc.W] + h[k + doc.W]) / 4 - h[k] || 0) * Math.min(1, s * 20);
    else if (tool === 'roughen') h[k] += s * 300 * Math.sin(i * 12.9898 + j * 78.233 + p.seed);
    else if (tool === 'paint') { doc.paint[k] = p.material; doc.paintWeight[k] = Math.max(doc.paintWeight[k], f * 255); }
  });
}

export function ramp(doc, a, b, { width, hardness }) {
  const at = (q) => doc.heights[Math.round(q.z / SQ) * doc.W + Math.round(q.x / SQ)];
  const ha = at(a), hb = at(b), dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
  return dabWalk(doc, (a.x + b.x) / 2, (a.z + b.z) / 2, Math.sqrt(len2) / 2 + width, (k, i, j) => {
    const t = Math.min(1, Math.max(0, ((i * SQ - a.x) * dx + (j * SQ - a.z) * dz) / len2));
    const d = Math.hypot(a.x + dx * t - i * SQ, a.z + dz * t - j * SQ) / (width / 2);
    if (d < 1) doc.heights[k] += (ha + (hb - ha) * t - doc.heights[k]) * (d < hardness ? 1 : 1 - (d - hardness) / (1 - hardness));
  });
}

// ---- src/look
export const BIOMES = { temperate: { label: 'Temperate' }, volcanic: { label: 'Volcanic' } };

export function previewColor(doc, i, j) {
  const k = j * doc.W + i, h = doc.heights[k], lava = doc.settings.lava;
  if (lava.enabled && h < lava.level) return [255, 96, 20];
  if (h < 0) return [40, 90, 150];
  const shade = 1 + ((doc.heights[k - 1] ?? h) - (doc.heights[k + 1] ?? h)) / 40;
  const base = doc.biome === 'volcanic' ? [70 + h / 6, 60 + h / 8, 55] : [70 + h / 5, 120 + h / 8, 60];
  if (doc.paintWeight[k]) base[0] = base[0] * 0.5 + 100;
  return base.map((c) => Math.max(0, Math.min(255, c * shade)));
}
