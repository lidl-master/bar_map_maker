// Visual pickers shared by New Map and the Look tab: symmetry pictograms and biome swatches.
import { SYMMETRY } from '../../src/core/index.js';
import { BIOMES } from '../../src/look/index.js';
import { choice, el } from './dom.js';
import { biomeSwatch } from './materials.js';

const NS = 'http://www.w3.org/2000/svg';

/** An arc around (12, 12) from angle a0 to a1 (degrees, clockwise from east) with an arrowhead at a1. */
function arcArrow(r, a0, a1) {
  const at = (deg, rr = r) => [12 + rr * Math.cos((deg * Math.PI) / 180), 12 + rr * Math.sin((deg * Math.PI) / 180)];
  const [x0, y0] = at(a0), [x1, y1] = at(a1), t = ((a1 + 90) * Math.PI) / 180; // travel direction at the tip
  const wing = (side) => [x1 - 3 * Math.cos(t) + side * 2.2 * Math.sin(t), y1 - 3 * Math.sin(t) - side * 2.2 * Math.cos(t)];
  const f = (v) => v.toFixed(2);
  return `M${f(x0)} ${f(y0)} A${r} ${r} 0 0 1 ${f(x1)} ${f(y1)} M${wing(1).map(f).join(' ')} L${f(x1)} ${f(y1)} L${wing(-1).map(f).join(' ')}`;
}

// 24×24 outline glyphs in the Lucide style: a dashed mirror line with the shape and its ghost, or turn arrows round a
// centre dot. solid = the original, ghost = its copies.
const PICTOGRAMS = {
  rot180: { arrows: [[210, 330], [30, 150]], dot: true },
  mirrorX: { lines: ['M12 2v20'], solid: ['M3 7l5 5-5 5z'], ghost: ['M21 7l-5 5 5 5z'] },
  mirrorZ: { lines: ['M2 12h20'], solid: ['M7 3l5 5 5-5z'], ghost: ['M7 21l5-5 5 5z'] },
  quad: { lines: ['M12 2v20', 'M2 12h20'], solid: ['M4 4h6l-6 6z'], ghost: ['M20 4h-6l6 6z', 'M4 20h6l-6-6z', 'M20 20h-6l6-6z'] },
  rot90: { arrows: [[-70, -20], [20, 70], [110, 160], [200, 250]], dot: true },
  diag: { lines: ['M3 3l18 18'], solid: ['M10 4h10v10z'], ghost: ['M4 10v10h10z'] },
  adiag: { lines: ['M21 3L3 21'], solid: ['M4 4h10L4 14z'], ghost: ['M20 20V10L10 20z'] },
  none: { solid: ['M7 6l10 6-10 6z'] },
};
const SYMMETRY_ORDER = Object.keys(PICTOGRAMS);

function svgNode(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function pictogram(mode) {
  const { lines = [], solid = [], ghost = [], arrows = [], dot } = PICTOGRAMS[mode];
  const svg = svgNode('svg', { viewBox: '0 0 24 24', class: 'pictogram', 'aria-hidden': 'true' });
  for (const d of lines) svg.append(svgNode('path', { d, class: 'axis' }));
  for (const d of solid) svg.append(svgNode('path', { d }));
  for (const d of ghost) svg.append(svgNode('path', { d, class: 'ghost' }));
  for (const [a0, a1] of arrows) svg.append(svgNode('path', { d: arcArrow(8, a0, a1) }));
  if (dot) svg.append(svgNode('circle', { cx: 12, cy: 12, r: 1.5, class: 'dot' }));
  return svg;
}

/** Symmetry radios; returns the cards keyed by mode so the caller can disable or lock them. */
export function symmetryChoices(name, current, onChange) {
  return SYMMETRY_ORDER.map((mode) => {
    const card = choice({ name, value: mode, checked: mode === current, onChange }, pictogram(mode), el('span', { class: 'name' }, SYMMETRY[mode].label));
    card.dataset.tip = SYMMETRY[mode].label;
    return card;
  });
}

export function biomeChoices(name, current, onChange) {
  return Object.entries(BIOMES).map(([key, b]) => choice(
    { name, value: key, checked: key === current, className: 'compact biome', onChange },
    biomeSwatch(key), el('span', { class: 'name' }, b.label),
  ));
}
