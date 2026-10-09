// Reads mapinfo.lua of every map in the user's BAR maps folder (skipped when BAR is not installed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import sevenZip from '7zip-bin';
import { locateBar } from '../../tools/bar/locate.js';
import { readMapInfo } from '../../src/lua/index.js';

const tmpRoot = join(import.meta.dirname, '..', '..', '.engine-tmp');
const mapsDir = (() => {
  try { return locateBar().mapsDir; } catch { return null; }
})();
const maps = mapsDir && existsSync(mapsDir) ? readdirSync(mapsDir).filter((name) => /\.sd[7z]$/i.test(name)) : [];

const readTree = (root) => new Map(readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name))
  .map((path) => [relative(root, path).replaceAll('\\', '/'), readFileSync(path)]));

test('reads mapinfo.lua of every map in the BAR maps folder', { skip: !maps.length && 'no BAR maps folder' }, async () => {
  mkdirSync(tmpRoot, { recursive: true });
  const tmp = mkdtempSync(join(tmpRoot, 'lua-maps-'));
  try {
    const infos = [];
    for (const archive of maps) {
      const out = join(tmp, archive);
      // The BAR folder is only ever read: 7-Zip extracts into our own temp dir.
      const { status, stderr } = spawnSync(sevenZip.path7za,
        ['x', '-y', '-bso0', '-bsp0', `-o${out}`, join(mapsDir, archive), 'mapinfo.lua', 'mapconfig'], { encoding: 'utf8' });
      assert.equal(status, 0, `7-Zip failed on ${archive}: ${stderr}`);
      const info = await readMapInfo(readTree(out));
      assert.equal(info.error, undefined, `${archive}: ${info.error} (line ${info.line})`);
      infos.push(info);
    }
    console.table(infos.map(({ name, version, teams, sunDir, lava, licence }) =>
      ({ name, version, teams: teams.length, sunDir: JSON.stringify(sunDir), lava: lava ? `level ${lava.level}` : 'no', licence })));

    const byName = Object.fromEntries(infos.map((info) => [info.name, info]));
    for (const info of infos) {
      // Volcano King was made by the old prototype with the sun in the south (z > 0): a known flaw.
      if (info.name === 'Volcano King') assert.ok(info.sunDir[2] > 0.3, 'Volcano King sun z');
      else assert.ok(info.sunDir[2] < 0, `${info.name} sun z = ${info.sunDir?.[2]}`);
    }
    if (byName['Volcano King']) {
      const { version, lava, teams } = byName['Volcano King'];
      assert.deepEqual([version, lava?.level, teams.length], ['1.0', 60, 16]);
    }
    if (byName.Pyroclast) assert.deepEqual([byName.Pyroclast.version, byName.Pyroclast.licence], ['1.0.4', 'CC BY-NC-SA 4.0']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
