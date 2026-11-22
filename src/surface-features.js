import { Vector3 } from 'three';

const CREASE = Math.cos((28 * Math.PI) / 180);
const light = new Vector3(-0.35, -0.4, 0.85).normalize();

export function isTrackSurface(part) {
  return part.role === 'road' || part.role === 'border';
}

// Line indices address the same vertices as the pick mesh. Index 65535 is a
// primitive-restart marker in a WebGL2 Uint16 index buffer.
export function creaseLineIndices(part) {
  const { lines } = surfaceFeatures(part.positions, part.indices, true);
  const IndexType = part.positions.length / 3 <= 65535 ? Uint16Array : Uint32Array;
  return IndexType.from(lines);
}

// A Boolean cut can produce a long sliver whose third vertex rounds onto or
// across the opposite edge in Float32. Test the precision of each component
// of AB × AC so translating a part along X cannot erase a fine YZ feature.
function reliableNormal(n, ab, ac, a, b, c) {
  const ulp = 2 ** -23;
  const ex = Math.max(Math.abs(a.x), Math.abs(b.x), Math.abs(c.x)) * ulp;
  const ey = Math.max(Math.abs(a.y), Math.abs(b.y), Math.abs(c.y)) * ulp;
  const ez = Math.max(Math.abs(a.z), Math.abs(b.z), Math.abs(c.z)) * ulp;
  const x = Math.abs(ab.x) + Math.abs(ac.x);
  const y = Math.abs(ab.y) + Math.abs(ac.y);
  const z = Math.abs(ab.z) + Math.abs(ac.z);
  return (
    Math.abs(n.x) > y * ez + z * ey ||
    Math.abs(n.y) > z * ex + x * ez ||
    Math.abs(n.z) > x * ey + y * ex
  );
}

function nextCorner(offset) {
  return offset % 3 === 2 ? offset - 2 : offset + 1;
}

// Retain the original adjacency across collapsed triangles. Dropping them
// creates false open edges where one side of a wall has extra subdivisions.
function recoverSliverNormals(source, neighbors, positions, indices, slivers) {
  const a = new Vector3(),
    b = new Vector3();
  function enqueue(face, frontier) {
    if (face < 0 || source[face] !== -1) return;
    let longest = 0,
      best = -1;
    for (let offset = face * 3; offset < face * 3 + 3; offset++) {
      const other = neighbors[offset];
      if (other < 0 || source[other] < 0) continue;
      a.fromArray(positions, indices[offset] * 3);
      b.fromArray(positions, indices[nextCorner(offset)] * 3);
      const length = a.distanceToSquared(b);
      if (length > longest) {
        longest = length;
        best = source[other];
      }
    }
    if (best >= 0) {
      source[face] = -2; // Queued; usable as a neighbor in the next layer.
      frontier.push(face, best);
    }
  }
  let frontier = [];
  for (const face of slivers) enqueue(face, frontier);
  while (frontier.length) {
    const next = [];
    for (let i = 0; i < frontier.length; i += 2)
      source[frontier[i]] = frontier[i + 1];
    for (let i = 0; i < frontier.length; i += 2) {
      const start = frontier[i] * 3;
      for (let offset = start; offset < start + 3; offset++)
        enqueue(neighbors[offset], next);
    }
    frontier = next;
  }
}

export function surfaceFeatures(positions, indices, makeLines) {
  const count = indices.length / 3;
  const normals = new Float32Array(3 * count);
  const shades = makeLines ? null : new Uint8Array(count);
  const marks = makeLines ? null : new Uint8Array(count);
  const seen = new Map();
  const neighbors = new Int32Array(indices.length).fill(-1);
  const source = new Int32Array(count).fill(-1),
    slivers = [];
  const n = new Vector3(),
    ab = new Vector3(),
    ac = new Vector3();
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  const vertCount = positions.length / 3;
  for (let f = 0; f < count; f++) {
    const i = f * 3;
    a.fromArray(positions, indices[i] * 3);
    b.fromArray(positions, indices[i + 1] * 3);
    c.fromArray(positions, indices[i + 2] * 3);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    if (reliableNormal(n, ab, ac, a, b, c)) {
      source[f] = f;
      n.normalize().toArray(normals, i);
      if (shades)
        shades[f] = Math.round(63 * (0.61 + 0.38 * Math.max(0, n.dot(light))));
    } else slivers.push(f);
    for (let j = 0; j < 3; j++) {
      const p = indices[i + j],
        q = indices[i + ((j + 1) % 3)];
      const key = p < q ? p * vertCount + q : q * vertCount + p;
      const other = seen.get(key);
      if (other === undefined) seen.set(key, i + j);
      else {
        neighbors[i + j] = Math.floor(other / 3);
        neighbors[other] = f;
      }
    }
  }
  if (slivers.length) {
    recoverSliverNormals(source, neighbors, positions, indices, slivers);
    if (shades)
      for (const f of slivers) shades[f] = source[f] < 0 ? 38 : shades[source[f]];
  }
  const lines = [];
  for (let f = 0; f < count; f++) {
    if (source[f] < 0) continue;
    n.fromArray(normals, source[f] * 3);
    for (let j = 0; j < 3; j++) {
      const offset = f * 3 + j,
        other = neighbors[offset];
      if (other >= 0) {
        if (source[other] < 0) continue;
        ab.fromArray(normals, source[other] * 3);
        if (n.dot(ab) > CREASE) continue;
      }
      const p = indices[offset],
        q = indices[nextCorner(offset)];
      a.fromArray(positions, p * 3);
      b.fromArray(positions, q * 3);
      if (a.equals(b)) continue;
      if (marks) marks[f] |= 1 << j;
      if (makeLines && (other < 0 || f < other)) lines.push(p, q);
    }
  }
  return { shades, marks, lines };
}
