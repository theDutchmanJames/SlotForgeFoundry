import {
  solidNames,
  validFrame,
  workplane,
  worldPoint as world,
} from '../design.js';
import { fineCircleSegments } from './curve-resolution.js';
const XY = workplane('xy');
const dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0);
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const scale = (a, t) => a.map((x) => x * t);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const planarArea = (ring) =>
  ring.reduce((area, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return area + p[0] * q[1] - p[1] * q[0];
  }, 0) / 2;
const primitiveShapes = ['box', 'cylinder', 'sphere', 'cone', 'tube'];
export const solidKinds = Object.keys(solidNames);

function positive(x, label) {
  if (!Number.isFinite(x) || x <= 0)
    throw Error(label + ' must be greater than zero.');
}
function finite(x, label) {
  if (!Number.isFinite(x)) throw Error('Enter a finite ' + label + '.');
}
function validateFrame(frame) {
  if (!validFrame(frame))
    throw Error('Choose a valid workplane for the solid.');
}
export function validateCreation(op) {
  if (
    !solidKinds.includes(op.kind) ||
    !['new', 'join', 'cut'].includes(op.result)
  )
    throw Error('Choose a solid tool and a result.');
  if (op.result !== 'new' && (typeof op.target !== 'string' || !op.target))
    throw Error('Choose the part to modify.');
  if (op.kind === 'primitive') {
    if (!primitiveShapes.includes(op.shape))
      throw Error('Choose a solid shape.');
    if (op.frame) validateFrame(op.frame);
    for (const d of ['x', 'y', 'z']) finite(op[d] ?? 0, 'placement');
    if (op.shape === 'box') {
      positive(op.width, 'Width');
      positive(op.length, 'Length');
    } else positive(op.diameter, 'Diameter');
    if (op.shape !== 'sphere') positive(op.height, 'Height');
    if (op.shape === 'tube') {
      positive(op.bore, 'Bore diameter');
      if (op.bore >= op.diameter)
        throw Error('Make the bore smaller than the outside diameter.');
    }
    if (
      op.shape === 'cone' &&
      (!Number.isFinite(op.topDiameter) || op.topDiameter < 0)
    )
      throw Error('Top diameter must be zero or greater.');
    return;
  }
  if (typeof op.sketchId !== 'string' || !op.sketchId)
    throw Error('Choose a closed profile sketch.');
  if (op.kind === 'extrude') {
    positive(op.distance, 'Extrusion distance');
    if (
      !['auto', 'forward', 'reverse', 'symmetric'].includes(
        op.direction ?? 'auto',
      )
    )
      throw Error('Choose an extrusion direction.');
  } else if (op.kind === 'revolve') {
    if (!['u', 'v'].includes(op.axis))
      throw Error('Choose a sketch axis to revolve around.');
    finite(op.axisOffset, 'axis offset');
    if (!Number.isFinite(op.angle) || op.angle <= 0 || op.angle > 360)
      throw Error('Choose a revolution angle above 0° and up to 360°.');
  } else if (op.kind === 'sweep') {
    if (typeof op.pathId !== 'string' || !op.pathId)
      throw Error('Choose an open path sketch.');
  } else {
    if (
      typeof op.sectionId !== 'string' ||
      !op.sectionId ||
      op.sectionId === op.sketchId
    )
      throw Error('Choose a different sketch for the second section.');
    finite(op.sectionOffset, 'second section offset');
  }
}
function frameMatrix(f) {
  return [...f.u, 0, ...f.v, 0, ...f.normal, 0, ...f.origin, 1];
}
function sketchOf(sketches, id) {
  const s =
    sketches instanceof Map
      ? sketches.get(id)
      : sketches?.find((p) => p.id === id);
  if (!s)
    throw Error('A required sketch is missing. Choose an earlier sketch.');
  validateFrame(s.frame);
  return s;
}
function profileOf(wasm, sketch, own) {
  if (!sketch.loops?.length)
    throw Error('This sketch has no closed profile. Close its outline first.');
  const profile = own(new wasm.CrossSection(sketch.loops, 'EvenOdd'));
  if (profile.isEmpty() || !(profile.area() > 0))
    throw Error('The sketch has no printable area. Check its closed outlines.');
  return profile;
}
function segments(radius, curveVersion) {
  if (curveVersion === 2) return fineCircleSegments(radius, 256);
  // Limit chord error on typical printed curves, with a bounded render cost.
  return Math.max(
    32,
    Math.min(
      256,
      4 * Math.ceil(Math.PI / (4 * Math.acos(Math.max(0, 1 - 0.02 / radius)))),
    ),
  );
}
function primitive(wasm, op, own) {
  let solid;
  const M = wasm.Manifold;
  if (op.shape === 'box') {
    solid = own(
      own(M.cube([op.width, op.length, op.height])).translate([
        -op.width / 2,
        -op.length / 2,
        0,
      ]),
    );
  } else if (op.shape === 'sphere') {
    // Sphere facets run diagonally across an octant, requiring more steps
    // than a planar circle for comparable edge sag.
    const sphereSteps =
      Math.ceil((segments(op.diameter / 2, op.curveVersion) * Math.SQRT2) / 4) *
      4;
    solid = own(
      own(M.sphere(op.diameter / 2, sphereSteps)).translate([
        0,
        0,
        op.diameter / 2,
      ]),
    );
  } else {
    const r = op.diameter / 2,
      top = op.shape === 'cone' ? op.topDiameter / 2 : r;
    const n = segments(Math.max(r, top), op.curveVersion);
    solid = own(M.cylinder(op.height, r, top, n));
    if (op.shape === 'tube')
      solid = own(
        solid.subtract(own(M.cylinder(op.height, op.bore / 2, op.bore / 2, n))),
      );
  }
  const f = op.frame ?? XY;
  const direction = op.result === 'cut' ? -1 : 1;
  return own(
    solid.transform(
      frameMatrix({
        ...f,
        origin: world(f, [op.x ?? 0, op.y ?? 0], op.z ?? 0),
        normal: scale(f.normal, direction),
      }),
    ),
  );
}
function revolve(wasm, profile, f, op, own) {
  const vertical = op.axis === 'v';
  const radial = vertical ? f.u : f.v,
    axis = vertical ? f.v : f.u;
  const project = ([x, y]) =>
    vertical ? [x - op.axisOffset, y] : [y - op.axisOffset, x];
  let loops = profile.toPolygons().map((r) => r.map(project));
  let low = Infinity,
    high = -Infinity;
  for (const loop of loops)
    for (const [r] of loop) {
      low = Math.min(low, r);
      high = Math.max(high, r);
    }
  const eps = Math.max(1, Math.abs(low), Math.abs(high)) * 1e-9;
  if (low < -eps && high > eps)
    throw Error(
      'The profile crosses the revolution axis. Move the axis to an edge or to one side.',
    );
  const sign = high <= eps ? -1 : 1;
  loops = loops.map((loop) => loop.map(([r, h]) => [Math.max(0, r * sign), h]));
  const section = own(new wasm.CrossSection(loops, 'EvenOdd'));
  const solid = own(
    section.revolve(segments(Math.max(high, -low), op.curveVersion), op.angle),
  );
  const x = scale(radial, sign);
  return own(
    solid.transform(
      frameMatrix({
        u: x,
        v: cross(axis, x),
        normal: axis,
        origin: add(f.origin, scale(radial, op.axisOffset)),
      }),
    ),
  );
}

