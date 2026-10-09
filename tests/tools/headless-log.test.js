import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEngineLog } from '../../tools/engine/headless-check.js';

const PIP_ERROR = `Error in Initialize(): [string "luaui/Widgets/gui_pip.lua"]:9330: attempt to call field 'CreateShader' (a nil value)`;
const LOG = `[t=00:00:01.000000] Warning: [ArchiveData] version "1.1" included in name "Other Map v1.1"
[t=00:00:01.100000] Warning: [ArchiveData] version "1.0" included in name "Test Map 1.0"
[t=00:00:02.000000][f=-000001] [PreGame::AddMapArchivesToVFS][server=0] using map "Test Map 1.0" (loaded=0 cached=0)
[t=00:00:03.000000][f=-000001] Lava Mapname, Test Map 1.0
[t=00:00:03.100000][f=-000001] Error: [SMFGroundTextures] tile file broken
[t=00:00:03.200000][f=-000001] ${PIP_ERROR}
[t=00:00:03.300000][f=-000001] Warning: [CreateYardMap] armhaap: given yardmap requires 81 extra char(s)!
[t=00:00:04.000000][f=-000001] Spectator MapCheck finished loading and is now ingame
[t=00:00:05.000000][f=0000001] [MapCheck] start frame=1 lavaLevel=60 mexCount=90 geoSpots=10
[t=00:00:06.000000][f=0000030] [MapCheck] frame=30
[t=00:00:06.100000][f=0000031] ${PIP_ERROR}
[t=00:00:35.000000][f=0000900] [MapCheck] quit frame=900 lavaLevel=59.5 mexCount=90 geoSpots=10
`;

test('reads load state, frames and the check widget facts', () => {
  const report = parseEngineLog(LOG, 'Test Map 1.0');
  assert.equal(report.loaded, true);
  assert.equal(report.ingame, true);
  assert.equal(report.framesReached, 900);
  assert.deepEqual(report.mapCheck, { frame: 900, lavaLevel: 59.5, mexCount: 90, geoSpots: 10 });
});

test('sorts lines into map problems, Lua errors, lava and metal', () => {
  const report = parseEngineLog(LOG, 'Test Map 1.0');
  assert.deepEqual(report.mapProblems.lines, [
    'Warning: [ArchiveData] version "1.0" included in name "Test Map 1.0"',
    'Error: [SMFGroundTextures] tile file broken',
  ]);
  assert.deepEqual(report.luaErrors, { count: 2, lines: [PIP_ERROR] });
  assert.equal(report.errors.count, 3);
  assert.deepEqual(report.lava.lines, [
    'Lava Mapname, Test Map 1.0',
    '[MapCheck] start frame=1 lavaLevel=60 mexCount=90 geoSpots=10',
    '[MapCheck] quit frame=900 lavaLevel=59.5 mexCount=90 geoSpots=10',
  ]);
  assert.equal(report.metal.count, 2);
});

test('a log that never reaches the game is not loaded', () => {
  const report = parseEngineLog('[t=00:00:01.000000] Error: [PreGame] map "Nope" not found\n', 'Nope');
  assert.equal(report.loaded, false);
  assert.equal(report.framesReached, -1);
  assert.deepEqual(report.mapProblems.lines, ['Error: [PreGame] map "Nope" not found']);
});
