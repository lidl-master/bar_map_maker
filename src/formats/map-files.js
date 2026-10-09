// MapDoc + baked texture -> the files of a BAR map archive.
import { writeLavaConfig, writeMapInfo, mapFileBase } from './mapinfo.js';
import { buildMetalMap } from './metal.js';
import { writeSmf } from './smf.js';
import { dedupeTiles, TILE_BYTES, writeSmt } from './smt.js';

const SQUARE = 8; // elmos between heightmap samples
const GEO_FEATURE = 'GeoVent'; // BAR's geothermal vent feature def

// Heights as the SMF stores them: height = min + raw * (max - min) / 65536, with whole-elmo limits.
function quantizeHeights(heights) {
  let lo = Infinity, hi = -Infinity;
  for (const h of heights) {
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error('heights contain a non-finite value');
  const minHeight = Math.floor(lo), maxHeight = Math.max(Math.ceil(hi), minHeight + 1);
  const scale = 65536 / (maxHeight - minHeight), raw = new Uint16Array(heights.length);
  for (let k = 0; k < heights.length; k++) raw[k] = Math.min(65535, Math.round((heights[k] - minHeight) * scale));
  return { minHeight, maxHeight, raw };
}

// Degrees -> engine heading (65536 per turn) in the signed 16-bit range the engine casts it to.
const heading = (degrees) => ((((Math.round((degrees * 65536) / 360) + 32768) % 65536) + 65536) % 65536) - 32768;

function smfFeatures(doc) {
  const width = doc.sx * 512, depth = doc.sz * 512;
  return doc.objects.filter((o) => o.type === 'geo' || o.type === 'feature').map((o) => {
    if (!(o.x >= 0 && o.x <= width && o.z >= 0 && o.z <= depth)) throw new Error(`${o.type} ${o.id} at (${o.x}, ${o.z}) is outside the map`);
    const y = doc.heights[Math.round(o.z / SQUARE) * doc.W + Math.round(o.x / SQUARE)];
    if (o.type === 'geo') return { name: GEO_FEATURE, x: o.x, y, z: o.z, rotation: 0, size: 1 };
    if (!o.name) throw new Error(`feature ${o.id} has no feature def name`);
    return { name: o.name, x: o.x, y, z: o.z, rotation: heading(o.rot ?? 0), size: 1 };
  });
}

/**
 * Everything that needs only the doc (and can be wrong) is built and checked before the slow texture bake.
 * @param {import('../core/index.js').MapDoc} doc
 * @param {() => Promise<{tiles: Uint8Array, minimap: Uint8Array}>} bakeTexture  one DXT1 tile per map tile
 *   (row-major from the north-west corner, TILE_BYTES each) and the DXT1 minimap
 * @returns {Promise<Map<string, Uint8Array>>} archive path -> bytes
 */
export async function buildMapFiles(doc, bakeTexture) {
  const fileBase = mapFileBase(doc.settings.name);
  const mapx = doc.sx * 64, mapy = doc.sz * 64;
  const { minHeight, maxHeight, raw } = quantizeHeights(doc.heights);
  const metal = buildMetalMap(doc);
  const features = smfFeatures(doc);
  const text = (s) => new TextEncoder().encode(s);
  const files = new Map([['mapinfo.lua', text(writeMapInfo(doc, { fileBase, minHeight, maxHeight, maxMetal: metal.maxMetal }))]]);
  const lava = writeLavaConfig(doc);
  if (lava) files.set('mapconfig/lava.lua', text(lava));

  const { tiles, minimap } = await bakeTexture();
  if (tiles.length !== (mapx / 4) * (mapy / 4) * TILE_BYTES) throw new Error(`expected ${(mapx / 4) * (mapy / 4)} baked tiles`);
  const unique = dedupeTiles(tiles);
  files.set(`maps/${fileBase}.smt`, writeSmt(unique.tiles));
  files.set(`maps/${fileBase}.smf`, writeSmf({
    mapId: Math.floor(Math.random() * 0x7fffffff),
    mapx,
    mapy,
    minHeight,
    maxHeight,
    heights: raw,
    typeMap: new Uint8Array((mapx / 2) * (mapy / 2)), // terrain type 0 everywhere
    minimap,
    metal: metal.data,
    tileFiles: [{ name: `${fileBase}.smt`, count: unique.tiles.length / TILE_BYTES }],
    tileIndex: unique.index,
    features,
    grass: null, // shortcut: no grass until the texture stack (Wave 2) paints it
  }));
  return files;
}
