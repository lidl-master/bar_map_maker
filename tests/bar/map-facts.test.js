// Checklist facts read back from archives (src/bar/map-facts.js): our own export passes the whole G7 checklist, grass
// on open ground reaches the archive, and an installed reference map passes. Skipped without the texture library / BAR.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { TEMP_ROOT } from '../../src/archive/index.js';
import { exportMap, locateBar } from '../../src/bar/index.js';
import { checklist, docFacts } from '../../src/bar/checklist.js';
import { readMapFacts } from '../../src/bar/map-facts.js';
import { createMap } from '../../src/core/index.js';
import { TEXTURE_ROOT } from '../../src/look/library-load.js';
import { generate } from '../../src/terrain/index.js';

mkdirSync(TEMP_ROOT, { recursive: true });
const outDir = mkdtempSync(join(TEMP_ROOT, 'facts-test-'));
after(() => rmSync(outDir, { recursive: true, force: true }));
const noLibrary = !existsSync(join(TEXTURE_ROOT, 'manifest.json')) && 'texture library not built (npm run textures)';

let pyroclast = null;
try { pyroclast = join(locateBar().mapsDir, 'pyroclast_1.0.4.sd7'); } catch { /* no BAR install */ }
const noPyroclast = !(pyroclast && existsSync(pyroclast)) && 'Pyroclast is not installed';

const problems = (rows) => rows.filter((r) => r.status !== 'pass').map((r) => `${r.status} ${r.id}: ${r.detail}`);

test('a generated map exports with every checklist item passing, from the archive and from the doc', { skip: noLibrary, timeout: 120_000 }, async () => {
  const doc = createMap({ sx: 6, sz: 6, symmetry: 'mirrorX' });
  doc.settings.name = 'Facts Test Hills';
  generate(doc, 'hills', { players: 2, seed: 3 });
  const { archivePath } = await exportMap(doc, outDir, { quality: 'share' });
  const facts = await readMapFacts(archivePath);
  assert.deepEqual(problems(checklist(facts)), []);
  assert.equal(checklist(facts).length, 15);
  assert.deepEqual(problems(checklist({ ...facts, ...docFacts(doc) })), []);
  assert.equal(facts.metal.found, doc.objects.filter((o) => o.type === 'metal').length);
});

test('grass on open ground reaches the exported grass map of a grassless biome', { skip: noLibrary, timeout: 120_000 }, async () => {
  const doc = createMap({ sx: 4, sz: 4, biome: 'lunar' });
  doc.settings.name = 'Facts Test Moon';
  generate(doc, 'hills', { players: 2, seed: 4 });
  const without = await readMapFacts((await exportMap(doc, outDir, { quality: 'share' })).archivePath);
  assert.equal(without.grass, 0);
  doc.settings.openGrass = true;
  const withGrass = await readMapFacts((await exportMap(doc, outDir, { quality: 'share', replace: true })).archivePath);
  assert.ok(withGrass.grass > 0.3, `grass on ${withGrass.grass}`);
  assert.ok(Math.abs(withGrass.grass - docFacts(doc).grass) < 1e-9, 'the doc predicts the exported grass map');
});

test('Pyroclast, a reference map, passes every checklist item', { skip: noPyroclast, timeout: 120_000 }, async () => {
  const facts = await readMapFacts(pyroclast);
  assert.deepEqual(problems(checklist(facts)), []);
  assert.equal(facts.metal.found, 100);
  assert.equal(facts.starts.length, 16);
});
