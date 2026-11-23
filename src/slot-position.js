import { braidSpan } from './geometry/solids.js';

// Slot position: a straight or curve may carry its guide slots off-centre.
// Absent means centred. 'outer' is the +offset side: left of travel from end A
// (t = 0) to end B (t = 1) on a straight, the outer edge of a curve.
//
// Lanes move together (the only form for one lane):
//   p.slotPosition = { version: 1, edge, startMm, endMm }
//   startMm and endMm are the distance from that edge to the slot nearest it
//   at end A and end B. The other slots follow away from the edge every
//   p.laneSpacing mm.
// Each lane set (two or more lanes):
//   p.slotPosition = { version: 1, edge, lanes: [{ startMm, endMm }, ...] }
//   One entry per lane, entry 0 the slot nearest the edge, every distance
//   measured from that edge. p.laneSpacing plays no part.
// Between the ends every slot follows S(t) = 10t^3 - 15t^4 + 6t^5.

/** Below this radius a guide blade binds in the slot: the piece is refused. */
export const SLOT_MIN_RADIUS = 40;
/** Rule of thumb for a bend that every car takes without slowing. */
export const SLOT_GENTLE_RADIUS = 150;

// Largest slope and curvature of the transition S(t) = 10t^3 - 15t^4 + 6t^5.
const STEEPEST = 1.875;
const SHARPEST = 10 / Math.sqrt(3);

const blend = (t) => t * t * t * (10 + t * (6 * t - 15));

export const hasSlotPosition = (p) => p?.slotPosition != null;

/** 'none' when centred, 'together' when the lanes move as one, 'each' when every lane is set. */
export const slotForm = (p) =>
  !hasSlotPosition(p) ? 'none' : Array.isArray(p.slotPosition.lanes) ? 'each' : 'together';

const laneCount = (p) => (p.lanes > 1 ? Number(p.lanes) : 1);
// How far the slot nearest an edge sits outside the middle of the lane pack.
const packHalf = (p) => (laneCount(p) > 1 ? ((p.lanes - 1) / 2) * p.laneSpacing : 0);
const sideSign = (edge) => (edge === 'outer' ? 1 : -1);
const shiftOf = (p, mm) => sideSign(p.slotPosition.edge) * (p.width / 2 - mm);
// Entry k of an 'each' list is counted from the edge; lane indices grow towards 'outer'.
const entryOf = (p, index) => (p.slotPosition.edge === 'outer' ? laneCount(p) - 1 - index : index);
const entries = (p) => (Array.isArray(p.slotPosition.lanes) ? p.slotPosition.lanes : []);

export const slotVaries = (p) => {
  const form = slotForm(p);
  if (form === 'together') return p.slotPosition.startMm !== p.slotPosition.endMm;
  return form === 'each' && entries(p).some((e) => e?.startMm !== e?.endMm);
};

/** True when a lane offset changes along the piece: squeeze, spread or a moving slot. */
export const lanesVary = (p) => Boolean(p.laneAdjustment) || slotVaries(p);

function entryOffsetAt(p, e, t) {
  // + 0: a slot on the centre line is at 0, never -0.
  const s0 = shiftOf(p, e.startMm) + 0;
  if (t <= 0 || e.startMm === e.endMm) return s0;
  const s1 = shiftOf(p, e.endMm) + 0;
  if (t >= 1) return s1;
  return s0 + (s1 - s0) * blend(t);
}

function entryDerivatives(p, e, t) {
  if (e.startMm === e.endMm || t <= 0 || t >= 1) return [0, 0];
  const change = shiftOf(p, e.endMm) - shiftOf(p, e.startMm);
  return [
    change * 30 * t * t * (1 - t) * (1 - t),
    change * 60 * t * (1 - t) * (1 - 2 * t),
  ];
}

/**
 * Signed distance of the middle of the lane pack from the road centre,
 * positive towards 'outer'. Every lane of the 'together' form (and the one
 * lane of a single-lane piece) is shifted by exactly this. For 'each' it is
 * the mean of the lanes: use slotLaneOffsetAt there.
 */
