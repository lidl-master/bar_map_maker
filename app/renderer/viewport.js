// The map views' chrome: 2D / Split / 3D layout and the splitter, the 2D toolbar (overlays menu, Shaded | Pathing,
// zoom), the pathing legend, the scale bar, the transient tool chip, and the 3D camera toolbar, compass and hint.
import { $, el, formatInt, keys } from './dom.js';
import { icon } from './icons.js';
import { PATHING_LEGEND, SQ } from './sample.js';

const SCALE_STEPS = [100, 250, 500, 1000, 2000, 5000, 10000]; // elmos; the bar shows the longest that fits
const SCALE_MAX_PX = 120;
const CHIP_MS = 3000;
const NS = 'http://www.w3.org/2000/svg';

let view2d, view3d, chipTimer = 0, legendTimer = 0, legendOpen = true;

export function initViewport(views) {
  ({ view2d, view3d } = views);
  for (const b of $('displayMode').children) b.addEventListener('click', () => setDisplayMode(b.dataset.mode));
  for (const item of $('overlayMenu').querySelectorAll('[data-overlay]')) item.addEventListener('click', () => toggleOverlay(item));
  $('btnFit').addEventListener('click', () => view2d.fit());
  $('btnZoomIn').addEventListener('click', () => view2d.zoomBy(1.25));
  $('btnZoomOut').addEventListener('click', () => view2d.zoomBy(0.8));
  view2d.onDraw = drawReadouts;
  view2d.onRender = () => {
    clearTimeout(legendTimer);
    if (view2d.mode === 'pathing') legendTimer = setTimeout(showLegend, 200);
  };
  bindSplitter();
  bind3d();
}

/** '2d' | 'split' | '3d' */
export function setViewMode(mode) {
  $('viewport').className = `view-${mode}`;
  for (const b of $('viewMode').children) b.setAttribute('aria-pressed', String(b.dataset.view === mode));
  view3d.visible = mode !== '2d';
  requestAnimationFrame(() => {
    view2d.resize();
    if (mode !== '3d') view2d.fit();
    view3d.resize();
    view3d.update();
  });
}

