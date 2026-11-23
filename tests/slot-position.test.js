import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTrack, nativeBraidLane, nativePath, trackParameters, validateTrack } from '../src/track.js';
import { laneOffsetAt, laneOffsetDerivatives } from '../src/lane-adjustment.js';
import {
  SLOT_GENTLE_RADIUS,
  SLOT_MIN_RADIUS,
  hasSlotPosition,
  lanesVary,
  normaliseSlotPosition,
  slotBend,
  slotClearance,
  slotClearances,
  slotDistances,
  slotEndLists,
  slotEnds,
  slotForm,
  slotGaps,
  slotLabel,
  slotLaneEnvelope,
  slotLaneOffsetAt,
  slotLaneOffsetDerivatives,
  slotLengthFor,
  slotLengthForClearance,
  slotRange,
  slotRoom,
  slotShiftAt,
  slotShiftDerivatives,
  slotTitle,
  slotVaries,
  validateSlotPosition,
} from '../src/slot-position.js';
import { slotAdvice } from '../src/slot-advice.js';
import { slotConnectorNotes } from '../src/geometry/slot-end-row.js';

const slot = (startMm, endMm = startMm, edge = 'outer') => ({ version: 1, edge, startMm, endMm });

function piece(extra = {}) {
  return trackParameters({
    ...defaultTrack(), kind: 'straight', width: 200, length: 300, lanes: 1, ...extra,
  });
}

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' is not ' + expected);

test('a piece without a slot position is centred and every helper says so', () => {
  const p = piece();
  assert.equal(hasSlotPosition(p), false);
  assert.equal(slotVaries(p), false);
  assert.equal(lanesVary(p), false);
  assert.equal(lanesVary({ ...p, laneAdjustment: { version: 1 } }), true);
  for (const t of [-1, 0, 0.3, 1, 2]) {
    assert.equal(slotShiftAt(p, t), 0);
    assert.deepEqual(slotShiftDerivatives(p, t), [0, 0]);
    assert.equal(laneOffsetAt(p, 0, t), 0);
  }
  assert.equal(slotLabel(p), '');
  assert.deepEqual(slotEnds(p), { start: { outer: 100, inner: 100 }, end: { outer: 100, inner: 100 } });
  assert.deepEqual(slotAdvice(p), []);
  assert.doesNotThrow(() => validateSlotPosition(p));
  assert.doesNotThrow(() => validateSlotPosition({ ...p, slotPosition: null }));
  assert.deepEqual(slotBend(p), { minRadius: Infinity, angle: 0 });
});

test('the distance is measured from the chosen edge: outer is left of travel and positive', () => {
  const left = piece({ slotPosition: slot(35) });
  const right = piece({ slotPosition: slot(35, 35, 'inner') });
  assert.equal(slotShiftAt(left, 0.4), 65);
  assert.equal(slotShiftAt(right, 0.4), -65);
  assert.equal(laneOffsetAt(left, 0, 0.4), 65);
  assert.equal(slotVaries(left), false);
  assert.equal(lanesVary(left), false);
  assert.deepEqual(slotEnds(left), { start: { outer: 35, inner: 165 }, end: { outer: 35, inner: 165 } });
  assert.deepEqual(slotEnds(right), { start: { outer: 165, inner: 35 }, end: { outer: 165, inner: 35 } });
  assert.deepEqual(slotEnds(piece({ slotPosition: slot(35, 145, 'inner') })),
    { start: { outer: 165, inner: 35 }, end: { outer: 55, inner: 145 } });
});

test('a moving slot is exact at both ends, half-way in the middle and square to both joints', () => {
  const p = piece({ slotPosition: slot(35, 145) });
  assert.equal(slotVaries(p), true);
  assert.equal(lanesVary(p), true);
  for (const t of [-0.5, 0]) assert.equal(slotShiftAt(p, t), 65);
  for (const t of [1, 1.5]) assert.equal(slotShiftAt(p, t), -45);
  assert.equal(slotShiftAt(p, 0.5), 10);
  assert.deepEqual([0, 0.5, 1].map((t) => laneOffsetAt(p, 0, t)), [65, 10, -45]);
  // 10t^3 - 15t^4 + 6t^5 at a quarter is 53 / 512.
  near(slotShiftAt(p, 0.25), 65 - 110 * 53 / 512);
  near(slotShiftAt(p, 0.25) + slotShiftAt(p, 0.75), 20);
  // The ends stay exact where width / 2 - distance does not round nicely.
  const odd = piece({ width: 140.3, slotPosition: slot(20.1, 77.7, 'inner') });
  assert.equal(slotShiftAt(odd, 0), -(140.3 / 2 - 20.1));
  assert.equal(slotShiftAt(odd, 1), -(140.3 / 2 - 77.7));
  for (let t = 0.01; t < 1; t += 0.01)
    assert.ok(slotShiftAt(p, t) < slotShiftAt(p, t - 0.01), 'the slot never turns back');

  assert.deepEqual(slotShiftDerivatives(p, 0), [0, 0]);
  assert.deepEqual(slotShiftDerivatives(p, 1), [0, 0]);
  near(slotShiftDerivatives(p, 0.5)[0], -110 * 1.875);
  near(slotShiftDerivatives(p, 0.5)[1], 0);
  const h = 1e-4;
  for (const t of [0.001, 0.1, 0.2113, 0.5, 0.77, 0.999]) {
    const [speed, acceleration] = slotShiftDerivatives(p, t);
    near(speed, (slotShiftAt(p, t + h) - slotShiftAt(p, t - h)) / (2 * h), 1e-4);
    near(acceleration,
      (slotShiftAt(p, t + h) - 2 * slotShiftAt(p, t) + slotShiftAt(p, t - h)) / h ** 2, 1e-3);
  }
  // The curvature fades to nothing at the joint: 635 at its largest.
  near(Math.max(...Array.from({ length: 999 }, (_, i) => Math.abs(slotShiftDerivatives(p, (i + 1) / 1000)[1]))),
    110 * 10 / Math.sqrt(3), 0.01);
  assert.ok(Math.abs(slotShiftDerivatives(p, 1e-4)[1]) < 1, 'no curvature at the joint');
});

test('the allowed range leaves a printable margin beside the braids or the slot walls', () => {
  assert.deepEqual(slotRange(piece()), { min: 7.5, max: 192.5 });
  assert.deepEqual(slotRange(piece({ braidGap: 2 })), { min: 9.5, max: 190.5 });
  assert.deepEqual(slotRange(piece({ wall: 8 })), { min: 10.5, max: 189.5 });
  assert.deepEqual(slotRange(piece({ wall: 8, hollow: false })), { min: 7.5, max: 192.5 });
  // A bare slot on a solid piece keeps a 2 mm wall to the road edge.
  assert.deepEqual(slotRange(piece({ braidWidth: 0, hollow: false, width: 60 })), { min: 3.5, max: 56.5 });
  assert.deepEqual(slotRange(piece({ braidWidth: 0, width: 60 })), { min: 4.5, max: 55.5 });
});

