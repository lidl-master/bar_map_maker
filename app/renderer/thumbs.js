// Template previews (welcome gallery, New Map), made by the generator worker and cached per look.
import { el } from './dom.js';
import { runJob } from './generator.js';
import { icon } from './icons.js';
import { TEAM_COLORS } from './markers.js';

const cache = new Map();

// Each template is previewed in the biome it suits best, on the welcome cards and in New Map alike; picking a welcome
// card starts New Map with that biome.
const SHOWCASE = {
  flat: 'temperate', hills: 'temperate', mountains: 'arctic', mesas: 'desert', canyons: 'redPlanet',
  islands: 'tropical', continents: 'temperate', craters: 'lunar', 'volcano-koth': 'volcanic',
};
export const showcaseBiome = (id) => SHOWCASE[id] ?? 'temperate';

/** Previews for items [{id, symmetry, biome, sx, sz}] with `players` starts → Map(id → {width, height, rgba, starts}). */
export async function templateThumbs(items, players) {
  const key = (item) => `${item.id}|${item.symmetry}|${item.biome}|${item.sx}x${item.sz}|${players}`;
  const missing = items.filter((item) => !cache.has(key(item)));
  if (missing.length) {
    for (const thumb of await runJob('thumbnails', { items: missing, players })) {
      cache.set(key(missing.find((item) => item.id === thumb.id)), thumb);
    }
  }
  return new Map(items.map((item) => [item.id, cache.get(key(item))]));
}

/** An empty preview frame: a shimmer until paintThumb() or thumbFailed() is called. */
export const thumbFrame = () => el('span', { class: 'thumb' }, el('canvas'));

/** Draws a preview at `width` canvas pixels (twice the frame's CSS width), smoothly scaled from the sample image. */
export function paintThumb(frame, { width: w, height: h, rgba, starts }, width) {
  const source = new OffscreenCanvas(w, h), canvas = frame.querySelector('canvas'), scale = width / w;
  source.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  canvas.width = width;
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const r = width / 48; // a team dot about 5 CSS px across at 2×
  starts.forEach(([u, v], team) => {
    ctx.beginPath();
    ctx.arc(u * canvas.width, v * canvas.height, r, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLORS[team % TEAM_COLORS.length];
    ctx.fill();
    ctx.lineWidth = r * 0.4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });
  frame.classList.add('ready');
}

export function thumbFailed(frame) {
  frame.classList.add('failed');
  frame.append(el('span', { class: 'thumb-error' }, icon('triangle-alert'), 'Preview unavailable'));
}
