import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import {
  customTrackPlan,
  refreshCustomTrack,
  validateCustomTrack,
} from '../src/custom-track.js';
import { defaultTrack, buildTrack } from '../src/track.js';
import { defaultPackRules, validatePackRules } from '../src/track-pack-rules.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import {
  findPathIntersections,
  findRouteCrossings,
} from '../src/flat-crossing.js';

const wasm = await init();
wasm.setup();
const p = {
  ...defaultTrack(),
  kind: 'import',
  lanes: 2,
  width: 60,
  laneSpacing: 25,
};
const shape = {
  version: 1,
  radius: 70,
  points: [
    [0, 0],
    [140, 0],
    [140, 220],
    [320, 220],
  ],
};
const line = {
  version: 1,
  radius: 70,
  points: [
    [0, 0],
    [200, 0],
  ],
};

const eight = {
  version: 1,
  radius: 40,
  points: [
    [-150, -100],
    [150, 100],
    [150, -100],
    [-150, 100],
  ],
  closed: true,
  crossingMode: 'flat-pieces',
};

test('pack rules and freeform drawings ignore a saved offset when braids are disabled', () => {
  const bare = { ...p, braidWidth: 0, braidGap: 40 };
  const rules = { ...defaultPackRules(), width: bare.width, lanes: bare.lanes, laneSpacing: bare.laneSpacing };
  assert.deepEqual(validatePackRules(rules, bare), rules);
  assert.deepEqual(customTrackPlan(shape, bare).lanes, customTrackPlan(shape, { ...bare, braidGap: 0 }).lanes);
  for (const invalid of [{ braidGap: NaN }, { braidGap: -2 }, { braidWidth: Infinity }, { braidWidth: -1 }]) {
    assert.throws(() => validatePackRules(rules, { ...bare, ...invalid }), /braid/);
    assert.throws(() => customTrackPlan(shape, { ...bare, ...invalid }), /braid/);
  }
});

test('a drawn squeeze interpolates by road distance and regenerates after its midpoint spacing changes', () => {
  const params = {
    ...p,
    lanes: 2,
    width: 200,
    laneSpacing: 100,
    laneAdjustment: {
      version: 1,
      mode: 'squeeze',
      spacingMm: 40,
      anchor: 'centre',
    },
  };
  const track = { params, custom: line };
  const { plan } = refreshCustomTrack(track);
  const gaps = plan.lanes[0].map((v, i) =>
    Math.hypot(...v.map((x, k) => x - plan.lanes[1][i][k])),
  );
  assert.equal(gaps[0], 100);
  assert.equal(gaps.at(-1), 100);
  assert.equal(Math.min(...gaps), 40);
  const mid = gaps.indexOf(40);
  assert.equal(plan.lanes[0][mid][0], 100);
  for (const row of plan.outlines[0]) assert.equal(Math.abs(row[1]), 100);
  params.laneAdjustment = {
    ...params.laneAdjustment,
    mode: 'spread',
    spacingMm: 130,
  };
  const spread = refreshCustomTrack(track).plan;
  assert.ok(spread !== plan);
  assert.ok(spread.lanes[0].some((v) => v[1] === -65));
  const parts = buildTrack(wasm, params, spread);
  try {
    assert.ok(parts.find((x) => x.id === 'road-1').solid.volume() > 0);
  } finally {
    for (const item of parts) item.solid.delete();
  }
});

test('a freeform path refuses a slot position before it can move a lane, and leaves the plan cache alone', () => {
  const slotPosition = { version: 1, edge: 'outer', startMm: 35, endMm: 145 };
  const refusal = /Slot position works on plain straights and curves only\. Freeform pieces and imported drawings keep the slot where it is drawn\./;
  const single = { ...p, lanes: 1, width: 200, laneSpacing: 100 };
  const squeezed = {
    ...single, lanes: 2,
    laneAdjustment: { version: 1, mode: 'squeeze', spacingMm: 40, anchor: 'centre' },
  };
  for (const params of [single, squeezed]) {
    const track = { params, custom: line };
    const { plan } = refreshCustomTrack(track);
    // The drawn lanes sit about the road centre at both ends.
    const ends = plan.lanes.flatMap((lane) => [lane[0][1], lane.at(-1)[1]]);
    assert.deepEqual(ends, params.lanes === 1 ? [0, 0] : [-50, -50, 50, 50]);
    const shifted = { ...track, params: { ...params, slotPosition } };
    assert.throws(() => customTrackPlan(line, shifted.params), refusal);
    assert.throws(() => refreshCustomTrack(shifted), refusal);
    assert.throws(() => buildTrack(wasm, shifted.params, plan), refusal);
    // The refusal neither replaced nor poisoned the plan kept for this recipe.
    assert.equal(refreshCustomTrack(track).plan, plan);
  }
  // Two lanes, each with its own slot position, are refused the same way.
  const plain = { ...single, lanes: 2 };
  const track = { params: plain, custom: line };
  const { plan } = refreshCustomTrack(track);
  const lanes = { version: 1, edge: 'inner', lanes: [{ startMm: 35, endMm: 95 }, { startMm: 105, endMm: 165 }] };
  const shifted = { ...track, params: { ...plain, slotPosition: lanes } };
  assert.throws(() => customTrackPlan(line, shifted.params), refusal);
  assert.throws(() => refreshCustomTrack(shifted), refusal);
  assert.throws(() => buildTrack(wasm, shifted.params, plan), refusal);
  assert.equal(refreshCustomTrack(track).plan, plan);
});

