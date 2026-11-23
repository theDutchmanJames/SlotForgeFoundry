// Handle maths for a flowing curve: one cubic from [0, 0] through two
// direction handles to its end. Dimensions are millimetres, angles radians.
const LIMIT = 20000;
const K = 0.5522847498307936;
const clean = (v) => Number(Math.max(-LIMIT, Math.min(LIMIT, v)).toFixed(6));
const unit = (a) => [Math.cos(a), Math.sin(a)];

export const FLOWING_PRESETS = [
  ['bend', 'Sweeping bend'],
  ['s-bend', 'S-bend'],
  ['transition', 'Straight transition'],
];

// The cubic's tightest centre radius as a share of the preset size r.
const TIGHTEST = { bend: 0.99, 's-bend': 0.9 };

// Sized for a printed piece: the bend clears the inside road edge with room,
// and its centre line is nowhere tighter than `centreRadius`.
export function flowingPreset(name, width, centreRadius = 0) {
  const r =
    Math.ceil(
      Math.min(
        9000,
        Math.max(200, 1.5 * width, centreRadius / (TIGHTEST[name] ?? Infinity)),
      ) / 5,
    ) * 5;
  const points =
    name === 's-bend'
      ? [[0, 0], [r * 0.65, r * 0.3], [r * 1.35, -r * 0.3], [r * 2, 0]]
      : name === 'transition'
        ? [[0, 0], [r * 0.6, 0], [r * 1.4, 0], [r * 2, 0]]
        : [[0, 0], [r * K, 0], [r, r * (1 - K)], [r, r]];
  return points.map((q) => q.map(clean));
}

export const mirrorFlowing = (points) =>
  points.map(([x, y]) => [x, y === 0 ? 0 : -y]);

/** Travel direction where the curve leaves its start and where it arrives. */
export function flowingDirections(points) {
  const [, a, b, end] = points;
  return {
    start: Math.atan2(a[1], a[0]),
    end: Math.atan2(end[1] - b[1], end[0] - b[0]),
  };
}

// Handle 1 or 2 is a direction handle; 3 is the end, and its handle travels
// with it. With `keep`, a direction handle slides along its direction line.
export function moveFlowingHandle(points, index, q, keep) {
  const c = points.map((point) => point.slice());
  if (index === 3) {
    c[2] = [c[2][0] + q[0] - c[3][0], c[2][1] + q[1] - c[3][1]];
    c[3] = q;
  } else if (!keep) c[index] = q;
  else if (index === 1) {
    const u = unit(keep.start);
    const reach = Math.max(1, q[0] * u[0] + q[1] * u[1]);
    c[1] = [reach * u[0], reach * u[1]];
  } else {
    const u = unit(keep.end);
    const reach = Math.max(
      1,
      (c[3][0] - q[0]) * u[0] + (c[3][1] - q[1]) * u[1],
    );
    c[2] = [c[3][0] - reach * u[0], c[3][1] - reach * u[1]];
  }
  return c.map((point) => point.map(clean));
}

/** Turn one end of the curve to face `angle`, keeping its handle length. */
export function setFlowingDirection(points, end, angle) {
  const c = points.map((point) => point.slice());
  const u = unit(angle);
  if (end === 'start') {
    const reach = Math.max(1, Math.hypot(...c[1]));
    c[1] = [reach * u[0], reach * u[1]];
  } else {
    const reach = Math.max(
      1,
      Math.hypot(c[3][0] - c[2][0], c[3][1] - c[2][1]),
    );
    c[2] = [c[3][0] - reach * u[0], c[3][1] - reach * u[1]];
  }
  return c.map((point) => point.map(clean));
}
