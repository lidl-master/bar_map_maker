import { app, BrowserWindow, Menu, net, protocol, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerStudioIpc } from './ipc.js';

const repoRoot = path.join(import.meta.dirname, '..');
const APP_ORIGIN = 'app://studio';

// The only files the renderer may load: its own folder, the pure modules in src/, three.js, the Inter font,
// Lucide's icon modules and the texture library's thumbnails.
const SERVED = [
  /^app\/renderer\/[\w./-]+$/,
  /^src\/[\w./-]+\.js$/,
  /^node_modules\/three\/build\/three\.(module|core)\.js$/,
  /^node_modules\/@fontsource-variable\/inter\/files\/inter-latin-wght-normal\.woff2$/,
  /^node_modules\/lucide\/dist\/esm\/icons\/[a-z0-9-]+\.mjs$/,
  /^assets\/textures\/thumbs\/[\w-]+\.png$/,
];

/** The absolute path of a repo-relative file the renderer may load, or null. */
function servedFile(rel) {
  const file = path.resolve(repoRoot, rel);
  const normal = path.relative(repoRoot, file).replaceAll('\\', '/');
  return normal === rel && SERVED.some((pattern) => pattern.test(rel)) ? file : null;
}

// Before ready: a standard + secure scheme gets a real origin, so module scripts and module workers work.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);

function serveAppFile(request) {
  const url = new URL(request.url);
  const file = url.host === 'studio' ? servedFile(decodeURIComponent(url.pathname).slice(1)) : null;
  return file ? net.fetch(pathToFileURL(file).href) : new Response('Not found', { status: 404 });
}

// The app only ever shows its own bundled page: no navigation, no popups, for every web contents.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// Not a top-level await: Electron waits for the ESM entry to finish evaluating, so awaiting ready here deadlocks under Playwright.
app.whenReady().then(() => {
  // Every permission is refused except writing text to the clipboard (the export card's Copy path).
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  protocol.handle('app', serveAppFile);
  registerStudioIpc(APP_ORIGIN, servedFile);
  // No default menu: its Ctrl+R reload would silently throw away the open map. Text editing keys work without it on Windows.
  Menu.setApplicationMenu(null);
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1024, // 1280 × 800 at 125 % display scaling
    minHeight: 640,
    backgroundColor: '#0e1014',
    // These match Electron's defaults; stated so a later edit cannot drop them silently.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(import.meta.dirname, 'preload.cjs') },
  });
  return mainWindow.loadURL(`${APP_ORIGIN}/app/renderer/index.html`);
}).catch((error) => {
  // A window without its shell is useless; fail loudly instead of leaving it blank.
  console.error('BAR Map Studio failed to start:', error);
  app.exit(1);
});
