import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultSketchGrid,
  exactGridPitch,
  gridAxisAngle,
  gridSegments,
  gridToPlane,
  outlineCircle,
  outlineHoleCentres,
  planeToGrid,
  resolveSketchGrid,
  snapToGrid,
  validateSketchGrid,
} from '../src/sketch-grid.js';
import { sketchPaths, validateSketch } from '../src/create-sketch-data.js';

const rectangle = (w, h, x = 0, y = 0) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
function local(point, origin, angle) {
  const a = (angle * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [
    origin[0] + c * point[0] - s * point[1],
    origin[1] + s * point[0] + c * point[1],
  ];
}
function near(a, b, eps = 1e-7) {
  assert.equal(a.length, b.length);
  a.forEach((v, i) =>
    assert.ok(Math.abs(v - b[i]) < eps, `expected ${a} near ${b}`),
  );
}
const opts = (edits = {}) => ({ ...defaultSketchGrid(), ...edits });

test('a 235 by 117 mm face preserves user pitch, balances the residual, and fits exactly at 1 mm', () => {
  const outline = [rectangle(235, 117, -80, -20)];
  const defaults = defaultSketchGrid(outline);
  assert.equal(defaults.pitch, 10);
  const g = resolveSketchGrid(defaults, outline);
  assert.deepEqual([g.columns, g.rows], [23, 11]);
  near(g.origin, [-77.5, -16.5]);
  near(g.margins, [2.5, 3.5, 2.5, 3.5]);
  const finer = resolveSketchGrid({ ...defaults, pitch: 5 }, outline);
  near(finer.margins, [0, 1, 0, 1]);
  const corner = resolveSketchGrid(
    { ...defaults, placement: 'corner' },
    outline,
  );
  near(corner.origin, [-80, -20]);
  near(corner.margins, [0, 0, 5, 7]);
  assert.equal(exactGridPitch(outline), 1);
  assert.equal(exactGridPitch([rectangle(23.75, 11.25)]), 1.25);
  assert.equal(exactGridPitch([rectangle(235.0003, 117)]), null);
  assert.equal(exactGridPitch([]), null);
  const exact = resolveSketchGrid(
    { ...defaults, pitch: exactGridPitch(outline) },
    outline,
  );
  near(exact.margins, [0, 0, 0, 0]);
});

test('rotated perimeters select stable axes independent of tessellation, translation and winding', () => {
  const angle = 27,
    origin = [31, -45];
  const face = rectangle(235, 117).map((p) => local(p, origin, angle));
  for (const ring of [face, [...face].reverse()]) {
    const g = resolveSketchGrid(defaultSketchGrid([ring]), [ring]);
    near([g.width, g.height], [235, 117]);
    near(g.origin, local([2.5, 3.5], origin, angle));
    assert.equal(exactGridPitch([ring], g.angle), 1);
    near(planeToGrid(g, gridToPlane(g, [20, 10])), [20, 10]);
  }
  const tiny = resolveSketchGrid(undefined, [rectangle(2.35, 1.17)]);
  assert.equal(tiny.pitch, 0.1);
});

test('a bore datum and a directed angled edge yield repeatable local geometry and exact snap positions', () => {
  const axis = gridAxisAngle([10, 30], local([15, 0], [10, 30], -53));
  assert.ok(Math.abs(axis + 53) < 1e-9);
  assert.equal(gridAxisAngle([2, 2], [2, 2]), null);
  const config = opts({
    pitch: 5,
    placement: 'custom',
    origin: [42, 18],
    angle: axis,
  });
  const g = resolveSketchGrid(config, [rectangle(100, 60)]);
  near(g.origin, [42, 18]);
  near(
    snapToGrid(g, local([18.2, 11.7], config.origin, axis)),
    local([20, 10], config.origin, axis),
  );
  near(resolveSketchGrid({ ...config, pitch: 10 }).origin, config.origin);
  for (const type of ['rectangle', 'lProfile']) {
    const e = {
      type,
      x: 42,
      y: 18,
      width: 20,
      height: 10,
      thickness: 2,
      angle: axis,
    };
    const [loop] = sketchPaths({ entities: [e] }).loops;
    near(loop[1], gridToPlane(g, [20, 0]));
    near(loop.at(-1), gridToPlane(g, [0, 10]));
    assert.throws(
      () => validateSketch({ entities: [{ ...e, angle: NaN }] }),
      /orientation/,
    );
  }
});

test('hole recognition uses circular enclosed contours and rejects islands, slots, ellipses and outer rings', () => {
  const circle = (c, r, n = 35) =>
    Array.from({ length: n }, (_, i) => local([r, 0], c, (360 * i) / n + 4));
  const a = circle([10, 10], 3),
    island = circle([10, 10], 1);
  const oval = circle([0, 0], 3).map(([x, y]) => [40 + x, 10 + y / 2]);
  const outer = rectangle(100, 45);
  const rings = [
    a.concat([a[0]]),
    [...outer].reverse(),
    island,
    oval,
    rectangle(7, 5, 50, 5),
  ];
  const found = outlineHoleCentres(rings);
  assert.equal(found.length, 1);
  near(found[0].point, [10, 10]);
  near([found[0].radius, found[0].loopIndex], [3, 0]);
  assert.equal(outlineHoleCentres([a]).length, 0);
  assert.equal(outlineCircle(oval), null);
  assert.equal(outlineCircle(rectangle(5, 5)), null);
});

test('display thinning stays aligned with the exact snap lattice and bounds work at far offsets', () => {
  const g = resolveSketchGrid(
    opts({ pitch: 0.001, angle: 13, placement: 'custom', origin: [4, 8] }),
  );
  const box = { min: [99123540, 15000], max: [99123775, 15117] };
  for (const pixelsPerMm of [0.1, 1, 10, 100]) {
    const { lines, stride } = gridSegments(g, box, {
      pixelsPerMm,
      maxLines: 50,
    });
    assert.ok(lines.length > 0 && lines.length <= 50);
    const spacing = stride * g.pitch;
    for (const [a, b] of lines) {
      const aa = planeToGrid(g, a),
        bb = planeToGrid(g, b);
      const i = Math.abs(aa[0] - bb[0]) < 1e-5 ? 0 : 1;
      near([aa[i]], [Math.round(aa[i] / spacing) * spacing], 1e-5);
    }
    near(
      planeToGrid(g, snapToGrid(g, gridToPlane(g, [17.1233, 9.0108]))),
      [17.123, 9.011],
    );
  }
  assert.deepEqual(gridSegments({ ...g, visible: false }, box).lines, []);
});

test('face guides clip to an L-shaped outline and a through-hole while retaining the four exterior edges', () => {
  const outer = [
    [0, 0],
    [30, 0],
    [30, 30],
    [20, 30],
    [20, 20],
    [0, 20],
  ];
  const hole = rectangle(6, 6, 7, 7);
  const loops = [outer, hole],
    g = resolveSketchGrid(opts({ pitch: 5, placement: 'corner' }), loops);
  const { lines } = gridSegments(g, g.bounds, {
    minPixels: 0,
    clipLoops: loops,
  });
  const y10 = lines.filter(([a, b]) => a[1] === 10 && b[1] === 10);
  assert.deepEqual(y10, [
    [
      [0, 10],
      [7, 10],
    ],
    [
      [13, 10],
      [30, 10],
    ],
  ]);
  assert.deepEqual(
    lines.find(([a, b]) => a[1] === 25 && b[1] === 25),
    [
      [20, 25],
      [30, 25],
    ],
  );
  assert.ok(lines.some(([a, b]) => a[0] === 30 && b[0] === 30));
  assert.ok(lines.some(([a, b]) => a[1] === 30 && b[1] === 30));
});

test('blank and malformed configuration are handled without an unbounded lattice', () => {
  const grid = resolveSketchGrid(defaultSketchGrid());
  near(grid.origin, [0, 0]);
  assert.equal(grid.pitch, 1);
  assert.deepEqual(gridSegments(grid).lines, []);
  for (const delta of [
    { pitch: 0 },
    { pitch: NaN },
    { origin: [Infinity, 0] },
    { visible: 1 },
    { placement: 'x' },
    { angle: NaN },
  ])
    assert.throws(() => validateSketchGrid(opts(delta)));
});
