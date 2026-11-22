import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import {
  starterPack,
  profileFromTrack,
  trackWithProfile,
  validateLibraryProfile,
  validateLibraryTrack,
} from '../src/library-profile.js';
import {
  buildTrack,
  chooseSegmentation,
  fitPlate,
  nativePath,
} from '../src/track.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { activeJointMode } from '../src/geometry/placements.js';

const wasm = await init();
wasm.setup();

test('a pack can share its centre stripe and dash dimensions across straights and corners', () => {
  const { pieces } = starterPack();
  const profile = { roadCentreLine: 'dashed', dashLength: 18, dashGap: 10 };
  for (const { track } of [pieces[0], pieces.at(-1)]) {
    const linked = trackWithProfile(track, profile).params;
    assert.deepEqual([linked.roadCentreLine, linked.dashLength, linked.dashGap], ['dashed', 18, 10]);
  }
  assert.throws(() => validateLibraryProfile({ roadCentreLine: 'dotted' }));
  assert.throws(() => validateLibraryProfile({ dashGap: 0 }));
});

test('the shared print profile carries rib spacing and the reinforcement switch across pieces', () => {
  const { pieces } = starterPack();
  const profile = validateLibraryProfile({ reinforcement: false, ribSpacing: 35 });
  for (const piece of [pieces[0], pieces.at(-1)]) {
    const edited = profileFromTrack(trackWithProfile(piece.track, profile));
    assert.equal(edited.reinforcement, false);
    assert.equal(edited.ribSpacing, 35);
  }
  assert.throws(() => validateLibraryProfile({ ribSpacing: 0 }));
  assert.throws(() => validateLibraryProfile({ reinforcement: 'false' }));
});

test('all ten Basic recipes produce closed prints on a 200 mm square plate and the corners nest', () => {
  const { profile, pieces } = starterPack();
  assert.equal(pieces.length, 10);
  assert.equal(profile.clipType, 'draw-key');
  assert.deepEqual(
    pieces.slice(0, 3).map(({ track }) => track.params.length),
    [200, 100, 50],
  );
  assert.deepEqual(
    pieces.filter(({ track }) => track.params.kind === 'curve').map(({ track }) => track.params.radius),
    [300, 500, 700, 900, 1100, 1300],
  );
  const builds = [];
  let previous;
  try {
    for (const { track, name } of pieces) {
      const p = trackWithProfile(track, profile).params;
      assert.deepEqual(profileFromTrack(track), profile);
      assert.equal(p.width, 200);
      assert.equal(p.laneSpacing, 100);
      assert.equal(p.height, 10);
      assert.equal(p.height - p.slotDepth, p.wall);
      assert.equal(p.braidWidth, 5);
      assert.equal(p.braidDepth, 0.5);
      assert.equal(p.braidGap, 0.6);
      const parts = buildTrack(wasm, p);
      builds.push(parts);
      const roads = parts.filter((part) => part.role === 'road');
      assert.equal(roads.length, p.segments);
      for (const part of parts) {
        assert.equal(part.solid.status(), 'NoError');
        assert.equal(fitPlate(part.footprintXY, 200, 200, 0).fits, true, name);
      }
      if (p.kind === 'straight') {
        const stl = parseSTL(wasm, encodeSTL(roads[0].solid));
        try {
          const top = (y) =>
            stl.rayCast([0, y, 11], [0, y, -1])[0]?.position[2];
          assert.equal(top(50), 2, '8 mm deep guide on 10 mm stock');
          assert.equal(
            top(50 + 1.5 + 0.3),
            10,
            'full-height wall at the 0.6 mm braid offset',
          );
          assert.equal(top(50 + 1.5 + 0.6 + 0.01), 9.5);
          assert.equal(top(50 + 1.5 + 0.6 + 4.99), 9.5);
          assert.equal(top(50 + 1.5 + 0.6 + 5.01), 10);
        } finally {
          stl.delete();
        }
        continue;
      }
      // Join the generated meshes at the same pivot and probe across their
      // facing edges between seams, where independently tessellated rings gap.
      const path = nativePath(p);
      if (previous) {
        const shift = p.radius - previous.p.radius;
        for (const t of [0.062, 0.233, 0.415, 0.603, 0.779, 0.954]) {
          const [x, y] = path.point(t, -100);
          const a = ((t - 0.5) * p.angle * Math.PI) / 180;
          const probe = (d, dy) => [
            x + d * Math.sin(a),
            y + dy + d * Math.cos(a),
            9.7,
          ];
          const outer = roads[Math.floor(t * roads.length)].solid;
          const inner =
            previous.roads[Math.floor(t * previous.roads.length)].solid;
          const outerHit = outer.rayCast(probe(-0.08, 0), probe(0.08, 0))[0]
            .position;
          const innerHit = inner.rayCast(
            probe(0.08, shift),
            probe(-0.08, shift),
          )[0].position;
          assert.ok(
            Math.hypot(
              outerHit[0] - innerHit[0],
              outerHit[1] + shift - innerHit[1],
            ) < 0.0001,
            name,
          );
        }
      }
      previous = { p, roads };
    }
  } finally {
    for (const parts of builds) for (const part of parts) part.solid.delete();
  }
});

