// The export progress panel: non-blocking, bottom right. Steps appear as the exporter reports them (src/bar onProgress labels),
// then it shows the result with Install to BAR, or the error with Try again.
import { $, btn, clamp, el } from './dom.js';
import { icon } from './icons.js';

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
export const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const fileName = (p) => p.split(/[\\/]/).pop();

let state = null; // {phase, name, steps: [{label, start, end}], fraction, start, result, error, actions}

function render() {
  const panel = $('exportPanel');
  if (!state) {
    panel.hidden = true;
    return;
  }
  const { phase, name, steps, fraction } = state;
  const head = {
    running: ['loader-circle', `Exporting ${name}`, 'You can keep editing; the export uses the map as it was when you clicked.'],
    done: ['circle-check', 'Export complete', state.result && `${fileName(state.result.archivePath)} · ${megabytes(state.result.bytes)} · ${seconds(Date.now() - state.start)}`],
    error: ['circle-alert', 'Export failed', name],
  }[phase];
  const stateIcon = icon(head[0], 'lg state-icon');
  if (phase === 'running') stateIcon.classList.add('spin');
  const bar = el('div');
  bar.style.width = `${Math.round(clamp(fraction, 0, 1) * 100)}%`;
  panel.dataset.state = phase;
  panel.replaceChildren(
    el('div', { class: 'ep-head' }, stateIcon,
      el('span', { class: 'title' }, el('strong', {}, head[1]), el('span', { class: 'sub' }, head[2] ?? '')),
      phase === 'running' ? el('span', { class: 'pct num' }, `${Math.round(fraction * 100)}%`) : null),
    phase === 'running' ? el('div', { class: 'progress' }, bar) : null,
    el('ol', { class: 'ep-steps' }, ...steps.map((s) => {
      const done = s.end !== undefined, failed = phase === 'error' && !done;
      return el('li', { class: done ? 'done' : failed ? 'failed' : 'active' },
        icon(done ? 'check' : failed ? 'x' : 'loader-circle'), s.label,
        el('span', { class: 'time num' }, done ? seconds(s.end - s.start) : ''));
    })),
    phase === 'error' ? el('div', { class: 'ep-error', role: 'alert' }, state.error) : null,
    phase === 'running' ? null : el('div', { class: 'ep-actions' }, ...state.actions.map(([label, attrs, iconName]) => btn(label, attrs, iconName)),
      btn('Close', { class: 'btn ghost', onclick: closeExportPanel })),
  );
  panel.hidden = false;
}

export function startExport(name) {
  const now = Date.now();
  state = { phase: 'running', name, steps: [{ label: 'Preparing map', start: now }], fraction: 0, start: now, actions: [] };
  render();
}

/** A progress report from the exporter: a new label closes the previous step; 'Done' closes them all. */
export function exportProgress({ label, fraction }) {
  if (state?.phase !== 'running') return;
  const now = Date.now(), current = state.steps.at(-1);
  state.fraction = fraction;
  if (label !== current.label) {
    current.end = now;
    if (label !== 'Done') state.steps.push({ label, start: now });
  }
  render();
}

/** actions: [[label, buttonAttrs, iconName], …] shown next to Close. */
export function exportDone(result, actions) {
  const now = Date.now();
  for (const s of state.steps) s.end ??= now;
  Object.assign(state, { phase: 'done', result, fraction: 1, actions });
  render();
}

export function exportFailed(message, actions) {
  Object.assign(state, { phase: 'error', error: message, actions });
  render();
}

export function closeExportPanel() {
  state = null;
  render();
}
