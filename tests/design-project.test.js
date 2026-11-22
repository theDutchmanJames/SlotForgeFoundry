import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { newProject, checkProject } from '../src/project.js';
import { createEngine } from '../src/engine.js';
import { defaultHolePlacement } from '../src/geometry/feature-selection.js';
import { workplane } from '../src/design.js';
import { parseSTL } from '../src/editor.js';

const wasm = await init();
wasm.setup();
const fixture = () => ({
  ...newProject(),
  mode: 'editor',
  editor: { source: { label: 'Blank', empty: true }, ops: [] },
});
test('saved sketches preserve the whole construction grid and still accept files made before grids', () => {
  const p = fixture();
  const sketch = {
    id: 'plate',
    type: 'sketch',
    name: 'Plate',
    plane: 'xy',
    offset: 0,
    frame: workplane('xy'),
    sketch: {
      entities: [{ type: 'rectangle', x: 0, y: 0, width: 30, height: 20 }],
    },
  };
  p.editor.ops.push(sketch);
  function reload() {
    return checkProject(JSON.parse(JSON.stringify(p))).editor.ops[0];
  }
  assert.deepEqual(reload(), sketch);
  const grid = {
    pitch: 2.5,
    placement: 'custom',
    origin: [-3.25, 1.125],
    angle: -31,
    snap: false,
    visible: false,
  };
  sketch.grid = grid;
  assert.deepEqual(reload().grid, grid);
  for (const invalid of [
    null,
    { ...grid, pitch: 0 },
    { ...grid, placement: 'other' },
    { ...grid, origin: [1, null] },
    { ...grid, angle: null },
    { ...grid, visible: 0 },
    { ...grid, snap: 'yes' },
  ]) {
    sketch.grid = invalid;
    assert.throws(reload, /grid/);
  }
});
test('empty designs and sketch-only documents save and reload without resurrecting the example enclosure', (t) => {
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const p = fixture();
  const example = { ...newProject(), mode: 'editor' };
  assert.equal(engine.build(example).length, 1);
  assert.deepEqual(engine.build(p), []);
  assert.throws(() => engine.export({ mode: 'assembly' }), /solid/);
  const sketch = {
    id: 'outline',
    type: 'sketch',
    name: 'Plate',
    label: 'Plate',
    plane: 'xy',
    offset: 0,
    frame: workplane('xy'),
    sketch: {
      entities: [{ type: 'rectangle', x: 0, y: 0, width: 70, height: 30 }],
    },
  };
  p.editor.ops = [sketch];
  assert.deepEqual(engine.build(JSON.parse(JSON.stringify(p))), []);
  const solid = {
    type: 'createSolid',
    kind: 'extrude',
    id: 'base',
    label: 'Plate',
    result: 'new',
    sketchId: 'outline',
    distance: 4,
    direction: 'auto',
  };
  p.editor.ops.push(solid);
  assert.equal(engine.build(p)[0].volume, 8400);
  assert.deepEqual(engine.historySource('base'), []);
  p.editor.ops.reverse();
  assert.throws(() => checkProject(p), /before/);
  p.editor.ops = [
    { type: 'simplify', id: 'wrong', target: 'body', deviation: 1 },
  ];
  assert.throws(() => checkProject(p), /missing target/);
  assert.equal(engine.build(example).length, 1);
});
test('a face-hosted drawing follows its mounting face when an upstream solid changes height', (t) => {
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const p = fixture(),
    box = {
      id: 'block',
      label: 'Block',
      type: 'createSolid',
      kind: 'primitive',
      shape: 'box',
      width: 40,
      length: 30,
      height: 10,
      result: 'new',
    };
  p.editor.ops.push(box);
  const [part] = engine.build(p);
  const coords = (i) => part.positions.slice(3 * i, 3 * i + 3);
  let tri = 0;
  while (
    tri < part.indices.length / 3 &&
    ![0, 1, 2].every((j) => coords(part.indices[3 * tri + j])[2] === 10)
  )
    tri++;
  const face = engine.pick({
    id: 'block',
    triangle: tri,
    point: [0, 0, 10],
    tolerance: 1,
  });
  face.seed = { triangle: tri, point: [0, 0, 10] };
  const attachment = { ...defaultHolePlacement(face, part), partId: 'block' };
  const frame = { ...workplane('xy'), origin: [0, 0, 10] };
  const sketch = {
    type: 'sketch',
    id: 'lettering-base',
    name: 'Boss footprint',
    label: 'Boss footprint',
    plane: 'face',
    offset: 0,
    frame,
    attachment,
    sketch: {
      entities: [{ type: 'rectangle', x: -3, y: -2, width: 6, height: 4 }],
    },
  };
  p.editor.ops.push(sketch, {
    type: 'createSolid',
    id: 'boss',
    target: 'block',
    result: 'join',
    kind: 'extrude',
    label: 'Raise boss',
    direction: 'forward',
    distance: 3,
    sketchId: sketch.id,
  });
  assert.equal(engine.build(p)[0].bounds.max[2], 13);
  box.height = 16;
  assert.equal(engine.build(structuredClone(p))[0].bounds.max[2], 19);
  assert.equal(engine.sketchPlacements()[0][1].origin[2], 16);
  const printed = parseSTL(wasm, engine.export({ mode: 'part', id: 'block' }));
  try {
    assert.equal(printed.volume(), 40 * 30 * 16 + 6 * 4 * 3);
  } finally {
    printed.delete();
  }
});
