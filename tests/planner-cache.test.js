import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, entrySize, GEOMETRY_ID, readPiece, storePiece } from '../src/planner-cache.js';

test('the cache key follows the recipe and the generator, not the piece name', async () => {
  const track = { params: { kind: 'curve', radius: 500, angle: 30 }, plan: null };
  const plate = { width: 250, depth: 210, margin: 5 };
  const a = await cacheKey([track, plate, true, false]);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await cacheKey([structuredClone(track), { ...plate }, true, false]));
  // Handedness, plate fitting, the plate and the geometry all change the key.
  assert.notEqual(a, await cacheKey([track, plate, true, true]));
  assert.notEqual(a, await cacheKey([track, plate, false, false]));
  assert.notEqual(a, await cacheKey([track, { ...plate, width: 256 }, true, false]));
  assert.notEqual(a, await cacheKey([{ ...track, params: { ...track.params, radius: 501 } }, plate, true, false]));
  assert.equal(typeof GEOMETRY_ID, 'string');
});

test('stored size counts the mesh arrays', () => {
  const value = { meshes: [{ positions: new Float32Array(1000), indices: new Uint32Array(3000) }], sections: [] };
  const size = entrySize(value);
  assert.ok(size >= 4000 + 12000 && size < 4000 + 12000 + 8192, String(size));
});

test('without device storage the cache is simply empty', async () => {
  assert.equal(typeof indexedDB, 'undefined');
  assert.equal(await readPiece('x'), null);
  await storePiece('x', { a: 1 });
});
