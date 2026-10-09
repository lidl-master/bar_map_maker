// Module worker: terrain generation, resource placement, feature scatter and template previews run here, off the UI thread.
import { createMap, worldSize } from '../../src/core/index.js';
import { BIOMES, previewColor } from '../../src/look/index.js';
import { TEMPLATES, generate, placeResources, scatterFeatures } from '../../src/terrain/index.js';

const PX_PER_UNIT = 40; // preview pixels per map unit; previews use 4×4 or 6×4 maps, so terrain reads like a whole map

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

  /** Replaces the scattered trees and/or rocks; returns the new objects list and the counts. */
  scatterFeatures({ doc, density, seed, kinds }) {
    const counts = scatterFeatures(doc, { density, seed, kinds });
    return { objects: doc.objects, ...counts };
  },

  /** A preview per item ({id, symmetry, biome, sx, sz}): RGBA pixels plus the start positions (0..1) for team dots. */
  thumbnails({ items, players }) {
    return items.map(({ id, symmetry, biome, sx, sz }) => {
      const template = TEMPLATES.find((t) => t.id === id);
      const doc = createMap({ sx, sz, symmetry: template.symmetry ?? symmetry, biome });
      generate(doc, id, { players, seed: 7 });
      const width = sx * PX_PER_UNIT, height = sz * PX_PER_UNIT, rgba = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const rgb = previewColor(doc, Math.round((x / (width - 1)) * (doc.W - 1)), Math.round((y / (height - 1)) * (doc.H - 1)));
          rgba.set([...rgb, 255], (y * width + x) * 4);
        }
      }
      const [w, h] = worldSize(doc);
      for (const o of doc.objects) { // trees darken and rocks lighten their pixel, so groves read as texture
        if (o.type !== 'feature') continue;
        const at = (Math.min(height - 1, Math.round((o.z / h) * height)) * width + Math.min(width - 1, Math.round((o.x / w) * width))) * 4;
        const [k, add] = o.name.startsWith('rocks') ? [0.7, 60] : [0.55, 0];
        for (let c = 0; c < 3; c++) rgba[at + c] = rgba[at + c] * k + add;
      }
      const starts = doc.objects.filter((o) => o.type === 'start').map((o) => [o.x / w, o.z / h]);
      return { id, width, height, rgba, starts };
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
