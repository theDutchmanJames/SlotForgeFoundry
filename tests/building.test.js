// A building kit: a garage of base, four walls, a roof, a door, and windows
// and doors in any wall.
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
  printSize,
  roofShape,
  validateBuilding,
} from '../src/geometry/building.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const freeAll = (parts) => parts.forEach((p) => p.solid.delete());
const withParts = (settings, check) => {
  const parts = buildGarage(wasm, settings);
  try {
    return check(parts, (id) => parts.find((p) => p.id === id));
  } finally {
    freeAll(parts);
  }
};
const window = (wall, at, extra = {}) => ({ wall, type: 'window', at, width: 40, height: 30, sill: 25, frame: false, ...extra });
const door = (wall, at, extra = {}) => ({ wall, type: 'door', at, width: 28, height: 48, frame: false, ...extra });
// Every roof, with windows and doors on every wall, some framed.
const VARIANTS = [
  {},
  { roof: 'slope', rises: 'back' },
  { roof: 'slope', rises: 'front', pitch: 20 },
  { roof: 'slope', rises: 'left', pitch: 15 },
  { roof: 'slope', rises: 'right', pitch: 12 },
  { roof: 'gable', ridge: 'depth', pitch: 35 },
  { roof: 'gable', ridge: 'width', pitch: 25, overhangFront: 10, overhangLeft: 0 },
  {
    roof: 'gable',
    openings: [window('left', 60, { frame: true }), door('left', 140, { frame: true }), window('back', 60), window('right', 90, { frame: true })],
  },
  { door: 'open', doorWidth: 50, roof: 'flat', overhangLeft: 12, overhangRight: 0, openings: [door('back', 30), window('front', 20, { width: 12, height: 20, frame: true })] },
];

test('the garage starts at toy proportions for 1:32, with a flat roof and no windows', () => {
  const { building, parts } = buildingLayout({});
  assert.deepEqual(
    [building.width, building.depth, building.height, building.baseHeight, building.roof, building.openings.length],
    [120, 180, 75, 10, 'flat', 0],
  );
  assert.deepEqual(parts.map((p) => p.id), ['base', 'front', 'back', 'left', 'right', 'roof', 'door']);
  assert.ok(!buildingLayout({ door: 'open' }).parts.some((p) => p.id === 'door'));
  assert.deepEqual(buildingLayout({ roof: 'gable' }).parts.filter((p) => p.role === 'roof').map((p) => p.id), ['roof-left', 'roof-right']);
  assert.deepEqual(buildingLayout({ roof: 'gable', ridge: 'width' }).parts.filter((p) => p.role === 'roof').map((p) => p.id), ['roof-front', 'roof-back']);
  // Only a framed opening adds a part.
  assert.deepEqual(
    buildingLayout({ openings: [window('left', 60), window('left', 120, { frame: true })] }).parts.filter((p) => p.role === 'frame').map((p) => p.name),
    ['Left window 2 frame'],
  );
});

test('every part of the default garage fits a 200 mm plate; a bigger one says which do not', () => {
  const plate = { width: 200, depth: 200, margin: 0 };
  withParts({}, (parts) => {
    for (const p of parts) assert.ok(fitsPlate(printSize(p), plate), p.name);
  });
  withParts({ width: 200, depth: 260 }, (parts) => {
    assert.deepEqual(parts.filter((p) => !fitsPlate(printSize(p), plate)).map((p) => p.id), ['base', 'left', 'right', 'roof']);
  });
});

