// Metal spots, geo vents and start positions. Mirrored copies share a `group` (src/core addObject / moveGroup),
// so selecting or deleting one acts on all of them.

export function groupOf(doc, obj) {
  return obj.group === undefined ? [obj] : doc.objects.filter((o) => o.group === obj.group);
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
  return {
    starts: of('start').length, metal: metal.length, metalTotal: metal.reduce((s, o) => s + o.metal, 0), geos: of('geo').length, features: of('feature').length,
  };
}
