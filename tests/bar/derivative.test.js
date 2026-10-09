// Derivative exports (a map opened from an archive): a mistake here corrupts someone's map, so an untouched round trip
// of a real installed map must come back identical except for its name, an extended one must keep every original tile
// and pad its map-wide textures, and the rules (SAME_NAME, no overwrite, never the BAR maps folder, cancel) must hold.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { readArchive, TEMP_ROOT } from '../../src/archive/index.js';
import { checkExportDir, classifyLicence, exportMap, licenceWarnings, locateBar, openMapArchive } from '../../src/bar/index.js';
import { deriveMetal } from '../../src/bar/derive-grids.js';
import { positionFiles } from '../../src/bar/derive-lua.js';
import { suggestVersion } from '../../src/bar/derive-rules.js';
import { moveTexture } from '../../src/bar/derive-textures.js';
import { extendMap } from '../../src/core/index.js';
import { decodeBlock, decodeTga, encodeDds, encodeTga, readDds, readDdsHeader, TILE_BYTES } from '../../src/formats/index.js';
import { findMetalSpots, readMapData } from '../../src/import/index.js';
import { decodePng, encodePng, TEXTURE_ROOT } from '../../src/look/library-load.js';
import { readMapInfo } from '../../src/lua/index.js';
import { testMap } from '../helpers/test-map.js';

mkdirSync(TEMP_ROOT, { recursive: true });
const outDir = mkdtempSync(join(TEMP_ROOT, 'derivative-test-'));
after(() => rmSync(outDir, { recursive: true, force: true }));

let mapsDir = null;
try { mapsDir = locateBar().mapsDir; } catch { /* no BAR install: the real-map tests skip */ }
const installed = (name) => (mapsDir && existsSync(join(mapsDir, name)) ? join(mapsDir, name) : null);
const noLibrary = !existsSync(join(TEXTURE_ROOT, 'manifest.json')) && 'texture library not built (npm run textures)';
const skipFor = (name) => (!installed(name) && `${name} is not installed`) || noLibrary;

const tileAt = (data, n) => data.tiles.subarray(data.smf.tileIndex[n] * TILE_BYTES, (data.smf.tileIndex[n] + 1) * TILE_BYTES);
const heading = (r) => ((Math.round(r) % 65536) + 65536) % 65536;
const features = (smf) => smf.features.map((f) => [f.name.toLowerCase(), f.x, f.z, heading(f.rotation)]);
const withoutKeys = (raw, keys) => JSON.parse(JSON.stringify(raw, (k, v) => (keys.includes(k) ? undefined : v)));

async function read(archive) {
  const files = await readArchive(archive);
  const info = await readMapInfo(files);
  assert.equal(info.error, undefined, `mapinfo.lua of ${archive} reads: ${info.error}`);
  return { files, info, data: readMapData(files, info) };
}

const AVALANCHE = 'avalanche_3.4.sd7';
test('an untouched derivative of a real map comes back identical except its name', { skip: skipFor(AVALANCHE), timeout: 180_000 }, async () => {
  const { doc } = await openMapArchive(installed(AVALANCHE));
  doc.settings.version = '3.4-test1';
  const report = await exportMap(doc, outDir);
  const [before, derived] = await Promise.all([read(installed(AVALANCHE)), read(report.archivePath)]);
  const b = before.data.smf, a = derived.data.smf;

  assert.deepEqual(a.heights, b.heights, 'raw heights');
  assert.deepEqual([derived.info.minHeight ?? a.minHeight, derived.info.maxHeight ?? a.maxHeight], [before.info.minHeight ?? b.minHeight, before.info.maxHeight ?? b.maxHeight]);
  for (let n = 0; n < b.tileIndex.length; n++) {
    if (Buffer.compare(tileAt(derived.data, n), tileAt(before.data, n))) assert.fail(`tile ${n} differs`);
  }
  for (const key of ['metal', 'typeMap', 'grass', 'minimap']) assert.deepEqual(a[key], b[key], key);
  assert.deepEqual(features(a), features(b), 'features');

  const regenerated = ['mapinfo.lua', 'maps/Avalanche.smf', 'maps/Avalanche.smt'];
  assert.deepEqual(report.regenerated.toSorted(), regenerated.toSorted());
  assert.deepEqual(report.warnings, []);
  const old = [before.data.smfPath, ...before.data.smtPaths, 'mapinfo.lua'];
  const kept = [...before.files.keys()].filter((path) => !old.includes(path));
  assert.equal(report.passedThrough, kept.length);
  for (const path of kept) assert.ok(Buffer.from(derived.files.get(path)).equals(before.files.get(path)), `${path} passes through byte for byte`);

  // mapinfo: the original's every key, with only name, credits and file names changed.
  const changed = ['name', 'version', 'description', 'author', 'mapfile', 'smtfilename0'];
  assert.deepEqual(withoutKeys(derived.info.raw, changed), withoutKeys(before.info.raw, changed));
  assert.equal(derived.info.name, 'Avalanche');
  assert.equal(derived.info.version, '3.4-test1');
  assert.equal(derived.info.author, before.info.author);
  assert.ok(derived.info.description.startsWith(`Based on Avalanche 3.4 by ${before.info.author}.`), derived.info.description);
});

