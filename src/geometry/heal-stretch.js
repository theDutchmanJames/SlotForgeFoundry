import { validateFaceProfiles } from '../face-selection.js';
import { faceSupportRange } from '../face-trim.js';
import {
  add3,
  cross3,
  dot3,
  length3,
  mul3,
  sub3,
  unit3,
} from './feature-selection.js';

export const stretchAxes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
export function stretchDirection(op) {
  return Object.hasOwn(stretchAxes, op.axis) ? stretchAxes[op.axis] : op.normal;
}
export function planeFrame(normal, origin) {
  const helper = Math.abs(normal[0]) < 0.85 ? [1, 0, 0] : [0, 1, 0];
  const u = unit3(sub3(helper, mul3(normal, dot3(helper, normal))));
  return { u, v: cross3(normal, u), normal, origin };
}
function fromWorld({ u, v, normal: n, origin: p }) {
  return [
    u[0],
    v[0],
    n[0],
    0,
    u[1],
    v[1],
    n[1],
    0,
    u[2],
    v[2],
    n[2],
    0,
    -dot3(u, p),
    -dot3(v, p),
    -dot3(n, p),
    1,
  ];
}
function toWorld({ u, v, normal, origin }) {
  return [...u, 0, ...v, 0, ...normal, 0, ...origin, 1];
}
function deltaCheck(solid) {
  if (solid.status() !== 'NoError' || solid.isEmpty() || !(solid.volume() > 0))
    throw Error('This change leaves no printable solid.');
  return solid;
}
export function validateHealStretch(op) {
  if (op.type === 'healFeature') {
    validateFaceProfiles([op.profile]);
    if (!Number.isFinite(op.supportOffset) || op.supportOffset === 0)
      throw Error(
        'Pick the flat top of a boss or rib, or the bottom of a pocket.',
      );
    return;
  }
  if (op.type !== 'stretchSection') throw Error('Unknown section edit.');
  const n = stretchDirection(op);
  if (
    (!Object.hasOwn(stretchAxes, op.axis) && op.axis !== 'face') ||
    !Array.isArray(n) ||
    n.length !== 3 ||
    !n.every(Number.isFinite) ||
    Math.abs(length3(n) - 1) > 1e-5
  )
    throw Error(
      'Choose X, Y, Z or a picked flat face for the stretch direction.',
    );
  if (!['low', 'high'].includes(op.fixedEnd))
    throw Error('Choose the end that stays fixed.');
  if (
    ![op.start, op.end, op.change].every(Number.isFinite) ||
    !(op.end > op.start)
  )
    throw Error(
      'The second plane must be beyond the first. Enter both positions in millimetres.',
    );
  if (op.change === 0)
    throw Error('Enter a positive or negative length change.');
  if (op.end - op.start + op.change <= 0)
    throw Error('Shortening must leave some material between the two planes.');
}

function outerOutline(loops) {
  const area = (loop) =>
    Math.abs(
      loop.reduce((a, p, i) => {
        const next = loop[(i + 1) % loop.length];
        return a + p[0] * next[1] - next[0] * p[1];
      }, 0),
    );
  let largest = -1,
    outer;
  for (const loop of loops) {
    const size = area(loop);
    if (size > largest) {
      largest = size;
      outer = loop;
    }
  }
  return outer;
}

const ambiguous =
  'Choose an isolated boss or rib top, or a flat pocket floor. Its straight walls must reach one surrounding flat face.';

// Find a parallel landing at the base of the selected outline. A Boolean
// check over the full footprint and wall band later confirms that it is real.
export function recognizeHealProfile(part, region) {
  if (
    !part?.positions ||
    !part.indices ||
    !region?.planar ||
    !region.loops?.length ||
    region.faceCount > 1 ||
    region.feature
  )
    throw Error(ambiguous);
  const { origin, normal, u, v, loops } = region;
  const support = faceSupportRange(part.positions, normal);
  const eps = Math.max(
    1e-6,
    (support.max - support.min) * 1e-6,
    ...origin.map((x) => Math.abs(x) * 2 ** -22),
  );
  const cell = 4 * eps,
    grid = new Map(),
    outer = outerOutline(loops);
  const key = (i, j) => i + ',' + j;
  outer.forEach((p, id) => {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(id);
  });
  const point = (i) => part.positions.subarray(3 * i, 3 * i + 3);
  const levels = new Map();
  for (let i = 0; i < part.indices.length; i += 3) {
    const a = point(part.indices[i]),
      b = point(part.indices[i + 1]),
      c = point(part.indices[i + 2]);
    const offset = dot3(sub3(a, origin), normal);
    if (
      Math.abs(offset) < cell ||
      Math.abs(dot3(sub3(b, a), normal)) > eps ||
      Math.abs(dot3(sub3(c, a), normal)) > eps ||
      dot3(cross3(sub3(b, a), sub3(c, a)), normal) <= 0
    )
      continue;
    for (const q of [a, b, c]) {
      const relative = sub3(q, origin),
        x = dot3(relative, u),
        y = dot3(relative, v);
      const ix = Math.floor(x / cell),
        iy = Math.floor(y / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          for (const id of grid.get(key(ix + dx, iy + dy)) ?? []) {
            if (Math.hypot(outer[id][0] - x, outer[id][1] - y) > eps) continue;
            const level = Math.round(offset / cell);
            if (!levels.has(level))
              levels.set(level, { offset, points: new Set() });
            levels.get(level).points.add(id);
          }
        }
    }
  }
  const candidates = [...levels.values()]
    .filter((level) => level.points.size >= 2)
    .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));
  if (!candidates.length) throw Error(ambiguous);
  return {
    profile: { frame: { origin, normal, u, v }, loops },
    supportOffset: candidates[0].offset,
  };
}

