// The Look tab: biome, paint materials, feature scatter (WP 2.3) and the export quality preset (WP 2.2).
import { BIOMES } from '../../src/look/index.js';
import { $, btn, el, formatInt, note, section, segmented, slider } from './dom.js';
import { toast, withLoading } from './feedback.js';
import { runJob } from './generator.js';
import { icon } from './icons.js';
import { featuresAvailable, materialPicker } from './materials.js';
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

  const paint = section(panel, 'Paint materials');
  note(paint, 'Pick a material, then drag on the map. Shift-drag paints back to automatic.');
  paint.append(materialPicker(doc, editor.settings.paint.material, (material) => {
    editor.settings.paint.material = material;
    editor.setTool('paint');
  }));

  buildFeatures(editor, panel);

  const quality = section(panel, 'Export quality');
  const help = el('p', { class: 'note' }, QUALITY[editor.exportQuality].help);
  quality.append(segmented(Object.entries(QUALITY).map(([key, q]) => [key, q.label]), editor.exportQuality, (key) => {
    editor.setExportQuality(key);
    help.textContent = QUALITY[key].help;
  }, 'block'), help);
}

const featureCount = (doc) => doc.objects.filter((o) => o.type === 'feature').length;

function buildFeatures(editor, panel) {
  const doc = editor.doc, s = editor.featureSettings;
  const features = section(panel, 'Features', el('span', { class: 'badge num' }, icon('trees'), formatInt(featureCount(doc))));
  if (!featuresAvailable()) {
    features.append(el('div', { class: 'callout' }, icon('info'), 'Trees and rocks arrive with the feature scatter update.'));
    slider(features, 'Density', s, 'density', { min: 0, max: 100 });
    features.querySelectorAll('input').forEach((input) => { input.disabled = true; });
    features.append(btn('Scatter features', { class: 'btn block', disabled: true }, 'trees'));
    return;
  }
  note(features, 'Trees and rocks from BAR, placed by biome and slope; ramps, bases and resources stay clear.');
  slider(features, 'Density', s, 'density', { min: 0, max: 100 });
  features.append(el('div', { class: 'btn-row' },
    btn('Scatter features', {
      class: 'btn primary',
      onclick: async () => {
        const objects = await withLoading('Scattering features', `Density ${s.density}%`, () => runJob('scatterFeatures', { doc, density: s.density / 100, seed: Math.floor(Math.random() * 1e6) }));
        if (!objects) return;
        editor.editObjects('scatter features', () => { doc.objects = objects; });
        buildLook(editor);
        toast(`${formatInt(featureCount(doc))} features on the map`, 'ok');
      },
    }, 'trees'),
    btn('Clear', {
      class: 'btn',
      disabled: !featureCount(doc),
      onclick: () => {
        editor.editObjects('clear features', () => { doc.objects = doc.objects.filter((o) => o.type !== 'feature'); });
        buildLook(editor);
      },
    }, 'trash'),
  ));
}
