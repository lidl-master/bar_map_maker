// Map size through the real app: extend (with the symmetry confirm), undo / redo across the doc swap, crop naming the
// objects it removes, resize. Screenshots go to .engine-tmp/screenshots (gitignored) as wave3-reshape-<step>.png;
// copy them to docs/gauntlet/screenshots by hand.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repoRoot = path.join(import.meta.dirname, '..');
const work = path.join(repoRoot, '.engine-tmp', 'reshape');
const screenshots = path.join(repoRoot, '.engine-tmp', 'screenshots');

/** @type {import('playwright').ElectronApplication} */
let app;
/** @type {import('playwright').Page} */
let page;
const errors = [];

before(async () => {
  rmSync(work, { recursive: true, force: true });
  app = await electron.launch({ args: [repoRoot, `--user-data-dir=${path.join(work, 'user-data')}`], timeout: 30_000 });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.locator('#welcome').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800));
});

after(async () => {
  await app.close();
  assert.deepEqual(errors, []);
});

async function shot(name) {
  await page.waitForTimeout(300); // dialogs fade in
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  mkdirSync(screenshots, { recursive: true });
  writeFileSync(path.join(screenshots, `wave3-reshape-${name}.png`), Buffer.from(png, 'base64'));
}

const meta = () => page.textContent('#mapMeta');
async function step(side, times, verb = 'Add') {
  for (let i = 0; i < times; i++) await page.click(`#rsBody button[aria-label="${verb} one unit ${side}"]`);
}

async function openSizeDialog() {
  await page.click('#tabs [data-tab=map]');
  await page.locator('#tab-map .btn', { hasText: 'Extend, crop or resize' }).click();
  await page.locator('#dlgReshape[open]').waitFor();
}

test('extend, undo, redo, crop and resize a 12×12 map', async () => {
  await page.click('#wNew');
  await page.locator('#nmTemplates .tpl-pick', { hasText: 'Rolling hills' }).click();
  await page.click('#nmCreate');
  await page.waitForFunction(() => document.getElementById('mapMeta').textContent.startsWith('12 × 12'));
  await page.locator('#loading').waitFor({ state: 'hidden' });
  const starts = await page.textContent('#stCounts [data-count=start]');

  await openSizeDialog();
  assert.equal(await page.isDisabled('#rsApply'), true, 'nothing to apply yet');
  await step('east', 4);
  assert.equal(await page.textContent('#rsSummary'), '12 × 12 → 16 × 12 · adds 4 units east');
  await step('west', 1);
  assert.match(await page.textContent('#rsSummary'), /even number/);
  assert.equal(await page.isDisabled('#rsApply'), true, 'an odd width cannot be applied');
  await step('west', 1, 'Crop');
  await page.mouse.move(5, 5);
  await shot('extend');
  await page.click('#rsApply');
  // The template's rotate-180° symmetry does not survive a one-sided extension: the confirm says so.
  await page.locator('#dlgConfirm[open]').waitFor();
  assert.match(await page.textContent('#cfText'), /symmetry no longer fits/);
  await page.click('#cfOk');
  await page.waitForFunction(() => document.getElementById('mapMeta').textContent.startsWith('16 × 12'));
  assert.equal(await page.textContent('#stCounts [data-count=start]'), starts);
  assert.equal(await page.getAttribute('#btnUndo', 'data-tip'), 'Undo extend map');
  await page.locator('#toasts .toast.ok').first().waitFor();
  await shot('extended');

  await page.click('#btnUndo');
  assert.match(await meta(), /^12 × 12/);
  await page.click('#btnRedo');
  assert.match(await meta(), /^16 × 12/);
  await page.click('#btnUndo');
  assert.match(await meta(), /^12 × 12/);

  // Cropping 6 units off the west side removes a start position, and the confirm names it.
  await openSizeDialog();
  await step('west', 6, 'Crop');
  await shot('crop');
  await page.click('#rsApply');
  await page.locator('#dlgConfirm[open]').waitFor();
  assert.match(await page.textContent('#cfText'), /start position/);
  await shot('crop-confirm');
  await page.click('#cfOk');
  await page.waitForFunction(() => document.getElementById('mapMeta').textContent.startsWith('6 × 12'));
  assert.notEqual(await page.textContent('#stCounts [data-count=start]'), starts);
  await page.click('#btnUndo');
  assert.match(await meta(), /^12 × 12/);
  assert.equal(await page.textContent('#stCounts [data-count=start]'), starts);

  await openSizeDialog();
  await page.click('#rsBody .seg [data-value=resize]');
  await page.fill('#rsBody .nm-size input >> nth=0', '20');
  await page.locator('#rsBody .nm-size input >> nth=0').dispatchEvent('change');
  await page.fill('#rsBody .nm-size input >> nth=1', '20');
  await page.locator('#rsBody .nm-size input >> nth=1').dispatchEvent('change');
  assert.equal(await page.textContent('#rsSummary'), '12 × 12 → 20 × 20 · stretches the map');
  await shot('resize');
  await page.click('#rsApply'); // square to square keeps the symmetry, nothing is lost: no confirm
  await page.waitForFunction(() => document.getElementById('mapMeta').textContent.startsWith('20 × 20'));
  assert.equal(await page.getAttribute('#btnUndo', 'data-tip'), 'Undo resize map');
});
