// Runs against a fake maps dir in the repo's .engine-tmp, never the real BAR folder.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { TEMP_ROOT } from '../../src/archive/index.js';
import { installMap } from '../../src/bar/index.js';

mkdirSync(TEMP_ROOT, { recursive: true });
const root = mkdtempSync(join(TEMP_ROOT, 'install-test-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('installs with an md5 sidecar and removes the same map under the other extension', async () => {
  const mapsDir = join(root, 'maps'), buildDir = join(root, 'build');
  mkdirSync(mapsDir);
  mkdirSync(buildDir);
  const archive = join(buildDir, 'my_map_1.0.sd7');
  writeFileSync(archive, 'new archive bytes');
  for (const name of ['my_map_1.0.sdz', 'My_Map_1.0.sdz.md5.gz', 'my_map_1.0.sd7', 'my_map_1.0.sd7.md5.gz', 'my_map_1.1.sdz', 'other_1.0.sdz']) {
    writeFileSync(join(mapsDir, name), 'old');
  }

  const { installedPath, removed } = await installMap(archive, { mapsDir });

  assert.equal(installedPath, join(mapsDir, 'my_map_1.0.sd7'));
  assert.deepEqual(removed.sort(), [join(mapsDir, 'My_Map_1.0.sdz.md5.gz'), join(mapsDir, 'my_map_1.0.sdz')].sort());
  assert.deepEqual(readdirSync(mapsDir).sort(), ['my_map_1.0.sd7', 'my_map_1.0.sd7.md5.gz', 'my_map_1.1.sdz', 'other_1.0.sdz']);
  assert.equal(readFileSync(installedPath, 'utf8'), 'new archive bytes');
  const md5 = createHash('md5').update('new archive bytes').digest('hex');
  assert.equal(gunzipSync(readFileSync(`${installedPath}.md5.gz`)).toString('latin1'), `${md5}  my_map_1.0.sd7\n`);
});

test('refuses files that are not map archives', async () => {
  await assert.rejects(installMap(join(root, 'notes.txt'), { mapsDir: root }), /not a map archive/);
});
