import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { QUALITY } from '../src/look/index.js';
import { registerEngineIpc } from './ipc-engine.js';

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

/** Asks for a map archive anywhere on disk; null when the user cancels. */
async function chooseMapArchive(window) {
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: 'Open a BAR map',
    properties: ['openFile'],
    filters: [{ name: 'BAR maps', extensions: ['sd7', 'sdz'] }],
  });
  return canceled || !filePaths.length ? null : filePaths[0];
}

// Minimap thumbnails of the BAR maps, cached per archive version in userData (32 KB each): reading one means
// extracting the archive's SMF, which takes up to a second. A cache file is [sx, sz, …256×256 DXT1], written whole
// (temp file, then rename); one of any other length (an older crash) is read again from the archive.
const THUMB_BYTES = 2 + 256 * 256 / 2;

async function cachedThumb(bar, file) {
  const { size, mtimeMs } = statSync(file);
  const cache = path.join(app.getPath('userData'), 'map-thumbs', `${path.basename(file)}-${size}-${Math.round(mtimeMs)}.bin`);
  const bytes = new Uint8Array(await readFile(cache).catch(() => []));
  if (bytes.length === THUMB_BYTES) return { sx: bytes[0], sz: bytes[1], size: 256, dxt1: bytes.subarray(2) };
  const thumb = await bar.readMinimapThumb(file);
  const out = new Uint8Array(THUMB_BYTES), temp = `${cache}.${randomUUID()}.tmp`;
  out.set([thumb.sx, thumb.sz]);
  out.set(thumb.dxt1, 2);
  await mkdir(path.dirname(cache), { recursive: true });
  await writeFile(temp, out);
  await rename(temp, cache).catch(() => rm(temp, { force: true })); // another request cached it first
  return thumb;
}

/**
 * IPC behind window.studio. Only our own page may call it; install, show-in-folder, check and play-test (ipc-engine.js)
 * only take archives this session exported, and opening reads only archives in the BAR maps folder or ones the user picked.
 * servedFile(rel) → absolute path or null is the app:// allowlist: hasFiles only answers for files the page may load.
 */
export function registerStudioIpc(origin, servedFile) {
  const exported = new Set();
  let running = null; // the export in progress: {controller, settled}

  /** file, if it is a map archive in the BAR maps folder; throws otherwise. */
  function barMap(bar, file) {
    const resolved = path.resolve(String(file));
    if (path.dirname(resolved) !== path.resolve(bar.locateBar().mapsDir) || !bar.MAP_ARCHIVE.test(resolved)) {
      throw new Error(`Not a map in the BAR maps folder: ${file}`);
    }
    return resolved;
  }

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

  handle('studio:listBarMaps', async () => {
    const bar = await loadBar();
    return bar.listMaps(bar.locateBar().mapsDir);
  });

  handle('studio:mapThumb', async (_event, file) => {
    const bar = await loadBar();
    return cachedThumb(bar, barMap(bar, file));
  });

  // A map from the BAR maps folder, or (no file) one the user picks. Progress goes to studio:openProgress.
  handle('studio:openMap', async (event, file) => {
    const bar = await loadBar();
    const archive = file ? barMap(bar, file) : await chooseMapArchive(BrowserWindow.fromWebContents(event.sender));
    if (!archive) return { cancelled: true };
    const onProgress = (fraction, label) => event.sender.send('studio:openProgress', { label, fraction });
    try {
      const { doc, seconds } = await bar.openMapArchive(archive, onProgress);
      console.log(`Opened ${archive}: extract ${seconds.extract.toFixed(2)} s, import ${seconds.import.toFixed(2)} s`);
      onProgress(0.9, 'Building the editor view');
      return doc;
    } catch (error) {
      const name = path.basename(archive); // named once: src/archive's refusals already name it
      throw new Error(error.message.includes(name) ? error.message : `${name}: ${error.message}`);
    }
  });

  handle('studio:exportMap', async (event, doc, { quality } = {}) => {
    if (!Object.keys(QUALITY).includes(quality)) throw new Error(`Unknown export quality "${quality}"`);
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
    return { archivePath: result.archivePath, bytes: result.bytes, report: result.report }; // report: {warnings} from WP 3.3
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

  registerEngineIpc(handle, { exported, readSettings });
}
