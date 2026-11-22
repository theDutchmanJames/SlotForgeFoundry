import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { encodeSTL, makeDemo, parseSTL } from '../src/editor.js';
import { meshFromSolid } from '../src/mesh-topology.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { pickFinishEdge } from '../src/geometry/feature-selection.js';
import {
  applyHoleModify,
  holeRimReference,
  isHoleRim,
  sameHoleRim,
  validateHoleModify,
} from '../src/geometry/hole-modify.js';

const wasm = await init();
wasm.setup();
function setup(t) {
  const scope = new SolidWorkshop(wasm);
  t.after(() => scope.close());
  const own = (s) => scope.own(s);
  const block = (dims) => own(wasm.Manifold.cube(dims));
  const translate = (solid, offset) => own(solid.translate(offset));
  const cylinder = (r, depth, xyz) =>
    translate(own(wasm.Manifold.cylinder(depth, r, r, 40)), xyz);
  const print = (solid) => own(parseSTL(wasm, encodeSTL(solid)));
  const apply = (solid, op) => print(applyHoleModify(wasm, solid, op, own));
  function fixtures(holes, dims = [48, 36, 8]) {
    const stock = block(dims);
    const cutters = holes.map(([x, y, r, h]) =>
      cylinder(r, h == null ? dims[2] : h, [x, y, h == null ? 0 : dims[2] - h]),
    );
    const plate = print(own(stock.subtract(own(wasm.Manifold.union(cutters)))));
    const part = { ...meshFromSolid(plate), bounds: plate.boundingBox() };
    const rims = holes.map(([x, y, r]) => {
      const hit = plate.rayCast(
        [x + r + 0.1, y, dims[2] + 1],
        [x + r + 0.1, y, 0],
      )[0];
      const rim = pickFinishEdge(part, Number(hit.faceID), hit.position);
      assert.ok(isHoleRim(rim));
      return holeRimReference(rim);
    });
    return { plate, rims };
  }
  return { own, print, fixtures, apply, block, cylinder, translate };
}
const z = (part, x, y) => part.rayCast([x, y, 99], [x, y, -1])[0]?.position[2];
const close = (a, b, eps = 0.003) =>
  assert.ok(Math.abs(a - b) < eps, a + ' vs ' + b);
