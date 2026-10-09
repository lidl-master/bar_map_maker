// Cold start: process launch → body[data-ready="1"], each run with a fresh userData (median of --runs, default 5).
// `node tools/package/cold-start.js [--exe "dist/BAR Map Studio-win32-x64/BAR Map Studio.exe"] [--runs 5]`
// Prints one line per run (total, and how much of it the page took from navigation start) and the median as JSON.
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { _electron as electron } from 'playwright';

const repoRoot = path.join(import.meta.dirname, '..', '..');
const { values } = parseArgs({ options: { exe: { type: 'string' }, runs: { type: 'string', default: '5' } } });
const runs = Number(values.runs);
if (!(runs >= 1)) throw new Error(`--runs must be a positive number, got "${values.runs}"`);
const work = path.join(repoRoot, '.engine-tmp', 'cold-start');

async function once(n) {
  const userData = path.join(work, `user-data-${n}`);
  rmSync(userData, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const args = [`--user-data-dir=${userData}`];
  const start = performance.now();
  const app = await electron.launch(values.exe
    ? { executablePath: path.resolve(values.exe), args, timeout: 60_000 }
    : { args: [repoRoot, ...args], timeout: 60_000 });
  try {
    const page = await app.firstWindow();
    await page.locator('body[data-ready="1"]').waitFor({ timeout: 60_000 });
    const total = performance.now() - start;
    const pageMs = await page.evaluate(() => performance.now()); // since the page's navigation started
    return { total: Math.round(total), page: Math.round(pageMs) };
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
}

const results = [];
for (let n = 0; n < runs; n++) {
  const result = await once(n);
  results.push(result);
  console.log(`run ${n + 1}: ${result.total} ms (page ${result.page} ms)`);
}
const median = (key) => results.map((r) => r[key]).sort((a, b) => a - b)[Math.floor(runs / 2)];
console.log(JSON.stringify({ target: values.exe ?? 'electron .', runs, medianMs: median('total'), medianPageMs: median('page') }));
rmSync(work, { recursive: true, force: true });