test('a tight curve says where the slot must sit, in the edge it is measured from', () => {
  // Centre line R105.5 on a 200 mm road: 7.5 mm from the inner edge is a 13 mm slot radius.
  const tight = piece({ kind: 'curve', radius: 105.5, angle: 45, slotPosition: slot(7.5, 7.5, 'inner') });
  assert.doesNotThrow(() => validateSlotPosition(tight));
  const [note] = slotAdvice(tight);
  assert.equal(note.level, 'warning');
  assert.equal(note.text, 'On this curve the slot follows a radius of about 13 mm, tighter than the 105.5 mm centre line. ' +
    "A car's guide can bind below 40 mm. Keep the slot at least 34.5 mm from the inner edge, or use a larger radius.");
  // The advised place really gives a 40 mm slot radius.
  near(slotBend({ ...tight, slotPosition: slot(34.5, 34.5, 'inner') }).minRadius, 40);
  // Typed from the outer edge, the advice uses that edge.
  const outer = piece({ kind: 'curve', radius: 105.5, angle: 45, slotPosition: slot(192.5, 192.5) });
  assert.match(slotAdvice(outer)[0].text, /Keep the slot at most 165\.5 mm from the outer edge, or use a larger radius\.$/);
  // Too close to the centre of the bend to build: the refusal says where it may go.
  assert.throws(() => validateSlotPosition(piece({ kind: 'curve', radius: 103, angle: 45, slotPosition: slot(7.5, 7.5, 'inner') })),
    /^Error: The slot is too close to the centre of the bend\. Keep it at least 10 mm from the inner edge, or use a larger radius\.$/);
});

test('the label names one distance, or both when they differ, and the edge, without trailing zeros', () => {
  assert.equal(slotLabel(piece({ slotPosition: slot(35) })), '35 from left');
  assert.equal(slotLabel(piece({ slotPosition: slot(35, 145) })), '35-145 from left');
  assert.equal(slotLabel(piece({ slotPosition: slot(35.5, 140.25, 'inner') })), '35.5-140.25 from right');
  assert.equal(slotLabel(piece({ slotPosition: slot(35.10000001, 40.999) })), '35.1-41 from left');
  assert.equal(slotLabel(piece({ kind: 'curve', radius: 300, slotPosition: slot(35) })), '35 from outer');
  assert.equal(slotLabel(piece({ kind: 'curve', radius: 300, slotPosition: slot(35, 35, 'inner') })), '35 from inner');
});

test('validation refuses bad data and everything outside stage 1 in plain words', () => {
  const refuses = (extra, message) => {
    assert.throws(() => validateSlotPosition(piece(extra)), message);
    assert.throws(() => validateTrack(piece(extra)), message);
  };
  for (const slotPosition of [
    { version: 2, edge: 'outer', startMm: 35, endMm: 35 },
    { version: 1, edge: 'left', startMm: 35, endMm: 35 },
    { version: 1, edge: 'outer', startMm: '35', endMm: 35 },
    { version: 1, edge: 'outer', startMm: 35 },
    { version: 1, edge: 'outer', startMm: 35, endMm: NaN },
    'centre', 35, false,
  ]) refuses({ slotPosition }, /^Error: Choose a valid slot position/);
  // Phase 2 lets several lanes move together; stage 1 refused them here.
  assert.doesNotThrow(() => validateTrack(piece({ lanes: 2, laneSpacing: 80, slotPosition: slot(35) })));
  refuses({ kind: 'curve', slotPosition: slot(35, 145) },
    /On a curve the slot must be the same distance from the edge at end A and end B/);
  assert.throws(() => validateSlotPosition(piece({ kind: 'import', slotPosition: slot(35) })),
    /plain straights and curves only/);
  assert.throws(() => validateTrack(piece({ kind: 'import', slotPosition: slot(35) })),
    /plain straights and curves only/);
  assert.throws(
    () => validateSlotPosition(piece({ special: { type: 'timing' }, slotPosition: slot(35) })),
    /Special pieces define their own lanes/);
  refuses({ width: 14, slotPosition: slot(7) }, /too narrow for an off-centre slot/);

  assert.doesNotThrow(() => validateTrack(piece({ slotPosition: slot(35, 145) })));
  assert.doesNotThrow(() => validateTrack(piece({ slotPosition: slot(7.5, 192.5), length: 600 })));
  assert.doesNotThrow(() => validateTrack(piece({ kind: 'curve', slotPosition: slot(35, 35, 'inner') })));
});

test('the room people are told about is the half millimetres they can type', () => {
  // A 100 mm road with a 7.1 mm channel half: 8.1 to 91.9 mm exactly.
  const narrow = piece({ width: 100, braidGap: 0.6 });
  const range = slotRange(narrow);
  near(range.min, 8.1);
  near(range.max, 91.9);
  assert.deepEqual(slotRoom(narrow), { min: 8.5, max: 91.5 });
  // Limits already on a half millimetre stay where they are.
  assert.deepEqual(slotRoom(piece()), { min: 7.5, max: 192.5 });
  // 8 is what typing 8.1 snaps to: the message quotes limits that can be typed.
  assert.throws(() => validateTrack({ ...narrow, slotPosition: slot(8) }),
    /^Error: The slot is 8 mm from the left edge\. Keep it between 8\.5 and 91\.5 mm/);
  // A stored value between the exact and the typed limit still builds.
  assert.doesNotThrow(() => validateSlotPosition({ ...narrow, slotPosition: slot(8.2) }));
});

test('the slot and its braids must stay on the road, with the edge named as people see it', () => {
  assert.throws(() => validateTrack(piece({ slotPosition: slot(5, 145) })),
    /^Error: The slot at end A is 5 mm from the left edge\. Keep it between 7\.5 and 192\.5 mm/);
  assert.throws(() => validateTrack(piece({ slotPosition: slot(35, 196, 'inner') })),
    /^Error: The slot at end B is 196 mm from the right edge/);
  assert.throws(() => validateTrack(piece({ slotPosition: slot(7.4) })),
    /^Error: The slot is 7\.4 mm from the left edge/);
  assert.throws(() => validateTrack(piece({ slotPosition: slot(-20) })), /-20 mm from the left edge/);
  assert.throws(
    () => validateTrack(piece({ kind: 'curve', radius: 300, slotPosition: slot(3, 3, 'inner') })),
    /^Error: The slot is 3 mm from the inner edge/);
  assert.throws(
    () => validateTrack(piece({ kind: 'curve', radius: 300, slotPosition: slot(199) })),
    /from the outer edge/);
  // A wider channel narrows the range.
  assert.throws(() => validateTrack(piece({ braidGap: 2, slotPosition: slot(9) })), /between 9\.5 and 190\.5 mm/);
});

