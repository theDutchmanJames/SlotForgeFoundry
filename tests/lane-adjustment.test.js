import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildTrack, buildTestJoint, defaultTrack, nativePath, nativeTrackPoint, validateTrack } from '../src/track.js';
import {
  laneOffsetAt, laneOffsetDerivatives, laneProfileSteps, validateLaneAdjustment,
} from '../src/lane-adjustment.js';
import { slotLengthFor, slotShiftAt } from '../src/slot-position.js';
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

const slot = (startMm, endMm = startMm, edge = 'outer') => ({version: 1, edge, startMm, endMm});
const single = (extra = {}) => ({
  ...defaultTrack(), kind: 'straight', width: 200, length: 300, lanes: 1, ...extra,
});

// Phase 2: a slot position sets the lanes on its own. A squeeze beside it is
// refused, so the slot terms no longer add to a squeeze (they did in stage 1).
const pack = (extra = {}) => profile({laneAdjustment: undefined, ...extra});
const eachSlot = (lanes, edge = 'outer') => ({version: 1, edge, lanes: lanes.map(([startMm, endMm = startMm]) => ({startMm, endMm}))});

test('a lane offset is its place in the row plus the slot shift, or the squeeze', () => {
  const p = single({slotPosition: slot(35, 145)});
  assert.deepEqual([0, 0.5, 1].map(t => laneOffsetAt(p, 0, t)), [65, 10, -45]);
  assert.equal(laneOffsetAt(single({slotPosition: slot(35, 35, 'inner')}), 0, 0.3), -65);
  // Together: the slot nearest the left edge is 50 then 10 mm from it, the other 100 mm further.
  const together = pack({slotPosition: slot(50, 10)});
  assert.deepEqual([0, 1].map(i => laneOffsetAt(together, i, 0)), [-50, 50]);
  assert.deepEqual([0, 1].map(i => laneOffsetAt(together, i, 1)), [-10, 90]);
  assert.deepEqual([0, 1].map(i => laneOffsetAt(together, i, 0.5)), [-30, 70]);
  for (const t of [0.1, 0.37, 0.8]) for (const i of [0, 1])
    assert.ok(Math.abs(laneOffsetAt(together, i, t) - laneOffsetAt(pack(), i, t) - slotShiftAt(together, t)) < 1e-12);
  // A squeeze stored beside a slot position plays no part in the offsets.
  for (const t of [0, 0.37, 1]) for (const i of [0, 1])
    assert.equal(laneOffsetAt(profile({slotPosition: slot(50, 10)}), i, t), laneOffsetAt(together, i, t));
  // Each lane: entry 0 is nearest the edge, lane index 1 from the left, lane 0 from the right.
  const each = pack({slotPosition: eachSlot([[20, 60], [150, 120]])});
  assert.deepEqual([0, 1].map(i => laneOffsetAt(each, i, 0)), [-50, 80]);
  assert.deepEqual([0, 1].map(i => laneOffsetAt(each, i, 1)), [-20, 40]);
  assert.deepEqual([0, 1].map(i => laneOffsetAt(each, i, 0.5)), [-35, 60]);
  const right = pack({slotPosition: eachSlot([[20, 60], [150, 120]], 'inner')});
  assert.deepEqual([0, 1].map(i => laneOffsetAt(right, i, 0)), [-80, 50]);
  assert.deepEqual([0, 1].map(i => laneOffsetAt(right, i, 1)), [-40, 20]);
});

