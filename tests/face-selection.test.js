import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import {
  composeFaceSelection,
  faceProfiles,
  matchesSavedFaceOutline,
  planFaceHeights,
  updateFaceSelection,
  validateFaceProfiles,
} from '../src/face-selection.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { createEngine } from '../src/engine.js';
import { checkProject, newProject, toBase64 } from '../src/project.js';
import { SolidWorkshop } from '../src/geometry/solids.js';

const square = (r) => [
  [-r, -r],
  [r, -r],
  [r, r],
  [-r, r],
];
const face = (id, x) => ({
  partId: 'body',
  origin: [x, 0, 16],
  u: [1, 0, 0],
  v: [0, 1, 0],
  normal: [0, 0, 1],
  planar: true,
  loops: [square(2), square(1)],
  triangleIndices: [id],
});

test('shift toggles a coplanar selection, preserves holes and reconciles independently oriented frames', () => {
  const a = face(7, -8),
    b = face(11, 12);
  // In the second frame, increasing local X moves toward global Y.
  b.u = [0, 1, 0];
  b.v = [-1, 0, 0];
  const selected = updateFaceSelection([a], b, true);
  const combined = composeFaceSelection(selected);
  assert.equal(combined.faceCount, 2);
  assert.deepEqual(combined.triangleIndices, [7, 11]);
  assert.deepEqual(combined.loops[2][0], [22, -2]);
  assert.deepEqual(combined.loops[3][0], [21, -1]);
  assert.deepEqual(updateFaceSelection(selected, { ...a }, true), [b]);
  assert.deepEqual(updateFaceSelection([b], b, true), []);
  assert.equal(composeFaceSelection([]), null);
  assert.deepEqual(updateFaceSelection(selected, b, false), [b]);
  const saved = combined.loops
    .map((loop) => [...loop.slice(1), loop[0]].reverse())
    .reverse();
  assert.ok(matchesSavedFaceOutline(composeFaceSelection([b, a]), a, saved));
  assert.equal(
    matchesSavedFaceOutline(
      composeFaceSelection([a, { ...b, origin: [13, 0, 16] }]),
      a,
      saved,
    ),
    false,
  );
  assert.equal(
    matchesSavedFaceOutline({ ...combined, origin: [-8, 0, 18] }, a, saved),
    false,
  );
});

test('sloped faces, opposing normals, mixed parts, and overlapping post/parent outlines give an actionable error', () => {
  const a = face(7, 0),
    b = face(90, 12);
  const slope = 0.001;
  assert.throws(
    () => updateFaceSelection([a], {
      ...b,
      u: [Math.cos(slope), 0, -Math.sin(slope)],
      normal: [Math.sin(slope), 0, Math.cos(slope)],
    }, true),
    /parallel planes/,
  );
  assert.throws(
    () => updateFaceSelection([a], { ...b, normal: [0, 0, -1] }, true),
    /same direction/,
  );
  assert.throws(
    () => updateFaceSelection([a], { ...b, partId: 'other' }, true),
    /same part/,
  );
  assert.throws(
    () => updateFaceSelection([a], { ...b, planar: false }, true),
    /flat faces/,
  );
  const post = {
    ...a,
    feature: 'post',
    featureKey: 'bore one',
    sourceFaceKey: 7,
    triangleIndices: [],
  };
  assert.throws(() => updateFaceSelection([a], post, true), /whole face/);
  assert.throws(() => updateFaceSelection([post], a, true), /whole face/);
  const other = { ...post, featureKey: 'bore two', origin: [0.5, 0, 16] };
  assert.throws(() => updateFaceSelection([post], other, true), /overlap/);
  assert.deepEqual(
    updateFaceSelection([post], { ...other, origin: [9, 0, 16] }, true).length,
    2,
  );
});

test('grouped levels preserve independent planes, bores, and historical face links', () => {
  const a = face(7, -8);
  const b = {
    ...face(11, 12),
    origin: [12, 0, 20],
    u: [0, 1, 0],
    v: [-1, 0, 0],
  };
  const selected = updateFaceSelection([a], b, true);
  const combined = composeFaceSelection(selected);
  assert.equal(combined.coplanar, false);
  assert.equal(combined.loops.length, 0);
  const profiles = faceProfiles(combined);
  assert.equal(faceProfiles(combined), profiles);
  assert.deepEqual(profiles[1].frame, { origin: b.origin, u: a.u, v: a.v, normal: a.normal });
  assert.deepEqual(profiles[1].loops.map((loop) => loop[0]), [[2, -2], [1, -1]]);
  for (const [i, profile] of profiles.entries())
    assert.ok(matchesSavedFaceOutline(selected[i], profile.frame, profile.loops));
  assert.equal(matchesSavedFaceOutline({ ...b, origin: [12, 0, 16] }, profiles[1].frame, profiles[1].loops), false);
  assert.equal(matchesSavedFaceOutline(combined, a, a.loops), false);
  assert.doesNotThrow(() => validateFaceProfiles(profiles));
  assert.deepEqual(updateFaceSelection(selected, a, true), [b]);
});

