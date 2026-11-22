import { encodeSTL, parseSTL } from './editor.js';
import { readSTLMesh } from './stl-mesh.js';
import { analyseMesh, capBoundaries, solidFromMesh } from './mesh-topology.js';

function validSolid(wasm, mesh) {
  const solid = solidFromMesh(wasm, mesh);
  try {
    return encodeSTL(solid);
  } finally {
    solid.delete();
  }
}

export function repairMesh(wasm, mesh, analysis, choices) {
  const removed = new Set(choices.remove ?? []),
    fill = new Set(choices.fill ?? []);
  const reverse = new Set(choices.reverse ?? []);
  const { component, components, loops, orient } = analysis;
  const indices = [],
    sourceFaces = [],
    changed = [];
  for (const id of [...removed, ...reverse])
    if (!Number.isInteger(id) || !components[id])
      throw Error('Choose an existing component.');
  for (let f = 0; f < component.length; f++) {
    const id = component[f];
    if (removed.has(id)) continue;
    const [a, b, c] = mesh.indices.subarray(3 * f, 3 * f + 3);
    const flip = Boolean(choices.winding && orient[f]) !== reverse.has(id);
    if (flip) changed.push(indices.length / 3);
    indices.push(a, flip ? c : b, flip ? b : c);
    sourceFaces.push(f);
  }
  const boundaries = [];
  for (const id of fill) {
    const loop = loops[id];
    if (!Number.isInteger(id) || !loop)
      throw Error('Choose an existing boundary.');
    const shell = component[loop.faces[0]];
    if (removed.has(shell)) continue;
    boundaries.push(
      reverse.has(shell) ? [...loop.vertices].reverse() : loop.vertices,
    );
  }
  const cap = capBoundaries(wasm, mesh.positions, boundaries);
  for (let i = 0; i < cap.length; i += 3) {
    changed.push(indices.length / 3);
    indices.push(cap[i], cap[i + 1], cap[i + 2]);
    sourceFaces.push(-1);
  }
  return {
    positions: mesh.positions,
    indices: Uint32Array.from(indices),
    sourceFaces: Int32Array.from(sourceFaces),
    changed: Uint32Array.from(changed),
  };
}

export function meshReviewMethods(wasm) {
  let session = null;
  return {
    checkSTL: (bytes) => {
      let solid;
      try {
        solid = parseSTL(wasm, bytes);
        return true;
      } catch {
        return false;
      } finally {
        solid?.delete();
      }
    },
    inspectSTL: (bytes) => {
      session = null;
      const mesh = readSTLMesh(bytes),
        analysis = analyseMesh(mesh);
      session = { mesh, analysis };
      return {
        ...mesh,
        components: analysis.components,
        component: analysis.component,
        orient: analysis.orient,
        loops: analysis.loops.map((loop) => Uint32Array.from(loop.vertices)),
        loopComponents: analysis.loops.map(
          (loop) => analysis.component[loop.faces[0]],
        ),
        openChains: analysis.openChains,
        conflicts: analysis.conflicts,
        nonManifold: analysis.nonManifold,
      };
    },
    previewSTLRepair: (choices) => {
      if (!session) throw Error('Reopen the STL to inspect it again.');
      const preview = repairMesh(wasm, session.mesh, session.analysis, choices);
      let issue = '',
        solid;
      try {
        solid = solidFromMesh(wasm, preview);
      } catch (error) {
        issue = error.message;
      } finally {
        solid?.delete();
      }
      return { ...preview, issue };
    },
    finishSTLRepair: (choices) => {
      if (!session) throw Error('Reopen the STL to inspect it again.');
      const repaired = repairMesh(
        wasm,
        session.mesh,
        session.analysis,
        choices,
      );
      return validSolid(wasm, repaired);
    },
    closeSTLReview: () => {
      session = null;
      return true;
    },
  };
}
