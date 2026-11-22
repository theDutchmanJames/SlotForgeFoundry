import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {
  defaultTrack,
  buildTrack,
  nativePath,
  validateTrack,
} from '../src/track.js';
import {
  borderEndProfile,
  borderEndShapes,
} from '../src/geometry/border-ends.js';
import { connectorLayout } from '../src/geometry/connector-layout.js';
import { encodeSTL, parseSTL } from '../src/editor.js';

const wasm = await Module();
wasm.setup();
const end = (shape, length, at) => ({ shape, length, at });
const p = {
  ...defaultTrack(),
  kind: 'straight',
  length: 420,
  borderSide: 'both',
  segments: 2,
  borderSegments: 2,
  borderEntry: 36,
  borderApex: 36,
  borderExit: 36,
};

test('the three printable profiles use the local width for Short and Long and reverse at the entry', () => {
  for (const shape of borderEndShapes) {
    for (const length of ['short', 'long']) {
      const params = {
        ...p,
        borderEnds: {
          outer: { finish: end(shape, length, 0.8) },
          inner: { start: end(shape, length, 0.2) },
        },
      };
      const path = nativePath(params);
      const outer = borderEndProfile(path, params, 'outer');
      const inner = borderEndProfile(path, params, 'inner');
      const span = (36 * (length === 'long' ? 2 : 1)) / p.length;
      assert.ok(Math.abs(outer.path.borderStock[1] - (0.8 - span)) < 1e-9);
      assert.ok(Math.abs(inner.path.borderStock[0] - (0.2 + span)) < 1e-9);
      assert.equal(outer.widthAt(0.81), 0);
      assert.equal(inner.widthAt(0.19), 0);
      assert.equal(outer.widthAt(0.8), 0);
      for (const ratio of [0.1, 0.25, 0.75, 1]) {
        const width = outer.widthAt(0.8 - span * ratio);
        assert.ok(Math.abs(width - inner.widthAt(0.2 + span * ratio)) < 1e-9);
        assert.ok(width > 0 && width <= 36);
      }
      assert.deepEqual(outer.path.borderSeams, [0, 0.4, 0.8]);
    }
  }
});

test('segmented STL borders end partway along the road, carry paint and keep hardware away from the exposed end', () => {
  const params = {
    ...p,
    borderEnds: {
      outer: { finish: end('rounded', 'long', 0.7) },
      inner: { start: end('s-curve', 'short', 0.2) },
    },
    borderMount: 'clips',
    borderJoint: 'clips',
    clipType: 'carrera-retained',
    whiteLineBorder: 'both',
    whiteLineRoad: 'both',
    kerbEdge: 'both',
    kerbGroove: true,
    kerbLength: 3,
  };
  const parts = buildTrack(wasm, params);
  try {
    const find = (id) => parts.find((part) => part.id === id);
    assert.ok(find('end-clip-outer-0') && find('end-clip-inner-2'));
    assert.ok(!find('end-clip-outer-2') && !find('end-clip-inner-0'));
    const a = find('border-outer-1').solid.boundingBox(),
      b = find('border-outer-2').solid.boundingBox();
    assert.ok(Math.abs(a.max[0] - b.min[0]) < 1e-5);
    const outerTip = -p.length / 2 + 0.7 * p.length;
    assert.ok(Math.abs(b.max[0] - outerTip) < 1e-4);
    assert.ok(
      Math.abs(find('border-inner-1').solid.boundingBox().min[0] + 126) < 1e-4,
    );
    assert.ok(
      find('side-clip-outer-2').solid.boundingBox().max[0] < outerTip - 72,
    );
    // At a shared edge only half the white line sits on the road. Once the
    // outside border has ended, its full 3 mm width must be on the road.
    const lineStarts = (road, x) =>
      road.kerbMarkings
        .flatMap((m) => m.points)
        .filter(([px, y]) => Math.abs(px - x) < 1e-4 && y > 60)
        .map(([, y]) => y);
    assert.ok(
      Math.abs(Math.min(...lineStarts(find('road-1'), -210)) - 68.5) < 1e-4,
    );
    assert.ok(
      Math.abs(Math.min(...lineStarts(find('road-2'), 210)) - 67) < 1e-4,
    );
    const border = find('border-outer-2');
    assert.ok(border.kerbMarkings?.length);
    const printed = parseSTL(wasm, encodeSTL(border.solid));
    try {
      assert.equal(printed.status(), 'NoError');
      assert.ok(printed.volume() > 0);
      assert.equal(
        printed.rayCast([outerTip - 1, 105, 13], [outerTip - 1, 105, -1])
          .length,
        0,
      );
    } finally {
      printed.delete();
    }
    const map = connectorLayout(params, null, 'side', {
      side: 'outer',
      index: 1,
    });
    assert.ok(Math.abs(map.length - 147) < 1e-6);
    assert.match(map.reason('clip', 0.93), /full-width/);
    assert.throws(
      () => connectorLayout(params, null, 'end', { side: 'outer', index: 2 }),
      /exposed border tip/,
    );
  } finally {
    parts.forEach((x) => x.solid.delete());
  }
});

test('invalid or overlapping finishes fail explicitly and manual connectors cannot hang out of the taper', () => {
  assert.throws(
    () =>
      validateTrack({
        ...p,
        borderEnds: { outer: { finish: end('rounded', 'long', 1.1) } },
      }),
    /tip between/,
  );
  const overlap = {
    ...p,
    borderEnds: {
      outer: {
        start: end('rounded', 'long', 0.4),
        finish: end('rounded', 'long', 0.6),
      },
    },
  };
  assert.throws(() => buildTrack(wasm, overlap), /too little length/);
  const bad = {
    ...p,
    borderEnds: { outer: { finish: end('tapered', 'long', 0.75) } },
    borderSide: 'outer',
    borderMount: 'clips',
    placements: { sideClips: [0.9] },
  };
  assert.throws(() => buildTrack(wasm, bad), /shaped finish/);
});

test('an open imported road accepts a finish and keeps its original road footprint', () => {
  const plan = {
    outlines: [
      [
        [0, -70],
        [420, -70],
        [420, 70],
        [0, 70],
      ],
    ],
    lanes: [
      [
        [0, -30],
        [420, -30],
      ],
      [
        [0, 30],
        [420, 30],
      ],
    ],
  };
  const params = {
    ...p,
    kind: 'import',
    borderSide: 'outer',
    borderEnds: { outer: { finish: end('tapered', 'short', 0.6) } },
  };
  const parts = buildTrack(wasm, params, plan);
  try {
    assert.ok(
      Math.abs(
        parts.find((x) => x.id === 'border-outer-2').solid.boundingBox()
          .max[0] - 252,
      ) < 1e-6,
    );
    assert.ok(
      Math.abs(
        parts.find((x) => x.id === 'road-2').solid.boundingBox().max[0] - 420,
      ) < 1e-6,
    );
  } finally {
    parts.forEach((x) => x.solid.delete());
  }
});