test('a curve keeps its slot clear of the centre of the bend', () => {
  // Slot radius 104 - 100 + 7.5 = 11.5 mm with a 6.5 mm half channel.
  const tight = { kind: 'curve', radius: 104, angle: 90, slotPosition: slot(7.5, 7.5, 'inner') };
  assert.throws(() => validateTrack(piece(tight)), /too close to the centre of the bend/);
  assert.doesNotThrow(() => validateTrack(piece({ ...tight, slotPosition: slot(9, 9, 'inner') })));
  assert.deepEqual(slotBend(piece({ ...tight, slotPosition: slot(35, 35, 'inner') })),
    { minRadius: 39, angle: 0 });
  assert.deepEqual(slotBend(piece({ kind: 'curve', radius: 150 })), { minRadius: 150, angle: 0 });
});

test('a sideways move that a guide cannot follow is refused with the length that works', () => {
  assert.equal(SLOT_MIN_RADIUS, 40);
  const p = piece({ length: 120, slotPosition: slot(35, 145) });
  assert.ok(slotBend(p).minRadius < 40);
  assert.equal(slotLengthFor(p, 40), 140);
  assert.throws(() => validateTrack(p),
    /^Error: The slot moves sideways too sharply for a car's guide to follow\. Use a piece at least 140 mm long, or a smaller sideways move\.$/);
  // The suggested length passes and one millimetre less does not.
  assert.doesNotThrow(() => validateTrack(piece({ length: 140, slotPosition: slot(35, 145) })));
  assert.throws(() => validateTrack(piece({ length: 139, slotPosition: slot(35, 145) })), /too sharply/);
  assert.ok(slotBend(piece({ length: 140, slotPosition: slot(35, 145) })).minRadius >= 40);
  assert.doesNotThrow(() => validateTrack(piece({ length: 120, slotPosition: slot(35, 60) })));
  // Either direction and either edge is the same curve.
  assert.throws(() => validateTrack(piece({ length: 120, slotPosition: slot(145, 35, 'inner') })),
    /at least 140 mm long/);
});

test('the tightest slot bend is the real curve, not the shallow-slope estimate', () => {
  // Brute force over the drawn curve [x, shift(x / length)].
  const radius = (p) => {
    let tightest = Infinity;
    const at = (t) => [p.length * t, slotShiftAt(p, t)];
    for (let i = 1; i < 4000; i++) {
      const [a, b, c] = [at((i - 1) / 4000), at(i / 4000), at((i + 1) / 4000)];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const ac = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const cross = Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]));
      if (cross > 0) tightest = Math.min(tightest, ab * bc * ac / (2 * cross));
    }
    return tightest;
  };
  for (const [length, startMm, endMm] of [[200, 35, 145], [300, 35, 145], [140, 35, 145], [400, 100, 110], [60, 100, 130]]) {
    const p = piece({ length, slotPosition: slot(startMm, endMm) });
    const { minRadius, angle } = slotBend(p);
    near(minRadius, radius(p), minRadius * 2e-3);
    near(angle, Math.atan(1.875 * Math.abs(endMm - startMm) / length) * 180 / Math.PI);
  }
  near(slotBend(piece({ length: 200, slotPosition: slot(35, 145) })).minRadius, 75.28, 0.01);
  // A gentle slot matches length^2 / (5.77 * move).
  near(slotBend(piece({ length: 1000, slotPosition: slot(95, 105) })).minRadius, 1000 ** 2 / (10 / Math.sqrt(3) * 10), 20);
});

test('validateTrack measures the fit across the road from where the slot really is', () => {
  // 3 + 2 * 60 mm of slot and braid fits a 200 mm road only near its middle.
  const wide = { braidWidth: 60, hollow: false, height: 20 };
  assert.doesNotThrow(() => validateTrack(piece(wide)));
  assert.doesNotThrow(() => validateTrack(piece({ ...wide, slotPosition: slot(100) })));
  assert.throws(() => validateTrack(piece({ ...wide, slotPosition: slot(50) })), /stay on the road/);
  assert.throws(() => validateTrack(piece({ width: 120, braidWidth: 60, hollow: false })),
    /do not fit across this road/);
});

test('a native path always publishes its lane offsets, and lane curves only when they move', () => {
  const centred = nativePath(piece());
  assert.deepEqual(centred.laneOffsets(0.3), [0]);
  assert.equal(centred.laneCurves, undefined);
  assert.equal(centred.measuredLanes, undefined);
  assert.deepEqual(nativePath(piece({ lanes: 3, laneSpacing: 50 })).laneOffsets(0.7), [-50, 0, 50]);
  assert.deepEqual(nativePath(trackParameters(defaultTrack())).laneOffsets(1), [-32.5, 32.5]);

  const fixed = nativePath(piece({ slotPosition: slot(35) }));
  assert.deepEqual([0, 0.5, 1].map((t) => fixed.laneOffsets(t)), [[65], [65], [65]]);
  assert.equal(fixed.laneCurves, undefined);
  const curve = nativePath(piece({ kind: 'curve', radius: 300, angle: 45, slotPosition: slot(35, 35, 'inner') }));
  assert.deepEqual(curve.laneOffsets(0.5), [-65]);
  assert.equal(curve.laneCurves, undefined);

  const p = piece({ slotPosition: slot(35, 145) });
  const moving = nativePath(p);
  assert.deepEqual([0, 0.5, 1].map((t) => moving.laneOffsets(t)), [[65], [10], [-45]]);
  assert.equal(moving.laneCurves.length, 1);
  assert.deepEqual(moving.laneCurves[0][0], [-150, 65]);
  assert.deepEqual(moving.laneCurves[0].at(-1), [150, -45]);
  for (const normal of [moving.laneNormals[0][0], moving.laneNormals[0].at(-1)])
    assert.deepEqual([Math.abs(normal[0]), normal[1]], [0, 1], 'square to the joint');
  // The drawn chords stay within 0.015 mm of the true curve.
  const lane = moving.laneCurves[0];
  for (let i = 1; i < lane.length; i++) {
    const t = ((lane[i - 1][0] + lane[i][0]) / 2 + 150) / 300;
    near((lane[i - 1][1] + lane[i][1]) / 2, slotShiftAt(p, t), 0.015);
  }
  near(moving.measuredLanes[0].total, 326.7, 0.1);
  near(moving.measuredLanes[0].at(0.5)[1], 10, 1e-6);
});

