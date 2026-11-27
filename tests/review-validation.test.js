// Checks found missing in a review: each refused with a clear message, and a
// building just clear of the trouble still accepted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBuilding } from '../src/geometry/building.js';

const ok = (b) => assert.doesNotThrow(() => validateBuilding(b));

test('nothing on the storey above stands over a stairwell', () => {
  const house = { upper: [{}], door: 'none', stairs: [{ storey: 0, x: 20, y: 40, rotation: 0 }] };
  assert.throws(() => validateBuilding({ ...house, props: [{ type: 'tool-chest', x: 22, y: 60, storey: 1 }] }), /Prop 1 stands over the stairwell of stairs 1: move one of them/);
  assert.throws(() => validateBuilding({ ...house, partitions: [{ storey: 1, x0: 10, y0: 80, x1: 100, y1: 80 }] }), /Partition 1 stands over the stairwell of stairs 1/);
  // A flight on the storey above standing in the hole.
  assert.throws(() => validateBuilding({ ...house, upper: [{}, {}], stairs: [...house.stairs, { storey: 1, x: 20, y: 40 }] }), /Stairs 2 stands over the stairwell of stairs 1/);
  // Beside the stairwell, and on the floor beside the flight, they are fine.
  ok({ ...house, props: [{ type: 'tool-chest', x: 70, y: 60, storey: 1 }] });
  ok({ ...house, partitions: [{ storey: 1, x0: 50, y0: 80, x1: 100, y1: 80 }] });
  ok({ ...house, props: [{ type: 'tool-chest', x: 70, y: 60, storey: 0 }] });
});

test('nothing on the ground floor stands over the track through a pit garage', () => {
  const pit = { lane: { width: 60 }, door: 'open' };
  assert.throws(() => validateBuilding({ ...pit, props: [{ type: 'tool-chest', x: 50, y: 60, storey: 0 }] }), /Prop 1 stands over the track through the garage/);
  assert.throws(() => validateBuilding({ ...pit, partitions: [{ x0: 10, y0: 100, x1: 100, y1: 100 }] }), /Partition 1 stands over the track/);
  // Beside the track, on the deck left each side of it.
  ok({ ...pit, props: [{ type: 'tool-chest', x: 92, y: 60, storey: 0 }] });
  ok({ ...pit, partitions: [{ x0: 95, y0: 100, x1: 115, y1: 100 }] });
});

test('a prop on the table keeps clear of door steps, the stand and the way up', () => {
  const step = { door: 'none', openings: [{ wall: 'front', type: 'door', at: 60, step: true }] };
  assert.throws(() => validateBuilding({ ...step, props: [{ type: 'tyre', x: 50, y: -26, storey: -1 }] }), /stands on the table where the step of the front door is/);
  ok({ ...step, props: [{ type: 'tyre', x: 90, y: -26, storey: -1 }] });
  const legs = { standType: 'legs' };
  assert.throws(() => validateBuilding({ ...legs, props: [{ type: 'tyre', x: -24, y: 0, storey: -1 }] }), /where the foot of the front left leg is/);
  ok({ ...legs, props: [{ type: 'tyre', x: -24, y: 40, storey: -1 }] });
  const ladder = { access: 'ladder', accessWall: 'right', accessAt: 60 };
  assert.throws(() => validateBuilding({ ...ladder, props: [{ type: 'tyre', x: 136, y: 51, storey: -1 }] }), /where the ladder is/);
  ok({ ...ladder, props: [{ type: 'tyre', x: 136, y: 100, storey: -1 }] });
  const stairs = { access: 'stairs', accessWall: 'right', accessAt: 20, accessTo: 'roof' };
  assert.throws(() => validateBuilding({ ...stairs, props: [{ type: 'tyre', x: 136, y: 60, storey: -1 }] }), /where the staircase is/);
  ok({ ...stairs, props: [{ type: 'tyre', x: 160, y: 60, storey: -1 }] });
});

test('a lintel stays under the fascia sign', () => {
  const win = { wall: 'front', type: 'window', at: 60, width: 30, height: 20, lintel: true };
  const b = (sill) => ({ sign: 'fascia', door: 'none', openings: [{ ...win, sill }] });
  assert.throws(() => validateBuilding(b(41)), /front window with its lintel reaches up under the sign: its top can be at most 57 mm/);
  ok(b(37));
});

test('the stepped gable is glued clear of lintels, flaps and lettering', () => {
  const gable = { roof: 'gable', ridge: 'depth', overhangFront: 0, gableFront: 'stepped', door: 'none' };
  const win = { wall: 'front', type: 'window', at: 60, width: 30, height: 20 };
  assert.throws(() => validateBuilding({ ...gable, openings: [{ ...win, sill: 46, lintel: true }] }), /keep the front window, its lintel under it/);
  ok({ ...gable, openings: [{ ...win, sill: 42, lintel: true }] });
  assert.throws(() => validateBuilding({ ...gable, openings: [{ ...win, sill: 46, flap: true }] }), /keep the front window, its flap under it/);
  ok({ ...gable, openings: [{ ...win, sill: 40, flap: true }] });
  assert.throws(() => validateBuilding({ ...gable, lettering: [{ wall: 'front', text: 'GARAGE', at: 60, up: 68, height: 8 }] }), /keep lettering 1 under it, its middle at most 61 mm up/);
  ok({ ...gable, lettering: [{ wall: 'front', text: 'GARAGE', at: 60, up: 61, height: 8 }] });
  // On a storey above, the top one's lettering is checked.
  assert.throws(() => validateBuilding({ ...gable, upper: [{ lettering: [{ wall: 'front', text: 'GARAGE', at: 60, up: 58, height: 8 }] }] }), /keep lettering 1, storey 2 under it/);
});

test('a hip roof is sized by the real top storey', () => {
  const hip = { roof: 'hip', width: 300, depth: 150, overhangFront: 0, overhangBack: 0, overhangLeft: 0, overhangRight: 0 };
  ok({ ...hip, upper: [{ width: 150 }, {}] });
  assert.throws(() => validateBuilding({ ...hip, upper: [{ width: 200 }, {}] }), /at most 190 mm across, not 200/);
  assert.throws(() => validateBuilding(hip), /not 300/);
  assert.throws(() => validateBuilding({ ...hip, upper: null }), /storeys above the ground floor are a list/);
  assert.throws(() => validateBuilding({ upper: null }), /storeys above the ground floor are a list/);
});

test('lettering keeps clear of shutters, a sill ledge and a lintel', () => {
  const win = { wall: 'front', type: 'window', at: 60, width: 30, height: 20, sill: 30 };
  const b = (extra, l) => ({ door: 'none', openings: [{ ...win, ...extra }], lettering: [{ wall: 'front', text: 'AB', height: 8, ...l }] });
  assert.throws(() => validateBuilding(b({ shutters: true }, { at: 33, up: 40 })), /Lettering 1 runs over the front window/);
  ok(b({}, { at: 33, up: 40 }));
  assert.throws(() => validateBuilding(b({ lintel: true }, { at: 60, up: 57 })), /runs over the front window/);
  ok(b({}, { at: 60, up: 57 }));
  assert.throws(() => validateBuilding(b({ ledge: true }, { at: 60, up: 23 })), /runs over the front window/);
  ok(b({}, { at: 60, up: 23 }));
});
