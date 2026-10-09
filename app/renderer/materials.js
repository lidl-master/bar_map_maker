// Paint materials as swatches for the Paint tool and the Look tab, and the optional pieces other work packages deliver.
// doc.paint holds src/look MATERIALS index + 1 (0 = automatic). WP 2.1's texture library supplies thumbnails when present.
import { BIOMES, MATERIALS } from '../../src/look/index.js';
import { choice, el } from './dom.js';

const MANIFEST = 'src/look/library-manifest.js';
const FEATURES = 'src/terrain/features.js';
const thumbPath = (id) => `assets/textures/thumbs/${id}.png`;

// Asked once: which optional files exist (no 404s in the console for pieces that are not built yet).
const optional = { library: [], thumbs: new Set(), features: false };

export async function loadOptional() {
  const [hasManifest, hasFeatures] = await window.studio.hasFiles([MANIFEST, FEATURES]);
  optional.features = hasFeatures;
  if (!hasManifest) return;
  optional.library = (await import(`../../${MANIFEST}`)).MATERIAL_LIBRARY ?? [];
  const found = await window.studio.hasFiles(optional.library.map((m) => thumbPath(m.id)));
  optional.thumbs = new Set(optional.library.filter((_, i) => found[i]).map((m) => m.id));
}

export const featuresAvailable = () => optional.features;

const css = (rgb) => `rgb(${rgb.map(Math.round).join(', ')})`;

/** [{value, label, color, thumb}] for the doc's biome; thumb is a served path or null. */
export function paintMaterials(doc) {
  const biome = BIOMES[doc.biome];
  return MATERIALS.map((m, i) => {
    // shortcut: matched by id/key until WP 2.2 makes paint ids library materials; revisit when smoothing wires 2.1 + 2.2.
    const lib = optional.library.find((l) => l.id === (m.id ?? m.key));
    return {
      value: i + 1,
      label: m.label,
      color: css(lib?.avgColor ?? m.avgColor ?? biome[m.key]),
      thumb: lib && optional.thumbs.has(lib.id) ? `../../${thumbPath(lib.id)}` : null,
    };
  });
}

/** A square swatch: the thumbnail over its average colour, so a missing image still shows the right colour. */
export function materialSwatch({ color, thumb }) {
  const swatch = el('span', { class: 'swatch square', 'aria-hidden': 'true' }, thumb ? el('img', { src: thumb, alt: '', draggable: 'false' }) : null);
  swatch.style.backgroundColor = color;
  return swatch;
}

let pickers = 0;

/** The paint material picker (Paint tool and Look tab): swatch radios with the chosen material's name below. */
export function materialPicker(doc, current, onPick) {
  const materials = paintMaterials(doc), name = `material-${++pickers}`;
  const caption = el('p', { class: 'note' });
  const show = (v) => { caption.textContent = materials.find((m) => m.value === v)?.label ?? ''; };
  const grid = el('div', { class: 'swatch-grid dense', role: 'radiogroup', 'aria-label': 'Paint material' }, ...materials.map((m) => {
    const card = choice({ name, value: m.value, checked: m.value === current, className: 'compact', onChange: (v) => { show(Number(v)); onPick(Number(v)); } }, materialSwatch(m));
    card.dataset.tip = m.label;
    card.querySelector('input').setAttribute('aria-label', m.label);
    return card;
  }));
  show(current);
  return el('div', {}, grid, caption);
}

/** A biome's ground, high ground, slope and shore colours as one gradient strip. */
export function biomeSwatch(key) {
  const b = BIOMES[key], swatch = el('span', { class: 'swatch', 'aria-hidden': 'true' });
  swatch.style.background = `linear-gradient(90deg, ${css(b.ground)} 0 30%, ${css(b.high)} 30% 55%, ${css(b.slope)} 55% 78%, ${css(b.sand)} 78%)`;
  return swatch;
}
