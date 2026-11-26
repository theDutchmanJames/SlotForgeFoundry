// Walls that lean out at the top, like a control-tower cab, and an open
// band split into panes. Everything of a leaning storey widens with its
// height the same way, so its parts still meet, and each wall and frame
// lies flat to print at its new angle.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { LEAN, OPEN, buildGarage, fitsPlate, printPose, printSize, storeyStack, validateBuilding } from '../src/geometry/building.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const withParts = (settings, check) => {
  const parts = buildGarage(wasm, settings, PLATE);
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
const LEANING = [
  { door: 'none', width: 80, depth: 70, height: 40, lean: 15, open: true, waist: 15, panes: 3 },
  { door: 'none', width: 100, depth: 100, height: 60, upper: [{ width: 80, depth: 80, x: 10, y: 10, height: 40, lean: 20, wallTexture: 'brick', openings: [{ wall: 'front', type: 'window', at: 40, width: 40, height: 20, sill: 10, frame: true }] }] },
  BUILDING_PRESETS.find((p) => p.id === 'tower').building,
];

test('leaning walls and panes are checked', () => {
  assert.throws(() => validateBuilding({ door: 'none', lean: 40 }), new RegExp('lean out 0 to ' + LEAN.most + '°'));
  assert.throws(() => validateBuilding({ door: 'none', lean: 10, upper: [{}] }), /Only the top storey can have walls that lean out: not the ground floor/);
  assert.throws(() => validateBuilding({ door: 'none', lean: 10, roof: 'gable' }), /carry a flat roof/);
  assert.throws(() => validateBuilding({ lean: 10 }), /no garage door and one room/);
  assert.throws(() => validateBuilding({ door: 'none', height: 120, lean: 25 }), /lean out too far: at most 25 mm/);
  assert.throws(() => validateBuilding({ door: 'none', lean: 10, openings: [{ wall: 'front', type: 'window', at: 60, sill: 20, counter: true }] }), /no counters or flaps/);
  assert.throws(() => validateBuilding({ door: 'none', open: true, panes: 9 }), /1 to 8 panes/);
  assert.throws(() => validateBuilding({ door: 'none', width: 60, depth: 60, open: true, panes: 8 }), /Too many panes/);
  // Panes: the open band of each wall in as many openings, mullions between them.
  const s = storeyStack(validateBuilding({ door: 'none', width: 120, depth: 100, open: true, panes: 3 }))[0];
  const front = s.openings.filter((o) => o.wall === 'front');
  assert.equal(front.length, 3);
  assert.ok(near(front[1].at - front[0].at - front[0].width, OPEN.mullion), 'a mullion between two panes');
  assert.ok(near(front[0].at - front[0].width / 2, OPEN.post) && near(front[2].at + front[2].width / 2, 120 - OPEN.post), 'posts at the corners');
});

test('a leaning storey: one body a part, fitting the plate, flat to print, nothing in another part', () => {
  for (const b of LEANING)
    withParts(b, (parts) => {
      const label = JSON.stringify(b).slice(0, 80);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits ' + printSize(p) + ' ' + label);
      }
      // Walls and frames lie flat: as thin as they are, over no air.
      for (const p of parts.filter((q) => /^(front|back|left|right|frame)/.test(q.id))) {
        assert.ok(printSize(p)[2] < 4.5, p.name + ' lies flat: ' + printSize(p) + ' ' + label);
        assert.ok(overAir(p) <= 0.5, p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
    });
});

test('the walls lean out from the floor up; the roof is as wide as their tops', () => {
  const b = validateBuilding({ door: 'none', width: 80, depth: 80, height: 40, lean: 15 });
  const k = 40 * Math.tan((15 * Math.PI) / 180);
  withParts(b, (parts, part) => {
    const front = part('front').solid.boundingBox();
    assert.ok(near(front.min[1], -k, 0.05), 'the front wall out by ' + k.toFixed(2) + ' at the top: ' + front.min[1]);
    // At the floor it has not moved.
    const probe = wasm.Manifold.cube([1, 0.2, 0.2]).translate([40, 0.1, b.baseHeight + 0.1]);
    const hit = part('front').solid.intersect(probe);
    assert.ok(hit.volume() > 0, 'at the floor where it stood');
    [probe, hit].forEach((s) => s.delete());
    const roof = part('roof').solid.boundingBox();
    assert.ok(roof.min[0] < -k - b.overhangLeft + 0.5, 'the roof over the tops of the walls');
  });
});
