// DXT1 (BC1) encoder with a full mip chain down to 4x4, as SMT tiles and the SMF minimap store it, and a decoder.
// Range fit along the colour block's principal axis (power iteration), always 4-colour mode (c0 > c1).

const clamp = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
const to565 = (r, g, b) => (clamp(Math.round(r * 31 / 255), 31) << 11) | (clamp(Math.round(g * 63 / 255), 63) << 5) | clamp(Math.round(b * 31 / 255), 31);

function from565(c, out, o) {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  out[o] = (r << 3) | (r >> 2);
  out[o + 1] = (g << 2) | (g >> 4);
  out[o + 2] = (b << 3) | (b >> 2);
}

const pal = new Float32Array(12);

// px: 16 RGB texels (48 values, row-major). Writes the 8-byte block at out[o].
function encodeBlock(px, out, o) {
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < 48; i += 3) { mr += px[i]; mg += px[i + 1]; mb += px[i + 2]; }
  mr /= 16; mg /= 16; mb /= 16;
  let rr = 0, rg = 0, rb = 0, gg = 0, gb = 0, bb = 0;
  for (let i = 0; i < 48; i += 3) {
    const r = px[i] - mr, g = px[i + 1] - mg, b = px[i + 2] - mb;
    rr += r * r; rg += r * g; rb += r * b; gg += g * g; gb += g * b; bb += b * b;
  }
  let ax = 0.577, ay = 0.577, az = 0.577;
  for (let it = 0; it < 4; it++) {
    const nx = rr * ax + rg * ay + rb * az, ny = rg * ax + gg * ay + gb * az, nz = rb * ax + gb * ay + bb * az;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) break;
    ax = nx / len; ay = ny / len; az = nz / len;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 48; i += 3) {
    const d = (px[i] - mr) * ax + (px[i + 1] - mg) * ay + (px[i + 2] - mb) * az;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  const inset = (hi - lo) / 32; // a slight inset lowers the average quantisation error
  lo += inset; hi -= inset;
  let c0 = to565(mr + ax * hi, mg + ay * hi, mb + az * hi);
  let c1 = to565(mr + ax * lo, mg + ay * lo, mb + az * lo);
  if (c0 < c1) [c0, c1] = [c1, c0];
  let idx = 0;
  if (c0 !== c1) {
    from565(c0, pal, 0);
    from565(c1, pal, 3);
    for (let c = 0; c < 3; c++) {
      pal[6 + c] = (2 * pal[c] + pal[3 + c]) / 3;
      pal[9 + c] = (pal[c] + 2 * pal[3 + c]) / 3;
    }
    for (let p = 15; p >= 0; p--) {
      const r = px[p * 3], g = px[p * 3 + 1], b = px[p * 3 + 2];
      let best = 0, bestD = Infinity;
      for (let k = 0; k < 4; k++) {
        const dr = r - pal[k * 3], dg = g - pal[k * 3 + 1], db = b - pal[k * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = k; }
      }
      idx = (idx << 2) | best;
    }
  }
  out[o] = c0 & 255; out[o + 1] = c0 >> 8; out[o + 2] = c1 & 255; out[o + 3] = c1 >> 8;
  out[o + 4] = idx & 255; out[o + 5] = (idx >>> 8) & 255; out[o + 6] = (idx >>> 16) & 255; out[o + 7] = idx >>> 24;
}

const block = new Float32Array(48);

function encodeLevel(rgb, size, out, o) {
  for (let by = 0; by < size; by += 4) {
    for (let bx = 0; bx < size; bx += 4) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const s = ((by + y) * size + bx + x) * 3, d = (y * 4 + x) * 3;
          block[d] = rgb[s]; block[d + 1] = rgb[s + 1]; block[d + 2] = rgb[s + 2];
        }
      }
      encodeBlock(block, out, o);
      o += 8;
    }
  }
  return o;
}

function halve(rgb, size) {
  const half = size >> 1, out = new Float32Array(half * half * 3);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      for (let c = 0; c < 3; c++) {
        const a = (2 * y * size + 2 * x) * 3 + c;
        out[(y * half + x) * 3 + c] = (rgb[a] + rgb[a + 3] + rgb[a + size * 3] + rgb[a + size * 3 + 3]) / 4;
      }
    }
  }
  return out;
}

/** Bytes of a DXT1 square image of `size` texels with all mips down to 4x4. */
export const dxt1MipBytes = (size) => (size <= 4 ? 8 : (size * size) / 2 + dxt1MipBytes(size >> 1));

/** rgb: size*size*3 values 0..255 (row-major), size a power of two >= 4. Returns the DXT1 mip chain. */
export function encodeDxt1Mips(rgb, size) {
  const out = new Uint8Array(dxt1MipBytes(size));
  let level = rgb, o = 0;
  for (;;) {
    o = encodeLevel(level, size, out, o);
    if (size === 4) return out;
    level = halve(level, size);
    size >>= 1;
  }
}

const palette = new Uint8Array(16); // four RGBA colours of the block being decoded

/**
 * One DXT1 image (8-byte blocks, row-major) to RGBA. width and height are multiples of 4.
 * 3-colour blocks (c0 <= c1) decode index 3 as transparent black, as the GPU does.
 * @returns {Uint8ClampedArray} width*height*4
 */
export function decodeDxt1(bytes, width, height) {
  const blocksX = width / 4, blocks = blocksX * (height / 4);
  if (!Number.isInteger(blocks) || bytes.length < blocks * 8) throw new Error(`DXT1: ${bytes.length} bytes do not hold a ${width}x${height} image`);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let b = 0; b < blocks; b++) {
    const o = b * 8, c0 = bytes[o] | (bytes[o + 1] << 8), c1 = bytes[o + 2] | (bytes[o + 3] << 8), four = c0 > c1;
    from565(c0, palette, 0);
    from565(c1, palette, 4);
    for (let c = 0; c < 3; c++) {
      const a = palette[c], d = palette[4 + c];
      palette[8 + c] = four ? (2 * a + d) / 3 : (a + d) / 2; // the typed array rounds down
      palette[12 + c] = four ? (a + 2 * d) / 3 : 0;
    }
    palette[3] = palette[7] = palette[11] = 255;
    palette[15] = four ? 255 : 0;
    const bits = bytes[o + 4] | (bytes[o + 5] << 8) | (bytes[o + 6] << 16) | (bytes[o + 7] << 24);
    const x0 = (b % blocksX) * 4, y0 = (b - (b % blocksX)) / blocksX * 4;
    for (let p = 0; p < 16; p++) {
      const k = ((bits >>> (2 * p)) & 3) * 4, d = ((y0 + (p >> 2)) * width + x0 + (p & 3)) * 4;
      out[d] = palette[k];
      out[d + 1] = palette[k + 1];
      out[d + 2] = palette[k + 2];
      out[d + 3] = palette[k + 3];
    }
  }
  return out;
}
