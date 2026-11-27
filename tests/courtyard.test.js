// A shaped building round a courtyard: walls round the outline and round
// each courtyard, the courtyard open to the sky through every floor and the
// roof, the base its paving; every part printing clean.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage, validateBuilding } from '../src/geometry/building.js';
import { COURTYARD, footprintRings, footprintWalls, ringsOffset } from '../src/geometry/footprint-building.js';
import { addBay, chamferCorner, curveWall, moveWall } from '../src/building-outline.js';
import { planShapes } from '../src/planner-buildings.js';
import { kitNotes } from '../src/building-kit.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const RECT = { kind: 'footprint', shape: 'rectangle', width: 180, depth: 160, height: 60 };
const court = (c = {}) => ({ x: 50, y: 50, width: 80, depth: 60, ...c });

test('a courtyard is checked: inside the walls with room, apart from another, and the roof flat', () => {
  assert.doesNotThrow(() => validateBuilding({ ...RECT, courtyards: [court()] }));
  assert.throws(() => validateBuilding({ ...RECT, courtyards: [court({ x: 5 })] }), /Courtyard 1 is too near a wall/);
  assert.throws(() => validateBuilding({ ...RECT, courtyards: [court({ width: 10 })] }), /at least 20 mm across/);
  assert.throws(() => validateBuilding({ ...RECT, courtyards: [court({ width: NaN })] }), /a place and a size/);
  assert.throws(() => validateBuilding({ ...RECT, courtyards: [court({ colour: 'red' })] }), /a place and a size/);
  assert.throws(() => validateBuilding({ ...RECT, width: 300, courtyards: [court({ x: 30 }), court({ x: 115 })] }), /Courtyard 2 is too near courtyard 1/);
  assert.doesNotThrow(() => validateBuilding({ ...RECT, width: 300, courtyards: [court({ x: 30, width: 70 }), court({ x: 170, width: 70 })] }));
  assert.throws(() => validateBuilding({ ...RECT, roofShape: 'hip', courtyards: [court()] }), /takes a flat roof/);
  assert.throws(() => validateBuilding({ ...RECT, width: 600, courtyards: Array.from({ length: COURTYARD.most + 1 }, (_, k) => court({ x: 20 + k * 110, width: 60 })) }), /at most 4 courtyards/);
  // In the notch of an L, where the building is not, it is refused.
  assert.throws(() => validateBuilding({ kind: 'footprint', shape: 'L', courtyards: [court({ x: 120, y: 110, width: 40, depth: 40 })] }), /too near a wall/);
});

test('the walls run round the outline and then round each courtyard, facing out into it', () => {
  const b = validateBuilding({ ...RECT, courtyards: [court()] });
  const walls = footprintWalls(b);
  assert.deepEqual(walls.map((w) => w.id), ['edge-1', 'edge-2', 'edge-3', 'edge-4', 'court-1-1', 'court-1-2', 'court-1-3', 'court-1-4']);
  assert.equal(walls[4].name, 'Courtyard 1, wall 1');
  // Each courtyard wall's inside faces away from the courtyard's middle.
  const mid = [90, 80];
  for (const w of walls.slice(4)) {
    const m = [(w.a[0] + w.end[0]) / 2, (w.a[1] + w.end[1]) / 2];
    assert.ok((m[0] - mid[0]) * w.inward[0] + (m[1] - mid[1]) * w.inward[1] > 0, w.id + ' faces into the courtyard');
  }
  // Moved out, a courtyard's ring grows into the courtyard: the base's ledge round it.
  const [, ring] = ringsOffset(b, 3);
  const xs = ring.map((p) => p[0]);
  assert.ok(Math.abs(Math.min(...xs) - 53) < 1e-9 && Math.abs(Math.max(...xs) - 127) < 1e-9);
  assert.equal(footprintRings(b).length, 2);
});

