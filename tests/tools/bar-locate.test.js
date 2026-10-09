import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { locateBar } from '../../tools/bar/locate.js';

const root = mkdtempSync(join(tmpdir(), 'bar-fixture-'));
after(() => rmSync(root, { recursive: true, force: true }));

function put(path, content = '') {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

put('data/maps/some_map.sd7');
put('data/engine/recoil_2025.06.19/spring-headless.exe');
put('data/engine/recoil_2026.06.11/spring-headless.exe');
put('data/engine/recoil_2026.07.04/spring.exe'); // newest, but without a headless build
put('data/packages/bbbb.sdp');
put('data/rapid/repos-cdn.example/byar/versions.gz', gzipSync([
  'byar:stable,aaaa,,Beyond All Reason stable-1',
  'byar:test,bbbb,,Beyond All Reason test-31536-188afa8',
  'byar-chobby:test,cccc,,BYAR Chobby test-9',
].join('\n')));
put('resources/app.asar.unpacked/node_modules/7zip-bin/win/x64/7za.exe');

test('finds dirs, engines, the newest headless engine, the test game and 7-Zip', () => {
  const bar = locateBar(root);
  assert.equal(bar.dataDir, join(root, 'data'));
  assert.equal(bar.mapsDir, join(root, 'data', 'maps'));
  assert.deepEqual(bar.engines.map((e) => e.name), ['recoil_2025.06.19', 'recoil_2026.06.11', 'recoil_2026.07.04']);
  assert.equal(bar.headlessEngine.name, 'recoil_2026.06.11');
  assert.equal(bar.headlessEngine.headlessExe, join(root, 'data', 'engine', 'recoil_2026.06.11', 'spring-headless.exe'));
  assert.deepEqual(bar.game, {
    tag: 'byar:test',
    name: 'Beyond All Reason test-31536-188afa8',
    package: join(root, 'data', 'packages', 'bbbb.sdp'),
    packageExists: true,
  });
  assert.equal(bar.sevenZip, join(root, 'resources', 'app.asar.unpacked', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'));
});

test('reports missing pieces as null', () => {
  const empty = mkdtempSync(join(tmpdir(), 'bar-empty-'));
  mkdirSync(join(empty, 'data'));
  try {
    assert.deepEqual(locateBar(empty), {
      root: empty,
      dataDir: join(empty, 'data'),
      mapsDir: join(empty, 'data', 'maps'),
      engines: [],
      headlessEngine: null,
      game: null,
      sevenZip: null,
    });
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('throws when there is no BAR data dir', () => {
  assert.throws(() => locateBar(join(root, 'nope')), /BAR data dir not found/);
});