test('automatic print segmentation can find the nine printable R6 pieces', () => {
  const { track } = starterPack().pieces.at(-1);
  const p = { ...track.params, segments: 1 };
  assert.deepEqual(
    chooseSegmentation(wasm, p, null, { width: 200, depth: 200 }, 'road-1'),
    { fits: true, key: 'segments', count: 9 },
  );
});

test('the ten single-lane presets have centred slots, reversible joints and printable borders on both sides', () => {
  const pack = starterPack(1);
  const double = starterPack();
  assert.deepEqual(pack.pieces.map(p => p.name), double.pieces.map(p => p.name));
  assert.deepEqual(pack.pieces.slice(0, 3).map(p => p.track.params.length), [200, 100, 50]);
  assert.deepEqual(pack.profile, double.profile);
  const bends = pack.pieces.filter(piece => piece.track.params.kind === 'curve');
  const doubleBends = double.pieces.filter(piece => piece.track.params.kind === 'curve');
  for (const piece of pack.pieces) {
    const p = trackWithProfile(piece.track, pack.profile).params;
    assert.equal(p.width, 100);
    assert.equal(p.lanes, 1);
    Object.assign(p, {
      borderSide: 'both', borderMount: 'clips', borderJoint: 'clips',
      whiteLineRoad: 'both', whiteLineBorder: 'both', kerbEdge: 'free',
    });
    const parts = buildTrack(wasm, p);
    try {
      const roads = parts.filter(part => part.role === 'road');
      assert.equal(parts.filter(part => part.role === 'border').length, 2 * p.borderSegments);
      for (const part of parts) {
        assert.equal(part.solid.status(), 'NoError');
        assert.ok(fitPlate(part.footprintXY, 200, 200, 0).fits, piece.name + ' ' + part.name);
      }
      const path = nativePath(p);
      // Run probes through a re-imported STL between sockets and print seams.
      const t = 0.23, road = roads[Math.floor(t * p.segments)];
      const solid = parseSTL(wasm, encodeSTL(road.solid));
      try {
        for (const [offset, z] of [[0, 2], [-4, 9.5], [4, 9.5], [-25, 10], [25, 10]]) {
          const pt = path.point(t, offset);
          const top = solid.rayCast([...pt, 11], [...pt, -1])[0].position[2];
          assert.ok(Math.abs(top - z) < 1e-4, piece.name + ' · ' + offset);
        }
      } finally { solid.delete(); }
      for (const end of [0, 1]) {
        const endRoad = end ? roads.at(-1) : roads[0];
        for (const offset of [-36, 36]) {
          const pt = path.point(end, offset);
          assert.ok(endRoad.jointGuides.some(g => g.kind === 'Clip' &&
            Math.hypot(g.point[0] - pt[0], g.point[1] - pt[1]) < 0.001));
        }
      }
      if (p.kind !== 'curve') continue;
      const r = bends.indexOf(piece);
      assert.equal(p.radius - p.width / 2, 200 + r * p.width);
      assert.equal(p.angle, 30);
      const mate = doubleBends[Math.floor(r / 2)].track.params;
      const neighbour = nativePath(mate);
      for (const t of [0, 0.233, 0.67, 1]) {
        const [x, y] = path.point(t, 0);
        const q = neighbour.point(t, r % 2 ? 50 : -50);
        assert.ok(Math.hypot(x - q[0], y + p.radius - q[1] - mate.radius) < 1e-6,
          'single guide lies on the corresponding double-lane path');
      }
    } finally { parts.forEach(part => part.solid.delete()); }
  }
});

