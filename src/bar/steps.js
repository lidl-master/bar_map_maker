// The progress labels exportMap reports, in order, so the UI can list every step from the start. Pure: the renderer
// imports this file directly (the rest of src/bar is Node-only). 'Done' closes the last step.
export const EXPORT_STEPS = {
  map: ['Loading materials', 'Baking texture', 'Encoding textures', 'Packing archive'],
  // A map opened from an archive (doc.original): the original's files pass through, only new ground is baked.
  derivative: ['Reading the original map', 'Loading materials', 'Baking new ground', 'Moving map-wide textures', 'Writing map files', 'Packing archive'],
};
