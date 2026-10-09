// The in-engine texture stack of an export: quality presets, the 4 splat materials with their mapinfo
// `splats` scales and strengths, and the resolution of each baked layer.
import { biomeOf, libraryMaterial } from './biomes.js';

/**
 * Export quality presets. diffuse: 1 = library albedo at 1 texel per elmo; n > 1 = average material colours (no
 * baked shading) in flat n x n blocks, which pack ~6x smaller (the in-engine splat detail textures add the grain).
 * splat/spec: elmos per texel of splatDistrTex and specularTex; normalMax: the largest detailNormalTex side
 * (1 texel per elmo up to that, then halved); dnts: how the splat detail textures ship (the library PNG as is,
 * or BC3 DDS at ~40% of the size). Share keeps a 32x32 map well under 50 MB (rolling hills: ~33 MB).
 */
export const QUALITY = {
  standard: { diffuse: 1, splat: 4, spec: 4, normalMax: 8192, dnts: 'png' },
  share: { diffuse: 4, splat: 8, spec: 8, normalMax: 4096, dnts: 'dds' },
};

// splats.texMults by library class: strength of the splat's detail normal and of its diffuse detail.
const MULTS = { ground: 0.6, slope: 0.7, cliff: 0.8, shore: 0.6, special: 0.7 };

/**
 * @typedef {Object} TexturePlan
 * @property {string} quality
 * @property {{splat: number, spec: number, normal: number}} layers  elmos per texel (powers of two)
 * @property {{id: string, scale: number, mult: number}[]} splats  splatDetailNormalTex1..4; scale = 1 / tileElmos,
 *   so the in-engine detail lines up with the albedo baked into the diffuse
 * @property {'png'|'dds'} dnts
 */

/** @returns {TexturePlan} */
export function texturePlan(doc, quality) {
  const preset = QUALITY[quality];
  if (!preset) throw new Error(`unknown export quality "${quality}" (known: ${Object.keys(QUALITY).join(', ')})`);
  let normal = 1;
  while ((Math.max(doc.sx, doc.sz) * 512) / normal > preset.normalMax) normal *= 2;
  return {
    quality,
    layers: { diffuse: preset.diffuse, splat: preset.splat, spec: preset.spec, normal },
    splats: biomeOf(doc).splats.map((id) => {
      const m = libraryMaterial(id);
      return { id, scale: 1 / m.tileElmos, mult: MULTS[m.class] };
    }),
    dnts: preset.dnts,
  };
}
