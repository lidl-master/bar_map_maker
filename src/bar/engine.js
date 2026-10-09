// BAR's engine on a map, isolated from the BAR install: start scripts, run dirs, the engine process, log parsing and
// the verdict rules every engine run shares. Used by check.js (Check map), playtest.js and tools/engine. Node-only.
// Isolation: the engine reads the engine dir and BAR's data dir as read-only data dirs; its write dir and config
// file are a fresh run dir. A map archive is hard-linked (or copied) into the run dir's own maps/, so it never has to
// be installed. A before/after listing of the install proves nothing was written there.
import { spawn } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { locateBar } from './locate.js';

const HARD_TIMEOUT_MS = 6 * 60_000; // archive checksums (~45 s on a fresh write dir) + loading + the tool's own work, with margin
const LIST_LIMIT = 40; // distinct lines kept per report list

export const mapId = (mapName) => mapName.replace(/\W+/g, '_');

/** The name the engine knows a map archive by (ArchiveData::GetNameVersioned): name, plus the version unless the name has it. */
export const engineMapName = ({ name, version }) => (version && !name.includes(version) ? `${name} ${version}` : name);

/**
 * A start script from nested sections: {GAME: {MapName: 'x', PLAYER0: {...}}} → "[GAME]\n{\n\tMapName=x;\n\t[PLAYER0]…".
 * Values must not contain ; { } or line breaks (the format has no escaping).
 */
export function scriptText(sections, depth = 0) {
  const tab = '\t'.repeat(depth);
  return Object.entries(sections).map(([key, value]) => {
    if (value && typeof value === 'object') return `${tab}[${key}]\n${tab}{\n${scriptText(value, depth + 1)}${tab}}\n`;
    if (/[;{}\r\n]/.test(String(value))) throw new Error(`start script value of ${key} must not contain ; { } or line breaks: ${value}`);
    return `${tab}${key}=${value};\n`;
  }).join('');
}

// Spectator host watching NullAI vs NullAI, start boxes on the left and right fifth of the map.
function spectatorScript(mapName, gameName, nullAIVersion) {
  const team = (t, side, left, right) => ({
    [`AI${t}`]: { Name: `NullAI${t}`, ShortName: 'NullAI', Version: nullAIVersion, Team: t, Host: 0 },
    [`TEAM${t}`]: { TeamLeader: 0, AllyTeam: t, Side: side },
    [`ALLYTEAM${t}`]: { NumAllies: 0, StartRectLeft: left, StartRectRight: right, StartRectTop: 0, StartRectBottom: 1 },
  });
  return scriptText({
    GAME: {
      MapName: mapName, GameType: gameName, IsHost: 1, HostIP: '127.0.0.1', HostPort: 0, MyPlayerName: 'MapCheck',
      StartPosType: 2, NumPlayers: 1, NumTeams: 2, NumAllyTeams: 2,
      PLAYER0: { Name: 'MapCheck', Spectator: 1, Team: 0 },
      ...team(0, 'Armada', 0, 0.2),
      ...team(1, 'Cortex', 0.8, 1),
    },
  });
}

/**
 * The newest engine that has `exeName` (spring-headless.exe or spring.exe) and the installed BAR game.
 * @returns {{bar: object, engine: {name: string, dir: string}, exe: string}}
 */
export function findEngine(exeName, bar = locateBar()) {
  const engine = bar.engines.findLast((e) => existsSync(join(e.dir, exeName)));
  if (!engine) throw new Error(`no BAR engine with ${exeName} under ${bar.dataDir}`);
  if (!bar.game?.packageExists) throw new Error('the installed Beyond All Reason game was not found: start BAR once so it downloads the game');
  return { bar, engine, exe: join(engine.dir, exeName) };
}

/**
 * A fresh run dir `<runRoot>/<kind>-<time>-<map>/` with `script` as script.txt and the archive (if any) in its
 * maps/ (a hard link on the same drive, else a copy); the engine's command line for it.
 * @returns {{runDir: string, args: string[]}}
 */
export function prepareRun({ kind, engine, bar, mapName, archive, script, runRoot }) {
  const runDir = join(resolve(runRoot), `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}-${mapId(mapName)}`);
  mkdirSync(runDir, { recursive: true });
  if (archive) {
    // shortcut: an installed archive with the same internal map name stays visible and the engine keeps only one of
    // the two; check.js reports when it picked the other one (mapArchive). Revisit if that happens in practice.
    mkdirSync(join(runDir, 'maps'));
    const linked = join(runDir, 'maps', basename(archive));
    try {
      linkSync(archive, linked);
    } catch {
      copyFileSync(archive, linked); // another drive, or a file system without hard links
    }
  }
  writeFileSync(join(runDir, 'script.txt'), script);
  return {
    runDir,
    args: [
      '--isolation', '--isolation-dir', `${engine.dir};${bar.dataDir}`,
      '--write-dir', runDir,
      '--config', join(runDir, 'springsettings.cfg'),
      join(runDir, 'script.txt'),
    ],
  };
}

