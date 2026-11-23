import test from 'node:test';
import assert from 'node:assert/strict';
import initManifold from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { encodeSTL } from '../src/editor.js';
import {
  newProject,
  checkProject,
  fromBase64,
  toBase64,
} from '../src/project.js';
import { validateTrack } from '../src/track.js';

const duplicate = (id, target = 'body') => ({
  type: 'duplicate',
  target,
  id,
  move: [3, 0, 0],
});

test('opening an old track selects a current clip while keeping the provenance of an embedded STL', () => {
  const project = newProject();
  project.editor.source.clipType = 'slotforge';
  project.track.params.clipType = 'slotforge';
  const reopened = checkProject(project);
  assert.equal(reopened.track.params.clipType, 'draw-key');
  assert.equal(reopened.editor.source.clipType, 'slotforge');
  assert.equal(project.track.params.clipType, 'slotforge');
  project.track.params.clipType = 'carrera';
  assert.equal(checkProject(project).track.params.clipType, 'carrera-retained');
  delete project.track.params.clipType;
  delete project.track.params.jointFitVersion;
  project.track.params.clipClearance = 0.6;
  const fit = checkProject(project).track.params;
  assert.deepEqual(
    [fit.clipType, fit.jointFitVersion, fit.tabClearance, fit.clipClearance],
    ['draw-key', 2, 0.6, 0.4],
  );
});

test('an off-centre slot position is saved with the piece and opens unchanged', () => {
  const project = newProject();
  const slotPosition = { version: 1, edge: 'outer', startMm: 35, endMm: 145 };
  Object.assign(project.track.params, {
    kind: 'straight', length: 300, width: 200, lanes: 1, borderSide: 'none', slotPosition,
  });
  const reopened = checkProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(reopened.track.params.slotPosition, slotPosition);
  validateTrack(reopened.track.params);
  // A centred piece carries no slot position at all.
  assert.equal('slotPosition' in checkProject(newProject()).track.params, false);
});

test('slot positions of several lanes are saved with the piece and open unchanged', () => {
  for (const slotPosition of [
    { version: 1, edge: 'outer', startMm: 35, endMm: 95 },
    { version: 1, edge: 'inner', lanes: [{ startMm: 35, endMm: 95 }, { startMm: 105, endMm: 165 }] },
  ]) {
    const project = newProject();
    Object.assign(project.track.params, {
      kind: 'straight', length: 300, width: 200, lanes: 2, laneSpacing: 65, borderSide: 'none', slotPosition,
    });
    const reopened = checkProject(JSON.parse(JSON.stringify(project)));
    assert.deepEqual(reopened.track.params.slotPosition, slotPosition);
    validateTrack(reopened.track.params);
  }
});

test('a fresh enclosure has a finer printed corner and saved edits keep their source mesh', async (t) => {
  const wasm = await initManifold();
  wasm.setup();
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const project = editorWith();
  delete project.editor.source.demoVersion;
  const upgraded = checkProject(project);
  assert.equal(upgraded.editor.source.demoVersion, 2);
  const legacy = {
    ...project,
    editor: { ...project.editor, ops: [duplicate('copy')] },
  };
  assert.equal(checkProject(legacy).editor.source.demoVersion, undefined);

  // Measure the first intact R5 wall chord beside the straight rail, before
  // the post meets the outer arc and changes its local radius.
  function cornerError(part) {
    const selected = new Map();
    for (let i = 0; i < part.positions.length; i += 3) {
      const dx = part.positions[i] - 36,
        dy = part.positions[i + 1] - 22;
      if (
        part.positions[i + 2] !== 16 ||
        Math.abs(Math.hypot(dx, dy) - 5) > 0.00002
      )
        continue;
      const angle = Math.atan2(dy, dx);
      if (angle >= 0 && angle < 0.3) selected.set(angle, [dx, dy]);
    }
    const [a, b] = [...selected.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, p]) => p);
    return 5 - Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  const [fine] = engine.build(upgraded);
  assert.ok(cornerError(fine) < 0.0028);
  const fineSTL = engine.export({ mode: 'part', id: 'body' });
  const [old] = engine.build(legacy);
  assert.ok(cornerError(old) > 0.023);
  const oldSTL = engine.export({ mode: 'part', id: 'body' });
  assert.notDeepEqual(oldSTL, fineSTL);
  engine.build(JSON.parse(JSON.stringify(upgraded)));
  assert.deepEqual(engine.export({ mode: 'part', id: 'body' }), fineSTL);
  engine.build(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(engine.export({ mode: 'part', id: 'body' }), oldSTL);
  assert.throws(
    () =>
      checkProject({
        ...legacy,
        editor: {
          ...legacy.editor,
          source: { label: 'Unknown example', demoVersion: 9 },
        },
      }),
    /version/,
  );
  assert.throws(
    () => checkProject(editorWith({ ...duplicate('copy'), curveVersion: 9 })),
    /version/,
  );
});
function editorWith(...ops) {
  const p = newProject();
  p.mode = 'editor';
  p.editor.ops = ops;
  return p;
}