function setDisplayMode(mode) {
  view2d.mode = mode;
  for (const b of $('displayMode').children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  $('legend').hidden = mode !== 'pathing';
  setTimeout(() => { view2d.render(); view3d.update(); }, 0); // after the buttons repaint: a full recolour takes a moment
}

function toggleOverlay(item) {
  const key = item.dataset.overlay, on = !view2d.overlays[key];
  view2d.overlays[key] = on;
  item.setAttribute('aria-checked', String(on));
  if (key === 'features') {
    view3d.showFeatures = on;
    view3d.update();
  }
  view2d.invalidate();
}

// ---- 2D read-outs: zoom percentage and scale bar, after every frame
function drawReadouts() {
  const zoom = `${Math.round(view2d.zoom * 100)}%`;
  if ($('zoomLevel').textContent !== zoom) $('zoomLevel').textContent = zoom;
  const perElmo = view2d.zoom / SQ, length = SCALE_STEPS.findLast((v) => v * perElmo <= SCALE_MAX_PX) ?? SCALE_STEPS[0];
  $('scaleBar').querySelector('.bar').style.width = `${Math.round(length * perElmo)}px`;
  const label = `${formatInt(length)} elmos`, node = $('scaleBar').querySelector('.label');
  if (node.textContent !== label) node.textContent = label;
}

// ---- pathing legend: docked under the toolbar, collapsible, only the classes the map has
function showLegend() {
  const present = view2d.presentClasses();
  const toggle = el('button', { class: 'legend-head', 'aria-expanded': String(legendOpen), onclick: () => { legendOpen = !legendOpen; showLegend(); } },
    el('span', {}, 'Pathing'), icon('chevron-down'));
  const items = present.map((key) => {
    const swatch = el('i', { class: `sw-${key}` });
    swatch.style.background = `rgb(${PATHING_LEGEND[key].color})`;
    return el('div', { class: 'item' }, swatch, PATHING_LEGEND[key].label);
  });
  $('legend').replaceChildren(toggle, ...(legendOpen ? [el('div', { class: 'legend-items' }, ...items)] : []));
}

// ---- transient tool chip (the inspector holds the full description)
/** Shows the tool's icon, name and key for a few seconds. */
export function flashTool(tool) {
  showChip([icon(tool.icon), el('strong', {}, tool.label), keys(tool.key)], CHIP_MS);
}

/** A live read-out in the chip until hideReadout() (ramp length and slope while dragging). */
export function readout(iconName, text) {
  showChip([icon(iconName), el('span', {}, text)], 0);
}

export const hideReadout = () => hideChip();

function showChip(children, ms) {
  clearTimeout(chipTimer);
  const chip = $('toolChip');
  chip.replaceChildren(...children);
  chip.hidden = false;
  chip.classList.remove('leaving');
  if (ms) chipTimer = setTimeout(hideChip, ms);
}

function hideChip() {
  const chip = $('toolChip');
  chip.classList.add('leaving');
  chipTimer = setTimeout(() => { chip.hidden = true; }, 150);
}

// ---- split view: a 4-px splitter, drag or arrow keys
function bindSplitter() {
  const bar = $('splitter'), viewport = $('viewport');
  const setSplit = (fraction) => {
    const f = Math.min(0.8, Math.max(0.2, fraction));
    viewport.style.setProperty('--split', `${(f * 100).toFixed(1)}%`);
    bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  };
  const current = () => $('wrap2d').getBoundingClientRect().width / viewport.getBoundingClientRect().width;
  bar.addEventListener('pointerdown', (e) => {
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
  });
  bar.addEventListener('pointermove', (e) => {
    if (!bar.hasPointerCapture(e.pointerId)) return;
    const r = viewport.getBoundingClientRect();
    setSplit((e.clientX - r.left) / r.width);
  });
  bar.addEventListener('lostpointercapture', () => {
    bar.classList.remove('dragging');
    view2d.fit();
  });
  bar.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -0.05, ArrowRight: 0.05 }[e.key];
    if (!step) return;
    e.preventDefault();
    setSplit(current() + step);
  });
  bar.setAttribute('aria-valuemin', '20');
  bar.setAttribute('aria-valuemax', '80');
  setSplit(0.5);
}

// ---- 3D: camera toolbar, compass (north = the sun), the controls hint until the first camera move
function bind3d() {
  $('btn3dFit').addEventListener('click', () => view3d.view());
  $('btn3dTop').addEventListener('click', () => view3d.top());
  $('btn3dReset').addEventListener('click', () => view3d.home());
  $('compass').addEventListener('click', () => view3d.north());
  const needle = compassNeedle();
  $('compass').append(needle.svg);
  view3d.onView = (yaw) => needle.dial.setAttribute('transform', `rotate(${((yaw * 180) / Math.PI).toFixed(1)} 18 18)`);
  view3d.onInteract = () => {
    const hint = $('hint3d');
    hint.classList.add('leaving');
    setTimeout(() => { hint.hidden = true; }, 300);
  };
}

function svgNode(tag, attrs, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

// A compass card that turns with the camera: N and the accent needle point north.
function compassNeedle() {
  const svg = svgNode('svg', { viewBox: '0 0 36 36', 'aria-hidden': 'true' });
  const dial = svgNode('g', {});
  dial.append(
    svgNode('circle', { cx: 18, cy: 18, r: 14.5, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.25, 'stroke-width': 1.5 }),
    svgNode('text', { x: 18, y: 10.5, 'text-anchor': 'middle', class: 'compass-n' }, 'N'),
    svgNode('path', { d: 'M18 12.5 L20.6 19 L15.4 19 Z', class: 'compass-north' }),
    svgNode('path', { d: 'M18 25.5 L20.6 19 L15.4 19 Z', class: 'compass-south' }),
  );
  svg.append(dial);
  return { svg, dial };
}
