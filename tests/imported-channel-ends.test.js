import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import init from 'manifold-3d';
import { buildTrack, defaultTrack } from '../src/track.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { parseDrawing } from '../src/imports.js';
import { importedTrackPaths } from '../src/geometry/import-track.js';
import { left, dot, minus, move, unit } from '../src/geometry/solids.js';

const wasm = await init();
wasm.setup();

function roundTripRoad(t, p, plan) {
  const parts = buildTrack(wasm, p, plan);
  t.after(() => parts.forEach((part) => part.solid.delete()));
  return parts
    .filter((part) => part.role === 'road')
    .map(({ solid }) => {
      const printed = parseSTL(wasm, encodeSTL(solid));
      t.after(() => printed.delete());
      return printed;
    });
}

function verifyMouth(road, p, center, previous, edge) {
  const travel = unit(minus(center, previous)),
    across = left(travel);
  const normal = left(unit(minus(edge[1], edge[0])));
  const half = p.slotWidth / 2,
    inner = half + p.braidGap,
    outer = inner + p.braidWidth;
  // Project each strip onto the actual end instead of assuming a square cap.
  for (const offset of [
    0,
    half * 0.8,
    -half * 0.8,
    ...(p.braidGap ? [half + p.braidGap / 2, -half - p.braidGap / 2] : []),
    inner + 0.15,
    -inner - 0.15,
    outer - 0.13,
    -outer + 0.13,
  ]) {
    const p0 = move(center, across, offset);
    const distance = dot(minus(edge[0], p0), normal) / dot(travel, normal);
    const seam = move(p0, travel, distance);
    const depth = Math.abs(offset) < half ? p.slotDepth : Math.abs(offset) < inner ? 0 : p.braidDepth;
    const floor = p.height - depth;
    for (const fraction of depth ? [0.2, 0.72] : []) {
      const z = floor + fraction * (p.height - floor);
      const hits = road.rayCast(
        [...move(seam, travel, 0.05), z],
        [...move(seam, travel, -0.05), z],
      );
      assert.equal(
        hits.length,
        0,
        'obstructed mouth at lateral offset ' + offset + ' and z ' + z,
      );
    }
    const inside = move(seam, travel, -0.07);
    const z = road.rayCast([...inside, p.height + 1], [...inside, -1])[0]
      ?.position[2];
    assert.ok(
      Math.abs(z - floor) < 0.001,
      'unexpected channel floor at ' + offset + ': ' + z,
    );
  }
}

test('braid shelves and guide channels open across the complete end of a real Circuit curve', async (t) => {
  const file = 'circuit-curve-mm.dxf';
  const plan = parseDrawing(
    await readFile(new URL('./drawings/' + file, import.meta.url), 'utf8'),
    file,
  );
  const p = {
    ...defaultTrack(),
    kind: 'import',
    ...plan.inferredWidths,
    segments: 2,
  };
  const roads = roundTripRoad(t, p, plan);
  const { path, p: actual } = importedTrackPaths(p, plan);
  for (const [index, end, prev, station] of [
    [0, 0, 1, 0],
    [1, -1, -2, 1],
  ]) {
    const edge = [-0.5, 0.5].map((s) => path.point(station, s * actual.width));
    for (const lane of plan.lanes)
      verifyMouth(roads[index], p, lane.at(end), lane.at(prev), edge);
  }
});

test('oppositely drawn lanes clear a skew seam even when their endpoints fall slightly inside the road', (t) => {
  const p = { ...defaultTrack(), kind: 'import', braidGap: 0.4 };
  const edge = (end) => [-20, 20].map((y) => [end + y * 0.45, y]);
  const [a, b] = edge(0),
    [d, c] = edge(100);
  const slot = (y) => [
    [y * 0.45 + 0.15, y],
    [100 + y * 0.45 - 0.15, y],
  ];
  const plan = {
    lanes: [slot(-8), slot(8).reverse()],
    outlines: [[a, d, c, b]],
  };
  const [road] = roundTripRoad(t, p, plan);
  for (const line of plan.lanes)
    for (const end of [0, 1])
      verifyMouth(
        road,
        p,
        line[end],
        line[1 - end],
        edge(line[end][0] < 50 ? 0 : 100),
      );
});

test('an open lane in a drawn panel stops at a blind end and clears a skew hole boundary without cutting its opposite bank', (t) => {
  const p = { ...defaultTrack(), kind: 'import', hollow: false };
  const edge = [-19, 19].map((y) => [60 + 0.45 * y, y]);
  const [a, b] = edge,
    onRight = ([x, y]) => [x + 0.12, y];
  const plan = {
    outlines: [
      [
        [0, -25],
        [110, -25],
        [110, 25],
        [0, 25],
      ],
      [a, b, onRight(b), onRight(a)],
    ],
    lanes: [
      [
        [20, 0],
        [60, 0],
      ],
    ],
  };
  const [road] = roundTripRoad(t, p, plan);
  verifyMouth(road, p, [60, 0], [20, 0], edge);
  const height = (x, y) => road.rayCast([x, y, 20], [x, y, -1])[0]?.position[2];
  for (const y of [0, -5, 5]) {
    assert.equal(
      height(19.98, y),
      p.height,
      'blind end should stop at its drawn station',
    );
    assert.equal(
      height(60 + 0.45 * y + 0.19, y),
      p.height,
      'channel should stop at the near bank',
    );
  }
});

test('closed panel lanes remain continuous through the first vertex', (t) => {
  const p = { ...defaultTrack(), kind: 'import' };
  const plan = {
    outlines: [
      [
        [-40, -40],
        [40, -40],
        [40, 40],
        [-40, 40],
      ],
    ],
    lanes: [
      [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
        [-20, -20],
      ],
    ],
  };
  const [road] = roundTripRoad(t, p, plan);
  for (const [x, y, z] of [
    [-20, -20, 5],
    [-19, -19, 5],
    [-17, -17, 11.5],
    [-13, -13, 12],
  ]) {
    const hits = road.rayCast([x, y, 13], [x, y, -1]);
    assert.equal(hits[0]?.position[2], z);
  }
});
