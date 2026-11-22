import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { starterPack } from '../src/library-profile.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { parseSTL } from '../src/editor.js';
import {
  newLayout,
  endsOf,
  placeSource,
  removeSection,
  reverseSection,
  snapRun,
  setElevation,
  surfaces,
  crossings,
  supportRequests,
  tally,
  validateLayout,
} from '../src/planner-model.js';

const wasm = await init();
wasm.setup();
const engine = createEngine(wasm),
  plate = { width: 450, depth: 450, margin: 0 },
  stock = starterPack().pieces;
function source(index, changes = {}, bed = plate) {
  const { name, track } = structuredClone(stock[index]);
  Object.assign(track.params, changes);
  return { name, ...engine.plannerSource({ track, plate: bed }) };
}
function setup(entries) {
  const defs = new Map(entries),
    layout = newLayout();
  for (const [id, d] of defs)
    layout.sources[id] = { name: d.name, track: d.track };
  return { defs, layout };
}
test('an R4 cut to two thirds, two left R2s and a quarter of an R1 form one printable run', () => {
  const { defs, layout } = setup([
    ['s1', source(0)],
    ['s2', source(7, { segments: 3 })],
    ['s3', source(5, { segments: 2 })],
    ['s4', source(4, { segments: 4 })],
  ]);
  let active = {};
  function add(id, hand) {
    active = placeSource(layout, defs, id, active.end, hand);
  }
  function trim() {
    active = removeSection(layout, defs, active.selected);
  }
  add('s1');
  add('s2');
  trim();
  add('s3', 'left');
  add('s3', 'left');
  add('s4');
  trim();
  trim();
  trim();
  add('s1');
  assert.deepEqual(
    layout.nodes.map((n) => n.source),
    ['s1', 's2', 's2', 's3', 's3', 's3', 's3', 's4', 's1'],
  );
  assert.equal(endsOf(layout, defs).open.length, 2);
  assert.equal(crossings(surfaces(layout, defs)).length, 0);
  const totals = tally(layout, defs);
  const count = (role) =>
    totals.filter((g) => g.role === role).reduce((s, g) => s + g.count, 0);
  assert.deepEqual(
    [count('road'), count('clip'), count('retainer')],
    [9, 8, 8],
  );
  const after = validateLayout(JSON.parse(JSON.stringify(layout)));
  assert.deepEqual(after, layout);
  const before = layout.nodes[0].pose;
  reverseSection(layout, defs, layout.nodes[3].id);
  assert.equal(layout.nodes[3].pose.flip, false);
  assert.deepEqual(layout.nodes[0].pose, before);
  assert.equal(endsOf(layout, defs).open.length, 2);
  const cut = removeSection(layout, defs, layout.nodes[3].id);
  const ends = endsOf(layout, defs).open;
  assert.equal(ends.length, 4);
  snapRun(
    layout,
    defs,
    ends.find((e) => e.id === layout.nodes[3].id).key,
    cut.end,
  );
  assert.equal(endsOf(layout, defs).open.length, 2);
});
test('snapping a loop closes the last joint, and a single-lane road cannot attach to a two-lane end', () => {
  const single = starterPack(1).pieces[0].track;
  const { defs, layout } = setup([
    ['s1', source(4, { segments: 1, angle: 90, joint: 'none' })],
    [
      's2',
      { name: 'Single', ...engine.plannerSource({ track: single, plate }) },
    ],
  ]);
  let c = placeSource(layout, defs, 's1');
  assert.throws(() => placeSource(layout, defs, 's2', c.end), /slots|edges/);
  for (let i = 0; i < 3; i++) c = placeSource(layout, defs, 's1', c.end);
  assert.equal(endsOf(layout, defs).open.length, 0);
  assert.throws(() => placeSource(layout, defs, 's1', c.end), /open end/i);
});
test('the actual bed fit increases a long straight’s divisions and preserves attached borders after trimming', () => {
  const s = source(
    0,
    {
      length: 520,
      width: 110,
      laneSpacing: 55,
      segments: 1,
      borderSide: 'both',
    },
    { width: 200, depth: 200, margin: 0 },
  );
  assert.ok(s.sections.length >= 3);
  assert.ok(s.meshes.every((m) => m.fit.fits));
  assert.ok(
    s.sections.every((s) => s.parts.some((k) => k.startsWith('border-'))),
  );
  const { defs, layout } = setup([['s1', s]]);
  const c = placeSource(layout, defs, 's1');
  removeSection(layout, defs, c.selected);
  assert.equal(
    tally(layout, defs).filter((g) => g.role === 'road').length,
    s.sections.length - 1,
  );
});
test('a diamond exposes four ends, a split pit stays in station pairs and both tally every road STL', () => {
  for (const [type, ends] of [
    ['diamond', 4],
    ['pit', 2],
  ]) {
    const track = {
      params: {
        ...specialTrackParams(type, stock[0].track.params),
        segments: 3,
      },
      plan: null,
    };
    const def = {
      name: type,
      ...engine.plannerSource({ track, plate, autoFit: false }),
    };
    const { layout, defs } = setup([['s1', def]]);
    placeSource(layout, defs, 's1');
    assert.equal(endsOf(layout, defs).open.length, ends);
    assert.equal(
      tally(layout, defs).filter((g) => g.role === 'road').length,
      def.meshes.filter((m) => m.role === 'road').length,
    );
  }
});
test('bridge headroom subtracts lower road thickness and printable supports avoid its complete footprint', () => {
  const def = source(0, {
      length: 400,
      width: 80,
      laneSpacing: 40,
      joint: 'none',
    }),
    { defs, layout } = setup([['s1', def]]);
  const c = placeSource(layout, defs, 's1');
  const upper = layout.nodes[0];
  placeSource(layout, defs, 's1', c.end);
  const lower = structuredClone(upper);
  lower.id = 'cross-track';
  lower.pose = { x: 200, y: 0, a: Math.PI / 2, flip: false };
  layout.nodes.push(lower);
  setElevation(layout, defs, upper.id, 70, 70, 2);
  const rows = surfaces(layout, defs),
    hits = crossings(rows);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].clearance, 60);
  // The Planner keeps pair results between edits; they must match a fresh check,
  // and a moved section must be worked out again.
  const memo = new Map();
  assert.deepEqual(crossings(rows, memo), hits);
  assert.ok(memo.size > 0);
  assert.deepEqual(crossings(surfaces(layout, defs), memo), hits);
  lower.pose = { ...lower.pose, x: 1000 };
  assert.deepEqual(crossings(surfaces(layout, defs), memo), []);
  lower.pose = { ...lower.pose, x: 200 };
  assert.deepEqual(layout.nodes[1].h, [70, 0]);
  const blocks = engine.plannerSupports({
    requests: supportRequests(rows),
    plate,
  });
  assert.equal(blocks.length, 2);
  for (const b of blocks) {
    assert.ok(b.bounds.max[0] < 160 || b.bounds.min[0] > 240);
    assert.equal(b.bounds.max[2], 70);
    const solid = parseSTL(wasm, b.stl);
    assert.equal(solid.status(), 'NoError');
    solid.delete();
  }
  const ramp = tally(layout, defs).find((g) => g.pose.slope);
  const [bytes] = engine.plannerPrint({ track: def.track, items: [ramp] });
  const print = parseSTL(wasm, bytes);
  assert.equal(print.status(), 'NoError');
  assert.ok(Math.abs(print.boundingBox().min[2]) < 0.001);
  print.delete();
});
