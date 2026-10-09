// Worker thread for exportMap: bakes and DXT1-encodes one row of SMT tiles, or the minimap, per message.
import { parentPort, workerData } from 'node:worker_threads';
import { encodeDxt1Mips, TILE_BYTES } from '../formats/index.js';
import { bakeMinimap, bakeTile } from '../look/index.js';

const doc = workerData;
const tilesX = doc.sx * 16;

parentPort.on('message', (job) => {
  let data;
  if (job === 'minimap') {
    data = encodeDxt1Mips(bakeMinimap(doc), 1024);
  } else {
    data = new Uint8Array(tilesX * TILE_BYTES);
    for (let tx = 0; tx < tilesX; tx++) data.set(encodeDxt1Mips(bakeTile(doc, tx, job), 32), tx * TILE_BYTES);
  }
  parentPort.postMessage({ job, data }, [data.buffer]);
});
