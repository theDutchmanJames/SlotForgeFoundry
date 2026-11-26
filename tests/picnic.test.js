// A picnic table: a planked top and two planked seats on A-frame ends; every
// part one body, printing without supports but for the cleats over the gaps
// between the planks, fitting the plate, nothing in another.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { BENCH, planksAcross } from '../src/geometry/bench.js';
import { PICNIC, picnicFootprint, validatePicnic } from '../src/geometry/picnic.js';
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

test('a picnic table is checked and laid out', () => {
  assert.throws(() => validatePicnic({ count: 1.5 }), /whole number/);
  assert.throws(() => validatePicnic({ length: 200 }), /Length must be between 40 and 150 mm/);
  const p = validatePicnic({ count: 2, length: 60, gap: 15 });
  assert.deepEqual(picnicFootprint(p), [0, 0, 135, PICNIC.depth]);
  assert.ok(near(shapeOf(p).front.f[1], -1));
  assert.match(kitNotes('Picnic', p, buildingLayout(p).parts, {}), /lay the seats on the low bearers/);
});

test('every part one body, fitting the plate, nothing in another; planks with gaps, the top and the seats at their heights', () => {
  for (const settings of [{ kind: 'picnic' }, { kind: 'picnic', length: 150, count: 2 }, { kind: 'picnic', length: 40 }]) {
    const label = JSON.stringify(settings);
    const parts = buildGarage(wasm, settings);
    try {
      assert.deepEqual(parts.map((p) => p.id), buildingLayout(settings).parts.map((p) => p.id), label);
      const p0 = validatePicnic(settings);
      const cleats = p0.length > 80 ? 3 : 2;
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits ' + label);
        // Only the cleats over the gaps between the planks hang over air, short bridges.
        const width = /^top/.test(p.id) ? PICNIC.top[2] - PICNIC.top[1] : /^seat/.test(p.id) ? PICNIC.seat[1] : 0;
        const bridges = width ? (planksAcross(width).length - 1) * cleats * BENCH.plank[1] * BENCH.cleat[0] : 0;
        assert.ok(overAir(p) < bridges + 0.5, p.name + ' prints ' + overAir(p) + ' over air ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
      const box = (id) => parts.find((p) => p.id === id + (p0.count > 1 ? '-1' : '')).solid.boundingBox();
      assert.ok(near(box('top').max[2], PICNIC.top[0]) && near(box('seat-front').max[2], PICNIC.seat[0]) && near(box('end-left').min[2], 0));
      assert.ok(near(box('end-left').min[0], BENCH.inset), 'the ends set in from the ends of the planks');
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
});
