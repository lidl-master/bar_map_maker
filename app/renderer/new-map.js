// New Map dialog: size, players, symmetry, biome and a starting-terrain template with live thumbnails.
import { BIOMES } from '../../src/look/index.js';
import { TEMPLATES } from '../../src/terrain/index.js';
import { $, busy, clamp, el, toast } from './dom.js';
import { runJob } from './generator.js';

export const SYMMETRIES = {
  rot180: 'Rotate 180° (point)',
  mirrorX: 'Mirror left ↔ right',
  mirrorZ: 'Mirror top ↕ bottom',
  quad: 'Quad mirror (4 corners)',
  rot90: 'Rotate 90° (4-way, square maps)',
  diag: 'Mirror diagonal ╲ (square maps)',
  adiag: 'Mirror diagonal ╱ (square maps)',
  none: 'None (free-form)',
};
const SQUARE_ONLY = ['rot90', 'diag', 'adiag'];

const evenSize = (input) => clamp(Math.round(+input.value / 2) * 2 || 2, 2, 32);
const players = () => clamp(Math.round(+$('nmPlayers').value) || 2, 2, 16);

let template = TEMPLATES[0].id;
let thumbnailRequest = 0;

export function initNewMap(editor) {
  $('nmSymmetry').append(...Object.entries(SYMMETRIES).map(([value, label]) => el('option', { value }, label)));
  $('nmBiome').append(...Object.entries(BIOMES).map(([value, biome]) => el('option', { value }, biome.label)));
  $('nmTemplates').append(...TEMPLATES.map((t) => {
    const button = el('button', { type: 'button', class: 'tpl', title: t.description, onclick: () => chooseTemplate(t.id) }, el('canvas', { width: 64, height: 64 }), t.label);
    button.dataset.template = t.id;
    return button;
  }));
  chooseTemplate(template);

  for (const input of [$('nmWidth'), $('nmHeight')]) input.addEventListener('change', normaliseSize);
  $('nmPlayers').addEventListener('change', () => { $('nmPlayers').value = players(); refreshThumbnails(); });
  $('nmSymmetry').addEventListener('change', refreshThumbnails);
  $('nmBiome').addEventListener('change', refreshThumbnails);
  $('nmCancel').addEventListener('click', () => $('dlgNew').close());
  $('nmCreate').addEventListener('click', () => create(editor));
}

export function openNewMap() {
  $('dlgNew').showModal();
  refreshThumbnails();
}

// A template built for one symmetry (Volcano – King of the Hill: mirror left ↔ right) sets and locks it.
function chooseTemplate(id) {
  template = id;
  for (const b of $('nmTemplates').children) b.classList.toggle('active', b.dataset.template === id);
  const forced = TEMPLATES.find((t) => t.id === id).symmetry, select = $('nmSymmetry');
  select.disabled = Boolean(forced);
  if (forced && select.value !== forced) {
    select.value = forced;
    refreshThumbnails();
  }
}

// BAR map sizes are even; diagonal and 90° symmetry only work on square maps.
function normaliseSize() {
  const w = evenSize($('nmWidth')), h = evenSize($('nmHeight'));
  $('nmWidth').value = w;
  $('nmHeight').value = h;
  for (const option of $('nmSymmetry').options) option.disabled = w !== h && SQUARE_ONLY.includes(option.value);
  if ($('nmSymmetry').selectedOptions[0].disabled) $('nmSymmetry').value = 'rot180';
}

async function refreshThumbnails() {
  const request = ++thumbnailRequest;
  try {
    const thumbs = await runJob('thumbnails', { symmetry: $('nmSymmetry').value, biome: $('nmBiome').value, players: players() });
    if (request !== thumbnailRequest) return; // a newer request is on its way
    for (const { id, size, rgba } of thumbs) {
      const canvas = $('nmTemplates').querySelector(`[data-template="${CSS.escape(id)}"] canvas`);
      canvas.getContext('2d').putImageData(new ImageData(rgba, size, size), 0, 0);
    }
  } catch (error) {
    toast(error.message, 8000);
  }
}

async function create(editor) {
  normaliseSize();
  const args = {
    sx: evenSize($('nmWidth')), sz: evenSize($('nmHeight')), players: players(), symmetry: $('nmSymmetry').value,
    biome: $('nmBiome').value, template, seed: Math.floor(Math.random() * 1e6),
  };
  $('dlgNew').close();
  const doc = await busy('Generating terrain…', () => runJob('newMap', args));
  if (doc) editor.setDoc(doc);
}
