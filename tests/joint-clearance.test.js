// The clearance of a wall in its groove and round the frame under the roof, set per building.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildGarage, validateBuilding } from '../src/geometry/building.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const box = { width: 120, depth: 140, height: 75, roof: 'flat' };
const measure = (b) => {
  const parts = buildGarage(wasm, b);
  try {
    const of = (id) => parts.find((p) => p.id === id).solid;
    // Where the frame under the roof starts, in from the front wall.
    return { base: of('base').volume(), lipMin: of('roof-frame').boundingBox().min[1] };
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};

test('the clearance is checked, 0.1 to 0.5 mm, 0.2 when left out', () => {
  assert.equal(validateBuilding(box).play, 0.2);
  assert.throws(() => validateBuilding({ ...box, play: 0.05 }), /Joint clearance must be between 0.1 and 0.5 mm/);
  assert.throws(() => validateBuilding({ ...box, play: 0.6 }), /Joint clearance/);
});

test('more clearance: a wider groove in the base, the frame under the roof further in', () => {
  const tight = measure({ ...box, play: 0.1 }),
    loose = measure({ ...box, play: 0.4 });
  assert.ok(loose.base < tight.base - 1, 'the groove takes more of the base');
  assert.ok(Math.abs(loose.lipMin - tight.lipMin - 0.3) < 1e-6, 'the frame moves in by the difference');
});

test('loose and tight kits still fit together: whole pieces, nothing over air, nothing in another part', () => {
  const plate = { width: 200, depth: 200, margin: 0 };
  for (const id of ['classic', 'race-hq', 'vip'])
    for (const play of [0.1, 0.5]) {
      const parts = buildGarage(wasm, { ...BUILDING_PRESETS.find((p) => p.id === id).building, play }, plate);
      try {
        checkKit(parts, plate, id + ' at ' + play + ': ');
      } finally {
        parts.forEach((p) => p.solid.delete());
      }
    }
});
