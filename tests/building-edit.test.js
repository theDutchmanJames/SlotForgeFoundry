import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingHistory, changeOpening, repeatOpening, alignOpenings, placeOpening } from '../src/building-edit.js';
import { validateBuilding, buildingCuts } from '../src/geometry/building.js';
import { validateCuts } from '../src/geometry/building-cuts.js';

test('building history restores independent snapshots, truncates redo and bounds memory', () => {
  const a = { building: { width: 120, openings: [] } }, h = createBuildingHistory(a, 3);
  a.building.width = 900;
  h.commit({ building: { width: 150, openings: [] } });
  h.commit({ building: { width: 180, openings: [] } });
  const old = h.undo(); assert.equal(old.building.width, 150);
  old.building.width = 999;
  assert.equal(h.undo().building.width, 120);
  assert.equal(h.redo().building.width, 150);
  h.commit({ building: { width: 200 } }); assert.equal(h.canRedo, false);
  h.commit({ building: { width: 220 } });
  assert.equal(h.undo().building.width, 200);
  assert.equal(h.undo().building.width, 150);
  assert.equal(h.canUndo, false);
});
test('window rows keep configuration, reject collisions atomically, and respect wall capacity', () => {
  let b = validateBuilding({ width: 300, door: 'none' });
  b = placeOpening(b, 0, 'front');
  b = changeOpening(b, 0, 0, { at: 40, frame: true });
  const row = repeatOpening(b, 0, 0, 4, 15);
  assert.deepEqual(row.openings.map(o => o.at), [40, 95, 150, 205]);
  assert.ok(row.openings.every(o => o.frame));
  assert.throws(() => repeatOpening(b, 0, 0, 8, 15), /corner|wall|position|at must/);
  assert.equal(b.openings.length, 1);
  assert.throws(() => changeOpening(row, 0, 1, { at: 45 }), /too close/);
});
test('aligning different-height windows preserves each window size', () => {
  let b = placeOpening(validateBuilding({ width: 300, door: 'none' }), 0, 'front');
  b = repeatOpening(b, 0, 0, 2, 20);
  b = changeOpening(b, 0, 1, { height: 20, sill: 15 });
  const aligned = alignOpenings(b, 0, 'front', 'top');
  assert.equal(aligned.openings[0].sill + aligned.openings[0].height, aligned.openings[1].sill + aligned.openings[1].height);
  assert.equal(aligned.openings[1].height, 20);
});
test('upper-floor edits do not change ground-floor openings', () => {
  const b = placeOpening(validateBuilding({ door: 'none', upper: [{}] }), 1, 'left');
  assert.equal(b.openings.length, 0); assert.equal(b.upper[0].openings.length, 1);
});
test('fourth storey and every allowed room divider can retain custom cuts', () => {
  const b = validateBuilding({ width: 300, depth: 250, door: 'none', upper: [{}, {}, {}] });
  const plan = buildingCuts(b, { width: 150, depth: 150, margin: 0 });
  const custom = Object.fromEntries(Object.entries(plan).filter(([,p]) => p.cuts.length).map(([key,p]) => [key,p.cuts]));
  assert.deepEqual(validateCuts(custom), custom);
  assert.deepEqual(validateCuts({ divide23: [100], divide23Z: [70] }), { divide23: [100], divide23Z: [70] });
});
