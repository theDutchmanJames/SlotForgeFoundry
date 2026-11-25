// A building kit: a garage of base, four walls, a roof, a door, and windows
// and doors in any wall.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import {
  BUILDING_DEFAULTS,
  buildingCuts,
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
const withParts = (settings, check, plate = null) => {
  const parts = buildGarage(wasm, settings, plate);
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
  const plainLayout = buildingLayout({});
  const withDoor = kitNotes('Pit garage', plainLayout.building, plainLayout.parts, sizes);
  assert.match(withDoor, /^Pit garage · SlotForge Foundry building kit/);
  assert.match(withDoor, /- Base plate: 126 × 186 × 10 mm/);
  assert.match(withDoor, /- Roller door: 96 × 58 × 3 mm/);
  assert.match(withDoor, /3\. Glue the roller door behind its opening/);
  assert.match(withDoor, /4\. Drop the roof on/);
  const shed = buildingLayout({ door: 'open', roof: 'gable', openings: [window('left', 90, { frame: true })] });
  const gable = kitNotes('Shed', shed.building, shed.parts, {});
  assert.doesNotMatch(gable, /Roller door/);
  assert.match(gable, /3\. Glue each frame around its window or door/);
  assert.match(gable, /4\. Lay the two roof panels on the walls so they meet at the ridge/);
  assert.match(gable, /each roof panel lies on its underside/);
});

test('wall and roof textures keep every part one body, with no two parts in the same space', () => {
  for (const wallTexture of ['brick', 'block', 'crack', 'metal'])
    for (const [roof, roofTexture] of [['flat', 'plain'], ['gable', 'tile'], ['slope', 'metal']])
      withParts(
        { wallTexture, roof, roofTexture, openings: [window('left', 60, { frame: true }), door('right', 120)] },
        (parts) => {
          const label = wallTexture + ' / ' + roof + ' ' + roofTexture;
          for (const p of parts) {
            assert.equal(p.solid.status(), 'NoError', p.name + ' ' + label);
            assert.equal(p.solid.decompose().length, 1, p.name + ' is one body: ' + label);
          }
          for (let i = 0; i < parts.length; i++)
            for (let j = i + 1; j < parts.length; j++) {
              const both = parts[i].solid.intersect(parts[j].solid);
              assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap: ' + label);
              both.delete();
            }
        },
      );
});

test('joints are cut into the outside face only, as deep as set, and keep clear of openings and frames', () => {
  const settings = { roof: 'gable', roofTexture: 'tile', openings: [window('left', 60, { frame: true }), door('right', 120)] };
  const volumes = (extra) =>
    withParts({ ...settings, ...extra }, (parts) => Object.fromEntries(parts.map((p) => [p.id, p.solid.volume()])));
  const plain = volumes({ roofTexture: 'plain' }),
    bricks = volumes({ wallTexture: 'brick' });
  for (const w of ['front', 'back', 'left', 'right']) assert.ok(bricks[w] < plain[w] - 50, w + ' wall has joints');
  assert.ok(bricks['roof-left'] < plain['roof-left'] - 50, 'the roof has tiles');
  withParts({ ...settings, wallTexture: 'brick', textureDepth: 0.8 }, (_, part) => {
    // The inside of the left wall, from 1 mm in, is whole.
    const wall = part('left').solid;
    const inside = wall.trimByPlane([1, 0, 0], 1);
    withParts({ ...settings, roofTexture: 'plain' }, (__, plainPart) => {
      const whole = plainPart('left').solid.trimByPlane([1, 0, 0], 1);
      assert.ok(near(inside.volume(), whole.volume(), 0.01), 'inside of the wall untouched');
      whole.delete();
    });
    inside.delete();
    // Nothing is cut deeper than the joint depth.
    const deep = wall.trimByPlane([1, 0, 0], 0.8 + 0.01);
    withParts({ ...settings, roofTexture: 'plain' }, (__, plainPart) => {
      const whole = plainPart('left').solid.trimByPlane([1, 0, 0], 0.8 + 0.01);
      assert.ok(near(deep.volume(), whole.volume(), 0.01));
      whole.delete();
    });
    deep.delete();
    // Around the framed window the face is plain: under the frame and 1 mm beyond.
    const u0 = 60 - 20 - KIT.trim - 1,
      u1 = 60 + 20 + KIT.trim + 1;
    const around = wasm.Manifold.cube([0.8, u1 - u0, 30 + 2 * KIT.trim + 2]).translate([0, 180 - u1, 10 + 25 - KIT.trim - 1]);
    const left = wall.intersect(around);
    withParts({ ...settings, roofTexture: 'plain' }, (__, plainPart) => {
      const whole = plainPart('left').solid.intersect(around);
      assert.ok(near(left.volume(), whole.volume(), 0.01), 'no joints around the window');
      whole.delete();
    });
    left.delete();
    around.delete();
    // The underside of a tiled roof panel is whole.
    const panel = part('roof-left');
    const printed = printPose(panel);
    const under = printed.trimByPlane([0, 0, -1], -(KIT.roof - 0.8 - 0.05));
    withParts({ ...settings, roofTexture: 'plain' }, (__, plainPart) => {
      const plainPrinted = printPose(plainPart('roof-left'));
      const whole = plainPrinted.trimByPlane([0, 0, -1], -(KIT.roof - 0.8 - 0.05));
      assert.ok(near(under.volume(), whole.volume(), 0.5), 'roof underside untouched: ' + under.volume() + ' vs ' + whole.volume());
      whole.delete();
      plainPrinted.delete();
    });
    under.delete();
    printed.delete();
  });
});

