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
  assert.deepEqual(parts.map((p) => p.id), ['base', 'front', 'back', 'left', 'right', 'roof', 'roof-frame', 'door', 'brace-fl', 'brace-fr', 'brace-bl', 'brace-br']);
  assert.equal(buildingLayout({ braces: false }).parts.length, 8, 'braces can be left out');
  assert.equal(buildingLayout({ roofLip: 'none' }).parts.filter((p) => p.role === 'lip').length, 0, 'and the roof frame');
  assert.throws(() => validateBuilding({ roofLip: 'glued' }), /frame under the roof, or none/);
  assert.throws(() => validateBuilding({ braces: 'yes' }), /corners get braces/);
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
    assert.deepEqual(parts.filter((p) => !fitsPlate(printSize(p), plate)).map((p) => p.id), ['base', 'left', 'right', 'roof', 'roof-frame']);
  });
});

test('settings are checked, and a door or window has to fit its wall', () => {
  assert.throws(() => validateBuilding({ roofColour: 'red' }), /unknown setting: roofColour/);
  assert.throws(() => validateBuilding({ width: 20 }), /Width must be between 60 and 1500 mm/);
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

test('walls print flat outside face up; base, roof and roof panels upside down, lip up; a brace on one leg', () => {
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
        // A roof prints the right way up, as thick as the roof: its frame is a part of its own.
        if (part.role === 'roof') assert.ok(near(max[2], KIT.roof, 0.01), part.name + ' lies on its underside: ' + max[2]);
        if (part.role === 'lip') {
          // The frame lies flat, its tabs standing up.
          // Under a sloped roof it is lipDepth deep straight down, a little less square to the panel.
          assert.ok(max[2] > KIT.tabRoof + 2 && max[2] < KIT.lipDepth + KIT.tabRoof + 0.05, part.name + ' with its tabs: ' + max[2]);
          const bottom = printed.trimByPlane([0, 0, -1], -0.2),
            topSlice = printed.trimByPlane([0, 0, 1], max[2] - 0.2);
          assert.ok(bottom.volume() > 5 * topSlice.volume(), part.name + ' lies flat, tabs up');
          bottom.delete();
          topSlice.delete();
        }
        if (part.role === 'brace') assert.ok(near(max[2], KIT.braceLeg, 0.01), part.name + ' lies on a leg: ' + max[2]);
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
  assert.match(withDoor, /3\. Glue a corner brace into each inside corner/);
  assert.match(withDoor, /4\. Glue the roller door behind its opening/);
  assert.match(withDoor, /5\. Push the roof frame onto the underside of the roof, each tab into its pocket/);
  assert.match(withDoor, /6\. Drop the roof on: its frame fits inside the walls/);
  const shed = buildingLayout({ door: 'open', roof: 'gable', openings: [window('left', 90, { frame: true })] });
  const gable = kitNotes('Shed', shed.building, shed.parts, {});
  assert.doesNotMatch(gable, /Roller door/);
  assert.match(gable, /4\. Glue each frame around its window or door/);
  assert.match(gable, /5\. Push the roof frames onto the underside of the roof/);
  assert.match(gable, /6\. Lay the two roof panels on the walls so they meet at the ridge, their frames inside the walls/);
  assert.match(gable, /The base prints upside down\. The roof panels and their frames print the right way up: a roof on its underside, its texture on top, a frame flat with its tabs up\. A corner brace lies on one leg\./);
});

test('wall and roof textures keep every part one body, with no two parts in the same space', () => {
  for (const wallTexture of ['brick', 'block', 'crack', 'metal', 'planks', 'boards'])
    for (const [roof, roofTexture] of [['flat', 'plain'], ['gable', 'tile'], ['slope', 'metal'], ['gable', 'shingle']])
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
    // The underside of a tiled roof panel is as a plain one: it prints top up,
    // so everything below the depth of the joints is the same.
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
  assert.throws(() => validateBuilding({ upper: [{}, {}, {}, {}] }), /at most 3 storeys above/);
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
      assert.ok(near(floor.max[2], 89) && near(floor.min[2], 85), 'floor ' + floor.min[2] + '–' + floor.max[2]);
      // Its frame hangs under it inside the walls, the tabs up through the floor, flush with its top.
      const frame = part('floor2-frame').solid.boundingBox();
      assert.ok(near(frame.min[2], 85 - KIT.lipDepth) && near(frame.max[2], 89), 'frame ' + frame.min[2] + '–' + frame.max[2]);
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
  assert.match(notes, /Push the floor frame of storey 2 onto the underside of its floor, each tab up into its slot/);
  assert.match(notes, /floor frame of storey 3/);
  assert.match(notes, /3 storeys: storey 2 100 × 120 mm/);
  assert.match(notes, /The roof panels, the floors and their frames print the right way up/);
});

/* ---------- The exploded view ---------- */

test('exploded, every part comes off the way it goes on, and no two parts take the same space', async () => {
  const { APART } = await import('../src/geometry/building.js');
  const moved = (p) => {
    const s = p.solid.translate(p.apart);
    return s;
  };
  for (const settings of [STOREYS, { ...STOREYS, roof: 'flat', upper: [STOREYS.upper[0]] }, { width: 200, depth: 200, roof: 'gable', wallTexture: 'brick' }])
    withParts(
      settings,
      (parts, part) => {
        const label = JSON.stringify(settings).slice(0, 60);
        for (const p of parts) assert.ok(Array.isArray(p.apart) && p.apart.length === 3, p.name + ' has its way apart ' + label);
        // Fully apart, nothing touches: every groove, lip and tab is in view.
        const apart = parts.map(moved);
        try {
          for (let i = 0; i < parts.length; i++)
            for (let j = i + 1; j < parts.length; j++) {
              const both = apart[i].intersect(apart[j]);
              assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap apart ' + label);
              both.delete();
            }
        } finally {
          apart.forEach((s) => s.delete());
        }
        for (const p of parts.filter((q) => q.role === 'buildingBase')) assert.equal(p.apart[2], 0, 'the base stays on the table');
      },
      settings.width === 200 ? SMALL : null,
    );
  withParts(STOREYS, (_, part) => {
    // A wall moves out and up out of its groove; the next storey lifts above.
    assert.deepEqual(part('front').apart, [0, -APART.out, APART.up]);
    assert.deepEqual(part('left2').apart, [-APART.out, 0, APART.up + APART.storey]);
    // A floor hangs between the walls below and the walls above.
    const floor = part('floor2').apart[2];
    assert.ok(floor > part('front').apart[2] && floor < part('front2').apart[2]);
    // The roof comes off the top storey, its panels part at the ridge; the door slides in.
    assert.ok(part('roof-left').apart[2] > part('front3').apart[2]);
    assert.ok(part('roof-left').apart[0] < 0 && part('roof-right').apart[0] > 0);
    assert.deepEqual(part('door').apart, [0, APART.door, 0]);
    // A frame comes off further than its wall.
    assert.ok(part('frame2-1').apart[1] < part('front2').apart[1]);
  });
  // The pieces of a cut part part at their seams.
  withParts({ width: 200, depth: 200 }, (_, part) => {
    assert.ok(part('front-1').apart[0] < 0 && part('front-2').apart[0] > 0, 'front pieces part along the wall');
    assert.equal(part('front-1').apart[1], -APART.out);
  }, SMALL);
});

/* ---------- A garage over a pit bay ---------- */

test('a garage over a pit bay leaves the track a clear way in, from the front to the back wall', () => {
  const over = { lane: { width: 80 }, door: 'open', doorWidth: 90 };
  assert.throws(() => validateBuilding({ ...over, door: 'roller' }), /open door/);
  assert.throws(() => validateBuilding({ ...over, doorWidth: 82 }), /door is narrower than the track through it: make it at least 84 mm/);
  assert.throws(() => validateBuilding({ ...over, lane: { width: 5 } }), /20 to 380 mm wide/);
  assert.throws(() => validateBuilding({ ...over, lane: { width: 80, side: 1 } }), /20 to 380 mm wide/);
  withParts(over, (parts, part) => {
    for (const p of parts) assert.equal(p.solid.decompose().length, 1, p.name + ' is one body');
    // Nothing stands where the track runs: from the front edge to the inside of
    // the back wall, as wide as the track, from the table up through the door.
    const way = wasm.Manifold.cube([80, 180 - KIT.wall - 1 + 3, 10 + 55 - 0.5]).translate([20, -3, 0]);
    for (const p of parts) {
      const both = p.solid.intersect(way);
      assert.ok(both.volume() < 0.01, p.name + ' stands in the way of the track: ' + both.volume());
      both.delete();
    }
    way.delete();
    // The base still carries every wall, and is closed along the track.
    const base = part('base').solid.boundingBox();
    assert.ok(near(base.min[0], -KIT.ledge) && near(base.max[1], 180 + KIT.ledge));
    assert.ok(part('front').solid.boundingBox().min[2] < 10, 'the front wall still stands in its groove beside the door');
  });
  // Cut to fit a small plate, an arm of the base is a piece of its own.
  withParts({ ...over, depth: 260 }, (parts) => {
    for (const p of parts) {
      assert.equal(p.solid.decompose().length, 1, p.name + ' is one body');
      assert.ok(fitsPlate(printSize(p), SMALL), p.name + ' fits');
    }
  }, SMALL);
});

/* ---------- Stronger joints ---------- */

test('a sloped or two-sided roof has a lip under it inside the walls, as a flat roof does', () => {
  for (const settings of [{ roof: 'slope', rises: 'back' }, { roof: 'gable', ridge: 'depth' }, { roof: 'gable', ridge: 'width', pitch: 40 }])
    withParts(settings, (parts) => {
      const panels = parts.filter((p) => p.role === 'roof');
      // Just inside the walls, a ring as deep as the lip: each panel reaches down into it.
      const W = 120,
        D = 180,
        lo = KIT.wall + KIT.play;
      const inside = wasm.Manifold.cube([W - 2 * lo, D - 2 * lo, 300]).translate([lo, lo, 10 + 75 - KIT.lipDepth]);
      const inner = wasm.Manifold.cube([W - 2 * lo - 2 * KIT.lip, D - 2 * lo - 2 * KIT.lip, 302]).translate([lo + KIT.lip, lo + KIT.lip, 10 + 75 - KIT.lipDepth - 1]);
      const ring = inside.subtract(inner);
      const lips = panels.reduce((v, p) => {
        const both = p.solid.intersect(ring);
        const n = both.volume();
        both.delete();
        return v + n;
      }, 0);
      // Round the inside of the walls, 2 mm wide and 3 mm deep under the roof: well over 1500 mm³.
      assert.ok(lips > 1500, 'lip under the roof ' + JSON.stringify(settings) + ': ' + lips);
      for (const s of [inside, inner, ring]) s.delete();
    });
});

test('a corner brace stands in each inside corner, against both walls, but not over a track or behind a roller door', () => {
  withParts({}, (parts, part) => {
    const braces = parts.filter((p) => p.role === 'brace');
    assert.equal(braces.length, 4);
    const fl = part('brace-fl').solid.boundingBox();
    const lo = KIT.wall + KIT.play;
    assert.ok(near(fl.min[0], lo) && near(fl.min[1], lo) && near(fl.min[2], 10), 'on the floor, against both walls: ' + fl.min);
    assert.ok(near(fl.max[0], lo + KIT.braceLeg) && near(fl.max[2], 10 + KIT.braceHeight), 'as tall as a brace gets: ' + fl.max);
    const br = part('brace-br').solid.boundingBox();
    assert.ok(near(br.max[0], 120 - lo) && near(br.max[1], 180 - lo));
  });
  // Low walls: a brace reaches up to just under the lip of the roof.
  withParts({ height: 40, doorHeight: 30 }, (_, part) => assert.ok(near(part('brace-fl').solid.boundingBox().max[2], 10 + 40 - KIT.lipDepth - 1)));
  // A roller door as wide as the wall allows: no brace where it stands.
  const wide = buildingLayout({ doorWidth: 102 }).parts.filter((p) => p.role === 'brace').map((p) => p.id);
  assert.deepEqual(wide, ['brace-bl', 'brace-br']);
  // Over a pit bay: the back corners only where the base is beside the track.
  const lane = buildingLayout({ lane: { width: 100 }, door: 'open', doorWidth: 104, width: 122 }).parts.filter((p) => p.role === 'brace').map((p) => p.id);
  assert.deepEqual(lane, ['brace-fl', 'brace-fr', 'brace-bl', 'brace-br'], 'the arms beside the track are wide enough');
  const narrow = buildingLayout({ lane: { width: 108 }, door: 'open', doorWidth: 112, width: 130 }).parts.filter((p) => p.role === 'brace').length;
  assert.equal(narrow, 4);
  // Every storey has its own.
  assert.equal(buildingLayout({ upper: [{}] }).parts.filter((p) => p.id.startsWith('brace2-')).length, 4);
});

/* ---------- Rooms ---------- */

test('rooms make the building: their sizes add up to its outside, each to the middle of a dividing wall', async () => {
  const { dividers, garageDoors } = await import('../src/geometry/building.js');
  const b = validateBuilding({ width: 60, rooms: { along: 'width', sizes: [120, 150] } });
  assert.equal(b.width, 270, 'the rooms set the width, outside to outside');
  assert.deepEqual(dividers(b), [120]);
  // A garage door in the middle of each room's inside.
  const doors = garageDoors(b);
  assert.deepEqual(doors.map((d) => [d.room, d.from, d.to]), [[1, 3, 118.5], [2, 121.5, 267]]);
  for (const d of doors) assert.ok(near(d.x + d.width / 2, (d.from + d.to) / 2));
  assert.equal(validateBuilding({ rooms: { along: 'depth', sizes: [100, 80, 60] } }).depth, 240);
  assert.throws(() => validateBuilding({ rooms: { along: 'width', sizes: [120] } }), /2 to 24 sizes/);
  assert.throws(() => validateBuilding({ rooms: { along: 'up', sizes: [120, 120] } }), /2 to 24 sizes/);
  assert.throws(() => validateBuilding({ rooms: { along: 'width', sizes: [120, 20] } }), /Room 2 must be between 40 and 400 mm/);
  assert.throws(() => validateBuilding({ rooms: { along: 'width', sizes: [400, 400, 400, 400] } }), /add up to 1600 mm, more than the 1500 mm/);
  assert.throws(() => validateBuilding({ rooms: { along: 'width', sizes: [80, 200] } }), /door is too wide for room 1: at most 63.5 mm/);
  assert.throws(() => validateBuilding({ rooms: { along: 'width', sizes: [120, 120] }, lane: { width: 80 }, door: 'open' }), /pit bay has one room/);
  // A window keeps wall beside a dividing wall, where it meets the outside wall.
  assert.throws(
    () => validateBuilding({ rooms: { along: 'depth', sizes: [100, 100] }, openings: [window('right', 80)] }),
    /right window is too close to the dividing wall/,
  );
  assert.doesNotThrow(() => validateBuilding({ rooms: { along: 'depth', sizes: [100, 100] }, openings: [window('right', 50)] }));
  const { parts } = buildingLayout({ rooms: { along: 'width', sizes: [120, 120, 120] } });
  assert.deepEqual(parts.filter((p) => p.role === 'divider').map((p) => p.name), ['Dividing wall 1', 'Dividing wall 2']);
  assert.deepEqual(parts.filter((p) => p.role === 'door').map((p) => p.id), ['door1', 'door2', 'door3']);
});

test('a dividing wall stands in its groove in the base, up to the ceiling, its ends clear of the lip', () => {
  for (const settings of [
    { rooms: { along: 'width', sizes: [120, 150] } },
    { rooms: { along: 'depth', sizes: [100, 80] }, roof: 'gable', ridge: 'width' },
    { rooms: { along: 'width', sizes: [100, 100] }, doorWidth: 70, roof: 'slope', rises: 'left', wallTexture: 'brick', upper: [{ width: 150, x: 20, height: 50 }] },
    { rooms: { along: 'width', sizes: [100, 110] }, doorWidth: 70, roof: 'gable', ridge: 'depth', upper: [{}] },
  ])
    withParts(settings, (parts, part) => {
      const label = JSON.stringify(settings).slice(0, 70);
      for (const p of parts) assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap by ' + both.volume() + ' ' + label);
          both.delete();
        }
      const divider = part('divide1').solid.boundingBox();
      assert.ok(near(divider.min[2], 10 - KIT.groove), 'stands in the groove: ' + divider.min[2]);
      // The base under it has the groove: nothing of the base where its foot stands.
      const foot = part('divide1').solid.trimByPlane([0, 0, -1], -10);
      const under = foot.intersect(part('base').solid);
      assert.ok(under.volume() < 0.01, 'the base leaves room for its foot ' + label);
      foot.delete();
      under.delete();
    });
  // Under a flat roof it reaches the ceiling in the middle, and is notched at its ends for the lip.
  withParts({ rooms: { along: 'width', sizes: [120, 150] } }, (_, part) => {
    const d = part('divide1').solid;
    const box = d.boundingBox();
    assert.ok(near(box.max[2], 85), 'up to the roof: ' + box.max[2]);
    assert.ok(near(box.min[0], 120 - KIT.wall / 2) && near(box.max[0], 120 + KIT.wall / 2), 'centred on 120 mm');
    const end = wasm.Manifold.cube([10, KIT.lip, KIT.lipDepth]).translate([115, KIT.wall + KIT.play, 85 - KIT.lipDepth]);
    const at = d.intersect(end);
    assert.ok(at.volume() < 0.01, 'notched at its end under the lip');
    at.delete();
    end.delete();
    // Each room has its roller door, behind its own opening.
    assert.ok(part('door1').solid.boundingBox().max[0] < 120 && part('door2').solid.boundingBox().min[0] > 120);
  });
});

test('a dividing wall is cut to fit the plate like the walls, and the notes stand it in its groove', async () => {
  const settings = { rooms: { along: 'width', sizes: [110, 110] }, depth: 260 };
  const plan = buildingCuts(settings, SMALL);
  assert.equal(plan.divide1.cuts.length, 1);
  withParts(settings, (parts) => {
    const pieces = parts.filter((p) => p.role === 'divider');
    assert.equal(pieces.length, 2);
    for (const p of pieces) assert.ok(fitsPlate(printSize(p), SMALL), p.name + ' fits: ' + printSize(p));
  }, SMALL);
  const { cutLabel } = await import('../src/geometry/building-cuts.js');
  assert.equal(cutLabel('divide2Z'), 'Dividing wall 2, across its height');
  const { kitNotes } = await import('../src/building-kit.js');
  const b = validateBuilding({ rooms: { along: 'width', sizes: [120, 150] } });
  const notes = kitNotes('Two bays', b, buildingLayout(b).parts, {});
  assert.match(notes, /2 rooms side by side: 120 \+ 150 mm, outside to outside/);
  assert.match(notes, /Stand each dividing wall in its groove in the base/);
  assert.match(notes, /Glue each roller door behind its opening/);
});

test('a frame under the roof or a floor is held by its tabs: in pockets under the roof, through slots in a floor', () => {
  const pocket = (KIT.tabLength + 2 * KIT.tabPlay) * (KIT.tabThick + 2 * KIT.tabPlay) * (KIT.tabRoof + 0.2);
  withParts({}, (_, part) => {
    withParts({ roofLip: 'none' }, (__, bare) => {
      // Eight tabs, two a side, each in a pocket that does not reach the top of the roof.
      const taken = bare('roof').solid.volume() - part('roof').solid.volume();
      assert.ok(near(taken, 8 * pocket, 0.5), 'eight pockets: ' + taken);
      assert.ok(near(part('roof').solid.boundingBox().max[2], bare('roof').solid.boundingBox().max[2]));
    });
  });
  // A floor: its slots go right through, clear of the groove for the walls above, even where those stand flush.
  withParts({ upper: [{}] }, (parts, part) => {
    const floor = part('floor2').solid,
      frame = part('floor2-frame').solid;
    const both = floor.intersect(frame);
    assert.ok(both.volume() < 0.01, 'the tabs sit in their slots');
    both.delete();
    // The groove for the walls above is whole: the upper walls stand in it without touching a slot.
    const walls = parts.filter((p) => p.id.endsWith('2') && p.role === 'wall');
    for (const w of walls) {
      const hit = w.solid.intersect(frame);
      assert.ok(hit.volume() < 0.01, w.name + ' clear of the tabs');
      hit.delete();
    }
  });
});

test('wood: planks and shingles step from row to row, the lower edge of each proud; boards stand upright', async () => {
  const { lappedRows, jointPolygons, grainPolygons, DRAWN } = await import('../src/geometry/building-texture.js');
  const settings = { textureScale: 100, textureJoint: 0.6, textureDepth: 0.5 };
  // Each row of planks is cut from nothing at its lower edge to the depth set at its top.
  const rows = lappedRows('planks', [10, 30], settings, 10);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], [[10, 0], [14, 0], [14, 1.5], [10, 1]]);
  // The ends of the planks fall at random but the same every time, and boards stand at their width.
  const ends = jointPolygons('planks', [0, 200], [10, 30], settings, 11, 10);
  assert.deepEqual(ends, jointPolygons('planks', [0, 200], [10, 30], settings, 11, 10));
  assert.ok(ends.length >= 5 * 3 && ends.length <= 5 * 8, 'a few plank ends a row: ' + ends.length);
  assert.equal(jointPolygons('boards', [0, 60], [0, 50], settings).length, 60 / DRAWN.boards.width - 1);
  assert.ok(grainPolygons('planks', [0, 100], [0, 50], settings).length > 10);
  assert.equal(grainPolygons('brick', [0, 100], [0, 50], settings).length, 0, 'only wood has a grain');
  // On the wall: the face steps out at the lower edge of each plank; the step is as deep as set.
  withParts({ wallTexture: 'planks' }, (_, part) => {
    withParts({}, (__, plain) => {
      const probe = (solid, y, z) => {
        // How far in the outside face of the left wall is, at height z, in mm.
        const slice = solid.intersect(wasm.Manifold.cube([KIT.wall, 0.2, 0.05]).translate([0, y, z]));
        const x = slice.isEmpty() ? null : slice.boundingBox().min[0];
        slice.delete();
        return x;
      };
      const wall = part('left').solid;
      // Just above a row's lower edge the face is whole; just under the next row it is cut 0.5 mm in.
      const z = 10 + 4 * 3;
      assert.ok(near(probe(wall, 47, z + 0.1), 0, 0.03), 'proud at its lower edge: ' + probe(wall, 47, z + 0.1));
      assert.ok(near(probe(wall, 47, z + 3.9), 0.5, 0.05), 'in at its top: ' + probe(wall, 47, z + 3.9));
      assert.ok(near(probe(plain('left').solid, 47, z + 3.9), 0, 0.01));
    });
  });
  // A shingled roof keeps its pockets well under the texture.
  withParts({ roof: 'gable', roofTexture: 'shingle', textureDepth: 1 }, (parts) => {
    for (const p of parts.filter((q) => q.role === 'roof')) assert.equal(p.solid.decompose().length, 1, p.name + ' is one body');
  });
});

