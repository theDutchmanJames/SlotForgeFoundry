import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import init from 'manifold-3d';
import {
  customTrackPlan,
  flowingLaneReport,
  refreshCustomTrack,
  validateCustomTrack,
} from '../src/custom-track.js';
import {
  FLOWING_PRESETS,
  flowingDirections,
  flowingPreset,
  mirrorFlowing,
  moveFlowingHandle,
  setFlowingDirection,
} from '../src/flowing-curve.js';
import { defaultTrack, buildTrack } from '../src/track.js';
import { checkProject, newProject } from '../src/project.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { WAYPOINT_CASES } from './flowing-curve-cases.js';

const wasm = await init();
wasm.setup();
const p = {
  ...defaultTrack(),
  kind: 'import',
  lanes: 2,
  width: 60,
  laneSpacing: 25,
  borderSide: 'none',
};
const K = 0.5522847498307936;
const flowing = (controlPoints) => ({ version: 1, shape: 'flowing', controlPoints });
const bend = flowing(flowingPreset('bend', p.width));
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    actual + ' is not within ' + tolerance + ' of ' + expected,
  );
// The two road corners of each end, from an outline of right side then left
// side reversed.
function endFaces(plan) {
  const outline = plan.outlines[0],
    n = outline.length / 2;
  return [
    [outline[0], outline.at(-1)],
    [outline[n - 1], outline[n]],
  ];
}

test('a flowing recipe needs four handle points from the origin and no waypoint settings', () => {
  validateCustomTrack(bend);
  const [a, b, c, d] = bend.controlPoints;
  for (const controlPoints of [
    undefined,
    [a, b, c],
    [a, b, c, d, d],
    [a, b, c, [NaN, 0]],
    [a, b, c, [0, 20001]],
    [a, b, c, [1, 2, 3]],
  ])
    assert.throws(() => validateCustomTrack(flowing(controlPoints)), /start, two handles and an end/);
  assert.throws(() => validateCustomTrack(flowing([[1, 0], b, c, d])), /starts at 0, 0/);
  for (const controlPoints of [
    [a, [0.5, 0], c, d],
    [a, b, [d[0], d[1] - 0.5], d],
    [a, b, [0.2, -3], [0.5, 0]],
  ])
    assert.throws(() => validateCustomTrack(flowing(controlPoints)), /at least 1 mm/);
  for (const extra of [{ closed: true }, { crossingMode: 'flat-pieces' }, { radius: 70 }, { points: [] }, { upperPasses: [] }])
    assert.throws(() => validateCustomTrack({ ...bend, ...extra }), /no waypoints, corner radius, closed loop or crossing/);
  assert.throws(() => validateCustomTrack({ ...bend, version: 2 }), /flowing curve/);
  // A waypoint recipe has no shape, and an unknown shape is refused.
  assert.throws(
    () => validateCustomTrack({ version: 1, shape: 'spiral', radius: 70, points: [[0, 0], [200, 0]] }),
    /custom path/,
  );
  const project = newProject();
  project.track = { params: p, custom: bend, plan: null, sourceName: 'Bend' };
  assert.equal(checkProject(project).track.plan.lanes.length, 2);
});

test('every starting shape builds on narrow and wide roads, sized for a printed piece', () => {
  for (const [width, lanes, laneSpacing] of [[60, 2, 25], [156, 2, 78], [200, 2, 100], [400, 4, 90]]) {
    // 1.5 road widths, to the next 5 mm, and never under 200 mm.
    const r = { 60: 200, 156: 235, 200: 300, 400: 600 }[width];
    assert.deepEqual(flowingPreset('bend', width).at(-1), [r, r]);
    assert.deepEqual(flowingPreset('s-bend', width).at(-1), [2 * r, 0]);
    assert.deepEqual(
      flowingPreset('transition', width).map((q) => q.map(Math.round)),
      [[0, 0], [0.6 * r, 0], [1.4 * r, 0], [2 * r, 0]].map((q) => q.map(Math.round)),
    );
    for (const [name] of FLOWING_PRESETS) {
      const params = { ...p, width, lanes, laneSpacing };
      const recipe = flowing(flowingPreset(name, width));
      const plan = customTrackPlan(recipe, params);
      assert.equal(plan.lanes.length, lanes);
      assert.equal(plan.outlines.length, 1);
      assert.ok(plan.lanes[0].length <= 1800);
      const report = flowingLaneReport(recipe, params, plan);
      if (name === 'transition') {
        assert.ok(report.every((lane) => lane.minRadius === null));
        for (const lane of report) near(lane.length, 2 * r);
      } else assert.ok(report.every((lane) => lane.minRadius > width / 2));
    }
  }
});

