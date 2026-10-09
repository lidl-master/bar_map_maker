'use strict';
// Seeded noise utilities: simplex, fBm, ridged multifractal, value noise, hashing.
var BMM = window.BMM || (window.BMM = {});

(function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const GRAD = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1]);
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;

  function makeSimplex(seed) {
    const rand = mulberry32((seed >>> 0) ^ 0x9E3779B9);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const r = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[r]; p[r] = t;
    }
    const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = (perm[i] % 12) * 2; }

    return function noise2D(xin, yin) {
      let n0 = 0, n1 = 0, n2 = 0;
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s), j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t), y0 = yin - (j - t);
      let i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 >= 0) { const g = pm12[ii + perm[jj]]; t0 *= t0; n0 = t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0); }
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 >= 0) { const g = pm12[ii + i1 + perm[jj + j1]]; t1 *= t1; n1 = t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1); }
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 >= 0) { const g = pm12[ii + 1 + perm[jj + 1]]; t2 *= t2; n2 = t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2); }
      return 70 * (n0 + n1 + n2);
    };
  }

  // Fractal Brownian motion, result roughly in [-1, 1].
  function fbm(noise, x, y, octaves, lacunarity, gain) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * freq + o * 17.31, y * freq - o * 9.17) * amp;
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  // Ridged multifractal, result in [0, 1].
  function ridged(noise, x, y, octaves, lacunarity, gain) {
    let sum = 0, amp = 1, freq = 1, norm = 0, weight = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(noise(x * freq + o * 31.7, y * freq + o * 11.3));
      n *= n;
      n *= weight;
      weight = Math.min(1, Math.max(0, n * 2));
      sum += n * amp; norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return Math.min(1, sum / norm * 1.4);
  }

  // Integer hash -> [0, 1)
  function hash2(ix, iy, seed) {
    let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (seed | 0) * 982451653;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Smooth value noise in [0, 1).
  function valueNoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  BMM.Noise = { mulberry32, makeSimplex, fbm, ridged, hash2, valueNoise };
})();
