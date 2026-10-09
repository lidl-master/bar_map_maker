import { app, BrowserWindow, dialog, ipcMain } from 'electron';
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

/** IPC behind window.studio. Only our own page may call it; installs only take archives this session exported. */
export function registerStudioIpc(origin) {
  const exported = new Set();

  function handle(channel, fn) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!event.senderFrame?.url.startsWith(`${origin}/`)) throw new Error(`Blocked ${channel} from an unexpected page`);
      return fn(event, ...args);
    });
  }

  handle('studio:locateBar', async () => (await loadBar()).locateBar());

  handle('studio:exportMap', async (event, doc) => {
    const { exportMap } = await loadBar();
    const outDir = path.join(app.getPath('documents'), 'BAR Map Studio');
    await mkdir(outDir, { recursive: true });
    const onProgress = (label, fraction) => event.sender.send('studio:progress', { label, fraction });
    const { archivePath, bytes } = await exportMap(doc, outDir, { onProgress });
    exported.add(archivePath);
    return { archivePath, bytes };
  });

  handle('studio:installMap', async (event, archivePath) => {
    if (!exported.has(archivePath)) throw new Error('Only a map exported in this session can be installed.');
    const bar = await loadBar();
    // planInstall (contract addition for src/bar) names exactly what installMap will replace, so the user confirms the real effect.
    const { mapsDir, replaces } = await bar.planInstall(archivePath);
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
    return bar.installMap(archivePath, { replace: true });
  });
}