test('a starting shape can be sized so its centre line keeps to a given radius', () => {
  // Curvature of the cubic's centre line, sampled finely.
  const tightest = (c) => {
    let most = 0;
    for (let i = 0; i <= 4096; i++) {
      const t = i / 4096,
        u = 1 - t;
      const v = [0, 1].map((k) => 3 * u * u * (c[1][k] - c[0][k]) + 6 * u * t * (c[2][k] - c[1][k]) + 3 * t * t * (c[3][k] - c[2][k]));
      const w = [0, 1].map((k) => 6 * u * (c[2][k] - 2 * c[1][k] + c[0][k]) + 6 * t * (c[3][k] - 2 * c[2][k] + c[1][k]));
      most = Math.max(most, Math.abs(v[0] * w[1] - v[1] * w[0]) / Math.hypot(...v) ** 3);
    }
    return 1 / most;
  };
  for (const radius of [150, 262.5, 480]) {
    for (const name of ['bend', 's-bend']) {
      const points = flowingPreset(name, 60, radius);
      assert.ok(tightest(points) >= radius, name + ' at ' + radius);
      // No larger than needed: within 5 mm rounding and a small margin.
      if (radius > 250) assert.ok(tightest(points) < radius * 1.03 + 5);
    }
    assert.deepEqual(flowingPreset('transition', 60, radius), flowingPreset('transition', 60));
  }
  assert.deepEqual(flowingPreset('bend', 60, 150), flowingPreset('bend', 60));
});

test('both end faces are square to the handle directions, and the road keeps its width and sampling tolerance', () => {
  const tilted = flowing([[0, 0], [90, 40], [260, 70], [300, 180]]);
  for (const recipe of [bend, flowing(flowingPreset('s-bend', p.width)), tilted]) {
    const c = recipe.controlPoints;
    const plan = customTrackPlan(recipe, p);
    const directions = [
      [c[1][0], c[1][1]],
      [c[3][0] - c[2][0], c[3][1] - c[2][1]],
    ].map((v) => v.map((n) => n / Math.hypot(...v)));
    for (const [i, [right, left]] of endFaces(plan).entries()) {
      const across = [left[0] - right[0], left[1] - right[1]];
      near(Math.hypot(...across), p.width);
      near(across[0] * directions[i][0] + across[1] * directions[i][1], 0);
      // The face is centred on the end of the curve, with each lane on it.
      const end = i ? c[3] : c[0];
      near((left[0] + right[0]) / 2, end[0]);
      near((left[1] + right[1]) / 2, end[1]);
      for (const [k, lane] of plan.lanes.entries()) {
        const q = lane.at(i ? -1 : 0);
        near(
          (q[0] - end[0]) * -directions[i][1] + (q[1] - end[1]) * directions[i][0],
          (k - 0.5) * p.laneSpacing,
        );
        // The first and last facets run along the end direction, which is
        // what joints and the Track Planner read.
        const next = lane.at(i ? -2 : 1);
        near((next[0] - q[0]) * directions[i][1] - (next[1] - q[1]) * directions[i][0], 0);
      }
    }
  }
  // Facets of the quarter bend stay within the chord tolerance of a true
  // offset: no outer-edge chord sags more than 0.035 mm.
  const plan = customTrackPlan(bend, p);
  const outer = plan.outlines[0].slice(0, plan.outlines[0].length / 2);
  for (let i = 1; i < outer.length; i++) {
    const chord = Math.hypot(outer[i][0] - outer[i - 1][0], outer[i][1] - outer[i - 1][1]);
    assert.ok(chord ** 2 / (8 * 225) < 0.035);
  }
});

test('lane radii of a quarter bend match the cubic, and lane lengths the offset arcs', () => {
  const r = 200;
  const plan = customTrackPlan(bend, p);
  const report = flowingLaneReport(bend, p, plan);
  // Curvature of the cubic from its control points, independently of the plan.
  const [a, b, c, d] = bend.controlPoints;
  const curvature = (t) => {
    const u = 1 - t;
    const v = [0, 1].map((i) => 3 * u * u * (b[i] - a[i]) + 6 * u * t * (c[i] - b[i]) + 3 * t * t * (d[i] - c[i]));
    const w = [0, 1].map((i) => 6 * u * (c[i] - 2 * b[i] + a[i]) + 6 * t * (d[i] - 2 * c[i] + b[i]));
    return (v[0] * w[1] - v[1] * w[0]) / Math.hypot(...v) ** 3;
  };
  let tightest = 0;
  for (let i = 0; i <= 8192; i++) tightest = Math.max(tightest, curvature(i / 8192));
  // At its ends this circle approximation has a radius of 3 r k² / (2 (1 - k)).
  near(1 / curvature(0), (3 * r * K * K) / (2 * (1 - K)), 1e-4);
  for (const [i, lane] of report.entries()) {
    // The bend turns left: lane 1 is outside, lane 2 inside.
    const offset = (i - 0.5) * p.laneSpacing;
    near(lane.minRadius, 1 / tightest - offset, 1e-6);
    near(lane.minRadius, r - offset, 0.012 * r);
    near(lane.radii[0], (3 * r * K * K) / (2 * (1 - K)) - offset, 1e-4);
    assert.equal(lane.radii.length, plan.lanes[i].length);
    assert.ok(Math.min(...lane.radii) >= lane.minRadius - 1e-9);
    // A quarter of a circle of that lane's radius, to the accuracy of the cubic.
    near(lane.length, (Math.PI / 2) * (r - offset), 0.05);
  }
  assert.ok(report[0].minRadius - report[1].minRadius - p.laneSpacing < 1e-9);
});

