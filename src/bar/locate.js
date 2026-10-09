// Locates the user's Beyond All Reason install. Node-only. CLI: `node tools/bar/locate.js`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const DEFAULT_ROOT = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Beyond-All-Reason');
export const GAME_TAG = 'byar:test';

const existing = (path) => (existsSync(path) ? path : null);

function listEngines(dataDir) {
  const engineDir = join(dataDir, 'engine');
  if (!existsSync(engineDir)) return [];
  return readdirSync(engineDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => ({ name, dir: join(engineDir, name), headlessExe: existing(join(engineDir, name, 'spring-headless.exe')) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })); // recoil_YYYY.MM.DD: oldest first
}

// Each rapid host keeps byar/versions.gz with lines `tag,packageMd5,dependencies,Game Name`.
function findGame(dataDir) {
  const rapidDir = join(dataDir, 'rapid');
  const hosts = existsSync(rapidDir) ? readdirSync(rapidDir) : [];
  for (const host of hosts) {
    const versions = join(rapidDir, host, 'byar', 'versions.gz');
    if (!existsSync(versions)) continue;
    for (const line of gunzipSync(readFileSync(versions)).toString('utf8').split('\n')) {
      const [tag, md5, , ...name] = line.trim().split(',');
      if (tag !== GAME_TAG) continue;
      const pkg = join(dataDir, 'packages', `${md5}.sdp`);
      return { tag, name: name.join(','), package: pkg, packageExists: existsSync(pkg) };
    }
  }
  return null;
}

export function locateBar(root = DEFAULT_ROOT) {
  const dataDir = join(root, 'data');
  if (!existsSync(dataDir)) throw new Error(`BAR data dir not found: ${dataDir}`);
  const engines = listEngines(dataDir);
  return {
    root,
    dataDir,
    mapsDir: join(dataDir, 'maps'),
    engines,
    headlessEngine: engines.findLast((engine) => engine.headlessExe) ?? null,
    game: findGame(dataDir),
    sevenZip: existing(join(root, 'resources', 'app.asar.unpacked', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')),
  };
}
