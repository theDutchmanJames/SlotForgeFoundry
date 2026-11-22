import test from 'node:test';
import assert from 'node:assert/strict';
import { trackInspector } from '../src/inspector.js';
import { defaultTrack } from '../src/track.js';
import { readTrackShapeFields } from '../src/track-shape-controls.js';
import { gridFieldDependencies, gridRestoreValues, syncStartingGridControls } from '../src/starting-grid-controls.js';
import { defaultStartingGrid, startingGridLayout } from '../src/geometry/starting-grid.js';
import { toolGuides } from '../src/guide-geometry.js';

const straight = () => ({ ...defaultTrack(), kind: 'straight', length: 200, width: 200, lanes: 2, laneSpacing: 100 });

test('an ordinary straight can acquire and clear its grid recipe independently of edge markings', () => {
  const p = straight();
  const track = { params: p };
  const road = () => trackInspector({ track }, 'markings');
  assert.match(road(), /Show starting marks/);
  assert.match(road(), /data-grid-marks hidden disabled/);
  assert.deepEqual(readTrackShapeFields({ gridEnabled: true }, track), {});
  assert.deepEqual(p.startingGrid, defaultStartingGrid(p));
  readTrackShapeFields({ gridEnabled: true, gridWidth: 50, gridThickness: 2, gridLegLength: 0,
    gridLayout: 'right', gridStagger: 18, gridRecessed: true }, track);
  assert.deepEqual(p.startingGrid, { width: 50, thickness: 2, legLength: 0, stagger: -18, recessed: true });
  Object.assign(p, readTrackShapeFields({ whiteLineRoad: 'outer' }, track));
  assert.match(road(), /value="right" selected>Leftmost lane behind/);
  assert.match(road(), /name="gridLegLength" value="0"/);
  assert.match(road(), /name="gridRecessed" checked/);
  readTrackShapeFields({ gridEnabled: true, gridLayout: 'left', gridStagger: 22 }, track);
  assert.equal(p.startingGrid.stagger, 22);
  readTrackShapeFields({ gridEnabled: true, gridLayout: 'aligned', gridStagger: NaN }, track);
  assert.equal(p.startingGrid.stagger, 0);
  readTrackShapeFields({ gridEnabled: false, gridLegLength: NaN }, track);
  assert.equal(p.startingGrid, undefined);
  assert.equal(p.whiteLineRoad, 'outer');
  readTrackShapeFields({ gridEnabled: true }, track);
  Object.assign(p, readTrackShapeFields({ kind: 'curve' }, track));
  assert.equal(p.startingGrid, undefined);
  assert.doesNotMatch(road(), /gridEnabled/);
});

test('row controls respond to lane count, including single-lane straights', () => {
  const groups = {};
  const form = {
    elements: { gridEnabled: { checked: true }, lanes: { value: '3' }, gridLayout: { value: 'left' },
      gridStagger: {}, gridRecessed: { checked: true } },
    querySelector: key => groups[key] ??= {},
  };
  syncStartingGridControls(form);
  assert.equal(groups['[data-grid-alternating]'].hidden, false);
  assert.equal(groups['[data-grid-groove]'].hidden, false);
  form.elements.gridLayout.value = 'aligned';
  syncStartingGridControls(form);
  assert.equal(form.elements.gridStagger.disabled, true);
  assert.equal(groups['[data-grid-offset]'].hidden, true);
  form.elements.lanes.value = '1';
  syncStartingGridControls(form);
  assert.equal(form.elements.gridLayout.disabled, true);
  assert.equal(groups['[data-grid-rows]'].hidden, true);
  const p = straight();
  readTrackShapeFields({ gridEnabled: true, lanes: 1, gridLayout: 'left', gridStagger: 45 }, { params: p });
  assert.equal(p.startingGrid.stagger, 0);
});

test('restoring the grid or its stagger recovers dimensions hidden by the applied edit', () => {
  const before = straight();
  before.startingGrid = { width: 64, thickness: 2, legLength: 13, stagger: -28, recessed: true };
  for (const change of [{ gridEnabled: false }, { kind: 'curve' }, { gridLayout: 'aligned' }, { lanes: 1 }]) {
    const field = Object.keys(change)[0];
    const removed = ['gridEnabled', 'kind'].includes(field);
    const after = structuredClone(before);
    Object.assign(after, readTrackShapeFields({ gridEnabled: true, ...change }, { params: after }));
    const previous = gridRestoreValues(before, after, change);
    const restored = { ...gridFieldDependencies(field, after, previous), kind: 'straight', lanes: 2, gridEnabled: true };
    Object.assign(after, readTrackShapeFields(restored, { params: after }));
    assert.deepEqual(after.startingGrid, before.startingGrid);
    assert.equal(Object.hasOwn(previous, 'gridWidth'), removed);
  }
});

test('focused grid guides trace the paint at deck height and the recess at its cut depth', () => {
  const p = straight();
  p.startingGrid = { ...defaultStartingGrid(p), recessed: true };
  const layout = startingGridLayout(p);
  for (const [field, rings, z] of [
    ['gridWidth', layout.paint, p.height],
    ['gridRecessed', layout.grooves, p.height - p.grooveDepth],
    ['grooveWidth', layout.grooves, p.height - p.grooveDepth],
  ]) {
    const guides = toolGuides({ mode: 'track', tab: 'geometry', field, track: { params: p } });
    const guide = guides.find(g => g.id === 'starting-grid');
    assert.ok(guide);
    assert.ok(rings.length >= 4);
    assert.deepEqual(guide.paths, rings.map(ring => [...ring, ring[0]].map(([x, y]) => [x, y, z])));
  }
});
