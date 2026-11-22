import { distance } from './curves.js';
import { braidSpan, dot, left, minus, move, unit } from '../geometry/solids.js';
import { vertexNormals } from '../geometry/import-track.js';
import { interpolateStation } from '../geometry/braid-feeds.js';
import {
  findPathIntersections,
  findRouteCrossings,
  flatCrossingPlan,
} from '../flat-crossing.js';
import { assertSimpleOutline } from '../custom-track.js';

const isClosed = (line) =>
  line.length > 2 && distance(line[0], line.at(-1)) < 1e-5;
const matchTolerance = 0.3; // mm; both lane offsets may have been tessellated independently.
const ambiguous =
  'The slot paths do not identify one consistent road through this crossing. Export continuous SLOT_CENTRES for each passage, or choose Create track piece → Freeform path to draw the route.';

function stations(line) {
  const distances = [0];
  for (let i = 1; i < line.length; i++)
    distances.push(distances[i - 1] + distance(line[i - 1], line[i]));
  const total = distances.at(-1);
  return distances.map((d) => d / total);
}

function offsetLine(line, closed) {
  const normals = vertexNormals(closed ? line.slice(0, -1) : line, closed);
  if (closed) normals.push(normals[0]);
  return (offset) => line.map((p, i) => move(p, normals[i], offset));
}

const sample = (points, ts, t) => interpolateStation(ts, t, (i) => points[i]);

// At a closed lane, the first SVG/DXF vertex can be anywhere. Cut its
// cyclic point list at the point corresponding to the reference lane's seam.
function orientedLines(line, start, closed) {
  if (!closed)
    return [line, line.slice().reverse()].filter(
      (v) => distance(start, v[0]) <= matchTolerance,
    );
  const choices = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i],
      delta = minus(line[i + 1], a);
    const t = Math.max(
      0,
      Math.min(1, dot(minus(start, a), delta) / dot(delta, delta)),
    );
    const seam = move(a, delta, t);
    if (distance(seam, start) > matchTolerance) continue;
    const rotated = [
      seam,
      ...line.slice(i + 1, -1),
      ...line.slice(0, i + 1),
      seam,
    ].filter((p, j, list) => !j || distance(p, list[j - 1]) > 1e-7);
    choices.push(rotated, rotated.slice().reverse());
  }
  return choices;
}

// Recover a road from parallel, ordered lane paths. Register using a measured
// transverse offset, then verify the full route in both directions. Merely
// picking the nearest lane at the X can jump to a different passage.
function registerLane(reference, offset, candidate, closed) {
  if (closed !== isClosed(candidate)) return null;
  let longest = 1;
  for (let j = 2; j < reference.length; j++)
    if (
      distance(reference[j - 1], reference[j]) >
      distance(reference[longest - 1], reference[longest])
    )
      longest = j;
  const a = reference[longest - 1],
    b = reference[longest];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const tangent = unit(minus(b, a)),
    normal = left(tangent);
  // At a mitered corner the endpoint can move along the tangent. Along the
  // middle of a straight its signed distance from the reference is exact.
  for (let i = 1; i < candidate.length; i++) {
    const edge = minus(candidate[i], candidate[i - 1]);
    if (Math.abs(dot(unit(edge), tangent)) < 0.95) continue;
    const t = dot(minus(mid, candidate[i - 1]), tangent) / dot(edge, tangent);
    if (t < 0 || t > 1) continue;
    const shift = dot(minus(move(candidate[i - 1], edge, t), mid), normal);
    if (Math.abs(shift) < 0.01 || Math.abs(shift) >= 5000) continue;
    const predicted = offset(shift),
      predictedTs = stations(predicted);
    for (const actual of orientedLines(candidate, predicted[0], closed)) {
      if (distance(predicted.at(-1), actual.at(-1)) > matchTolerance) continue;
      const actualTs = stations(actual);
      if (
        predicted.every(
          (p, j) =>
            distance(p, sample(actual, actualTs, predictedTs[j])) <=
            matchTolerance,
        ) &&
        actual.every(
          (p, j) =>
            distance(p, sample(predicted, predictedTs, actualTs[j])) <=
            matchTolerance,
        )
      )
        return { shift, predictedTs, actual, actualTs };
    }
  }
  return null;
}

