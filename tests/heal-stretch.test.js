import assert from 'node:assert/strict';
import test from 'node:test';
import init from 'manifold-3d';
import { encodeSTL, parseSTL, surfaceRegion } from '../src/editor.js';
import { meshFromSolid } from '../src/mesh-topology.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import {
  applyHealStretch,
  recognizeHealProfile,
  stretchReference,
  validateHealStretch,
} from '../src/geometry/heal-stretch.js';

const wasm = await init();
wasm.setup();
function fixture(t) {
  const bench = new SolidWorkshop(wasm),
    own = (v) => bench.own(v);
  t.after(() => bench.close());
  const box = (s, p = [0, 0, 0]) =>
    own(own(wasm.Manifold.cube(s)).translate(p));
  const cylinder = (h, r, p) =>
    own(own(wasm.Manifold.cylinder(h, r, r, 48)).translate(p));
  const printed = (s) => own(parseSTL(wasm, encodeSTL(s)));
  const apply = (s, op) => applyHealStretch(wasm, s, op, own);
  return { own, box, cylinder, printed, apply };
}
function operation(solid, x, y) {
  const hit = solid.rayCast([x, y, 100], [x, y, -100])[0];
  const face = surfaceRegion(solid, Number(hit.faceID), 0.02);
  return {
    type: 'healFeature',
    ...recognizeHealProfile(
      { ...meshFromSolid(solid), bounds: solid.boundingBox() },
      face,
    ),
  };
}
function top(solid, x, y) {
  return solid.rayCast([x, y, 100], [x, y, -100])[0]?.position[2];
}
function close(actual, expected, tolerance = 0.002) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    actual + ' does not match ' + expected,
  );
}
function stretch(overrides = {}) {
  return {
    type: 'stretchSection',
    axis: 'x',
    start: 12,
    end: 30,
    fixedEnd: 'low',
    change: 15,
    ...overrides,
  };
}
test('recognizes an imported drilled boss and an isolated rib; healing restores the planar landing and preserves a through bore and nearby details', (t) => {
  const { own, box, cylinder, apply, printed } = fixture(t);
  const base = box([42, 26, 5]);
  const post = cylinder(8, 4, [9, 12, 5]),
    bore = cylinder(16, 1.5, [9, 12, -1]);
  const rib = box([3, 16, 4], [31, 5, 5]);
  const stock = printed(own(own(own(base.add(post)).add(rib)).subtract(bore)));
  const remove = operation(stock, 12, 12);
  close(remove.supportOffset, -8);
  const healed = printed(apply(stock, remove));
  close(top(healed, 12, 12), 5);
  assert.equal(top(healed, 9, 12), undefined);
  close(top(healed, 32, 12), 9);
  const cleared = printed(apply(healed, operation(healed, 32, 12)));
  close(top(cleared, 32, 12), 5);
  close(cleared.volume(), own(base.subtract(bore)).volume(), 0.02);
});
test('recognizes a flat pocket floor and rejects missing lands, intersecting walls, and stale picks', (t) => {
  const { own, box, apply, printed } = fixture(t);
  const base = box([30, 22, 12]),
    cut = box([8, 6, 10], [13, 9, 5]);
  const pocket = printed(own(base.subtract(cut)));
  const fill = operation(pocket, 15, 12);
  close(fill.supportOffset, 7);
  close(printed(apply(pocket, fill)).volume(), base.volume(), 0.01);
  assert.throws(() => apply(base, fill), /has changed/);
  assert.throws(() => operation(base, 4, 3), /isolated/);
  const throughSlot = box([30, 2, 4], [0, 11, 7]);
  const interrupted = own(pocket.subtract(throughSlot));
  assert.throws(() => apply(interrupted, fill), /isolated/);
});

test('healing follows the local landing on a rotated and translated imported bracket', (t) => {
  const { own, box, cylinder, printed, apply } = fixture(t);
  const base = box([30, 20, 4]);
  const withPost = own(base.add(cylinder(5, 3, [13, 9, 4])));
  const transform = (solid) =>
    own(own(solid.rotate([24, 0, 34])).translate([40, -30, 12]));
  const stock = printed(transform(withPost));
  const r = (d) => (d * Math.PI) / 180,
    tilt = r(24),
    turn = r(34);
  const world = ([x, y, z]) => {
    const yy = Math.cos(tilt) * y - Math.sin(tilt) * z;
    return [
      40 + Math.cos(turn) * x - Math.sin(turn) * yy,
      -30 + Math.sin(turn) * x + Math.cos(turn) * yy,
      12 + Math.sin(tilt) * y + Math.cos(tilt) * z,
    ];
  };
  const hit = stock.rayCast(world([13, 9, 15]), world([13, 9, 1]))[0];
  const face = surfaceRegion(stock, Number(hit.faceID), 0.1);
  const remove = {
    type: 'healFeature',
    ...recognizeHealProfile(
      { ...meshFromSolid(stock), bounds: stock.boundingBox() },
      face,
    ),
  };
  close(remove.supportOffset, -5);
  const result = printed(apply(stock, remove));
  close(result.volume(), base.volume(), 0.03);
});
test('stretch moves end details rigidly in the printed file and can shorten the section from the high end', (t) => {
  const { own, box, cylinder, apply, printed } = fixture(t);
  const base = box([52, 20, 6]);
  const stock = printed(
    own(
      own(base.subtract(cylinder(8, 2.5, [6, 10, -1]))).subtract(
        cylinder(8, 3, [45, 10, -1]),
      ),
    ),
  );
  const expanded = printed(apply(stock, stretch()));
  close(expanded.boundingBox().max[0], 67);
  for (const [x, radius] of [
    [6, 2.5],
    [60, 3],
  ]) {
    assert.equal(top(expanded, x + radius - 0.05, 10), undefined);
    close(top(expanded, x + radius + 0.05, 10), 6);
  }
  close(expanded.volume() - stock.volume(), 15 * 20 * 6, 0.02);
  const short = printed(
    apply(stock, stretch({ change: -5, fixedEnd: 'high' })),
  );
  close(short.boundingBox().min[0], 5);
  close(short.boundingBox().max[0], 52);
  assert.equal(top(short, 11, 10), undefined);
  assert.equal(top(short, 45, 10), undefined);
  assert.throws(
    () => apply(stock, stretch({ start: -4 })),
    /both planes inside/,
  );
  assert.throws(
    () => validateHealStretch(stretch({ change: -18 })),
    /Shortening/,
  );
});
test('face-normal stretch handles an oblique bracket, and pattern tools outside the edited section move rigidly', (t) => {
  const { own, box, apply, printed } = fixture(t),
    rad = 0.46;
  const rotate = (s) => own(s.rotate([0, 0, (rad * 180) / Math.PI]));
  const stock = rotate(box([50, 10, 6]));
  const op = stretch({
    axis: 'face',
    normal: [Math.cos(rad), Math.sin(rad), 0],
  });
  const result = printed(apply(stock, op));
  close(result.volume(), 65 * 10 * 6, 0.04);
  const local = own(result.rotate([0, 0, (-rad * 180) / Math.PI]));
  close(local.boundingBox().max[0], 65);
  for (const [start, expected] of [
    [0, 0],
    [42, 57],
  ]) {
    const ref = rotate(box([2, 4, 8], [start, 3, -1]));
    const mapped = own(
      stretchReference(wasm, ref, op, own).rotate([
        0,
        0,
        (-rad * 180) / Math.PI,
      ]),
    );
    close(mapped.boundingBox().min[0], expected);
    close(mapped.volume(), 64);
  }
});
