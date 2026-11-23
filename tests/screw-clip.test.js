import assert from 'node:assert/strict';
import test from 'node:test';
import initManifold from 'manifold-3d';
import { unzipSync, strFromU8 } from 'fflate';
import {
  buildTestJoint,
  buildTrack,
  defaultTrack,
  validateTrack,
  trackParameters,
} from '../src/track.js';
import {
  SCREW_CLIP_DEFAULTS,
  SCREW_MIN_BITE,
  screwClipGeometry,
  screwClipSettings,
  screwName,
  validateScrewClip,
} from '../src/geometry/screw-clip.js';
import { clipSpec } from '../src/geometry/clip-types.js';
import { connectorLayout } from '../src/geometry/connector-layout.js';
import { packFitSamples } from '../src/fit-samples.js';
import { createEngine } from '../src/engine.js';
import { starterPack, validateLibraryProfile, profileFromTrack } from '../src/library-profile.js';
import { newLayout, endsOf, placeSource, tally, blockedJoints } from '../src/planner-model.js';
import { screwHardware, shoppingList } from '../src/planner-kit.js';
import { fitScrewClip } from '../src/clip-instructions.js';
import { parseConnectionControls } from '../src/connection-controls.js';
import { specialTrackParams } from '../src/special-pieces.js';

const wasm = await initManifold();
wasm.setup();

const H = 12;
const screw = (extra = {}) => ({
  ...defaultTrack(),
  jointFitVersion: 2,
  joint: 'clips',
  clipType: 'side-screw',
  ...extra,
});
const straight = (extra = {}) => screw({ kind: 'straight', length: 220, ...extra });

function build(p, options) {
  const parts = buildTrack(wasm, p, undefined, undefined, undefined, options);
  return {
    parts,
    get: (id) => parts.find((part) => part.id === id),
    free: () => parts.forEach((part) => part.solid.delete()),
  };
}

// True when a 0.1 mm cube at [x, y, z] meets material of the solid.
function solidAt(solid, [x, y, z]) {
  const cube = wasm.Manifold.cube([0.1, 0.1, 0.1], true).translate([x, y, z]);
  const both = solid.intersect(cube);
  try {
    return both.volume() > 1e-6;
  } finally {
    both.delete();
    cube.delete();
  }
}

// A straight of length L and width W: its start seam is x = -L/2 and its
// left edge y = +W/2. The left clip at the start reaches in along -y.
const at = (p, u, v, z, side = 1, x0 = -p.length / 2) => [x0 + u, side * (p.width / 2 - v), z];

test('defaults: the pocket sits halfway up a 12 mm road, and a 10 mm screw grips 3 mm of clip and 2.35 mm of road either way', () => {
  const g = screwClipGeometry(screwClipSettings({ height: H }), H);
  assert.equal(screwClipSettings({ height: H }).screwLength, 10, 'automatic length on a 12 mm road');
  assert.equal(screwClipSettings({ height: H }).screwLengthAuto, true);
  // A 10 mm road (the starter pack) takes the longest stock screw that fits: 8 mm.
  assert.equal(screwClipSettings({ height: 10 }).screwLength, 8);
  assert.equal(screwClipSettings({ height: 16 }).screwLength, 14);
  assert.equal(screwClipSettings({ height: H, screwLength: 11 }).screwLength, 11);
  assert.ok(Math.abs(g.grip - 5.35) < 1e-9, 'total thread engagement');
  assert.equal(SCREW_MIN_BITE, 1);
  assert.ok(Math.abs(g.floor - 4.35) < 1e-9);
  assert.ok(Math.abs(g.top - 7.65) < 1e-9);
  assert.ok(Math.abs(g.floor + g.top - H) < 1e-9, 'centred');
  assert.ok(Math.abs(g.bite - 2.35) < 1e-9);
  assert.ok(g.bite >= SCREW_MIN_BITE);
  // Top: the tip is at 12 - 10 = 2 mm, the pocket floor 4.35 mm.
  assert.ok(Math.abs(g.floor - (H - 10) - g.bite) < 1e-9);
  // Bottom: the tip is at 10 mm, the pocket roof 7.65 mm.
  assert.ok(Math.abs(10 - g.top - g.bite) < 1e-9);
  assert.ok(Math.abs(g.countersink - 1.1) < 1e-9);
  assert.equal(screwName({ height: H }), '2.5 × 10 mm countersunk wood screw');
  assert.equal(screwName({ height: 10 }), '2.5 × 8 mm countersunk wood screw');
  void SCREW_CLIP_DEFAULTS;
  const spec = clipSpec(screw());
  assert.equal(spec.clipName, 'Side screw clip');
  assert.equal(spec.type, 'side-screw');
});

