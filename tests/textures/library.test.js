import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MATERIAL_LIBRARY } from '../../src/look/library-manifest.js';
import { decodePng, encodePng, loadMaterial, TEXTURE_ROOT } from '../../src/look/library-load.js';

const noise = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (Math.imul(i + seed, 2654435761) >>> 24) & 255);

test('PNG encode → decode round-trips grey, grey+alpha, RGB and RGBA', () => {
  for (const channels of [1, 2, 3, 4]) {
    const image = { width: 37, height: 21, data: noise(37 * 21 * channels, channels) };
    assert.deepEqual(decodePng(encodePng(image)), { ...image, channels });
  }
});

test('loadMaterial reads albedo and DNTS from an overridden root and rejects path-like ids', () => {
  const root = mkdtempSync(join(tmpdir(), 'textures-'));
  try {
    const albedo = { width: 4, height: 4, data: noise(48, 1) }, dnts = { width: 4, height: 4, data: noise(64, 2) };
    for (const [dir, image] of [['albedo', albedo], ['dnts', dnts]]) {
      mkdirSync(join(root, dir));
      writeFileSync(join(root, dir, 'rock.png'), encodePng(image));
    }
    assert.deepEqual(loadMaterial('rock', root), { albedo: { ...albedo, channels: 3 }, dnts: { ...dnts, channels: 4 } });
    assert.throws(() => loadMaterial('../rock', root), /not a material id/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const built = existsSync(join(TEXTURE_ROOT, 'manifest.json'));
test('the library manifest matches the generated files', { skip: !built && 'run `npm run textures` first' }, () => {
  const manifest = JSON.parse(readFileSync(join(TEXTURE_ROOT, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.materials, MATERIAL_LIBRARY, 'src/look/library-manifest.js is stale: run `npm run textures`');
  assert.equal(new Set(MATERIAL_LIBRARY.map(m => m.id)).size, MATERIAL_LIBRARY.length, 'ids are unique');
  assert.deepEqual([...new Set(MATERIAL_LIBRARY.map(m => m.class))], ['ground', 'slope', 'cliff', 'shore', 'special']);
  for (const m of MATERIAL_LIBRARY) {
    assert.equal(m.licence, 'CC0');
    assert.match(m.sha256, /^[0-9a-f]{64}$/);
    assert.ok(m.tileElmos > 0 && m.avgColor.every(c => Number.isInteger(c) && c >= 0 && c <= 255), m.id);
    const { albedo, dnts } = loadMaterial(m.id);
    const thumb = decodePng(readFileSync(join(TEXTURE_ROOT, m.files.thumb)));
    assert.deepEqual([albedo.width, albedo.height, albedo.channels], [1024, 1024, 3], `${m.id} albedo`);
    assert.deepEqual([dnts.width, dnts.height, dnts.channels], [1024, 1024, 4], `${m.id} dnts`);
    assert.deepEqual([thumb.width, thumb.height, thumb.channels], [128, 128, 3], `${m.id} thumb`);
    assert.deepEqual(m.files, { albedo: `albedo/${m.id}.png`, dnts: `dnts/${m.id}.png`, thumb: `thumbs/${m.id}.png` });
  }
});
