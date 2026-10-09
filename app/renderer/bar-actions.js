// Export and Install to BAR, through window.studio (the preload bridge). The main process asks before installing.
import { $, el } from './dom.js';
import { closeExportPanel, exportDone, exportFailed, exportProgress, startExport } from './export-panel.js';
import { toast } from './feedback.js';
import { icon } from './icons.js';

let exporting = false, barFound = false;

export function bindBarActions(editor) {
  window.studio.onProgress(exportProgress);
  $('btnExport').addEventListener('click', () => exportMap(editor));
  $('btnInstall').addEventListener('click', () => installMap(editor));
  window.studio.locateBar().then(
    (bar) => {
      barFound = true;
      showBar('ok', 'BAR found', `BAR maps folder: ${bar.mapsDir}`);
    },
    (error) => {
      showBar('missing', 'BAR not found', error.message);
      $('btnInstall').dataset.tip = 'Beyond All Reason was not found on this computer';
    },
  ).finally(() => setExporting(exporting));
}

function showBar(state, label, tip) {
  const node = $('stBar');
  node.dataset.state = state;
  node.dataset.tip = tip;
  node.querySelector('.label').textContent = label;
}

export async function changeExportDir() {
  try {
    const dir = await window.studio.chooseExportDir();
    if (dir) toast(`Maps will be exported to ${dir}`, 'ok', 6000);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function setExporting(busy) {
  exporting = busy;
  $('btnExport').disabled = busy;
  $('btnInstall').disabled = busy || !barFound;
  $('btnExport').replaceChildren(icon(busy ? 'loader-circle' : 'package', busy ? 'spin' : ''), el('span', {}, busy ? 'Exporting…' : 'Export'));
}

/** Exports the open map; resolves with the archive path, or null when cancelled or failed (the panel says why). */
export async function exportMap(editor) {
  if (exporting) return null;
  startExport(editor.doc.settings.name);
  setExporting(true);
  let result;
  try {
    result = await window.studio.exportMap(editor.doc, { quality: editor.exportQuality });
  } catch (error) {
    console.error(error);
    exportFailed(error.message, [['Try again', { class: 'btn primary', onclick: () => exportMap(editor) }, 'package']]);
    return null;
  } finally {
    setExporting(false);
  }
  if (result.cancelled) {
    closeExportPanel();
    toast('Export cancelled: no export folder was chosen.', 'warn');
    return null;
  }
  exportDone(result, barFound ? [['Install to BAR', { class: 'btn primary', onclick: () => installArchive(result.archivePath) }, 'hard-drive-download']] : []);
  return result.archivePath;
}

async function installMap(editor) {
  const archivePath = await exportMap(editor);
  if (archivePath) await installArchive(archivePath);
}

async function installArchive(archivePath) {
  try {
    const result = await window.studio.installMap(archivePath);
    if (result.cancelled) {
      toast('Install cancelled. Nothing in the BAR folder was changed.', 'info');
      return;
    }
    closeExportPanel();
    const replaced = result.removed.length ? `, replacing ${result.removed.length} older file${result.removed.length > 1 ? 's' : ''}` : '';
    toast(`Installed ${result.installedPath}${replaced}. Restart BAR to see it.`, 'ok', 8000);
  } catch (error) {
    toast(`Install failed: ${error.message}`, 'error');
  }
}
