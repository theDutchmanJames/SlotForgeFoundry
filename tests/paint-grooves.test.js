import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import init from 'manifold-3d';
import { buildTrack, defaultTrack } from '../src/track.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { parseDrawing } from '../src/imports.js';

const wasm = await init();
wasm.setup();
const straight = {
  ...defaultTrack(),
  kind: 'straight',
  length: 100,
  width: 80,
  lanes: 1,
  segments: 2,
  borderSide: 'outer',
  borderSegments: 3,
  borderEntry: 20,
  borderApex: 20,
  borderExit: 20,
  whiteLineWidth: 4,
  grooveWidth: 0.8,
  grooveDepth: 0.45,
};
function build(t, overrides, plan) {
  const parts = buildTrack(wasm, { ...straight, ...overrides }, plan);
  t.after(() => parts.forEach((part) => part.solid.delete()));
  return parts;
}
function near(actual, expected, epsilon = 0.0001) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `Expected ${expected}, got ${actual}`,
  );
}
function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function paintAt(part, x, y) {
  return part.kerbMarkings?.find(({ points }) =>
    points.every((a, i) => cross(a, points[(i + 1) % 3], [x, y]) >= -1e-7),
  )?.color;
}
function whiteArea(part) {
  return (part.kerbMarkings ?? []).reduce(
    (area, { color, points }) =>
      area + (color === '#FFFFFF' ? Math.abs(cross(...points)) / 2 : 0),
    0,
  );
}
function heightAt(solid, x, y) {
  const hits = solid.rayCast([x, y, straight.height + 2], [x, y, -1]);
  assert.ok(hits.length, `No surface at ${x}, ${y}`);
  return hits[0].position[2];
}

test('a shared white line keeps its chosen width across independent road and border segments', (t) => {
  const base = build(t, {});
  const marked = build(t, { whiteLineRoad: 'both', whiteLineBorder: 'both' });
  for (const [i, part] of marked.entries()) {
    assert.deepEqual(encodeSTL(part.solid), encodeSTL(base[i].solid));
    const length =
      straight.length /
      (part.role === 'road' ? straight.segments : straight.borderSegments);
    // The inside road has no border and carries all 4 mm. The outside road
    // and border each carry 2 mm even though their print seams differ.
    near(whiteArea(part), length * (part.role === 'road' ? 6 : 2));
  }
  const road = marked.find((p) => p.id === 'road-1');
  const border = marked.find((p) => p.id === 'border-outer-1');
  for (const y of [-39.99, -36.01, 38.01, 39.99])
    assert.equal(paintAt(road, -32.1, y), '#FFFFFF');
  for (const y of [-35.99, 37.99])
    assert.equal(paintAt(road, -32.1, y), undefined);
  for (const y of [40.01, 41.99])
    assert.equal(paintAt(border, -32.1, y), '#FFFFFF');
  assert.equal(paintAt(border, -32.1, 42.01), undefined);
});

test('the white line groove has the requested width and depth on the driving side in the printable STL', (t) => {
  const options = { whiteLineRoad: 'both', whiteLineBorder: 'outer' };
  const plain = build(t, options),
    grooved = build(t, { ...options, whiteLineGroove: true });
  const raw = grooved.find((p) => p.id === 'road-1').solid;
  const imported = parseSTL(wasm, encodeSTL(raw));
  t.after(() => imported.delete());
  for (const solid of [raw, imported]) {
    for (const y of [37.21, 37.99, -35.21, -35.99])
      near(heightAt(solid, -32.11, y), 11.55);
    for (const y of [37.19, 38.01, -35.19, -36.01])
      near(heightAt(solid, -32.11, y), 12);
  }
  for (const [i, part] of grooved.entries()) {
    const lostVolume = plain[i].solid.volume() - part.solid.volume();
    near(lostVolume, part.role === 'road' ? 2 * 50 * 0.8 * 0.45 : 0);
  }
});

test('road and border groove controls independently override a legacy shared setting', (t) => {
  const options = {
    whiteLineRoad: 'inner',
    whiteLineBorder: 'outer',
    whiteLineGroove: true,
  };
  for (const roadOn of [false, true]) {
    const parts = build(t, {
      ...options,
      roadLineGroove: roadOn,
      borderLineGroove: !roadOn,
    });
    const road = parts.find((part) => part.role === 'road');
    const border = parts.find((part) => part.role === 'border');
    near(heightAt(road.solid, -32.11, -35.5), roadOn ? 11.55 : 12);
    near(heightAt(border.solid, -30.11, 40.1), roadOn ? 12 : 11.55);
  }
  const shared = build(t, {
    ...options,
    whiteLineRoad: 'outer',
    roadLineGroove: false,
  });
  near(
    heightAt(shared.find((part) => part.role === 'road').solid, -32.11, 37.5),
    12,
  );
  near(
    heightAt(shared.find((part) => part.role === 'border').solid, -30.11, 40.1),
    12,
  );
});

