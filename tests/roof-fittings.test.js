// Chimneys, rooflights, gutters and downpipes: on every roof they fit, each
// part whole, clear of the others and printing without supports.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildGarage, buildingLayout, validateBuilding } from '../src/geometry/building.js';
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
const CHIMNEY = { x: 60, y: 120, width: 12, depth: 10, height: 15 };
const CASES = [
  { roof: 'gable', door: 'none', chimney: CHIMNEY, rooflights: [{ x: 35, y: 60, width: 20, depth: 30 }], gutters: true, downpipes: 'left' },
  { roof: 'gable', ridge: 'width', chimney: { ...CHIMNEY, y: 90 }, rooflights: [{ x: 60, y: 40, width: 40, depth: 20 }], gutters: true, downpipes: 'right', roofTexture: 'tile' },
  { roof: 'hip', width: 120, depth: 160, door: 'none', chimney: { ...CHIMNEY, y: 80 }, gutters: true, downpipes: 'right' },
  { roof: 'slope', rises: 'back', door: 'none', gutters: true, downpipes: 'left', rooflights: [{ x: 60, y: 100, width: 30, depth: 30 }, { x: 60, y: 140, width: 30, depth: 20 }] },
  { roof: 'flat', door: 'none', chimney: { ...CHIMNEY, x: 30, y: 30 }, rooflights: [{ x: 60, y: 100, width: 30, depth: 30 }] },
  { roof: 'vault', door: 'none', chimney: { ...CHIMNEY, x: 30, y: 100, height: 10 } },
  { roof: 'sawtooth', door: 'none', chimney: { ...CHIMNEY, x: 30, y: 100, height: 10 }, rooflights: [{ x: 60, y: 30, width: 30, depth: 20 }] },
];

test('the fittings are parts of the kit', () => {
  const ids = buildingLayout(CASES[0]).parts.map((p) => p.id);
  for (const id of ['chimney', 'gutter-left', 'downpipe-left', 'gutter-right', 'downpipe-right']) assert.ok(ids.includes(id), id);
  assert.equal(buildingLayout(CASES[2]).parts.filter((p) => p.id.startsWith('gutter')).length, 4);
});

