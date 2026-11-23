import { activeJointMode } from './geometry/placements.js';
import { slotConnectorNotes } from './geometry/slot-end-row.js';
import {
  SLOT_GENTLE_RADIUS,
  SLOT_MIN_RADIUS,
  curveSlotAdvice,
  curveSlotOneAdvice,
  hasSlotPosition,
  slotBend,
  slotClearances,
  slotDistances,
  slotEdgeName,
  slotEnds,
  slotForm,
  slotGaps,
  slotInnermost,
  slotLengthFor,
  slotLengthForClearance,
  slotVaries,
  slotWidestMove,
} from './slot-position.js';

/** Closer to an edge than this, the body of a 1:32 car hangs over it. */
export const SLOT_BODY_ROOM = 30;
/** Neighbouring slots may come this much closer mid-way than at the ends before a warning. */
export const SLOT_SPACING_SLACK = 5;

const whole = (n) => String(Math.round(n));
const trimmed = (n) => String(Number(n.toFixed(1)));

/**
 * Remarks for the person choosing a slot position. Nothing here stops a
 * build: validateSlotPosition owns the limits.
 * Returns [{ level: 'note' | 'warning', text }].
 */
export function slotAdvice(p) {
  if (!hasSlotPosition(p)) return [];
  const a = slotDistances(p, 0), b = slotDistances(p, 1);
  if (![...a, ...b, p.width, p.length, p.radius].every(Number.isFinite) || !a.length) return [];
  return a.length > 1 ? severalLanes(p) : oneLane(p);
}

function oneLane(p) {
  const advice = [];
  const { minRadius, angle } = slotBend(p);
  if (slotVaries(p) && p.kind === 'straight') {
    advice.push(minRadius < SLOT_GENTLE_RADIUS ? {
      level: 'warning',
      text: 'The tightest bend in the slot is about ' + whole(minRadius) + ' mm radius. For a gentle ' +
        SLOT_GENTLE_RADIUS + ' mm or more, make the piece at least ' +
        slotLengthFor(p, SLOT_GENTLE_RADIUS) + ' mm long.',
    } : {
      level: 'note',
      text: 'The tightest bend in the slot is about ' + whole(minRadius) + ' mm radius, which is gentle.',
    });
    advice.push({
      level: 'note',
      text: 'Mid-way the slot runs at ' + trimmed(angle) + '° to the road edge.',
    });
  } else if (p.kind === 'curve' && minRadius < Math.min(p.radius, SLOT_GENTLE_RADIUS)) {
    const tight = minRadius < SLOT_MIN_RADIUS;
    const where = tight ? curveSlotAdvice(p, SLOT_MIN_RADIUS) : '';
    advice.push({
      level: tight ? 'warning' : 'note',
      text: 'On this curve the slot follows a radius of about ' + whole(minRadius) +
        ' mm, tighter than the ' + trimmed(p.radius) + ' mm centre line.' +
        (tight
          ? " A car's guide can bind below " + SLOT_MIN_RADIUS + ' mm. ' +
            (where ? 'Keep the slot ' + where + ', or use a larger radius.' : 'Use a larger radius.')
          : ''),
    });
  }
  const ends = slotEnds(p);
  for (const edge of ['outer', 'inner']) {
    const room = Math.min(ends.start[edge], ends.end[edge]);
    if (room >= SLOT_BODY_ROOM || p.borderSide === edge || p.borderSide === 'both') continue;
    const where = !slotVaries(p) ? 'The slot is'
      : ends.start[edge] < ends.end[edge] ? 'At end A the slot is' : 'At end B the slot is';
    advice.push({
      level: 'note',
      text: where + ' only ' + trimmed(room) + ' mm from the ' + slotEdgeName(p, edge) +
        ' edge. A 1:32 car body overhangs that edge, so a border on that side helps.',
    });
  }
  if (slotVaries(p)) {
    const tabs = ['start', 'finish'].some((scope) =>
      ['tabs', 'both'].includes(activeJointMode(p, scope)));
    // Turned round, an S is the same S: it never brings the slot back.
    advice.push({
      level: 'note',
      text: 'End A and end B are different' + (tabs
        ? ', and tab joints fit one way round only, so this piece cannot be turned round.'
        : '.') + ' To bring the slot back, make a second piece with the two distances swapped.',
    });
  }
  return [...advice, ...slotConnectorNotes(p)];
}

// Slots are numbered from the edge the distances are measured from.
const pair = (k) => 'slots ' + (k + 1) + ' and ' + (k + 2);
const capital = (text) => text[0].toUpperCase() + text.slice(1);

