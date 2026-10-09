// DOM helpers and the inspector's form rows. Text always goes in as text nodes: user and file text is never parsed as HTML.
import { icon } from './icons.js';

export const $ = (id) => document.getElementById(id);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const formatInt = (n) => Math.round(n).toLocaleString('en-US');

/** el('button', { class: 'btn', onclick, disabled: true }, 'label', childNode); false / null attributes and children are skipped. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter((c) => c !== null && c !== false && c !== undefined));
  return node;
}

/** A button with an optional leading icon: btn('Generate', { class: 'btn primary', onclick }, 'mountain'). */
export const btn = (label, attrs, iconName) => el('button', attrs, iconName ? icon(iconName) : null, label);

/** An inspector section with a title; returns it for the caller to fill. */
export function section(parent, title, ...extra) {
  const node = el('section', { class: 'section' }, el('h3', {}, title, ...extra));
  parent.append(node);
  return node;
}

export const note = (parent, text) => parent.append(el('p', { class: 'note' }, text));
export const value = (parent, label, text) => parent.append(el('div', { class: 'value' }, label, el('b', {}, text)));

function row(parent, label, control, id) {
  parent.append(el('div', { class: 'row' }, el('label', { for: id }, label), control));
}

let nextId = 0;
const fieldId = () => `f${++nextId}`;
const decimals = (step) => (String(step).split('.')[1] ?? '').length;

/** Label | range | number, bound to obj[key] and clamped to [min, max]. */
export function slider(parent, label, obj, key, { min, max, step = 1, onChange }) {
  const id = fieldId();
  const range = el('input', { type: 'range', min, max, step, 'aria-label': label });
  const num = el('input', { id, class: 'field', type: 'number', min, max, step });
  const show = () => {
    range.value = obj[key];
    num.value = Number(obj[key]).toFixed(decimals(step));
    range.style.setProperty('--fill', `${((obj[key] - min) / (max - min)) * 100}%`);
  };
  const set = (raw) => {
    if (raw === '' || Number.isNaN(+raw)) return show();
    obj[key] = clamp(+raw, min, max);
    show();
    onChange?.(obj[key]);
  };
  range.addEventListener('input', () => set(range.value));
  num.addEventListener('change', () => set(num.value));
  show();
  row(parent, label, el('div', { class: 'slider-row' }, range, num), id);
}

export function select(parent, label, obj, key, options, onChange) {
  const id = fieldId();
  const s = el('select', { id, class: 'field' }, ...options.map(([v, text]) => el('option', { value: v }, text)));
  s.value = obj[key];
  s.addEventListener('change', () => { obj[key] = s.value; onChange?.(s.value); });
  row(parent, label, s, id);
}

export function text(parent, label, obj, key, onChange, multiline = false) {
  const id = fieldId();
  const input = el(multiline ? 'textarea' : 'input', { id, class: 'field', spellcheck: 'false', ...(multiline ? { rows: 3 } : { type: 'text' }) });
  input.value = obj[key];
  input.addEventListener('input', () => { obj[key] = input.value; onChange?.(input.value); });
  if (multiline) parent.append(el('div', { class: 'row stack' }, el('label', { for: id }, label), input));
  else row(parent, label, input, id);
  return input;
}

/** A switch (checkbox) row bound to obj[key]. */
export function toggle(parent, label, obj, key, onChange) {
  const box = el('input', { type: 'checkbox', class: 'switch', role: 'switch' });
  box.checked = obj[key];
  box.addEventListener('change', () => { obj[key] = box.checked; onChange?.(box.checked); });
  parent.append(el('label', { class: 'switch-row' }, label, box));
}

/** A segmented control; options are [value, label, iconName?]. */
export function segmented(options, current, onChange, className = '') {
  const group = el('div', { class: `seg ${className}`, role: 'group' });
  const mark = (v) => { for (const b of group.children) b.setAttribute('aria-pressed', String(b.dataset.value === String(v))); };
  for (const [v, label, iconName] of options) {
    const b = btn(label, { type: 'button', 'data-value': v, onclick: () => { mark(v); onChange(v); } }, iconName);
    group.append(b);
  }
  mark(current);
  return group;
}

/** A [−][value][+] stepper (one segmented control), bound to obj[key] as an integer clamped to [min, max]. */
export function stepper(obj, key, { min, max, label, id, onChange }) {
  const input = el('input', { id, class: 'num', type: 'number', min, max, step: 1, 'aria-label': label });
  const show = () => {
    input.value = obj[key];
    down.disabled = obj[key] <= min;
    up.disabled = obj[key] >= max;
  };
  const set = (v, rewrite = true) => {
    obj[key] = clamp(Math.round(+v) || min, min, max);
    if (rewrite) show();
    onChange?.(obj[key]);
  };
  const down = el('button', { type: 'button', 'aria-label': `${label}: one fewer`, onclick: () => set(obj[key] - 1) }, icon('minus'));
  const up = el('button', { type: 'button', 'aria-label': `${label}: one more`, onclick: () => set(obj[key] + 1) }, icon('plus'));
  input.addEventListener('input', () => set(input.value, false)); // typing: keep the field as typed until it is left
  input.addEventListener('change', () => set(input.value));
  show();
  return el('div', { class: 'stepper', role: 'group', 'aria-label': label }, down, input, up);
}

/**
 * The one key-cap component: keys('Ctrl+Shift+Z'), alternatives keys(['Ctrl+Y', 'Ctrl+Shift+Z']), and a mouse gesture in
 * plain text: keys('Shift', 'wheel'), keys([], 'Right-click').
 */
export function keys(combos, mouse) {
  const node = el('span', { class: 'keys' });
  [combos].flat().forEach((combo, n) => {
    if (n) node.append(el('span', { class: 'or' }, 'or'));
    combo.split('+').forEach((k, i) => node.append(...(i ? [el('span', { class: 'plus' }, '+')] : []), el('kbd', {}, k)));
  });
  if (mouse) node.append(...(node.childElementCount ? [el('span', { class: 'plus' }, '+')] : []), el('span', { class: 'mouse' }, mouse));
  return node;
}

/** Replaces every <span data-keys="Ctrl+N"> placeholder in the static markup with key caps (its classes are kept). */
export function hydrateKeys(root = document) {
  for (const node of root.querySelectorAll('span[data-keys]')) {
    const caps = keys(node.dataset.keys);
    caps.classList.add(...node.classList);
    node.replaceWith(caps);
  }
}

/** A card-style radio: a visually hidden <input type=radio> (keyboard, focus) followed by the designed body. */
export function choice({ name, value: v, checked = false, disabled = false, className = '', onChange }, ...body) {
  const input = el('input', { type: 'radio', name, value: v, checked, disabled });
  input.addEventListener('change', () => { if (input.checked) onChange(v); });
  return el('label', { class: `choice ${className}`, 'data-value': v }, input, el('span', { class: 'body' }, ...body));
}

/** An empty state: icon, headline and one line of help. */
export const emptyState = (iconName, title, help) => el('div', { class: 'empty' }, icon(iconName), el('strong', {}, title), help);
