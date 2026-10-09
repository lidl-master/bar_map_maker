// Automatic placement of start positions, metal spots and geothermal vents, mirrored by the
// doc's symmetry (mirrored copies share a group).
import { addGroup, addObject, images, orbit, sampleHeight, slopeAt, symMode, symmetrize, worldSize } from '../core/index.js';
import { flattenAround } from './brush.js';
import { clearAroundResources } from './features.js';
import { mulberry32 } from './noise.js';

const TAU = Math.PI * 2;
const RESOURCES = new Set(['start', 'metal', 'geo']);
const PAIR_CHANCE = 0.35; // expansions often come in 2-spot clusters on BAR maps

export function checkPlayers(players) {
  if (!Number.isInteger(players) || players < 2 || players > 16) throw new RangeError(`players must be an integer in 2..16, got ${players}`);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const nearest = (p, pts) => pts.reduce((d, q) => Math.min(d, dist(p, q)), Infinity);

// Dry, not too steep, away from the map edge.
function isGood(doc, x, z, margin, maxSlope) {
  const [ww, wh] = worldSize(doc);
  if (x < margin || z < margin || x > ww - margin || z > wh - margin) return false;
  return sampleHeight(doc, x, z) >= 2 && slopeAt(doc, x, z) <= maxSlope;
}

/**
 * Replace start positions, metal and geos (features are kept, except scattered ones now in the way). Counts are
 * map totals; mirrored groups round them to the symmetry's orbit size. Defaults scale with the map area.
 */
export function placeResources(doc, { players, metalPerBase = 4, expansions, geos, metalValue = 2, flattenBases = true, seed = 1 }) {
  checkPlayers(players);
  const area = doc.sx * doc.sz, mode = symMode(doc), [ww, wh] = worldSize(doc), m = Math.min(ww, wh);
  expansions ??= Math.round(area / 9 + 4);
  geos ??= area >= 100 ? 4 : 2;
  const rnd = mulberry32(seed + 31), inSrc = (x, z) => mode.src(x, z, ww, wh), sides = mode.T.length;
  doc.objects = doc.objects.filter((o) => !RESOURCES.has(o.type));

  const bases = placeStarts(doc, players, rnd);
  const starts = doc.objects.filter((o) => o.type === 'start').map((o) => [o.x, o.z]);
  if (flattenBases) for (const [x, z] of starts) flattenAround(doc, x, z, 280, 420, 6);

  const spots = [];
  const addSpot = (type, x, z, props) => { for (const o of addObject(doc, type, x, z, props)) spots.push([o.x, o.z]); };
  // Room around a candidate: to every placed spot and to its own mirror images (one near the symmetry axis would touch
  // its twin, and BAR's spot finder sees touching metal as one spot). An image on the point itself is the point.
  const room = (x, z) => nearest([x, z], [...spots, ...images(doc, x, z).filter((p) => dist(p, [x, z]) > 1)]);
  const free = (x, z, d) => room(x, z) >= d;
  // Base metal: a ring around each start (source side; mirrored).
  for (const [sx, sz] of bases) {
    const a0 = rnd() * TAU;
    for (let t = 0, placed = 0; t < 200 && placed < metalPerBase; t++) {
      const ang = a0 + placed / metalPerBase * TAU + (rnd() - 0.5) * 0.9 + t * 0.07, r = 260 + rnd() * 220;
      const x = sx + Math.cos(ang) * r, z = sz + Math.sin(ang) * r;
      if ((t < 150 && !inSrc(x, z)) || !isGood(doc, x, z, 96, 13) || !free(x, z, 150)) continue;
      addSpot('metal', x, z, { metal: metalValue });
      placed++;
    }
  }
  // Expansion metal: spread out, away from bases.
  for (let n = 0, want = Math.round(expansions / sides); n < want; n++) {
    const best = bestSpot(rnd, ww, wh, (x, z) => {
      if (!inSrc(x, z) || !isGood(doc, x, z, 96, 13) || nearest([x, z], starts) < 600) return null;
      const d = room(x, z);
      return d < 180 ? null : Math.min(d, 900) + rnd() * 120;
    }, 400);
    if (!best) break;
    addSpot('metal', best[0], best[1], { metal: metalValue });
    if (n + 1 < want && rnd() < PAIR_CHANCE) {
      const ang = rnd() * TAU, x = best[0] + Math.cos(ang) * 170, z = best[1] + Math.sin(ang) * 170;
      if (inSrc(x, z) && isGood(doc, x, z, 96, 13) && free(x, z, 150)) { addSpot('metal', x, z, { metal: metalValue }); n++; }
    }
  }
  // Geothermal vents: a third of the map away from the bases.
  for (let n = 0, want = geos > 0 ? Math.max(1, Math.round(geos / sides)) : 0; n < want; n++) {
    const best = bestSpot(rnd, ww, wh, (x, z) => {
      if (!inSrc(x, z) || !isGood(doc, x, z, 96, 13)) return null;
      const dStart = nearest([x, z], starts);
      return dStart < 500 || !free(x, z, 200) ? null : -Math.abs(dStart - m * 0.3) + rnd() * 200;
    }, 300);
    if (best) addSpot('geo', best[0], best[1]);
  }
  // A small level pad under every steep metal spot so extractors are always buildable, and under every geo the whole
  // footprint of BAR's T2 geothermal (80 elmos square, centred on the 16-elmo build grid: up to 68 elmos out).
  for (const o of doc.objects) {
    if (o.type === 'geo') flattenAround(doc, o.x, o.z, 72, 80, 6);
    else if (o.type === 'metal' && slopeAt(doc, o.x, o.z) > 6) flattenAround(doc, o.x, o.z, 40, 80, 6);
  }
  symmetrize(doc, 0.01);
  clearAroundResources(doc);
}

/** Start positions for `players` (mirrored, as placeResources places them), replacing the doc's starts; nothing else changes. */
export function placeStartPositions(doc, players, seed = 1) {
  checkPlayers(players);
  doc.objects = doc.objects.filter((o) => o.type !== 'start');
  placeStarts(doc, players, mulberry32(seed + 31));
}

// Highest-scoring random point over `tries`; score(x, z) returns null to reject.
function bestSpot(rnd, ww, wh, score, tries) {
  let best = null, bs = -Infinity;
  for (let t = 0; t < tries; t++) {
    const x = rnd() * ww, z = rnd() * wh, s = score(x, z);
    if (s !== null && s > bs) { bs = s; best = [x, z]; }
  }
  return best;
}

/**
 * Exactly `players` starts: farthest-point picks in the source domain plus their mirror images
 * (the last orbit is trimmed when players is not a multiple of it). Team order: every start on the
 * source side first, then each mirrored side. Returns the source-side picks.
 */
function placeStarts(doc, players, rnd) {
  const [ww, wh] = worldSize(doc), m = Math.min(ww, wh), mode = symMode(doc), picks = [], side = new Map();
  for (let made = 0; made < players;) {
    let best = [ww / 2, wh / 2], bestScore = -Infinity;
    for (let t = 0; t < 600; t++) {
      const x = rnd() * ww, z = rnd() * wh, edge = Math.min(x, ww - x, z, wh - z) / m, strict = t < 500;
      if (!mode.src(x, z, ww, wh) || (strict && (edge < 0.06 || !isGood(doc, x, z, m * 0.08, 25)))) continue;
      // Far from every start so far and from our own mirror images; bases sit near the map edge.
      const own = images(doc, x, z).slice(1);
      let d = picks.length || own.length ? Infinity : dist([x, z], [ww / 2, wh / 2]);
      for (const p of picks) d = Math.min(d, nearest([x, z], images(doc, p[0], p[1])));
      d = Math.min(d, nearest([x, z], own) * 0.9);
      const score = d - Math.abs(edge - 0.14) * m * 4;
      if (score > bestScore) { bestScore = score; best = [x, z]; }
    }
    picks.push(best);
    const imgs = orbit(doc, best[0], best[1]).slice(0, players - made);
    addGroup(doc, 'start', imgs).forEach((o, n) => side.set(o, imgs[n][2]));
    made += imgs.length;
  }
  const starts = doc.objects.filter((o) => side.has(o)).sort((a, b) => side.get(a) - side.get(b));
  doc.objects = [...starts, ...doc.objects.filter((o) => !side.has(o))];
  return picks;
}
