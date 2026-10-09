// New Map dialog: starting terrain (live previews), size presets + custom size, players, symmetry pictograms, biome swatches.
import { SYMMETRY } from '../../src/core/index.js';
import { BIOMES } from '../../src/look/index.js';
import { TEMPLATES } from '../../src/terrain/index.js';
import { $, choice, clamp, el, formatInt } from './dom.js';
import { biomeChoices, symmetryChoices } from './pickers.js';
import { paintThumb, templateThumbs, thumbFailed, thumbFrame } from './thumbs.js';

const SIZE_PRESETS = [[8, '1v1'], [12, '2v2'], [16, '4v4'], [20, '6v6'], [24, '8v8']];
const evenSize = (v) => clamp(Math.round(+v / 2) * 2 || 2, 2, 32);
const SQUARE_ONLY = Object.keys(SYMMETRY).filter((m) => SYMMETRY[m].square);

const state = { template: TEMPLATES[0].id, sx: 12, sz: 12, players: 2, symmetry: 'rot180', biome: 'temperate' };
let symmetryCards = [], frames = new Map(), thumbTimer = 0, thumbRequest = 0;

const players = () => clamp(Math.round(+$('nmPlayers').value) || 2, 2, 16);
const forcedSymmetry = () => TEMPLATES.find((t) => t.id === state.template).symmetry;

export function initNewMap(onCreate) {
  const dialog = $('dlgNew');
  $('nmTemplates').append(...TEMPLATES.map((t) => {
    const frame = thumbFrame();
    frames.set(t.id, frame);
    return choice({ name: 'nm-template', value: t.id, checked: t.id === state.template, className: 'tpl-pick', onChange: chooseTemplate }, frame, el('span', { class: 'name' }, t.label));
  }));
  $('nmTemplates').after(el('p', { id: 'nmTemplateDesc', class: 'tpl-desc' }));
  showTemplateDesc();

  $('nmSizePresets').append(...SIZE_PRESETS.map(([size, label]) => el('button', {
    type: 'button', 'data-size': size, 'aria-pressed': 'false', onclick: () => setSize(size, size),
  }, el('b', {}, `${size} × ${size}`), el('span', {}, label))));
  for (const input of [$('nmWidth'), $('nmHeight')]) {
    input.addEventListener('change', () => setSize($('nmWidth').value, $('nmHeight').value));
    input.addEventListener('input', showSize);
  }

  const step = (d) => { $('nmPlayers').value = clamp(players() + d, 2, 16); playersChanged(); };
  $('nmPlayersDown').addEventListener('click', () => step(-1));
  $('nmPlayersUp').addEventListener('click', () => step(1));
  $('nmPlayers').addEventListener('change', () => { $('nmPlayers').value = players(); playersChanged(); });

  symmetryCards = symmetryChoices('nm-symmetry', state.symmetry, (v) => { state.symmetry = v; refresh(); });
  $('nmSymmetry').append(...symmetryCards);
  $('nmBiome').append(...biomeChoices('nm-biome', state.biome, (v) => { state.biome = v; refresh(); }));

  for (const b of dialog.querySelectorAll('[data-close]')) b.addEventListener('click', () => dialog.close());
  $('nmCreate').addEventListener('click', () => {
    setSize($('nmWidth').value, $('nmHeight').value);
    state.players = players();
    dialog.close();
    onCreate({ ...state, seed: Math.floor(Math.random() * 1e6) }, summary());
  });
}

/** Opens the dialog, optionally preselecting a template and biome (from a welcome screen card). */
export function openNewMap({ template, biome } = {}) {
  if (template && check('nm-template', template)) chooseTemplate(template);
  if (biome && check('nm-biome', biome)) state.biome = biome;
  setSize(state.sx, state.sz);
  refresh();
  $('dlgNew').showModal();
  $('nmTemplates').querySelector('input:checked').focus();
}

function check(name, v) {
  const input = document.querySelector(`input[name="${name}"][value="${CSS.escape(v)}"]`);
  if (input) input.checked = true;
  return Boolean(input);
}

function chooseTemplate(id) {
  state.template = id;
  showTemplateDesc();
  applySymmetryRules();
  refresh();
}

function showTemplateDesc() {
  const t = TEMPLATES.find((x) => x.id === state.template);
  $('nmTemplateDesc').replaceChildren(el('b', {}, t.label), ` — ${t.description}`);
}

function setSize(w, h) {
  state.sx = evenSize(w);
  state.sz = evenSize(h);
  $('nmWidth').value = state.sx;
  $('nmHeight').value = state.sz;
  applySymmetryRules();
  showSize();
  showSummary();
}

function showSize() {
  const w = +$('nmWidth').value, h = +$('nmHeight').value;
  for (const b of $('nmSizePresets').children) b.setAttribute('aria-pressed', String(+b.dataset.size === w && w === h));
  $('nmSizeNote').textContent = `${formatInt(evenSize(w) * 512)} × ${formatInt(evenSize(h) * 512)} elmos`;
}

function playersChanged() {
  state.players = players();
  refresh();
}

// A template built for one symmetry sets and locks it; diagonal and 90° symmetry need a square map.
function applySymmetryRules() {
  const forced = forcedSymmetry(), square = state.sx === state.sz;
  if (forced) state.symmetry = forced;
  else if (!square && SQUARE_ONLY.includes(state.symmetry)) state.symmetry = 'rot180';
  for (const card of symmetryCards) {
    const input = card.querySelector('input'), mode = input.value;
    input.disabled = forced ? mode !== forced : !square && SQUARE_ONLY.includes(mode);
    input.checked = mode === state.symmetry;
    card.dataset.tip = forced && mode !== forced ? 'Set by the template' : !square && SQUARE_ONLY.includes(mode) ? `${SYMMETRY[mode].label}: needs a square map` : SYMMETRY[mode].label;
  }
  $('nmSymLock').hidden = !forced;
}

function summary() {
  const t = TEMPLATES.find((x) => x.id === state.template);
  return `${t.label} · ${state.sx} × ${state.sz} · ${state.players} players · ${SYMMETRY[state.symmetry].label} · ${BIOMES[state.biome].label}`;
}

function showSummary() {
  state.players = players();
  $('nmSummary').textContent = summary();
}

// Previews follow symmetry, biome and player count; quick clicks on the stepper are batched.
function refresh() {
  showSummary();
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(async () => {
    const request = ++thumbRequest;
    // A template that forces its own symmetry ignores this one (the worker applies it).
    const items = TEMPLATES.map((t) => ({ id: t.id, symmetry: forcedSymmetry() ? 'rot180' : state.symmetry, biome: state.biome, sx: 4, sz: 4 }));
    try {
      const thumbs = await templateThumbs(items, state.players);
      if (request !== thumbRequest) return; // a newer request is on its way
      for (const [id, thumb] of thumbs) paintThumb(frames.get(id), thumb);
    } catch (error) {
      console.error(error);
      for (const frame of frames.values()) thumbFailed(frame);
    }
  }, 120);
}
