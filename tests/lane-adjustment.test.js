import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildTrack, buildTestJoint, defaultTrack, nativePath, nativeTrackPoint } from '../src/track.js';
import { laneOffsetAt } from '../src/lane-adjustment.js';
import { customTrackPlan } from '../src/custom-track.js';
import { readTrackShapeFields, syncTrackShapeControls } from '../src/track-shape-controls.js';

const wasm = await Module();
wasm.setup();

test('one lane shows a centred slot and restores the previous spacing when a second lane is added', () => {
  const fields = { lanes: { value: '1' }, laneSpacing: { value: '82.5' }, laneMode: { value: 'uniform' } };
  const groups = { '[data-lane-spacing-controls]': {}, '[data-centred-lane]': {}, '[data-lane-adjustment]': {} };
  const form = { elements: fields, querySelector: key => groups[key], querySelectorAll: () => [] };
  syncTrackShapeControls(form);
  assert.equal(groups['[data-centred-lane]'].hidden, false);
  assert.ok(groups['[data-lane-spacing-controls]'].hidden && fields.laneSpacing.disabled);
  fields.lanes.value = '2';
  syncTrackShapeControls(form);
  assert.equal(groups['[data-centred-lane]'].hidden, true);
  assert.equal(groups['[data-lane-spacing-controls]'].hidden, false);
  assert.equal(fields.laneSpacing.disabled, false);
  assert.equal(fields.laneSpacing.value, '82.5');
  const params = { lanes: 2, laneSpacing: 82.5 };
  Object.assign(params, readTrackShapeFields({ lanes: 1, laneSpacing: NaN }, { params }));
  assert.deepEqual(params, { lanes: 1, laneSpacing: 82.5 });
});

function profile(extra = {}) {
  return {
    ...defaultTrack(), kind: 'straight', width: 200, length: 250, laneSpacing: 100,
    laneAdjustment: {version: 1, mode: 'squeeze', spacingMm: 40, anchor: 'centre'},
    ...extra,
  };
}

function inspect(p, check, plan) {
  const parts = buildTrack(wasm, p, plan);
  try {
    for (const part of parts) assert.equal(part.solid.status(), 'NoError');
    check(parts);
  } finally {
    parts.forEach(part => part.solid.delete());
  }
}

function contains(solid, xy, z) {
  const probe = wasm.Manifold.cube([0.04, 0.04, 0.04], true);
  const placed = probe.translate([...xy, z]);
  const intersection = solid.intersect(placed);
  try {
    return intersection.volume() > 0.000032;
  } finally {
    intersection.delete();
    placed.delete();
    probe.delete();
  }
}

test('squeeze keeps both ends aligned and cuts normal-width slots, shelves and sleeves across a segmented straight', () => {
  const p = profile({segments: 2, braidGap: 2});
  inspect(p, roads => {
    assert.equal(roads.length, 2);
    for (const t of [0.001, 0.25, 0.499, 0.501, 0.999]) {
      const solid = roads[t < 0.5 ? 0 : 1].solid;
      const y = laneOffsetAt(p, 1, t);
      const x = (t - 0.5) * p.length;
      // The transverse direction is perpendicular to this lane's tangent.
      const derivative = -30 * 192 * t ** 2 * (1 - t) ** 2 * (1 - 2 * t);
      const magnitude = Math.hypot(p.length, derivative);
      const at = d => [x - derivative * d / magnitude, y + p.length * d / magnitude];
      assert.equal(contains(solid, at(p.slotWidth / 2 - 0.1), 8), false);
      assert.equal(contains(solid, at(p.slotWidth / 2 + 0.1), 8), true);
      assert.equal(contains(solid, at(3.4), p.height - 0.2), true);
      assert.equal(contains(solid, at(3.6), p.height - 0.2), false);
      assert.equal(contains(solid, at(8.4), p.height - 0.2), false);
      assert.equal(contains(solid, at(8.6), p.height - 0.2), true);
      assert.equal(contains(solid, at(0), p.height - p.slotDepth - 0.1), true);
    }
    assert.equal(contains(roads[0].solid, [-0.1, 50], 11.8), true, 'old centre is ordinary road');
  });
});

