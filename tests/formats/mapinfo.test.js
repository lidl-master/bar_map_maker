import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { LuaFactory } from 'wasmoon';
import { mapFileBase, writeLavaConfig, writeMapInfo } from '../../src/formats/index.js';
import { testMap } from '../helpers/test-map.js';

const extras = { fileBase: 'Studio_Test_Hills', minHeight: -20, maxHeight: 500, maxMetal: 1 };
let lua;
before(async () => { lua = await new LuaFactory().createEngine(); });
after(() => lua.global.close());

test('user strings survive Lua parsing exactly, with no way to inject code', async () => {
  const doc = testMap();
  const hostile = 'Evil", modtype = 0, x = "\\ ]] \n\ttab \r end';
  Object.assign(doc.settings, { name: hostile, description: `${hostile} ${'\x7f\x01'}`, author: 'A "quoted" \\author' });
  const info = await lua.doString(writeMapInfo(doc, extras));
  assert.equal(info.name, hostile);
  assert.equal(info.description, `${hostile} \x7f\x01`);
  assert.equal(info.author, 'A "quoted" \\author');
  assert.equal(info.modtype, 3);
  assert.equal(info.x, undefined);
});

test('mapinfo carries heights, metal, files, teams, and a normalised northern sun', async () => {
  const doc = testMap();
  const info = await lua.doString(writeMapInfo(doc, extras));
  assert.deepEqual(info.smf, { minheight: -20, maxheight: 500, smtFileName0: 'maps/Studio_Test_Hills.smt' });
  assert.equal(info.mapfile, 'maps/Studio_Test_Hills.smf');
  assert.equal(info.maxMetal, 1);
  assert.deepEqual(Object.values(info.teams).map((t) => t.startPos), [{ x: 614, z: 2048 }, { x: 3482, z: 2048 }]);
  const [x, y, z] = info.lighting.sunDir;
  assert.ok(z < 0 && y > 0);
  assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-3);
  assert.ok(info.water, 'terrain below 0 without lava or void water gets a water block');
});

test('sun in the south or below the horizon is refused', () => {
  for (const sunDir of [[0.3, 0.8, 0.5], [0.3, 0.8, 0], [0.3, -0.2, -0.5], [NaN, 1, -1]]) {
    const doc = testMap();
    doc.settings.sunDir = sunDir;
    assert.throws(() => writeMapInfo(doc, extras), /sunDir/);
  }
});

test('no water block for dry, void-water or lava maps', async () => {
  const dry = await lua.doString(writeMapInfo(testMap(), { ...extras, minHeight: 10 }));
  assert.equal(dry.water, undefined);
  const lavaDoc = testMap();
  lavaDoc.settings.lava = { enabled: true, level: 40, damage: 100 };
  assert.equal((await lua.doString(writeMapInfo(lavaDoc, extras))).water, undefined);
});

test('lava config is BAR-shaped when lava is on, null when off', async () => {
  const doc = testMap();
  assert.equal(writeLavaConfig(doc), null);
  doc.settings.lava = { enabled: true, level: 60, damage: 100 };
  const lava = await lua.doString(writeLavaConfig(doc));
  assert.equal(lava.level, 60);
  assert.equal(lava.grow, 0);
  assert.equal(lava.damage, 100);
  assert.deepEqual(lava.tideRhythm, [[59, 1.5, 30000]]);
  assert.match(lava.diffuseEmitTex, /^LuaUI\/images\/lava\/lava2_/);
});

test('file base names are file-system safe', () => {
  assert.equal(mapFileBase('  My Map: v2 / final  '), 'My_Map_v2_final');
  assert.equal(mapFileBase('1.0.4'), '1.0.4');
  assert.throws(() => mapFileBase(' ?! '), /file name/);
});
