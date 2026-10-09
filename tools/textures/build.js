// Builds the material library from the maps fetch.js cached: assets/textures/{albedo,dnts,thumbs}/<id>.png,
// manifest.json and LICENSES.md, plus the committed src/look/library-manifest.js. Formats: tools/textures/README.md.
//   node tools/textures/build.js        (or `npm run textures`, which fetches first)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng, encodePng, TEXTURE_ROOT } from '../../src/look/library-load.js';
import { CACHE, DOWNLOADS } from './fetch.js';
import { MATERIALS } from './materials.js';

const SIZE = 1024, THUMB = 128;
const REPO = resolve(import.meta.dirname, '../..');
const DNTS_LAYOUT = 'RGB: tangent-space normal, R = +x (east), G = +z (south, down the rows; a DDS copy needs its rows reversed), B = up; '
  + 'A: diffuse detail, 128 = none, added to the diffuse colour as (A / 255 * 2 - 1) * splat weight';

const luminance = rgb => Float32Array.from({ length: rgb.length / 3 }, (_, i) => 0.2126 * rgb[3 * i] + 0.7152 * rgb[3 * i + 1] + 0.0722 * rgb[3 * i + 2]);
const average = values => values.reduce((sum, v) => sum + v, 0) / values.length;

/** Box blur that wraps around the tile edges; three passes approximate a Gaussian with sigma ≈ radius. */
function blur(values, radius) {
  let a = Float32Array.from(values), b = new Float32Array(values.length);
  for (let pass = 0; pass < 6; pass++) {
    const [step, lineStep] = pass % 2 ? [SIZE, 1] : [1, SIZE]; // even passes run along rows, odd along columns
    for (let line = 0; line < SIZE; line++) {
      const at = i => line * lineStep + ((i + SIZE) % SIZE) * step;
      let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += a[at(i)];
      for (let i = 0; i < SIZE; i++) {
        b[at(i)] = sum / (2 * radius + 1);
        sum += a[at(i + radius + 1)] - a[at(i - radius)];
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

/**
 * Evens out light and shade broader than ~100 px (baked occlusion, uneven capture light), which would show as a
 * grid of blotches once the tile repeats across a map. Colour and fine detail stay.
 */
function delight(rgb) {
  const lum = luminance(rgb), broad = blur(lum, 48), mean = average(lum);
  const out = new Uint8ClampedArray(rgb.length);
  for (let i = 0; i < lum.length; i++) {
    const gain = Math.min(2, Math.max(0.5, mean / Math.max(1, broad[i])));
    for (let c = 0; c < 3; c++) out[3 * i + c] = rgb[3 * i + c] * gain;
  }
  return out;
}

/** BAR's splat detail texture (DNTS): the OpenGL normal map with green flipped, fine luminance detail in alpha. */
function splatDetail(albedo, normal) {
  const lum = luminance(albedo), local = blur(lum, 4);
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const n = i * normal.channels;
    out[4 * i] = normal.data[n];
    out[4 * i + 1] = 255 - normal.data[n + 1]; // OpenGL normal maps point green up the image; BAR's T axis points down it
    out[4 * i + 2] = normal.data[n + 2];
    out[4 * i + 3] = 128 + lum[i] - local[i];
  }
  return out;
}

function downsample(rgb, size) {
  const k = SIZE / size, out = new Uint8ClampedArray(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 3; c++) {
    let sum = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) sum += rgb[((y * k + j) * SIZE + x * k + i) * 3 + c];
    out[(y * size + x) * 3 + c] = sum / (k * k);
  }
  return out;
}

/** Mean colour step across the tile's wrap-around edges ÷ the mean step between neighbouring pixels inside it. */
function seamRatio(rgb) {
  let edge = 0, inside = 0;
  for (let i = 0; i < SIZE; i++) for (let c = 0; c < 3; c++) {
    const px = (x, y) => rgb[(y * SIZE + x) * 3 + c];
    edge += Math.abs(px(SIZE - 1, i) - px(0, i)) + Math.abs(px(i, SIZE - 1) - px(i, 0));
    inside += Math.abs(px(SIZE / 2 - 1, i) - px(SIZE / 2, i)) + Math.abs(px(i, SIZE / 2 - 1) - px(i, SIZE / 2));
  }
  return edge / inside;
}

function readMap(asset, suffix) {
  const dir = join(CACHE, asset), file = readdirSync(dir).find(f => f.endsWith(suffix));
  if (!file) throw new Error(`${dir} has no *${suffix}: run tools/textures/fetch.js`);
  const image = decodePng(readFileSync(join(dir, file)));
  if (image.width !== SIZE || image.height !== SIZE || image.channels < 3) {
    throw new Error(`${file} is ${image.width}×${image.height}×${image.channels}, the library needs ${SIZE}×${SIZE} RGB`);
  }
  return image;
}

const rgbOf = image => image.channels === 3 ? image.data : image.data.filter((_, i) => i % image.channels < 3);
const write = (path, width, data) => writeFileSync(join(TEXTURE_ROOT, path), encodePng({ width, height: width, data }));

const downloads = JSON.parse(readFileSync(DOWNLOADS, 'utf8'));
for (const dir of ['albedo', 'dnts', 'thumbs']) mkdirSync(join(TEXTURE_ROOT, dir), { recursive: true });
const library = [], thumbs = [];
for (const m of MATERIALS) {
  const albedo = delight(rgbOf(readMap(m.asset, '_Color.png')));
  const seam = seamRatio(albedo);
  if (seam > 2) throw new Error(`${m.asset} does not tile: its wrap-around edge steps are ${seam.toFixed(1)}× the inside ones`);
  const files = { albedo: `albedo/${m.id}.png`, dnts: `dnts/${m.id}.png`, thumb: `thumbs/${m.id}.png` };
  const thumb = downsample(albedo, THUMB);
  write(files.albedo, SIZE, albedo);
  write(files.dnts, SIZE, splatDetail(albedo, readMap(m.asset, '_NormalGL.png')));
  write(files.thumb, THUMB, thumb);
  thumbs.push({ class: m.class, thumb });
  const avgColor = [0, 1, 2].map(c => Math.round(average(thumb.filter((_, i) => i % 3 === c))));
  library.push({ id: m.id, label: m.label, class: m.class, avgColor, tileElmos: m.tileElmos, licence: 'CC0', source: 'ambientCG',
    url: `https://ambientcg.com/a/${m.asset}`, sha256: downloads[m.asset].sha256, files });
  console.log(`${m.id.padEnd(18)} ${m.asset.padEnd(15)} seam ${seam.toFixed(2)}  avg ${avgColor.join(',')}`);
}

writeFileSync(join(TEXTURE_ROOT, 'manifest.json'), `${JSON.stringify({ dntsLayout: DNTS_LAYOUT, materials: library }, null, 2)}\n`);
writeFileSync(join(REPO, 'src/look/library-manifest.js'), [
  '// Generated by tools/textures/build.js (`npm run textures`): do not edit. Pure.',
  '// The CC0 material library. `files` are relative to the texture root (TEXTURE_ROOT in library-load.js); DNTS layout:',
  `// ${DNTS_LAYOUT}.`,
  'export const MATERIAL_LIBRARY = [',
  ...library.map(entry => `  ${JSON.stringify(entry)},`),
  '];',
  '',
].join('\n'));
writeFileSync(join(TEXTURE_ROOT, 'LICENSES.md'), [
  '# Texture licences',
  '',
  'Every material is CC0 1.0 (public domain) from ambientCG: https://docs.ambientcg.com/license/',
  'Generated from the 1K-PNG zips by tools/textures/build.js; SHA-256 is of the downloaded zip.',
  '',
  '| Material | Class | Source | Download | SHA-256 |',
  '|---|---|---|---|---|',
  ...MATERIALS.map(m => `| ${m.id} | ${m.class} | https://ambientcg.com/a/${m.asset} | ${downloads[m.asset].url} | \`${downloads[m.asset].sha256}\` |`),
  '',
].join('\n'));

// Contact sheet for a quick look: one row per class.
const classes = [...new Set(MATERIALS.map(m => m.class))];
const columns = Math.max(...classes.map(c => thumbs.filter(t => t.class === c).length));
const sheet = new Uint8ClampedArray(columns * THUMB * classes.length * THUMB * 3).fill(32);
classes.forEach((c, row) => thumbs.filter(t => t.class === c).forEach(({ thumb }, column) => {
  for (let y = 0; y < THUMB; y++) {
    sheet.set(thumb.subarray(y * THUMB * 3, (y + 1) * THUMB * 3), ((row * THUMB + y) * columns * THUMB + column * THUMB) * 3);
  }
}));
mkdirSync(join(REPO, '.engine-tmp'), { recursive: true });
writeFileSync(join(REPO, '.engine-tmp/texture-thumbs.png'), encodePng({ width: columns * THUMB, height: classes.length * THUMB, data: sheet }));
console.log(`${library.length} materials in ${TEXTURE_ROOT}; contact sheet .engine-tmp/texture-thumbs.png (rows: ${classes.join(', ')})`);
