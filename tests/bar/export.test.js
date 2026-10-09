// Full export of a small synthetic map through the worker bake and 7-Zip, read back through readArchive.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { after, test } from 'node:test';
import { readArchive, TEMP_ROOT } from '../../src/archive/index.js';
import { exportMap } from '../../src/bar/index.js';
import { createMap } from '../../src/core/index.js';
import { readDdsHeader, readSmf, readSmt, TILE_BYTES } from '../../src/formats/index.js';
import { TEXTURE_ROOT } from '../../src/look/library-load.js';
import { readMapInfo } from '../../src/lua/index.js';
import { generate } from '../../src/terrain/index.js';
import { testMap } from '../helpers/test-map.js';

mkdirSync(TEMP_ROOT, { recursive: true });
const outDir = mkdtempSync(join(TEMP_ROOT, 'export-test-'));
after(() => rmSync(outDir, { recursive: true, force: true }));
// The material library is generated (npm run textures), not committed.
const skip = !existsSync(join(TEXTURE_ROOT, 'manifest.json')) && 'texture library not built (npm run textures)';

test('exports a 2x2 map whose archive holds a consistent SMF, SMT, mapinfo and texture stack', { skip }, async () => {
  const doc = testMap({ sx: 2, sz: 2, name: 'Export Test', version: '1.2' });
  const progress = [];
  const { archivePath, bytes } = await exportMap(doc, outDir, { onProgress: (f) => progress.push(f) });
  assert.equal(basename(archivePath), 'export_test_1.2.sd7');
  assert.ok(bytes > 0);
  assert.equal(progress.at(-1), 1);

  const files = await readArchive(archivePath);
  const smf = readSmf(files.get('maps/Export_Test.smf'));
  const tiles = readSmt(files.get('maps/Export_Test.smt'));
  assert.deepEqual([smf.mapx, smf.mapy], [128, 128]);
  assert.deepEqual(smf.tileFiles, [{ name: 'Export_Test.smt', count: tiles.length / TILE_BYTES }]);
  assert.ok(smf.tileIndex.every((t) => t >= 0 && t < tiles.length / TILE_BYTES));
  for (let k = 0; k < doc.heights.length; k += 97) {
    const h = smf.minHeight + (smf.heights[k] * (smf.maxHeight - smf.minHeight)) / 65536;
    assert.ok(Math.abs(h - doc.heights[k]) < 0.01);
  }
  const placed = doc.objects.filter((o) => o.type === 'geo' || o.type === 'feature');
  assert.deepEqual(smf.features.map((f) => [f.name, f.x, f.z]), placed.map((o) => [o.name ?? 'GeoVent', o.x, o.z]));
  assert.equal(smf.grass?.length, 32 * 32, 'temperate grass in the SMF vegetation header');

  const info = await readMapInfo(files);
  assert.equal(info.smtFile, 'maps/Export_Test.smt');
  const resources = Object.entries(info.raw.resources).filter(([key]) => key !== 'splatdetailnormaldiffusealpha'); // raw keys are lower case
  assert.equal(resources.length, 8, 'splat distribution, 4 splat detail textures, detail normals, specular, map edge (grass shading)');
  for (const [key, name] of resources) {
    assert.ok(files.has(`maps/${name}`), `${key}: maps/${name} is in the archive`);
    if (name.endsWith('.dds')) assert.ok(readDdsHeader(files.get(`maps/${name}`)).mips > 1, `${name} has mips`);
  }
  assert.equal(info.raw.resources.splatdetailnormaldiffusealpha, 1);
  assert.equal(info.raw.custom.grassconfig.mapgrasscolormodtex, '$minimap', 'BAR grass keeps the minimap colours');
  assert.equal(Object.values(info.raw.splats.texscales).length, 4);
});

test('the Share preset makes a smaller archive with DDS splat textures', { skip }, async () => {
  const doc = testMap({ sx: 4, sz: 4, name: 'Preset Test' });
  const standard = await exportMap(doc, outDir);
  const shareDir = mkdtempSync(join(outDir, 'share-'));
  const share = await exportMap(doc, shareDir, { quality: 'share' });
  assert.ok(share.bytes < standard.bytes * 0.6, `share ${share.bytes} vs standard ${standard.bytes}`);
  const dnts = [...(await readArchive(share.archivePath)).keys()].filter((path) => path.startsWith('maps/dnts_'));
  assert.equal(dnts.length, 4);
  assert.ok(dnts.every((path) => path.endsWith('.dds')));
});

test('a 32x32 rolling-hills map exports under 50 MB with the Share preset', { skip, timeout: 180_000 }, async () => {
  const doc = createMap({ sx: 32, sz: 32 });
  doc.settings.name = 'Share Bound Test';
  generate(doc, 'hills', { players: 4, seed: 7 });
  const { bytes } = await exportMap(doc, outDir, { quality: 'share' });
  assert.ok(bytes <= 50e6, `${(bytes / 1e6).toFixed(1)} MB`);
});

test('a doc mistake fails before the texture bake starts', async () => {
  const doc = testMap({ sx: 2, sz: 2 });
  doc.settings.sunDir = [0, 1, 1];
  const progress = [];
  await assert.rejects(exportMap(doc, outDir, { onProgress: (f) => progress.push(f) }), /sunDir/);
  assert.deepEqual(progress, []);
});

test('an unknown quality preset or paint id fails before the bake', async () => {
  const doc = testMap({ sx: 2, sz: 2 });
  await assert.rejects(exportMap(doc, outDir, { quality: 'ultra' }), /quality/);
  doc.paint[0] = 250;
  await assert.rejects(exportMap(doc, outDir), /paint material id 250/);
});