test('cracks come out the same every time; texture settings are checked', () => {
  const tris = () => withParts({ wallTexture: 'crack' }, (_, part) => part('left').solid.numTri());
  assert.equal(tris(), tris());
  assert.throws(() => validateBuilding({ wallTexture: 'marble' }), /Choose a wall texture/);
  assert.throws(() => validateBuilding({ roofTexture: 'thatch' }), /Choose a roof texture/);
  assert.throws(() => validateBuilding({ textureScale: 20 }), /Texture size must be between 50 and 200 %/);
  assert.throws(() => validateBuilding({ textureDepth: 2 }), /Joint depth must be between 0.3 and 1 mm/);
  assert.throws(() => validateBuilding({ textureJoint: 0.1 }), /Joint width must be between 0.4 and 1.5 mm/);
});

const SMALL = { width: 150, depth: 150, margin: 0 };
test('a building that fits the plate is not cut; a 200 mm garage on a 150 mm plate is', () => {
  const none = buildingCuts({}, { width: 200, depth: 200 });
  assert.ok(Object.values(none).every((p) => p.cuts.length === 0));
  const big = buildingCuts({ width: 200, depth: 200 }, SMALL);
  for (const key of ['front', 'back', 'left', 'right', 'baseX', 'baseY', 'roofX', 'roofY']) assert.equal(big[key].cuts.length, 1, key);
  // A two-sided roof is only cut along its ridge: each panel is narrow.
  const gable = buildingCuts({ width: 200, depth: 200, roof: 'gable', ridge: 'depth' }, SMALL);
  assert.deepEqual([gable.roofX.cuts.length, gable.roofY.cuts.length], [0, 1]);
  // The front wall may be cut through the garage door, not along its sides.
  const [lo, hi] = big.front.ranges[0];
  assert.ok(lo <= 100 && hi >= 100);
  assert.ok(big.front.forbidden.some(([a, b]) => a < 55 && b > 55), 'the side of the door is kept clear');
});