test('defaults build on the default road: hollow and solid, straight and curve, one and two lanes, off-centre slot', () => {
  for (const extra of [
    {},
    { kind: 'straight', length: 220 },
    { hollow: false },
    { lanes: 1 },
    { kind: 'straight', length: 220, lanes: 1, hollow: false },
    { kind: 'straight', length: 220, lanes: 1, slotPosition: { version: 1, edge: 'outer', startMm: 50, endMm: 50 } },
    { lanes: 1, slotPosition: { version: 1, edge: 'inner', startMm: 45, endMm: 45 }, radius: 300 },
    { segments: 2, angle: 45 },
    { joint: 'both', kind: 'straight', length: 260 },
    { screwDirection: 'bottom' },
  ]) {
    const label = JSON.stringify(extra);
    const p = screw(extra);
    const { parts, free } = build(p);
    try {
      const clips = parts.filter((part) => part.role === 'clip');
      // One loose clip per side at the finish end and each internal seam.
      assert.equal(clips.length, 2 * (p.segments ?? 1), label);
      for (const clip of clips) {
        assert.equal(clip.clipType, 'side-screw', label);
        assert.equal(clip.name, 'Side screw clip', label);
      }
      for (const part of parts) assert.equal(part.solid.status(), 'NoError', label);
    } finally {
      free();
    }
  }
});

test('the pocket is a tombstone open at the side face, with a lead-in, and both halves line up', () => {
  const p = straight({ segments: 2, length: 240, joint: 'clips' });
  const { get, free } = build(p);
  try {
    const first = get('road-1').solid,
      second = get('road-2').solid;
    const seam = 0; // The internal seam of a 240 mm straight is at x = 0.
    const g = screwClipGeometry(screwClipSettings(p), H);
    const z = H / 2;
    for (const side of [1, -1]) {
      const probe = (u, v, zz = z) => at(p, u, v, zz, side, seam);
      // Open right at the face, across the full width of the clip.
      for (const u of [-15, -8, -1, 1, 8, 15]) {
        const part = u < 0 ? first : second;
        assert.equal(solidAt(part, probe(u, 0.05)), false, 'mouth ' + u);
        assert.equal(solidAt(part, probe(u, 10)), false, 'straight ' + u);
      }
      // The straight sides: 15 + 0.15 play, then road.
      assert.equal(solidAt(second, probe(15.4, 10)), true);
      assert.equal(solidAt(first, probe(-15.4, 10)), true);
      // The half-round end reaches 30.15 mm in on the centre line.
      assert.equal(solidAt(second, probe(0.1, 30.05)), false);
      assert.equal(solidAt(second, probe(0.1, 30.3)), true);
      assert.equal(solidAt(second, probe(10, 15 + Math.sqrt(15.15 ** 2 - 100) - 0.1)), false);
      assert.equal(solidAt(second, probe(10, 15 + Math.sqrt(15.15 ** 2 - 100) + 0.2)), true);
      // Floor and roof: 3 mm clip, 0.3 mm play, centred.
      assert.equal(solidAt(second, probe(5, 20, g.floor + 0.05)), false);
      assert.equal(solidAt(second, probe(5, 20, g.floor - 0.1)), true);
      assert.equal(solidAt(second, probe(5, 20, g.top - 0.05)), false);
      assert.equal(solidAt(second, probe(5, 20, g.top + 0.1)), true);
      // The lead-in chamfer opens the mouth beyond the pocket.
      assert.equal(solidAt(second, probe(5, 0.1, g.top + 0.3)), false);
      assert.equal(solidAt(second, probe(5, 1, g.top + 0.3)), true);
    }
  } finally {
    free();
  }
});

