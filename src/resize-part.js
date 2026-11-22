import { Euler, Matrix4 } from 'three';

// Measure the vertices along one world axis after the same X/Y/Z rotations
// used by the solid kernel. A rotated bounding box overestimates a bent part.
export function orientedDimension(part, axis, angles, mirror) {
  if (angles.every((a) => a === 0))
    return part.bounds.max[axis] - part.bounds.min[axis];
  const [rx, ry, rz] = angles.map((a) => (a * Math.PI) / 180);
  const m = new Matrix4().makeRotationFromEuler(
    new Euler(rx, ry, rz, 'ZYX'),
  ).elements;
  const x = m[axis] * (mirror ? -1 : 1),
    y = m[axis + 4],
    z = m[axis + 8];
  let min = Infinity,
    max = -Infinity;
  const positions = part.positions;
  for (let i = 0; i < positions.length; i += 3) {
    const d = positions[i] * x + positions[i + 1] * y + positions[i + 2] * z;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return max - min;
}

export function bindSizeControls(form, part) {
  const target = form?.querySelector('[data-size-target]');
  if (!target || !part) return;
  const axis = form.querySelector('[data-size-axis]');
  const scale = form.elements.scale;
  const section = target.closest('details');
  let key,
    span,
    writing = false;
  function dimension() {
    const angles = ['rx', 'ry', 'rz'].map(
      (name) => form.elements[name].valueAsNumber,
    );
    const mirror = form.elements.mirror.checked;
    const next = [axis.value, ...angles, mirror].join(',');
    if (key !== next) {
      key = next;
      span = orientedDimension(part, Number(axis.value), angles, mirror);
    }
    return span;
  }
  function sync() {
    if (!section.open || writing) return;
    const length = dimension() * scale.valueAsNumber;
    target.value = Number.isFinite(length)
      ? String(Number(length.toFixed(6)))
      : '';
  }
  section.addEventListener('toggle', sync);
  axis.addEventListener('change', sync);
  form.addEventListener('input', (event) => {
    if (event.target !== target) {
      sync();
      return;
    }
    const ratio = target.valueAsNumber / dimension();
    // Hide trigonometric roundoff such as 0.49999999999999994 after a 90° turn.
    scale.value =
      ratio > 0 && Number.isFinite(ratio)
        ? String(Number(ratio.toPrecision(14)))
        : '';
    writing = true;
    scale.dispatchEvent(new Event('input', { bubbles: true }));
    writing = false;
  });
}
