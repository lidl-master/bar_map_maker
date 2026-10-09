# Architecture (contracts between work packages)

Builders may change internals freely. Changing a contract below needs a note in your report so the smoothing agent can update the others.

## Processes
- **Main process** (`app/main.js`, Node): window, IPC handlers, file system, 7-Zip, export/install. Heavy work in `worker_threads`.
- **Preload** (`app/preload.cjs`, CommonJS, sandboxed): exposes `window.studio` (the only bridge).
- **Renderer** (`app/renderer/`, sandboxed, no Node): UI, 2D/3D views, sculpting. Heavy terrain work runs in Web Workers. Imports pure ES modules from `src/`.
- Pure modules in `src/` must run in both Node and the browser (no `fs`, no DOM) unless the folder says "Node-only".

## Folders and owners (Wave 1)
| Folder | Owner WP | Notes |
|---|---|---|
| `src/core/` | 1.3 | MapDoc, symmetry, history, reshape (3.2). Pure. |
| `src/terrain/` | 1.3 | Generators, brushes, erosion, placement, presets. Pure. |
| `src/look/` | 1.1 | Biome palettes and the simple texture bake (replaced by the full texture stack in Wave 2). Pure. |
| `src/formats/` | 1.1 | SMF/SMT/DXT/metal map, mapinfo.lua + lava.lua writers. Pure. |
| `src/archive/`, `src/bar/` | 1.1 | 7-Zip, export pipeline, install to BAR. Node-only. |
| `src/lua/` | 1.2 | Sandboxed Lua reading of mapinfo.lua / mapconfig. Pure (wasmoon). |
| `src/import/` | 3.1 | Archive files -> MapDoc with `doc.original`, BAR's metal spot finder, the original-texture preview. Pure (importMap needs wasmoon, so the renderer imports `preview.js` directly). |
| `app/` | 1.4 | Main process, preload, renderer UI. |

## MapDoc (the one shared map model)
```js
/**
 * @typedef {Object} MapDoc
 * @property {number} sx  map width in units (even, 2..32); 1 unit = 512 elmos
 * @property {number} sz  map height in units
 * @property {number} W   heightmap width  = 64*sx + 1
 * @property {number} H   heightmap height = 64*sz + 1
 * @property {Float32Array} heights   elmos, row-major (index = z*W + x), 8 elmos between samples
 * @property {Uint8Array} paint       per heightmap sample, src/look MATERIALS index + 1 painted by the user (0 = auto)
 * @property {Uint8Array} paintWeight per heightmap sample, 0..255
 * @property {string} symmetry  'none'|'mirrorX'|'mirrorZ'|'diag'|'adiag'|'rot180'|'rot90'|'quad'
 * @property {MapObject[]} objects
 * @property {MapSettings} settings
 * @property {string} biome     key of src/look BIOMES: temperate|desert|arctic|volcanic|lunar|redPlanet|tropical
 * @property {OriginalMap} [original]  only on a map opened from an archive (contract in docs/gauntlet/wave3.md)
 */
/**
 * @typedef {Object} MapObject
 * @property {number} id
 * @property {'metal'|'geo'|'start'|'feature'} type
 * @property {number} x  elmos
 * @property {number} z  elmos
 * @property {number} [metal]   in-game value shown on the spot (metal only)
 * @property {string} [name]    feature def name, e.g. 'TreeType3', 'rocks30_moss_07' (feature only)
 * @property {number} [rot]     heading in degrees (feature only)
 * @property {number} [group]   symmetry group id (mirrored copies share it)
 */
/**
 * @typedef {Object} MapSettings
 * @property {string} name
 * @property {string} version
 * @property {string} author
 * @property {string} description
 * @property {number} minWind  0..30
 * @property {number} maxWind  0..30
 * @property {number} tidalStrength 0..25
 * @property {number} gravity
 * @property {number} extractorRadius
 * @property {boolean} voidWater
 * @property {{enabled:boolean, level:number, damage:number}} lava
 * @property {[number,number,number]} sunDir  z < 0 (sun in the north)
 */
```
Start positions: `objects` of type `start`, in team order (team 0 first).

## Module entry points
Actual signatures after Wave 1 smoothing. Grid rects are `[x0, z0, x1, z1]` in heightmap samples, inclusive; positions are elmos.

