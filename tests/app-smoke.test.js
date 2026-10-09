import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repoRoot = path.join(import.meta.dirname, '..');
const screenshotPath = path.join(repoRoot, 'docs', 'gauntlet', 'screenshots', 'wave0-app.png');

/** @type {import('playwright').ElectronApplication} */
let app;
/** @type {import('playwright').Page} */
let page;

before(async () => {
  app = await electron.launch({ args: [repoRoot], timeout: 30_000 });
  page = await app.firstWindow();
  await page.waitForLoadState();
});

after(async () => {
  const electronProcess = app.process(); // not reachable once the app is closed
  await app.close();
  assert.equal(electronProcess.exitCode, 0, 'Electron should exit with code 0');
});

test('opens the app shell in a window titled "BAR Map Studio"', async () => {
  const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
  assert.equal(title, 'BAR Map Studio');
  await page.screenshot({ path: screenshotPath });
});

test('renderer is isolated and sandboxed', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const { contextIsolation, nodeIntegration, sandbox } = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { contextIsolation, nodeIntegration, sandbox };
  });
  assert.deepEqual(prefs, { contextIsolation: true, nodeIntegration: false, sandbox: true });
});

test('CSP blocks inline scripts', async () => {
  const ran = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.inlineScriptRan = true';
    document.head.append(script);
    return window.inlineScriptRan === true;
  });
  assert.equal(ran, false);
});

test('navigation and new windows are blocked', async () => {
  const startUrl = page.url();
  // shortcut: a blocked navigation has no event to await, so give an unblocked one 2 s to show up; revisit if this ever flakes.
  const navigated = page.waitForEvent('framenavigated', { timeout: 2000 }).then(() => true, () => false);
  await page.evaluate(() => location.assign('https://example.com/'));
  assert.equal(await navigated, false);
  assert.equal(page.url(), startUrl);

  assert.equal(await page.evaluate(() => window.open('https://example.com/') === null), true);
  assert.equal(app.windows().length, 1);
});