test('a fold, a stop or an overlap is refused with what to move', () => {
  const plan = (controlPoints, params = p) => customTrackPlan(flowing(controlPoints), params);
  assert.throws(
    () => plan([[0, 0], [5, 0], [10, 5], [10, 10]]),
    /^Error: Lane 2 folds on the inside of the bend\. Drag the round handles further out or move the end away/,
  );
  // The same bend to the right folds the first lane.
  assert.throws(() => plan([[0, 0], [5, 0], [10, -5], [10, -10]]), /Lane 1 folds/);
  // 25 mm of centre radius clears both lanes but not a 30 mm half road.
  const tight = flowingPreset('bend', 60).map((q) => q.map((n) => n / 8));
  assert.throws(
    () => plan(tight),
    /The inside road edge folds: the tightest part of the curve has a 2[45](\.\d)? mm centre radius and needs more than half the road width \(30 mm\)\. Drag the round handles further out/,
  );
  assert.equal(plan(tight, { ...p, width: 40, laneSpacing: 20 }).lanes.length, 2);
  assert.throws(
    () => plan([[0, 0], [100, 100], [0, 100], [100, 0]]),
    /The curve stops and turns back on itself\. Move the two round handles apart\./,
  );
  assert.throws(
    () => plan([[0, 0], [3000, 2000], [-2200, 2000], [800, 0]]),
    /The road overlaps itself\. Move the end or the round handles apart/,
  );
  // A refused edit leaves the last good plan in place.
  const track = { params: p, custom: structuredClone(bend) };
  const good = refreshCustomTrack(track).plan;
  track.custom.controlPoints = tight;
  assert.throws(() => refreshCustomTrack(track), /road edge folds/);
  track.custom.controlPoints = bend.controlPoints;
  assert.equal(refreshCustomTrack(track).plan, good);
  track.custom.controlPoints = flowingPreset('s-bend', p.width);
  assert.notEqual(refreshCustomTrack(track).plan, good);
});

test('a mirrored curve is the same piece turned the other way', () => {
  const s = flowing([[0, 0], [90, 40], [260, 70], [300, 180]]);
  for (const recipe of [bend, s]) {
    const plan = customTrackPlan(recipe, p);
    const mirrored = flowing(mirrorFlowing(recipe.controlPoints));
    assert.deepEqual(mirrorFlowing(mirrored.controlPoints), recipe.controlPoints);
    const other = customTrackPlan(mirrored, p);
    for (const [i, lane] of plan.lanes.entries()) {
      const twin = other.lanes[plan.lanes.length - 1 - i];
      assert.equal(twin.length, lane.length);
      for (const [j, q] of lane.entries()) {
        near(twin[j][0], q[0]);
        near(twin[j][1], -q[1]);
      }
    }
    const report = flowingLaneReport(recipe, p, plan),
      reflected = flowingLaneReport(mirrored, p, other);
    near(reflected[1].minRadius, report[0].minRadius);
    near(reflected[0].length, report[1].length);
  }
});

test('handles keep the end directions, the end carries its handle and an end can be turned', () => {
  const c = bend.controlPoints;
  const kept = flowingDirections(c);
  near(kept.start, 0);
  near(kept.end, Math.PI / 2);
  // A kept direction handle slides along its line and stays 1 mm long.
  assert.deepEqual(moveFlowingHandle(c, 1, [150, 80], kept)[1], [150, 0]);
  assert.deepEqual(moveFlowingHandle(c, 1, [-40, 80], kept)[1], [1, 0]);
  assert.deepEqual(moveFlowingHandle(c, 2, [120, 140], kept)[2], [200, 140]);
  assert.deepEqual(moveFlowingHandle(c, 2, [120, 260], kept)[2], [200, 199]);
  // Released, it goes where it is put.
  assert.deepEqual(moveFlowingHandle(c, 1, [150, 80], null)[1], [150, 80]);
  // The end takes its handle along, so its direction is unchanged.
  const moved = moveFlowingHandle(c, 3, [260, 240], kept);
  assert.deepEqual(moved[3], [260, 240]);
  near(moved[2][0] - c[2][0], 60, 1e-6);
  near(moved[2][1] - c[2][1], 40, 1e-6);
  near(flowingDirections(moved).end, Math.PI / 2);
  // Turning an end keeps the handle length.
  const turned = setFlowingDirection(c, 'start', Math.PI / 6);
  near(Math.hypot(...turned[1]), Math.hypot(...c[1]), 1e-6);
  near(flowingDirections(turned).start, Math.PI / 6, 1e-8);
  const leaving = setFlowingDirection(c, 'end', 0);
  near(flowingDirections(leaving).end, 0, 1e-8);
  assert.deepEqual(leaving[3], c[3]);
  for (const points of [moved, turned, leaving]) customTrackPlan(flowing(points), p);
});

