// Props on a shaped building: inside a storey clear of its walls however the
// outline turns, or outside on the table clear of the base; each printing
// clean and running into nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage, buildingLayout, validateBuilding } from '../src/geometry/building.js';
import { footprintStoreys } from '../src/geometry/footprint-building.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { kitNotes } from '../src/building-kit.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const preset = (id) => BUILDING_PRESETS.find((p) => p.id === id).building;
const L = { kind: 'footprint', shape: 'L', width: 220, depth: 180, wing: 80, height: 75, upper: [{ height: 60 }] };

test('a prop on a shaped building stands inside a storey, clear of the walls, or outside clear of the base', () => {
  // Inside the L, in its long arm, and on the storey above.
  assert.doesNotThrow(() => validateBuilding({ ...L, props: [{ type: 'workbench', x: 20, y: 20, storey: 0 }, { type: 'crate', x: 20, y: 20, storey: 1 }] }));
  // In the notch of the L: outside the walls though inside its box.
  assert.throws(() => validateBuilding({ ...L, props: [{ type: 'crate', x: 180, y: 150, storey: 0 }] }), /stands inside the ground floor, 2 mm clear of its walls/);
  // Against a wall.
  assert.throws(() => validateBuilding({ ...L, props: [{ type: 'crate', x: 2, y: 30, storey: 0 }] }), /clear of its walls/);
  // Outside: in the notch of the L it is on the table; on the base it is not.
  assert.doesNotThrow(() => validateBuilding({ ...L, props: [{ type: 'crate', x: 180, y: 150, storey: -1 }] }));
  assert.throws(() => validateBuilding({ ...L, props: [{ type: 'crate', x: 20, y: 20, storey: -1 }] }), /clear of the base/);
  assert.throws(() => validateBuilding({ ...L, props: [{ type: 'crate', x: 20, y: 20, storey: 2 }] }), /storey the building has not got/);
  assert.throws(() => validateBuilding({ ...L, props: [{ type: 'crate', x: 20, y: 20, storey: 0 }, { type: 'crate', x: 25, y: 22, storey: 0 }] }), /keep them 2 mm apart/);
  // In an octagon: a corner cut off where a box would still fit.
  const diner = preset('paddock-diner');
  assert.throws(() => validateBuilding({ ...diner, props: [{ type: 'crate', x: 6, y: 6, storey: 0 }] }), /clear of its walls/);
  assert.doesNotThrow(() => validateBuilding({ ...diner, props: [{ type: 'counter', x: 50, y: 90, storey: 0 }] }));
});

test('props on a shaped building print clean and are in the kit, named as laid out', () => {
  const b = { ...L, props: [{ type: 'workbench', x: 20, y: 20, storey: 0 }, { type: 'pit-board', x: 180, y: 150, storey: -1 }, { type: 'tyre-stack', x: 20, y: 110, storey: 1 }] };
  const parts = buildGarage(wasm, b, PLATE);
  try {
    // The props as laid out (the walls are cut to the plate as they are built).
    const propIds = (list) => list.map((p) => p.id).filter((id) => /^prop-/.test(id));
    assert.deepEqual(propIds(parts), propIds(buildingLayout(b).parts));
    const props = parts.filter((p) => /^prop-/.test(p.id));
    assert.ok(props.length >= 3);
    checkKit(parts, PLATE);
    // Each on its floor: the ground floor's, the storey's above, the table.
    const [g, up] = footprintStoreys(validateBuilding(b));
    // The lowest of a prop's parts.
    const z = (id) => Math.min(...parts.filter((p) => p.id === id || p.id.startsWith(id + '-')).map((p) => p.solid.boundingBox().min[2]));
    assert.ok(Math.abs(z('prop-1') - g.floor) < 0.01);
    assert.ok(Math.abs(z('prop-2')) < 0.01);
    assert.ok(Math.abs(z('prop-3') - up.floor) < 0.01);
    assert.match(kitNotes('L', validateBuilding(b), parts, {}), /Glue each prop where it stands/);
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});

test('a prop outside stands in a courtyard on its paving, clear of the walls round it', () => {
  const b = { kind: 'footprint', shape: 'rectangle', width: 180, depth: 160, height: 60, courtyards: [{ x: 50, y: 50, width: 80, depth: 60 }], props: [{ type: 'parasol', x: 70, y: 60, storey: -1 }, { type: 'crate', x: -40, y: 20, storey: -1 }] };
  assert.throws(() => validateBuilding({ ...b, props: [{ type: 'crate', x: 48, y: 60, storey: -1 }] }), /in a courtyard: keep it 2 mm clear/);
  const parts = buildGarage(wasm, b, PLATE);
  try {
    checkKit(parts, PLATE);
    const low = (id) => Math.min(...parts.filter((p) => p.id === id || p.id.startsWith(id + '-')).map((p) => p.solid.boundingBox().min[2]));
    assert.ok(Math.abs(low('prop-1') - 6) < 1e-6, 'on the paving, the top of the base');
    assert.ok(Math.abs(low('prop-2')) < 1e-6, 'on the table outside');
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});
