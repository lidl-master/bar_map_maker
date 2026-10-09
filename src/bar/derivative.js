// Export of a map opened from an archive (doc.original, contract in docs/gauntlet/wave3.md): a derivative. The
// original's files pass through byte for byte. Rebuilt are only the SMF (heights, features, start positions and metal
// from the doc; typemap and grass shifted with the map), the SMT (the original's tiles where it has them, new ground
// baked and faded in at the seam), mapinfo.lua (a wrapper over the original's: new name, credits, file names and the
// values the user changed), and for a reshaped map its map-wide textures and position-placing Lua. Node-only.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { listArchive, readArchive } from '../archive/index.js';
import { paste } from '../core/index.js';
import { dedupeTiles, mapFileBase, quantizeHeights, smfFeatures, TILE_BYTES, writeSmf, writeSmt } from '../formats/index.js';
import { importMap, readMapData } from '../import/index.js';
import { checkPaint, texturePlan } from '../look/index.js';
import { readMapInfo } from '../lua/index.js';
import { bakeTileStrips, STRIP_ROWS } from './bake.js';
import { blendSeam, deriveMetal, originalRect, placeOriginalTiles, tileMinimap } from './derive-grids.js';
import { creditLine, findPath, lavaFiles, mapinfoPatch, positionFiles, wrapLua } from './derive-lua.js';
import { checkDerivativeName, clashesWithOriginal, licenceWarnings, suggestVersion } from './derive-rules.js';
import { moveTexture } from './derive-textures.js';
import { EXPORT_STEPS } from './steps.js';

const [READING, LOADING, BAKING, MOVING, WRITING] = EXPORT_STEPS.derivative;

// Textures the engine stretches over the whole map (mapinfo resources keys, lower case as readMapInfo gives them) and
// the colour new ground gets in them: null = the texture's mean colour.
const MAP_WIDE = {
  speculartex: null, skyreflectmodtex: null, parallaxheighttex: null, grassshadingtex: null,
  splatdistrtex: [0, 0, 0, 0], // none of the original's splat details: the baked ground has its own texture
  detailnormaltex: [128, 128, 255, 255], // flat in tangent space: the heightmap's own normal
  lightemissiontex: [0, 0, 0, 0], // no glow
};
const NO_GRASS = [0, 0, 0, 0]; // BAR's grass widget map (mapinfo custom.grassConfig.grassDistTGA) on new ground

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The original archive again (the doc carries only its listing), after checking it is still the one that was opened.
async function readOriginal(original, signal) {
  const name = basename(original.archive);
  if (!existsSync(original.archive)) throw new Error(`The original map ${name} is no longer at ${original.archive}. Put it back to export this map.`);
  const key = (listing) => listing.map((f) => `${f.path}\0${f.size}`).sort().join('\n');
  if (key(await listArchive(original.archive)) !== key(original.files)) {
    throw new Error(`The original map ${name} changed on disk since you opened it. Open it again to export this map.`);
  }
  signal.throwIfAborted();
  return readArchive(original.archive);
}

// Every map tile: the original's where it has one, baked (all cores) elsewhere, with the seam faded. Progress 0.1..0.6.
async function deriveTiles(doc, plan, original, originalTiles, onProgress, signal) {
  const tilesX = doc.sx * 16, count = tilesX * doc.sz * 16, { tileIndex } = original;
  const tiles = placeOriginalTiles(tileIndex, originalTiles, count);
  const isNew = (n) => !tileIndex || tileIndex[n] < 0;
  const strips = [];
  for (let n = 0; n < count; n++) if (isNew(n) && strips.at(-1) !== Math.floor(n / tilesX / STRIP_ROWS)) strips.push(Math.floor(n / tilesX / STRIP_ROWS));
  onProgress(0.1, LOADING);
  let done = 0;
  await bakeTileStrips(doc, plan, strips, (strip, baked) => {
    for (let k = 0; k < STRIP_ROWS * tilesX; k++) {
      const n = strip * STRIP_ROWS * tilesX + k;
      if (isNew(n)) tiles.set(baked.subarray(k * TILE_BYTES, (k + 1) * TILE_BYTES), n * TILE_BYTES);
    }
    onProgress(0.1 + (0.5 * ++done) / strips.length, BAKING);
  }, signal);
  if (tileIndex) blendSeam(tiles, tileIndex, tilesX);
  return tiles;
}