test('screws from the top: countersink in the road surface, clearance down to the clip, pilot beyond', () => {
  const p = straight();
  const { get, free } = build(p);
  try {
    const road = get('road-1').solid;
    const g = screwClipGeometry(screwClipSettings(p), H);
    // The start end of the piece holds the second half: its screw is at u = +9.
    for (const side of [1, -1]) {
      const [x, y] = at(p, 9, 12, 0, side);
      const ring = (r, z) => [x + r, y, z];
      assert.equal(solidAt(road, ring(2.3, H - 0.06)), false, 'head');
      assert.equal(solidAt(road, ring(2.7, H - 0.06)), true, 'beside the head');
      assert.equal(solidAt(road, ring(1.25, H - g.countersink - 0.5)), false, 'clearance');
      assert.equal(solidAt(road, ring(1.6, H - g.countersink - 0.5)), true);
      assert.equal(solidAt(road, ring(0.9, g.floor - 1)), false, 'pilot');
      assert.equal(solidAt(road, ring(1.25, g.floor - 1)), true, 'pilot wall');
      // The pilot ends 0.5 mm past the screw tip at 2 mm.
      assert.equal(solidAt(road, ring(0, 1.7)), false);
      assert.equal(solidAt(road, ring(0, 1.3)), true);
      // Nothing on the underside.
      assert.equal(solidAt(road, ring(2, 0.06)), true);
    }
    // The finish end holds the first half: its screw is 9 mm before the seam.
    const [fx, fy] = at(p, -9, 12, 0, 1, p.length / 2);
    assert.equal(solidAt(road, [fx + 2.3, fy, H - 0.06]), false);
    assert.equal(solidAt(road, [fx + 2.7, fy, H - 0.06]), true);
  } finally {
    free();
  }
});

test('screws from the bottom: countersink in the underside, pilot above the clip', () => {
  const p = straight({ screwDirection: 'bottom' });
  const { get, free } = build(p);
  try {
    const road = get('road-1').solid;
    const g = screwClipGeometry(screwClipSettings(p), H);
    const [x, y] = at(p, 9, 12, 0, 1);
    const ring = (r, z) => [x + r, y, z];
    assert.equal(solidAt(road, ring(2.3, 0.06)), false, 'head');
    assert.equal(solidAt(road, ring(2.7, 0.06)), true);
    assert.equal(solidAt(road, ring(1.25, g.countersink + 0.5)), false, 'clearance');
    assert.equal(solidAt(road, ring(0.9, g.top + 1)), false, 'pilot');
    assert.equal(solidAt(road, ring(1.25, g.top + 1)), true);
    // Tip at 10 mm, pilot to 10.5 mm, road surface intact above.
    assert.equal(solidAt(road, ring(0, 10.3)), false);
    assert.equal(solidAt(road, ring(0, 10.8)), true);
    assert.equal(solidAt(road, ring(2, H - 0.06)), true);
  } finally {
    free();
  }
});

test('per road side: each side of the piece has its own direction, and either side can be switched off', () => {
  const p = straight({ screwDirection: 'side', screwFromRight: 'bottom', sideClipLeft: '' });
  const { get, free } = build(p);
  try {
    const road = get('road-1').solid;
    const [lx, ly] = at(p, 9, 12, 0, 1);
    const [rx, ry] = at(p, 9, 12, 0, -1);
    assert.equal(solidAt(road, [lx + 2.3, ly, H - 0.06]), false, 'left from the top');
    assert.equal(solidAt(road, [lx + 2.3, ly, 0.06]), true);
    assert.equal(solidAt(road, [rx + 2.3, ry, 0.06]), false, 'right from the bottom');
    assert.equal(solidAt(road, [rx + 2.3, ry, H - 0.06]), true);
  } finally {
    free();
  }
  // A side direction is ignored unless the pack chooses per road side.
  const fixed = build(straight({ screwFromRight: 'bottom' }));
  try {
    const [rx, ry] = at(straight(), 9, 12, 0, -1);
    assert.equal(solidAt(fixed.get('road-1').solid, [rx + 2.3, ry, H - 0.06]), false);
  } finally {
    fixed.free();
  }
  const off = build(straight({ sideClipRight: 'none', hollow: false }));
  try {
    const road = off.get('road-1').solid;
    assert.equal(off.parts.filter((part) => part.role === 'clip').length, 1);
    assert.equal(solidAt(road, at(straight(), 5, 10, H / 2, -1)), true, 'no right pocket');
    assert.equal(solidAt(road, at(straight(), 5, 10, H / 2, 1)), false, 'left pocket');
    assert.equal(off.get('road-1').jointGuides.filter((g) => g.kind === 'Clip').length, 2);
  } finally {
    off.free();
  }
  assert.throws(() => validateTrack(trackParameters(straight({ sideClipLeft: 'maybe' }))), (e) => {
    assert.match(e.message, /side screw clip setting sideClipLeft cannot be "maybe"/);
    assert.equal(e.warning.setting.field, 'sideClipLeft');
    return true;
  });
  // Both sides off on a joint with clips leaves no connector: refused.
  assert.throws(() => validateTrack(trackParameters(straight({ sideClipLeft: 'none', sideClipRight: 'none' }))), (e) => {
    assert.match(e.message, /^Road connections\. Both side screw clips are switched off/);
    assert.equal(e.warning.setting.field, 'sideClipLeft');
    return true;
  });
  validateTrack(trackParameters(straight({ joint: 'tabs', sideClipLeft: 'none', sideClipRight: 'none' })));
});

