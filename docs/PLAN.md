# BAR Map Maker 2: plan

*Status: proposal, nothing built yet. Written 2026-10-09.*

## 1. What we're building

A **standalone Windows desktop app** for making and editing Beyond All Reason maps:

- It **opens any existing BAR map** (`.sd7`/`.sdz`). You can edit it, extend it, crop it, re-texture it or remix it, then save it back as a playable map.
- It produces maps that **look like the maps BAR ships**: proper splat detail textures, normal maps, specular, grass, skybox, trees and rocks. Today we only write a flat painted texture.
- It **installs straight into BAR**, play-tests with one click, and checks maps against BAR's own engine and map checklist.

We build it with a **gauntlet loop**: builder agents make each piece, and separate blind critic agents compare it against real references until it holds up.

### Rules this plan follows

| Source | How it's applied |
|---|---|
| **Gauntlet loop** (Matt Shumer) | Give a destination and a concrete bar, not a route. A lead splits the work into independently judgeable pieces. Builders build. Fresh-context critics inspect the *real artifact* blind (A/B where possible) and name the biggest gap. A smoothing agent runs per wave. Progress is shown on a live workbench page. No arbitrary round limit; stop on quality, diminishing returns or budget. |
| **ponytail** (`DietrichGebert/ponytail`) | Governs **builders**. Before writing code, climb the ladder: does it need to exist? Is it already in the codebase? stdlib? native platform? installed dependency? one line? Only then write the minimum, plus one small test for logic. Never cut validation, error handling, security or accessibility. Mark shortcuts with `shortcut:` comments. Every report ends with what was skipped or unchecked. `/ponytail-review` is one of the code critics. |
| **thermo-nuclear code-quality review** (`SKILL.md` in this repo) | Governs **code critics**. No file may grow past 1,000 lines without a strong reason. No ad-hoc conditionals bolted into unrelated flows. Prefer "code judo" restructuring that deletes complexity. Explicit boundaries, logic in its canonical layer, no thin wrappers. Its approval bar is a blocking gate for every merge. |

ponytail (write less) and thermo-nuclear (structure better) pull the same way: fewer concepts, less code, clear boundaries. Where they seem to conflict, the tiebreak is **delete complexity rather than move it**.

---

## 2. Where we are now (honest assessment)

**Works and verified with independent tools**

- The SMF/SMT writer. Round-tripped through a Python parser; headers, tile counts, metal-spot sums and features are correct.
- BC1 (DXT1) compression.
- The metal map. Spot value = sum × maxMetal / 1000, exact.
- Lava via `mapconfig/lava.lua`, read by BAR's `modules/lava.lua`.
- All 8 symmetry modes are exact and seamless.
- The generators and the Volcano King preset.
- `.sd7` packaging. Matches BAR's own maps: LZMA2, non-solid.

**Gaps and defects** (these become work packages)

1. **Not standalone.** It's a browser page; `.sd7` output needs a separate script.
2. **Can't open existing maps.**
3. **Not game-standard visually.** No splat DNTS textures, no detail normals, specular, grass or skybox, and no features (trees, rocks). Compared with Pyroclast (which ships 4 DNTS splats, a splat distribution, normals and specular), our maps will look flat in game.
4. **The texture doesn't show traversability the way the checklist wants.** BAR's checklist asks for three readable classes: vehicle ground, bot-only slopes and impassable cliffs. Our rock rule triggers around 30°, not on the real 27°/54° limits.
5. **The sun comes from the south.** Our default `sunDir` has z > 0; the checklist says the sun should be in the north.
6. **`js/app.js` is 1,099 lines** (violates the thermo-nuclear rule). Everything shares a global `BMM` namespace, and the scripts depend on load order.
7. **Slow.** Exporting a 32×32 map takes about 80 s on a single thread.
8. **Volcano King has never been loaded by the actual engine.** Structure is verified; behaviour in game is not.
9. **Metal spots are 21-pixel blobs.** The checklist mentions a "default hard pen size of 4px"; we need to confirm what BAR expects.

