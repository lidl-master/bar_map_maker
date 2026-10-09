// Status bar read-outs: cursor position, height, slope and pathing, and the object counts.
import { $, el, formatInt } from './dom.js';
import { icon } from './icons.js';
import { counts } from './objects.js';
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
