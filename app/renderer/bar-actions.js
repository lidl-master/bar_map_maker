// Export and Install to BAR, through window.studio (the preload bridge), plus the Export options popover (quality preset,
// export folder). One busy state drives the top bar and the export card, so their buttons always agree.
// The main process asks before installing.
import { editCount } from './autosave.js';
import { $, el, segmented } from './dom.js';
import { closeExportPanel, exportDone, exportFailed, exportProgress, refreshExportPanel, startExport } from './export-panel.js';
import { readyToDerive } from './derivative.js';
import { confirmDialog, toast } from './feedback.js';
import { icon } from './icons.js';

// src/bar export presets (WP 2.2).
const QUALITY = {
  share: { label: 'Share · ≤ 50 MB', help: 'Keeps the archive under 50 MB for sharing and downloads; textures are slightly softer.' },
  standard: { label: 'Standard', help: 'Full texture detail. A larger archive, fine for local play and testing.' },
};

let busy = null, barFound = false, cancelRequested = false; // busy: null | 'prepare' (checks before an export) | 'export' | 'install'
let lastExport = null; // {archivePath, doc, edits}: the archive Check map and Play-test use while the map is unchanged
let quality = savedQuality();

function savedQuality() {
  try {
    const key = localStorage.getItem('exportQuality');
    return Object.hasOwn(QUALITY, key ?? '') ? key : 'share';
  } catch {
    return 'share'; // storage unavailable: the default preset
  }
}

function setQuality(key) {
  quality = key;
  $('qualityHelp').textContent = QUALITY[key].help;
  try { localStorage.setItem('exportQuality', key); } catch { /* a preference only; the default applies next time */ }
}

export function bindBarActions(editor) {
  window.studio.onProgress(exportProgress);
  $('btnExport').addEventListener('click', () => exportMap(editor));
  $('btnInstall').addEventListener('click', () => installMap(editor));
  $('qualityChoice').append(segmented(Object.entries(QUALITY).map(([key, q]) => [key, q.label]), quality, setQuality, 'block'));
  setQuality(quality);
  $('btnExportDir').addEventListener('click', () => {
    $('exportOptions').hidePopover();
    changeExportDir();
  });
  window.studio.locateBar().then(
    (bar) => {
      barFound = true;
      showBar('ok', 'BAR found', `BAR maps folder: ${bar.mapsDir}`);
    },
    (error) => {
      showBar('missing', 'BAR not found', error.message);
      $('btnInstall').dataset.tip = 'Beyond All Reason was not found on this computer';
    },
  ).finally(() => setBusy(busy));
}

function showBar(state, label, tip) {
  const node = $('stBar');
  node.dataset.state = state;
  node.dataset.tip = tip;
  node.querySelector('.label').textContent = label;
}

async function changeExportDir() {
  try {
    const dir = await window.studio.chooseExportDir();
    if (dir) toast(`Maps will be exported to ${dir}`, 'ok', 6000);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function setBusy(next) {
  busy = next;
  $('btnExport').disabled = $('btnExportOptions').disabled = busy !== null;
  $('btnInstall').disabled = busy !== null || !barFound;
  const exporting = busy === 'export';
  $('btnExport').replaceChildren(icon(exporting ? 'loader-circle' : 'file-output', exporting ? 'spin' : ''), el('span', {}, exporting ? 'Exporting…' : 'Export'));
  refreshExportPanel();
}

function doneActions(archivePath) {
  return () => [
    ['Show in folder', { class: 'btn', onclick: () => window.studio.showInFolder(archivePath).catch((error) => toast(error.message, 'error')) }, 'folder-open'],
    ...(barFound ? [[busy === 'install' ? 'Installing…' : 'Install to BAR', { class: 'btn accent-icon', disabled: busy !== null, onclick: () => installArchive(archivePath) }, 'hard-drive-download']] : []),
  ];
}

// Runs the checks before an export with the export buttons disabled (no spinner: the user is answering a dialog).
async function withBusy(fn) {
  setBusy('prepare');
  try {
    return await fn();
  } catch (error) {
    toast(error.message, 'error');
    return false;
  } finally {
    setBusy(null);
  }
}

/**
 * Exports the open map; resolves with the archive path, or null when cancelled or failed (the card says why).
 * A map opened from an archive first gets its own version and the licence check (derivative.js); an archive of the
 * same name that this app did not write is only replaced when the user confirms.
 */
export async function exportMap(editor, replace = false) {
  if (busy) return null;
  const derivative = Boolean(editor.doc.original);
  if (derivative && !replace && !(await withBusy(() => readyToDerive(editor)))) return null;
  cancelRequested = false;
  startExport(editor.doc.settings.name, derivative, () => {
    cancelRequested = true;
    window.studio.cancelExport();
  });
  setBusy('export');
  const exported = { doc: editor.doc, edits: editCount() }; // the map as it is sent; edits during the export are not in it
  let result;
  try {
    result = await window.studio.exportMap(editor.doc, { quality, replace });
  } catch (error) {
    console.error(error);
    exportFailed(error.message, () => [['Try again', { class: 'btn accent-icon', disabled: busy !== null, onclick: () => exportMap(editor) }, 'file-output']]);
    return null;
  } finally {
    setBusy(null);
  }
  if (result.exists) {
    closeExportPanel();
    const file = result.exists.split(/[\\/]/).pop();
    const ok = await confirmDialog({
      title: `Replace ${file}?`,
      text: `${result.exists} already exists and was not written by BAR Map Studio. Replacing it deletes that file.`,
      ok: 'Replace',
    });
    return ok ? exportMap(editor, true) : null;
  }
  if (result.cancelled) {
    closeExportPanel();
    toast(cancelRequested ? 'Export cancelled.' : 'Export cancelled: no export folder was chosen.', 'warn');
    return null;
  }
  exportDone(result, doneActions(result.archivePath));
  lastExport = { ...exported, archivePath: result.archivePath };
  return result.archivePath;
}

/** The open map's archive as the map is now: the last export while nothing changed since, else a fresh export (null when
 * that is cancelled or fails). */
export async function currentExport(editor) {
  if (lastExport?.doc === editor.doc && lastExport.edits === editCount()) return lastExport.archivePath;
  return exportMap(editor);
}

async function installMap(editor) {
  const archivePath = await exportMap(editor);
  if (archivePath) await installArchive(archivePath);
}

async function installArchive(archivePath) {
  if (busy) return;
  setBusy('install');
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
  } finally {
    setBusy(null);
  }
}
