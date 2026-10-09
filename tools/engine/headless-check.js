// Runs BAR's headless engine on a map and reports whether it loads cleanly.
//   node tools/engine/headless-check.js "<Map Name>" [path/to/map.sd7]
// Starts a real BAR game (spectator host, NullAI vs NullAI), lets it simulate QUIT_FRAME frames, then quits.
// Prints a JSON report. Exit code 1 unless the map loaded and simulated, the engine quit before the hard
// timeout, and the BAR install is unchanged (report.ok).
// Isolation: the engine reads the BAR install as a read-only data dir; its write dir and config file
// are a fresh folder under .engine-tmp/. A before/after listing of the install proves nothing was written.
import { spawn } from 'node:child_process';
import { closeSync, copyFileSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { locateBar } from '../bar/locate.js';

const REPO = resolve(import.meta.dirname, '../..');
const QUIT_FRAME = 900; // 30 s of game time
const HARD_TIMEOUT_MS = 6 * 60_000; // archive checksums (~45 s on a fresh write dir) + loading + QUIT_FRAME, with margin
const LIST_LIMIT = 40; // distinct lines kept per report category

// Loaded by BAR as a user widget from the write dir (spectators may run user widgets).
// mex_count and lavaLevel are game rules params set by BAR's resource spot finder and lava gadgets.
const CHECK_WIDGET = `
function widget:GetInfo()
	return { name = "BAR Map Studio check", desc = "Logs sim progress and map facts, then quits", layer = 0, enabled = true }
end

local function rule(name)
	return tostring((Spring.GetGameRulesParam(name))) -- unset params return no value at all
end

local function facts(label, frame)
	local geo = WG.resource_spot_finder and WG.resource_spot_finder.geoSpotsList
	Spring.Echo(("[MapCheck] %s frame=%d lavaLevel=%s mexCount=%s geoSpots=%s"):format(label, frame,
		rule("lavaLevel"), rule("mex_count"), geo and #geo or "unknown"))
end

local started = false
function widget:GameFrame(frame)
	if not started then
		started = true
		facts("start", frame)
	elseif frame >= ${QUIT_FRAME} then
		facts("quit", frame)
		Spring.SendCommands("quitforce")
	elseif frame % 30 == 0 then
		Spring.Echo(("[MapCheck] frame=%d"):format(frame))
	end
end
`;

function startScript(mapName, gameName, nullAIVersion) {
  const team = (t, side, left, right) => `
	[AI${t}]
	{
		Name=NullAI${t};
		ShortName=NullAI;
		Version=${nullAIVersion};
		Team=${t};
		Host=0;
	}
	[TEAM${t}]
	{
		TeamLeader=0;
		AllyTeam=${t};
		Side=${side};
	}
	[ALLYTEAM${t}]
	{
		NumAllies=0;
		StartRectLeft=${left};
		StartRectRight=${right};
		StartRectTop=0;
		StartRectBottom=1;
	}`;
  return `[GAME]
{
	MapName=${mapName};
	GameType=${gameName};
	IsHost=1;
	HostIP=127.0.0.1;
	HostPort=0;
	MyPlayerName=MapCheck;
	StartPosType=2;
	NumPlayers=1;
	NumTeams=2;
	NumAllyTeams=2;
	[PLAYER0]
	{
		Name=MapCheck;
		Spectator=1;
		Team=0;
	}${team(0, 'Armada', 0, 0.2)}${team(1, 'Cortex', 0.8, 1)}
}
`;
}

const LINE_PREFIX = /^\[t=[^\]]*\](\[f=-?\d+\])? ?/;
const ERROR = /\b(error|fatal|crashed)\b|exception/i;
const WARNING = /\bwarning\b/i;
const LUA_ERROR = /\[string "[^"]*"\]:\d+:|Error in \w+\(|stack traceback/i;
const MAP_FORMAT = /smf|smt|mapinfo|minimap|heightmap|metalmap|typemap|grass|\bmap\b|\btiles?\b/i;
const LAVA = /lava/i;
const METAL = /metal|\bmex|geotherm|geovent|resource spot/i;

function pick(lines, test) {
  const hits = lines.filter(test);
  return { count: hits.length, lines: [...new Set(hits.map((line) => line.replace(LINE_PREFIX, '')))].slice(0, LIST_LIMIT) };
}

