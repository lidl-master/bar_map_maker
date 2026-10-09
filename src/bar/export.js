// Export a MapDoc as a BAR map archive: a new map (everything baked), or a derivative of an opened map
// (derivative.js: the original's files pass through, only what changed is rebuilt). Node-only.
import { rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeSd7 } from '../archive/index.js';
import { buildMapFiles } from '../formats/index.js';
import { bakeTexture } from './bake.js';
import { deriveMapFiles } from './derivative.js';
import { archiveFileName } from './derive-rules.js';

const NEVER = new AbortController().signal; // the signal of an export nobody can cancel

/**
 * @typedef {Object} ExportReport
 * @property {string} archivePath
 * @property {number} bytes  archive size
 * @property {number} passedThrough  files copied unchanged from the original map (0 for a new map)
 * @property {string[]} regenerated  archive paths this export wrote
 * @property {string[]} warnings  what the user should know about the result (empty for a new map)
 */

// A new map: every file comes from the doc and the bake.
async function newMapFiles(doc, { quality, onProgress, signal }) {
  const files = await buildMapFiles(doc, (plan) => bakeTexture(doc, plan, onProgress, signal), { quality });
  return { files, report: { passedThrough: 0, regenerated: [...files.keys()], warnings: [] } };
}

/**
 * @param {import('../core/index.js').MapDoc} doc  with doc.original: a derivative of that map (derivative.js)
 * @param {string} outDir
 * @param {{onProgress?: (fraction: number, label: string) => void, quality?: 'standard'|'share', signal?: AbortSignal}} [options]
 *   quality: src/look QUALITY preset (Share: flat-colour diffuse and smaller stack textures, <= 50 MB for 32x32);
 *   signal: aborting stops the workers and 7-Zip, deletes the partial archive and rejects with signal.reason
 *   (an AbortError unless the caller gave another reason)
 * @returns {Promise<ExportReport>}
 */
export async function exportMap(doc, outDir, { onProgress = () => {}, quality = 'standard', signal = NEVER } = {}) {
  const archivePath = join(resolve(outDir), archiveFileName(doc.settings));
  const build = doc.original ? deriveMapFiles : newMapFiles;
  const { files, report } = await build(doc, { quality, onProgress, signal });
  signal.throwIfAborted();
  onProgress(0.9, 'Packing archive');
  await writeSd7(files, archivePath, { signal }); // shortcut: no progress inside 7-Zip
  if (signal.aborted) { // cancelled in the moment 7-Zip finished: the user asked for no archive
    rmSync(archivePath, { force: true });
    throw signal.reason;
  }
  onProgress(1, 'Done');
  return { archivePath, bytes: statSync(archivePath).size, ...report };
}
