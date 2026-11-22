import { faceTrimMetrics, trimPlane } from './face-trim.js';

// Project an outward millimetre into screen space. Looking straight at the
// face, use an upward gesture at the same scale as its in-plane dimensions.
export function faceDragAxis(project, origin, frame) {
  const p = project(origin);
  const along = (direction) => {
    const q = project(origin.map((v, i) => v + direction[i]));
    return [q.x - p.x, q.y - p.y];
  };
  const normal = along(frame.normal);
  const scale = Math.max(
    Math.hypot(...along(frame.u)),
    Math.hypot(...along(frame.v)),
  );
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  return Math.hypot(...normal) < scale * 0.16 ? [0, -scale] : normal;
}

export function draggedFaceDistance(start, dx, dy, [x, y]) {
  return Math.round((start + (dx * x + dy * y) / (x * x + y * y)) * 10) / 10;
}

export function createFaceHandle(host, stage) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.dataset.faceHandle = '';
  handle.className = 'face-handle';
  handle.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4"/></svg>';
  handle.hidden = true;
  host.append(handle);
  let context = null,
    axis = null,
    drag = null,
    trim = null;
  const isHeight = () => context?.faceMoveMode === 'height';
  const input = () => {
    const name = context?.extrusion
      ? 'extrudeDistance'
      : trim
        ? 'trimAmount'
        : isHeight()
          ? 'faceHeight'
          : 'faceDistance';
    return document.querySelector('#settings-form [name="' + name + '"]');
  };
  const inputSign = () =>
    context?.extrusion?.factor ?? (context?.op?.trimMode === 'remove' ? -1 : 1);
  function write(value) {
    const field = input();
    if (
      !field ||
      field.disabled ||
      field.closest('[inert]') ||
      !Number.isFinite(value) ||
      (context?.extrusion && value <= 0) ||
      (!trim && isHeight() && value < 0)
    )
      return;
    if (
      trim &&
      !trimPlane(trim.min, trim.max, trim.face, context.op.trimMode, value)
        .valid
    )
      return;
    field.value = String(value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag || !axis) return;
    const field = input();
    if (!field || field.disabled || field.closest('[inert]')) return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: field.valueAsNumber || 0,
      axis: axis.map((v) => v * inputSign()),
    };
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (event.pointerId !== drag?.id) return;
    const value = draggedFaceDistance(
      drag.start,
      event.clientX - drag.x,
      event.clientY - drag.y,
      drag.axis,
    );
    if (input()?.valueAsNumber !== value) write(value);
  });
  handle.addEventListener('lostpointercapture', () => {
    drag = null;
  });
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 1;
    write(
      Math.round(
        ((input()?.valueAsNumber || 0) +
          (event.key === 'ArrowUp' ? step : -step) * inputSign()) *
          10,
      ) / 10,
    );
  });
  return {
    set(next) {
      context =
        ((next.part &&
          (next.tab === 'move-face' || next.op?.type === 'trimFace')) ||
          next.extrusion) &&
        !next.measuring &&
        !next.plateVisible
          ? next
          : null;
      trim =
        context?.op?.type === 'trimFace'
          ? faceTrimMetrics(
              context.part.positions,
              context.op.frame,
              context.op.trimMode,
              context.op.amount,
            )
          : null;
      const action = context?.extrusion
        ? 'Adjust extrusion distance'
        : trim
          ? 'Move cut plane'
          : isHeight()
            ? 'Adjust common height'
            : 'Move selected faces';
      handle.setAttribute(
        'aria-label',
        action + '. Drag along the arrow, or use the up and down arrow keys.',
      );
      handle.title = action + ' · ↑ / ↓ for 1 mm';
      if (!context) {
        handle.hidden = true;
        if (drag && handle.hasPointerCapture(drag.id))
          handle.releasePointerCapture(drag.id);
        drag = null;
      }
    },
    project() {
      const frame =
        context?.extrusion?.frame ??
        (trim
          ? context.op.frame
          : (context?.region ??
            context?.face ??
            context?.faceProfiles?.[0]?.frame ??
            context?.op?.faces?.[0]?.frame ??
            context?.op?.frame));
      if (!frame?.normal || !frame.u || !frame.v || frame.planar === false) {
        handle.hidden = true;
        return;
      }
      const origin =
        context.extrusion?.start ??
        (context.op?.reference === 'top'
          ? frame.origin
          : (context.facePoint ?? frame.origin));
      const projection = (normal) =>
        origin.reduce((offset, x, i) => offset + x * normal[i], 0);
      let distance = Number(context.faceDistance) || 0;
      if (context.extrusion)
        distance = context.extrusion.distance * context.extrusion.factor;
      if (trim) distance = trim.cut - projection(trim.normal);
      else if (isHeight()) {
        const plan = context.facePlan;
        if (
          !Number.isFinite(plan?.min) ||
          !Number.isFinite(context.faceHeight)
        ) {
          handle.hidden = true;
          return;
        }
        distance = plan.min + context.faceHeight - projection(plan.normal);
      }
      const point = stage.projectPoint(
        origin.map((v, i) => v + distance * frame.normal[i]),
      );
      axis = faceDragAxis((p) => stage.projectPoint(p), origin, frame);
      if (!axis || !point.visible) {
        if (!drag) handle.hidden = true;
        return;
      }
      const length = Math.hypot(...axis);
      const radius = 17;
      const clamp = (v, extent) =>
        Math.max(radius, Math.min(extent - radius, v));
      const x = clamp(point.x + (21 * axis[0]) / length, host.clientWidth);
      const y = clamp(point.y + (21 * axis[1]) / length, host.clientHeight);
      handle.hidden = false;
      handle.style.left = x + 'px';
      handle.style.top = y + 'px';
      handle.style.setProperty(
        '--arrow-angle',
        Math.atan2(axis[1], axis[0]) + 'rad',
      );
      return { x: x - radius, y: y - radius, w: 2 * radius, h: 2 * radius };
    },
  };
}
