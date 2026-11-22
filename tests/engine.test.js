import { test } from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { parseSTL, encodeSTL } from '../src/editor.js';
import { newProject, toBase64 } from '../src/project.js';

const wasm = await init();
wasm.setup();
const stock = wasm.Manifold.cube([10, 20, 30]);
const stockData = toBase64(encodeSTL(stock));
stock.delete();
const close = (a, b, eps = 1e-4) =>
  assert.ok(Math.abs(a - b) < eps, `${a} differs from ${b}`);
const transform = (id, target, extra = {}) => ({
  id,
  target,
  type: 'transform',
  move: [0, 0, 0],
  rotate: [0, 0, 0],
  scale: 1,
  ...extra,
});
const add = (separate = false) => ({
  id: 'badge',
  target: 'body',
  type: 'add',
  frame: { origin: [5, 10, 30], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  loops: [
    [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ],
  ],
  depth: 2,
  separate,
});

function workbench(t, ops) {
  const p = newProject();
  p.mode = 'editor';
  p.editor = { source: { label: 'Box', data: stockData }, ops };
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  engine.build(p);
  return {
    engine,
    p,
    extra() {
      const solid = parseSTL(wasm, engine.export({ mode: 'additions' }));
      t.after(() => solid.delete());
      return solid;
    },
  };
}

test('revising an earlier edit uses its input dimensions and face coordinates without changing the applied assembly', (t) => {
  const { engine, p } = workbench(t, [
    transform('scaled', 'body', { scale: 1.04 }),
    transform('moved', 'body', { move: [100, 0, 0] }),
  ]);
  const [original] = engine.historySource('scaled');
  close(original.bounds.max[0] - original.bounds.min[0], 10);
  const [scaled] = engine.historySource('moved');
  close(scaled.bounds.max[0] - scaled.bounds.min[0], 10.4);
  const args = { id: 'body', triangle: 0, tolerance: 8 };
  const before = engine.pick({ ...args, historyId: 'moved' });
  engine.forgetHistory('moved');
  assert.deepEqual(engine.pick({ ...args, historyId: 'moved' }), before);
  assert.ok(before.origin[0] < 12);
  assert.ok(engine.pick(args).origin[0] > 95);
  p.editor.ops = [];
  engine.build(p);
  assert.throws(() => engine.historySource('moved'), /no longer/);
});

test('moving, mirroring, scaling or duplicating stock creates no added material', (t) => {
  const { engine } = workbench(t, [
    transform('m', 'body', {
      move: [13, -8, 7],
      rotate: [15, 30, -22],
      mirror: true,
      scale: 2,
    }),
    { id: 'another', target: 'body', type: 'duplicate', move: [80, 0, 0] },
  ]);
  assert.throws(
    () => engine.export({ mode: 'additions' }),
    /no added material/,
  );
});

test('a detached tilt wedge can be exported, moved and reopened without changing its stock', (t) => {
  const tilted = {
    id: 'wedge',
    target: 'body',
    type: 'tiltFace',
    separate: true,
    angle: 45,
    pivot: 'u-min',
    hingeRotation: 90,
    pivotOffset: 2,
    frame: add().frame,
    loops: [
      [
        [-5, -10],
        [5, -10],
        [5, 10],
        [-5, 10],
      ],
    ],
  };
  const { engine, p, extra } = workbench(t, [
    tilted,
    transform('placed', 'wedge', { move: [40, 0, 0] }),
  ]);
  const parts = engine.build(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(
    parts.map(({ id, role }) => [id, role]),
    [
      ['body', 'body'],
      ['wedge', 'addition'],
    ],
  );
  const expectedWedge = (10 * 18 * 18) / 2;
  close(parts[1].volume, expectedWedge);
  close(parts[1].bounds.min[0], 40);
  close(extra().volume(), expectedWedge);
  const base = parseSTL(wasm, engine.export({ mode: 'base' }));
  const wedge = parseSTL(wasm, engine.export({ mode: 'part', id: 'wedge' }));
  t.after(() => {
    base.delete();
    wedge.delete();
  });
  close(base.volume(), 6000);
  close(base.boundingBox().max[2], 30);
  close(wedge.volume(), expectedWedge);
});

test('a pulled face can be kept as a separate printable part and reopened from a saved project', (t) => {
  const { engine, p } = workbench(t, []);
  const [body] = engine.build(p);
  const indices = body.indices,
    positions = body.positions;
  let triangle = 0;
  while (
    triangle < indices.length / 3 &&
    ![0, 1, 2].every((j) => positions[3 * indices[triangle * 3 + j] + 2] === 30)
  )
    triangle++;
  const { origin, u, v, normal, loops } = engine.pick({
    id: body.id,
    triangle,
    tolerance: 1,
  });
  p.editor.ops.push({
    id: 'cap',
    target: body.id,
    type: 'add',
    profileKind: 'face',
    frame: { origin, u, v, normal },
    loops,
    depth: 3,
    separate: true,
  });
  const parts = engine.build(JSON.parse(JSON.stringify(p)));
  close(parts[0].bounds.max[2], 30);
  close(parts[0].volume, 6000);
  assert.equal(parts[1].id, 'cap');
  assert.equal(parts[1].role, 'addition');
  const cap = parseSTL(wasm, engine.export({ mode: 'part', id: 'cap' }));
  t.after(() => cap.delete());
  close(cap.boundingBox().min[2], 30);
  close(cap.boundingBox().max[2], 33);
  close(cap.volume(), 600);
});

test('successful and failed live previews preserve the committed mesh for face selection and export', (t) => {
  const { engine, p } = workbench(t, []);
  const acceptedBytes = engine.export({ mode: 'part', id: 'body' });
  const pick = () => engine.pick({ id: 'body', triangle: 0, tolerance: 1 });
  const acceptedFace = pick();
  const decode = t.mock.method(globalThis, 'atob');
  const trial = structuredClone(p);
  trial.editor.ops = [
    add(true),
    transform('moved', 'body', { move: [100, 0, 0] }),
  ];
  const preview = engine.preview(trial);
  assert.equal(
    decode.mock.callCount(),
    0,
    'the original STL stayed in memory across the live edit',
  );
  assert.equal(preview.length, 2);
  close(preview[0].bounds.min[0], 100);
  assert.ok(preview[0].positions.length && preview[1].indices.length);
  assert.deepEqual(pick(), acceptedFace);
  assert.deepEqual(engine.export({ mode: 'part', id: 'body' }), acceptedBytes);
  assert.throws(
    () => engine.export({ mode: 'part', id: 'badge' }),
    /Select a part/,
  );
  trial.editor.ops[0].depth = -1;
  assert.throws(() => engine.preview(trial), /positive depth/);
  trial.editor.ops = [{ ...add(), offset: [300, 300] }];
  assert.throws(() => engine.preview(trial), /misses the model/);
  assert.deepEqual(pick(), acceptedFace);
  assert.deepEqual(engine.export({ mode: 'part', id: 'body' }), acceptedBytes);
});

test('joined additions follow the same matrix and pivot as their stock through a transform', (t) => {
  const { extra } = workbench(t, [
    add(),
    transform('scale', 'body', {
      move: [48, 2, 0],
      rotate: [0, 0, 90],
      scale: 2,
    }),
  ]);
  const addition = extra(),
    bounds = addition.boundingBox();
  close(addition.volume(), 32 * 8);
  close(bounds.min[2], 44);
  close(bounds.max[2], 48);
});

test('arbitrary-angle transforms keep empty cut-only differences empty and leave a single printable addition', (t) => {
  const spin = transform('spin', 'body', {
    move: [3, 7, 11],
    rotate: [5, 23.4, 66.8],
    scale: 1.333,
  });
  const { engine } = workbench(t, [{ ...add(), type: 'cut' }, spin]);
  assert.throws(
    () => engine.export({ mode: 'additions' }),
    /no added material/,
  );
  const { extra } = workbench(t, [add(), spin]);
  const badge = extra(),
    shells = badge.decompose();
  try {
    assert.equal(shells.length, 1);
    close(badge.volume(), 32 * 1.333 ** 3, 0.001);
  } finally {
    shells.forEach((s) => s.delete());
  }
});

test('separate additions are preserved after moving and reorienting their base', (t) => {
  const { extra } = workbench(t, [
    add(true),
    transform('m', 'body', { layFlat: [1, 0, 0], move: [70, 0, 0] }),
    transform('m2', 'badge', { move: [30, 0, 0] }),
  ]);
  const addition = extra();
  close(addition.volume(), 32);
  close(addition.boundingBox().min[0], 33);
  close(addition.boundingBox().min[2], 30);
});

test('split children carry their own reference coordinates when moved or duplicated', (t) => {
  const { extra } = workbench(t, [
    add(),
    {
      id: 'high',
      target: 'body',
      type: 'split',
      axis: 'x',
      position: 5,
      keep: 'both',
    },
    transform('m', 'high', { move: [100, 0, 0] }),
    { id: 'copy', target: 'body', type: 'duplicate', move: [-100, 0, 0] },
  ]);
  const addition = extra();
  close(addition.volume(), 48);
  close(addition.boundingBox().min[0], -97);
  close(addition.boundingBox().max[0], 107);
});

test('lay flat aligns the chosen outward normal downward, grounds the part, and leaves an unrelated base out of additions', (t) => {
  const { engine, p, extra } = workbench(t, [
    add(),
    transform('flat', 'body', { layFlat: [1, 0, 0] }),
  ]);
  const part = parseSTL(wasm, engine.export({ mode: 'part', id: 'body' }));
  t.after(() => part.delete());
  const b = part.boundingBox();
  close(b.min[2], 0);
  close(b.max[2], 10);
  close(b.max[0] - b.min[0], 32);
  const addition = extra();
  close(addition.volume(), 32);
  close(addition.boundingBox().max[0], b.max[0]);
  const edited = structuredClone(p);
  edited.editor.ops.at(-1).layFlat = [0, 0, 0];
  assert.throws(() => engine.build(edited), /normal/);
  close(extra().volume(), 32);
});

test('applying steps one at a time continues from the committed result and matches a full replay', (t) => {
  const steps = [
    add(),
    { id: 'high', target: 'body', type: 'split', axis: 'x', position: 5, keep: 'both' },
    transform('m', 'high', { move: [100, 0, 0] }),
    { id: 'copy', target: 'body', type: 'duplicate', move: [-100, 0, 0] },
    { ...add(true), id: 'badge-2', frame: { ...add().frame, origin: [2.5, 10, 30] } },
  ];
  const { engine, p, extra } = workbench(t, []);
  // The worker always receives copies; build from one as the app does.
  engine.build(structuredClone(p));
  const decode = t.mock.method(globalThis, 'atob');
  let previewed;
  for (const step of steps) {
    const trial = structuredClone(p);
    trial.editor.ops.push(step);
    previewed = engine.preview(trial);
    p.editor.ops.push(step);
    engine.build(structuredClone(p));
  }
  assert.equal(decode.mock.callCount(), 0, 'the source STL was not read again');
  // Each preview continued from the applied steps, and each Apply adopted it.
  assert.equal(engine.buildStats().resumed, steps.length);
  assert.equal(engine.buildStats().adopted, steps.length);
  const fresh = workbench(t, structuredClone(steps));
  const summary = (parts) =>
    parts.map((x) => [x.id, x.name, x.role, Math.round(x.volume * 1000), x.positions.length]);
  assert.deepEqual(summary(previewed), summary(fresh.engine.preview(fresh.p)));
  close(extra().volume(), fresh.extra().volume());
  assert.deepEqual(
    engine.export({ mode: 'assembly' }),
    fresh.engine.export({ mode: 'assembly' }),
  );
  // A failing next step leaves the committed result whole.
  const bytes = engine.export({ mode: 'assembly' });
  const bad = structuredClone(p);
  bad.editor.ops.push({ ...add(), id: 'missed', offset: [300, 300] });
  assert.throws(() => engine.preview(bad), /misses the model/);
  assert.deepEqual(engine.export({ mode: 'assembly' }), bytes);
  // Switching a step off replays the history in full.
  const off = structuredClone(p);
  off.editor.off = ['copy'];
  assert.equal(engine.build(off).length, summary(previewed).length - 1);
});

test('Apply adopts the live preview of the same project and builds anything else afresh', (t) => {
  const { engine, p } = workbench(t, []);
  engine.build(structuredClone(p));
  const withBadge = structuredClone(p);
  withBadge.editor.ops = [add()];
  const moved = structuredClone(p);
  moved.editor.ops = [transform('moved', 'body', { move: [100, 0, 0] })];
  engine.preview(structuredClone(withBadge));
  engine.preview(structuredClone(moved));
  // Not the last preview: built again.
  engine.build(structuredClone(withBadge));
  assert.equal(engine.buildStats().adopted, 0);
  const fresh = workbench(t, [add()]);
  assert.deepEqual(engine.export({ mode: 'assembly' }), fresh.engine.export({ mode: 'assembly' }));
  // The last preview: adopted, and the result is the same as building it.
  const both = structuredClone(withBadge);
  both.editor.ops.push(transform('moved', 'body', { move: [100, 0, 0] }));
  const previewed = engine.preview(structuredClone(both));
  const applied = engine.build(structuredClone(both));
  assert.equal(engine.buildStats().adopted, 1);
  assert.deepEqual(applied.map((x) => x.bounds), previewed.map((x) => x.bounds));
  const reference = workbench(t, structuredClone(both.editor.ops));
  assert.deepEqual(engine.export({ mode: 'assembly' }), reference.engine.export({ mode: 'assembly' }));
  // Track Set: Apply after previewing the same piece adopts it as well.
  const track = newProject();
  engine.build(track);
  const longer = structuredClone(track);
  longer.track.params.radius += 20;
  engine.preview(structuredClone(longer));
  const before = engine.buildStats().adopted;
  engine.build(structuredClone(longer));
  assert.equal(engine.buildStats().adopted, before + 1);
  const trackEngine = createEngine(wasm);
  t.after(() => trackEngine.dispose());
  trackEngine.build(structuredClone(longer));
  assert.deepEqual(engine.export({ mode: 'assembly' }), trackEngine.export({ mode: 'assembly' }));
});
