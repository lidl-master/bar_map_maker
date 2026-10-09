// Module worker: terrain generation, resource placement, feature scatter and template previews run here, off the UI thread.
import { createMap, worldSize } from '../../src/core/index.js';
import { BIOMES, previewColor } from '../../src/look/index.js';
import { TEMPLATES, generate, placeResources } from '../../src/terrain/index.js';

const THUMB = 160; // px; drawn from a 4×4 map so the terrain reads like a whole map, not a close-up

const jobs = {
  newMap({ sx, sz, symmetry, biome, template, players, seed }) {
    const doc = createMap({ sx, sz, symmetry, biome });
    doc.settings.sunDir = [...BIOMES[biome].sunDir];
    generate(doc, template, { players, seed }); // also places starts, metal and geos
    return doc;
  },

  placeResources({ doc, players, seed }) {
    placeResources(doc, { players, seed });
    return doc;
  },

  /** WP 2.3's scatter; loaded on demand, the Look tab only offers it when the module exists. */
  async scatterFeatures({ doc, density, seed }) {
    const { scatterFeatures } = await import('../../src/terrain/features.js');
    scatterFeatures(doc, { density, seed });
    return doc.objects;
  },

  /** A preview per item ({id, symmetry, biome}): RGBA pixels plus the start positions (0..1) for team dots. */
  thumbnails({ items, players }) {
    return items.map(({ id, symmetry, biome }) => {
      const template = TEMPLATES.find((t) => t.id === id);
      const doc = createMap({ sx: 4, sz: 4, symmetry: template.symmetry ?? symmetry, biome });
      generate(doc, id, { players, seed: 7 });
      const rgba = new Uint8ClampedArray(THUMB * THUMB * 4);
      for (let y = 0; y < THUMB; y++) {
        for (let x = 0; x < THUMB; x++) {
          const rgb = previewColor(doc, Math.round((x / (THUMB - 1)) * (doc.W - 1)), Math.round((y / (THUMB - 1)) * (doc.H - 1)));
          rgba.set([...rgb, 255], (y * THUMB + x) * 4);
        }
      }
      const [w, h] = worldSize(doc);
      const starts = doc.objects.filter((o) => o.type === 'start').map((o) => [o.x / w, o.z / h]);
      return { id, size: THUMB, rgba, starts };
    });
  },
};

self.onmessage = async ({ data: { id, type, args } }) => {
  try {
    self.postMessage({ id, result: await jobs[type](args) });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
