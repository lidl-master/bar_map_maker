# Design re-score 1 (after WP 2.6): 7.0 and 7.0 — fix list for WP 2.8

Both critics, merged and de-duplicated. Pass mark: 8/10 from both.

## Major
1. **3D viewport depth.** Visible vertical gradient backdrop (e.g. #1c2029 top → #0d0f13 bottom; the current one is too subtle and reads flat), an infinite ground grid at the map's minimum height fading with distance, a soft contact shadow under the slab, light fog, slightly stronger key light / AO. Markers as pins (1-px stem to a depth-tested dot on the terrain), fade metal rings with distance, de-overlap markers (start 4 vs its metal spots, start 6 vs geos). Auto-frame so the slab fills ~75–80% of the pane (currently ~45% in Split at 1280/1920). Same viewport background token for 2D and 3D panes.
2. **Trees/rocks in 2D** read as black speckle/dirt: draw trees as 5–7 px dark-green canopy discs with a light top-left highlight and soft shadow, rocks as small grey glyphs; below ~75% zoom use a low-opacity density tint instead. Tied to the Features overlay toggle.
3. **Open-map error** shows raw 7-Zip output with internal paths: title "<file> couldn't be opened", body "The file isn't a valid map archive. It may be incomplete or corrupted.", raw log behind "Show details" (muted monospace), banner must not push the grid (reserve slot or toast).
4. **Export error card**: primary action "Rename map" (switches to Map tab, focuses Name); sentence-style message; inline validation of Name in the Map tab (helper text) and Export disabled with a tooltip while the name is invalid; collapse greyed later steps; "Try again" secondary.
5. **Export done card**: 16-px footer padding both sides; actions right-aligned: "Show in folder" (secondary), "Install to BAR" (primary); Close as × in the header; path middle-ellipsis ("D:\…\my_bar_map_1.0.sd7") with full path tooltip; finished steps collapse into "Details"; card collapsible to a status-bar pill ("Exporting 42%"), auto-collapse when the user starts a stroke.
6. **Sidebar navigation vs CTA** (welcome/open screens): neutral nav rows, current page = surface-3 + 2-px accent bar on the left; one compact filled "New map" button that is never a selection state. Subtitle "Edit an installed map" (no orphan word); `text-wrap: balance` on card subtitles.
7. **Open-map cards**: title = clean map name from mapinfo (or file name prettified, no ".sd7"), single line with ellipsis + tooltip; meta "v1.8 · 16×12 · 40 MB"; thumbnails in a fixed 1:1 well on surface-1 with contain + 1-px inner border; skeleton cards while loading; search field + sort (Name / Size / Recently installed).
8. **Markers in 2D** scale with zoom (clamped 8–14 px), simple dots below ~60% zoom, nudge edge markers inside the map bounds. Selected spot: 2-px accent ring + soft glow + accent label chip, mirrored copies dashed ring + neutral chip; "X 2,364 · Z 3,873" formatting. Start numerals: ≥ 4.5:1 (darken blue/red fills or 1-px dark text stroke).
9. **Segmented controls** (2D/Split/3D, Extend/Resize, Share/Standard): selected segment raised surface + 1-px lighter border + full-white text, unselected transparent with muted text, ≥ 3:1 between pill and track.
10. **Collapse at 125% / narrow**: keep a short "Install" label (move the keyboard icon into an overflow menu), Shaded/Pathing as a labelled dropdown in Split, keep the tool chip, tooltips with name + shortcut on every icon-only control (3D cluster: "Frame map (Home)", "Top view", "Reset camera"; the map icon next to the logo).

## Minor
11. Brush presets: segmented with the matching preset highlighted, "Custom" when sliders don't match.
12. Look tab: sticky "Selected: <swatch> <name>" chip next to the "Paint materials" heading; tooltip on every swatch; no single-item rows (fixed 2-col biome grid with the last cell left-aligned; 36-px swatches with 6-px gap so 7 fit); top shadow under the tab bar when scrolled.
13. Units: "160 elmos", "5 m/s" wind, "30%" (no space) — one percent style; heading rule: caps 11/600 overlines only for dialog/menu group labels, sentence-case 13/600 for inspector sections; status bar label–value gap 4 px, 16 px between pairs.
14. Reshape crop confirm: no stacked modal (replace dialog content in place), bulleted counts with tabular figures, symmetry warning as its own amber callout; dismiss/replace stale toasts on undo ("Undone: map is 12 × 12 again").
15. Generating state: determinate bar if the generator reports progress, Cancel in the overlay card, Generate form disabled at 50% while busy, map dim ~55%.
16. Generate tab Template dropdown defaults to the map's current template (or "Choose…").
17. Shortcuts sheet: balanced columns (File+Edit+View | Tools | Brush+3D+Help), hairlines on every row or none, 24-px bottom padding, mouse gestures as chips with a mouse glyph; resolve Right-click = delete vs right-drag = pan (e.g. Alt+Right-click deletes).
18. Pathing overlay: ~50–55% over the hillshade, Bots hue distinct from geo-orange (e.g. violet), always list all classes incl. "Impassable > 54°", grey absent ones; explain or remove the legend caret.
19. Recent maps: no duplicate "Continue editing" + recent row; auto-number default names ("My BAR Map 2"); one time format.
20. New Map: one name "Volcano" + "King of the Hill" sub-badge everywhere; tile labels fixed two-line box or shorter ("180°", "90°", "Quad"); dialog body scrolls with a sticky footer at 125%; helper labels ≥ 12 px.
21. Welcome gallery at 125%: `repeat(auto-fill, minmax(232px, 1fr))`, max card width 320 px, keep 3 columns at 1024 CSS px.
22. Focus: one :focus-visible token (2-px accent outline, 2-px offset, radius = element radius + 2) incl. the slider thumb.
23. Icons: distinct icons for app logo / Shaded / Generate; Install (box with down-arrow) vs Export (share/file) clearly different; compass at 1.5-px outline style.
24. Imported maps: "Features 0" → "Features: not imported" with an info tooltip when features are Lua-placed; tool chip shown consistently.
25. Seed field: UI font with tabular-nums (still monospace in places).
26. 2D pane: replace the hard black rectangle around the map with a soft shadow + 1-px rgba(255,255,255,.06) border.
