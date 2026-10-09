// Sandboxed preloads must be CommonJS. window.studio is the renderer's only bridge to the main process.
const { contextBridge, ipcRenderer } = require('electron');

// Electron prefixes handler errors with "Error invoking remote method '…': Error: "; the user only needs the reason.
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args).catch((error) => {
  throw new Error(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
});

contextBridge.exposeInMainWorld('studio', {
  locateBar: () => invoke('studio:locateBar'),
  chooseExportDir: () => invoke('studio:chooseExportDir'),
  hasFiles: (paths) => invoke('studio:hasFiles', paths),
  exportMap: (doc, options) => invoke('studio:exportMap', doc, options),
  cancelExport: () => invoke('studio:cancelExport'),
  checkDerivative: (doc) => invoke('studio:checkDerivative', doc),
  showInFolder: (archivePath) => invoke('studio:showInFolder', archivePath),
  installMap: (archivePath) => invoke('studio:installMap', archivePath),
  onProgress: (callback) => { ipcRenderer.on('studio:progress', (_event, progress) => callback(progress)); },
  listBarMaps: () => invoke('studio:listBarMaps'),
  mapThumb: (file) => invoke('studio:mapThumb', file),
  openMap: (file) => invoke('studio:openMap', file),
  onOpenProgress: (callback) => { ipcRenderer.on('studio:openProgress', (_event, progress) => callback(progress)); },
  mapFacts: (archivePath) => invoke('studio:mapFacts', archivePath),
  checkMap: (archivePath) => invoke('studio:checkMap', archivePath),
  cancelCheck: () => invoke('studio:cancelCheck'),
  onCheckProgress: (callback) => { ipcRenderer.on('studio:checkProgress', (_event, progress) => callback(progress)); },
  playtest: (archivePath, options) => invoke('studio:playtest', archivePath, options),
  onPlaytestExit: (callback) => { ipcRenderer.on('studio:playtestExit', (_event, result) => callback(result)); },
  // Before the window closes: callback() saves the last edits; the main process waits for it (briefly).
  onFlush: (callback) => {
    ipcRenderer.on('studio:flush', async () => {
      try { await callback(); } finally { ipcRenderer.send('studio:flushed'); }
    });
  },
});