test('on every roof: whole, clear of each other, nothing over air', () => {
  for (const c of CASES)
    withParts({ ...c, rooflights: [] }, (plain) =>
      withParts(c, (parts) => {
        checkKit(parts, PLATE, c.roof + ': ');
        // The fittings too, which the kit check leaves out with the roof.
        for (const p of parts.filter((q) => /^(chimney|gutter|downpipe)/.test(q.id))) assert.ok(overAir(p) < 0.5, c.roof + ': ' + p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air');
        // A rooflight adds nothing over air to its panel: the panel bridges only the tops of its pockets, as before.
        for (const p of parts.filter((q) => /^roof/.test(q.id) && !/frame/.test(q.id))) {
          const before = plain.find((q) => q.id === p.id);
          assert.ok(overAir(p) - overAir(before) < 0.5, c.roof + ': ' + p.name + ' prints ' + (overAir(p) - overAir(before)).toFixed(1) + ' mm² more over air');
        }
      }),
    );
});

test('a rooflight is a hole through its panel with a frame round it; a chimney stands on the roof', () => {
  withParts({ ...CASES[0], rooflights: [] }, (plain) =>
    withParts(CASES[0], (parts, part) => {
      // The left panel gets the rooflight: one more hole through it.
      assert.equal(part('roof-left').solid.genus(), plain.find((p) => p.id === 'roof-left').solid.genus() + 1);
      // A frame stands on it: a little more roof, less the hole.
      assert.ok(part('roof-left').solid.boundingBox().max[2] > 0);
      // The chimney rises its height over the ridge it stands on.
      const ridge = Math.max(...parts.filter((p) => /^roof-(left|right)$/.test(p.id)).map((p) => p.solid.boundingBox().max[2]));
      assert.ok(Math.abs(part('chimney').solid.boundingBox().max[2] - ridge - 15) < 1, 'chimney height');
      // Its foot follows the roof: lower at its sides than over the ridge.
      assert.ok(part('chimney').solid.boundingBox().min[2] < ridge - 3);
    }),
  );
});

test('a downpipe runs from its gutter to the base, down the wall', () => {
  withParts(CASES[0], (parts, part) => {
    const pipe = part('downpipe-left').solid.boundingBox();
    assert.ok(Math.abs(pipe.min[2] - 10) < 0.01, 'down to the top of the base');
    assert.ok(pipe.min[0] < 0 && pipe.max[0] <= 0.01, 'outside the left wall, against it');
    const gutter = part('gutter-left').solid.boundingBox();
    assert.ok(pipe.max[2] > gutter.min[2], 'up into the gutter');
  });
});

test('fittings that do not fit are refused, saying why', () => {
  assert.throws(() => validateBuilding({ roof: 'gable', chimney: { ...CHIMNEY, x: 2 } }), /over the top storey/);
  assert.throws(() => validateBuilding({ roof: 'gable', chimney: { ...CHIMNEY, width: 50 } }), /6 to 40 mm wide/);
  assert.throws(() => validateBuilding({ roof: 'gable', rooflights: [{ x: 60, y: 90, width: 20, depth: 20 }] }), /over the ridge/);
  assert.throws(() => validateBuilding({ roof: 'gable', rooflights: [{ x: 8, y: 90, width: 10, depth: 20 }] }), /inside the outside of the walls/);
  assert.throws(() => validateBuilding({ roof: 'flat', rooflights: [{ x: 60, y: 90, width: 20, depth: 20 }, { x: 60, y: 110, width: 20, depth: 20 }] }), /runs into rooflight 1/);
  assert.throws(() => validateBuilding({ roof: 'flat', chimney: CHIMNEY, rooflights: [{ x: 60, y: 120, width: 20, depth: 20 }] }), /runs into the chimney/);
  assert.throws(() => validateBuilding({ roof: 'vault', rooflights: [{ x: 40, y: 90, width: 20, depth: 20 }] }), /not an arched roof/);
  assert.throws(() => validateBuilding({ roof: 'flat', gutters: true }), /eaves of a sloped/);
  assert.throws(() => validateBuilding({ roof: 'hip', width: 120, depth: 150, gutters: true, overhangFront: 8 }), /same overhang on every side/);
  assert.throws(() => validateBuilding({ roof: 'gable', downpipes: 'left' }), /choose gutters too/);
  assert.throws(() => validateBuilding({ roof: 'gable', gutters: true, downpipes: 'left', upper: [{ width: 100, depth: 150 }] }), /every storey as big/);
  assert.throws(() => validateBuilding({ roof: 'flat', arch: 10, chimney: CHIMNEY }), /not on an arched roof/);
  // A sawtooth rooflight keeps off the north light at the top of its tooth.
  assert.throws(() => validateBuilding({ roof: 'sawtooth', rooflights: [{ x: 60, y: 50, width: 20, depth: 15 }] }), /top of its tooth/);
});

test('a downpipe in the way of the sign: it says so', () => {
  assert.throws(
    () => withParts({ roof: 'gable', ridge: 'width', gutters: true, downpipes: 'left', sign: 'fascia', signWidth: 118, signHeight: 12 }, () => {}),
    /downpipe, front runs into the sign: put the downpipes at the other end/,
  );
});

test('the kit notes say how the fittings go on and print', async () => {
  const { kitNotes } = await import('../src/building-kit.js');
  const { building, parts } = buildingLayout(CASES[0]);
  const notes = kitNotes('Cottage', building, parts, {});
  assert.match(notes, /Glue clear sheet under each rooflight/);
  assert.match(notes, /Stand the chimney on the roof, its cap up/);
  assert.match(notes, /Glue each gutter along its eave/);
  assert.match(notes, /Push the top of each downpipe up into the hole in its gutter/);
  assert.match(notes, /The chimney prints upside down/);
  assert.match(notes, /each downpipe on its side/);
});
