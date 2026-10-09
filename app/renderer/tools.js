// The tool list (rail, shortcuts, hints) and the Tool tab: the active tool's settings and the selection.
import { $, btn, el, emptyState, formatInt, note, section, segmented, slider, value } from './dom.js';
import { icon } from './icons.js';
import { materialPicker } from './materials.js';
import { groupOf } from './objects.js';
import { PATHING, heightAt } from './sample.js';

// kind: brush = drag to sculpt/paint · ramp = drag a line · place = click to add · pick = click an existing object
export const TOOLS = [
  { id: 'select', kind: 'pick', group: 'Edit', label: 'Select', key: 'V', icon: 'mouse-pointer-2', hint: 'Click a metal spot, geo vent or start position to select it. Drag to move it; mirrored copies follow. Del deletes.' },
  { id: 'delete', kind: 'pick', group: 'Edit', label: 'Delete', key: 'X', icon: 'trash', hint: 'Click a metal spot, geo vent or start position to delete it and its mirrored copies.' },
  { id: 'raise', kind: 'brush', group: 'Sculpt', label: 'Raise', key: 'R', icon: 'arrow-up-from-line', hint: 'Drag to raise terrain. Hold Shift to lower. Shift+wheel or [ ] changes the brush size.' },
  { id: 'lower', kind: 'brush', group: 'Sculpt', label: 'Lower', key: 'L', icon: 'arrow-down-to-line', hint: 'Drag to lower terrain. Below 0 is water. Hold Shift to raise.' },
  { id: 'smooth', kind: 'brush', group: 'Sculpt', label: 'Smooth', key: 'S', icon: 'waves-horizontal', hint: 'Drag to smooth bumps and soften cliffs.' },
  { id: 'flatten', kind: 'brush', group: 'Sculpt', label: 'Flatten', key: 'F', icon: 'equal', hint: 'Drag to flatten to the height where the stroke starts. Alt+click picks a fixed height.' },
  { id: 'noise', kind: 'brush', group: 'Sculpt', label: 'Roughen', key: 'N', icon: 'audio-waveform', hint: 'Drag to add natural roughness. Hold Shift to subtract.' },
  { id: 'ramp', kind: 'ramp', group: 'Sculpt', label: 'Ramp', key: 'A', icon: 'triangle-right', hint: 'Drag a line from one height to another to cut a ramp between plateaus.' },
  { id: 'paint', kind: 'brush', group: 'Texture', label: 'Paint', key: 'P', icon: 'paintbrush', hint: 'Drag to paint a material. Hold Shift to erase back to automatic.' },
  { id: 'metal', kind: 'place', group: 'Resources', label: 'Metal', key: 'M', icon: 'circle-dot', hint: 'Click to place a metal spot. Drag to move it, right-click to delete.' },
  { id: 'geo', kind: 'place', group: 'Resources', label: 'Geo', key: 'G', icon: 'flame', hint: 'Click to place a geothermal vent. Drag to move it, right-click to delete.' },
  { id: 'start', kind: 'place', group: 'Resources', label: 'Start', key: 'T', icon: 'flag', hint: 'Click to place a start position (one per player, in team order). Drag to move, right-click to delete.' },
];

export const toolById = (id) => TOOLS.find((t) => t.id === id);

export const defaultToolSettings = () => ({
  raise: { radius: 160, strength: 0.5, hardness: 0.3 },
  lower: { radius: 160, strength: 0.5, hardness: 0.3 },
  smooth: { radius: 160, strength: 0.6, hardness: 0.2 },
  flatten: { radius: 160, strength: 0.7, hardness: 0.55, fixed: false, target: 100 },
  noise: { radius: 220, strength: 0.4, hardness: 0.2 },
  paint: { radius: 120, strength: 0.6, hardness: 0.4, material: 1 },
  ramp: { width: 160, hardness: 0.5 },
  metal: { metal: 2 },
});

const BRUSH_COLORS = { lower: '#ffab91', paint: '#ffd27a', ramp: '#7ad7ff' };

/** The 2D view's brush cursor for the active tool (null for click tools). */
export function brushCursor(editor) {
  const s = editor.settings[editor.tool], kind = toolById(editor.tool).kind;
  if (kind === 'brush') return { radius: s.radius, hardness: s.hardness, color: BRUSH_COLORS[editor.tool] ?? '#ffffff' };
  if (kind === 'ramp') return { radius: s.width / 2, hardness: s.hardness, color: BRUSH_COLORS.ramp };
  return null;
}

