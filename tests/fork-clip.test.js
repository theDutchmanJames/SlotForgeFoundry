import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import init from 'manifold-3d';
import original from '../src/geometry/carrera-clip.json' with { type: 'json' };
import { parseSTL } from '../src/editor.js';
import { buildTrack, defaultTrack } from '../src/track.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { withPrintableSolid } from '../src/geometry/joints.js';

const wasm = await init();
wasm.setup();

function near(actual, expected, epsilon = 1e-5) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${actual} should be ${expected}`,
  );
}

function seam(t, clipType, clipClearance = 0.15, overrides = {}) {
  const p = {
    ...defaultTrack(),
    kind: 'straight',
    length: 240,
    segments: 2,
    clipType,
    clipClearance,
    joint: 'clips',
    jointStart: 'none',
    jointEnd: 'none',
    placements: { seamClips: [0] },
    ...overrides,
  };
  const parts = buildTrack(wasm, p);
  t.after(() => parts.forEach((part) => part.solid.delete()));
  return parts;
}

test('Carrera exports use the original clip under a rigid orientation change', (t) => {
  const bytes = Buffer.from(original.stl, 'base64');
  // Digest measured from the author's supplied clip.stl, before conversion.
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '0c66c8766509d8f83f406d1e3645358680c16e3f9ad0a8a8a811511a4fb41e50',
  );
  const work = new SolidWorkshop(wasm);
  t.after(() => work.close());
  const input = work.own(parseSTL(wasm, bytes));
  const flat = work.own(input.rotate([-90, 0, 0]));
  const reference = work.own(flat.translate([0, -10, 4.5]));
  const [, , clip] = seam(t, 'carrera');
  withPrintableSolid(
    clip,
    (print) => {
      near(print.volume(), reference.volume());
      near(work.own(print.subtract(reference)).volume(), 0);
      near(work.own(reference.subtract(print)).volume(), 0);
      assert.equal(print.numTri(), 388);
      const { min, max } = print.boundingBox();
      near(min[2], 0);
      near(max[0] - min[0], 60);
      near(max[1] - min[1], 14.8);
      near(max[2], 4.5);
    },
    { sideDown: true },
  );
});

test('Carrera fork tips enter from underneath without a retaining lip at every supported clearance', (t) => {
  const work = new SolidWorkshop(wasm);
  t.after(() => work.close());
  for (const gap of [0.03, 0.15, 0.4]) {
    const [a, b, clip] = seam(t, 'carrera-retained', gap);
    for (const [half, sx] of [
      [a.solid, -1],
      [b.solid, 1],
    ]) {
      near(half.boundingBox().min[2], 0);
      near(work.and(clip.solid, half).volume(), 0);
      const tips = work.own(clip.solid.trimByPlane([sx, 0, 0], 22));
      const approach = work.prism(
        work.own(tips.project()),
        0,
        clip.solid.boundingBox().max[2],
      );
      assert.ok(approach.volume() > 100);
      near(work.and(approach, half).volume(), 0);
    }
  }
});

test('the project clip selection controls road seams, road-to-border and border-end joints together', (t) => {
  for (const type of ['draw-key', 'carrera-retained']) {
    const parts = seam(t, type, 0.15, {
      length: 400,
      segments: 2,
      borderSide: 'outer',
      borderSegments: 2,
      borderMount: 'clips',
      borderJoint: 'clips',
      borderEntry: 80,
      borderApex: 80,
      borderExit: 80,
    });
    const clips = parts.filter((part) => part.role === 'clip');
    assert.ok(clips.some(({ id }) => id.startsWith('road-clip')));
    assert.ok(clips.some(({ id }) => id.startsWith('side-clip')));
    assert.ok(clips.some(({ id }) => id.startsWith('end-clip')));
    assert.ok(clips.every((part) => part.clipType === type));
    assert.equal(new Set(clips.map((part) => part.fabricationKey)).size, 1);
  }
});
