// Play-test: the top bar's popover (AI difficulty, faction) launches BAR in a window, the user against BARb on the
// current export (exported first when the map changed). The map is never installed (src/bar/playtest.js).
import { DIFFICULTIES, SIDES } from '../../src/bar/playtest-options.js';
import { currentExport } from './bar-actions.js';
import { $, el, segmented } from './dom.js';
import { toast } from './feedback.js';

function remembered(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback; // storage unavailable: the default
  }
}

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* a preference only */ }
}

export function bindPlaytest(editor) {
  const choice = {
    difficulty: remembered('playtestDifficulty', Object.keys(DIFFICULTIES), 'medium'),
    side: remembered('playtestSide', SIDES, 'Armada'),
  };
  const difficulty = $('ptDifficulty');
  difficulty.append(...Object.entries(DIFFICULTIES).map(([key, label]) => el('option', { value: key }, label)));
  difficulty.value = choice.difficulty;
  difficulty.addEventListener('change', () => remember('playtestDifficulty', choice.difficulty = difficulty.value));
  $('ptSide').append(segmented(SIDES.map((side) => [side, side]), choice.side, (side) => remember('playtestSide', choice.side = side), 'block'));
  $('ptStart').addEventListener('click', () => {
    $('playtestMenu').hidePopover();
    launch(editor, choice);
  });
  window.studio.onPlaytestExit(({ code, log }) => {
    if (code === 0) toast('BAR closed.', 'info');
    else toast(`BAR closed with exit code ${code}. Its log: ${log}`, 'error');
  });
}

let launching = false;

async function launch(editor, { difficulty, side }) {
  if (launching) return;
  launching = true;
  try {
    const archivePath = await currentExport(editor);
    if (!archivePath) return; // the export card says why
    toast('Starting BAR…', 'info', 3000);
    await window.studio.playtest(archivePath, { difficulty, side });
    toast(`BAR is starting against ${DIFFICULTIES[difficulty]} BARb: its window opens within a minute or two. The map is not installed.`, 'ok', 12000);
  } catch (error) {
    toast(`Play-test failed: ${error.message}`, 'error');
  } finally {
    launching = false;
  }
}
