// Buildings in a layout: kept whole in the layout, placed and turned, and
// snapped with their front along the outside of the track.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GAP, SNAP, footprint, layoutBuilding, nearestRow, overlap, placeParts, planShapes, snapPose, toPlan, validateBuildings } from '../src/planner-buildings.js';
import { KIT } from '../src/geometry/building.js';
import { newLayout, validateLayout } from '../src/planner-model.js';

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const garage = (pose, extra = {}) => layoutBuilding({ id: 'lib-1', name: 'Garage', building: extra }, pose, 'b-1');
// A straight road 400 long and 100 wide along x, from y 0 to 100.
const ROAD = [
  [
    [0, 0],
    [400, 0],
    [400, 100],
    [0, 100],
  ],
];
// A quarter ring: inner radius 300, outer 400, centred on the origin.
const ring = () => {
  const outer = [],
    inner = [];
  for (let k = 0; k <= 30; k++) {
    const a = (k / 30) * (Math.PI / 2);
    outer.push([400 * Math.cos(a), 400 * Math.sin(a)]);
    inner.push([300 * Math.cos(a), 300 * Math.sin(a)]);
  }
  return [[...outer, ...inner.reverse()]];
};

test('a layout keeps its buildings whole, each checked; a building can be read back', () => {
  const entry = garage({ x: 10, y: 20, a: 0 });
  assert.equal(entry.libraryId, 'lib-1');
  assert.equal(entry.building.width, 120, 'the settings are kept in full');
  const layout = { ...newLayout(), buildings: [entry] };
  assert.equal(validateLayout(structuredClone(layout)).buildings.length, 1);
  assert.doesNotThrow(() => validateLayout(newLayout()), 'a layout without buildings is fine');
  for (const bad of [
    [{ ...entry, id: 'x' }],
    [entry, entry],
    [{ ...entry, pose: { x: 1, y: NaN, a: 0 } }],
    [{ ...entry, colour: 'red' }],
    'garage',
  ])
    assert.throws(() => validateBuildings(bad), /Invalid building/);
  assert.throws(() => validateBuildings([{ ...entry, building: { width: 5 } }]), /The building Garage in the layout file cannot be used: Width must be between/);
});

test('a building stands by the middle of its base, turned by its pose', () => {
  const entry = garage({ x: 100, y: 50, a: Math.PI / 2 });
  // Its middle is the middle of the walls; its front-left corner turns a quarter.
  assert.deepEqual(toPlan(entry, [60, 90]).map((v) => Math.round(v)), [100, 50]);
  const corner = toPlan(entry, [0, 0]);
  assert.ok(near(corner[0], 190) && near(corner[1], -10), String(corner));
  const base = footprint(entry);
  assert.equal(base.length, 4);
  const xs = base.map(([x]) => x);
  assert.ok(near(Math.max(...xs) - Math.min(...xs), 180 + 2 * KIT.ledge), 'turned, its depth runs across');
  const shapes = planShapes({ ...entry, building: { ...entry.building, upper: [{ width: 80, depth: 100, x: 20, y: 40 }] } });
  assert.equal(shapes.storeys.length, 2);
  assert.equal(shapes.door.length, 2);
  // The 3D parts move with it, z kept.
  const [placed] = placeParts([{ id: 'front', positions: new Float32Array([0, 0, 5, 60, 90, 7]), indices: [] }], entry);
  assert.equal(placed.id, 'b-1/front');
  assert.ok(near(placed.positions[0], 190, 1e-4) && near(placed.positions[2], 5) && near(placed.positions[3], 100, 1e-4) && near(placed.positions[5], 7));
});

test('dropped near the track, a building stands along it, its front 1 mm from the edge and facing it', () => {
  // Dropped below the road, its front a little apart and turned a little.
  const entry = garage({ x: 200, y: -110, a: Math.PI + 0.2 });
  const pose = snapPose(entry, ROAD);
  assert.ok(pose, 'it snaps');
  const placed = { ...entry, pose };
  // Facing the road: its front edge runs along y = -GAP.
  const front = [toPlan(placed, [0, -KIT.ledge]), toPlan(placed, [120, -KIT.ledge])];
  for (const [, y] of front) assert.ok(near(y, -GAP, 1e-6), 'front along the edge: ' + y);
  assert.ok(near(pose.x, toPlan(entry, [60, -KIT.ledge])[0], 1e-6), 'it keeps its place along the road');
  assert.equal(overlap(placed, ROAD), 0);
  // From above the road, it turns round to face it.
  const above = snapPose(garage({ x: 200, y: 215, a: 0 }), ROAD);
  assert.ok(near(toPlan({ ...entry, pose: above }, [60, -KIT.ledge])[1], 100 + GAP, 1e-6));
  // Too far away, it stays where it was dropped.
  assert.equal(snapPose(garage({ x: 200, y: -200, a: Math.PI }), ROAD), null);
  assert.ok(snapPose(garage({ x: 200, y: -200, a: 0 }), ROAD, SNAP * 8), 'a longer reach finds it');
});