test('a border-only stripe and its optional groove both belong to the printable border', (t) => {
  const parts = build(t, { whiteLineBorder: 'outer', whiteLineGroove: true });
  const border = parts.find((p) => p.role === 'border');
  const road = parts.find((p) => p.role === 'road');
  assert.equal(road.kerbMarkings, undefined);
  near(heightAt(road.solid, -30.11, 39.9), 12);
  near(heightAt(border.solid, -30.11, 40.1), 11.55);
  near(heightAt(border.solid, -30.11, 40.79), 11.55);
  for (const y of [40.81, 44.79]) {
    near(heightAt(border.solid, -30.11, y), 12);
    assert.equal(paintAt(border, -30.11, y), '#FFFFFF');
  }
  assert.equal(paintAt(border, -30.11, 44.81), undefined);
});

test('each kerb gets a paint boundary and a print seam through a block leaves both halves flush', (t) => {
  const parts = build(t, {
    borderSegments: 2,
    kerbEdge: 'road',
    kerbLength: 12,
    kerbWidth: 6,
    kerbGroove: true,
  });
  const [first, second] = parts.filter((p) => p.role === 'border');
  // The first colour change is 12 mm from the start at x = -50. The
  // physical seam at x = 0 passes through the middle of the fifth stone.
  for (const x of [-38.39, -37.61]) {
    near(heightAt(first.solid, x, 43.11), 11.55);
    assert.equal(paintAt(first, x, 43.11), undefined);
  }
  assert.equal(paintAt(first, -38.6, 43.11), '#E5484D');
  assert.equal(paintAt(first, -37.4, 43.11), '#ECE9E2');
  for (const [part, x] of [
    [first, -0.01],
    [second, 0.01],
  ]) {
    near(heightAt(part.solid, x, 43.11), 12);
    assert.equal(paintAt(part, x, 43.11), '#E5484D');
  }
});

test('white line width follows the drawn edge on a Circuit road that widens toward the finish', (t) => {
  const plan = {
    outlines: [
      [
        [-50, -40],
        [50, -55],
        [50, 55],
        [-50, 40],
      ],
    ],
    lanes: [
      [
        [-50, 0],
        [50, 0],
      ],
    ],
  };
  const parts = build(
    t,
    { kind: 'import', segments: 1, borderSide: 'none', whiteLineRoad: 'both' },
    plan,
  );
  const road = parts.find((p) => p.role === 'road');
  for (const x of [-37.5, 37.5]) {
    const halfWidth = 40 + (x + 50) * 0.15;
    for (const sign of [-1, 1]) {
      assert.equal(paintAt(road, x, sign * (halfWidth - 3.9)), '#FFFFFF');
      assert.equal(paintAt(road, x, sign * (halfWidth - 4.2)), undefined);
    }
  }
});

test('both Circuit export formats produce the same grooved roads and kerbs on a segmented bend', async (t) => {
  const settings = {
    kind: 'import',
    whiteLineRoad: 'both',
    whiteLineBorder: 'outer',
    whiteLineGroove: true,
    kerbEdge: 'road',
    kerbSide: 'outer',
    kerbGroove: true,
    kerbLength: 12,
    kerbWidth: 5,
  };
  const builds = [];
  for (const file of ['circuit-curve-compact.svg', 'circuit-curve-mm.dxf']) {
    const plan = parseDrawing(
      await readFile(new URL('./drawings/' + file, import.meta.url), 'utf8'),
      file,
    );
    const decorated = build(t, settings, plan);
    const flat = build(
      t,
      { ...settings, whiteLineGroove: false, kerbGroove: false },
      plan,
    );
    for (const [i, part] of decorated.entries()) {
      assert.equal(part.solid.status(), 'NoError');
      assert.ok(whiteArea(part) > 0);
      assert.ok(flat[i].solid.volume() - part.solid.volume() > 1);
      const shells = part.solid.decompose();
      try {
        assert.equal(shells.length, 1, part.id);
      } finally {
        shells.forEach((shell) => shell.delete());
      }
    }
    builds.push(decorated);
  }
  for (const [i, part] of builds[0].entries()) {
    const other = builds[1][i];
    assert.equal(part.id, other.id);
    near(whiteArea(part), whiteArea(other), 0.1);
    near(part.solid.volume(), other.solid.volume(), 1);
  }
});

test('paint settings reject a groove that opens a hollow deck, a line crossing the braid, and a too-narrow border', () => {
  const invalid = [
    [
      { whiteLineRoad: 'outer', whiteLineGroove: true, grooveDepth: 2.1 },
      /groove|deck|roof/i,
    ],
    [{ whiteLineRoad: 'outer', whiteLineWidth: 36 }, /slot|braid/i],
    [{ whiteLineBorder: 'outer', borderEntry: 1 }, /border/i],
  ];
  for (const [settings, message] of invalid)
    assert.throws(
      () => buildTrack(wasm, { ...straight, ...settings }),
      message,
    );
});