test('every piece fits the plate, is one body, and no two pieces take the same space', () => {
  for (const settings of [
    { width: 200, depth: 200 },
    { width: 200, depth: 200, roof: 'gable', wallTexture: 'brick', roofTexture: 'tile' },
    { width: 210, depth: 330, wallTexture: 'block', openings: [window('left', 100, { frame: true }), door('right', 165)] },
  ]) {
    const parts = buildGarage(wasm, settings, SMALL);
    try {
      const label = JSON.stringify(settings);
      for (const p of parts) {
        assert.ok(fitsPlate(printSize(p), SMALL), p.name + ' fits: ' + printSize(p) + ' ' + label);
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
      // Cutting loses only the play around the tabs.
      const whole = buildGarage(wasm, settings);
      const volume = (list, role) => list.filter((p) => p.role === role).reduce((v, p) => v + p.solid.volume(), 0);
      for (const role of ['wall', 'buildingBase', 'roof']) {
        const lost = volume(whole, role) - volume(parts, role);
        assert.ok(lost >= 0 && lost < volume(whole, role) * 0.01, role + ' lost ' + lost + ' ' + label);
      }
      freeAll(whole);
    } finally {
      freeAll(parts);
    }
  }
});

test('pieces join with dovetail tabs, or step along the bricks; a cut can be moved within its range', () => {
  withParts({ width: 200, depth: 200, cuts: { front: [100] } }, (_, part) => {
    // The front wall is cut through its door: the left piece reaches over the
    // cut with its tab in the lintel above the door.
    const left = part('front-1').solid.boundingBox(),
      right = part('front-2').solid.boundingBox();
    assert.ok(left.max[0] > 100 + 4 && left.max[0] < 100 + 5.2, 'tab reaches 5 mm: ' + left.max[0]);
    // The other piece starts at the cut, plus the play around the tab.
    assert.ok(near(right.min[0], 100.15, 0.02), 'second piece starts at ' + right.min[0]);
  }, SMALL);
  // Bricks: the seam steps along the joints, half a brick either way.
  withParts({ width: 200, depth: 200, wallTexture: 'brick', cuts: { left: [100] } }, (_, part) => {
    const a = part('left-1').solid.boundingBox(),
      b = part('left-2').solid.boundingBox();
    // Along the left wall u runs from the back: piece 1 lies at the back (high
    // y). The joints nearest a cut at 100 mm are at 100 and 104 mm in turn, so
    // the seam steps half a brick (4 mm) from course to course.
    assert.ok(near(a.min[1], 200 - 104, 0.05), 'piece 1 reaches the joint at 104 mm: ' + a.min[1]);
    assert.ok(near(b.max[1], 200 - 100 - 0.15, 0.05), 'piece 2 stops at the joint at 100 mm: ' + b.max[1]);
  }, SMALL);
  assert.throws(() => buildingCuts({ width: 200, depth: 200, cuts: { back: [20] } }, SMALL), /Back wall: cut 1 at 20 mm leaves a piece that does not fit the plate. Put it between 5\d(\.\d)? and 1\d\d(\.\d)? mm/);
  assert.throws(() => buildingCuts({ width: 200, depth: 200, cuts: { front: [55] } }, SMALL), /Front wall: cut 1 at 55 mm runs along the side of a window, a door or a frame/);
  assert.throws(() => validateBuilding({ cuts: { chimney: [3] } }), /cut for an unknown part: chimney/);
  // A moved cut is kept; one for a different number of pieces is spread evenly again.
  assert.deepEqual(buildingCuts({ width: 200, depth: 200, cuts: { back: [80] } }, SMALL).back.cuts, [80]);
  assert.deepEqual(buildingCuts({ width: 200, depth: 200, cuts: { back: [60, 120] } }, SMALL).back.cuts, [100]);
});

test('the kit notes tell to join the pieces of a cut part first', async () => {
  const { kitNotes } = await import('../src/building-kit.js');
  const b = validateBuilding({ width: 200, depth: 200 });
  const notes = kitNotes('Big garage', b, [{ id: 'front-1', name: 'Front wall 1 of 2' }, { id: 'front-2', name: 'Front wall 2 of 2' }], {});
  assert.match(notes, /1\. Join the pieces of each cut part first/);
  assert.doesNotMatch(kitNotes('Garage', b, [{ id: 'front', name: 'Front wall' }], {}), /Join the pieces/);
});

/* ---------- Storeys, and cuts across the height ---------- */

const STOREYS = {
  roof: 'gable',
  upper: [
    { width: 100, depth: 120, x: 10, y: 30, wallTexture: 'brick', openings: [window('front', 50, { frame: true, sill: 15 }), door('back', 30)] },
    { width: 80, depth: 80, x: 10, y: 20, openings: [window('left', 40, { sill: 15 })] },
  ],
};

test('a storey above has its own size, place, height, walls and openings, and stays on the one below', () => {
  const b = validateBuilding({ upper: [{}] });
  assert.deepEqual([b.upper[0].width, b.upper[0].depth, b.upper[0].height], [120, 180, 65], 'a new storey covers the one below');
  const { parts, storeys } = buildingLayout(STOREYS);
  assert.deepEqual(storeys.map((s) => [s.n, s.ox, s.oy, s.floor, s.eave]), [[1, 0, 0, 10, 85], [2, 10, 30, 89, 154], [3, 20, 50, 158, 223]]);
  const ids = parts.map((p) => p.id);
  for (const id of ['base', 'front', 'floor2', 'front2', 'floor3', 'right3', 'roof-left', 'frame2-1']) assert.ok(ids.includes(id), id);
  assert.equal(parts.find((p) => p.id === 'front2').name, 'Front wall, storey 2');
  assert.equal(parts.find((p) => p.id === 'front').name, 'Front wall, ground floor');
  assert.equal(parts.find((p) => p.id === 'frame2-1').name, 'Front window frame, storey 2');
  assert.throws(() => validateBuilding({ upper: [{ width: 100, x: 30 }] }), /Storey 2 reaches past the storey below/);
  assert.throws(() => validateBuilding({ upper: [{ width: 100 }, { width: 110 }] }), /Storey 3: Width must be between 60 and 100 mm/);
  assert.throws(() => validateBuilding({ upper: [{}, {}, {}] }), /at most 2 storeys above/);
  assert.throws(() => validateBuilding({ upper: [{ chimney: 1 }] }), /Storey 2 has an unknown setting: chimney/);
  assert.throws(() => validateBuilding({ upper: [{ wallTexture: 'marble' }] }), /wall texture from the list for storey 2/);
  // Openings are checked against their own storey: its height, its walls.
  assert.throws(() => validateBuilding({ upper: [{ height: 40, openings: [window('front', 60)] }] }), /front window, storey 2 reaches too high: .* at most 34 mm/);
  assert.throws(() => validateBuilding({ upper: [{ width: 70, openings: [window('front', 25)] }] }), /front window, storey 2 reaches into a corner/);
  // The garage door is on the ground floor only: a window above it is fine.
  assert.doesNotThrow(() => validateBuilding({ upper: [{ openings: [window('front', 60)] }] }));
});

test('storeys are one body each and take no space of another; each stands in the groove of its floor', () => {
  for (const settings of [STOREYS, { ...STOREYS, roof: 'flat', wallTexture: 'block' }, { roof: 'slope', upper: [{ x: 0, y: 0, height: 40 }] }])
    withParts(settings, (parts, part) => {
      const label = JSON.stringify(settings).slice(0, 60);
      for (const p of parts) assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap by ' + both.volume() + ' ' + label);
          both.delete();
        }
      const floor = part('floor2').solid.boundingBox();
      const wall = part('front2').solid.boundingBox();
      // The floor covers the storey below, a lip under it; the walls above stand 2 mm into its top.
      assert.ok(near(floor.max[2], 89) && near(floor.min[2], 82), 'floor ' + floor.min[2] + '–' + floor.max[2]);
      assert.ok(near(wall.min[2], 89 - KIT.groove), 'wall stands in the groove: ' + wall.min[2]);
      assert.ok(near(floor.min[0], 0) && near(floor.max[0], 120));
    });
  // The roof covers the top storey, with its overhangs.
  withParts(STOREYS, (_, part) => {
    const l = part('roof-left').solid.boundingBox(),
      r = part('roof-right').solid.boundingBox();
    assert.ok(near(l.min[0], 20 - 3, 0.05) && near(r.max[0], 100 + 3, 0.05), 'roof across the top storey: ' + l.min[0] + ' ' + r.max[0]);
    assert.ok(near(l.min[1], 50 - 3, 0.05) && near(l.max[1], 130 + 3, 0.05));
  });
});

