// Runs BAR's headless engine on a map and reports whether it loads cleanly.
//   node tools/engine/headless-check.js "<Map Name>" [path/to/map.sd7]
// Starts a real BAR game (see bar-game.js), lets it simulate QUIT_FRAME frames, then quits.
// The first map error in the log stops the engine at once. Prints a JSON report; exit code 0 only when
// report.ok (see failures()).
import { runFailures, runGame } from './bar-game.js';

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

// Why a run is not a clean load; an empty list means ok.
export function failures(run) {
  return [
    ...runFailures(run),
    run.framesReached < QUIT_FRAME && `reached frame ${run.framesReached}, needs ${QUIT_FRAME}`,
  ].filter(Boolean);
}

async function main([mapName, archive]) {
  if (!mapName) {
    console.error('usage: node tools/engine/headless-check.js "<Map Name>" [path/to/map.sd7]');
    return 2;
  }
  const run = await runGame({ kind: 'headless', exeName: 'spring-headless.exe', mapName, archive, settings: '', widget: CHECK_WIDGET });
  const why = failures(run);
  const report = { ok: why.length === 0, failures: why, quitFrame: QUIT_FRAME, ...run };
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
