import {
  add3,
  cross3,
  dot3,
  faceBoundary,
  length3,
  mul3,
  resolveFinishEdge,
  sub3,
  topology,
} from './feature-selection.js';
import { faceOf, nextCorner } from '../mesh-topology.js';

const positive = (v) => Number.isFinite(v) && v > 0;
const vector = (v) =>
  Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const mm = (v) => Number(v.toFixed(3)) + ' mm';

export function isHoleRim(edge) {
  return edge?.convex === true && edge.circle?.outward === -1;
}

export function sameHoleRim(a, b) {
  if (!isHoleRim(a) || !isHoleRim(b)) return false;
  const tolerance = Math.max(0.00001, a.circle.radius * 0.0001);
  return (
    length3(sub3(a.circle.center, b.circle.center)) <= tolerance &&
    Math.abs(a.circle.radius - b.circle.radius) <= tolerance &&
    dot3(a.circle.normal, b.circle.normal) > 0.99999
  );
}

export function holeRimReference(edge) {
  const { a, b, n1, n2, convex, witness, circle, centerWitness } = edge;
  return { a, b, n1, n2, convex, witness, circle, centerWitness };
}

export function validateHoleModify(op) {
  if (!Array.isArray(op.rims) || !op.rims.length || op.rims.length > 128)
    throw Error('Select between 1 and 128 circular hole rims on this part.');
  for (const [i, rim] of op.rims.entries()) {
    if (
      !isHoleRim(rim) ||
      ![
        rim.witness,
        rim.centerWitness,
        rim.a,
        rim.b,
        rim.circle.center,
        rim.circle.normal,
      ].every(vector) ||
      Math.abs(length3(rim.circle.normal) - 1) > 1e-4 ||
      !positive(rim.circle.radius)
    )
      throw Error(
        'Hole ' +
          (i + 1) +
          ' · Pick the circular opening of a cylindrical bore.',
      );
    if (op.rims.slice(0, i).some((r) => sameHoleRim(r, rim)))
      throw Error('Hole ' + (i + 1) + ' · This opening is selected twice.');
  }
  if (!['resize', 'counterbore', 'countersink', 'fill'].includes(op.kind))
    throw Error('Choose how to modify the selected holes.');
  if (op.kind === 'resize' && !positive(op.diameter))
    throw Error('Enter a positive bore diameter.');
  if (
    ['counterbore', 'countersink'].includes(op.kind) &&
    !positive(op.headDiameter)
  )
    throw Error('Enter a positive head diameter.');
  if (op.kind === 'counterbore' && !positive(op.headDepth))
    throw Error('Enter a positive counterbore depth.');
  if (
    op.kind === 'countersink' &&
    !(op.headAngle > 0 && op.headAngle < 180 && Number.isFinite(op.headAngle))
  )
    throw Error('Enter an included head angle between 0° and 180°.');
}

function segmentDistance(point, a, b) {
  const edge = sub3(b, a);
  const u = dot3(sub3(point, a), edge) / dot3(edge, edge);
  return length3(sub3(point, add3(a, mul3(edge, Math.max(0, Math.min(1, u))))));
}

// Follow each actual cylindrical facet from the lip to its far boundary.
// A blind bottom, opposite opening, counterbore shoulder or side passage
// naturally stops this traversal. No ray is allowed to reach a second slab.
function boreDimensions(solid, rim, eps) {
  const t = topology(solid),
    { segments, circle } = rim;
  const ownLip = new Set(segments);
  let land = Infinity,
    short = Infinity,
    long = 0;
  for (const e of faceBoundary(t, faceOf(segments[0]))) {
    if (!ownLip.has(e))
      land = Math.min(
        land,
        segmentDistance(circle.center, t.point(e), t.point(nextCorner(e))),
      );
  }
  for (const e of segments) {
    for (const f of faceBoundary(t, faceOf(t.twins[e]))) {
      const a = t.point(f),
        b = t.point(nextCorner(f));
      const delta = sub3(b, a);
      // A re-tessellated straight wall may have many vertices along its side
      // rails. Only the rim and the facet's transverse ends bound the depth.
      if (length3(cross3(delta, circle.normal)) <= eps) continue;
      for (const p of [a, b]) {
        const h = dot3(sub3(circle.center, p), circle.normal);
        if (h > eps) {
          short = Math.min(short, h);
          long = Math.max(long, h);
        }
      }
    }
  }
  if (!Number.isFinite(short) || short <= eps)
    throw Error('The cylindrical bore has no measurable depth.');
  return { land, short, long };
}

