import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { buildTrack, defaultTrack, validateTrack } from '../src/track.js';
import { connectorLayout } from '../src/geometry/connector-layout.js';
import { clipPair, withPrintableSolid } from '../src/geometry/joints.js';
import { SolidWorkshop } from '../src/geometry/solids.js';

const wasm = await init();
wasm.setup();

function profile(extra) {
  return {
    ...defaultTrack(),
    kind: 'straight',
    length: 140,
    slotDepth: 4,
    segments: 2,
    clipType: 'draw-key',
    joint: 'clips',
    jointStart: 'none',
    jointEnd: 'none',
    placements: { seamClips: [0] },
    ...extra,
  };
}

function build(t, p) {
  const parts = buildTrack(wasm, p);
  t.after(() => parts.forEach(({ solid }) => solid.delete()));
  return parts;
}

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-5, label + ': ' + actual);
}

test('the dovetail uses the available height beneath a two-millimetre roof on hollow and solid roads', (t) => {
  for (const [height, clipClearance, hollow] of [
    [7.5, 0.03, true],
    [10, 0.4, false],
    [12, 0.15, true],
    [17.225, 0.03, true],
  ]) {
    const p = profile({ height, clipClearance, hollow, deck: 0.8 });
    const parts = build(t, p);
    const main = parts.find((part) => part.role === 'clip');
    const keeper = parts.find((part) => part.role === 'retainer');
    const box = main.solid.boundingBox();
    close(keeper.solid.boundingBox().min[2], 0.3, 'clearance above the table');
    close(box.min[2], 3.65, 'seated key');
    close(box.max[2], height - 2.15, 'key top below running clearance');
    withPrintableSolid(
      main,
      (solid) => {
        close(solid.boundingBox().min[2], 0, 'clip on print bed');
        close(
          solid.boundingBox().max[2],
          height - 5.8,
          'printed key thickness',
        );
      },
      { sideDown: true },
    );
    for (const [index, road] of parts
      .filter((part) => part.role === 'road')
      .entries()) {
      const x = index ? 10.1 : -10.1;
      const z = road.solid
        .rayCast([x, 0.37, -1], [x, 0.37, height + 1])
        .map((h) => h.position[2]);
      assert.equal(z.length, 2);
      close(z[0], height - 2, 'pocket ceiling');
      close(z[1] - z[0], 2, 'physical road skin');
      close(
        z[0] - box.max[2],
        0.15,
        'same vertical fit at every side clearance',
      );
    }
  }
  assert.throws(
    () => validateTrack(profile({ height: 7.49 })),
    /at least 7.5 mm/,
  );
});

test('shallow braid recesses can cross the low keeper recess but must clear the tall dovetail', (t) => {
  const valid = profile({ width: 120, laneSpacing: 40, braidWidth: 11 });
  const layout = (p) => connectorLayout(p, null, 'seam').reason('clip', 0, 0);
  assert.equal(layout(valid), null);
  build(t, valid);
  const conflict = { ...valid, braidWidth: 14 };
  assert.match(layout(conflict), /braid recess/);
  assert.throws(
    () => buildTrack(wasm, conflict),
    /intersects a slot, braid recess/,
  );
});

test('a curved side mount and a curved border seam both retain the full roof over each key half', (t) => {
  const p = profile({
    kind: 'curve',
    radius: 500,
    angle: 50,
    height: 14,
    deck: 0.8,
    borderSide: 'outer',
    borderEntry: 60,
    borderExit: 60,
    borderApex: 60,
    borderSegments: 2,
    borderMount: 'clips',
    borderJoint: 'clips',
  });
  const parts = build(t, p);
  for (const id of ['side-clip-outer-1', 'end-clip-outer-1']) {
    const key = parts.find((part) => part.id === id);
    const { min, max } = key.solid.boundingBox();
    const center = min.map((n, i) => (n + max[i]) / 2);
    const section = key.solid.project();
    t.after(() => section.delete());
    const outline = section.toPolygons()[0];
    const far = outline.reduce((a, b) =>
      Math.hypot(b[0] - center[0], b[1] - center[1]) >
      Math.hypot(a[0] - center[0], a[1] - center[1])
        ? b
        : a,
    );
    for (const k of [-0.72, 0.72]) {
      const x = center[0] + k * (far[0] - center[0]);
      const y = center[1] + k * (far[1] - center[1]);
      const rays = parts
        .filter((part) => ['road', 'border'].includes(part.role))
        .flatMap((part) =>
          part.solid.rayCast([x, y, -1], [x, y, p.height + 1]),
        );
      assert.equal(rays.length, 2);
      close(rays[0].position[2], p.height - 2, id + ' roof underside');
      close(rays[1].position[2], p.height, id + ' finished surface');
    }
  }
});

test('one workshop can produce dimensionally distinct keys and print-kit groups', (t) => {
  const work = new SolidWorkshop(wasm);
  t.after(() => work.close());
  const loose = [];
  for (const height of [10, 12]) {
    clipPair(
      work,
      profile({ height }),
      [0, 0],
      [1, 0],
      null,
      null,
      loose,
      'key-' + height,
    );
  }
  const keys = loose.filter((q) => q.role === 'clip');
  assert.notEqual(keys[0].fabricationKey, keys[1].fabricationKey);
  close(
    keys[1].solid.boundingBox().max[2] - keys[0].solid.boundingBox().max[2],
    2,
    'additional key height',
  );
});

test('a physical paint groove crossing the dovetail roof identifies the conflicting part', (t) => {
  const p = profile({
    segments: 1,
    joint: 'none',
    placements: {},
    borderSide: 'outer',
    borderEntry: 40,
    borderExit: 40,
    borderApex: 40,
    borderMount: 'clips',
    whiteLineRoad: 'outer',
    whiteLineGroove: false,
  });
  build(t, p);
  assert.throws(
    () => buildTrack(wasm, { ...p, whiteLineGroove: true }),
    (error) =>
      /2 mm roof/.test(error.message) &&
      error.warning.location.includes('Road'),
  );
  build(t, { ...p, whiteLineGroove: true, whiteLineRoad: 'inner' });
});
