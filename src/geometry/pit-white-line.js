import clipping from 'polygon-clipping';
import { lineDimensions, lineGrooves, whiteLineLayout } from './paint-guides.js';
import { braidSpan } from './solids.js';
import { measuredLane } from './import-track.js';
import { connectorWarning } from './connector-warning.js';
import { pitBraidLandingShift } from './pit-braids.js';
import { dashIntervals } from './road-centre-line.js';

const rectangle = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];

// In local coordinates the pit is always above the racing lane. Find the
// lower boundary of discs swept along its guide. This gives the distance
// perpendicular to the lane even on a diagonal. Where a tight inside bend
// has less radius than the offset, use the envelope instead of a folded line.
function inwardEdge(points, distance, blendRun) {
  const segments = points.slice(1).map(([x, y], i) => {
    const [ax, ay] = points[i], dx = x - ax, dy = y - ay;
    const length = Math.hypot(dx, dy);
    const shift = distance * dy / length;
    return { start: ax + shift, end: x + shift, y: ay - distance * dx / length, slope: dy / dx };
  });
  const xs = new Set(points.map(q => q[0]));
  const start = points[0][0], end = points.at(-1)[0];
  for (const segment of segments)
    for (const x of [segment.start, segment.end]) if (x > start && x < end) xs.add(x);
  const envelope = [...xs].sort((a, b) => a - b).filter((x, i, all) => !i || x - all[i - 1] > 1e-7).map(x => {
    let low = Infinity;
    for (const segment of segments)
      if (x >= segment.start && x <= segment.end)
        low = Math.min(low, segment.y + (x - segment.start) * segment.slope);
    for (const [vx, vy] of points) {
      const dx = x - vx;
      if (Math.abs(dx) <= distance)
        low = Math.min(low, vy - Math.sqrt(Math.max(0, distance * distance - dx * dx)));
    }
    return [x, low];
  });
  return easeCorners(envelope, blendRun);
}

// Where two branches of a tight offset meet, the envelope has a sharp
// corner. Spread that change of slope over a short quadratic arc with
// matching tangents. The correction is zero outside each corner's window.
function easeCorners(edge, run) {
  const xs = new Set(edge.map(point => point[0]));
  const corners = [];
  for (let i = 1; i < edge.length - 1; i++) {
    const [x, y] = edge[i], [ax, ay] = edge[i - 1], [bx, by] = edge[i + 1];
    const before = (y - ay) / (x - ax), after = (by - y) / (bx - x);
    const turn = Math.abs(Math.atan(after) - Math.atan(before));
    if (turn < Math.PI / 90) continue;
    const reach = Math.min(run, x - edge[0][0], edge.at(-1)[0] - x);
    corners.push({ x, reach, curvature: (after - before) / (4 * reach) });
    const steps = Math.ceil(turn * 180 / Math.PI);
    for (let j = 0; j <= steps; j++) xs.add(x + reach * (2 * j / steps - 1));
  }
  if (!corners.length) return edge;
  let i = 0;
  return [...xs].sort((a, b) => a - b).map(x => {
    while (i + 2 < edge.length && x > edge[i + 1][0]) i++;
    const [ax, ay] = edge[i], [bx, by] = edge[i + 1];
    let y = ay + (by - ay) * (x - ax) / (bx - ax);
    for (const corner of corners) {
      const span = corner.reach - Math.abs(x - corner.x);
      if (span > 0) y += corner.curvature * span * span;
    }
    return [x, y];
  });
}

// Only the two sloping transitions are dashed. Measure along the stripe
// itself and reflect the entry pattern so both ends of the pit match.
function dividerSpans(p, points, line) {
  if (p.special.pitCrossingStyle !== 'dashed') return [[0, line.total]];
  const mid = points[Math.floor(points.length / 2)][1];
  const firstRise = points.findIndex(([, y]) => y > points[0][1] + 1e-6);
  const boxStart = points.findIndex(([, y]) => y >= mid - 1e-6);
  if (firstRise <= 0 || boxStart < firstRise) return [[0, line.total]];
  const a = line.ts[firstRise - 1] * line.total, b = line.ts[boxStart] * line.total;
  const entry = dashIntervals(b - a, p.dashLength ?? lineDimensions.dashLength, p.dashGap ?? lineDimensions.dashGap)
    .map(([from, to]) => [from + a, to + a]);
  const exit = entry.map(([from, to]) => [line.total - to, line.total - from]).reverse();
  return [[0, a], ...entry, [b, line.total - b], ...exit, [line.total - a, line.total]];
}

function stripePolygons(line, spans, halfWidth, surround) {
  // Merge touching paint spans and any overlapping groove caps before
  // offsetting. A continuous line has no groove across a pattern boundary.
  const runs = [];
  for (const [from, to] of spans) {
    const a = Math.max(0, from - surround), b = Math.min(line.total, to + surround);
    if (b <= a) continue;
    const previous = runs.at(-1);
    if (previous && a <= previous[1] + 1e-7) previous[1] = Math.max(previous[1], b);
    else runs.push([a, b]);
  }
  const width = halfWidth + surround;
  return runs.map(([from, to]) => {
    const a = from / line.total, b = to / line.total;
    const ts = [a, ...line.ts.filter(t => t > a && t < b), b];
    const low = ts.map(t => line.atOffset(t, -width)), high = ts.map(t => line.atOffset(t, width));
    return [[...low, ...high.reverse()]];
  });
}

