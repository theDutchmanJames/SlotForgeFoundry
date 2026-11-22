import { faceOf, nextCorner } from '../mesh-topology.js';
import { fineFilletSegments } from './curve-resolution.js';
import {
  topology,
  crease,
  resolveFinishEdge,
  withRoundedCorner,
  matchesCorner,
  faceBoundary,
  add3,
  sub3,
  mul3,
  dot3,
  cross3,
  length3,
  unit3,
} from './feature-selection.js';
import {
  finishTool,
  overlapFinishProfile,
  validateCreationFeature,
} from './create-features.js';

const close = (a, b, eps) => length3(sub3(a, b)) < eps;
const parallel = (a, b) => dot3(a, b) > 0.999995;
const tangentLimit = Math.cos((15 * Math.PI) / 180);
const maxEdges = 2048;
// Joined STL vertices are identical. Allow for the roundoff when a long
// straight edge is reconstructed from several collinear triangles.
const pointKey = (p) => p.map((x) => Math.round(x * 1e6)).join(',');
function edgeKey(edge) {
  if (edge.circle)
    return (
      'rim/' +
      pointKey(edge.circle.center) +
      '/' +
      pointKey(edge.circle.normal) +
      '/' +
      Math.round(edge.circle.radius * 1e6)
    );
  return [pointKey(edge.a), pointKey(edge.b)].sort().join('/');
}
export function compactEdge({ a, b, convex, n1, n2, witness, circle, corner }) {
  return {
    a,
    b,
    convex,
    n1,
    n2,
    witness,
    ...(circle ? { circle } : {}),
    ...(corner ? { corner } : {}),
  };
}
export function sameFinishEdge(a, b, eps = 0.0001, scope = 'corner') {
  if (!a || !b || a.convex !== b.convex || !!a.circle !== !!b.circle)
    return false;
  if (a.circle)
    return (
      close(a.circle.center, b.circle.center, eps) &&
      Math.abs(a.circle.radius - b.circle.radius) < eps &&
      parallel(a.circle.normal, b.circle.normal)
    );
  if (scope === 'corner' && a.corner && b.corner) {
    return matchesCorner(a, b, a.corner.start, a.corner.end, eps);
  }
  return (
    (close(a.a, b.a, eps) && close(a.b, b.b, eps)) ||
    (close(a.a, b.b, eps) && close(a.b, b.a, eps))
  );
}
export function validateEdgeGroup(op) {
  if (
    !Array.isArray(op.edges) ||
    !op.edges.length ||
    op.edges.length > 256 ||
    !['picked', 'corner', 'loop', 'tangent'].includes(op.scope)
  )
    throw Error('Pick 1–256 edges and choose a selection scope.');
  for (const edge of op.edges)
    validateCreationFeature({
      type: 'edgeFinish',
      kind: op.kind,
      size: op.size,
      edge,
    });
}

