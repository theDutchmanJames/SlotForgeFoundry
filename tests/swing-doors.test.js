// Doors that swing: the leaf a part of its own on pins, one up into a slot over its doorway and one
// down into a hole in the floor or base under it.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { SWING, buildGarage, buildingLayout, validateBuilding } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const DOOR = { wall: 'front', type: 'door', at: 60, width: 26, height: 50, leaf: 'panels', swing: true };
const HOUSE = { width: 160, depth: 120, height: 75, door: 'none', openings: [DOOR], upper: [{ height: 65, openings: [{ ...DOOR, at: 100, leaf: 'plain' }] }] };

test('only a square door with a leaf swings, and under the top of its wall', () => {
  const v = (o) => validateBuilding({ ...HOUSE, upper: [], openings: [{ ...DOOR, ...o }] });
  assert.equal(v({}).openings[0].swing, true);
  assert.equal(validateBuilding({ ...HOUSE, upper: [], openings: [{ ...DOOR, swing: undefined }] }).openings[0].swing, false);
  assert.throws(() => v({ swing: 'yes' }), /Choose whether/);
  assert.throws(() => v({ leaf: 'open' }), /square door with a leaf/);
  assert.throws(() => v({ shape: 'arch' }), /square door with a leaf/);
  assert.throws(() => v({ type: 'window', leaf: undefined, sill: 20, height: 20 }), /square door with a leaf/);
  assert.throws(() => v({ height: 75 - SWING.above + 1 }), new RegExp(SWING.above + ' mm under the top of the wall'));
});

test('a house with doors that swing prints clean, the leaves loose, the holes cut under them', () => {
  const fixed = { ...HOUSE, openings: [{ ...DOOR, swing: false }], upper: [{ height: 65, openings: [{ ...DOOR, at: 100, leaf: 'plain', swing: false }] }] };
  const volume = (parts, re) => parts.filter((p) => re.test(p.id)).reduce((t, p) => t + p.solid.volume(), 0);
  const plain = buildGarage(wasm, fixed, PLATE);
  const baseWas = volume(plain, /^base(-\d+)?$/),
    floorWas = volume(plain, /^floor2(-\d+)?$/);
  plain.forEach((p) => p.solid.delete());
  const parts = buildGarage(wasm, HOUSE, PLATE);
  try {
    checkKit(parts, PLATE);
    const leaves = parts.filter((p) => p.id.startsWith('leaf'));
    assert.deepEqual(leaves.map((p) => p.id), ['leaf-1', 'leaf2-1']);
    assert.deepEqual(buildingLayout(HOUSE).parts.filter((p) => p.id.startsWith('leaf')).map((p) => p.id), ['leaf-1', 'leaf2-1']);
    // Each leaf with its pins standing out past its top and bottom.
    for (const p of leaves) {
      const bb = p.solid.boundingBox();
      assert.ok(bb.max[2] - bb.min[2] > DOOR.height - 2 * SWING.play + SWING.length, p.id + ' has its pins');
    }
    const hole = SWING.pin + 2 * SWING.play;
    assert.ok(volume(parts, /^base(-\d+)?$/) < baseWas - hole * hole, 'a hole in the base');
    assert.ok(volume(parts, /^floor2(-\d+)?$/) < floorWas - hole * hole, 'a hole in the floor above');
    assert.match(kitNotes('House', validateBuilding(HOUSE), parts, {}), /Hang each door that swings/);
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});
