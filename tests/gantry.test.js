// Gantries and bridges over the track: a start gantry, a half gantry and a
// footbridge, each printing without supports, and spanning a straight.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { GANTRY, buildGantry, gantryLayout, stairOf, validateGantry } from '../src/geometry/gantry.js';
import { fitsPlate, printPose, printSize } from '../src/geometry/building.js';
import { OVER_CLEAR, overGantry, overPose, overlap, straightAcross, toPlan } from '../src/planner-buildings.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const VARIANTS = [{}, { type: 'half', reach: 180 }, { type: 'bridge' }, { span: 400, lights: 0, board: false }, { type: 'bridge', span: 300, clearance: 100 }];
const withParts = (settings, plate, check) => {
  const parts = buildGantry(wasm, { kind: 'gantry', ...settings }, plate);
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

test('a gantry is checked', () => {
  const g = validateGantry({});
  assert.deepEqual([g.type, g.span, g.clearance, g.lights], ['start', 220, 70, 5]);
  assert.throws(() => validateGantry({ type: 'arch' }), /start gantry, a half gantry or a footbridge/);
  assert.throws(() => validateGantry({ span: 30 }), /Span must be between 60 and 1200 mm/);
  assert.throws(() => validateGantry({ span: 60, lights: 10 }), /no room for 10 start lights on a beam of 60 mm: at most 7/);
  assert.throws(() => validateGantry({ lights: 2.5 }), /whole number/);
  assert.deepEqual(gantryLayout({ type: 'bridge' }).parts.map((p) => p.id), ['stair-1', 'stair-2', 'deck']);
  assert.equal(stairOf(validateGantry({ clearance: 70 })).steps, 10);
});

test('every part is one body, fits the plate, takes no space of another, and prints without supports', () => {
  for (const settings of VARIANTS)
    withParts(settings, PLATE, (parts) => {
      const label = JSON.stringify(settings);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits: ' + printSize(p) + ' ' + label);
        // Only the top of a pin socket in the beam is bridged, 6.3 mm across.
        const sockets = p.id.startsWith('beam') ? 2 * (GANTRY.pin[0] + 0.3) * (GANTRY.pin[1] + 0.2 + 1) : 0;
        assert.ok(overAir(p) <= sockets + 1, p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
    });
});

test('the beam drops onto the pins of the legs; the walkway lies on the landings', () => {
  withParts({}, null, (_, part) => {
    const leg = part('leg-1').solid.boundingBox(),
      beam = part('beam').solid.boundingBox();
    assert.ok(near(leg.max[2], 70 + GANTRY.pin[1]), 'the pin stands above the clearance: ' + leg.max[2]);
    assert.ok(near(beam.min[2], 70), 'the beam sits at the clearance');
  });
  withParts({ type: 'bridge' }, null, (_, part) => {
    const stair = part('stair-1').solid.boundingBox(),
      deck = part('deck').solid.boundingBox();
    assert.ok(near(stair.max[2], 70) && near(deck.min[2], 70));
    assert.ok(deck.min[0] < stair.max[0] - 10, 'the walkway reaches onto the landing');
  });
});

test('over a straight a gantry takes its width, its span centred on the road, its feet clear of it', () => {
  // A straight 300 long along x, 110 wide, borders included.
  const road = [[[0, -55], [300, -55], [300, 55], [0, 55]]];
  const over = straightAcross({ xy: [0, 0] }, { xy: [300, 0] }, road);
  assert.ok(near(over.width, 110) && near(over.at[0], 150) && near(over.at[1], 0));
  for (const type of ['start', 'half', 'bridge']) {
    const building = overGantry(validateGantry({ type }), over.width);
    assert.equal(building.span, 110 + 2 * OVER_CLEAR + (type === 'bridge' ? 0 : GANTRY.foot[0] - GANTRY.leg));
    const entry = { id: 'b-1', name: 'G', building, pose: overPose(building, over) };
    assert.ok(overlap(entry, road) < 0.5, type + ': its feet stand clear of the road');
  }
  // The start gantry's legs stand each side of the road, the span's middle on its middle.
  const start = overGantry(validateGantry({}), over.width);
  const entry = { id: 'b-1', name: 'G', building: start, pose: overPose(start, over) };
  const left = toPlan(entry, [GANTRY.foot[0] / 2, GANTRY.foot[0] / 2]);
  assert.ok(near(left[0], 150, 0.01) && left[1] < -55, 'a leg beside the road: ' + left);
});

test('lattice members: legs as tubes and the beam as a girder opened with diamonds, one body each, printing without supports', async () => {
  const { GANTRY, legOf } = await import('../src/geometry/gantry.js');
  const { fitsPlate, printPose, printSize } = await import('../src/geometry/building.js');
  const over = (part) => {
    const printed = printPose(part);
    const m = printed.getMesh();
    let a = 0;
    for (let i = 0; i < m.triVerts.length; i += 3) {
      const v = [0, 1, 2].map((k) => Array.from(m.vertProperties.subarray(m.triVerts[i + k] * m.numProp, m.triVerts[i + k] * m.numProp + 3)));
      const p = v[1].map((x, j) => x - v[0][j]),
        q = v[2].map((x, j) => x - v[0][j]);
      const n = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
      const len = Math.hypot(...n);
      if (n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) a += len / 2;
    }
    printed.delete();
    return a;
  };
  const plate = { width: 200, depth: 200, margin: 0 };
  for (const settings of [{ members: 'lattice' }, { members: 'lattice', type: 'half', reach: 180 }, { members: 'lattice', type: 'bridge' }, { members: 'lattice', lights: 0, span: 400 }]) {
    const parts = buildGantry(wasm, settings, plate);
    try {
      const label = JSON.stringify(settings);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), plate), p.name + ' fits ' + label);
        // Bridged: only the tops of the pin sockets in the beam.
        assert.ok(over(p) <= (p.id.startsWith('beam') ? 30 : 0.5), p.name + ' prints ' + over(p).toFixed(1) + ' mm² over air ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
  // Opened: a lattice leg is a tube with diamonds, far lighter than it would be solid.
  const parts = buildGantry(wasm, { members: 'lattice' });
  try {
    const L = legOf({ members: 'lattice' });
    assert.equal(L, GANTRY.lattice.leg);
    assert.ok(parts.find((p) => p.id === 'leg-1').solid.volume() < 0.75 * L * L * 70, 'a tube with diamonds, far lighter than a solid column');
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
  assert.throws(() => validateGantry({ members: 'wood' }), /solid or lattice/);
});
