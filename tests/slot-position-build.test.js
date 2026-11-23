import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildTestJoint, buildTrack, defaultTrack, nativeTrackPoint } from '../src/track.js';
import { slotShiftAt, slotShiftDerivatives } from '../src/slot-position.js';
import { laneOffsetAt, laneOffsetDerivatives } from '../src/lane-adjustment.js';

const wasm = await Module();
wasm.setup();

const slot = (startMm, endMm = startMm, edge = 'outer') => ({ version: 1, edge, startMm, endMm });

// The plain hollow straight below, as built before slot positions existed.
const CENTRED = { vertices: 144, triangles: 284, volume: 165444 };
// Hashes of every part's mesh for the centred pieces of the last test, as
// stage 1 (commit 144b896) builds them.
const CENTRED_TWO = [['road-1', '13d42a10:2651', 'e890e79a:4849']];
const CENTRED_THREE = [['road-1', 'd8de20f1:679', '367727d0:907'], ['road-2', '73303e7:651', '367727d0:907']];
const CENTRED_CURVE = [['road-1', 'd377f134:60551', 'dc855e16:38138']];

// FNV-1a of a mesh's number list, to pin it without a megabyte of numbers.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16) + ':' + text.length;
}

// Height 12, slot 3 x 7, braids 5 x 0.5 beside the slot, 2 mm walls and deck.
function straight(extra = {}) {
  return { ...defaultTrack(), kind: 'straight', width: 200, length: 300, lanes: 1, ...extra };
}

