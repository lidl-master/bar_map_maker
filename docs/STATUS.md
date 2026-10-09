# Project status

**Development paused on 2026-10-10** at the owner's request. `main` is green: 136 tests pass and 2 real-engine tests
are skipped unless `BAR_ENGINE_TESTS=1` (they passed when last run by hand). Live build log: [gauntlet/WORKBENCH.md](gauntlet/WORKBENCH.md).

## Gates

| Gate | Meaning | Status |
|---|---|---|
| G0 | Unit tests | pass (136/136; one unexplained file-level failure of `tests/bar/export.test.js` seen once under heavy parallel load, not reproduced) |
| G1 | Format validator | pass |
| G2 | BAR's headless engine loads the map with zero map errors | pass (new maps, Volcano King, derivatives of Pyroclast and Sector 318C) |
| G3 | Blind A/B of in-game screenshots vs professional maps (bar ≥ 40%) | pass: ours preferred in 11 of 16 judgments (69%) vs Pyroclast, Supreme Isthmus, Onyx Cauldron, Crimson Bay, Red River |
| G4 | Code quality (thermo-nuclear bar, no file > 1,000 lines) | structure passes (all files < 500 lines); the one critic pass found 4 blockers, all fixed (WP 3.4, 3.3) |
| G5 | Zero-context persona completes the 4 UX task cards | **not run** (WP 4.4) |
| G6 | Performance: 32×32 export ≤ 20 s, open ≤ 10 s, smooth sculpting, cold start ≤ 3 s | export 13.7 s (Share) / 17.4 s (Standard), open 2.7 s; sculpting and cold start **not benchmarked** (WP 4.3, 4.1) |
| G7 | BAR map checklist automated | pass: 15 checks with fixes; our exports pass 15/15; 0 of 19 installed maps fail |
| Design | Two independent design critics ≥ 8/10, blind preference over Wave 1 | blind preference 3/3; scores **7.0 and 7.0** (below the bar; fix list ready) |

## Done

| Wave | Work packages |
|---|---|
| 0 Setup | Electron skeleton with security controls; SMF/SMT validator; BAR locator; headless engine check; blind A/B tool |
| 1 Core | Map files (SMF/SMT/DXT, metal, features, grass, mapinfo/lava writers, .sd7 export on workers, install with md5 sidecar); sandboxed Lua reader; terrain engine (MapDoc, symmetry, history, generators, brushes, placement, Volcano King of the Hill); editor app |
| 2 Look + UI | 2.1 CC0 texture library (24 materials); 2.2 full BAR texture stack export with Share/Standard presets; 2.3 trees/rocks scatter with BAR's features; 2.4 commercial-grade UI redesign; 2.5 in-engine screenshot tool; 2.6 UI polish (32 fixes) |
| 3 Existing maps | 3.1 open BAR maps with original textures (19/19 round-trip exactly); 3.2 extend / crop / resize; 3.3 derivative export (pass-through, seam blend, shifted map-wide textures and Lua placers, name/licence rules, cancel); 3.4 safety fixes (archive checks, autosave, Lua in a worker, flush on close) |
| 4 App + UX | 4.2 Check map (headless verdict + G7 checklist with fixes) and Play-test vs BARb without installing |

## Not done

| Item | State | Where |
|---|---|---|
| **2.7 In-game look polish** | Committed but **not merged or reviewed**: side-projected cliff rock with strata, gradual slope cover, no topolines, neutral map edge, biome light and water, specular back under the checklist mean. Needs a final in-game check, a blind A/B re-run and a merge. | branch `wip/2.7-look-polish` |
| **2.8 UI polish round 2** | Not started (stopped before any change). 26 fixes from the second design review (3D depth, tree glyphs, friendly error text, export done/error actions, sidebar navigation, open-map card names, units, stacked modals, generating state…). | [gauntlet/critics/design-rescore-1.md](gauntlet/critics/design-rescore-1.md) |
| **4.1 Shell + packaging** | Only a cold-start measuring script exists. Still to do: Settings screen (BAR folder, export folder, work folder, autosave), portable data mode, offline proof, cold start ≤ 3 s, portable build (`@electron/packager` + 7-Zip) and possibly an installer. | branch `wip/4.1-shell-packaging`, brief in [gauntlet/wave4.md](gauntlet/wave4.md) |
| **4.3 Publishing + performance** | Not started: lobby start-box suggestions (`startBoxes` exists in `src/bar/playtest.js`), maps-metadata helper, `tools/bench` (G6), perf fixes (History serialises large object lists on each stroke; 32×32 2D repaint ~1–1.6 s). | [gauntlet/wave4.md](gauntlet/wave4.md) |
| **4.4 UX driver + personas (G5)** | Not started. | [gauntlet/wave4.md](gauntlet/wave4.md) |
| **Wave 5 polish** | Not started: persona-run bug fixes, `/ponytail-debt` review, delete `legacy/`, final report. | [PLAN.md](PLAN.md) |

