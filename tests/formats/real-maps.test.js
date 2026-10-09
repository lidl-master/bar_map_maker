// Untouched round trip of real BAR maps, read-only from the user's maps folder (extracted to .engine-tmp).
// Skips maps that are not installed.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readArchive } from '../../src/archive/index.js';
import { locateBar } from '../../src/bar/index.js';
import { readSmf, readSmt, writeSmf, writeSmt } from '../../src/formats/index.js';

let mapsDir = null;
try { mapsDir = locateBar().mapsDir; } catch { /* no BAR install: every case skips */ }

for (const archive of ['pyroclast_1.0.4.sd7', 'volcano_king_1.0.sd7', 'shallow_straits_v1.0.1.sd7']) {
  const path = mapsDir && join(mapsDir, archive);
  test(`${archive}: SMF and SMT survive read -> write -> read`, { skip: !path || !existsSync(path) }, async () => {
    const files = await readArchive(path);
    const smfPath = [...files.keys()].find((p) => /^maps\/[^/]+\.smf$/i.test(p));
    const smf = readSmf(files.get(smfPath));
    const smtBytes = files.get([...files.keys()].find((p) => p.toLowerCase() === `maps/${smf.tileFiles[0].name}`.toLowerCase()));
    assert.deepEqual(readSmf(writeSmf(smf)), smf);
    assert.deepEqual(writeSmt(readSmt(smtBytes)), smtBytes);
  });
}
