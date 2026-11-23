import { braidSpan } from './geometry/solids.js';
import {
  SLOT_AND_SQUEEZE,
  hasSlotPosition,
  slotForm,
  slotLaneOffsetAt,
  slotLaneOffsetDerivatives,
  slotShiftAt,
} from './slot-position.js';

// Sideways travel of one lane at the middle of a squeeze or spread.
function squeezeTravel(p, index) {
  const adjustment = p.laneAdjustment;
  if (!adjustment) return 0;
  const anchor = adjustment.anchor === 'inner' ? 0 : (p.lanes - 1) / 2;
  return (index - anchor) * (adjustment.spacingMm - p.laneSpacing);
}

// The Circuit profile has zero first and second derivatives at both ends.
// t is distance along the unadjusted road centreline, including print seams.
// An off-centre slot sets every lane itself; a piece never has both.
export function laneOffsetAt(p, index, t) {
  if (hasSlotPosition(p)) return slotLaneOffsetAt(p, index, t);
  const normal = (index - (p.lanes - 1) / 2) * p.laneSpacing;
  if (!p.laneAdjustment || t === 0 || t === 1) return normal;
  const blend = 64 * (t * (1 - t)) ** 3;
  return normal + squeezeTravel(p, index) * blend;
}

/** First and second derivative of laneOffsetAt with respect to t. */
export function laneOffsetDerivatives(p, index, t) {
  if (hasSlotPosition(p)) return slotLaneOffsetDerivatives(p, index, t);
  const travel = squeezeTravel(p, index);
  // 0 + keeps a zero travel from reporting -0, as it always has.
  return [
    0 + travel * 192 * t ** 2 * (1 - t) ** 2 * (1 - 2 * t),
    0 + travel * 384 * t * (1 - t) * (1 - 5 * t + 5 * t ** 2),
  ];
}

export function validateLaneAdjustment(p) {
  const adjustment = p.laneAdjustment;
  if (adjustment == null) return;
  if (hasSlotPosition(p)) throw Error(SLOT_AND_SQUEEZE);
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
  // A spread peaks mid-way and a moving slot at one end; together they can
  // peak anywhere in between.
  for (const i of [0, p.lanes - 1]) {
    for (let k = 0; k <= 16; k++) {
      if (Math.abs(laneOffsetAt(p, i, k / 16)) + half >= p.width / 2)
        throw Error('The guide slot or braid recess reaches the edge of the road. Reduce the spread or widen the road.');
    }
  }
}

// Bound the lateral chord error on a straight. abs(blend'') is at most 24 and
// the slot transition's second derivative at most 10 / sqrt(3) times its move.
// Set lane by lane, the lane that moves furthest decides.
export function laneProfileSteps(p) {
  const each = slotForm(p) === 'each';
  const lanes = Array.from({ length: p.lanes }, (_, i) => i);
  const travel = each ? 0 : Math.max(...[0, p.lanes - 1].map(i => Math.abs(
    laneOffsetAt(p, i, 0.5) - slotShiftAt(p, 0.5) - (laneOffsetAt(p, i, 0) - slotShiftAt(p, 0)))));
  const move = each
    ? Math.max(...lanes.map(i => Math.abs(slotLaneOffsetAt(p, i, 1) - slotLaneOffsetAt(p, i, 0))))
    : Math.abs(slotShiftAt(p, 1) - slotShiftAt(p, 0));
  return 2 * Math.max(16, Math.ceil(Math.sqrt((24 * travel + 5.7736 * move) / (8 * 0.015)) / 2));
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
