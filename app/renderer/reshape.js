// Map size dialog (Map tab): extend or crop each side by whole units, or resize, with a preview of the new outline.
// Applying is one undoable step (editor.replaceDoc); whatever it loses is named in a confirm first.
import { SYMMETRY, extendMap, resizeMap } from '../../src/core/index.js';
import { $, clamp, el, segmented } from './dom.js';
import { confirmDialog, toast } from './feedback.js';
import { icon } from './icons.js';
import { evenSize } from './new-map.js';
import { counts } from './objects.js';

const SIDES = { north: 'North', east: 'East', south: 'South', west: 'West' };
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
const PREVIEW = 240; // CSS px
const LOST = [['starts', 'start position'], ['metal', 'metal spot'], ['geos', 'geothermal vent'], ['features', 'tree or rock', 'trees and rocks']];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

let editor, state, steppers;

export function openReshape(ed) {
  editor = ed;
  state = { mode: 'extend', north: 0, east: 0, south: 0, west: 0, sx: ed.doc.sx, sz: ed.doc.sz };
  render();
  $('rsApply').onclick = apply;
  $('dlgReshape').showModal();
}

function render() {
  const canvas = el('canvas', { class: 'rs-preview', 'aria-label': 'Preview of the new map outline', role: 'img' });
  const mode = segmented([['extend', 'Extend or crop', 'crop'], ['resize', 'Resize', 'scaling']], state.mode, (m) => {
    state.mode = m;
    render();
  }, 'block');
  $('rsBody').replaceChildren(mode, state.mode === 'extend' ? extendPanel(canvas) : resizePanel(canvas));
  update();
}

function extendPanel(canvas) {
  steppers = Object.keys(SIDES).map(sideStepper);
  return el('div', {},
    el('div', { class: 'rs-stage' }, canvas, ...steppers.map((s) => s.node)),
    el('p', { class: 'note' }, 'Positive numbers add land on that side, negative numbers crop it. 1 unit is 512 elmos. New land continues the edge and levels out.'));
}

function sideStepper(side) {
  const input = el('input', { class: 'field', type: 'number', step: 1, 'aria-label': `${SIDES[side]}, in units` });
  const set = (v) => {
    const [lo, hi] = bounds(side);
    state[side] = clamp(Math.round(+v) || 0, lo, hi);
    update();
  };
  input.addEventListener('change', () => set(input.value));
  const minus = el('button', { class: 'btn square', type: 'button', 'aria-label': `Crop one unit ${side}`, onclick: () => set(state[side] - 1) }, icon('minus'));
  const plus = el('button', { class: 'btn square', type: 'button', 'aria-label': `Add one unit ${side}`, onclick: () => set(state[side] + 1) }, icon('plus'));
  const node = el('div', { class: `rs-side ${side}` }, el('span', { class: 'rs-label' }, SIDES[side]), el('div', { class: 'stepper' }, minus, input, plus));
  return { side, node, input, minus, plus };
}

// The values one side can take with the others fixed: the result stays 2..32 units and at least 1 unit of the map stays.
function bounds(side) {
  const size = side === 'east' || side === 'west' ? editor.doc.sx : editor.doc.sz, other = state[OPPOSITE[side]];
  return [Math.max(2 - size - other, 1 - size - Math.min(0, other)), 32 - size - other];
}

function resizePanel(canvas) {
  const field = (key, label) => {
    const input = el('input', { class: 'field', type: 'number', min: 2, max: 32, step: 2, value: state[key] });
    input.addEventListener('change', () => {
      state[key] = evenSize(input.value);
      input.value = state[key];
      update();
    });
    return el('label', {}, label, input);
  };
  const original = editor.doc.original?.tileIndex
    && el('p', { class: 'rs-warn' }, icon('triangle-alert'), 'The original textures can’t be stretched: a resized map is re-textured from its biome.');
  return el('div', { class: 'rs-resize' }, canvas, el('div', { class: 'rs-resize-controls' },
    el('div', { class: 'nm-size' }, field('sx', 'Width'), el('span', { class: 'times' }, '×'), field('sz', 'Height')),
    el('p', { class: 'note' }, 'Stretches or squeezes the terrain, paint and objects to the new size, in even units from 2 to 32. Heights stay as they are.'),
    original));
}

const resultSize = (doc) => (state.mode === 'resize' ? [state.sx, state.sz] : [doc.sx + state.west + state.east, doc.sz + state.north + state.south]);
const unchanged = (doc) => (state.mode === 'resize' ? state.sx === doc.sx && state.sz === doc.sz : Object.keys(SIDES).every((s) => !state[s]));

// Steppers allow single units; an odd width or height is explained here and blocks Apply.
function problem(doc) {
  const [sx, sz] = resultSize(doc);
  if (sx % 2) return `The width would be ${sx} units: maps need an even number. Change west or east by one more unit.`;
  if (sz % 2) return `The height would be ${sz} units: maps need an even number. Change north or south by one more unit.`;
  return null;
}

function summary(doc) {
  if (unchanged(doc)) return 'No change yet';
  const [sx, sz] = resultSize(doc), head = `${doc.sx} × ${doc.sz} → ${sx} × ${sz}`;
  if (state.mode === 'resize') return `${head} · stretches the map`;
  const parts = Object.keys(SIDES).filter((s) => state[s]).map((s) => `${state[s] > 0 ? 'adds' : 'crops'} ${plural(Math.abs(state[s]), 'unit')} ${s}`);
  return `${head} · ${parts.join(', ')}`;
}

