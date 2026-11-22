import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {
  buildTestJoint,
  buildTrack,
  defaultTrack,
  nativePath,
} from '../src/track.js';
import { racingPlan } from '../src/special-racing.js';
import { hairpinWireProfile } from '../src/geometry/special-racing-tools.js';

const wasm = await Module();
wasm.setup();
const profiles = {
  chicane: {
    kind: 'straight',
    length: 1200,
    special: {
      type: 'chicane',
      hand: 'left',
      offset: 150,
      entryRadius: 280,
      exitRadius: 330,
    },
  },
  hairpin: {
    kind: 'curve',
    radius: 330,
    angle: 180,
    special: { type: 'hairpin', crossingAt: 0.25, isolation: 2 },
  },
  duel: {
    kind: 'curve',
    radius: 460,
    angle: 112,
    special: { type: 'duel', apex: 0.62 },
  },
};
const profile = (name, extra = {}) => ({
  ...defaultTrack(),
  width: 200,
  laneSpacing: 100,
  ...structuredClone(profiles[name]),
  ...extra,
});
const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `${a} should be within ${tol} of ${b}`);
function atHeight(part, xy, z) {
  const shape = wasm.Manifold.cube([0.04, 0.04, 0.04], true);
  const check = shape.translate([...xy, z]);
  const hit = part.solid.intersect(check);
  try {
    return hit.volume() > 3.2e-5;
  } finally {
    hit.delete();
    check.delete();
    shape.delete();
  }
}
function withMesh(p, inspect) {
  const parts = buildTrack(wasm, p);
  try {
    for (const part of parts)
      assert.equal(part.solid.status(), 'NoError', part.name);
    inspect(parts);
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
}
function radii(path) {
  const results = [];
  for (let i = 0; i < 1000; i++) {
    const a = path.tangent(i / 1000),
      b = path.tangent((i + 1) / 1000);
    const angle = Math.abs(
      Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]),
    );
    if (angle < 0.00001) continue;
    const u = path.point(i / 1000, 0),
      v = path.point((i + 1) / 1000, 0);
    const r = Math.hypot(v[0] - u[0], v[1] - u[1]) / (2 * Math.sin(angle / 2));
    results.push([i / 1000, r]);
  }
  return results;
}
test('bus stop has independently specified circular radii, an adjustable footprint and tangent parallel joints', () => {
  const p = profile('chicane'),
    path = nativePath(p);
  const rs = radii(path);
  near(Math.min(...rs.filter(([t]) => t < 0.5).map(([, r]) => r)), 280);
  near(Math.min(...rs.filter(([t]) => t > 0.5).map(([, r]) => r)), 330);
  for (const t of [0, 1]) {
    near(path.point(t, 0)[0], (t - 0.5) * p.length);
    near(path.point(t, 0)[1], 0);
    near(path.tangent(t)[0], 1);
    near(path.tangent(t)[1], 0);
  }
  near(path.point(0.5, 0)[1], 150);
  const flipped = nativePath({
    ...p,
    special: { ...p.special, hand: 'right' },
  });
  for (const t of [0.1, 0.3, 0.5, 0.7, 0.9])
    near(path.point(t, 0)[1], -flipped.point(t, 0)[1]);
  const angle = (path) =>
    Math.max(
      ...Array.from({ length: 101 }, (_, i) =>
        Math.abs(path.tangent(i / 100)[1]),
      ),
    );
  assert.ok(angle(nativePath({ ...p, length: 1600 })) < angle(path));
  assert.throws(
    () => nativePath({ ...p, length: 400 }),
    /Lengthen the chicane/,
  );
  assert.throws(
    () => nativePath({ ...p, borderSide: 'both', borderApex: 300 }),
    /clear the road and its borders/,
  );
});
test('late apex keeps the slots in order, the pack spacing at the joints, and a later apex moves the outer racing line', () => {
  const p = profile('duel'),
    path = nativePath(p);
  for (const t of [0, 1]) {
    const [a, b] = path.laneOffsets(t);
    near(a, -50);
    near(b, 50);
  }
  const peak = (path) => {
    const samples = Array.from({ length: 201 }, (_, i) => ({
      t: i / 200,
      offsets: path.laneOffsets(i / 200),
    }));
    for (const {
      offsets: [a, b],
    } of samples)
      assert.ok(b - a > 70);
    return samples.reduce((best, s) =>
      s.offsets[1] < best.offsets[1] ? s : best,
    ).t;
  };
  assert.ok(
    peak(nativePath({ ...p, special: { ...p.special, apex: 0.72 } })) >
      peak(path),
  );
  assert.throws(() => nativePath({ ...p, lanes: 3 }), /two-lane/);
});
test('both shaped borders follow each special road and survive the STL geometry pipeline with a mating clip', () => {
  for (const name of Object.keys(profiles)) {
    const p = profile(name, {
      segments: 2,
      borderSegments: 2,
      borderSide: 'both',
      joint: 'clips',
      borderEnds: {
        outer: { finish: { shape: 's-curve', length: 'short', at: 1 } },
      },
    });
    const path = nativePath(p),
      plan = racingPlan(p);
    assert.equal(plan.borders.length, 2);
    withMesh(p, (parts) => {
      const roads = parts.filter((x) => x.role === 'road'),
        borders = parts.filter((x) => x.role === 'border');
      assert.equal(roads.length, 2);
      assert.equal(borders.length, 4);
      assert.ok(parts.some((x) => x.role === 'clip'));
      for (const [side, sign] of [
        ['inner', -1],
        ['outer', 1],
      ]) {
        const b = borders.find((x) => x.id === 'border-' + side + '-1');
        const t = 0.12,
          shoulder = (sign * p.width) / 2;
        assert.equal(
          atHeight(b, path.point(t, shoulder + sign * 3), p.height - 0.25),
          true,
        );
        assert.equal(
          atHeight(
            roads[0],
            path.point(t, shoulder - sign * 3),
            p.height - 0.25,
          ),
          true,
        );
        assert.equal(
          atHeight(
            roads[0],
            path.point(t, shoulder + sign * 3),
            p.height - 0.25,
          ),
          false,
        );
      }
    });
  }
});
test('each hairpin crossover keeps its guide and separates both braid shelves with flush stock and through feeds', () => {
  const p = profile('hairpin', { braidGap: 2 }),
    path = nativePath(p);
  const xy = path.point(p.special.crossingAt, 0);
  assert.equal(racingPlan(p).details.length, 16);
  withMesh(p, ([road]) => {
    assert.equal(atHeight(road, xy, p.height - p.slotDepth + 0.3), false);
    assert.equal(atHeight(road, xy, p.height - p.slotDepth - 0.2), true);
    for (const [i, lane] of path.measuredLanes.entries()) {
      const t = lane.ts[path.laneStations.indexOf(0.25)];
      const [first, last] = path.sites[i][0];
      assert.ok(t > first && t < last);
      for (const side of [-1, 1]) {
        const braid = side * (p.slotWidth / 2 + p.braidGap + p.braidWidth / 2);
        for (const [end, dir] of [
          [first, -1],
          [last, 1],
        ]) {
          const station = end + (dir * 8) / lane.total;
          const shoulder = side * (p.slotWidth / 2 + p.braidGap / 2);
          assert.equal(atHeight(road, lane.atOffset(station, shoulder), p.height - 0.05), true,
            'wall at road height between the guide and powered braid');
          assert.equal(
            atHeight(
              road,
              lane.atOffset(station, braid),
              p.height - 0.25,
            ),
            false,
            'powered shelf',
          );
          assert.equal(
            atHeight(
              road,
              lane.atOffset(end - (dir * 1.25) / lane.total, braid),
              p.height - 0.25,
            ),
            true,
            'insulating stock',
          );
          const feed = lane.atOffset(
            end + (dir * p.braidFeedLength) / (2 * lane.total),
            braid,
          );
          assert.equal(
            atHeight(road, feed, p.height - p.deck + 0.3),
            false,
            'terminal through deck',
          );
        }
      }
    }
  });
  assert.throws(
    () => buildTrack(wasm, { ...p, segments: 4 }),
    /seam 1 passes through a hairpin crossover/,
  );
});

