// The tool list (toolbar, shortcuts, hints) and the Tool tab, which shows the active tool's settings and the selection.
import { $, el, heading, icon, note, check, slider, stat } from './dom.js';
import { groupOf } from './objects.js';
import { PATHING, heightAt } from './sample.js';

const CIRCLE = 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0';

// kind: brush = drag to sculpt/paint · ramp = drag a line · place = click to add · pick = click an existing object
export const TOOLS = [
  { id: 'select', kind: 'pick', group: 'Edit', label: 'Select', key: 'V', icon: ['M6 3l12 8-5.5 1.5L10 19z'], hint: 'Click a metal spot, geo vent or start position to select it. Drag to move it; mirrored copies follow. Del deletes.' },
  { id: 'delete', kind: 'pick', group: 'Edit', label: 'Delete', key: 'X', icon: ['M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13'], hint: 'Click a metal spot, geo vent or start position to delete it and its mirrored copies.' },
  { id: 'raise', kind: 'brush', group: 'Sculpt', label: 'Raise', key: 'R', icon: ['M2 20h20M5 20l7-9 7 9', 'M12 2.5v5M9.5 5L12 2.5 14.5 5'], hint: 'Drag to raise terrain. Hold Shift to lower. Shift+wheel or [ ] changes the brush size.' },
  { id: 'lower', kind: 'brush', group: 'Sculpt', label: 'Lower', key: 'L', icon: ['M2 12h5l3 7h4l3-7h5', 'M12 3v6M9.5 6.5L12 9l2.5-2.5'], hint: 'Drag to lower terrain. Below 0 is water. Hold Shift to raise.' },
  { id: 'smooth', kind: 'brush', group: 'Sculpt', label: 'Smooth', key: 'S', icon: ['M2 13c3.3-5 6.7-5 10 0s6.7 5 10 0', 'M2 20h20'], hint: 'Drag to smooth bumps and soften cliffs.' },
  { id: 'flatten', kind: 'brush', group: 'Sculpt', label: 'Flatten', key: 'F', icon: ['M2 20h4l3-8h6l3 8h4', 'M8.5 12h7', 'M12 3v5'], hint: 'Drag to flatten to the height where the stroke starts. Alt+click picks a fixed height.' },
  { id: 'roughen', kind: 'brush', group: 'Sculpt', label: 'Roughen', key: 'N', icon: ['M2 18l3-5 3 3 3-8 3 7 3-4 3 3 2-2'], hint: 'Drag to add natural roughness. Hold Shift to subtract.' },
  { id: 'ramp', kind: 'ramp', group: 'Sculpt', label: 'Ramp', key: 'A', icon: ['M2 20h20', 'M3 20L21 9v11', 'M8 17l2-1M13 14.5l2-1'], hint: 'Drag a line from one height to another to cut a ramp between plateaus.' },
  { id: 'paint', kind: 'brush', group: 'Texture', label: 'Paint', key: 'P', icon: ['M15 3l6 6-8.5 8.5H6.5V11.5z', 'M3 21h8'], hint: 'Drag to paint a material. Hold Shift to erase back to automatic.' },
  { id: 'metal', kind: 'place', group: 'Resources', label: 'Metal', key: 'M', icon: [CIRCLE, 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0'], hint: 'Click to place a metal spot. Drag to move it, right-click to delete.' },
  { id: 'geo', kind: 'place', group: 'Resources', label: 'Geo', key: 'G', icon: ['M12 3c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4.5 3-7 1 2 2 3 3 3 0-3-1-5 0-7z'], hint: 'Click to place a geothermal vent. Drag to move it, right-click to delete.' },
  { id: 'start', kind: 'place', group: 'Resources', label: 'Start', key: 'T', icon: ['M5 21V3.5M5 4h12l-2.5 4L17 12H5'], hint: 'Click to place a start position (one per player, in team order). Drag to move, right-click to delete.' },
];

export const toolById = (id) => TOOLS.find((t) => t.id === id);

export const defaultToolSettings = () => ({
  raise: { radius: 160, strength: 0.5, hardness: 0.3 },
  lower: { radius: 160, strength: 0.5, hardness: 0.3 },
  smooth: { radius: 160, strength: 0.6, hardness: 0.2 },
  flatten: { radius: 160, strength: 0.7, hardness: 0.55, fixed: false, target: 100 },
  roughen: { radius: 220, strength: 0.4, hardness: 0.2 },
  paint: { radius: 120, strength: 0.6, hardness: 0.4, material: 1 },
  ramp: { width: 160, hardness: 0.5 },
  metal: { metal: 2 },
});

const BRUSH_COLORS = { lower: '#ff9a7a', paint: '#ffd27a', ramp: '#5cd0ff' };

/** The 2D view's brush cursor for the active tool (null for click tools). */
export function brushCursor(editor) {
  const s = editor.settings[editor.tool], kind = toolById(editor.tool).kind;
  if (kind === 'brush') return { radius: s.radius, color: BRUSH_COLORS[editor.tool] ?? '#ffffff' };
  if (kind === 'ramp') return { radius: s.width / 2, color: BRUSH_COLORS.ramp };
  return null;
}

export function buildToolbar(editor) {
  const bar = $('toolbar');
  let group = null;
  for (const t of TOOLS) {
    if (t.group !== group) {
      if (group) bar.append(el('div', { class: 'sep' }));
      bar.append(el('div', { class: 'cap' }, (group = t.group)));
    }
    const button = el('button', { class: 'tool', title: `${t.label} (${t.key})`, onclick: () => editor.setTool(t.id) }, icon(t.icon), el('span', {}, t.label));
    button.dataset.tool = t.id;
    bar.append(button);
  }
}

export function buildToolPanel(editor) {
  const panel = $('tab-tool'), t = toolById(editor.tool), s = editor.settings[t.id];
  const preview = () => editor.updateCursor();
  panel.replaceChildren();
  heading(panel, `${t.label} tool`);
  note(panel, t.hint);
  if (t.kind === 'brush') {
    slider(panel, 'Brush radius (elmos)', s, 'radius', 16, 1500, 1, preview);
    slider(panel, 'Strength', s, 'strength', 0.02, 1, 0.01);
    slider(panel, 'Edge hardness', s, 'hardness', 0, 0.95, 0.01);
  }
  if (t.id === 'flatten') {
    check(panel, 'Use a fixed height instead of the height where I click', s, 'fixed', () => buildToolPanel(editor));
    if (s.fixed) slider(panel, 'Target height (elmos)', s, 'target', -500, 2000, 1);
  }
  if (t.id === 'paint') {
    // shortcut: material ids only, until src/look names its materials (Wave 2 texture stack).
    slider(panel, 'Material id', s, 'material', 1, 15, 1);
  }
  if (t.id === 'ramp') {
    slider(panel, 'Ramp width (elmos)', s, 'width', 32, 800, 1, preview);
    slider(panel, 'Edge hardness', s, 'hardness', 0, 0.95, 0.01);
    const run = Math.ceil(100 / Math.tan((PATHING.vehicle * Math.PI) / 180));
    note(panel, `Vehicles climb up to ${PATHING.vehicle}°, bots up to ${PATHING.bot}°. A 100-elmo rise needs a ramp at least ${run} elmos long for vehicles.`);
  }
  if (t.id === 'metal') slider(panel, 'Metal per new spot', s, 'metal', 0.1, 10, 0.1);
  if (t.id === 'select' || t.kind === 'place') buildSelection(editor, panel);
}

const OBJECT_NAMES = { metal: 'Metal spot', geo: 'Geothermal vent', start: 'Start position' };

function buildSelection(editor, panel) {
  const { doc, selected: o } = editor;
  if (!o) {
    note(panel, 'Nothing selected.');
    return;
  }
  const copies = groupOf(doc, o).length - 1;
  heading(panel, `Selected: ${OBJECT_NAMES[o.type]}`);
  stat(panel, 'Position', `${Math.round(o.x)}, ${Math.round(o.z)}`);
  stat(panel, 'Ground height', `${Math.round(heightAt(doc, o.x, o.z))} elmos`);
  if (copies) stat(panel, 'Mirrored copies', String(copies));
  if (o.type === 'metal') {
    slider(panel, 'Metal value', { metal: o.metal }, 'metal', 0.1, 10, 0.1, (v) => {
      for (const copy of groupOf(doc, o)) copy.metal = v;
      editor.objectsChanged();
    });
  }
  panel.append(el('button', { class: 'wide danger', onclick: () => editor.deleteSelected() }, copies ? 'Delete (with mirrored copies)' : 'Delete'));
}