test('a squeeze on a flowing curve keeps both ends at the normal spacing and reaches its target mid-way', () => {
  const params = {
    ...p,
    laneAdjustment: { version: 1, mode: 'squeeze', spacingMm: 18, anchor: 'centre' },
  };
  for (const recipe of [bend, flowing(flowingPreset('s-bend', p.width))]) {
    const plan = customTrackPlan(recipe, params);
    const gaps = plan.lanes[0].map((q, i) =>
      Math.hypot(q[0] - plan.lanes[1][i][0], q[1] - plan.lanes[1][i][1]),
    );
    near(gaps[0], 25);
    near(gaps[1], 25, 1e-6);
    near(gaps.at(-1), 25);
    near(Math.min(...gaps), 18);
    const report = flowingLaneReport(recipe, params, plan);
    assert.ok(report.every((lane) => lane.minRadius > 100 && lane.minRadius < 260));
    // The road itself is the unsqueezed road.
    assert.deepEqual(endFaces(plan), endFaces(customTrackPlan(recipe, p)));
  }
});

test('a flowing bend prints a road with both slots, a border and square Track Planner ends', () => {
  const params = { ...p, borderSide: 'outer', segments: 2 };
  const plan = customTrackPlan(bend, params);
  const parts = buildTrack(wasm, params, plan, undefined, undefined, { planning: true });
  try {
    const roads = parts.filter((part) => part.role === 'road');
    assert.equal(roads.length, 2);
    assert.ok(parts.some((part) => part.role === 'border'));
    for (const part of parts) {
      assert.equal(part.solid.status(), 'NoError');
      assert.ok(part.solid.volume() > 0);
    }
    for (const [i, road] of roads.entries()) {
      const printed = parseSTL(wasm, encodeSTL(road.solid));
      try {
        assert.equal(printed.status(), 'NoError');
        // Each slot is open at its mouth and cut to depth just inside it.
        for (const lane of plan.lanes) {
          const [x, y] = lane.at(i ? -1 : 0);
          const inward = i ? [0, -1] : [1, 0];
          const [hit] = printed.rayCast(
            [x + inward[0], y + inward[1], 14],
            [x + inward[0], y + inward[1], -1],
          );
          near(hit.position[2], params.height - params.slotDepth, 0.001);
        }
      } finally {
        printed.delete();
      }
    }
    // The planner mates pieces by these ports: the bend enters along +X at the
    // origin and leaves along +Y at [200, 200], so a straight joins square.
    const [entry] = roads[0].plannerStrip.ports,
      exit = roads[1].plannerStrip.ports[1];
    assert.deepEqual(entry.xy, [0, 0]);
    near(entry.angle, Math.PI, 1e-9);
    near(exit.xy[0], 200, 1e-9);
    near(exit.xy[1], 200, 1e-9);
    near(exit.angle, Math.PI / 2, 1e-9);
    for (const port of [entry, exit]) {
      const across = [port.edges[1][0] - port.edges[0][0], port.edges[1][1] - port.edges[0][1]];
      near(Math.hypot(...across), 60, 1e-9);
      near(across[0] * Math.cos(port.angle) + across[1] * Math.sin(port.angle), 0, 1e-9);
      assert.equal(port.slots.length, 2);
    }
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
});

test('paths through waypoints still give the plans recorded before the flowing curve', () => {
  const recorded = {
    straight: 'f0acb913541663f2',
    'S piece': 'f804f9f9ed8ca4a5',
    'S piece, squeezed': '8fa34cf2c6fce525',
    'wide four-lane hook, spread': '15e7be7a0e0632c4',
    'closed oval': 'e7343b696e650c27',
    'figure eight on supports': '6d46c5099f0d53b5',
  };
  for (const [name, recipe, params] of WAYPOINT_CASES(defaultTrack())) {
    const plan = JSON.stringify(customTrackPlan(recipe, params));
    assert.equal(
      createHash('sha256').update(plan).digest('hex').slice(0, 16),
      recorded[name],
      name,
    );
  }
});
