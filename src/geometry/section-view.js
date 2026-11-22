// A section is a display mesh. Picking, edit history and STL export continue
// to use the original part. The same plane also clips open, unrepairable scans.
export function clippedPolygon(points, { axis, position, high }) {
  const inside = (p) => (high ? p[axis] >= position : p[axis] <= position);
  const out = [];
  let a = points.at(-1);
  for (const b of points) {
    if (inside(a) !== inside(b)) {
      const t = (position - a[axis]) / (b[axis] - a[axis]);
      const p = a.map((v, i) => v + t * (b[i] - v));
      p[axis] = position;
      out.push(p);
    }
    if (inside(b)) out.push(b);
    a = b;
  }
  return out;
}

export function clipOpenSurface({ positions, indices }, plane) {
  const { axis, position, high } = plane;
  const vertices = [],
    faces = [];
  const original = new Map(),
    intersections = new Map();
  function vertex(i) {
    if (!original.has(i)) {
      original.set(i, vertices.length / 3);
      vertices.push(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      );
    }
    return original.get(i);
  }
  function crossing(a, b) {
    if (positions[a * 3 + axis] === position) return vertex(a);
    if (positions[b * 3 + axis] === position) return vertex(b);
    const key = Math.min(a, b) * (positions.length / 3) + Math.max(a, b);
    if (!intersections.has(key)) {
      intersections.set(key, vertices.length / 3);
      const t =
        (position - positions[a * 3 + axis]) /
        (positions[b * 3 + axis] - positions[a * 3 + axis]);
      for (let dim = 0; dim < 3; dim++)
        vertices.push(
          dim === axis
            ? position
            : positions[a * 3 + dim] +
                t * (positions[b * 3 + dim] - positions[a * 3 + dim]),
        );
    }
    return intersections.get(key);
  }
  const inside = (i) =>
    high
      ? positions[i * 3 + axis] >= position
      : positions[i * 3 + axis] <= position;
  for (let t = 0; t < indices.length; t += 3) {
    const polygon = [];
    let a = indices[t + 2];
    for (let j = 0; j < 3; j++) {
      const b = indices[t + j];
      if (inside(a) !== inside(b)) polygon.push(crossing(a, b));
      if (inside(b)) polygon.push(vertex(b));
      a = b;
    }
    for (let j = 2; j < polygon.length; j++) {
      const [a, b, c] = [polygon[0], polygon[j - 1], polygon[j]];
      if (a !== b && a !== c && b !== c) faces.push(a, b, c);
    }
  }
  return {
    positions: Float32Array.from(vertices),
    indices: Uint32Array.from(faces),
  };
}

function sectionOf(wasm, part, plane) {
  const { axis, position, high } = plane;
  const { min, max } = part.bounds;
  if (high ? position <= min[axis] : position >= max[axis])
    return { id: part.id, whole: true };
  if (high ? position > max[axis] : position < min[axis])
    return { id: part.id, empty: true };
  if (part.solid === undefined) {
    const mesh = new wasm.Mesh({
      numProp: 3,
      vertProperties: part.positions,
      triVerts: part.indices,
    });
    mesh.merge();
    try {
      part.solid = new wasm.Manifold(mesh);
    } catch (err) {
      if (err.code !== 'NotManifold') throw err;
      part.solid = null;
    }
  }
  if (!part.solid) return { id: part.id, ...clipOpenSurface(part, plane) };
  const normal = [0, 0, 0];
  normal[axis] = high ? 1 : -1;
  const cut = part.solid.trimByPlane(normal, position * normal[axis]);
  try {
    if (cut.status() !== 'NoError')
      throw Error('Could not compute this section.');
    if (cut.isEmpty()) return { id: part.id, empty: true };
    const mesh = cut.getMesh();
    const positions = mesh.vertProperties;
    const cap = [],
      skin = [],
      coordinate = Math.fround(position);
    for (let f = 0; f < mesh.triVerts.length; f += 3) {
      const a = mesh.triVerts[f],
        b = mesh.triVerts[f + 1],
        c = mesh.triVerts[f + 2];
      const onPlane =
        positions[3 * a + axis] === coordinate &&
        positions[3 * b + axis] === coordinate &&
        positions[3 * c + axis] === coordinate;
      (onPlane ? cap : skin).push(a, b, c);
    }
    return {
      id: part.id,
      positions,
      indices: Uint32Array.from(skin),
      capIndices: Uint32Array.from(cap),
    };
  } finally {
    cut.delete();
  }
}

export function createSectionStore(wasm) {
  const views = new Map();
  function close(key) {
    for (const part of views.get(key) ?? []) part.solid?.delete();
    views.delete(key);
  }
  return {
    sectionView({ key, parts, plane }) {
      if (![0, 1, 2].includes(plane?.axis) || !Number.isFinite(plane.position))
        throw Error('Choose a section axis and a finite position.');
      if (parts) {
        close(key);
        views.set(
          key,
          parts.map((part) => ({ ...part })),
        );
      }
      const stored = views.get(key);
      if (!stored) return null; // Worker was restarted; caller resends the source.
      return stored.map((part) => sectionOf(wasm, part, plane));
    },
    closeSection: close,
    dispose() {
      for (const key of views.keys()) close(key);
    },
  };
}
