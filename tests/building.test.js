// A building kit: a one-car garage of base, four walls, roof and door.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import {
  BUILDING_DEFAULTS,
  KIT,
  buildGarage,
  buildingLayout,
  fitsPlate,
  printPose,
  validateBuilding,
} from '../src/geometry/building.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const freeAll = (parts) => parts.forEach((p) => p.solid.delete());

test('the garage starts at toy proportions for 1:32 and every part fits a 200 mm plate', () => {
  const { building, parts } = buildingLayout({});
  assert.deepEqual(
    [building.width, building.depth, building.height, building.baseHeight],
    [120, 180, 75, 10],
  );
  assert.deepEqual(parts.map((p) => p.id), ['base', 'front', 'back', 'left', 'right', 'roof', 'door']);
  for (const p of parts) assert.ok(fitsPlate(p.print, { width: 200, depth: 200, margin: 0 }), p.name);
  // A bigger garage does not: its base and roof are larger than the plate.
  const big = buildingLayout({ width: 200, depth: 260 }).parts;
  assert.deepEqual(big.filter((p) => !fitsPlate(p.print, { width: 200, depth: 200 })).map((p) => p.id), ['base', 'left', 'right', 'roof']);
  // An open garage has no door insert.
  assert.ok(!buildingLayout({ door: 'open' }).parts.some((p) => p.id === 'door'));
});

test('settings are checked, and the door has to fit its wall', () => {
  assert.throws(() => validateBuilding({ roofColour: 'red' }), /unknown setting: roofColour/);
  assert.throws(() => validateBuilding({ width: 20 }), /Width must be between 60 and 400 mm/);
  assert.throws(() => validateBuilding({ door: 'barn' }), /Choose a door/);
  assert.throws(() => validateBuilding({ width: 80, doorWidth: 90 }), /door is too wide for this building: at most 62 mm/);
  assert.throws(() => validateBuilding({ height: 50, doorHeight: 55 }), /door is too high for these walls: at most 44 mm/);
  assert.deepEqual(validateBuilding(undefined), { ...BUILDING_DEFAULTS });
});

test('every part is one solid body, and no two parts take the same space', () => {
  const parts = buildGarage(wasm, {});
  try {
    for (const p of parts) {
      assert.equal(p.solid.status(), 'NoError', p.name);
      assert.equal(p.solid.decompose().length, 1, p.name + ' is one body');
    }
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const both = parts[i].solid.intersect(parts[j].solid);
        assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap by ' + both.volume());
        both.delete();
      }
  } finally {
    freeAll(parts);
  }
});

test('the doorstep is level with the top of the base, which is as high as the track', () => {
  for (const baseHeight of [10, 12]) {
    const parts = buildGarage(wasm, { baseHeight, door: 'open' });
    try {
      const base = parts.find((p) => p.id === 'base').solid,
        front = parts.find((p) => p.id === 'front').solid;
      assert.ok(near(base.boundingBox().max[2], baseHeight));
      // Through the middle of the doorway nothing of the wall stands above the base.
      const doorway = wasm.Manifold.cube([20, 10, 50]).translate([50, -5, baseHeight]);
      const left = front.intersect(doorway);
      assert.ok(left.volume() < 0.001, 'wall in the doorway: ' + left.volume());
      left.delete();
      doorway.delete();
      // The walls reach down into the groove.
      assert.ok(near(front.boundingBox().min[2], baseHeight - KIT.groove));
    } finally {
      freeAll(parts);
    }
  }
});

test('walls print flat with their outside face up, so the corners are 45° overhangs', () => {
  const parts = buildGarage(wasm, {});
  try {
    for (const part of parts.filter((p) => p.role === 'wall')) {
      const printed = printPose(part);
      const { min, max } = printed.boundingBox();
      assert.ok(near(min[2], 0) && near(max[2], KIT.wall), part.name + ' lies flat, one wall thick');
      // The outside face is the long one: it is at the top.
      const bottom = printed.trimByPlane([0, 0, -1], -0.2),
        topSlice = printed.trimByPlane([0, 0, 1], KIT.wall - 0.2);
      assert.ok(topSlice.volume() > bottom.volume(), part.name + ': the outside face is up');
      bottom.delete();
      topSlice.delete();
      printed.delete();
    }
    // The base and the roof print upside down: their flat top on the plate.
    for (const id of ['base', 'roof']) {
      const printed = printPose(parts.find((p) => p.id === id));
      const { min } = printed.boundingBox();
      assert.deepEqual(min.map((v) => Math.round(v * 1000) / 1000), [0, 0, 0]);
      printed.delete();
    }
  } finally {
    freeAll(parts);
  }
});

test('a garage of other sizes still builds, its parts the sizes the layout gives', () => {
  for (const settings of [{ width: 80, depth: 100, height: 50, doorWidth: 50, doorHeight: 40 }, { width: 160, depth: 220, height: 95 }]) {
    const { parts: sizes } = buildingLayout(settings);
    const parts = buildGarage(wasm, settings);
    try {
      for (const part of parts) {
        const printed = printPose(part);
        const { max } = printed.boundingBox();
        const want = sizes.find((s) => s.id === part.id).print;
        assert.ok(near(max[0], want[0], 0.05) && near(max[1], want[1], 0.05) && near(max[2], want[2], 0.05),
          part.name + ': ' + max.map((v) => v.toFixed(2)).join(' × ') + ' is not ' + want.join(' × '));
        printed.delete();
      }
    } finally {
      freeAll(parts);
    }
  }
});

test('the kit notes list every part as it prints and how the kit goes together', async () => {
  const { kitNotes } = await import('../src/building-kit.js');
  const withDoor = kitNotes('Pit garage', buildingLayout({}));
  assert.match(withDoor, /^Pit garage · SlotForge Foundry building kit/);
  assert.match(withDoor, /- Base plate: 126 × 186 × 10 mm/);
  assert.match(withDoor, /- Roller door: 96 × 58 × 3 mm/);
  assert.match(withDoor, /3\. Glue the roller door behind the opening/);
  const open = kitNotes('Open garage', buildingLayout({ door: 'open' }));
  assert.doesNotMatch(open, /Roller door/);
  assert.match(open, /3\. Drop the roof on/);
});
