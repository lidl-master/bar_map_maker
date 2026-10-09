// Read-only terrain queries the UI needs (cursor read-out, pathing colours, markers, flatten pick).
// shortcut: local because the src/core contract has no sampling helpers; move there if core grows them.

export const SQ = 8; // elmos between heightmap samples
export const UNIT = 512; // elmos per map unit

export const worldSize = (doc) => [doc.sx * UNIT, doc.sz * UNIT];

const at = (doc, i, j) => doc.heights[Math.min(doc.H - 1, Math.max(0, j)) * doc.W + Math.min(doc.W - 1, Math.max(0, i))];

/** Bilinear height at world position (elmos). */
export function heightAt(doc, x, z) {
  const gx = Math.min(doc.W - 1.0001, Math.max(0, x / SQ)), gz = Math.min(doc.H - 1.0001, Math.max(0, z / SQ));
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const a = at(doc, i, j), b = at(doc, i + 1, j), c = at(doc, i, j + 1), d = at(doc, i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Slope in degrees at heightmap sample (i, j), central differences. */
export function slopeAt(doc, i, j) {
  const dx = (at(doc, i + 1, j) - at(doc, i - 1, j)) / (2 * SQ);
  const dz = (at(doc, i, j + 1) - at(doc, i, j - 1)) / (2 * SQ);
  return Math.atan(Math.hypot(dx, dz)) * (180 / Math.PI);
}

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
