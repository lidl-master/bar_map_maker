// End to end through the real app: New Map → sculpt → place → undo/redo → export, for two templates.
// Exports stay in .engine-tmp/e2e/export (gitignored) for `node tools/engine/headless-check.js "<name> 1.0" <archive>`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { readArchive } from '../src/archive/index.js';
import { readMapInfo } from '../src/lua/index.js';

const repoRoot = path.join(import.meta.dirname, '..');
const work = path.join(repoRoot, '.engine-tmp', 'e2e');
const exportDir = path.join(work, 'export');
const screenshots = path.join(repoRoot, '.engine-tmp', 'screenshots'); // copied to docs/gauntlet/screenshots by hand

/** @type {import('playwright').ElectronApplication} */
let app;
/** @type {import('playwright').Page} */
let page;
const errors = [];

before(async () => {
  rmSync(work, { recursive: true, force: true });
  // A fresh userData: no remembered export folder, and the user's own settings are never touched.
  app = await electron.launch({ args: [repoRoot, `--user-data-dir=${path.join(work, 'user-data')}`], timeout: 30_000 });
  // The folder picker of the first export answers with exportDir and counts how often it was asked.
  await app.evaluate(({ dialog }, dir) => {
    globalThis.folderAsks = 0;
    dialog.showOpenDialog = async () => { globalThis.folderAsks++; return { canceled: false, filePaths: [dir] }; };
  }, exportDir);
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.locator('#welcome').waitFor(); // the app has booted on its welcome screen
});

after(async () => {
  await app.close();
  assert.deepEqual(errors, []);
});

const countOf = async (type) => Number((await page.textContent(`#stCounts [data-count=${type}]`)).replaceAll(',', ''));

async function newMap({ size, players, template, biome }) {
  if (!(await page.locator('#dlgNew[open]').count())) await page.click(await page.isVisible('#welcome') ? '#wNew' : '#btnNew');
  await page.fill('#nmWidth', String(size));
  await page.fill('#nmHeight', String(size));
  await page.fill('#nmPlayers', String(players));
  await page.click(`#nmBiome [data-value=${biome}]`);
  await page.locator('#nmTemplates .tpl-pick', { hasText: template }).click();
  await page.click('#nmCreate');
  await page.waitForFunction((meta) => document.getElementById('mapMeta').textContent.startsWith(meta), `${size} × ${size}`);
  await page.locator('#loading').waitFor({ state: 'hidden' });
  assert.equal(await countOf('start'), players);
  assert.equal(await page.isDisabled('#btnUndo'), true, 'a new map starts with an empty history');
}

async function rename(name) {
  await page.click('#tabs [data-tab=map]');
  const field = page.locator('#tab-map input[type=text]').first();
  // Map names are text, never markup.
  await field.fill('<b>x</b>');
  assert.equal(await page.inputValue('#mapName'), '<b>x</b>');
  assert.equal(await page.title(), '<b>x</b> — BAR Map Studio');
  await field.fill(name);
}

// One raise stroke, one metal spot, undo and redo of the spot.
async function edit() {
  const box = await page.locator('#canvas2d').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = Math.min(box.width, box.height) / 2 - 30;
  await page.click('#toolbar [data-tool=raise]');
  await page.mouse.move(cx - r * 0.5, cy - r * 0.3);
  await page.mouse.down();
  await page.mouse.move(cx - r * 0.2, cy - r * 0.3, { steps: 12 });
  await page.mouse.up();
  assert.equal(await page.isDisabled('#btnUndo'), false, 'the stroke is undoable');

  await page.click('#toolbar [data-tool=metal]');
  const metal = await countOf('metal');
  // A click next to an existing spot selects it instead; try a few places.
  for (const [fx, fz] of [[0.1, 0.55], [-0.45, 0.6], [0.55, -0.1], [0.3, 0.3]]) {
    await page.mouse.click(cx + r * fx, cy + r * fz);
    if (await countOf('metal') > metal) break;
  }
  const placed = await countOf('metal');
  assert.ok(placed > metal, 'a metal spot (and its mirrored copies) was placed');
  await page.click('#btnUndo');
  assert.equal(await countOf('metal'), metal);
  assert.equal(await page.isDisabled('#btnRedo'), false);
  await page.click('#btnRedo');
  assert.equal(await countOf('metal'), placed);
  assert.equal(await page.isDisabled('#btnRedo'), true);
}

async function exportMap(fileName) {
  await page.click('#btnExport');
  await page.waitForFunction(() => document.getElementById('exportPanel').dataset.state !== 'running', null, { timeout: 180_000 });
  assert.equal(await page.getAttribute('#exportPanel', 'data-state'), 'done', await page.textContent('#exportPanel'));
  const archive = path.join(exportDir, fileName);
  assert.ok(existsSync(archive), `${archive} was written`);
  return archive;
}

async function screenshot(name) {
  await page.waitForFunction(() => {
    const canvas = document.getElementById('canvas2d');
    const [r, g, b] = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    return r + g + b > 3 * 0x12; // the map image is drawn, not just the background
  });
  await page.screenshot({ path: path.join(screenshots, `wave1-${name}-2d.png`) });
  await page.click('#viewMode [data-view="3d"]');
  await page.waitForTimeout(1000); // the 3D view renders on the next animation frames
  await page.screenshot({ path: path.join(screenshots, `wave1-${name}-3d.png`) });
  await page.click('#viewMode [data-view="2d"]');
}

test('Rolling hills 12×12, 4 players: edit, export, install confirm (cancelled)', async () => {
  await newMap({ size: 12, players: 4, template: 'Rolling hills', biome: 'temperate' });
  await rename('Studio E2E Hills');
  await edit();
  const archive = await exportMap('studio_e2e_hills_1.0.sd7');
  assert.equal(await app.evaluate(() => globalThis.folderAsks), 1, 'the first export asks for the folder');
  await screenshot('hills');

  // Install shows what it would replace; the test always answers Cancel, so the BAR folder is never written.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (_window, options) => { globalThis.installPrompt = options; return { response: 1 }; };
  });
  await page.click('#btnInstall');
  await page.waitForFunction(() => document.getElementById('toasts').textContent.includes('Install cancelled'), null, { timeout: 180_000 });
  const prompt = await app.evaluate(() => globalThis.installPrompt);
  assert.match(prompt.message, new RegExp(path.basename(archive).replaceAll('.', '\\.')));
  assert.match(prompt.detail, /BAR maps folder:\n.+maps\n\nNo existing file is replaced\./);
});

test('Volcano – King of the Hill 16×16, 8 players: symmetry locked, edit, export with lava and 8 starts', async () => {
  await page.click('#btnNew');
  await page.locator('#nmTemplates .tpl-pick', { hasText: 'Volcano' }).click();
  assert.equal(await page.getAttribute('#nmSymmetry input:checked', 'value'), 'mirrorX');
  assert.equal(await page.isDisabled('#nmSymmetry input[value=rot180]'), true, 'the template locks its symmetry');
  await newMap({ size: 16, players: 8, template: 'Volcano', biome: 'volcanic' });
  await rename('Studio E2E Volcano');
  await edit();
  const archive = await exportMap('studio_e2e_volcano_1.0.sd7');
  assert.equal(await app.evaluate(() => globalThis.folderAsks), 1, 'later exports reuse the remembered folder');
  await screenshot('volcano');

  const info = await readMapInfo(await readArchive(archive));
  assert.equal(info.name, 'Studio E2E Volcano');
  assert.equal(info.teams.length, 8);
  assert.equal(info.lava?.level, 60);
});
