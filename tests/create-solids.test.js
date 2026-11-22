import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import {
  createSolid,
  applyCreationResult,
  validateCreation,
} from '../src/geometry/create-solids.js';
import {
  createSolidControls,
  createSolidOperation,
} from '../src/create-solid-controls.js';
import { encodeSTL, parseSTL } from '../src/editor.js';

const wasm = await init();
wasm.setup();
const xy = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] };
const xz = {
  origin: [0, 0, 0],
  u: [1, 0, 0],
  v: [0, 0, 1],
  normal: [0, -1, 0],
};
const rect = (a, b, c, d) => [
  [a, b],
  [c, b],
  [c, d],
  [a, d],
];
const circle = (radius, n) =>
  Array.from({ length: n }, (_, i) => [
    radius * Math.cos((i * 2 * Math.PI) / n),
    radius * Math.sin((i * 2 * Math.PI) / n),
  ]);
const near = (actual, expected, tol = 1e-4) =>
  assert.ok(Math.abs(actual - expected) < tol, actual + ' vs ' + expected);
function models(t, entries = []) {
  const handles = new Set(),
    sketches = new Map(
      entries.map((s) => [s.id, { frame: xy, paths: [], loops: [], ...s }]),
    );
  const own = (x) => {
    handles.add(x);
    return x;
  };
  t.after(() => {
    for (const h of handles) h.delete();
  });
  const draw = (op) =>
    createSolid(
      wasm,
      { type: 'createSolid', result: 'new', ...op },
      sketches,
      own,
    );
  const printed = (solid) => own(parseSTL(wasm, encodeSTL(solid)));
  return { own, draw, printed };
}
test('dimensional box, tube, sphere, cone and cylinder export in the selected frame', (t) => {
  const { draw, printed } = models(t);
  const make = (shape, settings) =>
    printed(
      draw({
        kind: 'primitive',
        shape,
        frame: xz,
        x: 3,
        y: 4,
        z: 2,
        ...settings,
      }),
    );
  const box = make('box', { width: 12, length: 6, height: 4 });
  assert.deepEqual(box.boundingBox(), { min: [-3, -6, 1], max: [9, -2, 7] });
  near(box.volume(), 288);
  const cylinder = make('cylinder', { diameter: 12, height: 8 });
  near(cylinder.volume(), Math.PI * 36 * 8, 6);
  const tube = make('tube', { diameter: 12, bore: 6, height: 8 });
  near(tube.volume() / cylinder.volume(), 0.75);
  const sphere = make('sphere', { diameter: 12 });
  near(sphere.volume(), (4 * Math.PI * 216) / 3, 12);
  const cone = make('cone', { diameter: 12, topDiameter: 0, height: 8 });
  near(cone.volume() / cylinder.volume(), 1 / 3);
  assert.throws(
    () => make('tube', { diameter: 12, bore: 12, height: 8 }),
    /bore/i,
  );
});
test('new round solids lower printed chord error within the established triangle budget', (t) => {
  const { draw, printed } = models(t);
  const op = { kind: 'primitive', shape: 'cylinder', diameter: 40, height: 8 };
  const base = printed(draw(op));
  const fine = printed(draw({ ...op, curveVersion: 2 }));
  assert.ok(fine.numTri() > base.numTri());
  for (let i = 0; i < 120; i++) {
    const angle = ((i + 0.5) * Math.PI) / 180;
    const ray = [22 * Math.cos(angle), 22 * Math.sin(angle), 4];
    const {
      position: [x, y],
    } = fine.rayCast(ray, [0, 0, 4])[0];
    near(Math.hypot(x, y), 20, 0.00501);
  }
  const huge = draw({ ...op, diameter: 10000, curveVersion: 2 });
  assert.ok(huge.numTri() <= 4 * 256);
});
test('L extrusion and coplanar joins or cuts retain exact stock and hole dimensions', (t) => {
  const top = { ...xy, origin: [0, 0, 6] };
  const { draw, own, printed } = models(t, [
    {
      id: 'leg',
      frame: xz,
      loops: [
        [
          [0, 0],
          [20, 0],
          [20, 4],
          [4, 4],
          [4, 30],
          [0, 30],
        ],
      ],
    },
    { id: 'boss', frame: top, loops: [rect(-2, -2, 2, 2)] },
  ]);
  const bracket = printed(
    draw({
      kind: 'extrude',
      sketchId: 'leg',
      distance: 24,
      direction: 'forward',
    }),
  );
  near(bracket.volume(), (20 * 4 + 26 * 4) * 24);
  assert.deepEqual(bracket.boundingBox(), {
    min: [0, -24, 0],
    max: [20, 0, 30],
  });
  const stock = draw({
    kind: 'primitive',
    shape: 'box',
    width: 20,
    length: 20,
    height: 6,
  });
  for (const result of ['join', 'cut']) {
    const feature = draw({
      kind: 'extrude',
      sketchId: 'boss',
      target: 'stock',
      distance: 2,
      direction: 'auto',
      result,
    });
    const body = printed(applyCreationResult(stock, feature, result, own));
    near(body.volume(), 2400 + (result === 'cut' ? -1 : 1) * 32);
    if (result === 'cut')
      near(body.rayCast([0, 0, 10], [0, 0, -4])[0].position[2], 4);
  }
  const disjoint = own(stock.translate([100, 0, 0]));
  assert.throws(
    () => applyCreationResult(stock, disjoint, 'join', own),
    /does not touch/,
  );
});
test('full and partial revolutions use the sketch axis, retain a bore and handle profiles on either side', (t) => {
  const { draw, printed } = models(t, [
    { id: 'right', frame: xz, loops: [rect(3, 0, 7, 10)] },
    { id: 'left', frame: xz, loops: [rect(-7, 0, -3, 10)] },
    { id: 'crossing', frame: xz, loops: [rect(-3, 0, 3, 10)] },
  ]);
  const revolved = (sketchId, angle) =>
    printed(
      draw({ kind: 'revolve', sketchId, axis: 'v', axisOffset: 0, angle }),
    );
  const full = revolved('right', 360),
    partial = revolved('right', 90);
  near(full.volume(), 400 * Math.PI, 7);
  near(partial.volume() / full.volume(), 0.25, 0.003);
  near(revolved('left', 360).volume(), full.volume(), 0.002);
  assert.deepEqual(full.boundingBox(), { min: [-7, -7, 0], max: [7, 7, 10] });
  assert.equal(full.rayCast([0, 0, 12], [0, 0, -2]).length, 0);
  assert.throws(() => revolved('crossing', 360), /crosses/);
});
test('a mitered sweep along a curved open path has closed end caps and preserves a hollow profile', (t) => {
  const arc = Array.from({ length: 17 }, (_, i) => [
    20 * Math.cos((i * Math.PI) / 32),
    20 * Math.sin((i * Math.PI) / 32),
  ]);
  const { draw, printed } = models(t, [
    { id: 'ring', loops: [rect(-2, -2, 2, 2), rect(-1, -1, 1, 1)] },
    { id: 'path', frame: xz, paths: [arc] },
    {
      id: 'bad',
      paths: [
        [
          [0, 0],
          [2, 0],
          [0, 0],
        ],
      ],
    },
  ]);
  const swept = printed(
    draw({ kind: 'sweep', sketchId: 'ring', pathId: 'path' }),
  );
  const length = arc
    .slice(1)
    .reduce((d, p, i) => d + Math.hypot(p[0] - arc[i][0], p[1] - arc[i][1]), 0);
  near(swept.volume(), length * 12, 0.002);
  near(swept.boundingBox().max[1], 2);
  near(swept.boundingBox().min[1], -2);
  assert.throws(
    () => draw({ kind: 'sweep', sketchId: 'ring', pathId: 'bad' }),
    /direction|tightly/,
  );
});
test('a square-to-round loft preserves both sections including their empty centres on STL export', (t) => {
  const { draw, printed, own } = models(t, [
    { id: 'square', loops: [rect(-10, -10, 10, 10), rect(-3, -3, 3, 3)] },
    { id: 'round', loops: [circle(8, 47), circle(2, 37)] },
  ]);
  const shape = printed(
    draw({
      kind: 'loft',
      sketchId: 'square',
      sectionId: 'round',
      sectionOffset: 24,
    }),
  );
  near(shape.boundingBox().max[2], 24);
  const topArea = own(
    new wasm.CrossSection([circle(8, 47), circle(2, 37)], 'EvenOdd'),
  ).area();
  near(own(shape.slice(0.001)).area(), 364, 0.08);
  near(own(shape.slice(23.999)).area(), topArea, 0.08);
  assert.equal(shape.rayCast([0, 0, 26], [0, 0, -2]).length, 0);
  assert.throws(
    () =>
      draw({
        kind: 'loft',
        sketchId: 'square',
        sectionId: 'round',
        sectionOffset: 0,
      }),
    /sections touch/,
  );
});
test('reversed section normals and a negatively offset loft preserve closed caps', (t) => {
  const { draw, printed } = models(t, [
    { id: 'a', loops: [rect(0, 0, 8, 6)] },
    {
      id: 'b',
      frame: {
        origin: [0, 0, -12],
        u: [1, 0, 0],
        v: [0, -1, 0],
        normal: [0, 0, -1],
      },
      loops: [rect(0, -6, 8, 0)],
    },
  ]);
  near(
    printed(
      draw({ kind: 'loft', sketchId: 'a', sectionId: 'b', sectionOffset: 0 }),
    ).volume(),
    8 * 6 * 12,
  );
});
test('a loft between perpendicular workplanes preserves both end profiles and bores', (t) => {
  const { draw, printed, own } = models(t, [
    { id: 'bottom', loops: [rect(-5, -4, 5, 4), rect(-2, -2, 2, 2)] },
    {
      id: 'side',
      frame: {
        origin: [18, 0, 20],
        u: [0, 1, 0],
        v: [0, 0, 1],
        normal: [1, 0, 0],
      },
      loops: [circle(5, 39), circle(2, 27)],
    },
  ]);
  const result = printed(
    draw({
      kind: 'loft',
      sketchId: 'bottom',
      sectionId: 'side',
      sectionOffset: 0,
    }),
  );
  near(own(result.slice(0.001)).area(), 64, 0.05);
  const side = own(result.rotate([0, -90, 0]));
  const topArea = own(
    new wasm.CrossSection([circle(5, 39), circle(2, 27)], 'EvenOdd'),
  ).area();
  near(own(side.slice(17.999)).area(), topArea, 0.05);
});
test('creation forms identify compatible sketches and persist results, dimensions and references', () => {
  const sketches = [
    {
      id: 'bottom',
      name: 'Base',
      frame: xy,
      sketch: {
        entities: [{ type: 'rectangle', x: 0, y: 0, width: 20, height: 10 }],
      },
    },
    {
      id: 'top',
      name: 'Neck',
      frame: { ...xy, origin: [0, 0, 30] },
      sketch: { entities: [{ type: 'circle', x: 0, y: 0, diameter: 6 }] },
    },
  ];
  const html = createSolidControls(
    'loft',
    { profileSketch: 'bottom' },
    { sketches },
  );
  assert.match(html, /name="loftDistance" value="0"/);
  const op = createSolidOperation(
    'loft',
    {
      profileSketch: 'bottom',
      loftSketch: 'top',
      loftDistance: 0,
      creationResult: 'join',
      creationTarget: 'base',
    },
    { id: 'loft' },
  );
  validateCreation(op);
  assert.equal(op.sectionId, 'top');
  assert.equal(op.target, 'base');
  const p = createSolidOperation(
    'primitive',
    {
      primitiveShape: 'tube',
      shapeDiameter: 10,
      boreDiameter: 6,
      shapeHeight: 8,
      creationResult: 'new',
    },
    { target: 'old' },
  );
  assert.equal(p.target, undefined);
  assert.equal(p.bore, 6);
});
