// The SMF and its SMT tile files inside a map archive, found the way the engine finds them. Pure.
import { concatBytes, readSmf, readSmt, TILE_BYTES } from '../formats/index.js';
import { vfsPath } from '../lua/index.js';

/** Case-insensitive lookup of archive paths, like the engine's VFS: the first candidate that exists, or null. */
function finder(files) {
  const byVfs = new Map([...files.keys()].map((path) => [vfsPath(path), path]));
  return (...candidates) => candidates.map((c) => c && byVfs.get(vfsPath(c))).find(Boolean) ?? null;
}

/**
 * @param {Map<string, Uint8Array>} files  archive contents (at least mapinfo.lua, the SMF and its SMT files)
 * @param {object} info  readMapInfo(files): its `mapfile` and `smf.smtFileName<n>` override the defaults
 * @returns {{smfPath: string, smtPaths: string[], smf: import('../formats/smf.js').SmfData, tiles: Uint8Array}}
 *   tiles: the tiles of every SMT, concatenated in SMF order (TILE_BYTES each), as smf.tileIndex counts them
 */
export function readMapData(files, info) {
  const find = finder(files);
  const smfPath = find(info.raw.mapfile) ?? [...files.keys()].find((path) => /^maps\/[^/]+\.smf$/i.test(path));
  if (!smfPath) throw new Error('the archive has no maps/*.smf map file');
  const smf = readSmf(files.get(smfPath));
  const smtPaths = smf.tileFiles.map(({ name }, i) => {
    const override = info.raw.smf?.[`smtfilename${i}`];
    const path = find(override, override && `maps/${override}`, `maps/${name}`, name);
    if (!path) throw new Error(`tile file ${override ?? name} is not in the archive`);
    return path;
  });
  const parts = smtPaths.map((path, i) => {
    const tiles = readSmt(files.get(path)), bytes = smf.tileFiles[i].count * TILE_BYTES;
    if (tiles.length < bytes) throw new Error(`${path} has ${tiles.length / TILE_BYTES} tiles, the map file expects ${smf.tileFiles[i].count}`);
    return tiles.subarray(0, bytes);
  });
  // Most maps keep every tile in one SMT, and that one is not copied again.
  const tiles = parts.length === 1 ? parts[0] : concatBytes(parts);
  const count = tiles.length / TILE_BYTES;
  if (smf.tileIndex.some((t) => t < 0 || t >= count)) throw new Error(`the map file's tile index points past its ${count} tiles`);
  return { smfPath, smtPaths, smf, tiles };
}
