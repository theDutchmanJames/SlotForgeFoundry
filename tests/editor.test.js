import { test } from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { buildTrack, defaultTrack } from '../src/track.js';
import {
  additionsOnly,
  applyEdit,
  encodeSTL,
  faceHinge,
  makeDemo,
  parseSTL,
  surfaceRegion,
} from '../src/editor.js';

const wasm = await init();
wasm.setup();

test('face tilt holds a selected boundary fixed and supports either side of a diagonal pivot', (t) => {
  const own = withSolids(t);
  const base = own(wasm.Manifold.cube([10, 10, 10]));
  const face = surfaceRegion(base, horizontalTriangle(base, 10), 1);
  const op = {
    type: 'tiltFace',
    frame: face,
    loops: face.loops,
    pivot: 'u-min',
    angle: (Math.atan(0.5) * 180) / Math.PI,
  };
  const raised = own(applyEdit(wasm, base, op));
  near(raised.volume(), 1250);
  near(raised.boundingBox().max[2], 15);
  // At 2mm above the original face the tilted top covers the last 6 mm.
  near(own(raised.slice(12)).area(), 60);
  near(own(applyEdit(wasm, base, { ...op, angle: -op.angle })).volume(), 750);
  const triangle = [
    [
      [0, 0],
      [4, 0],
      [0, 4],
    ],
  ];
  for (const edge of [
    [
      [4, 0],
      [0, 4],
    ],
    [
      [0, 4],
      [4, 0],
    ],
  ]) {
    const diagonal = own(
      applyEdit(wasm, base, {
        ...op,
        frame: top,
        loops: triangle,
        pivotEdge: edge,
        angle: 45,
      }),
    );
    near(diagonal.volume() - 1000, (8 * Math.sqrt(8)) / 3);
  }
  assert.throws(
    () =>
      applyEdit(wasm, base, {
        ...op,
        pivotEdge: [
          [-5, -5],
          [5, 5],
        ],
      }),
    /outside edge/,
  );
  assert.throws(
    () => applyEdit(wasm, base, { ...op, frame: { ...face, planar: false } }),
    /flat surface/,
  );
});

test('the tilt hinge can turn within the selected face and slide into or beyond its starting edge', (t) => {
  const own = withSolids(t);
  const base = own(wasm.Manifold.cube([10, 20, 10]));
  const op = {
    type: 'tiltFace',
    angle: (Math.atan(0.5) * 180) / Math.PI,
    frame: { ...top, origin: [0, 0, 10] },
    loops: [
      [
        [0, 0],
        [10, 0],
        [10, 20],
        [0, 20],
      ],
    ],
    pivot: 'u-min',
    hingeRotation: 90,
    pivotOffset: 4,
  };
  const { direction, start, width } = faceHinge(op, op.loops);
  near(direction[0], 0);
  near(direction[1], 1);
  near(start, 4);
  near(width, 16);
  const tilted = own(applyEdit(wasm, base, op));
  near(tilted.volume(), 2000 + (10 * 16 * 8) / 2);
  near(tilted.boundingBox().max[2], 18);
  near(own(tilted.slice(12)).area(), 120);
  const cut = own(applyEdit(wasm, base, { ...op, angle: -op.angle }));
  near(cut.volume(), 2000 - (10 * 16 * 8) / 2);
  const exterior = own(applyEdit(wasm, base, { ...op, pivotOffset: -2 }));
  near(exterior.volume(), 2000 + 10 * 20 * 6);
  assert.throws(
    () => applyEdit(wasm, base, { ...op, pivotOffset: 20 }),
    /no face to tilt/,
  );
});

