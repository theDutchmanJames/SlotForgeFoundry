// Benches in a row: a seat (and back) between two end frames each; every
// part one body, to print without supports, nothing in another.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { BENCH, benchFootprint, benchStarts, validateBench } from '../src/geometry/bench.js';
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

test('benches are checked and laid out in a row', () => {
  assert.throws(() => validateBench({ count: 2.5 }), /whole number/);
  assert.throws(() => validateBench({ seatHeight: 30 }), /Seat height must be between 8 and 20 mm/);
  const b = validateBench({ count: 3, length: 60, gap: 12 });
  assert.deepEqual(benchStarts(b), [0, 72, 144]);
  assert.deepEqual(benchFootprint(b), [0, 0, 204, BENCH.depth]);
  assert.ok(near(shapeOf(b).front.f[1], -1));
  assert.match(kitNotes('Benches', b, buildingLayout(b).parts, {}), /Glue an end frame against each end of a seat/);
});

test('every part one body, without supports, fitting the plate, nothing in another; the seat at its height between its ends', () => {
  for (const settings of [{ kind: 'bench' }, { kind: 'bench', backrest: false, count: 1 }, { kind: 'bench', length: 150, seatHeight: 20, count: 8 }])
    {
      const label = JSON.stringify(settings);
      const parts = buildGarage(wasm, settings);
      try {
        assert.deepEqual(parts.map((p) => p.id), buildingLayout(settings).parts.map((p) => p.id), label);
        for (const p of parts) {
          assert.equal(p.solid.decompose().length, 1, p.name + ' ' + label);
          assert.ok(overAir(p) < 0.5, p.name + ' prints without supports ' + label);
          assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits ' + label);
        }
        for (let i = 0; i < parts.length; i++)
          for (let j = i + 1; j < parts.length; j++) {
            const both = parts[i].solid.intersect(parts[j].solid);
            assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
            both.delete();
          }
        const b = validateBench(settings);
        const seat = parts.find((p) => p.id === 'seat-1').solid.boundingBox(),
          end = parts.find((p) => p.id === 'end-1-left').solid.boundingBox();
        assert.ok(near(seat.max[2], b.backrest ? b.seatHeight + BENCH.back[1] : b.seatHeight), 'the seat at its height');
        assert.ok(near(seat.min[0], end.max[0]) && near(end.min[2], 0), 'between its end frames, their legs on the table');
      } finally {
        parts.forEach((p) => p.solid.delete());
      }
    }
});
