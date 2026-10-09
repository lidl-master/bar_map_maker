// Symmetry modes on the heightmap grid. Pure: works on any doc with W, H and symmetry.
//
// A transform is a 3-bit code acting on (x, z) inside extents (ex, ez): bit 4 swaps the axes,
// bit 1 mirrors x, bit 2 mirrors z. Each mode's transforms form a group, so the orbit of a
// point is {T(p) for T in mode.T}. Swapping modes only exist on square maps.
const I = 0, MX = 1, MZ = 2, R180 = 3, DIAG = 4, R90 = 5, R270 = 6, ADIAG = 7;

export const tx = (t, x, z, ex) => { const v = t & 4 ? z : x; return t & 1 ? ex - v : v; };
export const tz = (t, x, z, ez) => { const v = t & 4 ? x : z; return t & 2 ? ez - v : v; };

// src(i, j, a, b): is the point inside the source domain (the part every other part copies)?
// depth(u, v): how deep a normalized point lies inside the source domain (< 0 = outside).
// rot90 lists R180 second so a 2-player trim of its orbit picks opposite corners.
export const SYMMETRY = {
  none: { label: 'None', T: [I], src: () => true },
  mirrorX: { label: 'Mirror left–right', T: [I, MX], src: (i, j, a) => 2 * i <= a, depth: (u) => 0.5 - u },
  mirrorZ: { label: 'Mirror top–bottom', T: [I, MZ], src: (i, j, a, b) => 2 * j <= b, depth: (u, v) => 0.5 - v },
  rot180: { label: 'Rotate 180°', T: [I, R180], src: (i, j, a, b) => 2 * i < a || (2 * i === a && 2 * j <= b), depth: (u) => 0.5 - u },
  diag: { label: 'Diagonal (TL–BR)', square: true, T: [I, DIAG], src: (i, j) => i >= j, depth: (u, v) => (u - v) * 0.7071 },
  adiag: { label: 'Diagonal (TR–BL)', square: true, T: [I, ADIAG], src: (i, j, a) => i + j <= a, depth: (u, v) => (1 - u - v) * 0.7071 },
  quad: { label: 'Quad mirror', T: [I, MX, MZ, R180], src: (i, j, a, b) => 2 * i <= a && 2 * j <= b, depth: (u, v) => Math.min(0.5 - u, 0.5 - v) },
  rot90: { label: 'Rotate 90°', square: true, T: [I, R180, R90, R270], src: (i, j, a, b) => 2 * i < a && 2 * j <= b, depth: (u, v) => Math.min(0.5 - u, 0.5 - v) },
};

/** The doc's symmetry mode. Throws on an unknown mode or a square-only mode on a non-square map. */
export function symMode(doc) {
  const m = SYMMETRY[doc.symmetry];
  if (!m) throw new RangeError(`unknown symmetry '${doc.symmetry}'`);
  if (m.square && doc.W !== doc.H) throw new RangeError(`symmetry '${doc.symmetry}' needs a square map`);
  return m;
}

/** Exact symmetry: copy the source domain onto every mirrored part of the given layers. */
export function enforceSymmetry(doc, layers) {
  const m = symMode(doc), { W, H } = doc, a = W - 1, b = H - 1;
  if (m.T.length === 1) return;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!m.src(i, j, a, b)) continue;
    const c = j * W + i;
    for (let k = 1; k < m.T.length; k++) {
      const d = tz(m.T[k], i, j, b) * W + tx(m.T[k], i, j, a);
      for (const L of layers) L[d] = L[c];
    }
  }
}

/**
 * Seamless symmetrisation of a float layer: every orbit gets one weighted average of its members,
 * weighted by a smooth "inside the source domain" factor of half-width `width` (normalized).
 * Computed once per orbit and written to all members, so the result is bitwise symmetric.
 */
export function blendSymmetry(doc, arr, width) {
  const m = symMode(doc), n = m.T.length;
  if (n === 1) return;
  const { W, H } = doc, a = W - 1, b = H - 1;
  const src = arr.slice(), idx = new Int32Array(n), wt = new Float64Array(n);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    let k = 0;
    for (; k < n; k++) {
      const qi = tx(m.T[k], i, j, a), qj = tz(m.T[k], i, j, b);
      idx[k] = qj * W + qi;
      if (idx[k] < c) break; // not the orbit's lowest index: handled when that one came up
      const t = Math.min(1, Math.max(0, (m.depth(qi / a, qj / b) + width) / (2 * width)));
      wt[k] = t * t * (3 - 2 * t) + 1e-6;
    }
    if (k < n) continue;
    let v = 0, sw = 0;
    for (k = 0; k < n; k++) { v += src[idx[k]] * wt[k]; sw += wt[k]; }
    v /= sw;
    for (k = 0; k < n; k++) arr[idx[k]] = v;
  }
}

/** Make the whole map symmetric: heights blended seamlessly, paint layers copied. */
export function symmetrize(doc, width = 0.02) {
  blendSymmetry(doc, doc.heights, width);
  enforceSymmetry(doc, [doc.paint, doc.paintWeight]);
}
