// Feedback: toasts, the in-app confirm dialog, tooltips and the loading state for long jobs.
import { $, clamp, el, keys } from './dom.js';
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

/** Covers the map views (or the whole window on the welcome screen) until hideLoading(). */
export function showLoading(title, detail) {
  $('loadingTitle').textContent = title;
  $('loadingText').textContent = detail;
  $('loadingBar').hidden = true;
  $('loading').hidden = false;
}

/** A step of the job under the loading cover: its label and how far the job is (0..1). */
export function loadingProgress(label, fraction) {
  $('loadingText').textContent = label;
  $('loadingBar').hidden = false;
  $('loadingBar').firstElementChild.style.width = `${Math.round(clamp(fraction, 0, 1) * 100)}%`;
}

export const hideLoading = () => { $('loading').hidden = true; };

/** The loading cover while fn runs; errors become a toast. */
export async function withLoading(title, detail, fn) {
  showLoading(title, detail);
  try {
    return await fn();
  } catch (error) {
    console.error(error);
    toast(error.message, 'error');
    return undefined;
  } finally {
    hideLoading();
  }
}

// ---- tooltips: any element with data-tip (and optional data-key) gets a designed tooltip on hover and keyboard focus.
let tipTimer = 0, lastHidden = 0, tipFor = null;

/** Shows the tooltip next to rect: right of it in the tool rail, else below (above when there is no room). */
function placeTip(rect, side, text, key) {
  const tip = $('tooltip'), gap = 8;
  tip.replaceChildren(text, ...(key ? [keys(key)] : []));
  tip.hidden = false;
  const t = tip.getBoundingClientRect();
  let x = side === 'right' ? rect.right + gap : rect.left + rect.width / 2 - t.width / 2;
  let y = side === 'right' ? rect.top + rect.height / 2 - t.height / 2 : rect.bottom + gap;
  if (side !== 'right' && y + t.height > innerHeight - 4) y = rect.top - gap - t.height;
  x = Math.max(4, Math.min(innerWidth - t.width - 4, x));
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function showTip(target) {
  tipFor = target;
  placeTip(target.getBoundingClientRect(), target.closest('#toolbar') ? 'right' : 'below', target.dataset.tip, target.dataset.key);
}

/** A tooltip for a spot on a canvas (the 2D symmetry centre); text null hides it. */
export function pointTip(text, clientX, clientY) {
  if (!text) {
    if (tipFor === 'point') hideTip();
    return;
  }
  tipFor = 'point';
  placeTip(new DOMRect(clientX - 8, clientY - 8, 16, 16), 'below', text);
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
    else hideTip(); // also cancels a tooltip still waiting to appear
  });
  document.addEventListener('focusin', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (target?.matches(':focus-visible')) scheduleTip(target);
  });
  for (const type of ['pointerdown', 'keydown', 'focusout', 'wheel']) document.addEventListener(type, hideTip, true);
  document.addEventListener('pointerleave', hideTip);
}
