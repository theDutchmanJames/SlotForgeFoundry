// Found in review: walls that lean out cut to fit the plate, breaches through
// relief, leaning walls and gables, partitions cut to fit, doors that swing in
// a leaning wall, floor frames under leaning storeys.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage, buildingCuts, printSize, fitsPlate, storeyStack, validateBuilding, SWING } from '../src/geometry/building.js';
import { planCuts, validateCuts } from '../src/geometry/building-cuts.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const free = (parts) => parts.forEach((p) => p.solid.delete());
const built = (input, run) => {
  const parts = buildGarage(wasm, input, PLATE);
  try {
    return run(parts);
  } finally {
    free(parts);
  }
};
const volume = (parts, re) => parts.filter((p) => re.test(p.id)).reduce((t, p) => t + p.solid.volume(), 0);
// How much of the parts matching re lies inside the box.
const inside = (parts, re, [x0, y0, z0, x1, y1, z1]) => {
  const probe = wasm.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);
  let v = 0;
  for (const p of parts.filter((q) => re.test(q.id))) {
    const both = p.solid.intersect(probe);
    v += both.volume();
    both.delete();
  }
  probe.delete();
  return v;
};

test('walls that lean out, their roof and its frame are cut to fit the plate', () => {
  for (const input of [
    { width: 180, depth: 120, height: 75, door: 'none', lean: 12 },
    { width: 180, depth: 120, height: 75, door: 'none', upper: [{ height: 60, lean: 15 }] },
  ])
    built(input, (parts) => {
      checkKit(parts, PLATE);
      for (const p of parts) assert.ok(fitsPlate(printSize(p), PLATE), p.name + ': ' + printSize(p));
      const n = input.lean ? '' : '2';
      assert.ok(parts.some((p) => p.id === 'front' + n + '-2'), 'the front wall is cut');
    });
  // Across its height a slanting wall is cut where it stands, each band short enough slanted.
  const plan = planCuts({}, PLATE, { walls: [{ key: 'front', length: 100, height: 390, stands: 360, keepOut: [] }], flats: [] });
  const ends = [0, ...plan.frontZ.cuts, 360];
  for (let i = 1; i < ends.length; i++) assert.ok(((ends[i] - ends[i - 1]) * 390) / 360 <= 200 + 1e-9, 'band ' + i + ' fits slanted');
});

test('a breach in walls that lean out is cut where the walls are', () => {
  const house = { width: 160, depth: 160, height: 80, door: 'none', leaveOut: ['roof'] };
  const d = { wall: 'front', at: 80, width: 40, depth: 30 };
  for (const lean of [15, 2]) {
    const whole = built({ ...house, lean }, (parts) => volume(parts, /^front(-\d+)?$/));
    built({ ...house, lean, damage: [d] }, (parts) => {
      checkKit(parts, PLATE);
      // Most of the ragged gap, through the wall.
      const gone = whole - volume(parts, /^front(-\d+)?$/);
      assert.ok(gone > 0.4 * d.width * d.depth * 3, 'lean ' + lean + ': only ' + gone.toFixed(0) + ' mm³ broken away');
    });
  }
});

test('a breach goes through the relief on its wall too', () => {
  const house = { width: 160, depth: 160, height: 80, door: 'none', leaveOut: ['roof'] };
  for (const [extra, d] of [
    [{ cornice: 6 }, { width: 30, depth: 20 }],
    [{ pilasters: 40 }, { width: 30, depth: 20 }],
    [{ container: 'frame' }, { width: 40, depth: 25 }],
  ]) {
    const { eave } = storeyStack(validateBuilding({ ...house, ...extra }))[0];
    built({ ...house, ...extra, damage: [{ wall: 'front', at: 80, ...d }] }, (parts) => {
      checkKit(parts, PLATE, Object.keys(extra)[0] + ': ');
      // Nothing of the wall or its relief left in the top of the gap, out in front of the wall.
      assert.ok(inside(parts, /^front(-\d+)?$/, [80 - 4, -6, eave - 4, 80 + 4, 1, eave + 2]) < 0.01, Object.keys(extra)[0] + ': the gap is open');
    });
  }
});

