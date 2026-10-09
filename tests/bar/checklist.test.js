// G7 checklist (src/bar/checklist.js): each check passes and fails as it should on synthetic docs and facts, and every
// one-click fix makes its check pass as one undoable History step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checklist, docFacts, GEO, geoFacts, LIMITS, northernSun } from '../../src/bar/checklist.js';
import { addObject, createMap, History } from '../../src/core/index.js';
import { testMap } from '../helpers/test-map.js';

const row = (facts, id) => checklist(facts).find((r) => r.id === id);
const docRow = (doc, id) => row(docFacts(doc), id);

/** Applies a row's fix the way the app does (one History step) and returns the history. */
function fix(doc, r) {
  assert.ok(r.fix, `${r.id} has a fix`);
  const history = new History();
  history.begin(doc, r.fix.label);
  history.commit(r.fix.apply(doc));
  return history;
}

// A flat 4x4 map with two starts, four separate metal spots and a geo on flat ground: every doc check passes.
function cleanDoc() {
  const doc = createMap({ sx: 4, sz: 4 });
  doc.heights.fill(100);
  for (const [x, z] of [[300, 1024], [1748, 1024]]) addObject(doc, 'start', x, z);
  for (const [x, z] of [[500, 700], [500, 1300], [1500, 700], [1500, 1300]]) addObject(doc, 'metal', x, z, { metal: 2 });
  addObject(doc, 'geo', 1024, 1024);
  return doc;
}

test('a clean doc passes every check the doc decides, and archive-only checks are left out', () => {
  const rows = checklist(docFacts(cleanDoc()));
  assert.deepEqual(rows.map((r) => r.id), ['size', 'starts', 'wind', 'tidal', 'sun', 'metal', 'geos']);
  assert.deepEqual(rows.filter((r) => r.status !== 'pass'), []);
  assert.ok(rows.every((r) => !r.fix), 'passing rows offer no fix');
});

test('size: more than 32 units in either direction fails', () => {
  assert.equal(row({ sx: 32, sz: 32 }, 'size').status, 'pass');
  assert.equal(row({ sx: 34, sz: 16 }, 'size').status, 'fail');
});

test('wind outside 0-30 or min above max fails; the fix clamps it', () => {
  for (const [min, max] of [[5, 40], [-2, 10], [25, 12]]) {
    const doc = cleanDoc();
    Object.assign(doc.settings, { minWind: min, maxWind: max });
    const r = docRow(doc, 'wind');
    assert.equal(r.status, 'fail', `${min}-${max}`);
    fix(doc, r);
    assert.equal(docRow(doc, 'wind').status, 'pass', `${min}-${max} after the fix`);
  }
});

test('tidal above 25 fails; the fix clamps it and undo brings it back', () => {
  const doc = cleanDoc();
  doc.settings.tidalStrength = 31;
  const history = fix(doc, docRow(doc, 'tidal'));
  assert.equal(doc.settings.tidalStrength, 25);
  assert.equal(docRow(doc, 'tidal').status, 'pass');
  history.undo(doc);
  assert.equal(doc.settings.tidalStrength, 31);
});

test('sun: from the south fails, too low or high warns; the fix puts it 40° high in the north', () => {
  const doc = cleanDoc();
  doc.settings.sunDir = [0.3, 0.7, 0.5];
  assert.equal(docRow(doc, 'sun').status, 'fail');
  fix(doc, docRow(doc, 'sun'));
  assert.ok(doc.settings.sunDir[2] < 0);
  assert.equal(docRow(doc, 'sun').status, 'pass');

  doc.settings.sunDir = [0.05, 1, -0.05]; // ~86° high
  assert.equal(docRow(doc, 'sun').status, 'warn');
  fix(doc, docRow(doc, 'sun'));
  assert.equal(docRow(doc, 'sun').status, 'pass');
});

test('northernSun keeps a good sun and moves east/west or southern suns into the north', () => {
  const [x, y, z] = northernSun([0.35, 0.75, -0.55]);
  const elevation = (v) => (Math.asin(v[1] / Math.hypot(...v)) * 180) / Math.PI;
  assert.ok(Math.abs(elevation([x, y, z]) - elevation([0.35, 0.75, -0.55])) < 0.1 && z < 0 && x > 0);
  for (const sun of [[1, 0.5, 0], [-0.2, 0.6, 0.8], [0, 0.2, 1]]) {
    const v = northernSun(sun);
    assert.ok(v[2] <= -0.5 * Math.hypot(v[0], v[2]) + 1e-3, `${sun} -> ${v}: at least 30° from east/west`);
    const e = elevation(v);
    assert.ok(e >= LIMITS.sunElevation[0] && e <= LIMITS.sunElevation[1], `${sun} elevation ${e}`);
  }
});

test('starts: fewer than 2 fail with a fix that places 2; outside or stacked starts fail', () => {
  const doc = cleanDoc();
  doc.objects = doc.objects.filter((o) => o.type !== 'start');
  const r = docRow(doc, 'starts');
  assert.equal(r.status, 'fail');
  fix(doc, r);
  assert.equal(doc.objects.filter((o) => o.type === 'start').length, 2);
  assert.equal(docRow(doc, 'starts').status, 'pass');
  assert.equal(doc.objects.filter((o) => o.type === 'metal').length, 4, 'metal stays');

  assert.equal(row({ sx: 4, sz: 4, starts: [{ x: 100, z: 100 }, { x: 3000, z: 100 }] }, 'starts').status, 'fail');
  assert.equal(row({ sx: 4, sz: 4, starts: [{ x: 100, z: 100 }, { x: 120, z: 110 }] }, 'starts').status, 'fail');
});

