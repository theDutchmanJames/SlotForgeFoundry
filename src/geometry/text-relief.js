// Clip the letter outlines to each visible facet of a picked curved patch and
// lift each clipped footprint to its actual triangle plane. The complete relief
// follows the mesh and stays attached even where the original tangent falls away.
export function curvedTextTool(
  wasm,
  profile,
  op,
  frame,
  index,
  triangles,
  overlap,
  own,
) {
  const { normal, u, v, location } = frame;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const local = (id) => {
    const p = index.point(id).map((x, i) => x - location[i]);
    return [dot(p, u), dot(p, v), dot(p, normal)];
  };
  const { min, max } = profile.bounds();
  const pieces = [],
    raised = op.type === 'add';
  const extrusion = op.depth + overlap;
  const zOffset = raised ? -overlap : -op.depth;
  let covered = 0;
  for (const t of triangles) {
    const a = local(index.ids[3 * t]),
      b = local(index.ids[3 * t + 1]),
      c = local(index.ids[3 * t + 2]);
    if (
      [0, 1].some(
        (k) =>
          Math.max(a[k], b[k], c[k]) < min[k] ||
          Math.min(a[k], b[k], c[k]) > max[k],
      )
    )
      continue;
    const ab = b.map((x, i) => x - a[i]),
      ac = c.map((x, i) => x - a[i]);
    const area = ab[0] * ac[1] - ab[1] * ac[0];
    if (area <= 0) continue;
    const outline = own(
      new wasm.CrossSection([[a.slice(0, 2), b.slice(0, 2), c.slice(0, 2)]]),
    );
    const piece = own(outline.intersect(profile));
    if (piece.isEmpty()) continue;
    const dx = (ab[2] * ac[1] - ac[2] * ab[1]) / area;
    const dy = (ab[0] * ac[2] - ac[0] * ab[2]) / area;
    const z = a[2] - a[0] * dx - a[1] * dy + zOffset;
    const volume = own(piece.extrude(extrusion));
    pieces.push(
      own(volume.transform([1, 0, dx, 0, 0, 1, dy, 0, 0, 0, 1, 0, 0, 0, z, 1])),
    );
    covered += piece.area();
  }
  if (
    !pieces.length ||
    Math.abs(covered - profile.area()) > Math.max(1e-8, profile.area() * 1e-4)
  )
    throw Error(
      'The full text must fit on one visible surface. Reduce the letter size, reposition the label, or adjust the boundary angle.',
    );
  const combined =
    pieces.length === 1 ? pieces[0] : own(wasm.Manifold.union(pieces));
  return own(
    combined.transform([...u, 0, ...v, 0, ...normal, 0, ...location, 1]),
  );
}