function healFeature(wasm, source, op, own) {
  const {
    profile: { frame, loops },
    supportOffset: z,
  } = op;
  const local = own(source.transform(fromWorld(frame)));
  const box = local.boundingBox(),
    diag = length3(sub3(box.max, box.min));
  const eps = Math.max(local.tolerance() * 4, diag * 3e-7, 1e-8);
  if (Math.abs(z) <= 8 * eps)
    throw Error(
      'This feature is too shallow to distinguish from its supporting face.',
    );
  const face = own(new wasm.CrossSection(loops, 'EvenOdd'));
  const outer = own(new wasm.CrossSection([outerOutline(loops)], 'EvenOdd'));
  const inside = own(face.offset(-4 * eps, 'Miter'));
  const nearWall = own(outer.offset(5 * eps, 'Miter'));
  const band = own(own(outer.offset(32 * eps, 'Miter')).subtract(nearWall));
  if (inside.isEmpty() || band.isEmpty()) throw Error(ambiguous);
  const matchSlice = (shape, elevation, wanted) => {
    const slice = own(local.slice(elevation));
    const mismatch = own(
      wanted ? shape.subtract(slice) : shape.intersect(slice),
    );
    return mismatch.area() <= shape.area() * 0.002;
  };
  if (!matchSlice(inside, -eps, true) || !matchSlice(inside, eps, false))
    throw Error(
      'The selected feature face has changed. Pick its current top or floor.',
    );
  const boss = z < 0;
  if (
    !matchSlice(band, z - eps, true) ||
    !matchSlice(band, z + eps, false) ||
    !matchSlice(inside, boss ? z - eps : z + eps, boss)
  )
    throw Error(ambiguous);
  const prism = (shape, start, end) =>
    own(own(shape.extrude(end - start)).translate([0, 0, start]));
  const low = Math.min(0, z) + eps,
    high = Math.max(0, z) - eps;
  for (const [shape, filled] of [
    [inside, boss],
    [band, !boss],
  ]) {
    const probe = prism(shape, low, high);
    const mismatch = own(
      filled ? probe.subtract(local) : probe.intersect(local),
    );
    if (mismatch.volume() > probe.volume() * 0.0005) throw Error(ambiguous);
  }
  const tool = prism(
    own(face.offset(eps, 'Miter')),
    boss ? z : -eps,
    boss ? eps : z,
  );
  const healed = deltaCheck(own(boss ? local.subtract(tool) : local.add(tool)));
  return deltaCheck(own(healed.transform(toWorld(frame))));
}

// Scale the middle interval between two exact cross-sections. The low and
// high pieces undergo rigid motion only, preserving angled faces and bores.
export function stretchReference(
  wasm,
  source,
  op,
  own,
  requireBothPlanes = false,
) {
  if (source.isEmpty()) return own(source.translate([0, 0, 0]));
  const n = stretchDirection(op),
    width = op.end - op.start;
  const fixedLow = op.fixedEnd === 'low';
  const direction = fixedLow ? n : mul3(n, -1);
  const frame = planeFrame(direction, mul3(n, fixedLow ? op.start : op.end));
  const local = own(source.transform(fromWorld(frame)));
  const bounds = local.boundingBox(),
    eps = Math.max(local.tolerance() * 4, width * 1e-8);
  if (
    requireBothPlanes &&
    (bounds.min[2] >= -eps ||
      bounds.max[2] <= width + eps ||
      own(local.slice(0)).isEmpty() ||
      own(local.slice(width)).isEmpty())
  )
    throw Error(
      'Place both planes inside material so the part has an end on each side.',
    );
  if (bounds.max[2] <= 0) return own(source.translate([0, 0, 0]));
  if (bounds.min[2] >= width)
    return own(source.translate(mul3(direction, op.change)));
  const [moving, fixed] = local.splitByPlane([0, 0, 1], 0).map(own);
  const [end, section] = moving.splitByPlane([0, 0, 1], width).map(own);
  const pieces = [];
  if (!fixed.isEmpty()) pieces.push(fixed);
  if (!section.isEmpty())
    pieces.push(own(section.scale([1, 1, (width + op.change) / width])));
  if (!end.isEmpty()) pieces.push(own(end.translate([0, 0, op.change])));
  const combined =
    pieces.length === 1 ? pieces[0] : own(wasm.Manifold.union(pieces));
  return deltaCheck(own(combined.transform(toWorld(frame))));
}
export function applyHealStretch(wasm, solid, op, own) {
  validateHealStretch(op);
  return op.type === 'stretchSection'
    ? stretchReference(wasm, solid, op, own, true)
    : healFeature(wasm, solid, op, own);
}
