import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import {
  createSectionStore,
  clippedPolygon,
} from '../src/geometry/section-view.js';
import { createEngine } from '../src/engine.js';
import { newProject } from '../src/project.js';

const wasm = await init();
wasm.setup();
test('a view section caps the walls of a hollow part, preserves nested voids and leaves the exported mesh intact', (t) => {
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const project = newProject();
  project.mode = 'editor';
  const parts = engine.build(project);
  const original = engine.export({ mode: 'part', id: parts[0].id });
  const plane = { axis: 2, position: 8, high: false };
  const [cut] = engine.sectionView({
    key: 'test',
    parts: structuredClone(parts),
    plane,
  });
  assert.ok(cut.indices.length && cut.capIndices.length);
  let area = 0;
  for (let i = 0; i < cut.capIndices.length; i += 3) {
    const [a, b, c] = cut.capIndices.slice(i, i + 3).map((v) => v * 3);
    const p = cut.positions;
    assert.deepEqual([p[a + 2], p[b + 2], p[c + 2]], [8, 8, 8]);
    area +=
      Math.abs(
        (p[b] - p[a]) * (p[c + 1] - p[a + 1]) -
          (p[b + 1] - p[a + 1]) * (p[c] - p[a]),
      ) / 2;
  }
  assert.ok(area > 100 && area < (82 * 54) / 2, 'section covers only material');
  const [other] = engine.sectionView({
    key: 'test',
    plane: { ...plane, high: true },
  });
  for (let i = 2; i < other.positions.length; i += 3)
    assert.ok(other.positions[i] >= 8);
  assert.deepEqual(engine.export({ mode: 'part', id: parts[0].id }), original);
  engine.closeSection('test');
  assert.equal(engine.sectionView({ key: 'test', plane }), null);
});
test('an open scan can be inspected before repair without closing its boundary', (t) => {
  const store = createSectionStore(wasm);
  t.after(() => store.dispose());
  const p = {
    id: 'raw',
    positions: Float32Array.from([0, 0, 0, 2, 0, 0, 0, 2, 0]),
    indices: Uint32Array.from([0, 1, 2]),
    bounds: { min: [0, 0, 0], max: [2, 2, 0] },
  };
  const plane = { axis: 0, position: 1, high: false };
  const [cut] = store.sectionView({ key: 'raw', parts: [p], plane });
  assert.equal(cut.indices.length, 6);
  assert.equal(cut.capIndices, undefined);
  assert.equal(
    store.sectionView({ key: 'raw', plane: { ...plane, position: 2 } })[0]
      .whole,
    true,
  );
  assert.equal(
    store.sectionView({ key: 'raw', plane: { ...plane, position: -1 } })[0]
      .empty,
    true,
  );
  assert.deepEqual(
    clippedPolygon(
      [
        [0, 0, 0],
        [2, 0, 0],
        [0, 2, 0],
      ],
      plane,
    ),
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 2, 0],
    ],
  );
});