// Trace just the picked boundary cycle. A single planar face can also bound
// several holes, so collecting all its sharp edges would finish unrelated rims.
function traceLoop(t, start, allowStops) {
  const boundary = faceBoundary(t, faceOf(start)),
    outgoing = new Map();
  for (const e of boundary) {
    const v = t.indices[e];
    outgoing.set(v, outgoing.has(v) ? -1 : e);
  }
  const edges = [];
  let e = start;
  do {
    if (e == null || e < 0 || edges.length > boundary.length)
      throw Error(
        'This boundary branches. Shift-click the edges to finish instead.',
      );
    const ref = crease(t, e);
    if (!ref && !allowStops)
      throw Error(
        'This boundary meets a smooth surface. Pick its sharp edges individually.',
      );
    edges.push(ref);
    e = outgoing.get(t.indices[nextCorner(e)]);
  } while (e !== start);
  return edges;
}
const direction = (e) => unit3(sub3(e.b, e.a));
function follows(a, b) {
  return (
    a &&
    b &&
    a.convex === b.convex &&
    dot3(direction(a), direction(b)) >= tangentLimit &&
    dot3(a.n2, b.n2) >= tangentLimit
  );
}
function tangentRun(loop) {
  let first = 0,
    last = 0;
  while (last + 1 < loop.length && follows(loop[last], loop[last + 1])) last++;
  while (
    loop.length + first - 1 > last &&
    follows(loop.at(first - 1), loop.at(first))
  )
    first--;
  return first === 0
    ? loop.slice(0, last + 1)
    : [...loop.slice(first), ...loop.slice(0, last + 1)];
}
function mergeStraights(edges, bounds) {
  const out = [];
  const joinable = (a, b) =>
    parallel(a.n2, b.n2) &&
    parallel(direction(a), direction(b)) &&
    a.convex === b.convex &&
    close(a.b, b.a, 1e-5);
  for (const edge of edges) {
    const end = out.at(-1);
    if (end && joinable(end, edge)) end.b = edge.b;
    else out.push({ ...edge });
  }
  if (out.length > 1 && joinable(out.at(-1), out[0])) out[0].a = out.pop().a;
  for (const edge of out) {
    const m = mul3(add3(edge.a, edge.b), 0.5);
    edge.witness = m.map((x, i) =>
      bounds.max[i] === bounds.min[i]
        ? 0.5
        : (x - bounds.min[i]) / (bounds.max[i] - bounds.min[i]),
    );
  }
  return out;
}
const selections = new WeakMap();
export function selectedEdgeRefs(source, picked, scope = 'picked') {
  if (!source || !picked?.length) return [];
  const key = scope + JSON.stringify(picked.map(compactEdge));
  const prior = selections.get(source);
  if (prior?.key === key) return prior.edges;
  const t = topology(source),
    out = [],
    seen = new Set();
  // Data from a live pick has its original half-edge; persisted picks have to
  // be located on the current input, which can change after a history edit.
  for (const p of picked) {
    const e = Number.isInteger(p.halfEdge) ? p : resolveFinishEdge(source, p);
    let edges;
    if (scope === 'picked' || e.circle) edges = [e];
    else if (scope === 'corner')
      edges = withRoundedCorner(t, e).cornerEdges ?? [e];
    else {
      const side = parallel(t.normal(faceOf(e.halfEdge)), p.n1)
        ? e.halfEdge
        : t.twins[e.halfEdge];
      const ring = traceLoop(t, side, scope === 'tangent');
      edges = mergeStraights(
        scope === 'tangent' ? tangentRun(ring) : ring,
        t.bounds,
      );
    }
    for (const edge of edges) {
      const id = edgeKey(edge);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(edge);
      if (out.length > maxEdges)
        throw Error(
          'This boundary has too many edges for a live finish. Select a shorter chain.',
        );
    }
  }
  selections.set(source, { key, edges: out });
  return out;
}
function connects(edges, eps) {
  const chains = [],
    remaining = new Set(edges),
    ends = new Map();
  for (const e of edges)
    for (const p of [e.a, e.b]) {
      const key = pointKey(p);
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push(e);
    }
  while (remaining.size) {
    const first = remaining.values().next().value;
    remaining.delete(first);
    const chain = [first];
    for (const atStart of [false, true]) {
      while (true) {
        const p = atStart ? chain[0].a : chain.at(-1).b;
        const next = (ends.get(pointKey(p)) ?? []).filter((e) =>
          remaining.has(e),
        );
        if (next.length !== 1) break;
        const e = next[0];
        remaining.delete(e);
        const forward = close(p, atStart ? e.b : e.a, eps);
        const item = forward ? e : { ...e, a: e.b, b: e.a };
        if (atStart) chain.unshift(item);
        else chain.push(item);
      }
    }
    chains.push(chain);
  }
  return chains;
}
function wallNormal(edge, plane) {
  if (parallel(edge.n1, plane)) return edge.n2;
  if (parallel(edge.n2, plane)) return edge.n1;
}
// All cutters are constructed against the original stock. Adjacent edges of
// walls meeting a face at the same angle share one mitred sweep, including
// inside turns and the inclined sides of a drafted lid.
function groupedTools(wasm, solid, edges, op, own) {
  const tools = [],
    left = new Set(edges),
    eps = Math.max(
      solid.tolerance() * 8,
      length3(sub3(solid.boundingBox().max, solid.boundingBox().min)) * 2e-6,
    );
  while (left.size) {
    const e = left.values().next().value;
    let best = [],
      base;
    const cosine = dot3(e.n1, e.n2);
    if (!e.circle) {
      for (const n of [e.n1, e.n2]) {
        const coplanar = Array.from(left).filter(
          (item) =>
            !item.circle &&
            item.convex === e.convex &&
            Math.abs(dot3(item.n1, item.n2) - cosine) < 1e-5 &&
            wallNormal(item, n) &&
            Math.abs(dot3(sub3(item.a, e.a), n)) < eps,
        );
        if (coplanar.length > best.length) {
          best = coplanar;
          base = n;
        }
      }
    }
    if (best.length < 2) {
      left.delete(e);
      tools.push(finishTool(wasm, solid, op, own, e));
      continue;
    }
    best.forEach((item) => left.delete(item));
    for (const chain of connects(best, eps)) {
      tools.push(
        chain.length === 1
          ? finishTool(wasm, solid, op, own, chain[0])
          : sweptFinish(wasm, solid, op, chain, base, eps, own),
      );
    }
  }
  return tools;
}
function sweptFinish(wasm, solid, op, chain, normal, eps, own) {
  const closed = close(chain[0].a, chain.at(-1).b, eps);
  const side = chain[0].convex ? -1 : 1;
  const cosine = Math.max(-1, Math.min(1, dot3(chain[0].n1, chain[0].n2)));
  const sine = Math.sqrt(1 - cosine * cosine);
  const angle = Math.acos(-cosine),
    radius = op.size;
  const reach = op.kind === 'fillet' ? radius / Math.tan(angle / 2) : radius;
  const directions = chain.map((e) =>
    mul3(unit3(sub3(wallNormal(e, normal), mul3(normal, cosine))), side),
  );
  const rings = chain.map((e) => e.a);
  if (!closed) rings.push(chain.at(-1).b);
  let profile = [
    [0, 0],
    [reach, 0],
  ];
  if (op.kind === 'fillet') {
    const requested =
      op.curveVersion === 2
        ? fineFilletSegments(radius, Math.PI - angle)
        : Math.ceil(
            (Math.PI - angle) /
              (2 * Math.acos(Math.max(-1, 1 - 0.012 / radius))),
          );
    const steps = Math.min(128, Math.max(6, requested));
    for (let j = 1; j < steps; j++) {
      const a = (j * (Math.PI - angle)) / steps;
      profile.push([reach - radius * Math.sin(a), radius * (1 - Math.cos(a))]);
    }
  }
  profile.push([-cosine * reach, sine * reach]);
  if (op.scope === 'corner' || op.curveVersion === 2)
    profile = overlapFinishProfile(profile, [0, -1], [-sine, -cosine], eps);
  const positions = [],
    triangles = [],
    tip = [];
  for (let i = 0; i < rings.length; i++) {
    const backwards =
      directions[i - 1] ?? (closed ? directions.at(-1) : directions[0]);
    const forwards = directions[i] ?? directions.at(-1);
    const bisector = unit3(add3(forwards, backwards)),
      d = dot3(bisector, forwards);
    if (d < 1e-3)
      throw Error('This edge loop doubles back. Select a shorter chain.');
    const inset = mul3(bisector, 1 / d);
    tip.push(add3(rings[i], mul3(inset, reach)));
    for (const [x, y] of profile)
      positions.push(
        ...add3(rings[i], add3(mul3(inset, x), mul3(normal, y * side))),
      );
  }
  const k = profile.length;
  function supported(p, n) {
    return solid
      .rayCast(add3(p, mul3(n, eps)), sub3(p, mul3(n, eps)))
      .some((hit) => dot3(hit.normal, n) > 0.999);
  }
  for (let i = 0; i < chain.length; i++) {
    const ni = (i + 1) % rings.length,
      edge = chain[i];
    const delta = sub3(tip[ni], tip[i]);
    if (dot3(delta, direction(edge)) <= eps)
      throw Error('This finish would consume a short edge. Reduce its size.');
    for (const t of [0.02, 0.5, 0.98]) {
      const src = add3(edge.a, mul3(sub3(edge.b, edge.a), t));
      const dst = add3(tip[i], mul3(delta, t));
      const near = add3(src, mul3(sub3(dst, src), 0.99999));
      const flankPoint = add3(
        src,
        mul3(
          add3(mul3(normal, side * sine), mul3(directions[i], -cosine)),
          reach * 0.99999,
        ),
      );
      if (
        !supported(near, normal) ||
        !supported(flankPoint, wallNormal(edge, normal))
      )
        throw Error(
          'This finish extends past a selected wall or face. Reduce its size.',
        );
    }
    for (let j = 0; j < k; j++) {
      const nj = (j + 1) % k,
        a = i * k + j,
        b = ni * k + j,
        c = ni * k + nj,
        d = i * k + nj;
      triangles.push(a, b, c, a, c, d);
    }
  }
  if (!closed) {
    const last = (rings.length - 1) * k;
    for (let j = 1; j < k - 1; j++)
      triangles.push(0, j, j + 1, last, last + j + 1, last + j);
  }
  const point = (i) => sub3(positions.slice(i * 3, i * 3 + 3), rings[0]);
  let signed = 0;
  for (let i = 0; i < triangles.length; i += 3)
    signed += dot3(
      point(triangles[i]),
      cross3(point(triangles[i + 1]), point(triangles[i + 2])),
    );
  if (signed < 0)
    for (let i = 0; i < triangles.length; i += 3)
      [triangles[i + 1], triangles[i + 2]] = [
        triangles[i + 2],
        triangles[i + 1],
      ];
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(positions),
    triVerts: Uint32Array.from(triangles),
  });
  const tool = own(new wasm.Manifold(mesh));
  if (tool.status() !== 'NoError' || tool.volume() <= 0)
    throw Error(
      'The selected edges cannot share this finish. Reduce its size or select a shorter chain.',
    );
  return { tool, mode: side < 0 ? 'cut' : 'join' };
}
export function applyEdgeGroup(wasm, solid, op, own) {
  validateEdgeGroup(op);
  const edges = selectedEdgeRefs(solid, op.edges, op.scope);
  const tools = groupedTools(wasm, solid, edges, op, own);
  let result = solid;
  for (const mode of ['join', 'cut']) {
    const items = tools
      .filter((item) => item.mode === mode)
      .map((item) => item.tool);
    if (!items.length) continue;
    const tool =
      items.length === 1 ? items[0] : own(wasm.Manifold.union(items));
    result = own(mode === 'cut' ? result.subtract(tool) : result.add(tool));
  }
  if (result.status() !== 'NoError' || result.isEmpty() || result.volume() <= 0)
    throw Error('This finish leaves no printable part. Choose a smaller size.');
  return result;
}
