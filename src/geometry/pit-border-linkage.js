import { connectorWarning } from './connector-warning.js';
import { configuredPositionKey, configuredPositions, placementKeys } from './placements.js';
import { pitActuatorSpec } from './pit-turnout.js';

export function pitHardwareObstruction(p, part, fork, component = 'pushrod') {
  // Use the keeper's own station. At an open end its parent clip is supplied
  // by the far end of the *next* track piece, which has a different ID.
  const [scope, , side, segment, ordinal] = part.id.split('-');
  const number = Number(ordinal) || 1;
  const position = configuredPositions(p, scope, 'clip', side)?.[number - 1];
  const percent = position === undefined ? '' : ' at ' + Number((position * 100).toFixed(3)) +
    (scope === 'side' ? '% along this section' : '% across this border end');
  const border = side === 'outer' ? 'Outside border' : 'Inside border';
  const where = scope === 'side' ? 'attachment ' + segment :
    Number(segment) === 0 ? 'start' : Number(segment) === p.borderSegments ? 'finish' : 'seam ' + segment;
  const location = border + ' ' + where + ' · clip ' + number;
  const reason = 'The ' + part.name.toLowerCase() + percent + ' blocks the ' + fork.side + ' pit ' + component + ' underneath the track.';
  if (scope === 'end') {
    return connectorWarning(location, reason,
      'Change Borders → Segments per side to move the seam, or change Connections → Join border ends.',
      { tab: 'borders', field: 'borderSegments', label: 'Edit segments per side' });
  }
  const key = configuredPositionKey(p, scope, 'clip', side);
  return connectorWarning(location, reason,
    'Move clip ' + number + ' along the border in Connections → Custom border connector positions.',
    { tab: 'joints', field: 'place_' + key, label: 'Edit ' + placementKeys[key].toLowerCase() });
}

export function checkPitBorderHardware(work, p, fork, hardware) {
  // An internal motor's linkage ends inside its cradle, before the edge.
  if (p.special.motorMount) return;
  const { mainEye, pitEye, rodDiameter, rodCenterZ } = pitActuatorSpec(p, fork);
  const radius = rodDiameter / 2;
  const x0 = Math.min(mainEye[0], pitEye[0]), x1 = Math.max(mainEye[0], pitEye[0]);
  const side = fork.sign > 0 ? 'outer' : 'inner';
  const candidates = [];
  for (const part of hardware) {
    if (!part.id.startsWith('side-clip-' + side + '-') && !part.id.startsWith('end-clip-' + side + '-')) continue;
    const { min, max } = part.solid.boundingBox();
    if (max[0] <= x0 - radius || min[0] >= x1 + radius ||
        max[2] <= rodCenterZ - radius || min[2] >= rodCenterZ + radius) continue;
    const outside = fork.sign > 0 ? max[1] : min[1];
    if (fork.sign * (outside - mainEye[1]) > 0) candidates.push({ part, outside });
  }
  if (!candidates.length) return;

  // The wire moves sideways with the eye. Across the border, its whole
  // throw is the hull of two parallel round wires. The pocket itself is
  // wider and taller, and can overlap a connector that the wire clears.
  const end = fork.sign * Math.max(...candidates.map(c => fork.sign * c.outside)) + fork.sign;
  const wires = [mainEye, pitEye].map(([x, y]) => {
    const tube = work.own(work.wasm.Manifold.cylinder(Math.abs(end - y), radius, radius, 48));
    const along = work.own(tube.rotate([-fork.sign * 90, 0, 0]));
    return work.own(along.translate([x, y, rodCenterZ]));
  });
  const sweep = work.own(work.wasm.Manifold.hull(wires));
  for (const { part } of candidates) {
    if (work.and(sweep, part.solid).volume() > 1e-6) throw pitHardwareObstruction(p, part, fork);
  }
}
