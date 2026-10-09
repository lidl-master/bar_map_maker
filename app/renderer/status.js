// Status bar read-outs: cursor position, height, slope and pathing, and the object counts.
import { $, el, formatInt } from './dom.js';
import { icon } from './icons.js';
import { counts } from './objects.js';
import { PATHING_LEGEND, SQ, heightAt, pathingClass, slopeAt, worldSize } from './sample.js';

const field = (key, text, className = '') => [el('span', { class: 'k' }, key), el('b', { class: `v num ${className}`.trim() }, text)];

/** w = {x, z} in elmos, or null when the pointer left the map. Fixed-width values: the read-out never jitters. */
export function showCursor(doc, w) {
  const [width, height] = worldSize(doc);
  if (!w || w.x < 0 || w.z < 0 || w.x > width || w.z > height) {
    $('stCursor').replaceChildren(icon('crosshair'), el('span', { class: 'k' }, 'Move over the map'));
    $('stSlope').replaceChildren();
    return;
  }
  const i = Math.round(w.x / SQ), j = Math.round(w.z / SQ), pathing = pathingClass(doc, i, j);
  $('stCursor').replaceChildren(icon('crosshair'), ...field('X', formatInt(w.x)), ...field('Z', formatInt(w.z)), ...field('Height', formatInt(heightAt(doc, w.x, w.z))));
  $('stSlope').replaceChildren(...field('Slope', `${slopeAt(doc, i, j).toFixed(1)}°`, `pass-${pathing}`), el('span', { class: 'k' }, PATHING_LEGEND[pathing].label));
}

export function showCounts(doc) {
  const c = counts(doc);
  const item = (type, label, n, tip) => el('span', { 'data-count': type, 'data-tip': tip }, ...field(label, formatInt(n)));
  $('stCounts').replaceChildren(
    item('start', 'Starts', c.starts, 'Start positions'),
    item('metal', 'Metal', c.metal, `Metal spots: ${c.metalTotal.toFixed(1)} metal in total`),
    item('geo', 'Geo', c.geos, 'Geothermal vents'),
    item('feature', 'Features', c.features, 'Trees and rocks'),
  );
}
