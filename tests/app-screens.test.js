// The UI's screens through the real app, at 1280×800 and 1920×1080 (plus 1280×800 at 125 % scaling): welcome, New Map,
// editor 2D / Split / Pathing, inspector tabs, export progress / done / error, generating, a selected metal spot,
// keyboard focus, shortcuts. Screenshots go to .engine-tmp/screenshots (gitignored) as wave2-ui-<screen>-<size>.png;
// copy them to docs/gauntlet/screenshots by hand.
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
const capture = (rect) => app.evaluate(async ({ BrowserWindow }, r) => {
  const contents = BrowserWindow.getAllWindows()[0].webContents;
  return (await (r ? contents.capturePage(r) : contents.capturePage())).toPNG().toString('base64');
}, rect);
const save = (name, size, base64) => {
  mkdirSync(screenshots, { recursive: true });
  writeFileSync(path.join(screenshots, `wave2-ui-${name}-${size}.png`), Buffer.from(base64, 'base64'));
};
const shot = async (name, size) => save(name, size, await capture());

async function thumbsReady(container) {
  await page.waitForFunction((id) => {
    const frames = document.querySelectorAll(`#${id} .thumb`);
    return frames.length && [...frames].every((f) => f.classList.contains('ready'));
  }, container, { timeout: 30_000 });
  await page.waitForTimeout(400); // the previews fade in
}

const metalCount = async () => Number((await page.textContent('#stCounts [data-count=metal] b')).replaceAll(',', ''));

// Places a metal spot on open ground (a click next to an existing spot selects that one instead) and selects it.
async function placeMetal() {
  await page.click('#toolbar [data-tool=metal]');
  const box = await page.locator('#canvas2d').boundingBox(), before = await metalCount();
  for (const [fx, fz] of [[0.42, 0.62], [0.58, 0.38], [0.3, 0.45], [0.66, 0.6], [0.5, 0.3]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fz);
    if (await metalCount() > before) return [box.x + box.width * fx, box.y + box.height * fz];
  }
  throw new Error('no free ground for a metal spot');
}

