// An interior hit far from all three triangle edges cannot hit a boundary of
// its planar region. Avoid walking a large, flat STL face on those hovers.
export function edgeNearHit(part, triangle, point, tolerance) {
  const start = triangle * 3;
  if (
    !Number.isInteger(triangle) ||
    start < 0 ||
    start + 2 >= part.indices.length
  )
    return false;
  for (let i = 0; i < 3; i++) {
    const a = 3 * part.indices[start + i];
    const b = 3 * part.indices[start + ((i + 1) % 3)];
    const ab = [0, 1, 2].map(
      (k) => part.positions[b + k] - part.positions[a + k],
    );
    const ap = point.map((value, k) => value - part.positions[a + k]);
    const length2 = ab.reduce((n, value) => n + value * value, 0);
    const t = length2
      ? Math.max(
          0,
          Math.min(1, ab.reduce((n, v, k) => n + v * ap[k], 0) / length2),
        )
      : 0;
    if (Math.hypot(...ap.map((value, k) => value - ab[k] * t)) <= tolerance)
      return true;
  }
  return false;
}

export function toggleMember(current, member, extend, equal) {
  if (!extend) return [member];
  const index = current.findIndex((other) => equal(other, member));
  if (index >= 0) return current.filter((_, i) => i !== index);
  if (current.length >= 256) throw Error('Select up to 256 items in one edit.');
  return [...current, member];
}

// Only raycast a stationary pointer. Camera drags and keyboard navigation do
// not start a hover loop or redraw a static scene.
export function mountPickHint(stage, enabled, describe) {
  const hint = document.createElement('div');
  hint.className = 'pick-target-hint';
  hint.hidden = true;
  stage.host.append(hint);
  let timer,
    generation = 0;
  function hide() {
    generation++;
    clearTimeout(timer);
    hint.hidden = true;
  }
  stage.canvas.addEventListener('pointermove', (event) => {
    hide();
    if (event.buttons || event.pointerType === 'touch' || !enabled()) return;
    const { clientX, clientY } = event;
    const stamp = generation;
    timer = setTimeout(async () => {
      if (!enabled()) return;
      const rect = stage.canvas.getBoundingClientRect();
      const x = clientX - rect.left,
        y = clientY - rect.top;
      const hit = stage.intersectionAt({
        x: (2 * x) / rect.width - 1,
        y: 1 - (2 * y) / rect.height,
      });
      if (!hit) return;
      let label;
      try {
        label = await describe(
          hit.object.userData.id,
          hit.faceIndex,
          hit.point.toArray(),
        );
      } catch {
        return; // The model or history input may have changed under the pointer.
      }
      if (generation !== stamp || !enabled()) return;
      hint.textContent = label;
      hint.hidden = false;
      hint.style.left =
        Math.max(2, Math.min(x + 12, rect.width - hint.offsetWidth - 4)) + 'px';
      hint.style.top =
        Math.max(2, Math.min(y + 14, rect.height - hint.offsetHeight - 4)) +
        'px';
    }, 160);
  });
  for (const event of ['pointerleave', 'pointerdown', 'wheel'])
    stage.canvas.addEventListener(event, hide, { passive: true });
  stage.controls.addEventListener('change', hide);
}
