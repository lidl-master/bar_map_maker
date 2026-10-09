// What the G7 checklist (checklist.js) judges, read from a map archive: mapinfo.lua, the SMF and the texture files
// mapinfo names. Node-only (PNG decoding uses node:zlib); the facts are plain data, so they cross IPC.
import { basename } from 'node:path';
import { readArchive } from '../archive/index.js';
import { decodeDxt1, readDdsHeader, readSmf } from '../formats/index.js';
import { readMapInfo } from '../lua/index.js';
import { decodePng } from '../look/library-load.js';
import { geoFacts, metalFacts } from './checklist.js';

// Engine defaults (Recoil MapInfo) for values a mapinfo.lua leaves out.
const DEFAULTS = { minWind: 5, maxWind: 25, tidal: 0, fogStart: 0.1, fogEnd: 1, sunDir: [0, 1, 2], ambient: [0.5, 0.5, 0.5], diffuse: [0.5, 0.5, 0.5], maxMetal: 0.02, extractorRadius: 500 };
const MINIMAP_256 = 1024 * 1024 / 2 + 512 * 512 / 2; // the SMF minimap's 256x256 DXT1 mip follows the 1024 and 512 mips
const MEAN_MAX_SIDE = 512; // texture means are taken on the first mip no larger than this
const DNTS_KEYS = [1, 2, 3, 4].map((i) => `splatdetailnormaltex${i}`);

const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const normalize = (v) => { const n = Math.hypot(...v) || 1; return v.map((c) => c / n); };
const color = (value, fallback) => (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite) ? value.slice(0, 3) : fallback);

/**
 * Reads only what the checklist needs: Lua files first (mapinfo.lua names the textures), then the SMF and those textures.
 * @returns {Promise<import('./checklist.js').MapFacts>}
 */
export async function readMapFacts(archivePath) {
  const lua = await readArchive(archivePath, ['*.lua']);
  const info = await readMapInfo(lua);
  if (info.error) throw new Error(`${basename(archivePath)}: mapinfo.lua could not be read: ${info.error}`);
  const resources = info.raw.resources ?? {};
  const textures = [...DNTS_KEYS, 'speculartex', 'detailnormaltex'].map((key) => resources[key]).filter((name) => typeof name === 'string');
  const rest = await readArchive(archivePath, ['*.smf', ...new Set(textures.map((name) => basename(name)))]);
  return mapFacts(new Map([...lua, ...rest]), info);
}

/**
 * @param {Map<string, Uint8Array>} files  archive files: at least mapinfo.lua, the SMF and the textures mapinfo names
 * @param {object} info  readMapInfo(files)
 * @returns {import('./checklist.js').MapFacts}
 */
export function mapFacts(files, info) {
  const raw = info.raw, atmosphere = raw.atmosphere ?? {}, lighting = raw.lighting ?? {}, resources = raw.resources ?? {};
  const byLower = new Map([...files.keys()].map((path) => [path.toLowerCase(), path]));
  const file = (name) => {
    if (typeof name !== 'string') return null;
    const path = byLower.get(`maps/${basename(name)}`.toLowerCase()) ?? byLower.get(name.toLowerCase());
    return path ? files.get(path) : null;
  };
  const smfPath = (typeof raw.mapfile === 'string' && byLower.get(raw.mapfile.toLowerCase())) || [...files.keys()].find((p) => /^maps\/[^/]+\.smf$/i.test(p));
  if (!smfPath) throw new Error('the archive has no maps/*.smf map file');
  const smf = readSmf(files.get(smfPath));
  const sx = smf.mapx / 64, sz = smf.mapy / 64, W = smf.mapx + 1, H = smf.mapy + 1;
  const minH = finite(info.minHeight, smf.minHeight), step = (finite(info.maxHeight, smf.maxHeight) - minH) / 65536;
  const heights = Float32Array.from(smf.heights, (h) => minH + h * step);
  const extractorRadius = finite(info.extractorRadius, DEFAULTS.extractorRadius);
  const vents = smf.features.filter((f) => f.name.toLowerCase() === 'geovent');
  const featurePlacer = [...files].filter(([path]) => /^mapconfig\/featureplacer\/.*\.lua$/i.test(path));
  return {
    sx, sz,
    minWind: finite(atmosphere.minwind, DEFAULTS.minWind),
    maxWind: finite(atmosphere.maxwind, DEFAULTS.maxWind),
    tidal: finite(raw.tidalstrength, DEFAULTS.tidal),
    sunDir: normalize(info.sunDir ?? DEFAULTS.sunDir),
    starts: info.teams,
    dnts: DNTS_KEYS.filter((key) => resources[key]).map((key) => ({ file: resources[key], ...imageSize(file(resources[key])) })),
    normalTex: resources.detailnormaltex ? { file: resources.detailnormaltex, ...imageSize(file(resources.detailnormaltex)) } : null,
    specularMean: resources.speculartex ? textureMean(file(resources.speculartex)) : null,
    // shortcut: a grassDistTGA in mapinfo custom.grassConfig (BAR's other grass source) is not read; no installed map uses one
    grass: smf.grass ? smf.grass.reduce((n, g) => n + (g > 0), 0) / smf.grass.length : 0,
    minimapLuma: luma(decodeDxt1(smf.minimap.subarray(MINIMAP_256), 256, 256)),
    fog: { start: finite(atmosphere.fogstart, DEFAULTS.fogStart), end: finite(atmosphere.fogend, DEFAULTS.fogEnd) },
    light: { ambient: color(lighting.groundambientcolor, DEFAULTS.ambient), diffuse: color(lighting.grounddiffusecolor, DEFAULTS.diffuse) },
    metal: metalFacts(smf.metal, smf.mapx / 2, smf.mapy / 2, { maxMetal: finite(info.maxMetal, DEFAULTS.maxMetal), extractorRadius }),
    geos: geoFacts(heights, W, H, vents),
    // Springboard's feature placer writes `y = <height>` per feature: those float or sink when the ground changes.
    fixedY: featurePlacer.reduce((n, [, bytes]) => n + (new TextDecoder().decode(bytes).match(/[{,]\s*y\s*=\s*-?[\d.]+/g)?.length ?? 0), 0),
  };
}

/** Mean Rec. 709 luma (0..255) of RGBA pixels. */
function luma(rgba) {
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  return sum / (rgba.length / 4);
}

/** {width, height} of a DDS, TGA or PNG; {width: null, height: null} for a missing file or another format. */
function imageSize(bytes) {
  if (!bytes || bytes.length < 24) return { width: null, height: null, missing: !bytes };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x44 && bytes[1] === 0x44 && bytes[2] === 0x53) return { width: dv.getUint32(16, true), height: dv.getUint32(12, true) }; // "DDS"
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) }; // PNG IHDR
  if ([2, 3, 10, 11].includes(bytes[2])) return { width: dv.getUint16(12, true), height: dv.getUint16(14, true) }; // TGA true-colour / grey
  return { width: null, height: null };
}