function cappedBody(wasm, vertices, triangles, own) {
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(vertices.flat()),
    triVerts: Uint32Array.from(triangles),
  });
  let solid;
  try {
    solid = own(new wasm.Manifold(mesh));
  } catch {
    throw Error(
      'The sections could not form closed walls. Check the sketches and their spacing.',
    );
  }
  if (solid.status() !== 'NoError' || solid.isEmpty() || !(solid.volume() > 0))
    throw Error('These sections do not enclose a printable solid.');
  return solid;
}
function cap(wasm, triangles, loops, offset, reverse) {
  for (const [a, b, c] of wasm.triangulate(loops)) {
    triangles.push(
      offset + a,
      offset + (reverse ? c : b),
      offset + (reverse ? b : c),
    );
  }
}
function sweep(wasm, profile, pathSketch, own) {
  if (pathSketch.paths?.length !== 1)
    throw Error('Choose a path sketch with a single connected open path.');
  const path = pathSketch.paths[0].filter(
    (p, i, pts) => i === 0 || Math.hypot(...sub(p, pts[i - 1])) > 1e-9,
  );
  if (path.length < 2) throw Error('The path needs two distinct points.');
  const rings = profile.toPolygons(),
    points = rings.flat(),
    rows = path.length;
  if (points.length * rows > 500_000)
    throw Error(
      'The sweep would exceed the printable mesh budget. Simplify the profile or path.',
    );
  const { min, max } = profile.bounds(),
    cx = (min[0] + max[0]) / 2,
    cy = (min[1] + max[1]) / 2;
  const normal = [];
  for (let i = 1; i < rows; i++) {
    const [dx, dy] = sub(path[i], path[i - 1]),
      length = Math.hypot(dx, dy);
    normal.push([-dy / length, dx / length]);
  }
  // The bisector and its scale intersect both offset lines, so a corner
  // shares exactly one ring with its neighbours, even at a sharp turn.
  const miters = path.map((_, i) => {
    const a = normal[Math.max(0, i - 1)],
      b = normal[Math.min(normal.length - 1, i)];
    const denominator = 1 + dot(a, b);
    if (denominator < 1e-7)
      throw Error(
        'The sweep reverses direction. Round the turn or edit the path.',
      );
    return scale(add(a, b), 1 / denominator);
  });
  const side = (absX) =>
    path.map((p, i) => add(p, scale(miters[i], absX - cx)));
  const right = side(min[0]),
    left = side(max[0]);
  for (let i = 1; i < rows; i++) {
    const tangent = sub(path[i], path[i - 1]);
    if (
      [right, left].some((edge) => dot(sub(edge[i], edge[i - 1]), tangent) <= 0)
    )
      throw Error(
        'The path bends too tightly for this profile. Widen the turn or reduce the profile width.',
      );
  }
  const strip = [...right, ...left.reverse()];
  const boundary = own(new wasm.CrossSection([strip], 'EvenOdd'));
  const area = Math.abs(planarArea(strip));
  if (Math.abs(boundary.area() - area) > Math.max(area * 1e-6, 1e-8))
    throw Error(
      'The swept path overlaps itself. Separate the crossing segments or narrow the profile.',
    );
  const vertices = [],
    triangles = [];
  for (let row = 0; row < rows; row++) {
    for (const [x, y] of points)
      vertices.push(
        world(
          pathSketch.frame,
          add(path[row], scale(miters[row], x - cx)),
          y - cy,
        ),
      );
  }
  cap(wasm, triangles, rings, 0, true);
  let start = 0;
  for (const ring of rings) {
    for (let row = 0; row < rows - 1; row++) {
      const first = row * points.length + start;
      for (let i = 0; i < ring.length; i++) {
        const a = first + i,
          b = first + ((i + 1) % ring.length);
        triangles.push(
          a,
          b,
          b + points.length,
          a,
          b + points.length,
          a + points.length,
        );
      }
    }
    start += ring.length;
  }
  cap(wasm, triangles, rings, (rows - 1) * points.length, false);
  return cappedBody(wasm, vertices, triangles, own);
}