test('racing joint coupons reproduce the source lane positions at a segment seam and at both external joints', () => {
  const p = profile('duel', { segments: 3, joint: 'clips' });
  const path = nativePath(p);
  for (const which of ['seam', 'start', 'finish']) {
    const parts = buildTestJoint(wasm, p, which);
    try {
      const roads = parts.filter((part) => part.role === 'road');
      assert.equal(roads.length, 2);
      const offsets = which === 'seam' ? path.laneOffsets(1 / 3) : [-50, 50];
      for (const along of [-0.1, 0.1])
        for (const v of offsets) {
          assert.equal(
            atHeight(roads[along > 0 ? 1 : 0], [along, v], p.height - 3),
            false,
          );
          assert.equal(
            atHeight(roads[along > 0 ? 1 : 0], [along, v + 3], p.height - 3),
            true,
          );
        }
    } finally {
      parts.forEach((part) => part.solid.delete());
    }
  }
});

test('a solid hairpin has two recessed wire levels and retains material beneath the slots', () => {
  const p = profile('hairpin', {
    height: 10,
    slotDepth: 8,
    hollow: false,
    segments: 2,
  });
  const path = nativePath(p),
    wire = hairpinWireProfile(p);
  assert.ok(2 * wire.maxDiameter < wire.deep);
  withMesh(p, ([road]) => {
    for (const [i, lane] of path.measuredLanes.entries()) {
      const [a, b] = path.sites[i][0];
      const at = a + 0.16 * (b - a);
      for (const sign of [-1, 1]) {
        const xy = lane.atOffset(
          at,
          sign * (p.slotWidth / 2 + p.braidGap + p.braidWidth / 2),
        );
        const depth = i === 0 ? wire.deep : wire.shallow;
        assert.equal(atHeight(road, xy, depth - 0.1), false);
        assert.equal(atHeight(road, xy, depth + 0.1), true);
      }
    }
    const intersection = path.point(p.special.crossingAt, 0);
    assert.equal(
      atHeight(road, intersection, p.height - p.slotDepth - 0.15),
      true,
    );
  });
});
