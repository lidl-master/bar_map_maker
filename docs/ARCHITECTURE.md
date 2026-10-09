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
 * @property {Uint8Array} paint       per heightmap sample, src/look MATERIALS index + 1 painted by the user (0 = auto):
 *                                    1..7 = the biome's role materials (ROLES), 8.. = library materials by id
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
    - `extendMap(doc, {west = 0, east = 0, north = 0, south = 0}) → MapDoc`, whole map units, positive adds and negative crops. The kept part is copied exactly (heights, paint, paintWeight); new ground continues the edge (its slope over a 12-sample seam band, then eases to the map's lower-quartile height over 1.5 units, with low fBm) and has paint 0. Objects shift by (west, north) × 512 elmos; objects outside a crop are dropped (callers report losses by comparing object counts by type). `doc.original`: `tileIndex` / `metalMap` shift by 16 / 32 cells per unit (-1 / 0 in new areas, a crop slices them), `tilesX` / `tilesZ` follow, `offset` (where the archive's map sits, in units) moves by (west, north), everything else (files, tileMips, info, size) is the same reference. Throws a RangeError when a side of the result is not an even 2..32 units, a crop removes the whole map, or a value is not an integer.
    - `resizeMap(doc, sx, sz) → MapDoc`: heights bilinear (elmos, never scaled vertically), paint nearest, object positions scaled; `doc.original.tileIndex` and `metalMap` become null (original textures cannot be rescaled). Throws like `createMap` on a bad size.
    - Symmetry after either: kept when the mode fits the new shape and maps the old map's placement onto itself (a left-right mirror needs equal west and east, rotate 90° all four sides equal, a resize only a square result for square-only modes); otherwise `'none'`. New ground of a kept symmetry is exactly mirrored.
