import { activeJointMode } from './geometry/placements.js';
import { slotConnectorNotes } from './geometry/slot-end-row.js';
import {
  SLOT_GENTLE_RADIUS,
  SLOT_MIN_RADIUS,
  curveSlotAdvice,
  hasSlotPosition,
  slotBend,
  slotEdgeName,
  slotEnds,
  slotLengthFor,
  slotVaries,
} from './slot-position.js';

/** Closer to an edge than this, the body of a 1:32 car hangs over it. */
export const SLOT_BODY_ROOM = 30;

const whole = (n) => String(Math.round(n));
const trimmed = (n) => String(Number(n.toFixed(1)));

/**
 * Remarks for the person choosing a slot position. Nothing here stops a
 * build: validateSlotPosition owns the limits.
 * Returns [{ level: 'note' | 'warning', text }].
 */
export function slotAdvice(p) {
  if (!hasSlotPosition(p)) return [];
  const s = p.slotPosition;
  if (![s.startMm, s.endMm, p.width, p.length, p.radius].every(Number.isFinite)) return [];
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
