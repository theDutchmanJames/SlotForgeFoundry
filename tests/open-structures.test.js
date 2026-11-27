// What a building leaves out (its roof, its walls), breaches in its walls,
// canopies on posts and stages for the cars: each checked, every kit
// printing clean, laid out as built, and its notes telling how it goes together.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage, buildingLayout, breachOutline, keptPart, validateBuilding } from '../src/geometry/building.js';
import { CANOPY, canopyFootprint, canopyPosts, validateCanopy } from '../src/geometry/canopy.js';
import { stageFootprint, validateStage } from '../src/geometry/stage.js';
import { shapeOf } from '../src/planner-buildings.js';
import { kitNotes } from '../src/building-kit.js';
import { checkKit, overAir } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const withParts = (b, fn) => {
  const parts = buildGarage(wasm, b, PLATE);
  try {
    return fn(parts);
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const ids = (parts) => parts.map((p) => p.id);
// The roof parts are left out of checkKit's over-air check: check them here.
const roofsFlat = (parts) => parts.filter((p) => /^roof/.test(p.id)).forEach((p) => assert.ok(overAir(p) <= 0.5, p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air'));
const ROOM = { width: 156, depth: 125, height: 100, door: 'none' };

test('a building leaves out its roof or walls: checked, and gone from the kit with their braces', () => {
  assert.throws(() => validateBuilding({ ...ROOM, leaveOut: ['floor'] }), /Leave out the roof or a wall/);
  assert.throws(() => validateBuilding({ ...ROOM, leaveOut: ['roof', 'roof'] }), /each once/);
  assert.throws(() => validateBuilding({ ...ROOM, leaveOut: ['front', 'back', 'left', 'right'] }), /Keep at least one wall/);
  assert.throws(() => validateBuilding({ ...ROOM, leaveOut: ['roof'], chimney: { x: 50, y: 50, width: 12, depth: 10, height: 15 } }), /nothing for a chimney/);
  assert.throws(() => validateBuilding({ ...ROOM, leaveOut: ['front'], openings: [{ wall: 'front', type: 'window', at: 78, width: 30, height: 30, sill: 30 }] }), /take its windows and doors off/);
  assert.throws(() => validateBuilding({ ...ROOM, door: 'roller', leaveOut: ['front'] }), /no garage door/);
  assert.equal(keptPart({ leaveOut: ['front'] }, 'front2-1'), false);
  assert.equal(keptPart({ leaveOut: ['front'] }, 'brace-fl'), false);
  assert.equal(keptPart({ leaveOut: ['front'] }, 'brace-bl'), true);
  assert.equal(keptPart({ leaveOut: ['front'] }, 'frame-1'), true);
  assert.equal(keptPart({ leaveOut: ['roof'] }, 'roof-frame-2'), false);
  const box = { ...ROOM, leaveOut: ['roof', 'front'], openings: [{ wall: 'back', type: 'window', at: 78, width: 40, height: 42, sill: 27 }] };
  withParts(box, (parts) => {
    checkKit(parts, PLATE);
    assert.deepEqual(ids(parts), ids(buildingLayout(box).parts));
    assert.ok(!parts.some((p) => /^(roof|front|brace-f)/.test(p.id)), ids(parts).join(' '));
    assert.ok(parts.some((p) => p.id === 'back') && parts.some((p) => p.id === 'brace-bl'));
  });
});

test('a breach comes down from the top of a wall of the top storey, its foot ragged, the roof left out', () => {
  const ruin = { width: 219, depth: 156, height: 97, door: 'none', leaveOut: ['roof'], upper: [{ height: 88, openings: [{ wall: 'front', type: 'window', at: 50, width: 40, height: 42, sill: 27 }] }] };
  assert.throws(() => validateBuilding({ ...ruin, leaveOut: [], damage: [{ wall: 'front', at: 150, width: 60, depth: 40 }] }), /leave the roof out first/);
  assert.throws(() => validateBuilding({ ...ruin, damage: [{ wall: 'front', at: 60, width: 60, depth: 50 }] }), /reaches into the front window/);
  assert.throws(() => validateBuilding({ ...ruin, damage: [{ wall: 'front', at: 150, width: 60, depth: 85 }] }), /reaches too far down/);
  assert.throws(() => validateBuilding({ ...ruin, damage: [{ wall: 'front', at: 4, width: 20, depth: 20 }] }), /reaches into a corner/);
  assert.throws(() => validateBuilding({ ...ruin, leaveOut: ['roof', 'left'], damage: [{ wall: 'left', at: 60, width: 30, depth: 20 }] }), /left out/);
  // Its outline: from above the top down, its foot no deeper than asked and at least a quarter of it down.
  const outline = breachOutline({ at: 150, width: 60, depth: 40 }, 100);
  const zs = outline.map(([, z]) => z);
  assert.ok(Math.min(...zs) >= 60 - 1e-9 && Math.min(...zs) < 80);
  assert.deepEqual(outline, breachOutline({ at: 150, width: 60, depth: 40 }, 100), 'the same every time');
  const b = { ...ruin, damage: [{ wall: 'front', at: 150, width: 70, depth: 50 }, { wall: 'left', at: 60, width: 40, depth: 30 }], props: [{ type: 'rubble', x: 120, y: -40, storey: -1 }] };
  const whole = withParts({ ...ruin }, (parts) => Object.fromEntries(['front2', 'left2', 'back2'].map((w) => [w, parts.filter((p) => p.id.startsWith(w)).reduce((t, p) => t + p.solid.volume(), 0)])));
  withParts(b, (parts) => {
    checkKit(parts, PLATE);
    const vol = (w) => parts.filter((p) => p.id.startsWith(w)).reduce((t, p) => t + p.solid.volume(), 0);
    assert.ok(vol('front2') < whole.front2 - 1000, 'the front wall broken');
    assert.ok(vol('left2') < whole.left2 - 300, 'the left wall broken');
    assert.ok(Math.abs(vol('back2') - whole.back2) < 1, 'the back wall whole');
  });
});

test('a canopy: checked, its posts, roof or tent, screens, sign and props printing clean', () => {
  assert.throws(() => validateCanopy({ roof: 'dome' }), /flat roof or a tent/);
  assert.throws(() => validateCanopy({ width: 500, bays: 1 }), /give it more bays/);
  assert.throws(() => validateCanopy({ props: [{ type: 'crate', x: 0, y: 0 }] }), /stands on a post/);
  assert.throws(() => validateCanopy({ props: [{ type: 'crate', x: 140, y: 40 }] }), /inside its posts/);
  assert.throws(() => validateCanopy({ height: 30, props: [{ type: 'pit-board', x: 60, y: 40 }] }), /too tall/);
  assert.equal(canopyPosts(validateCanopy({ bays: 2 })).xs.length, 3);
  const flat = { kind: 'canopy', width: 231, depth: 144, height: 115, bays: 2, text: 'FUEL', props: [{ type: 'fuel-pump', x: 50, y: 66 }, { type: 'fuel-pump', x: 170, y: 66 }] };
  const tent = { kind: 'canopy', width: 266, depth: 156, height: 82, bays: 2, roof: 'tent', screens: 'three', text: 'RALLY 01', props: [{ type: 'workbench', x: 30, y: 60, rotation: 90 }] };
  for (const c of [flat, tent, { kind: 'canopy', base: false, roof: 'tent', screens: 'back' }])
    withParts(c, (parts) => {
      checkKit(parts, PLATE, c.roof ?? 'flat' + ' ');
      roofsFlat(parts);
      assert.deepEqual(ids(parts), ids(buildingLayout(c).parts));
    });
  // In the layout: out to its roof, its front to the track.
  assert.deepEqual(shapeOf(validateCanopy(flat)).box, canopyFootprint(validateCanopy(flat)));
  const notes = kitNotes('Forecourt', validateCanopy(flat), buildingLayout(flat).parts, {});
  assert.match(notes, /Push each post into its socket/);
  assert.match(notes, /Glue the sign along the front of the roof/);
  assert.match(kitNotes('Tent', validateCanopy(tent), buildingLayout(tent).parts, {}), /two slopes of the tent on the rails/);
  assert.ok(CANOPY.post >= 0.8 && CANOPY.screen >= 0.8);
});

test('a stage: checked, its deck, ramps, portal and backdrop printing clean', () => {
  assert.throws(() => validateStage({ height: 30, rampLength: 60 }), /at least three times as long/);
  assert.throws(() => validateStage({ text: 'START' }), /choose a portal too/);
  assert.throws(() => validateStage({ backdropText: 'WIN' }), /choose a backdrop too/);
  assert.throws(() => validateStage({ portal: true, width: 40 }), /portal needs the deck/);
  for (const s of [
    { kind: 'stage', width: 137, depth: 152, height: 20, rampLength: 160, portal: true, portalHeight: 90, text: 'RALLY START' },
    { kind: 'stage', width: 162, depth: 104, height: 13, rampLength: 100, backdrop: true, backdropHeight: 75, backdropText: 'WINNER' },
    { kind: 'stage', ramps: 'none' },
  ])
    withParts(s, (parts) => {
      checkKit(parts, PLATE);
      assert.deepEqual(ids(parts), ids(buildingLayout(s).parts));
      // The ramps' tops meet the deck's.
      const deck = parts.find((p) => p.id === 'deck').solid.boundingBox();
      for (const r of parts.filter((p) => /^ramp/.test(p.id))) assert.ok(Math.abs(r.solid.boundingBox().max[2] - deck.max[2]) < 1e-6);
    });
  const s = validateStage({ backdrop: true });
  assert.deepEqual(shapeOf(s).box, stageFootprint(s));
  assert.match(kitNotes('Stage', s, buildingLayout(s).parts, {}), /push a backdrop panel down into each slot/);
});
