import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';

// The app only ever shows its own bundled page: no navigation, no popups, for every web contents.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// Not a top-level await: Electron waits for the ESM entry to finish evaluating, so awaiting ready here deadlocks under Playwright.
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // These match Electron's defaults; stated so a later edit cannot drop them silently.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // shortcut: file:// is fine while the renderer only loads our own static files; move to a custom app:// protocol before it loads anything from user disk.
  return mainWindow.loadFile(path.join(import.meta.dirname, 'renderer', 'index.html'));
}).catch((error) => {
  // A window without its shell is useless; fail loudly instead of leaving it blank.
  console.error('BAR Map Studio failed to start:', error);
  app.exit(1);
});
