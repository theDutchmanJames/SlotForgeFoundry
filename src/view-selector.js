import './view-selector.css';
import * as THREE from 'three';
import { facePose, orthoPose, viewNames } from './view-orientation.js';

const poses = Object.fromEntries(
  Object.keys(viewNames).map((name) => [name, orthoPose(name)]),
);
const axes = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];
const axisNames = ['X', 'Y', 'Z'];

function orientationIndicator(host) {
  if (!host) return () => {};
  host.innerHTML =
    '<svg class="camera-axes" viewBox="-27 -25 54 50" role="img" aria-label="World axes in this view">' +
    axisNames
      .map(
        (name) =>
          '<g data-axis="' +
          name +
          '"><line x1="0" y1="0"/><text>' +
          name +
          '</text></g>',
      )
      .join('') +
    '</svg>';
  const marks = Array.from(host.querySelectorAll('[data-axis]'), (g) => ({
    line: g.firstElementChild,
    text: g.lastElementChild,
  }));
  return (right, up) => {
    for (const [i, axis] of axes.entries()) {
      const dx = axis.dot(right),
        dy = -axis.dot(up);
      const { line, text } = marks[i];
      // The axis pointing straight into or out of the screen has zero length.
      // Leave its name off the centre so the other two axes remain legible.
      const visible = Math.hypot(dx, dy) > 0.15;
      line.parentElement.setAttribute(
        'visibility',
        visible ? 'visible' : 'hidden',
      );
      if (!visible) continue;
      line.setAttribute('x2', String(16 * dx));
      line.setAttribute('y2', String(16 * dy));
      text.setAttribute('x', String(22 * dx));
      text.setAttribute('y', String(20 * dy));
    }
  };
}

/** Camera controls are local viewport actions; they never modify a project. */
export function mountViewSelector(stage, container, getFace) {
  const group = document.createElement('nav');
  group.className = 'view-selector';
  group.setAttribute('aria-label', 'Camera view');
  const buttons = new Map();
  for (const [key, label] of Object.entries({
    ...viewNames,
    face: 'Look at face',
  })) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.action = key === 'face' ? 'look-at-face' : key;
    b.title =
      key === 'face'
        ? 'Look straight at the selected face or sketch'
        : label + ' view';
    b.setAttribute('aria-pressed', 'false');
    group.append(b);
    buttons.set(key, b);
  }
  container.append(group);
  const indicator = orientationIndicator(container.querySelector('.axis'));
  const right = new THREE.Vector3(),
    up = new THREE.Vector3(),
    eye = new THREE.Vector3(),
    screenUp = new THREE.Vector3(),
    lastOrientation = new THREE.Quaternion(0, 0, 0, 0);
  let frame = null,
    faceDirection = null,
    marked = null;
  function update() {
    // OrbitControls emits change for zoom and pan as well as orbit. Keep a
    // named view active until its camera direction or screen-up really changes.
    if (!lastOrientation.equals(stage.camera.quaternion)) {
      lastOrientation.copy(stage.camera.quaternion);
      right.set(1, 0, 0).applyQuaternion(lastOrientation);
      up.set(0, 1, 0).applyQuaternion(lastOrientation);
      eye.set(0, 0, 1).applyQuaternion(lastOrientation);
      indicator(right, up);
    }
    const key = stage.activeView,
      pose = key === 'face' ? faceDirection : poses[key];
    if (pose) screenUp.copy(pose.up).projectOnPlane(pose.eye).normalize();
    const active =
      pose && eye.dot(pose.eye) > 0.999999 && up.dot(screenUp) > 0.999999
        ? key
        : null;
    if (marked === active) return;
    buttons.get(marked)?.setAttribute('aria-pressed', 'false');
    buttons.get(active)?.setAttribute('aria-pressed', 'true');
    marked = active;
  }
  function refresh() {
    frame = getFace?.() ?? null;
    faceDirection = facePose(frame);
    buttons.get('face').disabled = !faceDirection;
    buttons.get('face').title = faceDirection
      ? 'Look straight at the selected face or sketch'
      : 'Select a flat face or sketch to look straight at it';
    update();
  }
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    e.stopPropagation();
    if (b === buttons.get('face')) stage.lookAtFace(frame);
    else stage.view(b.dataset.action);
    update();
  });
  stage.controls.addEventListener('change', update);
  refresh();
  return { refresh };
}