const LINE_PREFIX = /^\[t=[^\]]*\](\[f=-?\d+\])? ?/;
// Before this line the engine only scans every installed archive; from here on the log is about this game and map.
export const SESSION_START = '[PreGame::AddMapArchivesToVFS]';
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
// the BAR install, loaded the archive it was given and logged no map error. Each tool adds its own checks.
export function runFailures({ engineExit, installChanges, mapErrors, archive, mapArchive }) {
  return [
    engineExit.killedFor && `engine stopped by the check: ${engineExit.killedFor}`,
    !engineExit.killedFor && engineExit.code !== 0 && `engine exit code ${engineExit.code}`,
    installChanges.length > 0 && `${installChanges.length} paths changed in the BAR install`,
    archive && mapArchive && basename(mapArchive).toLowerCase() !== basename(archive).toLowerCase()
      && `BAR loaded ${basename(mapArchive)}, not ${basename(archive)}: an installed map has the same name`,
    mapErrors.count > 0 && `${mapErrors.count} map error lines`,
  ].filter(Boolean);
}

// path -> "size:mtime" for everything under root, to prove the engine wrote nothing there. Asynchronous and in
// parallel batches: ~1.3 s for BAR's ~30,000 files (the synchronous walk took ~8 s and froze the app).
export async function snapshot(root) {
  const entries = new Map(), paths = (await readdir(root, { recursive: true, withFileTypes: true })).map((e) => join(e.parentPath, e.name));
  for (let i = 0; i < paths.length; i += 512) {
    await Promise.all(paths.slice(i, i + 512).map(async (path) => {
      const stat = await lstat(path).catch(() => null); // gone since the listing: absent from the snapshot
      if (stat) entries.set(path, `${stat.size}:${stat.mtimeMs}`);
    }));
  }
  return entries;
}

export function changedPaths(before, after) {
  const changed = [...after].filter(([path, sig]) => before.get(path) !== sig).map(([path]) => path);
  return [...changed, ...[...before.keys()].filter((path) => !after.has(path))];
}

// Copies the engine's console output (same lines as its buffered infolog.txt, so a killed run keeps its tail)
// to logFile, passes each line to onLine, and kills the engine at the first map error, at the hard timeout, on
// Ctrl+C or when `signal` aborts.
function runEngine(exe, args, cwd, logFile, isMapError, { signal, onLine }) {
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
        onLine?.(line);
        if (isMapError(line)) kill('map error');
      });
    }
    const timer = setTimeout(() => kill('timeout'), HARD_TIMEOUT_MS);
    const interrupt = () => kill('interrupted');
    const cancel = () => kill('cancelled');
    process.on('SIGINT', interrupt);
    signal?.addEventListener('abort', cancel);
    if (signal?.aborted) cancel();
    const cleanUp = () => {
      clearTimeout(timer);
      process.off('SIGINT', interrupt);
      signal?.removeEventListener('abort', cancel);
    };
    child.on('error', (error) => {
      cleanUp();
      reject(error);
    });
    child.on('close', (code, signalName) => {
      cleanUp();
      log.end(() => resolvePromise({ code, signal: signalName, killedFor }));
    });
  });
}

/**
 * Runs `exeName` (spring-headless.exe or spring.exe) of the newest engine that has a headless build on a fresh run
 * dir under `runRoot`, with `settings` as its exclusive springsettings.cfg and `widget` (Lua source) as a user
 * widget, watching NullAI vs NullAI as a spectator. An optional archive goes into the run's own maps/.
 * onLine(line) sees the engine's output as it comes; `signal` cancels the run.
 * @returns the fields every report shares; runFailures() and the tool's own checks read them.
 */
export async function runGame({ kind, exeName, mapName, archive, settings, widget, runRoot, signal, onLine }) {
  const bar = locateBar();
  // Both tools use the newest engine that has a headless build, so the check and the screenshots see the same engine.
  const engine = bar.headlessEngine;
  if (!engine) throw new Error(`no engine with spring-headless.exe under ${bar.dataDir}`);
  const { exe } = findEngine(exeName, { ...bar, engines: [engine] });
  const [nullAIVersion] = readdirSync(join(engine.dir, 'AI', 'Skirmish', 'NullAI'));
  const script = spectatorScript(mapName, bar.game.name, nullAIVersion);
  const { runDir, args } = prepareRun({ kind, engine, bar, mapName, archive, script, runRoot });
  mkdirSync(join(runDir, 'LuaUI', 'Widgets'), { recursive: true });
  writeFileSync(join(runDir, 'springsettings.cfg'), settings); // exclusive config: the engine must not touch BAR's
  writeFileSync(join(runDir, 'LuaUI', 'Widgets', `bar_map_studio_${kind}.lua`), widget);

  const log = join(runDir, 'engine-log.txt');
  const before = await snapshot(bar.root);
  const engineExit = await runEngine(exe, args, runDir, log, mapErrorWatch(mapName, archive), { signal, onLine });
  return {
    map: mapName,
    archive: archive ? resolve(archive) : null,
    engine: engine.name,
    game: bar.game.name,
    engineExit,
    ...parseEngineLog(readFileSync(log, 'utf8'), mapName, archive),
    installChanges: changedPaths(before, await snapshot(bar.root)),
    runDir,
    log,
  };
}
