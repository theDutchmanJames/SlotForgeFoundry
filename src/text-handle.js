export function createTextHandle(host, stage) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'text-position-handle';
  el.dataset.textHandle = '';
  el.textContent = '✥';
  el.title = 'Move lettering · drag or use the arrow keys';
  el.setAttribute('aria-label', 'Move lettering on surface');
  el.hidden = true;
  host.append(el);
  let op = null,
    drag = null;
  function write(x, y) {
    const form = document.querySelector('#settings-form');
    if (!form?.elements.labelText || form.closest('[inert]')) return;
    for (const [field, value] of [
      [form.elements.dx, x],
      [form.elements.dy, y],
    ]) {
      const rounded = Math.round(value * 100) / 100;
      if (!Number.isFinite(rounded) || field.valueAsNumber === rounded)
        continue;
      field.value = String(rounded);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function anchor() {
    return op.frame.origin.map(
      (x, i) => x + op.offset[0] * op.frame.u[i] + op.offset[1] * op.frame.v[i],
    );
  }
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !op) return;
    const p = anchor(),
      origin = stage.projectPoint(p);
    const axis = (direction) => {
      const end = stage.projectPoint(p.map((x, i) => x + direction[i]));
      return [end.x - origin.x, end.y - origin.y];
    };
    const [ux, uy] = axis(op.frame.u),
      [vx, vy] = axis(op.frame.v),
      det = ux * vy - uy * vx;
    if (Math.abs(det) < 0.001) return;
    el.setPointerCapture(e.pointerId);
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      offset: op.userOffset,
      ux,
      uy,
      vx,
      vy,
      det,
    };
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const x = e.clientX - drag.x,
      y = e.clientY - drag.y;
    write(
      drag.offset[0] + (x * drag.vy - y * drag.vx) / drag.det,
      drag.offset[1] + (y * drag.ux - x * drag.uy) / drag.det,
    );
  });
  el.addEventListener('lostpointercapture', () => {
    drag = null;
    if (!op) el.hidden = true;
  });
  el.addEventListener('keydown', (e) => {
    if (
      !op ||
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
    )
      return;
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : 1;
    write(
      op.userOffset[0] +
        step * ((e.key === 'ArrowRight') - (e.key === 'ArrowLeft')),
      op.userOffset[1] +
        step * ((e.key === 'ArrowUp') - (e.key === 'ArrowDown')),
    );
  });
  return {
    set(context) {
      op =
        context.mode === 'editor' &&
        context.tab === 'text' &&
        !context.measuring &&
        !context.plateVisible &&
        context.part
          ? context.op
          : null;
      if (!op && !drag) el.hidden = true;
    },
    project() {
      if (!op) return;
      const p = stage.projectPoint(anchor());
      if (!p.visible && !drag) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      return { x: p.x - 13, y: p.y - 13, w: 26, h: 26 };
    },
  };
}
