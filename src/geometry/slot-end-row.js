import {
  connectorEnvelopes,
  fixedFirst,
  nearestOffset,
  planConnectorRow,
  separated,
  spread,
  usesClips,
  usesTabs,
} from './connector-counts.js';
import { roadOffsetWarning, slotRowWarning } from './connector-position-warnings.js';
import { currentJointSettings } from './joint-fit.js';
import { activeJointMode, countedJoint, countWarningSetting } from './placements.js';
import { hasSlotPosition } from '../slot-position.js';

// Connector rows at the two ends of a piece with an off-centre slot.
//
// Two ends fit together when their slots line up and their connectors sit in
// the same places. So the row at an end may depend on nothing but that end:
// the road width, where the slot arrives, and what was asked for there. The
// length of the piece, its far end, its seams, feeds and pockets never move a
// connector here. When they leave no room, the build refuses the piece.

/** Extra room kept beside an off-centre slot, for a slot that moves sideways. */
export const SLOT_SWEEP_ALLOWANCE = 1;

// Two ways of typing the same position must never land either side of a limit.
const TIE = 1e-7;
const exact = (value) => Math.round(value * 1e6) / 1e6;

export const endObstacleText = {
  edge: 'Leave room for the supporting walls inside the edge.',
  lane: 'The pocket would reach a guide slot wall.',
};

/**
 * The face of one road end: its width, the lanes that arrive there, and the
 * sizes that decide how close a connector may sit.
 * A centred face is measured exactly as the standard pieces are.
 */
export function slotEndFace({ width, lanes, envelopes, slotWidth, wall }) {
  const arriving = lanes.map(exact);
  const lean = arriving.reduce((sum, lane) => sum + lane, 0);
  const offCentre = lean !== 0;
  return {
    width: offCentre ? exact(width) : width,
    lanes: arriving,
    lean,
    offCentre,
    envelopes,
    slotWidth,
    wall,
  };
}

/** Distance a connector centre keeps from a slot centre at this face. */
export function slotEndKeepOut(face, type, byHand = false) {
  return face.slotWidth / 2 + face.wall + face.envelopes[type].half +
    (face.offCentre && !byHand ? SLOT_SWEEP_ALLOWANCE : 0);
}

/**
 * Why a connector cannot sit at x on this face: 'edge', 'lane' or null.
 * A mark placed by hand may stand as close to the slot as the slot wall allows.
 */
export function slotEndObstacle(face, type, x, byHand = false) {
  if (Math.abs(x) > face.width / 2 - face.envelopes[type].half + 1e-8) return 'edge';
  const keepOut = slotEndKeepOut(face, type, byHand) + (face.offCentre ? TIE : 0);
  return face.lanes.some((lane) => Math.abs(lane - x) <= keepOut) ? 'lane' : null;
}

/** Collect everything the row at one end depends on. */
export function slotEndRequest(p, end, {
  width = p.width,
  lanes,
  mode = activeJointMode(p, end),
  envelopes = connectorEnvelopes(p),
  location = 'Road ' + end,
} = {}) {
  return {
    end,
    kind: p.kind,
    width,
    lanes,
    mode,
    envelopes,
    slotWidth: p.slotWidth,
    wall: p.wall,
    request: countedJoint(p, end, undefined, mode),
    tabs: p.placements?.[end + 'Tabs'],
    clips: p.placements?.[end + 'Clips'],
    tabOffset: p.connectorOffset,
    location,
    countSetting: (type) => countWarningSetting(p, end, type),
  };
}

const valuesOf = (specs, type) =>
  specs
    .filter((spec) => spec.type === type)
    .map((spec) => spec.value)
    .sort((a, b) => a - b);
const grouped = (specs) => ({
  tab: valuesOf(specs, 'tab'),
  clip: valuesOf(specs, 'clip'),
});

