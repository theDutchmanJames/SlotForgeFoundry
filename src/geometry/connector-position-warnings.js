import { connectorWarning, formatMm } from './connector-warning.js';
import { placementKeys } from './placements.js';
import { slotForm, slotVaries } from '../slot-position.js';

export function roadLengthWarning(
  p,
  index,
  available,
  minimum,
  ends,
  connector,
) {
  const location = 'Road segment ' + (index + 1) + ' · ' + ends;
  const reason =
    'The ' +
    connector +
    ' supports need ' +
    formatMm(minimum) +
    ' along the road. The shortest road edge allows ' +
    formatMm(available) +
    ' per segment.';
  if (p.kind === 'straight') {
    const total = Math.ceil(minimum * p.segments - 1e-8);
    const recommendation =
      total <= 20000 ? ' to at least ' + formatMm(total) : '';
    return connectorWarning(
      location,
      reason,
      'Increase Road → Road length' +
        recommendation +
        (p.segments > 1 ? ', or reduce Road segments.' : '.'),
      { tab: 'geometry', field: 'length', label: 'Edit road length' },
    );
  }
  if (p.segments > 1)
    return connectorWarning(
      location,
      reason,
      'Reduce Road → Print segments → Road segments to give each piece more length, or change the connections at these ends.',
      { tab: 'geometry', field: 'segments', label: 'Edit road segments' },
    );
  if (p.kind === 'curve')
    return connectorWarning(
      location,
      reason,
      'Increase the centre radius or sweep angle under Road to lengthen the inside edge.',
      { tab: 'geometry', field: 'radius', label: 'Edit centre radius' },
    );
  const field =
    p.jointStart && p.jointStart !== 'none'
      ? 'jointStart'
      : p.jointEnd && p.jointEnd !== 'none'
        ? 'jointEnd'
        : 'joint';
  return connectorWarning(
    location,
    reason,
    'Change the active end connection under Connections, or lengthen the piece in the Circuit drawing.',
    { tab: 'joints', field, label: 'Edit road connections' },
  );
}

export function roadOffsetWarning({
  label,
  kind,
  end,
  type,
  value,
  custom,
  width,
  envelope,
  laneSpace,
  lanes,
  fixedTabOffset,
  reason,
  slotPosition = false,
}) {
  const key = end + (type === 'tab' ? 'Tabs' : 'Clips');
  const positions = {
    tab: 'joints',
    field: 'place_' + key,
    label: 'Edit ' + placementKeys[key].toLowerCase(),
  };
  if (width < 2 * envelope.half) {
    const space =
      'The road here is ' +
      formatMm(width) +
      ' wide. The connector with its support walls needs ' +
      formatMm(2 * envelope.half) +
      '.';
    if (kind !== 'import')
      return connectorWarning(
        label,
        space,
        'Increase Road → Road width to give the connector room.',
        { tab: 'geometry', field: 'width', label: 'Edit road width' },
      );
    return connectorWarning(
      label,
      space,
      'Widen the road at this location in the Circuit drawing or change its connection under Connections.',
      {
        tab: 'joints',
        field:
          end === 'seam'
            ? 'joint'
            : end === 'start'
              ? 'jointStart'
              : 'jointEnd',
        label: 'Edit road connection',
      },
    );
  }
  const at = 'At the ' + formatMm(value) + ' offset, ';
  let detail;
  if (reason === 'lane') {
    const distance = Math.min(...lanes.map((lane) => Math.abs(lane - value)));
    detail =
      at +
      'the nearest guide slot centre is ' +
      formatMm(distance) +
      ' away. Its wall and the connector need more than ' +
      formatMm(laneSpace) +
      ' between centres.';
  } else if (reason === 'laneSweep') {
    detail =
      at +
      (slotPosition
        ? 'the pocket reaches a guide slot wall where the slot moves sideways away from the seam.'
        : 'the pocket reaches a guide slot wall as the lanes change spacing away from the seam.');
  } else if (reason === 'edge') {
    const limit = width / 2 - envelope.half;
    detail =
      'The ' +
      formatMm(value) +
      ' offset is too close to the road edge. The centre must be within ' +
      formatMm(limit) +
      ' of the road centreline.';
  } else if (reason === 'other') {
    detail =
      at + 'the support overlaps the space reserved for another connector.';
  } else if (reason === 'opposite') {
    detail = at + 'this pocket meets a connector from the other end of the same road segment. Move a connector across the seam or lengthen the segment.';
  } else {
    detail =
      at +
      'the pocket or its supporting walls extend outside the road outline.';
  }
  if (fixedTabOffset)
    return connectorWarning(
      label,
      detail,
      'Change Tab offset from centre in Connections. Enter 0 to find positions automatically.',
      { tab: 'joints', field: 'connectorOffset', label: 'Edit tab offset' },
    );
  if (custom)
    return connectorWarning(
      label,
      detail,
      'Change ' +
        placementKeys[key] +
        ' under Connections → Custom road connector positions.',
      positions,
    );
  if (kind === 'curve' && (reason === 'outline' || reason === 'opposite'))
    return connectorWarning(
      label,
      'Automatic placement could not fit the complete pocket. ' + detail,
      'Increase Road → Sweep angle or Centre radius for more room, reduce the number of road segments, or change the end connections.',
      { tab: 'geometry', field: 'angle', label: 'Edit sweep angle' },
    );
  return connectorWarning(
    label,
    'Automatic placement could not find a clear position. ' + detail,
    'Adjust the offsets under Connections → Custom road connector positions, or ' +
      (kind === 'import'
        ? 'give the joint more room in the Circuit drawing.'
        : 'increase Road → Road width.'),
    positions,
  );
}

