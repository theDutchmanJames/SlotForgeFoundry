import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import init from 'manifold-3d';
import { parseSTL } from '../src/editor.js';
import { createEngine } from '../src/engine.js';
import { newProject } from '../src/project.js';

const wasm = await init();
wasm.setup();

function checkPrintPose(bytes) {
  const part = parseSTL(wasm, bytes);
  try {
    const { min, max } = part.boundingBox();
    assert.ok(Math.abs(min[2]) < 0.0001, 'Placed on the print bed');
    assert.ok(Math.abs(min[0] + max[0]) < 0.0001, 'Centred on X');
    assert.ok(Math.abs(min[1] + max[1]) < 0.0001, 'Centred on Y');
    return max[2];
  } finally {
    part.delete();
  }
}

test('border print export includes every segment as an individual STL, with physical grooves and a flat bed pose', (t) => {
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const project = newProject();
  Object.assign(project.track.params, {
    kind: 'straight',
    length: 120,
    borderSide: 'both',
    borderSegments: 3,
    whiteLineBorder: 'outer',
    kerbEdge: 'free',
    kerbSide: 'inner',
  });
  const parts = engine.build(project);
  const flat = unzipSync(engine.borderSTLs());
  const ids = parts
    .filter((part) => part.role === 'border')
    .map((part) => part.id);
  assert.equal(ids.length, 6);
  assert.deepEqual(
    Object.keys(flat).sort(),
    ids.map((id) => id + '.stl').sort(),
  );
  Object.assign(project.track.params, {
    borderLineGroove: true,
    kerbGroove: true,
  });
  engine.build(project);
  const grooved = unzipSync(engine.borderSTLs());
  const kit = unzipSync(engine.kit());
  assert.deepEqual(
    Object.keys(kit).filter((name) => name.endsWith('.svg')),
    ['assembly.svg'],
  );
  for (const id of ids) {
    const name = id + '.stl';
    const bytes = grooved[name];
    assert.ok(bytes, name);
    assert.notDeepEqual(
      bytes,
      flat[name],
      'White line or kerb grooves change the printable mesh',
    );
    assert.deepEqual(engine.export({ mode: 'printPart', id }), bytes);
    assert.ok(
      Object.values(kit).some((data) => Buffer.from(data).equals(bytes)),
    );
    assert.equal(checkPrintPose(bytes), 12);
  }
  project.track.params.borderSide = 'none';
  engine.build(project);
  assert.throws(() => engine.borderSTLs(), /add a border/i);
});

test('single-clip STL uses the kit print orientation and preserves designer credit', (t) => {
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const project = newProject();
  Object.assign(project.track.params, {
    joint: 'clips',
    clipType: 'carrera-retained',
    segments: 2,
    borderSide: 'none',
  });
  const items = engine.build(project);
  const clip = items.find((part) => part.role === 'clip');
  assert.ok(clip);
  const bytes = engine.export({ mode: 'printPart', id: clip.id });
  const kit = unzipSync(engine.kit());
  assert.deepEqual(
    bytes,
    Object.entries(kit).find(([name]) => name.startsWith('parts/C'))[1],
  );
  assert.match(Buffer.from(bytes.subarray(0, 80)).toString(), /URSUS/);
  checkPrintPose(bytes);
});

test('an edited STL prints on the bed while the part transfer keeps its project placement', (t) => {
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const project = newProject();
  project.mode = 'editor';
  project.editor.ops = [
    {
      id: 'offset',
      target: 'body',
      type: 'transform',
      move: [27, -13, 8],
      rotate: [0, 0, 0],
      scale: 1,
    },
  ];
  engine.build(project);
  const printed = engine.export({ mode: 'printPart', id: 'body' });
  assert.equal(checkPrintPose(printed), 16);
  const transferred = parseSTL(
    wasm,
    engine.export({ mode: 'part', id: 'body' }),
  );
  try {
    assert.equal(transferred.boundingBox().min[2], 8);
  } finally {
    transferred.delete();
  }
});
