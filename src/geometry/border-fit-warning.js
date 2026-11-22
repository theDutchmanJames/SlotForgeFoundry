import { connectorWarning, formatMm as mm } from './connector-warning.js';
import { apexPositionFor } from './border-profile.js';
const bordersField = (field, label) => ({ tab: 'borders', field, label });
const jointMode = {
  tab: 'joints',
  field: 'borderJoint',
  label: 'Edit border end joints',
};
const editPosition = (type, key) => ({
  tab: 'joints',
  field: 'place_' + key,
  label: 'Edit border end ' + type + ' positions',
});

export function borderEndWidthWarning(
  location,
  p,
  t,
  width,
  required,
  connectors,
  side,
  allowFewer = false,
) {
  const fewer = allowFewer ? ' You can also choose fewer connectors under Connections → Join border ends.' : '';
  const reason =
    connectors +
    ' requires at least ' +
    mm(required) +
    ' of border width here, including clearance and supporting walls. This border is ' +
    mm(width) +
    ' wide.';
  // The entry and exit widths are shared. Inside widths must clear the bend centre.
  const innerLimit =
    p.kind === 'curve' &&
    (side === 'inner' || ((t === 0 || t === 1) && p.borderSide === 'both'))
      ? p.radius - p.width / 2
      : Infinity;
  if (required >= innerLimit)
    return connectorWarning(
      location,
      reason,
      'The inside edge reaches the bend centre at ' +
        mm(innerLimit) +
        '. Increase Road → Centre radius or change Connections → Border connections → Join border ends.' + fewer,
      { tab: 'geometry', field: 'radius', label: 'Edit centre radius' },
    );
  const widthField =
    t === 0
      ? 'Entry'
      : t === 1
        ? 'Exit'
        : Math.abs(t - apexPositionFor(p, side)) < 1e-10
          ? 'Apex'
          : null;
  if (widthField) {
    const rounded = Math.ceil(required - 1e-9);
    const target = rounded < innerLimit ? rounded : required;
    return connectorWarning(
      location,
      reason,
      'Set Borders → Border width → ' + widthField + ' to ' + mm(target) + '.' + fewer,
      bordersField(
        widthField === 'Apex' ? side + 'ApexWidth' : 'border' + widthField,
        'Edit ' + widthField.toLowerCase() + ' width',
      ),
    );
  }
  const names =
    t < apexPositionFor(p, side) ? 'Entry and Apex' : 'Apex and Exit';
  return connectorWarning(
    location,
    reason,
    'This seam is ' +
      Number((100 * t).toFixed(2)) +
      '% along the border. Adjust ' +
      names +
      ' in Borders → Border width to widen it here.' + fewer,
    bordersField(side + 'ApexWidth', 'Edit border width'),
  );
}

export function borderEndLengthWarning(
  location,
  available,
  required,
  count,
  name,
) {
  const max = Math.floor((available * count) / required);
  const reason =
    'The road-facing edge averages ' +
    mm(available) +
    ' per segment. The ' +
    name +
    ' supports at both ends need at least ' +
    mm(required) +
    ' per segment.';
  return max > 0
    ? connectorWarning(
        location,
        reason,
        'Set Borders → Print segments → Segments per side to ' +
          max +
          ' or fewer.',
        bordersField('borderSegments', 'Edit segments per side'),
      )
    : connectorWarning(
        location,
        reason,
        'Lengthen this track piece or change Connections → Border connections → Join border ends.',
        jointMode,
      );
}

export function borderEndPositionWarning(
  location,
  type,
  name,
  value,
  width,
  half,
  occupied,
  key = type === 'clip' ? 'endClips' : 'endTabs',
) {
  const offset = value * width;
  const subject =
    'The ' + name + ' centre at ' + Number((value * 100).toFixed(3)) + '%';
  const advice =
    'Adjust Connections → Custom border connector positions → Border end ' +
    type +
    's, or clear that field for automatic placement.';
  if (offset < half - 1e-8 || offset > width - half + 1e-8) {
    const fromRoad = offset < half;
    return connectorWarning(
      location,
      subject +
        ' is ' +
        mm(fromRoad ? offset : width - offset) +
        ' from the ' +
        (fromRoad ? 'road-facing' : 'free') +
        ' edge. Its pocket and walls need ' +
        mm(half) +
        ' on that side.',
      advice,
      editPosition(type, key),
    );
  }
  const previous = occupied.find(
    ({ position, half: other }) =>
      Math.abs(offset - position) < half + other + 0.2 - 1e-8,
  );
  if (previous)
    return connectorWarning(
      location,
      subject +
        ' is ' +
        mm(Math.abs(offset - previous.position)) +
        ' from the neighbouring ' +
        previous.name +
        ' centre. Their supports need at least ' +
        mm(half + previous.half + 0.2) +
        ' between centres.',
      advice,
      editPosition(type, key),
    );
  return connectorWarning(
    location,
    subject +
      ' puts part of its pocket or supporting walls outside the border outline.',
    advice,
    editPosition(type, key),
  );
}
