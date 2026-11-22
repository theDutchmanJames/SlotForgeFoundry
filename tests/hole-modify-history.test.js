import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { Triangle, Vector3 } from 'three';
import { createEngine } from '../src/engine.js';
import { parseSTL } from '../src/editor.js';
import { newProject } from '../src/project.js';

const wasm = await init();
wasm.setup();
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.002, a + ' vs ' + b);
const move = (id, delta) => ({
  id,
  type: 'transform',
  target: 'body',
  scale: 1,
  rotate: [0, 0, 0],
  move: delta,
});
function pickAtTop(engine, part, point, historyId) {
  // Reconstruct the viewport hit on the exact part delivered by the engine.
  const hit = new Vector3(...point);
  const vertex = (i) =>
    new Vector3().fromArray(part.positions, 3 * part.indices[i]);
  for (let i = 0; i < part.indices.length; i += 3) {
    const face = [vertex(i), vertex(i + 1), vertex(i + 2)];
    if (
      face.every((p) => Math.abs(p.z - hit.z) < 1e-4) &&
      Triangle.containsPoint(hit, ...face)
    ) {
      const query = {
        id: 'body',
        historyId,
        triangle: i / 3,
        point,
        tolerance: 0.2,
      };
      return { query, edge: engine.pickEdge(query) };
    }
  }
  assert.fail('No top triangle under the rim pick.');
}

test('history restores all four countersink rims on a translated input and picks separately from the committed assembly', (t) => {
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const project = newProject();
  project.mode = 'editor';
  const [original] = engine.build(project);
  const centers = [
    [-36.6, -22.6, 16],
    [36.6, -22.6, 16],
    [-36.6, 22.6, 16],
    [36.6, 22.6, 16],
  ];
  const rims = centers.map(
    ([x, y, z]) => pickAtTop(engine, original, [x + 1.76, y + 0.02, z]).edge,
  );
  assert.ok(rims.every((r) => r?.circle?.outward === -1));
  const countersink = {
    id: 'sinks',
    target: 'body',
    type: 'modifyHoles',
    kind: 'countersink',
    rims,
    headDiameter: 6,
    headAngle: 90,
  };
  engine.build({
    ...project,
    editor: { ...project.editor, ops: [countersink] },
  });
  engine.historySource(countersink.id);
  const shift = [24, 9, 7],
    after = [100, 0, 0];
  const revised = structuredClone(project);
  revised.editor.ops = [
    move('upstream', shift),
    countersink,
    move('downstream', after),
  ];
  engine.build(revised);
  const [input] = engine.historySource(countersink.id);
  const restored = engine.restoredEdges({
    id: 'body',
    historyId: countersink.id,
    edges: rims,
  });
  assert.equal(restored.length, 4);
  const exported = parseSTL(wasm, engine.export({ mode: 'part', id: 'body' }));
  t.after(() => exported.delete());
  for (const [i, originalCenter] of centers.entries()) {
    const moved = originalCenter.map((v, j) => v + shift[j]);
    restored[i].circle.center.forEach((v, j) => near(v, moved[j]));
    near(restored[i].circle.radius, 1.7);
    const [x, y, z] = moved;
    const { query, edge } = pickAtTop(
      engine,
      input,
      [x + 1.76, y + 0.02, z],
      countersink.id,
    );
    edge.circle.center.forEach((v, j) => near(v, moved[j]));
    assert.equal(engine.pickEdge({ ...query, historyId: undefined }), null);
    const seat = exported.rayCast(
      [x + after[0] + 2.5, y, z + 3],
      [x + after[0] + 2.5, y, z - 2],
    )[0];
    near(seat.position[2], z - 0.5);
  }
});
