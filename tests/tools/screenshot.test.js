import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failures, HEIGHT, WIDTH } from '../../tools/engine/screenshot.js';

const run = {
  engineExit: { code: 0, signal: null, killedFor: null },
  installChanges: [],
  mapErrors: { count: 0, lines: [] },
  mapCheck: { overviewCorners: 4, overview: 'saved', mid: 'saved', close: 'interfaceVisible' },
};
const shot = { width: WIDTH, height: HEIGHT };

test('screenshot verdict: all three shots at window size is ok, a missing or wrong-size shot or a cropped overview is not', () => {
  assert.deepEqual(failures(run, { overview: shot, mid: shot, close: shot }), []);
  assert.deepEqual(failures({ ...run, mapCheck: { ...run.mapCheck, overviewCorners: 2 } }, { overview: { width: 1280, height: 720 }, mid: shot, close: null }), [
    'the overview shows 2 of the 4 map corners',
    'overview.png is 1280x720, expected 1600x900',
    'no close screenshot (interfaceVisible)',
  ]);
  assert.deepEqual(failures({ ...run, engineExit: { code: null, signal: 'SIGTERM', killedFor: 'timeout' }, mapCheck: {} }, { overview: null, mid: null, close: null }), [
    'engine stopped by the check: timeout',
    'the overview shows 0 of the 4 map corners',
    'no overview screenshot (never taken)',
    'no mid screenshot (never taken)',
    'no close screenshot (never taken)',
  ]);
});