function countedRow(ask, face, turn) {
  const { request } = ask;
  const { width } = face;
  const turned = (type) => ({
    ...request[type],
    fixed: request[type].fixed?.map(turn),
  });
  let row;
  try {
    row = planConnectorRow({ tab: turned('tab'), clip: turned('clip') }, {
      // The face has rounded its width before the planner counts whole
      // millimetres of travel.
      domain: [-width / 2, width / 2],
      length: width,
      location: ask.location,
      settingFor: ask.countSetting,
      halfAt: (type) => ask.envelopes[type].half,
      blocked: (type, x) =>
        endObstacleText[slotEndObstacle(face, type, x, Boolean(request[type].fixed))],
    });
  } catch (error) {
    if (!error.warning) throw error;
    // A mark placed by hand that cannot stay is the thing to change.
    const stuck = ['tab', 'clip']
      .flatMap((type) => (request[type].fixed ?? []).map((value) => ({ type, value })))
      .find(({ type, value }) => slotEndObstacle(face, type, turn(value), true));
    const warning = stuck
      ? roadOffsetWarning({
          label: ask.location + ' · ' + ask.envelopes[stuck.type].name,
          kind: ask.kind,
          end: ask.end,
          ...stuck,
          custom: true,
          width,
          envelope: ask.envelopes[stuck.type],
          laneSpace: slotEndKeepOut(face, stuck.type, true),
          lanes: face.lanes.map(turn),
          reason: slotEndObstacle(face, stuck.type, turn(stuck.value), true),
        })
      : face.offCentre ? slotRowWarning(error, true) : error;
    const proposed = error.proposedPositions;
    if (proposed) {
      warning.proposedPositions = {
        tab: proposed.tab.map(turn),
        clip: proposed.clip.map(turn),
      };
    }
    throw warning;
  }
  return ['tab', 'clip'].flatMap((type) =>
    spread(
      row[type].map(turn).sort((a, b) => a - b),
      type,
      Boolean(request[type].fixed),
    ));
}

function legacyRow(ask, face, turn) {
  const { envelopes, mode } = ask;
  const { width } = face;
  const manualTabs = ask.tabs?.map(turn),
    manualClips = ask.clips?.map(turn);
  const autoDistance = ask.tabOffset || width * 0.36;
  const wanted = [
    ...(usesTabs(mode)
      ? spread(
          manualTabs ?? [-autoDistance, autoDistance],
          'tab',
          Boolean(manualTabs || ask.tabOffset),
        )
      : []),
    ...(usesClips(mode)
      ? spread(manualClips ?? [0], 'clip', Boolean(manualClips))
      : []),
  ].sort(fixedFirst);
  const occupied = [],
    specs = [];
  for (const [position, spec] of wanted.entries()) {
    const { type, value, custom } = spec;
    const envelope = envelopes[type];
    const fixedTabOffset = type === 'tab' && !manualTabs && Boolean(ask.tabOffset);
    const blocking = (x) =>
      slotEndObstacle(face, type, x, custom) ??
      (separated(occupied, x, envelope.half) ? null : 'other');
    const warning = () => {
      const error = roadOffsetWarning({
        label: ask.location + ' · ' + envelope.name,
        kind: ask.kind,
        end: ask.end,
        type,
        value: turn(value),
        custom,
        width,
        envelope,
        laneSpace: slotEndKeepOut(face, type, custom),
        lanes: face.lanes.map(turn),
        fixedTabOffset,
        reason: blocking(value),
      });
      const failed = !custom && face.offCentre ? slotRowWarning(error, false) : error;
      // Show the marks where they were asked for, so they can still be moved.
      failed.proposedPositions = grouped([
        ...specs,
        ...wanted.slice(position).map((rest) => ({ ...rest, value: turn(rest.value) })),
      ]);
      return failed;
    };
    if (custom && blocking(value)) throw warning();
    const offset = custom
      ? value
      : nearestOffset(value, width, (x) => !blocking(x), warning);
    occupied.push({ position: offset, half: envelope.half });
    specs.push({ ...spec, value: turn(offset), fixedTabOffset });
  }
  // Number automatic connectors from the low side, whichever way the row was
  // solved. A list typed by hand keeps its own order.
  for (const [type, manual] of [['tab', manualTabs], ['clip', manualClips]]) {
    if (manual) continue;
    const order = valuesOf(specs, type);
    for (const spec of specs) if (spec.type === type) spec.index = order.indexOf(spec.value);
  }
  return specs;
}

