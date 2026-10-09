// Volcano – King of the Hill. One-way uphill assault: attackers start in the lowlands along the
// south edge, the kings hold the summit plateau around a lava-filled volcano at the north edge.
// Four sheer cliff tiers climb north, crossed by ramps that get fewer and narrower towards the top.
// Two lava rivers run from the crater to the lowlands and split the climb into three lanes, with
// land bridges on every tier. Mirror left <-> right. Metal is worth more the higher it sits.
//
// Everything is authored for a 32x32 map (16384 elmos) on the left half and scales with the map;
// noise inputs use the x folded onto the left half, and a final symmetrize mirrors the rest.
import { SQUARE, addObject, sampleHeight, slopeAt, symmetrize, worldSize } from '../core/index.js';
import { MATERIALS } from '../look/index.js';
import { brush, flattenAround, ramp, smoothAll } from './brush.js';
import { fbm, lerp, makeSimplex, smoothstep } from './noise.js';
import { checkPlayers } from './place.js';

const TAU = Math.PI * 2;
const LAVA = 60;                                          // lava level; all terrain stays >= 2
const TIER = [80, 380, 680, 980, 1280].map((h) => LAVA + h); // 0 = lowlands, 4 = summit plateau
const RIM = LAVA + 1700, LAKE = LAVA - 50;
const CLIFF = [4300, 7000, 9700, 12300];                  // z of each cliff foot, summit cliff first
const AXIS = 8192;                                         // mirror line x
const CRATER = [AXIS, 2300], RIVER_END = 12900, BRIDGES = [3750, 5650, 8350, 11000];
// Starts in priority order, as mirrored pairs; the axis spot takes an odd count (1v1: both on the axis).
const KINGS = [[5300, 3550], [1600, 2100], [4000, 1100], [6600, 950]], KING_AXIS = [AXIS, 3700];
const ATTACKERS = [[3500, 14800], [7350, 14900], [1300, 13900], [5600, 13900]], ATTACKER_AXIS = [AXIS, 14600];
const BASE_METAL = [[-340, -120], [300, -200], [40, 340]], AXIS_BASE_METAL = [[-340, -150], [0, 340]];
const METAL = [ // [x, z, value]: summit, tiers 3..1, lowland expansions
  [7500, 3350, 4.5], [4300, 3900, 3.2], [7200, 4000, 3.2],
  ...[[1500, 5300], [3600, 5600], [5000, 6000], [7600, 5500]].map(([x, z]) => [x, z, 3.0]),
  ...[[1000, 8000], [2900, 8500], [5850, 8100], [6900, 8900], [7900, 7900]].map(([x, z]) => [x, z, 2.7]),
  ...[[700, 10900], [2700, 10400], [4000, 11300], [6300, 10600], [7700, 11400]].map(([x, z]) => [x, z, 2.3]),
  ...[[500, 15600], [6800, 12950], [4600, 15600], [7700, 13300]].map(([x, z]) => [x, z, 2.0]),
];
const GEOS = [[6800, 2900], [2600, 6300], [6000, 9200], [1900, 11700], [4600, 13200]];
const RAMPS = [ // [x, cliff index, width]; centre ones sit on the axis
  [1700, 3, 480], [6200, 3, 480], [2300, 2, 440], [AXIS, 2, 460],
  [3000, 1, 400], [7300, 1, 380], [4200, 0, 360], [AXIS, 0, 340],
];
const POOLS = [[2200, 12900, 260], [6900, 15700, 300], [4700, 10600, 200], [3000, 6200, 180], [6400, 8700, 170], [1200, 3600, 220]];
// Paint (doc.paint = MATERIALS index + 1): worn trails up the ramps, dark crust along the lava shores.
const material = (key) => MATERIALS.findIndex((m) => m.key === key) + 1;
const TRAIL = material('sand'), CRUST = material('seabed');