test('the standard buildings are good buildings: each builds, one body a part, and fits the plate once cut', async () => {
  const { BUILDING_PRESETS, pitRow } = await import('../src/building-presets.js');
  const plate = { width: 200, depth: 200, margin: 0 };
  assert.deepEqual(BUILDING_PRESETS.map((p) => p.id), ['garage', 'pitrow', 'pit-modern', 'pit-low', 'pit-building', 'pit-building-low', 'pit-row-modern', 'pit-boxes', 'pit-boxes-low', 'tower', 'race-control', 'vip', 'marshal', 'marshal-low', 'marshal-shelter', 'marshal-tall', 'hut-brick', 'hut-first-aid', 'hut-large', 'hut-legs', 'hut-frames', 'post-box', 'hut-tower', 'billboard', 'hoarding', 'tyre-bridge', 'benches', 'stairs-switchback', 'flag-post', 'tower-pyramid', 'booth-column', 'camera-tower', 'scaffold-tower', 'press-tower', 'stall-container', 'stall-twin', 'stall-kiosk', 'stall-tickets', 'timing', 'container', 'classic', 'shed', 'stand', 'stand-covered', 'stand-raised', 'stand-mini', 'gantry-start', 'gantry-lattice', 'gantry-timber', 'gantry-half', 'footbridge', 'platform', 'platform-both', 'platform-plain', 'walkway', 'crosswalk-tower', 'walkway-towers', 'crosswalk', 'stand-curved']);
  for (const preset of [...BUILDING_PRESETS, { id: 'nine bays', building: pitRow(9) }])
    withParts(
      preset.building,
      (parts) => {
        for (const p of parts) {
          assert.equal(p.solid.decompose().length, 1, preset.id + ': ' + p.name + ' is one body');
          assert.ok(fitsPlate(printSize(p), plate), preset.id + ': ' + p.name + ' fits: ' + printSize(p));
        }
      },
      plate,
    );
  // A pit row as long as wanted: nine bays make a building 990 mm long, each with its door.
  const row = validateBuilding(pitRow(9));
  assert.equal(row.width, 990);
  assert.equal(buildingLayout(row).parts.filter((p) => p.role === 'door').length, 9);
  // Without a garage door, a building has only its own doors and windows.
  const hut = buildingLayout(BUILDING_PRESETS.find((p) => p.id === 'marshal').building);
  assert.equal(hut.parts.filter((p) => p.role === 'door').length, 0);
  assert.equal(validateBuilding({ door: 'none', doorHeight: 190 }).door, 'none', 'its garage door sizes do not matter');
});

