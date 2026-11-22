// New feature geometry targets a maximum chord sag of 0.005 mm at typical
// print sizes. A bounded segment count also keeps very large radii affordable.
export function fineCircleSegments(radius, limit = 512) {
  const halfAngle = Math.acos(Math.max(0, 1 - 0.005 / radius));
  return Math.min(limit, Math.max(64, 4 * Math.ceil(Math.PI / (4 * halfAngle))));
}

export function fineFilletSegments(radius, angle) {
  return Math.max(4, Math.ceil((angle * fineCircleSegments(radius)) / (2 * Math.PI)));
}
