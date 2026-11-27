// Inside a building: partitions standing on its floors, a doorway in one, and
// stairs from one floor to the next through a stairwell in the floor above.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { INSIDE, buildGarage, buildingLayout, flightOf, storeyStack, validateBuilding } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const HOUSE = { width: 180, depth: 150, height: 75, door: 'none', upper: [{ height: 65 }] };

test('partitions and stairs are checked', () => {
  const p = (q) => validateBuilding({ ...HOUSE, partitions: [q] });
  assert.throws(() => p({ x0: 10, y0: 10, x1: 100, y1: 60 }), /along the width or the depth/);
  assert.throws(() => p({ x0: 10, y0: 80, x1: 20, y1: 80 }), /at least 20 mm long/);
  assert.throws(() => p({ x0: 1, y0: 80, x1: 120, y1: 80 }), /between its walls/);
  assert.throws(() => p({ storey: 2, x0: 10, y0: 80, x1: 120, y1: 80 }), /storey the building has not got/);
  assert.throws(() => p({ x0: 10, y0: 80, x1: 120, y1: 80, door: { at: 5, width: 20, height: 40 } }), /keeps 4 mm from each end/);
  assert.throws(() => p({ x0: 10, y0: 80, x1: 120, y1: 80, door: { at: 50, width: 20, height: 80 } }), /doorway is 15 to/);
  const s = (q) => validateBuilding({ ...HOUSE, stairs: [q] });
  assert.throws(() => s({ storey: 1, x: 100, y: 20 }), /climbs to a storey above/);
  assert.throws(() => s({ x: 2, y: 20 }), /inside the walls/);
  assert.throws(() => s({ x: 100, y: 20, rotation: 45 }), /a turn of 0, 90, 180 or 270/);
  assert.throws(() => validateBuilding({ ...HOUSE, stairs: [{ x: 100, y: 20 }, { x: 110, y: 30 }] }), /stands on stairs 1/);
});

test('a flight climbs from its floor to the next in steps no higher than allowed', () => {
  const b = validateBuilding({ ...HOUSE, stairs: [{ x: 140, y: 20 }] });
  const f = flightOf(b, b.stairs[0]);
  const [g, up] = storeyStack(b);
  assert.equal(f.floor, g.floor);
  assert.equal(f.top, up.floor);
  assert.ok(f.rise <= INSIDE.stair.rise + 1e-9 && f.steps * f.rise - (up.floor - g.floor) < 1e-9);
  assert.equal(f.run, f.steps * INSIDE.stair.tread);
  // Turned, its footprint turns.
  const turned = flightOf(b, { ...b.stairs[0], rotation: 90 });
  assert.deepEqual([turned.box[2] - turned.box[0], turned.box[3] - turned.box[1]], [f.run, INSIDE.stair.width]);
});

test('a house with partitions and stairs prints clean, the stairwell cut in the floor above, the notes telling it', () => {
  const b = { ...HOUSE, partitions: [{ storey: 0, x0: 4, y0: 80, x1: 120, y1: 80, door: { at: 60, width: 24, height: 45 } }, { storey: 1, x0: 100, y0: 4, x1: 100, y1: 146 }], stairs: [{ storey: 0, x: 140, y: 20, rotation: 0 }] };
  const plain = buildGarage(wasm, HOUSE, PLATE);
  const floorWas = plain.filter((p) => /^floor2(-\d+)?$/.test(p.id)).reduce((t, p) => t + p.solid.volume(), 0);
  plain.forEach((p) => p.solid.delete());
  const parts = buildGarage(wasm, b, PLATE);
  try {
    checkKit(parts, PLATE);
    for (const id of ['partition-1', 'partition-2', 'stairs-1']) assert.ok(parts.some((p) => p.id === id), id);
    assert.deepEqual(parts.map((p) => p.id).filter((id) => /^(partition|stairs)/.test(id)), buildingLayout(b).parts.map((p) => p.id).filter((id) => /^(partition|stairs)/.test(id)));
    const floorNow = parts.filter((p) => /^floor2(-\d+)?$/.test(p.id)).reduce((t, p) => t + p.solid.volume(), 0);
    assert.ok(floorNow < floorWas - 300, 'a stairwell in the floor above');
    // The top of the flight level with the floor above; the doorway cut in the partition.
    const vb = validateBuilding(b);
    const stairs = parts.find((p) => p.id === 'stairs-1').solid.boundingBox();
    assert.ok(Math.abs(stairs.max[2] - storeyStack(vb)[1].floor) < 1e-6);
    const pt = parts.find((p) => p.id === 'partition-1').solid;
    assert.ok(pt.volume() < (120 - 4) * INSIDE.thick * (75 - 3 - 1) - 20 * 40 * INSIDE.thick, 'its doorway cut out');
    const notes = kitNotes('House', vb, parts, {});
    assert.match(notes, /Glue each partition upright/);
    assert.match(notes, /under the stairwell in the floor above/);
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
  // A partition into a prop says so.
  assert.throws(() => buildGarage(wasm, { ...b, props: [{ type: 'crate', x: 50, y: 70, storey: 0 }] }, PLATE), /stands on/);
});
