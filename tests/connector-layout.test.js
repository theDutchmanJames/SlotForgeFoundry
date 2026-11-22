import assert from 'node:assert/strict';
import test from 'node:test';
import initManifold from 'manifold-3d';
import { connectorLayout } from '../src/geometry/connector-layout.js';
import {
  buildTrack,
  buildTestJoint,
  jointSampleChoices,
  defaultTrack,
} from '../src/track.js';
import { validatePlacements } from '../src/geometry/placements.js';

const wasm = await initManifold();
wasm.setup();
const base = {
  ...defaultTrack(),
  kind: 'straight',
  length: 520,
  width: 180,
  segments: 2,
  borderSide: 'both',
  borderSegments: 2,
  borderEntry: 65,
  borderApex: 70,
  borderExit: 68,
  joint: 'both',
  jointStart: 'none',
  jointEnd: 'none',
  borderMount: 'both',
  borderJoint: 'none',
};
const near = (a, b, eps = 1e-5) =>
  assert.ok(Math.abs(a - b) < eps, a + ' vs ' + b);
function generated(t, p, plan) {
  const parts = buildTrack(wasm, p, plan);
  t.after(() => parts.forEach((part) => part.solid.delete()));
  return parts;
}
function centre(part) {
  const { min, max } = part.solid.boundingBox();
  return min.slice(0, 2).map((v, i) => (v + max[i]) / 2);
}
function checkPoint(a, b, eps) {
  near(a[0], b[0], eps);
  near(a[1], b[1], eps);
}
test('the five marks on a curved road seam match both generated mating faces', (t) => {
  const p = {
    ...base, kind: 'curve', radius: 550, angle: 65, width: 200, laneSpacing: 100,
    borderSide: 'none', borderMount: 'none', connectorCounts: { seamTabs: 3, seamClips: 2 },
  };
  const layout = connectorLayout(p, null, 'seam');
  const roads = generated(t, p).filter(part => part.role === 'road');
  assert.equal(layout.positions.tab.length, 3);
  assert.equal(layout.positions.clip.length, 2);
  for (const [index, part] of roads.entries()) {
    for (const [type, marks] of Object.entries(layout.positions)) {
      const kind = type === 'clip' ? 'Clip' : index === 0 ? 'Tab' : 'Socket';
      const actual = part.jointGuides.filter(g => g.kind === kind);
      assert.equal(actual.length, marks.length);
      for (const mark of marks) {
        const [x, y] = layout.pointAt(mark);
        assert.ok(actual.some(g => Math.hypot(g.point[0] - x, g.point[1] - y) < 1e-5), kind);
      }
    }
  }
});

test('both end views use the reduced outer spread that clears opposing Carrera pockets on a tight corner', (t) => {
  const p = {
    ...base, kind: 'curve', width: 200, radius: 185, angle: 30, laneSpacing: 85, segments: 1,
    joint: 'clips', jointStart: 'clips', jointEnd: 'clips', clipType: 'carrera-retained',
    borderSide: 'none', borderMount: 'none', connectorCounts: { seamClips: 2 },
  };
  const [road] = generated(t, p);
  for (const scope of ['start', 'finish']) {
    const layout = connectorLayout(p, null, scope);
    const [left, right] = layout.positions.clip;
    near(left, -right);
    assert.ok(right < p.width * 0.36);
    for (const mark of [left, right]) {
      const [x, y] = layout.pointAt(mark);
      assert.ok(road.jointGuides.some(g => Math.hypot(g.point[0] - x, g.point[1] - y) < 1e-5));
    }
  }
});

test('the map displays the built row after neighbouring seams reserve stock in a short segment', (t) => {
  const p = {
    ...base, kind: 'curve', width: 200, radius: 185, angle: 90, segments: 3, laneSpacing: 85,
    joint: 'clips', jointStart: 'clips', jointEnd: 'clips', clipType: 'carrera-retained',
    borderSide: 'none', borderMount: 'none', connectorCounts: { seamClips: 2 },
  };
  const parts = generated(t, p);
  const layout = connectorLayout(p, null, 'seam', { index: 2, parts });
  const row = layout.positions.clip;
  assert.equal(row.length, 2);
  near(row[0], -row[1]);
  assert.ok(row[1] < p.width * 0.36);
  for (const mark of row) {
    const [x, y] = layout.pointAt(mark);
    for (const road of parts.filter(part => part.role === 'road').slice(1))
      assert.ok(road.jointGuides.some(g => Math.hypot(g.point[0] - x, g.point[1] - y) < 1e-5));
  }
});