test('the clip prints flat: a 30 mm flat edge, a half-round end, a notch and two pilot-size holes', () => {
  const p = straight();
  const { parts, free } = build(p);
  try {
    const clip = parts.find((part) => part.role === 'clip');
    const flat = clip.printPose((solid) => solid.boundingBox(), true);
    assert.deepEqual(flat.min.map((v) => Math.round(v * 1000) / 1000), [-15, 0, 0]);
    assert.deepEqual(flat.max.map((v) => Math.round(v * 1000) / 1000), [15, 30, 3]);
    const volume = clip.printPose((solid) => solid.volume(), true);
    const plate = 30 * 15 + (Math.PI * 15 ** 2) / 2;
    // Pilot-size holes (2.1 mm): each screw cuts its thread into the clip.
    const holes = 2 * Math.PI * 1.05 ** 2;
    assert.ok(volume < 3 * (plate - holes) && volume > 3 * (plate - holes) - 25, String(volume));
    const [x, y] = [9, 12];
    clip.printPose((solid) => {
      assert.equal(solidAt(solid, [x, y, 1.5]), false, 'hole');
      assert.equal(solidAt(solid, [x + 0.95, y, 1.5]), false, 'pilot radius 1.05');
      assert.equal(solidAt(solid, [x + 1.2, y, 1.5]), true, 'not clearance size');
    }, true);
    // Assembled, the flat edge is flush with the side face at the finish end.
    const box = clip.solid.boundingBox();
    assert.ok(Math.abs(Math.max(Math.abs(box.max[1]), Math.abs(box.min[1])) - p.width / 2) < 1e-6);
    assert.ok(Math.abs(box.min[2] - 4.5) < 1e-6, 'seated in the middle of its play');
    assert.equal(clip.fabricationKey.startsWith('side-screw/'), true);
  } finally {
    free();
  }
});

test('plain-language validation of the clip and screw settings', () => {
  const fails = (extra, pattern, field) => {
    let error;
    try {
      validateTrack(trackParameters(straight(extra)));
    } catch (e) {
      error = e;
    }
    assert.ok(error, JSON.stringify(extra));
    assert.match(error.message, pattern);
    if (field) assert.equal(error.warning.setting.field, field);
  };
  fails({ screwPilot: 2.5 }, /pilot hole \(2\.5 mm\) must be smaller than the screw thread/, 'screwPilot');
  fails({ screwClearance: 2.5 }, /clearance hole \(2\.5 mm\) must be larger than the screw thread/, 'screwClearance');
  fails({ screwHead: 2.8 }, /screw head \(2\.8 mm\) must be wider than the clearance hole/, 'screwHead');
  fails({ screwClipThickness: 8 }, /^Side screw clip\. An 8 mm clip leaves 1\.85 mm of road above and below its pocket in a 12 mm road\. The countersunk head and a roof need 2\.1 mm\./, 'screwClipThickness');
  fails({ screwLength: 6 }, /^Side screw clip\. A 6 mm screw reaches only 0 mm into the pilot hole beyond the clip\. It needs at least 1 mm there, after the 3 mm through the clip\. Use a 10 mm screw/, 'screwLength');
  fails({ screwLength: 12 }, /A 12 mm screw would end less than 0\.6 mm from the far side of a 12 mm road, or come out of it\. Use a 10 mm screw/, 'screwLength');
  fails({ screwLength: 11, height: 18 }, /^Side screw clip\. An 11 mm screw reaches only 0\.35 mm.*Use a 16 mm screw \(12, 13, 14 or 16 mm fit\)/, 'screwLength');
  // A depth that leaves the screws beyond the straight part: a working depth.
  fails({ screwClipDepth: 17 }, /Make the clip at least 27 mm deep/, 'screwClipDepth');
  fails({ screwInset: 20 }, /Make the clip at least 35 mm deep/, 'screwClipDepth');
  fails({ screwInset: 3 }, /at least 5 mm in from the side face\. Set the screw inset between 5 and 15 mm\./, 'screwInset');
  // The countersink must stay inside the walls around the pocket.
  fails({ screwSeamDistance: 14 }, /between 3\.5 and 12\.75 mm from the seam.*Set the screw distance from the seam to 12\.75 mm/, 'screwSeamDistance');
  fails({ screwHead: 10, screwSeamDistance: 12.4, screwDirection: 'bottom', screwClipThickness: 1 }, /between 6 and 11\.15 mm/, 'screwSeamDistance');
  fails({ screwClipDepth: 15 }, /straight sides/, 'screwClipDepth');
  fails({ screwHeadAngle: 30 }, /Countersink angle must be between 60 and 120°/, 'screwHeadAngle');
  fails({ screwClipThickness: 6 }, /No stock screw length grips a 6 mm clip in a 12 mm road.*Use a thinner clip or less play/, 'screwClipThickness');
  // A 10 mm road: a 10 mm screw is too long; left automatic, 8 mm is chosen.
  fails({ height: 10, slotDepth: 7, screwLength: 10 }, /Use an 8 mm screw/, 'screwLength');
  validateTrack(trackParameters(straight({ height: 10, slotDepth: 7 })));
  validateTrack(trackParameters(straight({ height: 10, slotDepth: 7, screwLength: 9 })));
  // The settings are only checked when side screw clips are in use.
  validateTrack(trackParameters(straight({ screwPilot: 3, clipType: 'draw-key' })));
  validateTrack(trackParameters(straight({ screwPilot: 3, joint: 'tabs' })));
  assert.ok(validateScrewClip({ ...screwClipSettings({}), height: 12 }).bite > 2.3);
});

