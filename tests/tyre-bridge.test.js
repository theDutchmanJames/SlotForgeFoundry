// A tyre bridge: two tyre sidewalls over the track, stairs up the arch
// between them, in halves joined at the middle; every part one body, to
// print without supports, fitting the plate, nothing in another.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { TYRE, tyreArch, tyreFootprint, tyreOpening, tyreSteps, validateTyreBridge } from '../src/geometry/tyre-bridge.js';
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
const VARIANTS = [{ kind: 'tyrebridge' }, { kind: 'tyrebridge', width: 100 }, { kind: 'tyrebridge', span: 240, height: 90, tread: false }, { kind: 'tyrebridge', span: 380, height: 120 }, { kind: 'tyrebridge', span: 300, height: 150 }];

test('a tyre bridge is checked; its arch, its opening and its steps', () => {
  assert.throws(() => validateTyreBridge({ height: 180, span: 300 }), /at most a half circle: at most 150 mm high/);
  assert.throws(() => validateTyreBridge({ span: 400, height: 140 }), /too long for a half to print/);
  assert.throws(() => validateTyreBridge({ tread: 'yes' }), /tread/);
  const t = validateTyreBridge({});
  const { R, zc } = tyreArch(t);
  assert.ok(near(zc + R, t.height) && near(Math.hypot(t.span / 2, zc), R), 'the rim through the feet and the top');
  const o = tyreOpening(t);
  assert.ok(o.width > 250 && o.height > 90, 'room for the track under it: ' + JSON.stringify(o));
  const { K, z, X } = tyreSteps(t);
  for (let k = 1; k < K; k++) {
    assert.ok(near(z[k] - z[k - 1], TYRE.rise), 'every step as high');
    assert.ok(X[k] - X[k + 1] >= TYRE.tread - 1e-9, 'every step deep enough');
  }
  const [x0, , x1] = tyreFootprint(t);
  assert.ok(near(x1, X[1]) && near(x0, -X[1]), 'the stairs reach out past the tyre at its feet');
  assert.ok(near(shapeOf(t).front.f[1], -1));
  assert.match(kitNotes('Bridge', t, buildingLayout(t).parts, {}), /Join the two halves of each sidewall and of the stairs at the middle/);
});

test('every part one body, without supports, fitting the plate, nothing in another; the halves meet at the middle', () => {
  for (const settings of VARIANTS) {
    const label = JSON.stringify(settings);
    const parts = buildGarage(wasm, settings);
    try {
      assert.deepEqual(parts.map((p) => p.id), buildingLayout(settings).parts.map((p) => p.id), label);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' one body ' + label);
        assert.ok(overAir(p) < 0.5, p.name + ' prints without supports ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits ' + label + ': ' + printSize(p));
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
      const t = validateTyreBridge(settings);
      const box = (id) => parts.find((p) => p.id === id).solid.boundingBox();
      // The sidewalls as high as the tyre; the halves either side of the middle, the dovetail reaching over it.
      assert.ok(near(Math.max(box('side-front-1').max[2], box('side-front-2').max[2]), t.height, 0.2));
      assert.ok(box('side-front-1').min[0] < 0 && box('side-front-2').max[0] > 0);
      // The stairs between the sidewalls, their top below the rim, their feet on the table.
      assert.ok(box('deck-1').min[1] > TYRE.wall && box('deck-1').max[1] < t.width - TYRE.wall);
      assert.ok(Math.max(box('deck-1').max[2], box('deck-2').max[2]) <= t.height - TYRE.sunk + 0.01 && near(box('deck-1').min[2], 0));
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
});