**Decision: rewrite**, reusing the proven algorithms (SMF/SMT/DXT writers, generators, symmetry, presets, metal-map maths) as modules. The current web app moves to `legacy/` and serves as an **oracle** during the rewrite: new export ≥ old export on every gate. It gets deleted at the end.

---

## 3. Product goals (the destination)

### Make
- Every current feature, plus:
  - export quality presets: **Share** (≤ 50 MB archive), **Standard**, **Max**
  - multi-threaded export (32×32 in ≤ 20 s)
  - writes `.sd7` directly

### Open, edit, extend
- Open any `.sd7`/`.sdz` in the BAR maps folder, or anywhere else.
- Show the original texture, heights, metal spots, geos, features, start positions, lava and water.
- **Lossless pass-through.** Anything the user doesn't touch is written back unchanged: texture tiles, splats, models, LuaGaia, mapconfig, mapoptions.
- **Extend** a map by N map units on any side, blending seamlessly into new terrain.
- **Crop**, **resize**, **make symmetric** (mirror one half), **re-texture** with the library, and edit metal, geos, features, lava and water.
- Name, version and licence handling:
  - Edited maps get a new name or version, because BAR needs unique map names.
  - The original author is credited.
  - Maps marked No-Derivatives get a warning; maps marked Non-Commercial get a notice.

### Look like a real BAR map
- A **texture library** of about 24 CC0 materials, organised by the checklist's traversability classes.
- Each map exports the full BAR texture stack (section 5).

### BAR integration
- Auto-detect the BAR install.
- **Install to BAR**, removing an older copy of the same map.
- **Play-test**: launch BAR with the map against an AI.
- **Check map**: headless engine load, plus BAR checklist checks.
- Generate lobby start-box commands, and a `maps-metadata` entry for anyone who wants to publish.

### Standalone
- A Windows installer plus a portable `.exe`.
- Works fully offline. The texture library is bundled.

### Non-goals (for now)
- Mac/Linux builds
- Online map upload
- Editing unit or feature models
- In-engine editing (SpringBoard already does that)

---

## 4. Key decisions

### 4.1 App shell: **Electron**

| Need | Electron | Tauri | Python + pywebview | PWA |
|---|---|---|---|---|
| Real desktop app / installer | ✓ (~90 MB installer) | ✓ (smallest) | ✓ | ~ (needs a browser) |
| Run 7-Zip, the BAR engine and BAR itself | ✓ child_process | ✓ | ✓ | ✗ |
| Reuse our existing JS unchanged (ponytail rung 2) | ✓ same language for UI and workers | ✗ adds Rust | ✗ adds Python | ✓ |
| Critics can drive and screenshot the **real app** | ✓ Playwright `_electron` | ~ WebDriver only | ✗ | ✓ |
| Toolchain cost on this PC (C: has about 21 GB free, no compilers) | Node only (~100 MB) | Rust + MSVC Build Tools (~6–8 GB) | none | none |

Electron is also what **BAR's own launcher** uses, and it bundles the same `7zip-bin` package. If we later need speed beyond what worker threads give, we can add a WASM module.

### 4.2 Dependency ladder (ponytail): what we reuse instead of writing

