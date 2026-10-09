# Verification tools

Used by builders and critics. Node is at `D:\tools\node` (put it on `PATH`); Python 3.12, stdlib only.

| Tool | Run | Output |
|---|---|---|
| SMF/SMT validator | `python tools/validate/smf.py <map.smf> [<map.smt>]` | JSON report; exit 0 valid, 1 invalid |
| BAR locator | `node tools/bar/locate.js` | JSON: BAR root, data/maps dirs, engines, newest headless engine, `byar:test` game, BAR's 7-Zip |
| Headless engine check | `node tools/engine/headless-check.js "<Map Name>" [map.sd7]` | JSON report; exit 0 when `ok`, else 1 |
| In-engine screenshots (G3) | `node tools/engine/screenshot.js "<Map Name>" [map.sd7] [--out <dir>]` | `overview/mid/close.png` + `report.json` in `.engine-tmp/g3/<map-id>/`; exit 0 when `ok` |
| Blind A/B pairs | `node tools/ab/ab.js <pair-id> <ours.png> <reference.png>` / `--reveal <pair-id>` | `docs/gauntlet/ab/<pair-id>/A.png, B.png`; key in `docs/gauntlet/.keys/` (gitignored) |

## Tests

```
node --test "tests/**/*.test.js"
python -B -m unittest discover -s tests/tools -p "test_*.py"
```

(`node --test tests/` does not work: Node 24 needs a file or glob. `-B` keeps `__pycache__` out of the tree.)

## Validator

Checks the SMF header (magic, version 1, squareSize 8, texelPerSquare 8, tilesize 32, map size a multiple of 128),
that every section (and the grass map of a vegetation extra header) lies inside the file without overlapping,
tile header and tile indices against the tile count, each SMT (magic, version 1, tileSize 32, compression 1,
size = 32 + numTiles × 680, enough tiles), and features (type names, type indices, positions inside the map).
`metalSpots` lists 8-connected groups of non-zero metal-map pixels with centroid (elmos), pixel count and pixel sum.
BAR shows a spot's value as `sum × maxMetal / 1000` (`maxMetal` is in `mapinfo.lua`).

To validate a map archive, extract it with BAR's 7-Zip into `.engine-tmp/` first (never into the BAR folder):

```
<sevenZip from locate.js> x <map.sd7> -o.engine-tmp/extract/<name> -y
python tools/validate/smf.py .engine-tmp/extract/<name>/maps/<Name>.smf
```

## Headless engine check

Starts a real BAR game on the map with `spring-headless.exe` (spectator host, NullAI vs NullAI, start boxes
left/right) and a small user widget that logs `[MapCheck]` lines (frame, `lavaLevel`, `mex_count`, geo spots)
and quits at frame 900 (30 s game time). Hard timeout 6 minutes; Ctrl+C also stops the engine.
A run takes about 1.5–2 minutes: a fresh write dir means the engine re-checksums the game package first.
An optional archive path is copied into the run's own `maps/`; give test builds a map name that is not installed
(with a duplicate the engine keeps one archive and logs which it ignored).
Run dirs stay in `.engine-tmp/` (about 5 MB each, plus any copied archive); delete old ones by hand.

`ok` is true only when the engine exited with code 0 by itself, reached frame 900, the BAR install is
unchanged and there are no map errors; `failures` says why not. A map error is an error line that names the
map, its archive file, or (once the engine picked the map) one of its files (`maps/…`, `mapconfig/…`,
`mapinfo.lua`) or the engine's SMF loader. The first map error stops the engine at once (`engineExit.killedFor`).
Other fields: `loaded`, `framesReached`, `mapArchive`, `mapCheck`, `mapErrors`, `mapWarnings`
(`{count, lines}`: distinct lines, timestamps stripped), `installChanges`, `runDir`, `log`. The log is the
engine's console output (`engine-log.txt`): the same lines as `infolog.txt`, but unbuffered, so a killed run
keeps its tail.

Isolation: `--isolation --isolation-dir "<engine dir>;<BAR data dir>"` makes the BAR install a read-only
data dir; `--write-dir` and `--config` point at a fresh `.engine-tmp/headless-<time>-<map>/`. The tool lists
every file under the BAR install (size and mtime) before and after the run and reports any difference in
`installChanges`. BAR's Lua may still *read* the user's `uikeys.txt` and `LuaUI/` files from the data dir
(its widget config is not: the log shows BAR's "First time setup: done").

Game setup, run dir, isolation, log parsing and the shared verdict rules live in `tools/engine/bar-game.js`;
`headless-check.js` and `screenshot.js` only add their widget and their own checks.

## In-engine screenshots (G3)

Same game and isolation as the headless check, but BAR's windowed `spring.exe` from the same engine, in a
1600×900 window, with a run-local config: no sound (`Sound = 0`), shadows on (BAR's "high" shadow quality),
reflective water, MSAA ×4, no edge scrolling, hardware cursor. Everything else is BAR's first-launch default.
The user widget `screenshot-widget.lua` waits for game frame 150 (5 s, so textures, splats, features, lava and
the two commanders are drawn), hides the interface with `/hideinterface 1`, and for each preset sets the spring
camera, lets 60 frames draw and saves the window with `gl.SaveImage`; then it quits.

| Preset | Camera (same rules for every map; yaw 0 = looking north) |
|---|---|
| `overview` | map centre, 80° down, from the south, 60° lens; distance fitted so the map outline, lifted to its highest ground, shows whole, +5% |
| `mid` | map centre, 45° down, looking north, 45° lens, 3500 elmos away |
| `close` | 30° down, 45° lens, 1000 elmos away, camera right above team 0's start position (left start box), looking at the map centre |

The engine caps the spring camera's distance at about 1.33 × the longer map side, hence the wider overview lens.
A run takes 70–110 s and opens a game window; leave it alone until it closes (keys such as F5 toggle the interface).
`ok` is true only when the engine exited with code 0 by itself, the BAR install is unchanged, there are no map
errors, all three PNGs exist at 1600×900 and all four map corners are in the overview (`mapCheck.overviewCorners`).
`shots` gives each PNG's `path`, `width`, `height` (or null); `mapCheck` has the map size, team 0's start position
and, per shot, the camera distance the engine applied (`<shot>Dist`), the map corners in view (`<shot>Corners`) and
`<shot>=saved|interfaceVisible|saveFailed`; the other fields are the headless check's.
`.engine-tmp/` is gitignored: never commit screenshots of other people's maps.
