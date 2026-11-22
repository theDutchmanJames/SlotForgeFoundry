import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Viewport } from '../src/viewport.js';
import {
  ViewNavigation,
  facePose,
  faceBounds,
} from '../src/view-orientation.js';

function testStage(t) {
  const canvas = new EventTarget();
  canvas.ownerDocument = new EventTarget();
  canvas.style = {};
  const stage = Object.create(Viewport.prototype);
  stage.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 1000);
  stage.camera.up.set(0, 0, 1);
  stage.camera.position.set(50, -30, 18);
  stage.controls = new ViewNavigation(stage.camera, canvas);
  stage.group = new THREE.Group();
  stage.host = { clientWidth: 720, clientHeight: 400 };
  stage.span = 50;
  stage.resize = () => stage.camera.updateProjectionMatrix();
  t.after(() => stage.controls.dispose());
  return stage;
}
function mesh(stage, id, lo, hi) {
  const geometry = new THREE.BufferGeometry();
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(...lo),
    new THREE.Vector3(...hi),
  );
  const object = new THREE.Mesh(geometry);
  object.userData.id = id;
  stage.group.add(object);
  return object;
}
function matches(v, expected, tolerance = 1e-8) {
  assert.ok(
    v.distanceTo(new THREE.Vector3(...expected)) < tolerance,
    JSON.stringify({ actual: v.toArray(), expected }),
  );
}
function cameraAxis(stage, xyz) {
  return new THREE.Vector3(...xyz).applyQuaternion(stage.camera.quaternion);
}

test('orthographic sides centre a visible selection and keep the expected axes upright', (t) => {
  const stage = testStage(t);
  const body = mesh(stage, 'A', [5, 0, 0], [15, 20, 30]);
  mesh(stage, 'B', [50, 90, 120], [80, 100, 140]);
  stage.focusIds = new Set(['A']);
  const cases = {
    top: [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    bottom: [
      [0, 0, -1],
      [-1, 0, 0],
      [0, 1, 0],
    ],
    front: [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    back: [
      [0, 1, 0],
      [-1, 0, 0],
      [0, 0, 1],
    ],
    right: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    left: [
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
    ],
  };
  for (const [side, [eye, right, up]] of Object.entries(cases)) {
    stage.view(side);
    matches(stage.controls.target, [10, 10, 15]);
    matches(cameraAxis(stage, [0, 0, 1]), eye);
    matches(cameraAxis(stage, [1, 0, 0]), right);
    matches(cameraAxis(stage, [0, 1, 0]), up);
  }
  stage.fitView();
  matches(cameraAxis(stage, [0, 0, 1]), [-1, 0, 0]);
  stage.fitView(true);
  matches(cameraAxis(stage, [0, 0, 1]), [-1, 0, 0]);
  matches(stage.controls.target, [42.5, 50, 70]);
  stage.focusIds.add('B');
  stage.view('top');
  matches(stage.controls.target, [42.5, 50, 70]);
  stage.focusIds = new Set(['A']);
  body.visible = false;
  stage.view('iso');
  matches(stage.controls.target, [65, 95, 130]);
});

test('submillimetre parts use their actual orthographic extent', (t) => {
  const stage = testStage(t);
  mesh(stage, 'miniature', [0, 0, 0], [0.25, 0.12, 0.04]);
  stage.view('top');
  assert.ok(
    Math.abs(stage.span - 1.31 * Math.max(0.12, 0.25 / (720 / 400))) < 1e-12,
  );
});

test('face view frames the geometry with its assigned X axis even when the datum is off centre', (t) => {
  const stage = testStage(t);
  mesh(stage, 'body', [-30, -40, -10], [70, 80, 60]);
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0.5, -0.8, 1.1),
  );
  const axis = (v) => new THREE.Vector3(...v).applyQuaternion(q).toArray();
  const frame = {
    origin: [8, -14, 11],
    normal: axis([0, 0, 1]),
    u: axis([1, 0, 0]),
    v: axis([0, 1, 0]),
    loops: [
      [
        [-3, 1],
        [77, 1],
        [77, 41],
        [-3, 41],
      ],
    ],
  };
  const center = new THREE.Vector3(...frame.origin)
    .addScaledVector(new THREE.Vector3(...frame.u), 37)
    .addScaledVector(new THREE.Vector3(...frame.v), 21);
  const pose = facePose(frame);
  matches(faceBounds(frame, pose).center, center.toArray());
  stage.lookAtFace(frame);
  matches(stage.controls.target, center.toArray());
  matches(cameraAxis(stage, [1, 0, 0]), frame.u);
  matches(cameraAxis(stage, [0, 1, 0]), frame.v);
  matches(cameraAxis(stage, [0, 0, 1]), frame.normal);
  const position = stage.camera.position.clone(),
    quaternion = stage.camera.quaternion.clone(),
    span = stage.span;
  stage.view('bottom');
  stage.lookAtFace(frame);
  matches(stage.camera.position, position.toArray());
  assert.ok(1 - Math.abs(stage.camera.quaternion.dot(quaternion)) < 1e-10);
  assert.equal(stage.span, span);
  const rolled = {
    ...frame,
    u: frame.v,
    v: frame.u.map((x) => -x),
    loops: null,
    points: frame.loops[0].map(([x, y]) =>
      new THREE.Vector3(...frame.origin)
        .addScaledVector(new THREE.Vector3(...frame.u), x)
        .addScaledVector(new THREE.Vector3(...frame.v), y)
        .toArray(),
    ),
  };
  stage.lookAtFace(rolled);
  matches(stage.controls.target, center.toArray());
  matches(cameraAxis(stage, [1, 0, 0]), rolled.u);
  assert.equal(facePose({ ...frame, planar: false }), null);
});
