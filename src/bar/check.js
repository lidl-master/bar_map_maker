// Check map: BAR's headless engine loads a map archive (not installed: it goes into the run dir's own maps/), lets it
// simulate QUIT_FRAME frames as a spectator of NullAI vs NullAI, then quits. The first map error stops the engine at
// once. Gate G2's verdict: failures(run). Node-only.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readArchive } from '../archive/index.js';
import { readMapInfo } from '../lua/index.js';
import { engineMapName, runFailures, runGame, SESSION_START } from './engine.js';

export const QUIT_FRAME = 900; // 30 s of game time

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

/** Why a run is not a clean load; an empty list means ok. */
export function failures(run) {
  return [
    ...runFailures(run),
    run.framesReached < QUIT_FRAME && `reached frame ${run.framesReached}, needs ${QUIT_FRAME}`,
  ].filter(Boolean);
}

/**
 * The raw engine run on a map by its engine name (installed, or `archive` added to the run). Run dirs stay in runRoot.
 * onProgress(fraction, label): starting, loading the map, simulating.
 */
export function runCheck({ mapName, archive, runRoot, signal, onProgress = () => {} }) {
  onProgress(0, 'Starting BAR\'s engine');
  const onLine = (line) => {
    if (line.includes(SESSION_START)) onProgress(0.4, 'Loading the map');
    const frame = /\[MapCheck\].*frame=(\d+)/.exec(line)?.[1];
    if (frame !== undefined) onProgress(0.5 + (0.5 * Number(frame)) / QUIT_FRAME, `Simulating ${Math.round(Number(frame) / 30)} of ${QUIT_FRAME / 30} s`);
  };
  return runGame({ kind: 'check', exeName: 'spring-headless.exe', mapName, archive, settings: '', widget: CHECK_WIDGET, runRoot, signal, onLine });
}

const number = (value) => (typeof value === 'number' ? value : null);

/**
 * Loads an exported archive in BAR's headless engine (70-150 s, ~6 GB RAM) under `<workDir>/check/` and deletes the
 * run dir afterwards.
 * @param {string} archivePath
 * @param {{workDir: string, onProgress?: (fraction: number, label: string) => void, signal?: AbortSignal}} options
 * @returns {Promise<{ok: boolean, failures: string[], frames: number, mapErrors: string[], warnings: string[],
 *   metalSpots: number|null, geos: number|null, starts: number, lava: number|null, seconds: number, cancelled: boolean}>}
 *   metalSpots / geos / lava: what BAR's own gadgets report in game (null when unknown); starts: mapinfo teams
 */
export async function checkMap(archivePath, { workDir, onProgress, signal }) {
  const started = performance.now();
  const info = await readMapInfo(await readArchive(archivePath, ['*.lua']));
  if (info.error) throw new Error(`mapinfo.lua could not be read: ${info.error}`);
  const run = await runCheck({ mapName: engineMapName(info), archive: archivePath, runRoot: join(workDir, 'check'), signal, onProgress });
  rmSync(run.runDir, { recursive: true, force: true }); // the hard link to the archive goes, the archive stays
  const why = failures(run);
  return {
    ok: why.length === 0,
    failures: why,
    frames: run.framesReached,
    mapErrors: run.mapErrors.lines,
    warnings: run.mapWarnings.lines,
    metalSpots: number(run.mapCheck.mexCount),
    geos: number(run.mapCheck.geoSpots),
    starts: info.teams.length,
    lava: number(run.mapCheck.lavaLevel),
    seconds: (performance.now() - started) / 1000,
    cancelled: run.engineExit.killedFor === 'cancelled',
  };
}