- `src/core/index.js` (1.3, pure):
  - `SQUARE` (8 elmos per sample), `UNIT` (512 elmos per map unit), `createMap({sx, sz, symmetry = 'none', biome = 'temperate'}) → MapDoc` (flat, height 0; throws on odd/out-of-range sizes or a square-only symmetry on a non-square map).
  - `worldSize(doc) → [w, h]`, `sampleHeight(doc, x, z)` (bilinear), `slopeAt(doc, x, z) → degrees`, `heightRange(doc) → [lo, hi]`.
  - Symmetry: `SYMMETRY` (modes `{label, square?, T, src, depth}`), `symMode(doc)`, `images(doc, x, z) → [[x, z], …]` (one per transform, duplicates kept), `orbit(doc, x, z) → [[x, z, transformIndex], …]` (distinct images, the input point first), `enforceSymmetry(doc, layers)`, `blendSymmetry(doc, array, width)`, `symmetrize(doc, width = 0.02)`.
  - Objects: `addObject(doc, type, x, z, props) → MapObject[]` (the point and its mirrored copies, one new `group`; `[0]` is at (x, z)), `addGroup(doc, type, points, props) → MapObject[]`, `moveGroup(doc, obj, x, z)` (mirrored copies follow).
  - `History`: `begin(doc, label)`, `commit(rect | null)` (null = objects/symmetry/settings only; no entry when nothing changed), `replace(before, after, label)` (one step that swapped in a whole new doc, e.g. a reshape), `cancel()`, `undo(doc)` / `redo(doc) → {label, rect, doc} | null` (`doc` is the doc to show from then on: the other one after a `replace` step, which carries the current `settings` over; otherwise the same), `clear()`; `undoStack` / `redoStack` arrays (their lengths drive the Undo/Redo buttons). An entry restores only the parts of objects / symmetry / settings that it changed.
  - Reshape (WP 3.2; both return a new MapDoc and never modify the input; `settings` deep-copied, `biome` and every other field carried over):
    - `extendMap(doc, {west = 0, east = 0, north = 0, south = 0}) → MapDoc`, whole map units, positive adds and negative crops. The kept part is copied exactly (heights, paint, paintWeight); new ground continues the edge (its slope over a 12-sample seam band, then eases to the map's lower-quartile height over 1.5 units, with low fBm) and has paint 0. Objects shift by (west, north) × 512 elmos; objects outside a crop are dropped (callers report losses by comparing object counts by type). `doc.original`: `tileIndex` / `metalMap` shift by 16 / 32 cells per unit (-1 / 0 in new areas, a crop slices them), `tilesX` / `tilesZ` follow, everything else (files, tileMips, info) is the same reference. Throws a RangeError when a side of the result is not an even 2..32 units, a crop removes the whole map, or a value is not an integer.
    - `resizeMap(doc, sx, sz) → MapDoc`: heights bilinear (elmos, never scaled vertically), paint nearest, object positions scaled; `doc.original.tileIndex` and `metalMap` become null (original textures cannot be rescaled). Throws like `createMap` on a bad size.
    - Symmetry after either: kept when the mode fits the new shape and maps the old map's placement onto itself (a left-right mirror needs equal west and east, rotate 90° all four sides equal, a resize only a square result for square-only modes); otherwise `'none'`. New ground of a kept symmetry is exactly mirrored.
- `src/terrain/index.js` (1.3, pure):
  - `TEMPLATES`: `[{id, label, description, params?, symmetry?, build}]`. A template with `symmetry` (Volcano – King of the Hill: `'mirrorX'`) sets it on the doc; the New Map dialog locks it.
  - `generate(doc, templateId, {players, seed = 1, ...paramOverrides})`: replaces heights and resources (starts, metal, geos for exactly `players`, 2..16); turns lava off unless the template enables it. Does not reset paint.
  - `brush(doc, tool, x, z, {radius, strength, hardness, target?, material?, noiseScale?}, dt) → rect | null`, tool `'raise'|'lower'|'smooth'|'flatten'|'noise'|'paint'` (paint: `material` = MATERIALS index + 1, 0 erases; noise: negative strength subtracts). Applies the dab at every symmetry image: callers call it once.
  - `ramp(doc, a, b, {width, hardness = 0.5}) → rect`, `a`/`b` = `{x, z, h?}` (h defaults to the terrain height). Mirrored like `brush`.
  - `placeResources(doc, {players, metalPerBase = 4, expansions?, geos?, metalValue = 2, flattenBases = true, seed = 1})`, `erode(doc, {amount, seed})`, `limitSlopes(doc, maxDeg)`.
- `src/look/index.js` (1.1, pure): `BIOMES` (`{[key]: {label, sunDir, …colours}}`, keys as in MapDoc.biome; every `sunDir` has z < 0; New Map copies it to `settings.sunDir`), `MATERIALS` (`[{key, label}]`), `previewColor(doc, i, j) → [r, g, b]` (0..255, includes water, void water and lava), `bakeTile(doc, tx, tz) → Uint8ClampedArray` (32×32 RGB), `bakeMinimap(doc) → Uint8ClampedArray` (1024×1024 RGB). Both bakes throw on an unknown biome or paint id.
- `src/formats/index.js` (1.1, pure): `buildMapFiles(doc, bakeTexture) → Map<archivePath, bytes>`, `mapFileBase(text) → string` (file-system safe; throws when nothing is left), `writeMapInfo(doc, {fileBase, minHeight, maxHeight, maxMetal}) → string`, `writeLavaConfig(doc) → string | null`, `buildMetalMap(doc)`, `writeSmf`, `readSmf`, `writeSmt`, `readSmt`, `dedupeTiles`, `encodeDxt1Mips`, `decodeDxt1(bytes, width, height) → Uint8ClampedArray` (RGBA; 3-colour blocks decode index 3 as transparent black), `TILE_BYTES`, `MINIMAP_BYTES`.
- `src/archive/index.js` (1.1, Node-only): `readArchive(path, only = []) → Map<path, Uint8Array>` (`only`: file name wildcards matched in every folder, e.g. `['*.lua', '*.smf']`; every file when empty), `listArchive(path) → [{path, size}]` (files only, nothing extracted), `writeSd7(files, outPath)`, `TEMP_ROOT`.
- `src/bar/index.js` (1.1, Node-only): `exportMap(doc, outDir, {onProgress(fraction, label)}) → {archivePath, bytes}` (`outDir` must exist; the file is `<mapFileBase(name)>_<mapFileBase(version)>.sd7`, lower case), `planInstall(archivePath, {mapsDir}) → {mapsDir, replaces: string[]}`, `installMap(archivePath, {mapsDir}) → {installedPath, removed: string[]}` (same replace rule as `planInstall`), `locateBar(root?) → {root, dataDir, mapsDir, engines, headlessEngine, game, sevenZip}`, `MAP_ARCHIVE` (`/\.sd[7z]$/i`), `listMaps(mapsDir) → [{file, name, sizeMB, mtime}]` (by name), `openMapArchive(archive, onProgress?) → {doc, seconds: {extract, import}}` (extracts only `*.lua`, `*.smf`, `*.smt` and lists the rest; 32×32: 2.6 s), `readMinimapThumb(archive) → {sx, sz, size: 256, dxt1}` (the SMF minimap's 256×256 DXT1 mip).
- `src/import/index.js` (3.1, pure): `importMap(files, {archive, listing}) → Promise<MapDoc>` (symmetry 'none', every object its own group: starts from mapinfo teams, metal spots, `geovent` features as geos, other SMF features as features with `name` and `rot` = rotation × 360 / 65536; settings from mapinfo and `mapconfig/lava.lua`; biome: volcanic with lava, else the closest average colour; throws with the reason when the map cannot be read), `readMapData(files, info) → {smfPath, smtPaths, smf, tiles}` (the SMF and its SMTs found as the engine finds them: mapinfo `mapfile` / `smf.smtFileName<n>` first, case-insensitive; `tiles` concatenated in SMF order), `findMetalSpots(metal, width, height, {maxMetal, extractorRadius}) → [{x, z, metal}]` (BAR's spot finder), `originalPreview(original) → {width, height, rgba}` (tilesX·4 × tilesZ·4, alpha 0 where tileIndex is -1), `originalColor(doc, preview, i, j) → [r, g, b] | null` (the 2D view's look colour on an opened map: paint and water / lava tint over the original texture), `closestBiome(preview) → biome key`.
- `src/lua/index.js` (1.2): `readMapInfo(files) → {name, version, author, description, maxMetal, extractorRadius, minHeight, maxHeight, smtFile, sunDir, teams:[{x,z}], lava:{...}|null, voidWater, licence: string|null, raw}` or `{error, line}`; never throws.
- IPC (`app/ipc.js`, `window.studio`): `locateBar()`, `exportMap(doc) → {archivePath, bytes} | {cancelled: true}` (the first export asks for a folder and remembers it in `<userData>/settings.json`), `chooseExportDir() → string | null`, `installMap(archivePath) → {installedPath, removed} | {cancelled: true}` (asks first, naming what it replaces), `onProgress(({label, fraction}) => …)`, `listBarMaps() → [{file, name, sizeMB, mtime}]`, `mapThumb(file) → {sx, sz, size, dxt1}` (cached per archive name, size and mtime in `<userData>/map-thumbs`), `openMap(file?) → MapDoc | {cancelled: true}` (no file: a .sd7/.sdz picker; a file must be in the BAR maps folder; errors name the archive), `onOpenProgress(({label, fraction}) => …)`.
