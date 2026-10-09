// Closing the window right after an edit (before the autosave delay) still saves it: the main process asks the page
// to flush before it closes. A fresh userData, relaunched to read the result back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repoRoot = path.join(import.meta.dirname, '..');
const userData = path.join(repoRoot, '.engine-tmp', 'autosave', 'user-data');

/** Runs fn(page) in the app, which is closed afterwards (the window's close is what flushes the autosave). */
async function inApp(fn) {
  const app = await electron.launch({ args: [repoRoot, `--user-data-dir=${userData}`], timeout: 30_000 });
  try {
    const page = await app.firstWindow();
    await page.locator('body[data-ready="1"]').waitFor(); // booted: every handler is bound
    return await fn(page);
  } finally {
    await app.close();
  }
}

test('the last edit is saved when the window closes before the autosave delay', async () => {
  rmSync(path.dirname(userData), { recursive: true, force: true });
  await inApp(async (page) => {
    await page.click('#wNew');
    await page.click('#nmCreate');
    await page.waitForFunction(() => document.querySelector('#saveState .label').textContent === 'Saved', null, { timeout: 60_000 });
    await page.fill('#mapName', 'Flushed on close');
    assert.equal(await page.textContent('#saveState .label'), 'Unsaved changes');
  });
  const names = await inApp(async (page) => {
    await page.locator('#recentList .recent').first().waitFor();
    return page.locator('#recentList .recent .name').allTextContents();
  });
  assert.deepEqual(names, ['Flushed on close']);
});
