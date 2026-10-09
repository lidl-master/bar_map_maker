// Terrain read-outs for the UI (cursor, pathing colours, markers, flatten pick), on top of src/core's sampling.
import { SQUARE, slopeAt as worldSlopeAt } from '../../src/core/index.js';

export { SQUARE as SQ, UNIT, worldSize, sampleHeight as heightAt } from '../../src/core/index.js';

/** Slope in degrees at heightmap sample (i, j). */
export const slopeAt = (doc, i, j) => worldSlopeAt(doc, i * SQUARE, j * SQUARE);

// BAR movedefs: vehicles climb up to 27°, bots up to 54°, land units wade up to 20 elmos deep.
export const PATHING = { vehicle: 27, bot: 54, wade: 20 };

/** 'lava' | 'deep' | 'shallow' | 'all' | 'bots' | 'none' */
export function pathingClass(doc, i, j) {
  const h = doc.heights[j * doc.W + i], lava = doc.settings.lava;
  if (lava.enabled && h < lava.level) return 'lava';
  if (h < 0) return -h > PATHING.wade ? 'deep' : 'shallow';
  const slope = slopeAt(doc, i, j);
  return slope <= PATHING.vehicle ? 'all' : slope <= PATHING.bot ? 'bots' : 'none';
}

export const PATHING_LEGEND = {
  all: { color: [64, 160, 80], label: `All ground units (≤ ${PATHING.vehicle}°)` },
  bots: { color: [220, 190, 60], label: `Bots only (≤ ${PATHING.bot}°)` },
  none: { color: [200, 60, 50], label: 'Impassable cliff' },
  shallow: { color: [90, 150, 220], label: `Shallow water (wade ≤ ${PATHING.wade} elmos)` },
  deep: { color: [40, 80, 170], label: 'Deep water (ships, hovers)' },
  lava: { color: [255, 110, 0], label: 'Lava (deadly)' },
};