test('a generated 30-degree road preserves a projecting connector when rebuilt to 15 degrees', (t) => {
  const own = withSolids(t);
  const parts = buildTrack(wasm, { ...defaultTrack(), joint: 'both' });
  for (const p of parts) own(p.solid);
  const source = parts.find((p) => p.role === 'road').solid;
  const halves = ['low', 'high'].map((keep) =>
    own(
      applyEdit(wasm, source, {
        type: 'radialSplit',
        center: [0, -220],
        startAngle: 75,
        endAngle: 105,
        splitAngle: 90,
        rebuild: true,
        // Include the entire 20 mm fork receiver in the donor section.
        bandAngle: 7,
        keep,
      }),
    ),
  );
  for (const body of halves) {
    const components = body.decompose();
    components.forEach(own);
    assert.equal(components.length, 1);
    assert.equal(body.status(), 'NoError');
  }
  near(halves[0].volume(), halves[1].volume(), 0.1);
});
const near = (got, expected, tolerance = 1e-5) =>
  assert.ok(
    Math.abs(got - expected) <= tolerance,
    `expected ${expected}, got ${got}`,
  );
const top = {
  origin: [5, 5, 10],
  u: [1, 0, 0],
  v: [0, 1, 0],
  normal: [0, 0, 1],
};
const square = [
  [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ],
];
function withSolids(t) {
  const bodies = [];
  t.after(() => {
    for (const body of bodies.reverse()) body.delete();
  });
  return (body) => {
    bodies.push(body);
    return body;
  };
}

test('binary STL roundtrip keeps millimetre bounds, bores and volume, including solid-prefixed binary headers', (t) => {
  const own = withSolids(t);
  const original = own(makeDemo(wasm));
  const file = encodeSTL(original);
  file.set(new TextEncoder().encode('solid binary enclosure'));
  // FileReader callers can pass a subarray of a larger buffer.
  const backed = new Uint8Array(file.length + 14);
  backed.set(file, 7);
  const read = own(parseSTL(wasm, backed.subarray(7, 7 + file.length)));
  assert.deepEqual(read.boundingBox(), original.boundingBox());
  near(read.volume(), original.volume(), 0.005);
  assert.equal(read.genus(), original.genus());
});

