// TGA images as BAR maps use them (grass distribution maps, splat distributions): uncompressed or RLE true-colour
// (24/32-bit) and greyscale (8-bit). Decoded rows run top-down; encoding keeps the source's row order flag, so
// whatever reads the original reads the copy the same way.

const HEADER_BYTES = 18;
const TOP_DOWN = 0x20; // image descriptor bit 5: first row is the top one

/**
 * @typedef {Object} TgaImage
 * @property {number} width
 * @property {number} height
 * @property {1|3|4} channels  grey, RGB or RGBA
 * @property {Uint8Array} data  rows top-down
 * @property {number} descriptor  the image descriptor byte (alpha bits, row order)
 */

/** @returns {TgaImage} */
export function decodeTga(bytes) {
  if (bytes.length < HEADER_BYTES) throw new Error('TGA: file too short');
  const idLength = bytes[0], colorMapType = bytes[1], type = bytes[2];
  const width = bytes[12] | (bytes[13] << 8), height = bytes[14] | (bytes[15] << 8), bits = bytes[16], descriptor = bytes[17];
  const grey = type === 3 || type === 11, rle = type === 10 || type === 11;
  if (colorMapType !== 0 || ![2, 3, 10, 11].includes(type) || (grey ? bits !== 8 : bits !== 24 && bits !== 32)) {
    throw new Error(`TGA: image type ${type} with ${bits} bits per pixel is not supported`);
  }
  if (descriptor & 0x10) throw new Error('TGA: right-to-left images are not supported');
  const channels = bits / 8, count = width * height, raw = new Uint8Array(count * channels);
  let o = HEADER_BYTES + idLength;
  if (!rle) {
    if (o + raw.length > bytes.length) throw new Error('TGA: pixel data is past the end of the file');
    raw.set(bytes.subarray(o, o + raw.length));
  } else {
    for (let p = 0; p < count;) {
      const head = bytes[o++], run = (head & 127) + 1;
      if (o > bytes.length || p + run > count) throw new Error('TGA: bad RLE packet');
      for (let k = 0; k < run; k++, p++) {
        raw.set(bytes.subarray(o, o + channels), p * channels);
        if (!(head & 128)) o += channels;
      }
      if (head & 128) o += channels;
    }
  }
  // BGR(A) -> RGB(A), rows top-down.
  const data = new Uint8Array(raw.length), stride = width * channels;
  for (let y = 0; y < height; y++) {
    const from = (descriptor & TOP_DOWN ? y : height - 1 - y) * stride, to = y * stride;
    for (let x = 0; x < stride; x += channels) {
      if (channels === 1) data[to + x] = raw[from + x];
      else {
        data[to + x] = raw[from + x + 2];
        data[to + x + 1] = raw[from + x + 1];
        data[to + x + 2] = raw[from + x];
        if (channels === 4) data[to + x + 3] = raw[from + x + 3];
      }
    }
  }
  return { width, height, channels: /** @type {1|3|4} */ (channels), data, descriptor };
}

/** An uncompressed TGA of the same kind as `decodeTga` returns (same channels and row order flag). */
export function encodeTga({ width, height, channels, data, descriptor }) {
  const out = new Uint8Array(HEADER_BYTES + data.length), stride = width * channels;
  out[2] = channels === 1 ? 3 : 2;
  out[12] = width & 255; out[13] = width >> 8; out[14] = height & 255; out[15] = height >> 8;
  out[16] = channels * 8;
  out[17] = descriptor & (TOP_DOWN | 0x0f);
  for (let y = 0; y < height; y++) {
    const from = y * stride, to = HEADER_BYTES + (descriptor & TOP_DOWN ? y : height - 1 - y) * stride;
    for (let x = 0; x < stride; x += channels) {
      if (channels === 1) out[to + x] = data[from + x];
      else {
        out[to + x] = data[from + x + 2];
        out[to + x + 1] = data[from + x + 1];
        out[to + x + 2] = data[from + x];
        if (channels === 4) out[to + x + 3] = data[from + x + 3];
      }
    }
  }
  return out;
}
