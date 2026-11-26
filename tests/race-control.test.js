// A race control tower: four storeys, a balcony all round a storey with
// lattice railings, an open cab on top. Each part one body, fitting the
// plate; the balcony floor reaches out on every side, a railing along each.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { KIT, MAX_UPPER, buildGarage, buildingLayout, fitsPlate, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const withParts = (b, check) => {
  const parts = buildGarage(wasm, b, PLATE);
  try {
    return check(parts, (id) => parts.find((p) => p.id === id));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
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
const TOWER = BUILDING_PRESETS.find((p) => p.id === 'race-control').building;
const SMALL = {
  width: 90,
  depth: 90,
  height: 40,
  door: 'none',
  upper: [{ width: 90, depth: 90, x: 0, y: 0, height: 40, balcony: 20, balconyAll: true, railing: true }],
  railingStyle: 'lattice',
};

test('four storeys, a balcony all round and lattice railings are checked', () => {
  assert.equal(MAX_UPPER, 3);
  assert.equal(validateBuilding(TOWER).upper.length, 3);
  const five = { ...TOWER, upper: [...TOWER.upper, TOWER.upper[0]] };
  assert.throws(() => validateBuilding(five), /at most 3 storeys above the ground floor/);
  assert.throws(() => validateBuilding({ ...SMALL, upper: [{ ...SMALL.upper[0], balconyAll: 'yes' }] }), /runs all round/);
  assert.throws(() => validateBuilding({ ...SMALL, railingStyle: 'rope' }), /bars, of mesh or a lattice/);
  // A way up to storey 4.
  const plain = { ...TOWER, upper: TOWER.upper.map((u) => ({ ...u, balcony: 0, balconyAll: false, railing: false, lean: 0 })) };
  assert.equal(validateBuilding({ ...plain, access: 'ladder', accessWall: 'right', accessAt: 40, accessTo: '4' }).accessTo, '4');
  // Not through a balcony on its way: all round, on any wall; in front, on the front.
  assert.throws(() => validateBuilding({ ...TOWER, upper: TOWER.upper.map((u) => ({ ...u, lean: 0 })), access: 'ladder', accessWall: 'right', accessAt: 40, accessTo: '4' }), /climb through the balcony of storey 3 on the right wall/);
  assert.throws(() => validateBuilding({ ...plain, upper: [plain.upper[0], { ...plain.upper[1], balcony: 20 }, plain.upper[2]], access: 'ladder', accessWall: 'front', accessAt: 20, accessTo: '4' }), /balcony of storey 3 on the front wall/);
  assert.equal(validateBuilding({ ...plain, upper: [plain.upper[0], { ...plain.upper[1], balcony: 20 }, plain.upper[2]], access: 'ladder', accessWall: 'right', accessAt: 40, accessTo: '4' }).accessTo, '4');
  assert.throws(() => validateBuilding({ ...SMALL, access: 'ladder', accessWall: 'right', accessAt: 40, accessTo: '4' }), /no storey 4/);
});

test('the race control tower: every part one body, fitting the plate; walls, frames and railings flat over no air', () => {
  withParts(TOWER, (parts) => {
    for (const p of parts) {
      assert.equal(p.solid.decompose().length, 1, p.name + ' is one body');
      assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits: ' + printSize(p));
    }
    for (const p of parts.filter((q) => /^(front|back|left|right|frame|railing)/.test(q.id))) assert.ok(overAir(p) <= 0.5, p.name + ' prints over air');
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const both = parts[i].solid.intersect(parts[j].solid);
        assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap');
        both.delete();
      }
    // Four storeys of walls, the top one leaning out.
    for (const n of ['', '2', '3', '4']) assert.ok(parts.some((p) => p.id === 'front' + n), 'storey ' + (n || 1));
  });
});

test('a balcony all round: the floor reaches out on every side, a railing along each edge', () => {
  const ids = buildingLayout(SMALL).parts.map((p) => p.id);
  for (const side of ['front', 'back', 'left', 'right']) assert.ok(ids.includes('railing2-' + side), 'a railing at the ' + side);
  withParts(SMALL, (_, part) => {
    const floor = part('floor2').solid.boundingBox();
    assert.ok(near(floor.min[0], -20) && near(floor.max[0], 110) && near(floor.min[1], -20) && near(floor.max[1], 110), 'out 20 all round');
    // Each railing on its edge, in from it by the inset.
    const back = part('railing2-back').solid.boundingBox();
    assert.ok(near(back.max[1], 110 - KIT.railInset), 'the back railing along the back edge');
    const left = part('railing2-left').solid.boundingBox();
    assert.ok(near(left.min[0], -20 + KIT.railInset), 'the left railing along the left edge');
  });
  // In front only, as before: no railing along the back.
  const front = { ...SMALL, upper: [{ ...SMALL.upper[0], balconyAll: false }] };
  assert.ok(!buildingLayout(front).parts.some((p) => p.id === 'railing2-back'));
});

test('a lattice railing has an X between each two posts: more solid than bars, less than mesh', () => {
  const volume = (style) =>
    withParts({ ...SMALL, railingStyle: style }, (_, part) => {
      const r = part('railing2-front');
      assert.ok(overAir(r) <= 0.5, style + ' prints flat');
      assert.equal(r.solid.decompose().length, 1);
      return r.solid.volume();
    });
  const bars = volume('bars'),
    lattice = volume('lattice'),
    mesh = volume('mesh');
  assert.ok(lattice > bars + 20 && lattice < mesh, [bars, lattice, mesh].join(' '));
});

test('a way up to storey 4 is in the notes', async () => {
  const { kitNotes } = await import('../src/building-kit.js');
  const b = validateBuilding({ ...TOWER, upper: TOWER.upper.map((u) => ({ ...u, balcony: 0, balconyAll: false, railing: false, lean: 0 })), access: 'ladder', accessWall: 'right', accessAt: 40, accessTo: '4' });
  assert.match(kitNotes('Tower', b, buildingLayout(b).parts, {}), /against the floor of storey 4/);
});
