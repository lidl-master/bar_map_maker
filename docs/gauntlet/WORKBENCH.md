# Workbench (live progress)

Updated by the lead after every round. Bars: [bars.md](bars.md).

## Wave 0: setup (in progress)

| Item | Status |
|---|---|
| Node 24.21.0 portable at `D:\tools\node`, on user PATH | done |
| git repo, baseline commit, prototype moved to `legacy/` | done |
| Electron 44.7.0 + Playwright 1.64.0 (caches on D:) | done |
| Thermo-nuclear skill active in `.claude/skills/` | done |
| WP 0.1 Electron skeleton + smoke test | merged; round 2 (screenshot to temp dir, fatal load errors) |
| WP 0.2 Tools: format validator, BAR locator, headless engine check, blind A/B pairs | merged; **critic blocked** → round 2 (engine-check verdict, map-error detection, A/B keys outside repo) |
| First engine check of Volcano King | **loads cleanly**: 900 frames, lava 60→59, 90 metal spots, 10 geos (confirmed by builder and critic) |

### Round 1 critic findings (blind)
- G0 pass (13 Node + 12 Python tests; security controls proven by mutation).
- G1 pass (Volcano King valid; independent header parse agrees).
- G2 pass (Volcano King loads; BAR install unchanged, verified by SHA-256 of 30,496 entries).
- G4 **block**: the engine check's verdict ignored the exit code and the quit frame. A probe map with a broken `mapconfig/lava.lua` showed "0 map problems" and failed only by timing out.

## Gates

| Gate | Status |
|---|---|
| G0 unit tests | pass (round 1) |
| G1 format validator | pass (round 1) |
| G2 headless engine load | pass on Volcano King (tool verdict being hardened) |
| G3 in-engine screenshots | Wave 1 |
| G4 code quality | block → fixing (round 2) |
| G5 UX journeys | Wave 4 |
| G6 performance | Wave 4 |
| G7 checklist | Wave 2 |
