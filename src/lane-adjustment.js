import { braidSpan } from './geometry/solids.js';

// The Circuit profile has zero first and second derivatives at both ends.
// t is distance along the unadjusted road centreline, including print seams.
export function laneOffsetAt(p, index, t) {
  const midpoint = (p.lanes - 1) / 2;
  const normal = (index - midpoint) * p.laneSpacing;
  const adjustment = p.laneAdjustment;
  if (!adjustment || t === 0 || t === 1) return normal;
  const anchor = adjustment.anchor === 'inner' ? 0 : midpoint;
  const blend = 64 * (t * (1 - t)) ** 3;
  return normal + (index - anchor) * (adjustment.spacingMm - p.laneSpacing) * blend;
}

export function validateLaneAdjustment(p) {
  const adjustment = p.laneAdjustment;
  if (adjustment == null) return;
  if (p.lanes < 2)
    throw Error('Squeeze and Spread need at least two lanes.');
  if (
    adjustment.version !== 1 ||
    !['squeeze', 'spread'].includes(adjustment.mode) ||
    !['centre', 'inner'].includes(adjustment.anchor)
  ) throw Error('Choose a valid lane adjustment and alignment.');
  if (adjustment.anchor === 'inner' && p.kind !== 'curve')
    throw Error('Only a circular corner can keep the innermost lane fixed.');
  const target = adjustment.spacingMm;
  if (!Number.isFinite(target) || target <= 0 || target > 1000)
    throw Error('Set the middle lane spacing above zero and at most 1000 mm.');
  if (adjustment.mode === 'squeeze' ? target >= p.laneSpacing : target <= p.laneSpacing)
    throw Error(adjustment.mode === 'squeeze'
      ? 'Squeezed middle spacing must be smaller than the normal spacing.'
      : 'Spread middle spacing must be greater than the normal spacing.');
  const half = p.slotWidth / 2 + braidSpan(p);
  if (Math.min(target, p.laneSpacing) <= half * 2)
    throw Error('The braid recesses and guide slots touch. Increase the middle or normal lane spacing.');
  for (const i of [0, p.lanes - 1]) {
    for (const t of [0, 0.5]) {
      if (Math.abs(laneOffsetAt(p, i, t)) + half >= p.width / 2)
        throw Error('The guide slot or braid recess reaches the edge of the road. Reduce the spread or widen the road.');
    }
  }
}

// Bound the lateral chord error on a straight. abs(blend'') is at most 24;
// maxima at the middle and endpoints are sampled exactly.
export function laneProfileSteps(p) {
  const travel = Math.max(...[0, p.lanes - 1].map(i =>
    Math.abs(laneOffsetAt(p, i, 0.5) - laneOffsetAt(p, i, 0))));
  return 2 * Math.max(16, Math.ceil(Math.sqrt(24 * travel / (8 * 0.015)) / 2));
}

export function validateLaneBends(p, points) {
  const halfWidth = p.slotWidth / 2 + Math.max(
    braidSpan(p), p.hollow ? p.wall : 0,
  );
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const ax = x - points[i-1][0], ay = y - points[i-1][1];
    const bx = points[i+1][0] - x, by = points[i+1][1] - y;
    // The circumcircle through three consecutive stations estimates the
    // local radius. The channel's inside edge reverses if it reaches its centre.
    const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.hypot(ax+bx, ay+by);
    if (2 * Math.abs(ax*by - ay*bx) * halfWidth >= 0.99 * denominator)
      throw Error('The guide slot or braid recess folds in the transition. Use a longer piece or a gentler spacing change.');
  }
}
