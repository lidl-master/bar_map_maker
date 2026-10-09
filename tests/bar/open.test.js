// openMapArchive reads a map's Lua in a worker thread: a mapinfo.lua stuck in a C call (the Lua instruction limit cannot
// interrupt it) is stopped after 10 s with a clear error, and the main thread stays responsive meanwhile.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { TEMP_ROOT } from '../../src/archive/index.js';
import { openMapArchive } from '../../src/bar/index.js';
import { zip } from '../helpers/zip.js';

mkdirSync(TEMP_ROOT, { recursive: true });
const root = mkdtempSync(join(TEMP_ROOT, 'open-test-'));
after(() => rmSync(root, { recursive: true, force: true }));

test("a map whose Lua never finishes is stopped with a clear error, without freezing the caller", { timeout: 30_000 }, async () => {
  const archive = join(root, 'stuck.sdz');
  const lua = "local s = string.rep('a', 30000)\ns:find(string.rep('a-', 25) .. 'b')\nreturn { name = 'Stuck' }\n";
  writeFileSync(archive, zip([{ name: 'mapinfo.lua', data: lua }]));
  // The longest the caller's thread went without running a timer: seconds when frozen, far less when free.
  const start = performance.now();
  let last = start, longestGap = 0;
  const ticker = setInterval(() => {
    longestGap = Math.max(longestGap, performance.now() - last);
    last = performance.now();
  }, 100);
  try {
    await assert.rejects(openMapArchive(archive), /this map's Lua took too long to read/);
  } finally {
    clearInterval(ticker);
  }
  const seconds = (performance.now() - start) / 1000;
  assert.ok(seconds >= 9.5 && seconds < 15, `stopped after ${seconds.toFixed(1)} s`);
  assert.ok(longestGap < 3000, `the caller's thread was blocked for ${Math.round(longestGap)} ms`);
});