test('an edge line fits beside an off-centre slot where there is road for it, and points at Slot position where there is not', (t) => {
  // 12 mm from the left edge leaves 4.9 mm of road outside the braid.
  const p = {
    borderSide: 'none', segments: 1, width: 200, braidGap: 0.6,
    slotPosition: { version: 1, edge: 'outer', startMm: 12, endMm: 12 },
  };
  const [far] = build(t, { ...p, whiteLineRoad: 'inner', whiteLineWidth: 40 });
  assert.equal(paintAt(far, 0, -61), '#FFFFFF');
  assert.equal(paintAt(far, 0, -59), undefined);
  const [near] = build(t, { ...p, whiteLineRoad: 'outer', whiteLineWidth: 4.5 });
  assert.equal(paintAt(near, 0, 96), '#FFFFFF');
  assert.equal(paintAt(near, 0, 95), undefined);
  assert.throws(
    () => buildTrack(wasm, { ...straight, ...p, whiteLineRoad: 'outer', whiteLineWidth: 5 }),
    /The white line reaches a guide slot or braid strip\. Reduce White line width under Road → Shared line and groove dimensions, or move the slot away from this edge under Slot position\.$/,
  );
  assert.throws(
    () => buildTrack(wasm, { ...straight, ...p, whiteLineRoad: 'outer', whiteLineWidth: 4.5, roadLineGroove: true }),
    /The white line or its paint groove reaches a guide slot or braid strip\. .* or reduce Groove width, or move the slot away from this edge under Slot position\.$/,
  );
  // A slot that only reaches the edge at end B is caught as well.
  assert.throws(
    () => buildTrack(wasm, { ...straight, ...p, length: 300, whiteLineRoad: 'outer', whiteLineWidth: 5,
      slotPosition: { ...p.slotPosition, startMm: 100 } }),
    /reaches a guide slot or braid strip/,
  );
  // Without a slot position the advice is what it was.
  assert.throws(
    () => buildTrack(wasm, { ...straight, borderSide: 'none', whiteLineRoad: 'outer', whiteLineWidth: 36 }),
    /The white line reaches a guide slot or braid strip\. Reduce White line width under Road → Shared line and groove dimensions\.$/,
  );
});

test('a groove in the solid border rim may extend past the thickness of the hollow deck', (t) => {
  const parts = build(t, {
    whiteLineBorder: 'outer',
    whiteLineGroove: true,
    grooveDepth: 2.1,
  });
  const border = parts.find((part) => part.role === 'border');
  near(heightAt(border.solid, -30.11, 40.31), 9.9);
  near(heightAt(border.solid, -30.11, 42.11), 12);
});

test('a skew-ended Circuit drawing measures shared stripes and grooves perpendicular to the road edge', (t) => {
  // The longitudinal edges are horizontal, but the end cuts span [60, 80].
  // Taking 2 mm along an end cut would only cover 1.6 mm of actual road.
  const plan = {
    outlines: [
      [
        [-80, -40],
        [20, -40],
        [80, 40],
        [-20, 40],
      ],
    ],
    lanes: [
      [
        [-50, 0],
        [50, 0],
      ],
    ],
  };
  const parts = build(
    t,
    {
      kind: 'import',
      segments: 1,
      borderSegments: 1,
      whiteLineRoad: 'outer',
      whiteLineBorder: 'outer',
      whiteLineGroove: true,
      kerbEdge: 'road',
    },
    plan,
  );
  const road = parts.find((part) => part.role === 'road');
  const border = parts.find((part) => part.role === 'border');
  const x = 10.3;
  assert.equal(paintAt(road, x, 38.01), '#FFFFFF');
  assert.equal(paintAt(road, x, 37.99), undefined);
  assert.equal(paintAt(border, x, 41.99), '#FFFFFF');
  assert.ok(['#E5484D', '#ECE9E2'].includes(paintAt(border, x, 42.01)));
  near(heightAt(road.solid, x, 37.21), 11.55);
  near(heightAt(road.solid, x, 37.99), 11.55);
  near(heightAt(road.solid, x, 37.19), 12);
  near(whiteArea(road), 200);
  near(whiteArea(border), 200);
});

test('a long narrow section warns when a groove would erase complete kerbstones before the border widens', () => {
  const settings = {
    ...straight,
    length: 120,
    kerbEdge: 'road',
    kerbLength: 10,
    kerbWidth: 5,
    kerbGroove: true,
    borderEntry: 1,
    borderApex: 1,
    borderExit: 18,
  };
  assert.throws(
    () => buildTrack(wasm, settings),
    (error) =>
      /outside border.*kerbstone 1/i.test(error.warning?.location) &&
      /0\.8 mm/.test(error.warning.reason) &&
      /10 mm/.test(error.warning.reason) &&
      error.warning.setting.tab === 'borders' &&
      error.warning.setting.field === 'grooveWidth',
  );
});
