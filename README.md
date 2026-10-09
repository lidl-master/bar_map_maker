# BAR Map Maker

A browser-based map editor for **Beyond All Reason**. Sculpt terrain, paint textures, place metal
spots / geothermal vents / start positions, and export a **ready-to-play `.sdz` map**. No other tools
(pymapconv, SpringMapEdit, GIMP) are needed.

## Run it

Double-click `index.html` (Chrome, Edge or Firefox).

If your browser blocks something when opening from disk, serve the folder instead:

```bash
python -m http.server 8765
```

and open <http://localhost:8765>.

The 3D preview loads three.js from cdnjs the first time, so it needs internet once. Everything else works offline.

## Workflow

1. **New** → choose size, players, symmetry, look and a starting terrain.
2. **Sculpt** with Raise / Lower / Smooth / Flatten / Rough / Ramp. Everything is mirrored by the
   *Symmetry* setting so the map stays fair.
3. **Show → Pathing** shows where units can drive. Green = all units (≤ 27°), yellow = bots only
   (≤ 54°), red = cliffs, blue = water. These limits come from BAR's `movedefs.lua`.
4. Place **Metal**, **Geo** and **Start** positions, or use *Generate → Auto-place resources*.
5. **Texture** tab: pick a theme (it also sets sky, sun and water) and paint materials with the Paint tool.
6. **Export map → Playable map (.sdz)**, then drag the file onto `tools\install_map.bat`. It repacks
   it as `.sd7` (7-Zip, the format BAR's own maps use) with the 7-Zip that ships with BAR and copies it to
   `%LOCALAPPDATA%\Programs\Beyond-All-Reason\data\maps\`.

Work is autosaved in the browser. **Save** writes a `.barmap` project file you can reopen later.

## What the export contains

| File | Notes |
|---|---|
| `mapinfo.lua` | name, version, wind, tidal, gravity, lighting/atmosphere/water from the theme, start positions |
| `maps/<name>.smf` | 16-bit heightmap, metal map, DXT1 minimap, tile index, `GeoVent` features |
| `maps/<name>.smt` | DXT1-compressed 32×32 texture tiles with mipmaps |

Metal spots are written to the metal map as hard-edged 21-pixel spots. `maxMetal` is chosen
automatically so the value BAR shows on each spot (sum × maxMetal / 1000) is exactly what you typed.

*Export → Source files* gives you a 16-bit heightmap PNG, the full texture, metal map, minimap and
mapinfo.lua for use with pymapconv or other tools.

## Files

- `js/map.js`: map model, symmetry modes, undo history
- `js/terrain.js`: brushes, generators, erosion, auto resource placement
- `js/texture.js`: themes and texturing rules
- `js/export.js`: SMF/SMT writer, DXT1 compressor, mapinfo.lua
- `js/io.js`: zip, PNG encode/decode, project files, autosave
- `js/view2d.js`, `js/view3d.js`, `js/app.js`: UI
