// The Generate and Map tabs. Rebuilt whenever a new map is loaded or a history step replaced doc parts.
import { SYMMETRY } from '../../src/core/index.js';
import { TEMPLATES } from '../../src/terrain/index.js';
import { $, btn, el, formatInt, note, section, select, slider, stepper, text, toggle, value } from './dom.js';
import { confirmDialog, withLoading } from './feedback.js';
import { runJob } from './generator.js';
import { icon } from './icons.js';
import { buildLook } from './look-panel.js';
import { counts } from './objects.js';

export function buildPanels(editor) {
  buildGenerate(editor);
  buildLook(editor);
  buildMap(editor);
}

const randomSeed = () => Math.floor(Math.random() * 1e6);

function buildGenerate(editor) {
  const panel = $('tab-generate'), doc = editor.doc;
  const gen = { template: TEMPLATES[0].id, seed: randomSeed(), players: Math.max(2, counts(doc).starts) };
  panel.replaceChildren();

  const terrain = section(panel, 'Terrain');
  note(terrain, 'Replaces the terrain and resources, keeping size, symmetry and map settings. Ctrl+Z undoes it.');
  select(terrain, 'Template', gen, 'template', TEMPLATES.map((t) => [t.id, t.label]));
  terrain.append(el('div', { class: 'row' }, el('label', { for: 'genPlayers' }, 'Players'), stepper(gen, 'players', { min: 2, max: 16, label: 'Players', id: 'genPlayers' })));
  const seed = el('input', { id: 'genSeed', class: 'field num', type: 'number', min: 0, max: 999999 });
  seed.value = gen.seed;
  seed.addEventListener('change', () => { gen.seed = Math.max(0, Math.round(+seed.value) || 0); seed.value = gen.seed; });
  const dice = el('button', { class: 'btn square', 'data-tip': 'Random seed', 'aria-label': 'Random seed', onclick: () => { gen.seed = randomSeed(); seed.value = gen.seed; } }, icon('dice-5'));
  terrain.append(el('div', { class: 'row' }, el('label', { for: 'genSeed' }, 'Seed'), el('div', { class: 'seed-row' }, seed, dice)));
  terrain.append(btn('Generate terrain', {
    class: 'btn accent-icon block',
    onclick: async () => {
      const label = TEMPLATES.find((t) => t.id === gen.template).label;
      const fresh = await withLoading('Generating terrain…', `${label} · ${gen.players} players · seed ${gen.seed}`,
        () => runJob('newMap', { sx: doc.sx, sz: doc.sz, symmetry: doc.symmetry, biome: doc.biome, ...gen }));
      if (fresh) editor.replaceTerrain(fresh, 'generate terrain');
    },
  }, 'mountain'));

  const resources = section(panel, 'Resources');
  note(resources, 'Places start positions, metal spots and geothermal vents for the player count above, mirrored by the symmetry.');
  resources.append(el('div', { class: 'stack-sm' },
    btn('Auto-place resources', {
      class: 'btn accent-icon block',
      onclick: async () => {
        const placed = await withLoading('Placing resources…', `${gen.players} players · seed ${gen.seed}`, () => runJob('placeResources', { doc, players: gen.players, seed: gen.seed }));
        if (placed) editor.replaceTerrain(placed, 'place resources');
      },
    }, 'circle-dot'),
    btn('Remove all resources', {
      class: 'btn danger block',
      onclick: async () => {
        const ok = await confirmDialog({ title: 'Remove all resources?', text: 'Every start position, metal spot and geothermal vent is removed. You can undo this with Ctrl+Z.', ok: 'Remove all' });
        if (ok) editor.editObjects('remove resources', () => { doc.objects = doc.objects.filter((o) => o.type === 'feature'); });
      },
    }, 'trash'),
  ));
}

function buildMap(editor) {
  const panel = $('tab-map'), doc = editor.doc, s = doc.settings;
  const changed = () => editor.markDirty();
  panel.replaceChildren();

  const info = section(panel, 'Map info');
  text(info, 'Name', s, 'name', () => editor.renamed()).dataset.field = 'name'; // kept in step with the top bar's name
  text(info, 'Version', s, 'version', changed);
  text(info, 'Author', s, 'author', changed);
  text(info, 'Description', s, 'description', changed, true);

  const size = section(panel, 'Size');
  value(size, 'Map size', `${doc.sx} × ${doc.sz} units`);
  value(size, 'In elmos', `${formatInt(doc.sx * 512)} × ${formatInt(doc.sz * 512)}`);
  value(size, 'Symmetry', SYMMETRY[doc.symmetry].label);

  const play = section(panel, 'Gameplay');
  slider(play, 'Wind min', s, 'minWind', { min: 0, max: 30, onChange: changed });
  slider(play, 'Wind max', s, 'maxWind', { min: 0, max: 30, onChange: changed });
  slider(play, 'Tidal', s, 'tidalStrength', { min: 0, max: 25, onChange: changed });

  const lava = section(panel, 'Lava');
  note(lava, 'Everything below the lava level becomes BAR\'s animated, damaging lava instead of water.');
  toggle(lava, 'Lava instead of water', s.lava, 'enabled', () => editor.lookChanged());
  slider(lava, 'Level', s.lava, 'level', { min: -100, max: 1000, onChange: () => editor.lookChanged() });
}
