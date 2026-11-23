import { braidSpan } from './geometry/solids.js';

// Slot position: a single-lane piece may carry its guide slot off-centre.
//   p.slotPosition = { version: 1, edge: 'outer' | 'inner', startMm, endMm }
// Absent means centred. 'outer' is the +offset side: left of travel from end A
// to end B on a straight, the outer edge of a curve. startMm and endMm are the
// distance from that edge to the slot centre at end A (t = 0) and end B (t = 1).

/** Below this radius a guide blade binds in the slot: the piece is refused. */
export const SLOT_MIN_RADIUS = 40;
/** Rule of thumb for a bend that every car takes without slowing. */
export const SLOT_GENTLE_RADIUS = 150;

// Largest slope and curvature of the transition S(t) = 10t^3 - 15t^4 + 6t^5.
const STEEPEST = 1.875;
const SHARPEST = 10 / Math.sqrt(3);

export const hasSlotPosition = (p) => p?.slotPosition != null;

export const slotVaries = (p) =>
  hasSlotPosition(p) && p.slotPosition.startMm !== p.slotPosition.endMm;

/** True when a lane offset changes along the piece: squeeze, spread or a moving slot. */
export const lanesVary = (p) => Boolean(p.laneAdjustment) || slotVaries(p);

const sideSign = (edge) => (edge === 'outer' ? 1 : -1);
const shiftOf = (p, mm) => sideSign(p.slotPosition.edge) * (p.width / 2 - mm);

/** Signed distance of the lane from the road centre, positive towards 'outer'. */
export function slotShiftAt(p, t) {
  if (!hasSlotPosition(p)) return 0;
  const { startMm, endMm } = p.slotPosition;
  const s0 = shiftOf(p, startMm);
  if (t <= 0 || startMm === endMm) return s0;
  const s1 = shiftOf(p, endMm);
  if (t >= 1) return s1;
  return s0 + (s1 - s0) * (t * t * t * (10 + t * (6 * t - 15)));
}

/** First and second derivative of slotShiftAt with respect to t. */
export function slotShiftDerivatives(p, t) {
  if (!slotVaries(p) || t <= 0 || t >= 1) return [0, 0];
  const change = shiftOf(p, p.slotPosition.endMm) - shiftOf(p, p.slotPosition.startMm);
  return [
    change * 30 * t * t * (1 - t) * (1 - t),
    change * 60 * t * (1 - t) * (1 - 2 * t),
  ];
}

/** Distance from each road edge to the slot centre at both ends, as typed. */
export function slotEnds(p) {
  const s = p.slotPosition;
  const end = (mm) => {
    if (s == null) return { outer: p.width / 2, inner: p.width / 2 };
    const far = p.width - mm;
    return s.edge === 'outer' ? { outer: mm, inner: far } : { outer: far, inner: mm };
  };
  return { start: end(s?.startMm), end: end(s?.endMm) };
}

/** Half the width of everything a lane cuts or needs under the deck. */
export function slotChannelHalf(p) {
  return p.slotWidth / 2 + Math.max(braidSpan(p), p.hollow ? p.wall : 0);
}

/** Thinnest wall left between a bare slot (no braids, solid piece) and the road edge. */
const SLOT_SIDE_WALL = 2;

/**
 * Allowed distance from a road edge to the slot centre: 1 mm of printable
 * margin beyond the braids or shell wall, and never less than a 2 mm wall
 * beside the slot itself, which takes the guide's push in corners.
 */
export function slotRange(p) {
  const min = Math.max(slotChannelHalf(p) + 1, p.slotWidth / 2 + SLOT_SIDE_WALL);
  return { min, max: p.width - min };
}

/**
 * The room as people can type it: typed distances settle on half millimetres,
 * so the limits shown are the nearest half millimetres inside slotRange.
 */
export function slotRoom(p) {
  const { min, max } = slotRange(p);
  return { min: Math.ceil(min * 2 - 1e-9) / 2, max: Math.floor(max * 2 + 1e-9) / 2 };
}

const trimmed = (n) => String(Number(n.toFixed(2)));

/** The name people use for a road edge: sides on a straight, bend sides on a curve. */
export function slotEdgeName(p, edge = p.slotPosition?.edge) {
  if (p.kind === 'curve') return edge === 'outer' ? 'outer' : 'inner';
  return edge === 'outer' ? 'left' : 'right';
}

/**
 * Short text for a piece name: '' when centred, otherwise the distances and
 * the edge they are measured from, '35 from inner' or '35-145 from left'. The
 * edge keeps a piece and its mirror image apart.
 */
export function slotLabel(p) {
  if (!hasSlotPosition(p)) return '';
  const { startMm, endMm } = p.slotPosition;
  return (
    (startMm === endMm ? trimmed(startMm) : trimmed(startMm) + '-' + trimmed(endMm)) +
    ' from ' + slotEdgeName(p)
  );
}

// The slot of a straight is the curve [length * t, shift(t)]. Its curvature is
// largest away from the middle, and a steep slot is straighter than its
// second derivative suggests, so measure the real curve.
function tightestRadius(length, change) {
  let sharpest = 0;
  for (let i = 1; i < 512; i++) {
    const t = i / 1024;
    const speed = change * 30 * t * t * (1 - t) * (1 - t);
    const bend = change * 60 * t * (1 - t) * (1 - 2 * t);
    sharpest = Math.max(sharpest, Math.abs(length * bend) / Math.hypot(length, speed) ** 3);
  }
  return sharpest ? 1 / sharpest : Infinity;
}