const texts = (p) => slotAdvice(p).map((item) => item.text).join('\n');

test('advice is never blocking and speaks about bend, angle, body room and direction', () => {
  assert.equal(SLOT_GENTLE_RADIUS, 150);
  assert.deepEqual(slotConnectorNotes(piece()), []);
  for (const item of slotAdvice(piece({ length: 200, slotPosition: slot(20, 145) }))) {
    assert.ok(['note', 'warning'].includes(item.level));
    assert.equal(typeof item.text, 'string');
  }

  const sharp = piece({ length: 200, slotPosition: slot(35, 145) });
  const bend = slotAdvice(sharp).find((item) => /tightest bend/.test(item.text));
  assert.equal(bend.level, 'warning');
  assert.match(bend.text, /about 75 mm radius\. For a gentle 150 mm or more, make the piece at least 293 mm long\./);
  assert.equal(slotLengthFor(sharp, 150), 293);
  assert.ok(slotBend(piece({ length: 293, slotPosition: slot(35, 145) })).minRadius >= 150);
  assert.match(texts(sharp), /Mid-way the slot runs at 45\.9° to the road edge\./);

  const gentle = slotAdvice(piece({ length: 300, slotPosition: slot(35, 145) }))
    .find((item) => /tightest bend/.test(item.text));
  assert.equal(gentle.level, 'note');
  assert.match(gentle.text, /about 157 mm radius, which is gentle/);

  // A slot that keeps its distance has no bend, angle or direction to mention.
  assert.doesNotMatch(texts(piece({ slotPosition: slot(35) })), /bend|Mid-way|End A and end B/);
});

test('advice mentions the edge a car body overhangs unless a border is already there', () => {
  assert.match(texts(piece({ slotPosition: slot(20) })),
    /The slot is only 20 mm from the left edge\. A 1:32 car body overhangs that edge, so a border on that side helps\./);
  assert.match(texts(piece({ slotPosition: slot(20, 20, 'inner') })), /only 20 mm from the right edge/);
  assert.match(texts(piece({ slotPosition: slot(100, 25) })), /At end B the slot is only 25 mm from the left edge/);
  assert.match(texts(piece({ slotPosition: slot(180, 100) })), /At end A the slot is only 20 mm from the right edge/);
  assert.match(texts(piece({ kind: 'curve', radius: 300, slotPosition: slot(20) })), /only 20 mm from the outer edge/);
  assert.doesNotMatch(texts(piece({ slotPosition: slot(30) })), /car body/);
  assert.doesNotMatch(texts(piece({ slotPosition: slot(20), borderSide: 'outer' })), /car body/);
  assert.doesNotMatch(texts(piece({ slotPosition: slot(20), borderSide: 'both' })), /car body/);
  assert.match(texts(piece({ slotPosition: slot(20), borderSide: 'inner' })), /car body/);
});

test('advice says a piece with different ends has a direction, and that tabs fix it', () => {
  const p = { slotPosition: slot(35, 145) };
  assert.match(texts(piece(p)),
    /End A and end B are different\. To bring the slot back, make a second piece with the two distances swapped\./);
  assert.match(texts(piece({ ...p, joint: 'tabs' })),
    /End A and end B are different, and tab joints fit one way round only, so this piece cannot be turned round\./);
  assert.match(texts(piece({ ...p, joint: 'clips', jointEnd: 'both' })), /cannot be turned round/);
  assert.doesNotMatch(texts(piece({ ...p, joint: 'clips' })), /cannot be turned round/);
});

test('advice gives the slot radius of a curve whose slot sits inside the centre line', () => {
  const curve = { kind: 'curve', radius: 150, angle: 45 };
  const inside = slotAdvice(piece({ ...curve, slotPosition: slot(35, 35, 'inner') }));
  assert.deepEqual(inside.filter((item) => /radius/.test(item.text)), [{
    level: 'note',
    text: 'On this curve the slot follows a radius of about 85 mm, tighter than the 150 mm centre line.',
  }]);
  assert.equal(slotAdvice(piece({ ...curve, radius: 104, slotPosition: slot(35, 35, 'inner') }))
    .find((item) => /radius/.test(item.text)).level, 'warning');
  assert.doesNotMatch(texts(piece({ ...curve, slotPosition: slot(35) })), /radius/);
  assert.doesNotMatch(texts(piece({ ...curve, radius: 400, slotPosition: slot(35, 35, 'inner') })), /radius/);
});

test('advice stays quiet instead of throwing on unfinished input', () => {
  assert.deepEqual(slotAdvice(piece({ slotPosition: slot(NaN, 145) })), []);
  assert.deepEqual(slotAdvice({ ...piece({ slotPosition: slot(35) }), width: undefined }), []);
});

// Phase 2: several lanes, moving together or set one by one.
const each = (lanes, edge = 'outer') => ({
  version: 1, edge, lanes: lanes.map(([startMm, endMm = startMm]) => ({ startMm, endMm })),
});
const pack = (extra = {}) => piece({ lanes: 2, laneSpacing: 70, ...extra });

test('the slot form says whether lanes are centred, move together or are set one by one', () => {
  assert.equal(slotForm(pack()), 'none');
  assert.equal(slotForm(pack({ slotPosition: slot(35) })), 'together');
  assert.equal(slotForm(piece({ slotPosition: slot(35) })), 'together');
  assert.equal(slotForm(pack({ slotPosition: each([[35], [120]]) })), 'each');
  assert.deepEqual(slotDistances(pack(), 0), []);
  assert.equal(slotVaries(pack({ slotPosition: each([[35], [120]]) })), false);
  assert.equal(slotVaries(pack({ slotPosition: each([[35], [120, 130]]) })), true);
  assert.equal(lanesVary(pack({ slotPosition: each([[35], [120, 130]]) })), true);
});

