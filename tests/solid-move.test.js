import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectMoveAxes,
  draggedSolidOffset,
  solidMoveTarget,
} from '../src/solid-move.js';
import { workplane } from '../src/design.js';

test('face-mounted solids translate in their own plane and cut extends into it', () => {
  const frame = workplane('xz');
  const op = {
    id: 'box',
    kind: 'primitive',
    shape: 'box',
    height: 12,
    result: 'new',
    frame,
    x: 2,
    y: 3,
    z: 4,
  };
  const ctx = {
    mode: 'editor',
    tab: 'primitive',
    op,
    shownMoveOp: { ...op, x: 1, y: 1, z: 1 },
    rigidMoveAllowed: true,
  };
  const result = solidMoveTarget(ctx);
  assert.deepEqual(result.anchor, [2, -16, 3]);
  assert.deepEqual(result.translated, [1, -3, 2]);
  const cut = solidMoveTarget({ ...ctx, op: { ...op, result: 'cut' } });
  assert.deepEqual(cut.anchor, [2, 8, 3]);
  assert.equal(cut.body, undefined);
});
test('whole parts translate relative to their input centre and the last drawn position', () => {
  const ctx = {
    mode: 'editor',
    tab: 'transform',
    part: { bounds: { min: [-12, 1, 0], max: [24, 5, 10] } },
    op: { id: 'move', target: 'box', move: [8, 2, 3] },
    rigidMoveAllowed: true,
  };
  assert.deepEqual(solidMoveTarget(ctx).anchor, [14, 5, 8]);
  assert.deepEqual(solidMoveTarget(ctx).translated, [8, 2, 3]);
  assert.deepEqual(
    solidMoveTarget({ ...ctx, shownMoveOp: { ...ctx.op, move: [2, 1, 4] } })
      .translated,
    [6, 1, -1],
  );
  assert.equal(
    solidMoveTarget({ ...ctx, rigidMoveAllowed: false }).translated,
    null,
  );
});
test('pointer displacement maps to the plane or a single axis; end-on controls remain separate', () => {
  const frame = workplane('xy'),
    anchor = [0, 0, 0];
  const p = projectMoveAxes(([x, y, z]) => ({ x: 2 * x + y, y: y - z }), {
    frame,
    anchor,
  });
  assert.deepEqual(draggedSolidOffset([1, 2, 3], 'plane', p, 8, 4), [3, 6, 3]);
  assert.deepEqual(draggedSolidOffset([1, 2, 3], 1, p, 5, 5), [1, 7, 3]);
  assert.deepEqual(
    draggedSolidOffset([1.123456, 2, 3.654321], 1, p, 5, 5),
    [1.123456, 7, 3.654321],
  );
  const edge = projectMoveAxes(([x, y, z]) => ({ x: 2 * x, y: -2 * z }), {
    frame,
    anchor,
  });
  assert.deepEqual(
    draggedSolidOffset([0, 0, 0], 'plane', edge, 8, 10),
    [4, 0, 0],
  );
  const [u, v] = edge.axis[1];
  assert.deepEqual(
    draggedSolidOffset([0, 0, 0], 1, edge, u * 6, v * 6),
    [0, 6, 0],
  );
});
