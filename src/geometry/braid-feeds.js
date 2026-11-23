import { hasSlotPosition, slotEdgeName, slotShiftAt, slotShiftDerivatives } from '../slot-position.js';

// The printable edges are chords between drawing stations. Interpolate on
// those exact chords when an opening starts or ends between two vertices.
export function interpolateStation(stations, t, pointAtIndex) {
  let lo = 0,
    hi = stations.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (stations[mid] < t) lo = mid;
    else hi = mid;
  }
  if (t <= stations[lo]) return [...pointAtIndex(lo)];
  if (t >= stations[hi]) return [...pointAtIndex(hi)];
  const a = pointAtIndex(lo),
    b = pointAtIndex(hi);
  const u = (t - stations[lo]) / (stations[hi] - stations[lo]);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

/** Cut a braid-width opening through the deck at selected lane stations.
 * Offsets refer to the left/right of the lane's direction of travel.
 */
export function braidFeedOutlines(p, path, laneIndex, joinGuide = false) {
  if (
    p.braidFeedSide === 'none' ||
    (p.braidFeedLane && laneIndex + 1 !== p.braidFeedLane)
  )
    return [];
  const halfTime = p.braidFeedLength / (2 * path.total);
  const sides =
    p.braidFeedSide === 'both'
      ? [1, -1]
      : [p.braidFeedSide === 'left' ? 1 : -1];
  const cuts = [];
  for (const t of p.braidFeedStations) {
    const t0 = t - halfTime,
      t1 = t + halfTime;
    if (Math.min(t0, 1 - t1) * path.total < p.wall + 0.2)
      throw new Error(
        'The braid pass-through crosses an end wall or segment seam. Move its station farther from the joint.',
      );
    const samples = [t0, ...path.ts.filter((i) => i > t0 && i < t1), t1];
    const edge = (sign, offset) =>
      samples.map((u) => path.atOffset(u, sign * offset));
    for (const sign of sides) {
      const inside = p.slotWidth / 2 + p.braidGap;
      const near = joinGuide ? 0 : inside;
      const far = inside + (joinGuide ? p.braidWidth / 2 : p.braidWidth);
      cuts.push([...edge(sign, near), ...edge(sign, far).reverse()]);
    }
  }
  return cuts;
}

// From the slot centre to the far side of a pass-through.
const feedReach = (p) => p.slotWidth / 2 + p.braidGap + p.braidWidth;

// An off-centre slot can put a pass-through into the side wall. Name the road
// edge that the opening numbered by braidFeedOutlines runs into, if any.
function feedSideWall(p, lane, index) {
  if (!hasSlotPosition(p)) return null;
  const signs = p.braidFeedSide === 'both' ? [1, -1] : [p.braidFeedSide === 'left' ? 1 : -1];
  const sign = signs[index % signs.length];
  const station = p.braidFeedStations[Math.floor(index / signs.length)];
  const half = p.braidFeedLength / (2 * lane.total);
  for (let k = 0; k <= 8; k++) {
    const t = station + half * (k / 4 - 1);
    // Where the slot runs at an angle the opening reaches further sideways.
    const slope = p.kind === 'straight' ? slotShiftDerivatives(p, t)[0] / p.length : 0;
    if (sign * slotShiftAt(p, t) + feedReach(p) * Math.hypot(1, slope) > p.width / 2 - p.wall - 1e-6)
      return slotEdgeName(p, sign > 0 ? 'outer' : 'inner');
  }
  return null;
}

export function attachBraidFeeds(work, p, roads, lanes) {
  const copies =
    (p.braidFeedLane ? 1 : lanes.length) *
    (p.braidFeedSide === 'both' ? 2 : 1) *
    p.braidFeedStations.length;
  if (copies > 256)
    throw new Error(
      'Choose one lane or fewer feed locations for this large panel.',
    );
  const interiors = roads.map((road) =>
    work.own(road.section.offset(-p.wall, 'Miter')),
  );
  for (const [index, line] of lanes.entries()) {
    const joins =
      p.braidGap === 0 ? braidFeedOutlines(p, line, index, true) : [];
    for (const [i, outline] of braidFeedOutlines(p, line, index).entries()) {
      // Keep the same clear opening all the way from the deck to the underside.
      const cut = work.prism(work.section([outline]), -1, p.height + 1);
      const projection = work.own(cut.project());
      // On squeezed or unequal imported lanes, the same distance along two
      // lanes can fall in different segments. Locate the physical footprint.
      const parent = interiors.findIndex(
        (area) => work.own(projection.subtract(area)).area() < 1e-5,
      );
      if (parent < 0) {
        const edge = feedSideWall(p, line, i);
        // Typed distances settle on half millimetres. A curve's faceted side
        // wall needs a little more than the exact limit, so advise the next
        // half millimetre above it there.
        const limit = feedReach(p) + p.wall;
        const advised =
          p.kind === 'curve'
            ? Math.floor(2 * limit + 1e-9) / 2 + 0.5
            : Math.ceil(2 * limit - 1e-9) / 2;
        if (edge)
          throw new Error(
            'The braid pass-through reaches the side wall of the road, because the slot is close to the ' +
              edge + ' edge here. Under Slot position, keep the slot at least ' +
              advised + ' mm from that edge' +
              (p.braidFeedSide === 'both' ? '.' : ', or feed the strip on the other side.'),
          );
        throw new Error(
          'The braid pass-through crosses an end wall or segment seam. Move its station away from the edge.',
        );
      }
      const road = roads[parent];
      if (road.feedCuts.some((other) => work.and(cut, other).volume() > 0.001))
        throw new Error(
          'Two braid pass-throughs overlap. Increase their station spacing.',
        );
      road.feedCuts.push(cut);
      road.cuts.push(cut);
      if (joins[i]) {
        // An opening can start halfway along a curved slot facet. Crossing
        // the common wall within the two cuts avoids a zero-thickness fin
        // from rounding coincident edges. Below the guide floor the aperture
        // still follows the exact footprint checked above.
        road.cuts.push(
          work.prism(
            work.section([joins[i]]),
            p.height - p.slotDepth,
            p.height + 1,
          ),
        );
      }
    }
  }
}
