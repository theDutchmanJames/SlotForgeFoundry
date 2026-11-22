export function meshFromSolid(solid) {
  const raw = solid.getMesh();
  const positions = new Float32Array(raw.numVert * 3);
  for (let i = 0; i < raw.numVert; i++)
    positions.set(
      raw.vertProperties.subarray(i * raw.numProp, i * raw.numProp + 3),
      i * 3,
    );
  return { positions, indices: new Uint32Array(raw.triVerts) };
}

export function solidFromMesh(wasm, { positions, indices }) {
  if (!indices.length) throw Error('The edit would remove all geometry.');
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: positions,
    triVerts: indices,
  });
  mesh.merge();
  let solid;
  try {
    solid = new wasm.Manifold(mesh);
    if (
      solid.status() !== 'NoError' ||
      solid.isEmpty() ||
      !(solid.volume() > 0)
    )
      throw Error('No closed solid');
    return solid;
  } catch {
    solid?.delete();
    throw Error(
      'The mesh still has an open or invalid surface. Review its boundaries and winding.',
    );
  }
}

export const nextCorner = (e) => (e % 3 === 2 ? e - 2 : e + 1);
export const faceOf = (e) => Math.floor(e / 3);

// Build adjacency using edges, so shells sharing only one vertex stay independent.
export function meshEdges(indices, vertexCount) {
  const twins = new Int32Array(indices.length).fill(-1);
  const edges = new Map();
  let nonManifold = 0;
  for (let e = 0; e < indices.length; e++) {
    const a = indices[e],
      b = indices[nextCorner(e)];
    const key = Math.min(a, b) * vertexCount + Math.max(a, b);
    const previous = edges.get(key);
    if (previous === undefined) edges.set(key, e);
    else if (twins[previous] === -1) {
      twins[e] = previous;
      twins[previous] = e;
    } else {
      if (twins[previous] >= 0) {
        twins[twins[previous]] = -2;
        nonManifold++;
      }
      twins[e] = twins[previous] = -2;
    }
  }
  return { twins, nonManifold };
}

// Return undirected boundary cycles even when some incident triangles are
// flipped. orient[] tells which way the repaired triangle will point.
export function boundaryLoops(indices, twins, orient) {
  const links = new Map();
  function link(a, e) {
    const old = links.get(a);
    if (old) old.push(e);
    else links.set(a, [e]);
  }
  const brokenVertices = new Set();
  for (let e = 0; e < indices.length; e++) {
    if (twins[e] === -2) {
      brokenVertices.add(indices[e]);
      brokenVertices.add(indices[nextCorner(e)]);
    }
    if (twins[e] !== -1) continue;
    link(indices[e], e);
    link(indices[nextCorner(e)], e);
  }
  const visited = new Set(),
    loops = [];
  let openChains = 0;
  for (const [vertex, incident] of links) {
    for (const first of incident) {
      if (visited.has(first)) continue;
      let a = vertex,
        edge = first,
        simple = true;
      const verts = [],
        faces = [];
      while (!visited.has(edge)) {
        visited.add(edge);
        if (brokenVertices.has(a) || links.get(a).length !== 2) simple = false;
        verts.push(a);
        faces.push(faceOf(edge));
        const next =
          indices[edge] === a ? indices[nextCorner(edge)] : indices[edge];
        a = next;
        const candidates = links.get(a);
        const nextEdge = candidates.find((e) => !visited.has(e));
        if (nextEdge === undefined) break;
        edge = nextEdge;
      }
      if (!simple || a !== vertex || verts.length < 3) {
        openChains++;
        continue;
      }
      // Cap runs in the direction opposite its incident faces.
      if ((indices[first] === vertex) !== Boolean(orient?.[faceOf(first)]))
        verts.reverse();
      loops.push({ vertices: verts, faces });
    }
  }
  return { loops, openChains };
}

