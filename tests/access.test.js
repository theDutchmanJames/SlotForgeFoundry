// A way up the outside of a building: a ladder leaning on a wall, or a
// staircase along it with a wall on its outer side, from the table up to
// the base on a stand, a storey's floor or a flat roof. Each prints flat
// (a ladder on its back, a staircase on its outer wall) and stands clear
// of everything else.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { ACCESS, buildGarage, buildingLayout, fitsPlate, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const withParts = (settings, check) => {
  const parts = buildGarage(wasm, settings, PLATE);
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
    if (n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
  }
  printed.delete();
  return over;
};
const BOX = { door: 'none', width: 100, depth: 80, height: 60 };
const CASES = [
  { ...BOX, access: 'ladder', accessWall: 'right', accessAt: 40, accessTo: 'roof' },
  { ...BOX, width: 120, height: 50, access: 'stairs', accessWall: 'front', accessAt: 10, accessTo: '2', upper: [{ height: 40, balcony: 10 }] },
  { ...BOX, width: 80, height: 40, open: true, waist: 15, standType: 'column', standSize: 30, standHeight: 50, access: 'stairs', accessWall: 'left', accessAt: -20, accessTo: 'base' },
  { ...BOX, width: 80, height: 40, standType: 'legs', standHeight: 100, access: 'ladder', accessWall: 'back', accessAt: 40, accessTo: 'base' },
  { ...BOX, width: 80, height: 40, standType: 'legs', standHeight: 60, access: 'stairs', accessWall: 'front', accessAt: -30, accessTo: 'base', cornice: 4, pilasters: 30 },
];
// The top of the level the way up reaches, from the table.
const levelTop = (b) => {
  const v = validateBuilding(b);
  const H = v.standType === 'none' ? 0 : v.standHeight;
  if (v.accessTo === 'base') return H + v.baseHeight;
  if (v.accessTo === 'roof') return H + v.baseHeight + v.height + 3;
  return H + v.baseHeight + v.height + 4;
};

test('a way up is checked', () => {
  assert.throws(() => validateBuilding({ ...BOX, access: 'rope' }), /a ladder, a staircase or no way up/);
  assert.throws(() => validateBuilding({ ...BOX, access: 'ladder', accessTo: 'base' }), /needs a stand/);
  assert.throws(() => validateBuilding({ ...BOX, access: 'ladder', roof: 'gable' }), /onto the roof needs a flat roof/);
  assert.throws(() => validateBuilding({ ...BOX, access: 'ladder', accessTo: '2' }), /no storey 2 to go up to/);
  assert.throws(() => validateBuilding({ ...BOX, access: 'ladder', accessWall: 'front', accessAt: 95 }), /The ladder does not fit along the 100 mm front wall at 95 mm/);
  assert.throws(() => validateBuilding({ ...BOX, access: 'stairs', accessWall: 'front', accessAt: 40 }), /The staircase, 114 mm long, does not fit/);
  assert.throws(() => validateBuilding({ ...BOX, height: 150, access: 'stairs', accessWall: 'front', accessAt: -100 }), /too long to print in one piece: take a ladder/);
  assert.deepEqual(buildingLayout(CASES[0]).parts.filter((p) => p.id === 'access').map((p) => p.name), ['Ladder']);
  assert.ok(ACCESS.levels.length === 5);
});

test('every way up: one body, flat to print, fitting the plate, reaching its level, clear of every other part', () => {
  for (const b of CASES)
    withParts(b, (parts, part) => {
      const label = JSON.stringify(b).slice(0, 100);
      const a = part('access');
      assert.equal(a.solid.decompose().length, 1, 'one body ' + label);
      assert.ok(fitsPlate(printSize(a), PLATE), 'fits ' + printSize(a) + ' ' + label);
      assert.ok(printSize(a)[2] <= (b.access === 'ladder' ? ACCESS.ladder.thick : ACCESS.stairs.width) + 0.05, 'lies flat ' + printSize(a) + ' ' + label);
      assert.ok(overAir(a) <= 0.5, 'prints ' + overAir(a).toFixed(1) + ' mm² over air ' + label);
      const box = a.solid.boundingBox();
      assert.ok(near(box.min[2], 0), 'on the table ' + label);
      const top = levelTop(b);
      const reach = b.access === 'ladder' ? top + ACCESS.ladder.above : top + ACCESS.stairs.parapet[1];
      assert.ok(near(box.max[2], reach, 0.05), 'up to its level: ' + box.max[2] + ' for ' + reach + ' ' + label);
      for (const p of parts.filter((q) => q !== a)) {
        const both = a.solid.intersect(p.solid);
        assert.ok(both.volume() < 0.01, 'clear of ' + p.name + ' ' + label);
        both.delete();
      }
    });
});

test('the staircase: its landing level with the floor it goes to, a wall on its outer side', () => {
  const b = CASES[1];
  withParts(b, (parts, part) => {
    const a = part('access').solid;
    const top = levelTop(b);
    // At the top of the stairs the landing, as high as the floor of storey 2.
    const probe = (x, y, z) => {
      const p = wasm.Manifold.cube([0.2, 0.2, 0.2]).translate([x, y, z]);
      const hit = a.intersect(p),
        v = hit.volume();
      [p, hit].forEach((s) => s.delete());
      return v > 0;
    };
    const run = a.boundingBox().max[0];
    const y = a.boundingBox().max[1] - 10;
    assert.ok(probe(run - 5, y, top - 0.5) && !probe(run - 5, y, top + 0.5), 'the landing at the floor');
    assert.ok(probe(run - 5, a.boundingBox().min[1] + 1, top + 6), 'the outer wall above it');
  });
  const notes = kitNotes('Up', validateBuilding(CASES[0]), buildingLayout(CASES[0]).parts, {});
  assert.match(notes, /Stand the ladder with its foot on the table/);
  assert.match(kitNotes('Up', validateBuilding(CASES[1]), buildingLayout(CASES[1]).parts, {}), /Stand the staircase on the table against the front wall/);
});
