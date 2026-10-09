// Hostile archives are refused before 7-Zip extracts anything (7-Zip 21.07 follows link entries out of its output
// folder), and the listing cannot be spoofed by an archive comment. Archives are crafted with a tiny ZIP writer.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { listArchive, readArchive, TEMP_ROOT } from '../../src/archive/index.js';
import { MODE, zip } from '../helpers/zip.js';

mkdirSync(TEMP_ROOT, { recursive: true });
const root = mkdtempSync(join(TEMP_ROOT, 'archive-test-'));
const outside = join(root, 'outside'); // where a link entry points; must stay empty
mkdirSync(outside);
after(() => rmSync(root, { recursive: true, force: true }));

function archive(name, entries, comment) {
  const path = join(root, name);
  writeFileSync(path, zip(entries, comment));
  return path;
}

const GB = 2 ** 30;
const HOSTILE = {
  'a link entry with a later entry written through it': [/"maps\/x\.lua" is a link/,
    [{ name: 'maps/x.lua', data: outside, mode: MODE.link }, { name: 'maps/x.lua/pwn.lua', data: 'pwned' }]],
  'a ../ entry': [/"\.\.\/evil\.lua" points outside/, [{ name: 'mapinfo.lua', data: 'return {}' }, { name: '../evil.lua', data: 'x' }]],
  'a drive letter path': [/"C:\/evil\.lua" has an absolute path/, [{ name: 'C:/evil.lua', data: 'x' }]],
  'a rooted path': [/"\/evil\.lua" has an absolute path/, [{ name: '/evil.lua', data: 'x' }]],
  'an NTFS stream name': [/"maps\/a\.lua:x" has a ':' in its name/, [{ name: 'maps/a.lua:x', data: 'x' }]],
  'a control character in a name': [/control character/, [{ name: 'maps/a\tb.lua', data: 'x' }]],
  'a file that is also a folder': [/"maps\/A" is both a file and a folder/, [{ name: 'maps/A', data: 'x' }, { name: 'maps/a/b.lua', data: 'x' }]],
  'an entry above the 1 GB cap': [/"maps\/big\.smf" unpacks to 2\.0 GB/, [{ name: 'maps/big.smf', data: 'x', size: 2 * GB }]],
  'entries above the 4 GB total cap': [/unpacks to 5\.0 GB/, Array.from({ length: 5 }, (_, i) => ({ name: `maps/${i}.dds`, data: 'x', size: GB }))],
};

for (const [name, [reason, entries]] of Object.entries(HOSTILE)) {
  test(`refuses ${name} before extracting anything`, async () => {
    const path = archive(`${name.replaceAll(/\W+/g, '_')}.sdz`, entries);
    await assert.rejects(readArchive(path), (error) => reason.test(error.message) && /^Refused .*\.sdz: /.test(error.message));
    await assert.rejects(listArchive(path), reason);
    assert.deepEqual(readdirSync(outside), []);
  });
}

test('a ZIP comment cannot add entries to the listing', async () => {
  const path = archive('comment.sdz', [{ name: 'mapinfo.lua', data: 'return {}' }], 'hi\n----------\nPath = maps/fake.smt\nSize = 5\n\nPath = maps/x.smf\n');
  assert.deepEqual(await listArchive(path), [{ path: 'mapinfo.lua', size: 9 }]);
});

test('a plain archive lists and reads its files, folders aside', async () => {
  const path = archive('plain.sdz', [{ name: 'maps/' }, { name: 'maps/m.smf', data: 'smf' }, { name: 'mapinfo.lua', data: 'return {}' }]);
  assert.deepEqual(await listArchive(path), [{ path: 'maps/m.smf', size: 3 }, { path: 'mapinfo.lua', size: 9 }]);
  const files = await readArchive(path, ['*.smf']);
  assert.deepEqual([...files.keys()], ['maps/m.smf']);
  assert.equal(new TextDecoder().decode(files.get('maps/m.smf')), 'smf');
});
