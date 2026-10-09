// Before exporting a map opened from an archive (doc.original): it needs a version of its own when its name would
// clash with the original's, and the user hears about the original's licence when it forbids derivatives (ND) or
// commercial use (NC). The main process reads the archive (studio.checkDerivative); every text goes in as text.
import { confirmDialog, promptDialog } from './feedback.js';

const accepted = new Set(); // original archives whose licence warning the user accepted this session

const LICENCE_TEXT = {
  nd: 'does not allow sharing changed versions (ND): keep yours for your own games unless the author agrees',
  nc: 'does not allow commercial use (NC): never sell your version or use it commercially',
};

/** Resolves true when the export may go ahead (the version may have been changed on the way). */
export async function readyToDerive(editor) {
  const { settings, original } = editor.doc;
  const check = await window.studio.checkDerivative({ settings, original });
  if (check.clash) {
    const same = (v) => v.toLowerCase() === String(original.info.version ?? '').toLowerCase();
    const version = await promptDialog({
      title: 'Save as a new version',
      text: `${original.info.name} ${original.info.version} is the map you opened. Your map needs its own version so BAR can tell the two apart; the original stays as it is.`,
      label: 'New version',
      value: check.suggestedVersion,
      ok: 'Use this version',
      valid: (v) => v !== '' && !same(v),
    });
    if (version === null) return false;
    settings.version = version;
    const field = document.querySelector('[data-field=version]');
    if (field) field.value = version;
    editor.markDirty();
  }
  const { licence } = check;
  if ((licence.nd || licence.nc) && !accepted.has(original.archive)) {
    const terms = ['nd', 'nc'].filter((k) => licence[k]).map((k) => LICENCE_TEXT[k]).join(', and ');
    const ok = await confirmDialog({
      title: 'Check the original map\'s licence',
      text: `${original.info.name} by ${original.info.author || 'its author'} is licensed ${licence.licence}, which ${terms}. Your export credits the original author.`,
      ok: 'Export for personal use',
      tone: 'warn',
    });
    if (!ok) return false;
    accepted.add(original.archive);
  }
  return true;
}
