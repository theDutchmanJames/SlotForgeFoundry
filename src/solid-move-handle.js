import {
  draggedSolidOffset,
  projectMoveAxes,
  solidMoveTarget,
} from './solid-move.js';
import './solid-move.css';

const same = (a, b) => b?.length === a.length && a.every((v, i) => v === b[i]);
export function createSolidMoveHandle(host, stage, onChange) {
  const group = document.createElement('div');
  group.className = 'solid-move-handle';
  group.hidden = true;
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Move solid along its axes');
  const buttons = ['X', 'Y', 'Z', 'Plane'].map((name, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.solidMove = i === 3 ? 'plane' : String(i);
    b.textContent = i === 3 ? '✥' : name;
    b.setAttribute(
      'aria-label',
      i === 3 ? 'Move in workplane' : 'Move along ' + name,
    );
    b.title =
      i === 3
        ? 'Slide in the workplane · use the arrow keys'
        : 'Move along ' + name + ' · ↑ or ↓ for 1 mm, Shift for 0.1 mm';
    group.append(b);
    return b;
  });
  const shafts = buttons.slice(0, 3).map((button) => {
    const line = document.createElement('div');
    line.className = 'move-axis-shaft';
    line.dataset.solidMove = button.dataset.solidMove;
    group.prepend(line);
    return line;
  });
  host.append(group);
  let model = null,
    projection = null,
    drag = null,
    lastKey = null,
    inputStart = null,
    prior = [];
  const fields = () => {
    const form = document.querySelector('#settings-form');
    return model && form
      ? model.names.map((name) => form.elements.namedItem(name))
      : null;
  };
  const canWrite = () =>
    fields()?.every((el) => el && !el.disabled && !el.closest('[inert]')) &&
    !document.querySelector('#dialog[open]');
  const values = () => fields()?.map((el) => el?.valueAsNumber);
  function write(next) {
    if (!canWrite() || !next.every(Number.isFinite)) return;
    const changed = fields().filter((field, i) => {
      if (field.valueAsNumber === next[i]) return false;
      field.value = String(next[i]);
      return true;
    });
    if (changed.length) onChange(changed);
  }
  function refreshUndo() {
    const b = document.querySelector('#settings-form [data-undo-position]');
    if (b)
      b.disabled =
        !prior.length && !(inputStart && model && !same(inputStart, values()));
  }
  function record(before) {
    const after = values();
    if (
      before?.every(Number.isFinite) &&
      after?.every(Number.isFinite) &&
      !same(before, after)
    ) {
      prior.push(before);
      if (prior.length > 40) prior.shift();
    }
    refreshUndo();
  }
  const inspector = document.querySelector('#inspector');
  inspector.addEventListener('focusin', (e) => {
    if (model?.names.includes(e.target.name)) inputStart = values();
  });
  inspector.addEventListener('focusout', (e) => {
    if (inputStart && model?.names.includes(e.target.name)) {
      const prev = inputStart;
      inputStart = null;
      record(prev);
    }
  });
  inspector.addEventListener('click', (e) => {
    if (
      e.target.closest('[data-undo-position]') &&
      prior.length &&
      canWrite()
    ) {
      write(prior.pop());
      refreshUndo();
    }
  });
  function finish(cancel, revert = true) {
    if (!drag) return;
    const { before, id } = drag;
    drag = null;
    if (host.hasPointerCapture(id)) host.releasePointerCapture(id);
    host.classList.remove('solid-moving');
    if (cancel) {
      if (revert) write(before);
    } else record(before);
  }
  host.addEventListener(
    'pointerdown',
    (e) => {
      if (
        !model ||
        !projection ||
        !canWrite() ||
        drag ||
        e.button !== 0 ||
        !e.isPrimary ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const handle = e.target.closest('[data-solid-move]');
      let axis;
      if (handle && group.contains(handle)) axis = handle.dataset.solidMove;
      else if (e.target === stage.canvas && model.body && !stage.sectionPlane) {
        const bounds = stage.canvas.getBoundingClientRect();
        const hit = stage.intersectionAt(
          {
            x: (2 * (e.clientX - bounds.left)) / bounds.width - 1,
            y: 1 - (2 * (e.clientY - bounds.top)) / bounds.height,
          },
          true,
        );
        if (hit?.object.userData.id !== model.body) return;
        axis = 'plane';
      } else return;
      const before = values();
      if (!before?.every(Number.isFinite)) return;
      e.preventDefault();
      e.stopPropagation();
      buttons[axis === 'plane' ? 3 : Number(axis)].focus({
        preventScroll: true,
      });
      drag = {
        id: e.pointerId,
        axis,
        before,
        projection,
        x: e.clientX,
        y: e.clientY,
      };
      host.setPointerCapture(e.pointerId);
      host.classList.add('solid-moving');
    },
    true,
  );
  host.addEventListener('pointermove', (e) => {
    if (e.pointerId !== drag?.id) return;
    write(
      draggedSolidOffset(
        drag.before,
        drag.axis,
        drag.projection,
        e.clientX - drag.x,
        e.clientY - drag.y,
      ),
    );
  });
  host.addEventListener('pointerup', (e) => {
    if (e.pointerId === drag?.id) finish(false);
  });
  host.addEventListener('pointercancel', (e) => {
    if (e.pointerId === drag?.id) finish(true);
  });
  host.addEventListener('lostpointercapture', (e) => {
    if (e.pointerId === drag?.id) finish(true);
  });
  group.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      e.stopPropagation();
      finish(true);
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      e.key.toLowerCase() === 'z' &&
      prior.length &&
      canWrite()
    ) {
      e.preventDefault();
      e.stopPropagation();
      write(prior.pop());
      refreshUndo();
      return;
    }
    const handle = e.target.dataset.solidMove;
    if (
      !model ||
      !handle ||
      !canWrite() ||
      !['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    const before = values(),
      after = before.slice(),
      horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    const i = handle === 'plane' ? Number(!horizontal) : Number(handle);
    const sign = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1;
    after[i] = Number((after[i] + (e.shiftKey ? 0.1 : 1) * sign).toFixed(3));
    write(after);
    record(before);
  });
  return {
    set(ctx) {
      const next = solidMoveTarget(ctx);
      // A temporarily blank number input hides the widget without ending a
      // placement session or discarding its completed drag transactions.
      const editing =
        ctx.mode === 'editor' && ['primitive', 'transform'].includes(ctx.tab);
      const key = editing ? (ctx.op?.id ?? lastKey) : null;
      if (!next || key !== lastKey) {
        if (drag) finish(true, false);
        if (key !== lastKey) {
          prior = [];
          inputStart = null;
        }
      }
      lastKey = key;
      model = next;
      const tint =
        ctx.tab === 'primitive' ||
        Boolean(model?.names.includes(ctx.field)) ||
        Boolean(ctx.op?.move?.some((n) => n !== 0));
      stage.setDisplayTranslation(model?.body, model?.translated, tint);
      group.hidden = !model;
      refreshUndo();
    },
    project() {
      if (!model) return;
      projection = projectMoveAxes((p) => stage.projectPoint(p), model);
      if (!projection || !projection.origin.visible) {
        group.hidden = true;
        return;
      }
      group.hidden = false;
      const { x, y } = projection.origin,
        points = [[x, y]];
      group.style.left = x + 'px';
      group.style.top = y + 'px';
      const length = Math.min(65, Math.max(42, host.clientWidth * 0.1));
      for (let i = 0; i < 3; i++) {
        const [a, b] = projection.axis[i],
          s = length / Math.hypot(a, b),
          dx = a * s,
          dy = b * s;
        buttons[i].style.left = dx + 'px';
        buttons[i].style.top = dy + 'px';
        shafts[i].style.width = length + 'px';
        shafts[i].style.transform = 'rotate(' + Math.atan2(b, a) + 'rad)';
        points.push([x + dx, y + dy]);
      }
      const xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]);
      return {
        x: Math.min(...xs) - 14,
        y: Math.min(...ys) - 14,
        w: Math.max(...xs) - Math.min(...xs) + 28,
        h: Math.max(...ys) - Math.min(...ys) + 28,
      };
    },
  };
}
