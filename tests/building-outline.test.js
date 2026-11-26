// A shaped building drawn wall by wall: walls moved, bays, recesses, corners cut at 45°.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildGarage, validateBuilding, printSize } from '../src/geometry/building.js';
import { checkOutline, footprintPoints, footprintWalls } from '../src/geometry/footprint-building.js';
import { addBay, asOutline, chamferCorner, moveWall } from '../src/building-outline.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const win = (wall, at, more = {}) => ({ wall, type: 'window', at, width: 24, height: 24, sill: 26, ...more });
const box = { kind: 'footprint', shape: 'rectangle', width: 160, depth: 120 };
// Where each opening is, in the plan: from the start of its wall, along it.
const places = (b) => {
  const walls = footprintWalls(b);
  return b.openings.map((o) => { const w = walls.find((x) => x.id === o.wall); return [w.a[0] + w.dir[0] * o.at, w.a[1] + w.dir[1] * o.at]; });
};
const near = (a, b, label) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, label + ': ' + a + ' and ' + b);

test('a drawn outline: square and 45° walls, long enough, turning 45° or 90°, not crossing; moved to the origin', () => {
  assert.deepEqual(checkOutline([[10, 5], [110, 5], [110, 85], [10, 85]], 3), { points: [[0, 0], [100, 0], [100, 80], [0, 80]], width: 100, depth: 80 });
  assert.throws(() => checkOutline([[0, 0], [100, 0], [100, 80], [10, 85]], 3), /at an angle/);
  assert.throws(() => checkOutline([[0, 0], [100, 0], [100, 80], [95, 80], [0, 80]], 3), /at least 10 mm/);
  assert.throws(() => checkOutline([[0, 0], [50, 0], [100, 0], [100, 80], [0, 80]], 3), /one line/);
  assert.throws(() => checkOutline([[0, 0], [100, 0], [0, 80], [100, 80]], 3), /angle|crosses|sharp/);
  assert.throws(() => checkOutline([[0, 0], [100, 0], [100, 80], [0, 80]].reverse(), 3), /crosses itself/);
  // An L with arms 10 mm thick: room inside them for walls 3 mm thick, none for 5 mm.
  const slot = [[0, 0], [100, 0], [100, 10], [10, 10], [10, 80], [0, 80]];
  assert.doesNotThrow(() => checkOutline(slot, 3));
  assert.throws(() => checkOutline(slot, 5), /too close|too short/);
  // A shape chosen again is that shape: the outline goes.
  assert.equal(validateBuilding({ ...box, shape: 'L', points: [[0, 0], [1, 1]] }).points, null);
  assert.deepEqual(asOutline(validateBuilding({ kind: 'footprint', shape: 'L' })).points, footprintPoints(validateBuilding({ kind: 'footprint', shape: 'L' })));
});

test('a wall moved out: its neighbours grow, every window stays where it was', () => {
  const b = validateBuilding({ ...box, openings: [win('edge-1', 50), win('edge-2', 40), win('edge-3', 80), win('edge-4', 60)] });
  const before = places(b);
  const moved = moveWall(b, 'edge-1', 12);
  assert.equal(moved.shape, 'custom');
  assert.deepEqual([moved.width, moved.depth], [160, 132]);
  // The outline moved back to the origin: the back corner shows by how much.
  const t = [footprintPoints(moved)[2][0] - footprintPoints(b)[2][0], footprintPoints(moved)[2][1] - footprintPoints(b)[2][1]];
  const after = places(moved);
  near(after[0], [before[0][0] + t[0], before[0][1] + t[1] - 12], 'the moved wall, out 12 mm');
  for (const k of [1, 2, 3]) near(after[k], [before[k][0] + t[0], before[k][1] + t[1]], 'window ' + (k + 1));
  assert.throws(() => moveWall(b, 'edge-1', -150), /crosses|too|at least/);
  assert.throws(() => moveWall(b, 'edge-9', 5), /Select a wall/);
});

