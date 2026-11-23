import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTrack, nativePath, trackParameters, validateTrack } from '../src/track.js';
import { laneOffsetAt } from '../src/lane-adjustment.js';
import {
  SLOT_GENTLE_RADIUS,
  SLOT_MIN_RADIUS,
  hasSlotPosition,
  lanesVary,
  slotBend,
  slotEnds,
  slotLabel,
  slotLengthFor,
  slotRange,
  slotRoom,
  slotShiftAt,
  slotShiftDerivatives,
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
  refuses({ lanes: 2, laneSpacing: 80, slotPosition: slot(35) }, /single-lane pieces\. Set Lanes to 1/);
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
