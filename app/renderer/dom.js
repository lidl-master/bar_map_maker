// Small DOM helpers. Text always goes in as text nodes: user and file text is never parsed as HTML.

export const $ = (id) => document.getElementById(id);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** el('button', { class: 'x', onclick }, 'label', childNode) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

/** A 24×24 line icon from SVG path data. */
export function icon(paths) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  for (const d of paths) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function heading(parent, text) { parent.append(el('h3', {}, text)); }
export function note(parent, text) { parent.append(el('p', {}, text)); }

/** Range + number pair bound to obj[key]. */
export function slider(parent, label, obj, key, min, max, step, onChange) {
  const num = el('input', { type: 'number', min, max, step });
  const range = el('input', { type: 'range', min, max, step });
  num.value = range.value = obj[key];
  const set = (raw) => {
    if (raw === '' || Number.isNaN(+raw)) return;
    obj[key] = clamp(+raw, min, max);
    num.value = range.value = obj[key];
    onChange?.(obj[key]);
  };
  range.addEventListener('input', () => set(range.value));
  num.addEventListener('change', () => set(num.value));
  parent.append(el('div', { class: 'ctl' }, el('div', { class: 'lbl' }, el('span', {}, label), num), range));
}

export function select(parent, label, obj, key, options, onChange) {
  const s = el('select', {}, ...options.map(([value, text]) => el('option', { value }, text)));
  s.value = obj[key];
  s.addEventListener('change', () => { obj[key] = s.value; onChange?.(s.value); });
  parent.append(el('div', { class: 'ctl' }, el('div', { class: 'lbl' }, label), s));
}

export function check(parent, label, obj, key, onChange) {
  const box = el('input', { type: 'checkbox' });
  box.checked = obj[key];
  box.addEventListener('change', () => { obj[key] = box.checked; onChange?.(box.checked); });
  parent.append(el('label', { class: 'ctl check' }, box, label));
}

export function text(parent, label, obj, key, onChange, multiline = false) {
  const input = el(multiline ? 'textarea' : 'input', multiline ? {} : { type: 'text' });
  input.value = obj[key];
  input.addEventListener('input', () => { obj[key] = input.value; onChange?.(input.value); });
  parent.append(el('div', { class: 'ctl' }, el('div', { class: 'lbl' }, label), input));
}

export function stat(parent, label, value) {
  parent.append(el('div', { class: 'stat' }, label, el('b', {}, value)));
}

let toastTimer = 0;
export function toast(message, ms = 2600) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/** Blocks the editor with a progress overlay while fn runs; errors become a toast. */
export async function busy(label, fn) {
  $('busyText').textContent = label;
  $('busyBar').parentElement.hidden = true; // shown by the first progress() call
  $('busy').hidden = false;
  try {
    return await fn();
  } catch (error) {
    console.error(error);
    toast(`Error: ${error.message}`, 8000);
    return undefined;
  } finally {
    $('busy').hidden = true;
  }
}

export function progress(label, fraction) {
  $('busyText').textContent = label;
  $('busyBar').parentElement.hidden = false;
  $('busyBar').style.width = `${Math.round(clamp(fraction, 0, 1) * 100)}%`;
}