function severalLanes(p) {
  const advice = [];
  const each = slotForm(p) === 'each', varies = slotVaries(p);
  const count = slotDistances(p, 0).length;
  const { minRadius, angle } = slotBend(p);
  if (varies && p.kind === 'straight') {
    // One slot is named only when it moves further than another.
    const start = slotGaps(p, 0), finish = slotGaps(p, 1);
    const alike = start.every((gap, k) => gap === finish[k]);
    const subject = alike ? 'the slots' : 'slot ' + (slotWidestMove(p).slot + 1);
    advice.push(minRadius < SLOT_GENTLE_RADIUS ? {
      level: 'warning',
      text: 'The tightest bend in ' + subject + ' is about ' + whole(minRadius) + ' mm radius. For a gentle ' +
        SLOT_GENTLE_RADIUS + ' mm or more, make the piece at least ' +
        slotLengthFor(p, SLOT_GENTLE_RADIUS) + ' mm long.',
    } : {
      level: 'note',
      text: 'The tightest bend in ' + subject + ' is about ' + whole(minRadius) + ' mm radius, which is gentle.',
    });
    advice.push({
      level: 'note',
      text: alike
        ? 'Mid-way the slots run at ' + trimmed(angle) + '° to the road edge.'
        : 'Mid-way ' + subject + ', the steepest, runs at ' + trimmed(angle) + '° to the road edge.',
    });
    // At an angle neighbouring slots come closer than the ends show.
    const atEnds = start.map((gap, k) => Math.min(gap, finish[k]));
    const clear = slotClearances(p);
    let worst = -1;
    for (const [k, mm] of clear.entries())
      if (atEnds[k] - mm > SLOT_SPACING_SLACK && (worst < 0 || atEnds[k] - mm > atEnds[worst] - clear[worst] + 1e-6)) worst = k;
    if (worst >= 0) {
      const length = slotLengthForClearance(p, (mm, k) => atEnds[k] - mm <= SLOT_SPACING_SLACK);
      advice.push({
        level: 'warning',
        text: 'Along the piece ' + pair(worst) + ' come within ' + trimmed(clear[worst]) +
          ' mm of each other, against ' + trimmed(atEnds[worst]) + ' mm at the ends. ' +
          (Number.isFinite(length)
            ? 'To keep them within ' + SLOT_SPACING_SLACK + ' mm of that, make the piece at least ' + length + ' mm long.'
            : 'Move the slots less to keep them apart.'),
      });
    }
  } else if (p.kind === 'curve' && minRadius < Math.min(p.radius, SLOT_GENTLE_RADIUS)) {
    const tight = minRadius < SLOT_MIN_RADIUS;
    const where = tight ? curveSlotAdvice(p, SLOT_MIN_RADIUS) : '';
    const inside = 'slot ' + (slotInnermost(p) + 1);
    advice.push({
      level: tight ? 'warning' : 'note',
      text: 'On this curve ' + inside + ' follows a radius of about ' + whole(minRadius) +
        ' mm, tighter than the ' + trimmed(p.radius) + ' mm centre line.' +
        (tight
          ? " A car's guide can bind below " + SLOT_MIN_RADIUS + ' mm. ' +
            (where ? 'Keep ' + inside + ' ' + where + ', or use a larger radius.' + curveSlotOneAdvice(p, SLOT_MIN_RADIUS)
              : 'Use a larger radius.')
          : ''),
    });
  }
  if (each && Number.isFinite(p.laneSpacing)) {
    // Closer than the pack's lanes, cars on neighbouring slots may touch.
    for (const t of varies ? [0, 1] : [0]) {
      const gaps = slotGaps(p, t);
      const k = gaps.indexOf(Math.min(...gaps));
      if (!(gaps[k] > 0 && gaps[k] < p.laneSpacing)) continue;
      const lead = varies ? 'At ' + (t ? 'end B ' : 'end A ') + pair(k) : capital(pair(k));
      advice.push({
        level: 'note',
        text: lead + ' are ' + trimmed(gaps[k]) + ' mm apart, closer than the ' + trimmed(p.laneSpacing) +
          ' mm lane spacing. Cars on neighbouring lanes may touch.',
      });
    }
  }
  const ends = slotEnds(p);
  for (const edge of ['outer', 'inner']) {
    const room = Math.min(ends.start[edge], ends.end[edge]);
    if (room >= SLOT_BODY_ROOM || p.borderSide === edge || p.borderSide === 'both') continue;
    const slot = 'slot ' + (edge === p.slotPosition.edge ? 1 : count);
    const where = ends.start[edge] === ends.end[edge] ? capital(slot) + ' is'
      : ends.start[edge] < ends.end[edge] ? 'At end A ' + slot + ' is' : 'At end B ' + slot + ' is';
    advice.push({
      level: 'note',
      text: where + ' only ' + trimmed(room) + ' mm from the ' + slotEdgeName(p, edge) +
        ' edge. A 1:32 car body overhangs that edge, so a border on that side helps.',
    });
  }
  if (varies) {
    const tabs = ['start', 'finish'].some((scope) =>
      ['tabs', 'both'].includes(activeJointMode(p, scope)));
    advice.push({
      level: 'note',
      text: 'End A and end B are different' + (tabs
        ? ', and tab joints fit one way round only, so this piece cannot be turned round.'
        : '.') + ' To bring the slots back, make a second piece with end A and end B swapped.',
    });
  }
  return [...advice, ...slotConnectorNotes(p)];
}
