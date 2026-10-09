import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repoRoot = path.join(import.meta.dirname, '..');
// Gitignored temp folder, like the wave 0 smoke screenshot.
const screenshotPath = path.join(repoRoot, '.engine-tmp', 'screenshots', 'wave1-editor.png');

test('New Map (8×8, 2 players, Volcano template) generates in the worker and renders', async () => {
  const app = await electron.launch({ args: [repoRoot], timeout: 30_000 });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

    await page.locator('#dlgNew[open]').waitFor();
    await page.fill('#nmWidth', '8');
    await page.fill('#nmHeight', '8');
    await page.fill('#nmPlayers', '2');
    await page.locator('#nmTemplates .tpl', { hasText: 'Volcano' }).click();
    await page.click('#nmCreate');
    await page.locator('#busy').waitFor({ state: 'hidden' });

    assert.match(await page.textContent('#mapTitle'), /8×8/);
    assert.match(await page.textContent('#stCounts'), /Starts 2 /);
    // The map image is drawn: the centre of the 2D view is no longer the empty background colour.
    await page.waitForFunction(() => {
      const canvas = document.getElementById('canvas2d');
      const [r, g, b] = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return r + g + b > 3 * 0x12;
    });
    await page.screenshot({ path: screenshotPath });
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});
