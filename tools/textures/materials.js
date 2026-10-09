// The CC0 materials in the library, by BAR traversability class (https://www.beyondallreason.info/guide/map-checklist):
//   ground  â‰¤ 27Â°: vehicles drive it      slope 27â€“54Â°: bots only      cliff > 54Â°: impassable
//   shore   beaches and riverbeds         special: lava, bases, metal
// `asset` is an ambientCG id (https://ambientcg.com/a/<asset>, CC0). `tileElmos` is the world size of one repeat: the
// range shipped BAR maps use (1 / splats.texScales â‰ˆ 50â€“500 elmos, mostly 100â€“200), small for fine grain, larger for
// coarse ground. Literal photo scale (1â€“3 m â‰ˆ 5â€“15 elmos) turns to mush from an RTS camera.
export const MATERIALS = [
  { id: 'grass_lush', label: 'Lush grass', class: 'ground', asset: 'Grass004', tileElmos: 128 },
  { id: 'grass_patchy', label: 'Patchy grass', class: 'ground', asset: 'Ground037', tileElmos: 192 },
  { id: 'dirt_dark', label: 'Dark soil', class: 'ground', asset: 'Ground048', tileElmos: 160 },
  { id: 'dirt_dry', label: 'Dry dirt', class: 'ground', asset: 'Ground102', tileElmos: 192 },
  { id: 'sand_yellow', label: 'Yellow sand', class: 'ground', asset: 'Ground080', tileElmos: 160 },
  { id: 'sand_dunes', label: 'Desert ripples', class: 'ground', asset: 'Ground092A', tileElmos: 256 },
  { id: 'snow', label: 'Snow', class: 'ground', asset: 'Snow004', tileElmos: 192 },
  { id: 'ash', label: 'Volcanic ash', class: 'ground', asset: 'Ground036', tileElmos: 160 },
  { id: 'mud', label: 'Mud', class: 'ground', asset: 'Ground051', tileElmos: 160 },
  { id: 'dust_red', label: 'Red dust', class: 'ground', asset: 'Gravel025', tileElmos: 128 },
  { id: 'regolith', label: 'Grey regolith', class: 'ground', asset: 'Gravel043', tileElmos: 160 },
  { id: 'gravel_slate', label: 'Slate gravel', class: 'slope', asset: 'Gravel040', tileElmos: 128 },
  { id: 'scree', label: 'Scree', class: 'slope', asset: 'Rocks006', tileElmos: 128 },
  { id: 'sandstone_layered', label: 'Layered sandstone', class: 'slope', asset: 'Ground105', tileElmos: 192 },
  { id: 'dirt_rocky', label: 'Rocky dirt', class: 'slope', asset: 'Ground067', tileElmos: 160 },
  { id: 'granite', label: 'Granite cliff', class: 'cliff', asset: 'Rock030', tileElmos: 128 },
  { id: 'basalt', label: 'Basalt cliff', class: 'cliff', asset: 'Rock031', tileElmos: 128 },
  { id: 'sandstone_cliff', label: 'Sandstone cliff', class: 'cliff', asset: 'Rock029', tileElmos: 160 },
  { id: 'ice_cliff', label: 'Ice cliff', class: 'cliff', asset: 'Ice002', tileElmos: 160 },
  { id: 'sand_wet', label: 'Wet sand', class: 'shore', asset: 'Ground054', tileElmos: 160 },
  { id: 'pebbles', label: 'Beach pebbles', class: 'shore', asset: 'Gravel041', tileElmos: 96 },
  { id: 'lava_rock', label: 'Cracked lava rock', class: 'special', asset: 'Lava001', tileElmos: 192 },
  { id: 'concrete', label: 'Concrete', class: 'special', asset: 'Concrete025', tileElmos: 128 },
  { id: 'metal_plates', label: 'Metal plates', class: 'special', asset: 'MetalPlates013', tileElmos: 128 },
];
