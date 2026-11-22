import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import {
  applyEdit,
  encodeSTL,
  parseSTL,
  surfaceRegion,
} from '../src/editor.js';
import { createEngine } from '../src/engine.js';
import { newProject, checkProject, toBase64 } from '../src/project.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { traceGlyphs, textOutline } from '../src/text-outline.js';

const wasm = await init();
wasm.setup();
const normal = [0, 0, 1],
  u = [1, 0, 0],
  v = [0, 1, 0];
const frame = { origin: [0, 0, 10], normal, u, v };
const rect = (w, h) => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];
const near = (v, w, t = 1e-4) => assert.ok(Math.abs(v - w) < t, v + ' vs ' + w);
function verifySeparate(work, bytes, stockVolume, op, expected) {
  const p = newProject();
  p.mode = 'editor';
  p.editor.source = { label: 'Stock', data: toBase64(bytes) };
  p.editor.ops = [{ ...op, id: 'letters', target: 'body', separate: true }];
  const engine = createEngine(wasm);
  try {
    const [base, letters] = engine.build(
      checkProject(JSON.parse(JSON.stringify(p))),
    );
    near(base.volume, stockVolume, 0.01);
    near(letters.volume, expected, 0.01);
    assert.equal(letters.role, 'addition');
    for (const args of [{ mode: 'part', id: 'letters' }, { mode: 'additions' }])
      near(
        work.own(parseSTL(wasm, engine.export(args))).volume(),
        expected,
        0.01,
      );
    assert.throws(
      () =>
        checkProject({
          ...p,
          editor: { ...p.editor, ops: [{ ...p.editor.ops[0], type: 'cut' }] },
        }),
      /text edit/,
    );
  } finally {
    engine.dispose();
  }
}
function stock(t) {
  const work = new SolidWorkshop(wasm);
  const box = work.own(
    work.own(wasm.Manifold.cube([30, 20, 10])).translate([-15, -10, 0]),
  );
  t.after(() => work.close());
  return { work, box };
}
test('hollow opens only the selected component, preserves measured wall and floor thickness across an STL round trip', (t) => {
  const { work, box } = stock(t);
  const other = work.own(box.translate([50, 0, 0]));
  const source = work.union([box, other]);
  const hollow = { type: 'hollow', frame, loops: [rect(30, 20)], thickness: 2 };
  const result = work.own(applyEdit(wasm, source, hollow));
  const printed = work.own(parseSTL(wasm, encodeSTL(result)));
  near(printed.volume(), 12000 - 26 * 16 * 8);
  const hits = (a, b, k) => printed.rayCast(a, b).map((h) => h.position[k]);
  near(hits([0, 0, 16], [0, 0, -2], 2)[0], 2);
  near(hits([0, 0, 7], [20, 0, 7], 0)[0], 13);
  near(hits([50, 0, 16], [50, 0, -2], 2)[0], 10);
  assert.throws(
    () => applyEdit(wasm, source, { ...hollow, thickness: 15 }),
    /opening|cavity/,
  );
});
test('a convex shell follows sloping facets and keeps its mouth open after export', (t) => {
  const { work } = stock(t);
  const sphere = work.own(wasm.Manifold.sphere(24, 64));
  const source = work.own(sphere.trimByPlane([0, 0, -1], -8));
  const mesh = source.getMesh();
  const seed = mesh.triVerts.findIndex(
    (_, i, ids) =>
      i % 3 === 0 &&
      [0, 1, 2].every(
        (j) =>
          Math.abs(mesh.vertProperties[ids[i + j] * mesh.numProp + 2] - 8) <
          1e-5,
      ),
  );
  assert.ok(seed >= 0);
  const face = surfaceRegion(source, seed / 3, 1);
  const shell = work.own(
    applyEdit(wasm, source, {
      type: 'hollow',
      frame: face,
      loops: face.loops,
      thickness: 2,
    }),
  );
  const printed = work.own(parseSTL(wasm, encodeSTL(shell)));
  const hits = printed.rayCast([0, 0, 14], [0, 0, -30]);
  assert.equal(hits.length, 2);
  near(hits[0].position[2], -22, 0.02);
  near(hits[1].position[2], -24, 0.001);
  const side = printed.rayCast([0, 0, 0], [30, 0, 0]);
  near(side[1].position[0] - side[0].position[0], 2, 0.02);
});
test('deviation-bounded simplification reduces imported mesh triangles, honours target, and reopens in project history', (t) => {
  const { work } = stock(t),
    engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const source = work.own(wasm.Manifold.sphere(20, 72));
  const p = newProject();
  p.mode = 'editor';
  p.editor.source = { label: 'Sphere', data: toBase64(encodeSTL(source)) };
  p.editor.ops = [
    {
      type: 'simplify',
      id: 's',
      target: 'body',
      deviation: 1,
      triangleTarget: 1400,
    },
  ];
  const [mesh] = engine.build(checkProject(JSON.parse(JSON.stringify(p))));
  assert.ok(mesh.indices.length / 3 <= 1400);
  const restored = work.own(
    parseSTL(wasm, engine.export({ mode: 'part', id: 'body' })),
  );
  assert.equal(restored.numTri(), mesh.indices.length / 3);
  near(restored.boundingBox().max[0], 20, 1);
  assert.throws(
    () =>
      engine.preview({
        ...p,
        editor: {
          ...p.editor,
          ops: [{ ...p.editor.ops[0], deviation: 0.001, triangleTarget: 12 }],
        },
      }),
    /target|deviation/i,
  );
  assert.throws(
    () =>
      checkProject({
        ...p,
        editor: { ...p.editor, ops: [{ ...p.editor.ops[0], deviation: 0 }] },
      }),
    /deviation/,
  );
});
test('raised and engraved contours preserve counters, depth, and side-by-side glyphs', (t) => {
  const { work, box } = stock(t);
  const outer = rect(6, 6),
    inner = rect(3, 3),
    stem = rect(1, 6).map(([x, y]) => [x + 5, y]);
  const op = {
    type: 'add',
    tool: 'text',
    profileKind: 'text',
    text: 'OI',
    textHeight: 6,
    depth: 1.5,
    loops: [outer, inner, stem],
    frame,
  };
  for (const type of ['add', 'cut']) {
    const result = work.own(applyEdit(wasm, box, { ...op, type }));
    const printed = work.own(parseSTL(wasm, encodeSTL(result)));
    const top = (x, y) =>
      printed.rayCast([x, y, 16], [x, y, -3])[0].position[2];
    near(top(0, 0), 10);
    near(top(2.5, 0), type === 'add' ? 11.5 : 8.5);
    near(top(5, 0), type === 'add' ? 11.5 : 8.5);
    assert.equal(printed.decompose().map((s) => work.own(s)).length, 1);
  }
  assert.throws(() => applyEdit(wasm, box, { ...op, offset: [20, 0] }), /fit/);
  verifySeparate(work, encodeSTL(box), box.volume(), op, (36 - 9 + 6) * 1.5);
});
test('curved lettering follows visible facets, attaching every stroke to a cylinder', (t) => {
  const { work } = stock(t);
  const bytes = encodeSTL(work.own(wasm.Manifold.cylinder(12, 20, 20, 64)));
  const solid = work.own(parseSTL(wasm, bytes));
  const m = solid.getMesh();
  let face, triangle;
  for (let i = 0; i < m.triVerts.length; i += 3) {
    const vertices = Array.from(m.triVerts.subarray(i, i + 3), (id) =>
      Array.from(m.vertProperties.subarray(id * m.numProp, id * m.numProp + 3)),
    );
    if (
      vertices.some((p) => p[0] < 19.85) ||
      vertices.every((p) => p[2] === vertices[0][2])
    )
      continue;
    triangle = i / 3;
    face = surfaceRegion(solid, triangle, 10);
    break;
  }
  assert.ok(face && !face.planar);
  const { origin, normal, u, v } = face;
  const op = {
    type: 'add',
    tool: 'text',
    profileKind: 'text',
    text: 'O',
    textHeight: 6,
    depth: 1,
    loops: [rect(8, 6), rect(5, 2)],
    frame: { origin, normal, u, v },
    textPatch: { triangle, point: origin, tolerance: 10 },
  };
  const result = work.own(applyEdit(wasm, solid, op));
  const printed = work.own(parseSTL(wasm, encodeSTL(result)));
  near(printed.volume() - solid.volume(), 8 * 6 - 5 * 2, 0.003);
  const cut = work.own(applyEdit(wasm, solid, { ...op, type: 'cut' }));
  near(solid.volume() - cut.volume(), 38, 0.003);
  verifySeparate(work, bytes, solid.volume(), op, 38);
});
test('letter contours keep counters and disconnected accents and reuse saved shapes across platforms', () => {
  const width = 15,
    height = 13,
    alpha = new Uint8Array(width * height);
  for (let y = 2; y < 11; y++)
    for (let x = 2; x < 10; x++)
      if (x < 4 || x > 7 || y < 4 || y > 8) alpha[y * width + x] = 255;
  alpha[3 * width + 12] = 255;
  const loops = traceGlyphs(alpha, width, height);
  assert.equal(loops.length, 3);
  const saved = { text: 'Ö', textHeight: 3, loops };
  assert.equal(textOutline('Ö', 3, saved), loops);
  assert.deepEqual(
    textOutline('Ö', 6, saved)[0][0],
    loops[0][0].map((v) => 2 * v),
  );
});
