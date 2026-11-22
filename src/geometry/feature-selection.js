import {
  faceOf,
  meshEdges,
  meshFromSolid,
  nextCorner,
  weldedMesh,
} from '../mesh-topology.js';
import { cornerRun } from './corner-run.js';

import { add3, sub3, mul3, dot3, cross3, length3, unit3 } from './vectors.js';
export { add3, sub3, mul3, dot3, cross3, length3, unit3 };
const parallel = (a, b) => dot3(a, b) > 0.999995;
const cache = new WeakMap();
const recentSeats = new WeakMap();
const fraction = (p, b) =>
  p.map((x, i) =>
    b.max[i] === b.min[i] ? 0.5 : (x - b.min[i]) / (b.max[i] - b.min[i]),
  );
const fromFraction = (p, b) =>
  p.map((x, i) => b.min[i] + x * (b.max[i] - b.min[i]));
const mid = (a, b) => mul3(add3(a, b), 0.5);

// Picking and replay use identical face numbers on rendered parts and worker solids.
export function topology(source) {
  if (cache.has(source)) return cache.get(source);
  const { positions, indices } = weldedMesh(
    source.positions ? source : meshFromSolid(source),
  );
  const bounds = source.bounds ?? source.boundingBox();
  const { twins } = meshEdges(indices, positions.length / 3);
  const normals = new Float32Array(indices.length);
  const vertex = (i) => Array.from(positions.subarray(i * 3, i * 3 + 3));
  const point = (e) => vertex(indices[e]);
  const normal = (f) => Array.from(normals.subarray(f * 3, f * 3 + 3));
  for (let e = 0; e < indices.length; e += 3) {
    const a = point(e);
    normals.set(unit3(cross3(sub3(point(e + 1), a), sub3(point(e + 2), a))), e);
  }
  const data = { indices, positions, twins, point, normal, bounds };
  cache.set(source, data);
  return data;
}

const recentBoundaries = new WeakMap();
export function faceBoundary(t, face) {
  const normal = t.normal(face);
  // On a dense cap, picking, rim detection and corner recognition all need
  // the same boundary. Identical seed normals ensure that the flood-fill's
  // angular criterion stays identical even on a slightly curved mesh.
  const recent = recentBoundaries.get(t) ?? [];
  const hit = recent.find(
    (item) =>
      item.visited.has(face) && normal.every((n, i) => n === item.normal[i]),
  );
  if (hit) return hit.boundary;
  const visited = new Set([face]),
    queue = [face],
    boundary = [];
  for (let j = 0; j < queue.length; j++) {
    for (let i = 0; i < 3; i++) {
      const e = 3 * queue[j] + i,
        other = t.twins[e];
      if (other < 0 || !parallel(normal, t.normal(faceOf(other))))
        boundary.push(e);
      else if (!visited.has(faceOf(other))) {
        visited.add(faceOf(other));
        queue.push(faceOf(other));
      }
    }
  }
  if (visited.size > 3) {
    recent.unshift({ normal, visited, boundary });
    if (recent.length > 4) recent.pop();
    recentBoundaries.set(t, recent);
  }
  return boundary;
}

function distance2ToSegment(p, a, b) {
  const d = sub3(b, a),
    l = dot3(d, d);
  if (l === 0) return dot3(sub3(p, a), sub3(p, a));
  const delta = sub3(
    sub3(p, a),
    mul3(d, Math.max(0, Math.min(1, dot3(sub3(p, a), d) / l))),
  );
  return dot3(delta, delta);
}

function distance2ToFace(t, face, p) {
  const a = t.point(3 * face),
    b = t.point(3 * face + 1),
    c = t.point(3 * face + 2),
    n = t.normal(face);
  if (
    [
      [a, b],
      [b, c],
      [c, a],
    ].every(([s, e]) => dot3(cross3(sub3(e, s), sub3(p, s)), n) >= 0)
  ) {
    const h = dot3(sub3(p, a), n);
    return h * h;
  }
  return Math.min(
    distance2ToSegment(p, a, b),
    distance2ToSegment(p, b, c),
    distance2ToSegment(p, c, a),
  );
}

export function makeHoleSeat(region, part) {
  if (!region?.planar || !region.loops?.length)
    throw Error('Select a flat face for the hole.');
  const { u, v, normal, origin } = region;
  const pick =
    region.seed?.point ??
    add3(
      origin,
      add3(mul3(u, region.anchor?.[0] ?? 0), mul3(v, region.anchor?.[1] ?? 0)),
    );
  return {
    u,
    v,
    normal,
    witness: fraction(pick, part.bounds),
    triangle: region.seed?.triangle ?? region.triangleIndices?.[0],
  };
}

