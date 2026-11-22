import {
  add3,
  sub3,
  mul3,
  dot3,
  cross3,
  length3,
  unit3,
  locateHole,
  resolveFinishEdge,
} from './feature-selection.js';
import { fineFilletSegments } from './curve-resolution.js';
export { pickFinishEdge, defaultHolePlacement } from './feature-selection.js';

const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const positive = (n) => Number.isFinite(n) && n > 0;
const vector = (p) =>
  Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const isUnit = (p) => vector(p) && Math.abs(length3(p) - 1) < 1e-4;
const centre = ({ min, max }) => min.map((v, i) => (v + max[i]) / 2);
export function repeatableFeature(op) {
  return (
    ['hole', 'edgeFinish', 'featurePattern'].includes(op.type) ||
    (op.type === 'createSolid' && ['join', 'cut'].includes(op.result)) ||
    (['add', 'cut'].includes(op.type) && !op.separate)
  );
}

export function validateCreationFeature(op) {
  if (op.type === 'hole') {
    const seat = op.seat;
    if (
      !seat ||
      ![seat.normal, seat.u, seat.v].every(isUnit) ||
      Math.abs(dot3(seat.u, seat.v)) > 1e-5 ||
      dot3(cross3(seat.u, seat.v), seat.normal) < 0.9999 ||
      !vector(seat.witness) ||
      ![op.fromU, op.fromV].every((x) =>
        ['min', 'max', 'center'].includes(x),
      ) ||
      ![op.offsetU, op.offsetV].every(Number.isFinite)
    )
      throw Error(
        'Choose a flat mounting face and two distances for the hole centre.',
      );
    if (
      !['plain', 'counterbore', 'countersink'].includes(op.kind) ||
      !positive(op.diameter)
    )
      throw Error('Choose a hole shape and enter a positive bore diameter.');
    if (
      !['through', 'blind'].includes(op.extent) ||
      (op.extent === 'blind' && !positive(op.depth))
    )
      throw Error('Choose Through or enter a positive blind depth.');
    if (
      op.kind !== 'plain' &&
      (!positive(op.headDiameter) || op.headDiameter <= op.diameter)
    )
      throw Error('The head diameter must be larger than the bore diameter.');
    if (op.kind === 'counterbore' && !positive(op.headDepth))
      throw Error('Enter a positive counterbore depth.');
    if (
      op.kind === 'countersink' &&
      !(Number.isFinite(op.headAngle) && op.headAngle > 0 && op.headAngle < 180)
    )
      throw Error('Enter an included countersink angle between 0 and 180°.');
    if (
      op.kind !== 'plain' &&
      op.extent === 'blind' &&
      headHeight(op) >= op.depth
    )
      throw Error('The blind depth must extend below the screw head recess.');
  } else if (op.type === 'edgeFinish') {
    const edge = op.edge;
    if (
      !edge ||
      ![edge.a, edge.b, edge.witness].every(vector) ||
      ![edge.n1, edge.n2].every(isUnit) ||
      typeof edge.convex !== 'boolean' ||
      length3(sub3(edge.b, edge.a)) < 1e-8 ||
      Math.abs(dot3(edge.n1, edge.n2)) > 0.99999
    )
      throw Error('Pick a straight edge between two angled faces.');
    if (
      edge.circle &&
      (!positive(edge.circle.radius) ||
        !vector(edge.circle.center) ||
        !isUnit(edge.circle.normal) ||
        ![-1, 1].includes(edge.circle.outward))
    )
      throw Error('Pick the circular rim on the current part again.');
    if (
      edge.corner &&
      (edge.circle ||
        !vector(edge.corner.start) ||
        !vector(edge.corner.end) ||
        (edge.corner.middle != null && !vector(edge.corner.middle)) ||
        ((edge.corner.startWitness != null || edge.corner.endWitness != null) &&
          (!vector(edge.corner.startWitness) ||
            !vector(edge.corner.endWitness))) ||
        !isUnit(edge.corner.normal) ||
        !positive(edge.corner.length) ||
        length3(sub3(edge.corner.start, edge.corner.end)) < 1e-8)
    )
      throw Error('Pick the rounded corner on the current part again.');
    if (!['fillet', 'chamfer'].includes(op.kind) || !positive(op.size))
      throw Error('Choose Round or Bevel and set a positive size.');
  } else if (op.type === 'featurePattern') {
    if (
      typeof op.sourceId !== 'string' ||
      !op.sourceId ||
      op.sourceId === op.id
    )
      throw Error('Choose an earlier feature on this part to repeat.');
    if (
      !['mirror', 'linear', 'circular'].includes(op.kind) ||
      !Object.hasOwn(axes, op.axis)
    )
      throw Error('Choose a pattern and an X, Y or Z axis.');
    if (
      op.kind !== 'linear' &&
      (!['part', 'custom'].includes(op.centerMode) ||
        (op.centerMode === 'custom' && !vector(op.center)))
    )
      throw Error('Enter the pattern centre in world coordinates.');
    if (
      op.kind !== 'mirror' &&
      !(Number.isInteger(op.count) && op.count >= 2 && op.count <= 256)
    )
      throw Error('Use 2–256 total instances, including the original feature.');
    if (
      op.kind === 'linear' &&
      (!Number.isFinite(op.spacing) || op.spacing === 0)
    )
      throw Error('Enter a nonzero repeat spacing.');
    if (
      op.kind === 'circular' &&
      !(
        Number.isFinite(op.angle) &&
        Math.abs(op.angle) > 0 &&
        Math.abs(op.angle) <= 360
      )
    )
      throw Error(
        'Choose a circular sweep between −360° and 360°, excluding zero.',
      );
  } else throw Error('Unknown creation feature.');
}
function headHeight(op) {
  return op.kind === 'counterbore'
    ? op.headDepth
    : (op.headDiameter - op.diameter) /
        2 /
        Math.tan((op.headAngle * Math.PI) / 360);
}
function cylinderSegments(radius) {
  // About 0.02 mm chord error at normal print scales.
  return Math.min(
    512,
    Math.max(
      32,
      Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - 0.02 / radius)) / 4) * 4,
    ),
  );
}
function holeCutter(wasm, solid, op, own) {
  const p = locateHole(solid, op),
    { u, v, normal } = op.seat;
  const box = solid.boundingBox(),
    diag = length3(sub3(box.max, box.min));
  const eps = Math.max(solid.tolerance() * 4, diag * 2e-7);
  const depth = op.extent === 'through' ? diag + eps : op.depth;
  const r = op.diameter / 2;
  const segments = cylinderSegments(
    op.kind === 'plain' ? r : op.headDiameter / 2,
  );
  const cyl = (h, r1, r2, z) =>
    own(own(wasm.Manifold.cylinder(h, r1, r2, segments)).translate([0, 0, z]));
  let tool = cyl(depth + eps, r, r, -depth);
  if (op.kind !== 'plain') {
    const h = headHeight(op),
      rh = op.headDiameter / 2;
    const foot = op.kind === 'counterbore' ? rh : r;
    const top = rh + (eps * (rh - foot)) / h;
    tool = own(tool.add(cyl(h + eps, foot, top, -h)));
  }
  return own(tool.transform([...u, 0, ...v, 0, ...normal, 0, ...p, 1]));
}
function onFace(solid, p, n, eps) {
  return solid
    .rayCast(add3(p, mul3(n, eps)), sub3(p, mul3(n, eps)))
    .some((hit) => dot3(hit.normal, n) > 0.999);
}

