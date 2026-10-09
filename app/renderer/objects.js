// Metal spots, geo vents and start positions. Placing or moving one also places or moves its mirrored copies
// (same `group`), so every player keeps a fair share.
import { symmetry } from '../../src/core/index.js';
import { clamp } from './dom.js';
import { worldSize } from './sample.js';

const nextId = (doc, key) => Math.max(0, ...doc.objects.map((o) => o[key] ?? 0)) + 1;

export function groupOf(doc, obj) {
  return obj.group === undefined ? [obj] : doc.objects.filter((o) => o.group === obj.group);
}

/** Adds the object and its mirrored copies; returns the one under the cursor. */
export function addObject(doc, type, x, z, props = {}) {
  const group = nextId(doc, 'group');
  let id = nextId(doc, 'id');
  const created = symmetry.orbit(doc, x, z).map(([px, pz]) => ({ id: id++, type, x: px, z: pz, group, ...props }));
  doc.objects.push(...created);
  return created[0];
}

/** Moves obj to (x, z); each mirrored copy goes to the nearest free mirror image of the new spot. */
export function moveObject(doc, obj, x, z) {
  const [w, h] = worldSize(doc);
  obj.x = clamp(x, 0, w);
  obj.z = clamp(z, 0, h);
  const images = symmetry.orbit(doc, obj.x, obj.z).slice(1); // [0] is the spot itself
  for (const other of groupOf(doc, obj).filter((o) => o !== obj)) {
    if (!images.length) break;
    let best = 0;
    images.forEach(([ix, iz], k) => {
      if (Math.hypot(ix - other.x, iz - other.z) < Math.hypot(images[best][0] - other.x, images[best][1] - other.z)) best = k;
    });
    [other.x, other.z] = images.splice(best, 1)[0];
  }
}

export function removeGroup(doc, obj) {
  const group = new Set(groupOf(doc, obj));
  doc.objects = doc.objects.filter((o) => !group.has(o));
}

export function findObject(doc, x, z, radius, types) {
  let best = null, bestDist = radius;
  for (const o of doc.objects) {
    const d = Math.hypot(o.x - x, o.z - z);
    if (types.includes(o.type) && d < bestDist) { best = o; bestDist = d; }
  }
  return best;
}

export function counts(doc) {
  const of = (type) => doc.objects.filter((o) => o.type === type);
  const metal = of('metal');
  return { starts: of('start').length, metal: metal.length, metalTotal: metal.reduce((s, o) => s + o.metal, 0), geos: of('geo').length };
}