export function resolveSeat(source, seat) {
  const key = [
    seat.triangle,
    ...seat.witness,
    ...seat.normal,
    ...seat.u,
    ...seat.v,
  ].join(',');
  const recent = recentSeats.get(source);
  if (recent?.key === key) return recent.value;
  const t = topology(source),
    p = fromFraction(seat.witness, t.bounds);
  let face = -1,
    nearest = Infinity;
  // Try the original triangle first; re-find the face when an upstream edit retessellates it.
  if (
    Number.isInteger(seat.triangle) &&
    seat.triangle >= 0 &&
    3 * seat.triangle < t.indices.length &&
    parallel(t.normal(seat.triangle), seat.normal)
  ) {
    face = seat.triangle;
    nearest = distance2ToFace(t, face, p);
  }
  for (let i = 0; i < t.indices.length && nearest > 1e-12; i += 3) {
    if (!parallel(t.normal(i / 3), seat.normal)) continue;
    const d = distance2ToFace(t, i / 3, p);
    if (d < nearest) {
      nearest = d;
      face = i / 3;
    }
  }
  if (face < 0)
    throw Error(
      'The mounting face has changed. Pick its current flat surface.',
    );
  const boundary = faceBoundary(t, face);
  const spans = [
    [Infinity, -Infinity],
    [Infinity, -Infinity],
  ];
  const edges = boundary.map((e) => [t.point(e), t.point(nextCorner(e))]);
  for (const [a] of edges)
    [seat.u, seat.v].forEach((direction, i) => {
      const x = dot3(a, direction);
      spans[i][0] = Math.min(x, spans[i][0]);
      spans[i][1] = Math.max(x, spans[i][1]);
    });
  const value = {
    face,
    spans,
    edges,
    level: dot3(t.point(3 * face), seat.normal),
    pick: p,
  };
  recentSeats.set(source, { key, value });
  return value;
}

export function defaultHolePlacement(region, part) {
  const seat = makeHoleSeat(region, part);
  let spans, pick;
  if (region.feature) {
    ({ spans, pick } = resolveSeat(part, seat));
  } else {
    // The worker already traced this face. Reuse its outline for the initial
    // centre rather than rebuilding a scan's adjacency on the UI thread.
    spans = [
      [Infinity, -Infinity],
      [Infinity, -Infinity],
    ];
    for (const loop of region.loops)
      for (const pt of loop) {
        for (let i = 0; i < 2; i++) {
          spans[i][0] = Math.min(spans[i][0], pt[i]);
          spans[i][1] = Math.max(spans[i][1], pt[i]);
        }
      }
    for (const [i, dir] of [seat.u, seat.v].entries()) {
      const origin = dot3(region.origin, dir);
      spans[i] = spans[i].map((x) => x + origin);
    }
    pick = fromFraction(seat.witness, part.bounds);
  }
  const values = [seat.u, seat.v].map((dir, i) => {
    const x = dot3(pick, dir),
      [lo, hi] = spans[i];
    const origin = x - lo <= hi - x ? 'min' : 'max';
    return {
      origin,
      offset: Number((origin === 'min' ? x - lo : hi - x).toFixed(6)),
    };
  });
  return {
    seat,
    fromU: values[0].origin,
    fromV: values[1].origin,
    offsetU: values[0].offset,
    offsetV: values[1].offset,
  };
}

export function locateHole(source, op, check = true) {
  const { seat } = op,
    { spans, level, edges } = resolveSeat(source, seat);
  const axis = (span, from, x) =>
    from === 'min'
      ? span[0] + x
      : from === 'max'
        ? span[1] - x
        : (span[0] + span[1]) / 2 + x;
  const x = axis(spans[0], op.fromU, op.offsetU),
    y = axis(spans[1], op.fromV, op.offsetV);
  const p = add3(
    mul3(seat.normal, level),
    add3(mul3(seat.u, x), mul3(seat.v, y)),
  );
  if (check) {
    // Test all loops, including interior rims. A hole must leave its entire mouth on material.
    let inside = false,
      margin2 = Infinity;
    for (const [a, b] of edges) {
      const ax = dot3(a, seat.u),
        ay = dot3(a, seat.v),
        bx = dot3(b, seat.u),
        by = dot3(b, seat.v);
      if (ay > y !== by > y && x < ax + ((bx - ax) * (y - ay)) / (by - ay))
        inside = !inside;
      margin2 = Math.min(margin2, distance2ToSegment(p, a, b));
    }
    const r = (op.kind === 'plain' ? op.diameter : op.headDiameter) / 2;
    if (!inside || Math.sqrt(margin2) < r - 1e-6)
      throw Error(
        'The hole crosses a face edge or an existing opening. Move its centre inward or reduce its diameter.',
      );
  }
  return p;
}

