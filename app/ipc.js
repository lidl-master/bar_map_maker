import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

const saveSettings = (changes) => writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...changes }, null, 2));

// The BAR maps folder, or null without a BAR install (then no folder is off limits).
function barMapsDir(bar) {
  try {
    return bar.locateBar().mapsDir;
  } catch {
    return null;
  }
}

/** Asks for the export folder and remembers it; null when the user cancels. Refuses BAR's own maps folder. */
async function chooseExportDir(window) {
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: 'Choose the folder for exported maps',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths.length) return null;
  const bar = await loadBar(), mapsDir = barMapsDir(bar);
  if (mapsDir) bar.checkExportDir(filePaths[0], mapsDir);
  saveSettings({ exportDir: filePaths[0] });
  return filePaths[0];
}

// Archives this app wrote (any session): exporting again may replace them without asking.
const MAX_REMEMBERED = 500;
const writtenByUs = (archivePath) => (readSettings().exportedFiles ?? []).includes(archivePath);
const rememberWritten = (archivePath) => saveSettings({ exportedFiles: [...new Set([...(readSettings().exportedFiles ?? []), archivePath])].slice(-MAX_REMEMBERED) });

const QUALITIES = ['share', 'standard']; // export presets (src/bar, WP 2.2)

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
// extracting the archive's SMF, which takes up to a second.
async function cachedThumb(bar, file) {
  const { size, mtimeMs } = statSync(file);
  const cache = path.join(app.getPath('userData'), 'map-thumbs', `${path.basename(file)}-${size}-${Math.round(mtimeMs)}.bin`);
  try {
    const bytes = new Uint8Array(await readFile(cache)); // [sx, sz, …256×256 DXT1]
    return { sx: bytes[0], sz: bytes[1], size: 256, dxt1: bytes.subarray(2) };
  } catch {
    const thumb = await bar.readMinimapThumb(file);
    await mkdir(path.dirname(cache), { recursive: true });
    const bytes = new Uint8Array(2 + thumb.dxt1.length);
    bytes.set([thumb.sx, thumb.sz]);
    bytes.set(thumb.dxt1, 2);
    await writeFile(cache, bytes);
    return thumb;
  }
}

/**
 * IPC behind window.studio. Only our own page may call it; install and show-in-folder only take archives this session
 * exported, and opening reads only archives in the BAR maps folder or ones the user picked.
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
      throw new Error(`${path.basename(archive)}: ${error.message}`);
    }
  });

  // Exports the doc. {exists: archivePath} when that file exists and this app did not write it: the page asks the user
  // and calls again with replace: true.
  handle('studio:exportMap', async (event, doc, { quality, replace = false } = {}) => {
    if (!QUALITIES.includes(quality)) throw new Error(`Unknown export quality "${quality}"`);
    const bar = await loadBar();
    // The first export asks where maps go (the user keeps big files off C:); later exports reuse the choice.
    const outDir = readSettings().exportDir ?? await chooseExportDir(BrowserWindow.fromWebContents(event.sender));
    if (!outDir) return { cancelled: true };
    const mapsDir = barMapsDir(bar);
    if (mapsDir) bar.checkExportDir(outDir, mapsDir); // also a folder chosen before this rule existed
    await mkdir(outDir, { recursive: true });
    await running?.settled; // one export at a time: a cancelled one may still be writing its archive
    const controller = new AbortController(), { signal } = controller;
    const onProgress = (fraction, label) => { if (!signal.aborted) event.sender.send('studio:progress', { label, fraction }); };
    const target = path.join(path.resolve(outDir), bar.archiveFileName(doc.settings));
    const job = bar.exportMap(doc, outDir, { onProgress, quality, signal, replace: replace === true || writtenByUs(target) });
    running = { controller, settled: job.then(() => {}, () => {}) };
    const aborted = new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }));
    let result;
    try {
      result = await Promise.race([job, aborted]);
    } catch (error) {
      if (signal.aborted) return { cancelled: true };
      if (error.code === 'EXISTS') return { exists: error.archivePath };
      throw error;
    }
    if (!result || signal.aborted) return { cancelled: true };
    exported.add(result.archivePath);
    rememberWritten(result.archivePath);
    const { archivePath, bytes, passedThrough, regenerated, warnings } = result;
    return { archivePath, bytes, report: { passedThrough, regenerated, warnings } };
  });

  // Before exporting a map opened from an archive: name clash, the version to suggest (one no archive in the export
  // or BAR maps folder has yet) and the original's licence. doc: {settings, original}.
  handle('studio:checkDerivative', async (_event, doc) => {
    const bar = await loadBar();
    const dirs = [readSettings().exportDir, barMapsDir(bar)].filter(Boolean);
    const taken = (version) => dirs.some((dir) => existsSync(path.join(dir, bar.archiveFileName({ ...doc.settings, version }))));
    return bar.checkDerivative(doc, taken);
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