test('partial profiles leave recipe settings and independent copies editable', () => {
  const source = starterPack().pieces[1].track;
  source.params.placements = { finishTabs: [-70, 70] };
  const next = trackWithProfile(source, { slotDepth: 7, tabWidth: 8 });
  assert.equal(next.params.length, 100);
  assert.equal(next.params.slotDepth, 7);
  assert.equal(next.params.tabWidth, 8);
  assert.deepEqual(next.params.placements, source.params.placements);
  next.params.placements.finishTabs.push(0);
  assert.equal(source.params.placements.finishTabs.length, 2);
  assert.equal(source.params.slotDepth, 8);
  validateLibraryProfile({});
  for (const [clipType, active] of [
    ['draw-key', 'draw-key'],
    ['carrera-retained', 'carrera-retained'],
    ['slotforge', 'draw-key'],
    ['carrera', 'carrera-retained'],
    [null, 'draw-key'],
  ]) {
    const saved = trackWithProfile(source, { clipType });
    assert.equal(profileFromTrack(saved).clipType, active);
    assert.equal(
      profileFromTrack(trackWithProfile(saved, { tabWidth: 9 })).clipType,
      active,
    );
  }
  for (const invalid of [
    { length: 200 },
    { tabWidth: 0 },
    { slotDepth: NaN },
    { hollow: 'no' },
    { clipType: 'other' },
    { joint: 'hinge' },
  ])
    assert.throws(() => validateLibraryProfile(invalid));
  assert.throws(
    () => trackWithProfile(source, { slotDepth: 8.01 }),
    /material below/,
  );
});

test('a shared road joint makes matching tabs and sockets at each member’s saved positions', () => {
  const pack = starterPack();
  assert.equal(pack.profile.joint, 'clips');
  const shared = { ...pack.profile, joint: 'tabs', tabWidth: 8 };
  for (const [i, { track }] of pack.pieces.slice(0, 2).entries()) {
    const y = i ? 80 : 20;
    track.params.placements = { startTabs: [y], finishTabs: [y] };
    const p = trackWithProfile(track, shared).params;
    assert.equal(p.segments, 1);
    const parts = buildTrack(wasm, p);
    try {
      const road = parts[0].solid,
        end = p.length / 2;
      // Measure the actual opening through its parallel flanks. The shared
      // 0.15 mm clearance is applied to both sides of each 8 mm tab.
      const sides = road.rayCast(
        [-end + 1, y - 10, 4.35],
        [-end + 1, y + 10, 4.35],
      );
      assert.equal(sides.length, 2);
      assert.ok(Math.abs(sides[0].position[1] - (y - 4.15)) < 1e-5);
      assert.ok(Math.abs(sides[1].position[1] - (y + 4.15)) < 1e-5);
      const tip = road.rayCast([end - 1, y, 4.35], [end + 10, y, 4.35])[0];
      assert.equal(tip.position[0], end + 6);
      assert.equal(fitPlate(parts[0].footprintXY, 200, 200).fits, i === 1);
    } finally {
      parts.forEach((part) => part.solid.delete());
    }
  }
  const perPiece = pack.pieces[1].track;
  perPiece.params.jointStart = 'none';
  perPiece.params.jointEnd = 'clips';
  const p = trackWithProfile(perPiece, shared).params;
  assert.equal(activeJointMode(p, 'start'), 'none');
  assert.equal(activeJointMode(p, 'finish'), 'clips');
  assert.equal(activeJointMode(p, 'seam'), 'tabs');
  const prior = { ...pack.profile };
  delete prior.joint;
  for (const joint of ['none', 'tabs', 'clips', 'both']) {
    perPiece.params.joint = joint;
    assert.equal(trackWithProfile(perPiece, prior).params.joint, joint);
  }
});

test('preflight builds each recipe and catches a shared fit failure on a narrow member', () => {
  const wide = starterPack().pieces[0].track;
  const narrow = structuredClone(wide);
  Object.assign(narrow.params, {
    lanes: 1,
    width: 22,
    joint: 'tabs',
    connectorOffset: 0,
  });
  assert.equal(
    validateLibraryTrack(wasm, trackWithProfile(wide, { tabWidth: 24 })),
    true,
  );
  assert.throws(
    () =>
      validateLibraryTrack(wasm, trackWithProfile(narrow, { tabWidth: 24 })),
    /tab|connector|position/i,
  );
});

test('standalone imported lanes and editable custom paths retain their source geometry', () => {
  const source = starterPack().pieces[0].track;
  const imported = {
    ...source,
    params: {
      ...source.params,
      kind: 'import',
      joint: 'none',
      width: 40,
      lanes: 1,
    },
    sourceName: 'centre.svg',
    plan: {
      lanes: [
        [
          [0, 0],
          [100, 0],
        ],
      ],
      outlines: [],
    },
  };
  const importedEdit = trackWithProfile(imported, { slotDepth: 6 });
  assert.deepEqual(importedEdit.plan, imported.plan);
  assert.equal(validateLibraryTrack(wasm, importedEdit), true);
  const custom = {
    ...imported,
    custom: {
      version: 1,
      points: [
        [0, 0],
        [140, 0],
        [140, 120],
      ],
      radius: 48,
    },
  };
  const rebuilt = trackWithProfile(custom, { slotDepth: 6 });
  assert.deepEqual(rebuilt.custom, custom.custom);
  assert.ok(rebuilt.plan.lanes[0].length > 4);
  assert.equal(validateLibraryTrack(wasm, rebuilt), true);
});
