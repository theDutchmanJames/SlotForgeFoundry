// Two follow-ups from the review: a planked wall kept clear all over has no joints to cut
// (an empty cut must not empty the wall), and the fit test's outline holds its wall strip.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { TEXTURE_DEFAULTS, wallJoints } from '../src/geometry/building-texture.js';
import { buildFitTest, fitFootprint } from '../src/geometry/fit-test.js';

const wasm = await Module();
wasm.setup();

test('a planked wall kept clear all over gives no cut, not an empty one', () => {
  const temp = [],
    own = (s) => (temp.push(s), s);
  try {
    const geom = { W: 100, D: 60, length: 100, bottom: 0, top: 50 };
    const all = wallJoints(wasm, own, 'front', geom, [[-20, -20, 120, 80]], TEXTURE_DEFAULTS, 'planks');
    assert.ok(all === null || !all.isEmpty(), 'nothing left to cut is no cut');
    // Kept clear only round a window, the planks are still cut.
    const some = wallJoints(wasm, own, 'front', geom, [[40, 20, 60, 40]], TEXTURE_DEFAULTS, 'planks');
    assert.ok(some && some.volume() > 0);
  } finally {
    for (const s of new Set(temp)) s.delete();
  }
});

test('the fit test stands inside its outline, strip and all', () => {
  const parts = buildFitTest(wasm, {});
  try {
    const [x0, y0, x1, y1] = fitFootprint();
    for (const p of parts) {
      const { min, max } = p.solid.boundingBox();
      assert.ok(min[0] >= x0 - 1e-6 && min[1] >= y0 - 1e-6 && max[0] <= x1 + 1e-6 && max[1] <= y1 + 1e-6, p.id + ' inside the outline');
    }
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});