test('a partition longer than the plate is cut like a wall, its doorway kept clear', () => {
  const long = { width: 260, depth: 150, height: 75, door: 'none', partitions: [{ storey: 0, x0: 4, y0: 75, x1: 256, y1: 75 }] };
  const plan = buildingCuts(long, PLATE);
  assert.equal(plan.partition1.cuts.length, 1);
  assert.deepEqual(validateCuts({ partition1: [120] }), { partition1: [120] });
  built(long, (parts) => {
    checkKit(parts, PLATE);
    assert.deepEqual(parts.filter((p) => p.role === 'divider').map((p) => p.id), ['partition-1-1', 'partition-1-2']);
  });
  // Front to back, with a doorway: no cut along its sides.
  const deep = { width: 150, depth: 260, height: 75, door: 'none', partitions: [{ storey: 0, x0: 75, y0: 4, x1: 75, y1: 256, door: { at: 126, width: 20, height: 40 } }] };
  const cut = buildingCuts(deep, PLATE).partition1.cuts[0];
  assert.ok(Math.abs(cut - 116) > 4 && Math.abs(cut - 136) > 4, 'the cut at ' + cut + ' keeps off the doorway');
  built(deep, (parts) => {
    checkKit(parts, PLATE);
    assert.equal(parts.filter((p) => p.role === 'divider').length, 2);
    const { floor } = storeyStack(validateBuilding(deep))[0];
    assert.ok(inside(parts, /^partition/, [73, 4 + 116 + 1, floor + 1, 77, 4 + 136 - 1, floor + 39]) < 0.01, 'the doorway is open');
  });
  // A cut chosen along the side of the doorway is refused.
  assert.throws(() => buildingCuts({ ...deep, cuts: { partition1: [116] } }, PLATE), /side of a window, a door/);
});

test('a breach under a gable roof left out reaches up through the gable', () => {
  const house = { width: 160, depth: 160, height: 80, door: 'none', leaveOut: ['roof'], roof: 'gable', ridge: 'depth', pitch: 30 };
  built({ ...house, damage: [{ wall: 'front', at: 80, width: 40, depth: 20 }] }, (parts) => {
    checkKit(parts, PLATE);
    const eave = storeyStack(validateBuilding(house))[0].eave;
    // Over the middle of the gap, from under the eaves up past the ridge: no wall left.
    assert.ok(inside(parts, /^front(-\d+)?$/, [80 - 8, -2, eave - 2, 80 + 8, 4, eave + 80]) < 0.01, 'nothing of the gable over the gap');
  });
});

test('a door that swings in a wall that leans out prints clean on its pins', () => {
  const door = { wall: 'front', type: 'door', at: 60, width: 26, height: 50, leaf: 'panels', swing: true };
  for (const lean of [5, 15])
    built({ width: 160, depth: 120, height: 75, door: 'none', lean, openings: [door] }, (parts) => {
      checkKit(parts, PLATE, 'lean ' + lean + ': ');
      const leaf = parts.find((p) => p.id === 'leaf-1');
      const bb = leaf.solid.boundingBox();
      assert.ok(bb.max[2] - bb.min[2] > door.height - 2 * SWING.play + SWING.length, 'the leaf has its pins');
    });
  built({ width: 160, depth: 120, height: 75, door: 'none', upper: [{ height: 65, lean: 10, openings: [{ ...door, at: 100, leaf: 'plain' }] }] }, (parts) => checkKit(parts, PLATE, 'upper: '));
});

test('the frame under a floor over walls that lean out keeps clear of the walls above', () => {
  built({ width: 120, depth: 60, height: 110, upper: [{ height: 30, open: true, waist: 8, panes: 3, lean: 20 }, { height: 34, open: true, waist: 14, panes: 1 }] }, (parts) => checkKit(parts, PLATE));
  built({ kind: 'walkway', towers: true, towerCab: 'left', towerWidth: 120 }, (parts) => {
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const both = parts[i].solid.intersect(parts[j].solid);
        assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap by ' + both.volume());
        both.delete();
      }
  });
});