/**
 * The map-wide textures mapinfo names, moved with a reshaped map; dropped from mapinfo (the engine then uses its
 * defaults) when they cannot be read or, after a resize, cannot line up with the map any more.
 */
function mapWideTextures(files, info, original, move, onProgress) {
  const refs = Object.entries(MAP_WIDE).flatMap(([key, fill]) => {
    const name = info.raw.resources?.[key];
    return typeof name === 'string' ? [{ key, name, path: findPath(files, `maps/${name}`), fill }] : [];
  });
  const grass = info.raw.custom?.grassconfig?.grassdisttga;
  if (typeof grass === 'string') refs.push({ key: 'grassDistTGA', name: grass, path: findPath(files, grass), fill: NO_GRASS });
  const result = { files: new Map(), resources: {}, dropGrassDist: false, warnings: [] };
  const drop = (ref, why) => {
    if (ref.key === 'grassDistTGA') result.dropGrassDist = true;
    else result.resources[ref.key] = null;
    result.warnings.push(`${ref.name} (${ref.key}) ${why}; it was left out and BAR uses its default.`);
  };
  refs.forEach((ref, i) => {
    onProgress(0.6 + (0.2 * i) / refs.length, MOVING);
    if (!original.tileIndex) return drop(ref, 'cannot be resized with the map');
    if (!ref.path) return result.warnings.push(`${ref.name} (${ref.key}) is not in the archive, so it was not moved with the map.`);
    if (result.files.has(ref.path)) return; // one file under two keys
    try {
      result.files.set(ref.path, moveTexture(files.get(ref.path), move, ref.fill));
    } catch (error) {
      drop(ref, `could not be moved with the map (${error.message})`);
    }
  });
  return result;
}

// True when the user painted inside the tile rect [x0, z0, x1, z1) (4 heightmap samples per tile).
function paintedInside(doc, [x0, z0, x1, z1]) {
  for (let j = z0 * 4; j < Math.min(doc.H, z1 * 4); j++) {
    for (let i = x0 * 4; i < Math.min(doc.W, x1 * 4); i++) if (doc.paint[j * doc.W + i]) return true;
  }
  return false;
}

// Short notes on what the export could not carry over.
function notes(doc, original) {
  const warnings = [];
  if (!original.tileIndex) {
    warnings.push('The map was resized: its ground was baked again from the biome, and the original\'s terrain types and grass were reset.');
    warnings.push('Features and start boxes placed by the map\'s Lua were not scaled with the map; check them in game.');
  }
  const rect = originalRect(original.tileIndex, doc.sx * 16);
  if (rect && paintedInside(doc, rect)) {
    warnings.push('Paint on the original ground is not exported: the original texture is kept there (paint shows on new ground only).');
  }
  if (!(doc.settings.sunDir[2] < 0)) warnings.push('The sun shines from the south (lighting sunDir z ≥ 0), as in the original map; BAR maps usually light from the north.');
  return warnings;
}

const startsOf = (objects, [dx, dz]) => objects.filter((o) => o.type === 'start').map((o) => ({ x: o.x + dx, z: o.z + dz }));

/**
 * The archive files of a derivative of doc.original. Throws SAME_NAME (derive-rules.js) before reading anything.
 * @returns {Promise<{files: Map<string, Uint8Array>, report: {passedThrough: number, regenerated: string[], warnings: string[]}}>}
 */
