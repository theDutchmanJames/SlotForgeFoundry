import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { OrthographicCamera } from 'three';
import { parseSTL, encodeSTL } from '../src/editor.js';
import { readSTLMesh } from '../src/stl-mesh.js';
import { meshReviewMethods } from '../src/mesh-repair.js';
import {
  meshFromSolid,
  meshEdges,
  meshSignature,
  solidFromMesh,
} from '../src/mesh-topology.js';
import {
  applySurfaceEdit,
  faceRuns,
  growSurfaceSelection,
} from '../src/mesh-sculpt.js';
import { visibleFaceMap, brushFaces, lassoFaces } from '../src/mesh-paint.js';
import { checkProject, newProject, toBase64 } from '../src/project.js';
import { createEngine } from '../src/engine.js';

const wasm = await init();
wasm.setup();
function own(t, solid) {
  t.after(() => solid.delete());
  return solid;
}
function binary(mesh, triangles) {
  const bytes = new Uint8Array(84 + 50 * triangles.length);
  const d = new DataView(bytes.buffer);
  d.setUint32(80, triangles.length, true);
  triangles.forEach((tri, i) =>
    tri.forEach((v, j) => {
      for (let k = 0; k < 3; k++)
        d.setFloat32(
          84 + 50 * i + 12 + 12 * j + k * 4,
          mesh.positions[3 * v + k],
          true,
        );
    }),
  );
  return bytes;
}
const triangles = (mesh) =>
  Array.from({ length: mesh.indices.length / 3 }, (_, i) => [
    ...mesh.indices.subarray(3 * i, 3 * i + 3),
  ]);

test('imports damaged STL only after chosen gap and winding repairs produce a closed solid', (t) => {
  const box = own(t, wasm.Manifold.cube([10, 10, 10]));
  const mesh = readSTLMesh(encodeSTL(box));
  const tris = triangles(mesh).filter(
    (tri) => !tri.every((i) => mesh.positions[3 * i + 2] === 10),
  );
  tris[2].reverse();
  const review = meshReviewMethods(wasm),
    input = binary(mesh, tris);
  assert.equal(review.checkSTL(input), false);
  const inspection = review.inspectSTL(input);
  assert.equal(inspection.loops.length, 1);
  assert.equal(inspection.components[0].flipped, 1);
  assert.ok(review.previewSTLRepair({ winding: true }).issue);
  const choices = { fill: [0], winding: true };
  const preview = review.previewSTLRepair(choices);
  assert.equal(preview.issue, '');
  assert.equal(
    preview.changed.length,
    3,
    'One corrected triangle and two patch faces',
  );
  const healed = own(t, parseSTL(wasm, review.finishSTLRepair(choices)));
  assert.ok(Math.abs(healed.volume() - 1000) < 0.001);
  assert.equal(
    review.checkSTL(input),
    false,
    'Inspection must keep original file untouched',
  );
  review.closeSTLReview();
  assert.throws(() => review.finishSTLRepair(choices), /reopen/i);
});

test('repairing a missing annular rim leaves the through-bore open', (t) => {
  const outside = own(t, wasm.Manifold.cylinder(10, 5, 5, 24)),
    inside = own(t, wasm.Manifold.cylinder(10, 2, 2, 24));
  const pipe = own(t, outside.subtract(inside)),
    mesh = meshFromSolid(pipe);
  const damaged = binary(
    mesh,
    triangles(mesh).filter(
      (tri) => !tri.every((i) => mesh.positions[i * 3 + 2] === 10),
    ),
  );
  const review = meshReviewMethods(wasm);
  const inspected = review.inspectSTL(damaged);
  assert.equal(inspected.loops.length, 2);
  const fixed = own(
    t,
    parseSTL(wasm, review.finishSTLRepair({ fill: [0, 1] })),
  );
  assert.ok(Math.abs(fixed.volume() - pipe.volume()) < 1e-4);
  assert.deepEqual(fixed.rayCast([0, 0, 11], [0, 0, -1]), []);
});

