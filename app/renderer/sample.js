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

// Colour-blind safe and muted: teal, amber, magenta (hatched in 2D), two blues, dark red. The 2D view lays them at 65 %
// over a hillshade, so the relief still reads.
export const PATHING_LEGEND = {
  all: { color: [52, 158, 146], label: `All ground units (≤ ${PATHING.vehicle}°)` },
  bots: { color: [222, 164, 58], label: `Bots only (${PATHING.vehicle}–${PATHING.bot}°)` },
  none: { color: [196, 70, 160], label: `Impassable (> ${PATHING.bot}°)` },
  shallow: { color: [120, 170, 232], label: `Shallow water (≤ ${PATHING.wade} elmos)` },
  deep: { color: [48, 86, 178], label: 'Deep water (ships, hovers)' },
  lava: { color: [150, 36, 28], label: 'Lava (deadly)' },
};
