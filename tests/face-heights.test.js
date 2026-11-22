import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { checkProject, newProject, toBase64 } from '../src/project.js';
import { SolidWorkshop } from '../src/geometry/solids.js';

const wasm = await init();
wasm.setup();
const heights = [8, 10, 12, 14];
const centres = [5, 13, 21, 29];
const baseZ = 5;
const close = (actual, expected, eps = 1e-4) =>
  assert.ok(
    Math.abs(actual - expected) < eps,
    actual + ' should be ' + expected,
  );

function fixture(t, tilt = 0) {
  const w = new SolidWorkshop(wasm);
  const engine = createEngine(wasm);
  t.after(() => {
    engine.dispose();
    w.close();
  });
  const at = (solid, xyz) => w.own(solid.translate(xyz));
  const floor = at(w.own(wasm.Manifold.cube([34, 12, 1])), [0, 0, baseZ]);
  const wall = at(w.own(wasm.Manifold.cube([34, 1, 18])), [0, 0, baseZ]);
  const ring = (height, radius) =>
    w.own(wasm.Manifold.cylinder(height, radius, radius, 32));
  const posts = heights.map((h, i) => {
    const annulus = w.own(ring(h, 2.5).subtract(ring(h, 1)));
    return at(annulus, [centres[i], 6, baseZ]);
  });
  const body = w.own(w.union([floor, wall, ...posts]).rotate([0, tilt, 0]));
  const p = newProject();
  p.mode = 'editor';
  p.editor.source = {
    label: 'Stepped screw posts',
    data: toBase64(encodeSTL(body)),
  };
  const [mesh] = engine.build(p);
  const c = Math.cos((tilt * Math.PI) / 180),
    s = Math.sin((tilt * Math.PI) / 180);
  const local = ([x, y, z]) => [c * x - s * z, y, s * x + c * z];
  const world = ([x, y, z]) => [c * x + s * z, y, -s * x + c * z];
  const faces = centres.map((x, j) => {
    for (let i = 0; i < mesh.indices.length; i += 3) {
      if (
        mesh.indices.subarray(i, i + 3).every((index) => {
          const [a, b, h] = local(
            mesh.positions.subarray(3 * index, 3 * index + 3),
          );
          return (
            Math.abs(h - baseZ - heights[j]) < 1e-4 &&
            Math.hypot(a - x, b - 6) < 2.501
          );
        })
      ) {
        const { origin, normal, u, v, loops } = engine.pick({
          id: 'body',
          triangle: i / 3,
          tolerance: 1,
        });
        assert.equal(loops.length, 2);
        return { frame: { origin, normal, u, v }, loops };
      }
    }
    throw Error('Missing screw post top in test fixture');
  });
  const read = (mode = 'part', id = 'body') =>
    w.own(parseSTL(wasm, engine.export({ mode, id })));
  const tops = (solid, x, y) =>
    solid
      .rayCast(world([x, y, 40]), world([x, y, -2]))
      .map((hit) => local(hit.position)[2] - baseZ);
  const verify = (expected) => {
    const solid = read();
    centres.forEach((x, i) => {
      close(tops(solid, x + 2, 6.1)[0], expected[i]);
      close(tops(solid, x, 6)[0], 1);
    });
    close(tops(solid, 17, 0.5)[0], 18);
  };
  const op = {
    id: 'posts',
    target: 'body',
    tool: 'move-face',
    type: 'moveFaces',
    faces,
    faceCount: 4,
  };
  return { p, faces, op, engine, read, tops, verify };
}