test('separate fragments can be inspected and removed without changing the main shell', (t) => {
  const cube = own(t, wasm.Manifold.cube([8, 8, 8])),
    tiny = own(t, wasm.Manifold.cube([1, 1, 1]));
  const moved = own(t, tiny.translate([20, 0, 0])),
    both = own(t, cube.add(moved));
  const review = meshReviewMethods(wasm),
    input = encodeSTL(both);
  assert.equal(review.checkSTL(input), true);
  const { components } = review.inspectSTL(input);
  assert.equal(components.length, 2);
  const remove = components.find((c) => Math.abs(c.volume - 1) < 1e-4).id;
  const repaired = own(
    t,
    parseSTL(wasm, review.finishSTLRepair({ remove: [remove] })),
  );
  assert.equal(repaired.volume(), 512);
  assert.throws(
    () => review.finishSTLRepair({ remove: [0, 1] }),
    /all geometry/,
  );
});

test('surface grow/shrink, smoothing, project replay and upstream stale-selection checks', (t) => {
  const sphere = own(t, wasm.Manifold.sphere(10, 20)),
    asset = encodeSTL(sphere);
  const project = newProject();
  project.mode = 'editor';
  project.editor.source = { data: toBase64(asset), label: 'Scan' };
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const [original] = engine.build(project),
    { twins } = meshEdges(original.indices, original.positions.length / 3);
  const selected = growSurfaceSelection(new Set([0]), twins);
  assert.equal(selected.size, 4);
  assert.deepEqual([...growSurfaceSelection(selected, twins, true)], [0]);
  const op = {
    target: 'body',
    id: 'surface-test',
    type: 'surfaceEdit',
    method: 'smooth',
    sourceKey: meshSignature(original),
    selection: [0, original.indices.length / 3],
    iterations: 2,
    strength: 0.4,
    protectEdges: true,
  };
  project.editor.ops = [op];
  const result = engine.build(
    checkProject(JSON.parse(JSON.stringify(project))),
  )[0];
  assert.ok(result.volume < original.volume);
  assert.ok(result.volume > original.volume * 0.6);
  const exported = own(
    t,
    parseSTL(wasm, engine.export({ id: 'body', mode: 'part' })),
  );
  assert.ok(Math.abs(exported.volume() - result.volume) < 0.001);
  assert.throws(
    () =>
      engine.build({
        ...project,
        editor: { ...project.editor, ops: [{ ...op, sourceKey: '1-3-abc' }] },
      }),
    /changed/,
  );
});

test('removing a scan protrusion caps its footprint and keeps the result printable', (t) => {
  const base = own(t, wasm.Manifold.cube([10, 10, 5])),
    post = own(t, wasm.Manifold.cube([2, 2, 3]));
  const moved = own(t, post.translate([4, 4, 5])),
    body = own(t, base.add(moved)),
    mesh = meshFromSolid(body);
  const faces = triangles(mesh)
    .map((ids, i) => (ids.some((v) => mesh.positions[3 * v + 2] > 5) ? i : -1))
    .filter((i) => i >= 0);
  const op = {
    method: 'patch',
    sourceKey: meshSignature(mesh),
    selection: faceRuns(faces),
  };
  const result = own(t, applySurfaceEdit(wasm, body, op));
  assert.equal(result.status(), 'NoError');
  assert.ok(Math.abs(result.volume() - 500) < 0.0001);
  assert.equal(result.boundingBox().max[2], 5);
  assert.throws(
    () =>
      applySurfaceEdit(wasm, body, {
        ...op,
        selection: [0, mesh.indices.length / 3],
      }),
    /Leave part/,
  );
});

test('brush and lasso use the visible triangle depth on overlapping projected surfaces', () => {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const mesh = {
    positions: Float32Array.from([
      -0.9, -0.9, 0, 0.9, -0.9, 0, 0, 0.9, 0, -0.9, -0.9, 1, 0.9, -0.9, 1, 0,
      0.9, 1,
    ]),
    indices: Uint32Array.from([0, 1, 2, 3, 4, 5]),
  };
  const map = visibleFaceMap(mesh, camera, 100, 100);
  const brushed = new Set(),
    lassoed = new Set();
  brushFaces(map, 50, 50, 10, (f) => brushed.add(f));
  lassoFaces(
    map,
    [
      [25, 25],
      [75, 25],
      [75, 75],
      [25, 75],
    ],
    (f) => lassoed.add(f),
  );
  assert.deepEqual([...brushed], [1]);
  assert.deepEqual([...lassoed], [1]);
});