test('settings are checked, and a door or window has to fit its wall', () => {
  assert.throws(() => validateBuilding({ roofColour: 'red' }), /unknown setting: roofColour/);
  assert.throws(() => validateBuilding({ width: 20 }), /Width must be between 60 and 400 mm/);
  assert.throws(() => validateBuilding({ door: 'barn' }), /Choose a door/);
  assert.throws(() => validateBuilding({ roof: 'dome' }), /Choose a roof/);
  assert.throws(() => validateBuilding({ pitch: 60 }), /Roof pitch must be between 10 and 45°/);
  assert.throws(() => validateBuilding({ overhangLeft: 40 }), /Overhang on the left must be between 0 and 30 mm/);
  assert.throws(() => validateBuilding({ width: 80, doorWidth: 90 }), /door is too wide for this building: at most 62 mm/);
  assert.throws(() => validateBuilding({ height: 50, doorHeight: 55 }), /door is too high for these walls: at most 44 mm/);
  assert.throws(() => validateBuilding({ openings: [window('left', 10)] }), /left window reaches into a corner: keep it 9 mm from both ends of the 180 mm wall/);
  assert.throws(() => validateBuilding({ openings: [window('left', 90, { sill: 50 })] }), /left window reaches too high: its top can be at most 69 mm/);
  assert.throws(() => validateBuilding({ openings: [window('front', 30, { width: 12 })] }), /front window is too close to the garage door: keep at least 6 mm/);
  assert.throws(() => validateBuilding({ openings: [window('left', 60), window('left', 100)] }), /left window 1 is too close to the left window 2/);
  assert.throws(() => validateBuilding({ openings: [{ wall: 'left', type: 'hatch' }] }), /must be a window or a door/);
  assert.throws(() => validateBuilding({ openings: [{ ...window('left', 90), glass: true }] }), /unknown setting: glass/);
  assert.throws(() => validateBuilding({ openings: Array.from({ length: 17 }, (_, i) => window('left', 20 + i)) }), /at most 16/);
  // A door always starts at the floor; an opening without a place sits in the middle.
  const [d] = validateBuilding({ openings: [{ wall: 'back', type: 'door', sill: 20 }] }).openings;
  assert.deepEqual([d.sill, d.at, d.width, d.height, d.frame], [0, 60, 28, 48, false]);
  assert.deepEqual(validateBuilding(undefined), { ...BUILDING_DEFAULTS, openings: [] });
});

test('every part is one solid body, and no two parts take the same space, for every roof', () => {
  for (const settings of VARIANTS)
    withParts(settings, (parts) => {
      const label = JSON.stringify(settings);
      for (const p of parts) {
        assert.equal(p.solid.status(), 'NoError', p.name + ' ' + label);
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap by ' + both.volume() + ' ' + label);
          both.delete();
        }
    });
});

test('a two-sided roof gives two walls their gable; a single slope makes one wall tall', () => {
  const top = 10 + 75;
  withParts({ roof: 'gable', ridge: 'depth', pitch: 30 }, (_, part) => {
    const rise = 60 * Math.tan(Math.PI / 6);
    assert.ok(near(part('front').solid.boundingBox().max[2], top + rise, 0.05), 'front gable');
    assert.ok(near(part('back').solid.boundingBox().max[2], top + rise, 0.05), 'back gable');
    // The eaves walls stay at wall height, their top sloped across the wall.
    assert.ok(near(part('left').solid.boundingBox().max[2], top + KIT.wall * Math.tan(Math.PI / 6), 0.05));
  });
  withParts({ roof: 'slope', rises: 'back', pitch: 20 }, (_, part) => {
    const t = Math.tan((20 * Math.PI) / 180);
    assert.ok(near(part('back').solid.boundingBox().max[2], top + 180 * t, 0.05));
    assert.ok(near(part('front').solid.boundingBox().max[2], top + KIT.wall * t, 0.05));
    assert.ok(near(roofShape(validateBuilding({ roof: 'slope', pitch: 20 })).rise, 180 * t, 1e-9));
  });
});

test('the roof reaches past the walls by the overhang of each side', () => {
  const ov = { overhangFront: 5, overhangBack: 0, overhangLeft: 12, overhangRight: 7 };
  for (const roof of ['flat', 'slope', 'gable'])
    withParts({ roof, ...ov }, (parts) => {
      const roofs = parts.filter((p) => p.role === 'roof');
      const min = [0, 1].map((k) => Math.min(...roofs.map((p) => p.solid.boundingBox().min[k])));
      const max = [0, 1].map((k) => Math.max(...roofs.map((p) => p.solid.boundingBox().max[k])));
      assert.deepEqual(
        [min[0], min[1], max[0], max[1]].map((v) => Math.round(v * 100) / 100),
        [-12, -5, 127, 180],
        roof,
      );
    });
});

