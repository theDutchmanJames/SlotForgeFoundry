const subtract = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = ([x, y, z], [a, b, c]) => [
  y * c - z * b,
  z * a - x * c,
  x * b - y * a,
];
const unit = (v) => {
  const length = Math.hypot(...v);
  if (!(length > 1e-10) || !Number.isFinite(length))
    throw Error('Pick a flat face with a valid direction.');
  return v.map((x) => x / length);
};
const center = ({ min, max }) => min.map((n, i) => (n + max[i]) / 2);

// Rotate the moving normal onto the inward normal of the reference face. A
// shortest-arc rotation preserves as much of the part's orientation as possible.
function rotateNormal(from, to) {
  const c = Math.min(1, Math.max(-1, dot(from, to)));
  const perpendicular = cross(from, to);
  const sine = Math.hypot(...perpendicular);
  if (sine < 1e-12 && c > 0) return (v) => v;
  const axis =
    sine < 1e-12
      ? unit(cross(from, Math.abs(from[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]))
      : perpendicular.map((x) => x / sine);
  return (v) => {
    const tangent = cross(axis, v);
    const along = dot(axis, v) * (1 - c);
    return v.map((n, i) => n * c + tangent[i] * sine + axis[i] * along);
  };
}

export function alignmentMatrix(moving, fixed, op) {
  let rotate = (v) => v,
    origin = center(moving),
    destination = center(fixed);
  if (op.alignment === 'stack') {
    origin[2] = moving.min[2];
    destination[2] = fixed.max[2] + op.gap;
  } else if (op.alignment === 'faces') {
    const outward = unit(op.destinationFace.normal);
    rotate = rotateNormal(
      unit(op.sourceFace.normal),
      outward.map((v) => -v),
    );
    origin = op.sourceFace.point;
    destination = op.destinationFace.point.map(
      (n, i) => n + outward[i] * op.gap,
    );
  }
  const columns = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ].flatMap((v) => [...rotate(v), 0]);
  return [...columns, ...subtract(destination, rotate(origin)), 1];
}

export function verifyAlignmentFace(part, face) {
  const normal = unit(face.normal);
  const epsilon = Math.max(
    1e-5,
    part.solid.tolerance() * 4,
    Math.max(...face.point.map(Math.abs)) * 2 ** -22,
  );
  const step = (sign) =>
    face.point.map((n, i) => n + sign * epsilon * normal[i]);
  const found = part.solid
    .rayCast(step(1), step(-1))
    .some(
      (hit) =>
        dot(hit.normal, normal) > 0.9999 &&
        Math.hypot(...subtract(hit.position, face.point)) <= epsilon,
    );
  if (!found)
    throw Error(
      'The picked face on ' +
        part.name +
        ' has changed. Pick its current face to align it.',
    );
}

export function combineBodies(
  wasm,
  target,
  operands,
  method,
  own,
  addedMaterial,
) {
  const inputs = [target, ...operands];
  let solid;
  if (method === 'join') {
    solid = own(wasm.Manifold.union(inputs.map((p) => p.solid)));
  } else if (method === 'intersect') {
    solid = own(wasm.Manifold.intersection(inputs.map((p) => p.solid)));
  } else {
    for (const part of operands) {
      if (own(target.solid.intersect(part.solid)).volume() <= 0)
        throw Error(
          part.name +
            ' does not overlap ' +
            target.name +
            '. Position the cutter inside the part.',
        );
    }
    const cutters =
      operands.length === 1
        ? operands[0].solid
        : own(wasm.Manifold.union(operands.map((p) => p.solid)));
    solid = own(target.solid.subtract(cutters));
  }
  if (solid.status() !== 'NoError' || solid.isEmpty() || !(solid.volume() > 0))
    throw Error(
      method === 'intersect'
        ? 'The selected parts have no common volume. Align or move the parts until they overlap.'
        : 'This operation leaves no printable material in the result.',
    );
  // A newly imported STL is original stock. Combining two imports alone never
  // creates a spurious “additions only” export.
  const originals = inputs.map((p) => p.base).filter(Boolean);
  let base = target.base;
  if (method === 'join') {
    base = inputs.every((p) => p.solid === p.base)
      ? solid
      : originals.length > 1
        ? own(wasm.Manifold.union(originals))
        : (originals[0] ?? null);
  }
  const role = base ? 'body' : 'addition';
  // Only material already added to an input can survive as an addition. A
  // second boolean between independently transformed stock and result can
  // otherwise leave microscopic, printable-looking slivers on curved cuts.
  let extra = null;
  if (base && base !== solid) {
    if (method === 'join') {
      const additions = inputs.map(addedMaterial).filter(Boolean);
      if (additions.length) {
        const gained =
          additions.length === 1
            ? additions[0]
            : own(wasm.Manifold.union(additions));
        extra = own(gained.subtract(base));
      }
    } else {
      const prior = addedMaterial(target);
      if (prior) extra = own(prior.intersect(solid));
    }
  }
  return {
    ...target,
    clipType: inputs.find((part) => part.clipType)?.clipType,
    solid,
    base,
    role,
    extra,
  };
}
