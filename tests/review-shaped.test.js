// Shaped buildings after a review: courtyards and props stay put when the
// outline moves to 0, 0; a jettied storey's windows stay where they are on the
// plan; a sawtooth's walls and teeth split to fit the plate as they print; the
// Footprint drawing's size on an upper storey; openings left on walls a shape
// has not got.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage, validateBuilding } from '../src/geometry/building.js';
import { footprintStoreys, footprintWalls, storeyWalls } from '../src/geometry/footprint-building.js';
import { addBay, chamferCorner, curveWall, moveWall } from '../src/building-outline.js';
import { planSize, sizeLevel } from '../src/building-canvas.js';
import { patchStorey } from '../src/building-edit.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg + ': ' + a + ' is not ' + b);

test('a courtyard and a prop keep their places among the walls that did not move when the front or left wall moves', () => {
  const b = validateBuilding({ kind: 'footprint', shape: 'rectangle', width: 180, depth: 160, height: 60, courtyards: [{ x: 50, y: 70, width: 80, depth: 40 }], props: [{ type: 'crate', x: 140, y: 120, storey: 0 }] });
  // Out 20 at the front: everything else 20 further from it, the same from the back wall.
  const out = moveWall(b, 'edge-1', 20);
  assert.equal(out.depth, 180);
  near(out.courtyards[0].y, 90, 'courtyard after the front moves out');
  near(out.courtyards[0].x, 50, 'courtyard x');
  near(out.props[0].y, 140, 'prop after the front moves out');
  // In 45: refused before, as the courtyard stayed where the wall came to.
  const inn = moveWall(b, 'edge-1', -45);
  near(inn.courtyards[0].y, 25, 'courtyard after the front moves in');
  near(inn.props[0].y, 75, 'prop after the front moves in');
  // The left wall out: across, not back.
  const left = moveWall(b, 'edge-4', 20);
  near(left.courtyards[0].x, 70, 'courtyard after the left wall moves out');
  near(left.props[0].x, 160, 'prop after the left wall moves out');
  // A bay out of the front, a curve out of the left wall, a corner cut: each from the back and the right as it was.
  for (const [what, next] of [['bay', addBay(b, 'edge-1', 15)], ['curve', curveWall(b, 'edge-4', 15)], ['chamfer', chamferCorner(b, 0, 15)]]) {
    const right = Math.max(...footprintWalls(next).filter((w) => !w.ring).map((w) => w.a[0])), back = Math.max(...footprintWalls(next).filter((w) => !w.ring).map((w) => w.a[1]));
    near(right - next.courtyards[0].x, 130, what + ': courtyard from the right wall');
    near(back - next.courtyards[0].y, 90, what + ': courtyard from the back wall');
    near(right - next.props[0].x, 40, what + ': prop from the right wall');
    near(back - next.props[0].y, 40, what + ': prop from the back wall');
  }
  // A drawn courtyard's corners move too, and a drawn outline given off 0, 0 brings its courtyard with it.
  const drawn = validateBuilding({ kind: 'footprint', shape: 'custom', points: [[100, 100], [280, 100], [280, 260], [100, 260]], height: 60, courtyards: [{ shape: 'custom', points: [[150, 170], [150, 210], [230, 210], [230, 170]] }] });
  assert.deepEqual(drawn.courtyards[0].points, [[50, 70], [50, 110], [130, 110], [130, 70]]);
  assert.equal(drawn.courtyards[0].x, 50);
  // Checked again, nothing moves.
  assert.deepEqual(validateBuilding(drawn).courtyards, drawn.courtyards);
});

// A window's place on the plan: along its storey's own wall.
const planOf = (b, n, k) => {
  const o = (n ? b.upper[n - 1] : b).openings[k], w = storeyWalls(b, footprintStoreys(b)[n]).find((x) => x.id === o.wall);
  return [w.a[0] + w.dir[0] * o.at, w.a[1] + w.dir[1] * o.at];
};
const win = (wall, at) => ({ wall, type: 'window', at, width: 20, height: 20, sill: 15 });

test('a jettied storey’s windows stay where they are on the plan when the outline changes', () => {
  const b = validateBuilding({ kind: 'footprint', shape: 'rectangle', width: 200, depth: 160, height: 60, upper: [{ height: 60, jetty: 10, openings: [win('edge-1', 175)] }] });
  const [x] = planOf(b, 1, 0);
  // A bay in the front: the window past it, on the wall's last piece, as far across as it was.
  const bay = addBay(b, 'edge-1', 15);
  assert.equal(bay.upper[0].openings[0].wall, 'edge-5');
  near(planOf(bay, 1, 0)[0], x, 'window across, after a bay');
  // A corner cut: nothing else moves, so the window is where it was each way.
  const c = validateBuilding({ ...b, upper: [{ height: 60, jetty: 10, openings: [win('edge-1', 40)] }] });
  const before = planOf(c, 1, 0), cut = chamferCorner(c, 0, 15), after = planOf(cut, 1, 0);
  assert.equal(cut.upper[0].openings[0].wall, 'edge-2');
  near(after[0], before[0], 'window across, after a corner cut');
  near(after[1], before[1], 'window back, after a corner cut');
  // The wall moved out: the window moves out with it, as far across.
  const moved = moveWall(c, 'edge-1', 10);
  near(planOf(moved, 1, 0)[0], before[0], 'window across, after the wall moves');
  // Two storeys out, 20 mm past the ground floor's walls.
  const two = validateBuilding({ ...b, upper: [{ height: 60, jetty: 10 }, { height: 60, jetty: 10, openings: [win('edge-1', 200)] }] });
  near(planOf(addBay(two, 'edge-1', 15), 2, 0)[0], planOf(two, 2, 0)[0], 'window of storey 3 across, after a bay');
  // The ground floor's windows as before.
  const ground = validateBuilding({ ...b, openings: [win('edge-1', 170)], upper: [] });
  near(planOf(addBay(ground, 'edge-1', 15), 0, 0)[0], planOf(ground, 0, 0)[0], 'ground floor window after a bay');
});