test('borders: side screw clips only join road ends; tabs on a border keep clear of the clips', () => {
  for (const extra of [
    { borderSide: 'outer', borderMount: 'clips' },
    { borderSide: 'inner', borderMount: 'tabs', borderJoint: 'both', borderSegments: 2 },
  ])
    assert.throws(() => validateTrack(trackParameters(screw(extra))), (e) => {
      assert.match(e.message, /^Border connections\. Side screw clips join road ends only\./);
      assert.equal(e.warning.setting.tab, 'joints');
      return true;
    });
  // A border attached with tabs: the tabs keep away from the clips at the ends.
  const p = straight({ length: 120, borderSide: 'outer', borderMount: 'tabs' });
  const { get, free } = build(p);
  try {
    const tabs = get('road-1').jointGuides.filter((g) => g.kind === 'Tab');
    assert.ok(tabs.length >= 1);
    for (const tab of tabs) {
      const fromEnd = Math.min(tab.point[0] + 60, 60 - tab.point[0]);
      assert.ok(fromEnd > 17.15 + 5, String(fromEnd));
    }
  } finally {
    free();
  }
  // A tab placed by hand at the clip is refused, with the reason.
  assert.throws(
    () => build(straight({ length: 120, borderSide: 'outer', borderMount: 'tabs', placements: { sideTabs: [0.08] } })),
    /side screw clip at a road joint/,
  );
});

test('a border beside a convex road edge is relieved where the clip corners stand proud', () => {
  const plain = build(screw({ joint: 'none', borderSide: 'outer', borderMount: 'tabs' }));
  const clipped = build(screw({ borderSide: 'outer', borderMount: 'tabs' }));
  const inner = build(screw({ borderSide: 'inner', borderMount: 'tabs' }));
  const innerPlain = build(screw({ joint: 'none', borderSide: 'inner', borderMount: 'tabs' }));
  try {
    const volume = (b) => b.get('border-outer-1')?.solid.volume() ?? b.get('border-inner-1').solid.volume();
    const relief = volume(plain) - volume(clipped);
    // Outer edge R290: the corners stand about 0.4 mm proud, over 3.3 mm of height.
    assert.ok(relief > 0.5 && relief < 20, String(relief));
    // A concave inner edge leaves the clip inside the road.
    assert.ok(Math.abs(volume(innerPlain) - volume(inner)) < 1e-6);
  } finally {
    for (const b of [plain, clipped, inner, innerPlain]) b.free();
  }
});

