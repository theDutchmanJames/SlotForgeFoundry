import assert from 'node:assert/strict';
import test from 'node:test';
import { worldPoint } from '../src/design.js';
import { defaultSketchGrid, gridToPlane } from '../src/sketch-grid.js';
import {
  gridCameraFrame,
  pickedGridSurface,
  savedGridSurface,
} from '../src/workplane-grid.js';

const plate = [
  [
    [-117.5, -58.5],
    [117.5, -58.5],
    [117.5, 58.5],
    [-117.5, 58.5],
  ],
];
const frame = {
  origin: [101, -20, 3],
  u: [0, 1, 0],
  v: [0, 0, 1],
  normal: [1, 0, 0],
};
test('the live grid occupies the same physical squares wherever the face was clicked', () => {
  function pick(anchor) {
    return pickedGridSurface({
      ...frame,
      anchor,
      seed: { point: worldPoint(frame, anchor) },
      loops: plate,
    });
  }
  const a = pick([0, 0]),
    b = pick([11.25, -6]);
  const vertex = (s) => worldPoint(s.frame, gridToPlane(s.resolved, [30, 10]));
  assert.deepEqual(vertex(a), vertex(b));
  assert.equal(a.config.pitch, 10);
  assert.deepEqual(a.resolved.margins, [2.5, 3.5, 2.5, 3.5]);
  assert.deepEqual(gridCameraFrame(a), gridCameraFrame(b));
});

test('returning to an offset sketch uses the current placement and its saved edge direction', () => {
  const config = {
    ...defaultSketchGrid(),
    placement: 'custom',
    angle: 90,
    origin: [3, 7],
  };
  const sketch = { frame, loops: [], paths: [] };
  const s = savedGridSurface(
    { plane: 'face', grid: config, referenceLoops: plate },
    sketch,
  );
  const camera = gridCameraFrame(s);
  assert.deepEqual(camera.u, [0, 0, 1]);
  assert.deepEqual(camera.origin, worldPoint(frame, [3, 7]));
  assert.deepEqual(camera.normal, frame.normal);
  assert.ok(s.worldCorners.every((p) => p[0] === frame.origin[0]));
  assert.equal(s.clipLoops, plate);
  assert.equal(s.config, config);
});