for (const tilt of [0, 31]) {
  test(
    'different starting planes preserve offsets and meet a common local height on imported STL at ' +
      tilt +
      ' degrees',
    (t) => {
      const { engine, p, op, read, tops, verify } = fixture(t, tilt);
      p.editor.ops = [{ ...op, moveMode: 'offset', value: -2 }];
      engine.build(JSON.parse(JSON.stringify(p)));
      verify([6, 8, 10, 12]);
      assert.throws(
        () => engine.export({ mode: 'additions' }),
        /no added material/,
      );
      p.editor.ops = [{ ...op, moveMode: 'height', value: 12 }];
      const [joined] = engine.build(
        checkProject(JSON.parse(JSON.stringify(p))),
      );
      verify([12, 12, 12, 12]);
      const additions = read('additions');
      close(tops(additions, 7, 6.1)[0], 12);
      close(tops(additions, 7, 6.1)[1], 8);
      close(tops(additions, 15, 6.1)[1], 10);
      assert.equal(tops(additions, 21 + 2, 6.1).length, 0);
      assert.equal(tops(additions, 29 + 2, 6.1).length, 0);
      assert.equal(tops(additions, 5, 6).length, 0);
      const historyInput = engine.historySource('posts')[0];
      assert.ok(historyInput.volume < joined.volume);
      p.editor.ops[0].separate = true;
      assert.throws(() => engine.preview(p), /separate addition/i);
      verify([12, 12, 12, 12]);
      p.editor.ops[0].value = 14;
      const parts = engine.build(p);
      assert.equal(parts[1].role, 'addition');
      verify(heights);
      const attachment = read('part', 'posts');
      close(tops(attachment, 7, 6.1)[1], 8);
      close(tops(attachment, 15, 6.1)[1], 10);
      close(tops(attachment, 23, 6.1)[1], 12);
      assert.equal(tops(attachment, 31, 6.1).length, 0);
    },
  );
}

test('mixed face heights trim prior additions and only export material beyond original stock', (t) => {
  const { engine, p, faces, op, read, tops, verify } = fixture(t);
  const prior = {
    id: 'first',
    target: 'body',
    type: 'add',
    tool: 'move-face',
    profileKind: 'face',
    ...faces[3],
    depth: 3,
  };
  const selected = structuredClone(faces);
  selected[3].frame.origin[2] += 3;
  p.editor.ops = [
    prior,
    { ...op, faces: selected, moveMode: 'height', value: 12 },
  ];
  engine.build(p);
  verify([12, 12, 12, 12]);
  const extra = read('additions');
  assert.equal(tops(extra, 31, 6.1).length, 0);
  close(tops(extra, 7, 6.1)[1], 8);
});

test('an invalid later face aborts the group and preserves the committed model', (t) => {
  const { engine, p, faces, op, verify } = fixture(t);
  const saved = { ...op, moveMode: 'height', value: 11 };
  const attempt = (overrides, pattern) => {
    const trial = structuredClone(p);
    trial.editor.ops = [{ ...saved, ...overrides }];
    assert.throws(() => engine.build(trial), pattern);
    verify(heights);
  };
  const stale = structuredClone(faces);
  stale[3].frame.origin[2] += 0.5;
  attempt({ faces: stale }, /Face 4.*changed/);
  attempt({ faces: stale, value: 14.5 }, /Face 4.*changed/);
  attempt({ value: -2 }, /height|base/i);
  attempt({ moveMode: 'offset', value: -10 }, /base|below/i);
  attempt(
    { faces: [faces[0], faces[0]], faceCount: 2 },
    /overlap|separate|touch/i,
  );
  attempt(
    { faces: [faces[0]], faceCount: 1, value: 8 },
    /already|change|move/i,
  );
  attempt({ faceCount: 3 }, /each selected face/i);
});

test('a shelf above one post blocks raising it and a target in the air below a shelf blocks lowering it', (t) => {
  const { engine, p, op } = fixture(t);
  const rectangle = (w, h) => [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ];
  const shelf = {
    id: 'shelf',
    target: 'body',
    type: 'add',
    frame: {
      origin: [5, 1, baseZ + 10.5],
      normal: [0, 1, 0],
      u: [1, 0, 0],
      v: [0, 0, -1],
    },
    loops: [rectangle(3, 0.5)],
    depth: 8,
  };
  p.editor.ops = [shelf];
  const [before] = engine.build(p);
  const raise = { ...op, moveMode: 'height', value: 12 };
  p.editor.ops.push(raise);
  assert.throws(() => engine.preview(p), /Face 1.*blocks this face/);
  const shelfTop = {
    frame: {
      origin: [5, 6, baseZ + 11],
      normal: [0, 0, 1],
      u: [1, 0, 0],
      v: [0, 1, 0],
    },
    loops: [rectangle(2, 2)],
  };
  p.editor.ops[1] = { ...raise, faces: [shelfTop], faceCount: 1, value: 9 };
  assert.throws(() => engine.preview(p), /empty space under this face/);
  p.editor.ops = [shelf];
  close(engine.build(p)[0].volume, before.volume);
});