test('keep-outs: slots, braid pass-throughs, other connectors and short pieces stop the build with what to change', () => {
  const slot = (startMm) => ({ version: 1, edge: 'outer', startMm, endMm: startMm });
  assert.throws(() => build(straight({ lanes: 1, slotPosition: slot(33) })), (e) => {
    assert.match(e.message, /^Road start · Side screw clip, left side\. The nearest guide slot centre is 33 mm from the left edge\./);
    assert.equal(e.warning.setting.field, 'slotStart');
    return true;
  });
  assert.throws(() => build(straight({ lanes: 1, slotPosition: slot(34), length: 300, braidFeedSide: 'both', braidFeedStations: [0.02] })), (e) => {
    assert.match(e.message, /would cut into a braid pass-through/);
    assert.equal(e.warning.setting.field, 'feedPercent');
    return true;
  });
  assert.throws(() => build(straight({ width: 60, lanes: 1 })), (e) => {
    // The width advised includes the room the centred guide slot needs.
    assert.match(e.message, /The road is 60 mm wide\. Clips on both sides beside the guide slot need at least 67\.5 mm\..*widen the road to at least 67\.5 mm/);
    assert.equal(e.warning.setting.field, 'width');
    return true;
  });
  assert.throws(() => build(straight({ width: 64.5, lanes: 1 })), /widen the road to at least 67\.5 mm/);
  build(straight({ width: 67.5, lanes: 1 })).free();
  // A narrow road takes one clip.
  build(straight({ width: 60, lanes: 1, sideClipRight: 'none', slotPosition: slot(45) })).free();
  // Too short for clips at both ends: the minimum length, which then builds.
  assert.throws(() => build(straight({ length: 30 })), (e) => {
    assert.match(e.message, /Clips at both ends need at least 36\.3 mm along the left edge; this segment has 30 mm\. Increase Road → Road length to at least 36\.3 mm/);
    assert.equal(e.warning.setting.field, 'length');
    return true;
  });
  build(straight({ length: 36.3 })).free();
  assert.throws(() => build(screw({ angle: 10 })), /Increase Road → Sweep angle to at least 13\.9°/);
  build(screw({ angle: 13.9 })).free();
  // Tabs in the same joint keep clear: automatic ones move inwards, ones
  // placed by hand are refused.
  const both = build(straight({ joint: 'both', length: 260 }));
  try {
    const tabs = both.get('road-1').jointGuides.filter((g) => g.kind === 'Tab').map((g) => Math.abs(g.point[1]));
    for (const y of tabs) assert.ok(y + 5 + 0.2 <= 70 - 32.15 + 1e-6, String(y));
  } finally {
    both.free();
  }
  assert.throws(
    () => build(straight({ joint: 'both', length: 260, placements: { startTabs: [-55, 0] } })),
    /side screw clip pocket at the road edge/,
  );
  // Counted tabs plan around the clips.
  build(straight({ joint: 'both', length: 260, connectorCounts: { startTabs: 2, finishTabs: 2 } })).free();
  // Drawn pieces and pit lanes are refused.
  assert.throws(
    () => validateTrack(trackParameters(specialTrackParams('pit', screw()))),
    /Side screw clips are made for straights and corners/,
  );
});

test('on a tight inner (concave) edge of a hollow corner the pocket keeps its floor and roof', () => {
  // Inner edge R30: the face bends up to 3.5 mm beyond the tangent line.
  const p = screw({ radius: 100, angle: 120 });
  const { get, free } = build(p);
  try {
    const road = get('road-1').solid;
    const g = screwClipGeometry(screwClipSettings(p), p.height);
    const theta = (-p.angle / 2) * Math.PI / 180;
    const R = p.radius - p.width / 2;
    const edge = [R * Math.sin(theta), R * Math.cos(theta) - p.radius];
    const dir = [Math.cos(theta), -Math.sin(theta)];
    const inward = [Math.sin(theta), Math.cos(theta)];
    for (const u of [12, 14, 15]) {
      const face = Math.hypot(R, u) - R;
      for (let v = -face + 0.3; v <= 0.6; v += 0.4) {
        const xy = [edge[0] + u * dir[0] + v * inward[0], edge[1] + u * dir[1] + v * inward[1]];
        assert.equal(solidAt(road, [...xy, g.floor - 0.5]), true, 'floor at u ' + u + ' v ' + v.toFixed(1));
        assert.equal(solidAt(road, [...xy, g.top + 0.5]), true, 'roof at u ' + u + ' v ' + v.toFixed(1));
        assert.equal(solidAt(road, [...xy, H / 2]), false, 'pocket at u ' + u);
      }
    }
  } finally {
    free();
  }
});

