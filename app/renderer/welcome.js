// Welcome screen: template gallery, recent maps (local autosave), continue editing. Open existing map: open-map.js.
import { BIOMES } from '../../src/look/index.js';
import { TEMPLATES } from '../../src/terrain/index.js';
import { $, el, emptyState } from './dom.js';
import { icon } from './icons.js';
import { listMaps } from './recent.js';
import { openShortcuts } from './shortcuts.js';
import { paintThumb, showcaseBiome, templateThumbs, thumbFailed, thumbFrame } from './thumbs.js';

const THUMB_PX = 640; // canvas width: twice the widest card
const ago = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function initWelcome(app) {
  $('wNew').addEventListener('click', () => app.openNewMap());
  $('wHelp').addEventListener('click', openShortcuts);
  $('wContinue').addEventListener('click', () => app.showScreen('editor'));

  const frames = new Map();
  // One chip row per card: the biome it is shown in, and a lock when the template sets its own symmetry.
  $('wTemplates').append(...TEMPLATES.map((t) => {
    const frame = thumbFrame(), biome = showcaseBiome(t.id);
    frames.set(t.id, frame);
    const tags = el('span', { class: 'tags' }, el('span', { class: 'badge' }, BIOMES[biome].label),
      t.symmetry ? el('span', { class: 'badge', 'data-tip': 'The template sets its own symmetry' }, icon('lock'), 'Fixed symmetry') : null);
    return el('button', { class: 'tpl-card', 'data-template': t.id, onclick: () => app.openNewMap({ template: t.id, biome }) },
      frame, el('span', { class: 'text' }, el('span', { class: 'name' }, t.label), el('span', { class: 'desc' }, t.description), tags));
  }));

  // 6 × 4 previews fill the 3:2 cards edge to edge.
  const items = TEMPLATES.map((t) => ({ id: t.id, symmetry: 'rot180', biome: showcaseBiome(t.id), sx: 6, sz: 4 }));
  templateThumbs(items, 4).then(
    (thumbs) => { for (const [id, thumb] of thumbs) paintThumb(frames.get(id), thumb, THUMB_PX); },
    (error) => {
      console.error(error);
      for (const frame of frames.values()) thumbFailed(frame);
    },
  );
}

/** Refreshes "continue editing" and the recent maps; called whenever the welcome screen is shown. */
export async function refreshWelcome(app) {
  $('wContinue').hidden = !app.doc;
  if (app.doc) $('wContinue').querySelector('.action-text span').textContent = app.doc.settings.name;
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
  // The whole row opens the map; on hover the time gives way to a ghost Open button.
  const editing = app.docKey === m.key;
  return el('button', { class: 'recent', onclick: () => app.openRecent(m.key), 'aria-label': `Open ${m.name}` },
    canvas,
    el('span', {}, el('span', { class: 'name' }, m.name), el('span', { class: 'meta num', 'data-tip': BIOMES[m.biome]?.label ?? m.biome }, `${m.sx}×${m.sz} · ${m.players}p`)),
    el('span', { class: 'when' }, editing ? 'Editing' : when),
    el('span', { class: 'open-ghost', 'aria-hidden': 'true' }, 'Open'));
}
