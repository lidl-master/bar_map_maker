// In-engine screenshots of a map (gate G3) from fixed camera presets, the same for every map.
//   node tools/engine/screenshot.js "<Map Name>" [path/to/map.sd7] [--out <dir>]
// Starts a real BAR game (see bar-game.js) in BAR's windowed engine at 1600x900 with a run-local config.
// screenshot-widget.lua hides the interface, saves overview/mid/close.png and quits. The PNGs and report.json go
// to --out (default .engine-tmp/g3/<map-id>/). Prints the JSON report; exit code 0 only when report.ok.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { mapId, REPO, runFailures, runGame } from './bar-game.js';

export const SHOTS = ['overview', 'mid', 'close'];
export const WIDTH = 1600;
export const HEIGHT = 900;

// The run's whole config: windowed, no sound, game-like graphics (shadows high, reflective water, MSAA x4),
// and nothing that moves the camera or draws over the world (edge scrolling, a software cursor, unit icons).
const SETTINGS = `Fullscreen = 0
WindowBorderless = 0
XResolutionWindowed = ${WIDTH}
YResolutionWindowed = ${HEIGHT}
Sound = 0
Shadows = 1
ShadowQuality = 4
Water = 4
AdvMapShading = 1
MSAALevel = 4
WindowedEdgeMove = 0
HardwareCursor = 1
UnitIconsHideWithUI = 1
`;

// Why a run did not produce the screenshots; an empty list means ok. shots[name] is {width, height} or null.
export function failures(run, shots) {
  return [
    ...runFailures(run),
    run.mapCheck.overviewCorners !== 4 && `the overview shows ${run.mapCheck.overviewCorners ?? 0} of the 4 map corners`,
    ...SHOTS.map((name) => {
      const shot = shots[name];
      if (!shot) return `no ${name} screenshot (${run.mapCheck[name] ?? 'never taken'})`;
      return (shot.width !== WIDTH || shot.height !== HEIGHT) && `${name}.png is ${shot.width}x${shot.height}, expected ${WIDTH}x${HEIGHT}`;
    }),
  ].filter(Boolean);
}

// Copies runDir/<name>.png to outDir and reads its size from the PNG header (IHDR width and height).
function collectShot(runDir, outDir, name) {
  const from = join(runDir, `${name}.png`);
  if (!existsSync(from)) return null;
  const path = join(outDir, `${name}.png`);
  copyFileSync(from, path);
  const png = readFileSync(path);
  return { path, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function main(argv) {
  const { positionals: [mapName, archive], values } = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: 'string' } } });
  if (!mapName) {
    console.error('usage: node tools/engine/screenshot.js "<Map Name>" [path/to/map.sd7] [--out <dir>]');
    return 2;
  }
  const outDir = resolve(values.out ?? join(REPO, '.engine-tmp', 'g3', mapId(mapName)));
  mkdirSync(outDir, { recursive: true });
  const widget = readFileSync(join(import.meta.dirname, 'screenshot-widget.lua'), 'utf8');
  const run = await runGame({ kind: 'g3', exeName: 'spring.exe', mapName, archive, settings: SETTINGS, widget });
  const shots = Object.fromEntries(SHOTS.map((name) => [name, collectShot(run.runDir, outDir, name)]));
  const why = failures(run, shots);
  const report = { ok: why.length === 0, failures: why, shots, ...run };
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
