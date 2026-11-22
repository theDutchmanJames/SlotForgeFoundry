import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { unzipSync, strFromU8 } from 'fflate';
import { clipSTLHeader } from '../src/geometry/clip-types.js';
import { clipTypeFromSTL } from '../src/geometry/fork-clip.js';
import originalClip from '../src/geometry/carrera-clip.json' with { type: 'json' };
import { createEngine } from '../src/engine.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { checkProject, newProject, toBase64 } from '../src/project.js';

const wasm = await init();
wasm.setup();
function stock(x = 0) {
  const raw = wasm.Manifold.cube([10, 10, 10]),
    placed = raw.translate([x, 0, 0]);
  try {
    return toBase64(encodeSTL(placed));
  } finally {
    placed.delete();
    raw.delete();
  }
}
const add = {
  id: 'second',
  type: 'addModel',
  name: 'Second.stl',
  data: stock(5),
};
function project(ops) {
  const p = newProject();
  p.mode = 'editor';
  p.editor = { source: { label: 'First.stl', data: stock() }, ops };
  return checkProject(JSON.parse(JSON.stringify(p)));
}
function engine(t) {
  const e = createEngine(wasm);
  t.after(() => e.dispose());
  return e;
}
const combine = (method) => ({
  type: 'combineParts',
  id: 'combine',
  target: 'body',
  tools: ['second'],
  method,
});
const align = (options) => ({
  type: 'alignParts',
  id: 'aligned',
  target: 'second',
  reference: 'body',
  gap: 0,
  ...options,
});
test('appended STL preserves source, position, separate exports and original-stock accounting', (t) => {
  const e = engine(t),
    parts = e.build(project([add]));
  assert.deepEqual(
    parts.map((p) => p.name),
    ['First.stl', 'Second.stl'],
  );
  assert.equal(parts[1].bounds.min[0], 5);
  assert.throws(() => e.export({ mode: 'additions' }), /no added material/);
  const original = e.export({ mode: 'part', id: 'body' });
  assert.throws(() =>
    e.build(project([{ ...add, data: toBase64(new Uint8Array(5)) }])),
  );
  assert.deepEqual(e.export({ mode: 'part', id: 'body' }), original);
  assert.deepEqual(
    e.build(project([])).map((p) => p.id),
    ['body'],
  );
});

test('importing independent stock still works after the previously selected part is consumed', (t) => {
  const e = engine(t);
  const third = { ...add, id: 'third', name: 'Third.stl', data: stock(20) };
  for (const imported of [third, { ...third, target: 'second' }]) {
    assert.deepEqual(
      e.build(project([add, combine('join'), imported])).map((p) => p.id),
      ['body', 'third'],
    );
  }
});

