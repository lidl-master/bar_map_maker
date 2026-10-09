import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const barModule = pathToFileURL(path.join(import.meta.dirname, '..', 'src', 'bar', 'index.js')).href;

// Dynamic import, so the editor still starts (and says what is missing) when src/bar is absent or broken.
async function loadBar() {
  try {
    return await import(barModule);
  } catch (error) {
    throw new Error(`Export and install are unavailable: src/bar could not be loaded (${error.message})`);
  }
}

// The user's choices that outlive a session ({exportDir}), in Electron's userData folder.
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {}; // none yet, or unreadable: the user is simply asked again
  }
}

/** Asks for the export folder and remembers it; null when the user cancels. */
async function chooseExportDir(window) {
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: 'Choose the folder for exported maps',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths.length) return null;
  writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), exportDir: filePaths[0] }, null, 2));
  return filePaths[0];
}

const QUALITIES = ['share', 'standard']; // export presets (src/bar, WP 2.2)

/**
 * IPC behind window.studio. Only our own page may call it; install and show-in-folder only take archives this session
 * exported.
 * servedFile(rel) → absolute path or null is the app:// allowlist: hasFiles only answers for files the page may load.
 */
export function registerStudioIpc(origin, servedFile) {
  const exported = new Set();
  let running = null; // the export in progress: {controller, settled}

  function handle(channel, fn) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!event.senderFrame?.url.startsWith(`${origin}/`)) throw new Error(`Blocked ${channel} from an unexpected page`);
      return fn(event, ...args);
    });
  }

  handle('studio:locateBar', async () => (await loadBar()).locateBar());

  // Which generated files exist (texture thumbnails), so the page never requests missing ones.
  handle('studio:hasFiles', (_event, paths) => paths.map((rel) => {
    const file = typeof rel === 'string' ? servedFile(rel) : null;
    return Boolean(file && existsSync(file));
  }));

  handle('studio:chooseExportDir', (event) => chooseExportDir(BrowserWindow.fromWebContents(event.sender)));

  handle('studio:exportMap', async (event, doc, { quality } = {}) => {
    if (!QUALITIES.includes(quality)) throw new Error(`Unknown export quality "${quality}"`);
    const { exportMap } = await loadBar();
    // The first export asks where maps go (the user keeps big files off C:); later exports reuse the choice.
    const outDir = readSettings().exportDir ?? await chooseExportDir(BrowserWindow.fromWebContents(event.sender));
    if (!outDir) return { cancelled: true };
    await mkdir(outDir, { recursive: true });
    await running?.settled; // one export at a time: a cancelled one may still be writing its archive
    const controller = new AbortController(), { signal } = controller;
    const onProgress = (fraction, label) => { if (!signal.aborted) event.sender.send('studio:progress', { label, fraction }); };
    // shortcut: exportMap does not stop on `signal` yet (smoothing step: make the bake and 7-Zip honour it). Until then a
    // cancelled export finishes in the background, is never offered for install, and the next export waits for it.
    const job = exportMap(doc, outDir, { onProgress, quality, signal });
    running = { controller, settled: job.then(() => {}, () => {}) };
    const aborted = new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }));
    const result = await Promise.race([job, aborted]);
    if (!result || signal.aborted) return { cancelled: true };
    exported.add(result.archivePath);
    return { archivePath: result.archivePath, bytes: result.bytes };
  });

  handle('studio:cancelExport', () => { running?.controller.abort(); });

  // Reveals an archive this session wrote, and nothing else.
  handle('studio:showInFolder', (_event, archivePath) => {
    if (!exported.has(archivePath)) throw new Error('Only a map exported in this session can be shown.');
    shell.showItemInFolder(archivePath);
  });

  handle('studio:installMap', async (event, archivePath) => {
    if (!exported.has(archivePath)) throw new Error('Only a map exported in this session can be installed.');
    const bar = await loadBar();
    // planInstall names exactly what installMap will replace, so the user confirms the real effect.
    const { mapsDir, replaces } = bar.planInstall(archivePath, { mapsDir: bar.locateBar().mapsDir });
    const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
      type: 'question',
      buttons: ['Install', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Install to BAR',
      message: `Install ${path.basename(archivePath)} into Beyond All Reason?`,
      detail: `BAR maps folder:\n${mapsDir}\n\n${replaces.length ? `This replaces:\n${replaces.join('\n')}` : 'No existing file is replaced.'}`,
    });
    if (response !== 0) return { cancelled: true };
    return bar.installMap(archivePath, { mapsDir });
  });
}