test('portable project can contain valid edits referencing split and separated children', () => {
  const p = editorWith(
    { id: 's', type: 'separate', target: 'body' },
    duplicate('copy', 's-1'),
    {
      id: 'high',
      target: 'copy',
      type: 'split',
      axis: 'x',
      position: 5,
      keep: 'both',
    },
    duplicate('end', 'high'),
  );
  assert.deepEqual(checkProject(JSON.parse(JSON.stringify(p))), p);
  const source = Uint8Array.from({ length: 45555 }, (_, i) => i % 256);
  assert.deepEqual(fromBase64(toBase64(source)), source);
});

test('reject missing or invalid targets, ID collisions, and corrupt operations before geometry is allocated', () => {
  for (const ops of [
    [duplicate(undefined)],
    [duplicate('body')],
    [duplicate('part'), duplicate('part')],
    [duplicate('s', 'unknown')],
    [{ id: 's', target: 'body', type: 'separate' }, duplicate('s-1')],
    [{ target: 'body', type: 'unknown' }],
    [{ type: 'split', target: 'body', keep: 'nothing' }],
  ])
    assert.throws(() => checkProject(editorWith(...ops)));
  assert.throws(
    () =>
      checkProject(
        editorWith({ ...duplicate('copy'), move: [0, 3, Infinity] }),
      ),
    /finite coordinates/,
  );
});

test('reject invalid embedded profiles and plate allowances', () => {
  const p = newProject();
  p.track.plan = {
    lanes: [
      [
        [0, 0],
        [null, 7],
      ],
    ],
  };
  assert.throws(() => checkProject(p), /invalid XY/);
  p.track.plan = null;
  p.plate.margin = 100;
  assert.throws(() => checkProject(p), /usable/);
  p.plate.margin = 0;
  p.editor.ops = [
    {
      id: 'feature',
      type: 'cut',
      target: 'body',
      depth: 2,
      frame: {
        origin: [0, 0, 0],
        u: [1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, 1],
      },
      loops: [
        [
          [0, 0],
          [3, 0],
        ],
      ],
    },
  ];
  assert.throws(() => checkProject(p), /incomplete path/);
});

test('through cuts round-trip without baking in a depth and require a cut operation', () => {
  const cut = {
    id: 'hole',
    type: 'cut',
    target: 'body',
    extent: 'through',
    frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
    loops: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    ],
  };
  const p = editorWith(cut);
  assert.deepEqual(checkProject(JSON.parse(JSON.stringify(p))), p);
  assert.throws(
    () => checkProject(editorWith({ ...cut, type: 'add', depth: 2 })),
    /extent/,
  );
  assert.throws(
    () => checkProject(editorWith({ ...cut, extent: 'distance' })),
    /positive depth/,
  );
});

test('saved face tilt requires a finite angle, supported pivot and valid face boundary', () => {
  const face = {
    id: 'tilt',
    type: 'tiltFace',
    target: 'body',
    angle: 5,
    pivot: 'v-max',
    frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
    loops: [
      [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    ],
  };
  assert.equal(checkProject(editorWith(face)).editor.ops[0], face);
  const separate = editorWith(
    { ...face, separate: true, hingeRotation: 37.5, pivotOffset: -2 },
    duplicate('copy', 'tilt'),
  );
  assert.deepEqual(
    checkProject(JSON.parse(JSON.stringify(separate))),
    separate,
  );
  for (const changes of [
    { angle: NaN },
    { angle: 85 },
    { angle: -5, separate: true },
    { separate: 'yes' },
    { hingeRotation: Infinity },
    { pivotOffset: NaN },
    { pivot: 'hole' },
    {
      pivotEdge: [
        [0, 0],
        [Infinity, 0],
      ],
    },
    { id: undefined },
  ]) {
    assert.throws(() => checkProject(editorWith({ ...face, ...changes })));
  }
});

test('a shell ID collision during rebuild leaves the previous valid print model exportable', async () => {
  const wasm = await initManifold();
  wasm.setup();
  const a = wasm.Manifold.cube([2, 2, 2]);
  const b = a.translate([5, 0, 0]);
  const both = a.add(b);
  const engine = createEngine(wasm);
  try {
    const p = editorWith();
    p.editor.source.data = toBase64(encodeSTL(both));
    engine.build(p);
    const before = engine.export({ mode: 'part', id: 'body' });
    const broken = structuredClone(p);
    broken.editor.ops = [
      duplicate('blocks-1'),
      { id: 'blocks', type: 'separate', target: 'body' },
    ];
    assert.throws(() => engine.build(broken), /ID is already in use/);
    assert.deepEqual(engine.export({ mode: 'part', id: 'body' }), before);
    const valid = structuredClone(p);
    valid.editor.ops = [{ id: 'blocks', type: 'separate', target: 'body' }];
    assert.deepEqual(
      engine.build(valid).map((part) => part.id),
      ['body', 'blocks-1'],
    );
  } finally {
    engine.dispose();
    both.delete();
    b.delete();
    a.delete();
  }
});
