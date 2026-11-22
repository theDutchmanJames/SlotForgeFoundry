import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { newProject } from '../src/project.js';
import { faceDragAxis, draggedFaceDistance } from '../src/face-handle.js';
import { orientedDimension } from '../src/resize-part.js';

test('a face handle follows its normal in side view and has a stable vertical gesture in top view', () => {
  const origin = [0, 0, 0],
    frame = { u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] };
  for (const project of [
    ([x, y]) => ({ x: 10 * x, y: -10 * y }),
    ([x, y, z]) => ({ x: 10 * x, y: -10 * z - y }),
  ]) {
    const axis = faceDragAxis(project, origin, frame);
    assert.equal(draggedFaceDistance(0, 0, 40, axis), -4);
    assert.equal(draggedFaceDistance(1.5, 5, -10, axis), 2.5);
  }
});

test('size by dimension matches the solid bounds after mirroring and rotation', async (t) => {
  const wasm = await init();
  wasm.setup();
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const project = newProject();
  project.mode = 'editor';
  const [source] = engine.build(project);
  const angles = [15, -23, 38];
  const span = orientedDimension(source, 0, angles, true);
  project.editor.ops.push({
    id: 'resize',
    type: 'transform',
    target: source.id,
    scale: 100 / span,
    rotate: angles,
    move: [0, 0, 0],
    mirror: true,
  });
  const [result] = engine.build(project);
  assert.ok(
    Math.abs(result.bounds.max[0] - result.bounds.min[0] - 100) < 0.0001,
  );
});
