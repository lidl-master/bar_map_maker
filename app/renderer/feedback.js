// Feedback: toasts, the in-app confirm dialog, tooltips and the loading state for long jobs.
import { $, el } from './dom.js';
import { icon } from './icons.js';

const TOAST_ICONS = { info: 'info', ok: 'circle-check', warn: 'triangle-alert', error: 'circle-alert' };
const MAX_TOASTS = 4;

/** A toast; kind is 'info' | 'ok' | 'warn' | 'error'. Errors stay longer. */
export function toast(message, kind = 'info', ms = kind === 'error' ? 9000 : 4000) {
  const box = $('toasts');
  const close = el('button', { class: 'close', 'aria-label': 'Dismiss' }, icon('x'));
  const node = el('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, icon(TOAST_ICONS[kind]), el('span', { class: 'msg' }, message), close);
  const dismiss = () => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 120);
  };
  close.addEventListener('click', dismiss);
  box.append(node);
  while (box.children.length > MAX_TOASTS) box.firstElementChild.remove();
  setTimeout(dismiss, ms);
}

/** The app's confirm dialog. Resolves true when the user confirms. */
export function confirmDialog({ title, text, ok }) {
  const dialog = $('dlgConfirm');
  $('cfTitle').textContent = title;
  $('cfText').textContent = text;
  $('cfOk').textContent = ok;
  return new Promise((resolve) => {
    const finish = (answer) => {
      $('cfOk').onclick = $('cfCancel').onclick = dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(answer);
    };
    $('cfOk').onclick = () => finish(true);
    $('cfCancel').onclick = () => finish(false);
    dialog.onclose = () => finish(false); // Esc
    dialog.showModal();
    $('cfCancel').focus();
  });
}

/** Covers the map views (or the whole window on the welcome screen) while fn runs; errors become a toast. */
export async function withLoading(title, detail, fn) {
  $('loadingTitle').textContent = title;
  $('loadingText').textContent = detail;
  $('loading').hidden = false;
  try {
    return await fn();
  } catch (error) {
    console.error(error);
    toast(error.message, 'error');
    return undefined;
  } finally {
    $('loading').hidden = true;
  }
}

// ---- tooltips: any element with data-tip (and optional data-key) gets a designed tooltip on hover and keyboard focus.
let tipTimer = 0, lastHidden = 0, tipFor = null;

function showTip(target) {
  const tip = $('tooltip');
  tipFor = target;
  tip.replaceChildren(target.dataset.tip, ...(target.dataset.key ? [el('kbd', {}, target.dataset.key)] : []));
  tip.hidden = false;
  const r = target.getBoundingClientRect(), t = tip.getBoundingClientRect(), gap = 8;
  const right = target.closest('#toolbar');
  let x = right ? r.right + gap : r.left + r.width / 2 - t.width / 2;
  let y = right ? r.top + r.height / 2 - t.height / 2 : r.bottom + gap;
  if (!right && y + t.height > innerHeight - 4) y = r.top - gap - t.height;
  x = Math.max(4, Math.min(innerWidth - t.width - 4, x));
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function hideTip() {
  clearTimeout(tipTimer);
  if (!$('tooltip').hidden) lastHidden = performance.now();
  $('tooltip').hidden = true;
  tipFor = null;
}

function scheduleTip(target) {
  if (target === tipFor) return;
  hideTip();
  // Moving from one tooltip to the next shows it at once, like native toolbars.
  tipTimer = setTimeout(() => showTip(target), performance.now() - lastHidden < 400 ? 0 : 450);
}

export function bindTooltips() {
  document.addEventListener('pointerover', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (target) scheduleTip(target);
    else if (tipFor) hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (target?.matches(':focus-visible')) scheduleTip(target);
  });
  for (const type of ['pointerdown', 'keydown', 'focusout', 'wheel']) document.addEventListener(type, hideTip, true);
  document.addEventListener('pointerleave', hideTip);
}