test('stacked footprints cannot shadow each other, with room for independent faces inside a bore', () => {
  const lower = face(1, 0);
  const upper = { ...face(2, 0), origin: [0, 0, 19] };
  for (const loops of [[square(2)], [square(1.5)], [square(1)]]) {
    const region = { ...upper, loops };
    assert.throws(() => updateFaceSelection([lower], region, true), /overlap/);
    const profiles = [lower, region].flatMap(faceProfiles);
    assert.throws(() => validateFaceProfiles(profiles), /overlap/);
  }
  const centre = { ...upper, loops: [square(0.5)] };
  assert.equal(updateFaceSelection([lower], centre, true).length, 2);
  const profiles = [lower, centre].flatMap(faceProfiles);
  assert.doesNotThrow(() => validateFaceProfiles(profiles));
  assert.throws(() => validateFaceProfiles([profiles[0], {
    ...profiles[1], frame: { ...profiles[1].frame, normal: [0, 0, -1] },
  }]), /surface frame/);
  assert.throws(() => validateFaceProfiles([profiles[0], {
    ...profiles[1], frame: { ...profiles[1].frame, normal: [0, 0, -1], v: [0, -1, 0] },
  }]), /same direction/);
});

test('offset and finished height start from each selected face and the part base', () => {
  const positions = Float32Array.from([0, 0, 5, 20, 20, 23]);
  const profiles = [10, 12, 14, 16].map((height, id) =>
    faceProfiles({ ...face(id, 10 * id), origin: [10 * id, 0, height + 5] })[0]);
  const plan = (mode, value) => planFaceHeights(positions, profiles, mode, value);
  const offset = plan('offset', -2);
  assert.equal(offset.valid, true);
  assert.deepEqual(offset.changes.map((c) => c.end), [8, 10, 12, 14]);
  const level = plan('height', 12);
  assert.equal(level.valid, true);
  assert.deepEqual(level.changes.map((c) => c.delta), [2, 0, -2, -4]);
  assert.deepEqual(level.changes.map((c) => c.end), [12, 12, 12, 12]);
  assert.equal(plan('height', 0).valid, true);
  assert.match(plan('offset', -11).issue, /past the part base/);
  assert.match(plan('offset', 0).issue, /nonzero/);
  assert.match(planFaceHeights(positions, [profiles[0]], 'height', 10).issue, /already/);
  assert.deepEqual(plan('height', NaN).changes.map((c) => c.start), [10, 12, 14, 16]);
});

test('oblique face heights use actual vertex projections, including property-strided kernel meshes', () => {
  const positions = Float32Array.from([-1, 0, 0, -100, 0, -1, 0, 500, 1, 1, 0, -999]);
  const n = Math.SQRT1_2;
  const frame = { origin: [1, 1, 0], normal: [n, n, 0], u: [0, 0, 1], v: [n, -n, 0] };
  const result = planFaceHeights(positions, [{ frame, loops: [square(1)] }], 'height', 1, 4);
  assert.ok(result.valid);
  assert.ok(Math.abs(result.min + n) < 1e-12);
  assert.ok(Math.abs(result.changes[0].start - 3 * n) < 1e-12);
  assert.ok(Math.abs(result.changes[0].delta - (1 - 3 * n)) < 1e-12);
});

const wasm = await init();
wasm.setup();
const centres = [
  [10, 10],
  [30, 10],
  [10, 30],
  [30, 30],
];

function makeProject(t) {
  const w = new SolidWorkshop(wasm);
  t.after(() => w.close());
  const outside = w.own(wasm.Manifold.cube([40, 40, 16]));
  const cavity = w.own(wasm.Manifold.cube([36, 36, 16]));
  const tray = w.own(outside.subtract(w.own(cavity.translate([2, 2, 2]))));
  const cylinder = w.own(wasm.Manifold.cylinder(14, 4, 4, 32));
  const drill = w.own(wasm.Manifold.cylinder(14, 1.5, 1.5, 32));
  const post = w.own(cylinder.subtract(drill));
  const body = w.union([
    tray,
    ...centres.map(([x, y]) => w.own(post.translate([x, y, 2]))),
  ]);
  const project = newProject();
  project.mode = 'editor';
  project.editor.source = {
    label: 'Four separate screw-post tops',
    data: toBase64(encodeSTL(body)),
  };
  return { project, w };
}