/** The left tool rail: grouped icon buttons; the tooltip shows name and shortcut. */
export function buildToolbar(editor) {
  const bar = $('toolbar');
  let group = null;
  for (const t of TOOLS) {
    if (group && t.group !== group) bar.append(el('div', { class: 'sep', role: 'separator' }));
    group = t.group;
    bar.append(el('button', {
      class: 'tool', 'data-tool': t.id, 'data-tip': t.label, 'data-key': t.key, 'aria-label': `${t.label} (${t.key})`, 'aria-pressed': 'false',
      onclick: () => editor.selectTool(t.id),
    }, icon(t.icon)));
  }
}

export function markActiveTool(id) {
  for (const b of $('toolbar').querySelectorAll('.tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
}

export function buildToolPanel(editor) {
  const panel = $('tab-tool'), t = toolById(editor.tool), s = editor.settings[t.id];
  const preview = () => editor.updateCursor();
  panel.replaceChildren();

  panel.append(el('section', { class: 'section' },
    el('div', { class: 'tool-head' },
      el('span', { class: 'tool-icon' }, icon(t.icon)),
      el('div', {}, el('h2', {}, t.label), el('p', {}, `${t.group} tool`)),
      el('kbd', {}, t.key)),
    el('p', { class: 'note' }, t.hint)));

  if (t.kind === 'brush') {
    const brush = section(panel, 'Brush');
    slider(brush, 'Radius', s, 'radius', { min: 16, max: 1500, onChange: preview });
    slider(brush, 'Strength', s, 'strength', { min: 0.02, max: 1, step: 0.01 });
    slider(brush, 'Hardness', s, 'hardness', { min: 0, max: 0.95, step: 0.01, onChange: preview });
  }
  if (t.id === 'flatten') {
    const target = section(panel, 'Target height');
    target.append(segmented([['click', 'Where I click'], ['fixed', 'Fixed height']], s.fixed ? 'fixed' : 'click', (v) => {
      s.fixed = v === 'fixed';
      buildToolPanel(editor);
    }, 'block'));
    if (s.fixed) slider(target, 'Height', s, 'target', { min: -500, max: 2000 });
    else note(target, 'Alt+click the map to pick a fixed height.');
  }
  if (t.id === 'paint') section(panel, 'Material').append(materialPicker(editor.doc, s.material, (v) => { s.material = v; }));
  if (t.id === 'ramp') {
    const ramp = section(panel, 'Ramp');
    slider(ramp, 'Width', s, 'width', { min: 32, max: 800, onChange: preview });
    slider(ramp, 'Hardness', s, 'hardness', { min: 0, max: 0.95, step: 0.01, onChange: preview });
    const run = Math.ceil(100 / Math.tan((PATHING.vehicle * Math.PI) / 180));
    note(ramp, `Vehicles climb up to ${PATHING.vehicle}°, bots up to ${PATHING.bot}°. A 100-elmo rise needs a ramp at least ${run} elmos long for vehicles.`);
  }
  if (t.id === 'metal') slider(section(panel, 'New spots'), 'Metal', s, 'metal', { min: 0.1, max: 10, step: 0.1 });
  if (t.id === 'select' || t.kind === 'place') buildSelection(editor, section(panel, 'Selection'));
}

const OBJECT_KINDS = { metal: ['Metal spot', 'circle-dot'], geo: ['Geothermal vent', 'flame'], start: ['Start position', 'flag'] };

function buildSelection(editor, parent) {
  const { doc, selected: o } = editor;
  if (!o) {
    parent.append(emptyState('mouse-pointer-2', 'Nothing selected', 'Click a metal spot, geo vent or start position on the map.'));
    return;
  }
  const copies = groupOf(doc, o).length - 1, [name, iconName] = OBJECT_KINDS[o.type];
  const card = el('div', { class: 'selection-card' }, el('div', { class: 'sel-head' }, icon(iconName), name));
  value(card, 'Position', `${formatInt(o.x)}, ${formatInt(o.z)}`);
  value(card, 'Ground height', `${formatInt(heightAt(doc, o.x, o.z))} elmos`);
  if (copies) value(card, 'Mirrored copies', String(copies));
  if (o.type === 'metal') {
    slider(card, 'Metal', { metal: o.metal }, 'metal', {
      min: 0.1, max: 10, step: 0.1,
      onChange: (v) => {
        for (const copy of groupOf(doc, o)) copy.metal = v;
        editor.objectsChanged();
      },
    });
  }
  card.append(el('div', { class: 'btn-row' }, btn(copies ? 'Delete with mirrored copies' : 'Delete', { class: 'btn danger', onclick: () => editor.deleteSelected() }, 'trash')));
  parent.append(card);
}