test('a bay is refused where a jettied storey’s own walls would turn under a window', () => {
  // On the jettied storey the bay's far side turns 153.3 mm along its wall, not 133.3.
  const b = validateBuilding({ kind: 'footprint', shape: 'rectangle', width: 200, depth: 160, height: 60, upper: [{ height: 60, jetty: 10, openings: [win('edge-1', 153)] }] });
  assert.throws(() => addBay(b, 'edge-1', 15), /Window 1 of storey 2 is where the bay would start or end/);
  // Clear of where its own walls turn, it is let be, though as near the ground floor's.
  const clear = validateBuilding({ ...b, upper: [{ height: 60, jetty: 10, openings: [win('edge-1', 175)] }] });
  assert.doesNotThrow(() => addBay(clear, 'edge-1', 15));
});

test('under a sawtooth the walls and the teeth split to fit the plate as they print', () => {
  const b = { kind: 'footprint', shape: 'rectangle', width: 180, depth: 180, height: 120, roofShape: 'sawtooth', teeth: 1, pitch: 35 };
  const parts = buildGarage(wasm, b, PLATE);
  try {
    checkKit(parts, PLATE);
    // The side walls rise past the plate's 200 mm and come in pieces; the tooth too, laid down its pitch.
    assert.ok(parts.filter((p) => /^edge-2/.test(p.id)).length > 1, 'side wall in pieces');
    assert.ok(parts.filter((p) => /^roof-1/.test(p.id)).length > 1, 'tooth in pieces');
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});

test('in Footprint, a shaped building with an upper storey chosen is drawn and sized by its ground outline', () => {
  const b = validateBuilding({ kind: 'footprint', shape: 'L', width: 220, depth: 180, wing: 80, height: 60, upper: [{ height: 60 }] });
  assert.deepEqual(planSize(b, 1), [220, 180]);
  assert.ok(planSize(b, 1).every(Number.isFinite));
  // A drawn outline: the size of its walls.
  assert.deepEqual(planSize(validateBuilding({ kind: 'footprint', shape: 'custom', points: [[0, 0], [150, 0], [150, 100], [0, 100]], upper: [{ height: 60 }] }), 1), [150, 100]);
  // The size and wing handles change the ground storey, whichever is chosen.
  assert.equal(sizeLevel(b, 1), 0);
  const wider = validateBuilding(patchStorey(b, sizeLevel(b, 1), { width: 240, wing: 90 }));
  assert.equal(wider.width, 240);
  assert.equal(wider.wing, 90);
  // A rectangular building's storey keeps its own size.
  const garage = validateBuilding({ kind: 'garage' });
  assert.deepEqual(planSize(garage, 0), [garage.width, garage.depth]);
  assert.equal(sizeLevel(garage, 1), 1);
});

test('an opening left on a wall the shape has not got is named, with its storey and the wall', () => {
  const L = { kind: 'footprint', shape: 'L', width: 220, depth: 180, wing: 80, height: 60 };
  assert.doesNotThrow(() => validateBuilding({ ...L, openings: [win('edge-1', 40), win('edge-6', 40)] }));
  assert.throws(() => validateBuilding({ ...L, shape: 'rectangle', openings: [win('edge-1', 40), win('edge-6', 40)] }), /^Error: Window 2 is on wall 6, which this shape has not got: move it or remove it\.$/);
  assert.throws(() => validateBuilding({ ...L, shape: 'rectangle', upper: [{ height: 60, openings: [{ ...win('edge-5', 40), type: 'door', sill: 0 }] }] }), /^Error: Door 1 of storey 2 is on wall 5, which this shape has not got/);
  assert.throws(() => validateBuilding({ ...L, openings: [win('court-1-2', 40)] }), /Window 1 is on wall 2 of courtyard 1, which this building has not got/);
  assert.throws(() => validateBuilding({ ...L, openings: [win(undefined, 40)] }), /Window 1 is on no wall: choose one\./);
  assert.throws(() => validateBuilding({ ...L, openings: [{ ...win('edge-1', 40), type: 'hatch' }] }), /Opening 1: choose a window or a door\./);
});
