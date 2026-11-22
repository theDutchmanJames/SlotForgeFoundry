const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function supportingPlanes(mesh, visit) {
  const { vertProperties: v, triVerts: ids, numProp: stride } = mesh;
  for (let i = 0; i < ids.length; i += 3) {
    const a = ids[i] * stride,
      b = ids[i + 1] * stride,
      c = ids[i + 2] * stride;
    const ux = v[b] - v[a],
      uy = v[b + 1] - v[a + 1],
      uz = v[b + 2] - v[a + 2];
    const vx = v[c] - v[a],
      vy = v[c + 1] - v[a + 1],
      vz = v[c + 2] - v[a + 2];
    const x = uy * vz - uz * vy,
      y = uz * vx - ux * vz,
      z = ux * vy - uy * vx;
    const size = Math.hypot(x, y, z);
    if (!size) continue;
    const n = [x / size, y / size, z / size],
      p = [v[a], v[a + 1], v[a + 2]];
    visit(n, dot(n, p));
  }
}

// A convex solid is the intersection of its face half-spaces. Offsetting
// their support distances gives a uniform shell, even on dense angled facets.
// Polar duality computes that intersection with two hulls instead of one
// full mesh Boolean per face. Coordinates are local to an interior witness.
function convexCavity(wasm, local, profile, below, t, epsilon, own) {
  const bounds = local.boundingBox();
  if (
    bounds.max[2] > epsilon * 3 ||
    own(below.subtract(own(profile.offset(12 * epsilon)))).area() >
      profile.area() * 1e-5
  )
    return null;
  const hull = own(local.hull());
  if (
    hull.volume() - local.volume() >
    Math.max(hull.volume() * 1e-7, hull.surfaceArea() * epsilon)
  )
    return null;
  const mesh = hull.getMesh(),
    center = [0, 0, 0],
    count = mesh.vertProperties.length / mesh.numProp;
  for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp)
    for (let j = 0; j < 3; j++) center[j] += mesh.vertProperties[i + j] / count;
  const dual = [];
  let feasible = true;
  supportingPlanes(mesh, (n, h) => {
    const isOpening = n[2] > 0.999999 && Math.abs(h) < epsilon * 8;
    const gap = h - dot(n, center) + (isOpening ? t : -t);
    if (gap <= epsilon) feasible = false;
    else dual.push(n.map((a) => a / gap));
  });
  if (!feasible || dual.length < 4) return null;
  const polar = own(wasm.Manifold.hull(dual));
  if (polar.isEmpty() || polar.status() !== 'NoError') return null;
  const verts = [];
  supportingPlanes(polar.getMesh(), (n, h) => {
    if (h <= 0) feasible = false;
    else verts.push(n.map((v, i) => center[i] + v / h));
  });
  if (!feasible || verts.length < 4) return null;
  const inner = own(wasm.Manifold.hull(verts));
  return inner.isEmpty() || inner.status() !== 'NoError' ? null : inner;
}

// Work in the opening's local frame so the wall setting is independent of
// the model's orientation. Only a cavity connected to that opening is cut.
export function hollowFromOpening(wasm, source, op, frame, own) {
  const t = op.thickness;
  if (!Number.isFinite(t) || t <= 0)
    throw Error('Enter a positive wall thickness.');
  const { u, v, normal: n, location: p } = frame;
  const local = own(
    source.transform([
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
      -dot(u, p),
      -dot(v, p),
      -dot(n, p),
      1,
    ]),
  );
  const box = local.boundingBox();
  const epsilon = Math.max(
    local.tolerance() * 4,
    Math.max(...box.max.map((x, i) => x - box.min[i])) * 1e-7,
  );
  const profile = own(new wasm.CrossSection(op.loops, 'EvenOdd'));
  const mouth = own(profile.offset(-t, 'Round'));
  if (mouth.isEmpty() || t <= epsilon)
    throw Error(
      'This wall thickness leaves no usable opening. Choose a wider face or a different thickness.',
    );
  const stockBelow = own(local.slice(-epsilon)),
    stockAbove = own(local.slice(epsilon));
  const probe = own(mouth.intersect(stockBelow));
  if (
    probe.area() < mouth.area() * 0.99 ||
    own(mouth.intersect(stockAbove)).area() > mouth.area() * 0.01
  )
    throw Error(
      'The selected opening has changed. Select its current flat face again.',
    );

  // Extend the mouth temporarily. Eroding the extended stock maintains the
  // requested side and floor thickness while opening exactly the picked face.
  let core = convexCavity(wasm, local, profile, stockBelow, t, epsilon, own);
  if (!core) {
    const extension = own(
      own(profile.extrude(2 * t + epsilon)).translate([0, 0, -epsilon]),
    );
    const extended = own(local.add(extension));
    const ball = own(wasm.Manifold.sphere(t, 24));
    core = own(extended.minkowskiDifference(ball));
  }
  // Keep the cutter's overlap past the top plane. Clipping to the stock
  // first can leave a microscopic film when exporting the mouth to Float32.
  const reachable = core
    .decompose()
    .map(own)
    .filter((piece) => {
      const section = own(piece.slice(-epsilon));
      return !own(section.intersect(mouth)).isEmpty();
    });
  if (!reachable.length)
    throw Error(
      'There is no room for a cavity below this opening. Reduce the wall thickness.',
    );
  const inner =
    reachable.length === 1 ? reachable[0] : own(wasm.Manifold.union(reachable));
  const cavity = own(inner.transform([...u, 0, ...v, 0, ...n, 0, ...p, 1]));
  const result = own(source.subtract(cavity));
  if (
    result.status() !== 'NoError' ||
    result.isEmpty() ||
    !(result.volume() < source.volume())
  )
    throw Error('Hollowing could not make a printable wall at this thickness.');
  return result;
}

export function simplifySolid(source, op, own) {
  const count = source.numTri();
  if (!(op.deviation > 0) || !Number.isFinite(op.deviation))
    throw Error('Enter a positive surface deviation in millimetres.');
  if (
    op.triangleTarget != null &&
    (!Number.isSafeInteger(op.triangleTarget) ||
      op.triangleTarget < 4 ||
      op.triangleTarget >= count)
  )
    throw Error('Choose a triangle target between 4 and ' + (count - 1) + '.');
  // The kernel's tolerance-bounded collapse preserves topology. A target
  // is a budget within that tolerance, never permission to erase detail.
  let best = source.simplify(op.deviation);
  try {
    if (best.status() !== 'NoError' || best.isEmpty() || best.volume() <= 0)
      throw Error(
        'This deviation removes too much of the model. Choose a smaller value.',
      );
    if (op.triangleTarget != null && best.numTri() > op.triangleTarget)
      throw Error(
        'At this deviation the part needs ' +
          best.numTri() +
          ' triangles. Raise the target or allow more surface deviation.',
      );
    if (best.numTri() >= count)
      throw Error(
        'The mesh already needs all ' +
          count +
          ' triangles at this deviation. Increase the deviation to reduce it.',
      );
    if (op.triangleTarget != null) {
      let low = 0,
        high = op.deviation;
      for (let i = 0; i < 8 && best.numTri() < op.triangleTarget; i++) {
        const mid = (low + high) / 2;
        const candidate = source.simplify(mid);
        if (
          candidate.status() === 'NoError' &&
          candidate.numTri() > 0 &&
          candidate.numTri() <= op.triangleTarget
        ) {
          best.delete();
          best = candidate;
          high = mid;
        } else {
          candidate.delete();
          low = mid;
        }
      }
    }
    return own(best);
  } catch (error) {
    best.delete();
    throw error;
  }
}
