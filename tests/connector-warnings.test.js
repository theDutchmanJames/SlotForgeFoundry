import assert from 'node:assert/strict';
import { test } from 'node:test';
import init from 'manifold-3d';
import { buildTrack, defaultTrack } from '../src/track.js';

const wasm = await init();
wasm.setup();
const road = {
  ...defaultTrack(),
  kind: 'straight',
  length: 120,
  segments: 2,
  joint: 'clips',
  jointStart: 'none',
  jointEnd: 'none',
  borderSide: 'none',
  clipType: 'carrera',
};

function checkWarning(params, location, field, reason, advice) {
  assert.throws(
    () => buildTrack(wasm, params),
    (error) => {
      assert.equal(error.warning.location, location);
      assert.equal(error.warning.setting.field, field);
      assert.match(error.warning.reason, reason);
      assert.match(error.warning.advice, advice);
      return true;
    },
  );
}

function builds(params) {
  for (const part of buildTrack(wasm, params)) part.solid.delete();
}

test('short segment warning measures the exact support length and points to a working total road length', () => {
  checkWarning(
    { ...road, length: 36 },
    'Road segment 1 · seam 1',
    'length',
    /33.15 mm.*18 mm per segment/,
    /Road length to at least 67 mm/,
  );
  builds({ ...road, length: 67 });
});

test('a wide corner accommodates full Carrera pockets at both ends even when its inner arc is short', () => {
  const corner = {
    ...road, kind: 'curve', width: 200, radius: 220, angle: 30, height: 10,
    laneSpacing: 85, segments: 1, jointStart: 'clips', jointEnd: 'clips',
  };
  for (const angle of [30, 17]) {
    const parts = buildTrack(wasm, { ...corner, angle });
    try {
      const [a, b] = parts[0].jointGuides.map(guide => guide.point);
      const offset = Math.hypot(a[0], a[1] + corner.radius) - corner.radius;
      assert.ok(angle === 30 ? Math.abs(offset) < 1e-6 : offset > 0);
      assert.ok(Math.abs(a[0] + b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6,
        'automatic pockets remain aligned on consecutive copies');
    } finally {
      parts.forEach(part => part.solid.delete());
    }
  }
  assert.throws(() => buildTrack(wasm, {
    ...corner, angle: 12, placements: {startClips: [0], finishClips: [0]},
  }), /other end of the same road segment/);
  builds({...corner, angle: 12, placements: {startClips: [-18], finishClips: [18]}});
  assert.throws(() => buildTrack(wasm, {...corner, angle: 5}), /Sweep angle or Centre radius/);
});

test('road seam positions differentiate the edge, slot wall and another reserved mount', () => {
  const setup = { ...road, joint: 'both', tabWidth: 20, tabLength: 14 };
  checkWarning(
    { ...setup, placements: { seamTabs: [64] } },
    'Road seam 1 · tab',
    'place_seamTabs',
    /64 mm offset.*road edge.*58 mm/,
    /Seam tabs/,
  );
  checkWarning(
    { ...setup, placements: { seamTabs: [32.5] } },
    'Road seam 1 · tab',
    'place_seamTabs',
    /slot centre is 0 mm away.*15.5 mm/,
    /Seam tabs/,
  );
  checkWarning(
    { ...setup, placements: { seamTabs: [0], seamClips: [4] } },
    'Road seam 1 · Carrera clip',
    'place_seamClips',
    /4 mm offset.*another connector/,
    /Seam clips/,
  );
});

test('automatic side clip warnings measure the widest border and point to the profile affecting its pocket', () => {
  const setup = {
    ...road,
    borderSide: 'outer',
    borderMount: 'clips',
    borderEntry: 26,
    borderExit: 26,
    borderApex: 26,
  };
  checkWarning(
    setup,
    'Outside border attachment 1 · Carrera clip',
    'outerApexWidth',
    /26 mm.*widest.*32.15 mm/,
    /Borders → Border width/,
  );
  builds({ ...setup, borderEntry: 36, borderApex: 36, borderExit: 36 });
});

test('manual border attachment warnings identify the blocked position as a percentage', () => {
  const setup = {
    ...road,
    joint: 'none',
    borderSide: 'outer',
    borderMount: 'clips',
    borderEntry: 36,
    borderExit: 36,
    borderApex: 36,
  };
  checkWarning(
    { ...setup, placements: { sideClips: [0.5] } },
    'Outside border attachment 1 · Carrera clip',
    'place_sideClips',
    /50%.*too close to a road seam/,
    /Side clips/,
  );
  builds({ ...setup, placements: { sideClips: [0.3] } });
});
