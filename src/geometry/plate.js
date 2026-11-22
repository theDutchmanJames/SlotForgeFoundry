const halfTurn = Math.PI;
const quarterTurn = Math.PI / 2;
const epsilon = 1e-8;

/** The convex hull is sufficient for testing containment in a rectangular bed. */
export function footprintHull(points) {
  const sorted = Array.from(points, ([x, y]) => [x, y]).sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );
  if (sorted.some((p) => !p.every(Number.isFinite)))
    throw new Error('Footprint contains an invalid coordinate.');
  const unique = sorted.filter(
    (p, i) => !i || p[0] !== sorted[i - 1][0] || p[1] !== sorted[i - 1][1],
  );
  if (unique.length < 3) return unique;
  const cross = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  function chain(input) {
    const result = [];
    for (const p of input) {
      while (result.length >= 2 && cross(result.at(-2), result.at(-1), p) <= 0)
        result.pop();
      result.push(p);
    }
    result.pop();
    return result;
  }
  return chain(unique).concat(chain(unique.reverse()));
}

export function solidFootprint(solid) {
  const mesh = solid.getMesh();
  const points = [];
  for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
    points.push([mesh.vertProperties[i], mesh.vertProperties[i + 1]]);
  }
  return footprintHull(points);
}

export function fitPlate(footprintXY, width, depth, margin = 0) {
  if (
    ![width, depth, margin].every(Number.isFinite) ||
    margin < 0 ||
    width <= margin * 2 ||
    depth <= margin * 2
  )
    throw new Error(
      'Print plate dimensions must leave a positive area inside the margin.',
    );
  const hull = footprintHull(footprintXY);
  if (!hull.length) throw new Error('Cannot fit an empty part.');
  const usableX = width - 2 * margin;
  const usableY = depth - 2 * margin;
  if (hull.length === 1) return { fits: true, angle: 0, width: 0, depth: 0 };

  // Between edge-aligned orientations the four support vertices stay fixed.
  // Each projected span is concave on that interval. Its normalized maximum
  // attains its minimum at a boundary or where the two normalized spans match.
  const events = [0, halfTurn];
  for (let i = 0; i < hull.length; ++i) {
    const a = hull[i],
      b = hull[(i + 1) % hull.length];
    const edge = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const angle = ((edge % quarterTurn) + quarterTurn) % quarterTurn;
    events.push(angle, angle + quarterTurn);
  }
  events.sort((a, b) => a - b);
  let best = { ratio: Infinity };
  const supports = [0, 0, 0, 0];
  const dot = (p, d) => p[0] * d[0] + p[1] * d[1];
  const extremum = (direction, index, first) => {
    if (first) {
      for (let i = 1; i < hull.length; ++i)
        if (dot(hull[i], direction) > dot(hull[supports[index]], direction))
          supports[index] = i;
    }
    for (let i = 0; i < hull.length; ++i) {
      const next = (supports[index] + 1) % hull.length;
      if (dot(hull[next], direction) <= dot(hull[supports[index]], direction))
        break;
      supports[index] = next;
    }
    return hull[supports[index]];
  };
  let first = true;
  for (let i = 1; i < events.length; ++i) {
    const a = events[i - 1],
      b = events[i];
    if (b - a < 1e-12) continue;
    const mid = (a + b) / 2,
      c = Math.cos(mid),
      s = Math.sin(mid);
    const x1 = extremum([c, s], 0, first),
      x0 = extremum([-c, -s], 1, first);
    const y1 = extremum([-s, c], 2, first),
      y0 = extremum([s, -c], 3, first);
    first = false;
    const dx = [x1[0] - x0[0], x1[1] - x0[1]];
    const dy = [y1[1] - y0[1], y0[0] - y1[0]];
    let equal = Math.atan2(
      dy[0] / usableY - dx[0] / usableX,
      dx[1] / usableX - dy[1] / usableY,
    );
    equal = ((equal % halfTurn) + halfTurn) % halfTurn;
    for (const angle of [a, b, equal]) {
      if (angle < a || angle > b) continue;
      const direction = [Math.cos(angle), Math.sin(angle)];
      const w = dot(dx, direction),
        h = dot(dy, direction);
      const ratio = Math.max(w / usableX, h / usableY);
      if (ratio + 1e-12 < best.ratio)
        best = { ratio, angle: (-angle * 180) / Math.PI, width: w, depth: h };
    }
  }
  return {
    fits: best.ratio <= 1 + epsilon,
    angle: best.angle,
    width: best.width,
    depth: best.depth,
  };
}