/* ---------- The modern pit building ---------- */

test('a modern pit building: panel doors, a balcony over them with its railing, bay numbers, a roof terrace', async () => {
  const { modernPits } = await import('../src/building-presets.js');
  const { railingRuns, railingPieces, plaquePlaces, garageDoors, storeyStack } = await import('../src/geometry/building.js');
  const b = validateBuilding(modernPits(3, 160));
  const plate = { width: 200, depth: 200, margin: 0 };
  // Railings run along the balcony's front and back along its sides, and round the roof.
  const runs = railingRuns(b, storeyStack(b));
  assert.deepEqual(runs.map((r) => r.id), ['railing2-front', 'railing2-left', 'railing2-right', 'roofrail-front', 'roofrail-back', 'roofrail-left', 'roofrail-right']);
  // A run longer than the plate comes in pieces that fit it.
  const pieces = railingPieces(runs[0], plate);
  assert.equal(pieces.length, 2);
  for (const p of pieces) assert.ok(p.b - p.a <= 196);
  // The numbers hang under the front edge of the balcony, one over each door.
  const plaques = plaquePlaces(b, garageDoors(b), storeyStack(b)[0]);
  assert.deepEqual(plaques.map((q) => q.number), [1, 2, 3]);
  assert.ok(near(plaques[0].y, -25 - KIT.plaque[2]) && near(plaques[0].z + KIT.plaque[1], 85 + KIT.slab), 'hung under the balcony edge');
  assert.throws(() => validateBuilding({ upper: [{ balcony: 50 }] }), /balcony must reach out 0 to 40 mm/);
  assert.throws(() => validateBuilding({ firstNumber: 99 }), /first bay number/);
  withParts(b, (parts, part) => {
    // The floor reaches out 25 mm over the doors.
    assert.ok(near(parts.filter((p) => p.id.startsWith('floor2') && p.role === 'floor').reduce((m, p) => Math.min(m, p.solid.boundingBox().min[1]), 0), -25));
    // A railing panel: as tall as set, standing in its pockets on the deck, as thick as it prints.
    const rail = part('railing2-left').solid.boundingBox();
    assert.ok(near(rail.max[2], 85 + KIT.slab + KIT.railHeight) && near(rail.min[2], 85 + KIT.slab - KIT.railTab));
    assert.ok(near(printSize(part('railing2-left'))[2], KIT.railThick), 'it lies flat to print');
    // The up-and-over door has its panels; every part is one body, no two in the same space.
    assert.match(part('door1').name, /Up-and-over door, room 1/);
    for (const p of parts) assert.equal(p.solid.decompose().length, 1, p.name + ' is one body');
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const both = parts[i].solid.intersect(parts[j].solid);
        assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap by ' + both.volume());
        both.delete();
      }
  }, plate);
  // Without a balcony the numbers go on the wall above the doors, where there is room.
  const plain = validateBuilding({ numbers: true, rooms: { along: 'width', sizes: [110, 110] }, doorWidth: 80 });
  const onWall = plaquePlaces(plain, garageDoors(plain), storeyStack(plain)[0]);
  assert.ok(onWall.length === 2 && near(onWall[0].y, -KIT.plaque[2]));
});