const holes = [
  [8, 8, 1.5],
  [38, 8, 2],
  [8, 27, 1.75, 5],
  [38, 27, 1.25],
];
test('the four screw posts in the supplied enclosure accept one countersink while retaining blind floors and outer walls', (t) => {
  const { own, print, apply } = setup(t);
  const original = own(makeDemo(wasm));
  const imported = print(original);
  const part = { ...meshFromSolid(imported), bounds: imported.boundingBox() };
  const rims = [];
  for (const x of [-36.6, 36.6]) {
    for (const y of [-22.6, 22.6]) {
      const hit = imported.rayCast([x + 1.78, y, 17], [x + 1.78, y, 2])[0];
      const edge = pickFinishEdge(part, Number(hit.faceID), hit.position);
      assert.ok(isHoleRim(edge));
      rims.push(holeRimReference(edge));
    }
  }
  const result = apply(original, {
    kind: 'countersink',
    rims,
    headDiameter: 6,
    headAngle: 90,
  });
  for (const {
    circle: {
      center: [x, y],
    },
  } of rims) {
    close(z(result, x, y), 2);
    close(z(result, x + 2.5, y), 15.5);
  }
  close(z(result, 40, 0), 16);
  close(z(result, 0, 0), 2);
});
test('one edit countersinks four existing bores on the same imported face at a shared, arbitrary included angle', (t) => {
  const { fixtures, apply } = setup(t);
  const { plate, rims } = fixtures(holes);
  const op = {
    type: 'modifyHoles',
    kind: 'countersink',
    rims,
    headDiameter: 7,
    headAngle: 82,
  };
  const result = apply(plate, JSON.parse(JSON.stringify(op)));
  for (const [x, y, r, blind] of holes) {
    const at = (3.5 + r) / 2;
    close(
      z(result, x + at, y),
      8 - (3.5 - at) / Math.tan((41 * Math.PI) / 180),
      0.005,
    );
    close(z(result, x + 3.52, y), 8);
    assert.equal(z(result, x + r - 0.02, y), blind ? 8 - blind : undefined);
  }
  close(z(result, 23, 16), 8);
  assert.equal(sameHoleRim(rims[0], rims[1]), false);
  assert.equal(sameHoleRim(rims[0], structuredClone(rims[0])), true);
});
test('counterbore applies an exact flat-bottom recess while keeping cylinders and blind floors', (t) => {
  const { fixtures, apply } = setup(t),
    { plate, rims } = fixtures(holes);
  const result = apply(plate, {
    kind: 'counterbore',
    rims,
    headDiameter: 8,
    headDepth: 2.25,
  });
  for (const [x, y, r, blind] of holes) {
    close(z(result, x + r + 0.2, y), 5.75);
    close(z(result, x + 3.95, y), 5.75);
    close(z(result, x + 4.02, y), 8);
    assert.equal(z(result, x, y), blind ? 8 - blind : undefined);
  }
});
test('mixed resize narrows and widens existing cylindrical bores without drilling past their original floors', (t) => {
  const { fixtures, apply } = setup(t),
    { plate, rims } = fixtures(holes);
  const result = apply(plate, { kind: 'resize', rims, diameter: 3.5 });
  for (const [x, y, , blind] of holes) {
    assert.equal(z(result, x + 1.73, y), blind ? 8 - blind : undefined);
    close(z(result, x + 1.77, y), 8);
  }
});
test('filling open and blind holes produces the original solid plate, including a watertight STL', (t) => {
  const { fixtures, apply } = setup(t),
    { plate, rims } = fixtures(holes);
  const filled = apply(plate, { kind: 'fill', rims });
  close(filled.volume(), 48 * 36 * 8, 0.001);
  for (const [x, y] of holes) close(z(filled, x, y), 8);
});
test('wall, available depth and overlapping seat failures identify a specific hole without partially applying', (t) => {
  const { fixtures, apply } = setup(t);
  const { plate, rims } = fixtures([
    [12, 12, 2],
    [3, 25, 1.5, 4],
  ]);
  const op = { kind: 'countersink', rims, headAngle: 90, headDiameter: 7 };
  const volume = plate.volume();
  assert.throws(() => apply(plate, op), /Hole 2 ·.*below 6 mm/);
  assert.throws(
    () =>
      apply(plate, {
        ...op,
        kind: 'counterbore',
        headDiameter: 5.5,
        headDepth: 5,
      }),
    /Hole 2 · Only 4 mm/,
  );
  close(plate.volume(), volume);
  const near = fixtures([
    [12, 12, 1.5],
    [17, 12, 1.5],
  ]);
  assert.throws(
    () => apply(near.plate, { ...op, rims: near.rims, headDiameter: 6 }),
    /Hole 2 ·.*overlaps hole 1/,
  );
});
test('diameters validate against each selected bore and duplicate picks cannot apply twice', (t) => {
  const { fixtures, apply } = setup(t);
  const { plate, rims } = fixtures(holes);
  const op = { kind: 'countersink', rims, headAngle: 100, headDiameter: 3.6 };
  assert.throws(() => apply(plate, op), /Hole 2 ·.*4 mm/);
  assert.throws(
    () => validateHoleModify({ ...op, headAngle: 180 }),
    /between 0° and 180°/,
  );
  assert.throws(
    () => validateHoleModify({ ...op, rims: [rims[0], rims[0]] }),
    /Hole 2 ·.*twice/,
  );
});
test('rotated imported mounting plate keeps each seat perpendicular to its own face', (t) => {
  const { own, print, fixtures, apply } = setup(t);
  const original = fixtures(holes);
  const plate = print(
    own(own(original.plate.rotate([29, 0, 0])).translate([-8, 17, -4])),
  );
  const angle = (29 * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const point = (x, y, z) => [x - 8, y * c - z * s + 17, y * s + z * c - 4];
  const part = { ...meshFromSolid(plate), bounds: plate.boundingBox() };
  const rims = holes.map(([x, y, r]) => {
    const hit = plate.rayCast(
      point(x + r + 0.1, y, 10),
      point(x + r + 0.1, y, 0),
    )[0];
    const edge = pickFinishEdge(part, Number(hit.faceID), hit.position);
    assert.ok(isHoleRim(edge));
    return holeRimReference(edge);
  });
  const op = { kind: 'counterbore', rims, headDiameter: 6, headDepth: 1.75 };
  const result = apply(plate, op);
  for (const [x, y, r] of holes) {
    const hit = result.rayCast(
      point(x + r + 0.2, y, 10),
      point(x + r + 0.2, y, 0),
    )[0];
    for (const [i, n] of point(x + r + 0.2, y, 6.25).entries())
      close(hit.position[i], n, 0.002);
  }
  close(apply(plate, { kind: 'fill', rims }).volume(), 48 * 36 * 8, 0.03);
});
test('concealed cavity below a wide mouth reports a measured diameter for the affected rim', (t) => {
  const { own, fixtures, translate, block, apply, print } = setup(t);
  const { plate, rims } = fixtures([[12, 12, 1.5]]);
  const cavity = translate(block([4, 3, 2]), [14.15, 10.5, 5]);
  const stock = print(own(plate.subtract(cavity)));
  assert.throws(
    () =>
      apply(stock, {
        kind: 'countersink',
        rims,
        headDiameter: 8,
        headAngle: 90,
      }),
    /Hole 1 ·.*below the lip.*about 6\.3\d* mm/,
  );
});
