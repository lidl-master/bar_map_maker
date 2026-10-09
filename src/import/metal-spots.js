// Metal spots from a metal map, the way BAR finds them in game (luarules/gadgets/api_resource_spot_finder.lua):
// 8-connected metal pixels form one spot at the centre of their bounding box, worth sum(pixels) * maxMetal / 1000
// (the value BAR shows on the spot). Like BAR, the outermost pixel ring is ignored, and a map whose metal blobs
// span more than 6 extractor radii is a "metal map" with no spots at all.

export const METAL_PIXEL = 16; // elmos per metal map pixel

/**
 * The 8-connected groups of metal pixels, ignoring the outermost pixel ring.
 * @returns {{x0: number, x1: number, z0: number, z1: number, pixels: number, sum: number}[]} bounding boxes in
 *   pixels (inclusive), pixel count and byte sum, in row-major order of their first pixel
 */
export function metalBlobs(metal, width, height) {
  const seen = new Uint8Array(width * height), stack = [], blobs = [];
  const inside = (x, z) => x >= 1 && x < width - 1 && z >= 1 && z < height - 1;
  for (let z = 1; z < height - 1; z++) {
    for (let x = 1; x < width - 1; x++) {
      if (!metal[z * width + x] || seen[z * width + x]) continue;
      const blob = { x0: x, x1: x, z0: z, z1: z, pixels: 0, sum: 0 };
      seen[z * width + x] = 1;
      stack.push(z * width + x);
      while (stack.length) {
        const k = stack.pop(), px = k % width, pz = (k - px) / width;
        blob.pixels++;
        blob.sum += metal[k];
        if (px < blob.x0) blob.x0 = px;
        if (px > blob.x1) blob.x1 = px;
        if (pz < blob.z0) blob.z0 = pz;
        if (pz > blob.z1) blob.z1 = pz;
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
      blobs.push(blob);
    }
  }
  return blobs;
}

/** A blob's larger bounding-box side in elmos, as BAR measures it against 6 extractor radii. */
export const blobSpan = ({ x0, x1, z0, z1 }) => Math.max(x1 - x0, z1 - z0) * METAL_PIXEL;

/**
 * @param {Uint8Array} metal  width * height metal map bytes
 * @param {number} width
 * @param {number} height
 * @param {{maxMetal: number, extractorRadius: number}} map  mapinfo values
 * @returns {{x: number, z: number, metal: number}[]} spot centres in elmos, row-major order of their first pixel
 */
export function findMetalSpots(metal, width, height, { maxMetal, extractorRadius }) {
  const blobs = metalBlobs(metal, width, height);
  if (blobs.some((blob) => blobSpan(blob) > 6 * extractorRadius)) return [];
  // Pixel centres are at 16 * i + 8 elmos.
  return blobs.map(({ x0, x1, z0, z1, sum }) => ({ x: ((x0 + x1 + 1) * METAL_PIXEL) / 2, z: ((z0 + z1 + 1) * METAL_PIXEL) / 2, metal: (sum * maxMetal) / 1000 }));
}
