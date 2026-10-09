// Metal map from metal spots. BAR shows a spot's value as sum(spot pixels) * maxMetal / 1000.
// Each spot is a hard-edged 21-pixel disc (5x5 minus corners, one pixel = 16 elmos) whose pixel sum
// is value * 1000 / maxMetal. maxMetal is the smallest whole number that fits the richest spot in 8 bits,
// so with maxMetal 1 (spots up to 5.355) every value with up to three decimals is exact.

const DISC = [];
for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dz * dz <= 5) DISC.push([dx, dz]);
/** The largest pixel sum one stamped spot holds. */
export const MAX_SPOT_SUM = DISC.length * 255;
const PIXEL_ELMOS = 16;

/** The smallest whole maxMetal (at least 1) that fits a spot worth `richest` in one disc. */
export const maxMetalFor = (richest) => Math.max(1, Math.ceil((richest * 1000) / MAX_SPOT_SUM));

/**
 * Writes a spot's disc into a metal map (replacing the pixels under it).
 * @param {{x: number, z: number, metal: number}} spot  elmos, in-game value
 * @returns {number} the in-game value the disc holds (the value rounded to whole pixel sums)
 */
export function stampSpot(data, width, height, { x, z, metal }, maxMetal) {
  const total = Math.round((metal * 1000) / maxMetal);
  if (total > MAX_SPOT_SUM) throw new Error(`a metal spot worth ${metal} does not fit maxMetal ${maxMetal}`);
  const cx = Math.min(Math.max(Math.floor(x / PIXEL_ELMOS), 2), width - 3);
  const cz = Math.min(Math.max(Math.floor(z / PIXEL_ELMOS), 2), height - 3);
  const base = Math.floor(total / DISC.length);
  DISC.forEach(([dx, dz], i) => {
    data[(cz + dz) * width + cx + dx] = base + (i < total - base * DISC.length ? 1 : 0);
  });
  return (total * maxMetal) / 1000;
}

/** The doc's metal objects, checked. */
export function metalObjects(doc) {
  const spots = doc.objects.filter((o) => o.type === 'metal');
  for (const s of spots) if (!(s.metal >= 0)) throw new Error(`metal spot ${s.id} has no valid metal value`);
  return spots;
}

/**
 * @param {import('../core/index.js').MapDoc} doc
 * @returns {{data: Uint8Array, width: number, height: number, maxMetal: number, values: number[]}}
 *   data: metal map (32*sx by 32*sz); values: in-game value of each metal object, in doc.objects order
 */
export function buildMetalMap(doc) {
  const width = doc.sx * 32, height = doc.sz * 32;
  const spots = metalObjects(doc);
  const maxMetal = maxMetalFor(Math.max(0, ...spots.map((s) => s.metal)));
  const data = new Uint8Array(width * height);
  const values = spots.map((s) => stampSpot(data, width, height, s, maxMetal));
  return { data, width, height, maxMetal, values };
}
