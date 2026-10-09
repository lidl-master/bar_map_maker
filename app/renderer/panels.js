// The Generate, Look and Map tabs. Rebuilt whenever a new map is loaded.
import { BIOMES } from '../../src/look/index.js';
import { TEMPLATES } from '../../src/terrain/index.js';
import { $, busy, check, el, heading, note, select, slider, stat, text } from './dom.js';
import { runJob } from './generator.js';
import { counts } from './objects.js';
import { SYMMETRIES } from './new-map.js';

export function buildPanels(editor) {
  buildGenerate(editor);
  buildLook(editor);
  buildMap(editor);
}

function buildGenerate(editor) {
  const panel = $('tab-generate'), doc = editor.doc;
  const gen = { template: TEMPLATES[0].id, seed: Math.floor(Math.random() * 1e6), players: Math.max(2, counts(doc).starts) };
  const randomSeed = () => { gen.seed = Math.floor(Math.random() * 1e6); };
  panel.replaceChildren();

  heading(panel, 'Terrain');
  note(panel, 'Replaces the terrain and resources with a new one, keeping size, symmetry and map settings. Ctrl+Z undoes it.');
  select(panel, 'Template', gen, 'template', TEMPLATES.map((t) => [t.id, t.label]));
  slider(panel, 'Players', gen, 'players', 2, 16, 1);
  panel.append(el('button', {
    class: 'primary wide',
    onclick: async () => {
      const fresh = await busy('Generating terrain…', () => runJob('newMap', { sx: doc.sx, sz: doc.sz, symmetry: doc.symmetry, biome: doc.biome, ...gen }));
      if (fresh) editor.replaceTerrain(fresh, 'generate terrain');
      randomSeed();
    },
  }, 'Generate new terrain'));

  heading(panel, 'Resources');
  note(panel, 'Places start positions, metal spots and geothermal vents for the player count above, mirrored by the symmetry.');
  panel.append(el('button', {
    class: 'wide',
    onclick: async () => {
      const placed = await busy('Placing resources…', () => runJob('placeResources', { doc, players: gen.players, seed: gen.seed }));
      if (placed) editor.replaceTerrain(placed, 'place resources');
      randomSeed();
    },
  }, 'Auto-place resources'));
  panel.append(el('button', {
    class: 'wide danger',
    onclick: () => editor.editObjects('remove resources', () => { doc.objects = []; }),
  }, 'Remove all resources and starts'));
}

function buildLook(editor) {
  const panel = $('tab-look');
  panel.replaceChildren();
  heading(panel, 'Biome');
  note(panel, 'Sets the colours of the ground. Paint (P) overrides it locally.');
  select(panel, 'Biome', editor.doc, 'biome', Object.entries(BIOMES).map(([key, b]) => [key, b.label]), () => editor.lookChanged());
}

function buildMap(editor) {
  const panel = $('tab-map'), doc = editor.doc, s = doc.settings, changed = () => editor.lookChanged();
  panel.replaceChildren();

  heading(panel, 'Map info');
  text(panel, 'Name', s, 'name', () => editor.updateTitle());
  text(panel, 'Version', s, 'version');
  text(panel, 'Author', s, 'author');
  text(panel, 'Description', s, 'description', null, true);

  heading(panel, 'Size');
  stat(panel, 'Map size', `${doc.sx} × ${doc.sz}`);
  stat(panel, 'In elmos', `${doc.sx * 512} × ${doc.sz * 512}`);
  stat(panel, 'Symmetry', SYMMETRIES[doc.symmetry]);

  heading(panel, 'Gameplay');
  slider(panel, 'Wind min', s, 'minWind', 0, 30, 1);
  slider(panel, 'Wind max', s, 'maxWind', 0, 30, 1);
  slider(panel, 'Tidal strength', s, 'tidalStrength', 0, 25, 1);

  heading(panel, 'Lava');
  note(panel, 'Everything below the lava level becomes BAR\'s animated, damaging lava instead of water.');
  check(panel, 'Lava map', s.lava, 'enabled', changed);
  slider(panel, 'Lava level (elmos)', s.lava, 'level', -100, 1000, 1, changed);
}
