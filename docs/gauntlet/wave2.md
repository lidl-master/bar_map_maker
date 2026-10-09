# Wave 2 brief: game-standard look + commercial-grade UI

Approved by the user: CC0 texture download (~300 MB, kept on D: outside the repo), windowed BAR screenshots (G3), standing OK for small npm packages (< 50 MB).

## Work packages (parallel)
| WP | Owner folders | Goal |
|---|---|---|
| 2.1 Texture library | `tools/textures/`, `src/look/library.js`, `assets/textures/` (generated, gitignored) | ~24 CC0 materials (ambientCG / Poly Haven) fetched by a script into `D:\tools\texture-cache\`, processed into: albedo tiles (for the diffuse bake), DNTS splat textures (BAR's "detail normal texture splatting": confirm the exact channel layout from the engine's own shader source in `data/engine/recoil_*/base/` before writing), small thumbnails for the UI. Licence manifest with source URLs + SHA-256. Classes: vehicle ground, bot slope, cliff, shore, special. |
| 2.2 Texture stack export | `src/look/`, `src/formats/` (DDS writer), `src/bar/export.js` | Export the full BAR texture stack: diffuse SMT baked from library albedo (world-space tiling, blended by splat weights, macro variation, subtle topolines), `splatDistrTex`, `splatDetailNormalTex1..4` + `splatTexScales/Mults`, `detailNormalTex`, subtle `specularTex`, grass map (SMF extra header), minimap, `resources` block in mapinfo. Traversability readable: ≤ 27° vehicle ground, 27–54° distinct slope material, > 54° unmistakable cliff. Biome presets choose the 4 splats. Keep 32×32 export ≤ 20 s and a "Share" preset ≤ 50 MB. |
| 2.3 Features | `src/terrain/features.js`, `src/look/biomes.js` (feature sets) | Scatter BAR's built-in features per biome and slope: `TreeType0..15`, `rocks30_{def,snow,moss,desert}_01..30`. Keep them off ramps, start areas, metal/geo pads and chokepoints. Fast object ids for thousands of features. A scatter tool + density slider in the UI is 2.4's job; 2.3 provides the function. |
| 2.4 UI polish (commercial grade) | `app/` | Redesign the editor to the UI bar below. Welcome screen (templates gallery with thumbnails, recent maps, open existing map placeholder for Wave 3), polished New Map flow, tool panels, dialogs, toasts, progress, shortcuts overlay (`?`), status bar, empty/loading/error states, Look tab with material swatches from the library thumbnails, feature scatter controls. Bundled font (Inter, OFL) and one icon set (e.g. Lucide, ISC) via small npm packages. |
| smooth | all | Integrate, update `docs/ARCHITECTURE.md`. |
| G3 + critics | — | In-engine screenshots (windowed `spring.exe`, isolated write dir) of our maps vs Pyroclast / Onyx Cauldron / Crimson Bay / Supreme Isthmus / Red River Remake at fixed camera presets; blind A/B visual critic; design critic on app screenshots; one blockers-only code pass. |

## UI bar (what "commercial grade" means here)
Reference class: Figma, Blender 4.x, Unity 6, Gaea 2, Linear.
- One type family (Inter) with a clear scale (e.g. 11/12/13/15/18/24), tabular numbers in value fields.
- 4-px spacing grid, consistent paddings, aligned edges, no cramped or orphaned controls.
- Three surface levels + one accent colour; text contrast ≥ 4.5:1; semantic colours only for state (success, warning, danger).
- One icon set, one stroke weight, consistent sizes.
- Every control has hover, active, focus-visible and disabled states; keyboard focus is always visible.
- Purposeful motion (≤ 150 ms, no layout jank), designed empty, loading and error states.
- Looks right at 1280×800 and 1920×1080, and at 100% and 125% display scaling.
- Never render user or file text as HTML.

Design critic: scores screenshots against this bar (≥ 8/10 from two independent critics) and must prefer the new UI over the Wave 1 UI in blind A/B.