test('metal: touching spots merge in BAR and fail; odd values and wide blobs warn; a metal field fails', () => {
  const doc = cleanDoc();
  addObject(doc, 'metal', 560, 700, { metal: 2 }); // 60 elmos from a spot: the discs touch
  const r = docRow(doc, 'metal');
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /finds 4 of 5/);

  const base = { expected: 4, found: 4, maxSpan: 64, extractorRadius: 90, values: [2, 2, 2, 2] };
  assert.equal(row({ metal: base }, 'metal').status, 'pass');
  assert.equal(row({ metal: { ...base, values: [2, 2, 2, 9] } }, 'metal').status, 'warn');
  assert.equal(row({ metal: { ...base, maxSpan: 200 } }, 'metal').status, 'warn');
  assert.equal(row({ metal: { ...base, maxSpan: 600, found: 0 } }, 'metal').status, 'fail');
  assert.equal(row({ metal: { ...base, expected: 0, found: 0, values: [] } }, 'metal').status, 'warn');
});

test('geos: a vent on a slope fails; the fix flattens its T2 footprint in one undoable step', () => {
  const doc = testMap({ sx: 4, sz: 4 }); // its geo sits on the plateau's rolling top: 23 elmos across the footprint
  const r = docRow(doc, 'geos');
  assert.equal(r.status, 'fail');
  const before = doc.heights.slice();
  const history = fix(doc, r);
  const [geo] = docFacts(doc).geos;
  assert.ok(geo.span < 0.01, `flat after the fix (${geo.span})`);
  assert.equal(docRow(doc, 'geos').status, 'pass');
  history.undo(doc);
  assert.deepEqual(doc.heights, before);
});

test('geos: the footprint span, and a vent under water fails', () => {
  const W = 33, ramp = Float32Array.from({ length: W * W }, (_, k) => (k % W) * 3); // 3 elmos per 8-elmo square
  const [g] = geoFacts(ramp, W, W, [{ x: 128, z: 128 }]);
  assert.equal(g.span, 30); // 10 squares across the 80-elmo footprint
  assert.ok(g.span > GEO.maxSpan);
  assert.equal(row({ geos: [{ x: 0, z: 0, span: 0, ground: -20 }] }, 'geos').status, 'fail');
  assert.equal(row({ geos: [] }, 'geos').status, 'pass');
});

test('grass: none warns with a fix that grows grass on open ground, which the doc facts then see', () => {
  const doc = cleanDoc();
  const r = row({ ...docFacts(doc), grass: 0 }, 'grass');
  assert.equal(r.status, 'warn');
  fix(doc, r);
  assert.equal(doc.settings.openGrass, true);
  const facts = { grass: 0, ...docFacts(doc) };
  assert.ok(facts.grass > 0.5, `open ground grass ${facts.grass}`);
  assert.equal(row(facts, 'grass').status, 'pass');
});

test('archive-only checks: splats, normals, specular, minimap, fog, lighting, features', () => {
  const dnts = (width, extra = {}) => ({ file: 'd.png', width, height: width, ...extra });
  assert.equal(row({ dnts: [dnts(1024), dnts(2048)] }, 'splats').status, 'pass');
  assert.equal(row({ dnts: [dnts(1024), dnts(512)] }, 'splats').status, 'warn');
  assert.equal(row({ dnts: [] }, 'splats').status, 'warn');
  assert.equal(row({ dnts: [dnts(null, { missing: true })] }, 'splats').status, 'fail');

  assert.equal(row({ sx: 16, normalTex: { file: 'n.dds', width: 8192, height: 8192 } }, 'normals').status, 'pass');
  assert.equal(row({ sx: 16, normalTex: { file: 'n.dds', width: 1024, height: 1024 } }, 'normals').status, 'warn');
  assert.equal(row({ sx: 16, normalTex: null }, 'normals').status, 'warn');

  assert.equal(row({ specularMean: null }, 'specular').status, 'pass');
  assert.equal(row({ specularMean: 15 }, 'specular').status, 'pass');
  assert.equal(row({ specularMean: 30 }, 'specular').status, 'warn');
  assert.equal(row({ specularMean: 60 }, 'specular').status, 'fail');

  assert.equal(row({ minimapLuma: 100 }, 'minimap').status, 'pass');
  assert.equal(row({ minimapLuma: 30 }, 'minimap').status, 'warn');

  assert.equal(row({ fog: { start: 0.75, end: 1 } }, 'fog').status, 'pass');
  assert.equal(row({ fog: { start: 0.1, end: 1 } }, 'fog').status, 'warn');
  assert.equal(row({ fog: { start: 1, end: 0.5 } }, 'fog').status, 'fail');

  assert.equal(row({ light: { ambient: [0.5, 0.5, 0.5], diffuse: [1, 1, 1] } }, 'lighting').status, 'pass');
  assert.equal(row({ light: { ambient: [1, 1, 1], diffuse: [1, 1, 1] } }, 'lighting').status, 'warn');

  assert.equal(row({ fixedY: 0 }, 'features').status, 'pass');
  assert.equal(row({ fixedY: 12 }, 'features').status, 'warn');
});