// Fractions of corresponding straight chords survive differences in how
// Circuit sampled an inner and outer curve. Preserve every drawn lane vertex.
function remap(ts, to, t) {
  let lo = 0,
    hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  return to[lo] + ((to[hi] - to[lo]) * (t - ts[lo])) / (ts[hi] - ts[lo]);
}

function roadGroup(reference, remaining, width, profile) {
  const closed = isClosed(reference),
    offset = offsetLine(reference, closed),
    refTs = stations(reference);
  const members = [
    { shift: 0, predictedTs: refTs, actual: reference, actualTs: refTs },
  ];
  for (const other of remaining) {
    const match = registerLane(reference, offset, other, closed);
    if (match) {
      remaining.delete(other);
      members.push(match);
    }
  }
  members.sort((a, b) => a.shift - b.shift);
  const channel = profile.slotWidth + 2 * braidSpan(profile);
  if (!Number.isFinite(channel))
    throw Error('Set a valid guide width, braid width and braid offset before importing.');
  if (
    members.length > 8 ||
    members.some((v, i) => i && v.shift - members[i - 1].shift <= channel)
  )
    throw Error(ambiguous);
  const spread = members.at(-1).shift - members[0].shift;
  if (spread + channel >= width)
    throw Error(
      `Set road width above ${(spread + channel).toFixed(1)} mm so the outer braid recesses fit.`,
    );
  const ts = [
    ...new Set(
      members
        .flatMap((m) => m.actualTs.map((t) => remap(m.predictedTs, refTs, t)))
        .concat(refTs),
    ),
  ]
    .sort((a, b) => a - b)
    .filter((t, i, list) => !i || t - list[i - 1] > 1e-9);
  const centerOffset = (members.at(-1).shift + members[0].shift) / 2;
  const edge = (shift) => {
    const line = offset(shift);
    return ts.map((t) => sample(line, refTs, t));
  };
  return {
    closed,
    center: edge(centerOffset),
    left: edge(centerOffset + width / 2),
    right: edge(centerOffset - width / 2),
    lanes: members.map((m) =>
      ts.map((t) =>
        sample(m.actual, m.actualTs, remap(refTs, m.predictedTs, t)),
      ),
    ),
  };
}

// The drawn lane centre paths are authoritative. A table or merged surface
// silhouette does not identify which side belongs to which passage.
// Height of a road at fraction t of its centre route, from Circuit's spot
// heights on the slot centrelines. Both passes share the crossing point, so
// samples near any crossing are ignored and the height comes from the
// nearest samples before and after along this route.
function routeHeight(line, closed, t, heights, crossingPoints, width) {
  const at = stations(line),
    total = line.reduce(
      (sum, p, i) => (i ? sum + distance(line[i - 1], p) : 0),
      0,
    );
  const accepted = [];
  for (const [x, y, z] of heights) {
    const p = [x, y];
    if (crossingPoints.some((c) => distance(c, p) < width)) continue;
    let best = Infinity,
      station = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        l2 = dx * dx + dy * dy;
      const f = l2
        ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
        : 0;
      const d = distance(p, [a[0] + f * dx, a[1] + f * dy]);
      if (d < best) {
        best = d;
        station = at[i - 1] + f * (at[i] - at[i - 1]);
      }
    }
    if (best <= width / 2 + 1) accepted.push({ s: station, z });
  }
  if (!accepted.length) return null;
  const gap = (from, to) => {
    const d = to - from;
    return closed ? (d + 1) % 1 : d;
  };
  let before, after;
  for (const sample of accepted) {
    const back = gap(sample.s, t),
      ahead = gap(t, sample.s);
    if (back >= 0 && (!before || back < before.d)) before = { ...sample, d: back };
    if (ahead >= 0 && (!after || ahead < after.d)) after = { ...sample, d: ahead };
  }
  if (!before || !after) return (before || after).z;
  const span = before.d + after.d;
  if (span * total < 1e-6) return before.z;
  return before.z + ((after.z - before.z) * before.d) / span;
}