export function analyseMesh({ indices, positions }) {
  const { twins, nonManifold } = meshEdges(indices, positions.length / 3);
  const faceCount = indices.length / 3,
    component = new Int32Array(faceCount).fill(-1);
  const orient = new Uint8Array(faceCount),
    components = [],
    queue = new Uint32Array(faceCount);
  let conflicts = 0;
  for (let root = 0; root < faceCount; root++) {
    if (component[root] !== -1) continue;
    const id = components.length;
    component[root] = id;
    let head = 0,
      tail = 1,
      flipped = 0,
      closed = true,
      volume6 = 0;
    queue[0] = root;
    const origin = indices[root * 3] * 3;
    while (head < tail) {
      const f = queue[head++];
      if (orient[f]) flipped++;
      const k = f * 3;
      const a = indices[k] * 3,
        b = indices[k + 1] * 3,
        c = indices[k + 2] * 3;
      const ax = positions[a] - positions[origin],
        ay = positions[a + 1] - positions[origin + 1],
        az = positions[a + 2] - positions[origin + 2];
      const bx = positions[b] - positions[origin],
        by = positions[b + 1] - positions[origin + 1],
        bz = positions[b + 2] - positions[origin + 2];
      const cx = positions[c] - positions[origin],
        cy = positions[c + 1] - positions[origin + 1],
        cz = positions[c + 2] - positions[origin + 2];
      volume6 +=
        (orient[f] ? -1 : 1) *
        (ax * (by * cz - bz * cy) +
          ay * (bz * cx - bx * cz) +
          az * (bx * cy - by * cx));
      for (let e = k; e < k + 3; e++) {
        const twin = twins[e];
        if (twin < 0) {
          closed = false;
          continue;
        }
        const neighbor = faceOf(twin);
        const expected = orient[f] ^ Number(indices[e] === indices[twin]);
        if (component[neighbor] === -1) {
          component[neighbor] = id;
          orient[neighbor] = expected;
          queue[tail++] = neighbor;
        } else if (orient[neighbor] !== expected) conflicts++;
      }
    }
    // Preserve a consistently inward enclosed cavity. For inconsistent components
    // use the orientation requiring the fewest changes; a wholly inverted outer
    // model can be reversed explicitly.
    if (flipped > tail / 2) {
      for (let i = 0; i < tail; i++) orient[queue[i]] ^= 1;
      flipped = tail - flipped;
      volume6 = -volume6;
    }
    components.push({
      id,
      triangles: tail,
      flipped,
      closed,
      volume: volume6 / 6,
    });
  }
  const boundary = boundaryLoops(indices, twins, orient);
  return {
    twins,
    nonManifold,
    component,
    orient,
    components,
    conflicts,
    ...boundary,
  };
}

function boundaryPlane(positions, vertices) {
  const origin = vertices[0] * 3;
  const points = vertices.map((i) =>
    [0, 1, 2].map((k) => positions[i * 3 + k] - positions[origin + k]),
  );
  const n = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    for (let k = 0; k < 3; k++)
      n[k] +=
        (a[(k + 1) % 3] - b[(k + 1) % 3]) * (a[(k + 2) % 3] + b[(k + 2) % 3]);
  }
  let axis = 0;
  for (let k = 1; k < 3; k++) if (Math.abs(n[k]) > Math.abs(n[axis])) axis = k;
  if (Math.abs(n[axis]) < 1e-14)
    throw Error('This boundary has no usable plane for a patch.');
  const length = Math.hypot(...n),
    normal = n.map((x) => x / length);
  return {
    normal,
    axis,
    area: length / 2,
    vertices,
    origin: [...positions.subarray(origin, origin + 3)],
  };
}

function inPolygon(polygon, [x, y]) {
  let inside = false,
    prev = polygon.at(-1);
  for (const next of polygon) {
    if (
      prev[1] > y !== next[1] > y &&
      x < prev[0] + ((next[0] - prev[0]) * (y - prev[1])) / (next[1] - prev[1])
    )
      inside = !inside;
    prev = next;
  }
  return inside;
}

