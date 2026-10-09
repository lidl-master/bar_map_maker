// G7 map checklist over map archives (src/bar/checklist.js on the facts src/bar/map-facts.js reads).
//   node tools/checklist/checklist.js [map.sd7 ...] [--json]
// Without archives: every map in the BAR maps folder. Prints one line per map with its warnings and failures
// (--json: the full rows); exit code 1 when any map has a failure.
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { checklist } from '../../src/bar/checklist.js';
import { locateBar } from '../../src/bar/locate.js';
import { readMapFacts } from '../../src/bar/map-facts.js';
import { listMaps } from '../../src/bar/open.js';

async function main(argv) {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' } } });
  const archives = positionals.length ? positionals : listMaps(locateBar().mapsDir).map((m) => m.file);
  let failed = false;
  for (const archive of archives) {
    let rows;
    try {
      rows = checklist(await readMapFacts(archive));
    } catch (error) {
      rows = [{ id: 'read', label: 'Archive readable', status: 'fail', detail: error.message }];
    }
    failed ||= rows.some((row) => row.status === 'fail');
    if (values.json) {
      console.log(JSON.stringify({ archive, rows: rows.map(({ fix, ...row }) => ({ ...row, fix: fix?.label })) }));
      continue;
    }
    const pass = rows.filter((row) => row.status === 'pass').length;
    console.log(`${basename(archive)}: ${pass}/${rows.length} pass`);
    for (const row of rows.filter((r) => r.status !== 'pass')) console.log(`  ${row.status.toUpperCase()} ${row.id}: ${row.detail}`);
  }
  return failed ? 1 : 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