const tetrahedronFaces = [
  [
    [0, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
];
function ascii(triangles) {
  const facets = triangles.map(
    (points) =>
      'facet normal 0 0 0\nouter loop\n' +
      points.map((p) => 'vertex ' + p.join(' ')).join('\n') +
      '\nendloop\nendfacet',
  );
  return new TextEncoder().encode(
    ['solid tetra', ...facets, 'endsolid tetra'].join('\n'),
  );
}

test('ASCII STL welds shared positions and rejects open, malformed and nonfinite data', (t) => {
  const own = withSolids(t);
  near(own(parseSTL(wasm, ascii(tetrahedronFaces))).volume(), 1 / 6);
  const nearWeld = structuredClone(tetrahedronFaces);
  nearWeld[0][0][0] = 1e-8;
  near(own(parseSTL(wasm, ascii(nearWeld))).volume(), 1 / 6);
  assert.throws(
    () => parseSTL(wasm, ascii(tetrahedronFaces.slice(1))),
    /open edges/,
  );
  assert.throws(
    () =>
      parseSTL(
        wasm,
        ascii([
          [
            [0, 0, NaN],
            [0, 1, 0],
            [1, 0, 0],
          ],
        ]),
      ),
    /invalid/i,
  );
  const truncated = encodeSTL(own(wasm.Manifold.cube([1, 1, 1]))).subarray(
    0,
    90,
  );
  assert.throws(() => parseSTL(wasm, truncated), /truncated/i);
  assert.throws(
    () =>
      parseSTL(
        wasm,
        new TextEncoder().encode('solid x\nfacet normal 0 0 0\nendsolid'),
      ),
    /Malformed/,
  );
});

function horizontalTriangle(body, height) {
  const m = body.getMesh();
  for (let i = 0; i < m.triVerts.length; i += 3) {
    if (
      [0, 1, 2].every(
        (j) =>
          Math.abs(
            m.vertProperties[m.triVerts[i + j] * m.numProp + 2] - height,
          ) < 1e-5,
      )
    )
      return i / 3;
  }
  throw new Error('No horizontal face found');
}

function moveFace(body, face, distance) {
  return applyEdit(wasm, body, {
    type: distance < 0 ? 'cut' : 'add',
    profileKind: 'face',
    frame: face,
    loops: face.loops,
    depth: Math.abs(distance),
  });
}

test('moving the enclosure rim sets its exact height and keeps its four blind bores and floor', (t) => {
  const own = withSolids(t);
  const body = own(makeDemo(wasm));
  const face = surfaceRegion(body, horizontalTriangle(body, 16));
  assert.equal(face.loops.length, 6);
  const lowered = own(moveFace(body, face, -4));
  assert.deepEqual(lowered.boundingBox(), {
    min: [-41, -27, 0],
    max: [41, 27, 12],
  });
  near(lowered.volume(), own(body.trimByPlane([0, 0, -1], -12)).volume());
  assert.equal(own(lowered.slice(11.999)).toPolygons().length, 6);
  assert.equal(own(lowered.slice(1)).toPolygons().length, 1);
  const raised = own(moveFace(body, face, 2));
  near(raised.boundingBox().max[2], 18);
  assert.equal(own(raised.slice(17)).toPolygons().length, 6);
  const reopened = own(parseSTL(wasm, encodeSTL(lowered)));
  near(reopened.boundingBox().max[2], 12);
});

test('inward moves affect only the picked boss or recessed face and preserve other stock', (t) => {
  const own = withSolids(t);
  const base = own(wasm.Manifold.cube([24, 12, 4]));
  const stud = own(wasm.Manifold.cylinder(4, 3.15, 3.15, 48));
  const left = own(stud.translate([6, 6, 4]));
  const right = own(stud.translate([18, 6, 4]));
  const body = own(wasm.Manifold.union([base, left, right]));
  const face = surfaceRegion(body, horizontalTriangle(body, 8));
  const lowered = own(moveFace(body, face, -1.5));
  const intact = face.origin[0] < 12 ? right : left;
  assert.ok(own(intact.subtract(lowered)).isEmpty());
  assert.equal(own(lowered.slice(7)).toPolygons().length, 1);
  near(lowered.volume(), body.volume() - 1.5 * own(stud.slice(2)).area());

  const squarePocket = own(
    own(wasm.Manifold.cube([4, 4, 3])).translate([3, 3, 2]),
  );
  const recessed = own(base.subtract(squarePocket));
  const floor = surfaceRegion(recessed, horizontalTriangle(recessed, 2));
  const deepened = own(moveFace(recessed, floor, -1));
  near(deepened.volume(), recessed.volume() - 16);
  near(own(deepened.slice(1.5)).area(), 24 * 12 - 16);
  assert.equal(own(deepened.slice(0.5)).toPolygons().length, 1);
  const wholeTop = surfaceRegion(base, horizontalTriangle(base, 4));
  assert.throws(() => moveFace(base, wholeTop, -4), /entire part/);
  assert.throws(
    () => moveFace(base, { ...wholeTop, planar: false }, -1),
    /flat face/,
  );
});

test('connected flat selection retains inner loops and can drive an extrusion', (t) => {
  const own = withSolids(t);
  const base = own(wasm.Manifold.cube([10, 10, 10]));
  const through = own(
    own(wasm.Manifold.cylinder(12, 2, 2, 48)).translate([5, 5, -1]),
  );
  const plate = own(base.subtract(through));
  const selected = surfaceRegion(plate, horizontalTriangle(plate, 10));
  assert.equal(selected.planar, true);
  assert.equal(selected.loops.length, 2);
  assert.ok(selected.triangleIndices.length > 2);
  const raised = own(
    applyEdit(wasm, plate, {
      type: 'add',
      frame: selected,
      loops: selected.loops,
      depth: 2,
    }),
  );
  near(raised.volume(), plate.volume() * 1.2, 0.001);
  near(raised.boundingBox().max[2], 12);
  assert.equal(raised.genus(), 1);
});

test('a curved wall returns a tangent frame but no flat boundary profile', (t) => {
  const own = withSolids(t);
  const body = own(wasm.Manifold.cylinder(8, 5, 5, 64));
  const mesh = body.getMesh();
  let wall;
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    const z = [0, 1, 2].map(
      (j) => mesh.vertProperties[3 * mesh.triVerts[i + j] + 2],
    );
    if (Math.max(...z) - Math.min(...z) > 1) {
      wall = i / 3;
      break;
    }
  }
  const region = surfaceRegion(body, wall, 8);
  assert.equal(region.planar, false);
  assert.equal(region.loops.length, 0);
  assert.ok(region.triangleIndices.length >= 100);
  assert.throws(() => surfaceRegion(body, 1e12), /Pick/);
});

test('flat faces and curved walls remain distinguishable on imported STLs with distant origins', (t) => {
  const own = withSolids(t);
  const location = [100000, 80500, 52];
  const rotated = own(
    own(wasm.Manifold.cube([12, 6, 20])).rotate([17, 21, 39]),
  );
  const box = own(parseSTL(wasm, encodeSTL(own(rotated.translate(location)))));
  const visited = new Set();
  for (let triangle = 0; triangle < box.numTri(); triangle++) {
    if (visited.has(triangle)) continue;
    const face = surfaceRegion(box, triangle, 1);
    assert.ok(face.planar);
    assert.equal(face.triangleIndices.length, 2);
    assert.equal(face.loops.length, 1);
    for (const index of face.triangleIndices) visited.add(index);
    const distance = 1.25;
    const plane = face.origin.reduce(
      (v, x, i) => v + x * face.normal[i],
      -distance,
    );
    const reference = own(
      box.trimByPlane(
        face.normal.map((x) => -x),
        -plane,
      ),
    );
    const lowered = own(moveFace(box, face, -distance));
    near(lowered.volume(), reference.volume(), 1e-6);
    const raised = own(moveFace(box, face, distance));
    assert.equal(raised.genus(), 0, 'the full face is joined without gaps');
    const shells = raised.decompose().map(own);
    assert.equal(shells.length, 1);
  }
  const curved = own(wasm.Manifold.cylinder(8, 5, 5, 64));
  const cylinder = own(
    parseSTL(wasm, encodeSTL(own(curved.translate(location)))),
  );
  const mesh = cylinder.getMesh();
  let index = 0;
  while (index < mesh.triVerts.length) {
    const z = [0, 1, 2].map(
      (j) => mesh.vertProperties[mesh.numProp * mesh.triVerts[index + j] + 2],
    );
    if (Math.max(...z) - Math.min(...z) > 1) break;
    index += 3;
  }
  const wall = surfaceRegion(cylinder, index / 3, 12);
  assert.equal(wall.planar, false);
  assert.equal(wall.loops.length, 0);
});

test('through cuts follow a tilted drawing to the underside whenever the target thickness changes', (t) => {
  const own = withSolids(t);
  const op = {
    type: 'cut',
    profileKind: 'drawing',
    extent: 'through',
    frame: { ...top, origin: [15, 15, 10] },
    loops: square,
    tilt: 24,
    tiltAzimuth: 35,
  };
  for (const height of [6, 16]) {
    const base = own(
      own(wasm.Manifold.cube([30, 30, height])).translate([0, 0, 10 - height]),
    );
    const cut = own(applyEdit(wasm, base, op));
    near(base.volume() - cut.volume(), 16 * height);
    near(own(cut.slice(10 - height + 0.01)).area(), 900 - 16);
    const pocket = own(
      applyEdit(wasm, base, { ...op, extent: 'distance', depth: 2 }),
    );
    near(own(pocket.slice(10 - height + 0.01)).area(), 900);
  }
});

test('angled editable pockets and additions use perpendicular depth, support fitted additions-only export', (t) => {
  const own = withSolids(t);
  const base = own(wasm.Manifold.cube([10, 10, 10]));
  const op = { type: 'add', frame: top, loops: square, depth: 2, tilt: 30 };
  const raised = own(applyEdit(wasm, base, op));
  near(raised.volume(), 1032);
  near(raised.boundingBox().max[2], 12);
  const additions = own(additionsOnly(wasm, raised, base));
  near(additions.volume(), 32);
  near(additions.boundingBox().min[2], 10);
  const pocket = own(applyEdit(wasm, base, { ...op, type: 'cut' }));
  near(pocket.volume(), 968);
  assert.throws(
    () => applyEdit(wasm, base, { ...op, offset: [1000, 0] }),
    /misses/,
  );
  assert.throws(() => applyEdit(wasm, base, { ...op, depth: -2 }), /Depth/);
  near(base.volume(), 1000);
});

test('length-preserving new end restores each half’s screw posts and blind holes', (t) => {
  const own = withSolids(t);
  const shell = own(makeDemo(wasm));
  for (const keep of ['low', 'high']) {
    const split = { type: 'split', axis: 'x', position: 0, keep, band: 11 };
    const cut = own(applyEdit(wasm, shell, split));
    const rebuilt = own(applyEdit(wasm, shell, { ...split, rebuild: true }));
    assert.ok(rebuilt.volume() > cut.volume());
    near(rebuilt.boundingBox().max[0] - rebuilt.boundingBox().min[0], 41);
    // At this height, the inside cavity and all four blind bores are empty.
    const section = own(rebuilt.slice(10));
    assert.equal(section.toPolygons().length, 6);
    const newPostX = keep === 'low' ? -4.4 : 4.4;
    const probe = own(
      own(wasm.Manifold.cylinder(2, 1.2, 1.2, 16)).translate([
        newPostX,
        22.6,
        6,
      ]),
    );
    assert.equal(own(rebuilt.intersect(probe)).isEmpty(), true);
    const atPost = own(probe.translate([2.9, 0, 0]));
    assert.ok(own(rebuilt.intersect(atPost)).volume() > 1);
  }
  assert.throws(
    () =>
      applyEdit(wasm, shell, {
        type: 'split',
        axis: 'x',
        keep: 'low',
        position: 0,
        rebuild: true,
        band: 42,
      }),
    /too long/,
  );
});

test('end graft refuses mismatched profiles while plain splitting still works', (t) => {
  const own = withSolids(t);
  const cone = own(wasm.Manifold.cylinder(20, 10, 7, 64));
  const op = { type: 'split', axis: 'z', keep: 'high', position: 10, band: 3 };
  assert.throws(
    () => applyEdit(wasm, cone, { ...op, rebuild: true }),
    /cross-sections/,
  );
  assert.ok(own(applyEdit(wasm, cone, op)).volume() > 0);
});

test('radial end transfer rotates exit details about a non-origin arc centre', (t) => {
  const own = withSolids(t);
  const centre = [17, -9];
  const polar = (r, deg) => [
    centre[0] + r * Math.cos((deg * Math.PI) / 180),
    centre[1] + r * Math.sin((deg * Math.PI) / 180),
  ];
  const angles = Array.from({ length: 61 }, (_, i) => i / 2);
  const loop = [
    ...angles.map((a) => polar(60, a)),
    ...angles.toReversed().map((a) => polar(50, a)),
  ];
  const band = own(own(new wasm.CrossSection([loop])).extrude(4));
  let withBores = band;
  for (const angle of [2, 28]) {
    const hole = own(
      own(wasm.Manifold.cylinder(6, 0.8, 0.8, 24)).translate([
        ...polar(55, angle),
        -1,
      ]),
    );
    withBores = own(withBores.subtract(hole));
  }
  for (const keep of ['low', 'high']) {
    const half = own(
      applyEdit(wasm, withBores, {
        type: 'radialSplit',
        center: centre,
        startAngle: 0,
        endAngle: 30,
        splitAngle: 15,
        keep,
        rebuild: true,
        bandAngle: 5,
      }),
    );
    assert.equal(half.genus(), 2);
    assert.equal(own(half.slice(2)).toPolygons().length, 3);
  }
});
