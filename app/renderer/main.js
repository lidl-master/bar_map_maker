// Editor entry: owns the open map, undo history, views and screens; wires the top bar, tabs, status bar and dialogs.
import { History } from '../../src/core/index.js';
import { BIOMES } from '../../src/look/index.js';
import { flushSave, markSaved, saveNow, scheduleSave } from './autosave.js';
import { bindBarActions, exportMap } from './bar-actions.js';
import { $, clamp, hydrateKeys } from './dom.js';
import { bindTooltips, withLoading } from './feedback.js';
import { runJob } from './generator.js';
import { hydrateIcons } from './icons.js';
import { bindInput } from './input.js';
import { loadThumbs } from './materials.js';
import { initNewMap, openNewMap } from './new-map.js';
import { removeGroup } from './objects.js';
import { buildPanels } from './panels.js';
import { loadMap } from './recent.js';
import { openShortcuts } from './shortcuts.js';
import { showCounts, showCursor } from './status.js';
import { brushCursor, buildToolPanel, buildToolbar, defaultToolSettings, markActiveTool, toolById } from './tools.js';
import { View2D } from './view2d.js';
import { View3D } from './view3d.js';
import { flashTool, initViewport, setViewMode } from './viewport.js';
import { initWelcome, refreshWelcome } from './welcome.js';

const view2d = new View2D($('canvas2d'));
const view3d = new View3D($('view3d'), view2d.base);
let view3dTimer = 0, lookTimer = 0;

// The 3D mesh is rebuilt from the whole heightmap, so updates are batched while the user sculpts.
function schedule3d() {
  if (!view3d.visible || view3dTimer) return;
  view3dTimer = setTimeout(() => { view3dTimer = 0; view3d.update(); }, 150);
}