export function crease(t, e) {
  const other = t.twins[e];
  if (other < 0) return null;
  const n1 = t.normal(faceOf(e)),
    n2 = t.normal(faceOf(other)),
    cos = dot3(n1, n2);
  // A rounded surface consists of small tessellation angles; skip those seams.
  if (cos > Math.cos((3 * Math.PI) / 180) || cos < -0.99999) return null;
  const a = t.point(e),
    b = t.point(nextCorner(e)),
    c = t.point(nextCorner(nextCorner(e)));
  return { a, b, n1, n2, halfEdge: e, convex: dot3(n2, sub3(c, a)) < 0 };
}
function matchingEdge(a, b) {
  return (
    a.convex === b.convex &&
    ((parallel(a.n1, b.n1) && parallel(a.n2, b.n2)) ||
      (parallel(a.n1, b.n2) && parallel(a.n2, b.n1)))
  );
}
export function wholeEdge(t, face, first) {
  const dir = unit3(sub3(first.b, first.a)),
    length = length3(sub3(first.b, first.a));
  let lo = 0,
    hi = length;
  const eps = Math.max(1e-6, length3(sub3(t.bounds.max, t.bounds.min)) * 1e-6);
  const intervals = [];
  for (const e of faceBoundary(t, face)) {
    const item = crease(t, e);
    if (!item || !matchingEdge(first, item)) continue;
    const delta = sub3(item.a, first.a);
    if (length3(cross3(dir, delta)) > eps) continue;
    const a = dot3(delta, dir),
      b = dot3(sub3(item.b, first.a), dir);
    intervals.push([Math.min(a, b), Math.max(a, b)]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let start = Infinity,
    end = -Infinity;
  for (const [a, b] of intervals) {
    if (a > end + eps) {
      start = a;
      end = b;
    } else end = Math.max(end, b);
    if (start <= eps && end >= length - eps) {
      lo = start;
      hi = end;
    }
  }
  const a = add3(first.a, mul3(dir, lo)),
    b = add3(first.a, mul3(dir, hi));
  return { ...first, a, b, witness: fraction(mid(a, b), t.bounds) };
}

// A circular CAD edge becomes a polygon in an STL. Recover only closed,
// coplanar cycles with cylindrical neighbours and a consistent radius.
function rimOn(t, halfEdge, first) {
  const face = faceOf(halfEdge),
    n = t.normal(face);
  const boundary = faceBoundary(t, face);
  if (boundary.length < 8) return null;
  const outgoing = new Map();
  for (const e of boundary) {
    const v = t.indices[e];
    outgoing.set(v, outgoing.has(v) ? -1 : e);
  }
  const segments = [];
  let e = halfEdge;
  while (e >= 0 && segments.length <= boundary.length) {
    segments.push(e);
    e = outgoing.get(t.indices[nextCorner(e)]);
    if (e === halfEdge) break;
  }
  if (e !== halfEdge || segments.length < 8) return null;
  const vertices = segments.map((i) => t.point(i)),
    a = vertices[0];
  // Use a long chord and the point farthest from it to obtain a stable circle.
  let b = a;
  for (const p of vertices)
    if (length3(sub3(p, a)) > length3(sub3(b, a))) b = p;
  const chord = sub3(b, a),
    u = unit3(chord),
    v = cross3(n, u),
    half = length3(chord) / 2;
  let bestHeight = 0,
    c;
  for (const p of vertices) {
    const y = Math.abs(dot3(sub3(p, a), v));
    if (y > bestHeight) {
      bestHeight = y;
      c = p;
    }
  }
  if (bestHeight < half * 0.1) return null;
  const d = sub3(c, a),
    y = (dot3(d, d) - 2 * half * dot3(d, u)) / (2 * dot3(d, v));
  const center = add3(a, add3(mul3(u, half), mul3(v, y))),
    radius = length3(sub3(a, center));
  const tolerance = Math.max(1e-6, radius * 0.001);
  let outward = 0,
    radialTurn = 0;
  for (let i = 0; i < segments.length; i++) {
    const edge = crease(t, segments[i]);
    if (
      !edge ||
      edge.convex !== first.convex ||
      Math.abs(dot3(edge.n2, n)) > 0.001
    )
      return null;
    const du = sub3(edge.a, center),
      dv = sub3(edge.b, center),
      s = unit3(add3(du, dv));
    if (
      Math.abs(length3(du) - radius) > tolerance ||
      Math.abs(dot3(du, n)) > tolerance ||
      Math.abs(dot3(edge.n2, s)) < 0.999
    )
      return null;
    const sign = Math.sign(dot3(edge.n2, s));
    if (outward && sign !== outward) return null;
    outward = sign;
    radialTurn += Math.atan2(dot3(cross3(du, dv), n), dot3(du, dv));
  }
  if (Math.abs(Math.abs(radialTurn) - 2 * Math.PI) > 0.001) return null;
  return {
    ...first,
    witness: fraction(mid(first.a, first.b), t.bounds),
    centerWitness: fraction(center, t.bounds),
    circle: { center, radius, normal: n, outward },
    segments,
    vertices,
  };
}
function withRim(t, edge) {
  if (Math.abs(dot3(edge.n1, edge.n2)) > 0.001) return null;
  return (
    rimOn(t, edge.halfEdge, edge) ?? rimOn(t, t.twins[edge.halfEdge], edge)
  );
}
const cornerCache = new WeakMap();
function cornerOn(t, halfEdge) {
  const boundary = faceBoundary(t, faceOf(halfEdge)),
    next = new Map();
  for (const e of boundary) {
    const vertex = t.indices[e];
    next.set(vertex, next.has(vertex) ? -1 : e);
  }
  const spans = [];
  let e = halfEdge,
    visited = 0;
  const normal = t.normal(faceOf(halfEdge));
  const joinable = (a, b) =>
    a && b && matchingEdge(a.edge, b.edge) && dot3(a.dir, b.dir) > 1 - 1e-10;
  function join(a, b) {
    a.edge.b = b.edge.b;
    for (const member of b.members) a.members.push(member);
    a.length += b.length;
  }
  do {
    if (e == null || e < 0 || ++visited > boundary.length) return null;
    const edge = crease(t, e);
    const delta = edge && sub3(edge.b, edge.a);
    const s = edge && {
      edge,
      dir: unit3(delta),
      length: length3(delta),
      members: [e],
    };
    if (joinable(spans.at(-1), s)) join(spans.at(-1), s);
    else spans.push(s);
    e = next.get(t.indices[nextCorner(e)]);
  } while (e !== halfEdge);
  if (spans.length > 1 && joinable(spans.at(-1), spans[0])) {
    const tail = spans.pop();
    join(tail, spans[0]);
    spans[0] = tail;
  }
  const run = cornerRun(spans, 0, normal);
  if (!run) return null;
  const cornerEdges = run.map(({ edge }) => ({
    ...edge,
    witness: fraction(mid(edge.a, edge.b), t.bounds),
  }));
  const cornerPath = [
    ...cornerEdges.map((edge) => edge.a),
    cornerEdges.at(-1).b,
  ];
  const length = run.reduce((sum, s) => sum + s.length, 0);
  let distance = length / 2,
    middle = cornerPath[0];
  for (const span of run) {
    if (distance <= span.length) {
      middle = add3(span.edge.a, mul3(span.dir, distance));
      break;
    }
    distance -= span.length;
  }
  return {
    corner: {
      start: cornerPath[0],
      end: cornerPath.at(-1),
      middle,
      normal,
      startWitness: fraction(cornerPath[0], t.bounds),
      endWitness: fraction(cornerPath.at(-1), t.bounds),
      length,
    },
    cornerPath,
    cornerEdges,
    members: run.flatMap((s) => s.members),
  };
}
// Two arcs of a lens have the same endpoints. Distinguish the side of the
// chord containing the bend, allowing either direction along the same arc.
export function matchesCorner(ref, current, start, end, eps) {
  const side = (edge) => {
    const c = edge.corner;
    return Math.sign(
      dot3(
        cross3(
          sub3(c.end, c.start),
          sub3(c.middle ?? mid(edge.a, edge.b), c.start),
        ),
        c.normal,
      ),
    );
  };
  const c = current.corner;
  if (!c || !parallel(c.normal, ref.corner.normal)) return false;
  const near = (a, b) => length3(sub3(a, b)) <= eps;
  return side(ref) === side(current)
    ? near(c.start, start) && near(c.end, end)
    : near(c.start, end) && near(c.end, start);
}
export function withRoundedCorner(t, edge) {
  if (edge.circle || !Number.isInteger(edge.halfEdge)) return edge;
  let cache = cornerCache.get(t);
  if (!cache) {
    cache = new Map();
    cornerCache.set(t, cache);
  }
  const key = edge.halfEdge,
    twin = t.twins[key];
  if (!cache.has(key)) {
    const found = cornerOn(t, key) ?? (twin >= 0 ? cornerOn(t, twin) : null);
    if (cache.size > 8192) cache.clear();
    for (const e of found?.members ?? [key]) {
      if (cache.size >= 8192) break;
      cache.set(e, found);
      cache.set(t.twins[e], found);
    }
    cache.set(key, found);
  }
  const found = cache.get(key);
  return found
    ? {
        ...edge,
        corner: found.corner,
        cornerPath: found.cornerPath,
        cornerEdges: found.cornerEdges,
      }
    : edge;
}
export function pickFinishEdge(part, triangle, point) {
  const t = topology(part);
  if (
    !Number.isInteger(triangle) ||
    triangle < 0 ||
    triangle * 3 >= t.indices.length
  )
    return null;
  let best,
    bestDist = Infinity;
  for (const e of faceBoundary(t, triangle)) {
    const edge = crease(t, e);
    if (!edge) continue;
    const d = distance2ToSegment(point, edge.a, edge.b);
    if (d < bestDist) {
      best = edge;
      bestDist = d;
    }
  }
  if (!best) return null;
  const result =
    withRim(t, best) ?? withRoundedCorner(t, wholeEdge(t, triangle, best));
  result.pickDistance = Math.sqrt(bestDist);
  return result;
}
export function resolveFinishEdge(solid, ref) {
  const t = topology(solid),
    p = fromFraction(ref.witness, t.bounds);
  const probes = [{ point: p, distance: Infinity }];
  // An edit can change bounding-box fractions while leaving the actual
  // feature fixed in space. Test the original witness for that case too.
  if (ref.corner) probes.push({ point: mid(ref.a, ref.b), distance: Infinity });
  for (let e = 0; e < t.indices.length; e++) {
    if (t.twins[e] < e) continue;
    const candidate = crease(t, e);
    if (!candidate) continue;
    if (ref.corner && !ref.circle) {
      if (
        candidate.convex !== ref.convex ||
        ![candidate.n1, candidate.n2].some((n) =>
          parallel(n, ref.corner.normal),
        ) ||
        Math.abs(dot3(candidate.n1, candidate.n2) - dot3(ref.n1, ref.n2)) > 1e-4
      )
        continue;
    } else if (ref.circle) {
      if (
        candidate.convex !== ref.convex ||
        Math.abs(dot3(candidate.n1, candidate.n2)) > 0.001 ||
        ![candidate.n1, candidate.n2].some((n) =>
          parallel(n, ref.circle.normal),
        )
      )
        continue;
    } else if (!matchingEdge(ref, candidate)) continue;
    for (const probe of probes) {
      const d = distance2ToSegment(probe.point, candidate.a, candidate.b);
      if (d < probe.distance) {
        probe.edge = candidate;
        probe.distance = d;
      }
    }
  }
  const found = probes[0].edge;
  if (!found)
    throw Error(
      'The selected edge has changed. Pick its current crease or circular rim.',
    );
  if (ref.circle) {
    const rim = withRim(t, found);
    if (
      !rim ||
      rim.circle.outward !== ref.circle.outward ||
      !parallel(rim.circle.normal, ref.circle.normal)
    )
      throw Error(
        'This circular rim has changed. Pick the current rim on the model.',
      );
    return rim;
  }
  if (!ref.corner) return wholeEdge(t, faceOf(found.halfEdge), found);
  const original = ref.corner;
  const ends = [[original.start, original.end]];
  if (original.startWitness && original.endWitness)
    ends.unshift([
      fromFraction(original.startWitness, t.bounds),
      fromFraction(original.endWitness, t.bounds),
    ]);
  for (const { edge } of probes) {
    if (!edge) continue;
    const picked = withRoundedCorner(
      t,
      wholeEdge(t, faceOf(edge.halfEdge), edge),
    );
    for (const [a, b] of ends) {
      const tol = Math.max(
        1e-5,
        length3(sub3(t.bounds.max, t.bounds.min)) * 2e-6,
        length3(sub3(a, b)) * 0.15,
      );
      if (matchesCorner(ref, picked, a, b, tol)) return picked;
    }
  }
  throw Error('This rounded corner has changed. Pick its current edge.');
}
