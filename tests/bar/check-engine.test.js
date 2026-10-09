// Check map end to end in BAR's real headless engine (src/bar/check.js): a fresh export, never installed, loads
// cleanly and BAR's own spot finder sees every metal spot. Heavy (70-150 s, ~6 GB RAM), so it runs only with
// BAR_ENGINE_TESTS=1 and BAR installed; the verdict rules themselves are covered by engine-check.test.js.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { TEMP_ROOT } from '../../src/archive/index.js';
import { checkMap } from '../../src/bar/check.js';
import { exportMap, locateBar } from '../../src/bar/index.js';
import { createMap } from '../../src/core/index.js';
import { generate } from '../../src/terrain/index.js';

let bar = null;
try { bar = locateBar(); } catch { /* no BAR install */ }
const skip = (process.env.BAR_ENGINE_TESTS !== '1' && 'set BAR_ENGINE_TESTS=1 to run BAR\'s engine') || (!bar?.headlessEngine && 'BAR is not installed');

mkdirSync(TEMP_ROOT, { recursive: true });
const outDir = mkdtempSync(join(TEMP_ROOT, 'check-test-'));
after(() => rmSync(outDir, { recursive: true, force: true }));

test('a fresh export loads cleanly in BAR\'s headless engine without being installed', { skip, timeout: 400_000 }, async () => {
  const doc = createMap({ sx: 8, sz: 8, symmetry: 'mirrorX' });
  doc.settings.name = `Studio Check Test ${process.pid}`; // a name no installed map has
  generate(doc, 'hills', { players: 2, seed: 12 });
  const { archivePath } = await exportMap(doc, outDir, { quality: 'share' });
  const progress = [];
  const result = await checkMap(archivePath, { workDir: join(outDir, 'work'), onProgress: (fraction, label) => progress.push([fraction, label]) });
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.ok(result.frames >= 900);
  assert.equal(result.metalSpots, doc.objects.filter((o) => o.type === 'metal').length);
  assert.equal(result.starts, 2);
  assert.ok(progress.some(([, label]) => /Simulating/.test(label)));
  assert.deepEqual(readdirSync(join(outDir, 'work', 'check')), [], 'the run dir is removed');
  assert.ok(!existsSync(join(bar.mapsDir, archivePath.split(/[\\/]/).pop())), 'not installed');
});
