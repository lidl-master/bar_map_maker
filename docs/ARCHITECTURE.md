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
| `src/look/` | 1.1, 2.1, 2.2 | Biomes, the CC0 material library (2.1), auto-texturing rules and the texture-stack bake (2.2). Pure, except `library-load.js` (Node-only, not exported from `index.js`). |
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
 * @property {Uint8Array} paint       per heightmap sample, src/look MATERIALS index + 1 painted by the user (0 = auto):
 *                                    1..7 = the biome's role materials (ROLES), 8.. = library materials by id
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

## Texture stack (WP 2.2)
What an export ships in `maps/` and lists in mapinfo `resources` / `splats`:

| File | Content | Standard | Share |
|---|---|---|---|
| `<base>.smt` | Diffuse: library albedo tiled in world space (1 texel per elmo, a transposed copy blended in by noise against visible tiling), blended by role weights (slope ≤ 27° / 27–54° / > 54° with a ±2° blend frayed by ±~2° of edge noise, height bands with lowland/highland patches, paint with texture-following edges), broad tone, 15% shading from the northern sun plus soft ambient occlusion in creases, dark cliff albedo lifted to read in the shade, erosion streaks on slopes and cliffs, thin wobbly topolines on 2–26° ground | full detail | average material colours, no baked shading, in flat 4×4 blocks (packs ~6× smaller; the DNTS add the grain in-engine) |
| `<base>_splat.dds` | `splatDistrTex`, BC3: weights of the 4 splats from the same per-texel weights (sum 255) | 4 elmos/px | 8 elmos/px |
| `dnts_<id>.png` or `.dds` | `splatDetailNormalTex1..4` from the library; `texScales = 1/tileElmos` (aligned with the baked albedo), `texMults` 0.6–0.8 by class, `splatDetailNormalDiffuseAlpha = 1` | library PNG as is | BC3 DDS |
| `<base>_normal.dds` | `detailNormalTex`, BC1, tangent space relative to the engine's heightmap normal: material relief (albedo luminance gradients, by class), erosion streaks down slopes and cliffs, topoline grooves | 1 elmo/px up to 8192 px | up to 4096 px |
| `<base>_spec.dds` | `specularTex`, BC3: subtle grey intensity by class and albedo brightness, alpha = exponent / 16 | 4 elmos/px | 8 elmos/px |
| SMF grass header | 255 where > 60% of a 32-elmo cell is a `grass*` material, clear of metal, geos and starts | ✓ | ✓ |
| SMF minimap | the bake at 8 elmos/px, lightened (gamma 0.85), water/lava drawn in | ✓ | ✓ |

Archive: 7-Zip `-mx=1` (fast, 1 MB LZMA2 chunks on every core) for both presets; Share is smaller through its content, not the packer.
Measured on a 32×32 rolling-hills map (Ryzen 5 3600, 12 threads, other agents idle): Standard ~17.4 s / ~160 MB, Share ~13.7 s / ~36 MB.

## Module entry points
Actual signatures after Wave 1 smoothing. Grid rects are `[x0, z0, x1, z1]` in heightmap samples, inclusive; positions are elmos.

