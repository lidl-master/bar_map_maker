# BAR Map Studio: kickoff prompt

Paste everything below the line into Claude Code, opened in `D:\bar_map_maker`.

---

You are the **lead** of a from-scratch build of **BAR Map Studio**, a standalone Windows desktop application for making and editing maps for the RTS game **Beyond All Reason (BAR)**. I opt in to multi-agent orchestration: run this project as a **gauntlet loop** with agents. Work in waves. Stop for my approval at the points listed under "Ask me first".

## 1. What I want (the destination)

An intuitive, easy-to-use app where a new mapper can make a good-looking, fair, playable BAR map. It must:

**Make maps**
- Sizes from 2×2 up to 32×32. BAR's maximum is 32 and each dimension must be even. Rectangular maps are allowed.
- Sculpting tools: raise, lower, smooth, flatten (plateaus), roughen, ramp/road, paint. Full undo/redo.
- Symmetry modes so maps are fair: mirror (both axes, both diagonals), rotate 180°, rotate 90°, quad.
- Terrain generators with templates:
  - hills, mountains, plateaus, canyons, islands, two shores, craters, flat
  - **"Volcano – King of the Hill"**: a one-way uphill assault. Attackers start in the lowlands along one edge and fight up cliff tiers through ramps to the king team on a volcano summit, with lava rivers, lava pools, and metal that gets richer the higher you climb.
- Templates must respect the player count I choose.
- Resources:
  - Metal spots, where the value I type is exactly what BAR shows in game.
  - Geothermal vents, on flat ground big enough for T2 geo plants.
  - Fixed start positions for the maximum player count.
  - Auto-placement of all of these.
