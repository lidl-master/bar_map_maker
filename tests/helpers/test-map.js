// A synthetic MapDoc (shape from docs/ARCHITECTURE.md) for format and export tests: rolling hills, a cliff-walled
// plateau, 2 starts, 6 metal spots, a geo vent, a few trees and rocks, and a painted sand patch.
export function testMap({ sx = 8, sz = 8, name = 'Studio Test Hills', version = '0.1' } = {}) {
  const W = 64 * sx + 1, H = 64 * sz + 1, width = sx * 512, depth = sz * 512;
  const heights = new Float32Array(W * H);
  const paint = new Uint8Array(W * H), paintWeight = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = i * 8, z = j * 8;
      const hills = 160 + 70 * Math.sin(x / 600) * Math.cos(z / 800) + 30 * Math.sin((x + 2 * z) / 300);
      const r = Math.hypot(x - width / 2, z - depth / 2) / Math.min(width, depth);
      const t = Math.min(1, Math.max(0, (0.19 - r) / 0.06));
      const plateau = 260 * t * t * (3 - 2 * t); // walls from gentle through bot-only to cliff
      heights[j * W + i] = hills + plateau;
      if (Math.hypot(x - width * 0.2, z - depth * 0.8) < 300) {
        paint[j * W + i] = 5; // sand
        paintWeight[j * W + i] = 200;
      }
    }
  }
  let id = 0;
  const at = (type, fx, fz, extra) => ({ id: ++id, type, x: Math.round(fx * width), z: Math.round(fz * depth), ...extra });
  const objects = [
    at('start', 0.15, 0.5), at('start', 0.85, 0.5),
    at('metal', 0.1, 0.4, { metal: 1.8 }), at('metal', 0.9, 0.6, { metal: 1.8 }),
    at('metal', 0.2, 0.6, { metal: 2.0 }), at('metal', 0.8, 0.4, { metal: 2.0 }),
    at('metal', 0.5, 0.15, { metal: 2.2 }), at('metal', 0.5, 0.85, { metal: 2.2 }),
    at('geo', 0.5, 0.5),
    at('feature', 0.3, 0.2, { name: 'TreeType0', rot: 0 }), at('feature', 0.32, 0.22, { name: 'TreeType5', rot: 90 }),
    at('feature', 0.7, 0.8, { name: 'TreeType11', rot: 200 }), at('feature', 0.4, 0.7, { name: 'rocks30_moss_07', rot: 45 }),
  ];
  return {
    sx, sz, W, H, heights, paint, paintWeight,
    symmetry: 'none',
    objects,
    biome: 'temperate',
    settings: {
      name, version,
      author: 'BAR Map Studio tests',
      description: 'Synthetic test map with a "quoted" word and a back\\slash',
      minWind: 5, maxWind: 20, tidalStrength: 15, gravity: 100, extractorRadius: 90,
      voidWater: false,
      lava: { enabled: false, level: 0, damage: 0 },
      sunDir: [0.35, 0.75, -0.55],
    },
  };
}