test('clip credit follows only its own stock and derivatives through part and kit export', (t) => {
  const e = engine(t);
  const patch = {
    id: 'raised',
    type: 'add',
    target: 'second',
    depth: 1,
    frame: {
      origin: [10, 5, 10],
      normal: [0, 0, 1],
      u: [1, 0, 0],
      v: [0, 1, 0],
    },
    loops: [
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
    ],
  };
  const model = project([add, patch]);
  model.editor.source.clipType = 'carrera';
  e.build(model);
  assert.equal(
    clipTypeFromSTL(e.export({ mode: 'part', id: 'body' })),
    'carrera',
  );
  assert.equal(
    clipTypeFromSTL(e.export({ mode: 'printPart', id: 'second' })),
    undefined,
  );
  assert.equal(clipTypeFromSTL(e.export({ mode: 'additions' })), undefined);
  const files = unzipSync(e.kit());
  assert.match(strFromU8(files['Clip attribution.txt']), /URSUS/);
  assert.equal(
    clipTypeFromSTL(
      files[Object.keys(files).find((key) => key.endsWith('First.stl.stl'))],
    ),
    'carrera',
  );
  assert.equal(
    clipTypeFromSTL(
      files[Object.keys(files).find((key) => key.endsWith('Second.stl.stl'))],
    ),
    undefined,
  );
  delete model.editor.source.clipType;
  model.editor.ops[0].clipType = 'slotforge';
  model.editor.ops.push(combine('join'));
  e.build(model);
  assert.equal(
    clipTypeFromSTL(e.export({ mode: 'part', id: 'body' })),
    'slotforge',
  );
  const material = parseSTL(wasm, e.export({ mode: 'additions' }));
  try {
    assert.ok(Math.abs(material.volume() - 4) < 1e-8);
  } finally {
    material.delete();
  }
  for (const type of ['slotforge', 'carrera']) {
    const header = clipSTLHeader(type);
    for (const value of [header, header.replace(/ source$/, '')])
      assert.equal(clipTypeFromSTL(new TextEncoder().encode(value)), type);
  }
  const bytes = Buffer.from(originalClip.stl, 'base64');
  assert.equal(clipTypeFromSTL(bytes), 'carrera');
  bytes[bytes.length - 1] ^= 1;
  assert.equal(clipTypeFromSTL(bytes), undefined);
});
for (const [method, expected] of [
  ['join', 1500],
  ['subtract', 500],
  ['intersect', 500],
]) {
  test(
    'assembly ' +
      method +
      ' survives project replay with one printable result and an intact history input',
    (t) => {
      const e = engine(t);
      e.build(project([add]));
      assert.equal(
        e.preview(project([add, combine(method)]))[0].volume,
        expected,
      );
      assert.ok(e.export({ mode: 'part', id: 'second' }));
      const result = e.build(project([add, combine(method)]));
      assert.deepEqual(
        result.map((p) => p.id),
        ['body'],
      );
      assert.equal(result[0].volume, expected);
      assert.equal(e.historySource('combine').length, 2);
      const printed = parseSTL(
        wasm,
        e.export({ mode: 'printPart', id: 'body' }),
      );
      try {
        assert.equal(printed.volume(), expected);
      } finally {
        printed.delete();
      }
      assert.throws(() => e.export({ mode: 'additions' }), /no added material/);
      assert.throws(
        () => project([add, combine(method), align({ alignment: 'centres' })]),
        /missing target/,
      );
    },
  );
}
test('subtracting and intersecting tilted solids preserves empty additions without numerical STL slivers', (t) => {
  const e = engine(t);
  const sphere = wasm.Manifold.sphere(10, 20);
  const cutter = wasm.Manifold.cube([20, 12, 8], true);
  const transform = (id, target, angle) => ({
    id,
    target,
    type: 'transform',
    scale: 1,
    move: [1, 2, 3],
    rotate: [angle * 0.78, 19, 82],
  });
  try {
    const pair = [
      { ...add, data: toBase64(encodeSTL(cutter)) },
      transform('m', 'body', 3 * 12.135),
      transform('t', 'second', 3 * 5.61),
    ];
    for (const method of ['subtract', 'intersect']) {
      const p = project([...pair, combine(method)]);
      p.editor.source.data = toBase64(encodeSTL(sphere));
      e.build(p);
      assert.throws(() => e.export({ mode: 'additions' }), /no added material/);
      p.editor.ops.push(
        { ...add, id: 'third', data: stock(30) },
        { ...combine('join'), id: 'again', tools: ['third'] },
      );
      e.build(p);
      assert.throws(() => e.export({ mode: 'additions' }), /no added material/);
    }
  } finally {
    sphere.delete();
    cutter.delete();
  }
});

test('align centres, stack with an offset and snap opposed faces to the exact picked point', (t) => {
  const e = engine(t);
  const apply = (options) => e.build(project([add, align(options)]))[1].bounds;
  assert.deepEqual(apply({ alignment: 'centres' }), {
    min: [0, 0, 0],
    max: [10, 10, 10],
  });
  assert.deepEqual(apply({ alignment: 'stack', gap: -0.5 }), {
    min: [0, 0, 9.5],
    max: [10, 10, 19.5],
  });
  const op = {
    alignment: 'faces',
    sourceFace: { point: [15, 3, 5], normal: [1, 0, 0] },
    destinationFace: { point: [4, 6, 10], normal: [0, 0, 1] },
    gap: 1,
  };
  assert.deepEqual(apply(op), { min: [-1, 3, 11], max: [9, 13, 21] });
  assert.throws(
    () =>
      apply({
        ...op,
        destinationFace: { ...op.destinationFace, point: [4, 6, 8] },
      }),
    /picked face.*changed/,
  );
  assert.equal(
    e.build(project([add, align({ alignment: 'stack' }), combine('join')]))[0]
      .volume,
    2000,
  );
  assert.throws(
    () =>
      e.preview(
        project([
          add,
          align({ alignment: 'stack', gap: 1 }),
          combine('intersect'),
        ]),
      ),
    /no common volume/,
  );
  assert.throws(
    () =>
      e.preview(
        project([
          add,
          align({ alignment: 'stack', gap: 1 }),
          combine('subtract'),
        ]),
      ),
    /does not overlap/,
  );
});