function liftFromHeights(flatCrossing, routes, heights, width) {
  if (!heights?.length) return null;
  const points = flatCrossing.crossings.map((c) => c.point).filter(Boolean);
  if (points.length !== flatCrossing.crossings.length) return null;
  let decided = 0;
  for (const c of flatCrossing.crossings) {
    const [one, two] = routes;
    const first = routeHeight(one.line, one.closed, c.first, heights, points, width);
    const second = routeHeight(two.line, two.closed, c.second, heights, points, width);
    if (first === null || second === null || Math.abs(first - second) < 1)
      continue;
    c.upperPass = first > second ? 'first' : 'second';
    c.circuitHeightDifference = Number(Math.abs(first - second).toFixed(1));
    decided++;
  }
  if (!decided) return null;
  const rises = flatCrossing.crossings
    .map((c) => c.circuitHeightDifference)
    .filter((v) => v !== undefined);
  return (
    'Circuit’s height plan chose the upper pass at ' +
    (decided === flatCrossing.crossings.length
      ? decided === 1
        ? 'the crossing'
        : 'all ' + decided + ' crossings'
      : decided + ' of ' + flatCrossing.crossings.length + ' crossings') +
    ' (' +
    rises.map((v) => v + ' mm').join(', ') +
    ' between running surfaces).'
  );
}

export function inspectFlatImport(drawing, width, profile) {
  const lanes = drawing.lanes;
  if (!lanes?.length) return null;
  if (lanes.length > 16 || lanes.reduce((n, p) => n + p.length, 0) > 16000)
    return {
      warning:
        'This drawing is too large to resolve crossings in one import. Import a smaller set of roads to generate separate flat pieces.',
    };
  let detected = false;
  try {
    for (let i = 0; i < lanes.length && !detected; i++) {
      detected =
        findRouteCrossings(lanes[i], { closed: isClosed(lanes[i]) }).length > 0;
      for (let j = i + 1; !detected && j < lanes.length; j++)
        detected = findPathIntersections(lanes[i], lanes[j]).length > 0;
    }
    if (!detected) {
      const endpoints = lanes
        .filter((l) => !isClosed(l))
        .flatMap((l) => [l[0], l.at(-1)]);
      if (
        endpoints.some(
          (p) => endpoints.filter((q) => distance(p, q) < 1e-5).length > 2,
        )
      )
        return { warning: ambiguous };
      return null;
    }
    if (!Number.isFinite(width) || width < 2 || width > 5000)
      throw Error('Set road width between 2 and 5000 mm.');
    const remaining = new Set(lanes),
      roads = [];
    while (remaining.size) {
      const reference = remaining.values().next().value;
      remaining.delete(reference);
      roads.push(roadGroup(reference, remaining, width, profile));
    }
    if (roads.length === 1) {
      const r = roads[0];
      const flatCrossing = flatCrossingPlan(
        r.center,
        r.left,
        r.right,
        r.lanes,
        { closed: r.closed },
      );
      if (!flatCrossing) throw Error(ambiguous);
      for (const section of flatCrossing.sections)
        assertSimpleOutline(section.outlines[0]);
      const route = { line: r.center, closed: r.closed };
      const heightNote = liftFromHeights(
        flatCrossing,
        [route, route],
        drawing.heights,
        width,
      );
      return heightNote ? { flatCrossing, heightNote } : { flatCrossing };
    }
    if (
      roads.length !== 2 ||
      roads.some((r) => r.closed || findRouteCrossings(r.center).length)
    )
      throw Error(ambiguous);
    const intersections = findPathIntersections(
      roads[0].center,
      roads[1].center,
    );
    if (!intersections.length) throw Error(ambiguous);
    const sections = roads.map((r) => ({
      start: 0,
      end: 1,
      sides: [r.right, r.left],
      outlines: [[...r.right, ...r.left.slice().reverse()]],
      lanes: r.lanes,
    }));
    for (const section of sections) assertSimpleOutline(section.outlines[0]);
    const flatCrossing = {
      closed: false,
      independentRoutes: true,
      sections,
      crossings: intersections.map((c) => ({
        ...c,
        firstSection: 0,
        secondSection: 1,
        firstLocal: c.first,
        secondLocal: c.second,
        upperPass: 'second',
      })),
    };
    const heightNote = liftFromHeights(
      flatCrossing,
      roads.map((r) => ({ line: r.center, closed: false })),
      drawing.heights,
      width,
    );
    return heightNote ? { flatCrossing, heightNote } : { flatCrossing };
  } catch (error) {
    return { warning: error.message };
  }
}
