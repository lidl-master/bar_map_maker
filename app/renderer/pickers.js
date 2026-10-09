// Visual pickers shared by New Map and the Look tab: symmetry pictograms and biome swatches.
import { SYMMETRY } from '../../src/core/index.js';
import { BIOMES } from '../../src/look/index.js';
import { choice, el } from './dom.js';
import { biomeSwatch } from './materials.js';

const NS = 'http://www.w3.org/2000/svg';

// In a 24×24 box: the map frame, the mirror lines, and where one player's copies land.
const PICTOGRAMS = {
  rot180: { short: 'Rotate 180°', dots: [[7.5, 8], [16.5, 16]], centre: true },
  mirrorX: { short: 'Left ↔ right', lines: [[12, 3, 12, 21]], dots: [[7.5, 9], [16.5, 9]] },
  mirrorZ: { short: 'Top ↕ bottom', lines: [[3, 12, 21, 12]], dots: [[9, 7.5], [9, 16.5]] },
  quad: { short: 'Quad', lines: [[12, 3, 12, 21], [3, 12, 21, 12]], dots: [[7.5, 7.5], [16.5, 7.5], [7.5, 16.5], [16.5, 16.5]] },
  rot90: { short: 'Rotate 90°', dots: [[8, 6.5], [17.5, 8], [16, 17.5], [6.5, 16]], centre: true },
  diag: { short: 'Diagonal ╲', lines: [[3, 3, 21, 21]], dots: [[15.5, 8.5], [8.5, 15.5]] },
  adiag: { short: 'Diagonal ╱', lines: [[21, 3, 3, 21]], dots: [[8, 8], [16, 16]] },
  none: { short: 'None', dots: [[9, 10]] },
};
export const SYMMETRY_ORDER = Object.keys(PICTOGRAMS);

function svgNode(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function pictogram(mode) {
  const { lines = [], dots, centre } = PICTOGRAMS[mode];
  const svg = svgNode('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'aria-hidden': 'true' });
  svg.append(svgNode('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2.5, 'stroke-width': 1.25, opacity: 0.55 }));
  for (const [x1, y1, x2, y2] of lines) svg.append(svgNode('line', { x1, y1, x2, y2, 'stroke-width': 1.25, 'stroke-dasharray': '2 1.6' }));
  if (centre) svg.append(svgNode('circle', { cx: 12, cy: 12, r: 1.6, 'stroke-width': 1.25 }));
  for (const [cx, cy] of dots) svg.append(svgNode('circle', { cx, cy, r: 1.9, fill: 'currentColor', stroke: 'none' }));
  return svg;
}

/** Symmetry radios; returns the cards keyed by mode so the caller can disable or lock them. */
export function symmetryChoices(name, current, onChange) {
  return SYMMETRY_ORDER.map((mode) => {
    const card = choice({ name, value: mode, checked: mode === current, onChange }, pictogram(mode), el('span', { class: 'name' }, PICTOGRAMS[mode].short));
    card.dataset.tip = SYMMETRY[mode].label;
    return card;
  });
}

export function biomeChoices(name, current, onChange) {
  return Object.entries(BIOMES).map(([key, b]) => choice(
    { name, value: key, checked: key === current, className: 'compact', onChange },
    biomeSwatch(key), el('span', { class: 'name' }, b.label),
  ));
}
