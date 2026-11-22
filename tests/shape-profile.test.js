import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { shapeOutline } from '../src/geometry/shape-profile.js';
import { applyEdit, encodeSTL, parseSTL } from '../src/editor.js';
import { toolGuides } from '../src/guide-geometry.js';
import { createEngine } from '../src/engine.js';
import { checkProject, newProject, toBase64 } from '../src/project.js';

const wasm = await init();
wasm.setup();
const near = (a, b, tolerance = 1e-5) =>
  assert.ok(Math.abs(a - b) < tolerance, a + ' differs from ' + b);

test('round-ended slots use tip-to-tip length and equal dimensions give a circular hole', () => {
  const shape = shapeOutline('slot', 18, 4);
  const xs = shape.map(([x]) => x);
  const ys = shape.map(([, y]) => y);
  near(Math.max(...xs), 9);
  near(Math.min(...xs), -9);
  near(Math.max(...ys), 2);
  near(Math.min(...ys), -2);
  for (const [x, y] of shape) near(Math.hypot(Math.abs(x) - 7, y), 2);
  assert.deepEqual(shapeOutline('slot', 4, 4), shapeOutline('circle', 4));
  assert.deepEqual(shapeOutline('rectangle', 10, 6), [
    [-5, -3],
    [5, -3],
    [5, 3],
    [-5, 3],
  ]);
  for (const bad of [
    [0, 0],
    [-4, 2],
    [8, 0],
    [4, 5],
    [NaN, 1],
    [Infinity, 2],
  ])
    assert.throws(() => shapeOutline('slot', ...bad), /length/);
});

test('the rotated slot guide, through cut and separate printable addition share one outline', (t) => {
  const own = (solid) => {
    t.after(() => solid.delete());
    return solid;
  };
  const stock = own(wasm.Manifold.cube([30, 40, 5]));
  const slot = {
    id: 'slot',
    type: 'cut',
    target: 'body',
    profileKind: 'slot',
    shapeWidth: 18,
    shapeHeight: 4,
    loops: [shapeOutline('slot', 18, 4)],
    frame: {
      origin: [15, 20, 5],
      normal: [0, 0, 1],
      u: [1, 0, 0],
      v: [0, 1, 0],
    },
    rotation: 90,
    offset: [2, -3],
    extent: 'through',
  };
  const bounds = stock.boundingBox();
  const guides = toolGuides({
    mode: 'editor',
    tab: 'cut-shape',
    op: slot,
    part: { bounds },
  });
  const [profile] = guides.find((g) => g.id === 'profile-base').paths;
  const xs = profile.map((p) => p[0]),
    ys = profile.map((p) => p[1]);
  near(Math.min(...xs), 15);
  near(Math.max(...xs), 19);
  near(Math.min(...ys), 8);
  near(Math.max(...ys), 26);
  const cut = own(applyEdit(wasm, stock, slot));
  const polygonArea = 14 * 4 + 30 * 2 ** 2 * Math.sin((2 * Math.PI) / 60);
  near(stock.volume() - cut.volume(), 5 * polygonArea);
  const add = { ...slot, type: 'add', depth: 2, separate: true };
  delete add.extent;
  const p = newProject();
  p.mode = 'editor';
  p.editor = {
    source: { label: 'Mount', data: toBase64(encodeSTL(stock)) },
    ops: [add],
  };
  const saved = JSON.parse(JSON.stringify(p));
  assert.deepEqual(checkProject(saved), p);
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const parts = engine.build(saved);
  assert.equal(parts.length, 2);
  const separate = own(
    parseSTL(wasm, engine.export({ mode: 'part', id: 'slot' })),
  );
  near(separate.volume(), 2 * polygonArea);
  near(separate.boundingBox().min[0], 15);
  near(separate.boundingBox().max[1], 26);
  saved.editor.ops[0].shapeWidth = 3;
  assert.throws(() => checkProject(saved), /at least its width/);
});