test('a blocked automatic centre can be picked and moved in the custom placement map', () => {
  const p = {
    ...base, joint: 'clips', lanes: 1, borderSide: 'none', borderMount: 'none',
    connectorCounts: { seamClips: 1 },
  };
  assert.throws(() => connectorLayout(p, null, 'seam'), /centre position is blocked/);
  const map = connectorLayout(p, null, 'seam', {editInvalid: true});
  assert.match(map.placementWarning, /guide slot/);
  assert.deepEqual(map.positions.clip, [0]);
  assert.equal(map.reason('clip', 60, 0), null);
  const moved = connectorLayout({ ...p, placements: {seamClips: [60]} }, null, 'seam');
  assert.deepEqual(moved.positions.clip, [60]);
  assert.equal(moved.placementWarning, undefined);
});
test('even road connectors avoid guide slots and tabs and generate matching pockets on both sections', (t) => {
  const p = { ...base, laneSpacing: 80, borderSide: 'none', borderMount: 'none' };
  const joint = connectorLayout(p, undefined, 'seam');
  assert.equal(joint.key('clip'), 'seamClips');
  assert.match(joint.reason('clip', -40), /guide slot/);
  assert.match(joint.reason('clip', joint.positions.tab[0]), /another tab/);
  assert.match(joint.reason('clip', 90), /edge/);
  assert.deepEqual(joint.even('tab', 0), []);
  const row = joint.even('clip', 3);
  near(row[1] - row[0], row[2] - row[1]);
  const parts = generated(t, { ...p, placements: { seamClips: row } });
  const clips = parts.filter((p) => p.role === 'clip');
  assert.equal(clips.length, 3);
  for (const [i, clip] of clips.entries()) {
    checkPoint(centre(clip), joint.pointAt(row[i]));
    for (const road of parts.filter((p) => p.role === 'road')) {
      const collision = road.solid.intersect(clip.solid);
      try {
        assert.ok(collision.volume() < 1e-5);
      } finally {
        collision.delete();
      }
    }
  }
  assert.throws(() => joint.even('clip', 3, [-40, 40]), /guide slot/);
  assert.throws(() => joint.even('clip', 3, [-19, 19]), /supporting walls/);
  const aligned = joint.even('clip', 3, [-20, 20]);
  assert.deepEqual(aligned, [-20, 0, 20]);
});
test('outer and inner curved border settings have independent counts, shared fallbacks and physical arc distances', (t) => {
  const p = {
    ...base,
    kind: 'curve',
    radius: 480,
    angle: 75,
    clipType: 'carrera-retained',
    borderMount: 'clips',
    borderJoint: 'clips',
    placements: {
      sideClips: [0.28, 0.72],
      innerSideClips: [],
      outerEndClips: [],
      innerEndClips: [0.5],
    },
  };
  const outside = connectorLayout(p, undefined, 'side', {
    side: 'outer',
    index: 1,
  });
  const inside = connectorLayout(p, undefined, 'side', {
    side: 'inner',
    index: 1,
  });
  assert.equal(outside.key('clip'), 'outerSideClips');
  assert.deepEqual(outside.positions.clip, [0.28, 0.72]);
  assert.deepEqual(inside.positions.clip, []);
  near(outside.length, ((p.radius + p.width / 2) * p.angle * Math.PI) / 360);
  const row = outside.even('clip', 3, [0.25, 0.75]);
  assert.deepEqual(row, [0.25, 0.5, 0.75]);
  const points = row.map(outside.pointAt);
  for (const [i, v] of points.entries())
    near(outside.valueAt(v), row[i], 0.0001);
  near(
    Math.hypot(...points[0].map((v, i) => v - points[1][i])),
    Math.hypot(...points[1].map((v, i) => v - points[2][i])),
  );
  const parts = generated(t, {
    ...p,
    placements: { ...p.placements, outerSideClips: row },
  });
  const clips = parts.filter((part) => part.role === 'clip');
  assert.equal(
    clips.filter((p) => p.id.startsWith('side-clip-outer')).length,
    6,
  );
  assert.equal(
    clips.filter((p) => p.id.startsWith('side-clip-inner')).length,
    0,
  );
  assert.equal(
    clips.filter((p) => p.id.startsWith('end-clip-outer')).length,
    0,
  );
  assert.equal(
    clips.filter((p) => p.id.startsWith('end-clip-inner')).length,
    2,
  );
  assert.ok(clips.every((p) => p.clipType === 'carrera-retained'));
  assert.throws(
    () => validatePlacements({ innerSideClips: [1.01] }),
    /percentages/,
  );
});
test('Circuit end spans use the imported outline and actual lane positions; closed panels explain the unavailable joint', (t) => {
  const p = {
    ...base,
    kind: 'import',
    joint: 'none',
    jointEnd: 'clips',
    segments: 1,
    borderSide: 'none',
  };
  const plan = {
    outlines: [
      [
        [-100, -110],
        [0, -70],
        [0, 70],
        [-100, 30],
      ],
    ],
    lanes: [
      [
        [-100, -72.5],
        [0, -32.5],
      ],
      [
        [-100, -7.5],
        [0, 32.5],
      ],
    ],
  };
  const l = connectorLayout(p, plan, 'finish');
  near(l.length, 140);
  assert.match(l.reason('clip', l.valueAt([0, 32.5])), /guide slot/);
  const row = l.even('clip', 3);
  const clips = generated(
    t,
    { ...p, placements: { finishClips: row } },
    plan,
  ).filter((p) => p.role === 'clip');
  for (const [i, clip] of clips.entries())
    checkPoint(centre(clip), l.pointAt(row[i]));
  assert.throws(
    () =>
      connectorLayout(
        p,
        { ...plan, outlines: [...plan.outlines, ...plan.outlines] },
        'finish',
      ),
    /identifiable open ends/,
  );
});
test('a braid pass-through blocks a physically intersecting support and a narrow border explains an impossible count', () => {
  const p = {
    ...base,
    width: 150,
    joint: 'clips',
    braidFeedSide: 'both',
    braidFeedLane: 1,
    braidFeedStations: [0.48],
  };
  const l = connectorLayout(p, undefined, 'seam');
  assert.match(l.reason('clip', -32.5 + 14), /braid pass-through/);
  const border = connectorLayout(
    { ...p, borderEntry: 4, borderApex: 5, borderExit: 4 },
    undefined,
    'end',
    { side: 'outer' },
  );
  assert.throws(() => border.even('clip', 2), /edge|space/);
});

