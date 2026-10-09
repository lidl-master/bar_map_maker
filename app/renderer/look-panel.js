// The Look tab: biome, trees and rocks and, last because it is long, paint materials.
import { BIOMES } from '../../src/look/index.js';
import { $, btn, el, formatInt, note, section, slider, toggle } from './dom.js';
import { toast, withLoading } from './feedback.js';
import { runJob } from './generator.js';
import { icon } from './icons.js';
import { materialPicker } from './materials.js';
import { biomeChoices } from './pickers.js';

export function buildLook(editor) {
  const panel = $('tab-look'), doc = editor.doc;
  panel.replaceChildren();

  const biome = section(panel, 'Biome');
  note(biome, 'Sets ground colours, sky, sun and water. Painted areas keep their material.');
  biome.append(el('div', { class: 'swatch-grid', role: 'radiogroup', 'aria-label': 'Biome' }, ...biomeChoices('look-biome', doc.biome, (key) => {
    doc.biome = key;
    doc.settings.sunDir = [...BIOMES[key].sunDir];
    editor.lookChanged();
    buildLook(editor); // material colours follow the biome
    editor.refreshToolPanel();
  })));
  // Off: BAR's grass grows on grassy materials only. On: on all ground vehicles can cross (src/look/grass.js).
  toggle(biome, 'Grass on all open ground', doc.settings, 'openGrass', () => editor.markDirty());

  buildFeatures(editor, panel);

  const paint = section(panel, 'Paint materials');
  note(paint, 'Pick a material, then drag on the map. Shift-drag paints back to automatic.');
  paint.append(materialPicker(doc, editor.settings.paint.material, (material) => {
    editor.settings.paint.material = material;
    editor.setTool('paint');
  }));
}

const featureCount = (doc) => doc.objects.filter((o) => o.type === 'feature').length;

// Trees and rocks (src/terrain scatterFeatures): rescattering replaces the scattered ones and keeps hand-placed features.
function buildFeatures(editor, panel) {
  const doc = editor.doc, s = editor.featureSettings;
  const features = section(panel, 'Features', el('span', { class: 'badge num', 'data-tip': 'Features on the map' }, icon('trees'), formatInt(featureCount(doc))));
  note(features, 'BAR trees and rocks, placed by biome and slope. Ramps, bases and resources stay clear.');
  slider(features, 'Density', s, 'density', { min: 0, max: 100 });
  toggle(features, 'Trees', s, 'trees');
  toggle(features, 'Rocks', s, 'rocks');
  features.append(btn('Scatter features', {
    class: 'btn accent-icon block',
    onclick: async () => {
      const kinds = ['trees', 'rocks'].filter((k) => s[k]);
      if (!kinds.length) {
        toast('Turn on trees, rocks or both first.', 'warn');
        return;
      }
      const result = await withLoading('Scattering features…', `${kinds.join(' and ')} · density ${s.density}%`,
        () => runJob('scatterFeatures', { doc, density: s.density / 100, seed: Math.floor(Math.random() * 1e6), kinds }));
      if (!result) return;
      editor.editObjects('scatter features', () => { doc.objects = result.objects; });
      buildLook(editor);
      toast(`${formatInt(result.added)} features placed${result.removed ? `, ${formatInt(result.removed)} replaced` : ''}`, 'ok');
    },
  }, 'trees'));
}