test('closed and open figure eights keep two independent flat passages with matching cut faces and complete lane paths', () => {
  for (const closed of [true, false]) {
    const recipe = { ...eight, closed, upperPasses: ['first'] };
    const plan = customTrackPlan(recipe, p);
    const { sections, crossings } = plan.flatCrossing;
    assert.equal(sections.length, 2);
    assert.equal(crossings.length, 1);
    const [crossing] = crossings;
    assert.ok(Math.hypot(...crossing.point) < 1e-7);
    assert.notEqual(crossing.firstSection, crossing.secondSection);
    assert.equal(crossing.upperPass, 'first');
    for (const pass of ['first', 'second']) {
      assert.ok(
        crossing[pass + 'Local'] > 0.4 && crossing[pass + 'Local'] < 0.6,
      );
    }
    for (let i = 0; i < (closed ? 2 : 1); i++) {
      const a = sections[i],
        b = sections[(i + 1) % 2];
      for (const kind of ['lanes', 'sides']) {
        a[kind].forEach((s, j) =>
          assert.ok(
            Math.hypot(...s.at(-1).map((x, k) => x - b[kind][j][0][k])) < 1e-7,
          ),
        );
      }
    }
    const otherPass = customTrackPlan(
      { ...recipe, upperPasses: ['second'] },
      p,
    );
    assert.deepEqual(otherPass.flatCrossing.sections, sections);
    assert.throws(
      () => customTrackPlan({ ...recipe, crossingMode: undefined }, p),
      /overlaps itself/,
    );
  }
});

test('a closed oval becomes two matching open decks and rejects an impossible closure bend', () => {
  const square = {
    ...eight,
    points: [
      [-150, -100],
      [150, -100],
      [150, 100],
      [-150, 100],
    ],
  };
  const plan = customTrackPlan({ ...square, crossingMode: undefined }, p);
  assert.equal(plan.flatCrossing.crossings.length, 0);
  assert.equal(plan.flatCrossing.sections.length, 2);
  assert.throws(
    () =>
      customTrackPlan(
        {
          ...square,
          points: [
            [-150, -100],
            [150, -100],
            [150, 100],
            [-150, -65],
          ],
        },
        p,
      ),
    /will not fit/,
  );
});

test('crossing detection merges sampled knots, excludes touching and parallel roads, and recognises crossings spanning a closed loop seam', () => {
  const a = [
      [-10, -10],
      [0, 0],
      [10, 10],
    ],
    b = [
      [-10, 10],
      [0, 0],
      [10, -10],
    ];
  const x = findPathIntersections(a, b);
  assert.equal(x.length, 1);
  assert.equal(x[0].first, 0.5);
  assert.equal(x[0].second, 0.5);
  assert.deepEqual(
    findPathIntersections(
      [
        [-10, 0],
        [10, 0],
      ],
      [
        [-10, 4],
        [0, 0],
        [10, 4],
      ],
    ),
    [],
  );
  assert.deepEqual(
    findPathIntersections(a, [
      [0, 0],
      [10, 0],
    ]),
    [],
  );
  assert.deepEqual(findPathIntersections(a, a), []);
  const ring = [
    [0, 0],
    [10, 10],
    [10, -10],
    [-10, 10],
    [-10, -10],
    [0, 0],
  ];
  assert.equal(findRouteCrossings(ring, { closed: true }).length, 1);
});

