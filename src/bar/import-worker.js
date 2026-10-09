// Worker thread for openMapArchive: importMap (mapinfo.lua in wasmoon, the SMF and its SMTs) off the main process, so
// a map whose Lua never finishes can be stopped (the Lua instruction limit does not interrupt a slow C call such as
// a pathological string.find).
import { parentPort } from 'node:worker_threads';
import { importMap } from '../import/index.js';

parentPort.once('message', async ({ files, source }) => parentPort.postMessage(await importMap(files, source)));
