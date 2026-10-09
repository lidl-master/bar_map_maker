// Downloads each library material's ambientCG 1K-PNG zip into the texture cache (outside the repo), checks it, and
// extracts the two maps build.js uses (*_Color.png, *_NormalGL.png) into <cache>/<asset>/.
//   node tools/textures/fetch.js        (or `npm run textures`, which also builds)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sevenZip from '7zip-bin';
import { MATERIALS } from './materials.js';

// shortcut: a fixed cache on the user's big drive; make it an argument when someone else builds the library.
export const CACHE = 'D:/tools/texture-cache/raw';
export const DOWNLOADS = join(CACHE, 'downloads.json'); // {[asset]: {file, url, bytes, sha256}}

// execFileSync throws on any non-zero exit code.
const sevenZ = args => execFileSync(sevenZip.path7za, [...args, '-bso0', '-bsp0', '-y'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });

async function fetchAsset(asset) {
  const zip = asset.downloadFolders.default.downloadFiletypeCategories.zip.downloads.find(d => d.attribute === '1K-PNG');
  if (!zip) throw new Error(`ambientCG has no 1K-PNG zip for ${asset.assetId}`);
  const path = join(CACHE, zip.fileName);
  if (!existsSync(path) || statSync(path).size !== zip.size) {
    const response = await fetch(zip.downloadLink);
    if (!response.ok) throw new Error(`${zip.downloadLink}: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(`${path}.partial`));
    const bytes = statSync(`${path}.partial`).size;
    if (bytes !== zip.size) throw new Error(`${zip.fileName}: got ${bytes} bytes, ambientCG lists ${zip.size}`);
    renameSync(`${path}.partial`, path);
    console.log(`fetched ${zip.fileName} (${(bytes / 1e6).toFixed(1)} MB)`);
  }
  sevenZ(['t', path]); // checks every entry's CRC
  sevenZ(['e', path, `-o${join(CACHE, asset.assetId)}`, '*_Color.png', '*_NormalGL.png']);
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  return { file: zip.fileName, url: zip.downloadLink, bytes: zip.size, sha256 };
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const ids = MATERIALS.map(m => m.asset);
  const response = await fetch(`https://ambientcg.com/api/v2/full_json?include=downloadData&limit=100&id=${ids.join(',')}`);
  if (!response.ok) throw new Error(`ambientCG API: HTTP ${response.status}`);
  const assets = new Map((await response.json()).foundAssets.map(a => [a.assetId, a]));
  const missing = ids.filter(id => !assets.has(id));
  if (missing.length) throw new Error(`not on ambientCG: ${missing.join(', ')}`);
  const records = {}, queue = [...ids];
  await Promise.all([1, 2, 3, 4].map(async () => {
    while (queue.length) {
      const id = queue.shift();
      records[id] = await fetchAsset(assets.get(id));
    }
  }));
  writeFileSync(DOWNLOADS, `${JSON.stringify(Object.fromEntries(ids.map(id => [id, records[id]])), null, 2)}\n`);
  const total = Object.values(records).reduce((sum, r) => sum + r.bytes, 0);
  console.log(`${ids.length} materials, ${(total / 1e6).toFixed(0)} MB of zips in ${CACHE}`);
}

if (import.meta.main) await main();
