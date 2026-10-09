// The SMF grass map (one byte per 32-elmo SMT tile; BAR draws grass where it is non-zero and tints the blades with
// the ground colour). The bake grows grass on grassy materials; MapSettings.openGrass grows it on all open ground
// instead (BAR's checklist asks for a grass map, and maps like Pyroclast grow it on rock). Pure.
const TILE = 32; // elmos per grass cell (one SMT tile)
const SAMPLES = TILE / 8; // heightmap squares per cell side
const GRASS_CLEAR = 64; // elmos kept clear of grass around metal spots, geos and start positions
const OPEN_SPAN = TILE * Math.tan((27 * Math.PI) / 180); // corner height span of a cell vehicles can drive across

/** Zeroes the grass cells near metal spots, geos and start positions in rows tz0.. of a grass strip. */
export function clearResources(doc, grass, tz0, tilesX) {
  const rows = grass.length / tilesX, r = GRASS_CLEAR / TILE;
  for (const o of doc.objects) {
    if (o.type === 'feature') continue;
    for (let tz = Math.max(tz0, Math.floor(o.z / TILE - r)); tz <= Math.min(tz0 + rows - 1, Math.floor(o.z / TILE + r)); tz++) {
      for (let tx = Math.max(0, Math.floor(o.x / TILE - r)); tx <= Math.min(tilesX - 1, Math.floor(o.x / TILE + r)); tx++) {
        grass[(tz - tz0) * tilesX + tx] = 0;
      }
    }
  }
  return grass;
}

/** Grass on every cell vehicles can drive across, above water and lava, clear of resources. */
export function openGroundGrass(doc) {
  const tilesX = doc.sx * 16, tilesZ = doc.sz * 16, { W, heights, settings } = doc;
  const floor = settings.lava.enabled ? settings.lava.level : 0; // below 0: water or void
  const grass = new Uint8Array(tilesX * tilesZ);
  for (let tz = 0; tz < tilesZ; tz++) {
    for (let tx = 0; tx < tilesX; tx++) {
      let lo = Infinity, hi = -Infinity;
      for (let j = tz * SAMPLES; j <= (tz + 1) * SAMPLES; j++) {
        for (let i = tx * SAMPLES; i <= (tx + 1) * SAMPLES; i++) {
          const h = heights[j * W + i];
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      if (lo > floor && hi - lo <= OPEN_SPAN) grass[tz * tilesX + tx] = 255;
    }
  }
  return clearResources(doc, grass, 0, tilesX);
}
