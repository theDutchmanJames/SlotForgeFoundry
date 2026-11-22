import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { inspectFlatImport } from '../src/drawings/flat-import.js';
import { independentSpans } from '../src/geometry/bridge-sections.js';
import {
  buildTrack,
  chooseSegmentation,
  defaultTrack,
  fitPlate,
} from '../src/track.js';

const wasm = await init();
wasm.setup();

test('two crossings between independent roads retain lane and seam ordering, headroom and dedicated support blocks', () => {
  const params = {
    ...defaultTrack(),
    kind: 'import',
    width: 50,
    lanes: 1,
    joint: 'none',
    borderSide: 'none',
    segments: 1,
    bridgeSupportCount: 2,
    bridgeClearance: 48,
  };
  const lanes = [
    [
      [-750, 0],
      [750, 0],
    ],
    [
      [-300, -550],
      [-300, 450],
      [300, 450],
      [300, -550],
    ],
  ];
  const { flatCrossing, warning } = inspectFlatImport(
    { lanes },
    params.width,
    params,
  );
  assert.ok(flatCrossing, warning);
  assert.equal(flatCrossing.crossings.length, 2);
  for (const c of flatCrossing.crossings) c.upperPass = 'first';
  const saved = JSON.stringify(flatCrossing);
  const expanded = independentSpans(flatCrossing);
  assert.deepEqual(
    expanded.sections.map((s) => s.routeIndex),
    [0, 0, 1, 1],
  );
  for (const first of [0, 2])
    assert.deepEqual(
      expanded.sections[first].lanes[0].at(-1),
      expanded.sections[first + 1].lanes[0][0],
    );
  assert.equal(JSON.stringify(flatCrossing), saved);
  const plan = {
    lanes,
    flatCrossing,
    outlines: flatCrossing.sections.map((s) => s.outlines[0]),
  };
  const parts = buildTrack(wasm, params, plan);
  try {
    const roads = parts.filter((p) => p.role === 'road'),
      supports = parts.filter((p) => p.role === 'support');
    assert.deepEqual(supports.map((p) => p.id).sort(), [
      'support-1-1',
      'support-1-2',
      'support-2-1',
      'support-2-2',
    ]);
    const diagrams = roads
      .filter((p) => p.bridgeDiagram)
      .map((p) => p.bridgeDiagram);
    assert.deepEqual(diagrams.map((d) => d.crossing).sort(), [1, 2]);
    for (const [x, y] of flatCrossing.crossings.map((c) => c.point)) {
      const hits = roads.flatMap((p) =>
        p.solid
          .rayCast([x + 12, y + 12, -1], [x + 12, y + 12, 150])
          .map((h) => h.position[2]),
      );
      assert.ok(hits.some((z) => Math.abs(z - params.height) < 0.001));
      assert.ok(
        hits.some(
          (z) =>
            Math.abs(z - (params.height * 2 + params.bridgeClearance)) < 0.001,
        ),
      );
    }
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});

test('a long crossing offers a printable segment count beyond eight and keeps support blocks whole', () => {
  const params = {
    ...defaultTrack(),
    kind: 'import',
    width: 60,
    lanes: 1,
    joint: 'none',
    borderSide: 'none',
    segments: 1,
    bridgeSupportCount: 2,
    bridgeClearance: 50,
  };
  const lanes = [
    [
      [-1250, 0],
      [1250, 0],
    ],
    [
      [0, -500],
      [0, 500],
    ],
  ];
  const { flatCrossing, warning } = inspectFlatImport(
    { lanes },
    params.width,
    params,
  );
  assert.ok(flatCrossing, warning);
  const plan = {
    lanes,
    flatCrossing,
    outlines: flatCrossing.sections.map((s) => s.outlines[0]),
  };
  const plate = { width: 200, depth: 160, margin: 5 };
  const result = chooseSegmentation(wasm, params, plan, plate, 'road-1');
  assert.ok(result.fits, result.reason);
  assert.ok(result.count > 8 && result.count <= 32);
  const parts = buildTrack(wasm, { ...params, segments: result.count }, plan);
  try {
    assert.ok(parts.some((p) => p.printPose));
    assert.ok(
      parts
        .filter((p) => p.role === 'road')
        .every(
          (p) =>
            fitPlate(p.footprintXY, plate.width, plate.depth, plate.margin)
              .fits,
        ),
    );
    const support = parts.find((p) => p.role === 'support');
    assert.match(
      chooseSegmentation(wasm, params, plan, plate, support.id).reason,
      /one block/,
    );
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});
