// Lua files of a derivative export. The original file's code stays byte for byte, wrapped in a function, and a short
// patch after it changes only the values the derivative changes in the table it returns. Every key, map option hook
// and include of the original keeps working, and user text only ever reaches Lua through luaString. Pure.
import { luaNumber, luaString, writeLavaConfig } from '../formats/index.js';

const encoder = new TextEncoder();

// set(t, key, value): every key of t that matches case-insensitively (the engine reads mapinfo that way), else `key`.
// sub(t, key): t[key] as a table, created when missing.
const PRELUDE = `local function set(t, key, value)
  local lower, found = key:lower(), false
  for k in pairs(t) do
    if type(k) == "string" and k:lower() == lower then
      t[k] = value
      found = true
    end
  end
  if not found then t[key] = value end
end

local function sub(t, key)
  local lower = key:lower()
  for k, v in pairs(t) do
    if type(k) == "string" and k:lower() == lower and type(v) == "table" then return v end
  end
  local v = {}
  set(t, key, v)
  return v
end
`;

/** The archive's own spelling of `path` (archive paths are case-insensitive in the engine), or null. */
export function findPath(files, path) {
  const lower = path.toLowerCase();
  return [...files.keys()].find((p) => p.toLowerCase() === lower) ?? null;
}

const BOM = [0xef, 0xbb, 0xbf];

/**
 * `path` with the original's code unchanged inside a function and a patch of what it returns (`t`; further return
 * values pass through). Self-contained on purpose: the engine's archive scanner reads mapinfo.lua before the archive
 * is mounted, so the file cannot include another one from its own archive.
 * @param {Map<string, Uint8Array>} files  the archive
 * @param {string} body  Lua statements changing `t`
 * @returns {Map<string, Uint8Array>} path -> the new file
 */
