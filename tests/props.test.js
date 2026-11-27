// Props: each prop printing flat without supports however it is turned; a
// kit of props on its own; props in and around a building, checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildGarage, buildingLayout, validateBuilding, printSize } from '../src/geometry/building.js';
import { PROPS, placeProp, propFootprint } from '../src/geometry/props.js';
import { propsFootprint } from '../src/geometry/props-kit.js';
import { footprint } from '../src/planner-buildings.js';
import { kitNotes } from '../src/building-kit.js';
import { checkKit, overAir } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const withParts = (b, fn) => {
  const parts = buildGarage(wasm, b, PLATE);
  try {
    fn(parts, (id) => parts.find((p) => p.id === id));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};

test('every prop, turned any way, is whole, clear of itself and prints without supports, as big as it says', () => {
  for (const p of PROPS)
    for (const rotation of [0, 90, 180, 270]) {
      const temp = [],
        own = (s) => (temp.push(s), s);
      try {
        const parts = placeProp(wasm, own, { type: p.id, x: 10, y: 20, rotation }, 5).map((q) => ({ id: 'prop-' + q.key, name: p.name + ' ' + q.name, solid: q.solid, turn: q.pose }));
        checkKit(parts, PLATE, p.id + ' at ' + rotation + '°: ');
        // A real solid each: an invalid one would pass as one body.
        for (const q of parts) assert.ok(q.solid.status() === 'NoError' && q.solid.volume() > 1, p.id + ' ' + q.name + ' is a solid at ' + rotation + '°');
        for (const q of parts) assert.ok(overAir(q) < 0.5, p.id + ' ' + q.name + ' prints over air at ' + rotation + '°');
        // On its footprint, standing on the floor.
        const [fw, fd] = propFootprint(p.id, rotation);
        const lo = [Infinity, Infinity, Infinity],
          hi = [-Infinity, -Infinity, -Infinity];
        for (const q of parts) {
          const { min, max } = q.solid.boundingBox();
          for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], min[k])), (hi[k] = Math.max(hi[k], max[k]));
        }
        assert.ok(lo[0] >= 10 - 1.01 && hi[0] <= 10 + fw + 1.01 && lo[1] >= 20 - 1.01 && hi[1] <= 20 + fd + 1.01, p.id + ' within its footprint at ' + rotation + '°');
        assert.ok(lo[2] >= 5 - 2.01, p.id + ' on the floor');
        // Small parts, as small as they look.
        for (const q of parts) assert.ok(printSize(q).every((v) => v < 60), p.id + ' ' + q.name + ' size');
      } finally {
        temp.forEach((s) => s.delete());
      }
    }
});

test('a kit of props: so many of each in a row, named, on the plate, with its notes', () => {
  const b = { kind: 'props', items: [{ type: 'tyre-stack', count: 3 }, { type: 'workbench', count: 1 }, { type: 'pit-board', count: 2 }] };
  const ids = buildingLayout(b).parts.map((p) => p.id);
  assert.deepEqual(ids, ['tyre-stack-1', 'tyre-stack-2', 'tyre-stack-3', 'workbench-1-top', 'workbench-1-end-1', 'workbench-1-end-2', 'workbench-1-shelf', 'pit-board-1-board', 'pit-board-1-foot', 'pit-board-2-board', 'pit-board-2-foot']);
  withParts(b, (parts) => checkKit(parts, PLATE, 'kit: '));
  const [x0, y0, x1, y1] = propsFootprint(b);
  assert.deepEqual([x0, y0], [0, 0]);
  assert.equal(x1, 3 * 19 + 44 + 2 * 14 + 5 * 4);
  assert.equal(y1, 19);
  assert.equal(footprint({ building: b, pose: { x: 0, y: 0, a: 0 } }).length, 4);
  const notes = kitNotes('Pit props', validateBuilding(b), buildingLayout(b).parts, {});
  assert.match(notes, /3 × stack of tyres, 1 × workbench, 2 × pit board/);
  assert.match(notes, /A workbench: stand its two end frames up/);
  assert.throws(() => validateBuilding({ kind: 'props', items: [] }), /1 to 22 kinds/);
  assert.throws(() => validateBuilding({ kind: 'props', items: [{ type: 'cone', count: 13 }] }), /1 to 12/);
  assert.throws(() => validateBuilding({ kind: 'props', items: [{ type: 'cone', count: 1 }, { type: 'cone', count: 2 }] }), /twice/);
});