test('Track Set kit notes count the screws in plain words', async () => {
  const { packKit } = await import('../src/kit.js');
  const { encodeSTL } = await import('../src/editor.js');
  const { newProject } = await import('../src/project.js');
  const project = newProject();
  project.track.params = straight({ sideClipRight: 'none' });
  const parts = buildTrack(wasm, project.track.params);
  try {
    const notes = strFromU8(unzipSync(packKit(wasm, parts, project, encodeSTL))['Fitting the clips.txt']);
    assert.match(notes, /^You need 2 × 2\.5 × 10 mm countersunk wood screw for this side screw clip: two per clip\./);
    assert.match(notes, /cuts its thread into the hole in the clip/);
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
});

test('the placement map shows the clips at the edges and keeps tabs clear of them', () => {
  const layout = connectorLayout(straight({ joint: 'both', length: 260 }), undefined, 'start');
  assert.deepEqual(layout.positions.clip, [-53.925, 53.925]);
  assert.ok(layout.lockedClips);
  assert.equal(layout.reason('clip', 0), layout.lockedClips);
  assert.match(layout.reason('tab', 50), /side screw clip/);
  assert.deepEqual(layout.positions.tab, [-23.4, 23.4]);
  assert.equal(layout.reason('tab', 20, 1), null);
  const one = connectorLayout(straight({ sideClipLeft: 'none' }), undefined, 'finish');
  assert.deepEqual(one.positions.clip, [-53.925]);
});

test('a test joint and fit samples are made for the side screw clip', () => {
  const parts = buildTestJoint(wasm, straight());
  try {
    assert.deepEqual(parts.map((part) => part.id), ['road-1', 'road-2', 'road-clip-1', 'road-clip-1-2']);
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
  const files = unzipSync(packFitSamples(wasm, screw()));
  assert.deepEqual(Object.keys(files).sort(), [
    'fit-key.txt', 'rack-B.stl', 'screw-sample-1-A.stl', 'screw-sample-1-B.stl',
    'screw-sample-2-A.stl', 'screw-sample-2-B.stl', 'screw-sample-3-A.stl', 'screw-sample-3-B.stl',
    'side-screw-clip.stl', 'tab-key.stl',
  ]);
  // The three dots of the last sample stay inside its blocks: every sample
  // pair is the same size, dots or not.
  const size = (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < view.getUint32(80, true); i++)
      for (let k = 0; k < 3; k++) {
        const y = view.getFloat32(84 + i * 50 + 12 + k * 12 + 4, true);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    return hi - lo;
  };
  const g = screwClipGeometry(screwClipSettings({ height: H, screwClipPlay: 0.4 }), H);
  assert.ok(Math.abs(size(files['screw-sample-3-A.stl']) - (g.across + 11)) < 1e-3);
  const key = strFromU8(files['fit-key.txt']);
  assert.match(key, /1 dot \| 0\.2\n2 dots \| 0\.3 {2}\(current\)\n3 dots \| 0\.4/);
  assert.match(key, /2\.5 × 10 mm countersunk wood screw/);
  assert.match(fitScrewClip(screw()), /before any border on that side/);
});

test('matching ends mate in the planner, a mirrored left-hand corner too; different clips are refused; the kit counts a screw per piece half', () => {
  const engine = createEngine(wasm);
  const plate = { width: 450, depth: 450, margin: 0 };
  const pieces = starterPack().pieces;
  // The 10 mm starter pack roads: the screw length is chosen automatically (8 mm).
  const changes = { clipType: 'side-screw', segments: 1, borderSegments: 1 };
  const source = (index, extra = {}) => {
    const { name, track } = structuredClone(pieces[index]);
    Object.assign(track.params, changes, extra);
    return { name, ...engine.plannerSource({ track, plate, autoFit: false }) };
  };
  const STRAIGHT = 0, CORNER = 4;
  function run(...list) {
    const entries = list.map((entry) => (Array.isArray(entry) ? entry : [entry]));
    const defs = new Map(entries.map(([def], i) => ['s' + (i + 1), def]));
    const layout = newLayout();
    for (const [id, d] of defs) layout.sources[id] = { name: d.name, track: d.track };
    let active = {};
    entries.forEach(([, hand], i) => {
      active = placeSource(layout, defs, 's' + (i + 1), active.end, hand);
    });
    return { layout, defs };
  }
  const straightPiece = source(STRAIGHT);
  const corner = source(CORNER);
  // The two ends of every piece carry clips at both edges.
  for (const port of straightPiece.sections[0].ports)
    assert.deepEqual(port.hardware.map((h) => h.family), Array(2).fill(
      'side-screw|screwClipWidth=30|screwClipDepth=30|screwClipThickness=3|screwClipPlay=0.3|' +
        'screwSeamDistance=9|screwInset=12|screwPilot=2.1|screwThread=2.5',
    ));
  const { layout, defs } = run(straightPiece, corner, [corner, 'left'], straightPiece);
  assert.equal(layout.nodes.length, 4);
  assert.equal(layout.nodes[2].pose.flip, true);
  const net = endsOf(layout, defs);
  assert.equal(net.open.length, 2);
  assert.deepEqual(blockedJoints(net), []);
  // A corner with its right side switched off mirrors that gap to its left.
  const half = source(CORNER, { sideClipRight: 'none' });
  assert.throws(() => run(straightPiece, [half, 'left']), /connector positions or clip families differ/);
  // Every setting that shapes the clip or its mating holes must agree.
  for (const [extra, text] of [
    [{ screwClipWidth: 34 }, /Clip width is 30 mm on this piece and 34 mm on the next/],
    [{ screwClipThickness: 2.6 }, /Clip thickness is 3 mm on this piece and 2\.6 mm on the next/],
    [{ screwClipPlay: 0.1 }, /Play in pocket is 0\.3 mm on this piece and 0\.1 mm on the next/],
    [{ screwPilot: 1.8 }, /Pilot hole is 2\.1 mm on this piece and 1\.8 mm on the next/],
    [{ screwSeamDistance: 11 }, /Screw distance from seam is 9 mm/],
    [{ screwInset: 8 }, /Screw inset from side face is 12 mm/],
    [{ screwClipDepth: 34 }, /Clip depth into road is 30 mm/],
    [{ screwThread: 2.2, screwPilot: 2.1, screwClearance: 2.5 }, /Screw thread is 2\.5 mm on this piece and 2\.2 mm on the next/],
  ])
    assert.throws(() => run(straightPiece, source(STRAIGHT, extra)),
      (e) => text.test(e.message) && /^The side screw clips differ at this joint: .*Give both pieces the same side screw clip settings in Track Set\.$/.test(e.message),
      JSON.stringify(extra));
  // The screw direction and length belong to each piece's own half.
  const longer = run(straightPiece, source(STRAIGHT, { screwDirection: 'bottom', screwLength: 9 }));
  assert.deepEqual(screwHardware(endsOf(longer.layout, longer.defs)), [
    { name: '2.5 × 8 mm countersunk wood screw', count: 2 },
    { name: '2.5 × 9 mm countersunk wood screw', count: 2 },
  ]);
  // Kit: one clip per side at each joint, one screw in each piece half.
  const quantities = tally(layout, defs);
  const clips = quantities.filter((g) => g.role === 'clip').reduce((sum, g) => sum + g.count, 0);
  assert.equal(clips, 6, 'three joints, two edges');
  const hardware = screwHardware(net);
  assert.deepEqual(hardware, [{ name: '2.5 × 8 mm countersunk wood screw', count: 12 }]);
  const list = shoppingList({
    name: 'Loop', groups: [], lanes: [], hardware,
    settings: { infill: 20, spoolPrice: 0, braidSpare: 50 }, material: { name: 'PLA', density: 1.24 },
  });
  assert.match(list, /Screws \(one in each piece at every side screw clip; each cuts its thread into the clip\)\r\n {2}12 × 2\.5 × 8 mm countersunk wood screw/);
  // The clip prints from the planner like any other clip.
  const bytes = engine.plannerPrint({
    track: defs.get('s1').track,
    items: quantities.filter((g) => g.role === 'clip' && g.source === 's1'),
  });
  assert.ok(bytes.length >= 1 && bytes[0].length > 84);
});

test('mirrored prints build the same pockets, and the pack profile carries the clip settings', () => {
  const p = screw();
  const plain = build(p),
    mirrored = build(p, { planning: true, mirrorPockets: true });
  try {
    assert.ok(Math.abs(plain.get('road-1').solid.volume() - mirrored.get('road-1').solid.volume()) < 1e-6);
  } finally {
    plain.free();
    mirrored.free();
  }
  // A pack that never set them leaves them out; set values are checked.
  assert.equal('screwLength' in profileFromTrack({ params: defaultTrack() }), false);
  assert.equal(profileFromTrack({ params: screw({ screwLength: 9 }) }).screwLength, 9);
  validateLibraryProfile({ screwLength: 9, screwDirection: 'side' });
  assert.throws(() => validateLibraryProfile({ screwDirection: 'sideways' }), /from the top/);
  assert.throws(() => validateLibraryProfile({ screwLength: 1 }), /Screw length must be between/);
  // Untouched defaults on the Joints page leave an older piece unchanged.
  const fields = parseConnectionControls({ screwLength: NaN, screwClipWidth: 30, screwThread: 3 }, {});
  assert.deepEqual(fields, { screwThread: 3 });
});