test('lanes moving together: slot 1 sits at the typed distance and the others follow every lane spacing', () => {
  // 200 mm road, spacing 70: the slot nearest the left edge goes from 35 to 95 mm.
  const p = pack({ slotPosition: slot(35, 95) });
  assert.deepEqual(slotDistances(p, 0), [35, 105]);
  assert.deepEqual(slotDistances(p, 1), [95, 165]);
  assert.deepEqual(slotDistances(p, -1), [35, 105]);
  assert.deepEqual(slotDistances(p, 2), [95, 165]);
  near(slotDistances(p, 0.5)[0], 65);
  near(slotDistances(p, 0.25)[1], 105 + 60 * 53 / 512);
  // Outer is the left edge: slot 1 is the highest lane index.
  assert.deepEqual([0, 1].map((i) => laneOffsetAt(p, i, 0)), [-5, 65]);
  assert.deepEqual([0, 1].map((i) => laneOffsetAt(p, i, 1)), [-65, 5]);
  assert.deepEqual([0, 1].map((i) => laneOffsetAt(p, i, 0.5)), [-35, 35]);
  assert.equal(slotShiftAt(p, 0), 30);
  // From the right edge, slot 1 is lane 0.
  const right = pack({ slotPosition: slot(35, 95, 'inner') });
  assert.deepEqual([0, 1].map((i) => laneOffsetAt(right, i, 0)), [-65, 5]);
  assert.deepEqual([0, 1].map((i) => laneOffsetAt(right, i, 1)), [-5, 65]);
  // A spacing change moves the others; a width change keeps the typed distance.
  assert.deepEqual(slotDistances({ ...p, laneSpacing: 60 }, 0), [35, 95]);
  assert.deepEqual(laneOffsetAt({ ...p, width: 240 }, 1, 0), 85);
  for (const t of [0.1, 0.5, 0.8]) {
    assert.deepEqual(slotLaneOffsetDerivatives(p, 0, t), slotShiftDerivatives(p, t));
    assert.equal(slotLaneOffsetAt(p, 1, t), laneOffsetAt(p, 1, t));
  }
});

test('each lane set: entries count from the chosen edge and blend their own ends with the same S', () => {
  const p = pack({ slotPosition: each([[40, 60], [140, 120]]) });
  assert.deepEqual(slotDistances(p, 0), [40, 140]);
  assert.deepEqual(slotDistances(p, 1), [60, 120]);
  assert.deepEqual(slotGaps(p, 0), [100]);
  assert.deepEqual(slotGaps(p, 1), [60]);
  near(slotDistances(p, 0.25)[0], 40 + 20 * 53 / 512);
  near(slotDistances(p, 0.25)[1], 140 - 20 * 53 / 512);
  // Left edge: entry 0 is lane 1.
  assert.deepEqual([0, 1].map((i) => laneOffsetAt(p, i, 0)), [-40, 60]);
  assert.deepEqual([0, 1].map((i) => laneOffsetAt(p, i, 1)), [-20, 40]);
  assert.deepEqual([0, 1].map((i) => laneOffsetAt(p, i, 0.5)), [-30, 50]);
  // Right edge: entry 0 is lane 0.
  const right = pack({ slotPosition: each([[40, 60], [140, 120]], 'inner') });
  assert.deepEqual([0, 1].map((i) => laneOffsetAt(right, i, 0)), [-60, 40]);
  assert.deepEqual([0, 1].map((i) => laneOffsetAt(right, i, 1)), [-40, 20]);
  // Exact ends where width / 2 - distance does not round nicely.
  const odd = pack({ width: 140.3, slotPosition: each([[20.1, 30.7], [77.7, 101.1]], 'inner') });
  assert.deepEqual(slotDistances(odd, 0), [20.1, 77.7]);
  assert.deepEqual(slotDistances(odd, 1), [30.7, 101.1]);
  // Lane derivatives are each lane's own, and square to both joints.
  const h = 1e-5;
  for (const i of [0, 1]) {
    assert.deepEqual(laneOffsetDerivatives(p, i, 0), [0, 0]);
    assert.deepEqual(laneOffsetDerivatives(p, i, 1), [0, 0]);
    for (const t of [0.2, 0.5, 0.7]) {
      const [speed] = laneOffsetDerivatives(p, i, t);
      near(speed, (laneOffsetAt(p, i, t + h) - laneOffsetAt(p, i, t - h)) / (2 * h), 1e-4);
    }
  }
  assert.ok(laneOffsetDerivatives(p, 1, 0.5)[0] < 0 && laneOffsetDerivatives(p, 0, 0.5)[0] > 0);
  // Three lanes from the right edge.
  const three = piece({ lanes: 3, laneSpacing: 50, slotPosition: each([[20, 40], [80, 100], [150, 170]], 'inner') });
  assert.deepEqual([0, 1, 2].map((i) => laneOffsetAt(three, i, 0)), [-80, -20, 50]);
  assert.deepEqual([0, 1, 2].map((i) => laneOffsetAt(three, i, 1)), [-60, 0, 70]);
  assert.deepEqual(nativePath(three).laneOffsets(1), [-60, 0, 70]);
});

test('end lists name every slot from each edge, nearest first, and slotEnds the nearest one', () => {
  const p = pack({ slotPosition: each([[40, 60], [140, 120]]) });
  assert.deepEqual(slotEndLists(p), {
    start: { outer: [40, 140], inner: [60, 160] },
    end: { outer: [60, 120], inner: [80, 140] },
  });
  assert.deepEqual(slotEnds(p), { start: { outer: 40, inner: 60 }, end: { outer: 60, inner: 80 } });
  assert.deepEqual(slotEndLists(pack({ slotPosition: slot(35, 95, 'inner') })), {
    start: { outer: [95, 165], inner: [35, 105] },
    end: { outer: [35, 105], inner: [95, 165] },
  });
  // Centred lanes sit symmetrically.
  assert.deepEqual(slotEndLists(piece({ lanes: 3, laneSpacing: 50 })).start, { outer: [50, 100, 150], inner: [50, 100, 150] });
  assert.deepEqual(slotEnds(pack()), { start: { outer: 65, inner: 65 }, end: { outer: 65, inner: 65 } });
  // One lane keeps the stage 1 shape.
  assert.deepEqual(slotEndLists(piece({ slotPosition: slot(35, 145) })), {
    start: { outer: [35], inner: [165] }, end: { outer: [145], inner: [55] },
  });
});

test('labels and titles list every slot at each end', () => {
  assert.equal(slotLabel(pack({ slotPosition: slot(35, 55) })), '35/105-55/125 from left');
  assert.equal(slotLabel(pack({ slotPosition: slot(35) })), '35/105 from left');
  assert.equal(slotLabel(pack({ slotPosition: each([[35, 55], [135, 155]]) })), '35/135-55/155 from left');
  assert.equal(slotLabel(pack({ slotPosition: each([[35], [135]]) })), '35/135 from left');
  assert.equal(slotLabel(pack({ kind: 'curve', radius: 300, slotPosition: each([[20.25], [100]], 'inner') })), '20.25/100 from inner');
  // A slot that stays still on a piece whose other slot moves is listed at both ends.
  assert.equal(slotLabel(pack({ slotPosition: each([[35], [135, 155]]) })), '35/135-35/155 from left');
  assert.equal(slotTitle(pack()), '');
  assert.equal(slotTitle(piece({ slotPosition: slot(35, 145) })), 'slot 35-145 from left');
  assert.equal(slotTitle(pack({ slotPosition: each([[35], [135]]) })), 'slots 35/135 from left');
});

