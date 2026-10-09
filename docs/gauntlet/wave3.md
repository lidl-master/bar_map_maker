# Wave 3 brief: open, edit and extend existing BAR maps

Bar (from [bars.md](bars.md)): every map in the user's BAR maps folder opens; an untouched round-trip is identical (heights, tiles, metal, features; mapid aside); open 32×32 ≤ 10 s. UX task card 2: "Open Pyroclast, extend it 4 units east, add 2 geos, and save it as a new version."

Rules on top of the usual builder rules:
- The BAR folder is read-only. Opening a map reads the archive; nothing is ever written there except through the existing confirmed Install.
- Never copy textures or models out of someone else's map into the app or its assets. Passing a map's own files through into the user's derivative of that same map is fine, but the export must credit the original author and warn when the licence forbids derivatives or commercial use (ND / NC).

## Contract: `doc.original` (optional on MapDoc)
Set only on a map opened from an archive. Builders may add fields; changing these needs a report note.
```js
/**
 * @typedef {Object} OriginalMap
 * @property {string} archive    path it was opened from (read-only)
 * @property {{name, version, author, description, licence: string|null}} info  from readMapInfo
 * @property {Map<string, Uint8Array>} files  every file of the archive, untouched (pass-through on export)
 * @property {number} tilesX     tiles across = doc.sx * 16 (1 tile = 32 elmos)
 * @property {number} tilesZ     tiles down   = doc.sz * 16
 * @property {Int32Array} tileIndex  tilesX * tilesZ, index into `tiles`; -1 = no original tile (area added by extend)
 * @property {Uint8Array} tiles  SMT tile bytes, 680 per tile, all tile files concatenated in SMF order
 * @property {Uint8Array|null} metalMap  (sx*32) * (sz*32) bytes, shifted with the map; null once metal objects were edited
 * @property {number} maxMetal
 */
```
- Metal spots: shown and edited as `metal` objects (found like BAR's spot finder: connected metal pixels → one spot at the weighted centre, value = sum × maxMetal / 1000). While `metalMap` is non-null the export writes it unchanged.
- Geovents (`GeoVent` feature) become `geo` objects; every other SMF feature becomes a `feature` object with its `name` and `rot`. Start positions come from mapinfo `teams`.
- Settings come from mapinfo (wind, tidal, gravity, extractor radius, void water, sunDir), lava from `mapconfig/lava.lua` when present. `doc.biome` is the closest match (used only for re-texturing and new areas).

## Work packages (parallel)
| WP | Owner folders | Goal |
|---|---|---|
| 3.1 Open | `src/import/` (new, pure), main-process IPC for listing/opening, `app/renderer` open flow + original-texture display | `importMap(files) → doc` with `doc.original`. Welcome "Open existing BAR map": list the BAR maps folder (name, size, minimap thumbnail decoded from the SMF minimap) plus a file picker for any .sd7/.sdz. Show the original texture in 2D and 3D (decode the 4×4 DXT1 mip of each tile: one block per tile, so a 32×32 map is a 2048² preview). Round-trip test over every installed map (skip when BAR is absent). Open 32×32 ≤ 10 s. |
| 3.2 Reshape | `src/core/reshape.js` (new, pure), reshape dialog in `app/renderer` | `extendMap(doc, {west, east, north, south})` in whole units (negative = crop), new terrain continues the edge heights with a smooth falloff and a seam blend; objects shift; `doc.original.tileIndex` / `metalMap` shift with -1 / 0 in new areas. `resizeMap(doc, sx, sz)` resamples heights and objects (drops `original.tileIndex` with a UI warning: original textures cannot be rescaled). Symmetrize already exists. Undoable. |
| 3.3 Derivative export | `src/bar/` | After WP 2.2 lands. Export of a doc with `original`: untouched files pass through byte-for-byte; tiles with index ≥ 0 come from `original.tiles`, new tiles are baked and blended at the seam; require a name or version different from the original; mapinfo credits the original author; ND/NC licence warning in the UI before export. Headless engine check of "Pyroclast + 4 units east + 2 geos". |
| smooth + critic | all | Integrate, update ARCHITECTURE.md, task card 2 end-to-end, one blockers-only critic pass. |