test('a building round a courtyard prints clean: its walls, a door into it, a storey above, the floor and the roof open over it', () => {
  const b = { ...RECT, upper: [{ height: 50 }], courtyards: [court()], openings: [{ wall: 'court-1-1', type: 'door', at: 30, width: 20, height: 40, sill: 0, frame: true }] };
  const parts = buildGarage(wasm, b, PLATE);
  try {
    checkKit(parts, PLATE);
    for (const id of ['court-1-1', 'court-1-4', 'court-1-1-2', 'frame-1']) assert.ok(parts.some((p) => p.id === id), id);
    // Over the middle of the courtyard there is nothing but the base under it.
    const at = (p, [x, y]) => {
      const probe = wasm.Manifold.cube([2, 2, 400]).translate([x - 1, y - 1, -100]);
      const v = p.solid.intersect(probe);
      const vol = v.volume();
      probe.delete();
      v.delete();
      return vol;
    };
    const over = parts.filter((p) => at(p, [90, 80]) > 0.001).map((p) => p.id);
    assert.deepEqual(over, ['base'], 'only the base under the open courtyard');
    // But the roof does cover the building between the courtyard and the outline.
    assert.ok(parts.some((p) => p.id.startsWith('roof') && at(p, [20, 20]) > 0.001));
    assert.ok(parts.some((p) => p.id.startsWith('floor-2') && at(p, [20, 20]) > 0.001));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});

test('the outline can still be drawn round a courtyard: its walls and openings stay with it', () => {
  const b = validateBuilding({ ...RECT, courtyards: [court()], openings: [{ wall: 'court-1-2', type: 'window', at: 30, width: 20, height: 20, sill: 20, frame: false }], wallTextures: { 'court-1-3': 'planks' } });
  const moved = moveWall(b, 'edge-2', 10);
  assert.equal(moved.width, 190);
  assert.deepEqual(moved.courtyards, b.courtyards);
  assert.equal(moved.openings[0].wall, 'court-1-2');
  assert.equal(moved.wallTextures['court-1-3'], 'planks');
  // Moved in too far, the courtyard is too near the wall: refused.
  assert.throws(() => moveWall(b, 'edge-2', -40), /too near a wall/);
});

test('in the planner and the kit notes', () => {
  const b = validateBuilding({ ...RECT, courtyards: [court()] });
  const shapes = planShapes({ building: b, pose: { x: 0, y: 0, a: 0 } });
  assert.equal(shapes.storeys.length, 2, 'the outline and the courtyard');
  const notes = kitNotes('Court', b, [], {});
  assert.match(notes, /Round a courtyard, open to the sky/);
  assert.match(notes, /Stand each courtyard’s walls in the groove round it/);
  // The standard one.
  const preset = BUILDING_PRESETS.find((p) => p.id === 'footprint-court');
  const parts = buildGarage(wasm, preset.building, PLATE);
  try {
    checkKit(parts, PLATE);
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});

test('a courtyard can be an octagon or round, as an outline can', () => {
  for (const c of [court({ shape: 'octagon', width: 70, depth: 70 }), court({ shape: 'round', width: 70, depth: 60, sides: 12 })]) {
    const b = validateBuilding({ ...RECT, courtyards: [c] });
    const walls = footprintWalls(b).filter((w) => w.ring === 1);
    assert.equal(walls.length, c.shape === 'octagon' ? 8 : 12);
    const parts = buildGarage(wasm, b, PLATE);
    try {
      checkKit(parts, PLATE, c.shape + ' ');
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
  assert.throws(() => validateBuilding({ ...RECT, courtyards: [court({ shape: 'oval' })] }), /choose a rectangular, octagonal or round courtyard/);
  assert.throws(() => validateBuilding({ ...RECT, courtyards: [court({ shape: 'round', sides: 40 })] }), /6 to 32 sides/);
});

test('a courtyard is drawn wall by wall as the outline is: moved, a bay, a corner cut, curved', () => {
  const b = validateBuilding({ ...RECT, courtyards: [court()], openings: [{ wall: 'court-1-2', type: 'window', at: 40, width: 20, height: 20, sill: 20, frame: false }] });
  // Its left wall moved out into the courtyard by 10: narrower, drawn now.
  let next = moveWall(b, 'court-1-1', 10);
  assert.equal(next.courtyards[0].shape, 'custom');
  assert.equal(next.courtyards[0].x, 60);
  assert.equal(next.courtyards[0].width, 70);
  assert.equal(next.shape, 'rectangle', 'the outline as it was');
  // The window on the wall beside it stays where it was on the plan.
  assert.equal(next.openings[0].wall, 'court-1-2');
  assert.ok(Math.abs(next.openings[0].at - 30) < 1e-6, 'measured from the moved corner');
  // A corner cut: five walls, the window's wall renumbered after it.
  next = chamferCorner(b, 1, 10, 1);
  assert.equal(footprintWalls(next).filter((w) => w.ring === 1).length, 5);
  assert.equal(next.openings[0].wall, 'court-1-3');
  // Curved, a bay: more walls; the outline is not touched.
  assert.equal(footprintWalls(curveWall(b, 'court-1-3', -8, 4)).filter((w) => w.ring === 1).length, 7);
  assert.equal(footprintWalls(addBay(b, 'court-1-4', 12)).filter((w) => w.ring === 1).length, 8);
  // Too far in, it is refused.
  assert.throws(() => moveWall(b, 'court-1-1', 70), /./);
  // A drawn courtyard prints clean.
  const parts = buildGarage(wasm, chamferCorner(b, 0, 12, 1), PLATE);
  try {
    checkKit(parts, PLATE);
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});
