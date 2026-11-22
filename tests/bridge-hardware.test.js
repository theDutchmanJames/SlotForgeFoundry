import assert from 'node:assert/strict';
import test from 'node:test';
import init from 'manifold-3d';
import { defaultTrack, buildTrack } from '../src/track.js';
import { setCrossingBorderStations } from '../src/geometry/import-track.js';

const wasm = await init();
wasm.setup();
const straight = (length, rotate) => {
  const line = (d) =>
    [
      [-length / 2, d],
      [length / 2, d],
    ].map(([x, y]) => (rotate ? [-y, x] : [x, y]));
  const sides = [-75, 75].map(line);
  return {
    sides,
    lanes: [-35, 35].map(line),
    outlines: [[...sides[0], ...sides[1].slice().reverse()]],
    start: 0,
    end: 1,
  };
};
const sections = [straight(1600, false), straight(650, true)];
const crossing = {
  upperPass: 'first',
  point: [0, 0],
  firstSection: 0,
  secondSection: 1,
  firstLocal: 0.5,
  secondLocal: 0.5,
};
const plan = {
  lanes: sections.flatMap((s) => s.lanes),
  outlines: sections.flatMap((s) => s.outlines),
  flatCrossing: {
    sections,
    crossings: [crossing],
    independentRoutes: true,
    closed: false,
  },
};

test('apexes on a bridge use whole-route positions across the deck and both approaches', (t) => {
  const p = {
    ...defaultTrack(), kind: 'import', width: 150, laneSpacing: 70,
    segments: 3, borderSegments: 3, borderSide: 'both',
    borderEntry: 8, borderExit: 10, outerApexPosition: 0.2741, outerApexWidth: 38,
    innerApexPosition: 0.6817, innerApexWidth: 25,
    bridgeClearance: 40, bridgeApproaches: true, bridgeSupportCount: 4,
  };
  const parts = buildTrack(wasm, p, plan);
  t.after(() => parts.forEach(({solid}) => solid.delete()));
  for (const [side, sign, width, station] of [
    ['outer', 1, 38, 0.2741], ['inner', -1, 25, 0.6817],
  ]) {
    let furthest = -Infinity;
    let atX;
    for (const part of parts.filter((q) => q.crossingSection === 0 && q.id.startsWith('border-' + side + '-'))) {
      const mesh = part.solid.getMesh();
      for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
        const y = sign * mesh.vertProperties[i + 1];
        if (y <= furthest) continue;
        furthest = y;
        atX = mesh.vertProperties[i];
      }
    }
    assert.ok(Math.abs(furthest - (75 + width)) < 1e-4, side + ' printed width');
    assert.ok(Math.abs(atX - (station - 0.5) * 1600) < 0.001, side + ' printed station');
  }
});

test('a closed route places apexes on either side of its start line within one printable span', () => {
  const path = {stations: [0, 1]};
  setCrossingBorderStations(path, {start: 0.75, end: 1.25}, {closed: true}, {
    outerApexPosition: 0.9, innerApexPosition: 0.1,
  });
  assert.deepEqual(path.stations, [0, 0.5, 1]);
  assert.equal(path.borderProfileSeam, 0.5);
  for (const [side, local, global] of [['outer', 0.3, 0.9], ['inner', 0.7, 0.1]]) {
    const positions = path.borderApexStations(side);
    assert.equal(positions.length, 1);
    assert.ok(Math.abs(positions[0] - local) < 1e-9);
    assert.ok(Math.abs(path.borderProfileStation(local) - global) < 1e-9);
  }
});

test('short crossing spans receive proportionate road and border counts with matching physical joints at every local cut', (t) => {
  const p = {
    ...defaultTrack(),
    kind: 'import',
    width: 150,
    lanes: 2,
    laneSpacing: 70,
    segments: 5,
    borderSegments: 3,
    joint: 'tabs',
    jointStart: 'none',
    jointEnd: 'none',
    borderSide: 'outer',
    borderEntry: 45,
    borderApex: 45,
    borderExit: 45,
    borderMount: 'none',
    borderJoint: 'none',
    bridgeSupportCount: 0,
    bridgeApproaches: false,
  };
  const parts = buildTrack(wasm, p, plan);
  t.after(() => parts.forEach((q) => q.solid.delete()));
  const count = (i, role) =>
    parts.filter((q) => q.crossingSection === i && q.role === role).length;
  assert.deepEqual([count(0, 'road'), count(1, 'road')], [5, 3]);
  assert.deepEqual([count(0, 'border'), count(1, 'border')], [3, 2]);
  const roadIds = parts.filter((q) => q.role === 'road').map((q) => q.id);
  assert.deepEqual(
    roadIds,
    Array.from({ length: 8 }, (_, i) => 'road-' + (i + 1)),
  );
  for (const [route, length, n] of [
    [0, 1600, 5],
    [1, 650, 3],
  ]) {
    const roads = parts.filter(
      (q) => q.role === 'road' && q.crossingSection === route,
    );
    for (let i = 1; i < n; i++) {
      const d = -length / 2 + (length * i) / n;
      const before = roads[i - 1].jointGuides.filter((g) => g.kind === 'Tab');
      const after = roads[i].jointGuides.filter((g) => g.kind === 'Socket');
      assert.equal(before.length, 2);
      assert.deepEqual(
        before.map((g) => g.point),
        after.map((g) => g.point),
      );
      assert.ok(before.every((g) => Math.abs(g.point[route] - d) < 0.001));
    }
  }
});

