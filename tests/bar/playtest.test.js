// Play-test start script and engine command line (src/bar/playtest.js, engine.js prepareRun): the user against BARb on
// the map, isolated: BAR's folders are only ever read, everything is written under the work folder.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { prepareRun } from '../../src/bar/engine.js';
import { playtestScript, startBoxes } from '../../src/bar/playtest.js';

const root = mkdtempSync(join(tmpdir(), 'playtest-'));
after(() => rmSync(root, { recursive: true, force: true }));

const game = { mapName: 'Studio Hills 1.0', gameName: 'Beyond All Reason test-31536-188afa8', aiVersion: 'stable', difficulty: 'hard', side: 'Cortex', boxes: [[0, 0, 0.2, 1], [0.8, 0, 1, 1]] };

test('the start script: the map, the game, player 0 against BARb with the chosen profile, start boxes', () => {
  const script = playtestScript(game);
  for (const line of ['MapName=Studio Hills 1.0;', 'GameType=Beyond All Reason test-31536-188afa8;', 'IsHost=1;', 'StartPosType=2;',
    'ShortName=BARb;', 'Version=stable;', 'profile=hard;', 'Side=Cortex;', 'StartRectRight=0.2;', 'StartRectLeft=0.8;']) {
    assert.ok(script.includes(line), `${line} in\n${script}`);
  }
  const player = /\[PLAYER0\]\s*\{([^}]*)\}/.exec(script)[1], ai = /\[AI0\]\s*\{([^]*?)\n\t\}/.exec(script)[1];
  assert.match(player, /Team=0;/);
  assert.doesNotMatch(player, /Spectator/);
  assert.match(ai, /Team=1;/);
  assert.throws(() => playtestScript({ ...game, difficulty: 'brutal' }), /difficulty/);
  assert.throws(() => playtestScript({ ...game, side: 'Legion' }), /side/);
  assert.throws(() => playtestScript({ ...game, mapName: 'x; IsHost=0' }), /must not contain/);
});

test('start boxes surround the first two start positions, or fall back to the left and right fifths', () => {
  assert.deepEqual(startBoxes([{ x: 1024, z: 4096 }, { x: 7168, z: 4096 }], 8192, 8192), [[0, 0.375, 0.25, 0.625], [0.75, 0.375, 1, 0.625]]);
  assert.deepEqual(startBoxes([{ x: 100, z: 100 }], 8192, 8192), [[0, 0, 0.2, 1], [0.8, 0, 1, 1]]);
});

test('the engine command line reads BAR\'s folders and writes only the run dir; the archive is linked, not installed', () => {
  const bar = { dataDir: join(root, 'BAR', 'data') }, engine = { dir: join(bar.dataDir, 'engine', 'recoil_2026.07.04') };
  mkdirSync(engine.dir, { recursive: true });
  const exportDir = join(root, 'exports');
  mkdirSync(exportDir);
  const archive = join(exportDir, 'studio_hills_1.0.sd7');
  writeFileSync(archive, 'archive bytes');
  const workDir = join(exportDir, '.studio-work');
  const { runDir, args } = prepareRun({ kind: 'playtest', engine, bar, mapName: game.mapName, archive, script: playtestScript(game), runRoot: join(workDir, 'playtest') });

  assert.ok(runDir.startsWith(join(workDir, 'playtest')), runDir);
  assert.deepEqual(args, ['--isolation', '--isolation-dir', `${engine.dir};${bar.dataDir}`, '--write-dir', runDir,
    '--config', join(runDir, 'springsettings.cfg'), join(runDir, 'script.txt')]);
  // Every path the engine may write is in the run dir; BAR's folders appear only as read-only data dirs.
  for (const [flag, value] of [['--write-dir', args[4]], ['--config', args[6]]]) assert.ok(value.startsWith(runDir), `${flag} ${value}`);
  assert.ok(!args.slice(3).some((a) => a.startsWith(join(root, 'BAR'))), 'no BAR path outside --isolation-dir');
  assert.equal(readFileSync(join(runDir, 'script.txt'), 'utf8'), playtestScript(game));
  const linked = join(runDir, 'maps', 'studio_hills_1.0.sd7');
  assert.equal(readFileSync(linked, 'utf8'), 'archive bytes');
  assert.ok(statSync(archive).nlink >= 1 && existsSync(archive), 'the export stays where it is');
  assert.ok(!existsSync(join(bar.dataDir, 'maps')), 'nothing installed');
});