// Each painted SVG polygon is filled independently. A mirrored pair that
// separates and rejoins can enclose a hole, so subdivide those fills.
function simpleLoops(polygons) {
  return polygons.flatMap(([outside, ...holes]) => {
    if (!holes.length) return [outside.slice(0, -1)];
    const xs = holes[0].map(q => q[0]);
    const cut = (Math.min(...xs) + Math.max(...xs)) / 2;
    const bx = outside.map(q => q[0]), by = outside.map(q => q[1]);
    const y0 = Math.min(...by) - 1, y1 = Math.max(...by) + 1;
    const polygon = [outside, ...holes];
    return [rectangle(Math.min(...bx) - 1, y0, cut, y1), rectangle(cut, y0, Math.max(...bx) + 1, y1)]
      .flatMap(half => simpleLoops(clipping.intersection(polygon, half)));
  });
}

function dividerClearance(p) {
  return p.slotWidth / 2 + braidSpan(p) + pitBraidLandingShift(p) + 1;
}

// The bay divider continues the pit-facing edge stripe of the original road,
// subject to clearance for the two lanes and their conductors.
export function pitDividerOffsetAtBay(p, sign) {
  const facing = whiteLineLayout(p, sign > 0 ? 'outer' : 'inner');
  const half = p.whiteLineWidth / 2, inset = facing.roadWidth && facing.borderWidth ? 0 : half;
  const shoulder = (p.width - (p.lanes - 1) * p.laneSpacing) / 2;
  const minimum = dividerClearance(p) + half + (lineGrooves(p).road ? p.grooveWidth : 0);
  return Math.min(p.special.pitOffset - minimum, Math.max(minimum, shoulder - inset));
}

export function pitWhiteLines(p, { forks, lanePaths }) {
  if (!p.special.pitWhiteLine) return { paint: [], grooves: [] };
  const half = p.whiteLineWidth / 2;
  const groove = lineGrooves(p).road ? p.grooveWidth : 0;
  const halfFootprint = half + groove;
  const protectedWidth = dividerClearance(p);
  const laneHalf = (p.lanes === 1 ? p.width : p.laneSpacing) / 2;
  const minDistance = protectedWidth + halfFootprint;
  const roomInBox = p.special.pitOffset - minDistance;
  if (Math.min(laneHalf, roomInBox) < minDistance)
    throw connectorWarning('Pit divider stripe', 'The stripe cannot fit inside the lane and between the pit-box braids.',
      'Reduce the line or groove width, widen the lane or increase the pit offset.',
      { tab: 'geometry', field: 'whiteLineWidth', label: 'Edit white line width' });

  const port = p.length / 2;
  const paints = [], surrounds = [];
  for (const [i, { sign, guardEndX }] of forks.entries()) {
    const branch = lanePaths[p.lanes + i], base = branch[0][1];
    const opposite = whiteLineLayout(p, sign > 0 ? 'inner' : 'outer');
    const deckEdge = -p.width / 2 - sign * base + opposite.roadWidth + opposite.roadGroove;
    const deckLimit = p.lanes > 1 ? Math.max(deckEdge, -p.laneSpacing + protectedWidth) : deckEdge;
    // Project the original pit-side road stripe straight through the box.
    // A line shared with the attached border is centred on the join. With
    // a narrow offset, reserve enough room beside both sets of conductors.
    const target = pitDividerOffsetAtBay(p, sign);
    const distance = Math.max(minDistance, Math.min(laneHalf,
      p.special.pitOffset - target, -deckLimit - halfFootprint - 1));
    const riseScale = (target + distance) / p.special.pitOffset;
    const points = [[-port, 0], ...branch.map(([x, y]) => [x, sign * (y - base) * riseScale]), [port, 0]];
    const blendRun = Math.min(distance / 4, 0.025 * p.length, 15);
    const centre = inwardEdge(points, distance, blendRun);
    const line = measuredLane(centre);
    const spans = dividerSpans(p, centre, line);
    // The paint and its surround are clipped separately. Reserving one
    // groove width at the end of each strip leaves printable caps on the
    // deck beside the braid, blade and track ends, including oblique cuts.
    function available(surround, inset) {
      const bands = stripePolygons(line, spans, half, surround);
      const stock = [
        [guardEndX + 1, protectedWidth, port, p.special.pitOffset],
        [-port, deckLimit, port, -protectedWidth],
      ].filter(([x0, y0, x1, y1]) => x1 - x0 > 2 * inset && y1 - y0 > 2 * inset)
        .map(([x0, y0, x1, y1]) => rectangle(x0 + inset, y0 + inset, x1 - inset, y1 - inset));
      const clipped = stock.length ? clipping.intersection(bands, stock) : [];
      return clipped.map(poly => poly.map(ring => ring.map(([x, y]) => [x, base + sign * y])));
    }
    paints.push(available(0, groove));
    if (groove) surrounds.push(available(groove, 0));
  }
  // Union mirrored strokes before outlining them. Segmenting the road
  // later lets these continuous outlines run through internal print seams.
  const paint = clipping.union(...paints);
  const recess = groove ? clipping.difference(clipping.union(...surrounds), paint) : [];
  // The solid uses an even-odd section, and the viewport traces the same
  // actual boundaries. Inner rings leave the painted islands at deck level.
  return { paint: simpleLoops(paint), grooves: recess.flatMap(poly => poly.map(ring => ring.slice(0, -1))) };
}
