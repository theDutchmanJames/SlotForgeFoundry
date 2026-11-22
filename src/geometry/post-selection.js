import { SolidWorkshop, dot, left, length2, minus, unit } from './solids.js';

const distance = (a, b) => length2(minus(a, b));
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const area = (loop) =>
  loop.reduce((a, p, i) => a + cross(p, loop[(i + 1) % loop.length]), 0) / 2;

function edges(loop) {
  return loop.map((a, i) => {
    const b = loop[(i + 1) % loop.length];
    return { a, b, length: distance(a, b) };
  });
}

export function contains(loop, [x, y]) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i],
      b = loop[j];
    if (
      a[1] > y !== b[1] > y &&
      x < a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
    )
      inside = !inside;
  }
  return inside;
}

// Circumcircle through three well-separated points. Confirm every bore vertex
// and its angular spacing, so bolt patterns and many-sided slots are rejected.
export function circularBore(loop, eps) {
  if (loop.length < 8) return null;
  const a = loop[0],
    u = minus(loop[Math.floor(loop.length / 3)], a);
  const v = minus(loop[Math.floor((2 * loop.length) / 3)], a),
    d = 2 * cross(u, v);
  if (Math.abs(d) < eps * eps) return null;
  const uu = dot(u, u),
    vv = dot(v, v);
  const center = [
    a[0] + (v[1] * uu - u[1] * vv) / d,
    a[1] + (u[0] * vv - v[0] * uu) / d,
  ];
  const radius = distance(a, center);
  if (
    radius <= eps ||
    !loop.every(
      (p, i) =>
        Math.abs(distance(p, center) - radius) <=
          Math.max(eps, radius * 0.002) &&
        distance(p, loop[(i + 1) % loop.length]) <= radius * 0.8,
    )
  )
    return null;
  return { center, radius };
}

// A circular hole alone may be in a plain lid. Require a substantial external
// arc concentric with that hole, where the post projects into the open cavity.
function postRadius(cavity, bore, eps) {
  const vectors = cavity.map((p) => minus(p, bore.center));
  let radius = 0,
    angle = 0,
    count = 0;
  for (let i = 0; i < 2 * vectors.length; i++) {
    const a = vectors[i % vectors.length],
      b = vectors[(i + 1) % vectors.length];
    if (!count) radius = length2(a);
    const step = Math.atan2(cross(a, b), dot(a, b));
    if (
      radius > bore.radius + eps &&
      step > 0 &&
      step <= Math.PI / 3 &&
      Math.abs(length2(b) - radius) <= Math.max(eps, radius * 0.0015)
    ) {
      count++;
      angle += step;
      if (count >= 4 && angle > Math.PI / 2) return radius;
    } else {
      count = 0;
      angle = 0;
    }
  }
  return null;
}

function bounds(loop) {
  return [0, 1].map((axis) => {
    const coords = loop.map((p) => p[axis]);
    return [Math.min(...coords), Math.max(...coords)];
  });
}

function rail(lines, axis, side, ranges, eps) {
  const other = 1 - axis,
    width = ranges[other][1] - ranges[other][0];
  const position = ranges[axis][side];
  const eligible = lines.filter(
    ({ a, b, length }) =>
      length > width / 4 &&
      Math.abs(a[axis] - position) < eps &&
      Math.abs(b[axis] - position) < eps,
  );
  if (!eligible.length) return null;
  const ends = eligible.flatMap(({ a, b }) => [a[other], b[other]]);
  return [Math.min(...ends), Math.max(...ends)];
}

