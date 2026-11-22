import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import Module from 'manifold-3d';
import {
  buildTrack,
  buildTestJoint,
  defaultTrack,
  solidFootprint,
} from '../src/track.js';
import {
  currentJointSettings,
  resolveJointFit,
} from '../src/geometry/joint-fit.js';
import { createEngine } from '../src/engine.js';
import { parseSTL } from '../src/editor.js';
import { newProject } from '../src/project.js';
import { clipSpec } from '../src/geometry/clip-types.js';

const wasm = await Module();
wasm.setup();

function near(actual, expected, epsilon = 1e-5) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${actual} differs from ${expected}`,
  );
}

function fixture(overrides = {}) {
  return {
    ...defaultTrack(),
    kind: 'straight',
    length: 72,
    segments: 2,
    joint: 'both',
    jointStart: 'none',
    jointEnd: 'none',
    placements: { seamTabs: [20], seamClips: [0] },
    ...overrides,
  };
}

function intersection(a, b, shift = [0, 0, 0]) {
  const moved = a.translate(shift);
  const common = moved.intersect(b);
  try {
    return common.volume();
  } finally {
    common.delete();
    moved.delete();
  }
}

test('both joints fit at their specified tolerances and the tapered tab has clearance normal to its flanks', (t) => {
  for (const tabClearance of [0.03, 0.15, 0.8]) {
    const clipClearance = tabClearance === 0.03 ? 0.4 : 0.03;
    const p = fixture({ tabClearance, clipClearance });
    const parts = buildTrack(wasm, p);
    t.after(() => parts.forEach((part) => part.solid.delete()));
    const [first, second, clip] = parts.map((part) => part.solid);
    const tab = first.trimByPlane([1, 0, 0], 0.01);
    t.after(() => tab.delete());
    near(tab.boundingBox().max[1] - tab.boundingBox().min[1], 6);
    near(clip.boundingBox().max[1] - clip.boundingBox().min[1], 10);
    for (const axis of [
      [1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      near(
        intersection(
          tab,
          second,
          axis.map((v) => v * (tabClearance - 0.01)),
        ),
        0,
      );
      assert.ok(
        intersection(
          tab,
          second,
          axis.map((v) => v * (tabClearance + 0.01)),
        ) > 0.001,
      );
    }
    // Probe at the middle of the sloping socket flank, away from its corners.
    const slope = (3 - 2.2) / 1.5;
    const x = 5.5,
      z = p.height * 0.4;
    const y = 20 + 3 - (x - 4.5) * slope + tabClearance * Math.hypot(1, slope);
    const probe = wasm.Manifold.cube([0.01, 0.01, 0.01], true);
    t.after(() => probe.delete());
    for (const sign of [-1, 1]) {
      const inside = intersection(probe, second, [x, y + sign * 0.02, z]);
      near(inside, sign < 0 ? 0 : 1e-6, 1e-8);
      // The long parallel sides take the selected running gap. The four
      // inclined shoulders have their own tighter draw fit.
      for (const d of [-0.02, 0.02]) {
        const pos = [-10, sign * (5 + clipClearance + d), 5];
        near(intersection(probe, first, pos), d < 0 ? 0 : 1e-6, 1e-8);
      }
    }
  }
});

test('unversioned joint samples open with the current dovetail and preserve supported clearances', (t) => {
  for (const storedGap of [undefined, 0.32, 0.78]) {
    const raw = { kind: 'straight', joint: 'both' };
    if (storedGap != null) raw.clipClearance = storedGap;
    const gap = storedGap ?? 0.25;
    const native = {
      ...raw,
      jointFitVersion: 2,
      clipType: 'draw-key',
      clipClearance: Math.min(gap, 0.4),
      tabClearance: gap,
    };
    for (const old of [raw, { ...raw, jointFitVersion: 1 }]) {
      const current = currentJointSettings(old);
      const fit = resolveJointFit(current);
      near(fit.tabClearance, gap);
      near(fit.clipClearance, Math.min(gap, 0.4));
      const fromSaved = buildTestJoint(wasm, old);
      const fromNative = buildTestJoint(wasm, native);
      t.after(() =>
        [...fromSaved, ...fromNative].forEach((part) => part.solid.delete()),
      );
      assert.deepEqual(
        fromSaved.map((part) => part.role),
        ['road', 'road', 'clip', 'retainer'],
      );
      for (const [index, part] of fromSaved.entries()) {
        near(part.solid.volume(), fromNative[index].solid.volume());
        near(
          intersection(part.solid, fromNative[index].solid),
          part.solid.volume(),
        );
      }
    }
  }
});

test('custom tabs and the matching cavity measure correctly in the generated meshes', (t) => {
  for (const [tabWidth, tabLength, tabThickness, c] of [
    [2, 2, 0.6, 0.03],
    [9, 11, 3.2, 0.25],
    [24, 24, 4, 0.8],
  ]) {
    const p = fixture({
      length: 150,
      joint: 'tabs',
      placements: { seamTabs: [0] },
      tabWidth,
      tabLength,
      tabThickness,
      tabClearance: c,
    });
    const [male, female] = buildTrack(wasm, p).map((part) => part.solid);
    const tab = male.trimByPlane([1, 0, 0], 0.01);
    t.after(() => [male, female, tab].forEach((s) => s.delete()));
    const { min, max } = tab.boundingBox();
    near(max[0], tabLength);
    near(max[1] - min[1], tabWidth);
    near(max[2] - min[2], tabThickness);
    near((max[2] + min[2]) / 2, 0.435 * p.height);
    const fit = resolveJointFit(p);
    near(fit.tabSocketWidth, tabWidth + 2 * c);
    near(fit.tabSocketHeight, tabThickness + 2 * c);
    near(fit.tabSocketDepth, tabLength + c);
    // This flank angle changes with the width/length ratio. Probe both sides
    // of the true offset line, in the actual socket cut from the second part.
    const shoulder = 0.75 * tabLength;
    const slope = ((tabWidth / 2) * (1 - 2.2 / 3)) / (tabLength - shoulder);
    const x = (tabLength + shoulder) / 2;
    const y = tabWidth / 2 - (x - shoulder) * slope + c * Math.hypot(1, slope);
    const probe = wasm.Manifold.cube([0.005, 0.005, 0.005], true);
    t.after(() => probe.delete());
    near(
      intersection(probe, female, [x, y - 0.012, 0.435 * p.height]),
      0,
      1e-9,
    );
    near(
      intersection(probe, female, [x, y + 0.012, 0.435 * p.height]),
      0.005 ** 3,
      1e-9,
    );
    for (const axis of [
      [1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      near(
        intersection(
          tab,
          female,
          axis.map((n) => n * (c - 0.01)),
        ),
        0,
      );
      assert.ok(
        intersection(
          tab,
          female,
          axis.map((n) => n * (c + 0.01)),
        ) > 0.0005,
      );
    }
  }
});

test('omitted thickness follows the track and saved legacy tabs ignore custom dimensions', (t) => {
  const opts = { tabWidth: 8, tabLength: 9, height: 16, joint: 'tabs' };
  const got = resolveJointFit(fixture(opts));
  near(got.tabThickness, 3.68);
  near(resolveJointFit(fixture({ ...opts, height: 20 })).tabThickness, 4.6);
  near(
    resolveJointFit(fixture({ ...opts, height: 20, tabThickness: 3.68 }))
      .tabThickness,
    3.68,
  );
  const old = resolveJointFit({ ...opts, jointFitVersion: 1, tabThickness: 5 });
  near(old.tabWidth, 6);
  near(old.tabLength, 6);
  near(old.tabThickness, 3.68);
  const explicit = buildTrack(
    wasm,
    fixture({ ...opts, tabThickness: got.tabThickness }),
  );
  const automatic = buildTrack(wasm, fixture(opts));
  t.after(() =>
    [...explicit, ...automatic].forEach(({ solid }) => solid.delete()),
  );
  for (const [i, part] of explicit.entries())
    near(part.solid.volume(), automatic[i].solid.volume());
  for (const invalid of [
    { tabWidth: 0 },
    { tabLength: Infinity },
    { tabThickness: -1 },
    { tabThickness: 12 },
  ])
    assert.throws(
      () => buildTrack(wasm, fixture(invalid)),
      /tab (width|length|thickness|socket)/i,
    );
});

test('clip height and independent tolerance limits are enforced without clipping older profiles', (t) => {
  const p = fixture({ height: 7.4, slotDepth: 3, wall: 1 });
  assert.throws(() => buildTrack(wasm, p), /at least 7\.5 mm/);
  assert.throws(
    () => buildTrack(wasm, { ...p, clipType: 'carrera', height: 5.5 }),
    (error) => {
      assert.match(
        error.warning.reason,
        /height is 5\.5 mm.*Carrera clip needs at least 9\.5 mm/,
      );
      assert.deepEqual(error.warning.setting, {
        tab: 'profile',
        field: 'height',
        label: 'Edit track height',
      });
      return true;
    },
  );
  assert.throws(
    () => buildTrack(wasm, fixture({ clipClearance: 0.41 })),
    /clipClearance/,
  );
  assert.throws(
    () => buildTrack(wasm, fixture({ tabClearance: 0.81 })),
    /tabClearance/,
  );
  assert.throws(
    () => buildTrack(wasm, fixture({ jointFitVersion: 3 })),
    /version/,
  );
  const deepShelf = fixture({
    joint: 'clips',
    placements: { seamClips: [16] },
    hollow: false,
    braidWidth: 18,
    braidDepth: 5,
  });
  assert.throws(() => buildTrack(wasm, deepShelf), /roof intersects/);
  for (const params of [
    { ...p, joint: 'tabs' },
    { ...p, height: 12, jointFitVersion: 1, clipClearance: 0.78 },
  ]) {
    const parts = buildTrack(wasm, params);
    t.after(() => parts.forEach((part) => part.solid.delete()));
    assert.ok(parts.every((part) => part.solid.status() === 'NoError'));
  }
});

test('seated preview, individual STL, kit and joint sample share the same scaled draw key', (t) => {
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const project = newProject();
  project.track.params = fixture({ joint: 'clips', height: 15 });
  const spec = clipSpec(project.track.params);
  const mesh = engine.build(project).find((part) => part.role === 'clip');
  const decoded = (bytes) => {
    const solid = parseSTL(wasm, bytes);
    t.after(() => solid.delete());
    return solid;
  };
  const single = decoded(engine.export({ mode: 'part', id: mesh.id }));
  const preview = engine.preview(project).find((part) => part.id === mesh.id);
  assert.deepEqual(preview.bounds, mesh.bounds);
  near(mesh.bounds.min[2], spec.seatHeight);
  near(mesh.bounds.max[2], 15 - 2 - spec.verticalClearance);
  for (const bytes of [
    engine.kit(),
    engine.testJoint({ params: project.track.params, which: 'seam' }),
  ]) {
    const files = unzipSync(bytes);
    const key = Object.keys(files).find(
      (name) => name.startsWith('parts/C') && name.endsWith('.stl'),
    );
    const kit = decoded(files[key]);
    const { min, max } = kit.boundingBox();
    near(min[2], 0);
    near(max[2], spec.thickness);
    near(max[1] - min[1], spec.width);
    near(max[0] - min[0], spec.length);
    near(kit.volume(), single.volume(), 0.0001);
    const range = (points, axis) => {
      const values = points.map((p) => p[axis]);
      return Math.max(...values) - Math.min(...values);
    };
    const exportedFootprint = solidFootprint(kit);
    for (const axis of [0, 1])
      near(range(mesh.footprintXY, axis), range(exportedFootprint, axis));
  }
  const assembly = decoded(engine.export({ mode: 'assembly' }));
  const probe = wasm.Manifold.cube([0.02, 0.02, 0.02], true);
  t.after(() => probe.delete());
  // At the waist the assembly has key material up to its designed seat
  // ceiling, with air directly above before the two-millimetre road roof.
  near(
    intersection(probe, assembly, [0.5, 0.2, mesh.bounds.max[2] - 0.03]),
    8e-6,
    1e-7,
  );
  near(
    intersection(probe, assembly, [0.5, 0.2, mesh.bounds.max[2] + 0.03]),
    0,
    1e-7,
  );
});
