// The glazing template: a clear sheet for each window, reaching past it to be glued on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { glazingSheets, glazingSvg, GLAZING } from '../src/building-glazing.js';
import { CONNECTED_DEFAULTS } from '../src/geometry/connected-building.js';
import { kitNotes } from '../src/building-kit.js';

const size = (s) => [Math.max(...s.points.map((p) => p[0])), Math.max(...s.points.map((p) => p[1]))];
const win = (wall, at, width, height, sill, more = {}) => ({ wall, type: 'window', at, width, height, sill, ...more });

test('each window a sheet, 2 mm past it all round; doors and serving hatches have none', () => {
  const b = { width: 160, depth: 120, height: 75, door: 'none', openings: [win('front', 40, 30, 24, 25), win('front', 110, 40, 30, 25, { frame: true, across: 2, up: 1 }), { wall: 'left', type: 'door', at: 60, width: 28, height: 48, sill: 0 }, win('back', 80, 40, 24, 30, { counter: true })] };
  const sheets = glazingSheets(b);
  assert.deepEqual(sheets.map((s) => s.name), ['Front window 1', 'Front window 2']);
  assert.deepEqual(sheets.map(size), [[34, 28], [44, 34]]);
});

test('a sheet keeps clear of the next window and reaches no further than the floor', () => {
  // Two windows 6 mm apart, one 1 mm off the floor.
  const b = { width: 120, depth: 120, height: 75, door: 'none', openings: [win('front', 30, 30, 20, 30), win('front', 66, 30, 20, 30), win('right', 60, 30, 20, 1)] };
  const [a, c, low] = glazingSheets(b);
  // 6 mm apart leaves room for the whole 2 mm on each, and half a millimetre between them.
  assert.ok(6 / 2 - GLAZING.apart / 2 >= 2);
  assert.deepEqual(size(a), [34, 24]);
  assert.deepEqual(size(c), [34, 24]);
  assert.deepEqual(size(low), [34, 20 + 2 + 1]);
});

test('an open storey: a sheet per pane, between the mullions; a leaning storey: wider at the top', () => {
  const open = { width: 100, depth: 80, height: 50, door: 'none', open: true, waist: 20, panes: 3 };
  const sheets = glazingSheets(open);
  assert.equal(sheets.length, 12);
  // Neighbouring panes 3 mm apart: each sheet stops short of the middle of the mullion.
  const [w] = size(sheets[1]);
  const pane = (100 - 2 * 9 - 2 * 3) / 3;
  assert.ok(Math.abs(w - (pane + 2 * (3 / 2 - GLAZING.apart / 2))) < 1e-6, w + ' for a pane of ' + pane);
  const lean = glazingSheets({ ...open, lean: 10 });
  const p = lean[1].points;
  assert.ok(p[2][0] - p[3][0] > p[1][0] - p[0][0], 'the top is wider');
  assert.ok(p[2][1] > size(sheets[1])[1], 'longer up the leaning face');
});

test('connected sections and footprints have their sheets too', () => {
  const [hall] = CONNECTED_DEFAULTS.sections;
  const sections = { kind: 'sections', sections: [{ ...hall, openings: [win('front', 60, 40, 30, 26, { frame: true }), { wall: 'front', type: 'door', at: 120, width: 28, height: 50, sill: 0 }] }] };
  assert.deepEqual(glazingSheets(sections).map((s) => s.name), ['Main hall, front window 1']);
  const shaped = { kind: 'footprint', shape: 'L', openings: [win('edge-1', 60, 40, 28, 24), win('edge-3', 30, 20, 20, 30)] };
  assert.deepEqual(glazingSheets(shaped).map((s) => s.name), ['Wall 1, window 1', 'Wall 3, window 1']);
  assert.deepEqual(glazingSheets({ kind: 'bench' }), []);
  // As saved, leaving out its sizes: they are its defaults, not nothing.
  const [raw] = glazingSheets({ kind: 'footprint', openings: [win('edge-1', 60, 40, 28, 24)] });
  assert.deepEqual(size(raw), [44, 32]);
  const [rawSection] = glazingSheets({ kind: 'sections', sections: [{ id: 's1', name: 'Hall', parent: null, openings: [win('front', 60, 40, 28, 24)] }] });
  assert.deepEqual(size(rawSection), [44, 32]);
});

test('the template: full size in mm, one outline a sheet, the names written out; the notes point to it', () => {
  const b = { width: 160, depth: 120, height: 75, door: 'none', openings: [win('front', 40, 30, 24, 25), win('back', 80, 40, 24, 30)] };
  const svg = glazingSvg('Tom & Jerry <HQ>', glazingSheets(b));
  assert.match(svg, /width="200mm"/);
  assert.equal(svg.match(/<polygon/g).length, 2);
  assert.match(svg, /Tom &amp; Jerry &lt;HQ&gt;/);
  assert.match(svg, /Front window 1 · 34 × 28 mm/);
  assert.match(kitNotes('HQ', b, [], {}), /glazing\.svg/);
  assert.doesNotMatch(kitNotes('HQ', { ...b, openings: [] }, [], {}), /glazing\.svg/);
});
