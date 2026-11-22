import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildTrack, defaultTrack, nativePath } from '../src/track.js';
import { encodeSTL, parseSTL } from '../src/editor.js';

const wasm = await Module();
wasm.setup();

function checkMouth(solid, p, path, t, entering, label) {
  const [tx, ty] = path.tangent(t);
  const half = p.slotWidth / 2;
  const inner = half + p.braidGap;
  const offsets = [-1, 1].flatMap((sign) => [
    [sign * 0.1 * half, p.slotDepth],
    [sign * 0.98 * half, p.slotDepth],
    ...(p.braidGap ? [[sign * (half + p.braidGap / 2), 0]] : []),
    [sign * (inner + 0.02 * p.braidWidth), p.braidDepth],
    [sign * (inner + 0.47 * p.braidWidth), p.braidDepth],
    [sign * (inner + 0.98 * p.braidWidth), p.braidDepth],
    [sign * (inner + p.braidWidth + 0.2), 0],
  ]);
  for (let lane = 0; lane < p.lanes; lane++) {
    const center = (lane - (p.lanes - 1) / 2) * p.laneSpacing;
    for (const [offset, depth] of offsets) {
      const [x, y] = path.point(t, center + offset);
      const point = (d, z) => [x + entering * d * tx, y + entering * d * ty, z];
      const floor = p.height - depth;
      // A top-down measurement can pass while an almost zero-thickness
      // vertical face still covers the mouth. Enter horizontally from outside.
      for (const fraction of [0.2, 0.8]) {
        if (!depth) continue;
        const z = floor + fraction * depth;
        const hits = solid.rayCast(point(-0.2, z), point(0.2, z));
        assert.equal(
          hits.length,
          0,
          `${label}, lane ${lane + 1} is blocked at ${offset} mm across, Z=${z}`,
        );
      }
      const surface = solid.rayCast(
        point(0.08, p.height + 1),
        point(0.08, -1),
      )[0]?.position[2];
      assert.ok(
        Math.abs(surface - floor) < 0.001,
        `${label}: at ${offset} mm across lane ${lane + 1}, expected Z=${floor}, got ${surface}`,
      );
    }
  }
}

for (const [name, params] of [
  ['straight', { kind: 'straight' }],
  ['default bend', {}],
  [
    'segmented solid bend',
    {
      angle: 47,
      radius: 345,
      width: 110,
      laneSpacing: 50,
      segments: 3,
      slotWidth: 2.8,
      slotDepth: 8,
      braidWidth: 4.2,
      braidDepth: 0.7,
      braidGap: 0.6,
      hollow: false,
    },
  ],
]) {
  test(`guide and braid shelves open through both ends of each ${name} in preview and STL`, () => {
    const p = { ...defaultTrack(), ...params };
    const path = nativePath(p);
    const parts = buildTrack(wasm, p);
    try {
      for (const [i, road] of parts
        .filter((part) => part.role === 'road')
        .entries()) {
        const printed = parseSTL(wasm, encodeSTL(road.solid));
        try {
          for (const [solid, format] of [
            [road.solid, 'preview'],
            [printed, 'STL'],
          ]) {
            for (const end of [0, 1]) {
              checkMouth(
                solid,
                p,
                path,
                (i + end) / p.segments,
                end ? -1 : 1,
                `${format} ${road.id} ${end ? 'finish' : 'start'}`,
              );
            }
          }
        } finally {
          printed.delete();
        }
      }
    } finally {
      parts.forEach((part) => part.solid.delete());
    }
  });
}
