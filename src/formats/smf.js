// SMF map file reader/writer (RecoilEngine rts/Map/SMF/SMFFormat.h). Little-endian throughout.
// Layout written: 80-byte header | extra headers | heightmap | typemap | minimap | metalmap | tiles | features | grass.

const MAGIC = 'spring map file';
const HEADER_BYTES = 80;
export const MINIMAP_BYTES = 699048; // 1024x1024 DXT1 + mips down to 4x4
const FEATURE_BYTES = 24; // int type, float x, y, z, rotation, relativeSize
const GRASS_TYPE = 1; // MEH_Vegetation: {int size = 12, int type = 1, int grassPtr}
const GRASS_HEADER_BYTES = 12;

/**
 * @typedef {Object} SmfFeature
 * @property {string} name  feature def name
 * @property {number} x  elmos
 * @property {number} y  elmos (the engine places features on the ground and ignores it)
 * @property {number} z  elmos
 * @property {number} rotation  heading in engine units (65536 = full turn)
 * @property {number} size  relativeSize (unused by the engine, 1 by convention)
 */
/**
 * @typedef {Object} SmfData
 * @property {number} mapId
 * @property {number} mapx  squares (8 elmos each), 64 per map unit
 * @property {number} mapy
 * @property {number} minHeight  elmos; height = minHeight + raw * (maxHeight - minHeight) / 65536
 * @property {number} maxHeight
 * @property {Uint16Array} heights  (mapx+1) * (mapy+1), row-major
 * @property {Uint8Array} typeMap  mapx/2 * mapy/2 terrain type ids
 * @property {Uint8Array} minimap  MINIMAP_BYTES of DXT1
 * @property {Uint8Array} metal  mapx/2 * mapy/2
 * @property {{name: string, count: number}[]} tileFiles  SMT files and how many tiles each holds
 * @property {Int32Array} tileIndex  mapx/4 * mapy/4 indices into the concatenated tile files
 * @property {SmfFeature[]} features
 * @property {Uint8Array|null} grass  mapx/4 * mapy/4 grass density, or null for no grass
 */

const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function readCString(bytes, off) {
  const end = bytes.indexOf(0, off);
  if (end < 0) throw new Error(`SMF: unterminated string at byte ${off}`);
  return { text: String.fromCharCode(...bytes.subarray(off, end)), next: end + 1 };
}

function cStringBytes(text) {
  const out = new Uint8Array(text.length + 1);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0 || code > 255) throw new Error(`SMF: name ${JSON.stringify(text)} is not Latin-1 text`);
    out[i] = code;
  }
  return out;
}

function checkInside(bytes, ptr, length, name) {
  if (ptr < HEADER_BYTES || length < 0 || ptr + length > bytes.length) throw new Error(`SMF: ${name} (bytes ${ptr}..${ptr + length}) is outside the file`);
}

function section(bytes, ptr, length, name) {
  checkInside(bytes, ptr, length, name);
  return bytes.slice(ptr, ptr + length);
}

/** @param {Uint8Array} bytes  @returns {SmfData} */
export function readSmf(bytes) {
  const dv = view(bytes);
  if (bytes.length < HEADER_BYTES || readCString(bytes, 0).text !== MAGIC) throw new Error('SMF: not a spring map file');
  const int = (o) => dv.getInt32(o, true);
  if (int(16) !== 1) throw new Error(`SMF: version ${int(16)} is not supported`);
  const mapx = int(24), mapy = int(28);
  if (mapx <= 0 || mapy <= 0 || mapx % 128 || mapy % 128) throw new Error(`SMF: map size ${mapx}x${mapy} is not a multiple of 128`);
  const [heightPtr, typePtr, tilesPtr, minimapPtr, metalPtr, featurePtr, numExtra] = [52, 56, 60, 64, 68, 72, 76].map(int);
  const quarter = (mapx / 4) * (mapy / 4), half = (mapx / 2) * (mapy / 2);

  let grass = null;
  for (let i = 0, off = HEADER_BYTES; i < numExtra; i++) {
    const size = int(off);
    if (size < 8) throw new Error(`SMF: extra header ${i} has size ${size}`);
    if (int(off + 4) === GRASS_TYPE) grass = section(bytes, int(off + 8), quarter, 'grass map');
    off += size; // shortcut: other extra header types are dropped; none are in use by BAR maps today
  }

  const heightBytes = section(bytes, heightPtr, (mapx + 1) * (mapy + 1) * 2, 'heightmap');
  const heights = new Uint16Array(heightBytes.length / 2);
  const hv = view(heightBytes);
  for (let i = 0; i < heights.length; i++) heights[i] = hv.getUint16(i * 2, true);

  checkInside(bytes, tilesPtr, 8, 'tiles header');
  const [numFiles, numTiles] = [int(tilesPtr), int(tilesPtr + 4)];
  const tileFiles = [];
  let off = tilesPtr + 8;
  for (let i = 0; i < numFiles; i++) {
    const { text, next } = readCString(bytes, off + 4);
    tileFiles.push({ name: text, count: int(off) });
    off = next;
  }
  if (tileFiles.reduce((sum, f) => sum + f.count, 0) !== numTiles) throw new Error('SMF: tile file counts do not add up to numTiles');
  checkInside(bytes, off, quarter * 4, 'tile index');
  const tileIndex = new Int32Array(quarter);
  for (let i = 0; i < quarter; i++) tileIndex[i] = int(off + i * 4);

  checkInside(bytes, featurePtr, 8, 'features header');
  const [numTypes, numFeatures] = [int(featurePtr), int(featurePtr + 4)];
  const typeNames = [];
  off = featurePtr + 8;
  for (let i = 0; i < numTypes; i++) {
    const { text, next } = readCString(bytes, off);
    typeNames.push(text);
    off = next;
  }
  checkInside(bytes, off, numFeatures * FEATURE_BYTES, 'features');
  const features = [];
  for (let i = 0; i < numFeatures; i++, off += FEATURE_BYTES) {
    const name = typeNames[int(off)];
    if (name === undefined) throw new Error(`SMF: feature ${i} uses unknown type ${int(off)}`);
    const [x, y, z, rotation, size] = [4, 8, 12, 16, 20].map((o) => dv.getFloat32(off + o, true));
    features.push({ name, x, y, z, rotation, size });
  }

  return {
    mapId: int(20),
    mapx,
    mapy,
    minHeight: dv.getFloat32(44, true),
    maxHeight: dv.getFloat32(48, true),
    heights,
    typeMap: section(bytes, typePtr, half, 'typemap'),
    minimap: section(bytes, minimapPtr, MINIMAP_BYTES, 'minimap'),
    metal: section(bytes, metalPtr, half, 'metalmap'),
    tileFiles,
    tileIndex,
    features,
    grass,
  };
}