test('windows and doors are holes; a frame is a part of its own, a window frame with a cross', () => {
  const settings = { openings: [window('left', 60), door('right', 120, { frame: true }), window('back', 60, { frame: true })] };
  withParts(settings, (parts, part) => {
    const top = 10;
    const probe = (x, y, z) => {
      const cube = wasm.Manifold.cube([1, 1, 1]).translate([x - 0.5, y - 0.5, z - 0.5]);
      const hit = parts.filter((p) => {
        const both = p.solid.intersect(cube);
        const v = both.volume();
        both.delete();
        return v > 0.01;
      });
      cube.delete();
      return hit.map((p) => p.id);
    };
    // Through the left window (at 60 mm from its left end, the back): nothing.
    assert.deepEqual(probe(1.5, 180 - 60 + 10, top + 25 + 5), []);
    // The side door on the right starts at the floor.
    assert.deepEqual(probe(118.5, 120 + 8, top + 2), []);
    assert.deepEqual(parts.filter((p) => p.role === 'frame').map((p) => p.name), ['Right door frame', 'Back window frame']);
    // The window frame's cross stands in the middle of its opening, outside the wall.
    assert.deepEqual(probe(120 - 60, 180 + 1, top + 25 + 15), ['frame-3']);
    // A frame prints flat, as deep as it stands out.
    const flat = (size) => [...size.slice(0, 2).sort((a, b) => a - b), size[2]];
    assert.deepEqual(flat(printSize(part('frame-3'))), [30 + 2 * KIT.trim, 40 + 2 * KIT.trim, KIT.trimDepth]);
    assert.deepEqual(flat(printSize(part('frame-2'))), [28 + 2 * KIT.trim, 48 + KIT.trim, KIT.trimDepth]);
  });
});

test('the doorstep is level with the top of the base, which is as high as the track', () => {
  for (const baseHeight of [10, 12])
    withParts({ baseHeight, door: 'open' }, (_, part) => {
      const base = part('base').solid,
        front = part('front').solid;
      assert.ok(near(base.boundingBox().max[2], baseHeight));
      const doorway = wasm.Manifold.cube([20, 10, 50]).translate([50, -5, baseHeight]);
      const left = front.intersect(doorway);
      assert.ok(left.volume() < 0.001, 'wall in the doorway: ' + left.volume());
      left.delete();
      doorway.delete();
      assert.ok(near(front.boundingBox().min[2], baseHeight - KIT.groove));
    });
});

test('walls print flat outside face up, roof panels on their underside, base and flat roof upside down', () => {
  for (const settings of VARIANTS)
    withParts(settings, (parts) => {
      for (const part of parts) {
        const printed = printPose(part);
        const { min, max } = printed.boundingBox();
        assert.ok(near(min[2], 0) && near(min[0], 0) && near(min[1], 0), part.name + ' sits at the origin');
        if (part.role === 'wall') {
          assert.ok(near(max[2], KIT.wall), part.name + ' lies flat, one wall thick');
          const bottom = printed.trimByPlane([0, 0, -1], -0.2),
            topSlice = printed.trimByPlane([0, 0, 1], KIT.wall - 0.2);
          assert.ok(topSlice.volume() > bottom.volume(), part.name + ': the outside face is up');
          bottom.delete();
          topSlice.delete();
        }
        if (part.role === 'roof' && part.lie) assert.ok(near(max[2], KIT.roof, 0.01), part.name + ' lies on its underside: ' + max[2]);
        printed.delete();
      }
    });
});

test('the kit notes list every part as it prints and how the kit goes together', async () => {
  const { kitNotes } = await import('../src/building-kit.js');
  const sizes = { base: [126, 186, 10], door: [96, 58, 3] };
  const withDoor = kitNotes('Pit garage', buildingLayout({}), sizes);
  assert.match(withDoor, /^Pit garage · SlotForge Foundry building kit/);
  assert.match(withDoor, /- Base plate: 126 × 186 × 10 mm/);
  assert.match(withDoor, /- Roller door: 96 × 58 × 3 mm/);
  assert.match(withDoor, /3\. Glue the roller door behind its opening/);
  assert.match(withDoor, /4\. Drop the roof on/);
  const gable = kitNotes('Shed', buildingLayout({ door: 'open', roof: 'gable', openings: [window('left', 90, { frame: true })] }), {});
  assert.doesNotMatch(gable, /Roller door/);
  assert.match(gable, /3\. Glue each frame around its window or door/);
  assert.match(gable, /4\. Lay the two roof panels on the walls so they meet at the ridge/);
  assert.match(gable, /each roof panel lies on its underside/);
});