// Mesh vertices are floats and the stock can retain double-precision faces.
// Extend the outside of the cutter across both supports to avoid a surviving
// film of the old wall. The dimensioned bevel or round stays at its specified
// points. The first vertex is the intersection of the two offset supports.
export function overlapFinishProfile(profile, faceOut, flankOut, margin) {
  const joint =
    margin / (1 + faceOut[0] * flankOut[0] + faceOut[1] * flankOut[1]);
  const offset = (p, n) => [p[0] + margin * n[0], p[1] + margin * n[1]];
  return [
    [(faceOut[0] + flankOut[0]) * joint, (faceOut[1] + flankOut[1]) * joint],
    offset(profile[1], faceOut),
    ...profile.slice(1),
    offset(profile.at(-1), flankOut),
  ];
}

function circularFinish(wasm, solid, op, edge, own) {
  const {
    circle: { center, radius, normal, outward },
    vertices,
    convex,
  } = edge;
  const side = convex ? -1 : 1,
    radialSign = side * outward,
    zSign = side,
    size = op.size;
  if (radialSign === -1 && size >= radius)
    throw Error(
      'The finish reaches the centre of this circular rim. Choose a smaller size.',
    );
  let profile = [
    [0, 0],
    [size, 0],
  ];
  if (op.kind === 'fillet') {
    const steps =
      op.curveVersion === 2
        ? fineFilletSegments(size, Math.PI / 2)
        : Math.max(4, cylinderSegments(size) / 4);
    for (let i = 1; i < steps; i++) {
      const theta = ((Math.PI / 2) * i) / steps;
      profile.push([
        size * (1 - Math.sin(theta)),
        size * (1 - Math.cos(theta)),
      ]);
    }
  }
  profile.push([0, size]);
  const reach = size * (1 - 1e-5),
    count = vertices.length;
  const eps = Math.max(
    solid.tolerance() * 8,
    length3(sub3(solid.boundingBox().max, solid.boundingBox().min)) * 1e-6,
  );
  if (op.curveVersion === 2)
    profile = overlapFinishProfile(profile, [0, -1], [-1, 0], eps);
  const cols = profile.length;
  const xyz = new Float32Array(count * cols * 3),
    tris = [];
  for (let i = 0; i < count; i++) {
    const v = vertices[i],
      next = vertices[(i + 1) % count],
      prev = vertices[(i + count - 1) % count];
    const r = unit3(sub3(v, center)),
      nr = unit3(sub3(next, center)),
      pr = unit3(sub3(prev, center));
    // Offset the real polygon's straight sides, preserving this STL's angular
    // phase and resolution. A new ideal circle can leave fins on a faceted bore.
    const outNext = unit3(add3(r, nr)),
      outPrev = unit3(add3(pr, r));
    const miter = unit3(add3(outNext, outPrev)),
      factor = 1 / dot3(miter, outNext);
    if (factor > 1.15)
      throw Error('The circular rim is too coarsely faceted for this finish.');
    const mid = mul3(add3(v, next), 0.5);
    if (
      !onFace(
        solid,
        add3(mid, mul3(outNext, radialSign * reach)),
        normal,
        eps,
      ) ||
      !onFace(
        solid,
        add3(mid, mul3(normal, zSign * reach)),
        mul3(outNext, outward),
        eps,
      )
    )
      throw Error(
        'The finish extends past the circular lip or cylindrical wall. Choose a smaller size.',
      );
    for (let j = 0; j < cols; j++) {
      const [dx, dz] = profile[j],
        p = add3(
          v,
          add3(mul3(miter, radialSign * factor * dx), mul3(normal, zSign * dz)),
        );
      xyz.set(p, 3 * (i * cols + j));
      const k = (j + 1) % cols,
        other = ((i + 1) % count) * cols,
        a = i * cols + j,
        b = other + j,
        c = other + k,
        d = i * cols + k;
      tris.push(a, b, c, a, c, d);
    }
  }
  let signed = 0;
  const point = (i) => sub3(xyz.subarray(3 * i, 3 * i + 3), center);
  for (let i = 0; i < tris.length; i += 3)
    signed += dot3(
      point(tris[i]),
      cross3(point(tris[i + 1]), point(tris[i + 2])),
    );
  if (signed < 0)
    for (let i = 0; i < tris.length; i += 3)
      [tris[i + 1], tris[i + 2]] = [tris[i + 2], tris[i + 1]];
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: xyz,
    triVerts: Uint32Array.from(tris),
  });
  return { tool: own(new wasm.Manifold(mesh)), mode: convex ? 'cut' : 'join' };
}
export function finishTool(
  wasm,
  solid,
  op,
  own,
  edge = resolveFinishEdge(solid, op.edge),
) {
  if (edge.circle) return circularFinish(wasm, solid, op, edge, own);
  const { a, b, n1, n2, convex } = edge;
  const dir = unit3(sub3(b, a)),
    length = length3(sub3(b, a));
  const proj = dot3(n1, n2),
    sign = convex ? -1 : 1;
  const t1 = mul3(unit3(sub3(n2, mul3(n1, proj))), sign);
  const t2 = mul3(unit3(sub3(n1, mul3(n2, proj))), sign);
  const theta = Math.acos(Math.max(-1, Math.min(1, dot3(t1, t2))));
  const reach = op.kind === 'chamfer' ? op.size : op.size / Math.tan(theta / 2);
  // At the midpoint of each supporting face, verify the requested tangent
  // still lies on the same plane. Excessive radii must not cut a distant wall.
  const extent = length3(
    sub3(solid.boundingBox().max, solid.boundingBox().min),
  );
  const eps = Math.max(solid.tolerance() * 8, extent * 1e-6);
  const mid = mul3(add3(a, b), 0.5);
  for (const [n, t] of [
    [n1, t1],
    [n2, t2],
  ]) {
    const p = add3(mid, mul3(t, reach * (1 - 1e-5)));
    if (!onFace(solid, p, n, eps))
      throw Error(
        'This finish extends beyond an adjacent face. Choose a smaller radius or bevel.',
      );
  }
  const boundary = [mul3(t1, reach)];
  if (op.kind === 'fillet') {
    const center = mul3(unit3(add3(t1, t2)), op.size / Math.sin(theta / 2));
    const start = unit3(sub3(boundary[0], center)),
      end = unit3(sub3(mul3(t2, reach), center));
    const angle = Math.acos(Math.max(-1, Math.min(1, dot3(start, end))));
    const count =
      op.curveVersion === 2
        ? fineFilletSegments(op.size, angle)
        : Math.max(
            4,
            Math.ceil((cylinderSegments(op.size) * angle) / (2 * Math.PI)),
          );
    for (let i = 1; i < count; i++) {
      const w = i / count,
        s = Math.sin(angle);
      const radial = add3(
        mul3(start, Math.sin((1 - w) * angle) / s),
        mul3(end, Math.sin(w * angle) / s),
      );
      boundary.push(add3(center, mul3(radial, op.size)));
    }
  }
  boundary.push(mul3(t2, reach));
  const u = t1,
    v = unit3(cross3(dir, u));
  const xy = (p) => [dot3(p, u), dot3(p, v)];
  let polygon = [[0, 0], ...boundary.map(xy)];
  if (op.curveVersion === 2)
    polygon = overlapFinishProfile(
      polygon,
      xy(mul3(n1, -sign)),
      xy(mul3(n2, -sign)),
      eps,
    );
  const profile = own(new wasm.CrossSection([polygon], 'EvenOdd'));
  const extruded = own(profile.extrude(length));
  return {
    tool: own(extruded.transform([...u, 0, ...v, 0, ...dir, 0, ...a, 1])),
    mode: convex ? 'cut' : 'join',
  };
}