test('a wall taller than the plate is cut across its height too; bricks along a course', () => {
  const plan = buildingCuts({ height: 160 }, SMALL);
  for (const w of ['front', 'back', 'left', 'right']) assert.equal(plan[w + 'Z'].cuts.length, 1, w + 'Z');
  // 180 mm side walls are cut along too; the 120 mm front lies along the plate.
  assert.deepEqual([plan.front.cuts.length, plan.left.cuts.length], [0, 1]);
  assert.equal(buildingCuts({}, SMALL).frontZ.cuts.length, 0, 'a low wall is not cut across');
  const settings = { height: 160, wallTexture: 'brick', openings: [window('left', 60, { sill: 90 })] };
  const parts = buildGarage(wasm, settings, SMALL);
  try {
    for (const p of parts) {
      assert.ok(fitsPlate(printSize(p), SMALL), p.name + ' fits: ' + printSize(p));
      assert.equal(p.solid.decompose().length, 1, p.name + ' is one body');
    }
    const whole = buildGarage(wasm, settings);
    const volume = (list) => list.filter((p) => p.role === 'wall').reduce((v, p) => v + p.solid.volume(), 0);
    const lost = volume(whole) - volume(parts);
    assert.ok(lost >= 0 && lost < volume(whole) * 0.01, 'walls lost ' + lost);
    freeAll(whole);
    // The seam across the front wall runs along a course line of the bricks.
    const low = parts.find((p) => p.id === 'front-1').solid.boundingBox();
    const course = 3.4;
    const rows = (low.max[2] - 10) / course;
    assert.ok(Math.abs(rows - Math.round(rows)) < 0.05, 'seam on a course: ' + low.max[2]);
  } finally {
    freeAll(parts);
  }
  // A plain wall's seam across its height has tabs, and a cut can be moved.
  withParts({ height: 160, cuts: { backZ: [90] } }, (_, part) => {
    const low = part('back-1').solid.boundingBox(),
      high = part('back-2').solid.boundingBox();
    assert.ok(low.max[2] > 8 + 90 + 4 && low.max[2] < 8 + 90 + 5.2, 'tab reaches up: ' + low.max[2]);
    assert.ok(near(high.min[2], 8 + 90 + 0.15, 0.02), 'next band starts at the cut: ' + high.min[2]);
  }, SMALL);
  assert.throws(() => buildingCuts({ height: 160, cuts: { backZ: [5] } }, SMALL), /Back wall, across its height: cut 1 at 5 mm/);
  // A block seam moves up to half a block onto its course, so it keeps that much more from an opening.
  const high = { height: 160, openings: [window('back', 60, { sill: 70 })], cuts: { backZ: [108] } };
  assert.doesNotThrow(() => buildingCuts(high, SMALL));
  assert.throws(() => buildingCuts({ ...high, wallTexture: 'block' }, SMALL), /runs along the side of a window/);
});

test('upper storeys are cut to fit as well, and the kit notes lay the floors', async () => {
  const big = { width: 200, depth: 200, upper: [{ height: 60 }] };
  const plan = buildingCuts(big, SMALL);
  for (const key of ['front2', 'left2', 'floor2X', 'floor2Y']) assert.equal(plan[key].cuts.length, 1, key);
  const { cutLabel } = await import('../src/geometry/building-cuts.js');
  assert.equal(cutLabel('left3Z'), 'Left wall, storey 3, across its height');
  assert.equal(cutLabel('floor2Y'), 'Floor of storey 2, front to back');
  assert.equal(cutLabel('front'), 'Front wall');
  const { kitNotes } = await import('../src/building-kit.js');
  const b = validateBuilding(STOREYS);
  const notes = kitNotes('Workshop', b, buildingLayout(b).parts, {});
  assert.match(notes, /Lay the floor of storey 2 on the walls below/);
  assert.match(notes, /Lay the floor of storey 3/);
  assert.match(notes, /3 storeys: storey 2 100 × 120 mm/);
  assert.match(notes, /The base and the floors print upside down; each roof panel/);
});