function inspect(p, check, build = buildTrack) {
  const parts = build(wasm, p);
  try {
    for (const part of parts) assert.equal(part.solid.status(), 'NoError');
    return check(parts);
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

// across(d) is the point d mm to the left of the slot centre, square to the
// slot. solidAt names the printed part that point belongs to.
function assertChannel(solidAt, p, across, label) {
  const top = p.height - 0.2, middle = p.height - p.slotDepth / 2;
  const hit = (d, z) => contains(solidAt(across(d)), across(d), z);
  assert.equal(hit(0, middle), false, label + ': open slot');
  for (const sign of [-1, 1]) {
    assert.equal(hit(sign * 1.4, middle), false, label + ': slot is 3 mm wide');
    assert.equal(hit(sign * 1.6, middle), true, label + ': slot wall');
    assert.equal(hit(sign * 1.6, top), false, label + ': braid recess beside the slot');
    assert.equal(hit(sign * 6.4, top), false, label + ': braid recess is 5 mm wide');
    assert.equal(hit(sign * 6.6, top), true, label + ': road beside the braid');
    assert.equal(hit(sign * 3, p.height - 0.7), true, label + ': braid recess is 0.5 mm deep');
  }
  assert.equal(hit(0, p.height - p.slotDepth - 0.1), true, label + ': slot floor');
}

function roadAt(parts, t) {
  const roads = parts.filter(part => part.role === 'road');
  return roads[Math.min(roads.length - 1, Math.floor(t * roads.length))];
}

function digest(parts) {
  return parts.map(part => {
    const mesh = part.solid.getMesh();
    return [part.id, [...mesh.vertProperties].join(), [...mesh.triVerts].join()];
  });
}

const variants = [];
for (const hollow of [true, false]) for (const segments of [1, 2]) variants.push({ hollow, segments });
const named = ({ hollow, segments }) => (hollow ? 'hollow' : 'solid') + ', ' + segments + ' segment' + (segments > 1 ? 's' : '');

test('a 300 mm straight carries its slot from 35 to 145 mm from the left edge in a smooth S', () => {
  for (const variant of variants) {
    const p = straight({ ...variant, slotPosition: slot(35, 145) });
    inspect(p, parts => {
      assert.equal(parts.length, variant.segments);
      // Mid-way the slot crosses the print seam at 34.5 degrees, so a point
      // beside it can belong to the other half.
      const solidAt = ([x]) => roadAt(parts, x / p.length + 0.5).solid;
      for (const t of [0.0005, 0.25, variant.segments > 1 ? 0.49 : 0.5, 0.51, 0.75, 0.9995]) {
        const x = (t - 0.5) * p.length, y = slotShiftAt(p, t);
        const speed = slotShiftDerivatives(p, t)[0], magnitude = Math.hypot(p.length, speed);
        const across = d => [x - speed * d / magnitude, y + p.length * d / magnitude];
        assertChannel(solidAt, p, across, named(variant) + ' at ' + t);
      }
      // 35 mm from the left edge at end A, 145 mm at end B, half-way in between.
      const first = parts[0].solid, last = parts.at(-1).solid, depth = p.height - 3;
      for (const [solid, x, y] of [[first, -149.9, 65], [last, 149.9, -45], [roadAt(parts, 0.5001).solid, 0.1, 10]]) {
        assert.equal(contains(solid, [x, y], depth), false);
        assert.equal(contains(solid, [x, y + 3], p.height - 0.2), false, 'braid');
        assert.equal(contains(solid, [x, 0], p.height - 0.2), true, 'the centre is ordinary road');
      }
      // Both ends are square to the joint: the slot walls sit at 1.5 mm.
      for (const [solid, x, y] of [[first, -149.97, 65], [last, 149.97, -45]]) {
        for (const sign of [-1, 1]) {
          assert.equal(contains(solid, [x, y + sign * 1.45], depth), false);
          assert.equal(contains(solid, [x, y + sign * 1.55], depth), true);
        }
      }
    });
  }
});

test('the solid S piece loses exactly the slot and braids along the true length of its slot', () => {
  const p = straight({ hollow: false, slotPosition: slot(35, 145) });
  let length = 0;
  for (let i = 0; i < 20000; i++)
    length += Math.hypot(p.length, slotShiftAt(p, (i + 1) / 20000) * 20000 - slotShiftAt(p, i / 20000) * 20000) / 20000;
  assert.ok(length > 326 && length < 328, 'the slot is ' + length + ' mm long');
  const channel = p.slotWidth * p.slotDepth + 2 * p.braidWidth * p.braidDepth;
  inspect(p, ([road]) => {
    const removed = p.width * p.length * p.height - road.solid.volume();
    assert.ok(Math.abs(removed - channel * length) < 2, removed + ' mm3 removed, expected ' + channel * length);
  });
});

test('a straight with its slot a constant 35 mm from an edge keeps it there from end to end', () => {
  for (const variant of variants) for (const [edge, y] of [['outer', 65], ['inner', -65]]) {
    const p = straight({ ...variant, slotPosition: slot(35, 35, edge) });
    inspect(p, parts => {
      assert.equal(parts.length, variant.segments);
      for (const t of [0.0005, 0.3, 0.499, 0.501, 0.9995]) {
        const solid = roadAt(parts, t).solid, x = (t - 0.5) * p.length;
        assertChannel(() => solid, p, d => [x, y + d], named(variant) + ' ' + edge + ' at ' + t);
        assert.equal(contains(solid, [x, 0], p.height - 0.2), true, 'the centre is ordinary road');
        assert.equal(contains(solid, [x, -y], p.height - 0.2), true, 'nothing on the other side');
      }
    });
  }
  // Moving the slot sideways neither adds nor removes material.
  const volume = extra => inspect(straight({ hollow: false, ...extra }), ([road]) => road.solid.volume());
  assert.ok(Math.abs(volume({}) - 712200) < 1e-3);
  assert.ok(Math.abs(volume({ slotPosition: slot(35) }) - 712200) < 1e-3);
  assert.ok(Math.abs(volume({ slotPosition: slot(170, 170, 'inner') }) - 712200) < 1e-3);
});

test('a curve carries a constant off-centre slot concentric with the road', () => {
  for (const variant of variants) for (const [edge, offset] of [['inner', -65], ['outer', 65]]) {
    const p = straight({ ...variant, kind: 'curve', radius: 300, angle: 45, slotPosition: slot(35, 35, edge) });
    inspect(p, parts => {
      assert.equal(parts.length, variant.segments);
      for (const t of [0.001, 0.25, 0.499, 0.501, 0.75, 0.999]) {
        const solid = roadAt(parts, t).solid;
        assertChannel(() => solid, p, d => nativeTrackPoint(p, t, offset + d), named(variant) + ' ' + edge + ' at ' + t);
        assert.equal(contains(solid, nativeTrackPoint(p, t, 0), p.height - 0.2), true, 'the centre is ordinary road');
      }
    });
  }
  // The channel is as long as the arc at the slot's own radius: 235 mm
  // inside, 365 mm outside, so the inner slot removes 130 mm of arc less.
  const volume = edge => inspect(
    straight({ hollow: false, kind: 'curve', radius: 300, angle: 45, slotPosition: slot(35, 35, edge) }),
    ([road]) => road.solid.volume(),
  );
  const difference = volume('inner') - volume('outer');
  assert.ok(Math.abs(difference - 26 * 130 * Math.PI / 4) < 1, difference + ' mm3');
});

test('a centred piece builds exactly as it did before slot positions existed', () => {
  inspect(straight(), ([road]) => {
    assert.equal(road.solid.numVert(), CENTRED.vertices);
    assert.equal(road.solid.numTri(), CENTRED.triangles);
    assert.ok(Math.abs(road.solid.volume() - CENTRED.volume) < 1e-6, String(road.solid.volume()));
  });
  // The off-centre route at the centre is the centred piece, number for number.
  for (const extra of [{}, { hollow: false, segments: 2 }, { kind: 'curve', radius: 300, angle: 45, joint: 'tabs' }]) {
    const plain = inspect(straight(extra), digest);
    assert.deepEqual(inspect(straight({ ...extra, slotPosition: undefined }), digest), plain);
    assert.deepEqual(inspect(straight({ ...extra, slotPosition: slot(100) }), digest), plain);
    assert.deepEqual(inspect(straight({ ...extra, slotPosition: slot(100, 100, 'inner') }), digest), plain);
  }
});

test('print seams, borders, markings, braid pass-throughs and connectors follow an off-centre slot without failing', () => {
  const s = { slotPosition: slot(35, 145) };
  for (const extra of [
    { ...s, borderSide: 'both', borderMount: 'tabs', whiteLineRoad: 'both', roadCentreLine: 'dashed' },
    { ...s, braidFeedSide: 'both', braidFeedLane: 1 },
    { slotPosition: slot(35), braidFeedSide: 'both', braidFeedLane: 1 },
    { ...s, joint: 'tabs', segments: 2 },
    { ...s, joint: 'clips' },
    { slotPosition: slot(35), joint: 'both' },
    { kind: 'curve', radius: 300, angle: 45, slotPosition: slot(35, 35, 'inner'), joint: 'both', segments: 2 },
  ]) inspect(straight(extra), parts => assert.ok(parts.length >= 1));
  // A braid pass-through opens beside the moved slot, not beside the centre.
  const feed = { braidFeedSide: 'left', braidFeedLane: 1, braidFeedStations: [0.5], hollow: false };
  inspect(straight(feed), ([road]) => assert.equal(contains(road.solid, [0, 4], 2), false));
  inspect(straight({ ...feed, slotPosition: slot(35) }), ([road]) => {
    assert.equal(contains(road.solid, [0, 65 + 4], 2), false, 'pass-through below the left braid');
    assert.equal(contains(road.solid, [0, 4], 2), true);
  });
  // Mid-way on the S the slot is at 10 mm and runs at atan(206.25 / 300).
  inspect(straight({ ...feed, slotPosition: slot(35, 145) }), ([road]) => {
    const magnitude = Math.hypot(300, 206.25);
    assert.equal(contains(road.solid, [4 * 206.25 / magnitude, 10 + 4 * 300 / magnitude], 2), false);
    assert.equal(contains(road.solid, [-4 * 206.25 / magnitude, 10 - 4 * 300 / magnitude], 2), true);
    assert.equal(contains(road.solid, [0, 65 + 4], 2), true);
  });
});

test('a fit sample of a piece with a moving slot carries the slot of the joint it samples', () => {
  const p = straight({ joint: 'clips', segments: 2, slotPosition: slot(35, 145) });
  for (const [joint, y] of [['start', 65], ['finish', -45], ['seam', 10]]) {
    inspect(p, parts => {
      for (const id of ['road-1', 'road-2']) {
        const road = parts.find(part => part.id === id), x = id === 'road-1' ? -0.1 : 0.1;
        assert.equal(contains(road.solid, [x, y], 8), false, joint + ' sample: slot');
        assert.equal(contains(road.solid, [x, y + 1.6], 8), true, joint + ' sample: slot wall');
        assert.equal(contains(road.solid, [x * 150, y], 8), false, joint + ' sample: the slot runs straight');
      }
    }, (wasm, params) => buildTestJoint(wasm, params, joint));
  }
});

// Phase 2: several lanes, moving together or set one by one.
const each = (lanes, edge = 'outer') => ({
  version: 1, edge, lanes: lanes.map(([startMm, endMm = startMm]) => ({ startMm, endMm })),
});
const road = (extra = {}) => straight({ lanes: 2, laneSpacing: 70, ...extra });

// Every lane of a straight at t, probed square to its own slot.
function assertLanes(p, parts, label) {
  const solidAt = ([x]) => roadAt(parts, x / p.length + 0.5).solid;
  for (let i = 0; i < p.lanes; i++) {
    for (const t of [0.0005, 0.25, p.segments > 1 ? 0.49 : 0.5, 0.51, 0.75, 0.9995]) {
      const x = (t - 0.5) * p.length, y = laneOffsetAt(p, i, t);
      const speed = laneOffsetDerivatives(p, i, t)[0], magnitude = Math.hypot(p.length, speed);
      const across = d => [x - speed * d / magnitude, y + p.length * d / magnitude];
      assertChannel(solidAt, p, across, label + ' lane ' + i + ' at ' + t);
    }
  }
}

// Slot centres given as [x, y]: open slot there, road 1.6 mm square beside it.
function assertSlotsAt(parts, p, places, label) {
  const depth = p.height - 3;
  for (const [x, y] of places) {
    const solid = roadAt(parts, x / p.length + 0.5).solid;
    assert.equal(contains(solid, [x, y], depth), false, label + ': slot at ' + [x, y]);
    assert.equal(contains(solid, [x, y + 3], p.height - 0.2), false, label + ': braid beside ' + [x, y]);
    assert.equal(contains(solid, [x, y + 1.6], depth), true, label + ': slot wall beside ' + [x, y]);
  }
}

test('two lanes move together: the slot nearest the left edge goes from 35 to 95 mm, the other 70 mm further', () => {
  for (const variant of variants) {
    const p = road({ ...variant, slotPosition: slot(35, 95) });
    inspect(p, parts => {
      assert.equal(parts.length, variant.segments);
      assertLanes(p, parts, named(variant));
      // 35 and 105 mm from the left edge at end A, 95 and 165 mm at end B, 65 and 135 mid-way.
      assertSlotsAt(parts, p, [[-149.9, 65], [-149.9, -5], [149.9, 5], [149.9, -65], [0.1, 35], [0.1, -35]], named(variant));
      for (const [x, y] of [[-149.9, 30], [149.9, -30], [-149.9, -65], [149.9, 65]])
        assert.equal(contains(roadAt(parts, x / p.length + 0.5).solid, [x, y], p.height - 0.2), true, 'ordinary road at ' + [x, y]);
    });
  }
});

test('each lane set: 35/105 to 95/165 mm builds the same slots as the lanes moving together', () => {
  for (const variant of variants) {
    // The pack spacing is 65 mm, so these 70 mm gaps are the lanes' own.
    const p = road({ ...variant, laneSpacing: 65, slotPosition: each([[35, 95], [105, 165]]) });
    inspect(p, parts => {
      assertLanes(p, parts, named(variant));
      assertSlotsAt(parts, p, [[-149.9, 65], [-149.9, -5], [149.9, 5], [149.9, -65], [0.1, 35], [0.1, -35]], named(variant));
    });
  }
});

test('each lane set with a spacing change: 40/140 mm at end A, 60/120 mm at end B', () => {
  for (const variant of variants) {
    const p = road({ ...variant, slotPosition: each([[40, 60], [140, 120]]) });
    inspect(p, parts => {
      assertLanes(p, parts, named(variant));
      // Offsets 60 / -40 at end A, 40 / -20 at end B, 50 / -30 mid-way.
      assertSlotsAt(parts, p, [[-149.9, 60], [-149.9, -40], [149.9, 40], [149.9, -20], [0.1, 50], [0.1, -30]], named(variant));
      for (const [x, y] of [[-149.9, 10], [149.9, 10], [149.9, -40], [-149.9, -20]])
        assert.equal(contains(roadAt(parts, x / p.length + 0.5).solid, [x, y], p.height - 0.2), true, 'ordinary road at ' + [x, y]);
    });
  }
  // Measured from the right edge the same numbers make the mirror image.
  const p = road({ hollow: false, slotPosition: each([[40, 60], [140, 120]], 'inner') });
  inspect(p, parts => assertSlotsAt(parts, p, [[-149.9, -60], [-149.9, 40], [149.9, -40], [149.9, 20], [0.1, -50], [0.1, 30]], 'mirror'));
});

test('three lanes set one by one from the right edge keep every slot where it was typed', () => {
  for (const variant of variants) {
    const p = road({ ...variant, lanes: 3, laneSpacing: 50, slotPosition: each([[20, 40], [80, 100], [150, 170]], 'inner') });
    inspect(p, parts => {
      assertLanes(p, parts, named(variant));
      assertSlotsAt(parts, p, [[-149.9, -80], [-149.9, -20], [-149.9, 50], [149.9, -60], [149.9, 0], [149.9, 70]], named(variant));
    });
  }
});

test('a curve carries each lane at its own constant distance, concentric with the road', () => {
  for (const variant of variants) for (const [edge, offsets] of [['inner', [-80, 0]], ['outer', [0, 80]]]) {
    const p = road({ ...variant, kind: 'curve', radius: 300, angle: 45, slotPosition: each([[20], [100]], edge) });
    inspect(p, parts => {
      assert.equal(parts.length, variant.segments);
      for (const t of [0.001, 0.25, 0.499, 0.501, 0.75, 0.999]) {
        const solid = roadAt(parts, t).solid;
        for (const offset of offsets)
          assertChannel(() => solid, p, d => nativeTrackPoint(p, t, offset + d), named(variant) + ' ' + edge + ' ' + offset + ' at ' + t);
        assert.equal(contains(solid, nativeTrackPoint(p, t, edge === 'inner' ? 40 : -40), p.height - 0.2), true, 'ordinary road');
      }
    });
  }
});

test('connectors, seams, borders and fit samples build beside several moved slots', () => {
  const moving = each([[40, 60], [140, 120]]);
  for (const extra of [
    { slotPosition: moving, joint: 'clips', segments: 2 },
    { slotPosition: slot(35, 95), joint: 'tabs' },
    { slotPosition: moving, borderSide: 'both', borderMount: 'tabs', whiteLineRoad: 'both', roadCentreLine: 'dashed' },
    { kind: 'curve', radius: 300, angle: 45, slotPosition: each([[20], [100]], 'inner'), joint: 'both', segments: 2 },
  ]) inspect(road(extra), parts => assert.ok(parts.length >= 1));
  // A sample keeps every slot where it meets its joint: offsets 60 / -40 at
  // end A, 40 / -20 at end B and 50 / -30 at the seam in the middle.
  const p = road({ joint: 'clips', segments: 2, slotPosition: moving });
  for (const [joint, lanes] of [['start', [60, -40]], ['finish', [40, -20]], ['seam', [50, -30]]]) {
    inspect(p, parts => {
      for (const id of ['road-1', 'road-2']) {
        const part = parts.find(item => item.id === id), x = id === 'road-1' ? -0.1 : 0.1;
        for (const y of lanes) {
          assert.equal(contains(part.solid, [x, y], 8), false, joint + ' sample: slot at ' + y);
          assert.equal(contains(part.solid, [x, y + 1.6], 8), true, joint + ' sample: slot wall at ' + y);
          assert.equal(contains(part.solid, [x * 150, y], 8), false, joint + ' sample: the slot runs straight');
        }
      }
    }, (wasm, params) => buildTestJoint(wasm, params, joint));
  }
});

test('a squeeze or spread cannot be built with a slot position', () => {
  const squeeze = { version: 1, mode: 'squeeze', spacingMm: 40, anchor: 'centre' };
  for (const slotPosition of [slot(35, 95), each([[40, 60], [140, 120]])])
    assert.throws(() => buildTrack(wasm, road({ laneAdjustment: squeeze, slotPosition })),
      /move its slots, not both\. Choose one/);
});

test('centred pieces with several lanes build exactly as before slot positions existed', () => {
  // Pinned from v1.0.0 / stage 1, before several lanes could move.
  for (const [extra, pinned] of [
    [{}, CENTRED_TWO],
    [{ lanes: 3, laneSpacing: 50, hollow: false, segments: 2 }, CENTRED_THREE],
    [{ kind: 'curve', radius: 300, angle: 45, joint: 'tabs' }, CENTRED_CURVE],
  ]) {
    const plain = inspect(road(extra), digest);
    assert.deepEqual(inspect(road({ ...extra, slotPosition: undefined }), digest), plain);
    assert.deepEqual(plain.map(([id, vertices, triangles]) => [id, hash(vertices), hash(triangles)]), pinned);
  }
});
