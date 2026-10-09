// Undo/redo. Each entry keeps only the changed rectangle of the grid layers plus, when they
// changed, JSON snapshots of objects / symmetry / settings, so long sculpting sessions stay cheap.
const LAYERS = ['heights', 'paint', 'paintWeight'];
const LIMIT_BYTES = 400e6, MAX_ENTRIES = 100;

const meta = (doc) => JSON.stringify({ objects: doc.objects, symmetry: doc.symmetry, settings: doc.settings });

export class History {
  undoStack = [];
  redoStack = [];
  pending = null;

  clear() { this.undoStack = []; this.redoStack = []; this.pending = null; }

  /** Snapshot before an edit; call commit(dirtyRect) afterwards (null rect = objects/settings only). */
  begin(doc, label) {
    this.pending = { doc, label, layers: LAYERS.map((k) => doc[k].slice()), meta: meta(doc) };
  }

  cancel() { this.pending = null; }

  /** @param {[number, number, number, number]|null} rect grid [x0, z0, x1, z1], inclusive */
  commit(rect) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    const { doc } = p, entry = { label: p.label, rect: null, bytes: 0 };
    if (rect) {
      const x0 = Math.max(0, rect[0] | 0), z0 = Math.max(0, rect[1] | 0);
      const x1 = Math.min(doc.W - 1, Math.ceil(rect[2])), z1 = Math.min(doc.H - 1, Math.ceil(rect[3]));
      if (x1 >= x0 && z1 >= z0) {
        entry.rect = [x0, z0, x1, z1];
        entry.before = p.layers.map((L) => extract(doc, L, entry.rect));
        entry.after = LAYERS.map((k) => extract(doc, doc[k], entry.rect));
        entry.bytes = (x1 - x0 + 1) * (z1 - z0 + 1) * 12;
      }
    }
    const now = meta(doc);
    if (now !== p.meta) { entry.metaBefore = p.meta; entry.metaAfter = now; entry.bytes += now.length * 4; }
    if (!entry.rect && !entry.metaBefore) return;
    this.undoStack.push(entry);
    this.redoStack = [];
    let total = this.undoStack.reduce((s, e) => s + e.bytes, 0);
    while ((total > LIMIT_BYTES || this.undoStack.length > MAX_ENTRIES) && this.undoStack.length > 1) total -= this.undoStack.shift().bytes;
  }

  /** Returns the undone entry ({label, rect, ...}) or null. */
  undo(doc) { return apply(doc, this.undoStack, this.redoStack, 'before'); }
  redo(doc) { return apply(doc, this.redoStack, this.undoStack, 'after'); }
}

function apply(doc, from, to, which) {
  const e = from.pop();
  if (!e) return null;
  if (e.rect) LAYERS.forEach((k, n) => restore(doc, doc[k], e.rect, e[which][n]));
  if (e.metaBefore) Object.assign(doc, JSON.parse(which === 'before' ? e.metaBefore : e.metaAfter));
  to.push(e);
  return e;
}

function extract(doc, layer, [x0, z0, x1, z1]) {
  const w = x1 - x0 + 1, out = new layer.constructor(w * (z1 - z0 + 1));
  for (let z = z0; z <= z1; z++) out.set(layer.subarray(z * doc.W + x0, z * doc.W + x0 + w), (z - z0) * w);
  return out;
}

function restore(doc, layer, [x0, z0, x1, z1], data) {
  const w = x1 - x0 + 1;
  for (let z = z0; z <= z1; z++) layer.set(data.subarray((z - z0) * w, (z - z0 + 1) * w), z * doc.W + x0);
}
