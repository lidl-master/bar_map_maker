// Editor entry: owns the current map, undo history and views, and wires the top bar, tabs and status bar.
import { History, createMap } from '../../src/core/index.js';
import { BIOMES } from '../../src/look/index.js';
import { bindBarActions } from './bar-actions.js';
import { $, el, toast } from './dom.js';
import { bindInput } from './input.js';
import { initNewMap, openNewMap } from './new-map.js';
import { counts, removeGroup } from './objects.js';
import { buildPanels } from './panels.js';
import { PATHING_LEGEND, SQ, heightAt, pathingClass, slopeAt, worldSize } from './sample.js';
import { brushCursor, buildToolPanel, buildToolbar, defaultToolSettings, toolById } from './tools.js';
import { View2D } from './view2d.js';
import { View3D } from './view3d.js';

const view2d = new View2D($('canvas2d'));
const view3d = new View3D($('view3d'), view2d.base);
let view3dTimer = 0;
let lookTimer = 0;

// The 3D mesh is rebuilt from the whole heightmap, so updates are batched while the user sculpts.
function schedule3d() {
  if (!view3d.visible || view3dTimer) return;
  view3dTimer = setTimeout(() => { view3dTimer = 0; view3d.update(); }, 150);
}

const editor = {
  doc: null,
  history: new History(),
  view2d,
  tool: 'raise',
  settings: defaultToolSettings(),
  selected: null,
  openNewMap,

  setDoc(doc) {
    editor.doc = doc;
    editor.history.clear();
    editor.selected = null;
    view2d.setDoc(doc);
    view3d.setDoc(doc);
    buildPanels(editor);
    buildToolPanel(editor);
    editor.updateTitle();
    showCounts();
    updateUndoButtons();
  },

  setTool(id) {
    const tool = toolById(id);
    editor.tool = id;
    if (tool.kind !== 'pick' && tool.kind !== 'place') editor.selected = view2d.selected = null;
    for (const b of $('toolbar').querySelectorAll('.tool')) b.classList.toggle('active', b.dataset.tool === id);
    $('hint').textContent = tool.hint;
    editor.updateCursor();
    buildToolPanel(editor);
    showTab('tool');
  },

  select(obj) {
    editor.selected = view2d.selected = obj;
    buildToolPanel(editor);
    view2d.invalidate();
  },

  refreshToolPanel: () => buildToolPanel(editor),

  updateCursor() {
    view2d.brush = brushCursor(editor);
    $('canvas2d').style.cursor = view2d.brush ? 'none' : 'crosshair';
    view2d.invalidate();
  },

  updateTitle() {
    $('mapTitle').textContent = `${editor.doc.settings.name} · ${editor.doc.sx}×${editor.doc.sz}`;
  },

  showCursor(w) {
    const doc = editor.doc, [width, height] = worldSize(doc);
    if (w.x < 0 || w.z < 0 || w.x > width || w.z > height) {
      $('stCursor').textContent = '—';
      $('stSlope').textContent = '';
      return;
    }
    const i = Math.round(w.x / SQ), j = Math.round(w.z / SQ), pathing = pathingClass(doc, i, j);
    $('stCursor').textContent = `x ${Math.round(w.x)}   z ${Math.round(w.z)}   height ${Math.round(heightAt(doc, w.x, w.z))}`;
    $('stSlope').textContent = `slope ${slopeAt(doc, i, j).toFixed(1)}° · ${PATHING_LEGEND[pathing].label}`;
    $('stSlope').className = `pass-${pathing}`;
  },

  /** After heights or paint changed inside rect [x0, z0, x1, z1]. */
  terrainChanged(rect) {
    view2d.render(rect);
    schedule3d();
  },

  objectsChanged() {
    showCounts();
    view2d.invalidate();
    schedule3d();
  },

  /** After biome, lava or display mode changed: everything is recoloured (batched, sliders fire often). */
  lookChanged() {
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => editor.terrainChanged(), 60);
  },

  commit(rect) {
    editor.history.commit(rect);
    updateUndoButtons();
  },

  /** One undoable step that swaps in generated terrain and resources (settings stay). */
  replaceTerrain(src, label) {
    const doc = editor.doc, all = [0, 0, doc.W - 1, doc.H - 1];
    editor.history.begin(doc, label);
    doc.heights.set(src.heights);
    doc.paint.set(src.paint);
    doc.paintWeight.set(src.paintWeight);
    doc.objects = src.objects;
    editor.commit(all);
    editor.select(null);
    editor.terrainChanged(all);
    editor.objectsChanged();
  },

  editObjects(label, change) {
    editor.history.begin(editor.doc, label);
    change();
    editor.commit(null);
    editor.select(null);
    editor.objectsChanged();
  },

  deleteObject(obj) {
    editor.editObjects('delete', () => removeGroup(editor.doc, obj));
  },

  deleteSelected() {
    if (editor.selected) editor.deleteObject(editor.selected);
  },

  undo: () => afterHistory('Undid', editor.history.undo(editor.doc)),
  redo: () => afterHistory('Redid', editor.history.redo(editor.doc)),
};

