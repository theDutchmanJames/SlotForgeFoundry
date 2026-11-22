import { workplane, worldPoint } from './design.js';

const world = workplane('xy');
const finite3 = (a) =>
  Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const mm = (value) => Number(value.toFixed(3));

export function solidMoveTarget(context) {
  const { op, part, shownMoveOp: shown } = context;
  if (
    context.mode !== 'editor' ||
    context.plateVisible ||
    context.measuring ||
    !op
  )
    return null;
  let frame, offset, anchor, names, id, displayed;
  if (context.tab === 'primitive' && op.kind === 'primitive') {
    frame = op.frame ?? world;
    offset = [op.x, op.y, op.z];
    names = ['shapeX', 'shapeY', 'shapeZ'];
    const height = op.shape === 'sphere' ? op.diameter : op.height;
    anchor = worldPoint(
      frame,
      offset,
      op.z + (op.result === 'cut' ? -height : height),
    );
    if (op.result === 'new' && shown?.id === op.id && shown.result === 'new') {
      id = op.id;
      displayed = [shown.x, shown.y, shown.z];
    }
  } else if (context.tab === 'transform' && part && !op.layFlat) {
    frame = world;
    offset = op.move;
    names = ['mx', 'my', 'mz'];
    const { min, max } = part.bounds;
    anchor = min.map((v, i) => (v + max[i]) / 2 + offset[i]);
    id = op.target;
    displayed = shown?.id === op.id ? shown.move : [0, 0, 0];
  } else return null;
  if (!finite3(offset) || !finite3(anchor)) return null;
  const translated =
    id && finite3(displayed) && context.rigidMoveAllowed
      ? worldPoint(
          { ...frame, origin: [0, 0, 0] },
          offset.map((n, i) => n - displayed[i]),
          offset[2] - displayed[2],
        )
      : null;
  return { frame, anchor, names, body: id, translated };
}

// An end-on axis still has one labelled control: extend it along an unused
// diagonal. The other arrows and the plane pad keep their true projections.
export function projectMoveAxes(project, { anchor, frame }) {
  const origin = project(anchor);
  const axes = [frame.u, frame.v, frame.normal].map((axis) => {
    const end = project(anchor.map((n, i) => n + axis[i]));
    return [end.x - origin.x, end.y - origin.y];
  });
  const scale = Math.max(...axes.map((v) => Math.hypot(...v)));
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const directions = axes.map((v) => {
    const length = Math.hypot(...v);
    return length < 0.15 * scale ? null : v.map((n) => n / length);
  });
  // Also separate two axes which point along nearly the same screen ray.
  const placed = [];
  const dragAxes = axes.map((v, i) => {
    let direction = directions[i];
    if (!direction || placed.some((p) => dot(p, direction) > 0.87)) {
      const occupied = [...directions.filter(Boolean), ...placed];
      const score = (d) => Math.max(...occupied.map((p) => dot(p, d)));
      const choices = Array.from({ length: 8 }, (_, k) => [
        Math.cos((k * Math.PI) / 4),
        Math.sin((k * Math.PI) / 4),
      ]);
      direction = choices.reduce((best, d) =>
        score(d) < score(best) ? d : best,
      );
      v = direction.map((n) => n * scale);
    }
    placed.push(direction);
    return v;
  });
  return { origin, axis: dragAxes, plane: axes.slice(0, 2), scale };
}

export function draggedSolidOffset(start, handle, projection, dx, dy) {
  const result = start.slice();
  const delta = [dx, dy];
  if (handle === 'plane') {
    const [u, v] = projection.plane,
      det = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(det) > 0.12 * projection.scale ** 2) {
      result[0] += (dx * v[1] - dy * v[0]) / det;
      result[1] += (u[0] * dy - u[1] * dx) / det;
    } else {
      // The workplane is edge-on. Use the shortest in-plane displacement
      // along its visible direction instead of dividing by a near-zero area.
      const denom = dot(u, u) + dot(v, v);
      result[0] += dot(delta, u) / denom;
      result[1] += dot(delta, v) / denom;
    }
  } else {
    const v = projection.axis[handle];
    result[handle] += dot(delta, v) / dot(v, v);
  }
  return result.map((n, i) => (n === start[i] ? n : mm(n)));
}
