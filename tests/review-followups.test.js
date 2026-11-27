// Two follow-ups from the review: a planked wall kept clear all over has no joints to cut
// (an empty cut must not empty the wall), and the fit test's outline holds its wall strip.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { TEXTURE_DEFAULTS, wallJoints } from '../src/geometry/building-texture.js';
import { FIT, buildFitTest, fitFootprint } from '../src/geometry/fit-test.js';
import { KIT, validateBuilding } from '../src/geometry/building.js';
import { headroomOver, layoutBuilding, overlap, shapeOf, snapPose, toPlan } from '../src/planner-buildings.js';

const wasm = await Module();
wasm.setup();
const place = (building, pose) => layoutBuilding({ name: 'Test', building }, pose, 'b-1');
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// A garage on legs with a drum on the table well out in front of it.
const withDrum = (legs) => validateBuilding({ width: 120, depth: 100, door: 'none', ...(legs && { standType: 'legs', standHeight: 40 }), props: [{ type: 'drum', x: 50, y: -110, storey: -1 }] });

test('a garage is outlined by its base; what stands beside it counts on the track, not the table between', () => {
  const b = withDrum(true),
    m = KIT.ledge;
  assert.deepEqual(shapeOf(b).box, [-m, -m, b.width + m, b.depth + m]);
  const entry = place(b, { x: b.width / 2, y: b.depth / 2, a: 0 });
  // A track between the drum and the base, touching neither.
  const between = box(-50, -60, 170, -20);
  assert.equal(overlap(entry, [between]), 0);
  assert.equal(headroomOver(entry, [{ polys: [between] }], () => 0), null, 'nothing over it');
  // A track under the drum is on the track.
  assert.ok(overlap(entry, [box(-50, -112, 170, -95)]) > 0.5);
});

test('a prop out in front, off to the side of the track, does not push a garage back from it', () => {
  // The drum stands out in front and to the left, where the track does not run.
  const b = validateBuilding({ width: 120, depth: 100, door: 'none', props: [{ type: 'drum', x: -80, y: -110, storey: -1 }] });
  assert.equal(shapeOf(b).front.p[1], -KIT.ledge);
  const track = box(-20, -400, 140, -150);
  const entry = place(b, { x: 60, y: -90, a: 0 });
  const pose = snapPose(entry, [track]);
  assert.ok(pose, 'it snaps');
  const snapped = { ...entry, pose };
  assert.ok(overlap(snapped, [track]) < 0.5);
  // Its front stands just clear of the track, not back by the drum's reach.
  const [, y] = toPlan(snapped, [b.width / 2, -KIT.ledge]);
  assert.ok(y > -150 && y < -140, 'its front ' + y.toFixed(1) + ' just clear of the track at -150');
});

test('a fit test turns round the middle of its block, where it always has', () => {
  assert.deepEqual(shapeOf({ kind: 'fittest', play: 0.2 }).centre, [FIT.length / 2, FIT.depth / 2]);
  // A saved one stays where it was.
  const entry = place({ kind: 'fittest', play: 0.2 }, { x: 100, y: 100, a: 0.5 });
  const [x, y] = toPlan(entry, [0, 0]);
  assert.deepEqual([+x.toFixed(2), +y.toFixed(2)], [76.79, 73.65]);
});

test('a planked wall kept clear all over gives no cut, not an empty one', () => {
  const temp = [],
    own = (s) => (temp.push(s), s);
  try {
    const geom = { W: 100, D: 60, length: 100, bottom: 0, top: 50 };
    const all = wallJoints(wasm, own, 'front', geom, [[-20, -20, 120, 80]], TEXTURE_DEFAULTS, 'planks');
    assert.ok(all === null || !all.isEmpty(), 'nothing left to cut is no cut');
    // Kept clear only round a window, the planks are still cut.
    const some = wallJoints(wasm, own, 'front', geom, [[40, 20, 60, 40]], TEXTURE_DEFAULTS, 'planks');
    assert.ok(some && some.volume() > 0);
  } finally {
    for (const s of new Set(temp)) s.delete();
  }
});

test('the fit test stands inside its outline, strip and all', () => {
  const parts = buildFitTest(wasm, {});
  try {
    const [x0, y0, x1, y1] = fitFootprint();
    for (const p of parts) {
      const { min, max } = p.solid.boundingBox();
      assert.ok(min[0] >= x0 - 1e-6 && min[1] >= y0 - 1e-6 && max[0] <= x1 + 1e-6 && max[1] <= y1 + 1e-6, p.id + ' inside the outline');
    }
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});
