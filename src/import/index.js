// Opening existing BAR maps: archive files -> MapDoc with doc.original. Pure (Node and browser), but importMap reads
// mapinfo.lua through wasmoon, so the renderer imports preview.js directly instead of this file.
export { importMap } from './import.js';
export { readMapData } from './map-data.js';
export { findMetalSpots } from './metal-spots.js';
export { closestBiome, originalColor, originalPreview } from './preview.js';
