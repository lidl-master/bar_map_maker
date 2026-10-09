# Changelog

## v0.1.0 — first preview (2026-10-10)

The first public preview of BAR Map Studio, a desktop map maker and editor for Beyond All Reason. Development is
paused at this point; see [docs/STATUS.md](docs/STATUS.md) for what is left. There is no installer yet: run it from
source (see the [README](README.md)).

### New maps
- Nine terrain templates: Flat, Rolling hills, Mountains, Plateaus, Canyons, Islands, Two shores, Craters, and
  Volcano – King of the Hill (a one-way uphill assault with cliff tiers and lava rivers).
- Sizes 2–32 map units (rectangular allowed), 2–16 players, 8 symmetry modes, 7 biomes.
- Start positions, metal spots and geothermal vents placed for the player count; BAR's own trees and rocks scattered
  per biome, kept off ramps, pads and chokepoints.

### Editing
- Raise, lower, smooth, flatten, roughen and ramp brushes, material painting, and resource placement, all mirrored by
  the map's symmetry, with undo/redo for everything.
- 2D, 3D and split views; pathing overlay (vehicle ground ≤ 27°, bot-only slopes, cliffs > 54°); overlays for
  features, metal values and symmetry guides.
- Extend or crop a map by whole units on any side, or resize it.

### Look
- 24 CC0 materials from ambientCG baked into BAR's full texture stack: diffuse tiles, splat distribution, detail
  normal textures, detail normals, specular, grass and minimap. Slopes and cliffs read as BAR's checklist asks.
- In a blind comparison of in-game screenshots against five professional BAR maps, ours were preferred in 11 of 16
  judgments.

### Existing maps
- Open any map from the BAR maps folder (read-only) with its original textures, resources and lava; all 19 tested
  installed maps round-trip exactly.
- Export a derivative: untouched files pass through byte-for-byte, extended ground is blended at the seam, map-wide
  textures and Lua placers are shifted, a new name or version is required, the original author is credited, and
  ND/NC licences are flagged.

### BAR integration
- Export to `.sd7`, with a Share preset that keeps a 32×32 map under 50 MB (a 32×32 map exports in about 15–20 s).
- Install to BAR with a confirm and the `.md5.gz` sidecar.
- Check map: loads the export in BAR's headless engine and runs 15 automated checks from BAR's map checklist, with
  one-click fixes.
- Play-test against the BARb AI without installing the map.

### Safety
- Archives are checked before extraction (links, paths outside the archive, oversized files are refused); map Lua runs
  in a sandbox in a worker that is stopped after 10 s; the BAR folder is only written by a confirmed Install.
- Autosave never deletes your maps on its own.

### Known limitations
- Windows only; run from source with Node 24.2+; the texture library is downloaded once with `npm run textures`.
- No installer or portable build yet.
- The UI scored 7/10 from two design reviewers (target 8); a second polish round is planned.
- Painting over an opened map's original texture is not exported yet.
- The bundled 7-Zip is 21.07; unsafe archives are refused before extraction.
- Full list: [docs/STATUS.md](docs/STATUS.md).