export function sideMountWarning({
  label,
  type,
  key = type === 'tab' ? 'sideTabs' : 'sideClips',
  value,
  custom,
  reason,
  required,
  available,
  widest,
  widthControl,
  side,
  nativeLaneGap,
  laneMinimum,
  slotPosition = false,
}) {
  // slotPosition: true, or the setting of the slot nearest this edge.
  const slotSetting = () =>
    typeof slotPosition === 'object' ? slotPosition : slotPositionSetting();
  // On a piece whose lanes are set one by one, name the slot to move.
  const named = typeof slotPosition === 'object' && /^slotLane\d+(?:Start|End)$/.test(slotPosition.field);
  const moveSlot = 'move ' + (named ? slotToMove(slotPosition) : 'the slot') +
    ' away from this edge under Road → Slot position';
  const positions = {
    tab: 'joints',
    field: 'place_' + key,
    label: 'Edit ' + placementKeys[key].toLowerCase(),
  };
  const percentage = Number((value * 100).toFixed(3)) + '%';
  if (widest < required || reason === 'width') {
    const region =
      !custom && widest < required
        ? 'This border section reaches only ' +
          formatMm(widest) +
          ' at its widest point.'
        : 'At ' +
          percentage +
          ' along this section, the border narrows to ' +
          formatMm(available) +
          ' beneath the connector.';
    const advice =
      'Increase the border width across the pocket under Borders → Border width.';
    return connectorWarning(
      label,
      region +
        ' The socket and its supporting wall need at least ' +
        formatMm(required) +
        '.',
      custom && widest >= required
        ? advice + ' You can also move the attachment to a wider position.'
        : advice,
      {
        tab: 'borders',
        field:
          widthControl === 'Apex'
            ? side + 'ApexWidth'
            : 'border' + widthControl,
        label: 'Edit ' + widthControl.toLowerCase() + ' width',
      },
    );
  }
  if (nativeLaneGap != null && nativeLaneGap <= laneMinimum)
    return connectorWarning(
      label,
      'The nearest guide-slot centre is ' +
        formatMm(nativeLaneGap) +
        ' from this road edge. The pocket and slot wall need more than ' +
        formatMm(laneMinimum) +
        '.',
      slotPosition
        ? 'Either ' + moveSlot + ', or increase Road → Road width.'
        : 'Increase Road → Road width to give the pocket more room beside the guide slot.',
      slotPosition
        ? slotSetting()
        : { tab: 'geometry', field: 'width', label: 'Edit road width' },
    );
  const causes = {
    angle:
      'the tab meets the road at too sharp an angle to slide into its socket.',
    roadEnd: 'the pocket is too close to a road seam or end.',
    finish: 'the pocket or keeper would enter the shaped finish. Increase the full-width part of the border, use a Short finish, or move the connector towards the square end.',
    borderEnd:
      'the pocket is too close to the border end or its reserved connector space.',
    lane: 'the pocket reaches the clearance reserved for a guide slot and its wall.',
    laneSweep: slotPosition
      ? 'the pocket reaches the wall of a guide slot where the slot moves sideways.'
      : 'the pocket reaches the wall of a guide slot as the lanes change spacing.',
    channel: 'the pocket would cut into a guide slot or braid recess.',
    feed: 'the pocket would cut into a braid pass-through.',
    other: 'the attachment is too close to another mount on this border.',
    outline:
      'the pocket or its support extends beyond the road or border outline.',
  };
  const detail = 'At ' + percentage + ' along this section, ' + causes[reason];
  // An off-centre slot can crowd one road edge along its whole length.
  const beside = slotPosition && ['lane', 'laneSweep', 'channel'].includes(reason);
  const movePlaces =
    placementKeys[key] + ' under Connections → Custom border connector positions.';
  const advice = beside
    ? 'Either ' + moveSlot + ', or move ' + movePlaces
    : 'Move ' + movePlaces;
  return connectorWarning(
    label,
    custom
      ? detail
      : 'Automatic placement could not find a clear position. ' + detail,
    advice,
    beside && !custom ? slotSetting() : positions,
  );
}