test('a bay and a recess: the wall in five, the windows on their pieces, later walls and textures renumbered', () => {
  const b = validateBuilding({ ...box, wallTextures: { 'edge-1': 'brick', 'edge-3': 'metal' }, openings: [win('edge-1', 25), win('edge-1', 135), win('edge-2', 60), win('edge-3', 80)] });
  const before = places(b);
  const bay = addBay(b, 'edge-1', 15);
  assert.equal(footprintWalls(bay).length, 8);
  assert.deepEqual(bay.openings.map((o) => o.wall), ['edge-1', 'edge-5', 'edge-6', 'edge-7']);
  assert.deepEqual(bay.wallTextures, { 'edge-1': 'brick', 'edge-2': 'brick', 'edge-3': 'brick', 'edge-4': 'brick', 'edge-5': 'brick', 'edge-7': 'metal' });
  const t = [footprintPoints(bay)[6][0] - footprintPoints(b)[2][0], footprintPoints(bay)[6][1] - footprintPoints(b)[2][1]];
  places(bay).forEach((p, k) => near(p, [before[k][0] + t[0], before[k][1] + t[1]], 'window ' + (k + 1)));
  // The bay's face is out 15 mm.
  assert.equal(bay.depth, 135);
  const recess = addBay(b, 'edge-1', -15);
  assert.equal(recess.depth, 120);
  assert.ok(Math.abs(footprintWalls(recess)[2].length - 160 / 3) < 1e-6);
  assert.throws(() => addBay(validateBuilding({ ...box, openings: [win('edge-1', 55)] }), 'edge-1', 15), /Window 1 is where the bay would start or end/);
});

test('a square corner cut at 45°: a new wall, the windows of the wall after it keep their place', () => {
  const b = validateBuilding({ ...box, openings: [win('edge-1', 80), win('edge-2', 60), win('edge-4', 60)] });
  const before = places(b);
  const cut = chamferCorner(b, 1, 20);
  const walls = footprintWalls(cut);
  assert.equal(walls.length, 5);
  assert.ok(Math.abs(walls[1].length - 20 * Math.SQRT2) < 1e-6);
  assert.deepEqual(cut.openings.map((o) => o.wall), ['edge-1', 'edge-3', 'edge-5']);
  places(cut).forEach((p, k) => near(p, before[k], 'window ' + (k + 1)));
  assert.throws(() => chamferCorner(cut, 2, 10), /Only a square corner/);
  // The first corner: the last wall is the one before it.
  const first = chamferCorner(b, 0, 15);
  assert.deepEqual(first.openings.map((o) => o.wall), ['edge-2', 'edge-3', 'edge-5']);
});

test('drawn buildings build and print: diagonal walls lie flat, windows and frames on them, textures, cut to fit', () => {
  let b = validateBuilding({ ...box, width: 200, depth: 140, wallTexture: 'brick', openings: [win('edge-1', 30), win('edge-3', 70, { frame: true, across: 2 })] });
  b = addBay(b, 'edge-1', 18);
  b = chamferCorner(b, 6, 20);
  b = moveWall(b, 'edge-4', 6);
  // A window with a frame on the new corner wall.
  b = validateBuilding({ ...b, openings: [...b.openings, win('edge-7', 14.14, { width: 8, height: 20, frame: false })] });
  for (const plate of [{ width: 200, depth: 200, margin: 0 }, { width: 120, depth: 120, margin: 0 }]) {
    const parts = buildGarage(wasm, b, plate);
    try {
      checkKit(parts, plate);
      // A wall prints on its inside face: no higher than a wall and its texture.
      for (const p of parts.filter((q) => q.role === 'wall')) assert.ok(printSize(p)[2] <= b.wall + 0.01, p.name + ' prints ' + printSize(p)[2] + ' mm high');
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
});
