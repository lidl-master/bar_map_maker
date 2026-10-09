// Runs BAR's headless engine on a map and reports whether it loads cleanly (gate G2). The logic is src/bar/check.js.
//   node tools/engine/headless-check.js "<Map Name>" [path/to/map.sd7]
// Prints a JSON report; exit code 0 only when report.ok (see failures()). Run dirs stay in .engine-tmp/.
import { join, resolve } from 'node:path';
import { failures, QUIT_FRAME, runCheck } from '../../src/bar/check.js';

export { failures, QUIT_FRAME };

async function main([mapName, archive]) {
  if (!mapName) {
    console.error('usage: node tools/engine/headless-check.js "<Map Name>" [path/to/map.sd7]');
    return 2;
  }
  const run = await runCheck({ mapName, archive, runRoot: join(resolve(import.meta.dirname, '../..'), '.engine-tmp') });
  const why = failures(run);
  const report = { ok: why.length === 0, failures: why, quitFrame: QUIT_FRAME, ...run };
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