export function volcanoKing(doc, { players, seed }) {
  checkPlayers(players);
  doc.symmetry = 'mirrorX';
  const { W, H, heights: hh } = doc, [ww, wh] = worldSize(doc);
  const SX = ww / 16384, SZ = wh / 16384, S = Math.min(SX, SZ), X = (v) => v * SX, Z = (v) => v * SZ;
  const nA = makeSimplex(seed), nB = makeSimplex(seed + 1), nC = makeSimplex(seed + 2);
  const [cx, cz] = [X(CRATER[0]), Z(CRATER[1])];
  const cliffZ = (k, x) => Z(CLIFF[k]) + fbm(nA, x / 2600, k * 7.3, 3, 2, 0.5) * 420 * SZ;
  const riverX = (z) => cx - X(850) - Math.max(0, z - cz) * 0.42 * SX; // left river, bending outwards
  const half = (W + 1) >> 1; // columns of the left half incl. the axis

  // Per-column cliff lines (wobbling along x; mostly sheer, sometimes a bot-climbable scree band)
  // and per-row river meander.
  const cliffs = CLIFF.map((_, k) => Float32Array.from({ length: half }, (_, i) => cliffZ(k, i * SQUARE)));
  const bands = CLIFF.map((_, k) => Float32Array.from({ length: half }, (_, i) =>
    (130 + 520 * Math.min(1, Math.max(0, fbm(nB, i * SQUARE / 1500, k * 3.1, 2, 2, 0.5) - 0.28) * 2.2)) * S));
  const meander = Float32Array.from({ length: H }, (_, j) => {
    const z = j * SQUARE;
    return (fbm(nB, z / (2600 * SZ), -4.1, 3, 2, 0.5) * 650 + fbm(nC, z / (500 * SZ), -2.3, 2, 2, 0.5) * 90) * SX * smoothstep(cz + Z(600), cz + Z(1800), z);
  });

  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = Math.min(i, W - 1 - i), x = c * SQUARE, z = j * SQUARE;
    let h = TIER[4];
    for (let k = 0; k < 4 && z >= cliffs[k][c]; k++) {
      let t = smoothstep(cliffs[k][c], cliffs[k][c] + bands[k][c], z);
      t = t * t * (3 - 2 * t);
      h = lerp(h, TIER[3 - k], t);
    }
    // Tiers tilt gently towards the summit; plateaus stay buildable, the lowlands roll more.
    const low = smoothstep(Z(CLIFF[3]), Z(CLIFF[3] + 800), z);
    h += 12 * Math.sin(z / Z(2700) * Math.PI) + fbm(nC, x / 1500, z / 1500, 4, 2, 0.5) * (16 + 40 * low);
    if (low > 0) h += fbm(nC, x / 4200 + 3, z / 4200, 2, 2, 0.5) * 55 * low;
    // The volcano cone: lava lake, rim, flanks down to the summit plateau.
    const d = Math.hypot(x - cx, z - cz);
    if (d < 2400 * S) {
      const rc = d + fbm(nA, x / 700, z / 700, 2, 2, 0.5) * 70 * S;
      if (rc < 620 * S) h = LAKE;
      else if (rc < 880 * S) h = lerp(LAKE, RIM, Math.pow(smoothstep(620 * S, 880 * S, rc), 0.55));
      else if (rc < 2300 * S) h = Math.max(h, lerp(RIM, TIER[4] - 30, Math.pow(smoothstep(880 * S, 2300 * S, rc), 0.7)));
    }
    // Lava river, broken by a land bridge on every tier.
    if (z > cz && z < Z(RIVER_END + 900)) {
      const lat = Math.abs(x - riverX(z) - meander[j]), w0 = (110 + 0.02 * (z - cz)) * S, wall = (140 + 0.012 * (z - cz)) * S;
      let m = (1 - smoothstep(w0, w0 + wall, lat)) * (1 - smoothstep(Z(RIVER_END), Z(RIVER_END + 900), z));
      for (const b of BRIDGES) m *= smoothstep(140 * S, 250 * S, Math.abs(z - Z(b)));
      if (m > 0) h = lerp(h, LAVA - 45, m);
    }
    hh[j * W + i] = h;
  }

  // Lava pools: where the river ends, plus small vents here and there.
  for (const [px, pz, pr] of [[riverX(Z(RIVER_END)), Z(RIVER_END + 250), 620 * S], ...POOLS.map(([x, z, r]) => [X(x), Z(z), r * S])]) {
    const i0 = Math.max(0, Math.floor((px - pr * 2) / SQUARE)), i1 = Math.min(W - 1, Math.ceil((px + pr * 2) / SQUARE));
    const j0 = Math.max(0, Math.floor((pz - pr * 2) / SQUARE)), j1 = Math.min(H - 1, Math.ceil((pz + pr * 2) / SQUARE));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const m = 1 - smoothstep(0.75, 1.45, Math.hypot(i * SQUARE - px, j * SQUARE - pz) / pr + fbm(nA, i / 18, j / 18, 2, 2, 0.5) * 0.35);
      if (m > 0) hh[j * W + i] = lerp(hh[j * W + i], LAVA - 40, m);
    }
  }
  smoothAll(doc, 1);

  // Ramps through each cliff line, with a trail painted up them (both mirrored by ramp() and brush()).
  for (const [rx, k, w] of RAMPS) {
    const x = X(rx), zc = cliffZ(k, Math.min(x, ww - x)), z0 = zc + Z(1150), z1 = zc - Z(520);
    ramp(doc, { x, z: z0, h: TIER[3 - k] }, { x, z: z1, h: TIER[4 - k] }, { width: w * S, hardness: 0.55 });
    for (let t = 0; t <= 1; t += 0.05) brush(doc, 'paint', x, lerp(z0, z1, t), { radius: w * S * 0.45, strength: 1, hardness: 0.5, material: TRAIL }, 0.3);
  }

  // Objects: kings first (teams 0..k-1), then attackers.
  doc.objects = [];
  const kings = Math.floor(players / 2), pick = (pairs, axis, n) => [...(n % 2 ? [axis] : []), ...pairs.slice(0, n >> 1)];
  const bases = [...pick(KINGS, KING_AXIS, kings).map((p) => [...p, 2.4]), ...pick(ATTACKERS, ATTACKER_AXIS, players - kings).map((p) => [...p, 1.9])];
  for (const [x, z] of bases) addObject(doc, 'start', X(x), Z(z));
  // A spot is safe on flat ground with no lava within `ring`; off-axis spots keep clear of the axis
  // so their mirror image does not overlap them.
  const ring = Math.max(48, 120 * S);
  const safe = (x, z, axis) => (axis || x < ww / 2 - 60 * S) && x > 0 && z > 0 && z < wh && slopeAt(doc, x, z) <= 14
    && [0, 1, 2, 3, 4, 5, 6, 7].every((a) => sampleHeight(doc, x + Math.cos(a * TAU / 8) * ring, z + Math.sin(a * TAU / 8) * ring) >= LAVA + 15);
  // Move a spot that landed in or next to lava, or on a cliff, to the nearest safe ground
  // (axis spots slide along the axis).
  const nudged = (x, z) => {
    const axis = x === ww / 2;
    if (safe(x, z, axis)) return [x, z];
    for (let r = 40 * S; r < 900 * S; r += 40 * S) for (let a = 0; a < 24; a++) {
      const nx = axis ? x : x + Math.cos(a / 24 * TAU) * r, nz = axis ? z + (a % 2 ? r : -r) : z + Math.sin(a / 24 * TAU) * r;
      if (safe(nx, nz, axis)) return [nx, nz];
    }
    return [x, z]; // shortcut: stays put on tiny maps; its pad below still lifts it out of the lava
  };
  const spot = (type, x, z, props) => addObject(doc, type, ...nudged(X(x), Z(z)), props);
  for (const [x, z, metal] of bases) for (const [dx, dz] of x === AXIS ? AXIS_BASE_METAL : BASE_METAL) spot('metal', x + dx, z + dz, { metal });
  for (const [x, z, metal] of METAL) spot('metal', x, z, { metal });
  for (const [x, z] of GEOS) spot('geo', x, z);

  // Generous flat areas for every base and pads under spots, always above the lava.
  for (const o of doc.objects) {
    const start = o.type === 'start';
    flattenAround(doc, o.x, o.z, start ? 340 * S : 42, start ? 380 * S : 80, LAVA + 20);
  }
  symmetrize(doc, 0.004);
  for (let k = 0; k < hh.length; k++) {
    if (hh[k] < 2) hh[k] = 2; // no engine water under the lava
    const crust = 1 - smoothstep(LAVA + 8, LAVA + 40, hh[k]); // heights are symmetric now, so this paint is too
    if (crust > 0) { doc.paint[k] = CRUST; doc.paintWeight[k] = Math.round(crust * 230); }
  }
  doc.settings.lava = { ...doc.settings.lava, enabled: true, level: LAVA };
  doc.settings.voidWater = false;
}
