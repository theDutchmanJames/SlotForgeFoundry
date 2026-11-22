// Curves are tessellated in millimetres, after the drawing's unit conversion.
export const tolerance = 0.025;
export const pointLimit = 500000;
export const tau = Math.PI * 2;
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function circleSteps(radius, sweep) {
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(sweep)) {
    throw Error('Invalid curve radius or angle in drawing.');
  }
  const halfAngle =
    2 * Math.asin(Math.sqrt(Math.min(1, tolerance / (2 * radius))));
  const n = Math.ceil(Math.abs(sweep) / Math.min(2 * halfAngle, Math.PI / 8));
  if (n > pointLimit)
    throw Error('Curve is too large to import at millimetre precision.');
  return Math.max(1, n);
}

export function ellipsePoints(center, rx, ry, rotation, start, sweep) {
  const steps = circleSteps(Math.max(rx, ry), sweep);
  const c = Math.cos(rotation),
    s = Math.sin(rotation);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = start + (sweep * i) / steps;
    const x = rx * Math.cos(angle),
      y = ry * Math.sin(angle);
    return [center[0] + c * x - s * y, center[1] + s * x + c * y];
  });
}

// SVG endpoint-to-centre parameterization, including the mandatory radius
// increase when the caller supplied radii too short to span the endpoints.
export function svgArc(start, rx, ry, rotation, large, positive, end) {
  if (!rx || !ry || distance(start, end) < 1e-12) return [start, end];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (rotation * Math.PI) / 180;
  const c = Math.cos(phi),
    s = Math.sin(phi);
  const dx = (start[0] - end[0]) / 2,
    dy = (start[1] - end[1]) / 2;
  const x = c * dx + s * dy,
    y = -s * dx + c * dy;
  const length = Math.hypot(x / rx, y / ry);
  if (length > 1) {
    rx *= length;
    ry *= length;
  }
  const n = (x / rx) ** 2 + (y / ry) ** 2;
  const f =
    (Boolean(large) === Boolean(positive) ? -1 : 1) *
    Math.sqrt(Math.max(0, (1 - n) / n));
  const cx = (f * rx * y) / ry,
    cy = (-f * ry * x) / rx;
  const center = midpoint(start, end);
  center[0] += c * cx - s * cy;
  center[1] += s * cx + c * cy;
  const a = Math.atan2((y - cy) / ry, (x - cx) / rx);
  const b = Math.atan2((-y - cy) / ry, (-x - cx) / rx);
  let sweep = b - a;
  if (positive && sweep < 0) sweep += tau;
  if (!positive && sweep > 0) sweep -= tau;
  const points = ellipsePoints(center, rx, ry, phi, a, sweep);
  points[0] = start;
  points[points.length - 1] = end;
  return points;
}

function pointToSegment(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  const t = lenSq
    ? Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq),
      )
    : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function flattenBezier(control, append, depth = 0) {
  if (
    control
      .slice(1, -1)
      .every((p) => pointToSegment(p, control[0], control.at(-1)) <= tolerance)
  ) {
    append(control.at(-1));
    return;
  }
  if (depth > 24) throw Error('Curve exceeds the supported coordinate range.');
  const left = [control[0]],
    right = [control.at(-1)];
  for (let row = control; row.length > 1; ) {
    row = row.slice(1).map((p, i) => midpoint(row[i], p));
    left.push(row[0]);
    right.unshift(row.at(-1));
  }
  flattenBezier(left, append, depth + 1);
  flattenBezier(right, append, depth + 1);
}
