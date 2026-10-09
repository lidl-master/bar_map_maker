// Check map: exports the map if it changed, then shows BAR's engine verdict (src/bar/check.js, 1-2 minutes in the
// background) and the G7 checklist (src/bar/checklist.js) with one-click fixes. The checklist is judged on the
// export's facts with the open map's own facts on top, so a fix shows its effect at once; every fix is one undo step.
import { checklist, docFacts } from '../../src/bar/checklist.js';
import { currentExport } from './bar-actions.js';
import { $, btn, clamp, el } from './dom.js';
import { toast } from './feedback.js';
import { icon } from './icons.js';
import { buildPanels } from './panels.js';

const STATUS = { fail: ['circle-x', 'Failure', 'Failures'], warn: ['triangle-alert', 'Warning', 'Warnings'], pass: ['circle-check', 'Pass', 'Pass'] };
const ORDER = { fail: 0, warn: 1, pass: 2 };
const fileName = (p) => p.split(/[\\/]/).pop();

// {docKey, phase: 'export'|'ready'|'noExport', exportStep, archivePath, facts, factsError,
//  engine: {phase: 'running'|'done'|'error', fraction, label, result, error}}
let run = null;

export function bindCheck(editor) {
  $('btnCheck').addEventListener('click', () => openCheck(editor));
  $('ckAgain').addEventListener('click', () => startCheck(editor));
  window.studio.onProgress(({ label, fraction }) => {
    if (run?.phase !== 'export') return;
    run.exportStep = { label, fraction };
    render(editor);
  });
  window.studio.onCheckProgress(({ label, fraction }) => {
    if (run?.engine?.phase !== 'running') return;
    Object.assign(run.engine, { label, fraction });
    render(editor);
  });
}

function openCheck(editor) {
  $('dlgCheck').showModal();
  if (run?.engine?.phase === 'running' || run?.phase === 'export') render(editor);
  else startCheck(editor);
}

async function startCheck(editor) {
  if (run?.engine?.phase === 'running' || run?.phase === 'export') return;
  run = { docKey: editor.docKey, phase: 'export', exportStep: null };
  render(editor);
  const archivePath = await currentExport(editor);
  if (!archivePath) {
    run.phase = 'noExport';
    render(editor);
    return;
  }
  Object.assign(run, { phase: 'ready', archivePath, engine: { phase: 'running', fraction: 0, label: 'Starting BAR\'s engine' } });
  render(editor);
  const current = run;
  const engine = window.studio.checkMap(archivePath).then(
    (result) => Object.assign(current.engine, { phase: 'done', result }),
    (error) => Object.assign(current.engine, { phase: 'error', error: error.message }),
  );
  try {
    current.facts = await window.studio.mapFacts(archivePath);
  } catch (error) {
    current.factsError = error.message;
  }
  render(editor);
  await engine;
  render(editor);
  if (!$('dlgCheck').open && current === run) toast(engineSummary(current.engine)[1], current.engine.result?.ok ? 'ok' : 'warn', 8000);
}

/** One undo step: the fix edits the doc, the views and panels follow, the rows are judged again on the edited map. */
function applyFix(editor, fix) {
  editor.history.begin(editor.doc, fix.label.toLowerCase());
  const rect = fix.apply(editor.doc);
  editor.commit(rect);
  buildPanels(editor);
  editor.objectsChanged();
  editor.terrainChanged(rect ?? undefined); // settings fixes (sun) recolour the whole shaded view
  render(editor);
}

// [state, title, detail] of the engine run.
function engineSummary(engine) {
  if (engine.phase === 'running') return ['running', 'Loading the map in BAR\'s engine', engine.label];
  if (engine.phase === 'error') return ['fail', 'BAR\'s engine could not run', engine.error];
  const r = engine.result;
  if (r.cancelled) return ['cancelled', 'Engine check cancelled', 'Check again to run it.'];
  const facts = [`${r.frames} frames`, r.metalSpots !== null && `${r.metalSpots} metal spots`, r.geos !== null && `${r.geos} geos`,
    r.lava !== null && `lava at ${Math.round(r.lava)}`, `${Math.round(r.seconds)} s`].filter(Boolean).join(' · ');
  return r.ok ? ['pass', 'Loads cleanly in BAR', facts] : ['fail', 'BAR reported problems', facts];
}

