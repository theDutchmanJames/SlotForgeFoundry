// Several windows and doors of a wall at once: mirrored, spaced, centred, moved, copied, removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBuilding } from '../src/geometry/building.js';
import { centreOpenings, copyOpenings, mirrorOpenings, moveOpenings, removeOpenings, spaceOpenings } from '../src/building-edit.js';

const win = (wall, at, more = {}) => ({ wall, type: 'window', at, width: 20, height: 24, sill: 30, ...more });
const garage = (openings) => validateBuilding({ width: 160, depth: 120, height: 75, door: 'none', openings });
const ats = (b, wall = 'front') => b.openings.filter((o) => o.wall === wall).map((o) => o.at);

test('mirrored across the wall: a copy of each on the other side; one in the middle or mirrored already stays one', () => {
  const b = garage([win('front', 30), win('front', 80), win('front', 55, { width: 10 })]);
  assert.deepEqual(ats(mirrorOpenings(b, 0, [0])), [30, 80, 55, 130]);
  // The middle one has no copy; the first one's copy is new.
  assert.deepEqual(ats(mirrorOpenings(b, 0, [0, 1])), [30, 80, 55, 130]);
  const twice = mirrorOpenings(b, 0, [0]);
  assert.throws(() => mirrorOpenings(twice, 0, [0, 3]), /mirrored already/);
  // On a storey above, and on a connected section.
  const up = validateBuilding({ width: 160, depth: 120, height: 75, door: 'none', upper: [{ height: 50, openings: [win('left', 30, { sill: 20 })] }] });
  assert.deepEqual(ats(mirrorOpenings(up, 1, [0]).upper[0], 'left'), [30, 90]);
  const hall = validateBuilding({ kind: 'sections', sections: [{ id: 's1', name: 'Hall', parent: null, width: 200, depth: 100, height: 80, openings: [win('front', 40)] }] });
  assert.deepEqual(ats(mirrorOpenings(hall, 0, [0]).sections[0]), [40, 160]);
});

test('spaced evenly: the gaps between them and at the ends all the same', () => {
  const b = garage([win('front', 20), win('front', 50), win('front', 100, { width: 40 })]);
  const spaced = spaceOpenings(b, 0, [2, 0, 1]);
  // 160 mm, 80 mm of windows: four gaps of 20 mm.
  assert.deepEqual(ats(spaced), [30, 70, 120]);
  assert.throws(() => spaceOpenings(garage([win('front', 30, { width: 70 }), win('front', 115, { width: 70 })]), 0, [0, 1]), /gap|keep|wall|apart|6 mm/i);
});

test('centred, moved together, copied to another wall, removed together', () => {
  const b = garage([win('front', 20), win('front', 50), win('back', 60)]);
  assert.deepEqual(ats(centreOpenings(b, 0, [0, 1])), [65, 95]);
  const moved = moveOpenings(b, 0, [0, 1], 10, 5);
  assert.deepEqual(ats(moved), [30, 60]);
  assert.deepEqual(moved.openings.slice(0, 2).map((o) => o.sill), [35, 35]);
  assert.equal(moved.openings[2].at, 60, 'the one not chosen stays');
  // Copied to the 120 mm left wall, as far from its middle: 20 → -20 from 80's middle, so 0 → refused; 50 → 30.
  assert.throws(() => copyOpenings(b, 0, [0, 1], 'left'), /./);
  const copied = copyOpenings(b, 0, [1], 'left');
  assert.deepEqual(ats(copied, 'left'), [30]);
  assert.throws(() => copyOpenings(b, 0, [1], 'front'), /another wall/);
  assert.deepEqual(removeOpenings(b, 0, [0, 1]).openings.map((o) => o.at), [60]);
  assert.throws(() => moveOpenings(b, 0, [0, 2], 1), /one wall/);
  assert.throws(() => removeOpenings(b, 0, []), /Select one or more/);
  assert.throws(() => moveOpenings(b, 0, [0], -20), /./, 'past the corner is refused');
});