- Lava (BAR's own animated lava), water, and void water.
- A **pathing view** using BAR's real limits: vehicles ≤ 27°, bots ≤ 54°, wading depth 20 elmos.

**Look like a real BAR map ("game-standard textures")**
- The same texture stack BAR's own maps ship:
  - diffuse SMT
  - 4 DNTS splat detail textures (≥ 1024²)
  - splat distribution, detail normals, subtle specular
  - skybox, grass map, minimap
- Trees and rocks placed using BAR's built-in features, so no models need shipping.
- A bundled texture library of about 24 materials from **CC0 sources only** (ambientCG, Poly Haven), with a licence manifest. Never copy textures out of other people's maps.
- Auto-texturing that makes traversability readable, following BAR's map checklist:
  - flat ground where vehicles can drive
  - a distinct slope material where only bots can climb
  - unmistakable cliffs where nobody can climb
- Biome presets (temperate, desert, arctic, volcanic/lava, lunar, red planet, tropical) that also set sky, sun, fog and water. **The sun is in the north** (negative z).

**Open and edit existing BAR maps**
- Open any `.sd7` / `.sdz` map, including directly from my BAR maps folder.
- Show the original texture, heights, metal spots, geos, features, start positions, lava and water.
- Edit, **extend** (add map units on any side, blended seamlessly), crop, resize, re-texture, make symmetric, and change metal, geos, features and lava.
- Anything I didn't touch is saved back unchanged: texture tiles, splats, models, Lua, mapconfig.
- On save:
  - require a new name or a higher version, because BAR needs unique map names
  - credit the original author
  - warn when the licence is NoDerivatives or NonCommercial

**BAR integration**
- Auto-detect the BAR install.
- **Install to BAR**:
  - writes a `.sd7`: 7-Zip, LZMA2, non-solid, exactly like BAR's own maps
  - adds the matching `.md5.gz` sidecar
  - never leaves two copies of the same map
- **Check map**:
  - loads the map in BAR's headless engine and reports errors
  - plus a BAR map-checklist report
- **Play-test**: launch BAR with the map against an AI.
- Export quality presets, including **Share (≤ 50 MB)** so I can send maps to friends.
- Lobby start-box suggestions, and help preparing a `maps-metadata` entry if I want to publish.

**Standalone**
- A Windows installer and a portable `.exe`.
- Works fully offline.
- Exports a 32×32 map in ≤ 20 s.
- Opens a 32×32 map in ≤ 10 s.
- Sculpting stays smooth on 32×32.

## 2. How to work

**Process: gauntlet loop** (Matt Shumer's method, https://somethingbig.ai/gauntlet-loop)
- You are the lead. You never build and never judge.
- Split each wave into the smallest independently judgeable work packages.
- Each package gets a **builder** agent in its own git worktree.
- **Critic** agents get fresh context and see only the real artifacts: running app screenshots, exported files, test and engine logs. They never see the builder's reasoning.
- Visual and UX critics judge **blind A/B**: randomised order, and the key is kept from them.
- Send the single biggest gap back to the builder and repeat.
- Run a smoothing agent at the end of each wave.
- Keep a live progress page at `docs/gauntlet/WORKBENCH.md` with screenshots and gate results.
- Stop a package when:
  - all gates are green, critics find no blocker, and the bar is met, **or**
  - two rounds in a row bring only minor gains, **or**
  - the wave budget is reached.
- No fixed round limit.

**Bars and references**
- **Visual:** in-engine screenshots of our maps vs the top BAR maps installed on my PC (Pyroclast, Onyx Cauldron, Crimson Bay, Supreme Isthmus, Red River Remake) at fixed camera presets. Target: critics prefer ours in ≥ 40% of blind pairs.
- **Format:** BAR's own engine loads it with zero map errors.
- **Import:** all maps in my BAR folder open, and an untouched round-trip is identical.
- **Checklist:** https://www.beyondallreason.info/guide/map-checklist
- **UX:** a zero-context "new BAR mapper" persona completes these task cards:
  1. Make a 2v2 forest map with a river in under 10 minutes and install it.
  2. Open Pyroclast, extend it 4 units east, add 2 geos, and save it as a new version.
  3. Re-texture a map with another biome and export it under 50 MB.
  4. Find and fix a checklist failure.

**Verification gates** (all automated, all in the repo)

| Gate | What |
|---|---|
| G0 | Unit tests |
| G1 | An independent format validator plus a round-trip of my installed maps |
| G2 | Headless engine load test with `spring-headless.exe` |
| G3 | In-engine screenshots with `spring.exe` |
| G4 | Code quality: thermo-nuclear review, `/ponytail-review`, file-size limits |
| G5 | UX journeys driven in the real app (Playwright) |
| G6 | Performance budgets |
| G7 | BAR checklist automation |

**Code rules**
- **ponytail** (installed) governs builders:
  - climb the ladder before writing code
  - prefer the standard library, platform features and BAR's own assets
  - mark shortcuts with `shortcut:` comments
  - end every report with what was skipped or unchecked
- Run `/ponytail-review` on every package and `/ponytail-audit` at the end of every wave.
- **thermo-nuclear code-quality review** (`SKILL.md` in this repo, copied to `.claude/skills/` in Wave 0) governs code critics. Its approval bar blocks merges:
  - no file over 1,000 lines
  - no ad-hoc branching
  - logic in its canonical layer
  - no dead options
- **Lessons from the old version's audit** (these are rules now):
  - never render user or file text as HTML
  - sun in the north
  - check every external program's exit code
  - tests live in the repo
  - no unused options
  - heavy work runs off the UI thread
  - presets respect the player count

**Default tech (change it only with a critic-backed reason)**
- Electron, the same stack as BAR's launcher, so critics can drive the real app with Playwright.
- Plain JavaScript ES modules with JSDoc types, and `node:test`.
- `7zip-bin` for archives.
- A sandboxed Lua VM for `mapinfo.lua`.
- three.js, vendored locally.

## 3. Verified facts (don't re-research these)

**BAR install on this PC** (`%LOCALAPPDATA%\Programs\Beyond-All-Reason\`)
- Maps: `data\maps\` (`.sd7` + `.md5.gz`).
- Engines: `data\engine\recoil_*\` (`spring.exe`, `spring-headless.exe`).
- 7-Zip: `resources\app.asar.unpacked\node_modules\7zip-bin\win\x64\7za.exe`.
- Game files: rapid pool in `data\pool` + `data\packages\*.sdp`. These are gzip'd: each entry is a name, md5, crc32 and size.

**Map format**
- SMF: 80-byte header; heightmap uint16 `(mapx+1)²`, height = min + raw × (max − min) / 65536.
- Type and metal maps: `mapx/2` per side.
- Minimap: 1024² DXT1 with 9 mip levels, 699,048 bytes.
- Tile index: `mapx/4` per side, pointing into an SMT. Each SMT tile is 680 bytes: DXT1 mips 32/16/8/4.
- Features: names plus `{type, x, y, z, rot, size}`. y is ignored.
- One map unit = 512 elmos = 64 squares = 16 tiles.

**Gameplay values**
- Metal: in-game spot value = sum(metal pixels) × maxMetal / 1000. BAR groups connected metal pixels into spots.
- Lava:
  - map-side `mapconfig/lava.lua` (`level`, `grow=0`, `tideRhythm`, textures `LuaUI/images/lava/lava2_*`)
  - BAR hides water on lava maps
  - voidWater disables lava
  - keep terrain ≥ 0
- Features:
  - geovents: `GeoVent`
  - trees: `TreeType0`–`15` (BAR draws them as fir trees)
  - rocks: `rocks30_{def,snow,moss,desert}_01`–`_30`
- Start boxes can't be stored in a map; they come from the lobby or `maps-metadata`. `teams[i].startPos` gives the fixed starts.
- Sun direction: all 18 BAR maps installed here use z < 0.

**Reference code**
- The old browser app moves to `legacy/` in Wave 0.
- Use it only as a reference for formats (its SMF/SMT writer and metal maths were verified). Don't build on it.
- `docs/PLAN.md` has the full earlier plan.

## 4. Waves

| Wave | Contents |
|---|---|
| 0 | **Setup**, with my approval: git init, move old code to `legacy/`, install Node LTS, Electron skeleton, test runner, skill copied, workbench, critic prompts, A/B tool. First engine check of the old Volcano King map. |
| 1 | **Formats and engine harness**: archive I/O, map reader (Lua sandbox), map writer v2 (`.sd7`, dedupe, features, grass, DDS), headless load test and screenshot capture. |
| 2 | **Game-standard textures**: CC0 library, splats and bake, normals, specular, skybox, grass, features, biome presets, traversability texturing. |
| 3 | **Editing existing maps**: open, display, edit, extend, crop, resize, symmetrise, re-export with naming, credit and licence rules. |
| 4 | **App and UX**: installer, BAR detection, install, play-test, check, presets incl. Volcano King of the Hill, sculpt/generate/resources UI, Share ≤ 50 MB, performance. |
| 5 | **Polish**: persona runs, `/ponytail-debt` review, delete `legacy/`, README and user guide. |

## 5. Ask me first (always)

- Installing anything: Node, npm packages, Playwright, tools.
- Downloading anything, including the CC0 textures.
- Launching BAR or its engine. I'm fine with the headless one.
- Writing to or deleting anything in my BAR folder.
- Deleting any file of mine.
- Starting each wave. Give me a cost/time estimate for the wave first.

Keep everything on **D:**, because C: is short on space. Never copy textures or models out of other people's maps into the app.

## 6. Reporting

After every wave:
- a short plain-English summary
- screenshots
- the gate table
- open risks and what was skipped
- the next wave's plan and estimate

Then wait for "go".

**Start now with Wave 0.** List exactly what you'll install and change, and wait for my OK.