test('a Carrera pocket can sit under a wide divider but must clear a deep braid recess', () => {
  const p = {
    ...base,
    borderSide: 'none',
    width: 230,
    laneSpacing: 116,
    braidGap: 26,
    braidWidth: 4,
    braidDepth: 7,
    hollow: false,
    joint: 'clips',
    clipType: 'carrera',
    placements: { seamClips: [-41] },
  };
  const layout = connectorLayout(p, null, 'seam');
  assert.equal(layout.reason('clip', -41, 0), null);
  const parts = buildTrack(wasm, p);
  parts.forEach(part => part.solid.delete());
  const inRecess = -58 + p.slotWidth / 2 + p.braidGap + p.braidWidth / 2;
  assert.match(layout.reason('clip', inRecess, 0), /braid recess/);
  assert.throws(() => buildTrack(wasm, { ...p, placements: { seamClips: [inRecess] } }), /intersects a slot, braid recess/);
});

test('picker validates draft geometry before sampling and restores old unordered mark lists in drawing order', () => {
  for (const [key, value] of [
    ['radius', 1e20],
    ['angle', Infinity],
    ['width', NaN],
    ['borderSegments', 1e9],
  ])
    assert.throws(
      () =>
        connectorLayout(
          { ...base, kind: 'curve', [key]: value },
          null,
          'start',
        ),
      new RegExp(key),
    );
  assert.throws(
    () =>
      connectorLayout(
        { ...base, kind: 'import' },
        {
          lanes: [
            [
              [0, 0],
              [Infinity, 7],
            ],
          ],
        },
        'start',
      ),
    /finite/,
  );
  const p = {
    ...base,
    joint: 'clips',
    laneSpacing: 80,
    placements: { seamClips: [20, -20, 0] },
  };
  const l = connectorLayout(p, null, 'seam');
  assert.deepEqual(l.positions.clip, [-20, 0, 20]);
  assert.equal(l.reason('clip', 20, 2), null);
  assert.match(l.reason('clip', 20, 0), /another clip/);
});