test('props in and around a building: on its floors and the table, clear of each other and all else', () => {
  const b = {
    door: 'none',
    upper: [{ height: 60 }],
    props: [
      { type: 'workbench', x: 20, y: 150, storey: 0 },
      { type: 'tool-chest', x: 30, y: 40, rotation: 90 },
      { type: 'crate', x: 40, y: 60, storey: 1 },
      { type: 'cone', x: 20, y: -30, storey: -1 },
    ],
  };
  withParts(b, (parts, part) => {
    checkKit(parts, PLATE, 'building props: ');
    // The crate on the floor of storey 2, the cone on the table.
    assert.ok(part('prop-3').solid.boundingBox().min[2] > 10 + 75, 'on the floor of storey 2');
    assert.ok(Math.abs(part('prop-4').solid.boundingBox().min[2]) < 1e-6, 'on the table');
  });
  // On a stand, a prop on the table stays on the table.
  withParts({ door: 'none', standType: 'legs', standHeight: 40, props: [{ type: 'barrier', x: 0, y: -20, storey: -1 }] }, (parts, part) => {
    assert.ok(Math.abs(part('prop-1').solid.boundingBox().min[2]) < 1e-6);
  });
  const notes = kitNotes('Garage', validateBuilding(b), buildingLayout(b).parts, {});
  assert.match(notes, /Glue each prop where it stands/);
  assert.match(notes, /Props print as they lie/);
});

test('props that do not fit are refused, saying why', () => {
  const v = (props, extra = {}) => validateBuilding({ door: 'none', props, ...extra });
  assert.throws(() => v([{ type: 'workbench', x: 1, y: 100 }]), /stands inside the ground floor, 2 mm clear of its walls/);
  assert.throws(() => v([{ type: 'cone', x: 10, y: 10, storey: -1 }]), /clear of the base/);
  assert.throws(() => v([{ type: 'cone', x: 400, y: 10, storey: -1 }]), /at most 150 mm from the building/);
  assert.throws(() => v([{ type: 'crate', x: 30, y: 30 }, { type: 'crate', x: 40, y: 40 }]), /stands on prop 1/);
  assert.throws(() => v([{ type: 'pit-board', x: 30, y: 30 }], { height: 40 }), /too tall for the ground floor/);
  assert.throws(() => v([{ type: 'crate', x: 30, y: 30, storey: 2 }]), /a storey the building has not got/);
  assert.throws(() => v([{ type: 'crate', x: 30, y: 30, rotation: 45 }]), /0, 90, 180 or 270/);
  // Into a dividing wall: refused when the building is made.
  assert.throws(() => withParts({ door: 'none', rooms: { along: 'width', sizes: [60, 60] }, props: [{ type: 'crate', x: 50, y: 60 }] }, () => {}), /runs into the dividing wall: move it/);
});

test('the braking boards kit: its signs, and how they go together', () => {
  const b = { kind: 'props', items: [{ type: 'brake-150', count: 2 }, { type: 'chevron-left', count: 1 }, { type: 'pit-in', count: 1 }] };
  const ids = buildingLayout(b).parts.map((p) => p.id);
  assert.deepEqual(ids, ['brake-150-1-board', 'brake-150-1-foot', 'brake-150-2-board', 'brake-150-2-foot', 'chevron-left-1-board', 'chevron-left-1-foot', 'pit-in-1-board', 'pit-in-1-foot']);
  withParts(b, (parts) => checkKit(parts, PLATE, 'signs: '));
  const notes = kitNotes('Braking boards', validateBuilding(b), buildingLayout(b).parts, {});
  assert.match(notes, /A sign: push its two posts into the sockets in its foot/);
  assert.match(notes, /a pit board and a sign on their backs/);
});
