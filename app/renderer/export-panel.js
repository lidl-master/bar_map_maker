// The export card: non-blocking, bottom right. Every step is listed from the start (pending ones hollow), with a
// progress bar, Cancel while it runs; then the archive with its path (Copy, Show in folder) and Install to BAR, or the
// error with Try again. Esc dismisses a finished card.
import { $, btn, clamp, el } from './dom.js';
import { toast } from './feedback.js';
import { icon } from './icons.js';

// The exporter's progress labels in order (src/bar exportMap onProgress). 'Preparing map' is this side: sending the map
// and, on the first export, asking for the folder.
// shortcut: mirrors src/bar/export.js (WP 2.2 labels); move this plan into src/bar as EXPORT_STEPS when smoothing.
const PLAN = ['Preparing map', 'Loading materials', 'Baking texture', 'Encoding textures', 'Packing archive'];
const MIN_FILL = 0.02; // the bar always shows that something runs

const seconds = (ms) => (ms < 100 ? '<0.1 s' : `${(ms / 1000).toFixed(1)} s`);
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const fileName = (p) => p.split(/[\\/]/).pop();

// {phase: 'running'|'done'|'error', name, steps: [{label, start?, end?, skipped?}], fraction, start, result, error, actions(), onCancel}
let state = null;

const STEP_ICON = { done: 'check', active: 'loader-circle', failed: 'x' };

function stepRow(s) {
  // A step the exporter went past without reporting (nothing to do for this map) counts as done, without a time.
  const status = s.end !== undefined || s.skipped ? 'done' : s.start === undefined ? 'pending' : state.phase === 'error' ? 'failed' : 'active';
  const mark = STEP_ICON[status] ? icon(STEP_ICON[status]) : el('span', { class: 'pending-dot', 'aria-hidden': 'true' });
  const time = s.end !== undefined && s.start !== undefined ? seconds(s.end - s.start) : '';
  return el('li', { class: status }, mark, el('span', { class: 'step' }, s.label), el('span', { class: 'time num' }, time));
}

function pathRow(archivePath) {
  const copy = el('button', { class: 'btn ghost square', 'data-tip': 'Copy path', 'aria-label': 'Copy path' }, icon('copy'));
  copy.addEventListener('click', () => navigator.clipboard.writeText(archivePath).then(
    () => toast('Path copied', 'ok', 2500),
    (error) => toast(`Could not copy the path: ${error.message}`, 'error'),
  ));
  return el('div', { class: 'ep-path' }, el('span', { class: 'path', title: archivePath }, archivePath), copy);
}

/** The exporter's warnings (report.warnings), as text lines under the path; nothing when there are none. */
function warningList(warnings) {
  if (!warnings.length) return null;
  return el('ul', { class: 'ep-warnings' }, ...warnings.map((text) => el('li', {}, icon('triangle-alert'), el('span', {}, text))));
}

function render() {
  const panel = $('exportPanel');
  if (!state) {
    panel.hidden = true;
    return;
  }
  const { phase, name, steps } = state;
  const head = {
    running: ['loader-circle', `Exporting ${name}`, 'You can keep editing while it runs.'],
    done: ['circle-check', 'Export complete', state.result && `${fileName(state.result.archivePath)} · ${megabytes(state.result.bytes)} · ${seconds(state.end - state.start)}`],
    error: ['circle-alert', 'Export failed', name],
  }[phase];
  const stateIcon = icon(head[0], phase === 'running' ? 'state-icon spin' : 'state-icon');
  const fill = Math.max(MIN_FILL, clamp(state.fraction, 0, 1));
  const bar = el('div');
  bar.style.width = `${(fill * 100).toFixed(1)}%`;
  panel.dataset.state = phase;
  panel.replaceChildren(...[
    el('div', { class: 'ep-head' }, stateIcon,
      el('span', { class: 'title' }, el('strong', {}, head[1]), el('span', { class: 'sub' }, head[2] ?? '')),
      phase === 'running' ? el('span', { class: 'pct num' }, `${Math.round(fill * 100)}%`) : null),
    phase === 'running' ? el('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(Math.round(fill * 100)) }, bar) : null,
    el('ol', { class: 'ep-steps' }, ...steps.map(stepRow)),
    phase === 'done' ? pathRow(state.result.archivePath) : null,
    phase === 'done' ? warningList(state.result.report?.warnings ?? []) : null,
    phase === 'error' ? el('div', { class: 'ep-error', role: 'alert' }, state.error) : null,
    el('div', { class: 'ep-actions' }, ...state.actions().map(([label, attrs, iconName]) => btn(label, attrs, iconName)),
      phase === 'running'
        ? btn('Cancel', { class: 'btn ghost', onclick: state.onCancel })
        : btn('Close', { class: 'btn ghost', 'data-tip': 'Close', 'data-key': 'Esc', onclick: closeExportPanel })),
  ].filter(Boolean));
  panel.hidden = false;
}

/** onCancel: the Cancel button while it runs. */
export function startExport(name, onCancel) {
  const now = Date.now();
  state = { phase: 'running', name, steps: PLAN.map((label) => ({ label })), fraction: 0, start: now, actions: () => [], onCancel };
  state.steps[0].start = now;
  render();
}

/** A progress report from the exporter: its label starts that step and closes every earlier one. */
export function exportProgress({ label, fraction }) {
  if (state?.phase !== 'running') return;
  const now = Date.now();
  state.fraction = Math.max(state.fraction, fraction);
  if (label !== 'Done') {
    let at = state.steps.findIndex((s) => s.label === label);
    if (at < 0) { // a step this plan does not know yet: before the first one still pending
      at = state.steps.findIndex((s) => s.start === undefined);
      if (at < 0) at = state.steps.length;
      state.steps.splice(at, 0, { label });
    }
    for (const s of state.steps.slice(0, at)) {
      if (s.start === undefined) s.skipped = true;
      else s.end ??= now;
    }
    state.steps[at].start ??= now;
  }
  render();
}

/** actions(): [[label, buttonAttrs, iconName], …] beside Close, re-read on every render (refreshExportPanel). */
export function exportDone(result, actions) {
  const now = Date.now();
  for (const s of state.steps) {
    if (s.start === undefined) s.skipped = true;
    else s.end ??= now;
  }
  Object.assign(state, { phase: 'done', result, fraction: 1, end: now, actions });
  render();
}

export function exportFailed(message, actions) {
  Object.assign(state, { phase: 'error', error: message, actions });
  render();
}

/** Re-renders the card (its actions follow the export / install state). */
export const refreshExportPanel = () => render();

export function closeExportPanel() {
  state = null;
  render();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state && state.phase !== 'running' && !document.querySelector('dialog[open]')) closeExportPanel();
});
