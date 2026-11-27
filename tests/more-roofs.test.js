// A dome and a sawtooth on a shaped building, a jettied storey, and a
// stepped gable on a garage: each checked, every kit printing clean.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage, gableFrontOutline, roofAt, roofShape, storeyStack, validateBuilding } from '../src/geometry/building.js';
import { domeOf, footprintStoreys, sawOf, storeyWalls } from '../src/geometry/footprint-building.js';
import { checkKit, overAir } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const withParts = (b, fn) => {
  const parts = buildGarage(wasm, b, PLATE);
  try {
    return fn(parts);
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
// checkKit leaves the roof out of its over-air check: the roofs are checked here.
const roofsFlat = (parts) => parts.filter((p) => /^roof/.test(p.id)).forEach((p) => assert.ok(overAir(p) <= 0.5, p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air'));

test('a dome on a shaped building: no inside corners, no higher than a half round, whole on the plate, hollowed, printing clean', () => {
  const oct = { kind: 'footprint', shape: 'octagon', width: 180, depth: 180, height: 80, roofShape: 'dome', domeRise: 60 };
  assert.throws(() => validateBuilding({ ...oct, shape: 'L' }), /A dome goes on an outline without inside corners/);
  assert.throws(() => validateBuilding({ ...oct, domeRise: 120 }), /at most as high as half its span/);
  assert.throws(() => validateBuilding({ ...oct, courtyards: [{ x: 60, y: 60, width: 60, depth: 60 }] }), /takes a flat roof/);
  assert.throws(() => validateBuilding({ ...oct, upper: [{ height: 50, jetty: 4 }] }), /no jetties under it/);
  assert.throws(() => buildGarage(wasm, { ...oct, width: 230, depth: 230 }, PLATE), /dome prints whole/);
  const { a, h, R } = domeOf(validateBuilding(oct));
  assert.ok(Math.abs(R - (a * a + h * h) / (2 * h)) < 1e-9);
  withParts(oct, (parts) => {
    checkKit(parts, PLATE);
    roofsFlat(parts);
    const dome = parts.find((p) => p.id === 'roof');
    assert.equal(dome.name, 'Dome');
    // It rises its rise above the walls, and is hollowed under.
    const top = footprintStoreys(validateBuilding(oct)).at(-1).top;
    assert.ok(Math.abs(dome.solid.boundingBox().max[2] - (top + 60)) < 0.5);
    const box = dome.solid.boundingBox();
    assert.ok(dome.solid.volume() < 0.9 * (box.max[0] - box.min[0]) * (box.max[1] - box.min[1]) * 60 * 0.6, 'less than a solid cap');
  });
});

test('a sawtooth on a shaped building: teeth across it from front to back, its walls rising to them, each slope and north light printing flat', () => {
  const L = { kind: 'footprint', shape: 'L', width: 220, depth: 180, wing: 80, height: 70, roofShape: 'sawtooth', teeth: 3, pitch: 20 };
  assert.throws(() => validateBuilding({ ...L, teeth: 9 }), /1 to 8 teeth/);
  assert.throws(() => validateBuilding({ ...L, teeth: 8 }), /at least 25 mm each/);
  assert.throws(() => validateBuilding({ ...L, pitch: 40 }), /at most 35/);
  const saw = sawOf(validateBuilding(L));
  assert.ok(Math.abs(saw.wd * 3 - (saw.y1 - saw.y0)) < 1e-9);
  withParts(L, (parts) => {
    checkKit(parts, PLATE);
    roofsFlat(parts);
    assert.equal(new Set(parts.filter((p) => /^roof-/.test(p.id)).map((p) => p.id.split('-').slice(0, 2).join('-'))).size, 3, 'three teeth');
    assert.ok(parts.some((p) => /^light-1/.test(p.id)) && parts.some((p) => /^light-2/.test(p.id)) && !parts.some((p) => /^light-3/.test(p.id)), 'a north light between each two');
    // The side walls rise to the high edge of a tooth.
    const top = 6 + 70;
    const highest = Math.max(...parts.filter((p) => /^edge-/.test(p.id)).map((p) => p.solid.boundingBox().max[2]));
    assert.ok(highest > top + saw.h - 1 && highest < top + saw.h + 1, 'walls up to the teeth: ' + highest);
  });
});

test('a jettied storey stands out past the walls below on a floor that reaches out under it', () => {
  const L = { kind: 'footprint', shape: 'L', upper: [{ height: 60, jetty: 6 }] };
  assert.throws(() => validateBuilding({ ...L, upper: [{ height: 60, jetty: 12 }] }), /0 to 10 mm past the walls below/);
  const b = validateBuilding(L);
  const [g, up] = footprintStoreys(b);
  assert.equal(g.out, 0);
  assert.equal(up.out, 6);
  // Its walls are the outline moved out by 6: the first runs along y = -6.
  const w = storeyWalls(b, up)[0];
  assert.ok(Math.abs(w.a[1] + 6) < 1e-9 && w.length > storeyWalls(b, g)[0].length);
  withParts(L, (parts) => {
    checkKit(parts, PLATE);
    const y0 = (id) => Math.min(...parts.filter((p) => p.id.startsWith(id)).map((p) => p.solid.boundingBox().min[1]));
    assert.ok(Math.abs(y0('edge-1-2') + 6) < 1e-6, 'the upper front wall out by 6');
    assert.ok(Math.abs(y0('edge-1') - 0) < 1e-6 || y0('edge-1') <= 0, 'the lower one where it was');
    assert.ok(y0('floor-2') <= -6 + 1e-6, 'the floor reaching out under it');
  });
  // Its windows go along its own walls: one near the end of the front, past where the wall below ends, fits up there only.
  const late = { wall: 'edge-1', type: 'window', at: 212, width: 20, height: 20, sill: 20 };
  assert.doesNotThrow(() => validateBuilding({ ...L, upper: [{ height: 60, jetty: 6, openings: [late] }] }));
  assert.throws(() => validateBuilding({ ...L, openings: [late] }), /corner/);
});

test('a stepped gable rises over a two-sided roof facing the front, clear of it, on its own board', () => {
  const canal = { width: 169, depth: 172, height: 97, door: 'none', roof: 'gable', ridge: 'depth', pitch: 45, overhangFront: 0, gableFront: 'stepped', gableSteps: 3 };
  assert.throws(() => validateBuilding({ ...canal, ridge: 'width' }), /gable faces the front/);
  assert.throws(() => validateBuilding({ ...canal, overhangFront: 4 }), /overhang at the front to 0/);
  assert.throws(() => validateBuilding({ ...canal, gableSteps: 7 }), /1 to 6 steps/);
  assert.throws(() => validateBuilding({ ...canal, openings: [{ wall: 'front', type: 'window', at: 84, width: 30, height: 30, sill: 60 }] }), /keep the front window under it/);
  const b = validateBuilding(canal);
  const pts = gableFrontOutline(b);
  // Every step clear above the roof's top over it.
  const shape = roofShape(b),
    top = storeyStack(b).at(-1);
  for (let k = 2; k < pts.length; k += 2) {
    const [u0, z] = pts[k + 1] ?? pts[k],
      [u1] = pts[k];
    const u = (u0 + u1) / 2;
    assert.ok(z >= top.eave + roofAt(shape, u, 0) + 3, 'step over ' + u.toFixed(0) + ' clear of the roof');
  }
  withParts(canal, (parts) => {
    checkKit(parts, PLATE);
    const g = parts.find((p) => p.id === 'gable-front');
    assert.ok(g, 'the board in the kit');
    assert.ok(g.solid.boundingBox().max[1] <= 1e-6, 'in front of the wall');
    assert.ok(g.solid.boundingBox().max[2] > Math.max(...parts.filter((p) => /^roof/.test(p.id)).map((p) => p.solid.boundingBox().max[2])), 'above the roof');
  });
});
