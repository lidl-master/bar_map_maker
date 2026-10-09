# Workbench (live progress)

Updated by the lead. Bars and pace rules: [bars.md](bars.md). Contracts: [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Wave 0: setup — done
- Node 24.21 (D:\tools\node, on PATH), git, prototype in `legacy/`, Electron 44 + Playwright, thermo-nuclear skill active.
- Secure Electron skeleton (4 tests; security controls proven by mutation).
- Tools: SMF/SMT validator, BAR locator, headless engine check, blind A/B pairs.
- **Volcano King 1.0 loads in BAR's headless engine**: 900 frames, lava 60→59, 90 metal spots, 10 geos, BAR install untouched (SHA-256 of 30,496 entries).
- Critic round 1 blocked the engine-check verdict; round 2 fixed it (exit code + quit frame + map errors; a broken `lava.lua` now fails in 33 s).
- Skipped (pace): engine pick from launcher config, A/B keys outside repo, smf.py unused option, Node ≥ 24.2 note.

## Wave 1: working core — done
| WP | Scope | Status |
|---|---|---|
| 1.1 | Map files: SMF/SMT/DXT, metal, features, grass, dedupe, mapinfo/lava writers, biomes + simple bake, .sd7 export (workers), install with md5 sidecar | merged (32×32 export 8.9 s; 3 real maps round-trip identical) |
| 1.2 | Sandboxed Lua reader for mapinfo.lua / mapconfig (19-map corpus) | merged (19/19 installed maps parse) |
| 1.3 | Terrain engine: MapDoc, symmetry, history, generators, brushes, placement, Volcano KotH respecting players | merged (exact symmetry; every template respects players) |
| 1.4 | Editor app: app:// protocol, preload IPC, New Map, tools, 2D/3D, pathing view, export/install with confirm | merged |
| smooth | Integrate the four, remove stand-ins, end-to-end: new map → export → engine check | done: 14 mismatches fixed; 53/53 tests; real-app E2E → both maps `ok` in BAR headless (hills 12×12: 38 mex, 4 geo; volcano 16×16 8p: 68 mex, 10 geo, lava 60) |
| critic | One pass, blockers only | folded into the Wave 2 critic pass (pace) |

## Gates
| Gate | Status |
|---|---|
| G0 unit tests | pass (Wave 0) |
| G1 format validator | pass (Wave 0) |
| G2 headless engine load | pass (Wave 0, hardened) |
| G3 in-engine screenshots | pass (Wave 2: ours preferred in 11/16 blind judgments) |
| G4 code quality | Wave 0 blockers fixed |
| G5 UX journeys | Wave 4 |
| G6 performance | Wave 1 (export ≤ 20 s), Wave 4 |
| G7 checklist | Wave 2 |

Screenshots: `screenshots/wave1-*.png`.

## Wave 2: game-standard look + commercial-grade UI — building
Brief: [wave2.md](wave2.md). User approved: CC0 texture download, windowed BAR screenshots.

| WP | Scope | Status |
|---|---|---|
| 2.1 | Texture library: 24 CC0 ambientCG materials → albedo, DNTS (layout from the engine shader), thumbnails, licence manifest | merged |
| 2.2 | Full BAR texture stack export | merged (90/90 tests; headless ok, 0 map errors; 32×32 Share 36 MB in 14 s, Standard 160 MB in 17 s) |
| 2.3 | Tree/rock scatter with BAR built-in features, O(1) object ids | merged |
| 2.4 | Commercial-grade UI: Inter + Lucide, welcome, New Map, editor shell, Look tab, feedback states, 125% layout | merged (61/61 tests) |
| 2.5 | G3 in-engine screenshot tool (fixed camera presets, isolated windowed BAR) | merged |
| critic | Blind UI A/B, Wave 2 vs Wave 1 (3 pairs) | new UI preferred 3/3 (confidence 0.93 / 0.78 / 0.92) |
| critic | Design score, 2 independent critics (pass: 8/10 from both) | 7.0 and 6.6: 3D viewport looks like a debug view, metal badges clutter, truncated hints, spinner-like symmetry glyph, garish pathing colours, dev copy |
| 2.6 | UI polish: 32 fixes from both critics | merged (30 fixed, 2 partly: 3D marker de-overlap, pathing legend placement; hills 56% → 87.5% vehicle ground) |
| critic | Design re-score after 2.6 (2 fresh critics) | 7.0 and 7.0 (was 7.0 / 6.6). Remaining: 3D depth (gradient, ground grid, contact shadow), tree glyphs in 2D, raw 7-Zip error text, export done/error card actions, sidebar nav vs CTA, open-map card names, units, preset state, stacked modals, generating state |
| 2.8 | UI polish round 2 (re-score findings) | queued until 3.3 / 3.4 / 4.2 merge (same files) |
| G3 critic | Blind in-game look A/B: our hills + volcano exports (mid/close) vs Pyroclast, Supreme Isthmus, Onyx Cauldron, Crimson Bay, Red River (8 pairs × 2 critics) | **ours preferred 11/16 (69%)**, bar ≥ 40%. Lost on: hills terrain reads as noise with brown contour stripes on slopes; volcano cliff walls look streaky/stretched; blocky mirrored layout; flat plateau floors |

## Wave 3: open and extend existing maps — building (in parallel with the end of Wave 2)
Brief: [wave3.md](wave3.md).

| WP | Scope | Status |
|---|---|---|
| 3.1 | Open BAR maps (list + browse), import to MapDoc + `doc.original`, original textures in 2D/3D | merged (19/19 installed maps round-trip exactly; 32×32 opens in 2.7 s; BAR's own spot finder ported) |
| 3.2 | Extend/crop per side in whole units, resize; undoable whole-doc swap; original tile/metal grids shift | merged (71/71 tests; seam ≤ 2 elmos near the old edge) |
| 3.3 | Derivative export: pass-through, new name/version, credit, ND/NC warning, export cancel | building |

## Wave 4: standalone app and UX — started
Brief: [wave4.md](wave4.md).

| WP | Scope | Status |
|---|---|---|
| 4.1 | Settings, offline, cold start, portable build / installer | after Wave 2–3 merges |
| 4.2 | Play-test in BAR vs BARb (isolated, no install), Check map (headless verdict + G7 checklist with one-click fixes) | building |
| 4.3 | Start-box + maps-metadata helpers, G6 bench and perf fixes | after merges (needs a quiet machine for timings) |
| 4.4 | UX driver + 4 persona task-card runs (G5) | after 4.1–4.3 |
| critic | Blockers-only code pass over main (Waves 2–3) | **block**, 4 blockers: 7-Zip 21.07 follows symlink entries in .sdz archives (writes outside temp; reachable from the Open screen); opened-map export keeps the original's name (Install could replace the official map); autosave evicts user maps after 8; app-open test race. Structure passes the thermo-nuclear bar (all files < 500 lines). |
| 3.4 | Safety fixes: pre-extraction archive listing check (links, traversal, sizes), autosave without eviction, boot readiness, Lua import in a worker with timeout, atomic thumbnails, install .partial cleanup, ARCHITECTURE conflict markers | merged (106/106 twice; all 19 installed maps still open). Bundled 7-Zip stays 21.07: the only npm package with 7-Zip 26 (`7zip-bin-full`) is ~80 MB, over the 50 MB pre-approval — user decision |
| 2.7 | In-game look polish from the blind critics' gaps (slope stripes, cliff stretch, plateau detail, other biomes) | building |
