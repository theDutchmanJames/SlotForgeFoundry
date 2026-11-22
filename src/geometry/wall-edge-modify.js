import { faceOf, solidFromMesh } from '../mesh-topology.js';
import {
  topology,
  resolveSeat,
  add3,
  sub3,
  mul3,
  dot3,
  cross3,
  unit3,
  length3,
} from './feature-selection.js';
import { applyEdgeGroup, validateEdgeGroup } from './edge-groups.js';
export {
  sameFinishEdge,
  selectedEdgeRefs,
  compactEdge,
} from './edge-groups.js';

const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const vector = (p) =>
  Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const isUnit = (p) => vector(p) && Math.abs(length3(p) - 1) < 1e-4;
// Restore a pick at the interior of the resolved triangle, even when an
// earlier edit retessellates a wall or moves its original pick outside it.
export function wallPickSeeds(source, walls) {
  const t = topology(source);
  return walls.map((wall) => {
    const { face } = resolveSeat(source, wall);
    const e = 3 * face;
    return {
      triangle: face,
      point: mul3(
        add3(t.point(e), add3(t.point(e + 1), t.point(e + 2))),
        1 / 3,
      ),
    };
  });
}
export function validateWallEdgeModify(op) {
  if (op.type === 'edgeGroup') return validateEdgeGroup(op);
  if (
    op.type !== 'wallModify' ||
    !Array.isArray(op.walls) ||
    !op.walls.length ||
    op.walls.length > 128
  )
    throw Error('Select 1–128 flat walls on the same part.');
  for (const w of op.walls) {
    if (
      !w ||
      ![w.normal, w.u, w.v].every(isUnit) ||
      !vector(w.witness) ||
      dot3(cross3(w.u, w.v), w.normal) < 0.9999 ||
      !Number.isSafeInteger(w.triangle) ||
      w.triangle < 0
    )
      throw Error('Select the current flat wall again.');
  }
  if (op.kind === 'offset') {
    if (!Number.isFinite(op.distance) || op.distance === 0)
      throw Error('Enter a nonzero offset per selected wall.');
  } else if (op.kind === 'draft') {
    if (
      !Object.hasOwn(axes, op.axis) ||
      !Number.isFinite(op.base) ||
      !Number.isFinite(op.angle) ||
      op.angle === 0 ||
      Math.abs(op.angle) >= 85
    )
      throw Error(
        'Choose a fixed plane and enter a nonzero draft angle between −85° and 85°.',
      );
    if (op.walls.some((w) => Math.abs(dot3(w.normal, axes[op.axis])) > 1e-4))
      throw Error(
        'Each selected sidewall must be perpendicular to the fixed plane. Choose a different plane or wall.',
      );
  } else throw Error('Choose Offset wall or Draft wall.');
}
function coplanarTriangles(t, first) {
  const found = new Set([first]),
    queue = [first],
    n = t.normal(first);
  for (let i = 0; i < queue.length; i++) {
    for (let j = 0; j < 3; j++) {
      const twin = t.twins[queue[i] * 3 + j],
        next = faceOf(twin);
      if (twin >= 0 && !found.has(next) && dot3(t.normal(next), n) > 0.999995) {
        found.add(next);
        queue.push(next);
      }
    }
  }
  return found;
}
// Project a shared mesh vertex onto all incident new and retained planes.
// This keeps neighbouring faces planar and intersects adjacent edited walls
// at one common corner instead of producing gaps or overlapping volumes.
function solveVertex(p, planes, eps) {
  let delta = [0, 0, 0];
  const basis = [];
  for (const { normal, level } of planes) {
    let orth = normal;
    for (const q of basis) orth = sub3(orth, mul3(q, dot3(orth, q)));
    const length = length3(orth),
      miss = level - dot3(normal, add3(p, delta));
    if (length > 1e-5) {
      const q = mul3(orth, 1 / length);
      delta = add3(delta, mul3(q, miss / length));
      basis.push(q);
    } else if (Math.abs(miss) > eps) {
      throw Error(
        'A neighbouring detail fixes this wall corner in place. Select adjoining walls together or choose a different wall.',
      );
    }
  }
  return add3(p, delta);
}
function checkIntersections(result, t, positions, affectedFaces, eps) {
  const p = (v) => Array.from(positions.subarray(3 * v, 3 * v + 3));
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const f of affectedFaces) {
    for (let k = 0; k < 3; k++) {
      const v = p(t.indices[3 * f + k]);
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], v[a]);
        hi[a] = Math.max(hi[a], v[a]);
      }
    }
  }
  for (let e = 0; e < t.indices.length; e++) {
    if (t.twins[e] < e) continue;
    const a = p(t.indices[e]),
      b = p(t.indices[3 * faceOf(e) + ((e + 1) % 3)]);
    if (
      a.some(
        (x, i) =>
          Math.max(x, b[i]) < lo[i] - eps || Math.min(x, b[i]) > hi[i] + eps,
      )
    )
      continue;
    const d = sub3(b, a),
      l = length3(d);
    if (l <= eps * 4) continue;
    const u = mul3(d, 1 / l);
    if (
      result
        .rayCast(add3(a, mul3(u, eps * 2)), sub3(b, mul3(u, eps * 2)))
        .some(
          (hit) =>
            Math.abs(dot3(hit.normal, u)) > 0.001 &&
            length3(sub3(hit.position, a)) > eps * 3 &&
            length3(sub3(hit.position, b)) > eps * 3,
        )
    )
      throw Error(
        'This wall would cross another surface. Reduce the offset or draft.',
      );
  }
}
function applyWalls(wasm, solid, op, own) {
  const t = topology(solid),
    edits = new Map(),
    corners = new Map();
  const diag = length3(sub3(t.bounds.max, t.bounds.min));
  const eps = Math.max(solid.tolerance() * 12, diag * 1e-6, 1e-7);
  for (const seat of op.walls) {
    const { face } = resolveSeat(solid, seat);
    const n = t.normal(face),
      members = coplanarTriangles(t, face);
    if (edits.has(face))
      throw Error('The same wall was picked twice. Select distinct walls.');
    const slope =
      op.kind === 'draft' ? Math.tan((op.angle * Math.PI) / 180) : 0;
    const plane =
      op.kind === 'draft'
        ? {
            normal: sub3(n, mul3(axes[op.axis], slope)),
            level: dot3(n, t.point(3 * face)) - slope * op.base,
          }
        : { normal: n, level: dot3(n, t.point(3 * face)) + op.distance };
    for (const f of members) {
      edits.set(f, plane);
      for (let j = 0; j < 3; j++) corners.set(t.indices[3 * f + j], []);
    }
  }
  const affected = new Set();
  for (let f = 0; 3 * f < t.indices.length; f++) {
    const incident = [0, 1, 2].map((k) => corners.get(t.indices[3 * f + k]));
    if (!incident.some(Boolean)) continue;
    affected.add(f);
    const n = t.normal(f),
      plane = edits.get(f) ?? { normal: n, level: dot3(n, t.point(3 * f)) };
    for (const list of incident) {
      if (
        list &&
        !list.some(
          (x) =>
            dot3(unit3(x.normal), unit3(plane.normal)) > 1 - 1e-10 &&
            Math.abs(
              x.level / length3(x.normal) - plane.level / length3(plane.normal),
            ) < eps,
        )
      )
        list.push(plane);
    }
  }
  const positions = new Float32Array(t.positions);
  let moved = false;
  for (const [v, list] of corners) {
    const p = Array.from(t.positions.subarray(3 * v, 3 * v + 3)),
      next = solveVertex(p, list, eps);
    if (length3(sub3(p, next)) > eps * 0.01) moved = true;
    positions.set(next, 3 * v);
  }
  if (!moved)
    throw Error('This setting does not move any of the selected walls.');
  for (const f of affected) {
    const vertices = [0, 1, 2].map((k) => {
      const v = t.indices[3 * f + k];
      return Array.from(positions.subarray(3 * v, 3 * v + 3));
    });
    const n = cross3(
      sub3(vertices[1], vertices[0]),
      sub3(vertices[2], vertices[0]),
    );
    if (dot3(n, t.normal(f)) <= 0)
      throw Error(
        'This wall would collapse or cross an adjacent feature. Reduce the offset or change the fixed plane.',
      );
  }
  const result = own(solidFromMesh(wasm, { positions, indices: t.indices }));
  checkIntersections(result, t, positions, affected, eps);
  return result;
}
export function applyWallEdgeModify(wasm, solid, op, own) {
  if (op.type === 'edgeGroup') return applyEdgeGroup(wasm, solid, op, own);
  validateWallEdgeModify(op);
  return applyWalls(wasm, solid, op, own);
}
