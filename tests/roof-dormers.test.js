// Gambrel and mansard roofs, and dormers: whole, clear and printing without supports.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildGarage, buildingLayout, validateBuilding, roofAt, roofShape } from '../src/geometry/building.js';
import { checkKit, overAir } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 220, depth: 220, margin: 0 };
const withParts = (b, fn) => {
  const parts = buildGarage(wasm, b, PLATE);
  try {
    fn(parts, (id) => parts.find((p) => p.id === id));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};

test('a gambrel and a mansard: two panels a side, steep to the break, shallower above', () => {
  const ids = buildingLayout({ roof: 'gambrel' }).parts.filter((p) => p.role === 'roof').map((p) => p.id);
  assert.deepEqual(ids, ['roof-left-lower', 'roof-left-upper', 'roof-right-lower', 'roof-right-upper']);
  assert.equal(buildingLayout({ roof: 'mansard', width: 120, depth: 150 }).parts.filter((p) => p.role === 'roof').length, 8);
  // No frame under them.
  assert.ok(!buildingLayout({ roof: 'gambrel' }).parts.some((p) => p.id.endsWith('-frame')));
  const shape = roofShape(validateBuilding({ roof: 'gambrel', lowerPitch: 60, pitch: 30, breakAt: 20 }));
  const tL = Math.tan(Math.PI / 3),
    tU = Math.tan(Math.PI / 6);
  assert.ok(Math.abs(roofAt(shape, 10, 50) - 10 * tL) < 1e-9, 'steep below the break');
  assert.ok(Math.abs(roofAt(shape, 40, 50) - (20 * tL + 20 * tU)) < 1e-9, 'shallow above it');
  assert.ok(Math.abs(shape.rise - (20 * tL + 40 * tU)) < 1e-9);
});

test('gambrel and mansard roofs build whole, every panel printing flat without supports', () => {
  for (const c of [
    { roof: 'gambrel' },
    { roof: 'gambrel', ridge: 'width', roofTexture: 'tile', lowerPitch: 75, pitch: 20, overhangFront: 10 },
    { roof: 'mansard', width: 120, depth: 150, door: 'none', roofTexture: 'shingle' },
    { roof: 'mansard', width: 160, depth: 120, door: 'none', lowerPitch: 80, breakAt: 30, chimney: { x: 80, y: 60, width: 12, depth: 10, height: 10 } },
  ])
    withParts(c, (parts) => {
      checkKit(parts, PLATE, c.roof + ': ');
      for (const p of parts.filter((q) => /^roof/.test(q.id))) assert.ok(overAir(p) < 0.5, c.roof + ': ' + p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air');
    });
});

test('a gambrel or mansard is refused where its pitches or break do not work', () => {
  assert.throws(() => validateBuilding({ roof: 'gambrel', lowerPitch: 50, pitch: 45 }), /at least 10° shallower/);
  assert.throws(() => validateBuilding({ roof: 'gambrel', breakAt: 55 }), /at most 50 mm in from the walls/);
  assert.throws(() => validateBuilding({ roof: 'mansard', depth: 200 }), /mansard roof is not cut to fit the plate/);
});

const DORMER = { x: 60, y: 30, width: 30, height: 18 };
test('a dormer: one hollow piece over an opening, printing on its front without supports', () => {
  for (const c of [
    { roof: 'gable', ridge: 'width', door: 'none', dormers: [DORMER, { ...DORMER, y: 150 }] },
    { roof: 'slope', rises: 'back', roofTexture: 'tile', dormers: [DORMER] },
    { roof: 'hip', width: 120, depth: 160, pitch: 45, door: 'none', dormers: [{ ...DORMER, y: 20, width: 20, height: 12 }] },
    { roof: 'mansard', width: 140, depth: 150, door: 'none', breakAt: 25, dormers: [{ x: 70, y: 8, width: 26, height: 16 }, { x: 8, y: 75, width: 26, height: 16 }] },
    { roof: 'gambrel', door: 'none', breakAt: 30, dormers: [{ x: 8, y: 90, width: 26, height: 16 }] },
  ])
    withParts(c, (parts, part) => {
      checkKit(parts, PLATE, c.roof + ' dormer: ');
      for (const p of parts.filter((q) => q.id.startsWith('dormer'))) assert.ok(overAir(p) < 0.5, c.roof + ': ' + p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air');
      assert.ok(part('dormer-1').solid.volume() > 100);
    });
  // The panel gets its opening.
  withParts({ roof: 'slope', rises: 'back', door: 'none' }, (plain) =>
    withParts({ roof: 'slope', rises: 'back', door: 'none', dormers: [DORMER] }, (parts, part) => {
      assert.ok(part('roof').solid.volume() < plain.find((p) => p.id === 'roof').solid.volume() - 50, 'an opening under the dormer');
    }),
  );
});

test('a dormer that does not fit is refused, saying why', () => {
  assert.throws(() => validateBuilding({ roof: 'flat', dormers: [DORMER] }), /sloped, two-sided, hip, gambrel or mansard/);
  assert.throws(() => validateBuilding({ roof: 'gable', dormers: [{ x: 22, y: 90, width: 28, height: 16 }] }), /reaches over a ridge/);
  assert.throws(() => validateBuilding({ roof: 'gable', ridge: 'width', dormers: [{ ...DORMER, width: 90 }] }), /20 to 80 mm wide/);
  assert.throws(() => validateBuilding({ roof: 'gable', ridge: 'width', dormers: [{ ...DORMER, x: 10 }] }), /clear of the frame under the roof/);
  assert.throws(() => validateBuilding({ roof: 'gable', ridge: 'width', dormers: [DORMER, { ...DORMER, x: 75 }] }), /runs into dormer 1/);
  assert.throws(() => validateBuilding({ roof: 'slope', rises: 'back', dormers: [{ x: 60, y: 120, width: 80, height: 12 }] }), /past the top of the roof/);
});

test('the kit notes say how a mansard and its dormers go together', async () => {
  const { kitNotes } = await import('../src/building-kit.js');
  const { building, parts } = buildingLayout({ roof: 'mansard', width: 140, depth: 150, breakAt: 25, dormers: [{ x: 70, y: 8, width: 26, height: 16 }] });
  const notes = kitNotes('Terrace', building, parts, {});
  assert.match(notes, /Lay the steep lower panels on the walls/);
  assert.match(notes, /along the hips and at the top/);
  assert.match(notes, /Stand each dormer over its opening in the roof/);
  assert.match(notes, /Each dormer prints standing on its front/);
});
