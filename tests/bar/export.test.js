// Full export of a small synthetic map through the worker bake and 7-Zip, read back through readArchive.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { after, test } from 'node:test';
import { readArchive, TEMP_ROOT } from '../../src/archive/index.js';
import { exportMap } from '../../src/bar/index.js';
import { readSmf, readSmt, TILE_BYTES } from '../../src/formats/index.js';
import { testMap } from '../helpers/test-map.js';

mkdirSync(TEMP_ROOT, { recursive: true });
const outDir = mkdtempSync(join(TEMP_ROOT, 'export-test-'));
after(() => rmSync(outDir, { recursive: true, force: true }));

test('exports a 2x2 map whose archive holds a consistent SMF, SMT and mapinfo', async () => {
  const doc = testMap({ sx: 2, sz: 2, name: 'Export Test', version: '1.2' });
  const progress = [];
  const { archivePath, bytes } = await exportMap(doc, outDir, { onProgress: (f) => progress.push(f) });
  assert.equal(basename(archivePath), 'export_test_1.2.sd7');
  assert.ok(bytes > 0);
  assert.equal(progress.at(-1), 1);

  const files = await readArchive(archivePath);
  assert.deepEqual([...files.keys()].sort(), ['mapinfo.lua', 'maps/Export_Test.smf', 'maps/Export_Test.smt']);
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
  assert.match(new TextDecoder().decode(files.get('mapinfo.lua')), /smtFileName0 = "maps\/Export_Test\.smt"/);
});

test('a doc mistake fails before the texture bake starts', async () => {
  const doc = testMap({ sx: 2, sz: 2 });
  doc.settings.sunDir = [0, 1, 1];
  const progress = [];
  await assert.rejects(exportMap(doc, outDir, { onProgress: (f) => progress.push(f) }), /sunDir/);
  assert.deepEqual(progress, []);
});
