// Reads a map archive's mapinfo.lua (+ mapconfig/lava.lua) in a sandboxed Lua 5.4 (wasmoon). Pure: Node and browser.
import { LuaFactory } from 'wasmoon';
import { SANDBOX_LUA } from './sandbox.js';

const MEMORY_LIMIT = 64 * 1024 * 1024; // Lua heap bytes per read
// Names map authors put in mapinfo.lua, e.g. "-- CC BY-NC-SA 4.0 Cinnamon18".
const LICENCE = /\bCC[ -]?BY(?:[ -](?:NC|SA|ND))*(?:[ -]\d\.\d)?|\bCC0\b|\b[AL]?GPL[ -]?v?\d(?:\.\d)?\+?|\bMIT licen[cs]e\b|\bpublic domain\b/i;
const decoder = new TextDecoder();
let factory;

/** Engine-style VFS path: forward slashes, no leading './' or '/', lower case. */
export const vfsPath =(path) => String(path).replaceAll('\\', '/').replace(/^\.?\/+/, '').toLowerCase();
const globToRegExp = (glob) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.')}$`, 'i');

/** The only things map code can reach in the archive. Returns strings/arrays only (they are copied into Lua). */
function vfsHost(files) {
  const byPath = new Map([...files].map(([path, bytes]) => [vfsPath(path), bytes]));
  return {
    readText: (path) => {
      const bytes = byPath.get(vfsPath(path));
      return bytes && decoder.decode(bytes);
    },
    exists: (path) => byPath.has(vfsPath(path)),
    dirList: (dir, pattern = '*', recursive = false) => {
      let prefix = vfsPath(dir);
      if (prefix && !prefix.endsWith('/')) prefix += '/';
      const name = globToRegExp(pattern);
      return [...byPath.keys()].filter((path) => path.startsWith(prefix)
        && (recursive || !path.includes('/', prefix.length))
        && name.test(path.slice(path.lastIndexOf('/') + 1)));
    },
  };
}

const lineOf = (message) => Number(/:(\d+):/.exec(message)?.[1]) || null;
const num = (v) => (typeof v === 'number' ? v : null);
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);

function summarize(raw, lava, source) {
  const sun = Array.isArray(raw.lighting?.sundir) ? raw.lighting.sundir.slice(0, 3) : []; // 4th value: engine-only
  const teams = Object.entries(raw.teams ?? {})
    .map(([key, team]) => [Number(key), team?.startpos])
    .filter(([key, pos]) => Number.isFinite(key) && typeof pos?.x === 'number' && typeof pos?.z === 'number')
    .sort((a, b) => a[0] - b[0])
    .map(([, pos]) => ({ x: pos.x, z: pos.z }));
  return {
    name: str(raw.name),
    version: str(raw.version),
    author: str(raw.author),
    description: str(raw.description),
    maxMetal: num(raw.maxmetal),
    extractorRadius: num(raw.extractorradius),
    minHeight: num(raw.smf?.minheight),
    maxHeight: num(raw.smf?.maxheight),
    smtFile: str(raw.smf?.smtfilename0),
    sunDir: sun.length === 3 && sun.every((n) => typeof n === 'number') ? sun : null, // as written, not normalized
    teams,
    lava,
    voidWater: raw.voidwater === true,
    licence: LICENCE.exec(source)?.[0] ?? null,
    raw,
  };
}

/**
 * Evaluates mapinfo.lua like the engine does with default map options. Never throws.
 * @param {Map<string, Uint8Array>} files archive contents keyed by archive path
 * @returns {Promise<object>} the summary documented in docs/ARCHITECTURE.md, or {error, line}
 *   (`raw` keys are lower case, as the engine sees them; `lava` keeps lava.lua's own keys)
 */
export async function readMapInfo(files) {
  let engine;
  try {
    const vfs = vfsHost(files);
    const source = vfs.readText('mapinfo.lua');
    if (source === undefined) return { error: 'mapinfo.lua not found in the archive', line: null };
    factory ??= new LuaFactory();
    // enableProxy: false is load-bearing: proxies would hand map code live JS objects (a sandbox escape).
    engine = await factory.createEngine({ enableProxy: false, traceAllocations: true });
    engine.global.setMemoryMax(MEMORY_LIMIT);
    const out = JSON.parse(engine.doStringSync(SANDBOX_LUA)(vfs));
    return out.error ? { error: out.error, line: lineOf(out.error) } : summarize(out.mapinfo, out.lava, source);
  } catch (err) {
    const error = String(err?.message ?? err);
    return { error, line: lineOf(error) };
  } finally {
    engine?.global.close();
  }
}
