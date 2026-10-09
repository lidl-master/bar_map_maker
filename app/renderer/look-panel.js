// The Look tab: biome, trees and rocks, the export quality preset (WP 2.2) and, last because it is long, paint materials.
import { BIOMES } from '../../src/look/index.js';
import { $, btn, el, formatInt, note, section, segmented, slider, toggle } from './dom.js';
import { toast, withLoading } from './feedback.js';
import { runJob } from './generator.js';
import { icon } from './icons.js';
import { materialPicker } from './materials.js';
import { biomeChoices } from './pickers.js';

export const QUALITY = {
  share: { label: 'Share · ≤ 50 MB', help: 'Keeps the archive under 50 MB for sharing and downloads; textures are slightly softer.' },
  standard: { label: 'Standard', help: 'Full texture detail. A larger archive, fine for local play and testing.' },
};

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

  buildFeatures(editor, panel);

  const quality = section(panel, 'Export quality');
  const help = el('p', { class: 'note' }, QUALITY[editor.exportQuality].help);
  quality.append(segmented(Object.entries(QUALITY).map(([key, q]) => [key, q.label]), editor.exportQuality, (key) => {
    editor.setExportQuality(key);
    help.textContent = QUALITY[key].help;
  }, 'block'), help);

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
    class: 'btn primary block',
    onclick: async () => {
      const kinds = ['trees', 'rocks'].filter((k) => s[k]);
      if (!kinds.length) {
        toast('Turn on trees, rocks or both first.', 'warn');
        return;
      }
      const result = await withLoading('Scattering features', `${kinds.join(' and ')} · density ${s.density}%`,
        () => runJob('scatterFeatures', { doc, density: s.density / 100, seed: Math.floor(Math.random() * 1e6), kinds }));
      if (!result) return;
      editor.editObjects('scatter features', () => { doc.objects = result.objects; });
      buildLook(editor);
      toast(`${formatInt(result.added)} features placed${result.removed ? `, ${formatInt(result.removed)} replaced` : ''}`, 'ok');
    },
  }, 'trees'));
}