/**
 * The connector row at one external end, from that end alone.
 *
 * ask: { width, lanes, mode, request, tabs, clips, tabOffset, envelopes,
 *        slotWidth, wall, end, kind, location, countSetting }
 *   lanes     signed mm from the road centre where each slot meets this end
 *   request   the counted request for this end (countedJoint), or null
 *   tabs, clips, tabOffset   positions fixed by hand at this end
 *
 * Returns { specs, positions }: specs are { type, value, custom, index } in
 * the order they are placed, positions is { tab: [...], clip: [...] }.
 * custom marks a connector that was placed by hand.
 *
 * - Equal faces and equal requests give equal rows, to the last bit.
 * - A centred face gets the row of a standard centred piece.
 * - A slot on the other side of the centre gets the mirror image of the row.
 * Throws a connectorWarning when the row does not fit across the road.
 */
export function slotEndRow(ask) {
  const face = slotEndFace(ask);
  // Solve with the slot on the positive side, then turn the answer back.
  const side = face.lean < 0 ? -1 : 1;
  const turn = (value) => side * value + 0;
  const turnedFace = side < 0 ? { ...face, lanes: face.lanes.map(turn) } : face;
  const specs = ask.request
    ? countedRow(ask, turnedFace, turn)
    : legacyRow(ask, turnedFace, turn);
  return { specs, positions: grouped(specs) };
}

const trimmed = (value) => String(Number(value.toFixed(2)));

/**
 * Remarks about connectors that an off-centre slot has moved away from their
 * usual places, as [{ level: 'note' | 'warning', text }]. Never throws.
 */
export function slotConnectorNotes(params) {
  try {
    if (!hasSlotPosition(params)) return [];
    // Size the connectors as the build does, whatever version was saved.
    const p = currentJointSettings(params);
    const { edge, startMm, endMm } = p.slotPosition;
    if (
      p.lanes !== 1 ||
      ![p.width, p.slotWidth, p.wall, startMm, endMm].every(Number.isFinite)
    ) return [];
    const envelopes = connectorEnvelopes(p);
    const side = edge === 'outer' ? 1 : -1;
    const rowAt = (end, lanes) => {
      try {
        return JSON.stringify(
          slotEndRow(slotEndRequest(p, end, { lanes, envelopes })).positions,
        );
      } catch {
        return null;
      }
    };
    const slotAt = (mm) => [side * (p.width / 2 - mm)];
    const remarks = [];
    for (const [end, mm] of [['start', startMm], ['finish', endMm]]) {
      if (activeJointMode(p, end) === 'none') continue;
      const standard = rowAt(end, slotAt(p.width / 2));
      const row = rowAt(end, slotAt(mm));
      if (!standard || !row || row === standard) continue;
      // Step towards the centre until the standard row comes back.
      const towards = mm < p.width / 2 ? 1 : -1;
      let keeps = null,
        lasting = true;
      for (
        let step = towards > 0 ? Math.floor(mm * 2) + 1 : Math.ceil(mm * 2) - 1;
        towards * (p.width - step) > 0;
        step += towards
      ) {
        const same = rowAt(end, slotAt(step / 2)) === standard;
        if (keeps == null) {
          // Next to the centre is no place for an off-centre slot.
          if (same && Math.abs(p.width - step) >= 10) keeps = step / 2;
        } else if (!same) {
          lasting = false;
          break;
        }
      }
      remarks.push({
        end,
        mm,
        // The same row with the slot out of reach shows whether the slot is
        // what pushed a connector aside.
        moved: row !== rowAt(end, [Math.sign(slotAt(mm)[0]) * 1e6]),
        keeps: keeps == null ? ''
          : ' At ' + trimmed(keeps) + ' mm' + (lasting ? (towards > 0 ? ' or more' : ' or less') : '') +
            ' the standard positions stay.',
      });
    }
    const text = ({ mm, moved, keeps }, where, subject) =>
      'Connectors at ' + where +
      (moved ? ' move to make room for the slot. ' : ' are not where a centred piece has them. ') +
      subject + ' other ends with the slot at ' + trimmed(mm) + ' mm, not centred pieces.' + keeps;
    const [a, b] = remarks;
    if (b && a.mm === b.mm && a.moved === b.moved && a.keeps === b.keeps)
      return [{ level: 'note', text: text(a, 'both ends', 'They fit') }];
    return remarks.map((remark) => {
      const name = remark.end === 'start' ? 'end A' : 'end B';
      return {
        level: 'note',
        text: text(remark, name, name[0].toUpperCase() + name.slice(1) + ' fits'),
      };
    });
  } catch {
    return [];
  }
}
