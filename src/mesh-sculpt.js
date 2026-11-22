import {
  boundaryLoops,
  capBoundaries,
  faceOf,
  meshEdges,
  meshFromSolid,
  meshSignature,
  nextCorner,
  solidFromMesh,
  weldedMesh,
} from './mesh-topology.js';

export function faceRuns(selection) {
  const sorted = Array.from(selection).sort((a, b) => a - b),
    runs = [];
  for (const face of sorted) {
    if (runs.length && runs.at(-2) + runs.at(-1) === face)
      runs[runs.length - 1]++;
    else runs.push(face, 1);
  }
  return runs;
}

export function validateSurfaceEdit(op) {
  if (
    !['patch', 'smooth'].includes(op.method) ||
    typeof op.sourceKey !== 'string' ||
    !/^\d+-\d+-[0-9a-f]{1,8}$/.test(op.sourceKey)
  )
    throw Error('The surface edit needs a valid source mesh and action.');
  if (
    !Array.isArray(op.selection) ||
    !op.selection.length ||
    op.selection.length % 2 ||
    op.selection.length > 2_000_000
  )
    throw Error('Choose mesh triangles to edit.');
  let end = 0;
  for (let i = 0; i < op.selection.length; i += 2) {
    const start = op.selection[i],
      count = op.selection[i + 1];
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(count) ||
      start < end ||
      count <= 0 ||
      start + count > 100_000_000
    )
      throw Error('The saved triangle selection has invalid spans.');
    end = start + count;
  }
  if (
    op.method === 'smooth' &&
    (!Number.isInteger(op.iterations) ||
      op.iterations < 1 ||
      op.iterations > 25 ||
      !Number.isFinite(op.strength) ||
      op.strength <= 0 ||
      op.strength > 1 ||
      typeof op.protectEdges !== 'boolean')
  )
    throw Error(
      'Choose 1–25 smoothing passes and a strength above 0 and up to 1.',
    );
}

export function growSurfaceSelection(selection, twins, shrink = false) {
  const next = new Set(selection);
  for (const face of selection) {
    for (let e = face * 3; e < face * 3 + 3; e++) {
      const twin = twins[e],
        adjacent = twin < 0 ? -1 : faceOf(twin);
      if (shrink && (adjacent < 0 || !selection.has(adjacent)))
        next.delete(face);
      else if (!shrink && adjacent >= 0) next.add(adjacent);
    }
  }
  return next;
}

function smoothPatch(mesh, selected, op) {
  const { indices } = mesh,
    original = mesh.positions,
    p = new Float32Array(original);
  const normals = new Float64Array(indices.length),
    active = new Uint8Array(p.length / 3).fill(1);
  const lengths = new Float64Array(indices.length / 3);
  const edges = meshEdges(indices, p.length / 3);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    const abx = p[b] - p[a],
      aby = p[b + 1] - p[a + 1],
      abz = p[b + 2] - p[a + 2];
    const acx = p[c] - p[a],
      acy = p[c + 1] - p[a + 1],
      acz = p[c + 2] - p[a + 2];
    normals[i] = aby * acz - abz * acy;
    normals[i + 1] = abz * acx - abx * acz;
    normals[i + 2] = abx * acy - aby * acx;
    lengths[i / 3] = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (!selected[i / 3]) active[a / 3] = active[b / 3] = active[c / 3] = 0;
  }
  for (let e = 0; e < indices.length; e++) {
    const twin = edges.twins[e];
    if (twin >= 0 && (!op.protectEdges || twin < e)) continue;
    const a = faceOf(e) * 3,
      b = faceOf(twin) * 3;
    if (
      twin < 0 ||
      normals[a] * normals[b] +
        normals[a + 1] * normals[b + 1] +
        normals[a + 2] * normals[b + 2] <
        0.70710678 * lengths[a / 3] * lengths[b / 3]
    )
      active[indices[e]] = active[indices[nextCorner(e)]] = 0;
  }
  const sum = new Float64Array(p.length),
    degree = new Uint32Array(active.length);
  // Each oriented edge of a closed, consistently wound manifold occurs once
  // in either direction. Uniform weights preserve the pinned selection rim.
  for (let pass = 0; pass < op.iterations; pass++) {
    sum.fill(0);
    degree.fill(0);
    for (let e = 0; e < indices.length; e++) {
      const a = indices[e],
        b = indices[nextCorner(e)] * 3;
      if (!active[a]) continue;
      degree[a]++;
      for (let j = 0; j < 3; j++) sum[a * 3 + j] += p[b + j];
    }
    for (let a = 0; a < active.length; a++)
      if (degree[a])
        for (let j = 0; j < 3; j++)
          p[a * 3 + j] +=
            op.strength * (sum[a * 3 + j] / degree[a] - p[a * 3 + j]);
  }
  if (p.every((x, i) => x === original[i]))
    throw Error(
      'No interior vertices moved. Grow the selection or turn off Protect sharp edges.',
    );
  return { positions: p, indices };
}

export function editedSurfaceMesh(wasm, input, op) {
  validateSurfaceEdit(op);
  if (meshSignature(input) !== op.sourceKey)
    throw Error(
      'This surface changed since the selection was saved. Select its triangles again.',
    );
  const mesh = weldedMesh(input),
    selected = new Uint8Array(mesh.indices.length / 3);
  for (let i = 0; i < op.selection.length; i += 2) {
    const end = op.selection[i] + op.selection[i + 1];
    if (end > selected.length)
      throw Error('The saved surface selection extends beyond this mesh.');
    selected.fill(1, op.selection[i], end);
  }
  if (op.method === 'smooth') return smoothPatch(mesh, selected, op);
  const remaining = [];
  for (let f = 0; f < selected.length; f++)
    if (!selected[f])
      remaining.push(
        mesh.indices[f * 3],
        mesh.indices[f * 3 + 1],
        mesh.indices[f * 3 + 2],
      );
  if (!remaining.length) throw Error('Leave part of the surface to patch.');
  const { twins } = meshEdges(remaining, mesh.positions.length / 3);
  const { loops, openChains } = boundaryLoops(remaining, twins);
  if (openChains)
    throw Error(
      'The selection meets itself at a corner. Grow or shrink it to form a simple boundary.',
    );
  for (const id of capBoundaries(
    wasm,
    mesh.positions,
    loops.map((loop) => loop.vertices),
  ))
    remaining.push(id);
  return { positions: mesh.positions, indices: Uint32Array.from(remaining) };
}

export function applySurfaceEdit(wasm, solid, op) {
  return solidFromMesh(wasm, editedSurfaceMesh(wasm, meshFromSolid(solid), op));
}
