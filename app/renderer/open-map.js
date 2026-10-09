// Open an existing BAR map (welcome → Open existing BAR map): the BAR maps folder as cards with minimap thumbnails,
// Browse… for any .sd7 / .sdz, the loading cover while the main process opens it, and an error panel when it fails.
import { decodeDxt1 } from '../../src/formats/dxt.js';
import { $, btn, el, emptyState } from './dom.js';
import { hideLoading, loadingProgress, showLoading } from './feedback.js';
import { icon } from './icons.js';
import { thumbFailed, thumbFrame } from './thumbs.js';

const megabytes = (mb) => `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
const THUMB_LOADS = 2; // archives read at once for thumbnails; each is a 7-Zip run
let opening = false;

export function initOpenMap(app) {
  // The main process reports each step; the first one puts the cover up (after the file picker, when browsing).
  window.studio.onOpenProgress(({ label, fraction }) => {
    if (!opening) return;
    if ($('loading').hidden) showLoading('Opening map', label);
    loadingProgress(label, fraction);
  });
  $('wOpen').addEventListener('click', () => showOpenView(app, true));
  $('oBack').addEventListener('click', () => showOpenView(app, false));
  $('oBrowse').addEventListener('click', () => openMap(app, null));
}

/** Swaps the welcome screen's main area between the templates and the BAR maps list. */
function showOpenView(app, open) {
  $('wTemplatesView').hidden = open;
  $('wOpenView').hidden = !open;
  $('wOpen').setAttribute('aria-current', open ? 'page' : 'false');
  if (open) listMaps(app);
}

async function listMaps(app) {
  const list = $('oMaps');
  let maps;
  try {
    maps = await window.studio.listBarMaps();
  } catch (error) {
    list.replaceChildren(emptyState('triangle-alert', 'BAR maps folder not found', `${error.message}. Use Browse… to open a map file.`));
    return;
  }
  if (!maps.length) {
    list.replaceChildren(emptyState('map', 'No maps in your BAR maps folder', 'Maps you download in BAR appear here. Use Browse… to open a map file.'));
    return;
  }
  const cards = maps.map((map) => {
    const frame = thumbFrame(), meta = el('span', { class: 'desc num' }, megabytes(map.sizeMB));
    const card = el('button', { class: 'tpl-card map-card', 'data-file': map.name, onclick: () => openMap(app, map.file) },
      frame, el('span', { class: 'text' }, el('span', { class: 'name' }, map.name), meta));
    return { map, card, frame, meta };
  });
  list.replaceChildren(...cards.map((c) => c.card));
  const queue = [...cards];
  const worker = async () => { for (let c = queue.shift(); c; c = queue.shift()) await loadThumb(c); };
  await Promise.all(Array.from({ length: THUMB_LOADS }, worker));
}

// The SMF minimap is square whatever the map's shape, so it is drawn at the map's aspect.
async function loadThumb({ map, frame, meta }) {
  try {
    const { sx, sz, size, dxt1 } = await window.studio.mapThumb(map.file);
    const square = new OffscreenCanvas(size, size);
    square.getContext('2d').putImageData(new ImageData(decodeDxt1(dxt1, size, size), size, size), 0, 0);
    const canvas = frame.querySelector('canvas');
    [canvas.width, canvas.height] = sx >= sz ? [size, Math.round((size * sz) / sx)] : [Math.round((size * sx) / sz), size];
    canvas.getContext('2d').drawImage(square, 0, 0, canvas.width, canvas.height);
    frame.classList.add('ready');
    meta.textContent = `${sx} × ${sz} · ${megabytes(map.sizeMB)}`;
  } catch (error) {
    console.warn(`No thumbnail for ${map.name}: ${error.message}`);
    thumbFailed(frame);
  }
}

/** Opens file (a BAR maps folder path), or asks for one when file is null. Failures show in the error panel. */
async function openMap(app, file) {
  if (opening) return;
  opening = true;
  $('oError').hidden = true;
  try {
    const doc = await window.studio.openMap(file);
    if (!doc.cancelled) app.adoptDoc(doc);
  } catch (error) {
    console.warn(error);
    showError(error.message);
  } finally {
    opening = false;
    hideLoading();
  }
}

function showError(message) {
  const box = $('oError');
  box.replaceChildren(icon('circle-alert', 'lg'),
    el('div', { class: 'text' }, el('strong', {}, 'This map could not be opened'), el('span', {}, message)),
    btn('Dismiss', { class: 'btn ghost', onclick: () => { box.hidden = true; } }));
  box.hidden = false;
}
