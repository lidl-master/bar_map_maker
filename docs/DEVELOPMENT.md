# Developing BAR Map Studio

How to set up, run, test and change the app. The contracts between modules are in
[ARCHITECTURE.md](ARCHITECTURE.md); the verification tools are in [../tools/README.md](../tools/README.md).

## Setup

| Need | Notes |
|---|---|
| Windows 10/11 x64 | The app, BAR integration and tests are Windows-only for now. |
| Node.js ≥ 24.2 | Uses `import.meta.main` and `import.meta.dirname`. On the original machine Node lives in `D:\tools\node`; tool shells may need it prepended to `PATH`. |
| Git | |
| Python 3.12 (optional) | Only for `tools/validate/smf.py` and its tests (stdlib only). |
| Beyond All Reason (optional) | Needed for import tests, engine checks, Check map, Play-test, Install. Looked up in `%LOCALAPPDATA%\Programs\Beyond-All-Reason`. |

```
npm install          # Electron 44, Playwright, three, wasmoon, 7zip-bin, lucide, Inter
npm run textures     # once: fetch + build the CC0 texture library into assets/textures/ (gitignored)
npm start            # run the app
npm test             # run the tests
```

- `.npmrc` sets the npm cache to `D:\tools\npm-cache` (the original machine's C: drive is small). Remove or change it
  on another machine.
- `tools/textures/fetch.js` caches downloads in `D:\tools\texture-cache\raw` (constant `CACHE`). Change it on a machine
  without a D: drive.
- Worktrees used by agents link `node_modules` and `assets/textures` to the main checkout with directory junctions.
  **Never delete a worktree folder recursively while those junctions exist**: remove the junctions first
  (`[System.IO.Directory]::Delete(path, $false)` in PowerShell), then `git worktree remove`.

## Scripts

| Script | Does |
|---|---|
| `npm start` | `electron .` |
| `npm test` | `node --test "tests/**/*.test.js"` (Node 24 needs the glob; `node --test tests/` does not work) |
| `npm run textures` | `tools/textures/fetch.js` then `tools/textures/build.js` |

## Project structure

```
app/
  main.js            Electron main process: window, app:// protocol + allowlist, permissions, close/flush
  ipc.js             IPC handlers (export, install, open, thumbnails, settings, show in folder)
  ipc-engine.js      IPC for Check map and Play-test
  preload.cjs        the only bridge: window.studio (CommonJS, sandboxed)
  renderer/          the UI (plain ES modules, no framework)
    index.html, css/ design tokens, controls, shell, screens
    main.js          editor state, boot (sets body[data-ready="1"]), doc adoption, undo/redo wiring
    welcome.js, open-map.js, new-map.js, recent.js, autosave.js
    view2d.js, view3d.js, viewport.js, markers.js   2D canvas, three.js 3D view, shared marker drawing
    tools.js, input.js, shortcuts.js                tools, pointer/keyboard input, the one shortcut table
    panels.js, look-panel.js, reshape.js, check-panel.js, playtest-menu.js, export-panel.js, bar-actions.js
    generator.js, gen-worker.js                     terrain jobs in a Web Worker
    dom.js (el(): never innerHTML), icons.js (Lucide), feedback.js (toasts, dialogs, loading)
src/            pure modules (Node + browser) unless marked Node-only; see ARCHITECTURE.md
tests/          node:test; app-*.test.js drive the real app with Playwright's _electron
tools/          validator, engine tools, checklist CLI, A/B tool, texture pipeline
docs/           documentation; docs/gauntlet/ is the build history
legacy/         the first browser prototype (reference only, not maintained)
SKILL.md        the thermo-nuclear code-quality review skill (also in .claude/skills/)
```

## Architecture in one paragraph

The main process owns the file system, 7-Zip, export/install and BAR's engine; heavy work runs in `worker_threads`
(texture bake, map import). The renderer is sandboxed with context isolation and no Node; it talks to the main
process only through `window.studio` (preload). It edits one shared model, the **MapDoc** (heights, paint, objects,
settings, biome, optional `original` for maps opened from an archive), with heavy terrain jobs in Web Workers.
Everything in `src/` that is pure runs in both. Export turns a MapDoc into BAR's files (`src/formats`), bakes the
texture stack from the material library (`src/look`, `src/bar/bake.js`), and packs an `.sd7` (`src/archive`). Read
[ARCHITECTURE.md](ARCHITECTURE.md) for every signature.

## Map formats (short reference)

- **SMF**: 80-byte header (`spring map file\0`, version 1, mapid, mapx, mapy, 8, 8, 32, min/max height, section
  pointers, extra headers: grass is type 1). Heightmap `(mapx+1)×(mapy+1)` uint16, height = min + raw × (max − min) /
  65536. Type map and metal map `mapx/2` per side. Minimap 1024² DXT1 with mips (699,048 bytes). Tile index
  `mapx/4` per side. Features: type names, then 24-byte records.
- **SMT**: 32-byte header, 680-byte tiles (DXT1 32/16/8/4 mips). 1 tile = 32 elmos; 1 map unit = 16 tiles.
- **Metal**: BAR's spot value = sum of a blob's metal pixels × maxMetal / 1000; BAR's spot finder groups 8-connected
  pixels, ignores the outer ring, and finds no spots if a blob spans more than 6 extractor radii.
- **DDS**: written bottom-row-first, because the engine flips DDS on load. PNG/TGA are top-down.
- **DNTS splat detail textures**: RGB = tangent-space normal (R = +x east, G = +z south, B = up), A = additive diffuse
  detail (128 neutral, needs `splatDetailNormalDiffuseAlpha = 1`). `splats.texScales = 1 / tileElmos`.
- **Sun**: `sunDir` z < 0 (sun in the north), as on every installed BAR map. `writeMapInfo` enforces it for new maps.
- **Lava**: map-side `mapconfig/lava.lua`; BAR hides water on lava maps. Keep terrain ≥ 0 where lava is meant.
- **Start boxes** cannot live in a map archive (they come from the lobby); `teams[i].startPos` gives start positions.

## Tests

`npm test` runs everything (about 140 tests, 2–3 minutes). Notes:

- `tests/app-*.test.js` launch the real app with Playwright. Each launches Electron with its **own
  `--user-data-dir` under `.engine-tmp/`**, never the user's real data, and waits for `body[data-ready="1"]` before
  the first interaction. Keep both rules for new app tests.
- Tests that read installed BAR maps (import round trips, derivative export, checklist on Pyroclast) skip when BAR is
  not installed.
- Real-engine tests are gated: set `BAR_ENGINE_TESTS=1` to run `tests/bar/check-engine.test.js` and
  `tests/app-check.test.js` (each engine run is about 1.5 minutes and about 6 GB of RAM).
- The texture-library test skips until `npm run textures` has run.
- One 32 × 32 Share export runs as part of the suite (≤ 50 MB check, about 20 s).
- Python: `python -B -m unittest discover -s tests/tools -p "test_*.py"`.

What is tested by design: binary formats, archive I/O and archive safety, metal maths, import round trips, derivative
export round trips, the engine verdict, checklist rules and fixes, reshape. UI details are not unit-tested; they are
checked by screenshots and design critics.

## Tools

See [../tools/README.md](../tools/README.md) for details.

| Tool | Command |
|---|---|
| SMF/SMT validator | `python tools/validate/smf.py <map.smf> [<map.smt>]` |
| Locate BAR | `node tools/bar/locate.js` |
| Headless engine check (G2) | `node tools/engine/headless-check.js "<Map Name>" [map.sd7]` |
| In-engine screenshots (G3) | `node tools/engine/screenshot.js "<Map Name>" [map.sd7]` (opens a BAR window for ~2 min) |
| Map checklist (G7) | `node tools/checklist/checklist.js [map.sd7 …] [--json]` |
| Blind A/B pairs | `node tools/ab/ab.js <pair-id> <ours.png> <reference.png>` / `--reveal <pair-id>` |
| Texture library | `npm run textures` ([tools/textures/README.md](../tools/textures/README.md)) |

Engine runs are always isolated (`--isolation --isolation-dir "<engine>;<BAR data>"`, a fresh `--write-dir` and
`--config`) and snapshot the BAR install before and after; any change fails the run. Run dirs go to `.engine-tmp/`
(gitignored); delete old ones by hand.

## Rules for changes

From [gauntlet/bars.md](gauntlet/bars.md); they apply to every change:

- **Ladder before code**: does it need to exist, is it already here, standard library, platform, BAR's own assets,
  an installed dependency, one line — then the minimum.
- **Never render user or file text as HTML.** Use `el()` from `app/renderer/dom.js`; there is no `innerHTML` anywhere.
- **Sun in the north** (negative z). **Check every external program's exit code.** No unused options. Heavy work off
  the UI thread. Presets respect the player count.
- **Never write to or delete in the user's BAR folder** except through the confirmed Install. Tests use fake maps
  folders. Never copy textures or models out of other people's maps into the app.
- Mark deliberate shortcuts with a `shortcut:` comment that says when to revisit (`grep -rn "shortcut:" src app`).
- Code quality bar: [../SKILL.md](../SKILL.md) (thermo-nuclear review): no file over 1,000 lines, no ad-hoc branching,
  no dead options.
- New dependencies: small, exact versions (`--save-exact`), at least two weeks old.

## Security model

- Renderer: `sandbox`, `contextIsolation`, no `nodeIntegration`; strict CSP in `index.html` (`default-src 'none'`;
  scripts, styles, images and fonts only from `'self'`; no `base-uri`, no forms); navigation and popups denied; only `clipboard-sanitized-write` permission granted.
- `app://` protocol serves an allowlist of files with a traversal check.
- IPC handlers check the sender's origin and validate arguments; paths for install / show in folder / Check map /
  Play-test must be archives this session exported.
- Archives are listed with `7za l -ba -slt` and refused before extraction if any entry is a link, has an absolute,
  drive, `:` or `..` path, a control character, is a file that is also a folder, or exceeds 1 GB (4 GB total). The
  bundled 7-Zip 21.07 follows link entries, so these checks are what keeps extraction inside its folder.
- Map Lua runs in a wasmoon sandbox (no `io`/`os`/coroutines, instruction and 64 MB memory limits); importing runs in
  a worker thread that is stopped after 10 s.

## How the project was built

The app was built in waves by a lead agent with builder agents in git worktrees, fresh blind critics, blind A/B
comparisons and gates (G0 unit tests, G1 format validator, G2 headless engine load, G3 in-engine screenshots, G4 code
quality, G5 UX journeys, G6 performance, G7 checklist). The history, briefs, critic prompts and reports are in
[gauntlet/](gauntlet/WORKBENCH.md). Current state: [STATUS.md](STATUS.md).