test('beside a corner a building moves out until it is clear of the track', () => {
  // Outside the ring, its front towards the middle of the corner.
  const a = Math.PI / 4;
  const entry = garage({ x: 520 * Math.cos(a), y: 520 * Math.sin(a), a: a - Math.PI / 2 });
  const pose = snapPose(entry, ring());
  assert.ok(pose, 'it snaps');
  assert.ok(overlap({ ...entry, pose }, ring()) < 0.5, 'clear of the corner');
  // Its front faces the middle of the corner.
  const facing = [-Math.sin(pose.a) * -1, Math.cos(pose.a) * -1];
  const out = [Math.cos(a), Math.sin(a)];
  assert.ok(facing[0] * -out[0] + facing[1] * -out[1] > 0.95, 'faces the corner');
  // On the inside of the corner there is no edge it can stand along without
  // lying on the track: there it stays clear, or is not snapped at all.
  const inside = snapPose(garage({ x: 200 * Math.cos(a), y: 200 * Math.sin(a), a: a + Math.PI / 2 }), ring());
  if (inside) assert.ok(overlap({ ...entry, pose: inside }, ring()) < 0.5);
});

test('a building lying on the track is told; the road beside it is found', () => {
  assert.ok(overlap(garage({ x: 200, y: 50, a: 0 }), ROAD) > 1000);
  const entry = garage({ x: 200, y: -95, a: Math.PI });
  const row = { n: { h: [0, 0] }, def: { track: { params: { height: 12 } } }, polys: ROAD };
  const found = nearestRow(entry, [row]);
  assert.equal(found.row, row);
  assert.ok(near(found.d, 2, 1e-6), 'its front is 2 mm from the road: ' + found.d);
});

/* ---------- Garages over the pit bays ---------- */

test('a pit bay ends where its end stop is closed; a garage stands over it, the track along its middle', async () => {
  const { bayEnd, bayPose, bayRoom, pitGarage } = await import('../src/planner-buildings.js');
  // An end stop 150 long and 100 wide, joined at its end A at x = 0 (facing
  // out of the piece, towards -x), closed at x = 150; its track off-centre by 4.
  const stop = [
    [
      [0, -46],
      [150, -46],
      [150, 54],
      [0, 54],
    ],
  ];
  const bay = bayEnd({ xy: [0, 0], angle: Math.PI }, stop);
  assert.ok(near(bay.at[0], 150) && near(bay.at[1], 4), 'the closed end, across the middle: ' + bay.at);
  assert.ok(near(bay.dir[0], 1) && near(bay.dir[1], 0), 'the bay runs into it along +x');
  assert.ok(near(bay.width, 100));
  // The garage is made to take the track: an open door wide enough, wider if need be.
  const building = pitGarage({ width: 100, doorWidth: 60, door: 'roller' }, bay.width, 12);
  assert.deepEqual([building.lane.width, building.door, building.doorWidth, building.width, building.baseHeight], [100, 'open', 104, 122, 12]);
  // A wide garage keeps its width; between bays it is no wider than the room.
  assert.equal(pitGarage({ width: 200 }, 100, 10).width, 200);
  assert.equal(pitGarage({ width: 200 }, 100, 10, 150).width, 150);
  assert.throws(() => pitGarage({}, 100, 10, 110), /too close together for a garage over each: a garage needs 122 mm and there is 110 mm/);
  // It faces down the bay: its back wall 1 mm beyond the end stop, the track along its middle.
  const entry = { building, pose: bayPose(building, bay) };
  const back = toPlan(entry, [building.width / 2, building.depth - KIT.wall]);
  assert.ok(near(back[0], 150 + GAP, 1e-6) && near(back[1], 4, 1e-6), 'back wall inside face: ' + back);
  const door = toPlan(entry, [building.width / 2, 0]);
  assert.ok(door[0] < back[0] && near(door[1], 4, 1e-6), 'the door faces the incoming track');
  // Bays side by side: the room across each is the distance to the next, less 1 mm.
  const ends = [0, 150, 300].map((y) => ({ at: [500, y], dir: [1, 0] }));
  assert.deepEqual(bayRoom(ends, 180), [149, 149, 149]);
  assert.deepEqual(bayRoom([ends[0], { at: [2000, 150], dir: [1, 0] }], 180), [Infinity, Infinity], 'a bay far ahead is not beside it');
  // A layout keeps which bay a garage stands over.
  assert.doesNotThrow(() => validateBuildings([{ ...garage({ x: 0, y: 0, a: 0 }), bay: 'node-1' }]));
  assert.throws(() => validateBuildings([{ ...garage({ x: 0, y: 0, a: 0 }), bay: 'a b' }]), /Invalid building/);
});

test('over its bay a garage leaves the track clear; deeper than the straight, its base stands on the track', async () => {
  const { bayEnd, bayPose, pitGarage } = await import('../src/planner-buildings.js');
  // A straight bay 300 long, 100 wide, closed at x = 300; a corner comes in at x < 0.
  const straight = [
    [
      [0, -50],
      [300, -50],
      [300, 50],
      [0, 50],
    ],
  ];
  const corner = [
    [
      [-300, -50],
      [0, -50],
      [0, 50],
      [-300, 250],
    ],
  ];
  const bay = bayEnd({ xy: [0, 0], angle: Math.PI }, straight);
  const over = (depth) => {
    const building = pitGarage({ depth }, bay.width, 10);
    return { building, pose: bayPose(building, bay) };
  };
  assert.equal(overlap(over(180), [...straight, ...corner]), 0, 'the track runs in between the arms of the base');
  assert.ok(overlap(over(390), [...straight, ...corner]) > 100, 'deeper than the straight, the arms stand on the corner');
});
