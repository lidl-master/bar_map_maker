// Play-test: the user against one BARb AI on an exported map, in BAR's own windowed engine, without installing the map.
// The start script follows the one BAR's lobby (Chobby) writes for a skirmish against an AI (data/_script.txt), the
// run dir is isolated like every engine run (engine.js), and the user's springsettings.cfg is copied in so their
// graphics settings apply; BAR's data dir stays read-only, so their key bindings and widget settings are read but
// never written. Node-only.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readArchive } from '../archive/index.js';
import { readSmf } from '../formats/index.js';
import { readMapInfo } from '../lua/index.js';
import { engineMapName, findEngine, prepareRun, scriptText } from './engine.js';
import { DIFFICULTIES, SIDES } from './playtest-options.js';

const BOX = 0.125; // half the side of a start box, as a share of the map, around each of the first two start positions

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Start boxes [left, top, right, bottom] (0..1) around the map's first two start positions, or its left and right fifths. */
export function startBoxes(starts, width, depth) {
  if (starts.length < 2) return [[0, 0, 0.2, 1], [0.8, 0, 1, 1]];
  return starts.slice(0, 2).map(({ x, z }) => [x / width - BOX, z / depth - BOX, x / width + BOX, z / depth + BOX].map(clamp01));
}

/**
 * The skirmish start script: player 0 (the user) on team 0 against BARb on team 1, start positions chosen in game.
 * @param {{mapName: string, gameName: string, aiVersion: string, difficulty: string, side: string, boxes: number[][]}} game
 */
export function playtestScript({ mapName, gameName, aiVersion, difficulty, side, boxes }) {
  if (!Object.hasOwn(DIFFICULTIES, difficulty)) throw new Error(`unknown AI difficulty "${difficulty}"`);
  if (!SIDES.includes(side)) throw new Error(`unknown side "${side}"`);
  const allyTeam = ([left, top, right, bottom]) => ({ NumAllies: 0, StartRectLeft: left, StartRectTop: top, StartRectRight: right, StartRectBottom: bottom });
  return scriptText({
    GAME: {
      MapName: mapName, GameType: gameName, IsHost: 1, HostIP: '127.0.0.1', HostPort: 0, MyPlayerName: 'Player',
      StartPosType: 2, NumPlayers: 1, NumUsers: 2, GameStartDelay: 5, NoHelperAIs: 0,
      PLAYER0: { Name: 'Player', Team: 0, Rank: 0, IsFromDemo: 0 },
      AI0: { Name: 'BARbarIAn(1)', ShortName: 'BARb', Version: aiVersion, Team: 1, Host: 0, IsFromDemo: 0, OPTIONS: { profile: difficulty } },
      TEAM0: { TeamLeader: 0, AllyTeam: 0, Side: side, Handicap: 0, RgbColor: '0 0.51 0.78' },
      TEAM1: { TeamLeader: 0, AllyTeam: 1, Side: 'Random', Handicap: 0, RgbColor: '0.9 0.1 0.29' },
      ALLYTEAM0: allyTeam(boxes[0]),
      ALLYTEAM1: allyTeam(boxes[1]),
    },
  });
}

/**
 * Starts BAR's windowed engine on the archive. Resolves once the process runs; `exited` resolves when BAR closes
 * (the run dir keeps BAR's infolog.txt and the demo; the archive's link in it is removed).
 * @param {string} archivePath
 * @param {{workDir: string, difficulty?: string, side?: string}} options
 * @returns {Promise<{pid: number, runDir: string, exited: Promise<{code: number|null, signal: string|null, seconds: number, log: string}>}>}
 */
export async function playtest(archivePath, { workDir, difficulty = 'medium', side = 'Armada' }) {
  const files = await readArchive(archivePath, ['*.lua', '*.smf']);
  const info = await readMapInfo(files);
  if (info.error) throw new Error(`mapinfo.lua could not be read: ${info.error}`);
  const smfPath = [...files.keys()].find((path) => /^maps\/[^/]+\.smf$/i.test(path));
  if (!smfPath) throw new Error('the archive has no maps/*.smf map file');
  const { mapx, mapy } = readSmf(files.get(smfPath));
  const { bar, engine, exe } = findEngine('spring.exe');
  const [aiVersion] = readdirSync(join(engine.dir, 'AI', 'Skirmish', 'BARb'));
  if (!aiVersion) throw new Error(`BARb is missing from ${engine.dir}`);
  const mapName = engineMapName(info);
  const script = playtestScript({ mapName, gameName: bar.game.name, aiVersion, difficulty, side, boxes: startBoxes(info.teams, mapx * 8, mapy * 8) });
  const { runDir, args } = prepareRun({ kind: 'playtest', engine, bar, mapName, archive: archivePath, script, runRoot: join(workDir, 'playtest') });
  const userSettings = join(bar.dataDir, 'springsettings.cfg');
  if (existsSync(userSettings)) copyFileSync(userSettings, join(runDir, 'springsettings.cfg')); // a copy: BAR's own is never written

  const started = performance.now();
  // detached: BAR keeps running when the Studio closes (a plain child would be in Node's kill-on-close job object).
  const child = spawn(exe, args, { cwd: runDir, stdio: 'ignore', detached: true });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      rmSync(join(runDir, 'maps'), { recursive: true, force: true });
      resolve({ code, signal, seconds: (performance.now() - started) / 1000, log: join(runDir, 'infolog.txt') });
    });
  });
  return { pid: child.pid, runDir, exited };
}
