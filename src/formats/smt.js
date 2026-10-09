// SMT tile file: 32-byte header, then 680-byte tiles (32x32 DXT1 + mips 16, 8, 4).

const MAGIC = 'spring tilefile';
const HEADER_BYTES = 32;
export const TILE_BYTES = 680;
const TILE_WORDS = TILE_BYTES / 4;

/** @param {Uint8Array} bytes  @returns {Uint8Array} the tiles, numTiles * TILE_BYTES */
export function readSmt(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, MAGIC.length + 1));
  if (bytes.length < HEADER_BYTES || magic !== `${MAGIC}\0`) throw new Error('SMT: not a spring tile file');
  const [version, numTiles, tileSize, compression] = [16, 20, 24, 28].map((o) => dv.getInt32(o, true));
  if (version !== 1 || tileSize !== 32 || compression !== 1) throw new Error(`SMT: unsupported version ${version}, tile size ${tileSize}, compression ${compression}`);
  if (bytes.length < HEADER_BYTES + numTiles * TILE_BYTES) throw new Error(`SMT: file too short for ${numTiles} tiles`);
  return bytes.slice(HEADER_BYTES, HEADER_BYTES + numTiles * TILE_BYTES);
}

/** @param {Uint8Array} tiles  numTiles * TILE_BYTES  @returns {Uint8Array} */
export function writeSmt(tiles) {
  if (tiles.length % TILE_BYTES) throw new Error(`SMT: ${tiles.length} bytes is not a whole number of tiles`);
  const out = new Uint8Array(HEADER_BYTES + tiles.length);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i);
  [1, tiles.length / TILE_BYTES, 32, 1].forEach((v, i) => dv.setInt32(16 + i * 4, v, true)); // version, numTiles, tileSize, DXT1
  out.set(tiles, HEADER_BYTES);
  return out;
}

/**
 * Stores identical tiles once.
 * @param {Uint8Array} tiles  numTiles * TILE_BYTES, one per map tile
 * @returns {{tiles: Uint8Array, index: Int32Array}} unique tiles (first-seen order) and, per input tile, its unique index
 */
export function dedupeTiles(tiles) {
  const count = tiles.length / TILE_BYTES;
  const aligned = tiles.byteOffset % 4 ? tiles.slice() : tiles;
  const words = new Int32Array(aligned.buffer, aligned.byteOffset, aligned.length / 4);
  const index = new Int32Array(count);
  const byHash = new Map(); // hash -> unique tile numbers with that hash
  const kept = []; // input tile number of each unique tile
  const same = (a, b) => {
    for (let w = 0; w < TILE_WORDS; w++) if (words[a * TILE_WORDS + w] !== words[b * TILE_WORDS + w]) return false;
    return true;
  };
  for (let t = 0; t < count; t++) {
    let hash = 0;
    for (let w = t * TILE_WORDS; w < (t + 1) * TILE_WORDS; w++) hash = Math.imul(hash ^ words[w], 0x9e3779b1);
    const bucket = byHash.get(hash) ?? [];
    let u = bucket.find((candidate) => same(kept[candidate], t));
    if (u === undefined) {
      u = kept.push(t) - 1;
      bucket.push(u);
      byHash.set(hash, bucket);
    }
    index[t] = u;
  }
  const out = new Uint8Array(kept.length * TILE_BYTES);
  kept.forEach((t, u) => out.set(tiles.subarray(t * TILE_BYTES, (t + 1) * TILE_BYTES), u * TILE_BYTES));
  return { tiles: out, index };
}