export async function deriveMapFiles(doc, { quality, onProgress, signal }) {
  const { original, settings } = doc;
  checkDerivativeName(settings, original);
  checkPaint(doc);
  const plan = texturePlan(doc, quality), fileBase = mapFileBase(settings.name);
  onProgress(0, READING);
  const files = await readOriginal(original, signal);
  const opened = await importMap(files, { archive: original.archive, listing: original.files }); // as the editor opened it
  const info = await readMapInfo(files);
  const { smf, tiles: originalTiles, smfPath, smtPaths } = readMapData(files, info);
  signal.throwIfAborted();

  const tiles = await deriveTiles(doc, plan, original, originalTiles, onProgress, signal);
  const move = { from: original.size, to: [doc.sx, doc.sz], offset: original.offset };
  const reshaped = !sameValue(move.from, move.to) || move.offset.some(Boolean) || !original.tileIndex;
  const textures = reshaped ? mapWideTextures(files, info, original, move, onProgress) : { files: new Map(), resources: {}, dropGrassDist: false, warnings: [] };
  const credit = creditLine(original.info);
  const positions = reshaped && original.tileIndex ? positionFiles(files, move, credit) : { files: new Map(), warnings: [] };
  signal.throwIfAborted();

  onProgress(0.8, WRITING);
  const heights = quantizeHeights(doc.heights, [original.minHeight, original.maxHeight]);
  const metal = deriveMetal(doc, original, opened.settings.extractorRadius);
  // A grid of the original (per cells per unit) where the map now lies; `fill` on new ground.
  const shifted = (grid, per, fill) => paste(grid, original.size[0] * per, new Uint8Array(doc.sx * per * doc.sz * per).fill(fill), doc.sx * per, original.offset[0] * per, original.offset[1] * per);
  const unique = dedupeTiles(tiles);
  const smfBytes = writeSmf({
    mapId: Math.floor(Math.random() * 0x7fffffff),
    mapx: doc.sx * 64,
    mapy: doc.sz * 64,
    minHeight: heights.minHeight,
    maxHeight: heights.maxHeight,
    heights: heights.raw,
    typeMap: original.tileIndex ? shifted(smf.typeMap, 32, 0) : new Uint8Array(doc.sx * 32 * doc.sz * 32),
    minimap: reshaped ? tileMinimap(doc, tiles) : smf.minimap,
    metal: metal.data,
    tileFiles: [{ name: `${fileBase}.smt`, count: unique.tiles.length / TILE_BYTES }],
    tileIndex: unique.index,
    features: smfFeatures(doc),
    grass: original.tileIndex && smf.grass ? shifted(smf.grass, 16, 0) : null,
  });

  const starts = startsOf(doc.objects, [0, 0]);
  const mapinfo = mapinfoPatch(settings, opened.settings, original.info, {
    fileBase,
    smtFiles: smtPaths.length,
    heights: heights.minHeight !== original.minHeight || heights.maxHeight !== original.maxHeight ? heights : null,
    maxMetal: metal.maxMetal !== original.maxMetal ? metal.maxMetal : null,
    starts: sameValue(starts, startsOf(opened.objects, original.offset.map((v) => v * 512))) ? null : starts,
    resources: textures.resources,
    dropGrassDist: textures.dropGrassDist,
  });
  const written = new Map([
    ...wrapLua(files, findPath(files, 'mapinfo.lua'), mapinfo.body, credit),
    ...lavaFiles(files, doc, opened.settings, credit),
    ...positions.files,
    ...textures.files,
    [`maps/${fileBase}.smf`, smfBytes],
    [`maps/${fileBase}.smt`, writeSmt(unique.tiles)],
  ]);
  const out = new Map(files);
  for (const path of [smfPath, ...smtPaths]) out.delete(path);
  for (const [path, bytes] of written) {
    if (bytes) out.set(path, bytes);
    else out.delete(path);
  }
  return {
    files: out,
    report: {
      passedThrough: [...out].filter(([path, bytes]) => files.get(path) === bytes).length,
      regenerated: [...written].filter(([, bytes]) => bytes).map(([path]) => path),
      warnings: [...notes(doc, original), ...textures.warnings, ...positions.warnings, ...mapinfo.warnings],
    },
  };
}

// Licence and readme files anywhere in the archive (licenceWarnings ignores bundled code libraries).
const LICENCE_FILES = ['*licen*', '*copying*', '*readme*'];

/**
 * What the UI asks about before exporting a derivative: does it clash with the original's name (and which version to
 * suggest instead), and what does the original's licence allow.
 * @param {(version: string) => boolean} taken  true when an archive with that version exists already
 * @returns {Promise<{clash: boolean, suggestedVersion: string, licence: ReturnType<typeof licenceWarnings>}>}
 */
export async function checkDerivative(doc, taken = () => false) {
  const { original, settings } = doc;
  const files = existsSync(original.archive) ? await readArchive(original.archive, LICENCE_FILES) : new Map();
  return {
    clash: clashesWithOriginal(settings, original),
    suggestedVersion: suggestVersion(settings, original, taken),
    licence: licenceWarnings(original, files),
  };
}
