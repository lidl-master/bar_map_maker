// Export and Install to BAR, through window.studio (the preload bridge). The main process asks before installing.
import { $, busy, progress, toast } from './dom.js';

const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

export function bindBarActions(editor) {
  window.studio.onProgress(({ label, fraction }) => progress(label, fraction));
  $('btnExport').addEventListener('click', () => exportMap(editor));
  $('btnInstall').addEventListener('click', () => installMap(editor));
  window.studio.locateBar().then(
    (bar) => { $('stBar').textContent = `BAR maps folder: ${bar.mapsDir}`; },
    (error) => { $('stBar').textContent = 'BAR not found'; $('stBar').title = error.message; },
  );
}

export async function changeExportDir() {
  try {
    const dir = await window.studio.chooseExportDir();
    if (dir) toast(`Maps will be exported to ${dir}`, 6000);
  } catch (error) {
    toast(`Error: ${error.message}`, 8000);
  }
}

function exportMap(editor) {
  return busy('Exporting…', async () => {
    const result = await window.studio.exportMap(editor.doc);
    if (result.cancelled) {
      toast('Export cancelled: no export folder was chosen.');
      return undefined;
    }
    toast(`Exported ${result.archivePath} (${megabytes(result.bytes)})`, 6000);
    return result.archivePath;
  });
}

async function installMap(editor) {
  const archivePath = await exportMap(editor);
  if (!archivePath) return;
  try {
    const result = await window.studio.installMap(archivePath);
    if (result.cancelled) toast('Install cancelled. Nothing in the BAR folder was changed.');
    else toast(`Installed ${result.installedPath}${result.removed.length ? `, replaced ${result.removed.length} older file(s)` : ''}. Restart BAR to see it.`, 8000);
  } catch (error) {
    toast(`Install failed: ${error.message}`, 8000);
  }
}
