'use strict';
// Hand-designed map presets built on top of the generic terrain tools.
var BMM = window.BMM || (window.BMM = {});

(function () {
  const { smoothstep, lerp } = BMM.util;
  const N = BMM.Noise;
  const SQ = BMM.SQUARE;

  // ------------------------------------------------------------------ Volcano: King of the Hill
  // One-way uphill assault. The attackers start in the lowlands along the bottom (south) edge;
  // the king team holds the summit plateau along the top edge around a lava-filled volcano.
  // Between them four cliff tiers climb north, each crossed by ramps that get fewer and
  // narrower towards the top. Two lava rivers run from the crater down to the lowlands and
  // split the climb into left / centre / right lanes, with land bridges on every tier.
  // Mirror symmetry left <-> right. Metal is worth more the higher you capture it.
  //
  // All distances are authored for a 32x32 map (16384 elmos) and scale with map width/height.
  function volcanoKing(map, o) {
    o = Object.assign({ seed: 1337, lava: 60 }, o || {});
    const W = map.W, H = map.H, hh = map.heights;
    const SX = map.worldW / 16384, SZ = map.worldH / 16384, S = Math.min(SX, SZ);
    const L = o.lava;
    const nA = N.makeSimplex(o.seed), nB = N.makeSimplex(o.seed + 1), nC = N.makeSimplex(o.seed + 2);
    const X = v => v * SX, Z = v => v * SZ;

    // Tier heights (elmos above lava). Tier 0 = lowlands, tier 4 = summit plateau.
    const TH = [L + 80, L + 380, L + 680, L + 980, L + 1280];
    const RIM = L + 1700, LAKE = L - 50;
    // Cliff lines (z of the foot of each cliff, from summit down) between tier k+1 and k.
    const CLIFF = [Z(4300), Z(7000), Z(9700), Z(12300)];
    const crater = { x: X(8192), z: Z(2300) };
    const R = { lake: 620 * S, rimPeak: 880 * S, cone: 2300 * S };

    // Lava river centre line: from the crater, bending outwards as it flows south.
    const riverX = (z, side) => X(8192) + side * (X(850) + Math.max(0, z - crater.z) * 0.42 * SX);
    const riverEnd = Z(12900);
    const bridgesZ = [Z(3750), Z(5650), Z(8350), Z(11000)];

    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = i * SQ, z = j * SQ;
        // --- tiered slope rising to the north, cliff lines wobble along x
        let h = TH[4];
        for (let k = 0; k < 4; k++) {
          const zc = CLIFF[k] + N.fbm(nA, x / 2600, k * 7.3, 3, 2, 0.5) * 420 * SZ;
          // mostly sheer cliffs, occasionally a bot-climbable scree slope
          const goat = Math.max(0, N.fbm(nB, x / 1500, k * 3.1, 2, 2, 0.5) - 0.28) * 2.2;
          const band = (130 + 520 * Math.min(1, goat)) * S;
          let t = smoothstep(zc, zc + band, z);
          t = t * t * (3 - 2 * t);
          h = lerp(h, TH[3 - k], t);
          if (z < zc) break;
        }
        // each tier tilts gently uphill towards the summit
        const tilt = 40 * Math.sin((z / Z(2700)) * Math.PI);
        // surface detail: plateaus stay buildable, lowlands roll more
        const low = smoothstep(CLIFF[3], CLIFF[3] + Z(800), z);
        h += tilt * 0.3 + N.fbm(nC, x / 1500, z / 1500, 4, 2, 0.5) * (16 + 40 * low) + N.fbm(nC, x / 4200 + 3, z / 4200, 2, 2, 0.5) * 55 * low;

        // --- the volcano cone on the summit plateau
        const rc = Math.hypot(x - crater.x, z - crater.z) + N.fbm(nA, x / 700, z / 700, 2, 2, 0.5) * 70 * S;
        if (rc < R.lake) h = LAKE;
        else if (rc < R.rimPeak) h = lerp(LAKE, RIM, Math.pow(smoothstep(R.lake, R.rimPeak, rc), 0.55));
        else if (rc < R.cone) h = Math.max(h, lerp(RIM, TH[4] - 30, Math.pow(smoothstep(R.rimPeak, R.cone, rc), 0.7)));

        // --- lava rivers
        if (z > crater.z && z < riverEnd + Z(900)) {
          for (const side of [-1, 1]) {
            const meander = (N.fbm(nB, z / (2600 * SZ), side * 4.1, 3, 2, 0.5) * 650 + N.fbm(nC, z / (500 * SZ), side * 2.3, 2, 2, 0.5) * 90) * SX * smoothstep(crater.z + 600 * SZ, crater.z + 1800 * SZ, z);
            const lat = Math.abs(x - riverX(z, side) - meander);
            const half = (110 + 0.02 * (z - crater.z)) * S, wall = (140 + 0.012 * (z - crater.z)) * S;
            let m = 1 - smoothstep(half, half + wall, lat);
            m *= 1 - smoothstep(riverEnd, riverEnd + Z(900), z);
            for (const b of bridgesZ) m *= smoothstep(140 * S, 250 * S, Math.abs(z - b));
            if (m > 0) h = lerp(h, L - 45, m);
          }
        }
        hh[j * W + i] = h;
      }
    }

    // --- lava pools: where the rivers end, plus small vents ("bits of lava") here and there
    const pools = [
      [riverX(riverEnd, -1), riverEnd + Z(250), 620],
      [X(2200), Z(12900), 260], [X(6900), Z(15700), 300], [X(4700), Z(10600), 200],
      [X(3000), Z(6200), 180], [X(6400), Z(8700), 170], [X(1200), Z(3600), 220],
    ];
    for (const [px, pz, prad0] of pools) {
      const prad = prad0 * S;
      for (const qx of [px, map.worldW - px]) {
        const x0 = Math.max(0, Math.floor((qx - prad * 2) / SQ)), x1 = Math.min(W - 1, Math.ceil((qx + prad * 2) / SQ));
        const z0 = Math.max(0, Math.floor((pz - prad * 2) / SQ)), z1 = Math.min(H - 1, Math.ceil((pz + prad * 2) / SQ));
        for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
          const d = Math.hypot(i * SQ - qx, j * SQ - pz) / prad + N.fbm(nA, i / 18, j / 18, 2, 2, 0.5) * 0.35;
          const m = 1 - smoothstep(0.75, 1.45, d);
          const k = j * W + i;
          if (m > 0) hh[k] = lerp(hh[k], L - 40, m);
        }
      }
    }

    BMM.Terrain.smoothAll(map, 1);
    map.symmetry = 'mirrorX';
    BMM.Sym.blendSymmetry(map, hh, 0.01);

    // --- ramps through each cliff line (left half; mirrored). Fewer and narrower near the top.
    // [x, cliff index (0 = summit cliff), width]
    const rampDefs = [
      [1700, 3, 480], [6200, 3, 480],                 // lowlands -> tier 1
      [2300, 2, 440], [8192, 2, 460],                 // tier 1 -> tier 2
      [3000, 1, 400], [7300, 1, 380],                 // tier 2 -> tier 3
      [4200, 0, 360], [8192, 0, 340],                 // tier 3 -> summit (chokepoints)
    ];
    map.paintId.fill(0); map.paintW.fill(0);
    const segs = [];
    for (const [rx, k, w] of rampDefs) {
      for (const xx of rx === 8192 ? [X(8192)] : [X(rx), map.worldW - X(rx)]) {
        const zc = CLIFF[k] + N.fbm(nA, xx / 2600, k * 7.3, 3, 2, 0.5) * 420 * SZ;
        const a = [xx, zc + Z(1150)], b = [xx, zc - Z(520)];
        BMM.Terrain.ramp(map, a[0], a[1], b[0], b[1], TH[3 - k], TH[4 - k], w * S, 0.55);
        segs.push([a[0], a[1], b[0], b[1], w * S]);
      }
    }
    const pathId = BMM.Texture.MATERIALS.findIndex(m => m.key === 'path') + 1;
    for (const [ax, az, bx, bz, w] of segs) {
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 40);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        BMM.Terrain.dab(map, 'paint', lerp(ax, bx, t), lerp(az, bz, t), { radius: w * 0.42, hardness: 0.3, strength: 1, material: pathId }, 0.25, {});
      }
    }

    // --- objects (authored on the left half, mirrored)
    map.objects = [];
    const add = (type, x, z, props) => map.addObject(type, X(x), Z(z), props);
    // Kings first so they are team ids 0..7 (first ally team), attackers 8..15.
    const kings = [[1600, 2100], [4000, 1100], [5300, 3550], [6600, 950]];
    const attackers = [[1300, 13900], [3500, 14800], [5600, 13900], [7350, 14900]];
    for (const [x, z] of kings) add('start', x, z);
    for (const [x, z] of attackers) add('start', x, z);
    const M = (x, z, metal) => add('metal', x, z, { metal });
    // king bases (3 each) + the crown on the crater flank
    for (const [x, z] of kings) for (const [dx, dz] of [[-340, -120], [300, -200], [40, 340]]) M(x + dx, z + dz, 2.4);
    M(7500, 3350, 4.5);
    // summit plateau front, guarding the top ramps
    M(4300, 3900, 3.2); M(7200, 4000, 3.2);
    // tier 3 (just below the summit)
    for (const [x, z] of [[1500, 5300], [3600, 5600], [5000, 6000], [7600, 5500]]) M(x, z, 3.0);
    // tier 2
    for (const [x, z] of [[1000, 8000], [2900, 8500], [5850, 8100], [6900, 8900], [7900, 7900]]) M(x, z, 2.7);
    // tier 1
    for (const [x, z] of [[700, 10900], [2700, 10400], [4000, 11300], [6300, 10600], [7700, 11400]]) M(x, z, 2.3);
    // attacker bases (3 each) + lowland expansions
    for (const [x, z] of attackers) for (const [dx, dz] of [[-330, -200], [320, -260], [0, 360]]) M(x + dx, z + dz, 1.9);
    for (const [x, z] of [[500, 15600], [6800, 12950], [4600, 15600], [7700, 13300]]) M(x, z, 2.0);
    // Geothermal vents: one per lane side on each tier, plus one by the crater for the king
    const G = (x, z) => add('geo', x, z);
    G(6800, 2900); G(2600, 6300); G(6000, 9200); G(1900, 11700); G(4600, 13200);

    // Nudge anything that landed in/next to lava or on a cliff to the nearest safe flat ground.
    const safe = (x, z) => {
      if (map.slopeAtWorld(x, z) > 14) return false;
      for (let a = 0; a < 8; a++) if (map.sampleHeight(x + Math.cos(a * 0.785) * 120, z + Math.sin(a * 0.785) * 120) < L + 15) return false;
      return true;
    };
    for (const ob of map.objects.filter(ob => ob.sym === 0)) {
      if (safe(ob.x, ob.z)) continue;
      found: for (let rr = 40; rr < 900; rr += 40) for (let a = 0; a < 24; a++) {
        const nx = ob.x + Math.cos(a / 24 * 6.2832) * rr, nz = ob.z + Math.sin(a / 24 * 6.2832) * rr;
        if (nx < map.worldW / 2 - 60 && safe(nx, nz)) { map.moveObject(ob, nx, nz); break found; }
      }
    }
    // Flat pads under spots and generous flat areas for every base.
    for (const ob of map.objects.filter(ob => ob.sym === 0)) {
      const isStart = ob.type === 'start';
      flattenPad(map, ob.x, ob.z, isStart ? 340 * S : 42, isStart ? 380 * S : 80);
    }
    BMM.Sym.symmetrize(map, 0.004);
    for (let k = 0; k < hh.length; k++) if (hh[k] < 2) hh[k] = 2;  // no engine water under the lava
    Object.assign(map.settings, { lava: true, lavaLevel: L, voidWater: false });
    // scorched, glowing crust along every lava shore
    const crustId = BMM.Texture.MATERIALS.findIndex(m => m.key === 'beach') + 1;
    for (let k = 0; k < hh.length; k++) {
      const d = hh[k] - L;
      if (d < 45) {
        const w = Math.round(255 * Math.min(1, Math.max(0, 1 - (d - 8) / 37)));
        if (w > map.paintW[k] || map.paintId[k] !== pathId) { map.paintId[k] = crustId; map.paintW[k] = w; }
      }
    }
    const bad = map.objects.filter(ob => map.sampleHeight(ob.x, ob.z) < L + 10);
    return { lavaLevel: L, tiers: TH, rim: RIM, objectsInLava: bad.length };
  }

  function flattenPad(map, x, z, core, blend) {
    let sum = 0, cnt = 0;
    for (let a = 0; a < 16; a++) for (let r = 0; r <= core; r += core / 3) {
      sum += map.sampleHeight(x + Math.cos(a / 16 * 6.2832) * r, z + Math.sin(a / 16 * 6.2832) * r); cnt++;
    }
    const R = core + blend;
    BMM.Terrain.dab(map, 'flatten', x, z, { radius: R, hardness: core / R, strength: 1 }, 1, { target: sum / cnt });
  }

  BMM.Presets = { volcanoKing };
})();