test('lane derivatives cover the squeeze bump and the slot transition', () => {
  const h = 1e-4;
  for (const p of [profile(), single({slotPosition: slot(35, 145)}), pack({slotPosition: slot(50, 10)}),
    pack({slotPosition: eachSlot([[20, 60], [150, 120]])}), pack({lanes: 3, laneSpacing: 50, slotPosition: eachSlot([[20, 20], [70, 100], [150, 180]], 'inner')})]) {
    for (const i of [0, p.lanes - 1]) {
      assert.deepEqual(laneOffsetDerivatives(p, i, 0), [0, 0]);
      assert.deepEqual(laneOffsetDerivatives(p, i, 1), [0, 0]);
      for (const t of [0.05, 0.2, 0.5, 0.63, 0.9]) {
        const [speed, acceleration] = laneOffsetDerivatives(p, i, t);
        const at = u => laneOffsetAt(p, i, u);
        assert.ok(Math.abs(speed - (at(t + h) - at(t - h)) / (2 * h)) < 1e-4);
        assert.ok(Math.abs(acceleration - (at(t + h) - 2 * at(t) + at(t - h)) / h ** 2) < 1e-3);
      }
    }
  }
  assert.deepEqual(laneOffsetDerivatives(single(), 0, 0.3), [0, 0]);
});

test('the lane stations keep a moving slot within 0.015 mm of its true curve', () => {
  assert.equal(laneProfileSteps(profile()), 78, 'a squeeze keeps its stations');
  assert.equal(laneProfileSteps(single({laneAdjustment: undefined})), 32);
  assert.equal(laneProfileSteps(single({slotPosition: slot(35)})), 32);
  for (const p of [single({slotPosition: slot(35, 145)}), single({slotPosition: slot(190, 10, 'inner')}),
    pack({slotPosition: slot(50, 10)}), pack({slotPosition: eachSlot([[20, 20], [80, 180]])}),
    pack({lanes: 3, laneSpacing: 50, slotPosition: eachSlot([[20, 20], [70, 100], [150, 180]], 'inner')})]) {
    const steps = laneProfileSteps(p);
    assert.equal(steps % 2, 0);
    for (let i = 0; i < p.lanes; i++) for (let k = 0; k < steps; k++) {
      const chord = (laneOffsetAt(p, i, k / steps) + laneOffsetAt(p, i, (k + 1) / steps)) / 2;
      assert.ok(Math.abs(chord - laneOffsetAt(p, i, (k + 0.5) / steps)) <= 0.015);
    }
  }
  assert.equal(laneProfileSteps(single({slotPosition: slot(35, 145)})), 74);
});

// Phase 2 replaces the stage 1 test of a spread plus a moving slot: that
// combination is now refused, in words that say to choose one.
test('a spread is checked against the road edge and never shares a piece with a slot position', () => {
  const p = profile({
    width: 160, laneSpacing: 60,
    laneAdjustment: {version: 1, mode: 'spread', spacingMm: 100, anchor: 'centre'},
  });
  assert.deepEqual([0, 0.5, 1].map(t => laneOffsetAt(p, 1, t)), [30, 50, 30]);
  assert.doesNotThrow(() => validateLaneAdjustment(p));
  assert.throws(() => validateLaneAdjustment({...p, width: 112}), /reaches the edge of the road/);
  const message = /^Error: A piece can squeeze or spread its lanes, or move its slots, not both\. Choose one: turn off Squeeze \/ spread lanes, or set Slot position to Centred\.$/;
  for (const slotPosition of [slot(40, 20), eachSlot([[30], [100]])]) {
    assert.throws(() => validateLaneAdjustment({...p, slotPosition}), message);
    assert.throws(() => validateTrack({...p, slotPosition}), message);
    assert.throws(() => nativePath({...p, slotPosition}), message);
  }
});

test('a slot transition tighter than its own braid channel is refused as a fold', () => {
  // 60 mm braids make a 61.5 mm half channel: a 41 mm slot radius passes
  // the guide rule, yet the inside braid edge would turn back on itself.
  const p = single({width: 400, hollow: false, braidWidth: 60, slotPosition: slot(100, 300)});
  p.length = slotLengthFor(p, 40) + 2;
  assert.throws(() => nativePath(p), /folds in the transition/);
  assert.throws(() => buildTrack(wasm, p), /folds in the transition/);
  const gentle = {...p, length: slotLengthFor(p, 70)};
  assert.equal(nativePath(gentle).laneCurves.length, 1);
  inspect(gentle, parts => assert.equal(parts.length, 1));
});
