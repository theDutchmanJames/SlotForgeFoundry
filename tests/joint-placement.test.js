import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildTestJoint, buildTrack, defaultTrack } from '../src/track.js';
import { clipSpec } from '../src/geometry/clip-types.js';

const wasm = await Module();
wasm.setup();

function build(params, plan) {
  return buildTrack(
    wasm,
    { ...defaultTrack(), jointFitVersion: 2, ...params },
    plan,
  );
}

function dispose(parts) {
  for (const part of parts) part.solid.delete();
}

function assertSlide(fixed, moving, dir, offset = [0, 0]) {
  for (const distance of [0, 0.25, 1, 2, 3, 4.5, 6, 8]) {
    const shifted = moving.solid.translate([
      offset[0] + dir[0] * distance,
      offset[1] + dir[1] * distance,
      0,
    ]);
    const overlap = shifted.intersect(fixed.solid);
    try {
      const volume = overlap.volume();
      assert.ok(
        volume < 1e-5,
        `${fixed.id} and ${moving.id} interfere by ${volume} mm³ at ${distance} mm of travel`,
      );
    } finally {
      overlap.delete();
      shifted.delete();
    }
  }
}

const borders = {
  borderSide: 'both',
  borderEntry: 30,
  borderExit: 30,
  borderApex: 40,
};

test('both tabs of each tapered curved border share an unobstructed insertion path', () => {
  const parts = build({
    ...borders,
    angle: 120,
    radius: 300,
    borderMount: 'both',
  });
  try {
    const road = parts.find((part) => part.role === 'road');
    for (const [side, sign] of [
      ['outer', 1],
      ['inner', -1],
    ]) {
      assertSlide(
        road,
        parts.find((part) => part.id === 'border-' + side + '-1'),
        [0, sign],
      );
    }
  } finally {
    dispose(parts);
  }
});

test('a wrapping border with integral side tabs requires an assembly direction', () => {
  const shape = { ...borders, angle: 200, radius: 200, borderMount: 'tabs' };
  assert.throws(() => build(shape), /border segments|side clips/i);
  for (const change of [{ borderMount: 'clips' }, { borderSegments: 2 }]) {
    const parts = build({ ...shape, ...change });
    dispose(parts);
  }
  assert.throws(
    () =>
      build({ ...shape, angle: 160, placements: { sideTabs: [0.05, 0.95] } }),
    /too sharp an angle/,
  );
});

test('the draw-key shoulders progressively close both sides of the seam over their full insertion stroke', () => {
  for (const [height, clipClearance] of [
    [8, 0.03],
    [12, 0.15],
    [20, 0.4],
  ]) {
    const p = {
      ...defaultTrack(),
      kind: 'straight',
      clipType: 'draw-key',
      length: 80,
      height,
      clipClearance,
      slotDepth: 3,
      segments: 2,
      joint: 'clips',
      jointStart: 'none',
      jointEnd: 'none',
    };
    const parts = build(p);
    try {
      const clip = parts.find((part) => part.role === 'clip');
      const spec = clipSpec(p);
      for (const [i, sign] of [
        [0, -1],
        [1, 1],
      ]) {
        const hit = (solid, u) => {
          const z = spec.seatHeight + u * spec.thickness;
          return solid.rayCast([sign * 3, 3.5, z], [sign * 8, 3.5, z]).at(-1);
        };
        const land = hit(parts[i].solid, 0.05);
        const gapAt = (u) =>
          sign * (hit(clip.solid, u).position[0] - land.position[0]);
        const startingGap = gapAt(0.95);
        const finishGap = gapAt(0.05);
        assert.ok(startingGap > gapAt(0.5) && gapAt(0.5) > finishGap);
        assert.ok(Math.abs(startingGap - finishGap - 0.54) < 1e-5);
        assert.ok(
          finishGap > 0 && finishGap < 0.25,
          'running fit after final insertion',
        );
        assert.ok(
          sign * hit(clip.solid, 0.5).normal[0] < 0,
          'bearing pulls the half toward the seam',
        );
        assert.ok(sign * land.normal[0] > 0);
      }
    } finally {
      dispose(parts);
    }
  }
});

function assertFlatAssembly(parts) {
  assert.ok(parts.some((part) => part.role === 'clip'));
  for (const part of parts) {
    const bottom = part.solid.boundingBox().min[2];
    if (part.role === 'clip' || part.role === 'retainer') {
      assert.ok(bottom >= 0.29, part.id + ' clears the table when seated');
    } else {
      assert.ok(Math.abs(bottom) < 1e-6, part.id + ' rests on the table');
      const foot = part.solid.slice(0.01);
      try {
        assert.ok(foot.area() > 50, part.id + ' has a flat bearing surface');
      } finally {
        foot.delete();
      }
    }
  }
}

