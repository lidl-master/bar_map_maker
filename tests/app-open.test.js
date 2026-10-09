// Opening an installed BAR map through the real app: the Open screen lists the BAR maps folder with thumbnails, a
// broken map shows the error panel, Pyroclast opens with its own texture in 2D and 3D, is stored from its first edit
// and can be removed from Recent. Skipped without BAR.
// Screenshots go to .engine-tmp/screenshots/wave3-*.png (gitignored); copy them to docs/gauntlet/screenshots by hand.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { locateBar } from '../src/bar/index.js';

const repoRoot = path.join(import.meta.dirname, '..');
const work = path.join(repoRoot, '.engine-tmp', 'open-screens');
const screenshots = path.join(repoRoot, '.engine-tmp', 'screenshots');
const MAP = 'pyroclast_1.0.4.sd7';
let mapsDir = null;
try { mapsDir = locateBar().mapsDir; } catch { /* no BAR install */ }
const skip = !(mapsDir && existsSync(path.join(mapsDir, MAP))) && `${MAP} is not installed`;

/** @type {import('playwright').ElectronApplication} */
let app;
/** @type {import('playwright').Page} */
let page;
const errors = [];

async function shot(name) {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  mkdirSync(screenshots, { recursive: true });
  writeFileSync(path.join(screenshots, `wave3-${name}.png`), Buffer.from(png, 'base64'));
}

before(async () => {
  if (skip) return;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, 'broken.sd7'), 'not an archive');
  app = await electron.launch({ args: [repoRoot, `--user-data-dir=${path.join(work, 'user-data')}`], timeout: 30_000 });
  // Browse… picks a broken file: the error panel must show what went wrong.
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.join(work, 'broken.sd7'));
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800));
  await page.locator('body[data-ready="1"]').waitFor(); // booted: every handler is bound (#welcome is static HTML)
});

after(async () => {
  if (skip) return;
  await app.close();
  assert.deepEqual(errors, []);
});

test('the Open screen lists the BAR maps with thumbnails and explains a broken file', { skip }, async () => {
  await page.click('#wOpen');
  await page.locator(`#oMaps [data-file="${MAP}"]`).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('#oMaps .thumb')].every((f) => f.classList.contains('ready') || f.classList.contains('failed')), null, { timeout: 120_000 });
  await page.waitForTimeout(400); // thumbnails fade in
  await page.mouse.move(5, 5);
  await shot('open-maps');

  await page.click('#oBrowse');
  await page.locator('#oError:not([hidden])').waitFor({ timeout: 30_000 });
  assert.match(await page.textContent('#oError'), /broken\.sd7/);
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await page.waitForTimeout(300); // the next frame is painted
  await shot('open-error');
  await page.click('#oError .btn');
});

test('Pyroclast opens with its own texture, objects and name', { skip }, async () => {
  const start = Date.now();
  await page.click(`#oMaps [data-file="${MAP}"]`);
  await page.locator('#editor').waitFor({ timeout: 60_000 });
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 60_000 });
  console.log(`${MAP}: ${((Date.now() - start) / 1000).toFixed(2)} s from click to editor`);
  assert.equal(await page.inputValue('#mapName'), 'Pyroclast');
  assert.match(await page.textContent('#stCounts'), /100/); // metal spots
  await page.waitForTimeout(500);
  await shot('pyroclast-2d');
  await page.click('#viewMode [data-view="3d"]');
  await page.waitForTimeout(1500);
  await shot('pyroclast-3d');
  await page.click('#viewMode [data-view="2d"]');
});

// The autosaved docs: [{archive, mips, tiles}] from each doc.original.
const storedDocs = () => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('bar-map-studio');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const docs = await new Promise((resolve) => { const r = db.transaction('docs').objectStore('docs').getAll(); r.onsuccess = () => resolve(r.result); });
  db.close();
  return docs.map(({ doc: { original } }) => ({ archive: original?.archive, mips: original?.tileMips.length, tiles: original?.tileIndex.length }));
});

test('an opened map is stored from its first edit, with doc.original (archive path, tile index, 4x4 mips), not the archive files', { skip }, async () => {
  assert.deepEqual(await storedDocs(), [], 'an untouched opened map is not stored');
  await page.fill('#mapName', 'Pyroclast edit');
  await page.waitForFunction(() => document.querySelector('#saveState .label').textContent === 'Saved');
  const [saved, ...more] = await storedDocs();
  assert.equal(more.length, 0);
  assert.match(saved.archive, /pyroclast_1\.0\.4\.sd7$/);
  assert.deepEqual([saved.tiles, saved.mips], [16 * 16 * 20 * 16, 81920 * 8]); // Pyroclast: 16 × 20 units, 81,920 SMT tiles
});

test('Recent removes a stored map only after the user confirms', { skip }, async () => {
  // Open Pyroclast again and leave it untouched: the edited copy is no longer the open map, so it can be removed.
  await page.click('#btnHome');
  await page.click('#wOpen');
  await page.click(`#oMaps [data-file="${MAP}"]`);
  await page.locator('body[data-screen="editor"]').waitFor({ timeout: 60_000 });
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 60_000 });
  await page.click('#btnHome');
  const rows = page.locator('#recentList .recent-row');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 1, 'only the edited map is stored');
  await rows.first().hover();
  await page.click('#recentList .remove');
  await page.click('#cfCancel');
  assert.equal((await storedDocs()).length, 1, 'cancel keeps it');
  await page.click('#recentList .remove');
  await page.click('#cfOk');
  await page.locator('#recentList .empty').waitFor();
  assert.deepEqual(await storedDocs(), []);
});
