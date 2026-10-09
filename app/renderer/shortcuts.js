// Every shortcut in one table: input.js dispatches the keyed ones, the ? overlay lists all of them (keys and mouse gestures).
import { $, el, keys } from './dom.js';
import { TOOLS } from './tools.js';

// keys: the key caps the overlay shows ('Ctrl+Y', or alternatives as an array); mouse: a gesture in plain text.
// combo: the normalised key(s) that run it (see comboOf). global: also works on the welcome screen.
const SHORTCUTS = [
  { group: 'File', label: 'New map', keys: 'Ctrl+N', combo: 'ctrl+n', global: true, run: (app) => app.openNewMap() },
  { group: 'File', label: 'Export', keys: 'Ctrl+E', combo: 'ctrl+e', run: (app) => app.exportMap() },
  { group: 'Edit', label: 'Undo', keys: 'Ctrl+Z', combo: 'ctrl+z', run: (app) => app.undo() },
  { group: 'Edit', label: 'Redo', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], combo: ['ctrl+y', 'ctrl+shift+z'], run: (app) => app.redo() },
  { group: 'Edit', label: 'Delete selection', keys: 'Del', combo: 'delete', run: (app) => app.deleteSelected() },
  { group: 'Edit', label: 'Delete under cursor', mouse: 'Right-click' },
  ...TOOLS.map((t) => ({ group: 'Tools', label: t.label, keys: t.key, combo: t.key.toLowerCase(), run: (app) => app.selectTool(t.id) })),
  { group: 'Brush', label: 'Smaller brush', keys: '[', combo: '[', run: (app) => app.resizeBrush(0.87) },
  { group: 'Brush', label: 'Larger brush', keys: ']', combo: ']', run: (app) => app.resizeBrush(1.15) },
  { group: 'Brush', label: 'Resize brush', keys: 'Shift', mouse: 'wheel' },
  { group: 'Brush', label: 'Opposite stroke', keys: 'Shift', mouse: 'drag' },
  { group: 'Brush', label: 'Pick flatten height', keys: 'Alt', mouse: 'click' },
  { group: 'View', label: '2D view', keys: '1', combo: '1', run: (app) => app.setViewMode('2d') },
  { group: 'View', label: 'Split view', keys: '2', combo: '2', run: (app) => app.setViewMode('split') },
  { group: 'View', label: '3D view', keys: '3', combo: '3', run: (app) => app.setViewMode('3d') },
  { group: 'View', label: 'Fit map to view', keys: 'Home', combo: 'home', run: (app) => app.view2d.fit() },
  { group: 'View', label: 'Zoom', mouse: 'Wheel' },
  { group: 'View', label: 'Pan', keys: 'Space', mouse: 'drag' },
  { group: 'View', label: 'Pan with the mouse', mouse: 'Middle- or right-drag' },
  { group: '3D view', label: 'Rotate', mouse: 'Left-drag' },
  { group: '3D view', label: 'Pan', mouse: 'Right-drag' },
  { group: '3D view', label: 'Zoom', mouse: 'Wheel' },
  { group: 'Help', label: 'Keyboard shortcuts', keys: '?', combo: '?', global: true, run: () => openShortcuts() },
  { group: 'Help', label: 'Close a dialog or card', keys: 'Esc' },
];

/** 'ctrl+shift+z', 'ctrl+e', 'r', '?', 'home': Shift only counts together with Ctrl (Shift+/ is simply '?'). */
function comboOf(e) {
  const ctrl = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  return `${ctrl ? 'ctrl+' : ''}${ctrl && e.shiftKey ? 'shift+' : ''}${key}`;
}

const byCombo = new Map(SHORTCUTS.flatMap((s) => [s.combo ?? []].flat().map((combo) => [combo, s])));
export const shortcutFor = (e) => (e.altKey ? null : byCombo.get(comboOf(e)) ?? null);

function buildList() {
  const groups = new Map();
  for (const s of SHORTCUTS) {
    if (!groups.has(s.group)) groups.set(s.group, el('div', { class: 'sc-group' }, el('h3', {}, s.group)));
    groups.get(s.group).append(el('div', { class: 'sc-item' }, el('span', {}, s.label), keys(s.keys ?? [], s.mouse)));
  }
  $('scList').replaceChildren(...groups.values());
}

export function openShortcuts() {
  if (!$('scList').childElementCount) buildList();
  for (const d of document.querySelectorAll('dialog[open]')) if (d.id !== 'dlgShortcuts') return; // never on top of another dialog
  $('dlgShortcuts').showModal();
  $('dlgShortcuts').focus(); // the sheet itself, not its close button
}