// Lines before the engine picks the map come from scanning every installed archive; only those naming this map count.
export function parseEngineLog(text, mapName, archive) {
  const lines = text.split(/\r?\n/);
  const names = [mapName, archive && basename(archive)].filter(Boolean).map((n) => n.toLowerCase());
  const namesMap = (line) => names.some((n) => line.toLowerCase().includes(n));
  const start = Math.max(0, lines.findIndex((line) => line.includes('[PreGame::AddMapArchivesToVFS]')));
  const scan = lines.slice(0, start);
  const session = lines.slice(start);
  let framesReached = -1;
  for (const [, frame] of text.matchAll(/\]\[f=(-?\d+)\]/g)) framesReached = Math.max(framesReached, Number(frame));
  const mapCheck = {};
  for (const [, pairs] of text.matchAll(/\[MapCheck\](.*)/g)) {
    for (const [, key, value] of pairs.matchAll(/(\w+)=(\S+)/g)) mapCheck[key] = Number.isNaN(Number(value)) ? value : Number(value);
  }
  const ingame = text.includes('finished loading and is now ingame');
  const isProblem = (l) => ERROR.test(l) || WARNING.test(l);
  return {
    loaded: ingame && framesReached > 0,
    ingame,
    framesReached,
    mapCheck,
    mapProblems: pick([...scan.filter(namesMap), ...session], (l) => isProblem(l) && (namesMap(l) || MAP_FORMAT.test(l))),
    luaErrors: pick(session, (l) => LUA_ERROR.test(l)),
    errors: pick(session, (l) => ERROR.test(l)),
    lava: pick(session, (l) => LAVA.test(l)),
    metal: pick(session, (l) => METAL.test(l)),
  };
}

// path -> "size:mtime" for everything under root, to prove the engine wrote nothing there.
function snapshot(root) {
  const entries = new Map();
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat) entries.set(path, `${stat.size}:${stat.mtimeMs}`);
  }
  return entries;
}

function changedPaths(before, after) {
  const changed = [...after].filter(([path, sig]) => before.get(path) !== sig).map(([path]) => path);
  return [...changed, ...[...before.keys()].filter((path) => !after.has(path))];
}

function runEngine(exe, args, cwd, outputFile) {
  return new Promise((resolvePromise, reject) => {
    const out = openSync(outputFile, 'w');
    const child = spawn(exe, args, { cwd, stdio: ['ignore', out, out], windowsHide: true });
    closeSync(out);
    let timedOut = false;
    const stop = () => child.kill(); // Ctrl+C must not leave the engine running
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, HARD_TIMEOUT_MS);
    process.on('SIGINT', stop);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      process.off('SIGINT', stop);
      resolvePromise({ code, signal, timedOut });
    });
  });
}

async function main([mapName, archive]) {
  if (!mapName) {
    console.error('usage: node tools/engine/headless-check.js "<Map Name>" [path/to/map.sd7]');
    return 2;
  }
  if (/[;{}\r\n]/.test(mapName)) throw new Error('map name must not contain ; { } or line breaks (start script syntax)');
  const bar = locateBar();
  const engine = bar.headlessEngine;
  if (!engine) throw new Error(`no engine with spring-headless.exe under ${bar.dataDir}`);
  if (!bar.game?.packageExists) throw new Error(`installed game for the BAR test tag not found: ${JSON.stringify(bar.game)}`);

  const runDir = join(REPO, '.engine-tmp', `headless-${new Date().toISOString().replace(/[:.]/g, '-')}-${mapName.replace(/\W+/g, '_')}`);
  mkdirSync(join(runDir, 'LuaUI', 'Widgets'), { recursive: true });
  if (archive) {
    // shortcut: an installed archive with the same internal map name stays visible and the engine keeps only one of
    // the two (it logs which, see mapProblems); give test builds a unique map name until this matters.
    mkdirSync(join(runDir, 'maps'));
    copyFileSync(archive, join(runDir, 'maps', basename(archive)));
  }
  const [nullAIVersion] = readdirSync(join(engine.dir, 'AI', 'Skirmish', 'NullAI'));
  writeFileSync(join(runDir, 'script.txt'), startScript(mapName, bar.game.name, nullAIVersion));
  writeFileSync(join(runDir, 'springsettings.cfg'), ''); // exclusive config: the engine must not touch BAR's
  writeFileSync(join(runDir, 'LuaUI', 'Widgets', 'bar_map_studio_check.lua'), CHECK_WIDGET);

  // The engine's console output has the same lines as its infolog.txt, but unbuffered: a killed run keeps its tail.
  const log = join(runDir, 'engine-log.txt');
  const before = snapshot(bar.root);
  const exit = await runEngine(engine.headlessExe, [
    '--isolation', '--isolation-dir', `${engine.dir};${bar.dataDir}`,
    '--write-dir', runDir,
    '--config', join(runDir, 'springsettings.cfg'),
    join(runDir, 'script.txt'),
  ], runDir, log);
  const installChanges = changedPaths(before, snapshot(bar.root));
  const parsed = parseEngineLog(readFileSync(log, 'utf8'), mapName, archive);
  const report = {
    ok: parsed.loaded && !exit.timedOut && installChanges.length === 0,
    map: mapName,
    archive: archive ? resolve(archive) : null,
    engine: engine.name,
    game: bar.game.name,
    quitFrame: QUIT_FRAME,
    engineExit: exit,
    ...parsed,
    installChanges,
    runDir,
    log,
  };
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
