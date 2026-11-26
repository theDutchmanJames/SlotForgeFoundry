// Switchback stairs to stand against a building: two flights, a landing on
// posts between them and one at the top, railings; each part one body, to
// print without supports, nothing in another.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { SWITCHBACK, switchbackFootprint, switchbackPlan, validateSwitchback } from '../src/geometry/switchback.js';
import { buildGarage, buildingLayout, fitsPlate, printPose, printSize } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';
import { shapeOf } from '../src/planner-buildings.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const overAir = (part) => {
  const printed = printPose(part);
  const m = printed.getMesh();
  let over = 0;
  for (let i = 0; i < m.triVerts.length; i += 3) {
    const v = [0, 1, 2].map((k) => Array.from(m.vertProperties.subarray(m.triVerts[i + k] * m.numProp, m.triVerts[i + k] * m.numProp + 3)));
    const a = v[1].map((x, j) => x - v[0][j]),
      b = v[2].map((x, j) => x - v[0][j]);
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = Math.hypot(...n);
    if (len && n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
  }
  printed.delete();
  return over;
};
const VARIANTS = [{ kind: 'switchback' }, { kind: 'switchback', height: 30, width: 16, railingStyle: 'bars' }, { kind: 'switchback', height: 190, width: 40, railHeight: 25 }, { kind: 'switchback', railHeight: 10 }];

test('switchback stairs are checked, and laid out step by step', () => {
  assert.throws(() => validateSwitchback({ height: 20 }), /Height must be between 30 and 190 mm/);
  assert.throws(() => validateSwitchback({ railingStyle: 'rope' }), /mesh or of bars/);
  assert.throws(() => validateSwitchback({ colour: 'red' }), /unknown setting/);
  for (const height of [30, 70, 133, 190]) {
    const s = validateSwitchback({ height });
    const p = switchbackPlan(s);
    assert.ok(p.r <= SWITCHBACK.rise + 1e-9, 'no step too high');
    assert.ok(near(p.n * p.r, height) && near(p.h1, p.n1 * p.r));
    assert.ok(p.x2 <= 0, 'the upper flight comes back past the foot of the lower');
  }
});

test('every part one body, without supports, fitting the plate, nothing in another; the flights meet the landings', () => {
  for (const settings of VARIANTS) {
    const label = JSON.stringify(settings);
    const parts = buildGarage(wasm, settings);
    try {
      assert.deepEqual(parts.map((p) => p.id), buildingLayout(settings).parts.map((p) => p.id), label);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' one body ' + label);
        assert.ok(overAir(p) < 0.5, p.name + ' prints without supports ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
      const s = validateSwitchback(settings),
        p = switchbackPlan(s);
      const box = (id) => parts.find((q) => q.id === id).solid.boundingBox();
      // The lower flight from the table to the landing in the middle, the upper from it to the top.
      assert.ok(near(box('flight-1').max[0], p.x1) && near(box('landing-mid').min[0], p.x1), 'the lower flight against the middle landing');
      assert.ok(near(box('landing-mid').max[2], p.h1) && near(box('landing-top').max[2], s.height), 'the landings at their heights');
      assert.ok(near(box('flight-2').min[0], p.x2) && near(box('landing-top').max[0], p.x2), 'the upper flight against the top landing');
      assert.ok(near(box('flight-2').max[1], 2 * s.width) && near(box('landing-top').max[1], 2 * s.width), 'the upper flight and the top landing against the wall');
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
});

test('on the plan it stands with its back to the wall; the notes put it together', () => {
  const s = validateSwitchback({});
  const [x0, y0, x1, y1] = switchbackFootprint(s);
  assert.ok(x0 < 0 && near(y0, 0) && near(y1, 2 * s.width) && x1 > 0);
  assert.ok(near(shapeOf(s).front.f[1], -1));
  assert.match(kitNotes('Stairs', s, buildingLayout(s).parts, {}), /Stand the lower flight against the back of the building/);
});
