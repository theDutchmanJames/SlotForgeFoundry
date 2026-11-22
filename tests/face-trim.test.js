import { test } from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { applyEdit, encodeSTL, parseSTL } from '../src/editor.js';
import { faceTrimMetrics } from '../src/face-trim.js';
import { toolGuides } from '../src/guide-geometry.js';
import { createEngine } from '../src/engine.js';
import { checkProject, newProject, toBase64 } from '../src/project.js';

const wasm = await init();
wasm.setup();
const top = (z) => ({
  origin: [0, 0, z],
  normal: [0, 0, 1],
  u: [1, 0, 0],
  v: [0, 1, 0],
});
const trim = (frame, amount, trimMode = 'remove') => ({
  type: 'trimFace',
  id: 'trim',
  target: 'body',
  frame,
  amount,
  trimMode,
});
const near = (x, y, eps = 1e-5) =>
  assert.ok(Math.abs(x - y) < eps, x + ' differs from ' + y);
function solids(t) {
  return (s) => {
    t.after(() => s.delete());
    return s;
  };
}

test('trim from a shoulder cuts every boss on the selected part and preserves a through hole', (t) => {
  const own = solids(t);
  const plate = own(wasm.Manifold.cube([20, 16, 8]));
  const cube = own(wasm.Manifold.cube([3, 3, 5]));
  const boss = own(cube.translate([1, 1, 8]));
  const bore = own(wasm.Manifold.cube([2, 2, 15]));
  const drill = own(bore.translate([8, 8, 0]));
  const joined = own(plate.add(boss));
  const stock = own(joined.subtract(drill));
  const result = own(applyEdit(wasm, stock, trim(top(8), 2)));
  near(result.boundingBox().max[2], 6);
  near(result.volume(), (20 * 16 - 4) * 6);
  assert.equal(result.status(), 'NoError');
  near(stock.boundingBox().max[2], 13);
  // A saved top trim follows the current top, even if an earlier operation
  // has since raised the boss. A selected shoulder keeps its own datum.
  const topTrim = own(
    applyEdit(wasm, stock, { ...trim(top(8), 2), reference: 'top' }),
  );
  near(topTrim.boundingBox().max[2], 11);
  const fromBottom = {
    origin: [0, 0, 0],
    normal: [0, 0, -1],
    u: [1, 0, 0],
    v: [0, -1, 0],
  };
  const reversed = own(applyEdit(wasm, stock, trim(fromBottom, 2)));
  near(reversed.boundingBox().min[2], 2);
  near(reversed.boundingBox().max[2], 13);
});

test('oblique finished size uses actual opposing material and draws the same plane through the mesh', (t) => {
  const own = solids(t);
  const angle = (37 * Math.PI) / 180;
  const normal = [Math.sin(angle), 0, Math.cos(angle)];
  const u = [Math.cos(angle), 0, -Math.sin(angle)];
  const offset = [85, -12, -23];
  const cube = own(wasm.Manifold.cube([10, 14, 20]));
  const rotated = own(cube.rotate([0, 37, 0]));
  const stock = own(rotated.translate(offset));
  const frame = {
    origin: offset.map((v, i) => v + 20 * normal[i]),
    normal,
    u,
    v: [0, 1, 0],
  };
  const mesh = stock.getMesh();
  const part = {
    positions: mesh.vertProperties,
    indices: mesh.triVerts,
    bounds: stock.boundingBox(),
  };
  const op = trim(frame, 7.5, 'remaining');
  const metrics = faceTrimMetrics(
    part.positions,
    frame,
    op.trimMode,
    op.amount,
  );
  near(metrics.height, 20);
  near(metrics.removed, 12.5);
  const guides = toolGuides({ mode: 'editor', tab: 'trim', op, part });
  const datum = offset.reduce((a, v, i) => a + v * normal[i], 0);
  for (const id of ['trim-plane', 'cut-contour']) {
    const paths = guides.find((g) => g.id === id).paths;
    assert.ok(paths.length);
    for (const p of paths.flat())
      near(
        p.reduce((a, v, i) => a + v * normal[i], 0),
        datum + 7.5,
      );
  }
  const result = own(applyEdit(wasm, stock, op));
  near(result.volume(), 10 * 14 * 7.5);
  assert.equal(result.status(), 'NoError');
});