export function patternCentre(op, bounds) {
  return op.centerMode === 'custom' ? op.center : centre(bounds);
}
function patternedTool(wasm, solid, op, seeds, own) {
  const seed = seeds.get(op.sourceId);
  if (
    !seed ||
    seed.target !== op.target ||
    !seed.tool ||
    !['join', 'cut'].includes(seed.mode)
  )
    throw Error('Choose an earlier added or cut feature on this same part.');
  const axis = axes[op.axis],
    copies = [],
    origin = patternCentre(op, solid.boundingBox());
  const around = (transform) => {
    const local = own(seed.tool.translate(mul3(origin, -1)));
    return own(own(transform(local)).translate(origin));
  };
  if (op.kind === 'mirror') copies.push(around((s) => s.mirror(axis)));
  else
    for (let i = 1; i < op.count; i++) {
      if (op.kind === 'linear')
        copies.push(own(seed.tool.translate(mul3(axis, i * op.spacing))));
      else {
        const divisor = Math.abs(op.angle) === 360 ? op.count : op.count - 1;
        copies.push(
          around((s) => s.rotate(mul3(axis, (op.angle * i) / divisor))),
        );
      }
    }
  for (let i = 0; i < copies.length; i++) {
    if (seed.mode === 'cut' && own(solid.intersect(copies[i])).volume() <= 0)
      throw Error(
        'Pattern copy ' +
          (i + 2) +
          ' has no material to cut. Adjust the axis, spacing or centre.',
      );
  }
  return {
    tool: copies.length === 1 ? copies[0] : own(wasm.Manifold.union(copies)),
    mode: seed.mode,
  };
}