- `src/terrain/index.js` (1.3, pure):
  - `TEMPLATES`: `[{id, label, short?, description, details?, params?, symmetry?, build}]`. `description` is under 60 characters (welcome cards); `details` is the longer text New Map shows when present; `short` is the label for narrow template cards. A template with `symmetry` (Volcano – King of the Hill: `'mirrorX'`) sets it on the doc; the New Map dialog locks it.
  - `falloff(d, hardness) → 0..1`: the brush weight at normalised distance d (the Tool tab draws it).
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
- `src/formats/index.js` (1.1 + 2.2 + 3.3, pure):
  - `buildMapFiles(doc, bakeTexture(plan) → {tiles, minimap, grass, textures}, {quality = 'standard'}) → Map<archivePath, bytes>` (`textures` by mapinfo resources key; checks every resource file is there), `textureFiles(fileBase, plan) → {resourcesKey: fileName}`, `quantizeHeights(heights, keep = null) → {minHeight, maxHeight, raw}` (`keep`: a `[min, max]` range used while every height fits it, so an opened map's untouched heights come back bit-identical), `smfFeatures(doc)` (geo → `GeoVent`, features with name and heading).
  - mapinfo: `mapFileBase(text) → string` (file-system safe; throws when nothing is left), `writeMapInfo(doc, {fileBase, minHeight, maxHeight, maxMetal, textures: {resources, splats}}) → string` (writes `resources` + `splats`), `writeLavaConfig(doc) → string | null`, `luaString(text)`, `luaNumber(value, name)` (the only way values reach generated Lua).
  - Metal: `buildMetalMap(doc)`, `stampSpot(data, width, height, {x, z, metal}, maxMetal) → value` (one 21-pixel disc, replacing the pixels under it), `maxMetalFor(richest)`, `MAX_SPOT_SUM`, `metalObjects(doc)` (checked metal objects).
  - `writeSmf`, `readSmf`, `writeSmt`, `readSmt`, `dedupeTiles`, `encodeDxt1Mips`, `decodeDxt1(bytes, width, height) → Uint8ClampedArray` (RGBA; 3-colour blocks decode index 3 as transparent black), `TILE_BYTES`, `MINIMAP_BYTES`. `concatBytes(arrays) → Uint8Array`. A southern sun (`sunDir` z ≥ 0) fails `writeMapInfo` with the fix in the message (the Look tab's "Move sun north"); derivative exports keep the original's lighting and only warn.
  - DDS (BC1 / BC2 / BC3): `encodeDds(rgba, w, h, format)`, `encodeStrip` + `assembleDds` (strip-wise on workers), `readDdsHeader`, `readDds(bytes) → {width, height, format, levels: Uint8Array[]}` (block-compressed only; throws otherwise), `decodeBlock(bytes, o, format, out16Rgba)`, `encodeBlock(texels, format, out, o)`, `writeDds(levels, w, h, format)`, `levelBytes`, `BLOCK_BYTES`. DDS files store rows bottom-first because the engine (nv_dds) flips them on load; callers pass top-down images.
  - TGA: `decodeTga(bytes) → {width, height, channels: 1|3|4, data (top-down), descriptor}` (uncompressed or RLE, grey or true colour), `encodeTga(image)` (uncompressed, keeps the source's row order flag).
- `src/archive/index.js` (1.1, Node-only): `readArchive(path, only = []) → Map<path, Uint8Array>` (`only`: file name wildcards matched in every folder, e.g. `['*.lua', '*.smf']`; every file when empty), `listArchive(path) → [{path, size}]` (files only, nothing extracted), `writeSd7(files, outPath, {signal}?)` (LZMA2 `-mx=1` since Wave 2; aborting kills 7-Zip and leaves outPath as it was), `TEMP_ROOT`. Both readers list the archive first (`7za l -ba -slt`: entries only, so an archive comment cannot spoof them) and throw `Refused <archive>: its entry "<path>" …` before anything is extracted when an entry is a link or reparse point, has an absolute / drive / `:` path, a `..` part or a control character, is a file that is also a folder of another entry (case-insensitive), or is over 1 GB, or when all entries add up to over 4 GB; formats whose listing has no Attributes (tar) are refused too. After extraction a link in the output fails the read (the output is removed without following it). The bundled 7-Zip is 21.07 (7zip-bin 5.2.0, the latest on npm), which follows link entries out of its output folder: these checks are what keeps it inside.
- `src/bar/index.js` (1.1 + 3.3, Node-only):
  - `exportMap(doc, outDir, {onProgress(fraction, label), quality = 'standard'|'share', signal?, replace = false}) → {archivePath, bytes, passedThrough, regenerated: string[], warnings: string[]}` (reads the material library from `assets/textures/`; `outDir` must exist; the file is `archiveFileName(settings)` = `<mapFileBase(name)>_<mapFileBase(version)>.sd7`, lower case). Refuses (Error `code: 'EXISTS'`, `archivePath`) to write over an existing file unless `replace`; aborting `signal` stops the workers and 7-Zip, deletes the partial archive and rejects with `signal.reason` (an AbortError). A doc with `original` is exported as a derivative (below); it must have its own name or version (Error `code: 'SAME_NAME'`).
  - Derivative export (WP 3.3, `derivative.js`): re-reads `original.archive` (and fails with "changed on disk" unless its listing still matches `original.files`). Every file it does not rebuild passes through byte for byte. Rebuilt: the SMF (heights from the doc in the original's range while they fit; typemap and grass shifted by `original.offset`, 0 / none on new ground; features and starts from the doc; metal: the original metal map unchanged while the doc's metal objects are exactly BAR's spots of it, else only the edited spots rewritten, `deriveMetal`), the SMT (original tile bytes where `tileIndex` ≥ 0, new ground baked with `doc.biome` and blended in at the seam: a 4-tile mirror fade plus a 16-tile colour shift towards the original's edge), the minimap (passed through, or rebuilt from the final tiles' 4×4 mips when reshaped), `mapinfo.lua` (the original's code unchanged inside a function plus a patch of name, version, credits — description "Based on <name> <version> by <author>. …", author "<user> (original by <author>)" —, `mapfile` / `smtFileName0` for the new `maps/<mapFileBase(name)>.smf|smt`, and only what changed: smf min/max height, maxMetal, teams, wind, tidal, gravity, extractor radius, void water, sun direction, dropped resources), `mapconfig/lava.lua` (unchanged / dropped / BAR Map Studio's / patched level and damage). A reshaped map also moves its map-wide textures (mapinfo `resources` splatDistrTex, specularTex, detailNormalTex, skyReflectModTex, lightEmissionTex, parallaxHeightTex, grassShadingTex, and `custom.grassConfig.grassDistTGA`; DDS BC1/2/3 block by block, PNG, TGA; new ground fades to the texture's mean, a flat normal, no emission, no grass; unreadable ones are dropped from mapinfo with a warning) and its position-placing Lua (`mapconfig/featureplacer/config.lua`, `mapconfig/map_startboxes.lua`: shifted, cropped-away entries dropped; other `mapconfig/*.lua` named in a warning). After `resizeMap` nothing of the original lines up: all ground is baked and map-wide textures are dropped (warnings). Pyroclast (16×20) + 4 units east + 2 geos, Standard: ~15 s, 109 MB.
  - `checkDerivative(doc, taken(version)) → {clash, suggestedVersion, licence: {nd, nc, unknown, licence}}` (for the UI before a derivative export; reads only the archive's licence/readme files), `archiveFileName(settings)`, `classifyLicence(text) → {nd, nc}`, `licenceWarnings(original, files)` (mapinfo's licence line and the archive's own LICENSE / COPYING / readme files, not bundled code libraries), `EXPORT_STEPS` (`{map, derivative}`: the progress labels in order; `steps.js` is pure and the renderer imports it).
  - `checkExportDir(dir, mapsDir)` (throws `code: 'BAR_MAPS_DIR'` for the BAR maps folder or a folder inside it), `planInstall(archivePath, {mapsDir}) → {mapsDir, replaces: string[]}`, `installMap(archivePath, {mapsDir}) → Promise<{installedPath, removed: string[]}>` (same replace rule as `planInstall`; copies asynchronously through `<name>.partial`, which a failure removes), `locateBar(root?) → {root, dataDir, mapsDir, engines, headlessEngine, game, sevenZip}`, `MAP_ARCHIVE` (`/\.sd[7z]$/i`), `listMaps(mapsDir) → [{file, name, sizeMB, mtime}]` (by name), `openMapArchive(archive, onProgress?) → {doc, seconds: {extract, import}}` (extracts only `*.lua`, `*.smf`, `*.smt` and lists the rest; `importMap` runs in a worker thread (`import-worker.js`) that is stopped after 10 s with "this map's Lua took too long to read", since the Lua instruction limit cannot interrupt a slow C call; 32×32: 2.5 s), `readMinimapThumb(archive) → {sx, sz, size: 256, dxt1}` (the SMF minimap's 256×256 DXT1 mip).
- `src/import/index.js` (3.1, pure): `importMap(files, {archive, listing}) → Promise<MapDoc>` (symmetry 'none', every object its own group: starts from mapinfo teams, metal spots, `geovent` features as geos, other SMF features as features with `name` and `rot` = rotation × 360 / 65536; settings from mapinfo and `mapconfig/lava.lua`; biome: volcanic with lava, else the closest ground colour; `original.offset = [0, 0]`, `original.size = [sx, sz]`; throws with the reason when the map cannot be read), `readMapData(files, info) → {smfPath, smtPaths, smf, tiles}` (the SMF and its SMTs found as the engine finds them: mapinfo `mapfile` / `smf.smtFileName<n>` first, case-insensitive; `tiles` concatenated in SMF order), `findMetalSpots(metal, width, height, {maxMetal, extractorRadius}) → [{x, z, metal}]` (BAR's spot finder), built from `metalBlobs(metal, width, height) → [{pixels, sum, box}]`, `blobSpot(blob, maxMetal)` and `isMetalField(blobs, extractorRadius)`, `originalPreview(original) → {width, height, rgba}` (tilesX·4 × tilesZ·4, alpha 0 where tileIndex is -1), `originalColor(doc, preview, i, j) → [r, g, b] | null` (the 2D view's look colour on an opened map: paint and water / lava tint over the original texture), `closestBiome(preview) → biome key` (3 parts lowland to 1 part highland colour).
- `src/lua/index.js` (1.2): `readMapInfo(files) → {name, version, author, description, maxMetal, extractorRadius, minHeight, maxHeight, smtFile, sunDir, teams:[{x,z}], lava:{...}|null, voidWater, licence: string|null, raw}` or `{error, line}`; never throws, but a pathological pattern match can run for minutes (run it where it can be stopped, as `openMapArchive` does). `vfsPath(path)`: the engine's VFS form of a path (forward slashes, no leading `./` or `/`, lower case), also used by `readMapData`.
- IPC (`app/ipc.js`, `window.studio`): `locateBar()`, `exportMap(doc, {quality, replace?}) → {archivePath, bytes, report: {passedThrough, regenerated, warnings}} | {exists: archivePath} | {cancelled: true}` (the first export asks for a folder and remembers it in `<userData>/settings.json`; never BAR's maps folder; one export at a time; passes an AbortSignal to src/bar `exportMap`; an existing archive is replaced without asking only when this app wrote it (`exportedFiles` in settings.json), else `{exists}` and the page asks; `report.warnings` show in the export card), `checkDerivative({settings, original}) → {clash, suggestedVersion, licence}`, `cancelExport()` (aborts the running export; it resolves `{cancelled: true}` at once), `showInFolder(archivePath)` (only an archive this session exported), `chooseExportDir() → string | null` (refuses the BAR maps folder), `installMap(archivePath) → {installedPath, removed} | {cancelled: true}` (asks first, naming what it replaces), `onProgress(({label, fraction}) => …)`, `listBarMaps() → [{file, name, sizeMB, mtime}]`, `mapThumb(file) → {sx, sz, size, dxt1}` (cached per archive name, size and mtime in `<userData>/map-thumbs`; written to a temp file and renamed, and a cache file of the wrong length is read again from the archive), `openMap(file?) → MapDoc | {cancelled: true}` (no file: a .sd7/.sdz picker; a file must be in the BAR maps folder; errors name the archive once), `onOpenProgress(({label, fraction}) => …)`, `onFlush(callback)` (before the window closes, the main process sends `studio:flush` and closes on `studio:flushed`, sent when `callback()`'s promise settles, or after 3 s).
- Renderer boot: `#welcome` is `inert` in the markup until `main.js` has bound every handler; then it sets `document.body.dataset.ready = '1'`. App tests wait for `body[data-ready="1"]` before the first interaction.
- Autosave (`app/renderer/autosave.js`, `recent.js`, IndexedDB): a generated map is stored at once, a map opened from an archive from its first change (an untouched one is not stored: the archive has it). Nothing is ever evicted; Recent maps offers Remove (after a confirm; not on the map being edited) and, past ~1 GB of storage (`navigator.storage.estimate()`), a notice suggesting it. Closing the window flushes a pending save (`onFlush`).