// Keep the actual STL polygon's phase and facets at both ends of the cut.
// A separately tessellated ideal cylinder would leave small fins in the bore.
function frustum(
  wasm,
  rim,
  radiusTop,
  radiusBottom,
  depth,
  own,
  topExtension = 0,
) {
  const {
    circle: { radius, normal, center },
  } = rim;
  const ordered = [...rim.vertices];
  const clockwise =
    dot3(cross3(sub3(ordered[0], center), sub3(ordered[1], center)), normal) <
    0;
  if (clockwise) ordered.reverse();
  const n = ordered.length,
    base = sub3(center, mul3(normal, depth));
  const top = add3(center, mul3(normal, topExtension));
  const positions = new Float32Array(3 * (2 * n + 2));
  const triangles = [];
  positions.set(top, 6 * n);
  positions.set(base, 6 * n + 3);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n,
      d = sub3(ordered[i], center);
    positions.set(add3(base, mul3(d, radiusBottom / radius)), 3 * i);
    positions.set(add3(top, mul3(d, radiusTop / radius)), 3 * (n + i));
    triangles.push(
      i,
      j,
      n + j,
      i,
      n + j,
      n + i,
      2 * n,
      n + i,
      n + j,
      2 * n + 1,
      j,
      i,
    );
  }
  return own(
    new wasm.Manifold(
      new wasm.Mesh({
        numProp: 3,
        vertProperties: positions,
        triVerts: Uint32Array.from(triangles),
      }),
    ),
  );
}

function prepare(wasm, solid, rim, op, eps, own) {
  const { radius } = rim.circle;
  const { land, short, long } = boreDimensions(solid, rim, eps);
  const recess = op.kind === 'counterbore' || op.kind === 'countersink';
  const outer = (recess ? op.headDiameter : op.diameter) / 2;
  const isFill = op.kind === 'fill';
  if (recess && outer <= radius + eps)
    throw Error(
      'Head diameter must exceed this bore’s diameter of ' +
        mm(2 * radius) +
        '.',
    );
  if (!recess && long - short > 4 * eps)
    throw Error(
      'The bore meets a sloping exit or side passage. Resizing or filling needs an uninterrupted cylindrical wall with a flat end.',
    );
  if (!isFill && outer > radius && outer >= land - eps)
    throw Error(
      'The opening would cross the supporting face. Choose a diameter below ' +
        mm(2 * land) +
        '.',
    );
  const slope =
    op.kind === 'countersink' ? Math.tan((op.headAngle * Math.PI) / 360) : 0;
  const depth =
    op.kind === 'countersink'
      ? (outer - radius) / slope
      : op.kind === 'counterbore'
        ? op.headDepth
        : short;
  if (recess && depth >= short - eps) {
    const limit =
      op.kind === 'countersink'
        ? ' Use a head diameter below ' +
          mm(2 * (radius + short * slope)) +
          ' at this angle.'
        : ' Reduce the recess depth.';
    throw Error(
      'Only ' + mm(short) + ' of straight bore is available.' + limit,
    );
  }
  if (op.kind === 'resize' && Math.abs(outer - radius) <= eps) return null;
  const tool = (a, b, h = depth) => frustum(wasm, rim, a, b, h, own);
  if (isFill || outer < radius) {
    // A slight overlap into the original wall welds the plug to arbitrarily
    // oriented facet planes after the STL float32 round trip.
    const plug = tool(radius + eps, radius + eps);
    return {
      tool: isFill ? plug : own(plug.subtract(tool(outer, outer))),
      join: true,
    };
  }
  const inner = tool(radius, radius);
  const cut = tool(outer, op.kind === 'countersink' ? radius : outer);
  const annulus = own(cut.subtract(inner));
  function supported(shell) {
    const outside = own(shell.subtract(solid));
    return (
      outside.volume() <= Math.max(eps ** 3, Math.abs(shell.volume()) * 1e-5)
    );
  }
  if (!supported(annulus)) {
    // The top land fits but a hidden cavity intersects the cut. Find a usable
    // diameter with the user's angle/depth before reporting the failed rim.
    let lo = radius,
      hi = outer;
    for (let n = 0; n < 14 && hi - lo > 0.0005; n++) {
      const r = (lo + hi) / 2;
      const h = op.kind === 'countersink' ? (r - radius) / slope : depth;
      const trial = tool(r, op.kind === 'countersink' ? radius : r, h);
      if (supported(own(trial.subtract(tool(radius, radius, h))))) lo = r;
      else hi = r;
    }
    throw Error(
      'The cut breaks into a cavity or sidewall below the lip. At this setting the available diameter is about ' +
        mm(2 * lo) +
        '.',
    );
  }
  // A tilted imported face can be a few float ULPs out of plane. Extend the
  // boolean cutter past the mouth so no uncut, paper-thin membrane remains.
  const extension = 8 * eps;
  const bottom = sub3(rim.circle.center, mul3(rim.circle.normal, depth));
  const axial = mul3(rim.circle.normal, extension);
  const blind =
    !recess &&
    solid
      .rayCast(add3(bottom, axial), sub3(bottom, axial))
      .some((hit) => dot3(hit.normal, rim.circle.normal) > 0.99);
  return {
    tool: frustum(
      wasm,
      rim,
      outer + extension * slope,
      op.kind === 'countersink' ? radius : outer,
      depth + (recess || blind ? 0 : extension),
      own,
      extension,
    ),
    join: false,
  };
}