/**
 * How hard the slot itself turns.
 *   minRadius  tightest radius of the slot centre line in mm (Infinity when straight)
 *   angle      steepest angle between the slot and the road, in degrees
 */
export function slotBend(p) {
  if (!hasSlotPosition(p)) return { minRadius: p.kind === 'curve' ? p.radius : Infinity, angle: 0 };
  if (p.kind === 'curve') return { minRadius: p.radius + slotShiftAt(p, 0), angle: 0 };
  const change = slotShiftAt(p, 1) - slotShiftAt(p, 0);
  if (!change) return { minRadius: Infinity, angle: 0 };
  return {
    minRadius: tightestRadius(p.length, change),
    angle: (Math.atan(STEEPEST * Math.abs(change) / p.length) * 180) / Math.PI,
  };
}

/** Shortest straight, in whole mm, whose slot never bends tighter than radius. */
export function slotLengthFor(p, radius) {
  const change = Math.abs(slotShiftAt(p, 1) - slotShiftAt(p, 0));
  if (!change) return 0;
  // A shallow slot has curvature of at most SHARPEST * change / length^2.
  let short = 0, long = Math.sqrt(SHARPEST * change * radius);
  for (let i = 0; i < 40; i++) {
    const middle = (short + long) / 2;
    if (tightestRadius(middle, change) >= radius) long = middle;
    else short = middle;
  }
  return Math.ceil(long - 1e-6);
}

/**
 * On a curve, where the slot must sit for its own radius to be at least
 * `radius`, said in the edge the piece is measured from: 'at least 52 mm
 * from the inner edge' or 'at most 148 mm from the outer edge'. '' when no
 * slot position on this road reaches that radius.
 */
export function curveSlotAdvice(p, radius) {
  // The slot radius is the centre-line radius plus the shift towards outer.
  const fromInner = Math.ceil(2 * (radius - p.radius + p.width / 2) - 1e-9) / 2;
  if (!(fromInner <= slotRoom(p).max)) return '';
  const edge = p.slotPosition?.edge ?? 'inner';
  return edge === 'inner'
    ? 'at least ' + trimmed(fromInner) + ' mm from the inner edge'
    : 'at most ' + trimmed(p.width - fromInner) + ' mm from the outer edge';
}

export function validateSlotPosition(p) {
  const s = p.slotPosition;
  if (s == null) return;
  if (
    typeof s !== 'object' ||
    s.version !== 1 ||
    !['outer', 'inner'].includes(s.edge) ||
    !Number.isFinite(s.startMm) ||
    !Number.isFinite(s.endMm)
  ) throw Error('Choose a valid slot position: an edge, and a distance for end A and end B.');
  if (p.special)
    throw Error('Special pieces define their own lanes. Set Slot position to Centred.');
  if (!['straight', 'curve'].includes(p.kind))
    throw Error('Slot position works on plain straights and curves only. Freeform pieces and imported drawings keep the slot where it is drawn.');
  if (p.lanes !== 1)
    throw Error('Slot position is for single-lane pieces. Set Lanes to 1, or set Slot position to Centred.');
  if (p.kind === 'curve' && s.startMm !== s.endMm)
    throw Error('On a curve the slot must be the same distance from the edge at end A and end B. Use a straight to move the slot sideways.');
  const { min, max } = slotRange(p);
  if (!(min <= max))
    throw Error('This road is too narrow for an off-centre slot. Widen the road, or set Slot position to Centred.');
  // The transition never overshoots, so the two ends bound every station.
  for (const [mm, end] of [[s.startMm, 'end A'], [s.endMm, 'end B']]) {
    if (mm >= min - 1e-9 && mm <= max + 1e-9) continue;
    const room = slotRoom(p);
    throw Error(
      'The slot ' + (s.startMm === s.endMm ? '' : 'at ' + end + ' ') + 'is ' + trimmed(mm) + ' mm from the ' +
      slotEdgeName(p) + ' edge. Keep it between ' + trimmed(room.min) + ' and ' + trimmed(room.max) +
      ' mm so the slot and braids stay on the road.',
    );
  }
  if (p.kind === 'curve') {
    // The inside of the channel shrinks to a point as the slot nears the
    // centre of the bend. Keep it at least as wide as the channel itself.
    if (p.radius + slotShiftAt(p, 0) < 2 * slotChannelHalf(p)) {
      const where = curveSlotAdvice(p, 2 * slotChannelHalf(p));
      throw Error(
        'The slot is too close to the centre of the bend. ' +
          (where ? 'Keep it ' + where + ', or use a larger radius.' : 'Use a larger radius.'),
      );
    }
  } else if (s.startMm !== s.endMm && slotBend(p).minRadius < SLOT_MIN_RADIUS) {
    throw Error(
      "The slot moves sideways too sharply for a car's guide to follow. Use a piece at least " +
      slotLengthFor(p, SLOT_MIN_RADIUS) + ' mm long, or a smaller sideways move.',
    );
  }
}
