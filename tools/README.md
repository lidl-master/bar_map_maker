# Verification tools

Used by builders and critics. Node is at `D:\tools\node` (put it on `PATH`); Python 3.12, stdlib only.

| Tool | Run | Output |
|---|---|---|
| SMF/SMT validator | `python tools/validate/smf.py <map.smf> [<map.smt>]` | JSON report; exit 0 valid, 1 invalid |
| BAR locator | `node tools/bar/locate.js` | JSON: BAR root, data/maps dirs, engines, newest headless engine, `byar:test` game, BAR's 7-Zip |
| Headless engine check | `node tools/engine/headless-check.js "<Map Name>" [map.sd7]` | JSON report; exit 0 when `ok` (loaded, quit in time, BAR install unchanged), else 1 |
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

Report fields: `ok`, `loaded` (reached the game and simulated frames), `framesReached`, `engineExit`
(`timedOut` means the check widget never quit the game), `mapCheck`, `mapProblems` (errors/warnings naming
the map or map-format terms), `luaErrors`, `errors`, `lava`, `metal` (each `{count, lines}`: distinct lines,
timestamps stripped), `installChanges`, `runDir`, `log`. The log is the engine's console output
(`engine-log.txt`): the same lines as `infolog.txt` in the run dir, but unbuffered, so a killed run keeps its tail.
Compare against a known-good map (Pyroclast): BAR in headless mode logs many shader/GL errors on every map.

Isolation: `--isolation --isolation-dir "<engine dir>;<BAR data dir>"` makes the BAR install a read-only
data dir; `--write-dir` and `--config` point at a fresh `.engine-tmp/headless-<time>-<map>/`. The tool lists
every file under the BAR install (size and mtime) before and after the run and reports any difference in
`installChanges`. BAR's Lua may still *read* the user's `uikeys.txt` and `LuaUI/` files from the data dir.
