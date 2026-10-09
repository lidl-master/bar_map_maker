import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMapInfo } from '../../src/lua/index.js';

const archive = (files) => new Map(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]));

test('reads a synthetic map like the engine: includes, Lua 5.1 shims, case-insensitive keys, lava', async () => {
  const info = await readMapInfo(archive({
    'mapinfo.lua': `-- Synthetic test map. Licence: CC BY-SA 4.0
      local mapinfo = {
        name = "Test Map", version = 2, author = "Tester", description = "Synthetic",
        maxMetal = 1.5, extractorRadius = 80, voidWater = true,
        smf = { minHeight = -100, maxheight = 400, smtFileName0 = "maps/test.smt" },
        lighting = { sunDir = { 0.5, 0.8, -0.3, 1e9 } },
        teams = { [1] = { startPos = { x = 300, z = 400 } }, [0] = { startPos = { x = 100, z = 200 } } },
      }
      getfenv()["mapinfo"] = mapinfo
      for _, file in ipairs(VFS.DirList("mapconfig/mapinfo/", "*.lua")) do VFS.Include(file) end
      assert(table.getn({ 1, 2 }) == 2 and unpack({ 7 }) == 7 and math.pow(2, 3) == 8)
      assert(VFS.FileExists("MapConfig\\\\Lava.lua") and not VFS.FileExists("nope.lua"))
      return mapinfo`,
    'MapConfig/mapinfo/10_options.lua': 'if Spring.GetMapOptions().metal == nil then mapinfo.maxMetal = mapinfo.maxMetal * 2 end',
    'mapconfig\\lava.lua': 'return { level = 25, diffuseEmitTex = "lava.dds" }',
  }));
  assert.equal(info.error, undefined, info.error);
  const { raw, ...summary } = info;
  assert.deepEqual(summary, {
    name: 'Test Map', version: '2', author: 'Tester', description: 'Synthetic', maxMetal: 3, extractorRadius: 80,
    minHeight: -100, maxHeight: 400, smtFile: 'maps/test.smt', sunDir: [0.5, 0.8, -0.3],
    teams: [{ x: 100, z: 200 }, { x: 300, z: 400 }], lava: { level: 25, diffuseEmitTex: 'lava.dds' },
    voidWater: true, licence: 'CC BY-SA 4.0',
  });
  assert.equal(raw.smf.smtfilename0, 'maps/test.smt');
});

test('bad map Lua fails safely as data', async () => {
  const cases = [
    ['os.execute("calc")', /global 'os'/, 1],
    ['local f = io.open("x")', /global 'io'/, 1],
    ['\nrequire("os")', /global 'require'/, 2],
    ['while true do end', /instruction limit exceeded/, null],
    ['while true do pcall(function() while true do end end) end', /instruction limit exceeded/, null],
    ['local s = string.rep("x", 2^30)', /not enough memory/, null],
    ['setmetatable({}, { __gc = function() while true do end end })', /__gc is not allowed/, 1],
    ['VFS.Include("missing.lua")', /file not found: missing\.lua/, 1],
    ['return {\n name = ', /unexpected symbol|expected/, 2],
  ];
  for (const [source, error, line] of cases) {
    const result = await readMapInfo(archive({ 'mapinfo.lua': source }));
    assert.match(result.error, error, source);
    assert.equal(result.line, line, source);
  }
  assert.match((await readMapInfo(null)).error, /not iterable/);
  assert.match((await readMapInfo(new Map())).error, /mapinfo\.lua not found/);
});