export function slotShiftAt(p, t) {
  const form = slotForm(p);
  if (form === 'none') return 0;
  if (form === 'each') {
    const list = entries(p);
    return list.reduce((sum, e) => sum + entryOffsetAt(p, e, t), 0) / list.length;
  }
  const { startMm, endMm } = p.slotPosition;
  const half = packHalf(p);
  const s0 = shiftOf(p, startMm + half);
  if (t <= 0 || startMm === endMm) return s0;
  const s1 = shiftOf(p, endMm + half);
  if (t >= 1) return s1;
  return s0 + (s1 - s0) * blend(t);
}

/** First and second derivative of slotShiftAt with respect to t. */
export function slotShiftDerivatives(p, t) {
  if (!slotVaries(p) || t <= 0 || t >= 1) return [0, 0];
  if (slotForm(p) === 'each') {
    const list = entries(p);
    const sum = list.map((e) => entryDerivatives(p, e, t))
      .reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
    return [sum[0] / list.length, sum[1] / list.length];
  }
  const half = packHalf(p);
  const change = shiftOf(p, p.slotPosition.endMm + half) - shiftOf(p, p.slotPosition.startMm + half);
  return [
    change * 30 * t * t * (1 - t) * (1 - t),
    change * 60 * t * (1 - t) * (1 - 2 * t),
  ];
}

/** Signed offset of lane `index` from the road centre at t, positive towards 'outer'. */
export function slotLaneOffsetAt(p, index, t) {
  const form = slotForm(p);
  if (form === 'each') return entryOffsetAt(p, entries(p)[entryOf(p, index)], t);
  const nominal = laneCount(p) > 1 ? (index - (p.lanes - 1) / 2) * p.laneSpacing : 0;
  return form === 'none' ? nominal : nominal + slotShiftAt(p, t);
}

/** First and second derivative of slotLaneOffsetAt with respect to t. */
export function slotLaneOffsetDerivatives(p, index, t) {
  const form = slotForm(p);
  if (form === 'each') return entryDerivatives(p, entries(p)[entryOf(p, index)], t);
  return slotShiftDerivatives(p, t);
}

/**
 * Distance from p.slotPosition.edge to every slot at t, nearest the edge
 * first. Exact as stored at t <= 0 and t >= 1. [] when centred.
 */
export function slotDistances(p, t) {
  const form = slotForm(p);
  if (form === 'none') return [];
  if (form === 'each')
    return entries(p).map((e) =>
      t <= 0 ? e?.startMm
        : t >= 1 ? e?.endMm
        : e?.startMm === e?.endMm ? e.startMm
        : e?.startMm + (e?.endMm - e?.startMm) * blend(t));
  const { edge, startMm, endMm } = p.slotPosition;
  const first = t <= 0 ? startMm : t >= 1 ? endMm
    : p.width / 2 - sideSign(edge) * slotShiftAt(p, t) - packHalf(p);
  return Array.from({ length: laneCount(p) }, (_, k) => (k ? first + k * p.laneSpacing : first));
}

/** Gaps between neighbouring slots at t, in the order of slotDistances. */
export const slotGaps = (p, t) => {
  const d = slotDistances(p, t);
  return d.slice(1).map((mm, k) => mm - d[k]);
};

/**
 * Distance from each road edge to every slot at both ends, nearest that edge
 * first: { start: { outer: [...], inner: [...] }, end: { ... } }.
 */
export function slotEndLists(p) {
  const at = (t) => {
    if (!hasSlotPosition(p)) {
      const n = laneCount(p);
      const offsets = Array.from({ length: n }, (_, i) => slotLaneOffsetAt(p, i, t));
      return {
        outer: offsets.map((o) => p.width / 2 - o).reverse(),
        inner: offsets.map((o) => p.width / 2 + o),
      };
    }
    const near = slotDistances(p, t);
    const far = near.map((mm) => p.width - mm).reverse();
    return p.slotPosition.edge === 'outer' ? { outer: near, inner: far } : { outer: far, inner: near };
  };
  return { start: at(0), end: at(1) };
}

