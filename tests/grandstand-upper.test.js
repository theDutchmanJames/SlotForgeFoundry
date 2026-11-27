// A grandstand with an upper tier: a stand on the table and another behind
// it, raised on braced frames so its first row is level with the top of the
// back wall in front of it; the staircases and railings are the upper one's.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { STAND, buildGrandstand, grandstandLayout, sizeLine, standDepth, standExtent, standHeight, tiers, validateGrandstand } from '../src/geometry/grandstand.js';
import { buildGarage } from '../src/geometry/building.js';
import { shapeOf } from '../src/planner-buildings.js';
import { kitNotes } from '../src/building-kit.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
// A section's slots for the tabs of the one before it bridge 2 mm as it stands on its end, as in every stand.
const bridges = (p) => (/grandstand section/i.test(p.name) ? 35 : 0.5);
const DOUBLE = { kind: 'grandstand', length: 300, rows: 5, upperTier: 4, aisles: 1, backHeight: 12, stairs: 'both', railings: true, backrests: true };

test('an upper tier is checked', () => {
  assert.throws(() => validateGrandstand({ upperTier: 1.5 }), /whole numbers/);
  assert.throws(() => validateGrandstand({ upperTier: 13 }), /Upper tier rows must be between 0 and 12\./);
  assert.throws(() => validateGrandstand({ upperTier: 3, curve: { radius: 450, angle: 45, facing: 'in' } }), /straight stand of a stepped shell/);
  assert.throws(() => validateGrandstand({ upperTier: 3, roof: 'canopy' }), /open to the sky/);
  assert.throws(() => validateGrandstand({ upperTier: 3, raised: 30 }), /on the table/);
  assert.throws(() => validateGrandstand({ upperTier: 3, build: 'frames', benchStyle: 'wood' }), /stepped shell/);
  // Too many rows below: the upper tier would stand too high on its frames.
  assert.throws(() => validateGrandstand({ upperTier: 3, rows: 12 }), /stand \d+ mm up on its frames/);
  assert.throws(() => validateGrandstand({ upperTier: 2, rows: 1, frontHeight: 6, backHeight: 10 }), /between 20 and 100 mm/);
});

test('the upper tier stands behind the lower one, its first row level with the top of the back wall', () => {
  const g = validateGrandstand(DOUBLE);
  const { lower, upper, behind } = tiers(g);
  assert.equal(behind, standDepth(lower));
  assert.equal(lower.stairs, 'none');
  assert.equal(lower.railings, false);
  assert.equal(upper.rows, 4);
  assert.ok(near(upper.raised + upper.frontHeight, standHeight(lower)), 'the first upper row level with the lower back wall');
  assert.ok(near(standHeight(g), standHeight(upper)));
  const [x0, y0, x1, y1] = standExtent(g);
  assert.ok(x0 < 0 && x1 > g.length, 'its staircases beside it');
  assert.ok(near(y1, behind + standDepth(upper) + STAND.rail.bar), 'out to the upper back railing');
  assert.ok(y0 <= 0);
  assert.deepEqual(shapeOf(g).box, [x0, y0, x1, y1]);
  assert.match(sizeLine(g), /5 rows and 4 on an upper tier/);
});

test('a double-deck stand prints: every part one body, flat or on its end, nothing in another; the layout names them all', () => {
  const parts = buildGarage(wasm, DOUBLE, PLATE);
  try {
    assert.deepEqual(parts.map((p) => p.id), grandstandLayout(DOUBLE).parts.map((p) => p.id));
    checkKit(parts, PLATE, '', bridges);
    const g = validateGrandstand(DOUBLE);
    const { behind, upper } = tiers(g);
    // Staircases and railings on the upper tier only, frames under it.
    assert.ok(parts.some((p) => p.id === 'upper-stair-left') && parts.some((p) => p.id === 'upper-stair-right'));
    assert.ok(!parts.some((p) => /^(stair|rail|frame)/.test(p.id)), 'none on the lower tier');
    const frame = parts.find((p) => p.id === 'upper-frame-front-1').solid.boundingBox();
    assert.ok(near(frame.min[1], behind) && near(frame.max[2], upper.raised), 'the upper frames behind the lower back wall, as high as the tier is raised');
    const lowerBack = parts.find((p) => p.id === 'stand-1').solid.boundingBox();
    assert.ok(lowerBack.max[1] <= behind + 1e-6, 'the lower tier in front');
    // Its notes.
    const notes = kitNotes('Double', g, parts, {});
    assert.match(notes, /an upper tier of 4 behind them/);
    assert.match(notes, /lower the upper tier onto them/);
    assert.match(notes, /Glue each staircase/);
    assert.match(notes, /Glue the back railings/);
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});

test('without an upper tier a stand is as before', () => {
  const plain = buildGrandstand(wasm, { kind: 'grandstand', rows: 3, aisles: 0, length: 100 });
  try {
    assert.ok(!plain.some((p) => /^upper-/.test(p.id)));
    assert.doesNotMatch(sizeLine(validateGrandstand({ rows: 3 })), /upper/);
  } finally {
    plain.forEach((p) => p.solid.delete());
  }
});
