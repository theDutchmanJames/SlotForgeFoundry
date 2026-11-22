import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { creaseLineIndices, isTrackSurface } from './surface-features.js';
import { faceBudgets, PREVIEW_FACES } from './track-preview-budget.js';

const noAttributes = new Float32Array();

// A simplification can discard a zero-area triangle and expose a diagonal on
// a flat face. Outline only creases of the source, on each incident triangle
// in the reduced mesh. Meshopt may choose a coincident vertex at the crease.
function originalEdgeMarks(positions, indices, lines) {
  const remap = MeshoptSimplifier.generatePositionRemap(positions, 3);
  const edgeKey = (a, b) => {
    const u = remap[a],
      v = remap[b];
    return Math.min(u, v) * remap.length + Math.max(u, v);
  };
  const original = new Set();
  for (let i = 0; i < lines.length; i += 2)
    original.add(edgeKey(lines[i], lines[i + 1]));
  const marks = new Uint8Array(indices.length / 3);
  for (let i = 0; i < indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      if (original.has(edgeKey(indices[i + j], indices[i + ((j + 1) % 3)])))
        marks[i / 3] |= 1 << j;
    }
  }
  return marks;
}

// Lock both ends of every printable crease. Meshopt can then reduce the flat
// surfaces between the lips while keeping their positions in millimetres.
export async function prepareSoftwareTrack(parts) {
  const counts = parts.map((part) => part.indices.length / 3);
  const budgets = faceBudgets(counts, PREVIEW_FACES);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!isTrackSurface(part)) continue;
    delete part.previewIndices;
    delete part.previewMarks;
    if (counts[i] <= budgets[i] || !MeshoptSimplifier.supported) continue;
    await MeshoptSimplifier.ready;
    const locks = new Uint8Array(part.positions.length / 3);
    const creases = creaseLineIndices(part);
    for (const vertex of creases) locks[vertex] = 1;
    const [indices] = MeshoptSimplifier.simplifyWithAttributes(
      part.indices,
      part.positions,
      3,
      noAttributes,
      0,
      [],
      locks,
      3 * budgets[i],
      0.01,
      ['ErrorAbsolute'],
    );
    if (indices.length > 0 && indices.length < part.indices.length) {
      part.previewIndices = indices;
      part.previewMarks = originalEdgeMarks(part.positions, indices, creases);
    }
  }
}
