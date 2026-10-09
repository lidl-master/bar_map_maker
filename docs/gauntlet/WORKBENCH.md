# Workbench (live progress)

Updated by the lead. Bars and pace rules: [bars.md](bars.md). Contracts: [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Wave 0: setup â€” done
- Node 24.21 (D:\tools\node, on PATH), git, prototype in `legacy/`, Electron 44 + Playwright, thermo-nuclear skill active.
- Secure Electron skeleton (4 tests; security controls proven by mutation).
- Tools: SMF/SMT validator, BAR locator, headless engine check, blind A/B pairs.
- **Volcano King 1.0 loads in BAR's headless engine**: 900 frames, lava 60â†’59, 90 metal spots, 10 geos, BAR install untouched (SHA-256 of 30,496 entries).
- Critic round 1 blocked the engine-check verdict; round 2 fixed it (exit code + quit frame + map errors; a broken `lava.lua` now fails in 33 s).
- Skipped (pace): engine pick from launcher config, A/B keys outside repo, smf.py unused option, Node â‰¥ 24.2 note.

## Wave 1: working core â€” done
| WP | Scope | Status |
|---|---|---|
| 1.1 | Map files: SMF/SMT/DXT, metal, features, grass, dedupe, mapinfo/lava writers, biomes + simple bake, .sd7 export (workers), install with md5 sidecar | merged (32Ã—32 export 8.9 s; 3 real maps round-trip identical) |
| 1.2 | Sandboxed Lua reader for mapinfo.lua / mapconfig (19-map corpus) | merged (19/19 installed maps parse) |
| 1.3 | Terrain engine: MapDoc, symmetry, history, generators, brushes, placement, Volcano KotH respecting players | merged (exact symmetry; every template respects players) |
| 1.4 | Editor app: app:// protocol, preload IPC, New Map, tools, 2D/3D, pathing view, export/install with confirm | merged |
| smooth | Integrate the four, remove stand-ins, end-to-end: new map â†’ export â†’ engine check | done: 14 mismatches fixed; 53/53 tests; real-app E2E â†’ both maps `ok` in BAR headless (hills 12Ã—12: 38 mex, 4 geo; volcano 16Ã—16 8p: 68 mex, 10 geo, lava 60) |
| critic | One pass, blockers only | folded into the Wave 2 critic pass (pace) |

## Gates
| Gate | Status |
|---|---|
| G0 unit tests | pass (Wave 0) |
| G1 format validator | pass (Wave 0) |
| G2 headless engine load | pass (Wave 0, hardened) |
| G3 in-engine screenshots | Wave 2 |
| G4 code quality | Wave 0 blockers fixed |
| G5 UX journeys | Wave 4 |
| G6 performance | Wave 1 (export â‰¤ 20 s), Wave 4 |
| G7 checklist | Wave 2 |

Screenshots: `screenshots/wave1-*.png`.

## Wave 2: game-standard look + commercial-grade UI â€” building
Brief: [wave2.md](wave2.md). User approved: CC0 texture download, windowed BAR screenshots.

| WP | Scope | Status |
|---|---|---|
| 2.1 | Texture library: 24 CC0 ambientCG materials â†’ albedo, DNTS (layout from the engine shader), thumbnails, licence manifest | merged |
| 2.2 | Full BAR texture stack export | building |
| 2.3 | Tree/rock scatter with BAR built-in features, O(1) object ids | merged |
| 2.4 | Commercial-grade UI: Inter + Lucide, welcome, New Map, editor shell, Look tab, feedback states, 125% layout | merged (61/61 tests) |
| 2.5 | G3 in-engine screenshot tool (fixed camera presets, isolated windowed BAR) | merged |
| critic | Blind UI A/B, Wave 2 vs Wave 1 (3 pairs) | new UI preferred 3/3 (confidence 0.93 / 0.78 / 0.92) |
| critic | Design score, 2 independent critics (pass: 8/10 from both) | 7.0 and 6.6: 3D viewport looks like a debug view, metal badges clutter, truncated hints, spinner-like symmetry glyph, garish pathing colours, dev copy |
| 2.6 | UI polish: 32 fixes from both critics | building |

## Wave 3: open and extend existing maps â€” building (in parallel with the end of Wave 2)
Brief: [wave3.md](wave3.md). 3.1 open + original textures, 3.2 extend/crop/resize: building. 3.3 derivative export: after 2.2.
