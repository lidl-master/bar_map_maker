// Terrain engine: templates, brushes, ramps, erosion, slope limiting, resource and feature placement. Pure.
export { TEMPLATES, generate } from './generate.js';
export { brush, falloff, ramp } from './brush.js';
export { erode, limitSlopes } from './erosion.js';
export { placeResources } from './place.js';
export { FEATURE_SETS, scatterFeatures } from './features.js';
