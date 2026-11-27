// Shaped buildings: octagons and round buildings, walls at any angle, hip and
// cone roofs on outlines without inside corners, and storeys one on another.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildGarage, buildingLayout, validateBuilding } from '../src/geometry/building.js';
import { footprintPoints, footprintWalls, cornerTurns } from '../src/geometry/footprint-building.js';
import { checkKit, overAir } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 220, depth: 220, margin: 0 };
const withParts = (b, fn, plate = PLATE) => {
  const parts = buildGarage(wasm, b, plate);
  try {
    fn(parts, (id) => parts.find((p) => p.id === id));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const FP = { kind: 'footprint', openings: [] };

test('an octagon has eight equal sides on a square; a round building so many sides round an ellipse', () => {
  const oct = footprintWalls(validateBuilding({ ...FP, shape: 'octagon', width: 120, depth: 120 }));
  assert.equal(oct.length, 8);
  for (const w of oct) assert.ok(Math.abs(w.length - oct[0].length) < 1e-6);
  const round = validateBuilding({ ...FP, shape: 'round', width: 140, depth: 100, sides: 20 });
  const pts = footprintPoints(round);
  assert.equal(pts.length, 20);
  for (const turn of cornerTurns(pts)) assert.ok(turn > 0 && turn < 30);
  // One wall faces the front.
  const front = footprintWalls(round)[0];
  assert.ok(Math.abs(front.dir[1]) < 1e-9 && front.a[1] < 1e-6);
  assert.throws(() => validateBuilding({ ...FP, shape: 'round', sides: 40 }), /6 to 32 sides/);
});

test('octagons, round buildings and angled outlines build whole, their walls lying flat to print', () => {
  for (const b of [
    { ...FP, shape: 'octagon', width: 120, depth: 120, wallTexture: 'brick', openings: [{ wall: 'edge-1', type: 'door', at: 25, width: 20, height: 45, sill: 0, frame: true }] },
    { ...FP, shape: 'round', width: 110, depth: 110, sides: 12, openings: [{ wall: 'edge-3', type: 'window', at: 14.2, width: 10, height: 20, sill: 25 }] },
    { ...FP, shape: 'custom', points: [[0, 0], [100, 0], [130, 50], [100, 100], [0, 100]] },
  ])
    withParts(b, (parts) => {
      checkKit(parts, PLATE, b.shape + ': ');
    });
});

test('a hip roof on an outline without inside corners: a panel over each wall, a cone on a round plan', () => {
  assert.throws(() => validateBuilding({ ...FP, shape: 'L', roofShape: 'hip' }), /without inside corners/);
  const ids = buildingLayout({ ...FP, shape: 'octagon', width: 120, depth: 120, roofShape: 'hip' }).parts.filter((p) => p.role === 'roof').map((p) => p.id);
  assert.equal(ids.length, 8);
  for (const b of [
    { ...FP, shape: 'octagon', width: 120, depth: 120, roofShape: 'hip', pitch: 40 },
    { ...FP, shape: 'round', width: 100, depth: 100, sides: 16, roofShape: 'hip', pitch: 45, overhang: 4 },
    { ...FP, shape: 'rectangle', width: 140, depth: 110, roofShape: 'hip', pitch: 30 },
    { ...FP, shape: 'custom', points: [[0, 0], [100, 0], [130, 50], [100, 100], [0, 100]], roofShape: 'hip' },
  ])
    withParts(b, (parts) => {
      checkKit(parts, PLATE, b.shape + ' hip: ');
      // Each panel flat on its underside: nothing over air.
      for (const p of parts.filter((q) => q.role === 'roof')) assert.ok(overAir(p) < 0.5, b.shape + ': ' + p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air');
      // The walls reach up under the roof, no higher than its peak.
      const roofTop = Math.max(...parts.filter((q) => q.role === 'roof').map((q) => q.solid.boundingBox().max[2]));
      const wallTop = Math.max(...parts.filter((q) => q.role === 'wall').map((q) => q.solid.boundingBox().max[2]));
      assert.ok(wallTop > 6 + 75 - 0.01 && wallTop < roofTop);
    });
});

test('a hip roof too big for the plate says so', () => {
  assert.throws(() => withParts({ ...FP, shape: 'rectangle', width: 300, depth: 300, roofShape: 'hip' }, () => {}), /too big for the plate/);
});

test('storeys on a shaped building: a floor and its frame between each two, walls and windows of their own', () => {
  const b = { ...FP, shape: 'octagon', width: 120, depth: 120, height: 60, upper: [{ height: 50, wallTexture: 'planks', openings: [{ wall: 'edge-2', type: 'window', at: 25, width: 14, height: 20, sill: 15, frame: true }] }, { height: 45 }], roofShape: 'hip' };
  const ids = buildingLayout(b).parts.map((p) => p.id);
  for (const id of ['floor-2', 'floor-2-frame', 'floor-3', 'edge-1-2', 'edge-8-3', 'frame-1-2']) assert.ok(ids.includes(id), id);
  withParts(b, (parts, part) => {
    checkKit(parts, PLATE, 'storeys: ');
    // Storey 3's walls stand on storey 2's, a floor between each.
    assert.ok(Math.abs(part('floor-2').solid.boundingBox().min[2] - (6 + 60)) < 1e-6);
    assert.ok(Math.abs(part('edge-1-3').solid.boundingBox().min[2] - (6 + 60 + 4 + 50 + 4 - 2)) < 1e-6);
  });
  assert.throws(() => validateBuilding({ ...b, upper: [{}, {}, {}, {}] }), /at most 3 storeys/);
  assert.throws(() => validateBuilding({ ...b, upper: [{ height: 20 }] }), /30 to 180 mm high/);
  assert.throws(() => validateBuilding({ ...b, upper: [{ openings: [{ wall: 'edge-2', type: 'window', at: 25, width: 14, height: 50, sill: 15 }] }] }), /storey 2: leave at least 6 mm above/);
});

test('a curved wall: facets along an arc through its ends, its texture on each, the building printing whole', async () => {
  const { curveWall, addBay } = await import('../src/building-outline.js');
  const b = validateBuilding({ ...FP, shape: 'rectangle', width: 160, depth: 120, wallTextures: { 'edge-1': 'brick' } });
  const curved = curveWall(b, 'edge-1', 25, 6);
  const walls = footprintWalls(curved);
  assert.equal(walls.length, 9);
  for (let k = 1; k <= 6; k++) assert.equal(curved.wallTextures['edge-' + k], 'brick');
  // Bulging out 25 mm at its middle.
  assert.ok(Math.abs(curved.depth - 145) < 0.5);
  withParts(curved, (parts) => checkKit(parts, PLATE, 'curved: '));
  // Curving in on a square corner makes the corner too sharp to print.
  assert.throws(() => curveWall(b, 'edge-3', -20, 4), /too sharp/);
  // Not a wall with a window, on any storey.
  const withWindow = validateBuilding({ ...b, upper: [{ openings: [{ wall: 'edge-1', type: 'window', at: 60, width: 14, height: 20, sill: 15 }] }] });
  assert.throws(() => curveWall(withWindow, 'edge-1', 20), /Take the windows and doors off this wall first/);
  // A bay keeps an upper storey's windows on their walls.
  const bay = addBay(withWindow, 'edge-3', 15);
  assert.equal(bay.upper[0].openings[0].wall, 'edge-1');
  const later = addBay(validateBuilding({ ...b, upper: [{ openings: [{ wall: 'edge-3', type: 'window', at: 20, width: 14, height: 20, sill: 15 }] }] }), 'edge-1', 15);
  assert.equal(later.upper[0].openings[0].wall, 'edge-7');
});

test('the kit notes say how storeys and a hip roof go together', async () => {
  const { kitNotes } = await import('../src/building-kit.js');
  const { building, parts } = buildingLayout({ ...FP, shape: 'octagon', width: 120, depth: 120, roofShape: 'hip', pitch: 40, upper: [{ height: 50 }] });
  const notes = kitNotes('Tower', building, parts, {});
  assert.match(notes, /Octagonal footprint, 120 × 120 mm/);
  assert.match(notes, /2 storeys: storey 2 50 mm, each on a floor\. A hip roof at 40°/);
  assert.match(notes, /Glue each floor frame under its floor/);
  assert.match(notes, /Lay the roof panels on the tops of the walls, each over its own wall/);
});
