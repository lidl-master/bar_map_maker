// Module worker: terrain generation and resource placement run here, off the UI thread.
import { createMap } from '../../src/core/index.js';
import { previewColor } from '../../src/look/index.js';
import { TEMPLATES, generate, placeResources } from '../../src/terrain/index.js';

const THUMB = 64;

const jobs = {
  newMap({ sx, sz, symmetry, biome, template, players, seed }) {
    const doc = createMap({ sx, sz, symmetry, biome });
    generate(doc, template, { players, seed });
    // Templates that place their own resources (Volcano – King of the Hill) keep them.
    if (!doc.objects.length) placeResources(doc, { players, seed });
    return doc;
  },

  placeResources({ doc, players, seed }) {
    placeResources(doc, { players, seed });
    return doc;
  },

  /** A small preview of every template on a 2×2 map. */
  thumbnails({ symmetry, biome, players }) {
    return TEMPLATES.map(({ id }) => {
      const doc = createMap({ sx: 2, sz: 2, symmetry, biome });
      generate(doc, id, { players, seed: 7 });
      const rgba = new Uint8ClampedArray(THUMB * THUMB * 4);
      for (let y = 0; y < THUMB; y++) {
        for (let x = 0; x < THUMB; x++) {
          const rgb = previewColor(doc, Math.round((x / (THUMB - 1)) * (doc.W - 1)), Math.round((y / (THUMB - 1)) * (doc.H - 1)));
          rgba.set([...rgb, 255], (y * THUMB + x) * 4);
        }
      }
      return { id, size: THUMB, rgba };
    });
  },
};

self.onmessage = ({ data: { id, type, args } }) => {
  try {
    self.postMessage({ id, result: jobs[type](args) });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
