// A walkway bridge between two buildings: a deck, two glazed sides in its
// grooves, a roof with rails, legs at its ends. Each part one body, flat to
// print, fitting the plate, clear of the others; the sides stand in the
// grooves, the legs' pins in the deck.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { WALKWAY, buildWalkway, validateWalkway, walkwayLayout } from '../src/geometry/walkway.js';
import { buildingCuts, fitsPlate, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';
import { planShapes, shapeOf } from '../src/planner-buildings.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const withParts = (settings, check) => {
  const parts = buildWalkway(wasm, settings);
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

test('a walkway is checked', () => {
  const w = validateBuilding({ kind: 'walkway' });
  assert.deepEqual([w.length, w.width, w.clearance, w.legs], [150, 32, 70, true]);
  assert.throws(() => validateWalkway({ length: 300 }), /Length must be between 40 and 180 mm/);
  assert.throws(() => validateWalkway({ waist: 20, height: 30 }), /the wall under them can be at most 17 mm/);
  assert.throws(() => validateWalkway({ length: 40, panes: 12 }), /Too many panes/);
  assert.throws(() => validateWalkway({ colour: 'red' }), /unknown setting: colour/);
  assert.deepEqual(walkwayLayout({}).parts.map((p) => p.id), ['deck', 'side-front', 'side-back', 'roof', 'leg-1', 'leg-2']);
  assert.equal(walkwayLayout({ width: 40 }).parts.length, 8, 'two legs at each end when wide enough');
  assert.deepEqual(walkwayLayout({ legs: false }).parts.map((p) => p.id), ['deck', 'side-front', 'side-back', 'roof']);
  assert.deepEqual(buildingCuts({ kind: 'walkway' }, PLATE), {});
});

test('every walkway: one body a part, flat to print, fitting the plate, clear of the others', () => {
  for (const settings of [{}, { width: 40, panes: 6 }, { legs: false, length: 180, clearance: 120, height: 50, waist: 20 }, { length: 40, width: 20, panes: 1 }])
    withParts(settings, (parts) => {
      const label = JSON.stringify(settings);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits ' + printSize(p) + ' ' + label);
        // Bridged: only the tops of the legs' pockets under the deck.
        const allowed = p.id === 'deck' ? 4 * (WALKWAY.pin[0] + 0.3) ** 2 + 2 : 0.5;
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

test('the sides stand in the grooves, windows between waist and beam; the roof on top; the legs under the deck', () => {
  const w = validateWalkway({});
  withParts({}, (parts, part) => {
    const z0 = w.clearance;
    const side = part('side-front').solid;
    assert.ok(near(side.boundingBox().min[2], z0 - WALKWAY.groove), 'its foot down in the groove');
    assert.ok(hits(side, 2, 1.5, z0 + 3) && !hits(side, 20, 1.5, z0 + w.waist + 5), 'a wall under a window, the window above');
    assert.ok(hits(side, 20, 1.5, z0 + w.height - 2), 'the beam over the windows');
    const roof = part('roof').solid.boundingBox();
    assert.ok(near(roof.max[2], z0 + w.height + WALKWAY.roof), 'the roof on top');
    const leg = part('leg-1').solid.boundingBox();
    assert.ok(near(leg.min[2], 0) && near(leg.max[2], z0 - WALKWAY.deck + WALKWAY.pin[1]), 'a leg from the table, its pin up in the deck');
  });
  const shape = shapeOf(w);
  assert.deepEqual(shape.outline[0], [0, -WALKWAY.ledge]);
  const plan = planShapes({ id: 'w-1', name: 'W', building: w, pose: { x: 0, y: 0, a: 0 } });
  assert.equal(plan.dividers.length, 2);
  const notes = kitNotes('Bridge', w, walkwayLayout({}).parts, {});
  assert.match(notes, /A covered walkway 150 mm long and 32 mm wide, its deck 70 mm above the table/);
  assert.match(notes, /Stand the two sides in the grooves along the deck/);
});

test('towers at the ends: each a building, a doorway where the walkway joins it, the whole piece clear and one body a part', () => {
  const w = validateWalkway({ towers: true });
  assert.throws(() => validateWalkway({ towers: true, towerDepth: 60, width: 60 }), /at least 70 mm deep/);
  assert.throws(() => validateWalkway({ towers: true, towerHeight: 90 }), /at least 108 mm high: over the walkway/);
  assert.throws(() => validateWalkway({ towerRoof: 'dome' }), /flat or a pyramid roof/);
  const ids = walkwayLayout({ towers: true }).parts.map((p) => p.id);
  assert.ok(ids.includes('tower1-roof-front') && ids.includes('tower2-base') && !ids.some((id) => /^leg/.test(id)), 'tower parts, no legs');
  for (const settings of [{ towers: true }, { towers: true, towerRoof: 'flat', towerWidth: 70, towerDepth: 80, length: 100, towerWindows: false }])
    withParts(settings, (parts, part) => {
      const label = JSON.stringify(settings);
      assert.deepEqual(parts.map((p) => p.id), walkwayLayout(settings).parts.map((p) => p.id), 'built as laid out ' + label);
      for (const p of parts) assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
      // The left tower stands against the walkway's start, its doorway open at the deck.
      const v = validateWalkway(settings);
      const right = part('tower1-right').solid;
      assert.ok(near(right.boundingBox().max[0], 0, 0.01), 'its wall at the walkway end');
      assert.ok(!hits(right, -1.5, v.width / 2, v.clearance + 5) && hits(right, -1.5, v.width / 2, v.clearance - 8), 'a doorway at the deck, wall under it');
      assert.ok(near(part('tower2-left').solid.boundingBox().min[0], v.length, 0.01), 'the right tower at the other end');
    });
  const notes = kitNotes('Towers', w, walkwayLayout({ towers: true }).parts, {});
  assert.match(notes, /Stand the two towers 150 mm apart, their doorways facing each other/);
  assert.deepEqual(shapeOf(w).outline[0], [-63, -17]);
});