/** Mean RGB intensity (0..255) of a texture: DDS (DXT1/3/5 on a small mip, or 32-bit), TGA (24/32-bit, RLE) or PNG; null if unreadable. */
function textureMean(bytes) {
  if (!bytes) return null;
  try {
    const rgba = decodeSmall(bytes);
    if (!rgba) return null;
    let sum = 0;
    for (let i = 0; i < rgba.length; i += 4) sum += rgba[i] + rgba[i + 1] + rgba[i + 2];
    return sum / (rgba.length / 4) / 3;
  } catch {
    return null; // an unreadable texture counts as unknown, not as a failure of the check
  }
}

function decodeSmall(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return toRgba(decodePng(bytes));
  if (bytes[0] === 0x44 && bytes[1] === 0x44 && bytes[2] === 0x53) return decodeDdsSmall(bytes);
  return decodeTga(bytes);
}

function toRgba({ width, height, channels, data }) {
  if (channels === 4) return data;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = data[i * channels + (channels >= 3 ? c : 0)];
    out[i * 4 + 3] = 255;
  }
  return out;
}

function decodeDdsSmall(bytes) {
  const { width, height, mips, fourCC } = readDdsHeader(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const block = { DXT1: 8, DXT3: 16, DXT5: 16 }[fourCC];
  if (!block) {
    if (dv.getUint32(88, true) !== 32) return null; // only 32-bit BGRA among uncompressed formats
    const out = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) [out[i * 4 + 2], out[i * 4 + 1], out[i * 4], out[i * 4 + 3]] = bytes.subarray(128 + i * 4, 132 + i * 4);
    return out;
  }
  let offset = 128, w = width, h = height;
  for (let level = 1; level < Math.max(1, mips) && Math.max(w, h) > MEAN_MAX_SIDE; level++) {
    offset += Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * block;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  const blocks = Math.ceil(w / 4) * Math.ceil(h / 4), level = bytes.subarray(offset, offset + blocks * block);
  // shortcut: DXT3/5 colour blocks go through the DXT1 decoder, which reads c0 <= c1 blocks as 3-colour (DXT3/5 never
  // are); fine for a mean, revisit if exact colours are ever needed.
  const colour = block === 8 ? level : Uint8Array.from({ length: blocks * 8 }, (_, i) => level[(i >> 3) * 16 + 8 + (i & 7)]);
  return decodeDxt1(colour, Math.ceil(w / 4) * 4, Math.ceil(h / 4) * 4);
}

function decodeTga(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = bytes[2], width = dv.getUint16(12, true), height = dv.getUint16(14, true), bpp = bytes[16] >> 3;
  if (![2, 10].includes(type) || ![3, 4].includes(bpp)) return null;
  const out = new Uint8Array(width * height * 4);
  let src = 18 + bytes[0], px = 0;
  const put = (o) => { out[px * 4] = bytes[o + 2]; out[px * 4 + 1] = bytes[o + 1]; out[px * 4 + 2] = bytes[o]; out[px * 4 + 3] = bpp === 4 ? bytes[o + 3] : 255; px++; };
  while (px < width * height && src < bytes.length) {
    if (type === 2) { put(src); src += bpp; continue; }
    const head = bytes[src++], count = (head & 127) + 1;
    if (head & 128) { for (let i = 0; i < count; i++) put(src); src += bpp; } else for (let i = 0; i < count; i++, src += bpp) put(src);
  }
  return out; // rows bottom-up; irrelevant for a mean
}