const editor = {
  doc: null,
  docKey: null, // the map's id in the local autosave (recent.js)
  history: new History(),
  view2d,
  tool: 'raise',
  settings: defaultToolSettings(),
  featureSettings: { density: 40, trees: true, rocks: true },
  selected: null,

  showScreen(name) {
    document.body.dataset.screen = name;
    if (name === 'welcome') {
      document.title = 'BAR Map Studio';
      refreshWelcome(editor);
    } else {
      editor.updateTitle();
      view2d.resize(); // now, not on the next frame: openDoc fits the map to this size
      view3d.resize();
    }
  },

  openNewMap,

  async createMap(args, summary) {
    const doc = await withLoading('Generating terrain…', summary, () => runJob('newMap', args));
    if (!doc) return;
    editor.openDoc(doc, crypto.randomUUID());
    saveNow(editor);
  },

  async openRecent(key) {
    if (key === editor.docKey) {
      editor.showScreen('editor');
      return;
    }
    const doc = await withLoading('Opening map…', 'Loading it from this computer', () => loadMap(key));
    if (doc) editor.openDoc(doc, key);
  },

  openDoc(doc, key) {
    if (editor.doc) flushSave(editor); // the previous map's last edits
    Object.assign(editor, { doc, docKey: key, selected: null });
    editor.history.clear();
    editor.showScreen('editor');
    view2d.setDoc(doc);
    view3d.setDoc(doc);
    buildPanels(editor);
    editor.setTool(editor.tool);
    showCounts(doc);
    showCursor(doc, null);
    updateUndoButtons();
    markSaved();
  },

  setTool(id) {
    const tool = toolById(id);
    if (id !== editor.tool) flashTool(tool);
    editor.tool = id;
    if (tool.kind !== 'pick' && tool.kind !== 'place') editor.selected = view2d.selected = null;
    markActiveTool(id);
    editor.updateCursor();
    buildToolPanel(editor);
  },

  /** From the rail and the tool keys: also brings the Tool tab forward. */
  selectTool(id) {
    editor.setTool(id);
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

  resizeBrush(factor) {
    const key = editor.tool === 'ramp' ? 'width' : 'radius', s = editor.settings[editor.tool];
    if (s?.[key] === undefined) return;
    s[key] = clamp(Math.round(s[key] * factor), 16, 1500);
    editor.updateCursor();
    editor.refreshToolPanel();
  },

  /** The map name lives in the top bar and the Map tab; both edit settings.name. */
  updateTitle() {
    const { doc } = editor, name = doc.settings.name;
    if (document.activeElement !== $('mapName')) $('mapName').value = name;
    const field = document.querySelector('[data-field=name]');
    if (field && document.activeElement !== field) field.value = name;
    $('mapMeta').textContent = `${doc.sx} × ${doc.sz} · ${BIOMES[doc.biome].label}`;
    document.title = `${name} — BAR Map Studio`;
  },

  renamed() {
    editor.updateTitle();
    editor.markDirty();
  },

  showCursor: (w) => showCursor(editor.doc, w),
  markDirty: () => scheduleSave(editor),

  /** After heights or paint changed inside rect [x0, z0, x1, z1]. */
  terrainChanged(rect) {
    view2d.render(rect);
    schedule3d();
    editor.markDirty();
  },

  objectsChanged() {
    showCounts(editor.doc);
    view2d.invalidate();
    schedule3d();
    editor.markDirty();
  },

  /** After biome, lava or display mode changed: everything is recoloured (batched, sliders fire often). */
  lookChanged() {
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => {
      editor.terrainChanged();
      editor.updateTitle();
    }, 60);
  },

  commit(rect) {
    editor.history.commit(rect);
    updateUndoButtons();
  },

  /** One undoable step that swaps in generated terrain and resources, plus the symmetry and lava the template set. */
  replaceTerrain(src, label) {
    const doc = editor.doc, all = [0, 0, doc.W - 1, doc.H - 1];
    editor.history.begin(doc, label);
    doc.heights.set(src.heights);
    doc.paint.set(src.paint);
    doc.paintWeight.set(src.paintWeight);
    doc.objects = src.objects;
    doc.symmetry = src.symmetry;
    doc.settings.lava = src.settings.lava;
    editor.commit(all);
    afterDocChange(all);
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

  undo: () => afterHistory(editor.history.undo(editor.doc)),
  redo: () => afterHistory(editor.history.redo(editor.doc)),
  exportMap: () => exportMap(editor),
  setViewMode,
};

function afterHistory(entry) {
  if (!entry) return;
  afterDocChange(entry.rect);
  updateUndoButtons();
}

// After a step that may have replaced objects, symmetry or settings: the panels hold references into the doc, so rebuild them.
function afterDocChange(rect) {
  editor.select(null);
  buildPanels(editor);
  editor.updateTitle();
  if (rect) editor.terrainChanged(rect);
  editor.objectsChanged();
}

function updateUndoButtons() {
  const { undoStack, redoStack } = editor.history;
  $('btnUndo').disabled = !undoStack.length;
  $('btnRedo').disabled = !redoStack.length;
  $('btnUndo').dataset.tip = undoStack.length ? `Undo ${undoStack.at(-1).label}` : 'Nothing to undo';
  $('btnRedo').dataset.tip = redoStack.length ? `Redo ${redoStack.at(-1).label}` : 'Nothing to redo';
}

function showTab(name) {
  for (const b of $('tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const page of document.querySelectorAll('.tabpage')) page.classList.toggle('active', page.id === `tab-${name}`);
}

// ---- boot
hydrateIcons();
hydrateKeys();
bindTooltips();
initViewport({ view2d, view3d });
for (const b of $('tabs').children) b.addEventListener('click', () => showTab(b.dataset.tab));
for (const b of $('viewMode').children) b.addEventListener('click', () => setViewMode(b.dataset.view));
for (const dialog of document.querySelectorAll('dialog')) {
  for (const b of dialog.querySelectorAll('[data-close]')) b.addEventListener('click', () => dialog.close());
}
$('btnHome').addEventListener('click', () => editor.showScreen('welcome'));
$('btnNew').addEventListener('click', () => editor.openNewMap());
$('btnUndo').addEventListener('click', editor.undo);
$('btnRedo').addEventListener('click', editor.redo);
$('btnHelp').addEventListener('click', openShortcuts);
$('mapName').addEventListener('input', () => {
  editor.doc.settings.name = $('mapName').value;
  editor.renamed();
});
$('mapName').addEventListener('change', () => {
  if (!$('mapName').value.trim()) $('mapName').value = editor.doc.settings.name = 'Untitled map';
  editor.renamed();
});
$('mapName').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') $('mapName').blur(); });
new ResizeObserver(() => view2d.resize()).observe($('wrap2d'));
new ResizeObserver(() => view3d.resize()).observe($('wrap3d'));

buildToolbar(editor);
initNewMap((args, summary) => editor.createMap(args, summary));
initWelcome(editor);
bindInput(editor);
bindBarActions(editor);
loadThumbs().catch((error) => console.error(error)).finally(() => editor.showScreen('welcome'));