test('normalising never stores a centred slot, and stores evenly spaced lanes as moving together', () => {
  assert.equal(normaliseSlotPosition(pack()), undefined);
  assert.equal(normaliseSlotPosition(pack({ slotPosition: slot(65) })), undefined);
  assert.equal(normaliseSlotPosition(pack({ slotPosition: slot(65, 65, 'inner') })), undefined);
  assert.equal(normaliseSlotPosition(pack({ slotPosition: each([[65], [135]]) })), undefined);
  assert.equal(normaliseSlotPosition(piece({ slotPosition: slot(100) })), undefined);
  assert.deepEqual(normaliseSlotPosition(pack({ slotPosition: each([[35, 95], [105, 165]]) })),
    { version: 1, edge: 'outer', startMm: 35, endMm: 95 });
  assert.deepEqual(normaliseSlotPosition(pack({ slotPosition: each([[35, 95], [105, 160]], 'inner') })),
    { version: 1, edge: 'inner', lanes: [{ startMm: 35, endMm: 95 }, { startMm: 105, endMm: 160 }] });
  // Only one end centred is still off-centre.
  assert.deepEqual(normaliseSlotPosition(pack({ slotPosition: slot(65, 30) })), slot(65, 30));
  // Extra keys are dropped; malformed data is left for validation to refuse.
  assert.deepEqual(normaliseSlotPosition(piece({ slotPosition: { ...slot(35), note: 1 } })), slot(35));
  const bad = { version: 1, edge: 'outer', lanes: [{ startMm: 35 }] };
  assert.equal(normaliseSlotPosition(pack({ slotPosition: bad })), bad);
});

