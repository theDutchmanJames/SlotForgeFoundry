// A pit building of mixed bays: single storey, corporate box, podium. Each
// bay prints standing on its end without supports, one body; its closed side
// at the start is the wall between two garages and the fin of a frame; the
// bays join with tabs; doors, numbers and railings fit where they go.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { BAYS, buildPitBays, pitBaysLayout, pitBaysLevels, validatePitBays } from '../src/geometry/pit-bays.js';
import { buildingLayout, fitsPlate, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';
import { planShapes, shapeOf } from '../src/planner-buildings.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const VARIANTS = [
  {},
  { types: ['single', 'box', 'box', 'podium', 'single'] },
  { types: ['podium'], door: 'roller', pillars: false, lean: 0 },
  { types: ['box', 'single', 'box'], depth: 75, setBack: 10, jut: 30, balcony: 40, lean: 25, numbers: false, roofRailing: false },
  { types: ['box', 'box'], balcony: 0, balconyRailing: true },
];
const withParts = (settings, check) => {
  const parts = buildPitBays(wasm, settings);
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
const hits = (solid, x, y, z, size = 0.2) => {
  const p = wasm.Manifold.cube([size, size, size]).translate([x - size / 2, y - size / 2, z - size / 2]);
  const hit = solid.intersect(p),
    v = hit.volume();
  [p, hit].forEach((s) => s.delete());
  return v > 0;
};

test('a pit building of mixed bays is checked', () => {
  const m = validateBuilding({ kind: 'pitbays' });
  assert.deepEqual(m.types, ['box', 'box', 'box']);
  assert.throws(() => validatePitBays({ types: [] }), /1 to 24 bays/);
  assert.throws(() => validatePitBays({ types: ['box', 'tent'] }), /Bay 2 must be single storey, a corporate box or a podium/);
  assert.throws(() => validatePitBays({ doorWidth: 100 }), /too wide for a bay of 110 mm: at most 84 mm/);
  assert.throws(() => validatePitBays({ doorHeight: 60 }), /at most 53 mm, room left over it for a number/);
  assert.throws(() => validatePitBays({ lean: 25, jut: 0, setBack: 4 }), /leans out past the roof/);
  assert.throws(() => validatePitBays({ types: ['podium'], depth: 170 }), /would be 208 mm long: at most 190 mm/);
  assert.throws(() => validatePitBays({ types: ['podium'], balcony: 4 }), /podium needs a balcony of at least 8 mm/);
  assert.throws(() => validatePitBays({ upperHeight: 28 }), /Upper storey height must be between 30/);
  assert.throws(() => validatePitBays({ colour: 'red' }), /unknown setting: colour/);
  const ids = buildingLayout({ kind: 'pitbays', types: ['single', 'box'] }).parts.map((p) => p.id);
  assert.deepEqual(ids, ['bay-1', 'bay-2', 'end', 'door-1', 'door-2', 'number-1', 'number-2', 'roofback-1', 'roofleft-1', 'roofright-1', 'rail-2', 'roofback-2', 'roofleft-2', 'roofright-2']);
  const podium = pitBaysLayout({ types: ['podium'] }).parts;
  assert.match(podium[0].name, /Bay 1 of 1, podium/);
  assert.deepEqual(podium.map((p) => p.id).filter((id) => /podium|^rail/.test(id)), ['podium-1', 'rail-1-1', 'rail-1-2', 'rail-1-3']);
});

test('every part is one body, fits the plate, takes no space of another, and prints without supports', () => {
  for (const settings of VARIANTS)
    withParts(settings, (parts) => {
      const label = JSON.stringify(settings);
      assert.deepEqual(parts.map((p) => p.id), pitBaysLayout(settings).parts.map((p) => p.id), 'built as laid out ' + label);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits: ' + printSize(p) + ' ' + label);
        // Bridged: only the tops of the tab sockets and of the railing pockets, a few mm² each.
        const allowed = p.id.startsWith('bay') ? 100 : 0.5;
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

test('a box: glazing leaning out, set back between fins under a roof that reaches out, a balcony in front; a lower bay next to it closes its side', () => {
  const m = validatePitBays({ types: ['box', 'single', 'podium'] });
  const L = pitBaysLevels(m);
  withParts(m, (parts, part) => {
    const box = part('bay-1').solid,
      single = part('bay-2').solid;
    const mid = (L.slab1 + L.roof0) / 2;
    // The roof reaches out over the lane, its upstand along the front.
    assert.ok(hits(box, 50, -m.jut + 1, L.roof1 - 1) && hits(box, 50, -m.jut + 2, L.roof1 + BAYS.upstand - 1), 'the roof reaching out, its upstand');
    // The glazing leans out: further forward at its top than at its foot.
    assert.ok(hits(box, 50, m.setBack + 1.5, L.slab1 + 2) && !hits(box, 50, m.setBack - 2, L.slab1 + 2), 'the foot of the glazing set back');
    assert.ok(hits(box, 50, m.setBack - L.lean + 1.5, L.roof0 - 1), 'its top leaning out');
    // The fin at the start of the bay: narrow at its foot, out to the front of the roof at its top.
    assert.ok(hits(box, 2, m.setBack - 3, L.slab1 + 1) && !hits(box, 2, -m.jut + 2, L.slab1 + 1), 'the fin narrow at its foot');
    assert.ok(hits(box, 2, -m.jut + 1, L.roof0 - 1), 'and wide at its top');
    // A pillar between two garages, standing out of the front.
    assert.ok(hits(single, m.bayWidth + 3, -BAYS.pillar + 1, L.floor + 20), 'a pillar');
    // A podium: its platform reaching out past the balcony, the podium on it.
    const podium = part('bay-3').solid;
    assert.ok(hits(podium, 2 * m.bayWidth + 55, -m.balcony - BAYS.podium[0] + 1, L.slab0 + 2), 'the platform');
    assert.ok(part('podium-3').solid.boundingBox().min[2] > L.slab1 - 0.01, 'the podium on it');
    // The balcony slab in front, under the glazing.
    assert.ok(hits(box, 50, -m.balcony + 1, L.slab1 - 1), 'the balcony');
    // The single bay after it: its start closes the box's side above its roof.
    assert.ok(hits(single, m.bayWidth + 2, 50, mid), 'the box closed on its side by the next bay');
    assert.ok(!hits(single, m.bayWidth + 50, 50, mid), 'the single storey under open sky');
    // The door at the back of its reveal; a number over it.
    const door = part('door-1').solid.boundingBox();
    assert.ok(near(door.max[1], m.recess) && near(door.min[2], L.floor));
    const num = part('number-1').solid.boundingBox();
    assert.ok(num.min[2] > L.door && num.max[2] < L.slab0, 'the number between the door and the floor above');
    // Tabs at the end of bay 1 into bay 2.
    assert.ok(near(box.boundingBox().max[0], m.bayWidth + BAYS.tab[2], 0.05), 'tabs past the end of bay 1');
  });
});

test('on the plan and in the notes', () => {
  const m = validatePitBays({ types: ['single', 'box', 'podium', 'box'] });
  const { outline, front } = shapeOf(m);
  assert.deepEqual(outline.at(2), [4 * 110 + BAYS.side, 150]);
  assert.deepEqual(front, { p: [220, 0], f: [0, -1] });
  const shapes = planShapes({ id: 'b-1', name: 'P', building: m, pose: { x: 0, y: 0, a: 0 } });
  assert.equal(shapes.dividers.length, 3);
  assert.equal(shapes.doors.length, 4);
  const notes = kitNotes('Pits', m, pitBaysLayout(m).parts, {});
  assert.match(notes, /4 bays, each 110 mm wide, 150 mm deep: 1 single storey, 2 corporate box, 3 podium, 4 corporate box/);
  assert.match(notes, /Glue each podium on its platform/);
  assert.match(notes, /The closed side at the start of each bay is the wall between two garages/);
});