function bounds2(pts) {
  const min = [Infinity, Infinity],
    max = [-Infinity, -Infinity];
  for (const p of pts)
    for (let i = 0; i < 2; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  return { min, max };
}
function ringData(worldPoints, frame) {
  const flat = worldPoints.map((p) => {
    const d = sub(p, frame.origin);
    return [dot(d, frame.u), dot(d, frame.v)];
  });
  const { min, max } = bounds2(flat);
  return {
    world: worldPoints,
    flat,
    area: planarArea(flat),
    center: min.map((lo, i) => (lo + max[i]) / 2),
    min,
    max,
  };
}
function registerRing(ring) {
  // Pick the same geometric corner on differently tessellated sections.
  // Normalising width and height also works on long rectangles and ellipses.
  let best = -Infinity,
    start = 0;
  for (let i = 0; i < ring.flat.length; i++) {
    const [x, y] = ring.flat[i].map(
      (v, k) => (v - ring.min[k]) / (ring.max[k] - ring.min[k] || 1),
    );
    const score = x + y;
    if (score > best + 1e-10) {
      best = score;
      start = i;
    }
  }
  const rotate = (a) => [...a.slice(start), ...a.slice(0, start)];
  const world = rotate(ring.world),
    flat = rotate(ring.flat);
  const stops = [0];
  for (let i = 0; i < world.length; i++)
    stops.push(
      stops[i] + Math.hypot(...sub(world[(i + 1) % world.length], world[i])),
    );
  const total = stops.at(-1);
  return { world, flat, stops: stops.map((n) => n / total) };
}
function sampleRing(ring, stops) {
  let cursor = 0;
  const flat = [],
    world = [];
  for (const t of stops) {
    while (cursor < ring.world.length - 1 && ring.stops[cursor + 1] <= t)
      cursor++;
    const dt =
      (t - ring.stops[cursor]) / (ring.stops[cursor + 1] - ring.stops[cursor]);
    const next = (cursor + 1) % ring.world.length;
    for (const [source, dest] of [
      [ring.flat, flat],
      [ring.world, world],
    ]) {
      if (dt < 1e-7) dest.push(source[cursor]);
      else if (dt > 1 - 1e-7) dest.push(source[next]);
      else
        dest.push(
          add(source[cursor], scale(sub(source[next], source[cursor]), dt)),
        );
    }
  }
  return { flat, world };
}
function loft(wasm, first, second, lower, upper, offset, own) {
  const worldContours = (profile, f, z) =>
    profile.toPolygons().map((r) => r.map((p) => world(f, p, z)));
  const lowRings = worldContours(first, lower, 0),
    highRings = worldContours(second, upper, offset);
  const origin = world(upper, [0, 0], offset);
  const lowSign = Math.sign(
    dot(sub(highRings[0][0], lower.origin), lower.normal),
  );
  const highSign = Math.sign(dot(sub(origin, lowRings[0][0]), upper.normal));
  const forwardLow = scale(lower.normal, lowSign),
    forwardHigh = scale(upper.normal, highSign);
  const tol = Math.max(Math.hypot(...sub(origin, lower.origin)) * 1e-9, 1e-7);
  if (
    highRings.some((r) =>
      r.some((p) => dot(sub(p, lower.origin), forwardLow) <= tol),
    ) ||
    lowRings.some((r) => r.some((p) => dot(sub(origin, p), forwardHigh) <= tol))
  )
    throw Error(
      'The loft sections touch or cross. Offset the second section until the planes clear both outlines.',
    );
  // Register and triangulate both outlines in their common bisector plane.
  // A perpendicular pair then retains both cap areas in projection.
  const unit = (v) => scale(v, 1 / Math.hypot(...v));
  const direction = unit(add(forwardLow, forwardHigh));
  const basis = Math.abs(dot(direction, lower.u)) < 0.9 ? lower.u : lower.v;
  const horiz = unit(sub(basis, scale(direction, dot(basis, direction))));
  const projection = {
    origin: lower.origin,
    u: horiz,
    v: cross(direction, horiz),
  };
  const contours = (rings, sign) =>
    rings
      .map((r) => ringData(sign < 0 ? r.reverse() : r, projection))
      .sort((a, b) => b.area - a.area);
  const bottom = contours(lowRings, lowSign),
    top = contours(highRings, highSign);
  if (
    bottom.length !== top.length ||
    [bottom, top].some((rings) => rings.filter((r) => r.area > 0).length !== 1)
  )
    throw Error(
      'Each loft section needs one outer outline and the same number of holes.',
    );
  // Match inner rings by their relative position in each section.
  const relative = (r, outer) =>
    r.center.map(
      (v, i) => (v - outer.min[i]) / (outer.max[i] - outer.min[i] || 1),
    );
  const topOuter = top[0],
    unused = top.slice(1);
  const pairs = bottom.map((a, i) => {
    let b = topOuter;
    if (i) {
      const p = relative(a, bottom[0]);
      let closest = 0,
        dist = Infinity;
      unused.forEach((r, j) => {
        const d = Math.hypot(...sub(p, relative(r, topOuter)));
        if (d < dist) {
          dist = d;
          closest = j;
        }
      });
      b = unused.splice(closest, 1)[0];
    }
    const low = registerRing(a),
      high = registerRing(b);
    const fractions = [
      ...low.stops.slice(0, -1),
      ...high.stops.slice(0, -1),
    ].sort((x, y) => x - y);
    const shared = [];
    for (const t of fractions)
      if (!shared.length || t - shared.at(-1) > 1e-7) shared.push(t);
    return [sampleRing(low, shared), sampleRing(high, shared)];
  });
  const base = pairs.map((pair) => pair[0]),
    end = pairs.map((pair) => pair[1]);
  for (const t of [0.25, 0.5, 0.75]) {
    const rings = pairs.map(([a, b]) =>
      a.flat.map((p, i) => add(p, scale(sub(b.flat[i], p), t))),
    );
    const signed = rings.reduce((area, r) => area + planarArea(r), 0);
    const filled = own(new wasm.CrossSection(rings, 'EvenOdd')).area();
    if (
      signed <= 0 ||
      Math.abs(signed - filled) > Math.max(1e-8, filled * 1e-5)
    )
      throw Error(
        'The loft crosses itself between its sections. Align the outlines and holes.',
      );
  }
  const points = base.flatMap((r) => r.world),
    count = points.length;
  const vertices = points.concat(end.flatMap((r) => r.world)),
    triangles = [];
  cap(
    wasm,
    triangles,
    base.map((r) => r.flat),
    0,
    true,
  );
  let k = 0;
  for (const ring of base) {
    for (let i = 0; i < ring.world.length; i++) {
      const a = k + i,
        b = k + ((i + 1) % ring.world.length);
      triangles.push(a, b, b + count, a, b + count, a + count);
    }
    k += ring.world.length;
  }
  cap(
    wasm,
    triangles,
    end.map((r) => r.flat),
    count,
    false,
  );
  return cappedBody(wasm, vertices, triangles, own);
}

/** Generate the feature before its result mode is applied. Own all WASM handles
 * in the caller's transaction so live previews and failed edits release them. */
export function createSolid(wasm, op, sketches, own) {
  validateCreation(op);
  let solid;
  if (op.kind === 'primitive') solid = primitive(wasm, op, own);
  else {
    const sketch = sketchOf(sketches, op.sketchId),
      profile = profileOf(wasm, sketch, own);
    if (op.kind === 'extrude') {
      const dir = op.direction ?? 'auto';
      const low =
        dir === 'symmetric'
          ? -op.distance / 2
          : dir === 'reverse' || (dir === 'auto' && op.result === 'cut')
            ? -op.distance
            : 0;
      const body = own(profile.extrude(op.distance));
      const f = { ...sketch.frame, origin: world(sketch.frame, [0, 0], low) };
      solid = own(body.transform(frameMatrix(f)));
    } else if (op.kind === 'revolve')
      solid = revolve(wasm, profile, sketch.frame, op, own);
    else if (op.kind === 'sweep')
      solid = sweep(wasm, profile, sketchOf(sketches, op.pathId), own);
    else {
      const other = sketchOf(sketches, op.sectionId);
      solid = loft(
        wasm,
        profile,
        profileOf(wasm, other, own),
        sketch.frame,
        other.frame,
        op.sectionOffset,
        own,
      );
    }
  }
  if (solid.status() !== 'NoError' || solid.isEmpty() || !(solid.volume() > 0))
    throw Error(
      'The feature produced no printable volume. Check its dimensions and outlines.',
    );
  return solid;
}
export function applyCreationResult(target, tool, mode, own) {
  if (mode === 'new') return tool;
  if (!target) throw Error('Select an existing part for this operation.');
  const joined = mode === 'join';
  if (!joined && mode !== 'cut') throw Error('Choose New part, Join or Cut.');
  const result = own(joined ? target.add(tool) : target.subtract(tool));
  if (
    result.status() !== 'NoError' ||
    result.isEmpty() ||
    !(result.volume() > 0)
  )
    throw Error(
      'This edit removes the whole part or leaves invalid geometry. Adjust the feature.',
    );
  const volume = target.volume(),
    delta = result.volume() - volume;
  if (
    Math.abs(delta) <=
    Math.max(Number.MIN_VALUE, Math.min(volume, tool.volume()) * 1e-10)
  )
    throw Error(
      joined
        ? 'This shape is already inside the part. Move it to add material.'
        : 'The cutter misses the part. Check its direction and placement.',
    );
  if (
    joined &&
    Math.abs(delta - tool.volume()) <= Math.min(volume, tool.volume()) * 1e-8
  ) {
    // Coplanar attachment is a valid join even without overlapping volume.
    const smallerArea = Math.min(target.surfaceArea(), tool.surfaceArea());
    if (
      target.surfaceArea() + tool.surfaceArea() - result.surfaceArea() <=
      smallerArea * 1e-9
    )
      throw Error(
        'The shape does not touch the part. Move it into contact or choose New part.',
      );
  }
  return result;
}
