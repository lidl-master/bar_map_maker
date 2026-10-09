# Bars (what "done" means)

Critics judge against these. Builders aim for them. Change a bar only with the user's OK.

| Area | Bar | Reference |
|---|---|---|
| Format | BAR's own engine (`spring-headless.exe`) loads the map with zero map-related errors | `tools/engine/headless-check.js` report |
| Import | Every map in the user's BAR maps folder opens; an untouched round-trip is identical (heights, tiles, metal, features; mapid aside) | The original archives |
| Visual | Blind A/B of in-engine screenshots (same camera presets): critics prefer ours in ≥ 40% of pairs | Pyroclast, Onyx Cauldron, Crimson Bay, Supreme Isthmus, Red River Remake |
| Checklist | Every automatable item passes | https://www.beyondallreason.info/guide/map-checklist |
| UX | A zero-context "new BAR mapper" persona completes all task cards | Task cards below |
| Performance | 32×32 export ≤ 20 s · open 32×32 ≤ 10 s · smooth sculpting on 32×32 | `tools/bench` (Wave 4) |
| Code | Thermo-nuclear approval bar met · `/ponytail-review` has no blocker · no file > 1,000 lines | `.claude/skills/thermo-nuclear-code-quality-review/SKILL.md` |
| Size | Share preset ≤ 50 MB for any 32×32 map | Export report |

## UX task cards
1. Make a 2v2 forest map with a river in under 10 minutes and install it.
2. Open Pyroclast, extend it 4 units east, add 2 geos, and save it as a new version.
3. Re-texture a map with another biome and export it under 50 MB.
4. Find and fix a checklist failure.

## Rules every builder follows
- ponytail ladder before writing code: does it need to exist, is it already here, stdlib, platform, BAR's own assets, installed dependency, one line, then the minimum.
- Never render user or file text as HTML. Sun in the north (negative z). Check every external program's exit code. Tests live in the repo. No unused options. Heavy work off the UI thread. Presets respect the player count.
- Mark deliberate shortcuts with `shortcut:` comments that say when to revisit.
- End every report with: what was skipped, what was not checked, open risks.
