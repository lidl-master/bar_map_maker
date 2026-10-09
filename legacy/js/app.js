'use strict';
// Application: UI wiring, tools, input handling, dialogs.
(function () {
  const { clamp } = BMM.util;
  const SQ = BMM.SQUARE;
  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------------ state
  let map = null;
  const history = new BMM.History();
  const view2d = new BMM.View2D($('canvas2d'));
  const view3d = new BMM.View3D($('view3d'), view2d.base);
  let tool = 'raise';
  let selected = null;
  let viewMode = '2d';
  let dirtySinceSave = false;

  const ICONS = {
    select: '<path d="M6 3l12 8-5.5 1.5L10 19z"/>',
    raise: '<path d="M2 20h20M5 20l7-9 7 9"/><path d="M12 2.5v5M9.5 5L12 2.5 14.5 5"/>',
    lower: '<path d="M2 12h5l3 7h4l3-7h5"/><path d="M12 3v6M9.5 6.5L12 9l2.5-2.5"/>',
    smooth: '<path d="M2 13c3.3-5 6.7-5 10 0s6.7 5 10 0"/><path d="M2 20h20"/>',
    flatten: '<path d="M2 20h4l3-8h6l3 8h4"/><path d="M8.5 12h7" stroke-width="2.6"/><path d="M12 3v5"/>',
    noise: '<path d="M2 18l3-5 3 3 3-8 3 7 3-4 3 3 2-2"/>',
    ramp: '<path d="M2 20h20"/><path d="M3 20L21 9v11"/><path d="M8 17l2-1M13 14.5l2-1"/>',
    paint: '<path d="M15 3l6 6-8.5 8.5H6.5V11.5z"/><path d="M3 21h8"/>',
    metal: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/>',
    geo: '<path d="M12 3c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4.5 3-7 1 2 2 3 3 3 0-3-1-5 0-7z"/>',
    start: '<path d="M5 21V3.5M5 4h12l-2.5 4L17 12H5"/>',
  };
  const TOOLS = [
    { cap: 'Edit' },
    { id: 'select', label: 'Select', key: 'V', hint: 'Click a resource or start position to select it. Drag to move it — mirrored copies follow. <kbd>Del</kbd> deletes.' },
    { cap: 'Sculpt' },
    { id: 'raise', label: 'Raise', key: 'R', hint: 'Drag to <b>raise</b> terrain. Hold <kbd>Shift</kbd> to lower. <kbd>Shift</kbd>+wheel or <kbd>[</kbd> <kbd>]</kbd> = brush size.' },
    { id: 'lower', label: 'Lower', key: 'L', hint: 'Drag to <b>lower</b> terrain (dig valleys, lakes – below 0 is water). Hold <kbd>Shift</kbd> to raise.' },
    { id: 'smooth', label: 'Smooth', key: 'S', hint: 'Drag to <b>smooth</b> bumps and soften cliffs.' },
    { id: 'flatten', label: 'Flatten', key: 'F', hint: 'Drag to <b>flatten</b> to the height where you started the stroke – great for building areas and plateaus. <kbd>Alt</kbd>+click picks a height.' },
    { id: 'noise', label: 'Rough', key: 'N', hint: 'Drag to add natural <b>roughness</b>. Hold <kbd>Shift</kbd> to subtract.' },
    { id: 'ramp', label: 'Ramp', key: 'A', hint: 'Drag a line from one height to another to cut a <b>ramp</b> or road – use it to connect plateaus.' },
    { cap: 'Texture' },
    { id: 'paint', label: 'Paint', key: 'P', hint: 'Drag to <b>paint</b> a material onto the ground. Hold <kbd>Shift</kbd> to erase back to automatic.' },
    { cap: 'Resources' },
    { id: 'metal', label: 'Metal', key: 'M', hint: 'Click to place a <b>metal spot</b>. Drag to move, <b>right-click</b> to delete.' },
    { id: 'geo', label: 'Geo', key: 'G', hint: 'Click to place a <b>geothermal vent</b>. Drag to move, <b>right-click</b> to delete.' },
    { id: 'start', label: 'Start', key: 'T', hint: 'Click to place a <b>start position</b> (one per player). Drag to move, <b>right-click</b> to delete.' },
  ];
  const BRUSH_TOOLS = ['raise', 'lower', 'smooth', 'flatten', 'noise', 'paint'];
  const OBJ_TOOLS = ['metal', 'geo', 'start'];
  const toolSettings = {
    raise: { radius: 160, strength: 0.5, hardness: 0.3 },
    lower: { radius: 160, strength: 0.5, hardness: 0.3 },
    smooth: { radius: 160, strength: 0.6, hardness: 0.2 },
    flatten: { radius: 160, strength: 0.7, hardness: 0.55, fixed: false, target: 100 },
    noise: { radius: 220, strength: 0.4, hardness: 0.2, noiseScale: 150 },
    ramp: { width: 160, hardness: 0.5 },
    paint: { radius: 120, strength: 0.6, hardness: 0.4, material: 6 },
    metal: { metal: 2.0 },
  };
  const genSettings = { style: 'hills', seed: 1, minHeight: -40, maxHeight: 350, water: 5, featureSize: 1500, roughness: 0.5, warp: 0.6, terraces: 0, edges: 'none', erosion: 0.3 };
  const resSettings = { players: 2, nearStart: 4, extraMetal: 8, geos: 1, metalValue: 2.0, flattenStarts: true, replaceStarts: true, allowWater: false };

  const TEMPLATES = [
    { id: 'flat', label: 'Flat', g: { style: 'flat', minHeight: 0, maxHeight: 200, water: 0, erosion: 0 } },
    { id: 'hills', label: 'Rolling hills', g: { style: 'hills', minHeight: -40, maxHeight: 350, water: 5, featureSize: 1500, roughness: 0.5, warp: 0.6, erosion: 0.3 } },
    { id: 'mountains', label: 'Mountains', g: { style: 'mountains', minHeight: -30, maxHeight: 700, water: 3, featureSize: 2200, roughness: 0.55, warp: 0.5, erosion: 0.5 } },
    { id: 'mesas', label: 'Plateaus', g: { style: 'mesas', minHeight: 0, maxHeight: 450, water: 0, featureSize: 1600, roughness: 0.4, warp: 0.8, terraces: 4, erosion: 0.15 } },
    { id: 'canyons', label: 'Canyons', g: { style: 'canyons', minHeight: -20, maxHeight: 500, water: 0, featureSize: 2500, roughness: 0.45, warp: 0.7, erosion: 0.3 } },
    { id: 'islands', label: 'Islands', g: { style: 'islands', minHeight: -150, maxHeight: 300, water: 45, featureSize: 1800, roughness: 0.5, warp: 0.6, edges: 'sink', erosion: 0.2 } },
    { id: 'continents', label: 'Two shores', g: { style: 'continents', minHeight: -120, maxHeight: 350, water: 30, featureSize: 1500, roughness: 0.5, warp: 0.5, erosion: 0.25 } },
    { id: 'craters', label: 'Craters', g: { style: 'craters', minHeight: 0, maxHeight: 400, water: 0, featureSize: 1500, roughness: 0.5, warp: 0.2, erosion: 0 } },
    { id: 'volcano', label: 'Volcano – King of the Hill', preset: 'volcanoKing', palette: 'lava', g: { style: 'mesas' } },
  ];

  // ------------------------------------------------------------------ small UI helpers
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    }
    for (const c of kids) if (c !== null && c !== undefined) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  }
  function slider(parent, label, obj, key, min, max, step, onChange, opts) {
    opts = opts || {};
    const num = el('input', { type: 'number', min, max, step, value: obj[key] });
    const rng = el('input', { type: 'range', min, max, step, value: obj[key] });
    const set = v => {
      v = clamp(+v, min, max); if (isNaN(v)) return;
      obj[key] = v; num.value = +v.toFixed(3); rng.value = v;
      if (onChange) onChange(v);
    };
    rng.addEventListener('input', () => set(rng.value));
    num.addEventListener('change', () => set(num.value));
    const lbl = el('div', { class: 'lbl' }, el('span', { title: opts.title || '' }, label + (opts.unit ? ` (${opts.unit})` : '')), num);
    const c = el('div', { class: 'ctl' }, lbl, rng);
    parent.append(c);
    c.setValue = v => { obj[key] = v; num.value = +(+v).toFixed(3); rng.value = v; };
    return c;
  }
  function select(parent, label, obj, key, options, onChange) {
    const s = el('select');
    for (const [v, l] of options) s.append(el('option', { value: v }, l));
    s.value = obj[key];
    s.addEventListener('change', () => { obj[key] = s.value; if (onChange) onChange(s.value); });
    parent.append(el('div', { class: 'ctl' }, el('div', { class: 'lbl' }, label), s));
    return s;
  }
  function check(parent, label, obj, key, onChange, title) {
    const c = el('input', { type: 'checkbox' });
    c.checked = !!obj[key];
    c.addEventListener('change', () => { obj[key] = c.checked; if (onChange) onChange(c.checked); });
    parent.append(el('label', { class: 'ctl check', title: title || '' }, c, label));
    return c;
  }
  function text(parent, label, obj, key, onChange, multiline) {
    const i = el(multiline ? 'textarea' : 'input', multiline ? {} : { type: 'text' });
    i.value = obj[key] || '';
    i.addEventListener('input', () => { obj[key] = i.value; if (onChange) onChange(i.value); });
    parent.append(el('div', { class: 'ctl' }, el('div', { class: 'lbl' }, label), i));
    return i;
  }
  function number(parent, label, obj, key, onChange, attrs) {
    const i = el('input', Object.assign({ type: 'number', value: obj[key] }, attrs || {}));
    i.addEventListener('change', () => { obj[key] = +i.value; if (onChange) onChange(+i.value); });
    parent.append(el('div', { class: 'ctl' }, el('div', { class: 'lbl' }, el('span', {}, label), i)));
    return i;
  }
  function toast(msg, ms) {
    const t = $('toast');
    t.innerHTML = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }
  async function busy(msg, fn) {
    $('busyText').textContent = msg;
    $('busy').hidden = false;
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 20)));
    try { return await fn(); }
    catch (e) { console.error(e); toast('Error: ' + e.message, 5000); }
    finally { $('busy').hidden = true; }
  }
  const rgbHex = c => '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const fmtElmo = v => Math.round(v) + '';

  // ------------------------------------------------------------------ map lifecycle
  function setMap(m, keepHistory) {
    map = m;
    if (!keepHistory) history.clear();
    selected = null;
    view2d.setMap(map);
    view3d.setMap(map);
    if (viewMode !== '2d') { view3d.resize(); }
    buildSymmetrySelect();
    buildToolbar();
    buildToolPanel();
    buildGeneratePanel();
    buildTexturePanel();
    buildMapPanel();
    updateTitle();
    updateStatusCounts();
    updateUndoButtons();
  }
  function fullRefresh() {
    view2d.resetRange();
    view2d.renderBase();
    view3d.updateHeights();
    view3d.render();
    updateStatusCounts();
    changed();
  }
  function refreshObjects() {
    view2d.invalidate();
    view3d.updateMarkers();
    view3d.render();
    updateStatusCounts();
    if (tool === 'select' || OBJ_TOOLS.includes(tool)) buildToolPanel();
    changed();
  }
  let autosaveTimer = 0;
  function changed() {
    map.revision++;
    dirtySinceSave = true;
    $('stSaved').textContent = 'unsaved changes';
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      await BMM.IO.autosave(map);
      $('stSaved').textContent = 'autosaved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }, 4000);
    updateUndoButtons();
  }
  function updateTitle() {
    $('mapTitle').textContent = `${map.settings.name} · ${map.sx}×${map.sz}`;
    document.title = `${map.settings.name} – BAR Map Maker`;
  }
  function updateUndoButtons() {
    $('btnUndo').disabled = !history.undoStack.length;
    $('btnRedo').disabled = !history.redoStack.length;
  }
  function updateStatusCounts() {
    const metal = map.objectsOf('metal'), geos = map.objectsOf('geo'), starts = map.objectsOf('start');
    const total = metal.reduce((s, o) => s + (+o.metal || 0), 0);
    $('stCounts').innerHTML = `Starts <b>${starts.length}</b> · Metal spots <b>${metal.length}</b> (${total.toFixed(1)} total${starts.length ? ', ' + (total / starts.length).toFixed(1) + '/player' : ''}) · Geos <b>${geos.length}</b>`;
    $('stSize').innerHTML = `<b>${map.sx}×${map.sz}</b> (${map.worldW}×${map.worldH} elmos)`;
  }

  // Whole-map edit wrapper with undo.
  async function wholeMapOp(label, fn) {
    await busy(label + '…', () => {
      history.begin(map, label);
      fn();
      history.commit([0, 0, map.W - 1, map.H - 1]);
      fullRefresh();
      refreshObjects();
    });
  }

  // ------------------------------------------------------------------ toolbar & symmetry
  function buildToolbar() {
    const tb = $('toolbar');
    tb.innerHTML = '';
    for (const t of TOOLS) {
      if (t.cap) { if (tb.children.length) tb.append(el('div', { class: 'sep' })); tb.append(el('div', { class: 'cap' }, t.cap)); continue; }
      const b = el('button', { class: 'tool' + (t.id === tool ? ' active' : ''), title: `${t.label} (${t.key})`, onclick: () => setTool(t.id) });
      b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[t.id]}</svg><span>${t.label}</span><span class="k">${t.key}</span>`;
      b.dataset.tool = t.id;
      tb.append(b);
    }
  }
  function setTool(id) {
    tool = id;
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('active', b.dataset.tool === id);
    const t = TOOLS.find(t => t.id === id);
    $('hint').innerHTML = t ? t.hint : '';
    if (id === 'paint' && view2d.mode !== 'texture') setDisplayMode('texture');
    if (!['select', ...OBJ_TOOLS].includes(id)) selected = null;
    updateBrushPreview();
    buildToolPanel();
    showTab('tool');
    view2d.invalidate();
  }
  function updateBrushPreview() {
    const s = toolSettings[tool];
    if (BRUSH_TOOLS.includes(tool)) view2d.brush = { radius: s.radius, hardness: s.hardness, symmetric: true, color: tool === 'lower' ? '#ff9a7a' : tool === 'paint' ? '#ffd27a' : '#ffffff' };
    else if (tool === 'ramp') view2d.brush = { radius: s.width / 2, symmetric: true, color: '#5cd0ff' };
    else view2d.brush = null;
    $('canvas2d').style.cursor = view2d.brush ? 'none' : (tool === 'select' ? 'default' : 'crosshair');
    view2d.invalidate();
  }
  function buildSymmetrySelect() {
    const square = map.W === map.H;
    for (const sel of [$('symmetry'), $('nmSym')]) {
      const cur = sel === $('symmetry') ? map.symmetry : (sel.value || 'rot180');
      sel.innerHTML = '';
      for (const k in BMM.SYMMETRY) {
        const m = BMM.SYMMETRY[k];
        const o = el('option', { value: k }, m.label + (m.square && !square && sel === $('symmetry') ? ' (square maps only)' : ''));
        if (m.square && !square && sel === $('symmetry')) o.disabled = true;
        sel.append(o);
      }
      sel.value = cur;
    }
  }
  $('symmetry').addEventListener('change', e => {
    history.begin(map, 'symmetry');
    map.symmetry = e.target.value;
    history.commit(null);
    view2d.invalidate();
    changed();
    if (map.symmetry !== 'none') toast('Symmetry on. To mirror terrain you already made: <b>Generate → Apply symmetry to existing terrain</b>.', 4500);
  });

  // ------------------------------------------------------------------ display / view mode
  function setDisplayMode(m) {
    view2d.mode = m;
    $('displayMode').value = m;
    view2d.resetRange();
    view2d.renderBase();
    view3d.updateHeights(); view3d.render();
    const lg = $('legend');
    if (m === 'slope') {
      const s = map.settings;
      lg.hidden = false;
      lg.innerHTML = `<div><i style="background:#40a050"></i>All ground units (≤ ${s.maxSlopeTank}°)</div>
        <div><i style="background:#dcbe3c"></i>Bots only (≤ ${s.maxSlopeBot}°)</div>
        <div><i style="background:#c83c32"></i>Impassable (spiders/air only)</div>
        <div><i style="background:#5a96dc"></i>Shallow water (wade ≤ ${s.maxWaterDepth} elmos)</div>
        <div><i style="background:#2850aa"></i>Deep water (ships, hovers, amphibious)</div>${s.lava ? '<div><i style="background:#ff6e00"></i>Lava (deadly)</div>' : ''}`;
    } else if (m === 'height') {
      lg.hidden = false;
      const [lo, hi] = map.heightRange();
      lg.innerHTML = `<div>Contour lines every 50 elmos</div><div>Lowest <b>${fmtElmo(lo)}</b> · Highest <b>${fmtElmo(hi)}</b></div>`;
    } else lg.hidden = true;
  }
  $('displayMode').addEventListener('change', e => setDisplayMode(e.target.value));
  function setViewMode(m) {
    viewMode = m;
    $('viewport').className = 'view-' + m;
    for (const b of $('viewMode').children) b.classList.toggle('active', b.dataset.view === m);
    view3d.visible = m !== '2d';
    requestAnimationFrame(() => {
      view2d.resize();
      if (m === '2d' || m === 'split') view2d.fit();
      view3d.resize();
      view3d.updateHeights();
      view3d.render();
    });
  }
  for (const b of $('viewMode').children) b.addEventListener('click', () => setViewMode(b.dataset.view));
  $('exaggerate').addEventListener('input', e => { view3d.exaggerate = +e.target.value; view3d.updateHeights(); view3d.render(); });
  let t3d = 0;
  function schedule3D() {
    if (!view3d.visible || t3d) return;
    t3d = setTimeout(() => { t3d = 0; view3d.updateHeights(); view3d.render(); }, 180);
  }

  // ------------------------------------------------------------------ tabs
  function showTab(name) {
    for (const b of $('tabs').children) b.classList.toggle('active', b.dataset.tab === name);
    for (const p of document.querySelectorAll('.tabpage')) p.classList.toggle('active', p.id === 'tab-' + name);
  }
  for (const b of $('tabs').children) b.addEventListener('click', () => showTab(b.dataset.tab));

  // ------------------------------------------------------------------ Tool panel
  function buildToolPanel() {
    const P = $('tab-tool');
    P.innerHTML = '';
    view2d.selected = selected;
    const t = TOOLS.find(t => t.id === tool);
    P.append(el('h3', {}, t.label + ' tool'));
    P.append(el('p', { html: t.hint }));
    const s = toolSettings[tool];
    const upd = () => updateBrushPreview();
    if (BRUSH_TOOLS.includes(tool)) {
      slider(P, 'Brush size', s, 'radius', 16, 1500, 1, upd, { unit: 'radius, elmos' });
      slider(P, 'Strength', s, 'strength', 0.02, 1, 0.01, upd);
      slider(P, 'Edge hardness', s, 'hardness', 0, 0.95, 0.01, upd, { title: '0 = soft round brush, 1 = hard edged stamp' });
    }
    if (tool === 'flatten') {
      check(P, 'Use a fixed height instead of the height where I click', s, 'fixed', () => buildToolPanel());
      if (s.fixed) slider(P, 'Target height', s, 'target', -500, 2000, 1, null, { unit: 'elmos' });
      P.append(el('div', { class: 'note' }, 'Tip: a hard-edged flatten (hardness ~0.8) creates plateaus with cliffs. Connect them with the Ramp tool.'));
    }
    if (tool === 'noise') slider(P, 'Noise scale', s, 'noiseScale', 20, 1000, 1, null, { unit: 'elmos' });
    if (tool === 'ramp') {
      slider(P, 'Ramp width', s, 'width', 32, 800, 1, upd, { unit: 'elmos' });
      slider(P, 'Edge hardness', s, 'hardness', 0, 0.95, 0.01);
      P.append(el('div', { class: 'note' }, `Keep ramps gentle: tanks can climb up to ${map.settings.maxSlopeTank}°, bots up to ${map.settings.maxSlopeBot}°. Rise of 100 elmos needs a ramp ≥ ${Math.ceil(100 / Math.tan(map.settings.maxSlopeTank * Math.PI / 180))} elmos long for tanks.`));
    }
    if (tool === 'paint') {
      P.append(el('h3', {}, 'Material'));
      const sw = el('div', { class: 'swatches' });
      const mats = [{ label: 'Auto (erase)', color: null, id: 0 }].concat(BMM.Texture.MATERIALS.map((m, i) => ({ label: m.label, color: map.texture.colors[m.key], id: i + 1 })));
      for (const m of mats) {
        const b = el('button', { class: 'swatch' + (s.material === m.id ? ' active' : ''), onclick: () => { s.material = m.id; buildToolPanel(); } },
          el('span', { class: 'c', style: m.color ? `background:${rgbHex(m.color)}` : 'background:repeating-linear-gradient(45deg,#555 0 4px,#333 4px 8px)' }), m.label);
        sw.append(b);
      }
      P.append(sw);
      P.append(el('p', {}, 'Materials blend smoothly with the automatic texture. Colours can be changed in the Texture tab.'));
    }
    if (tool === 'metal') {
      slider(P, 'Metal per new spot', s, 'metal', 0.1, 10, 0.1, null, { title: 'In-game value shown on the spot. T1 extractor income in metal/s.' });
      P.append(el('p', {}, 'Typical BAR spots are 1.5 – 3.0. A base usually has 3–5 spots nearby.'));
    }
    if (tool === 'select' || OBJ_TOOLS.includes(tool)) buildSelection(P);
    if (tool === 'start' || tool === 'select') buildStartList(P);
    if (OBJ_TOOLS.includes(tool) && tool !== 'start') {
      const list = map.objectsOf(tool);
      P.append(el('h3', {}, (tool === 'metal' ? 'Metal spots' : 'Geothermal vents') + ` (${list.length})`));
      if (list.length) P.append(el('button', { class: 'wide danger', onclick: () => { history.begin(map, 'clear'); map.objects = map.objects.filter(o => o.type !== tool); selected = null; history.commit(null); refreshObjects(); } }, `Delete all ${tool === 'metal' ? 'metal spots' : 'geo vents'}`));
      P.append(el('p', {}, 'Use Generate → Auto-place resources to fill the map automatically.'));
    }
  }
  function buildSelection(P) {
    if (!selected || !map.objects.includes(selected)) { if (tool === 'select') P.append(el('div', { class: 'note' }, 'Nothing selected.')); return; }
    const o = selected;
    const names = { metal: 'Metal spot', geo: 'Geothermal vent', start: 'Start position' };
    P.append(el('h3', {}, 'Selected: ' + names[o.type]));
    const group = map.groupOf(o);
    P.append(el('div', { class: 'stat' }, 'Position', el('b', {}, `${Math.round(o.x)}, ${Math.round(o.z)}`)));
    P.append(el('div', { class: 'stat' }, 'Ground height', el('b', {}, fmtElmo(map.sampleHeight(o.x, o.z)) + ' elmos')));
    if (group.length > 1) P.append(el('div', { class: 'stat' }, 'Mirrored copies', el('b', {}, String(group.length - 1))));
    if (o.type === 'metal') {
      const tmp = { metal: +o.metal };
      slider(P, 'Metal value', tmp, 'metal', 0.1, 10, 0.1, v => { map.setGroupProp(o, 'metal', v); view2d.invalidate(); updateStatusCounts(); changed(); });
    }
    P.append(el('button', { class: 'wide danger', onclick: deleteSelected }, group.length > 1 ? 'Delete (with mirrored copies)' : 'Delete'));
  }
  function buildStartList(P) {
    const starts = map.objectsOf('start');
    P.append(el('h3', {}, `Start positions (${starts.length})`));
    if (!starts.length) { P.append(el('p', {}, 'No start positions yet. BAR needs one per player.')); return; }
    const list = el('div', { class: 'objlist' });
    starts.forEach((s, i) => {
      const item = el('div', { class: 'item', onclick: () => { selected = s; setTool('select'); } },
        el('span', { class: 'dot', style: 'background:' + BMM.TEAM_COLORS[i % BMM.TEAM_COLORS.length] }),
        `Player ${i + 1}`, el('span', { class: 'muted' }, ` ${Math.round(s.x)}, ${Math.round(s.z)}`),
        el('button', { class: 'x', title: 'Delete', onclick: e => { e.stopPropagation(); history.begin(map, 'delete'); map.objects = map.objects.filter(o => o.id !== s.id); history.commit(null); refreshObjects(); } }, '✕'));
      list.append(item);
    });
    P.append(list);
    P.append(el('p', {}, 'Start boxes are drawn in the BAR lobby; the map stores these start positions (used for fixed/random starts).'));
  }
  function deleteSelected() {
    if (!selected) return;
    history.begin(map, 'delete');
    map.removeGroup(selected);
    selected = null;
    history.commit(null);
    refreshObjects();
  }

  // ------------------------------------------------------------------ Generate panel
  function buildGeneratePanel() {
    const P = $('tab-generate');
    P.innerHTML = '';
    P.append(el('h3', {}, 'Terrain generator'));
    P.append(el('p', {}, 'Creates new terrain using the current symmetry. Replaces the existing heights (undo with Ctrl+Z).'));
    const styles = Object.entries(BMM.Terrain.STYLES);
    select(P, 'Style', genSettings, 'style', styles, v => {
      const t = TEMPLATES.find(t => t.g.style === v);
      if (t) Object.assign(genSettings, { terraces: 0, edges: 'none' }, t.g);
      buildGeneratePanel();
    });
    const seedRow = el('div', { class: 'ctl' });
    const seedIn = el('input', { type: 'number', value: genSettings.seed, style: 'width:110px' });
    seedIn.addEventListener('change', () => genSettings.seed = +seedIn.value | 0);
    seedRow.append(el('div', { class: 'lbl' }, el('span', {}, 'Seed'), el('span', { class: 'row' }, seedIn,
      el('button', { title: 'Random seed', onclick: () => { genSettings.seed = (Math.random() * 1e6) | 0; seedIn.value = genSettings.seed; } }, '🎲'))));
    P.append(seedRow);
    slider(P, 'Lowest point', genSettings, 'minHeight', -600, 500, 5, null, { unit: 'elmos', title: 'Below 0 is water' });
    slider(P, 'Highest point', genSettings, 'maxHeight', 20, 2000, 5, null, { unit: 'elmos' });
    slider(P, 'Water coverage', genSettings, 'water', 0, 80, 1, null, { unit: '%', title: 'Needs a negative lowest point' });
    slider(P, 'Feature size', genSettings, 'featureSize', 200, 5000, 10, null, { unit: 'elmos', title: 'Distance between hills/mountains' });
    slider(P, 'Roughness', genSettings, 'roughness', 0, 1, 0.01);
    slider(P, 'Warp (organic shapes)', genSettings, 'warp', 0, 2, 0.05);
    slider(P, 'Terraces', genSettings, 'terraces', 0, 10, 1, null, { title: '0 = off. Creates flat plateaus separated by cliffs.' });
    select(P, 'Map edges', genSettings, 'edges', [['none', 'Leave as is'], ['sink', 'Sink into water'], ['raise', 'Raise into cliffs']]);
    slider(P, 'Erosion', genSettings, 'erosion', 0, 1.5, 0.05, null, { title: 'Water erosion carves realistic gullies (slower)' });
    P.append(el('button', { class: 'primary wide', onclick: () => doGenerate() }, 'Generate terrain'));

    P.append(el('h3', {}, 'Resources'));
    P.append(el('p', {}, 'Places start positions, metal spots near each base, expansion metal and geothermal vents – mirrored by the symmetry setting.'));
    slider(P, 'Players', resSettings, 'players', 2, 16, 1);
    slider(P, 'Metal spots per base', resSettings, 'nearStart', 0, 10, 1);
    slider(P, 'Expansion spots (per side)', resSettings, 'extraMetal', 0, 40, 1);
    slider(P, 'Geothermal vents (per side)', resSettings, 'geos', 0, 6, 1);
    slider(P, 'Metal per spot', resSettings, 'metalValue', 0.5, 6, 0.1);
    check(P, 'Re-place start positions', resSettings, 'replaceStarts');
    check(P, 'Flatten ground around start positions', resSettings, 'flattenStarts');
    check(P, 'Allow underwater metal', resSettings, 'allowWater');
    P.append(el('button', { class: 'primary wide', onclick: () => doAutoResources() }, 'Auto-place resources'));
    P.append(el('button', { class: 'wide danger', onclick: () => { history.begin(map, 'clear'); map.objects = []; selected = null; history.commit(null); refreshObjects(); } }, 'Remove all resources & starts'));

    P.append(el('h3', {}, 'Whole-map tools'));
    const r1 = el('div', { class: 'btnrow' });
    r1.append(el('button', { onclick: () => wholeMapOp('Smoothing', () => BMM.Terrain.smoothAll(map, 2)), title: 'Soften the whole map' }, 'Smooth'));
    r1.append(el('button', { onclick: () => wholeMapOp('Eroding', () => { BMM.Terrain.hydraulicErosion(map, { droplets: map.sx * map.sz * 800, seed: (Math.random() * 1e6) | 0 }); BMM.Sym.symmetrize(map, 0.015); }), title: 'Hydraulic erosion pass' }, 'Erode'));
    r1.append(el('button', { onclick: () => wholeMapOp('Terracing', () => BMM.Terrain.terrace(map, 5, 0.75, true)), title: 'Make flat steps' }, 'Terrace'));
    P.append(r1);
    P.append(el('button', { class: 'wide', title: 'Relaxes slopes steeper than the tank limit so ground units can drive everywhere', onclick: () => wholeMapOp('Making pathable', () => { BMM.Terrain.limitSlopes(map, map.settings.maxSlopeTank - 2, 60); BMM.Sym.symmetrize(map, 0.01); }) }, `Make all slopes tank-passable (< ${map.settings.maxSlopeTank}°)`));
    P.append(el('button', { class: 'wide', title: 'Copy the master side onto the mirrored side(s)', onclick: () => { if (map.symmetry === 'none') { toast('Choose a symmetry mode in the top bar first.'); return; } wholeMapOp('Mirroring', () => BMM.Sym.symmetrize(map, 0.03)); } }, 'Apply symmetry to existing terrain'));
    const adj = { offset: 0, scale: 1 };
    const r2 = el('div', { class: 'ctl' });
    const off = el('input', { type: 'number', value: 0, step: 5 });
    const sc = el('input', { type: 'number', value: 1, step: 0.1 });
    off.addEventListener('change', () => adj.offset = +off.value);
    sc.addEventListener('change', () => adj.scale = +sc.value);
    r2.append(el('div', { class: 'lbl' }, el('span', {}, 'Raise / lower everything by'), off));
    r2.append(el('div', { class: 'lbl' }, el('span', {}, 'Multiply heights by'), sc));
    r2.append(el('button', { class: 'wide', onclick: () => wholeMapOp('Adjusting heights', () => { const h = map.heights; for (let k = 0; k < h.length; k++) h[k] = h[k] * adj.scale + adj.offset; }) }, 'Apply height adjustment'));
    P.append(r2);
    const r3 = el('div', { class: 'btnrow' });
    r3.append(el('button', { onclick: () => $('dlgImport').showModal() }, 'Import heightmap…'));
    r3.append(el('button', { onclick: openResize }, 'Resize map…'));
    P.append(r3);
  }
  async function doGenerate() {
    await wholeMapOp('Generating terrain', () => {
      BMM.Terrain.generate(map, genSettings);
      // keep resources on the ground
    });
    toast('Terrain generated. Tip: use <b>Auto-place resources</b> next.');
  }
  async function doAutoResources() {
    await wholeMapOp('Placing resources', () => {
      BMM.Terrain.autoResources(map, Object.assign({ clear: true, seed: (Math.random() * 1e6) | 0 }, resSettings));
    });
    const n = map.objectsOf('metal').length;
    toast(`Placed ${map.objectsOf('start').length} start positions, ${n} metal spots and ${map.objectsOf('geo').length} geo vents.`);
  }

  // ------------------------------------------------------------------ Texture panel
  let texTimer = 0;
  function textureChanged() {
    clearTimeout(texTimer);
    texTimer = setTimeout(() => { view2d.renderBase(); view3d.updateHeights(); view3d.render(); changed(); }, 60);
  }
  function buildTexturePanel() {
    const P = $('tab-texture');
    P.innerHTML = '';
    const tx = map.texture;
    P.append(el('h3', {}, 'Look'));
    const pals = Object.entries(BMM.Texture.PALETTES).map(([k, p]) => [k, p.label]);
    select(P, 'Theme (colours, sky, sun & water)', tx, 'palette', pals, v => {
      const d = BMM.Texture.defaultTextureSettings(v);
      Object.assign(tx, { colors: d.colors, rules: d.rules });
      buildTexturePanel(); textureChanged();
      if (tool === 'paint') buildToolPanel();
    });
    P.append(el('h3', {}, 'Material colours'));
    const cg = el('div', { class: 'colors' });
    for (const m of BMM.Texture.MATERIALS) {
      const inp = el('input', { type: 'color', value: rgbHex(tx.colors[m.key]) });
      inp.addEventListener('input', () => { tx.colors[m.key] = hexRgb(inp.value); textureChanged(); });
      cg.append(el('label', {}, inp, m.label));
    }
    P.append(cg);
    P.append(el('h3', {}, 'Automatic texturing rules'));
    const R = tx.rules;
    slider(P, 'Highland starts at', R, 'highStart', -200, 1500, 5, textureChanged, { unit: 'elmos' });
    slider(P, 'Fully highland at', R, 'highEnd', -100, 2000, 5, textureChanged, { unit: 'elmos' });
    slider(P, 'Rock on slopes steeper than', R, 'rockSlope', 5, 70, 1, textureChanged, { unit: '°' });
    slider(P, 'Beach width above water', R, 'beach', 0, 80, 1, textureChanged, { unit: 'elmos' });
    slider(P, 'Snow / peak line', R, 'snowLine', 0, 2500, 10, textureChanged, { unit: 'elmos' });
    slider(P, 'Natural edge breakup', R, 'jitter', 0, 3, 0.05, textureChanged);
    P.append(el('h3', {}, 'Detail'));
    slider(P, 'Colour variation', tx, 'variation', 0, 0.5, 0.01, textureChanged);
    slider(P, 'Fine grain (export only)', tx, 'detail', 0, 0.4, 0.01, textureChanged);
    slider(P, 'Baked shadows (export only)', tx, 'bakeShading', 0, 1, 0.01, textureChanged, { title: 'Bakes some hill shading into the texture for depth' });
    const seedIn = el('input', { type: 'number', value: tx.seed });
    seedIn.addEventListener('change', () => { tx.seed = +seedIn.value | 0; textureChanged(); });
    P.append(el('div', { class: 'ctl' }, el('div', { class: 'lbl' }, el('span', {}, 'Pattern seed'), seedIn)));
    P.append(el('h3', {}, 'Painted materials'));
    P.append(el('button', { class: 'wide danger', onclick: () => wholeMapOp('Clearing paint', () => { map.paintW.fill(0); map.paintId.fill(0); }) }, 'Clear all painted materials'));
  }

  // ------------------------------------------------------------------ Map panel
  function buildMapPanel() {
    const P = $('tab-map');
    P.innerHTML = '';
    const st = map.settings;
    P.append(el('h3', {}, 'Map info'));
    text(P, 'Name', st, 'name', () => { updateTitle(); changed(); });
    text(P, 'Version', st, 'version', changed);
    text(P, 'Author', st, 'author', changed);
    text(P, 'Description', st, 'description', changed, true);
    P.append(el('h3', {}, 'Size'));
    P.append(el('div', { class: 'stat' }, 'Map size', el('b', {}, `${map.sx} × ${map.sz}`)));
    P.append(el('div', { class: 'stat' }, 'In elmos', el('b', {}, `${map.worldW} × ${map.worldH}`)));
    P.append(el('div', { class: 'stat' }, 'Heightmap', el('b', {}, `${map.W} × ${map.H}`)));
    P.append(el('div', { class: 'stat' }, 'Texture', el('b', {}, `${(map.W - 1) * 8} × ${(map.H - 1) * 8}`)));
    P.append(el('button', { class: 'wide', onclick: openResize }, 'Resize map…'));
    P.append(el('h3', {}, 'Gameplay'));
    slider(P, 'Wind min', st, 'minWind', 0, 30, 1, changed);
    slider(P, 'Wind max', st, 'maxWind', 0, 40, 1, changed);
    slider(P, 'Tidal strength', st, 'tidalStrength', 0, 30, 1, changed);
    slider(P, 'Gravity', st, 'gravity', 50, 200, 1, changed);
    slider(P, 'Extractor radius', st, 'extractorRadius', 40, 300, 1, () => { view2d.invalidate(); changed(); }, { unit: 'elmos', title: 'Radius metal extractors gather from' });
    check(P, 'Void water (space map – no water surface)', st, 'voidWater', () => { view2d.renderBase(); view3d.updateHeights(); view3d.render(); changed(); });
    P.append(el('h3', {}, 'Lava'));
    P.append(el('p', {}, "Turns everything below the lava level into BAR's animated, damaging lava (written to mapconfig/lava.lua). Hides normal water."));
    const lavaRefresh = () => { view2d.renderBase(); view3d.updateHeights(); view3d.render(); changed(); };
    check(P, 'Lava map', st, 'lava', lavaRefresh);
    slider(P, 'Lava level', st, 'lavaLevel', -100, 1000, 1, lavaRefresh, { unit: 'elmos' });
    slider(P, 'Lava damage', st, 'lavaDamage', 0, 1000, 10, changed, { unit: 'HP/s' });
    P.append(el('h3', {}, 'Pathing overlay'));
    P.append(el('p', {}, 'Limits used by the Pathing view. Defaults match BAR: tanks 27°, bots 54°, wading depth 20 elmos.'));
    const rp = () => { if (view2d.mode === 'slope') setDisplayMode('slope'); changed(); };
    slider(P, 'Tank max slope', st, 'maxSlopeTank', 5, 60, 1, rp, { unit: '°' });
    slider(P, 'Bot max slope', st, 'maxSlopeBot', 10, 89, 1, rp, { unit: '°' });
    slider(P, 'Max wading depth', st, 'maxWaterDepth', 0, 100, 1, rp, { unit: 'elmos' });
  }

  // ------------------------------------------------------------------ pointer input on 2D canvas
  const cv = $('canvas2d');
  let pan = null, stroke = null, drag = null, ramp = null, spaceDown = false, rightDown = null;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  function evPos(e) { const r = cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  function pickRadius() { return Math.max(40, 14 / view2d.zoom * SQ); }

  cv.addEventListener('pointerdown', e => {
    if (!map) return;
    cv.setPointerCapture(e.pointerId);
    const { sx, sy } = evPos(e);
    const w = view2d.toWorld(sx, sy);
    if (e.button === 1 || e.button === 2 || spaceDown) {
      pan = { sx, sy, ox: view2d.ox, oy: view2d.oy };
      if (e.button === 2) rightDown = { sx, sy };
      cv.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    if (BRUSH_TOOLS.includes(tool)) {
      if (tool === 'flatten' && e.altKey) {
        toolSettings.flatten.target = Math.round(map.sampleHeight(w.x, w.z));
        toolSettings.flatten.fixed = true;
        buildToolPanel();
        toast('Flatten height set to ' + toolSettings.flatten.target + ' elmos');
        return;
      }
      startStroke(e, w);
    } else if (tool === 'ramp') {
      const h = map.sampleHeight(w.x, w.z);
      ramp = { ax: w.x, az: w.z, bx: w.x, bz: w.z, ha: h };
      view2d.rampPreview = [w.x, w.z, w.x, w.z, toolSettings.ramp.width];
    } else {
      const types = tool === 'select' ? ['metal', 'geo', 'start'] : [tool];
      let hit = map.findObjectNear(w.x, w.z, pickRadius(), types);
      history.begin(map, 'object');
      if (hit) {
        selected = hit;
        drag = { obj: hit, dx: hit.x - w.x, dz: hit.z - w.z };
      } else if (tool !== 'select') {
        const props = tool === 'metal' ? { metal: toolSettings.metal.metal } : {};
        const made = map.addObject(tool, w.x, w.z, props);
        selected = made[0];
        drag = { obj: made[0], dx: 0, dz: 0 };
        view3d.updateMarkers();
      } else {
        selected = null;
      }
      view2d.selected = selected;
      buildToolPanel();
      view2d.invalidate();
    }
  });

  cv.addEventListener('pointermove', e => {
    if (!map) return;
    const { sx, sy } = evPos(e);
    const w = view2d.toWorld(sx, sy);
    view2d.cursor = w;
    if (pan) {
      view2d.ox = pan.ox + sx - pan.sx; view2d.oy = pan.oy + sy - pan.sy;
      view2d.invalidate();
      return;
    }
    if (stroke) stroke.pos = w;
    if (ramp) {
      ramp.bx = w.x; ramp.bz = w.z;
      view2d.rampPreview = [ramp.ax, ramp.az, ramp.bx, ramp.bz, toolSettings.ramp.width];
      const hb = map.sampleHeight(w.x, w.z), len = Math.hypot(ramp.bx - ramp.ax, ramp.bz - ramp.az);
      const ang = Math.atan2(Math.abs(hb - ramp.ha), Math.max(1, len)) * 57.3;
      $('hint').innerHTML = `Ramp: ${Math.round(len)} elmos long, ${Math.round(ramp.ha)} → ${Math.round(hb)} elmos, slope <b class="${ang <= map.settings.maxSlopeTank ? 'pass-ok' : ang <= map.settings.maxSlopeBot ? 'pass-bot' : 'pass-no'}">${ang.toFixed(1)}°</b>`;
    }
    if (drag) {
      map.moveObject(drag.obj, w.x + drag.dx, w.z + drag.dz);
      view2d.invalidate();
    } else if (tool === 'select' || OBJ_TOOLS.includes(tool)) {
      const types = tool === 'select' ? null : [tool];
      const h = map.findObjectNear(w.x, w.z, pickRadius(), types);
      if (h !== view2d.hover) { view2d.hover = h; cv.style.cursor = h ? 'move' : (tool === 'select' ? 'default' : 'crosshair'); }
    }
    updateCursorStatus(w);
    view2d.invalidate();
  });

  function endPointer(e) {
    if (pan) {
      pan = null;
      updateBrushPreview();
      if (rightDown && e && e.button === 2) {
        const { sx, sy } = evPos(e);
        if (Math.hypot(sx - rightDown.sx, sy - rightDown.sy) < 5) {
          const w = view2d.toWorld(sx, sy);
          const types = OBJ_TOOLS.includes(tool) ? [tool] : null;
          const hit = map.findObjectNear(w.x, w.z, pickRadius(), types);
          if (hit) { selected = hit; deleteSelected(); }
        }
      }
      rightDown = null;
      return;
    }
    if (stroke) endStroke();
    if (ramp) {
      const s = toolSettings.ramp;
      const hb = map.sampleHeight(ramp.bx, ramp.bz);
      if (Math.hypot(ramp.bx - ramp.ax, ramp.bz - ramp.az) > 8) {
        history.begin(map, 'ramp');
        let rect = null;
        const A = BMM.Sym.orbit(map, ramp.ax, ramp.az), B = BMM.Sym.orbit(map, ramp.bx, ramp.bz);
        const mode = BMM.Sym.symMode(map);
        // pair orbit images by transform index
        for (let k = 0; k < mode.T.length; k++) {
          const a = mode.T[k](ramp.ax, ramp.az, map.worldW, map.worldH), b = mode.T[k](ramp.bx, ramp.bz, map.worldW, map.worldH);
          if (k > 0 && A.length === 1 && B.length === 1) break;
          rect = union(rect, BMM.Terrain.ramp(map, a[0], a[1], b[0], b[1], ramp.ha, hb, s.width, s.hardness));
        }
        history.commit(rect);
        view2d.resetRange();
        view2d.renderBase(rect);
        view3d.updateHeights(); view3d.render();
        changed();
      }
      ramp = null;
      view2d.rampPreview = null;
      $('hint').innerHTML = TOOLS.find(t => t.id === 'ramp').hint;
    }
    if (drag) {
      drag = null;
      history.commit(null);
      refreshObjects();
    } else if (tool === 'select' || OBJ_TOOLS.includes(tool)) {
      history.cancel();
    }
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('pointerleave', () => { view2d.cursor = null; view2d.invalidate(); });

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.shiftKey && (BRUSH_TOOLS.includes(tool) || tool === 'ramp')) {
      const s = toolSettings[tool], key = tool === 'ramp' ? 'width' : 'radius';
      const d = e.deltaY || e.deltaX;
      s[key] = clamp(Math.round(s[key] * (d > 0 ? 0.9 : 1.1)), 16, 1500);
      updateBrushPreview();
      buildToolPanel();
      return;
    }
    const { sx, sy } = evPos(e);
    view2d.zoomAt(sx, sy, Math.pow(1.0018, -e.deltaY));
  }, { passive: false });

  function union(a, b) {
    if (!b) return a; if (!a) return b.slice();
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  }

  function startStroke(e, w) {
    let t = tool;
    const inv = e.shiftKey;
    if (inv && t === 'raise') t = 'lower'; else if (inv && t === 'lower') t = 'raise';
    const p = Object.assign({}, toolSettings[tool]);
    if (tool === 'paint' && inv) p.material = 0;
    if (tool === 'noise' && inv) p.strength = -p.strength;
    history.begin(map, t);
    stroke = {
      tool: t, p, pos: w, last: w, lastT: performance.now(), rect: null,
      state: { seed: (Math.random() * 1e6) | 0, target: p.fixed ? p.target : map.sampleHeight(w.x, w.z) },
    };
    if (tool === 'noise') { stroke.state.seed = 4242; }
    strokeFrame(true);
    const loop = () => { if (!stroke) return; strokeFrame(false); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  function strokeFrame(first) {
    const s = stroke, now = performance.now();
    let dt = first ? 1 / 60 : Math.min(0.1, (now - s.lastT) / 1000);
    s.lastT = now;
    const a = s.last, b = s.pos;
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const spacing = Math.max(4, s.p.radius * 0.25);
    const n = Math.max(1, Math.ceil(dist / spacing));
    let rect = null;
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const pts = BMM.Sym.orbit(map, x, z);
      // avoid double-applying where mirror images overlap (brush on the symmetry axis)
      const used = [];
      for (const [px, pz] of pts) {
        if (used.some(u => Math.hypot(u[0] - px, u[1] - pz) < s.p.radius * 0.5)) continue;
        used.push([px, pz]);
        rect = union(rect, BMM.Terrain.dab(map, s.tool, px, pz, s.p, dt / n, s.state));
      }
    }
    s.last = b;
    if (rect) {
      s.rect = union(s.rect, rect);
      view2d.renderBase(rect);
      schedule3D();
    }
  }
  function endStroke() {
    const s = stroke;
    stroke = null;
    history.commit(s.rect);
    view2d.resetRange();
    if (view2d.mode === 'height') view2d.renderBase();
    updateCursorStatus(view2d.cursor);
    if (view3d.visible) { view3d.updateHeights(); view3d.render(); }
    changed();
  }

  function updateCursorStatus(w) {
    if (!w || !map) return;
    const inside = w.x >= 0 && w.z >= 0 && w.x <= map.worldW && w.z <= map.worldH;
    if (!inside) { $('stCursor').textContent = '—'; $('stHeight').textContent = ''; $('stSlope').textContent = ''; return; }
    const h = map.sampleHeight(w.x, w.z), sl = map.slopeAtWorld(w.x, w.z), st = map.settings;
    $('stCursor').innerHTML = `x <b>${Math.round(w.x)}</b> z <b>${Math.round(w.z)}</b>`;
    $('stHeight').innerHTML = `height <b>${Math.round(h)}</b>`;
    let cls, txt;
    if (h < 0) { cls = 'pass-water'; txt = -h <= st.maxWaterDepth ? 'shallow water – units can wade' : 'deep water – ships & hovers'; }
    else if (sl <= st.maxSlopeTank) { cls = 'pass-ok'; txt = 'all units'; }
    else if (sl <= st.maxSlopeBot) { cls = 'pass-bot'; txt = 'bots only'; }
    else { cls = 'pass-no'; txt = 'impassable cliff'; }
    $('stSlope').innerHTML = `slope <b>${sl.toFixed(1)}°</b> <span class="${cls}">● ${txt}</span>`;
  }

  // ------------------------------------------------------------------ keyboard
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (document.querySelector('dialog[open]')) return;
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
    if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); $('fileOpen').click(); return; }
    if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); openExport(); return; }
    if (typing || ctrl || e.altKey) return;
    if (e.key === ' ') { spaceDown = true; cv.style.cursor = 'grab'; e.preventDefault(); return; }
    if (e.key === 'F1') { e.preventDefault(); $('dlgHelp').showModal(); return; }
    if (e.key === 'Home') { view2d.fit(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
    if (e.key === '[' || e.key === ']') {
      const key = tool === 'ramp' ? 'width' : 'radius';
      const s = toolSettings[tool];
      if (s && s[key] !== undefined) { s[key] = clamp(Math.round(s[key] * (e.key === ']' ? 1.15 : 0.87)), 16, 1500); updateBrushPreview(); buildToolPanel(); }
      return;
    }
    const t = TOOLS.find(t => t.key && t.key.toLowerCase() === e.key.toLowerCase());
    if (t) setTool(t.id);
  });
  window.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; updateBrushPreview(); } });

  function undo() {
    const e = history.undo(map); if (!e) return;
    afterHistory(e);
  }
  function redo() {
    const e = history.redo(map); if (!e) return;
    afterHistory(e);
  }
  function afterHistory(e) {
    selected = null; view2d.selected = null;
    view2d.resetRange();
    if (e.rect) view2d.renderBase(e.rect);
    $('symmetry').value = map.symmetry;
    view3d.updateHeights(); view3d.render();
    refreshObjects();
    buildToolPanel();
    toast('Undid / redid: ' + e.label, 1200);
  }
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  $('btnFit').addEventListener('click', () => view2d.fit());
  $('btnZoomIn').addEventListener('click', () => view2d.zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.4));
  $('btnZoomOut').addEventListener('click', () => view2d.zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.4));

  // ------------------------------------------------------------------ New map dialog
  let chosenTemplate = 'hills';
  function openNew() {
    buildSymmetrySelect();
    $('nmSym').value = $('nmSym').value || 'rot180';
    const ps = $('nmPalette');
    if (!ps.options.length) for (const k in BMM.Texture.PALETTES) ps.append(el('option', { value: k }, BMM.Texture.PALETTES[k].label));
    const tg = $('nmTemplates');
    tg.innerHTML = '';
    for (const t of TEMPLATES) {
      const c = el('canvas', { width: 96, height: 96 });
      const b = el('button', { type: 'button', class: 'tpl' + (t.id === chosenTemplate ? ' active' : ''), onclick: () => { chosenTemplate = t.id; for (const x of tg.children) x.classList.toggle('active', x === b); } }, c, t.label);
      tg.append(b);
      t._canvas = c;
    }
    $('dlgNew').showModal();
    renderThumbs();
  }
  async function renderThumbs() {
    for (const t of TEMPLATES) {
      await new Promise(r => setTimeout(r, 0));
      const m = new BMM.MapData(2, 2);
      m.symmetry = $('nmSym').value;
      m.texture = BMM.Texture.defaultTextureSettings($('nmPalette').value);
      if (t.preset) { m.texture = BMM.Texture.defaultTextureSettings(t.palette || $('nmPalette').value); BMM.Presets[t.preset](m, { seed: 7 }); }
      else {
        const g = Object.assign({}, genSettings, { terraces: 0, edges: 'none' }, t.g, { erosion: 0, seed: 7 });
        g.featureSize = (g.featureSize || 1500) / 6;
        BMM.Terrain.generate(m, g);
      }
      const c = t._canvas, ctx = c.getContext('2d'), img = ctx.createImageData(96, 96);
      const f = BMM.Texture.fields(m), col = [0, 0, 0], sun = BMM.Texture.sunDir(m.texture);
      for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
        const i = Math.round(x / 95 * (m.W - 1)), j = Math.round(y / 95 * (m.H - 1)), k = j * m.W + i;
        const h = m.heights[k];
        BMM.Texture.ruleColor(col, m.texture, h, m.slopeAt(i, j) * 0.4, f.jit[k], f.vary[k], 0, 0);
        const sh = 1 + (BMM.Texture.shadeAt(m, i, j, sun) - 1) * 0.35;
        let r = col[0] * sh, gg = col[1] * sh, b = col[2] * sh;
        if (h < 0) { r = r * 0.4 + 20; gg = gg * 0.5 + 60; b = b * 0.5 + 90; }
        const o = (y * 96 + x) * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
  }
  $('nmSize').addEventListener('change', () => { $('nmCustomWrap').hidden = $('nmSize').value !== 'custom'; });
  $('nmSym').addEventListener('change', renderThumbs);
  $('nmPalette').addEventListener('change', renderThumbs);
  $('dlgNew').addEventListener('close', async () => {
    if ($('dlgNew').returnValue !== 'ok') return;
    let sx, sz;
    if ($('nmSize').value === 'custom') { sx = +$('nmCx').value; sz = +$('nmCz').value; }
    else [sx, sz] = $('nmSize').value.split('x').map(Number);
    sx = clamp(Math.round(sx / 2) * 2, 2, 32); sz = clamp(Math.round(sz / 2) * 2, 2, 32);
    await busy('Creating map…', () => {
      const m = new BMM.MapData(sx, sz);
      m.settings.name = $('nmName').value.trim() || 'My BAR Map';
      m.settings.author = $('nmAuthor').value.trim();
      let sym = $('nmSym').value;
      if (BMM.SYMMETRY[sym].square && sx !== sz) sym = 'rot180';
      m.symmetry = sym;
      m.texture = BMM.Texture.defaultTextureSettings($('nmPalette').value);
      const t = TEMPLATES.find(t => t.id === chosenTemplate);
      Object.assign(genSettings, { terraces: 0, edges: 'none', seed: (Math.random() * 1e6) | 0 }, t.g);
      resSettings.players = clamp(+$('nmPlayers').value | 0, 2, 16);
      if (t.preset) {
        if (t.palette) m.texture = BMM.Texture.defaultTextureSettings(t.palette);
        BMM.Presets[t.preset](m, { seed: genSettings.seed });
      } else BMM.Terrain.generate(m, genSettings);
      if (!t.preset && $('nmResources').checked) {
        const big = sx * sz;
        Object.assign(resSettings, { nearStart: 4, extraMetal: Math.round(big / 18 + 2), geos: big >= 100 ? 2 : 1 });
        const perSide = Math.max(1, BMM.Sym.symMode(m).T.length);
        resSettings.extraMetal = Math.max(2, Math.round(resSettings.extraMetal * 2 / perSide));
        BMM.Terrain.autoResources(m, Object.assign({ clear: true, seed: genSettings.seed }, resSettings));
      }
      setMap(m);
      fullRefresh();
      setTool('raise');
    });
    toast('Map created! Sculpt with the tools on the left, then <b>Export map</b>.', 4000);
  });

  // ------------------------------------------------------------------ resize & import
  function openResize() { $('rsX').value = map.sx; $('rsZ').value = map.sz; $('dlgResize').showModal(); }
  $('dlgResize').addEventListener('close', async () => {
    if ($('dlgResize').returnValue !== 'ok') return;
    const sx = clamp(Math.round(+$('rsX').value / 2) * 2, 2, 32), sz = clamp(Math.round(+$('rsZ').value / 2) * 2, 2, 32);
    if (sx === map.sx && sz === map.sz) return;
    await busy('Resizing…', () => {
      const m = map.resized(sx, sz);
      if (BMM.SYMMETRY[m.symmetry].square && sx !== sz) m.symmetry = 'rot180';
      setMap(m);
      fullRefresh();
    });
    toast(`Map resized to ${sx}×${sz}. (Undo history was cleared.)`);
  });
  $('dlgImport').addEventListener('close', async () => {
    if ($('dlgImport').returnValue !== 'ok') return;
    const f = $('imFile').files[0];
    if (!f) { toast('No image chosen.'); return; }
    const lo = +$('imMin').value, hi = +$('imMax').value;
    await busy('Importing heightmap…', async () => {
      const img = await BMM.IO.decodeImageLuminance(f);
      history.begin(map, 'import');
      const W = map.W, H = map.H;
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const gx = i / (W - 1) * (img.width - 1), gz = j / (H - 1) * (img.height - 1);
        const x0 = Math.floor(gx), z0 = Math.floor(gz), x1 = Math.min(img.width - 1, x0 + 1), z1 = Math.min(img.height - 1, z0 + 1);
        const fx = gx - x0, fz = gz - z0, d = img.data, w = img.width;
        const v = (d[z0 * w + x0] * (1 - fx) + d[z0 * w + x1] * fx) * (1 - fz) + (d[z1 * w + x0] * (1 - fx) + d[z1 * w + x1] * fx) * fz;
        map.heights[j * W + i] = lo + (hi - lo) * v;
      }
      history.commit([0, 0, W - 1, H - 1]);
      fullRefresh();
      toast(`Imported ${img.width}×${img.height} ${img.depth}-bit heightmap.`);
    });
    $('imFile').value = '';
  });

  // ------------------------------------------------------------------ save / open
  async function saveProject() {
    await busy('Saving project…', async () => {
      const blob = await BMM.IO.saveProjectBlob(map);
      BMM.IO.download(blob, BMM.Export.safeName(map.settings.name).toLowerCase() + '.barmap');
      dirtySinceSave = false;
      $('stSaved').textContent = 'saved';
    });
  }
  $('btnSave').addEventListener('click', saveProject);
  $('btnOpen').addEventListener('click', () => $('fileOpen').click());
  $('fileOpen').addEventListener('change', async () => {
    const f = $('fileOpen').files[0];
    if (!f) return;
    await busy('Opening project…', async () => {
      const m = await BMM.IO.loadProjectFile(await f.arrayBuffer());
      setMap(m);
      fullRefresh();
      toast('Opened ' + m.settings.name);
    });
    $('fileOpen').value = '';
  });
  $('btnNew').addEventListener('click', openNew);
  $('btnHelp').addEventListener('click', () => $('dlgHelp').showModal());
  $('helpClose').addEventListener('click', () => $('dlgHelp').close());

  // ------------------------------------------------------------------ export
  let exporting = false;
  function openExport() {
    const issues = BMM.Export.validate(map);
    const ul = $('exIssues');
    ul.innerHTML = '';
    if (!issues.length) ul.append(el('li', { class: 'ok' }, '✓ Map looks ready to play.'));
    for (const i of issues) ul.append(el('li', { class: i.level }, i.msg));
    $('exProgress').hidden = true;
    $('exDone').hidden = true;
    $('dlgExport').showModal();
  }
  async function runExport(kind) {
    if (exporting) return;
    exporting = true;
    for (const b of document.querySelectorAll('.exopts button')) b.disabled = true;
    $('exProgress').hidden = false; $('exDone').hidden = true;
    const prog = (label, f) => { $('exLabel').textContent = label; $('exBar').style.width = Math.round(f * 100) + '%'; };
    const t0 = performance.now();
    try {
      let res;
      if (kind === 'sdz') res = await BMM.Export.exportSDZ(map, prog);
      else if (kind === 'src') res = await BMM.Export.exportSources(map, prog);
      else {
        prog('Encoding heightmap…', 0.5);
        const r = await BMM.Export.exportHeightPNG(map);
        res = { blob: r.blob, filename: BMM.Export.safeName(map.settings.name).toLowerCase() + `_heightmap_${r.minH}_${r.maxH}.png` };
      }
      prog('Done', 1);
      BMM.IO.download(res.blob, res.filename);
      const mb = (res.blob.size / 1048576).toFixed(1);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const d = $('exDone');
      d.hidden = false;
      if (kind === 'sdz') {
        d.innerHTML = `<b>✓ ${res.filename}</b> (${mb} MB, ${secs}s) has been downloaded.<br>
          Easiest: drag it onto <code>tools\\install_map.bat</code> – it converts it to <b>.sd7</b> (BAR's usual 7-Zip format) and installs it.<br>
          Or move it into your BAR maps folder as-is (the engine also reads .sdz):<br><code>%LOCALAPPDATA%\\Programs\\Beyond-All-Reason\\data\\maps\\</code>
          <button id="copyPath" type="button">Copy path</button><br>
          <span class="muted">Then restart BAR and choose <b>${map.settings.name} ${map.settings.version}</b> in a skirmish. Start boxes are drawn in the lobby.</span>`;
        $('copyPath').addEventListener('click', () => { navigator.clipboard.writeText('%LOCALAPPDATA%\\Programs\\Beyond-All-Reason\\data\\maps\\'); toast('Path copied – paste it into the Explorer address bar.'); });
      } else {
        d.innerHTML = `<b>✓ ${res.filename}</b> (${mb} MB, ${secs}s) has been downloaded.`;
      }
    } catch (e) {
      console.error(e);
      $('exLabel').textContent = 'Export failed: ' + e.message;
    } finally {
      exporting = false;
      for (const b of document.querySelectorAll('.exopts button')) b.disabled = false;
    }
  }
  $('btnExport').addEventListener('click', openExport);
  $('exSdz').addEventListener('click', () => runExport('sdz'));
  $('exSrc').addEventListener('click', () => runExport('src'));
  $('exHm').addEventListener('click', () => runExport('hm'));
  $('exClose').addEventListener('click', () => { if (!exporting) $('dlgExport').close(); });

  // ------------------------------------------------------------------ boot
  let firstFit = true;
  new ResizeObserver(() => {
    view2d.resize();
    if (firstFit && map && $('wrap2d').clientWidth > 50) { firstFit = false; view2d.fit(); }
  }).observe($('wrap2d'));
  new ResizeObserver(() => view3d.resize()).observe($('wrap3d'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && map && dirtySinceSave) BMM.IO.autosave(map); });

  async function boot() {
    view2d.resize();
    const saved = await BMM.IO.loadAutosave();
    if (saved) {
      try {
        const m = await saved.load();
        setMap(m);
        setTool('raise');
        view2d.resize(); view2d.fit();
        $('stSaved').textContent = 'restored last session';
        toast(`Restored “${m.settings.name}” from your last session.`, 3500);
        return;
      } catch (e) { console.warn('Could not restore autosave', e); }
    }
    const m = new BMM.MapData(12, 12);
    m.symmetry = 'rot180';
    genSettings.seed = (Math.random() * 1e6) | 0;
    BMM.Terrain.generate(m, genSettings);
    BMM.Terrain.autoResources(m, Object.assign({ clear: true, seed: 3 }, resSettings));
    setMap(m);
    setTool('raise');
    view2d.resize(); view2d.fit();
    openNew();
  }
  boot();

  // for debugging in the console
  window.App = { get map() { return map; }, history, view2d, view3d, setMap, fullRefresh };
})();
