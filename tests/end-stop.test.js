import assert from 'node:assert/strict';
import test from 'node:test';
// ---- End stop: a straight whose slots stop short of a closed end B ----
import Module3 from 'manifold-3d';
import {
  buildTrack as buildStop,
  defaultTrack as defaultStop,
  trackParameters as stopParameters,
  validateTrack as validateStop,
  END_STOP_GAP,
  endStopGap,
  hasEndStop,
} from '../src/track.js';
import { trackInspector as stopInspector } from '../src/inspector.js';
import { newProject as stopProject } from '../src/project.js';

const stopWasm = await Module3();
stopWasm.setup();
const stopPiece = (changes = {}) =>
  stopParameters({ ...defaultStop(), kind: 'straight', length: 150, lanes: 1, width: 100, joint: 'clips', ...changes });
function builtStop(p, inspect) {
  const parts = buildStop(stopWasm, p, null, undefined, undefined, { planning: true });
  try {
    return inspect(parts);
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
}
// The height of the road surface, or of the slot floor, at a point.
const surfaceAt = (solid, x, y) => solid.rayCast([x, y, 60], [x, y, -5])[0].position[2];

test('an end stop ends its slot and braid before a closed end B without connectors', () => {
  const open = stopPiece(),
    stop = stopPiece({ endStop: true });
  assert.equal(hasEndStop(open), false);
  assert.equal(hasEndStop(stop), true);
  assert.equal(endStopGap(stop), END_STOP_GAP.default);
  const floor = stop.height - stop.slotDepth;
  builtStop(stop, (parts) => {
    const road = parts.find((part) => part.role === 'road').solid;
    const end = stop.length / 2,
      gap = END_STOP_GAP.default;
    // The slot runs up to the gap and the road is whole beyond it.
    assert.ok(Math.abs(surfaceAt(road, -end + 5, 0) - floor) < 1e-6);
    assert.ok(Math.abs(surfaceAt(road, end - gap - 1, 0) - floor) < 1e-6);
    assert.ok(Math.abs(surfaceAt(road, end - gap + 1, 0) - stop.height) < 1e-6);
    assert.ok(Math.abs(surfaceAt(road, end - 1, 0) - stop.height) < 1e-6);
    // So does the braid recess beside it.
    const braid = stop.slotWidth / 2 + stop.braidGap + stop.braidWidth / 2;
    assert.ok(surfaceAt(road, end - gap - 1, braid) < stop.height - 0.01);
    assert.ok(Math.abs(surfaceAt(road, end - gap + 1, braid) - stop.height) < 1e-6);
    // Connectors at end A only, and one end for the Track Planner.
    const guides = road && parts.find((part) => part.role === 'road').jointGuides;
    assert.ok(guides.length >= 1);
    assert.ok(guides.every((g) => g.point[0] < 0), 'every connector is at end A');
    assert.equal(parts.find((part) => part.role === 'road').plannerStrip.ports.length, 1);
  });
  builtStop(open, (parts) => {
    const road = parts.find((part) => part.role === 'road');
    assert.ok(road.jointGuides.some((g) => g.point[0] > 0));
    assert.equal(road.plannerStrip.ports.length, 2);
    assert.ok(Math.abs(surfaceAt(road.solid, open.length / 2 - 1, 0) - floor) < 1e-6);
  });
  // A longer gap, two lanes, two segments and borders.
  const wide = stopParameters({
    ...defaultStop(), kind: 'straight', length: 240, segments: 2, borderSide: 'both', endStop: true, endStopGap: 40,
  });
  builtStop(wide, (parts) => {
    const roads = parts.filter((part) => part.role === 'road');
    assert.equal(roads.length, 2);
    assert.equal(roads[0].plannerStrip.ports.length, 2);
    assert.equal(roads[1].plannerStrip.ports.length, 1);
    const lane = wide.laneSpacing / 2;
    for (const y of [lane, -lane]) {
      assert.ok(surfaceAt(roads[1].solid, 120 - 41, y) < wide.height - 1);
      assert.ok(Math.abs(surfaceAt(roads[1].solid, 120 - 39, y) - wide.height) < 1e-6);
    }
    // The borders close the end as well: no connector of theirs at end B.
    for (const border of parts.filter((part) => part.role === 'border'))
      assert.ok((border.jointGuides ?? []).every((g) => g.point[0] < 119), border.id);
    for (const part of parts) assert.equal(part.solid.status(), 'NoError');
  });
});

test('the slot of an end stop stops where the slot of the open piece runs, also off-centre', () => {
  // 30 mm from the outer edge of a 100 mm road, the same distance at both ends.
  const slotPosition = { version: 1, edge: 'outer', startMm: 30, endMm: 30 };
  const open = stopPiece({ slotPosition }),
    stop = stopPiece({ slotPosition, endStop: true });
  const floor = stop.height - stop.slotDepth;
  // Where the open piece has its slot, across the road.
  const slotAt = (solid, x) =>
    [-40, -30, -20, -10, 0, 10, 20, 30, 40].filter((y) => Math.abs(surfaceAt(solid, x, y) - floor) < 1e-6);
  let run;
  builtStop(open, (parts) => {
    run = slotAt(parts.find((part) => part.role === 'road').solid, 0);
  });
  assert.equal(run.length, 1, 'the slot is at one of the probed lines: ' + run);
  assert.notEqual(run[0], 0, 'and it is off-centre');
  builtStop(stop, (parts) => {
    const road = parts.find((part) => part.role === 'road').solid;
    assert.deepEqual(slotAt(road, 0), run, 'the same side as on the open piece');
    assert.deepEqual(slotAt(road, stop.length / 2 - 30), run);
    assert.deepEqual(slotAt(road, stop.length / 2 - 10), [], 'no slot beyond the stop');
  });
  // A slot that moves sideways cannot stop this way, and says what to use.
  const moving = stopPiece({ length: 300, endStop: true, slotPosition: { version: 1, edge: 'outer', startMm: 30, endMm: 60 } });
  assert.throws(
    () => builtStop(moving, () => {}),
    /An end stop needs a slot that runs straight\. Use a centred slot or one distance from the edge/,
  );
});

test('an end stop is refused where it cannot be made, in plain words', () => {
  const refuse = (changes, text) =>
    assert.throws(() => validateStop(stopPiece({ endStop: true, ...changes })), text);
  refuse({ endStopGap: 2 }, /road beyond the slot end must be between 5 and 500 mm/);
  refuse({ endStopGap: 145 }, /Set Road beyond the slot end to at most 140 mm/);
  refuse({ segments: 3, endStopGap: 45 }, /at most 40 mm, use fewer road segments or a longer road/);
  refuse({ endStop: 'yes' }, /Choose whether this straight is an end stop/);
  assert.throws(
    () => validateStop(stopParameters({ ...defaultStop(), kind: 'curve', endStop: true })),
    /Only a plain straight can be an end stop/,
  );
  // Off: the gap is not looked at, and a piece from before end stops is unchanged.
  assert.doesNotThrow(() => validateStop(stopPiece({ endStop: false, endStopGap: 9999 })));
  assert.equal(defaultStop().endStop, undefined);
  // Track Set offers it on a plain straight only.
  const project = stopProject();
  project.mode = 'track';
  project.track.params = stopPiece({ endStop: true });
  const html = stopInspector(project, 'geometry');
  assert.match(html, /name="endStop"[^>]*checked/);
  assert.match(html, /data-end-stop>/);
  assert.match(html, /name="endStopGap"[^>]*value="20"/);
  project.track.params = stopPiece();
  assert.match(stopInspector(project, 'geometry'), /data-end-stop hidden disabled>/);
  project.track.params = stopParameters({ ...defaultStop(), kind: 'curve' });
  assert.doesNotMatch(stopInspector(project, 'geometry'), /endStop/);
});