function expectLength(name, array, length) {
  if (array.length !== length) throw new Error(`SMF: ${name} has ${array.length} entries, expected ${length}`);
}

/** @param {SmfData} smf  @returns {Uint8Array} */
export function writeSmf(smf) {
  const { mapx, mapy } = smf;
  if (mapx <= 0 || mapy <= 0 || mapx % 128 || mapy % 128) throw new Error(`SMF: map size ${mapx}x${mapy} is not a multiple of 128`);
  const quarter = (mapx / 4) * (mapy / 4), half = (mapx / 2) * (mapy / 2);
  expectLength('heights', smf.heights, (mapx + 1) * (mapy + 1));
  expectLength('typeMap', smf.typeMap, half);
  expectLength('metal', smf.metal, half);
  expectLength('minimap', smf.minimap, MINIMAP_BYTES);
  expectLength('tileIndex', smf.tileIndex, quarter);
  if (smf.grass) expectLength('grass', smf.grass, quarter);

  const fileNames = smf.tileFiles.map((f) => cStringBytes(f.name));
  const typeNames = [...new Set(smf.features.map((f) => f.name))];
  const typeId = new Map(typeNames.map((name, i) => [name, i]));
  const typeBytes = typeNames.map(cStringBytes);
  const sum = (arrays) => arrays.reduce((n, a) => n + a.length, 0);

  let p = HEADER_BYTES + (smf.grass ? GRASS_HEADER_BYTES : 0);
  const at = (length) => { const start = p; p += length; return start; };
  const ptr = {
    height: at(smf.heights.length * 2),
    type: at(half),
    minimap: at(MINIMAP_BYTES),
    metal: at(half),
    tiles: at(8 + 4 * fileNames.length + sum(fileNames) + quarter * 4),
    features: at(8 + sum(typeBytes) + smf.features.length * FEATURE_BYTES),
    grass: at(smf.grass ? quarter : 0),
  };
  const out = new Uint8Array(p);
  const dv = view(out);
  const int = (o, v) => dv.setInt32(o, v, true);

  out.set(cStringBytes(MAGIC), 0);
  [1, smf.mapId, mapx, mapy, 8, 8, 32].forEach((v, i) => int(16 + i * 4, v)); // version, mapid, size, square/texel/tile size
  dv.setFloat32(44, smf.minHeight, true);
  dv.setFloat32(48, smf.maxHeight, true);
  [ptr.height, ptr.type, ptr.tiles, ptr.minimap, ptr.metal, ptr.features, smf.grass ? 1 : 0].forEach((v, i) => int(52 + i * 4, v));
  if (smf.grass) [GRASS_HEADER_BYTES, GRASS_TYPE, ptr.grass].forEach((v, i) => int(HEADER_BYTES + i * 4, v));

  for (let i = 0; i < smf.heights.length; i++) dv.setUint16(ptr.height + i * 2, smf.heights[i], true);
  out.set(smf.typeMap, ptr.type);
  out.set(smf.minimap, ptr.minimap);
  out.set(smf.metal, ptr.metal);

  let o = ptr.tiles;
  int(o, fileNames.length);
  int(o + 4, smf.tileFiles.reduce((n, f) => n + f.count, 0));
  o += 8;
  smf.tileFiles.forEach((file, i) => {
    int(o, file.count);
    out.set(fileNames[i], o + 4);
    o += 4 + fileNames[i].length;
  });
  for (const index of smf.tileIndex) { int(o, index); o += 4; }

  o = ptr.features;
  int(o, typeNames.length);
  int(o + 4, smf.features.length);
  o += 8;
  for (const name of typeBytes) { out.set(name, o); o += name.length; }
  for (const f of smf.features) {
    int(o, typeId.get(f.name));
    [f.x, f.y, f.z, f.rotation, f.size].forEach((v, i) => dv.setFloat32(o + 4 + i * 4, v, true));
    o += FEATURE_BYTES;
  }

  if (smf.grass) out.set(smf.grass, ptr.grass);
  return out;
}
