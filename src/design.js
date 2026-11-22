import { sketchPaths } from './create-sketch-data.js';

export const solidNames = {
  primitive: 'Shape',
  extrude: 'Extrude',
  revolve: 'Turn',
  sweep: 'Follow a path',
  loft: 'Blend two sketches',
};
export const featureNames = {
  hole: 'Hole',
  'edge-finish': 'Round or chamfer',
  'hole-modify': 'Change hole',
  'wall-modify': 'Move walls',
  'heal-feature': 'Remove bump or pocket',
  'stretch-section': 'Stretch',
  'feature-pattern': 'Mirror & repeat',
};
export const isSolidTool = (tab) => Object.hasOwn(solidNames, tab);
export const isFeatureTool = (tab) => Object.hasOwn(featureNames, tab);
export const featureTab = (type) =>
  ({
    hole: 'hole',
    edgeFinish: 'edge-finish',
    edgeGroup: 'edge-finish',
    modifyHoles: 'hole-modify',
    wallModify: 'wall-modify',
    healFeature: 'heal-feature',
    stretchSection: 'stretch-section',
    featurePattern: 'feature-pattern',
  })[type];
export const workplaneLabels = {
  xy: 'Top (XY)',
  xz: 'Front (XZ)',
  yz: 'Side (YZ)',
  face: 'Selected face',
};
export function workplane(plane, offset = 0, face) {
  const axes = {
    xy: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    xz: [
      [1, 0, 0],
      [0, 0, 1],
      [0, -1, 0],
    ],
    yz: [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
  };
  let frame = face;
  if (plane !== 'face') {
    if (!Object.hasOwn(axes, plane)) throw Error('Choose a workplane.');
    const [u, v, normal] = axes[plane];
    frame = { u, v, normal, origin: [0, 0, 0] };
  }
  if (!frame || !Number.isFinite(offset))
    throw Error('Choose a plane and a finite offset.');
  return {
    u: frame.u,
    v: frame.v,
    normal: frame.normal,
    origin: frame.origin.map((x, i) => x + offset * frame.normal[i]),
  };
}

export function validFrame(frame) {
  const units = [frame?.u, frame?.v, frame?.normal];
  if (
    ![...units, frame?.origin].every(
      (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite),
    )
  )
    return false;
  const [u, v, n] = units;
  const cross = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  return (
    units.every((a) => Math.abs(Math.hypot(...a) - 1) < 1e-4) &&
    cross.every((x, i) => Math.abs(x - n[i]) < 1e-4)
  );
}
export function materializeSketch(op) {
  return {
    id: op.id,
    name: op.name,
    frame: op.frame,
    ...sketchPaths(op.sketch),
  };
}
export function worldPoint(frame, [x, y], z = 0) {
  return frame.origin.map(
    (a, i) => a + x * frame.u[i] + y * frame.v[i] + z * frame.normal[i],
  );
}
export function sketchLines(sketch) {
  if (!sketch) return [];
  return [
    ...sketch.loops.map((loop) => [...loop, loop[0]]),
    ...sketch.paths,
  ].map((path) => path.map((p) => worldPoint(sketch.frame, p)));
}