function engineCard(engine) {
  const [state, title, detail] = engineSummary(engine);
  const stateIcon = { running: 'loader-circle', pass: 'circle-check', fail: 'circle-x', cancelled: 'circle-alert' }[state];
  const body = [el('strong', {}, title), el('span', { class: 'detail' }, detail)];
  if (state === 'running') {
    const bar = el('div');
    bar.style.width = `${Math.round(clamp(engine.fraction, 0.02, 1) * 100)}%`;
    body.push(el('div', { class: 'progress' }, bar));
  }
  const problems = engine.result && !engine.result.ok && !engine.result.cancelled
    ? el('ul', { class: 'ck-problems' }, ...[...engine.result.failures, ...engine.result.mapErrors].map((line) => el('li', {}, line)))
    : null;
  return el('div', { class: 'ck-engine', 'data-state': state },
    icon(stateIcon, state === 'running' ? 'state-icon spin' : 'state-icon'),
    el('div', { class: 'text' }, ...body, problems),
    state === 'running' ? btn('Cancel', { class: 'btn', onclick: () => window.studio.cancelCheck() }) : null);
}

// The checklist on the export's facts (none when the export failed) with the open map's own facts on top.
function checklistRows(editor) {
  if (run.factsError) return el('div', { class: 'ck-error', role: 'alert' }, `The checklist could not read the export: ${run.factsError}`);
  if (run.phase === 'ready' && !run.facts) return el('div', { class: 'ck-wait' }, el('div', { class: 'spinner' }), 'Reading the export\'s settings, textures and resources…');
  // The open map's own facts count only while it is the map that was exported (not after opening another one).
  const sameMap = editor.doc && editor.docKey === run.docKey;
  const rows = checklist({ ...run.facts, ...(sameMap ? docFacts(editor.doc) : {}) }).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const counts = Object.keys(STATUS).map((status) => [status, rows.filter((r) => r.status === status).length]).filter(([, n]) => n);
  return [
    el('div', { class: 'ck-counts' }, ...counts.map(([status, n]) => el('span', { class: `badge ck-${status}` }, icon(STATUS[status][0]), `${n} ${n === 1 ? STATUS[status][1].toLowerCase() : STATUS[status][2].toLowerCase()}`))),
    el('ul', { class: 'ck-rows' }, ...rows.map((row) => el('li', { class: 'ck-row', 'data-status': row.status },
      icon(STATUS[row.status][0]),
      el('div', { class: 'text' }, el('strong', {}, row.label), el('span', { class: 'detail' }, row.detail)),
      row.fix && sameMap ? btn(row.fix.label, { class: 'btn', onclick: () => applyFix(editor, row.fix) }, 'wrench') : null))),
  ];
}

function render(editor) {
  const body = $('ckBody');
  if (!run) return;
  $('ckAgain').disabled = run.phase === 'export' || run.engine?.phase === 'running';
  $('ckSub').textContent = run.archivePath ? fileName(run.archivePath) : '';
  if (run.phase === 'export') {
    const step = run.exportStep;
    body.replaceChildren(el('div', { class: 'ck-wait' }, el('div', { class: 'spinner' }),
      `Exporting the map first${step ? `: ${step.label} (${Math.round(step.fraction * 100)}%)` : '…'}`));
    return;
  }
  if (run.phase === 'noExport') {
    // Without an archive neither BAR nor the texture checks can run; the map's own checks still can (a sun in the
    // south, for one, stops the export and has a fix here).
    body.replaceChildren(
      el('div', { class: 'ck-error', role: 'alert' }, 'The map was not exported (cancelled, or the export card says why), so BAR\'s engine and the texture checks did not run. The checks below come from the map itself: fix them, then Check again.'),
      el('section', {}, el('h3', {}, 'BAR map checklist'), ...[checklistRows(editor)].flat()),
    );
    return;
  }
  body.replaceChildren(
    el('section', {}, el('h3', {}, 'In BAR\'s engine'), engineCard(run.engine)),
    el('section', {}, el('h3', {}, 'BAR map checklist'), ...[checklistRows(editor)].flat()),
  );
}
