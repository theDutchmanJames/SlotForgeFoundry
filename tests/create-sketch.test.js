import test from 'node:test';
import assert from 'node:assert/strict';
import {
  importSketchDrawing,
  sketchAnchors,
  sketchBounds,
  sketchElementPath,
  sketchPaths,
  validateSketch,
} from '../src/create-sketch-data.js';

function area(points) {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    twice += a[0] * b[1] - a[1] * b[0];
  }
  return Math.abs(twice) / 2;
}
const bbox = (points) => sketchBounds([points]);

test('an editable L profile keeps its outside corner, leg lengths and wall thickness in mm', () => {
  const profile = {
    type: 'lProfile',
    x: -2,
    y: 3,
    width: 40,
    height: 30,
    thickness: 4,
  };
  const sketch = { entities: [profile] };
  const [points] = sketchPaths(sketch).loops;
  assert.deepEqual(bbox(points), { xmin: -2, xmax: 38, ymin: 3, ymax: 33 });
  assert.equal(area(points), 264);
  const reopened = JSON.parse(JSON.stringify(sketch));
  reopened.entities[0].thickness = 5;
  assert.equal(area(sketchPaths(reopened).loops[0]), 325);
  assert.equal(profile.thickness, 4);
  assert.throws(
    () => validateSketch({ entities: [{ ...profile, thickness: 30 }] }),
    /wall thinner/,
  );
});

test('a three-point arc passes exactly through all picks, and joins a reversed line into one closed profile', () => {
  for (const sign of [1, -1]) {
    const points = [
      [5, 0],
      [0, 5 * sign],
      [-5, 0],
    ];
    const arc = { type: 'arc', points };
    const line = {
      type: 'line',
      points: [
        [5, 0],
        [-5, 0],
      ],
    };
    const result = sketchPaths({ entities: [arc, line] });
    assert.equal(result.loops.length, 1);
    assert.equal(result.paths.length, 0);
    for (const p of points)
      assert.ok(result.loops[0].some((v) => v[0] === p[0] && v[1] === p[1]));
    assert.ok(Math.abs(area(result.loops[0]) - (Math.PI * 25) / 2) < 1);
  }
  assert.throws(
    () =>
      sketchPaths({
        entities: [
          {
            type: 'arc',
            points: [
              [2, 2],
              [4, 4],
              [8, 8],
            ],
          },
        ],
      }),
    /straight line/,
  );
});

test('dimensioned circle, slot and nested profiles retain their centres, angle and tip-to-tip dimensions', () => {
  const entities = [
    { type: 'rectangle', x: -15, y: -25, width: 30, height: 50 },
    { type: 'circle', x: 1, y: 2, diameter: 8 },
    { type: 'slot', x: 0, y: 0, width: 4, length: 20, angle: 90 },
  ];
  const { loops } = sketchPaths({ entities });
  assert.equal(loops.length, 3);
  assert.deepEqual(bbox(loops[1]), { xmin: -3, xmax: 5, ymin: -2, ymax: 6 });
  const slot = bbox(loops[2]);
  assert.equal(slot.ymax - slot.ymin, 20);
  assert.ok(Math.abs(slot.xmax - slot.xmin - 4) < 1e-10);
  assert.ok(
    sketchAnchors(entities[0], sketchElementPath(entities[0])).some(
      ([p, kind]) => p[0] === 0 && p[1] === 0 && kind === 'Centre',
    ),
  );
});

test('SVG and ASCII DXF artwork preserve open paths, closed loops and file units independent of Circuit layer names', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="30mm" viewBox="0 0 50 30"><g id="SURFACE_EDGES"><path d="M0 0 H12 V8 H0 Z"/><path d="M20 5 L25 9 L28 16"/></g></svg>';
  const g = sketchPaths(importSketchDrawing(svg, 'fixture.svg'));
  assert.equal(g.loops.length, 1);
  assert.equal(g.paths.length, 1);
  assert.equal(area(g.loops[0]), 96);
  const dxf = [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '8',
    'SLOT_CENTRES',
    '10',
    '2',
    '20',
    '3',
    '11',
    '17',
    '21',
    '8',
    '0',
    'ENDSEC',
    '0',
    'EOF',
  ].join('\n');
  const line = sketchPaths(importSketchDrawing(dxf, 'drawing.dxf')).paths;
  assert.deepEqual(line, [
    [
      [2, 3],
      [17, 8],
    ],
  ]);
});