export function wrapLua(files, path, body, credit) {
  let source = files.get(path);
  if (BOM.every((b, i) => source[i] === b)) source = source.subarray(3); // Lua does not read a byte-order mark inside a function
  const head = encoder.encode(`-- ${credit.replace(/[\x00-\x1f\x7f]/g, ' ')}
-- Made with BAR Map Studio: the original map's ${path}, unchanged, is the function below; the lines after it change
-- only what the derivative changes.
local function original(...)
`);
  const tail = encoder.encode(`
end

${PRELUDE}
local function patch(t, ...)
${body.trim().split('\n').map((line) => `  ${line}`).join('\n')}
  return t, ...
end

return patch(original(...))
`);
  const out = new Uint8Array(head.length + source.length + tail.length);
  out.set(head);
  out.set(source, head.length);
  out.set(tail, head.length + source.length);
  return new Map([[path, out]]);
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// mapinfo.lua lines for doc settings the user changed (credits, name and lava are written elsewhere).
const SETTING_PATCHES = {
  minWind: (v) => `set(sub(t, "atmosphere"), "minWind", ${luaNumber(v, 'minWind')})`,
  maxWind: (v) => `set(sub(t, "atmosphere"), "maxWind", ${luaNumber(v, 'maxWind')})`,
  tidalStrength: (v) => `set(t, "tidalStrength", ${luaNumber(v, 'tidalStrength')})`,
  gravity: (v) => `set(t, "gravity", ${luaNumber(v, 'gravity')})`,
  extractorRadius: (v) => `set(t, "extractorRadius", ${luaNumber(v, 'extractorRadius')})`,
  voidWater: (v) => `set(t, "voidWater", ${v ? 'true' : 'false'})`,
  // The original's 4th value (sun distance), if any, stays.
  sunDir: (v) => `local sun = sub(sub(t, "lighting"), "sunDir")\nsun[1], sun[2], sun[3] = ${v.map((n) => luaNumber(n, 'sunDir')).join(', ')}`,
};
const WRITTEN_ELSEWHERE = new Set(['name', 'version', 'author', 'description', 'lava']);

/** "Based on <name> <version> by <author>": the credit every derivative carries. */
export const creditLine = ({ name, version, author }) => `Based on ${[name, version].filter(Boolean).join(' ')}${author ? ` by ${author}` : ''}`;

/**
 * @typedef {Object} MapinfoChanges
 * @property {string} fileBase  maps/<fileBase>.smf and .smt
 * @property {number} smtFiles  how many SMT files the original's mapinfo may name (all but the first are cleared)
 * @property {{minHeight: number, maxHeight: number}|null} heights  a new height range, or null to keep the original's
 * @property {number|null} maxMetal  a new maxMetal, or null
 * @property {{x: number, z: number}[]|null} starts  new start positions (team order), or null
 * @property {Record<string, string|null>} resources  mapinfo resources keys to set (file name) or drop (null)
 * @property {boolean} dropGrassDist  drop custom.grassConfig.grassDistTGA (BAR's grass widget map)
 */

/**
 * Lua lines patching the original mapinfo table `t` into the derivative's.
 * @param {import('../core/index.js').MapSettings} settings  the doc's
 * @param {import('../core/index.js').MapSettings} openedSettings  the original's, as the editor opened it
 * @param {{name, version, author}} info  the original's (doc.original.info)
 * @param {MapinfoChanges} changes
 * @returns {{body: string, warnings: string[]}}
 */
export function mapinfoPatch(settings, openedSettings, info, changes) {
  const credit = creditLine(info);
  const description = settings.description.startsWith(credit) ? settings.description : `${credit}. ${settings.description}`.trim();
  const user = settings.author.trim();
  const author = !user || user === info.author || user.includes('(original by') ? user || info.author || '' : `${user} (original by ${info.author || 'unknown'})`;
  const lines = [
    `set(t, "name", ${luaString(settings.name)})`,
    `set(t, "version", ${luaString(settings.version)})`,
    `set(t, "description", ${luaString(description)})`,
    `set(t, "author", ${luaString(author)})`,
    `set(t, "mapfile", ${luaString(`maps/${changes.fileBase}.smf`)})`,
    `local smf = sub(t, "smf")`,
    `set(smf, "smtFileName0", ${luaString(`maps/${changes.fileBase}.smt`)})`,
    ...Array.from({ length: Math.max(0, changes.smtFiles - 1) }, (_, i) => `set(smf, "smtFileName${i + 1}", nil)`),
  ];
  if (changes.heights) {
    lines.push(`set(smf, "minheight", ${luaNumber(changes.heights.minHeight, 'minHeight')})`, `set(smf, "maxheight", ${luaNumber(changes.heights.maxHeight, 'maxHeight')})`);
  }
  if (changes.maxMetal !== null) lines.push(`set(t, "maxMetal", ${luaNumber(changes.maxMetal, 'maxMetal')})`);
  if (changes.starts) {
    const starts = changes.starts.map((s) => `{ x = ${luaNumber(Math.round(s.x), 'start x')}, z = ${luaNumber(Math.round(s.z), 'start z')} }`);
    lines.push(
      `local teams, starts = sub(t, "teams"), { ${starts.join(', ')} }`,
      'for i, pos in ipairs(starts) do',
      '  if type(teams[i - 1]) ~= "table" then teams[i - 1] = {} end',
      '  set(teams[i - 1], "startPos", pos)',
      'end',
      'for i in pairs(teams) do',
      '  if type(i) == "number" and i >= #starts then teams[i] = nil end',
      'end',
    );
  }
  const resources = Object.entries(changes.resources);
  if (resources.length) lines.push('local resources = sub(t, "resources")', ...resources.map(([key, file]) => `set(resources, ${luaString(key)}, ${file === null ? 'nil' : luaString(file)})`));
  if (changes.dropGrassDist) lines.push('set(sub(sub(t, "custom"), "grassConfig"), "grassDistTGA", nil)');
  const warnings = [];
  for (const key of Object.keys(settings)) {
    if (WRITTEN_ELSEWHERE.has(key) || sameValue(settings[key], openedSettings[key])) continue;
    if (SETTING_PATCHES[key]) lines.push(SETTING_PATCHES[key](settings[key]));
    else warnings.push(`The setting "${key}" is not written to derivative maps yet; the original's value stays.`);
  }
  return { body: lines.join('\n'), warnings };
}

/**
 * mapconfig/lava.lua of the derivative: unchanged lava passes through; lava turned off drops the file; new lava gets
 * BAR Map Studio's lava.lua; changed lava patches the original's level and damage (its tide targets move with the level).
 * @returns {Map<string, Uint8Array|null>} files to write (null: drop that path)
 */
export function lavaFiles(files, doc, openedSettings, credit) {
  const { lava } = doc.settings, path = findPath(files, 'mapconfig/lava.lua') ?? 'mapconfig/lava.lua';
  if (sameValue(lava, openedSettings.lava)) return new Map();
  if (!lava.enabled) return new Map([[path, null]]);
  if (!openedSettings.lava.enabled || !files.has(path)) return new Map([[path, encoder.encode(writeLavaConfig(doc))]]);
  const level = luaNumber(lava.level, 'lava level');
  return wrapLua(files, path, `local delta = ${level} - (t.level or 0)
t.level = ${level}
t.damage = ${luaNumber(lava.damage, 'lava damage')}
for _, step in ipairs(type(t.tideRhythm) == "table" and t.tideRhythm or {}) do
  if type(step) == "table" and type(step[1]) == "number" then step[1] = step[1] + delta end
end`, credit);
}

// Lua that places things by position, as BAR maps ship it; each body moves (dx, dz) elmos and keeps things on the
// w x h elmo map.
const POSITION_FILES = {
  // smoth's feature placer (LuaGaia/Gadgets/FP_featureplacer.lua reads this file): objects, units and buildings.
  'mapconfig/featureplacer/config.lua': `for _, key in ipairs({ "objectlist", "unitlist", "buildinglist" }) do
  local kept = {}
  for _, o in ipairs(type(t[key]) == "table" and t[key] or {}) do
    if type(o) == "table" and type(o.x) == "number" and type(o.z) == "number" then
      o.x, o.z = o.x + DX, o.z + DZ
      if o.x >= 0 and o.z >= 0 and o.x <= W and o.z <= H then kept[#kept + 1] = o end
    else
      kept[#kept + 1] = o
    end
  end
  t[key] = kept
end`,
  // BAR's map-side start boxes: per ally team, polygons of {x, z} points and start points.
  'mapconfig/map_startboxes.lua': `local function move(p)
  if type(p) == "table" and type(p[1]) == "number" and type(p[2]) == "number" then
    p[1] = math.min(W, math.max(0, p[1] + DX))
    p[2] = math.min(H, math.max(0, p[2] + DZ))
  end
end
for _, team in pairs(t) do
  if type(team) == "table" then
    for _, box in ipairs(type(team.boxes) == "table" and team.boxes or {}) do
      for _, p in ipairs(box) do move(p) end
    end
    for _, p in ipairs(type(team.startpoints) == "table" and team.startpoints or {}) do move(p) end
  end
end`,
};

/**
 * Position-placing Lua of a reshaped map, moved with it; other map Lua that may hold positions is named in a warning.
 * @param {{offset: [number, number], to: [number, number]}} move  map units
 * @returns {{files: Map<string, Uint8Array>, warnings: string[]}}
 */
export function positionFiles(files, move, credit) {
  const out = new Map(), [dx, dz] = move.offset.map((v) => v * 512), [w, h] = move.to.map((v) => v * 512);
  for (const [known, body] of Object.entries(POSITION_FILES)) {
    const path = findPath(files, known);
    if (path) for (const [p, bytes] of wrapLua(files, path, `local DX, DZ, W, H = ${dx}, ${dz}, ${w}, ${h}\n${body}`, credit)) out.set(p, bytes);
  }
  const skip = /^mapconfig\/(featureplacer\/|mapinfo\/|lava\.lua$|map_startboxes\.lua$)/i;
  const others = [...files.keys()].filter((p) => /^mapconfig\/.*\.lua$/i.test(p) && !skip.test(p));
  const warnings = others.length
    ? [`Not moved with the map (check them in game; they may place things by position): ${others.join(', ')}`]
    : [];
  return { files: out, warnings };
}
