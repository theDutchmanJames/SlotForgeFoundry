// Over the track: what stands on legs, towers or an arch meets the table only
// at its feet, and the planner checks the cars have room under it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CAR_HEADROOM, baseParts, footprint, headroomOver, layoutBuilding, overlap, spanOf } from '../src/planner-buildings.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { tyreHeadroom, tyreOpening, validateTyreBridge } from '../src/geometry/tyre-bridge.js';
import { WALKWAY } from '../src/geometry/walkway.js';

const preset = (id) => BUILDING_PRESETS.find((p) => p.id === id).building;
const place = (building, pose = { x: 0, y: 0, a: 0 }) => layoutBuilding({ name: 'Test', building }, pose, 'b-1');
// A straight of track along x, `wide` across, its road `road` above the table, through the plan's origin.
const straight = (wide, road = 8, length = 600) => ({ polys: [[[-length / 2, -wide / 2], [length / 2, -wide / 2], [length / 2, wide / 2], [-length / 2, wide / 2]]], n: { h: [0, 0] }, def: { track: { params: { height: road } } } });
const roadOf = (row) => Math.max(...row.n.h) + row.def.track.params.height;
const loopsOf = (rows) => rows.flatMap((r) => r.polys);

test('the finish-line bridge stands over a straight on its legs: its feet clear of the track, the cars with room under it', () => {
  const entry = place(preset('finish-bridge'), { x: 0, y: 0, a: Math.PI / 2 });
  const rows = [straight(150)];
  // Its outline lies over the track, its feet do not.
  assert.equal(baseParts(entry).length, 4, 'four feet');
  assert.ok(overlap(entry, loopsOf(rows)) < 0.5, 'its feet clear of the track');
  const head = headroomOver(entry, rows, roadOf);
  assert.ok(head, 'over the track');
  assert.equal(head.under, 139);
  assert.equal(head.road, 8);
  assert.equal(head.room, 131);
  assert.ok(head.room >= CAR_HEADROOM);
  // Turned along the track it stands on it.
  const along = place(preset('finish-bridge'));
  assert.ok(overlap(along, loopsOf(rows)) > 0.5, 'its legs on the track');
  // Beside the track it is not over it.
  assert.equal(headroomOver(place(preset('finish-bridge'), { x: 0, y: 300, a: 0 }), rows, roadOf), null);
});

test('a building on low legs over the track is too low for the cars', () => {
  const b = { ...preset('finish-bridge'), standHeight: 50 };
  const entry = place(b, { x: 0, y: 0, a: Math.PI / 2 });
  const head = headroomOver(entry, [straight(150, 10)], roadOf);
  assert.equal(head.room, 40);
  assert.ok(head.room < CAR_HEADROOM);
});

test('a building on its base, a column or frames is not something that spans the track', () => {
  assert.equal(spanOf(place({ width: 160, depth: 120 }).building), null);
  assert.equal(spanOf(place(preset('booth-column')).building), null);
  assert.equal(spanOf(place(preset('commentary-booth')).building), null);
  // On its base it stands on the track over its whole outline.
  const entry = place({ width: 160, depth: 120 });
  assert.deepEqual(baseParts(entry), [footprint(entry)]);
});

test('under a tyre bridge the headroom is the arch: highest in the middle, none at its feet', () => {
  const t = validateTyreBridge(preset('tyre-bridge'));
  const o = tyreOpening(t);
  assert.ok(Math.abs(tyreHeadroom(t, 0) - o.height) < 1e-6);
  assert.ok(tyreHeadroom(t, o.width / 4) < o.height && tyreHeadroom(t, o.width / 4) > 0);
  assert.equal(tyreHeadroom(t, o.width), 0);
  // The track under it, running along y through the arch: narrow, the room is the arch where its edges are.
  const entry = place(preset('tyre-bridge'));
  const narrow = { ...straight(60, 8), polys: [[[-30, -400], [30, -400], [30, 400], [-30, 400]]] };
  const head = headroomOver(entry, [narrow], roadOf);
  assert.ok(head, 'over the track');
  assert.ok(Math.abs(head.under - tyreHeadroom(t, 30)) < 0.5, 'lowest at the edge of the road');
  assert.ok(overlap(entry, narrow.polys) < 0.5, 'its sides clear of the road');
  // A road as wide as the opening runs into its sides.
  const wide = { ...straight(60, 8), polys: [[[-o.width / 2 - 5, -400], [o.width / 2 + 5, -400], [o.width / 2 + 5, 400], [-o.width / 2 - 5, 400]]] };
  assert.ok(overlap(entry, wide.polys) > 0.5);
});

test('a walkway on legs meets the table at its feet; joining two buildings, nowhere', () => {
  const legs = { kind: 'walkway', length: 160, legs: true, clearance: 70 };
  const entry = place(legs, { x: 0, y: 0, a: Math.PI / 2 });
  assert.equal(baseParts(entry).length, 2, 'a leg at each end of a narrow walkway');
  const head = headroomOver(entry, [straight(120)], roadOf);
  assert.equal(head.under, 70 - WALKWAY.deck);
  const joined = place({ kind: 'walkway', length: 160, legs: false });
  assert.deepEqual(baseParts(joined), []);
  assert.ok(overlap(joined, loopsOf([straight(120)])) === 0);
});

test('a gantry set low over a straight is too low for the cars', () => {
  const entry = place({ kind: 'gantry', type: 'start', clearance: 40, span: 200 }, { x: 0, y: 0, a: Math.PI / 2 });
  const head = headroomOver(entry, [straight(150)], roadOf);
  assert.equal(head.room, 32);
  assert.ok(head.room < CAR_HEADROOM);
});
