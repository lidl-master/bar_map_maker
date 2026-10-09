// Status bar read-outs (cursor, slope, counts) and local autosave with its state chip in the top bar.
import { $, el, formatInt } from './dom.js';
import { icon } from './icons.js';
import { counts } from './objects.js';
import { saveMap } from './recent.js';
import { PATHING_LEGEND, SQ, heightAt, pathingClass, slopeAt, worldSize } from './sample.js';

/** w = {x, z} in elmos, or null when the pointer left the map. */
export function showCursor(doc, w) {
  const [width, height] = worldSize(doc);
  const label = $('stCursor').querySelector('.label');
  if (!w || w.x < 0 || w.z < 0 || w.x > width || w.z > height) {
    label.textContent = 'Move over the map';
    $('stSlope').replaceChildren();
    return;
  }
  const i = Math.round(w.x / SQ), j = Math.round(w.z / SQ), pathing = pathingClass(doc, i, j);
  const pad = (n) => formatInt(n).padStart(6); // fixed columns (tabular digits, white-space: pre): the read-out does not jitter
  label.textContent = `X ${pad(w.x)}   Z ${pad(w.z)}   Height ${pad(heightAt(doc, w.x, w.z))}`;
  $('stSlope').replaceChildren(el('span', { class: `pass-${pathing}` }, `${slopeAt(doc, i, j).toFixed(1)}°`), PATHING_LEGEND[pathing].label);
}

export function showCounts(doc) {
  const c = counts(doc);
  const item = (type, iconName, n, tip) => el('span', { 'data-count': type, 'data-tip': tip }, icon(iconName), el('b', { class: 'num' }, formatInt(n)));
  $('stCounts').replaceChildren(
    item('start', 'flag', c.starts, 'Start positions'),
    item('metal', 'circle-dot', c.metal, `Metal spots: ${c.metalTotal.toFixed(1)} metal in total`),
    item('geo', 'flame', c.geos, 'Geothermal vents'),
    item('feature', 'trees', c.features, 'Features (trees and rocks)'),
  );
}

// ---- autosave: a moment after the last change the map is saved locally; the welcome screen lists it under Recent maps.
const SAVE_DELAY = 1500;
let saveTimer = 0;

function showSaveState(state, label, tip = '') {
  const chip = $('saveState');
  chip.dataset.state = state;
  chip.dataset.tip = tip || label;
  chip.querySelector('.label').textContent = label;
}

export function scheduleSave(editor) {
  showSaveState('dirty', 'Unsaved changes', 'Saved on this computer a moment after you stop editing');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(editor), SAVE_DELAY);
}

export async function saveNow(editor) {
  clearTimeout(saveTimer);
  showSaveState('saving', 'Saving…');
  try {
    await saveMap(editor.docKey, editor.doc, thumbnail(editor.view2d.base));
    showSaveState('saved', 'Saved', 'Saved on this computer. Reopen it from the welcome screen.');
  } catch (error) {
    console.error(error);
    showSaveState('error', 'Not saved', `Could not save on this computer: ${error.message}`);
  }
}

/** A 64×64 RGBA preview of the 2D map image for the recent maps list. */
function thumbnail(source, size = 64) {
  const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, size, size);
  return { size, rgba: ctx.getImageData(0, 0, size, size).data };
}
