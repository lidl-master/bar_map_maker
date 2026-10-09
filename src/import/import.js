// A BAR map archive's files -> MapDoc with doc.original (contract in docs/gauntlet/wave3.md and docs/ARCHITECTURE.md).
import { addGroup, createMap } from '../core/index.js';
import { TILE_BYTES } from '../formats/index.js';
import { readMapInfo } from '../lua/index.js';
import { readMapData } from './map-data.js';
import { findMetalSpots } from './metal-spots.js';
import { closestBiome, originalPreview } from './preview.js';

const GEO_VENT = 'geovent'; // BAR's geothermal vent feature def (def names are case-insensitive)
const DEGREES_PER_HEADING = 360 / 65536; // SMF feature rotation: engine heading units
const MIP_4X4 = TILE_BYTES - 8; // a tile's last DXT1 block: its 4x4 mip (after 32, 16 and 8 texel mips)

const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

// Each tile's 4x4 mip, 8 bytes per tile: all the editor needs to show the texture (1/85 of the tile bytes).
function tileMips(tiles) {
  const count = tiles.length / TILE_BYTES, mips = new Uint8Array(count * 8);
  for (let t = 0; t < count; t++) for (let b = 0; b < 8; b++) mips[t * 8 + b] = tiles[t * TILE_BYTES + MIP_4X4 + b];
  return mips;
}

// mapinfo.lua over the doc's defaults; a value the map leaves out keeps the default.
function readSettings(defaults, info) {
  const { raw } = info;
  return {
    ...defaults,
    name: info.name ?? defaults.name,
    version: info.version ?? '',
    author: info.author ?? '',
    description: info.description ?? '',
    minWind: finite(raw.atmosphere?.minwind, defaults.minWind),
    maxWind: finite(raw.atmosphere?.maxwind, defaults.maxWind),
    tidalStrength: finite(raw.tidalstrength, defaults.tidalStrength),
    gravity: finite(raw.gravity, defaults.gravity),
    extractorRadius: finite(info.extractorRadius, defaults.extractorRadius),
    voidWater: info.voidWater,
    // shortcut: only map-side mapconfig/lava.lua; BAR's game-side lava configs (e.g. Sector 318C) are not read. Revisit with Wave 4's checklist.
    lava: info.lava
      ? { enabled: true, level: finite(info.lava.level, 0), damage: finite(info.lava.damage, defaults.lava.damage) }
      : defaults.lava,
    sunDir: info.sunDir ?? defaults.sunDir, // as the map has it: the bake's sun-in-the-north rule is for new maps
  };
}

/**
 * Opens a map from its archive files. Symmetry is 'none' (the editor does not guess it); every object is its own group.
 * @param {Map<string, Uint8Array>} files  archive path -> bytes: mapinfo.lua, the Lua it includes, the SMF and its SMTs
 *   (other files may be left out: the export reads them from the archive again)
 * @param {{archive: string, listing: {path: string, size: number}[]}} source  where the files came from, and every
 *   file of that archive
 * @returns {Promise<import('../core/index.js').MapDoc>} with doc.original
 */
export async function importMap(files, { archive, listing }) {
  const info = await readMapInfo(files);
  if (info.error) throw new Error(`mapinfo.lua could not be read: ${info.error}`);
  const { smf, tiles } = readMapData(files, info);
  const sx = smf.mapx / 64, sz = smf.mapy / 64;
  const original = {
    archive,
    info: { name: info.name, version: info.version, author: info.author, description: info.description, licence: info.licence },
    files: listing,
    size: [sx, sz],
    offset: [0, 0], // where the archive's map sits in the doc, in units (extendMap moves it)
    tilesX: sx * 16,
    tilesZ: sz * 16,
    tileIndex: smf.tileIndex,
    tileMips: tileMips(tiles),
    metalMap: smf.metal,
    maxMetal: finite(info.maxMetal, 0.02), // the engine's default
    // mapinfo's smf.minheight / maxheight override the SMF header, as in the engine
    minHeight: finite(info.minHeight, smf.minHeight),
    maxHeight: finite(info.maxHeight, smf.maxHeight),
  };

  const doc = createMap({ sx, sz, biome: info.lava ? 'volcanic' : closestBiome(originalPreview(original)) });
  doc.settings = readSettings(doc.settings, info);
  const step = (original.maxHeight - original.minHeight) / 65536;
  for (let k = 0; k < smf.heights.length; k++) doc.heights[k] = original.minHeight + smf.heights[k] * step;

  for (const { x, z } of info.teams) addGroup(doc, 'start', [[x, z]]);
  const spots = findMetalSpots(smf.metal, sx * 32, sz * 32, { maxMetal: original.maxMetal, extractorRadius: doc.settings.extractorRadius });
  for (const { x, z, metal } of spots) addGroup(doc, 'metal', [[x, z]], { metal });
  for (const f of smf.features) {
    if (f.name.toLowerCase() === GEO_VENT) addGroup(doc, 'geo', [[f.x, f.z]]);
    else addGroup(doc, 'feature', [[f.x, f.z]], { name: f.name, rot: f.rotation * DEGREES_PER_HEADING });
  }
  doc.original = original;
  return doc;
}