test('custom straight preserves exact length, road width, signed lane positions and open ends', () => {
  const plan = customTrackPlan(line, p);
  assert.deepEqual(plan.lanes, [
    [
      [0, -12.5],
      [200, -12.5],
    ],
    [
      [0, 12.5],
      [200, 12.5],
    ],
  ]);
  assert.deepEqual(plan.outlines[0], [
    [0, -30],
    [200, -30],
    [200, 30],
    [0, 30],
  ]);
});

test('a custom S piece rounds both corners at the specified radius and prints both slots on segmented roads', () => {
  const params = {
    ...p,
    segments: 2,
    borderSide: 'outer',
    borderEntry: 10,
    borderApex: 10,
    borderExit: 10,
  };
  const plan = customTrackPlan(shape, params);
  assert.ok(plan.lanes[0].length > 40);
  for (const [i, offset] of [-12.5, 12.5].entries()) {
    const arc = plan.lanes[i].filter(
      ([x, y]) =>
        x > 70 && x < 140 - offset + 0.001 && y > offset && y <= 70 + 1e-9,
    );
    assert.ok(arc.length > 10);
    for (const [x, y] of arc)
      assert.ok(Math.abs(Math.hypot(x - 70, y - 70) - (70 - offset)) < 1e-7);
  }
  const parts = buildTrack(wasm, params, plan);
  try {
    const roads = parts.filter((part) => part.role === 'road');
    assert.equal(roads.length, 2);
    assert.ok(parts.some((part) => part.role === 'border'));
    for (const [i, road] of roads.entries()) {
      const printed = parseSTL(wasm, encodeSTL(road.solid));
      try {
        assert.equal(printed.status(), 'NoError');
        for (const sign of [-1, 1]) {
          const x = i ? 320 : 0,
            y = (i ? 220 : 0) + sign * 12.5;
          assert.equal(
            printed.rayCast([x - 0.1, y, 11], [x + 0.1, y, 11]).length,
            0,
          );
          const hits = printed.rayCast(
            [x + (i ? -1 : 1), y, 14],
            [x + (i ? -1 : 1), y, -1],
          );
          assert.ok(
            Math.abs(hits[0].position[2] - (p.height - p.slotDepth)) < 0.001,
          );
        }
      } finally {
        printed.delete();
      }
    }
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
});

test('a saved custom recipe rebuilds stale lanes, road width and spacing when a collection profile changes', () => {
  const track = JSON.parse(
    JSON.stringify({
      params: p,
      custom: shape,
      plan: { lanes: [], outlines: [] },
    }),
  );
  const original = refreshCustomTrack(track);
  assert.deepEqual(original.plan.lanes[0][0], [0, -12.5]);
  const changed = refreshCustomTrack({
    ...original,
    params: { ...p, width: 84, laneSpacing: 30, lanes: 3 },
  });
  assert.equal(changed.plan.lanes.length, 3);
  assert.deepEqual(changed.plan.lanes[0][0], [0, -30]);
  assert.deepEqual(changed.plan.outlines[0][0], [0, -42]);
  assert.deepEqual(original.plan.lanes[0][0], [0, -12.5]);
  assert.equal(refreshCustomTrack(changed), changed);
  const thirdParty = { params: p, plan: original.plan };
  assert.equal(refreshCustomTrack(thirdParty), thirdParty);
});

test('inserting a collinear handle into an existing bend approach preserves the drawn outline and lane positions', () => {
  const inserted = {
    ...shape,
    points: [[0, 0], [130, 0], ...shape.points.slice(1)],
  };
  assert.deepEqual(customTrackPlan(inserted, p), customTrackPlan(shape, p));
});

test('invalid or folded custom roads reject the edit before generating an STL', () => {
  assert.throws(
    () => validateCustomTrack({ ...line, version: 'unknown' }),
    /custom path/,
  );
  assert.throws(
    () =>
      customTrackPlan(
        {
          ...line,
          points: [
            [0, 0],
            [0, 0],
          ],
        },
        p,
      ),
    /apart/,
  );
  assert.throws(
    () => customTrackPlan({ ...shape, radius: 20 }, p),
    /half the road width/,
  );
  assert.throws(
    () => customTrackPlan({ ...shape, radius: 300 }, p),
    /will not fit/,
  );
  assert.throws(
    () => customTrackPlan(shape, { ...p, width: 30 }),
    /lane slots/,
  );
  assert.throws(
    () =>
      customTrackPlan(
        {
          ...shape,
          points: [
            [0, 0],
            [200, 0],
            [200, 200],
            [0, 200],
            [0, -120],
          ],
        },
        p,
      ),
    /overlaps/,
  );
});
