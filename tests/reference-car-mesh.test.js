import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { referenceCarMeshes, scaleCarDimensions } from '../src/reference-car-mesh.js';
import { Viewport } from '../src/viewport.js';

const forward = [1, 0, 0], position = [0, 0, 0];
const pose = { position, forward, scale: 32 };
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} should equal ${expected}`);

function bounds(meshes) {
  const box = new THREE.Box3();
  const vertex = new THREE.Vector3();
  for (const mesh of meshes)
    for (let i = 0; i < mesh.positions.length; i += 3)
      box.expandByPoint(vertex.fromArray(mesh.positions, i));
  return box;
}

test('reference car matches its millimetre readout in every scale, with the guide near the nose', () => {
  for (const scale of [64, 43, 32, 24]) {
    const meshes = referenceCarMeshes({ ...pose, scale });
    const { length, width, height } = scaleCarDimensions(scale);
    const box = bounds(meshes);
    const size = box.getSize(new THREE.Vector3());
    close(size.x, length); close(size.y, width); close(size.z, height);
    close(length, 4600 / scale); close(width, 1900 / scale); close(height, 1200 / scale);
    close(box.min.z, 0); close(box.min.y, -width / 2); close(box.max.x, 0.18 * length);
    const triangleCount = meshes.reduce((count, m) => count + m.indices.length / 3, 0);
    assert.ok(triangleCount < 1200, 'keep the reference lightweight in the software viewer');
    for (const m of meshes) {
      assert.ok(m.positions.every(Number.isFinite));
      assert.equal(m.indices.length % 3, 0);
      assert.ok(m.indices.every(i => i < m.positions.length / 3));
    }
  }
});

test('ramped, rotated and reversed reference car follows the tangent while anchored to its guide', () => {
  const original = referenceCarMeshes(pose);
  const anchor = new THREE.Vector3(-70, 15, 30);
  const up = new THREE.Vector3(0, 0, 1);
  for (const direction of [[-1, 0, 0], [0, 6, 2], [3, -9, -1]]) {
    const f = new THREE.Vector3(...direction).normalize();
    const left = new THREE.Vector3().crossVectors(up, f).normalize();
    const normal = new THREE.Vector3().crossVectors(f, left);
    const placed = referenceCarMeshes({ ...pose, position: anchor.toArray(), forward: direction });
    for (const [k, part] of placed.entries())
      for (let i = 0; i < part.positions.length; i += 3) {
        const rel = new THREE.Vector3().fromArray(part.positions, i).sub(anchor);
        close(rel.dot(f), original[k].positions[i]);
        close(rel.dot(left), original[k].positions[i + 1]);
        close(rel.dot(normal), original[k].positions[i + 2]);
      }
  }
});

function makeStage(software = false) {
  const stage = Object.create(Viewport.prototype);
  stage.scene = new THREE.Scene();
  stage.span = 180;
  stage.group = new THREE.Group();
  stage.scene.add(stage.group);
  stage.renderer = software ? null : {};
  stage.draw = () => {};
  return stage;
}

test('both renderers reuse geometry on movement and release it when the reference is removed', () => {
  for (const software of [false, true]) {
    const stage = makeStage(software);
    stage.setReferenceCar(pose);
    const meshes = stage.referenceCar.children.slice();
    const geometry = meshes.map(m => m.geometry);
    assert.ok(meshes.length > 1);
    assert.equal(stage.group.children.length, 0, 'the car stays out of part picking and framing');
    stage.setReferenceCar({ ...pose, forward: [0, 1, 0], scale: 24 });
    const expected = referenceCarMeshes({ ...pose, forward: [0, 1, 0], scale: 24 });
    let released = 0;
    for (const [i, m] of meshes.entries()) {
      assert.equal(stage.referenceCar.children[i].geometry, geometry[i]);
      assert.deepEqual(m.geometry.attributes.position.array, expected[i].positions);
      if (software) assert.deepEqual(m.userData.preview.positions, expected[i].positions);
      geometry[i].addEventListener('dispose', () => released++);
      m.material.addEventListener('dispose', () => released++);
    }
    stage.setReferenceCar(null);
    stage.setReferenceCar(null);
    assert.equal(stage.referenceCar, null);
    assert.equal(released, 2 * meshes.length);
  }
});

test('software view depth-tests the car against track stock and picks through it to the road', () => {
  const stage = makeStage(true);
  const size = 180;
  stage.canvas = { width: size, height: size };
  stage.context = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  };
  stage.camera = new THREE.OrthographicCamera(-90, 90, 90, -90, 0.01, 1000);
  stage.camera.up.set(0, 1, 0);
  stage.camera.position.set(0, 0, 100);
  stage.camera.lookAt(0, 0, 0);
  stage.pickRay = new THREE.Raycaster();
  const road = stage.displayMesh({
    id: 'road-1', role: 'road',
    positions: Float32Array.from([-89,-89,0, 89,-89,0, 89,89,0, -89,89,0]),
    indices: Uint16Array.from([0,1,2, 0,2,3]),
  }, 2);
  stage.group.add(road);
  stage.setReferenceCar({ ...pose, position: [40, 0, 0] });
  stage.updateDepthRange();
  stage.softwareDraw(null);
  const orangePixelCount = () => {
    const pixels = stage.raster.image.data;
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > pixels[i + 1] * 1.5 && pixels[i] > 60) total++;
    return total;
  };
  assert.ok(orangePixelCount() > 1000, 'the car is visible from above in the actual raster');
  assert.equal(stage.intersectionAt(new THREE.Vector2()).object, road);
  stage.setReferenceCar({ ...pose, position: [40, 0, -45] });
  stage.updateDepthRange();
  stage.softwareDraw(null);
  assert.equal(orangePixelCount(), 0, 'the road hides all of the car when it is below the deck');
  stage.setReferenceCar(null);
  stage.clearParts();
});

test('road visibility probe excludes a hidden upper road, its border, and the lower crossing', () => {
  const stage = makeStage();
  const surface = (role, z) => {
    const geometry = new THREE.PlaneGeometry(100, 50);
    geometry.translate(0, 0, z);
    geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry);
    mesh.userData.role = role;
    stage.group.add(mesh);
    return mesh;
  };
  surface('road', 10);
  const upper = surface('road', 40);
  surface('border', 40);
  assert.equal(stage.hasRoadBelow([0, 0, 48], 8), true); // bottom of a deep guide slot
  upper.visible = false;
  assert.equal(stage.hasRoadBelow([0, 0, 48], 8), false);
  assert.equal(stage.hasRoadBelow([0, 0, 10], 8), true);
  assert.equal(stage.hasRoadBelow([60, 10, 10], 8), false);
  stage.group.children.forEach(mesh => { mesh.material.dispose(); mesh.geometry.dispose(); });
});
