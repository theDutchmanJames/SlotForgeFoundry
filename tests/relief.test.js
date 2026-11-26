// Relief on the outside of the walls: a plinth, a cornice, pilasters and
// recessed panels. It stands out from the face (or sinks into it), runs on
// round the corners mitred, keeps clear of every opening, and the walls
// still print flat without supports.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { RELIEF, buildGarage, fitsPlate, printPose, printSize, validateBuilding } from '../src/geometry/building.js';

const wasm = await Module();
wasm.setup();
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
const hits = (solid, x, y, z, size = 0.2) => {
  const p = wasm.Manifold.cube([size, size, size]).translate([x - size / 2, y - size / 2, z - size / 2]);
  const hit = solid.intersect(p),
    v = hit.volume();
  [p, hit].forEach((s) => s.delete());
  return v > 0;
};
const WINDOW = { wall: 'front', type: 'window', at: 60, width: 30, height: 25, sill: 25, frame: true };
const CASES = [
  { door: 'none', width: 120, depth: 90, height: 70, plinth: 6, cornice: 5, pilasters: 40, panels: true, wallTexture: 'brick', openings: [WINDOW] },
  { width: 120, depth: 180, plinth: 5, pilasters: 60, roof: 'gable', cornice: 4 },
  { door: 'none', width: 100, depth: 100, height: 60, cornice: 6, upper: [{ height: 40, pilasters: 30, panels: true, lean: 10, wallTexture: 'block' }] },
  { door: 'none', width: 90, depth: 80, height: 50, open: true, waist: 20, plinth: 4, cornice: 4, pilasters: 25, roof: 'hip' },
];

test('relief is checked', () => {
  assert.throws(() => validateBuilding({ plinth: 30 }), /The plinth must be 0 to 20 mm high/);
  assert.throws(() => validateBuilding({ door: 'none', height: 30, plinth: 12, cornice: 12 }), /leave too little wall: together at most 20 mm/);
  assert.throws(() => validateBuilding({ pilasters: 10 }), /Pilasters stand 20 to 300 mm apart, or 0 for none/);
  assert.throws(() => validateBuilding({ panels: 'yes' }), /recessed panels/);
  assert.throws(() => validateBuilding({ sign: 'fascia', cornice: 5, door: 'none' }), /sign and the cornice/);
  assert.throws(() => validateBuilding({ numbers: true, pilasters: 40 }), /bay numbers sit on the wall/);
  assert.throws(() => validateBuilding({ door: 'none', upper: [{ cornice: 25 }] }), /cornice, storey 2 must be 0 to 20/);
});

test('walls with relief: one body each, flat to print over no air, nothing in another part', () => {
  for (const b of CASES)
    withParts(b, (parts) => {
      const label = JSON.stringify(b).slice(0, 90);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits ' + label);
      }
      for (const p of parts.filter((q) => /^(front|back|left|right)/.test(q.id))) {
        assert.ok(printSize(p)[2] < 3 + RELIEF.depth + 1.2, p.name + ' lies flat ' + printSize(p) + ' ' + label);
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

test('bands run round the corners, pilasters stand out, panels sink in, all clear of the window', () => {
  const b = validateBuilding(CASES[0]);
  const top = b.baseHeight,
    d = RELIEF.depth;
  withParts(b, (parts, part) => {
    const front = part('front').solid,
      left = part('left').solid;
    // The plinth stands out of the front, and on round the corner on the left wall: the corner closed.
    assert.ok(hits(front, 30, -d / 2, top + 3) && hits(left, -d / 2, 30, top + 3), 'the plinth on both walls');
    assert.ok(hits(front, -d / 2 + 0.3, -d / 2, top + 3) || hits(left, -d / 2, -d / 2 + 0.3, top + 3), 'and at the corner');
    // The cornice under the eaves.
    assert.ok(hits(front, 30, -d / 2, top + b.height - 2), 'the cornice');
    // A corner pilaster from the plinth up to the cornice.
    assert.ok(hits(front, 3, -d / 2, top + 35), 'a pilaster at the corner');
    // Clear of the window and its frame: no relief in front of it.
    assert.ok(!hits(front, 60, -d / 2, top + 37), 'clear of the window');
    // A recessed panel between pilasters, where there is no window.
    assert.ok(!hits(left, 0.4, 25, top + 35) && hits(left, 1.5, 25, top + 35), 'a panel sunk in the left wall');
  });
});