/**
 * The inspector field that holds the slot position of a piece. On a piece
 * whose lanes are set one by one it is the field of the slot nearest `value`
 * (mm from the road centre) among `lanes`, the slot offsets at that end:
 * 'slotLane<n>Start', n counted from the edge the slots are measured from.
 * At end B ('finish') of a straight whose slots move sideways the distance
 * there is the end-B field: 'slotLane<n>End', or 'slotEnd' when the lanes
 * move together. Seams, curves and slots that keep their place use end A.
 */
export function slotPositionSetting(p, lanes, value = 0, end) {
  const atB = end === 'finish' && p?.kind === 'straight' && slotVaries(p);
  const setting = { tab: 'geometry', field: atB ? 'slotEnd' : 'slotStart', label: 'Slot position' };
  if (slotForm(p) !== 'each' || !lanes?.length) return setting;
  const nearest = lanes.reduce((best, lane) =>
    Math.abs(lane - value) < Math.abs(best - value) ? lane : best);
  const outer = p.slotPosition.edge === 'outer';
  const slot = lanes.filter((lane) => (outer ? lane > nearest : lane < nearest)).length + 1;
  return { ...setting, field: 'slotLane' + slot + (atB ? 'End' : 'Start') };
}

/**
 * The slot the advice tells the user to move: the slot a lane field names
 * ('slot 2'), the slots of a piece with several lanes moving together, or the
 * one slot of a single-lane piece.
 */
export function slotToMove(setting, lanes = 1) {
  const named = /^slotLane(\d+)(?:Start|End)$/.exec(setting?.field ?? '');
  if (named) return 'slot ' + named[1];
  return lanes > 1 ? 'the slots' : 'the slot';
}

/** A row beside an off-centre slot that cannot be laid out across the road. */
export function slotRowWarning(source, counted, setting = slotPositionSetting(), lanes = 1) {
  const move = 'Move ' + slotToMove(setting, lanes);
  return connectorWarning(
    source.warning.location,
    source.warning.reason,
    counted
      ? move + ', change the number of connectors, or place the connectors by hand.'
      : move + ', widen the road, or place the connectors by hand.',
    setting,
  );
}

const slotPocketCauses = {
  laneSweep: 'the slot moves sideways into the room this pocket needs.',
  outline: 'the pocket or its supporting walls reach outside the road.',
  opposite: 'the pocket meets a connector from the other end of the piece.',
  channel: 'the pocket would cut into the guide slot or a braid recess.',
  feed: 'the pocket would cut into a braid pass-through.',
  detector: 'the pocket would reach the timing equipment.',
};

/**
 * A connector at an end with an off-centre slot that the rest of the piece
 * leaves no room for. Its place is fixed by the slot at that end alone, so
 * the piece has to change, not the row.
 */
export function slotPocketWarning({
  label, kind, end, type, value, custom, fixedTabOffset, reason, setting = slotPositionSetting(),
  lanes = 1,
}) {
  const detail =
    'At the ' + formatMm(value) + ' offset, ' + (slotPocketCauses[reason] ?? reason);
  const roomier = slotRoomAdvice(kind, reason);
  const move = 'move ' + slotToMove(setting, lanes);
  if (fixedTabOffset)
    return connectorWarning(
      label,
      detail,
      'Change Tab offset from centre in Connections, ' + roomier.toLowerCase() + ', or ' + move + '.',
      { tab: 'joints', field: 'connectorOffset', label: 'Edit tab offset' },
    );
  const key = end + (type === 'tab' ? 'Tabs' : 'Clips');
  if (custom)
    return connectorWarning(
      label,
      detail,
      'Move ' +
        placementKeys[key] +
        ' under Connections → Custom road connector positions, ' +
        roomier.toLowerCase() + ', or ' + move + '.',
      {
        tab: 'joints',
        field: 'place_' + key,
        label: 'Edit ' + placementKeys[key].toLowerCase(),
      },
    );
  return connectorWarning(
    label,
    detail +
      (lanes > 1 ? ' On a piece with off-centre slots' : ' On a piece with an off-centre slot') +
      ' the connectors keep fixed places, so that matching ends always fit together.',
    roomier + ', ' + move + ', or place the connectors by hand.',
    setting,
  );
}

/** The change to the piece itself that gives a refused pocket its room. */
export function slotRoomAdvice(kind, reason) {
  if (reason === 'feed') return 'Move the braid pass-through';
  return kind === 'curve' ? 'Use a larger radius or sweep angle' : 'Use a longer piece';
}
