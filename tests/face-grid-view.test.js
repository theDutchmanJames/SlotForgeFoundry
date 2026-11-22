import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { FaceGridView } from '../src/face-grid-view.js';
import { worldPoint } from '../src/design.js';
import { defaultSketchGrid, resolveSketchGrid } from '../src/sketch-grid.js';
import { Viewport } from '../src/viewport.js';

const frame = {
  origin: [0, 0, 0],
  u: [0.8, 0, 0.6],
  v: [0, 1, 0],
  normal: [-0.6, 0, 0.8],
};
const outline = [
  [-5, -5],
  [5, -5],
  [5, 5],
  [-5, 5],
];
const bore = [
  [-0.7, -0.7],
  [0.7, -0.7],
  [0.7, 0.7],
  [-0.7, 0.7],
];
function gridStage(t, gpu = false) {
  const view = Object.create(Viewport.prototype);
  view.canvas = { width: 240, height: 240 };
  view.cssWidth = view.cssHeight = 240;
  view.draw = () => {};
  view.group = new THREE.Group();
  view.scene = new THREE.Scene().add(view.group);
  if (gpu) view.renderer = {};
  else
    view.context = {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(4 * w * h) }),
      putImageData(image) {
        this.data = image.data;
      },
    };
  view.camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 20);
  view.camera.position.z = 10;
  view.camera.updateMatrixWorld();
  const faceGrid = new FaceGridView(view);
  t.after(() => faceGrid.dispose());
  const surface = { frame, clipLoops: [outline, bore] };
  const config = { ...defaultSketchGrid(), pitch: 1 };
  const resolved = resolveSketchGrid(config, surface.clipLoops);
  faceGrid.set(surface, resolved);
  return { view, faceGrid };
}
function panel(id, corners, zOffset) {
  const points = corners.map((p) => {
    const wp = worldPoint(frame, p);
    wp[2] += zOffset;
    return wp;
  });
  return {
    id,
    role: 'body',
    positions: Float32Array.from(points.flat()),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    bounds: {
      min: [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))),
      max: [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]))),
    },
  };
}
test('viewport grid lies on the inclined face, clips to its holes and both sides of section, and stays separate from pickable solids', (t) => {
  const { view, faceGrid } = gridStage(t, true);
  assert.equal(view.group.children.length, 0);
  assert.ok(view.scene.children.includes(faceGrid.object));
  const full = faceGrid.update();
  assert.ok(full?.positions.length);
  assert.equal(faceGrid.update(), full);
  function coords(grid, k) {
    return grid.positions.filter((_, i) => i % 3 === k);
  }
  for (let i = 0; i < full.positions.length; i += 6) {
    const [x, y, z, dx, dy, dz] = full.positions.slice(i, i + 6);
    assert.ok(Math.abs(x * 0.75 - z) < 1e-5);
    assert.ok(Math.abs(dx * 0.75 - dz) < 1e-5);
    if (Math.abs(x) < 0.5 && Math.abs(dx) < 0.5)
      assert.ok(Math.min(y, dy) >= 0.699 || Math.max(y, dy) <= -0.699);
    if (Math.abs(y) < 0.5 && Math.abs(dy) < 0.5)
      assert.ok(Math.min(x, dx) >= 0.559 || Math.max(x, dx) <= -0.559);
  }
  for (const high of [true, false]) {
    view.sectionPlane = { axis: 0, position: 0.375, high };
    const xs = coords(faceGrid.update(), 0);
    assert.ok(xs.includes(0.375));
    assert.ok(xs.every((v) => (high ? v >= 0.375 : v <= 0.375)));
  }
  view.sectionPlane = null;
  view.camera.position.z = -10;
  view.camera.lookAt(0, 0, 0);
  view.camera.updateMatrixWorld();
  assert.equal(faceGrid.update(), null);
  assert.equal(faceGrid.object.visible, false);
});

test('software pixels show the inclined grid on the selected face and hide it behind a close-fitting cover and inside holes', (t) => {
  const { view, faceGrid } = gridStage(t);
  const cover = [
    [1.5, -4],
    [4.5, -4],
    [4.5, 4],
    [1.5, 4],
  ];
  view.setParts(
    [panel('host', outline, 0), panel('cover', cover, 0.00004)],
    false,
  );
  view.highlightFaces('host', [0, 1]);
  view.softwareDraw();
  const baseline = view.context.data.slice();
  view.softwareDraw(faceGrid.update());
  function changed(x, y) {
    const idx = 4 * (y * view.cssWidth + x);
    return baseline
      .slice(idx, idx + 4)
      .some((v, i) => view.context.data[idx + i] !== v);
  }
  // The grid line is horizontal at y=120. It crosses a tilted face and
  // approaches the cover from below, with a 0.00004 mm depth difference.
  for (let x = 60; x <= 80; x++) assert.ok(changed(x, 120));
  for (let x = 150; x <= 180; x++) assert.equal(changed(x, 120), false);
  for (let x = 114; x <= 126; x++) assert.equal(changed(x, 120), false);
  assert.equal(changed(66, 124), false);
});