/** Distance from each road edge to the slot nearest it, at both ends. */
export function slotEnds(p) {
  const s = p.slotPosition;
  if (laneCount(p) > 1 || slotForm(p) === 'each') {
    const lists = slotEndLists(p);
    const nearest = (end) => ({ outer: end.outer[0], inner: end.inner[0] });
    return { start: nearest(lists.start), end: nearest(lists.end) };
  }
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

/** Width of a slot with its braids: neighbouring slots stay further apart than this. */
export const slotLaneEnvelope = (p) => p.slotWidth + 2 * braidSpan(p);

/** Thinnest wall left between a bare slot (no braids, solid piece) and the road edge. */
const SLOT_SIDE_WALL = 2;

/**
 * Allowed distance from a road edge to a slot centre: 1 mm of printable
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
 * the edge they are measured from, '35 from inner' or '35-145 from left'.
 * Several lanes list every slot at each end: '35/135-55/155 from left'. The
 * edge keeps a piece and its mirror image apart.
 */
export function slotLabel(p) {
  if (!hasSlotPosition(p)) return '';
  const a = slotDistances(p, 0), b = slotDistances(p, 1);
  const list = (ds) => ds.map(trimmed).join('/');
  const same = a.every((mm, k) => mm === b[k]);
  return (same ? list(a) : list(a) + '-' + list(b)) + ' from ' + slotEdgeName(p);
}

/** '' when centred, else 'slot 35-145 from left', or 'slots ...' for several lanes. */
export function slotTitle(p) {
  const label = slotLabel(p);
  if (!label) return '';
  return (slotDistances(p, 0).length > 1 ? 'slots ' : 'slot ') + label;
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
 * The slot that moves furthest sideways: { change, slot }, change in mm and
 * slot its place in slotDistances (0 is nearest the edge).
 */
export function slotWidestMove(p) {
  if (slotForm(p) !== 'each') return { change: Math.abs(slotShiftAt(p, 1) - slotShiftAt(p, 0)), slot: 0 };
  let widest = { change: 0, slot: 0 };
  for (const [slot, e] of entries(p).entries()) {
    const change = Math.abs(e.endMm - e.startMm);
    if (change > widest.change) widest = { change, slot };
  }
  return widest;
}

/** Place in slotDistances (0 is nearest the edge) of the slot nearest the centre of a bend. */
export const slotInnermost = (p) =>
  p.slotPosition?.edge === 'outer' ? Math.max(0, slotDistances(p, 0).length - 1) : 0;

/**
 * How hard the slots turn, for the worst slot.
 *   minRadius  tightest radius of a slot centre line in mm (Infinity when straight)
 *   angle      steepest angle between a slot and the road, in degrees
 */
export function slotBend(p) {
  if (!hasSlotPosition(p)) return { minRadius: p.kind === 'curve' ? p.radius : Infinity, angle: 0 };
  if (p.kind === 'curve') {
    // The slot nearest the centre of the bend has the smallest radius.
    const inside = laneCount(p) > 1 || slotForm(p) === 'each' ? slotLaneOffsetAt(p, 0, 0) : slotShiftAt(p, 0);
    return { minRadius: p.radius + inside, angle: 0 };
  }
  const { change } = slotWidestMove(p);
  if (!change) return { minRadius: Infinity, angle: 0 };
  return {
    minRadius: tightestRadius(p.length, change),
    angle: (Math.atan(STEEPEST * Math.abs(change) / p.length) * 180) / Math.PI,
  };
}

/** Shortest straight, in whole mm, whose slots never bend tighter than radius. */
export function slotLengthFor(p, radius) {
  const { change } = slotWidestMove(p);
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

// Distance from the point at t on slot curve f to slot curve g, on a straight
// of this length. Beyond the ends both slots carry on straight, as they do in
// the next piece. The nearest point is within |g(t) - f(t)| of t along the road.
function reachAt(f, g, length, t) {
  const y = f(t);
  const at = (u) => Math.hypot(length * (u - t), g(u) - y);
  const window = Math.abs(g(t) - y) / length;
  let best = at(t), nearest = t;
  const n = 16;
  for (let i = -n; i <= n; i++) {
    const u = t + (window * i) / n, d = at(u);
    if (d < best) [best, nearest] = [d, u];
  }
  let lo = nearest - window / n, hi = nearest + window / n;
  for (let i = 0; i < 30 && hi - lo > 1e-9; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (at(a) < at(b)) hi = b;
    else lo = a;
  }
  return Math.min(best, at((lo + hi) / 2));
}

// Narrowest distance between two slot centre curves along a straight.
function pairClearance(f, g, length) {
  const n = 96;
  let best = Infinity, where = 0;
  for (let i = 0; i <= n; i++) {
    const d = reachAt(f, g, length, i / n);
    if (d < best) [best, where] = [d, i / n];
  }
  let lo = Math.max(0, where - 1 / n), hi = Math.min(1, where + 1 / n);
  for (let i = 0; i < 30 && hi - lo > 1e-7; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (reachAt(f, g, length, a) < reachAt(f, g, length, b)) hi = b;
    else lo = a;
  }
  return Math.min(best, reachAt(f, g, length, (lo + hi) / 2));
}

/**
 * Narrowest spacing between each pair of neighbouring slot centre lines,
 * measured square to the slots, in the order of slotGaps. A slot that runs
 * at an angle comes closer to its neighbour than the ends show. `length`
 * lets a caller try another length of straight.
 */
export function slotClearances(p, length = p.length) {
  const gaps = slotGaps(p, 0);
  if (!gaps.length) return [];
  const ends = slotGaps(p, 1);
  if (p.kind !== 'straight' || !slotVaries(p)) return gaps.map((gap, k) => Math.min(gap, ends[k]));
  const a = slotDistances(p, 0), b = slotDistances(p, 1);
  const curve = (k) => (u) => (u <= 0 ? a[k] : u >= 1 ? b[k] : a[k] + (b[k] - a[k]) * blend(u));
  return gaps.map((_, k) => pairClearance(curve(k), curve(k + 1), length));
}

/** The narrowest neighbour spacing: { mm, slot } with slot the first of the pair (0 nearest the edge). */
export function slotClearance(p, length = p.length) {
  let narrowest = { mm: Infinity, slot: 0 };
  for (const [slot, mm] of slotClearances(p, length).entries())
    if (mm < narrowest.mm) narrowest = { mm, slot };
  return narrowest;
}

/**
 * Shortest straight, in whole mm, on which every neighbour pair keeps
 * fits(clearance, pair) true. 0 when the piece does not move its slots,
 * Infinity when no length helps.
 */
export function slotLengthForClearance(p, fits) {
  if (p.kind !== 'straight' || !slotVaries(p) || slotDistances(p, 0).length < 2) return 0;
  const ok = (length) => slotClearances(p, length).every((mm, k) => fits(mm, k));
  let short = 0, long = Math.max(1, p.length);
  while (!ok(long)) {
    short = long;
    long *= 2;
    if (long > 1e6) return Infinity;
  }
  for (let i = 0; i < 30 && long - short > 0.25; i++) {
    const middle = (short + long) / 2;
    if (ok(middle)) long = middle;
    else short = middle;
  }
  // Settle on the shortest whole millimetre that works.
  let whole = Math.max(1, Math.ceil(short));
  while (!ok(whole)) whole++;
  return whole;
}

/**
 * On a curve, where the slot nearest the centre of the bend must sit for its
 * own radius to be at least `radius`, said in the edge the piece is measured
 * from: 'at least 52 mm from the inner edge' or 'at most 148 mm from the
 * outer edge'. '' when no slot position on this road reaches that radius.
 */
export function curveSlotAdvice(p, radius) {
  const fromInner = curveSlotFromInner(p, radius);
  if (fromInner == null) return '';
  const edge = p.slotPosition?.edge ?? 'inner';
  return edge === 'inner'
    ? 'at least ' + trimmed(fromInner) + ' mm from the inner edge'
    : 'at most ' + trimmed(p.width - fromInner) + ' mm from the outer edge';
}

// Where the slot nearest the centre of the bend must sit, from the inner
// edge, for its radius to be at least `radius`; null when it cannot.
function curveSlotFromInner(p, radius) {
  // The slot radius is the centre-line radius plus the shift towards outer.
  const fromInner = Math.ceil(2 * (radius - p.radius + p.width / 2) - 1e-9) / 2;
  // The other slots still need their room outside it.
  const inner = slotEndLists(p).start.inner;
  const span = inner.length > 1 ? inner.at(-1) - inner[0] : 0;
  return fromInner + span <= slotRoom(p).max ? fromInner : null;
}

/**
 * Lanes moving together are set by slot 1 alone. When curveSlotAdvice names
 * another slot, the same limit said for slot 1, as a sentence that starts
 * with a space: ' With the lanes moving together, keep slot 1 at most 91 mm
 * from the outer edge.' '' when the advice is already about slot 1.
 */
export function curveSlotOneAdvice(p, radius) {
  const k = slotInnermost(p);
  if (slotForm(p) !== 'together' || !k) return '';
  const fromInner = curveSlotFromInner(p, radius);
  if (fromInner == null) return '';
  return ' With the lanes moving together, keep slot 1 at most ' +
    trimmed(p.width - fromInner - k * p.laneSpacing) + ' mm from the ' + slotEdgeName(p) + ' edge.';
}

/** Why a piece cannot both squeeze its lanes and move its slots. */
export const SLOT_AND_SQUEEZE =
  'A piece can squeeze or spread its lanes, or move its slots, not both. ' +
  'Choose one: turn off Squeeze / spread lanes, or set Slot position to Centred.';

const wellFormed = (s) => {
  if (typeof s !== 'object' || s.version !== 1 || !['outer', 'inner'].includes(s.edge)) return false;
  if (Array.isArray(s.lanes))
    return !('startMm' in s) && !('endMm' in s) && s.lanes.length > 0 &&
      s.lanes.every((e) => e && Number.isFinite(e.startMm) && Number.isFinite(e.endMm));
  return Number.isFinite(s.startMm) && Number.isFinite(s.endMm);
};

const endName = (t) => (t ? 'end B' : 'end A');

export function validateSlotPosition(p) {
  const s = p.slotPosition;
  if (s == null) return;
  const each = Array.isArray(s?.lanes);
  if (!wellFormed(s))
    throw Error(each
      ? 'Choose a valid slot position: an edge, and a distance for every slot at end A and end B.'
      : 'Choose a valid slot position: an edge, and a distance for end A and end B.');
  if (p.special)
    throw Error('Special pieces define their own lanes. Set Slot position to Centred.');
  if (!['straight', 'curve'].includes(p.kind))
    throw Error('Slot position works on plain straights and curves only. Freeform pieces and imported drawings keep the slot where it is drawn.');
  if (each && !(p.lanes >= 2))
    throw Error('Set each lane needs two or more lanes. A single lane uses Lanes move together.');
  if (each && s.lanes.length !== p.lanes)
    throw Error(
      'Give every lane its own slot position: this piece has ' + p.lanes + ' lanes and ' +
      s.lanes.length + ' slot positions.',
    );
  if (p.laneAdjustment) throw Error(SLOT_AND_SQUEEZE);
  const single = slotDistances(p, 0).length === 1;
  if (p.kind === 'curve' && slotVaries(p))
    throw Error(single
      ? 'On a curve the slot must be the same distance from the edge at end A and end B. Use a straight to move the slot sideways.'
      : 'On a curve every slot must be the same distance from the edge at end A and end B. Use a straight to move the slots sideways.');
  const { min, max } = slotRange(p);
  if (!(min <= max))
    throw Error('This road is too narrow for an off-centre slot. Widen the road, or set Slot position to Centred.');
  const varies = slotVaries(p);
  const ends = [slotDistances(p, 0), slotDistances(p, 1)];
  // The transition never overshoots, so the two ends bound every station.
  for (const t of [0, 1]) {
    for (const [k, mm] of ends[t].entries()) {
      if (mm >= min - 1e-9 && mm <= max + 1e-9) continue;
      const room = slotRoom(p);
      const keep = ' mm from the ' + slotEdgeName(p) + ' edge. Keep it between ' + trimmed(room.min) +
        ' and ' + trimmed(room.max) + ' mm so the slot and braids stay on the road.';
      const moves = ends[0][k] !== ends[1][k];
      const at = moves ? 'at ' + endName(t) + ' ' : '';
      // Moving together, only slot 1 can be typed: say its limit too.
      const top = room.max - (ends[t].length - 1) * p.laneSpacing;
      const first = !single && !each && mm > max && top >= room.min
        ? ' With the lanes moving together, keep slot 1 ' + at + 'at most ' + trimmed(top) +
          ' mm from the ' + slotEdgeName(p) + ' edge.'
        : '';
      throw Error(single
        ? 'The slot ' + at + 'is ' + trimmed(mm) + keep
        : 'Slot ' + (k + 1) + ' ' + at + 'is ' + trimmed(mm) + keep + first);
    }
  }
  const envelope = slotLaneEnvelope(p);
  if (each) {
    for (const t of varies ? [0, 1] : [0]) {
      const at = varies ? 'At ' + endName(t) + ' s' : 'S';
      for (let k = 1; k < ends[t].length; k++) {
        const gap = ends[t][k] - ends[t][k - 1];
        if (gap <= 0)
          throw Error(
            (varies ? 'At ' + endName(t) + ' slot ' : 'Slot ') + (k + 1) + ' is not further from the ' +
            slotEdgeName(p) + ' edge than slot ' + k + '. Number the slots from the ' + slotEdgeName(p) +
            ' edge, slot 1 nearest it: lanes never cross.',
          );
        if (gap <= envelope)
          throw Error(
            at + 'lots ' + k + ' and ' + (k + 1) + ' are only ' + trimmed(gap) + ' mm apart. Keep neighbouring slots more than ' +
            trimmed(envelope) + ' mm apart so their braids do not meet.',
          );
      }
    }
  }
  if (p.kind === 'curve') {
    // The inside of the channel shrinks to a point as the slot nears the
    // centre of the bend. Keep it at least as wide as the channel itself.
    if (slotBend(p).minRadius < 2 * slotChannelHalf(p)) {
      const where = curveSlotAdvice(p, 2 * slotChannelHalf(p));
      throw Error(
        (single ? 'The slot is' : 'Slot ' + (slotInnermost(p) + 1) + ' is') +
          ' too close to the centre of the bend. ' +
          (where ? 'Keep it ' + where + ', or use a larger radius.' + curveSlotOneAdvice(p, 2 * slotChannelHalf(p))
            : 'Use a larger radius.'),
      );
    }
    return;
  }
  if (!varies) return;
  // Together, the spacing itself is checked with the road (validateTrack).
  const spaced = !single && (each || envelope < p.laneSpacing);
  if (slotBend(p).minRadius < SLOT_MIN_RADIUS) {
    // One slot is named only when it moves further than another.
    const start = slotGaps(p, 0), finish = slotGaps(p, 1);
    const alike = start.every((gap, k) => gap === finish[k]);
    const subject = single ? 'The slot moves'
      : each && !alike ? 'Slot ' + (slotWidestMove(p).slot + 1) + ' moves'
      : 'The slots move';
    // Suggest a length that keeps the neighbours apart as well.
    const apart = spaced ? slotLengthForClearance(p, (gap) => gap > envelope) : 0;
    const length = Math.max(slotLengthFor(p, SLOT_MIN_RADIUS), Number.isFinite(apart) ? apart : 0);
    throw Error(
      subject + " sideways too sharply for a car's guide to follow. Use a piece at least " +
      length + ' mm long, or a smaller sideways move.',
    );
  }
  if (!spaced) return;
  const { mm, slot } = slotClearance(p);
  if (mm > envelope) return;
  const length = slotLengthForClearance(p, (gap) => gap > envelope);
  throw Error(
    'Along the piece slots ' + (slot + 1) + ' and ' + (slot + 2) + ' come within ' + trimmed(mm) +
    ' mm of each other. Keep neighbouring slots more than ' + trimmed(envelope) +
    ' mm apart so their braids do not meet: ' +
    (Number.isFinite(length) ? 'use a piece at least ' + length + ' mm long, or move the slots less.' : 'move the slots less.'),
  );
}

/**
 * The slot position to store, or undefined for a centred piece. A slot
 * position that puts every slot where a centred piece has it is centred, and
 * a lane list spaced exactly p.laneSpacing apart at both ends is stored as
 * lanes moving together. Anything malformed comes back as it is, for
 * validateSlotPosition to refuse.
 */
export function normaliseSlotPosition(p) {
  const s = p.slotPosition;
  if (s == null) return undefined;
  if (!wellFormed(s)) return s;
  const each = Array.isArray(s.lanes);
  if (each && s.lanes.length !== laneCount(p)) return { version: 1, edge: s.edge, lanes: s.lanes.map(copy) };
  const a = slotDistances(p, 0), b = slotDistances(p, 1);
  const close = (x, y) => Math.abs(x - y) < 1e-6;
  const first = p.width / 2 - packHalf(p);
  const symmetric = (mm, k) => close(mm, k ? first + k * p.laneSpacing : first);
  if (a.every(symmetric) && b.every(symmetric)) return undefined;
  const spaced = (ds) => ds.every((mm, k) => !k || close(mm - ds[k - 1], p.laneSpacing));
  if (!each || (spaced(a) && spaced(b)))
    return { version: 1, edge: s.edge, startMm: a[0], endMm: b[0] };
  return { version: 1, edge: s.edge, lanes: s.lanes.map(copy) };
}

const copy = ({ startMm, endMm }) => ({ startMm, endMm });
