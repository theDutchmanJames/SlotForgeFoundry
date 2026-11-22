import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// A face workplane can have any roll. OrbitControls captures the orbit axis
// when it is constructed, so change controllers along with the up axis. Keep
// the public event source stable for the viewport, hover hints and comparisons.
export class ViewNavigation extends THREE.EventDispatcher {
  constructor(camera, canvas) {
    super();
    this.camera = camera;
    this.canvas = canvas;
    this.useUp(camera.up);
  }
  useUp(up) {
    if (this.orbit && this.camera.up.distanceToSquared(up) < 1e-16) return;
    const target = this.orbit?.target.clone();
    this.orbit?.dispose();
    this.camera.up.copy(up);
    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.orbit.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.orbit.enableDamping = false;
    if (target) this.orbit.target.copy(target);
    this.orbit.addEventListener('change', () =>
      this.dispatchEvent({ type: 'change' }),
    );
  }
  get target() {
    return this.orbit.target;
  }
  update() {
    this.orbit.update();
  }
  dispose() {
    this.orbit.dispose();
  }
}

export const viewNames = {
  top: 'Top',
  front: 'Front',
  right: 'Right',
  bottom: 'Bottom',
  back: 'Back',
  left: 'Left',
  iso: 'Isometric',
};
const directions = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  iso: [0.68, -1, 0.95],
};
export function orthoPose(name) {
  if (!Object.hasOwn(directions, name)) return null;
  const eye = new THREE.Vector3(...directions[name]).normalize();
  const up =
    name === 'top' || name === 'bottom'
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
  return { eye, up };
}

export function facePose(frame) {
  const finite = (a) =>
    Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  if (
    !frame ||
    frame.planar === false ||
    ![frame.u, frame.v, frame.normal, frame.origin].every(finite)
  )
    return null;
  const eye = new THREE.Vector3(...frame.normal).normalize();
  const right = new THREE.Vector3(...frame.u);
  right.addScaledVector(eye, -right.dot(eye)).normalize();
  const up = new THREE.Vector3().crossVectors(eye, right).normalize();
  if (
    eye.lengthSq() < 0.99 ||
    up.dot(new THREE.Vector3(...frame.v).normalize()) < 0.999
  )
    return null;
  return { eye, up };
}

// Outline coordinates are in the supplied frame. A custom datum may sit in
// a corner or hole; frame the face itself, including when its origin is far
// from the middle. Callers with separate camera/datum axes can pass world points.
export function faceBounds(frame, pose) {
  const origin = new THREE.Vector3(...frame.origin);
  const right = new THREE.Vector3().crossVectors(pose.up, pose.eye);
  const ext = new THREE.Box2(),
    uv = new THREE.Vector2();
  if (frame.points?.length) {
    const p = new THREE.Vector3();
    for (const v of frame.points) {
      p.fromArray(v).sub(origin);
      ext.expandByPoint(uv.set(p.dot(right), p.dot(pose.up)));
    }
  } else {
    for (const loop of frame.loops ?? [])
      for (const [x, y] of loop) ext.expandByPoint(uv.set(x, y));
  }
  if (ext.isEmpty()) return null;
  const mid = ext.getCenter(uv);
  return {
    center: origin
      .addScaledVector(right, mid.x)
      .addScaledVector(pose.up, mid.y),
    size: ext.getSize(new THREE.Vector2()),
  };
}
