// The UI's screens through the real app, at 1280×800 and 1920×1080 (plus 1280×800 at 125 % scaling): welcome, New Map,
// editor 2D / Split / Pathing, Look tab, export progress, shortcuts overlay. Screenshots go to .engine-tmp/screenshots
// (gitignored) as wave2-ui-<screen>-<size>.png; copy them to docs/gauntlet/screenshots by hand.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repoRoot = path.join(import.meta.dirname, '..');
const work = path.join(repoRoot, '.engine-tmp', 'screens');
const screenshots = path.join(repoRoot, '.engine-tmp', 'screenshots');

/** @type {import('playwright').ElectronApplication} */
let app;
/** @type {import('playwright').Page} */
let page;
const errors = [];

before(async () => {
  rmSync(work, { recursive: true, force: true });
  app = await electron.launch({ args: [repoRoot, `--user-data-dir=${path.join(work, 'user-data')}`], timeout: 30_000 });
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, path.join(work, 'export'));
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.locator('#welcome').waitFor();
});

after(async () => {
  await app.close();
  assert.deepEqual(errors, []);
});

async function setSize(width, height, zoom = 1) {
  await app.evaluate(({ BrowserWindow }, [w, h, z]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(w, h);
    win.webContents.setZoomFactor(z);
  }, [width, height, zoom]);
  await page.waitForTimeout(400); // layout and canvases follow the resize
}

// The window's real pixels (capturePage), so 125 % scaling comes out at 1280×800 like the screen shows it.
async function shot(name, size) {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  mkdirSync(screenshots, { recursive: true });
  writeFileSync(path.join(screenshots, `wave2-ui-${name}-${size}.png`), Buffer.from(png, 'base64'));
}
async function thumbsReady(container) {
  await page.waitForFunction((id) => {
    const frames = document.querySelectorAll(`#${id} .thumb`);
    return frames.length && [...frames].every((f) => f.classList.contains('ready'));
  }, container, { timeout: 30_000 });
  await page.waitForTimeout(400); // the previews fade in
}

async function screens(size, { exportToo = true } = {}) {
  await page.evaluate(() => document.getElementById('btnHome')?.click());
  await page.locator('#welcome').waitFor();
  await thumbsReady('wTemplates');
  await page.mouse.move(5, 5);
  await shot('welcome', size);

  await page.click('#wTemplates [data-template=hills]');
  await page.locator('#dlgNew[open]').waitFor();
  await page.fill('#nmPlayers', '4');
  await page.locator('#nmPlayers').dispatchEvent('change');
  await page.waitForTimeout(1500); // previews for 4 players replace the 2-player ones
  await thumbsReady('nmTemplates');
  await shot('newmap', size);
  await page.click('#nmCreate');
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 60_000 });
  await page.locator('#editor').waitFor();

  await page.click('#toolbar [data-tool=raise]');
  const box = await page.locator('#canvas2d').boundingBox();
  await page.mouse.move(box.x + box.width * 0.36, box.y + box.height * 0.42);
  await page.waitForTimeout(300);
  await shot('editor-2d', size);

  await page.click('#displayMode [data-mode=pathing]');
  await page.waitForTimeout(500);
  await shot('editor-pathing', size);
  await page.click('#displayMode [data-mode=look]');

  await page.click('#viewMode [data-view=split]');
  await page.waitForTimeout(1200);
  await shot('editor-split', size);
  await page.click('#viewMode [data-view="2d"]');

  for (const tab of ['look', 'generate', 'map']) {
    await page.click(`#tabs [data-tab=${tab}]`);
    await page.waitForTimeout(300);
    await shot(tab, size);
  }
  await page.click('#tabs [data-tab=tool]');
  // Keyboard focus is always visible: Tab from the tool rail onto the next control.
  await page.focus('#toolbar [data-tool=smooth]');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600); // the focused control's tooltip
  await shot('focus', size);

  if (exportToo) {
    await page.click('#btnExport');
    await page.waitForFunction(() => document.querySelectorAll('#exportPanel .ep-steps li').length >= 2, null, { timeout: 60_000 });
    await page.waitForTimeout(250);
    await shot('export-progress', size);
    await page.waitForFunction(() => document.getElementById('exportPanel').dataset.state !== 'running', null, { timeout: 180_000 });
    assert.equal(await page.getAttribute('#exportPanel', 'data-state'), 'done', await page.textContent('#exportPanel'));
    await shot('export-done', size);
    await page.click('#exportPanel .ep-actions .btn.ghost'); // Close
  }

  await page.keyboard.press('?');
  await page.locator('#dlgShortcuts[open]').waitFor();
  await page.waitForTimeout(300); // the dialog fades in
  await shot('shortcuts', size);
  await page.keyboard.press('Escape');
}

test('screens at 1280×800', async () => {
  await setSize(1280, 800);
  await screens('1280');
});

test('screens at 1920×1080', async () => {
  await setSize(1920, 1080);
  await screens('1920');
});

test('screens at 1280×800, 125 % scaling', async () => {
  await setSize(1280, 800, 1.25);
  await screens('1280-125', { exportToo: false });
  await setSize(1280, 800);
});