test('validation of several slots names the slot and the end', () => {
  const refuses = (extra, message) => {
    assert.throws(() => validateSlotPosition(piece(extra)), message);
    assert.throws(() => validateTrack(piece(extra)), message);
  };
  const two = { lanes: 2, laneSpacing: 70 };
  for (const slotPosition of [
    { version: 1, edge: 'outer', lanes: [{ startMm: 35 }, { startMm: 100, endMm: 100 }] },
    { version: 1, edge: 'outer', lanes: [] },
    { version: 1, edge: 'outer', startMm: 35, endMm: 35, lanes: [{ startMm: 35, endMm: 35 }, { startMm: 100, endMm: 100 }] },
  ]) refuses({ ...two, slotPosition }, /^Error: Choose a valid slot position: an edge, and a distance for every slot at end A and end B\.$/);
  refuses({ slotPosition: each([[35]]) }, /^Error: Set each lane needs two or more lanes\. A single lane uses Lanes move together\.$/);
  refuses({ lanes: 3, laneSpacing: 50, slotPosition: each([[35], [100]]) },
    /^Error: Give every lane its own slot position: this piece has 3 lanes and 2 slot positions\.$/);
  refuses({ ...two, slotPosition: each([[35, 95], [105, 196]]) },
    /^Error: Slot 2 at end B is 196 mm from the left edge\. Keep it between 7\.5 and 192\.5 mm so the slot and braids stay on the road\.$/);
  refuses({ ...two, slotPosition: each([[5], [105]], 'inner') }, /^Error: Slot 1 is 5 mm from the right edge\./);
  // Together, every following slot must fit too: 145 + 70 is off the road.
  refuses({ ...two, slotPosition: slot(35, 145) }, /^Error: Slot 2 at end B is 215 mm from the left edge/);
  refuses({ ...two, slotPosition: each([[35, 100], [105, 90]]) },
    /^Error: At end B slot 2 is not further from the left edge than slot 1\. Number the slots from the left edge, slot 1 nearest it: lanes never cross\.$/);
  refuses({ ...two, slotPosition: each([[35, 60], [44, 120]]) },
    /^Error: At end A slots 1 and 2 are only 9 mm apart\. Keep neighbouring slots more than 13 mm apart so their braids do not meet\.$/);
  refuses({ ...two, slotPosition: each([[35], [48]]) }, /^Error: Slots 1 and 2 are only 13 mm apart\./);
  assert.equal(slotLaneEnvelope(piece()), 13);
  assert.doesNotThrow(() => validateTrack(piece({ ...two, slotPosition: each([[35], [48.5]]) })));
  refuses({ ...two, kind: 'curve', radius: 300, slotPosition: each([[35], [105, 110]]) },
    /^Error: On a curve every slot must be the same distance from the edge at end A and end B\. Use a straight to move the slots sideways\.$/);
  refuses({ ...two, kind: 'curve', radius: 300, slotPosition: slot(35, 40) }, /On a curve every slot must be/);
  // The slot nearest the centre of the bend decides, whichever edge it is measured from.
  const tight = { ...two, kind: 'curve', radius: 104, angle: 90 };
  refuses({ ...tight, slotPosition: each([[7.5], [60]], 'inner') },
    /^Error: Slot 1 is too close to the centre of the bend\. Keep it at least 9 mm from the inner edge, or use a larger radius\.$/);
  refuses({ ...tight, slotPosition: each([[132.5], [192.5]]) },
    /^Error: Slot 2 is too close to the centre of the bend\. Keep it at most 191 mm from the outer edge, or use a larger radius\.$/);
  assert.doesNotThrow(() => validateTrack(piece({ ...tight, slotPosition: each([[9], [60]], 'inner') })));
  // Every slot on a straight keeps the 40 mm guide radius; the worst one is named.
  refuses({ ...two, length: 120, slotPosition: each([[35, 145], [160, 165]]) },
    /^Error: Slot 1 moves sideways too sharply for a car's guide to follow\. Use a piece at least 140 mm long, or a smaller sideways move\.$/);
  refuses({ lanes: 2, laneSpacing: 40, length: 120, slotPosition: slot(35, 145) },
    /^Error: The slots move sideways too sharply for a car's guide to follow\. Use a piece at least 140 mm long/);
  assert.doesNotThrow(() => validateTrack(piece({ ...two, length: 140, slotPosition: each([[35, 145], [160, 165]]) })));
  // Squeeze or spread and a slot position never share a piece.
  refuses({ ...two, laneAdjustment: { version: 1, mode: 'squeeze', spacingMm: 40, anchor: 'centre' }, slotPosition: slot(35) },
    /^Error: A piece can squeeze or spread its lanes, or move its slots, not both\. Choose one/);
  // Specials, freeform paths and imports keep their own slots, as in stage 1.
  assert.throws(() => validateSlotPosition(piece({ ...two, special: { type: 'timing' }, slotPosition: each([[35], [105]]) })),
    /Special pieces define their own lanes/);
  assert.throws(() => validateSlotPosition(piece({ ...two, kind: 'import', slotPosition: each([[35], [105]]) })),
    /plain straights and curves only/);
  // Lanes set one by one may sit closer than the pack spacing; together they may not.
  assert.doesNotThrow(() => validateTrack(piece({ lanes: 2, laneSpacing: 10, slotPosition: each([[35], [70]]) })));
  assert.throws(() => validateTrack(piece({ lanes: 2, laneSpacing: 10, slotPosition: slot(35) })),
    /do not fit across this road/);
});

test('moving together, range and bend limits on another slot are also said for slot 1', () => {
  const three = { lanes: 3, laneSpacing: 50 };
  assert.throws(() => validateTrack(piece({ ...three, slotPosition: slot(20, 96) })),
    /^Error: Slot 3 at end B is 196 mm from the left edge\. Keep it between 7\.5 and 192\.5 mm so the slot and braids stay on the road\. With the lanes moving together, keep slot 1 at end B at most 92\.5 mm from the left edge\.$/);
  assert.throws(() => validateTrack(piece({ ...three, slotPosition: slot(96) })),
    /^Error: Slot 3 is 196 mm from the left edge\. Keep it between 7\.5 and 192\.5 mm so the slot and braids stay on the road\. With the lanes moving together, keep slot 1 at most 92\.5 mm from the left edge\.$/);
  // The limit given for slot 1 is one that builds.
  assert.doesNotThrow(() => validateTrack(piece({ ...three, slotPosition: slot(20, 92.5) })));
  // Too close to its own edge, slot 1 already has the number to type.
  assert.throws(() => validateTrack(piece({ ...three, slotPosition: slot(5, 20) })),
    /^Error: Slot 1 at end A is 5 mm from the left edge\. Keep it between 7\.5 and 192\.5 mm so the slot and braids stay on the road\.$/);
  // Lanes set one by one keep the plain text: every slot can be typed.
  assert.throws(() => validateTrack(piece({ ...three, slotPosition: each([[20], [70], [196]]) })),
    /^Error: Slot 3 is 196 mm from the left edge\. Keep it between 7\.5 and 192\.5 mm so the slot and braids stay on the road\.$/);
  // On a curve measured from the outer edge the innermost slot is the last one.
  const tight = { lanes: 2, laneSpacing: 70, kind: 'curve', radius: 104, angle: 90 };
  assert.throws(() => validateTrack(piece({ ...tight, slotPosition: slot(122.5) })),
    /^Error: Slot 2 is too close to the centre of the bend\. Keep it at most 191 mm from the outer edge, or use a larger radius\. With the lanes moving together, keep slot 1 at most 121 mm from the outer edge\.$/);
  assert.doesNotThrow(() => validateTrack(piece({ ...tight, slotPosition: slot(121) })));
  // From the inner edge slot 1 is the innermost: nothing is added.
  assert.throws(() => validateTrack(piece({ ...tight, slotPosition: slot(7.5, 7.5, 'inner') })),
    /^Error: Slot 1 is too close to the centre of the bend\. Keep it at least 9 mm from the inner edge, or use a larger radius\.$/);
  // The curve advice says the same for slot 1.
  const bend = { lanes: 2, laneSpacing: 70, kind: 'curve', radius: 130, angle: 90 };
  const warning = slotAdvice(piece({ ...bend, slotPosition: slot(122) }))[0].text;
  assert.match(warning, /Keep slot 2 at most 190 mm from the outer edge, or use a larger radius\. With the lanes moving together, keep slot 1 at most 120 mm from the outer edge\.$/);
  assert.ok(!/bind below/.test(texts(piece({ ...bend, slotPosition: slot(120) }))));
  assert.match(slotAdvice(piece({ ...bend, slotPosition: each([[52], [192]]) }))[0].text,
    /Keep slot 2 at most 190 mm from the outer edge, or use a larger radius\.$/);
});

test('the 40 mm guide radius refusal suggests a length that also keeps neighbouring slots apart', () => {
  // Both slots move 130 mm only 16 mm apart: the radius alone wants 150 mm, the braids 340 mm.
  const p = piece({ lanes: 2, laneSpacing: 70, length: 100, slotPosition: each([[20, 150], [36, 166]]) });
  assert.equal(slotLengthFor(p, SLOT_MIN_RADIUS), 150);
  const length = slotLengthForClearance(p, (gap) => gap > slotLaneEnvelope(p));
  assert.ok(length > 150);
  assert.throws(() => validateTrack(p),
    new RegExp("^Error: The slots move sideways too sharply for a car's guide to follow\\. Use a piece at least " + length + ' mm long, or a smaller sideways move\\.$'));
  // The suggested length builds, and one millimetre less does not.
  assert.doesNotThrow(() => validateTrack({ ...p, length }));
  assert.throws(() => validateTrack({ ...p, length: length - 1 }));
  // Where the radius needs more than the braids, the radius length stays.
  const far = piece({ lanes: 2, laneSpacing: 70, length: 120, slotPosition: each([[35, 145], [160, 165]]) });
  assert.throws(() => validateTrack(far), /Use a piece at least 140 mm long/);
  assert.doesNotThrow(() => validateTrack({ ...far, length: 140 }));
  // A single lane keeps the Stage 1 radius length.
  assert.throws(() => validateTrack(piece({ length: 100, slotPosition: slot(35, 145) })), /Use a piece at least 140 mm long/);
});

test('the guide radius refusal names one slot only when it moves further than the others', () => {
  const two = { lanes: 2, laneSpacing: 70, length: 100 };
  assert.throws(() => validateTrack(piece({ ...two, slotPosition: each([[20, 110], [100, 190]]) })),
    /^Error: The slots move sideways too sharply for a car's guide to follow\./);
  assert.throws(() => validateTrack(piece({ ...two, slotPosition: each([[20, 110], [100, 185]]) })),
    /^Error: Slot 1 moves sideways too sharply for a car's guide to follow\./);
  assert.throws(() => validateTrack(piece({ ...two, slotPosition: each([[20, 105], [100, 190]]) })),
    /^Error: Slot 2 moves sideways too sharply for a car's guide to follow\./);
});

// Brute force: the closest two dense polylines of the slot centres come.
function bruteClearance(p, a, b, n = 1500) {
  const curve = (k) => Array.from({ length: n + 1 }, (_, i) => [p.length * i / n, slotDistances(p, i / n)[k]]);
  const first = curve(a), second = curve(b);
  let best = Infinity;
  for (const [x, y] of first) for (const [u, v] of second) best = Math.min(best, Math.hypot(x - u, y - v));
  return best;
}

test('neighbouring slots come closer where they cross the road at an angle', () => {
  // Together, 70 mm apart at both ends, the S brings them to about 70 cos(angle).
  const p = pack({ slotPosition: slot(35, 95) });
  near(slotClearance(p).mm, bruteClearance(p, 0, 1), 0.05);
  assert.ok(slotClearance(p).mm < 70 && slotClearance(p).mm > 70 * Math.cos(21 * Math.PI / 180));
  // A spacing change from 100 to 60 mm narrows to its smaller end.
  const change = pack({ slotPosition: each([[40, 60], [140, 120]]) });
  near(slotClearance(change).mm, 60, 1e-6);
  // Curves and still slots: the gap at the ends.
  assert.deepEqual(slotClearances(pack({ kind: 'curve', radius: 300, slotPosition: each([[20], [100]]) })), [80]);
  const three = piece({ lanes: 3, laneSpacing: 50, length: 200, slotPosition: each([[20, 120], [36, 136], [120, 180]], 'inner') });
  const clear = slotClearances(three);
  near(clear[0], bruteClearance(three, 0, 1), 0.05);
  near(clear[1], bruteClearance(three, 1, 2), 0.05);
  assert.deepEqual(slotClearance(three).slot, 0);
  assert.deepEqual(slotClearances(pack()), [], 'centred pieces have no slot list');
});

test('slots that come within their braids of each other along the S are refused with a length that works', () => {
  const p = pack({ length: 200, slotPosition: each([[20, 120], [36, 136]]) });
  assert.ok(slotClearance(p).mm < 13 && slotGaps(p, 0)[0] === 16);
  const length = slotLengthForClearance(p, (mm) => mm > 13);
  assert.throws(() => validateTrack(p), new RegExp(
    '^Error: Along the piece slots 1 and 2 come within ' + Number(slotClearance(p).mm.toFixed(2)) +
    ' mm of each other\\. Keep neighbouring slots more than 13 mm apart so their braids do not meet: use a piece at least ' +
    length + ' mm long, or move the slots less\\.$'));
  assert.doesNotThrow(() => validateTrack({ ...p, length }));
  assert.throws(() => validateTrack({ ...p, length: length - 1 }), /come within/);
  // Lanes moving together are checked the same way.
  assert.throws(() => validateTrack(piece({ lanes: 2, laneSpacing: 16, length: 200, slotPosition: slot(20, 120) })),
    /^Error: Along the piece slots 1 and 2 come within/);
  assert.equal(slotLengthForClearance(pack({ slotPosition: slot(35) }), () => false), 0);
});

test('a path hands each lane its own measured braid line, by index', () => {
  const p = pack({ slotPosition: each([[40, 60], [140, 120]]) });
  const path = nativePath(p);
  assert.equal(path.measuredLanes.length, 2);
  const starts = path.laneOffsets(0);
  assert.deepEqual(starts, [-40, 60]);
  for (const i of [0, 1]) {
    assert.equal(nativeBraidLane(p, path, starts[i], i), path.measuredLanes[i]);
    assert.equal(nativeBraidLane(p, path, starts[i]), path.measuredLanes[i], 'nearest lane without an index');
    near(path.measuredLanes[i].at(0.5)[1], [-30, 50][i], 1e-6);
  }
  // Still slots are cut as plain bands at their own offsets.
  const still = nativePath(pack({ slotPosition: each([[30], [150]], 'inner') }));
  assert.equal(still.laneCurves, undefined);
  assert.deepEqual(still.laneOffsets(0.4), [-70, 50]);
  assert.equal(nativeBraidLane(pack(), nativePath(pack()), 35, 1).total, 300);
});

const several = (p) => slotAdvice(p).map((item) => item.level + ': ' + item.text);

test('advice for several slots names the worst slot, the narrowest spacing and the edges', () => {
  assert.deepEqual(several(pack({ length: 200, slotPosition: slot(20, 120) })), [
    'warning: The tightest bend in the slots is about 81 mm radius. For a gentle 150 mm or more, make the piece at least 281 mm long.',
    'note: Mid-way the slots run at 43.2° to the road edge.',
    'warning: Along the piece slots 1 and 2 come within 51.5 mm of each other, against 70 mm at the ends. To keep them within 5 mm of that, make the piece at least 469 mm long.',
    'note: At end A slot 1 is only 20 mm from the left edge. A 1:32 car body overhangs that edge, so a border on that side helps.',
    'note: At end B slot 2 is only 10 mm from the right edge. A 1:32 car body overhangs that edge, so a border on that side helps.',
    'note: End A and end B are different. To bring the slots back, make a second piece with end A and end B swapped.',
  ]);
  // The suggested length really keeps the spacing within 5 mm.
  assert.ok(70 - slotClearance(pack({ length: 469, slotPosition: slot(20, 120) })).mm <= 5);
  assert.ok(70 - slotClearance(pack({ length: 468, slotPosition: slot(20, 120) })).mm > 5);
  assert.deepEqual(several(pack({ slotPosition: each([[40, 60], [140, 120]]) })), [
    'note: The tightest bend in slot 1 is about 783 mm radius, which is gentle.',
    'note: Mid-way slot 1, the steepest, runs at 7.1° to the road edge.',
    'note: At end B slots 1 and 2 are 60 mm apart, closer than the 70 mm lane spacing. Cars on neighbouring lanes may touch.',
    'note: End A and end B are different. To bring the slots back, make a second piece with end A and end B swapped.',
  ]);
  assert.deepEqual(several(pack({ kind: 'curve', radius: 105, angle: 45, slotPosition: each([[30], [180]]) })), [
    "warning: On this curve slot 2 follows a radius of about 25 mm, tighter than the 105 mm centre line. A car's guide can bind below 40 mm. Keep slot 2 at most 165 mm from the outer edge, or use a larger radius.",
    'note: Slot 2 is only 20 mm from the inner edge. A 1:32 car body overhangs that edge, so a border on that side helps.',
  ]);
  assert.match(several(pack({ kind: 'curve', radius: 300, slotPosition: each([[10], [60]], 'inner') })).join('\n'),
    /note: Slots 1 and 2 are 50 mm apart, closer than the 70 mm lane spacing\./);
  assert.doesNotMatch(several(pack({ slotPosition: each([[10], [60]], 'inner'), borderSide: 'inner' })).join('\n'), /car body/);
  assert.match(several(pack({ slotPosition: slot(35, 95), joint: 'tabs' })).join('\n'), /cannot be turned round/);
  assert.deepEqual(slotAdvice(pack({ slotPosition: each([[NaN], [60]]) })), []);
  assert.deepEqual(slotAdvice(pack({ slotPosition: slot(35), laneSpacing: undefined })), []);
});