const RAVAGED = 'ravaged_remake_v1.2.sd7';
test('extending a real map 2 units east keeps every original tile and pads its map-wide textures', { skip: skipFor(RAVAGED), timeout: 180_000 }, async () => {
  const { doc: opened } = await openMapArchive(installed(RAVAGED));
  const doc = extendMap(opened, { east: 2 });
  doc.settings.version = 'v1.2-test2';
  const report = await exportMap(doc, outDir);
  const [before, derived] = await Promise.all([read(installed(RAVAGED)), read(report.archivePath)]);
  const b = before.data.smf, a = derived.data.smf, oldX = b.mapx / 4, newX = a.mapx / 4;
  assert.deepEqual([a.mapx, a.mapy], [b.mapx + 128, b.mapy]);

  for (let n = 0; n < a.tileIndex.length; n++) {
    const x = n % newX, z = Math.floor(n / newX);
    if (x < oldX && Buffer.compare(tileAt(derived.data, n), tileAt(before.data, z * oldX + x))) assert.fail(`original tile ${x},${z} differs`);
  }
  const newTiles = new Set(Array.from(a.tileIndex).filter((_, n) => n % newX >= oldX));
  assert.ok(newTiles.size > 50, `new ground has its own baked tiles (${newTiles.size} distinct)`);

  const rows = (grid, width, keep) => Array.from({ length: grid.length / width }, (_, z) => Array.from(grid.subarray(z * width, z * width + keep)));
  for (const key of ['metal', 'typeMap']) assert.deepEqual(rows(a[key], a.mapx / 2, b.mapx / 2), rows(b[key], b.mapx / 2, b.mapx / 2), `${key} of the original area`);
  assert.deepEqual(rows(a.grass, newX, oldX), rows(b.grass, oldX, oldX), 'grass of the original area');
  assert.ok(a.metal.every((v, k) => k % (a.mapx / 2) < b.mapx / 2 || v === 0), 'no metal on new ground');

  // Map-wide textures grow by 12/10 in x and keep their own resolution; tiled ones pass through.
  for (const key of ['splatdistrtex', 'speculartex', 'detailnormaltex']) {
    const path = `maps/${before.info.raw.resources[key]}`;
    const [o, n] = [readDdsHeader(before.files.get(path)), readDdsHeader(derived.files.get(path))];
    assert.deepEqual([n.width, n.height, n.fourCC], [(o.width * 12) / 10, o.height, o.fourCC], path);
    assert.ok(report.regenerated.includes(path), `${path} regenerated`);
  }
  const grass = decodeTga(derived.files.get(before.info.raw.custom.grassconfig.grassdisttga));
  assert.deepEqual([grass.width, grass.height], [192, 160], 'grass distribution map padded');
  assert.ok(report.passedThrough > 30);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(derived.info.teams, before.info.teams, 'start positions did not move (extended east)');
});

test('a derivative needs its own name or version (SAME_NAME), before any work', async () => {
  const doc = testMap({ sx: 2, sz: 2, name: 'Pyroclast', version: '1.0.4' });
  doc.original = { archive: 'D:/nowhere/pyroclast_1.0.4.sd7', info: { name: 'Pyroclast', version: '1.0.4', author: 'Cinnamon18', licence: null } };
  await assert.rejects(exportMap(doc, outDir), (error) => error.code === 'SAME_NAME');
  doc.settings.name = 'pyroclast '; // case and spaces do not make a new map
  await assert.rejects(exportMap(doc, outDir), (error) => error.code === 'SAME_NAME');
  assert.equal(suggestVersion(doc.settings, doc.original), '1.0.4-edit1');
  assert.equal(suggestVersion(doc.settings, doc.original, (v) => v === '1.0.4-edit1'), '1.0.4-edit2');
});

