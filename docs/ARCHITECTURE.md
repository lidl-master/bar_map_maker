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
 * @property {Uint8Array} paint       per heightmap sample, material id painted by the user (0 = auto)
 * @property {Uint8Array} paintWeight per heightmap sample, 0..255
 * @property {string} symmetry  'none'|'mirrorX'|'mirrorZ'|'diag'|'adiag'|'rot180'|'rot90'|'quad'
 * @property {MapObject[]} objects
 * @property {MapSettings} settings
 * @property {string} biome     key into src/look biome palettes
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
- `src/core/index.js` (1.3): `createMap({sx, sz, symmetry, biome}) → MapDoc`, `History`, `symmetry` helpers.
- `src/terrain/index.js` (1.3): `TEMPLATES` (list with id, label, needs), `generate(doc, templateId, {players, seed, ...})`, `brush(doc, tool, x, z, params, dt) → dirtyRect|null`, `ramp(doc, a, b, params) → dirtyRect`, `placeResources(doc, {players, ...})`.
- `src/look/index.js` (1.1): `BIOMES`, `previewColor(doc, i, j) → [r,g,b]` (fast, for the 2D view), `bakeTile(doc, tx, tz) → RGB texels` (used by the exporter).
- `src/formats/index.js` (1.1): `writeSmf`, `writeSmt`, `readSmf`, `readSmt`, `buildMetalMap`, `writeMapInfo(doc, extras) → string`, `writeLavaConfig(doc) → string|null`.
- `src/archive/index.js` + `src/bar/index.js` (1.1, Node-only): `readArchive(path) → Map<path, Uint8Array>`, `writeSd7(files, outPath)`, `exportMap(doc, outDir, {onProgress}) → {archivePath, bytes}`, `installMap(archivePath, {replace:true}) → {installedPath, removed[]}`, `locateBar()`.
- `src/lua/index.js` (1.2): `readMapInfo(files) → {name, version, author, description, maxMetal, extractorRadius, minHeight, maxHeight, smtFile, sunDir, teams:[{x,z}], lava:{...}|null, voidWater, licence: string|null, raw}`.
- IPC (1.4 implements, `window.studio`): `locateBar()`, `exportMap(doc) → {archivePath}`, `installMap(archivePath)`, `onProgress(cb)`.
