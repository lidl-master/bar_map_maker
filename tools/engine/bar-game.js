// One isolated BAR game on a map, shared by headless-check.js and screenshot.js: start script, run dir, engine
// process, log parsing and the verdict rules both tools apply.
// Isolation: the engine reads the BAR install as a read-only data dir; its write dir and config file are a fresh
// folder under .engine-tmp/. A before/after listing of the install proves nothing was written.
import { spawn } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { locateBar } from '../bar/locate.js';

export const REPO = resolve(import.meta.dirname, '../..');
const HARD_TIMEOUT_MS = 6 * 60_000; // archive checksums (~45 s on a fresh write dir) + loading + the tool's own work, with margin
const LIST_LIMIT = 40; // distinct lines kept per report list

export const mapId = (mapName) => mapName.replace(/\W+/g, '_');

// Spectator host watching NullAI vs NullAI, start boxes on the left and right fifth of the map.
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
// Before this line the engine only scans every installed archive; from here on the log is about this game and map.
const SESSION_START = '[PreGame::AddMapArchivesToVFS]';
const ARCHIVE_FILE = /\[CAS::GASCB\] Archive file="([^"]+)"/; // the first one in the session is the map's archive
const ERROR = /\b(error|fatal|crashed)\b|exception/i;
const WARNING = /\bwarning\b/i;
// Files of the map's own archive as the engine and BAR's Lua name them (VFS paths), and the engine's SMF loader.
const MAP_FILE = /(?<![\w/\\.-])(maps\/|mapconfig\/|mapinfo\.lua)|SMF/;

const lowerNames = (...names) => names.filter(Boolean).map((name) => name.toLowerCase());

// 'error' | 'warning' | null. A line is about the map if it names the map or its archive file, or, once the
// session started, one of the map's files.
function mapSeverity(line, names, inSession) {
  const lower = line.toLowerCase();
  if (!names.some((name) => lower.includes(name)) && !(inSession && MAP_FILE.test(line))) return null;
  if (ERROR.test(line)) return 'error';
  return WARNING.test(line) ? 'warning' : null;
}

// Live version for a running engine: true at the first map error. It does not learn the archive name yet;
// parseEngineLog does, so the report can only list more map errors than this, never fewer.
function mapErrorWatch(mapName, archive) {
  const names = lowerNames(mapName, archive && basename(archive));
  let inSession = false;
  return (line) => {
    inSession ||= line.includes(SESSION_START);
    return mapSeverity(line, names, inSession) === 'error';
  };
}

function summarize(lines) {
  return { count: lines.length, lines: [...new Set(lines.map((line) => line.replace(LINE_PREFIX, '')))].slice(0, LIST_LIMIT) };
}

// mapCheck collects the `key=value` pairs of the tool widget's `[MapCheck]` lines (later lines win).
export function parseEngineLog(text, mapName, archive) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(SESSION_START));
  const session = start < 0 ? [] : lines.slice(start);
  const archiveFile = session.map((line) => ARCHIVE_FILE.exec(line)?.[1]).find(Boolean);
  const names = lowerNames(mapName, archive && basename(archive), archiveFile);
  const severity = lines.map((line, i) => mapSeverity(line, names, start >= 0 && i >= start));
  let framesReached = -1;
  for (const [, frame] of text.matchAll(/\]\[f=(-?\d+)\]/g)) framesReached = Math.max(framesReached, Number(frame));
  const mapCheck = {};
  for (const [, pairs] of text.matchAll(/\[MapCheck\](.*)/g)) {
    for (const [, key, value] of pairs.matchAll(/(\w+)=(\S+)/g)) mapCheck[key] = Number.isNaN(Number(value)) ? value : Number(value);
  }
  return {
    loaded: text.includes('finished loading and is now ingame') && framesReached > 0,
    framesReached,
    mapArchive: archiveFile ?? null,
    mapCheck,
    mapErrors: summarize(lines.filter((_, i) => severity[i] === 'error')),
    mapWarnings: summarize(lines.filter((_, i) => severity[i] === 'warning')),
  };
}