test('exports never write over an existing file unless asked, nor into the BAR maps folder', async () => {
  const doc = testMap({ sx: 2, sz: 2, name: 'Clash Test', version: '1' });
  const target = join(outDir, 'clash_test_1.sd7');
  writeFileSync(target, 'someone else\'s map');
  await assert.rejects(exportMap(doc, outDir), (error) => error.code === 'EXISTS' && error.archivePath === target);
  assert.equal(readFileSync(target, 'utf8'), 'someone else\'s map');
  assert.throws(() => checkExportDir('D:/BAR/data/maps', 'D:/BAR/data/maps'), (error) => error.code === 'BAR_MAPS_DIR');
  assert.throws(() => checkExportDir('d:/bar/DATA/maps/sub', 'D:/BAR/data/maps'), (error) => error.code === 'BAR_MAPS_DIR');
  checkExportDir('D:/BAR/data/maps-export', 'D:/BAR/data/maps');
  checkExportDir('D:/maps', 'D:/BAR/data/maps');
});

test('cancelling stops the export and leaves no file behind', { skip: noLibrary }, async () => {
  const doc = testMap({ sx: 4, sz: 4, name: 'Cancel Test', version: '1' });
  const dir = mkdtempSync(join(outDir, 'cancel-'));
  const controller = new AbortController();
  const labels = [];
  const job = exportMap(doc, dir, { signal: controller.signal, onProgress: (_, label) => { labels.push(label); if (label === 'Baking texture') controller.abort(); } });
  await assert.rejects(job, (error) => error.name === 'AbortError');
  assert.ok(labels.includes('Baking texture'));
  assert.deepEqual(readdirSync(dir), []);
  await assert.rejects(exportMap(doc, dir, { signal: AbortSignal.abort() }), (error) => error.name === 'AbortError');
});