export function applyHoleModify(wasm, solid, op, own) {
  validateHoleModify(op);
  const bounds = solid.boundingBox();
  const eps = Math.max(
    1e-6,
    solid.tolerance() * 8,
    length3(sub3(bounds.max, bounds.min)) * 2e-7,
  );
  const edits = [],
    resolved = [];
  for (const [i, ref] of op.rims.entries()) {
    try {
      const rim = resolveFinishEdge(solid, ref);
      const expected = ref.centerWitness.map(
        (v, k) => bounds.min[k] + (bounds.max[k] - bounds.min[k]) * v,
      );
      if (
        length3(sub3(rim.circle.center, expected)) >
          Math.max(eps * 10, rim.circle.radius) ||
        resolved.some((r) => sameHoleRim(rim, r))
      ) {
        throw Error(
          'The original hole has moved or disappeared. Pick its rim again.',
        );
      }
      resolved.push(rim);
      const edit = prepare(wasm, solid, rim, op, eps, own);
      if (!edit) continue;
      const box = edit.tool.boundingBox();
      for (const other of edits) {
        const overlap = box.min.every(
          (n, j) => n < other.box.max[j] && other.box.min[j] < box.max[j],
        );
        if (
          overlap &&
          own(edit.tool.intersect(other.tool)).volume() >
            Math.max(eps ** 3, eps * eps)
        ) {
          throw Error(
            'This edit overlaps hole ' +
              (other.index + 1) +
              '. Reduce the size or remove one rim.',
          );
        }
      }
      edits.push({ ...edit, box, index: i });
    } catch (error) {
      throw Error('Hole ' + (i + 1) + ' · ' + error.message);
    }
  }
  if (!edits.length)
    throw Error('All selected bores already have this diameter.');
  let result = solid;
  for (const join of [false, true]) {
    const tools = edits
      .filter((item) => item.join === join)
      .map((item) => item.tool);
    if (!tools.length) continue;
    const union =
      tools.length === 1 ? tools[0] : own(wasm.Manifold.union(tools));
    result = own(join ? result.add(union) : result.subtract(union));
  }
  if (
    result.status() !== 'NoError' ||
    result.isEmpty() ||
    !(result.volume() > 0)
  )
    throw Error('These hole dimensions leave no printable solid.');
  return result;
}