test('zero quantity suppresses the unused fit checks and unequal external clip counts supply enough printable forks', (t) => {
  const p = {
    ...base,
    height: 5.5,
    slotDepth: 2,
    wall: 1,
    clipType: 'carrera',
    borderSide: 'none',
    joint: 'both',
    placements: { seamClips: [], seamTabs: [] },
  };
  assert.equal(
    generated(t, p).some((part) => part.role === 'clip'),
    false,
  );
  const ends = {
    ...base,
    joint: 'none',
    segments: 1,
    borderSide: 'none',
    jointStart: 'clips',
    jointEnd: 'clips',
    placements: { startClips: [-65, 0, 65], finishClips: [0] },
  };
  assert.equal(
    generated(t, ends).filter((part) => part.role === 'clip').length,
    3,
  );
});

test('muting one border preserves its stored stations while the opposite border becomes active', (t) => {
  const p = {
    ...base,
    borderMount: 'clips',
    placements: { outerSideClips: [0.3], innerSideClips: [0.2, 0.8] },
    mutedPlacements: ['innerSideClips'],
  };
  const visible = generated(t, p).filter((part) =>
    part.id.startsWith('side-clip'),
  );
  assert.equal(visible.filter((p) => p.role === 'clip').length, 2);
  assert.equal(visible.filter((p) => p.role === 'retainer').length, 2);
  assert.ok(visible.every((part) => part.id.startsWith('side-clip-outer')));
  assert.deepEqual(
    connectorLayout(p, null, 'side', { side: 'inner' }).positions.clip,
    [],
  );
  assert.ok(jointSampleChoices(p).some(([key]) => key === 'side-outer'));
  assert.ok(!jointSampleChoices(p).some(([key]) => key === 'side-inner'));
  const coupon = buildTestJoint(
    wasm,
    { ...p, mutedPlacements: [] },
    'side-inner',
  );
  t.after(() => coupon.forEach((part) => part.solid.delete()));
  assert.equal(
    coupon.filter((part) => part.id.startsWith('side-clip-inner')).length,
    4,
  );
  assert.deepEqual(
    connectorLayout({ ...p, mutedPlacements: [] }, null, 'side', {
      side: 'inner',
    }).positions.clip,
    [0.2, 0.8],
  );
  for (const muted of [
    ['startClips'],
    ['innerSideClips', 'innerSideClips'],
    false,
    'innerSideClips',
  ]) {
    assert.throws(
      () => validatePlacements(undefined, muted),
      /Muted placements/,
    );
  }
});

test('a detailed Circuit bend keeps the SVG compact and reuses its actual outline as marks change', () => {
  const n = 2000;
  const line = (r) =>
    Array.from({ length: n }, (_, i) => [
      r * Math.sin(i / n),
      r * Math.cos(i / n),
    ]);
  const plan = {
    outlines: [[...line(265), ...line(405).reverse()]],
    lanes: [line(300), line(362)],
  };
  const p = { ...base, kind: 'import' };
  const one = connectorLayout(p, plan, 'side', { side: 'outer', index: 1 });
  const two = connectorLayout(
    { ...p, placements: { outerSideClips: [0.25, 0.75] } },
    plan,
    'side',
    { side: 'outer', index: 1 },
  );
  assert.equal(one.outlines, two.outlines);
  assert.equal(one.lanes, two.lanes);
  assert.ok(
    [one.edge, ...one.outlines, ...one.lanes].reduce(
      (n, p) => n + p.length,
      0,
    ) <= 6000,
  );
  assert.deepEqual(two.positions.clip, [0.25, 0.75]);
  const f = 0.123456;
  near(two.valueAt(two.pointAt(f)), f, 1e-8);
});