test('licence matcher: ND and NC in the ways map authors write them', () => {
  const cases = [
    ['CC BY-NC-ND 4.0', { nd: true, nc: true }],
    ['CC BY-NC-SA 4.0 Cinnamon18', { nd: false, nc: true }],
    ['https://creativecommons.org/licenses/by-nd/4.0/', { nd: true, nc: false }],
    ['Attribution-NoDerivatives 4.0 International', { nd: true, nc: false }],
    ['No Derivatives allowed', { nd: true, nc: false }],
    ['Attribution-NonCommercial 4.0', { nd: false, nc: true }],
    ['licence: NC', { nd: false, nc: true }],
    ['CC BY-SA 4.0', { nd: false, nc: false }],
    ['GPL v2. Grab the 2nd edition and enjoy', { nd: false, nc: false }],
    ['CC0', { nd: false, nc: false }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(classifyLicence(text), expected, text);
  const files = new Map([['LICENSE.txt', new TextEncoder().encode('CC BY-ND 4.0')], ['libs/s11n/LICENSE', new TextEncoder().encode('NC')]]);
  assert.deepEqual(licenceWarnings({ info: { licence: null } }, files), { nd: true, nc: false, unknown: false, licence: 'LICENSE.txt' });
  assert.deepEqual(licenceWarnings({ info: { licence: null } }, new Map()), { nd: false, nc: false, unknown: true, licence: null });
  assert.deepEqual(licenceWarnings({ info: { licence: 'CC BY-NC-SA 4.0' } }, new Map()), { nd: false, nc: true, unknown: false, licence: 'CC BY-NC-SA 4.0' });
});

test('metal: untouched spots keep their pixels, removed ones are cleared, new ones stamped', () => {
  const doc = testMap({ sx: 2, sz: 2 });
  const width = 64, metalMap = new Uint8Array(64 * 64);
  const blob = (x, z, v) => { for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 2; dx++) metalMap[(z + dz) * width + x + dx] = v; };
  blob(10, 10, 100);
  blob(40, 40, 50);
  const original = { metalMap, maxMetal: 2 };
  const spots = findMetalSpots(metalMap, 64, 64, { maxMetal: 2, extractorRadius: 90 });
  doc.objects = spots.map((s, i) => ({ id: i + 1, type: 'metal', ...s }));
  assert.equal(deriveMetal(doc, original, 90).data, metalMap, 'unchanged: the original map itself');

  doc.objects = [doc.objects[0], { id: 9, type: 'metal', x: 800, z: 200, metal: 1.5 }];
  const { data, maxMetal, changed } = deriveMetal(doc, original, 90);
  assert.ok(changed);
  assert.equal(maxMetal, 2);
  assert.equal(data[10 * width + 10], 100, 'the kept spot keeps its own pixels');
  assert.equal(data[40 * width + 40], 0, 'the removed spot is cleared');
  const found = findMetalSpots(data, 64, 64, { maxMetal, extractorRadius: 90 });
  assert.deepEqual(found.map((s) => Math.round(s.metal * 1000) / 1000).sort(), [spots[0].metal, 1.5].sort());
});

test('map-wide textures move with the map: DDS (rows bottom-first), PNG and TGA', () => {
  const move = { from: [2, 2], to: [4, 2], offset: [2, 0] }; // 2 units added in the west
  // 64x64 texture of a 2x2 map: a gradient, so every texel says where it came from.
  const rgba = new Uint8Array(64 * 64 * 4).map((_, k) => (k % 4 === 0 ? (k >> 2) % 64 * 4 : k % 4 === 1 ? Math.floor((k >> 2) / 64) * 4 : k % 4 === 2 ? 77 : 255));
  const dds = readDds(moveTexture(encodeDds(rgba, 64, 64, 'bc3'), move, [0, 0, 255, 255]));
  assert.deepEqual([dds.width, dds.height, dds.levels.length], [128, 64, 8]);
  const texel = (x, y) => { // top-down coordinates; the file is bottom-first
    const out = new Uint8Array(64), fy = 63 - y;
    decodeBlock(dds.levels[0], ((fy >> 2) * 32 + (x >> 2)) * 16, 'bc3', out);
    return out.subarray(((fy & 3) * 4 + (x & 3)) * 4, ((fy & 3) * 4 + (x & 3)) * 4 + 4);
  };
  for (const [x, y] of [[64, 0], [70, 10], [127, 63], [100, 40]]) {
    const t = texel(x, y);
    assert.ok(Math.abs(t[0] - (x - 64) * 4) <= 12 && Math.abs(t[1] - y * 4) <= 12, `texel ${x},${y} came from ${x - 64},${y}: ${[...t]}`);
  }
  assert.deepEqual([...texel(0, 30)].slice(0, 3), [0, 0, 255], 'far new ground is the fill colour');

  const png = decodePng(moveTexture(new Uint8Array(encodePng({ width: 64, height: 64, data: rgba })), move, null));
  assert.deepEqual([png.width, png.height], [128, 64]);
  assert.deepEqual([...png.data.subarray((10 * 128 + 70) * 4, (10 * 128 + 70) * 4 + 4)], [6 * 4, 10 * 4, 77, 255]);
  const grey = { width: 32, height: 32, channels: 1, data: new Uint8Array(32 * 32).map((_, k) => k % 32), descriptor: 0 };
  const tga = decodeTga(moveTexture(encodeTga(grey), { from: [2, 2], to: [2, 4], offset: [0, 0] }, [0, 0, 0, 0]));
  assert.deepEqual([tga.width, tga.height, tga.data[5 * 32 + 7], tga.data[63 * 32 + 7]], [32, 64, 7, 0], 'grey TGA grows south, new rows empty');
});

test('Lua-placed features and start boxes move with the map and leave it when cropped away', async () => {
  const encode = (text) => new TextEncoder().encode(text);
  const files = new Map([
    ['mapconfig/featureplacer/config.lua', encode('local cfg = { objectlist = { { name = "rock", x = 100, z = 200, rot = 0 }, { name = "tree", x = 1000, z = 50 } } }\nreturn cfg')],
    ['mapconfig/map_startboxes.lua', encode('return { [0] = { boxes = { { {0, 0}, {512, 0}, {512, 512} } }, startpoints = { {256, 256} } } }, { 2 }')],
    ['mapconfig/map_metal_layout.lua', encode('return {}')],
  ]);
  const { files: moved, warnings } = positionFiles(files, { offset: [-1, 1], to: [2, 3] }, 'Based on Test 1 by Someone');
  assert.match(warnings.join(), /map_metal_layout\.lua/);
  const evaluate = async (path) => (await readMapInfo(new Map([...files, ...moved, ['mapinfo.lua', encode(`return VFS.Include("${path}")`)]]))).raw;
  assert.deepEqual((await evaluate('mapconfig/featureplacer/config.lua')).objectlist, [{ name: 'tree', x: 488, z: 562 }]);
  const boxes = await evaluate('mapconfig/map_startboxes.lua');
  assert.deepEqual(boxes[0].boxes[0], [[0, 512], [0, 512], [0, 1024]]);
  assert.deepEqual(boxes[0].startpoints, [[0, 768]]);
});
