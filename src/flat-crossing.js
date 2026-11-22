// Distances along a route distinguish the two passages through the same XY point.
const EPS = 1e-7;
export const MAX_CROSSINGS = 32;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const length = (v) => Math.hypot(v[0], v[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function measured(points, closed) {
  if (points.length < 2 || points.length > 4096)
    throw Error('A crossing route needs 2–4096 path stations.');
  const stations = [0],
    edges = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      v = sub(b, a),
      size = length(v);
    if (size < EPS)
      throw Error(
        'Remove duplicate consecutive points from the crossing route.',
      );
    stations.push(stations[i] + size);
    edges.push({
      i,
      a,
      v,
      size,
      lo: Math.min(a[0], b[0]),
      hi: Math.max(a[0], b[0]),
      bottom: Math.min(a[1], b[1]),
      top: Math.max(a[1], b[1]),
    });
  }
  const total = stations.at(-1);
  return {
    points,
    stations: stations.map((d) => d / total),
    edges,
    total,
    closed,
  };
}

function locate(stations, t) {
  let lo = 0,
    hi = stations.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (stations[mid] <= t) lo = mid;
    else hi = mid;
  }
  return [lo, (t - stations[lo]) / (stations[lo + 1] - stations[lo])];
}

function passage(route, edge, fraction) {
  const n = route.edges.length;
  let before = edge,
    after = edge;
  if (fraction * edge.size < EPS) before = route.edges[(edge.i + n - 1) % n];
  if ((1 - fraction) * edge.size < EPS) after = route.edges[(edge.i + 1) % n];
  const t = route.stations[edge.i] + (fraction * edge.size) / route.total;
  if (!route.closed && (t * route.total < EPS || (1 - t) * route.total < EPS))
    return null;
  const incoming = before.v.map((v) => -v / before.size);
  const outgoing = after.v.map((v) => v / after.size);
  const forward = sub(outgoing, incoming),
    magnitude = length(forward);
  if (magnitude < EPS) return null;
  return {
    t: route.closed && (1 - t) * route.total < EPS ? 0 : t,
    direction: forward.map((v) => v / magnitude),
    rays: [incoming, outgoing],
  };
}

function intersections(one, two) {
  const same = one === two;
  const events = [
    ...one.edges.map((e) => ({ ...e, branch: 0 })),
    ...(same ? [] : two.edges.map((e) => ({ ...e, branch: 1 }))),
  ].sort((a, b) => a.lo - b.lo);
  const found = [];
  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    for (let j = i + 1; j < events.length && events[j].lo <= a.hi + EPS; j++) {
      const b = events[j];
      if (b.bottom > a.top + EPS || a.bottom > b.top + EPS) continue;
      if (!same && a.branch === b.branch) continue;
      const gap = Math.abs(a.i - b.i);
      if (same && (gap === 1 || (one.closed && gap === one.edges.length - 1)))
        continue;
      const denominator = cross(a.v, b.v);
      if (Math.abs(denominator) <= EPS * a.size * b.size) continue;
      const delta = sub(b.a, a.a);
      const u = cross(delta, b.v) / denominator,
        v = cross(delta, a.v) / denominator;
      if (
        u * a.size < -EPS ||
        v * b.size < -EPS ||
        (1 - u) * a.size < -EPS ||
        (1 - v) * b.size < -EPS
      )
        continue;
      let first = passage(a.branch ? two : one, a, Math.max(0, Math.min(1, u)));
      let second = passage(
        b.branch ? two : one,
        b,
        Math.max(0, Math.min(1, v)),
      );
      if (!first || !second) continue;
      // Four alternating rays distinguish a crossing from two bends that touch.
      const rays = [...first.rays, ...second.rays].map((r, k) => ({
        angle: Math.atan2(r[1], r[0]),
        path: k >> 1,
      }));
      rays.sort((r, s) => r.angle - s.angle);
      if (
        rays.some((r, k) => {
          const next = rays[(k + 1) % 4];
          const turn = (next.angle - r.angle + Math.PI * 2) % (Math.PI * 2);
          return r.path === next.path || turn < EPS;
        })
      )
        continue;
      if (a.branch || (same && second.t < first.t))
        [first, second] = [second, first];
      if (
        found.some(
          (c) =>
            Math.abs(c.first - first.t) * one.total < EPS &&
            Math.abs(c.second - second.t) * two.total < EPS,
        )
      )
        continue;
      if (found.length >= MAX_CROSSINGS)
        throw Error(
          'This layout has more than 32 crossings. Divide the route into smaller drawings.',
        );
      found.push({
        point: [a.a[0] + a.v[0] * u, a.a[1] + a.v[1] * u],
        first: first.t,
        second: second.t,
        firstDirection: first.direction,
        secondDirection: second.direction,
      });
    }
  }
  return found.sort((a, b) => a.first - b.first || a.second - b.second);
}