test('spread on a circular corner holds the inner lane, doubles back to the mating layout and carries the braid opening', () => {
  const p = profile({
    kind: 'curve', radius: 300, angle: 45, braidFeedSide: 'left', braidFeedLane: 2,
    braidFeedStations: [0.28], laneAdjustment: {version: 1, mode: 'spread', spacingMm: 130, anchor: 'inner'},
  });
  const path = nativePath(p);
  assert.deepEqual([0,0.5,1].map(t => path.laneOffsets(t)), [[-50,50],[-50,80],[-50,50]]);
  const feed = path.measuredLanes[1].atOffset(0.28, p.slotWidth / 2 + p.braidWidth / 2);
  inspect(p, ([{solid}]) => {
    assert.equal(contains(solid, nativeTrackPoint(p, 0.5, -50), 8), false);
    assert.equal(contains(solid, nativeTrackPoint(p, 0.5, 80), 8), false);
    assert.equal(contains(solid, nativeTrackPoint(p, 0.5, 50), 11.8), true);
    assert.equal(contains(solid, feed, 11), false);
  });
  inspect({...p, braidFeedSide: 'none'}, ([{solid}]) => assert.equal(contains(solid, feed, 11), true));
});

test('clearance covers the entire adjustable lane and rejects folded or out-of-road braid channels', () => {
  const p = profile({
    length: 160, jointStart: 'clips', jointEnd: 'none', clipType: 'carrera-retained',
    placements: {startClips: [34]},
  });
  inspect({...p, laneAdjustment: null}, parts => assert.ok(parts.length > 1));
  assert.throws(() => buildTrack(wasm, p), /guide slot wall.*away from the seam/);
  assert.throws(() => buildTrack(wasm, profile({length: 15})), /folds in the transition/);
  assert.throws(() => buildTrack(wasm, profile({
    kind: 'curve', laneAdjustment: {version:1, mode:'spread', anchor:'inner', spacingMm:150},
  })), /edge of the road/);
  assert.throws(() => buildTrack(wasm, profile({
    laneAdjustment: {version:1, mode:'squeeze', anchor:'centre', spacingMm:10},
  })), /recesses and guide slots touch/);
  // Radial spacing is legal at every station, but the actual normal-width
  // braid shelves overlap away from the midpoint on this short corner.
  assert.throws(() => buildTrack(wasm, profile({
    kind:'curve', width:500, radius:350, angle:22, lanes:3, laneSpacing:50,
    laneAdjustment:{version:1, mode:'squeeze', anchor:'inner', spacingMm:13.05},
  })), /overlap in the transition/);
});

test('a freeform recipe keeps its braid and slot widths through a spacing change and rejects a folded transition', () => {
  const p = profile({kind:'import', braidGap: 2});
  const recipe = length => ({version:1, radius:150, points:[[0,0], [length,0]]});
  const plan = customTrackPlan(recipe(250), p);
  inspect(p, ([{solid}]) => {
    const t = 0.25;
    const speed = -30 * 192 * t ** 2 * (1-t) ** 2 * (1-2*t);
    const normalLength = Math.hypot(250,speed);
    const at = d => [250*t-speed*d/normalLength, laneOffsetAt(p,1,t)+250*d/normalLength];
    assert.equal(contains(solid, at(1.4), 8), false);
    assert.equal(contains(solid, at(1.6), 8), true);
    assert.equal(contains(solid, at(3.4), 11.8), true);
    assert.equal(contains(solid, at(3.6), 11.8), false);
    assert.equal(contains(solid, at(8.4), 11.8), false);
    assert.equal(contains(solid, at(8.6), 11.8), true);
  }, plan);
  assert.throws(() => buildTrack(wasm,p,customTrackPlan(recipe(15),p)), /folds in the transition/);
});

test('a shortened fit coupon samples its source spacing at the actual mating joint', () => {
  const p = profile({joint: 'clips', segments: 2});
  for (const [joint, offset] of [['start', 50], ['finish', 50], ['seam', 20]]) {
    const parts = buildTestJoint(wasm, p, joint);
    try {
      const road = parts.find(part => part.id === 'road-1');
      assert.equal(contains(road.solid, [-0.1,offset], 8), false);
      assert.equal(contains(road.solid, [-0.1,offset+2], 8), true);
    } finally {
      parts.forEach(p => p.solid.delete());
    }
  }
});