test('assembled roads, both types of border joints and their test coupons rest flat at supported heights', () => {
  for (const height of [8, 12, 20]) {
    const p = {
      ...defaultTrack(),
      ...borders,
      kind: 'straight',
      height,
      slotDepth: 3,
      length: 280,
      segments: 2,
      borderSegments: 2,
      joint: 'both',
      borderMount: 'both',
      borderJoint: 'both',
    };
    const whole = build(p);
    try {
      assertFlatAssembly(whole);
    } finally {
      dispose(whole);
    }
    for (const kind of ['seam', 'side', 'border']) {
      const sample = buildTestJoint(wasm, p, kind);
      try {
        assertFlatAssembly(sample);
      } finally {
        dispose(sample);
      }
    }
  }
});

test('wider road tabs reserve their actual socket walls beside lanes, track edges and clips', () => {
  const setup = {
    kind: 'straight',
    length: 120,
    segments: 2,
    joint: 'both',
    jointStart: 'none',
    jointEnd: 'none',
    clipType: 'draw-key',
    tabWidth: 20,
    tabLength: 14,
  };
  for (const [point, reason] of [
    [64, /road edge/],
    [22, /guide slot/],
    [17, /more than 15.5 mm/],
  ]) {
    assert.throws(
      () =>
        build({
          ...setup,
          placements: { seamTabs: [point], seamClips: [0] },
        }),
      reason,
    );
  }
  const parts = build(setup);
  try {
    assertSlide(
      parts.find((p) => p.id === 'road-1'),
      parts.find((p) => p.id === 'road-2'),
      [1, 0],
    );
  } finally {
    dispose(parts);
  }
});

test('curved resized tabs clear the assembled border along the full withdrawal path', () => {
  const parts = build({
    ...borders,
    tabWidth: 15,
    tabLength: 13,
    tabThickness: 3.4,
    angle: 80,
    radius: 300,
    borderMount: 'tabs',
  });
  try {
    const road = parts.find((p) => p.role === 'road');
    for (const [side, sign] of [
      ['outer', 1],
      ['inner', -1],
    ]) {
      const border = parts.find((p) => p.id === 'border-' + side + '-1');
      assertSlide(road, border, [0, sign]);
      for (const distance of [10, 12, 14])
        assertSlide(road, border, [0, sign], [0, sign * distance]);
    }
  } finally {
    dispose(parts);
  }
});

test('fork type determines the wall, end and coupon space consumed by each actual socket', () => {
  const setup = {
    ...defaultTrack(),
    kind: 'straight',
    length: 120,
    segments: 2,
    joint: 'clips',
    jointStart: 'none',
    jointEnd: 'none',
    borderSide: 'outer',
    borderMount: 'clips',
    borderEntry: 26,
    borderExit: 26,
    borderApex: 26,
  };
  dispose(build({ ...setup, clipType: 'draw-key' }));
  assert.throws(
    () => build({ ...setup, clipType: 'carrera' }),
    /Outside border attachment 1 · Carrera clip.*26 mm.*32.15 mm.*Borders → Border width/,
  );
  for (const clipType of ['draw-key', 'carrera']) {
    const p = { ...setup, clipType, borderSide: 'none' };
    assert.throws(
      () => build({ ...p, length: 34 }),
      /Road segment 1 · seam 1.*supports need.*17 mm per segment.*Road length/,
    );
    const sample = buildTestJoint(wasm, p, 'seam');
    try {
      const [a, b] = sample.filter((part) => part.role === 'road');
      assertSlide(a, b, [1, 0]);
      assert.ok(
        a.solid.boundingBox().max[0] - a.solid.boundingBox().min[0] >=
          (clipType === 'carrera' ? 31.15 : 14.15),
      );
    } finally {
      dispose(sample);
    }
    // Long pockets at both ends of an inside border have less room than the
    // neighbouring road. The coupon must extend the shorter free-edge arc.
    const bend = {
      ...p,
      kind: 'curve',
      radius: 300,
      angle: 90,
      borderSide: 'inner',
      borderEntry: 48,
      borderApex: 48,
      borderExit: 48,
      borderJoint: 'clips',
    };
    dispose(buildTestJoint(wasm, bend, 'border'));
  }
});

