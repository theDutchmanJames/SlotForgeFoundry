import { laneOffsetAt } from './lane-adjustment.js';

// The step the slot heading is measured over, as a fraction of the path.
const HEADING_STEP = 1e-5;

// Sample the same cross sections the track generator uses to cut print seams.
export function plannerStrip(path, p, a, b) {
  const inside = (list) => list.filter((t) => t > a && t < b);
  const sorted = (list) => [...new Set(list)].sort((x, y) => x - y);
  const ts = sorted([
    a,
    ...inside(path.stations),
    ...Array.from({ length: 15 }, (_, i) => a + ((b - a) * (i + 1)) / 16),
    b,
  ]);
  const sides = [-1, 1].map((sign) =>
    ts.map((t) => path.point(t, (sign * p.width) / 2)),
  );
  // Every generated road publishes where its lanes run, off-centre slot
  // included. A path without lanes of its own (a diamond's roads) uses the
  // same lane formula, so there is one answer everywhere.
  const slots = (t) =>
    path.laneOffsets?.(t) ??
    Array.from({ length: p.lanes }, (_, i) => laneOffsetAt(p, i, t));
  const point = (t, d) =>
    path.atOffset ? path.atOffset(t, d) : path.point(t, d);
  // A lane that moves sideways is drawn and measured through the stations its
  // channel is cut at, not through the coarser road stations.
  const cut = path.laneCurves
    ? (path.laneStations ??
      path.laneCurves[0].map((_, i, lane) => i / (lane.length - 1)))
    : [];
  const laneTs = cut.length ? sorted([...ts, ...inside(cut)]) : ts;
  const lanes = slots(a).map((_, i) =>
    laneTs.map((t) => point(t, slots(t)[i])),
  );
  // The direction a line runs at t, over the same short step whichever
  // section asks: both sides of a print seam get the identical answer.
  const heading = (line, t) => {
    const from = line(Math.max(0, t - HEADING_STEP)),
      to = line(Math.min(1, t + HEADING_STEP));
    return Math.atan2(to[1] - from[1], to[0] - from[0]);
  };
  // How far a slot leans away from the road. The lane and the centre line are
  // measured the same way, so the chords of a faceted curve cancel out. A
  // drawing's lanes are polylines of their own, where a facet cannot be told
  // from a lean: they join by position alone, as they always have.
  const lean =
    p.kind === 'import'
      ? () => 0
      : (t, i) =>
          heading((u) => point(u, slots(u)[i]), t) -
          heading((u) => point(u, 0), t);
  const ports = [a, b].map((t, i) => {
    const index = i ? ts.length - 1 : 0;
    const xy = path.point(t, 0),
      tangent = path.tangent(t),
      angle = Math.atan2(tangent[1], tangent[0]) + (i ? 0 : Math.PI);
    return {
      xy,
      angle,
      edges: sides.map((line) => line[index]),
      slots: lanes.map((line) => line.at(i ? -1 : 0)),
      // Outward heading of each slot, like angle: a slot that is still moving
      // sideways at a seam does not leave square to the joint.
      slotAngles: lanes.map((_, k) => angle + lean(t, k)),
    };
  });
  return { sides, lanes, ports };
}
