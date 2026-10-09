// Template previews (welcome gallery, New Map), made by the generator worker and cached per look.
import { el } from './dom.js';
import { runJob } from './generator.js';
import { icon } from './icons.js';
import { TEAM_COLORS } from './view2d.js';

const cache = new Map();

/** Previews for items [{id, symmetry, biome}] with `players` starts → Map(id → {size, rgba, starts}). */
export async function templateThumbs(items, players) {
  const key = (item) => `${item.id}|${item.symmetry}|${item.biome}|${players}`;
  const missing = items.filter((item) => !cache.has(key(item)));
  if (missing.length) {
    for (const thumb of await runJob('thumbnails', { items: missing, players })) {
      cache.set(key(missing.find((item) => item.id === thumb.id)), thumb);
    }
  }
  return new Map(items.map((item) => [item.id, cache.get(key(item))]));
}

/** An empty preview frame: a shimmer until paintThumb() or thumbFailed() is called. */
export const thumbFrame = () => el('span', { class: 'thumb' }, el('canvas', { width: 160, height: 160 }));

export function paintThumb(frame, { size, rgba, starts }) {
  const canvas = frame.querySelector('canvas'), ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(rgba, size, size), 0, 0);
  starts.forEach(([u, v], team) => {
    ctx.beginPath();
    ctx.arc(u * size, v * size, 4, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLORS[team % TEAM_COLORS.length];
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });
  frame.classList.add('ready');
}

export function thumbFailed(frame) {
  frame.classList.add('failed');
  frame.append(el('span', { class: 'thumb-error' }, icon('triangle-alert'), 'Preview unavailable'));
}
