import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSketchGrid, resolveSketchGrid } from '../src/sketch-grid.js';
import { sketchElementPath } from '../src/create-sketch-data.js';
import {
  sketchEntityInGrid,
  sketchEntityOnPlane,
} from '../src/sketch-grid-entities.js';

const datum = resolveSketchGrid({
  ...defaultSketchGrid(),
  placement: 'custom',
  origin: [31.5, 27.25],
  angle: 90,
});
function near(a, b) {
  assert.ok(Math.abs(a - b) < 1e-9, a + ' versus ' + b);
}

test('native sketch sizes and angles are edited in the chosen datum while geometry is stored in its original plane', () => {
  for (const entity of [
    { type: 'rectangle', x: 12, y: 3, width: 5, height: 2 },
    { type: 'lProfile', x: 12, y: 3, width: 10, height: 8, thickness: 2 },
    { type: 'circle', x: 12, y: 3, diameter: 5 },
    { type: 'slot', x: 12, y: 3, length: 8, width: 4, angle: 22 },
    {
      type: 'line',
      points: [
        [0, 1],
        [12, 3],
      ],
    },
    {
      type: 'arc',
      points: [
        [0, 0],
        [2, 1],
        [2, 3],
      ],
    },
    {
      type: 'path',
      closed: false,
      points: [
        [0, 0],
        [1, 2],
        [2, 1],
      ],
    },
  ]) {
    const world = sketchEntityOnPlane(entity, datum);
    const back = sketchEntityInGrid(world, datum);
    const expected = sketchElementPath(entity).points;
    const actual = sketchElementPath(back).points;
    assert.equal(actual.length, expected.length);
    for (const [i, p] of actual.entries()) {
      near(p[0], expected[i][0]);
      near(p[1], expected[i][1]);
    }
    if (entity.type === 'rectangle' || entity.type === 'lProfile') {
      near(world.x, 28.5);
      near(world.y, 39.25);
      near(world.angle, 90);
      assert.deepEqual(sketchElementPath(world).points[1], [
        28.5,
        39.25 + entity.width,
      ]);
    }
  }
});
