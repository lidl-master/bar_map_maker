// Check map and Play-test behind window.studio (WP 4.2). Like install, they only take archives this session exported;
// the renderer exports first when the map changed since. Engine run dirs go to the work folder. Main process.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const barFile = (name) => pathToFileURL(path.join(import.meta.dirname, '..', 'src', 'bar', name)).href;

/**
 * @param {(channel: string, fn: Function) => void} handle  ipc.js's origin-checked ipcMain.handle
 * @param {{exported: Set<string>, readSettings: () => object}} session  archives exported this session; settings.json
 */
export function registerEngineIpc(handle, { exported, readSettings }) {
  let check = null; // the AbortController of the running check

  function ownArchive(archivePath) {
    if (!exported.has(archivePath)) throw new Error('Only a map exported in this session can be checked or play-tested.');
    return archivePath;
  }

  // shortcut: WP 4.1 builds the Settings screen with a work folder choice; until then settings.json's `workDir`, or a
  // .studio-work folder next to the exported maps (the user's big drive), holds the engine run dirs.
  function workDir() {
    const { workDir: chosen, exportDir } = readSettings();
    return chosen ?? path.join(exportDir, '.studio-work');
  }

  // The checklist facts of the archive (G7): mapinfo, textures, metal, geos. A few seconds at most.
  handle('studio:mapFacts', async (_event, archivePath) => {
    const { readMapFacts } = await import(barFile('map-facts.js'));
    return readMapFacts(ownArchive(archivePath));
  });

  // BAR's headless engine loads the archive (70-150 s). Progress goes to studio:checkProgress; one check at a time.
  handle('studio:checkMap', async (event, archivePath) => {
    if (check) throw new Error('A check is already running.');
    const { checkMap } = await import(barFile('check.js'));
    check = new AbortController();
    const onProgress = (fraction, label) => { if (!event.sender.isDestroyed()) event.sender.send('studio:checkProgress', { fraction, label }); };
    try {
      return await checkMap(ownArchive(archivePath), { workDir: workDir(), signal: check.signal, onProgress });
    } finally {
      check = null;
    }
  });

  handle('studio:cancelCheck', () => { check?.abort(); });

  // Windowed BAR, the user against BARb. Resolves once BAR runs; its exit goes to studio:playtestExit.
  handle('studio:playtest', async (event, archivePath, { difficulty, side } = {}) => {
    const { playtest } = await import(barFile('playtest.js'));
    const run = await playtest(ownArchive(archivePath), { workDir: workDir(), difficulty, side });
    run.exited.then((result) => { if (!event.sender.isDestroyed()) event.sender.send('studio:playtestExit', result); });
    return { pid: run.pid };
  });
}
