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
| `src/core/` | 1.3 | MapDoc, symmetry, history. Pure. |
| `src/terrain/` | 1.3 | Generators, brushes, erosion, placement, presets. Pure. |
| `src/look/` | 1.1 | Biome palettes and the simple texture bake (replaced by the full texture stack in Wave 2). Pure. |
| `src/formats/` | 1.1 | SMF/SMT/DXT/metal map, mapinfo.lua + lava.lua writers. Pure. |
| `src/archive/`, `src/bar/` | 1.1 | 7-Zip, export pipeline, install to BAR. Node-only. |
| `src/lua/` | 1.2 | Sandboxed Lua reading of mapinfo.lua / mapconfig. Pure (wasmoon). |
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
  - `History`: `begin(doc, label)`, `commit(rect | null)` (null = objects/symmetry/settings only; no entry when nothing changed), `cancel()`, `undo(doc)` / `redo(doc) → {label, rect, …} | null`, `clear()`; `undoStack` / `redoStack` arrays (their lengths drive the Undo/Redo buttons). An entry restores only the parts of objects / symmetry / settings that it changed.
- `src/terrain/index.js` (1.3, pure):
  - `TEMPLATES`: `[{id, label, description, params?, symmetry?, build}]`. A template with `symmetry` (Volcano – King of the Hill: `'mirrorX'`) sets it on the doc; the New Map dialog locks it.
  - `generate(doc, templateId, {players, seed = 1, ...paramOverrides})`: replaces heights and resources (starts, metal, geos for exactly `players`, 2..16); turns lava off unless the template enables it. Does not reset paint.
  - `brush(doc, tool, x, z, {radius, strength, hardness, target?, material?, noiseScale?}, dt) → rect | null`, tool `'raise'|'lower'|'smooth'|'flatten'|'noise'|'paint'` (paint: `material` = MATERIALS index + 1, 0 erases; noise: negative strength subtracts). Applies the dab at every symmetry image: callers call it once.
  - `ramp(doc, a, b, {width, hardness = 0.5}) → rect`, `a`/`b` = `{x, z, h?}` (h defaults to the terrain height). Mirrored like `brush`.
  - `placeResources(doc, {players, metalPerBase = 4, expansions?, geos?, metalValue = 2, flattenBases = true, seed = 1})`, `erode(doc, {amount, seed})`, `limitSlopes(doc, maxDeg)`.
- `src/look/index.js` (1.1, pure): `BIOMES` (`{[key]: {label, sunDir, …colours}}`, keys as in MapDoc.biome; every `sunDir` has z < 0; New Map copies it to `settings.sunDir`), `MATERIALS` (`[{key, label}]`), `previewColor(doc, i, j) → [r, g, b]` (0..255, includes water, void water and lava), `bakeTile(doc, tx, tz) → Uint8ClampedArray` (32×32 RGB), `bakeMinimap(doc) → Uint8ClampedArray` (1024×1024 RGB). Both bakes throw on an unknown biome or paint id.
- `src/formats/index.js` (1.1, pure): `buildMapFiles(doc, bakeTexture) → Map<archivePath, bytes>`, `mapFileBase(text) → string` (file-system safe; throws when nothing is left), `writeMapInfo(doc, {fileBase, minHeight, maxHeight, maxMetal}) → string`, `writeLavaConfig(doc) → string | null`, `buildMetalMap(doc)`, `writeSmf`, `readSmf`, `writeSmt`, `readSmt`, `dedupeTiles`, `encodeDxt1Mips`, `TILE_BYTES`, `MINIMAP_BYTES`.
- `src/archive/index.js` (1.1, Node-only): `readArchive(path) → Map<path, Uint8Array>`, `writeSd7(files, outPath)`, `TEMP_ROOT`.
- `src/bar/index.js` (1.1, Node-only): `exportMap(doc, outDir, {onProgress(fraction, label)}) → {archivePath, bytes}` (`outDir` must exist; the file is `<mapFileBase(name)>_<mapFileBase(version)>.sd7`, lower case), `planInstall(archivePath, {mapsDir}) → {mapsDir, replaces: string[]}`, `installMap(archivePath, {mapsDir}) → {installedPath, removed: string[]}` (same replace rule as `planInstall`), `locateBar(root?) → {root, dataDir, mapsDir, engines, headlessEngine, game, sevenZip}`.
- `src/lua/index.js` (1.2): `readMapInfo(files) → {name, version, author, description, maxMetal, extractorRadius, minHeight, maxHeight, smtFile, sunDir, teams:[{x,z}], lava:{...}|null, voidWater, licence: string|null, raw}` or `{error, line}`; never throws.
- IPC (`app/ipc.js`, `window.studio`): `locateBar()`, `exportMap(doc) → {archivePath, bytes} | {cancelled: true}` (the first export asks for a folder and remembers it in `<userData>/settings.json`), `chooseExportDir() → string | null`, `installMap(archivePath) → {installedPath, removed} | {cancelled: true}` (asks first, naming what it replaces), `onProgress(({label, fraction}) => …)`.