test('invalid trims explain lost stock, unreachable finished sizes, and unchanged geometry', (t) => {
  const own = solids(t);
  const cube = own(wasm.Manifold.cube([4, 4, 2]));
  const upper = own(cube.translate([0, 0, 4]));
  const stock = own(cube.add(upper));
  for (const amount of [0, -2, NaN, Infinity])
    assert.throws(
      () => applyEdit(wasm, stock, trim(top(6), amount)),
      /greater than zero/,
    );
  assert.throws(() => applyEdit(wasm, stock, trim(top(6), 6)), /entire part/);
  assert.throws(
    () => applyEdit(wasm, stock, trim(top(6), 7, 'remaining')),
    /removes no material/,
  );
  assert.throws(
    () => applyEdit(wasm, stock, trim(top(6), 3, 'remaining')),
    /gap between shells/,
  );
  const exact = own(applyEdit(wasm, stock, trim(top(6), 2, 'remaining')));
  near(exact.boundingBox().max[2], 2);
  const p = newProject();
  p.editor.ops = [trim(top(6), 1, 'unknown')];
  assert.throws(() => checkProject(p), /measurement type/);
});

test('trimming a joined addition after a rotation keeps the printable portion of the addition', (t) => {
  const own = solids(t);
  const stock = own(wasm.Manifold.cube([12, 10, 8]));
  const p = newProject();
  p.mode = 'editor';
  p.editor = {
    source: { label: 'Box', data: toBase64(encodeSTL(stock)) },
    ops: [
      {
        id: 'boss',
        target: 'body',
        type: 'add',
        frame: top(8),
        depth: 4,
        loops: [
          [
            [2, 2],
            [4, 2],
            [4, 4],
            [2, 4],
          ],
        ],
      },
      {
        id: 'turned',
        target: 'body',
        type: 'transform',
        scale: 1,
        rotate: [0, 0, 37],
        move: [0, 0, 0],
      },
      trim(top(12), 2),
    ],
  };
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  engine.build(p);
  const extra = own(parseSTL(wasm, engine.export({ mode: 'additions' })));
  near(extra.volume(), 2 * 2 * 2);
  near(extra.boundingBox().min[2], 8);
  near(extra.boundingBox().max[2], 10);
});

test('trim previews, saved history, and printable export agree and preserve other parts', (t) => {
  const own = solids(t);
  const stock = own(wasm.Manifold.cube([12, 10, 8]));
  const p = newProject();
  p.mode = 'editor';
  p.editor = {
    source: { label: 'Box', data: toBase64(encodeSTL(stock)) },
    ops: [{ type: 'duplicate', id: 'copy', target: 'body', move: [20, 0, 0] }],
  };
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  engine.build(p);
  const next = JSON.parse(JSON.stringify(p));
  next.editor.ops.push(trim(top(8), 4.5, 'remaining'));
  const draft = engine.preview(next);
  near(draft.find((part) => part.id === 'body').bounds.max[2], 4.5);
  const exportBody = () =>
    own(parseSTL(wasm, engine.export({ mode: 'part', id: 'body' })));
  near(exportBody().boundingBox().max[2], 8);
  const saved = JSON.parse(JSON.stringify(checkProject(next)));
  const committed = engine.build(saved);
  near(committed.find((part) => part.id === 'copy').bounds.max[2], 8);
  near(
    engine.historySource('trim').find((part) => part.id === 'body').bounds
      .max[2],
    8,
  );
  near(exportBody().volume(), 12 * 10 * 4.5);
  assert.throws(
    () => engine.export({ mode: 'additions' }),
    /no added material/,
  );
  const invalid = structuredClone(saved);
  invalid.editor.ops[1].amount = 80;
  assert.throws(() => engine.preview(invalid), /removes no material/);
  near(exportBody().boundingBox().max[2], 4.5);
});