// Why a run is not clean, whatever the tool: the engine stopped by itself with exit code 0, wrote nothing into
// the BAR install and logged no map error. Each tool adds its own checks.
export function runFailures({ engineExit, installChanges, mapErrors }) {
  return [
    engineExit.killedFor && `engine stopped by the check: ${engineExit.killedFor}`,
    !engineExit.killedFor && engineExit.code !== 0 && `engine exit code ${engineExit.code}`,
    installChanges.length > 0 && `${installChanges.length} paths changed in the BAR install`,
    mapErrors.count > 0 && `${mapErrors.count} map error lines`,
  ].filter(Boolean);
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

// Copies the engine's console output (same lines as its buffered infolog.txt, so a killed run keeps its tail)
// to logFile and kills the engine at the first map error, at the hard timeout, or on Ctrl+C.
function runEngine(exe, args, cwd, logFile, isMapError) {
  return new Promise((resolvePromise, reject) => {
    const log = createWriteStream(logFile);
    const child = spawn(exe, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let killedFor = null;
    const kill = (reason) => {
      killedFor ??= reason;
      child.kill();
    };
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', (line) => {
        log.write(`${line}\n`);
        if (isMapError(line)) kill('map error');
      });
    }
    const timer = setTimeout(() => kill('timeout'), HARD_TIMEOUT_MS);
    const interrupt = () => kill('interrupted');
    process.on('SIGINT', interrupt);
    const cleanUp = () => {
      clearTimeout(timer);
      process.off('SIGINT', interrupt);
    };
    child.on('error', (error) => {
      cleanUp();
      reject(error);
    });
    child.on('close', (code, signal) => {
      cleanUp();
      log.end(() => resolvePromise({ code, signal, killedFor }));
    });
  });
}

// Runs `exeName` (spring-headless.exe or spring.exe) of the newest engine that has a headless build, on a fresh
// run dir `.engine-tmp/<kind>-<time>-<map>/` with `settings` as its exclusive springsettings.cfg and `widget`
// (Lua source) as a user widget. An optional archive is copied into the run's own maps/.
// Returns the fields every report shares; runFailures() and the tool's own checks read them.
export async function runGame({ kind, exeName, mapName, archive, settings, widget }) {
  if (/[;{}\r\n]/.test(mapName)) throw new Error('map name must not contain ; { } or line breaks (start script syntax)');
  const bar = locateBar();
  const engine = bar.headlessEngine;
  if (!engine) throw new Error(`no engine with spring-headless.exe under ${bar.dataDir}`);
  const exe = join(engine.dir, exeName);
  if (!existsSync(exe)) throw new Error(`${exe} not found`);
  if (!bar.game?.packageExists) throw new Error(`installed game for the BAR test tag not found: ${JSON.stringify(bar.game)}`);

  const runDir = join(REPO, '.engine-tmp', `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}-${mapId(mapName)}`);
  mkdirSync(join(runDir, 'LuaUI', 'Widgets'), { recursive: true });
  if (archive) {
    // shortcut: an installed archive with the same internal map name stays visible and the engine keeps only one of
    // the two (it logs which, see mapErrors); give test builds a unique map name until this matters.
    mkdirSync(join(runDir, 'maps'));
    copyFileSync(archive, join(runDir, 'maps', basename(archive)));
  }
  const [nullAIVersion] = readdirSync(join(engine.dir, 'AI', 'Skirmish', 'NullAI'));
  writeFileSync(join(runDir, 'script.txt'), startScript(mapName, bar.game.name, nullAIVersion));
  writeFileSync(join(runDir, 'springsettings.cfg'), settings); // exclusive config: the engine must not touch BAR's
  writeFileSync(join(runDir, 'LuaUI', 'Widgets', `bar_map_studio_${kind}.lua`), widget);

  const log = join(runDir, 'engine-log.txt');
  const before = snapshot(bar.root);
  const engineExit = await runEngine(exe, [
    '--isolation', '--isolation-dir', `${engine.dir};${bar.dataDir}`,
    '--write-dir', runDir,
    '--config', join(runDir, 'springsettings.cfg'),
    join(runDir, 'script.txt'),
  ], runDir, log, mapErrorWatch(mapName, archive));
  return {
    map: mapName,
    archive: archive ? resolve(archive) : null,
    engine: engine.name,
    game: bar.game.name,
    engineExit,
    ...parseEngineLog(readFileSync(log, 'utf8'), mapName, archive),
    installChanges: changedPaths(before, snapshot(bar.root)),
    runDir,
    log,
  };
}