export function findRouteCrossings(center, { closed = false } = {}) {
  const route = measured(center, closed);
  return intersections(route, route);
}

export function findPathIntersections(firstPath, secondPath) {
  return intersections(measured(firstPath, false), measured(secondPath, false));
}

// Joining adjacent offsets into a *single* polygon would fuse the decks.
// Cut in the middle of each approach, interpolating every lane and edge at
// the same centreline station for a perpendicular, matching end face.
export function flatCrossingPlan(
  center,
  left,
  right,
  lanes,
  { closed = false, splitClosed = false, upperPasses = [] } = {},
) {
  if ([left, right, ...lanes].some((p) => p.length !== center.length))
    throw Error('The road edges and lanes need corresponding path stations.');
  const route = measured(center, closed);
  const crossings = intersections(route, route);
  if (!crossings.length && !(closed && splitClosed)) return null;
  const passes = crossings
    .flatMap((c) => [c.first, c.second])
    .sort((a, b) => a - b);
  if (passes.some((p, i) => i && (p - passes[i - 1]) * route.total < EPS))
    throw Error(
      'Three branches meet at one crossing. Separate the crossings in the drawing.',
    );
  const cuts = passes.slice(1).map((p, i) => (passes[i] + p) / 2);
  if (closed) {
    if (!passes.length) cuts.push(0, 0.5);
    else cuts.push(((passes[0] + passes.at(-1) + 1) / 2) % 1);
  } else cuts.push(0, 1);
  cuts.sort((a, b) => a - b);
  const intervals = cuts
    .slice(0, closed ? cuts.length : -1)
    .map((p, i) => [p, cuts[i + 1] ?? 1 + cuts[0]]);
  function slice(line, start, end) {
    const at = (t) => {
      const [i, f] = locate(route.stations, t);
      return lerp(line[i], line[i + 1], f);
    };
    const section = [at(start)];
    const append = (from, to) => {
      for (let i = 1; i < route.stations.length; i++) {
        const t = route.stations[i];
        if (t > from + EPS / route.total && t < to - EPS / route.total)
          section.push(line[i]);
      }
      section.push(at(to));
    };
    append(start, Math.min(1, end));
    if (end > 1 + EPS / route.total) append(0, end - 1);
    return section;
  }
  const sections = intervals.map(([start, end]) => {
    const sides = [slice(right, start, end), slice(left, start, end)];
    return {
      start,
      end,
      sides,
      outlines: [[...sides[0], ...sides[1].slice().reverse()]],
      lanes: lanes.map((l) => slice(l, start, end)),
    };
  });
  const sectionOf = (t) =>
    intervals.findIndex(([a, b]) => (t >= a && t < b) || t + 1 < b);
  crossings.forEach((c, i) =>
    Object.assign(c, {
      firstSection: sectionOf(c.first),
      secondSection: sectionOf(c.second),
      upperPass: upperPasses[i] === 'first' ? 'first' : 'second',
    }),
  );
  for (const c of crossings) {
    for (const pass of ['first', 'second']) {
      const [start, end] = intervals[c[pass + 'Section']];
      const t = c[pass] < start ? c[pass] + 1 : c[pass];
      c[pass + 'Local'] = (t - start) / (end - start);
    }
  }
  return { closed, crossings, sections };
}
