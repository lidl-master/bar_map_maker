// Blind A/B image pairs for visual critics.
//   node tools/ab/ab.js <pair-id> <ours.png> <reference.png>  writes <AB root>/pairs/<pair-id>/{A,B}.png
//   node tools/ab/ab.js --reveal <pair-id>                     prints which image was which
// The AB root is outside the repo (BMS_AB_ROOT, default ../tools/bar-map-studio/ab next to the repo), so critics
// working in the repo never come across the keys in <AB root>/keys/. Keep pair ids neutral: critics see them.
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const AB_ROOT = process.env.BMS_AB_ROOT ?? resolve(import.meta.dirname, '../../../tools/bar-map-studio/ab');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PAIR_ID = /^[a-z0-9][a-z0-9._-]*$/i;

function pairPaths(root, id) {
  if (!PAIR_ID.test(id)) throw new Error(`pair id must match ${PAIR_ID}: ${id}`);
  return { pairDir: join(root, 'pairs', id), keyFile: join(root, 'keys', `${id}.json`) };
}

export function makePair(root, id, ours, reference) {
  const { pairDir, keyFile } = pairPaths(root, id);
  if (existsSync(pairDir) || existsSync(keyFile)) throw new Error(`pair ${id} already exists`);
  const images = {};
  for (const [role, path] of Object.entries({ ours, reference })) {
    images[role] = readFileSync(path);
    if (!images[role].subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${role} image is not a PNG: ${path}`);
  }
  const [a, b] = randomInt(2) === 0 ? ['ours', 'reference'] : ['reference', 'ours'];
  mkdirSync(pairDir, { recursive: true });
  mkdirSync(dirname(keyFile), { recursive: true });
  // Written fresh rather than copied, so file times do not hint at which image is ours.
  writeFileSync(join(pairDir, 'A.png'), images[a]);
  writeFileSync(join(pairDir, 'B.png'), images[b]);
  const key = { pair: id, A: a, B: b, ours: resolve(ours), reference: resolve(reference), created: new Date().toISOString() };
  writeFileSync(keyFile, `${JSON.stringify(key, null, 2)}\n`);
  return pairDir;
}

export function reveal(root, id) {
  return JSON.parse(readFileSync(pairPaths(root, id).keyFile, 'utf8'));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === '--reveal') {
    console.log(JSON.stringify(reveal(AB_ROOT, args[1]), null, 2));
  } else if (args.length === 3) {
    console.log(makePair(AB_ROOT, ...args));
  } else {
    console.error('usage: node tools/ab/ab.js <pair-id> <ours.png> <reference.png> | --reveal <pair-id>');
    process.exitCode = 2;
  }
}
