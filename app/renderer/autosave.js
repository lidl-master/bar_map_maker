// Autosave: a moment after the last change the open map is saved on this computer (recent.js), and the top bar's
// chip says so. The welcome screen lists saved maps under Recent maps.
import { $ } from './dom.js';
import { saveMap } from './recent.js';

const SAVE_DELAY = 1500;
let saveTimer = 0, edits = 0; // edits counts changes, so a save that finishes after a newer edit does not claim "Saved"
let lastSave = Promise.resolve(); // the save in flight, for flushSave to wait on

function showSaveState(state, label, tip = '') {
  const chip = $('saveState');
  chip.dataset.state = state;
  chip.dataset.tip = tip || label;
  chip.querySelector('.label').textContent = label;
}

const SAVED_TIP = 'Saved on this computer. Reopen it from the welcome screen.';
export const markSaved = () => showSaveState('saved', 'Saved', SAVED_TIP);
/** A map opened from an archive and not edited yet: not stored here (the archive has it). */
export const markUnchanged = () => showSaveState('saved', 'Unchanged', 'Saved on this computer from your first change.');

/** How many changes the open session has seen: equal counts mean the map did not change in between. */
export const editCount = () => edits;

export function scheduleSave(editor) {
  edits++;
  showSaveState('dirty', 'Unsaved changes', 'Saved on this computer a moment after you stop editing');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(editor), SAVE_DELAY);
}

/** Saves now if a save is waiting (before another map replaces the open one, or the window closes); resolves when stored. */
export function flushSave(editor) {
  return saveTimer ? saveNow(editor) : lastSave;
}

export function saveNow(editor) {
  clearTimeout(saveTimer);
  saveTimer = 0;
  const saving = edits;
  showSaveState('saving', 'Saving…');
  lastSave = saveMap(editor.docKey, editor.doc, thumbnail(editor.view2d.base)).then(
    () => { if (saving === edits) markSaved(); },
    (error) => {
      console.error(error);
      showSaveState('error', 'Not saved', `Could not save on this computer: ${error.message}`);
    },
  );
  return lastSave;
}

/** A 64×64 RGBA preview of the 2D map image for the recent maps list. */
function thumbnail(source, size = 64) {
  const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, size, size);
  return { size, rgba: ctx.getImageData(0, 0, size, size).data };
}
