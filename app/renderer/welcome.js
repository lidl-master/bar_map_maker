// Welcome screen: template gallery, recent maps (local autosave), continue editing, open existing map (coming in Wave 3).
import { BIOMES } from '../../src/look/index.js';
import { TEMPLATES } from '../../src/terrain/index.js';
import { $, el, emptyState } from './dom.js';
import { icon } from './icons.js';
import { listMaps } from './recent.js';
import { openShortcuts } from './shortcuts.js';
import { paintThumb, templateThumbs, thumbFailed, thumbFrame } from './thumbs.js';

// Each card previews its template in the biome it suits best; picking the card starts New Map with that biome.
const SHOWCASE = {
  flat: 'temperate', hills: 'temperate', mountains: 'arctic', mesas: 'desert', canyons: 'redPlanet',
  islands: 'tropical', continents: 'temperate', craters: 'lunar', 'volcano-koth': 'volcanic',
};
const PLAYERS = '2–16 players'; // every template places 2..16 players (src/terrain checkPlayers)
const ago = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function initWelcome(app) {
  $('wNew').addEventListener('click', () => app.openNewMap());
  $('wHelp').addEventListener('click', openShortcuts);
  $('wContinue').addEventListener('click', () => app.showScreen('editor'));

  const frames = new Map();
  $('wTemplates').append(...TEMPLATES.map((t) => {
    const frame = thumbFrame(), biome = SHOWCASE[t.id] ?? 'temperate';
    frames.set(t.id, frame);
    const tags = el('span', { class: 'tags' }, el('span', { class: 'badge' }, icon('users'), PLAYERS), el('span', { class: 'badge' }, BIOMES[biome].label));
    if (t.symmetry) tags.append(el('span', { class: 'badge accent' }, icon('lock'), 'Fixed symmetry'));
    return el('button', { class: 'tpl-card', 'data-template': t.id, onclick: () => app.openNewMap({ template: t.id, biome }) },
      frame, el('span', { class: 'text' }, el('span', { class: 'name' }, t.label), el('span', { class: 'desc' }, t.description), tags));
  }));

  // 6 × 4 previews fill the 3:2 cards edge to edge.
  const items = TEMPLATES.map((t) => ({ id: t.id, symmetry: 'rot180', biome: SHOWCASE[t.id] ?? 'temperate', sx: 6, sz: 4 }));
  templateThumbs(items, 4).then(
    (thumbs) => { for (const [id, thumb] of thumbs) paintThumb(frames.get(id), thumb); },
    (error) => {
      console.error(error);
      for (const frame of frames.values()) thumbFailed(frame);
    },
  );
}

/** Refreshes "continue editing" and the recent maps; called whenever the welcome screen is shown. */
export async function refreshWelcome(app) {
  $('wContinue').hidden = !app.doc;
  if (app.doc) $('wContinue').querySelector('.label').textContent = `Continue editing ${app.doc.settings.name}`;
  const list = $('recentList');
  try {
    const maps = await listMaps();
    list.replaceChildren(...maps.map((m) => recentRow(m, app)));
    if (!maps.length) list.replaceChildren(emptyState('clock', 'No recent maps yet', 'Maps you create are saved on this computer as you work.'));
  } catch (error) {
    list.replaceChildren(emptyState('triangle-alert', 'Recent maps are unavailable', error.message));
  }
}

function recentRow(m, app) {
  const canvas = el('canvas', { width: m.thumb.size, height: m.thumb.size });
  canvas.getContext('2d').putImageData(new ImageData(m.thumb.rgba, m.thumb.size, m.thumb.size), 0, 0);
  const minutes = Math.round((m.savedAt - Date.now()) / 60000);
  const when = Math.abs(minutes) < 60 ? ago.format(minutes, 'minute') : Math.abs(minutes) < 1440 ? ago.format(Math.round(minutes / 60), 'hour') : ago.format(Math.round(minutes / 1440), 'day');
  return el('button', { class: 'recent', onclick: () => app.openRecent(m.key) },
    canvas,
    el('span', {}, el('span', { class: 'name' }, m.name), el('span', { class: 'meta num' }, `${m.sx} × ${m.sz} · ${BIOMES[m.biome]?.label ?? m.biome} · ${m.players} players`)),
    el('span', { class: 'when' }, app.docKey === m.key ? 'Open' : when));
}