test('a narrow border with room for a tab and fork reserves space for both before placing either', () => {
  const p = {
    kind: 'straight',
    length: 160,
    borderSide: 'outer',
    borderSegments: 2,
    clipType: 'draw-key',
    borderJoint: 'both',
    borderEntry: 31,
    borderApex: 31,
    borderExit: 31,
  };
  const parts = build(p);
  try {
    const borders = parts.filter((part) => part.role === 'border');
    assertSlide(borders[0], borders[1], [1, 0]);
    assert.ok(parts.find((part) => part.id === 'end-clip-outer-1'));
  } finally {
    dispose(parts);
  }
  assert.throws(
    () => build({ ...p, tabWidth: 16 }),
    (error) =>
      error.warning?.location === 'Outside border · start' &&
      error.warning.reason.includes('tab and Double-dovetail draw key') &&
      error.warning.setting.field === 'borderEntry',
  );
});

test('joined border segments slide as one assembly onto an undivided curved road', () => {
  const parts = build({
    ...borders,
    angle: 75,
    radius: 240,
    borderSegments: 2,
    borderMount: 'tabs',
    borderJoint: 'tabs',
  });
  try {
    const road = parts.find((part) => part.role === 'road');
    for (const [side, sign] of [
      ['outer', 1],
      ['inner', -1],
    ]) {
      const segments = parts.filter((part) =>
        part.id.startsWith('border-' + side),
      );
      for (const border of segments) assertSlide(road, border, [0, sign]);
      assertSlide(segments[0], segments[1], [1, 0]);
    }
  } finally {
    dispose(parts);
  }
});

// The imported lane travels diagonally to a vertical end face shared with the
// native straight. Good registration requires the connector to follow that face.
const skewed = {
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

test('Circuit sockets use the selected fork reach and tab envelope at a skew track end', () => {
  const setup = {
    kind: 'import',
    joint: 'none',
    jointEnd: 'both',
    connectorOffset: 54,
    tabWidth: 12,
    tabLength: 11,
    clipType: 'carrera',
    borderSide: 'outer',
    borderEntry: 18,
    borderExit: 18,
    borderApex: 18,
  };
  const parts = build(setup, skewed);
  try {
    const clip = parts.find((p) => p.id === 'road-clip-1');
    assert.ok(
      clip.solid.boundingBox().max[0] - clip.solid.boundingBox().min[0] >=
        59.99,
    );
  } finally {
    dispose(parts);
  }
  assert.throws(
    () => build({ ...setup, borderMount: 'clips' }, skewed),
    /Outside border attachment 1 · Carrera clip.*18 mm.*32.15 mm/,
  );
  assert.throws(
    () =>
      build(
        {
          ...setup,
          borderJoint: 'tabs',
          placements: { endTabs: [0.18] },
        },
        skewed,
      ),
    (error) =>
      error.warning?.location === 'Outside border · start' &&
      error.warning.reason.includes('road-facing edge') &&
      error.warning.setting.field === 'place_endTabs',
  );
});

test('side mounts on an imported piece follow the road edge even when its end cuts are skewed', () => {
  const parts = build(
    { ...borders, kind: 'import', borderMount: 'both' },
    skewed,
  );
  try {
    const road = parts.find((part) => part.role === 'road');
    const length = Math.hypot(100, 40);
    for (const [side, sign] of [
      ['outer', 1],
      ['inner', -1],
    ]) {
      const border = parts.find((part) => part.id === 'border-' + side + '-1');
      assertSlide(road, border, [(sign * -40) / length, (sign * 100) / length]);
    }
  } finally {
    dispose(parts);
  }
});

test('imported road ends and both border ends mate with a separately generated straight', () => {
  const setup = {
    ...borders,
    borderEntry: 60,
    borderApex: 60,
    borderExit: 60,
    joint: 'both',
    borderJoint: 'both',
  };
  const first = build({ ...setup, kind: 'import' }, skewed);
  try {
    const second = build({ ...setup, kind: 'straight', length: 180 });
    try {
      for (const part of first.filter((p) =>
        ['road', 'border'].includes(p.role),
      )) {
        const mate = second.find((p) => p.id === part.id);
        assertSlide(part, mate, [1, 0], [90, 0]);
        const id =
          part.role === 'road'
            ? 'road-clip-1'
            : part.id.replace('border-', 'end-clip-');
        const clip = first.find((p) => p.id === id);
        const placed = mate.solid.translate([90, 0, 0]);
        const overlap = clip.solid.intersect(placed);
        try {
          assert.ok(
            overlap.volume() < 1e-5,
            id + ' seats in the separately generated pocket',
          );
        } finally {
          overlap.delete();
          placed.delete();
        }
      }
    } finally {
      dispose(second);
    }
  } finally {
    dispose(first);
  }
});