// Two coplanar, nested boundary loops can form one annular patch (a broken
// pipe rim). Triangulate the inner bore as a hole in the cap.
export function capBoundaries(wasm, positions, boundaries) {
  const planes = boundaries
    .map((loop) => boundaryPlane(positions, loop))
    .sort((a, b) => b.area - a.area);
  const parents = new Map(),
    children = new Map();
  const project = (loop, plane) => {
    const u = (plane.axis + 1) % 3,
      v = (plane.axis + 2) % 3,
      sign = Math.sign(plane.normal[plane.axis]);
    return loop.vertices.map((i) => [
      positions[i * 3 + u] - plane.origin[u],
      sign * (positions[i * 3 + v] - plane.origin[v]),
    ]);
  };
  for (let i = 0; i < planes.length; i++) {
    const child = planes[i];
    for (let j = i - 1; j >= 0; j--) {
      const parent = planes[j],
        n = parent.normal;
      const dot = n.reduce((v, x, k) => v + x * child.normal[k], 0);
      if (Math.abs(dot) < 1 - 1e-6) continue;
      const epsilon = Math.max(1e-6, Math.sqrt(parent.area) * 1e-6);
      if (
        child.vertices.some(
          (id) =>
            Math.abs(
              n.reduce(
                (s, x, k) => s + x * (positions[id * 3 + k] - parent.origin[k]),
                0,
              ),
            ) > epsilon,
        )
      )
        continue;
      const outer = project(parent, parent),
        inner = project(child, parent);
      if (!inPolygon(outer, inner[0])) continue;
      if (dot >= 0 || !inner.every((p) => inPolygon(outer, p)))
        throw Error(
          'These patch boundaries overlap. Choose a different boundary.',
        );
      parents.set(child, parent);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(child);
      break;
    }
  }
  const caps = [];
  for (const outer of planes) {
    let ancestor = parents.get(outer),
      depth = 0;
    while (ancestor) {
      depth++;
      ancestor = parents.get(ancestor);
    }
    if (depth % 2) continue;
    const rings = [outer, ...(children.get(outer) ?? [])],
      ids = rings.flatMap((r) => r.vertices);
    const triangles = wasm.triangulate(
      rings.map((r) => project(r, outer)),
      -1,
      false,
    );
    if (triangles.length !== ids.length + 2 * (rings.length - 1) - 2)
      throw Error('The boundary crosses itself or needs a different patch.');
    for (const [a, b, c] of triangles) caps.push(ids[a], ids[b], ids[c]);
  }
  return caps;
}

export function meshSignature(mesh) {
  let h = 2166136261;
  const floats = new Uint32Array(
    mesh.positions.buffer,
    mesh.positions.byteOffset,
    mesh.positions.length,
  );
  for (const words of [floats, mesh.indices])
    for (let i = 0; i < words.length; i++)
      h = Math.imul(h ^ words[i], 16777619);
  return [
    mesh.positions.length,
    mesh.indices.length,
    (h >>> 0).toString(16),
  ].join('-');
}

// A render mesh can duplicate coordinates at property seams. Preserve the face
// order for saved brush selections and weld just the vertex indices.
export function weldedMesh(mesh) {
  const ids = new Map(),
    map = new Uint32Array(mesh.positions.length / 3),
    coords = [];
  for (let i = 0; i < map.length; i++) {
    const x = mesh.positions[i * 3],
      y = mesh.positions[i * 3 + 1],
      z = mesh.positions[i * 3 + 2];
    const key = x + ',' + y + ',' + z;
    let id = ids.get(key);
    if (id === undefined) {
      id = coords.length / 3;
      ids.set(key, id);
      coords.push(x, y, z);
    }
    map[i] = id;
  }
  return {
    positions: Float32Array.from(coords),
    indices: Uint32Array.from(mesh.indices, (i) => map[i]),
  };
}
