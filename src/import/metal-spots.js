// Metal spots from a metal map, the way BAR finds them in game (luarules/gadgets/api_resource_spot_finder.lua):
// 8-connected metal pixels form one spot at the centre of their bounding box, worth sum(pixels) * maxMetal / 1000
// (the value BAR shows on the spot). Like BAR, the outermost pixel ring is ignored, and a map whose metal blobs
// span more than 6 extractor radii is a "metal map" with no spots at all.

const PIXEL = 16; // elmos per metal map pixel

/**
 * @typedef {Object} MetalBlob  8-connected metal pixels (the outer ring ignored)
 * @property {number[]} pixels  indices into the metal map
 * @property {number} sum  their metal bytes added up
 * @property {[number, number, number, number]} box  [x0, z0, x1, z1] in pixels, inclusive
 */

/** Every blob, in row-major order of its first pixel. @returns {MetalBlob[]} */
export function metalBlobs(metal, width, height) {
  const seen = new Uint8Array(width * height), stack = [], blobs = [];
  const inside = (x, z) => x >= 1 && x < width - 1 && z >= 1 && z < height - 1;
  for (let z = 1; z < height - 1; z++) {
    for (let x = 1; x < width - 1; x++) {
      if (!metal[z * width + x] || seen[z * width + x]) continue;
      const pixels = [];
      let sum = 0, x0 = x, x1 = x, z0 = z, z1 = z;
      seen[z * width + x] = 1;
      stack.push(z * width + x);
      while (stack.length) {
        const k = stack.pop(), px = k % width, pz = (k - px) / width;
        pixels.push(k);
        sum += metal[k];
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (pz < z0) z0 = pz;
        if (pz > z1) z1 = pz;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const q = k + dz * width + dx;
            if (inside(px + dx, pz + dz) && metal[q] && !seen[q]) {
              seen[q] = 1;
              stack.push(q);
            }
          }
        }
      }
      blobs.push({ pixels, sum, box: [x0, z0, x1, z1] });
    }
  }
  return blobs;
}

/** A blob as BAR's spot: the centre of its bounding box (pixel centres are at 16 * i + 8 elmos) and its value. */
export function blobSpot({ sum, box: [x0, z0, x1, z1] }, maxMetal) {
  return { x: ((x0 + x1 + 1) * PIXEL) / 2, z: ((z0 + z1 + 1) * PIXEL) / 2, metal: (sum * maxMetal) / 1000 };
}

/** True when the blobs make a metal map (BAR finds no spots on it): one spans more than 6 extractor radii. */
export function isMetalField(blobs, extractorRadius) {
  const maxSpan = 6 * extractorRadius;
  return blobs.some(({ box: [x0, z0, x1, z1] }) => (x1 - x0) * PIXEL > maxSpan || (z1 - z0) * PIXEL > maxSpan);
}

/**
 * @param {Uint8Array} metal  width * height metal map bytes
 * @param {number} width
 * @param {number} height
 * @param {{maxMetal: number, extractorRadius: number}} map  mapinfo values
 * @returns {{x: number, z: number, metal: number}[]} spot centres in elmos, row-major order of their first pixel
 */
export function findMetalSpots(metal, width, height, { maxMetal, extractorRadius }) {
  const blobs = metalBlobs(metal, width, height);
  return isMetalField(blobs, extractorRadius) ? [] : blobs.map((blob) => blobSpot(blob, maxMetal));
}