/** Return caller-owned geometry. Keep the tool around only when a later operation references this feature. */
export function applyCreationFeature(wasm, solid, op, seeds, own) {
  validateCreationFeature(op);
  const { tool, mode } =
    op.type === 'hole'
      ? { tool: holeCutter(wasm, solid, op, own), mode: 'cut' }
      : op.type === 'edgeFinish'
        ? finishTool(wasm, solid, op, own)
        : patternedTool(wasm, solid, op, seeds, own);
  const result = own(mode === 'cut' ? solid.subtract(tool) : solid.add(tool));
  if (result.status() !== 'NoError' || result.isEmpty() || result.volume() <= 0)
    throw Error(
      'The operation leaves no printable solid. Reduce the size or change the placement.',
    );
  if (op.type === 'featurePattern' && mode === 'join') {
    // A chain of copies can legitimately connect through its neighbours. Check
    // the completed union so every connected component contains existing stock.
    const pieces = result.decompose().map(own);
    if (
      pieces.length > 1 &&
      pieces.some(
        (piece) =>
          piece.volume() > 0 && own(piece.intersect(solid)).volume() <= 0,
      )
    )
      throw Error(
        'A pattern copy is detached from the part. Adjust the centre, spacing or count until the added features touch.',
      );
  }
  const delta =
    mode === 'cut'
      ? solid.volume() - result.volume()
      : result.volume() - solid.volume();
  if (
    delta <=
    Math.max(
      solid.tolerance() ** 3,
      Math.abs(solid.volume()) * Number.EPSILON * 32,
    )
  )
    throw Error(
      'This feature coincides with existing geometry. Adjust its position or size.',
    );
  return { solid: result, tool, mode };
}
