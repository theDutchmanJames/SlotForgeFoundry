// The pit building made of bays: each bay prints standing on its end
// without supports, the bays join with tabs, and the doors, numbers and
// railings fit where they go.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { PIT, buildPitModule, pitLevels, pitModuleLayout, validatePitModule } from '../src/geometry/pit-module.js';
import { buildingLayout, fitsPlate, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';
import { planShapes, shapeOf } from '../src/planner-buildings.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const VARIANTS = [{}, { door: 'roller', bays: 2 }, { bays: 1, depth: 70, lean: 0, visor: 0, balcony: 10 }, { lean: 25, visor: 20, recess: 15, doorWidth: 60, numbers: false, railing: false }];
const withParts = (settings, check) => {
  const parts = buildPitModule(wasm, settings);
  try {
    return check(parts, (id) => parts.find((p) => p.id === id));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const overAir = (part) => {
  const printed = printPose(part);
  const m = printed.getMesh();
  let over = 0;
  for (let i = 0; i < m.triVerts.length; i += 3) {
    const v = [0, 1, 2].map((k) => Array.from(m.vertProperties.subarray(m.triVerts[i + k] * m.numProp, m.triVerts[i + k] * m.numProp + 3)));
    const a = v[1].map((x, j) => x - v[0][j]),
      b = v[2].map((x, j) => x - v[0][j]);
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = Math.hypot(...n);
    if (n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
  }
  printed.delete();
  return over;
};

test('a pit building is checked', () => {
  const m = validateBuilding({ kind: 'pitmodule' });
  assert.deepEqual([m.bays, m.bayWidth, m.door, m.lean], [3, 110, 'panel', 15]);
  assert.throws(() => validatePitModule({ door: 'open' }), /up-and-over or a roller door/);
  assert.throws(() => validatePitModule({ bays: 0 }), /Bays must be between 1 and 24\./);
  assert.throws(() => validatePitModule({ lean: 40 }), /Glazing lean must be between 0 and 25°/);
  assert.throws(() => validatePitModule({ doorWidth: 90 }), /too wide for a bay of 110 mm with its reveal: at most 84 mm/);
  assert.throws(() => validatePitModule({ doorHeight: 60 }), /too high for the ground floor: at most 57 mm/);
  assert.throws(() => validatePitModule({ colour: 'red' }), /unknown setting: colour/);
  const ids = buildingLayout({ kind: 'pitmodule', bays: 2 }).parts.map((p) => p.id);
  assert.deepEqual(ids, ['bay-1', 'bay-2', 'end', 'door-1', 'door-2', 'number-1', 'number-2', 'rail-1', 'roofrail-1', 'roofback-1', 'rail-2', 'roofrail-2', 'roofback-2']);
});

test('every part is one body, fits the plate, takes no space of another, and prints without supports', () => {
  for (const settings of VARIANTS)
    withParts(settings, (parts) => {
      const label = JSON.stringify(settings);
      assert.deepEqual(parts.map((p) => p.id), pitModuleLayout(settings).parts.map((p) => p.id), 'built as laid out ' + label);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits: ' + printSize(p) + ' ' + label);
        // Bridged: only the top of each tab socket and of each railing pocket, a few mm across.
        const allowed = p.id.startsWith('bay') ? 80 : 0.5;
        assert.ok(overAir(p) <= allowed, p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
    });
});

test('the doors stand back in their reveals; the glazing leans out; the bays join with tabs', () => {
  withParts({}, (parts, part) => {
    const m = validatePitModule({}),
      L = pitLevels(m);
    const door = part('door-1').solid.boundingBox();
    assert.ok(near(door.max[1], m.recess) && near(door.min[2], L.floor) && near(door.max[0] - door.min[0], m.doorWidth), 'the door at the back of its reveal');
    // The reveal is wider at the front than at the door, at 45°.
    const bay = part('bay-1').solid;
    const probe = (x, y, z = L.floor + 20) => {
      const p = wasm.Manifold.cube([0.2, 0.2, 0.2]).translate([x, y, z]);
      const hit = bay.intersect(p),
        v = hit.volume();
      [p, hit].forEach((s) => s.delete());
      return v > 0;
    };
    const edge = m.bayWidth / 2 - m.doorWidth / 2;
    assert.ok(probe(edge - 1, m.recess - 0.5), 'the reveal\'s side beside the door');
    assert.ok(!probe(edge - 1, 0.3), 'open at the front, wider than the door');
    assert.ok(probe(edge - m.recess - 2, 0.3), 'the column beside the reveal');
    // The glazing's top stands out by its lean; the roof's visor beyond it.
    const box = bay.boundingBox();
    assert.ok(near(box.min[1], -Math.max(m.balcony, L.lean + m.visor), 0.05), 'the visor reaches out: ' + box.min[1]);
    assert.ok(near(L.lean, m.loungeHeight * Math.tan((15 * Math.PI) / 180)));
    // The balcony reaches out over the lane, under the glazing's top.
    assert.ok(probe(40, -m.balcony + 3, L.slab1 - 1) && probe(40, -10, L.slab1 - 1), 'the balcony in front of the doors');
    assert.ok(!probe(40, -m.balcony + 3, L.slab0 - 3), 'its fascia slopes away under its edge');
    // Under the pockets of the balcony railing there is still fascia: the
    // pockets do not break out through its sloping face.
    const rail = part('rail-1').solid.boundingBox();
    assert.ok(probe(m.bayWidth * 0.2, rail.min[1] - 0.5, L.slab1 - 1.3), 'fascia in front of the railing pocket');
    // A tab at the end of bay 1, its socket at the start of bay 2.
    assert.ok(near(box.max[0], m.bayWidth + PIT.tab[2], 0.05), 'tabs past the end of bay 1');
    assert.ok(near(part('bay-2').solid.boundingBox().min[0], m.bayWidth), 'bay 2 starts where bay 1 ends');
    assert.ok(near(part('end').solid.boundingBox().min[0], 3 * m.bayWidth));
  });
});

test('on the plan and in the notes', () => {
  const m = validatePitModule({ bays: 4 });
  const { outline, front } = shapeOf(m);
  assert.deepEqual(outline.at(2), [4 * 110 + PIT.shell, 150]);
  assert.deepEqual(front, { p: [220, 0], f: [0, -1] });
  const shapes = planShapes({ id: 'b-1', name: 'P', building: m, pose: { x: 0, y: 0, a: 0 } });
  assert.equal(shapes.dividers.length, 3);
  assert.equal(shapes.doors.length, 4);
  const notes = kitNotes('Pits', m, [{ id: 'bay-1', name: 'Bay 1 of 4' }], { 'bay-1': [133, 175, 114] });
  assert.match(notes, /4 bays, each 110 mm wide/);
  assert.match(notes, /Glue an up-and-over door into each doorway/);
  assert.match(notes, /- Bay 1 of 4: 133 × 175 × 114 mm/);
});