function update() {
  const doc = editor.doc, issue = problem(doc);
  if (state.mode === 'extend') {
    for (const { side, input, minus, plus } of steppers) {
      const [lo, hi] = bounds(side);
      input.value = state[side];
      minus.disabled = state[side] <= lo;
      plus.disabled = state[side] >= hi;
    }
  }
  drawPreview($('rsBody').querySelector('.rs-preview'), doc);
  $('rsSummary').className = issue ? 'rs-summary warn' : 'rs-summary';
  $('rsSummary').replaceChildren(...(issue ? [icon('triangle-alert')] : []), issue ?? summary(doc));
  $('rsApply').disabled = Boolean(issue) || unchanged(doc);
}

// The current map image in its old outline (dashed), the new outline in the accent colour; new ground is tinted,
// cropped ground dimmed. Resize stretches the image into the new outline.
function drawPreview(canvas, doc) {
  const dpr = devicePixelRatio || 1, ctx = canvas.getContext('2d'), css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  canvas.width = canvas.height = Math.round(PREVIEW * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const extend = state.mode === 'extend', [sx, sz] = resultSize(doc);
  const old = [0, 0, doc.sx, doc.sz], next = extend ? [-state.west, -state.north, -state.west + sx, -state.north + sz] : [0, 0, sx, sz];
  const box = [Math.min(old[0], next[0]), Math.min(old[1], next[1]), Math.max(old[2], next[2]), Math.max(old[3], next[3])];
  const scale = (PREVIEW - 16) / Math.max(box[2] - box[0], box[3] - box[1]);
  const ox = (PREVIEW - (box[2] - box[0]) * scale) / 2 - box[0] * scale, oz = (PREVIEW - (box[3] - box[1]) * scale) / 2 - box[1] * scale;
  const px = ([x0, z0, x1, z1]) => [ox + x0 * scale, oz + z0 * scale, (x1 - x0) * scale, (z1 - z0) * scale];
  const image = editor.view2d.base;

  ctx.fillStyle = token('--accent-soft');
  ctx.fillRect(...px(next));
  if (extend) {
    ctx.globalAlpha = 0.25;
    ctx.drawImage(image, ...px(old));
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(...px(next));
    ctx.clip();
    ctx.drawImage(image, ...px(old));
    ctx.restore();
  } else {
    ctx.drawImage(image, ...px(next));
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)'; // one line per map unit
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let u = next[0] + 1; u < next[2]; u++) { ctx.moveTo(ox + u * scale, oz + next[1] * scale); ctx.lineTo(ox + u * scale, oz + next[3] * scale); }
  for (let u = next[1] + 1; u < next[3]; u++) { ctx.moveTo(ox + next[0] * scale, oz + u * scale); ctx.lineTo(ox + next[2] * scale, oz + u * scale); }
  ctx.stroke();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = token('--text-3');
  ctx.strokeRect(...px(old));
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = token('--accent');
  ctx.strokeRect(...px(next));
}

// What the step loses, as sentences for the confirm: objects outside the crop, a symmetry that no longer fits,
// the original textures and metal map.
function losses(doc, next) {
  const before = counts(doc), after = counts(next), out = [];
  const lost = LOST.filter(([k]) => after[k] < before[k]).map(([k, one, many]) => plural(before[k] - after[k], one, many));
  if (lost.length) out.push(`Removes ${lost.join(', ')} outside the crop.`);
  if (after.starts < before.starts) out.push(`${plural(after.starts, 'start position')} will remain.`);
  if (next.symmetry !== doc.symmetry) out.push(`${SYMMETRY[doc.symmetry].label} symmetry no longer fits the map and is turned off.`);
  if (doc.original?.tileIndex && !next.original.tileIndex) out.push('The original textures can’t be stretched: the map is re-textured from its biome.');
  if (doc.original?.metalMap && !next.original.metalMap) out.push('The original metal map is rebuilt from the metal spots.');
  return out;
}

async function apply() {
  const doc = editor.doc, extend = state.mode === 'extend', sides = Object.keys(SIDES);
  const verb = extend ? [sides.some((s) => state[s] > 0) && 'extend', sides.some((s) => state[s] < 0) && 'crop'].filter(Boolean).join(' and ') : 'resize';
  let next;
  try {
    // shortcut: runs on the UI thread (≤ 0.4 s for the largest change, 2 → 32 units). Move it to the generator worker if it
    // grows; doc.original's files and tiles must then stay out of the structured clone.
    next = extend ? extendMap(doc, { north: state.north, east: state.east, south: state.south, west: state.west }) : resizeMap(doc, state.sx, state.sz);
  } catch (error) {
    console.error(error);
    toast(error.message, 'error');
    return;
  }
  const lost = losses(doc, next), title = `${verb[0].toUpperCase()}${verb.slice(1)}`;
  if (lost.length && !(await confirmDialog({ title: `${title} the map?`, text: `${lost.join(' ')} Ctrl+Z undoes it.`, ok: title }))) return;
  $('dlgReshape').close();
  editor.replaceDoc(next, `${verb} map`);
  toast(`The map is now ${next.sx} × ${next.sz} units. Ctrl+Z undoes it.`, 'ok');
}