function topTriangle(mesh, x, y) {
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const corners = [0, 1, 2].map((j) =>
      mesh.positions.slice(
        mesh.indices[i + j] * 3,
        mesh.indices[i + j] * 3 + 3,
      ),
    );
    if (
      corners.every(
        (p) =>
          Math.abs(p[2] - 16) < 1e-5 && Math.hypot(p[0] - x, p[1] - y) < 4.001,
      )
    )
      return {
        triangle: i / 3,
        point: [0, 1, 2].map((k) => corners.reduce((n, p) => n + p[k] / 3, 0)),
      };
  }
  throw new Error('Post top is missing from test fixture');
}

test('four real disconnected STL post tops form a single local edit, preserve bores and wall, and replay in history and exports', (t) => {
  const { project, w } = makeProject(t);
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const [mesh] = engine.build(project);
  const refs = centres.map(([x, y]) => topTriangle(mesh, x, y));
  let selection = [];
  for (const ref of refs) {
    const region = engine.pick({
      id: 'body',
      triangle: ref.triangle,
      tolerance: 8,
    });
    assert.equal(region.loops.length, 2);
    selection = updateFaceSelection(
      selection,
      { ...region, partId: 'body' },
      true,
    );
  }
  const combined = composeFaceSelection(selection);
  const { u, v, origin, normal } = combined;
  const op = {
    type: 'cut',
    tool: 'move-face',
    profileKind: 'face',
    id: 'shorten-posts',
    target: 'body',
    frame: { u, v, origin, normal },
    loops: combined.loops,
    depth: 2,
    faceCount: 4,
    faceRefs: refs.map((ref) => ({ ...ref, whole: true, tolerance: 8 })),
  };
  project.editor.ops = [op];
  const saved = checkProject(JSON.parse(JSON.stringify(project)));
  assert.equal(saved.editor.ops.length, 1);
  const topAt = (solid, x, y) =>
    solid.rayCast([x, y, 25], [x, y, -1])[0].position[2];
  engine.build(saved);
  const cut = w.own(
    parseSTL(wasm, engine.export({ mode: 'part', id: 'body' })),
  );
  for (const [x, y] of centres) {
    assert.equal(topAt(cut, x + 3, y), 14);
    assert.equal(topAt(cut, x, y), 2);
  }
  assert.equal(topAt(cut, 1, 20), 16);
  assert.throws(
    () => engine.export({ mode: 'additions' }),
    /no added material/,
  );
  const src = engine.historySource('shorten-posts')[0];
  assert.equal(src.bounds.max[2], 16);
  saved.editor.ops[0].depth = 3;
  engine.build(saved);
  const deeper = w.own(
    parseSTL(wasm, engine.export({ mode: 'part', id: 'body' })),
  );
  for (const [x, y] of centres) assert.equal(topAt(deeper, x + 3, y), 13);

  saved.editor.ops[0] = { ...op, type: 'add', separate: true };
  assert.equal(engine.build(saved).length, 2);
  const addition = w.own(parseSTL(wasm, engine.export({ mode: 'additions' })));
  const pieces = addition.decompose();
  assert.equal(pieces.length, 4);
  for (const piece of pieces) {
    w.own(piece);
    assert.equal(piece.boundingBox().min[2], 16);
  }
  for (const [x, y] of centres) {
    assert.equal(topAt(addition, x + 3, y), 18);
    assert.equal(addition.rayCast([x, y, 25], [x, y, -1]).length, 0);
  }
  saved.editor.ops[0] = { ...op, type: 'add', separate: false };
  assert.equal(engine.build(saved).length, 1);
  const joinedExtra = w.own(
    parseSTL(wasm, engine.export({ mode: 'additions' })),
  );
  assert.equal(joinedExtra.boundingBox().min[2], 16);
  assert.ok(Math.abs(joinedExtra.volume() - addition.volume()) < 1e-5);
  const invalidRefs = [
    [],
    [{ triangle: 0, point: [0, NaN, 1] }],
    [{ triangle: -1, point: [0, 0, 0] }],
    [{ triangle: 0, point: [0, 0, 0], whole: 'yes' }],
  ];
  for (const faceRefs of invalidRefs) {
    saved.editor.ops = [{ ...op, faceCount: faceRefs.length, faceRefs }];
    assert.throws(() => checkProject(saved), /selected faces|face selection/);
  }
});
