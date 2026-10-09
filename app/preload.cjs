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
  installMap: (archivePath) => invoke('studio:installMap', archivePath),
  onProgress: (callback) => { ipcRenderer.on('studio:progress', (_event, progress) => callback(progress)); },
});
