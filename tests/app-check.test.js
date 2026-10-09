// Check map through the real app and BAR's real engine: a map with checklist failures opens, Check map exports it and
// loads it in BAR, the Fix buttons repair it (undoable doc edits), and Check again passes everything. Heavy (two
// engine runs, ~3 minutes, ~6 GB RAM each): runs only with BAR_ENGINE_TESTS=1 and BAR installed.
// Screenshots go to .engine-tmp/screenshots/wave4-check-{fail,pass}.png (copied to docs/gauntlet/screenshots by hand).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { exportMap, locateBar } from '../src/bar/index.js';
import { createMap } from '../src/core/index.js';
import { TEXTURE_ROOT } from '../src/look/library-load.js';
import { generate } from '../src/terrain/index.js';

const repoRoot = path.join(import.meta.dirname, '..');
const work = path.join(repoRoot, '.engine-tmp', 'app-check');
const screenshots = path.join(repoRoot, '.engine-tmp', 'screenshots');
let bar = null;
try { bar = locateBar(); } catch { /* no BAR install */ }
const skip = (process.env.BAR_ENGINE_TESTS !== '1' && 'set BAR_ENGINE_TESTS=1 to run BAR\'s engine')
  || (!bar?.headlessEngine && 'BAR is not installed')
  || (!existsSync(path.join(TEXTURE_ROOT, 'manifest.json')) && 'texture library not built');

/** @type {import('playwright').ElectronApplication} */
let app;
/** @type {import('playwright').Page} */
let page;
const errors = [];

// An 8x8 lunar map with wind up to 40, tidal 30, the sun 80° high and a geo vent on a slope.
async function brokenArchive() {
  const doc = createMap({ sx: 8, sz: 8, biome: 'lunar' });
  Object.assign(doc.settings, { name: 'Studio Check Probe', version: '1.0', minWind: 2, maxWind: 40, tidalStrength: 30, sunDir: [0.1, 0.98, -0.15] });
  generate(doc, 'hills', { players: 2, seed: 8 });
  const geo = doc.objects.find((o) => o.type === 'geo');
  const ci = Math.round(geo.x / 8), cj = Math.round(geo.z / 8);
  for (let j = cj - 12; j <= cj + 12; j++) for (let i = ci - 12; i <= ci + 12; i++) doc.heights[j * doc.W + i] += (i - ci) * 4;
  const dir = path.join(work, 'source');
  mkdirSync(dir, { recursive: true });
  return (await exportMap(doc, dir, { quality: 'share' })).archivePath;
}

async function shot(name) {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  mkdirSync(screenshots, { recursive: true });
  writeFileSync(path.join(screenshots, `wave4-check-${name}.png`), Buffer.from(png, 'base64'));
}

const rows = () => page.$$eval('.ck-row', (items) => items.map((li) => ({ status: li.dataset.status, label: li.querySelector('strong').textContent, fix: li.querySelector('.btn')?.textContent ?? null })));

before(async () => {
  if (skip) return;
  rmSync(work, { recursive: true, force: true });
  const archive = await brokenArchive();
  const userData = path.join(work, 'user-data');
  mkdirSync(userData, { recursive: true });
  writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ exportDir: path.join(work, 'export') }));
  app = await electron.launch({ args: [repoRoot, `--user-data-dir=${userData}`], timeout: 30_000 });
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, archive);
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800));
  await page.locator('body[data-ready="1"]').waitFor();
});

after(async () => {
  if (skip) return;
  await app.close();
  rmSync(work, { recursive: true, force: true });
  assert.deepEqual(errors, []);
});

test('Check map finds the failures, the fixes repair them, and Check again passes in BAR', { skip, timeout: 900_000 }, async () => {
  await page.click('#wOpen');
  await page.click('#oBrowse');
  await page.waitForFunction(() => document.getElementById('mapMeta').textContent.startsWith('8 × 8'), null, { timeout: 60_000 });
  await page.locator('#loading').waitFor({ state: 'hidden' });

  await page.click('#btnCheck');
  await page.locator('.ck-rows').waitFor({ timeout: 120_000 });
  await page.locator('.ck-engine:not([data-state=running])').waitFor({ timeout: 400_000 });
  assert.equal(await page.getAttribute('.ck-engine', 'data-state'), 'pass', await page.textContent('.ck-engine'));
  const found = await rows();
  const problems = Object.fromEntries(found.filter((r) => r.status !== 'pass').map((r) => [r.label, [r.status, r.fix]]));
  assert.deepEqual(problems, {
    'Wind between 0 and 30': ['fail', 'Clamp wind to 0–30'],
    'Tidal between 0 and 25': ['fail', 'Clamp tidal to 0–25'],
    'Geos fit a T2 geothermal': ['fail', 'Flatten geo pads'],
    'Sun in the north, not too low or high': ['warn', 'Set the sun 40° high'],
    'Grass map used': ['warn', 'Grow grass on open ground'],
  });
  await page.mouse.move(5, 5);
  await shot('fail');

  for (let n = 0; await page.locator('.ck-row .btn').count(); n++) {
    assert.ok(n < 10, 'every fix removes its own button');
    await page.locator('.ck-row .btn').first().click();
  }
  assert.deepEqual((await rows()).filter((r) => r.status !== 'pass'), []);
  assert.equal(await page.isDisabled('#btnUndo'), false, 'fixes are undoable');

  await page.click('#ckAgain');
  await page.locator('.ck-engine[data-state=running]').waitFor({ timeout: 120_000 });
  await page.locator('.ck-engine:not([data-state=running])').waitFor({ timeout: 400_000 });
  assert.equal(await page.getAttribute('.ck-engine', 'data-state'), 'pass', await page.textContent('.ck-engine'));
  assert.deepEqual((await rows()).filter((r) => r.status !== 'pass'), []);
  assert.equal((await rows()).length, 15);
  await page.mouse.move(5, 5);
  await shot('pass');
  await page.click('#dlgCheck [data-close]');
});