## Known issues and risks

- **Bundled 7-Zip is 21.07** (`7zip-bin` 5.2.0, the newest on npm), which follows symlink entries when extracting
  (CVE-2025-11001/-11002 class). The app refuses such archives before extracting (tested), but a newer 7-Zip would
  remove the risk. The only npm package with 7-Zip 26 (`7zip-bin-full`) is about 80 MB, over the project's 50 MB
  pre-approval: **owner decision**. BAR's own bundled 7-Zip (19.00) has the same issue.
- **Play-test window closed by itself** about 3 minutes after loading in the one real run (cause unknown; the log
  showed the game loaded with BARb). Re-test before relying on it.
- **Derivative exports**: painting over original texture is not exported (the original tile wins; the report warns);
  extended ground is flat lowland, lighter than the original, without splat detail; BAR's game-side per-map configs
  keyed by map name are not carried to a renamed derivative; BMP or uncompressed-DDS map-wide textures would be dropped
  with a warning; resize and crop paths were not engine-tested.
- **Imported maps**: features placed by Lua (featureplacer) are not shown in the editor (they pass through on export);
  the biome guess for re-texturing is rough; game-side lava configs are not read.
- **Southern sun**: new-map export refuses it (with a "Move sun north" fix); derivatives keep the original lighting.
  The installed Wave 1 `volcano_king_1.0.sd7` has a southern sun.
- **Performance**: the 32×32 Standard export has ~2.5 s of margin under 20 s; reshape runs on the UI thread (~0.27 s
  worst case); a full 2D repaint of a 32×32 map takes ~1–1.6 s; undo of a reshape keeps a whole doc (~25 MB).
- **Feature density**: the default (0.4) gives 11–18k features on a 32×32 map; in-game performance not measured.
- **Hard-coded D: paths**: `.npmrc` (npm cache) and `tools/textures/fetch.js` (download cache).
- **Engine choice**: the newest installed engine is used; BAR's launcher may prefer another.
- **125% display scaling** was only simulated with Electron's zoom factor, not real Windows scaling.
- **Autosave** stores whole maps in IndexedDB under `%APPDATA%\bar-map-studio` (on C:); a 32×32 map is about 25 MB.

## Decisions for the owner

1. Ship a newer 7-Zip (`7zip-bin-full`, ~80 MB) or keep 21.07 behind the archive checks?
2. Installer: a portable zip is within the current approvals; an NSIS installer or single-file exe via
   electron-builder likely needs a larger package (to be confirmed in WP 4.1).
3. A licence for the project itself (currently `UNLICENSED`, all rights reserved).
4. Whether to resume with 2.7 merge → 2.8 → 4.1 → 4.3 → 4.4 → Wave 5 (the planned order).

## Resuming

1. `git checkout main && npm install && npm run textures && npm test`.
2. Review and merge `wip/2.7-look-polish` (re-run G3 screenshots and the blind A/B; check the 20 s export budget).
3. Run WP 2.8 from [gauntlet/critics/design-rescore-1.md](gauntlet/critics/design-rescore-1.md), then re-score with
   two fresh design critics.
4. Continue Wave 4 from [gauntlet/wave4.md](gauntlet/wave4.md) (4.1, 4.3, then 4.4), then Wave 5.