test('the short level bridge deck remains one piece when the long approaches each need three prints', (t) => {
  const p = {
    ...defaultTrack(),
    kind: 'import',
    width: 150,
    lanes: 2,
    laneSpacing: 70,
    segments: 3,
    borderSide: 'none',
    joint: 'none',
    bridgeClearance: 40,
    bridgeApproaches: true,
    bridgeSupportCount: 4,
  };
  const parts = buildTrack(wasm, p, plan);
  t.after(() => parts.forEach((q) => q.solid.delete()));
  const roads = parts.filter((q) => q.role === 'road');
  assert.equal(roads.filter((q) => q.name.startsWith('Entry ramp')).length, 3);
  assert.equal(roads.filter((q) => q.name.startsWith('Exit ramp')).length, 3);
  assert.equal(roads.filter((q) => q.name.startsWith('Bridge deck')).length, 1);
});
for (const mode of ['clips', 'both']) {
  test(
    'inclines omit rigid clip pockets for ' +
      mode +
      ' while level spans keep the selected hardware',
    (t) => {
      const p = {
        ...defaultTrack(),
        kind: 'import',
        width: 150,
        lanes: 2,
        laneSpacing: 70,
        segments: 2,
        borderSide: 'outer',
        borderEntry: 45,
        borderApex: 45,
        borderExit: 45,
        borderSegments: 2,
        joint: mode,
        borderMount: mode,
        borderJoint: mode,
        bridgeClearance: 40,
        bridgeApproaches: true,
        bridgeSupportCount: 4,
      };
      const parts = buildTrack(wasm, p, plan);
      t.after(() => parts.forEach((part) => part.solid.delete()));
      const slopePhases = new Set(
        parts
          .filter((part) => part.role === 'road' && /ramp/.test(part.name))
          .map((part) => part.bridgePhase),
      );
      assert.equal(slopePhases.size, 2);
      const pitched = parts.filter((part) => slopePhases.has(part.bridgePhase));
      assert.ok(pitched.every((part) => !['clip', 'retainer'].includes(part.role)));
      for (const part of pitched.filter((part) =>
        ['road', 'border'].includes(part.role),
      )) {
        const guides = part.jointGuides || [];
        assert.ok(guides.every((g) => g.kind !== 'Clip'));
        if (mode === 'both')
          assert.ok(
            guides.some((g) => ['Tab', 'Socket'].includes(g.kind)),
            part.name + ' keeps paired integral features',
          );
        else assert.deepEqual(guides, []);
      }
      for (const phase of slopePhases) {
        const roads = pitched.filter(
          (part) => part.bridgePhase === phase && part.role === 'road',
        );
        assert.equal(roads.length, 2);
        const bounds = roads.map((q) => q.solid.boundingBox());
        const toe = Math.min(...bounds.map((b) => b.min[0])),
          crest = Math.max(...bounds.map((b) => b.max[0]));
        for (const road of roads)
          for (const g of road.jointGuides ?? []) {
            assert.ok(
              Math.abs(g.point[0] - toe) > 0.01 &&
                Math.abs(g.point[0] - crest) > 0.01,
            );
          }
      }
      assert.ok(
        parts.some(
          (part) => part.role === 'clip' && !slopePhases.has(part.bridgePhase),
        ),
      );
      for (const clip of parts.filter((part) => part.role === 'clip')) {
        const keeper = parts.find((part) => part.id === clip.id + '-retainer');
        assert.equal(keeper?.role, 'retainer');
        assert.equal(keeper.bridgePhase, clip.bridgePhase);
      }
      assert.ok(
        parts
          .filter(
            (part) =>
              part.role === 'border' && !slopePhases.has(part.bridgePhase),
          )
          .some((part) => part.jointGuides?.some((g) => g.kind === 'Clip')),
      );
    },
  );
}