// Reconstruct a constant-thickness rectangular rim only when all four long
// inner and outer rails agree. Offsetting the *observed* perimeter directly
// would also offset any piece of a post that bulges through an outer corner.
function protectedInterior(outer, cavity, eps) {
  const longest = edges(outer).reduce((a, b) => (a.length >= b.length ? a : b));
  const x = unit(minus(longest.b, longest.a)),
    y = left(x);
  const local = (p) => [dot(p, x), dot(p, y)];
  const face = ([a, b]) => [a * x[0] + b * y[0], a * x[1] + b * y[1]];
  const outside = outer.map(local),
    inside = cavity.map(local);
  const box = bounds(outside),
    voidBox = bounds(inside);
  const rails = [];
  const outerLines = edges(outside),
    innerLines = edges(inside);
  const thickness = [];
  for (const axis of [0, 1]) {
    rails[axis] = [];
    for (const side of [0, 1]) {
      const line = rail(outerLines, axis, side, box, eps);
      if (!line || !rail(innerLines, axis, side, voidBox, eps)) return null;
      rails[axis].push(line);
      thickness.push(Math.abs(box[axis][side] - voidBox[axis][side]));
    }
  }
  const wall = Math.max(...thickness);
  if (
    wall <= eps ||
    wall - Math.min(...thickness) > Math.max(eps, wall * 0.005)
  )
    return null;
  const points = [];
  for (const [sx, sy, start] of [
    [1, 1, 0],
    [0, 1, 90],
    [0, 0, 180],
    [1, 0, 270],
  ]) {
    const edgeX = box[0][sx],
      edgeY = box[1][sy];
    const rx = Math.abs(edgeX - rails[1][sy][sx]);
    const ry = Math.abs(edgeY - rails[0][sx][sy]);
    if (Math.abs(rx - ry) > Math.max(eps, wall * 0.005)) return null;
    const r = (rx + ry) / 2;
    if (r <= wall + eps) {
      points.push(face([voidBox[0][sx], voidBox[1][sy]]));
      continue;
    }
    const center = [edgeX + (sx ? -r : r), edgeY + (sy ? -r : r)];
    // Read the fillet's facet angle from surviving vertices of the actual STL.
    // The hidden interior follows the same concentric rounded corner.
    const angles = outside
      .filter((p) => Math.abs(distance(center, p) - r) < eps)
      .map(
        (p) =>
          ((Math.atan2(p[1] - center[1], p[0] - center[0]) * 180) / Math.PI -
            start +
            360) %
          360,
      )
      .filter((a) => a > 0.1 && a < 89.9);
    if (!angles.length) return null;
    const step = Math.min(...angles.map((a) => Math.min(a, 90 - a)));
    const segments = Math.round(90 / step);
    if (segments < 2 || segments > 256 || Math.abs(90 / segments - step) > 0.15)
      return null;
    for (let i = 0; i <= segments; i++) {
      const phi = ((start + (90 * i) / segments) * Math.PI) / 180;
      points.push(
        face([
          center[0] + (r - wall) * Math.cos(phi),
          center[1] + (r - wall) * Math.sin(phi),
        ]),
      );
    }
  }
  return points;
}

const toWorld = (region, [x, y]) =>
  region.origin.map((a, i) => a + x * region.u[i] + y * region.v[i]);

export function postOnFace(wasm, region, point) {
  if (
    !region.planar ||
    region.loops.length < 3 ||
    !Array.isArray(point) ||
    point.length !== 3 ||
    !point.every(Number.isFinite)
  )
    return null;
  // Feature recognition is optional. Keep ordinary mesh picking available on
  // very intricate faces without running extra polygon work for each click.
  if (region.loops.reduce((n, p) => n + p.length, 0) > 12000) return null;
  const ordered = region.loops
    .map((loop) => ({ loop, a: area(loop) }))
    .sort((a, b) => b.a - a.a);
  const outer = ordered[0].loop,
    cavity = ordered.at(-1).loop;
  if (ordered[1].a >= 0 || ordered.at(-1).a >= 0) return null;
  const eps = Math.max(1e-6, 1e-5 * Math.sqrt(ordered[0].a));
  const delta = point.map((p, i) => p - region.origin[i]);
  const uv = [region.u, region.v].map((axis) =>
    axis.reduce((sum, n, i) => sum + n * delta[i], 0),
  );
  const candidates = [];
  for (const { loop } of ordered.slice(1, -1)) {
    const bore = circularBore(loop, eps);
    if (!bore || distance(bore.center, uv) > bore.radius * 16) continue;
    const radius = postRadius(cavity, bore, eps);
    if (radius && distance(bore.center, uv) <= radius + eps)
      candidates.push({ bore, radius });
  }
  if (candidates.length !== 1) return null;
  const interior = protectedInterior(outer, cavity, eps);
  if (!interior) return null;
  const { bore, radius } = candidates[0],
    work = new SolidWorkshop(wasm);
  try {
    const face = work.section(region.loops);
    // Keep the guard inside the measured inner wall even at Float32 roundoff.
    const extent = Math.max(...outer.map((p) => length2(p)));
    const guardMargin = Math.max(
      eps / 20,
      (Math.hypot(...region.origin) + extent) * 2 ** -20,
    );
    if (guardMargin > bore.radius / 50) return null;
    const guard = work.own(
      work.section([interior]).offset(-guardMargin, 'Miter'),
    );
    const circle = work.own(
      wasm.CrossSection.circle((radius + 2 * eps) / Math.cos(Math.PI / 96), 96),
    );
    const disk = work.own(circle.translate(bore.center));
    const footprint = work.and(work.and(face, guard), disk);
    const loops = footprint.toPolygons();
    if (
      loops.length !== 2 ||
      !loops.some((loop) => area(loop) < 0 && contains(loop, bore.center)) ||
      loops.filter((loop) => contains(loop, uv)).length !== 1
    )
      return null;
    const vertices = loops.flat().map((p) => toWorld(region, p));
    const patches = wasm
      .triangulate(loops)
      .map((tri) => tri.map((i) => vertices[i]));
    if (!patches.length) return null;
    const sourceFaceKey = region.triangleIndices.reduce(
      (a, b) => Math.min(a, b),
      Infinity,
    );
    const center = toWorld(region, bore.center);
    const featureKey =
      'post-' +
      sourceFaceKey +
      '-' +
      center.map((n) => Math.round(n / eps)).join('/');
    return {
      ...region,
      loops,
      triangleIndices: [],
      patches,
      feature: 'post',
      featureKey,
      key: featureKey,
      sourceFaceKey,
    };
  } finally {
    work.close();
  }
}