| Need | Answer |
|---|---|
| Read/write `.sd7` + `.sdz` | `7zip-bin` (same binary as BAR's launcher; handles both) |
| Evaluate `mapinfo.lua` and friends safely | Small Lua VM (fengari or wasmoon), sandboxed, with stubs for `VFS`, `Spring`, `Game` and Lua 5.1 compatibility shims. Builder picks the VM; the bar is the corpus pass rate. |
| BC1/BC3 compression, DDS/PNG | **Existing code.** Our BC1 encoder plus about 40 lines for the BC3 alpha block and about 60 for the DDS header. Our PNG encoder/decoder is reused. |
| 3D view | three.js (already used), vendored locally for offline use |
| Trees and rocks | **BAR's built-in features.** No models to ship. `TreeType0`–`TreeType15` (BAR overrides these with fir trees) and `rocks30_{def,snow,moss,desert}_01`–`_30`. |
| Lava | BAR's built-in lava (done) |
| Map validation | **`spring-headless.exe`**, already installed with BAR |
| Tests | `node:test` (standard library) |
| UI automation and screenshots | Playwright (dev dependency only) |

### 4.3 Textures: CC0 only
Many maps are CC BY-NC-SA (Pyroclast is), so we **never copy textures out of existing maps** into our library. Library sources are **ambientCG** and **Poly Haven** (both CC0), downloaded by a build script. `assets/textures/LICENSES.md` lists every source URL.

When a user opens someone else's map, *that* map's own textures pass through unchanged inside their edited copy, with the licence notice preserved.

---

## 5. "Game-standard" texture stack (export spec)

Reference: what Pyroclast 1.0.4 ships (read from your installed copy) and what BAR's map checklist asks for.

| mapinfo `resources` key / file | Content | Resolution | Notes |
|---|---|---|---|
| `maps/<name>.smt` | Diffuse bake: library albedo blended by splat weights, plus macro variation and subtle topolines | 8 texels per square | Tile dedupe. Untouched tiles of imported maps are copied byte-for-byte. |
| `splatDetailNormalTex1..4` | 4 DNTS textures: tangent-space normal in RGB, diffuse in A | ≥ 1024² | Checklist minimum is 1024. Exact channel layout to be **confirmed against the engine shader** before building. |
| `splatDistrTex` | RGBA weights for the 4 splats | about 1 px per 4–8 elmos | Balanced, little overlap (checklist) |
| `splatTexScales` / `splatTexMults` | Tiling scales and strengths | | Subtle, not repetitive |
| `detailNormalTex` | Map-wide normals | Up to 1:1 with the texture, within the size budget | Checklist: "highest possible resolution" |
| `specularTex` | Subtle specular (wet sand, lava rock, metal) | ½ resolution | Checklist: not too shiny |
| `atmosphere.skyBox` | Cubemap built from a CC0 HDRI | 2048 per face | Stored in `maps/` (the engine prefixes `maps/`) |
| SMF grass extra header | Grass density map | mapx/4 | Checklist: grass "should be used" |
| SMF minimap | From the bake, slightly lightened | 1024² | |
| SMF features / featureplacer | Trees, rocks, geovents | | Geos on flat pads that fit T2 geo plants (checklist) |

**Traversability readability** (checklist): the auto-texturing rules map directly onto the slope classes.

| Slope | Material class | Example materials |
|---|---|---|
| ≤ 27° (vehicles) | Flat ground | Grass, dirt, sand, snow, ash |
| 27–54° (bots only) | Distinct slope material | Gravel, scree, sandstone |
| > 54° (impassable) | Unmistakable cliff | Granite, basalt, ice cliff |

**Library** (about 24 materials, each with albedo, DNTS and thumbnail):

| Class | Materials |
|---|---|
| Vehicle ground | 2 grass, 2 dirt, 2 sand, snow, ash, mud |
| Bot slopes | 2 gravel/scree, sandstone, rocky dirt |
| Cliffs | Granite, basalt, sandstone cliff, ice cliff |
| Shore | Wet sand, pebbles |
| Special | Cracked lava rock, concrete, metal plates |

**Biome presets** pick 4 splats plus up to 8 bake materials, sky, sun (from the north), fog and water.

---

## 6. Opening and editing existing maps (spec)

### Import pipeline
1. Unpack with 7za.
2. Index all files.
3. Evaluate `mapinfo.lua` (plus `mapconfig/*`) in the Lua sandbox.
4. Parse the SMF:
   - heights: raw uint16 kept, along with min/max
   - type map, metal map, minimap, grass
   - features: named, positioned
   - tile index plus SMT(s)
5. Convert metal map → spot objects (connected components; value = sum × maxMetal / 1000). Keep the original metal map until a spot is edited.
6. Convert features → objects. Kinds: GeoVent, TreeTypeN, rocks30_*, plus the map's own feature types, which pass through.
7. Read `teams` → start positions. Read `mapconfig/lava.lua` → lava settings.

### Display
- Decode SMT tiles at a mip level suited to the zoom.
- For a 32×32 map, the full texture is 16384² (about 1 GB as RGBA), so decode on demand or upload BC1 blocks directly to WebGL (`WEBGL_compressed_texture_s3tc`).

### Editing model: layers over the original
- **Heights:** float edits on top of the original raw heights. An untouched map exports bit-identical heights.
- **Texture:** paint, splat and re-texture edits mark tiles dirty. Only dirty tiles are re-baked and re-encoded.
- **Files we don't understand** (LuaGaia, models, extra textures, mapoptions) pass through unchanged.

### Extend
- Add N units on the N/S/E/W edges.
- One map unit is exactly 16 tiles, so existing tiles shift by whole tiles with **no re-encode**.
- New area comes from a generator (matching theme and biome) and is blended across a seam band of about 1 unit.
- The splat distribution, normals and specular are padded and blended the same way.
- All objects shift. Start positions are optionally re-laid out for the new player count.

### Naming and credit
- On export of an imported map, require a new name, or the same name with a higher version.
- Add "based on <name> by <author>" to the description.
- Carry the licence comment forward and warn on ND/NC.

---

## 7. Bars and references

| Area | Bar (the destination) | Reference the critics compare against |
|---|---|---|
| Format correctness | Engine loads it with **zero** map-related errors in `infolog`. Independent validator passes. | `spring-headless.exe` from your BAR install, plus our Python validator |
| Import fidelity | **All 19 maps** in your BAR maps folder open. Re-exporting untouched gives identical heights, tiles, metal and features (mapid aside). The engine loads the re-export. | The original archives |
| Visual quality | In blind A/B of **in-engine screenshots** (same camera presets: overview, mid, close), critics prefer ours ≥ 40% of the time against top BAR maps. Aspirational: 50%. | Pyroclast, Onyx Cauldron, Crimson Bay, Supreme Isthmus, Red River Remake (installed) |
| Checklist compliance | Every automatable item of BAR's map checklist passes (section 8, G7). | beyondallreason.info/guide/map-checklist |
| Editor UX | A zero-context "new BAR mapper" persona completes the task cards using only the app. Feature parity with SpringBoard's terrain, texture and metal workflow. | SpringBoard (Spring's map editor), plus Gaea / World Machine UX conventions |
| Performance | 32×32 export ≤ 20 s. Opening a 32×32 map ≤ 10 s. Sculpting at 60 fps on 32×32. Memory ≤ 2.5 GB. | Current: 80 s export |
| Code | Thermo-nuclear approval bar met. No file > 1,000 lines (target ≤ 600). No globals. `/ponytail-review` has no blockers. | `SKILL.md` + ponytail rules |
| Archive size | Share preset ≤ 50 MB for any 32×32 map. Standard ≤ 150 MB (BAR's biggest maps are about 150 MB). | Your earlier 50 MB send limit |

---

## 8. Verification gates (objective, automated)

| Gate | What | Tooling |
|---|---|---|
| **G0** | Unit tests for every pure module (formats, symmetry, generators, metal maths) | `node:test` |
| **G1** | Format oracle: an independent Python validator (SMF/SMT/DDS/7z) agrees with our reader/writer. Corpus round-trip of all installed maps. | `tools/validate/*.py` (grows from `smf.py`) |
| **G2** | **Engine load**: `spring-headless.exe` with a generated start script (BAR + NullAI), isolated write-dir. Checks: zero map/Lua errors, lava config loaded when expected, metal spot count matches what BAR's spot finder reports, start-position count. | `tools/engine-harness` (a test-only map-side gadget may report results) |
| **G3** | **In-engine screenshots** at fixed camera presets, for blind visual A/B | `spring.exe` (opens a game window for ~20 s, so this needs your OK) |
| **G4** | Code quality: line budget, no circular imports, thermo-nuclear critic, `/ponytail-review` | Script + critic agents |
| **G5** | UX journeys driven in the real Electron app, with screenshots for each step | Playwright `_electron` |
| **G6** | Performance budget (timed, multi-run median) | Bench script |
| **G7** | BAR checklist automation (list below) | `tools/checklist` |

**G7 checks:**
- Size ≤ 32×32
- Wind 0–30, tidal 0–25
- `teams{}` covers the maximum number of players
- Splats ≥ 1024²
- Grass present
- Sun direction from the north
- Specular mean below a set limit
- Metal spot shapes sane
- Geos fit a T2 geo footprint
- Features have no fixed Y
- Fog sane
- Minimap brightness

---

## 9. Gauntlet loop design

### Roles
- **Lead** (main session):
  - holds this plan, the bars and the blinding keys
  - splits waves into work packages and spawns agents
  - runs the gates and maintains `docs/gauntlet/WORKBENCH.md`, the live page with screenshots, gate results and open gaps
  - never builds and never judges
- **Builders**:
  - one per work package, each in its own **git worktree**
  - receive the goal, bar, gate commands, ponytail rules and relevant file paths, but not how to build it
  - must run the gates before handing back
  - end with *skipped / unchecked / risks*
- **Critics** (fresh context, never the builder):
  - **Format critic**: runs G0–G2 and reads the logs
  - **Visual critic**: blind A/B on screenshots
  - **Code critic**: thermo-nuclear + ponytail-review on the diff
  - **UX critic**: persona working through the task cards
- **Smoothing agent** (once per wave): integrates worktrees, resolves conflicts and unifies UI and naming without redesigning.

### Blind A/B protocol
1. The lead renders the candidate and the reference with the same camera, size and preset.
2. `tools/ab` writes `pair-<n>/A.png` and `B.png` in random order; the key goes in `docs/gauntlet/.keys/` (never shown to critics).
3. The critic gets the bar, the rubric and the two images. It returns `{winner, confidence, gaps: [{severity, what, where}]}`, with the gaps aimed at whichever image lost.
4. The lead unblinds and sends the **single biggest gap** back to the builder.

### Loop for each work package
1. **Build.** The builder implements, runs the gates and reports.
2. **Objective gates.** G0, G1, G2, G4 and G6 must be green. Otherwise the gap goes straight back to the builder, with no critic involved.
3. **Judge.** For visual or UX packages, spawn fresh critics (3 visual pairs or 1 UX persona run). Critics only ever see the artifacts.
4. **Gap.** If the reference wins or a blocker is found, the biggest gap goes back to the builder (a new or continued builder in the same worktree). Repeat.
5. **Stop** when:
   - all gates are green, and
   - critics find no blocker, and
   - the visual bar is met, or two consecutive rounds bring only minor gaps (diminishing returns), or
   - the wave budget is reached, or
   - you say stop.

### Critic prompt skeletons (kept in `docs/gauntlet/critics/`)
- **Visual:** "You're judging BAR terrain screenshots. Bar: <bar>. Rubric: readability of vehicle / bot / cliff areas, texture quality and tiling, lighting (sun from the north, not over-bright), splat balance, believable features, minimap clarity. Pick the better image and list the 3 biggest gaps in the worse one."
- **Code:** the full `SKILL.md`, plus "Also apply the ponytail ladder: flag anything that could be deleted, reused, or replaced by the stdlib or a platform feature. Input: this diff and the file sizes."
- **UX:** "You are new to BAR mapping. Use only what's on screen. Task card: <tasks>. Report where you got stuck, what was unclear, and what you expected to find but didn't."
- **Format:** "Run these commands. Report failures with log excerpts. Do not fix anything."

---

## 10. Waves and work packages

Each wave runs its packages in parallel worktrees. The smoothing agent merges at the end of each wave.

### Wave 0: Setup (lead, no loop; needs your approvals, see section 12)
- `git init` and a baseline commit. Current app moves to `legacy/`.
- Install Node LTS. Scaffold Electron: window, preload, IPC, `src/` module layout with a `node:test` runner.
- **First engine check:** run G2 against the existing Volcano King. This answers open question 8 right away.
- Copy `SKILL.md` to `.claude/skills/thermo-nuclear-code-quality-review/SKILL.md` so `/thermo-nuclear-code-quality-review` works.
- Create the workbench page, the critic prompts and the `tools/ab` script.

### Wave 1: Formats and engine harness (objective bars, ~4 builders)

| WP | Goal | Bar |
|---|---|---|
| 1.1 Archive I/O | Read/write `.sd7`/`.sdz` via 7za | Corpus 19/19. Output matches BAR packaging (LZMA2, non-solid). |
| 1.2 Map reader | SMF/SMT parse, Lua sandbox for mapinfo and mapconfig, metal → spots, features, lava/water | 19/19 maps open. Values match the Python oracle exactly. |
| 1.3 Map writer v2 | Port the writer; tile dedupe, grass header, features (trees/rocks/geos), DDS/BC3, direct `.sd7`, pass-through | Untouched round-trip is identical. G2 green on round-trips of all corpus maps. |
| 1.4 Engine harness | G2 headless load test and G3 screenshot capture with camera presets | Produces JSON reports and screenshots for Volcano King and 3 reference maps |

### Wave 2: Game-standard textures (visual bars, ~3 builders)

| WP | Goal | Bar |
|---|---|---|
| 2.1 Texture library | Fetch CC0 materials and convert to albedo + DNTS + thumbnails, with licence manifest | 24 materials, seamless when tiled 3×3 (critic check), DNTS lighting correct in engine (G3) |
| 2.2 Splats and bake | Distribution authoring (traversability rules + paint), diffuse bake, normals, specular, skybox, topolines, grass, biome presets | Blind A/B vs reference maps ≥ 40% preference; G7 green |
| 2.3 Features | Tree/rock scattering by biome and slope rules, geo pads | Critic: "looks natural, doesn't block chokepoints"; engine loads, features reclaimable |

### Wave 3: Editing existing maps (~3 builders)

| WP | Goal | Bar |
|---|---|---|
| 3.1 Open in editor | Tiled texture display, objects editable, lava/water display | Screenshot fidelity vs the in-engine screenshot (critic); 32×32 opens ≤ 10 s |
| 3.2 Extend / crop / resize / symmetrise | Whole-tile shifts and seam blending | Blind critic can't find the seam more often than chance. G2 green. |
| 3.3 Edit and re-export | Dirty tiles, name/version/credit/licence flow | Edit a corpus map (add a lava pool, extend by 2): untouched tiles bit-identical, G2 green |

### Wave 4: Standalone app and UX (~4 builders)

| WP | Goal | Bar |
|---|---|---|
| 4.1 App shell | Installer, portable exe, BAR detection, Install to BAR, **Play-test in BAR** (launch with a start script vs AI), settings, offline | Clean install ≤ 2 min, cold start ≤ 3 s, works offline |
| 4.2 UI rewrite | Panels and tools as small modules, onboarding, undo for everything, accessibility (keyboard, contrast) | UX persona completes all task cards. G4 green. |
| 4.3 Performance | Worker-thread bake/encode, viewport streaming | G6 budgets met |
| 4.4 Publishing helpers | Export presets (Share ≤ 50 MB), start-box commands, maps-metadata entry, checklist report | G7 report clean. Share preset ≤ 50 MB on 32×32. |

### Wave 5: Polish
- Bugs found by an end-to-end persona run.
- `/ponytail-debt` ledger review.
- Delete `legacy/`.

**UX task cards** (G5 / persona):
1. Make a 2v2 forest map with a river in under 10 minutes and install it.
2. Open Pyroclast, extend it 4 units east, add 2 geos, and save it as "Pyroclast Extended 1.0".
3. Re-texture Volcano King with a different biome and export under 50 MB.
4. Find out why a map fails the checklist and fix it.

---

## 11. Running it in Claude Code

- **Orchestration:** one Workflow script per wave (`.claude/workflows/wave-N.js`). Builders run with `isolation: "worktree"`; critics are fresh agents with no history.
- **Agent count:** this session's default workflow size is "medium" (under 10 agents per run), so each run does **one round** of a wave (for example 3 builders + 3 critics + 1 smoother) and the lead re-runs it until the stop rule is met. To run whole waves continuously you can raise the limit ("Dynamic workflow size" in `/config`, from an interactive `claude` terminal) or say **ultracode**, as the article recommends for big runs.
- **Your view:** `docs/gauntlet/WORKBENCH.md` updates after every round (it can also be published as a live page).
- **Cost:** published gauntlet runs report roughly $400–$1,200 for whole-app builds. We cap spend **per wave**, so you approve each wave separately.

---

## 12. What I need from you before Wave 0

1. **ponytail:** send these as **two separate messages** (sending them together is a known mistake). I can't run `/plugin` commands myself.
   ```
   /plugin marketplace add DietrichGebert/ponytail
   ```
   ```
   /plugin install ponytail@ponytail
   ```
2. **Install Node.js LTS** (~100 MB). It's needed for Electron and the tests, and also for ponytail's hooks. npm packages go into the project on D: (Electron is about 250 MB).
3. **`git init`** in `D:\bar_map_maker`. Worktree-isolated builders need git.
4. **Engine tests:**
   - G2 runs BAR's headless engine, with no window.
   - G3 opens a BAR game window for about 20 s per screenshot set.
   - OK to run both?
5. **CC0 texture downloads** from ambientCG and Poly Haven (about 300 MB raw, about 100 MB processed).
6. **Budget** per wave, and whether to use ultracode.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| The DNTS channel layout or `splatDetailNormalDiffuseAlpha` semantics are wrong | Confirm from the engine shader source in WP 2.1 before building; G3 screenshots verify the result |
| Lua in some mapinfo files uses Spring-specific calls | Stub the common calls. Corpus pass rate is the bar. Unknown calls are logged, not crashed on. |
| 16k² textures exhaust memory | Tile streaming, BC1 upload, worker-side bakes, memory gate in G6 |
| Headless engine can't confirm visuals | G3 uses the real `spring.exe` for screenshots |
| Critics drift toward taste | Rubrics tied to the BAR checklist, fixed camera presets, multiple pairs |
| Licence mistakes | CC0-only library with a manifest; imported maps keep their own licence text; ND/NC warnings |
| Scope creep | ponytail ladder, per-wave budget, non-goals list |

## 14. Open questions
- Should the app also offer a **Linux/Mac** build later? This changes nothing now.
- Do you want **SpringBoard-style in-engine editing**? (Non-goal for now.)
- The metal "hard pen 4px" in the checklist: is that diameter or radius? (WP 1.3 checks real BAR maps in the corpus.)

---

**Sources:**
- Gauntlet loop (method): https://somethingbig.ai/gauntlet-loop and https://www.skills.sh/trilwu/gauntlet-loop-skills/gauntlet-loop
- ponytail: https://github.com/DietrichGebert/ponytail
- BAR map checklist: https://www.beyondallreason.info/guide/map-checklist
- Facts read from your local BAR install:
  - lava: `modules/lava.lua`, `luarules/gadgets/map_lava.lua`
  - features: `features/rocks30.lua`, `features/enginetrees_override.lua`
  - Pyroclast 1.0.4's `mapinfo.lua`
  - `spring-headless.exe` in `data/engine/*`
