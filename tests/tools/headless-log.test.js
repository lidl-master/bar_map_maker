import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failures, parseEngineLog, QUIT_FRAME } from '../../tools/engine/headless-check.js';

const T = '[t=00:00:17.313553][f=-000001] ';
// Verbatim from the critic's probe map (a Volcano King copy with an extra comma in mapconfig/lava.lua).
const LAVA_CONFIG_ERROR = `Error: [LuaRules::RunCallInTraceback] error=2 (LUA_ERRRUN) callin=LoadCode trace=[Internal Lua error: Call failure] [LuaVFS::Include(synced=true)][pcall] file=LuaRules/gadgets.lua error=2 ([LuaVFS::Include(synced=true)][pcall] file=init.lua error=2 ([LuaVFS::Include(synced=true)][pcall] file=modules/lava.lua error=2 ([LuaVFS::Include(synced=true)][loadbuf] file=mapconfig/lava.lua error=3 ([string "mapconfig/lava.lua"]:4: unexpected symbol near ',') cenv=false vfsmode=Mmb) ptop=1 cenv=false vfsmode=Mmb) ptop=3 cenv=false vfsmode=Mmb) ptop=3 cenv=false vfsmode=Mmb`;
const SESSION = '[t=00:00:00.640663][f=-000001] [PreGame::AddMapArchivesToVFS][server=0000000000000000] using map "%MAP%" (loaded=0 cached=0)';
const archiveLine = (file) => `[t=00:00:01.255659][f=-000001] [CAS::GASCB] Archive file="${file}" cs="10f25f30"`;

const CLEAN = [
  '[t=00:00:01.000000] Warning: [ArchiveData] version "1.1" included in name "Other Map v1.1"',
  SESSION.replace('%MAP%', 'Test Map 1.0'),
  archiveLine('test_map_1.0.sd7'),
  archiveLine('maphelper.sdz'),
  `${T}Error: [GetFeatureDef] could not find FeatureDef "corfast_dead"`,
  `${T}Error in Initialize(): [string "luaui/Widgets/gui_pip.lua"]:9330: attempt to call field 'CreateShader' (a nil value)`,
  `${T}[Sunfacer] Warning: Missing sun facing for Test Map 1.0`,
  `${T}Warning: [CSMFReadMap::CreateSplatDetailTextures] Invalid SMF splatDetailTex maps/detail.tga. Creating fallback texture`,
  '[t=00:00:04.000000][f=-000001] Spectator MapCheck finished loading and is now ingame',
  '[t=00:00:05.000000][f=0000000] [MapCheck] start frame=0 lavaLevel=60 mexCount=90 geoSpots=10',
  '[t=00:00:06.000000][f=0000030] [MapCheck] frame=30',
  '[t=00:00:35.000000][f=0000900] [MapCheck] quit frame=900 lavaLevel=59.5 mexCount=90 geoSpots=10',
].join('\n');

test('a clean log: loaded, frames, widget facts, only map warnings', () => {
  const report = parseEngineLog(CLEAN, 'Test Map 1.0');
  assert.equal(report.loaded, true);
  assert.equal(report.framesReached, 900);
  assert.equal(report.mapArchive, 'test_map_1.0.sd7');
  assert.deepEqual(report.mapCheck, { frame: 900, lavaLevel: 59.5, mexCount: 90, geoSpots: 10 });
  assert.deepEqual(report.mapErrors, { count: 0, lines: [] });
  assert.deepEqual(report.mapWarnings.lines, [
    '[Sunfacer] Warning: Missing sun facing for Test Map 1.0',
    'Warning: [CSMFReadMap::CreateSplatDetailTextures] Invalid SMF splatDetailTex maps/detail.tga. Creating fallback texture',
  ]);
});

test('an error in the map\'s own mapconfig/lava.lua is a map error', () => {
  const log = [SESSION.replace('%MAP%', 'Critic Lava Probe 1.0'), archiveLine('critic_lava_probe_1.0.sd7'), T + LAVA_CONFIG_ERROR].join('\n');
  const report = parseEngineLog(log, 'Critic Lava Probe 1.0');
  assert.deepEqual(report.mapErrors, { count: 1, lines: [LAVA_CONFIG_ERROR] });
  assert.equal(report.loaded, false);
});

test('a scan warning naming the map\'s archive file counts once the session names that archive', () => {
  const scanWarning = 'Warning: [AS::ScanArchive] set the \'mapfile\' key in mapinfo.lua of archive "C:/BAR/data/maps/shallow_straits_v1.0.1.sd7" for faster loading!';
  const otherMap = 'Warning: [AS::ScanArchive] set the \'mapfile\' key in mapinfo.lua of archive "C:/BAR/data/maps/other_map_1.0.sd7" for faster loading!';
  const log = [`[t=00:00:01.0] ${scanWarning}`, `[t=00:00:01.1] ${otherMap}`,
    SESSION.replace('%MAP%', 'Shallow Straits v1.0.1'), archiveLine('shallow_straits_v1.0.1.sd7')].join('\n');
  assert.deepEqual(parseEngineLog(log, 'Shallow Straits v1.0.1').mapWarnings.lines, [scanWarning]);
});

test('a log that never reaches the game is not loaded', () => {
  const report = parseEngineLog('[t=00:00:01.000000] Fatal: [ExitSpringProcess] errorMsg="Dependent archive "nope 1.0" not found"\n', 'Nope 1.0');
  assert.equal(report.loaded, false);
  assert.equal(report.framesReached, -1);
  assert.equal(report.mapErrors.count, 1);
});

const clean = { engineExit: { code: 0, signal: null, killedFor: null }, framesReached: QUIT_FRAME, installChanges: [], mapErrors: { count: 0, lines: [] } };

test('failures: a clean run has none', () => {
  assert.deepEqual(failures(clean), []);
});

test('failures: crash after load, timeout, early quit, map error, install change', () => {
  assert.deepEqual(failures({ ...clean, engineExit: { code: 3221225477, signal: null, killedFor: null }, framesReached: 31 }),
    ['engine exit code 3221225477', 'reached frame 31, needs 900']);
  assert.deepEqual(failures({ ...clean, engineExit: { code: null, signal: 'SIGTERM', killedFor: 'timeout' }, framesReached: 1800 }),
    ['engine stopped by the check: timeout']);
  assert.deepEqual(failures({ ...clean, framesReached: 400 }), ['reached frame 400, needs 900']);
  assert.deepEqual(failures({ ...clean, mapErrors: { count: 2, lines: ['x'] } }), ['2 map error lines']);
  assert.deepEqual(failures({ ...clean, installChanges: ['C:/BAR/data/infolog.txt'] }), ['1 paths changed in the BAR install']);
});
