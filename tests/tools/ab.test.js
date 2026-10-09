import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { makePair, reveal } from '../../tools/ab/ab.js';

const root = mkdtempSync(join(tmpdir(), 'ab-'));
after(() => rmSync(root, { recursive: true, force: true }));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ours = join(root, 'ours.png');
const reference = join(root, 'reference.png');
writeFileSync(ours, Buffer.concat([PNG_SIGNATURE, Buffer.from('ours')]));
writeFileSync(reference, Buffer.concat([PNG_SIGNATURE, Buffer.from('reference')]));

test('A/B files match the key, and both orders occur', () => {
  const orders = new Set();
  for (let i = 0; i < 40; i++) {
    const pairDir = makePair(root, `pair-${i}`, ours, reference);
    const key = reveal(root, `pair-${i}`);
    const source = { ours, reference };
    assert.deepEqual(readFileSync(join(pairDir, 'A.png')), readFileSync(source[key.A]));
    assert.deepEqual(readFileSync(join(pairDir, 'B.png')), readFileSync(source[key.B]));
    assert.notEqual(key.A, key.B);
    assert.ok(existsSync(join(root, 'keys', `pair-${i}.json`)));
    orders.add(key.A);
  }
  assert.deepEqual([...orders].sort(), ['ours', 'reference']); // fails by chance with p = 2^-39
});

test('refuses to overwrite an existing pair', () => {
  makePair(root, 'once', ours, reference);
  assert.throws(() => makePair(root, 'once', ours, reference), /already exists/);
});

test('rejects path-like pair ids and non-PNG input', () => {
  assert.throws(() => makePair(root, '../escape', ours, reference), /pair id must match/);
  const text = join(root, 'not-a-png.png');
  writeFileSync(text, 'hello');
  assert.throws(() => makePair(root, 'text', text, reference), /ours image is not a PNG/);
  assert.equal(existsSync(join(root, 'pairs', 'text')), false);
});