function afterHistory(verb, entry) {
  if (!entry) return;
  editor.select(null);
  if (entry.rect) editor.terrainChanged(entry.rect);
  editor.objectsChanged();
  updateUndoButtons();
  toast(`${verb}: ${entry.label}`, 1200);
}

function updateUndoButtons() {
  $('btnUndo').disabled = !editor.history.undoStack.length;
  $('btnRedo').disabled = !editor.history.redoStack.length;
}

function showCounts() {
  const c = counts(editor.doc);
  $('stCounts').textContent = `Starts ${c.starts} · Metal spots ${c.metal} (${c.metalTotal.toFixed(1)} metal) · Geos ${c.geos}`;
}

function showTab(name) {
  for (const b of $('tabs').children) b.classList.toggle('active', b.dataset.tab === name);
  for (const page of document.querySelectorAll('.tabpage')) page.classList.toggle('active', page.id === `tab-${name}`);
}

function setDisplayMode(mode) {
  view2d.mode = mode;
  for (const b of $('displayMode').children) b.classList.toggle('active', b.dataset.mode === mode);
  $('legend').hidden = mode !== 'pathing';
  editor.lookChanged();
}

function setViewMode(mode) {
  $('viewport').className = `view-${mode}`;
  for (const b of $('viewMode').children) b.classList.toggle('active', b.dataset.view === mode);
  view3d.visible = mode !== '2d';
  requestAnimationFrame(() => {
    view2d.resize();
    if (mode !== '3d') view2d.fit();
    view3d.resize();
    view3d.update();
  });
}

// ---- boot
$('legend').append(...Object.values(PATHING_LEGEND).map(({ color, label }) => {
  const swatch = el('i');
  swatch.style.background = `rgb(${color})`;
  return el('div', {}, swatch, label);
}));
for (const b of $('tabs').children) b.addEventListener('click', () => showTab(b.dataset.tab));
for (const b of $('displayMode').children) b.addEventListener('click', () => setDisplayMode(b.dataset.mode));
for (const b of $('viewMode').children) b.addEventListener('click', () => setViewMode(b.dataset.view));
$('btnNew').addEventListener('click', openNewMap);
$('btnUndo').addEventListener('click', editor.undo);
$('btnRedo').addEventListener('click', editor.redo);
$('btnFit').addEventListener('click', () => view2d.fit());
new ResizeObserver(() => view2d.resize()).observe($('wrap2d'));
new ResizeObserver(() => view3d.resize()).observe($('wrap3d'));

buildToolbar(editor);
initNewMap(editor);
bindInput(editor);
bindBarActions(editor);
view2d.resize();
editor.setDoc(createMap({ sx: 12, sz: 12, symmetry: 'rot180', biome: Object.keys(BIOMES)[0] }));
editor.setTool('raise');
openNewMap();