- `src/core/index.js` (1.3, pure):
  - `SQUARE` (8 elmos per sample), `UNIT` (512 elmos per map unit), `createMap({sx, sz, symmetry = 'none', biome = 'temperate'}) → MapDoc` (flat, height 0; throws on odd/out-of-range sizes or a square-only symmetry on a non-square map).
  - `worldSize(doc) → [w, h]`, `sampleHeight(doc, x, z)` (bilinear), `slopeAt(doc, x, z) → degrees`, `heightRange(doc) → [lo, hi]`.
  - Symmetry: `SYMMETRY` (modes `{label, square?, T, src, depth}`), `symMode(doc)`, `images(doc, x, z) → [[x, z], …]` (one per transform, duplicates kept), `orbit(doc, x, z) → [[x, z, transformIndex], …]` (distinct images, the input point first), `enforceSymmetry(doc, layers)`, `blendSymmetry(doc, array, width)`, `symmetrize(doc, width = 0.02)`.
  - Objects: `addObject(doc, type, x, z, props) → MapObject[]` (the point and its mirrored copies, one new `group`; `[0]` is at (x, z)), `addGroup(doc, type, points, props) → MapObject[]`, `moveGroup(doc, obj, x, z)` (mirrored copies follow).
  - `History`: `begin(doc, label)`, `commit(rect | null)` (null = objects/symmetry/settings only; no entry when nothing changed), `replace(before, after, label)` (one step that swapped in a whole new doc, e.g. a reshape), `cancel()`, `undo(doc)` / `redo(doc) → {label, rect, doc} | null` (`doc` is the doc to show from then on: the other one after a `replace` step, which carries the current `settings` over; otherwise the same), `clear()`; `undoStack` / `redoStack` arrays (their lengths drive the Undo/Redo buttons). An entry restores only the parts of objects / symmetry / settings that it changed.
  - Reshape (WP 3.2; both return a new MapDoc and never modify the input; `settings` deep-copied, `biome` and every other field carried over):
    - `extendMap(doc, {west = 0, east = 0, north = 0, south = 0}) → MapDoc`, whole map units, positive adds and negative crops. The kept part is copied exactly (heights, paint, paintWeight); new ground continues the edge (its slope over a 12-sample seam band, then eases to the map's lower-quartile height over 1.5 units, with low fBm) and has paint 0. Objects shift by (west, north) × 512 elmos; objects outside a crop are dropped (callers report losses by comparing object counts by type). `doc.original`: `tileIndex` / `metalMap` shift by 16 / 32 cells per unit (-1 / 0 in new areas, a crop slices them), `tilesX` / `tilesZ` follow, everything else (files, tiles, info) is the same reference. Throws a RangeError when a side of the result is not an even 2..32 units, a crop removes the whole map, or a value is not an integer.
    - `resizeMap(doc, sx, sz) → MapDoc`: heights bilinear (elmos, never scaled vertically), paint nearest, object positions scaled; `doc.original.tileIndex` and `metalMap` become null (original textures cannot be rescaled). Throws like `createMap` on a bad size.
    - Symmetry after either: kept when the mode fits the new shape and maps the old map's placement onto itself (a left-right mirror needs equal west and east, rotate 90° all four sides equal, a resize only a square result for square-only modes); otherwise `'none'`. New ground of a kept symmetry is exactly mirrored.
- `src/terrain/index.js` (1.3, pure):
  - `TEMPLATES`: `[{id, label, description, params?, symmetry?, build}]`. A template with `symmetry` (Volcano – King of the Hill: `'mirrorX'`) sets it on the doc; the New Map dialog locks it.
  - `generate(doc, templateId, {players, seed = 1, ...paramOverrides})`: replaces heights and resources (starts, metal, geos for exactly `players`, 2..16); turns lava off unless the template enables it. Does not reset paint.
  - `brush(doc, tool, x, z, {radius, strength, hardness, target?, material?, noiseScale?}, dt) → rect | null`, tool `'raise'|'lower'|'smooth'|'flatten'|'noise'|'paint'` (paint: `material` = MATERIALS index + 1, 0 erases; noise: negative strength subtracts). Applies the dab at every symmetry image: callers call it once.
  - `ramp(doc, a, b, {width, hardness = 0.5}) → rect`, `a`/`b` = `{x, z, h?}` (h defaults to the terrain height). Mirrored like `brush`.
  - `placeResources(doc, {players, metalPerBase = 4, expansions?, geos?, metalValue = 2, flattenBases = true, seed = 1})`, `erode(doc, {amount, seed})`, `limitSlopes(doc, maxDeg)`.
- `src/look/index.js` (1.1 + 2.2, pure):
  - `BIOMES` (`{[key]: {label, materials, splats, sunDir, highStart, highEnd, sandTop, snowLine, sky, fog, …}}`, keys as in MapDoc.biome; every `sunDir` has z < 0; New Map copies it to `settings.sunDir`). `materials`: role → library id for the 7 `ROLES` (`ground, high, slope, cliff, sand, seabed, snow`); `splats`: the 4 in-engine splat materials (ground, slope, cliff, shore/snow/special).
  - `MATERIALS` (paint list, `[{key, label, role?, id?}]`): the 7 roles first (resolved per biome, so Wave 1 paint ids and `terrain/volcano.js`'s `'sand'`/`'seabed'` keys keep working), then every `MATERIAL_LIBRARY` entry (`key` = library id). `MATERIAL_LIBRARY` (2.1: `{id, label, class, avgColor, tileElmos, files, …}`).
  - `previewColor(doc, i, j) → [r, g, b]` (0..255; the bake's rules with library average colours, plus water, void water and lava).
  - `QUALITY` (`standard`, `share`), `texturePlan(doc, quality) → {quality, layers: {diffuse, splat, spec, normal}, splats: [{id, scale, mult}×4], dnts: 'png'|'dds'}` (throws on an unknown quality).
  - Bake (used by `src/bar` workers): `bakeMaterials(doc) → id[]` (role + painted materials), `materialTable(albedo, tileElmos) → Float32Array`, `prepareBake(doc, tables: Map<id, table>, layers) → ctx`, `bakeStrip(ctx, tz0, rows) → {rgb, splat, spec, normal, minimap, grass}` (SMT tile rows; RGBA layer strips top-down; splat pixels sum to 255), `finishMinimap(doc, rgb8) → Uint8Array` (1024² RGB), `checkPaint(doc)` (throws on an unknown paint id).
  - `library-load.js` (2.1, Node-only): `TEXTURE_ROOT`, `loadMaterial(id, root?)`, `decodePng`, `encodePng`.
- `src/formats/index.js` (1.1 + 2.2, pure): `buildMapFiles(doc, bakeTexture(plan) → {tiles, minimap, grass, textures}, {quality = 'standard'}) → Map<archivePath, bytes>` (`textures` by mapinfo resources key; checks every resource file is there), `textureFiles(fileBase, plan) → {resourcesKey: fileName}`, `mapFileBase(text) → string` (file-system safe; throws when nothing is left), `writeMapInfo(doc, {fileBase, minHeight, maxHeight, maxMetal, textures: {resources, splats}}) → string` (writes `resources` + `splats`), `writeLavaConfig(doc) → string | null`, `buildMetalMap(doc)`, `writeSmf`, `readSmf`, `writeSmt`, `readSmt`, `dedupeTiles`, `encodeDxt1Mips`, `TILE_BYTES`, `MINIMAP_BYTES`, DDS: `encodeDds(rgba, w, h, 'bc1'|'bc3')`, `encodeStrip` + `assembleDds` (strip-wise on workers), `readDdsHeader`. DDS files store rows bottom-first because the engine (nv_dds) flips them on load; callers pass top-down images.
- `src/archive/index.js` (1.1, Node-only): `readArchive(path) → Map<path, Uint8Array>`, `writeSd7(files, outPath)` (LZMA2 `-mx=1` since Wave 2), `TEMP_ROOT`.
- `src/bar/index.js` (1.1, Node-only): `exportMap(doc, outDir, {onProgress(fraction, label), quality = 'standard'|'share'}) → {archivePath, bytes}` (reads the material library from `assets/textures/`) (`outDir` must exist; the file is `<mapFileBase(name)>_<mapFileBase(version)>.sd7`, lower case), `planInstall(archivePath, {mapsDir}) → {mapsDir, replaces: string[]}`, `installMap(archivePath, {mapsDir}) → {installedPath, removed: string[]}` (same replace rule as `planInstall`), `locateBar(root?) → {root, dataDir, mapsDir, engines, headlessEngine, game, sevenZip}`.
- `src/lua/index.js` (1.2): `readMapInfo(files) → {name, version, author, description, maxMetal, extractorRadius, minHeight, maxHeight, smtFile, sunDir, teams:[{x,z}], lava:{...}|null, voidWater, licence: string|null, raw}` or `{error, line}`; never throws.
- IPC (`app/ipc.js`, `window.studio`): `locateBar()`, `exportMap(doc) → {archivePath, bytes} | {cancelled: true}` (the first export asks for a folder and remembers it in `<userData>/settings.json`), `chooseExportDir() → string | null`, `installMap(archivePath) → {installedPath, removed} | {cancelled: true}` (asks first, naming what it replaces), `onProgress(({label, fraction}) => …)`.
