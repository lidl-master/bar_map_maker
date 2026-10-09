# CC0 texture library

`npm run textures` = `fetch.js` then `build.js`.

| Step | Does | Output |
|---|---|---|
| `fetch.js` | Downloads each material's ambientCG 1K-PNG zip (list: `materials.js`), checks its size against the API and every entry's CRC (7-Zip `t`), extracts `*_Color.png` and `*_NormalGL.png`, records SHA-256 | `D:\tools\texture-cache\raw\` (outside the repo, ~440 MB) |
| `build.js` | Albedo, DNTS and thumbnail per material, manifest, licences, contact sheet | `assets/textures/` (gitignored), `src/look/library-manifest.js` (committed), `.engine-tmp/texture-thumbs.png` |

`assets/textures/` lives in the main checkout. In a git worktree, junction it like `node_modules`:
`mkdir assets` then `cmd /c mklink /J assets\textures D:\bar_map_maker\assets\textures`.
`loadMaterial(id, root)` in `src/look/library-load.js` takes another root for tests.

Classes follow BAR's map checklist: `ground` (≤ 27°, vehicles), `slope` (27–54°, bots only), `cliff` (> 54°),
`shore`, `special`. `tileElmos` is the world size of one repeat; use `splats.texScales = 1 / tileElmos` for the DNTS
so the detail lines up with an albedo baked at the same repeat.

## Files

- `albedo/<id>.png`: 1024² RGB. The source colour map with light and shade broader than ~100 px evened out
  (gain = mean luminance ÷ blurred luminance, clamped to 0.5–2) so repeats do not show as blotches.
  The build fails if a tile's wrap-around edges step more than 2× its inside pixel steps (all are 0.9–1.3).
- `dnts/<id>.png`: 1024² RGBA, BAR's splat detail normal texture (layout below).
- `thumbs/<id>.png`: 128² RGB, 8×8 box average of the albedo.
- `manifest.json`: `{dntsLayout, materials}`; `materials` equals `MATERIAL_LIBRARY`.
- `LICENSES.md`: every material, its page and download URL, SHA-256 of the zip. All ambientCG assets are CC0 1.0.

## DNTS layout (from the engine's shader)

Source: `springcontent.sdz` → `shaders/GLSL/SMFFragProg.glsl` of engine `recoil_2026.07.04` (extracted read-only).

```glsl
vec4 splatTexCoord0 = vertexWorldPos.xzxz * splatTexScales.rrgg;
vec4 splatCofac = texture2D(splatDistrTex, uv) * splatTexMults;
splatDetailStrength.x = min(1.0, dot(splatCofac, vec4(1.0)));
splatDetailNormal  = ((texture2D(splatDetailNormalTex1, splatTexCoord0.st) * 2.0 - 1.0) * splatCofac.r);
...                                                     // Tex2..4 with .g, .b, .a
#ifdef SMF_DETAIL_NORMAL_DIFFUSE_ALPHA
    splatDetailStrength.y = clamp(splatDetailNormal.a, -1.0, 1.0);
#endif
vec3 tTangent = normalize(cross(normal, vec3(-1.0, 0.0, 0.0)));   // +z on flat ground
vec3 sTangent = cross(normal, tTangent);                           // +x on flat ground
mat3 stnMatrix = mat3(sTangent, tTangent, normal);
detailCol = vec4(splatDetailStrength.y);
normal = normalize(mix(normal, normalize(stnMatrix * splatDetailNormal.xyz), splatDetailStrength.x));
fragColor.rgb = (diffuseCol.rgb + detailCol.rgb) * shadeInt.rgb;
```

So each `splatDetailNormalTexN` texel is:

| Channel | Meaning |
|---|---|
| R | normal x along S = world +x (east, image right) |
| G | normal y along T = world +z (south, image down: rows run north to south like the SMT and `splatDistrTex`) |
| B | normal z along the surface normal (up) |
| A | diffuse detail: `(A/255·2 − 1) · weight` is **added** to the diffuse colour; 128 = no change. Only read when mapinfo sets `resources.splatDetailNormalDiffuseAlpha = 1` (every BAR map checked does) |

Texture coordinates are `world x, z × splats.texScales`, one channel of `splatDistrTex` weights each texture, and
`splats.texMults` scales both the normal and the alpha detail (shipped maps: 0.1–1.5).

The library's DNTS: RGB = ambientCG's OpenGL normal map with green inverted (OpenGL's +Y points up the image, BAR's
T axis points down it; the same as the DirectX-style map), A = 128 + (luminance − luminance blurred over ~4 px), the
fine detail the 2 px/elmo diffuse texture cannot hold.

### Row order: PNG/TGA top-down, DDS bottom-up

"Image down = +z" holds for how the engine uploads the texture. Recoil's `CBitmap::Load`
(`rts/Rendering/Textures/Bitmap.cpp`) loads PNG/TGA through DevIL with `IL_ORIGIN_UPPER_LEFT` (file row 0 → t = 0),
but loads DDS through nv_dds with `flipDDS = true` for every path without "unitpics" (last file row → t = 0).
Checked on shipped maps: the cliff channel of `splatDistrTex` (DXT5) correlates with heightmap slope only when the
file's last row is north (Supreme Isthmus r = 0.74 bottom-up vs 0.05 top-down, Crimson Bay 0.65 vs 0.05).

So: write a DNTS as TGA/PNG with rows as they are here. Write any DDS (DNTS, `splatDistrTex`, `specularTex`,
`detailNormalTex`) with its rows reversed, south first; the channels stay the same.

Shipped maps disagree on DNTS green (a curl test on the normals: Pyroclast's TGAs use OpenGL green, Supreme Isthmus's
the inverted one), so they are no evidence either way; the shader and loader above are. A wrong green only mislights
fine bumps; it never breaks a map.