// Keyboard focus on four kinds of control, each reached with Tab (so :focus-visible applies), cropped and tiled 2×2.
async function focusControls(size) {
  await page.click('#toolbar [data-tool=raise]'); // a brush: presets, falloff and sliders in the Tool tab
  const targets = [
    ['Tab', async () => { await page.focus('#tabs [data-tab=tool]'); await page.keyboard.press('Tab'); }],
    ['Slider', async () => { await page.focus('#tab-tool .chips .chip:last-child'); await page.keyboard.press('Tab'); }],
    ['Segmented control', async () => { await page.focus('#btnOverlays'); await page.keyboard.press('Tab'); }],
    ['Swatch', async () => {
      await page.click('#tabs [data-tab=look]');
      await page.locator('#tab-look .material-picker').scrollIntoViewIfNeeded();
      await page.focus('#tab-look .section .btn.accent-icon'); // Scatter features, the control before the materials
      await page.keyboard.press('Tab');
    }],
  ];
  const tiles = [];
  for (const [label, focus] of targets) {
    await page.click('#tabs [data-tab=tool]');
    await focus();
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const b = document.activeElement.closest('.choice') ?? document.activeElement, rect = b.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const w = 360, h = 112, x = Math.round(Math.max(0, Math.min(1280 - w, r.x + r.width / 2 - w / 2))), y = Math.round(Math.max(0, Math.min(800 - h, r.y + r.height / 2 - h / 2)));
    tiles.push({ label, png: await capture({ x, y, width: w, height: h }) });
    await page.keyboard.press('Escape'); // closes a tooltip
  }
  const composite = await page.evaluate(async (list) => {
    const pad = 16, w = 360, h = 112, label = 24, canvas = new OffscreenCanvas(pad + 2 * (w + pad), pad + 2 * (h + label + pad));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '600 12px Inter, sans-serif';
    for (const [n, tile] of list.entries()) {
      // Decoded from bytes: the page's CSP rightly refuses to fetch data: URLs.
      const img = await createImageBitmap(new Blob([Uint8Array.from(atob(tile.png), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      const x = pad + (n % 2) * (w + pad), y = pad + Math.floor(n / 2) * (h + label + pad);
      ctx.fillStyle = '#adb3bf';
      ctx.fillText(`${tile.label}: keyboard focus`, x, y + 14);
      ctx.drawImage(img, x, y + label, w, h);
      ctx.strokeStyle = '#262a33';
      ctx.strokeRect(x - 0.5, y + label - 0.5, w + 1, h + 1);
    }
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }, tiles);
  save('focus-controls', size, composite);
}

async function screens(size, { full = true } = {}) {
  await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((t) => t.remove())); // left over from the last size
  await page.evaluate(() => document.getElementById('btnHome')?.click());
  await page.locator('#welcome').waitFor();
  await thumbsReady('wTemplates');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300); // hover states settle
  await shot('welcome', size);

  await page.click('#wTemplates [data-template=hills]');
  await page.locator('#dlgNew[open]').waitFor();
  await page.fill('#nmPlayers', '4');
  await page.locator('#nmPlayers').dispatchEvent('change');
  await page.locator('#nmCreate').focus(); // the players field keeps no focus ring in the shot
  await page.waitForTimeout(1500); // previews for 4 players replace the 2-player ones
  await thumbsReady('nmTemplates');
  await page.mouse.move(5, 5);
  await page.evaluate(() => document.activeElement.blur());
  await shot('newmap', size);
  await page.click('#nmCreate');
  await page.locator('#loading').waitFor();
  await page.waitForTimeout(150); // fades in
  await shot('loading', size);
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 60_000 });
  await page.locator('#editor').waitFor();

  await page.click('#toolbar [data-tool=raise]');
  await page.click('#toolbar [data-tool=smooth]'); // a tool change shows the tool chip for a few seconds
  await page.click('#toolbar [data-tool=raise]');
  const box = await page.locator('#canvas2d').boundingBox();
  await page.mouse.move(box.x + box.width * 0.36, box.y + box.height * 0.42);
  await page.waitForTimeout(300);
  await shot('editor-2d', size);
  await page.click('#btnOverlays');
  await page.locator('#overlayMenu:popover-open').waitFor();
  await page.waitForTimeout(200);
  await shot('overlays', size);
  await page.keyboard.press('Escape');

  await page.click('#displayMode [data-mode=pathing]');
  await page.waitForTimeout(800);
  await shot('editor-pathing', size);
  await page.click('#displayMode [data-mode=look]');

  await page.click('#viewMode [data-view=split]');
  await page.waitForTimeout(1500);
  await page.mouse.move(box.x + box.width * 0.5, box.y + 4); // over the splitter's neighbourhood, no tooltip
  await shot('editor-split', size);
  await page.click('#viewMode [data-view="2d"]');

  for (const tab of ['look', 'generate', 'map']) {
    await page.click(`#tabs [data-tab=${tab}]`);
    await page.waitForTimeout(300);
    await shot(tab, size);
  }
  await page.click('#tabs [data-tab=look]');
  await page.locator('#tab-look .material-picker').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot('look-materials', size);
  await page.click('#tabs [data-tab=tool]');
  // Keyboard focus is always visible: Tab from the tool rail onto the next control.
  await page.focus('#toolbar [data-tool=smooth]');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600); // the focused control's tooltip
  await shot('focus', size);

  if (full) {
    await page.click('#btnExport');
    await page.waitForFunction(() => document.querySelectorAll('#exportPanel .ep-steps li.done').length >= 2, null, { timeout: 60_000 });
    await page.waitForTimeout(250);
    await shot('export-progress', size);
    await page.waitForFunction(() => document.getElementById('exportPanel').dataset.state !== 'running', null, { timeout: 180_000 });
    assert.equal(await page.getAttribute('#exportPanel', 'data-state'), 'done', await page.textContent('#exportPanel'));
    await page.mouse.move(5, 300);
    await page.waitForTimeout(300);
    await shot('export-done', size);
    await page.keyboard.press('Escape'); // dismisses the finished card
    assert.equal(await page.isHidden('#exportPanel'), true);
  }

  if (size === '1280') {
    // A failed export: a name with nothing to make a file name from.
    const name = await page.inputValue('#mapName');
    await page.fill('#mapName', '***');
    await page.click('#btnExport');
    await page.waitForFunction(() => document.getElementById('exportPanel').dataset.state === 'error', null, { timeout: 60_000 });
    errors.splice(errors.findIndex((e) => e.includes('no letters or digits')), 1); // logged on purpose by the failed export
    await page.mouse.move(5, 300);
    await page.waitForTimeout(400); // the card rises in
    await shot('export-error', size);
    await page.keyboard.press('Escape');
    await page.fill('#mapName', name);

    // A selected metal spot: its value on the map, position and value in the inspector.
    const [mx, my] = await placeMetal();
    await page.click('#toolbar [data-tool=select]');
    await page.mouse.move(mx + 60, my + 40);
    await page.waitForTimeout(300);
    await shot('selected-metal', size);
    await page.click('#btnUndo');

    await focusControls(size);

    // Regenerating terrain covers the map views until the worker is done.
    await page.click('#tabs [data-tab=generate]');
    await page.locator('#tab-generate .btn', { hasText: 'Generate terrain' }).click();
    await page.locator('#loading').waitFor();
    await page.waitForTimeout(150);
    await shot('generating', size);
    await page.locator('#loading').waitFor({ state: 'hidden', timeout: 60_000 });
    await page.click('#btnUndo');
  }

  await page.click('#tabs [data-tab=generate]');
  await page.click('#tab-generate .btn.danger');
  await page.locator('#dlgConfirm[open]').waitFor();
  await page.waitForTimeout(300);
  await shot('confirm', size);
  await page.click('#cfCancel');
  await page.click('#btnExportOptions');
  await page.locator('#exportOptions:popover-open').waitFor();
  await page.waitForTimeout(200);
  await shot('export-options', size);
  await page.click('#btnExportDir');
  await page.locator('#toasts .toast').first().waitFor();
  await page.waitForTimeout(300);
  await shot('toast', size);
  await page.click('#tabs [data-tab=tool]');

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
  await screens('1280-125', { full: false });
  await setSize(1280, 800);
});
