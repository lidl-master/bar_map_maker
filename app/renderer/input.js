// Mouse and keyboard: pan/zoom, brush strokes, ramps, placing/moving/deleting objects, shortcuts.
// src/terrain's brush() and ramp() and src/core's addObject() apply the map's symmetry themselves.
import { addObject, moveGroup } from '../../src/core/index.js';
import { brush, ramp } from '../../src/terrain/index.js';
import { $, clamp, toast } from './dom.js';
import { findObject } from './objects.js';
import { PATHING, heightAt } from './sample.js';
import { TOOLS, toolById } from './tools.js';

const OBJECT_TYPES = ['metal', 'geo', 'start'];

/** Union of dirty rects [x0, z0, x1, z1]; either may be null. */
const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

// Shift turns a tool into its opposite.
const SHIFTED = {
  raise: (p) => ['lower', p],
  lower: (p) => ['raise', p],
  noise: (p) => ['noise', { ...p, strength: -p.strength }],
  paint: (p) => ['paint', { ...p, material: 0 }],
};

export function bindInput(editor) {
  const canvas = $('canvas2d'), view = editor.view2d;
  let pan = null, stroke = null, rampDrag = null, drag = null, spaceDown = false;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const pickRadius = () => Math.max(40, 14 / view.scale);
  const pickTypes = () => (toolById(editor.tool).kind === 'place' ? [editor.tool] : OBJECT_TYPES);

  // ---- brush strokes: dabs every frame along the mouse path
  function startStroke(e, w) {
    const doc = editor.doc, s = editor.settings[editor.tool];
    if (editor.tool === 'flatten' && e.altKey) {
      s.target = Math.round(heightAt(doc, w.x, w.z));
      s.fixed = true;
      editor.refreshToolPanel();
      toast(`Flatten height set to ${s.target} elmos`);
      return;
    }
    const params = { ...s, target: s.fixed ? s.target : heightAt(doc, w.x, w.z) };
    const [tool, p] = e.shiftKey && SHIFTED[editor.tool] ? SHIFTED[editor.tool](params) : [editor.tool, params];
    editor.history.begin(doc, tool);
    stroke = { tool, p, last: w, pos: w, time: performance.now(), rect: null };
    strokeStep(1 / 60);
    const loop = () => {
      if (!stroke) return;
      strokeStep(Math.min(0.1, (performance.now() - stroke.time) / 1000));
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  function strokeStep(dt) {
    const doc = editor.doc, { last: a, pos: b, p } = stroke;
    stroke.time = performance.now();
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / Math.max(4, p.radius * 0.25)));
    let rect = null;
    for (let i = 1; i <= n; i++) {
      rect = union(rect, brush(doc, stroke.tool, a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n, p, dt / n));
    }
    stroke.last = b;
    if (rect) {
      stroke.rect = union(stroke.rect, rect);
      editor.terrainChanged(rect);
    }
  }

  // ---- ramps: drag a line from one height to another
  function rampMoved(w) {
    const doc = editor.doc, { a } = rampDrag;
    rampDrag.b = w;
    view.rampPreview = { a, b: w, width: editor.settings.ramp.width };
    const ha = heightAt(doc, a.x, a.z), hb = heightAt(doc, w.x, w.z), len = Math.hypot(w.x - a.x, w.z - a.z);
    const angle = (Math.atan2(Math.abs(hb - ha), Math.max(1, len)) * 180) / Math.PI;
    const who = angle <= PATHING.vehicle ? 'all units' : angle <= PATHING.bot ? 'bots only' : 'too steep for ground units';
    $('hint').textContent = `Ramp: ${Math.round(len)} elmos long, ${Math.round(ha)} → ${Math.round(hb)} elmos, slope ${angle.toFixed(1)}° (${who})`;
  }

  function endRamp() {
    const doc = editor.doc, { a, b } = rampDrag;
    rampDrag = view.rampPreview = null;
    $('hint').textContent = toolById('ramp').hint;
    if (Math.hypot(b.x - a.x, b.z - a.z) < 8) return;
    editor.history.begin(doc, 'ramp');
    const rect = ramp(doc, a, b, editor.settings.ramp);
    editor.terrainChanged(rect);
    editor.commit(rect);
  }

  // ---- objects
  function pickOrPlace(w) {
    const doc = editor.doc, tool = editor.tool;
    const hit = findObject(doc, w.x, w.z, pickRadius(), pickTypes());
    if (tool === 'delete') {
      if (hit) editor.deleteObject(hit);
      return;
    }
    editor.history.begin(doc, hit ? `move ${hit.type}` : `place ${tool}`);
    const placed = !hit && toolById(tool).kind === 'place' ? addObject(doc, tool, w.x, w.z, tool === 'metal' ? { metal: editor.settings.metal.metal } : {})[0] : null;
    const obj = hit ?? placed;
    editor.select(obj);
    if (!obj) {
      editor.history.cancel();
      return;
    }
    drag = { obj, dx: obj.x - w.x, dz: obj.z - w.z, changed: Boolean(placed) };
    if (placed) editor.objectsChanged();
  }

  function endDrag() {
    if (drag.changed) editor.commit(null);
    else editor.history.cancel();
    drag = null;
    editor.refreshToolPanel();
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = local(e), w = view.toWorld(sx, sy), kind = toolById(editor.tool).kind;
    if (e.button === 1 || e.button === 2 || spaceDown) {
      pan = { sx, sy, ox: view.ox, oy: view.oy, button: e.button };
      canvas.style.cursor = 'grabbing';
    } else if (e.button === 0 && kind === 'brush') startStroke(e, w);
    else if (e.button === 0 && kind === 'ramp') rampDrag = { a: w, b: w };
    else if (e.button === 0) pickOrPlace(w);
  });

  canvas.addEventListener('pointermove', (e) => {
    const [sx, sy] = local(e), w = view.toWorld(sx, sy);
    view.cursor = w;
    editor.showCursor(w);
    if (pan) {
      view.ox = pan.ox + sx - pan.sx;
      view.oy = pan.oy + sy - pan.sy;
    } else if (stroke) stroke.pos = w;
    else if (rampDrag) rampMoved(w);
    else if (drag) {
      moveGroup(editor.doc, drag.obj, w.x + drag.dx, w.z + drag.dz);
      drag.changed = true;
      editor.objectsChanged();
    } else if (['pick', 'place'].includes(toolById(editor.tool).kind)) {
      view.hover = findObject(editor.doc, w.x, w.z, pickRadius(), pickTypes());
      canvas.style.cursor = view.hover ? 'move' : 'crosshair';
    }
    view.invalidate();
  });

  function pointerUp(e) {
    if (pan) {
      const [sx, sy] = local(e);
      // A right-click that did not pan deletes the object under the cursor.
      if (pan.button === 2 && Math.hypot(sx - pan.sx, sy - pan.sy) < 5) {
        const w = view.toWorld(sx, sy), hit = findObject(editor.doc, w.x, w.z, pickRadius(), pickTypes());
        if (hit) editor.deleteObject(hit);
      }
      pan = null;
      editor.updateCursor();
    }
    if (stroke) {
      editor.commit(stroke.rect);
      stroke = null;
    }
    if (rampDrag) endRamp();
    if (drag) endDrag();
  }
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('pointerleave', () => {
    view.cursor = null;
    view.invalidate();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const tool = editor.tool, kind = toolById(tool).kind;
    if (e.shiftKey && (kind === 'brush' || kind === 'ramp')) resizeBrush(e.deltaY + e.deltaX < 0 ? 1.1 : 0.9);
    else view.zoomAt(...local(e), 1.0018 ** -e.deltaY);
  }, { passive: false });

  function resizeBrush(factor) {
    const key = editor.tool === 'ramp' ? 'width' : 'radius', s = editor.settings[editor.tool];
    if (s?.[key] === undefined) return;
    s[key] = clamp(Math.round(s[key] * factor), 16, 1500);
    editor.updateCursor();
    editor.refreshToolPanel();
  }

  // ---- keyboard (the prototype's shortcuts)
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || e.target.closest('input, textarea, select')) return;
    const key = e.key.toLowerCase(), tool = !e.altKey && TOOLS.find((t) => t.key.toLowerCase() === key);
    const actions = e.ctrlKey || e.metaKey
      ? {
        z: () => (e.shiftKey ? editor.redo() : editor.undo()),
        y: () => editor.redo(),
        n: () => editor.openNewMap(),
        e: () => $('btnExport').click(),
      }
      : {
        ' ': () => { spaceDown = true; canvas.style.cursor = 'grab'; },
        home: () => view.fit(),
        delete: () => editor.deleteSelected(),
        backspace: () => editor.deleteSelected(),
        '[': () => resizeBrush(0.87),
        ']': () => resizeBrush(1.15),
        ...(tool ? { [key]: () => editor.setTool(tool.id) } : {}),
      };
    if (!actions[key]) return;
    e.preventDefault();
    actions[key]();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key !== ' ') return;
    spaceDown = false;
    editor.updateCursor();
  });
}
