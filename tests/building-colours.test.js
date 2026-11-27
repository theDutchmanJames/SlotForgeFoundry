// A building in its colours: the joints of its textures found in its parts,
// and each part painted by what it is made of or in a set chosen for it.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage } from '../src/geometry/building.js';
import { jointMarks } from '../src/geometry/building-texture.js';
import { COLOUR_SETS, WALL_MATERIALS, ROOF_MATERIALS, buildingPaint, checkColours, setColours, hexText, textHex } from '../src/building-colours.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';

const wasm = await Module();
wasm.setup();
const marked = (building) => {
  const parts = buildGarage(wasm, building, null);
  try {
    return parts.map((p) => ({ id: p.id, role: p.role, joints: jointMarks(p.solid.getMesh()) }));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};

test('the joints of a brick wall and a tiled roof are found in their parts, and nowhere else', () => {
  const parts = marked({ width: 100, depth: 80, door: 'none', wallTexture: 'brick', wallTextures: { back: 'planks' }, roof: 'gable', roofTexture: 'tile' });
  const by = Object.fromEntries(parts.map((p) => [p.id, p]));
  assert.equal(by.front.joints.kind, 'brick');
  assert.equal(by.front.joints.surface, 'wall');
  assert.equal(by.back.joints.kind, 'planks');
  const roof = parts.find((p) => p.role === 'roof');
  assert.equal(roof.joints.kind, 'tile');
  assert.equal(roof.joints.surface, 'roof');
  // Some of a wall is joint, most of it face.
  const m = by.front.joints.marks;
  const joint = m.filter((v) => v === 1).length;
  assert.ok(joint > 0 && joint < m.length);
  // The base has no joints.
  assert.equal(parts.find((p) => p.role === 'buildingBase').joints, null);
});

test('a plain building has no joints to shade', () => {
  for (const p of marked({ width: 80, depth: 60, door: 'none' })) assert.equal(p.joints, null, p.id);
});

test('colours by material: bricks red with light mortar, a tiled roof terracotta, doors and trim their own', () => {
  const paint = buildingPaint(setColours('material'));
  const wall = paint({ role: 'wall', joints: { surface: 'wall', kind: 'brick' } });
  assert.equal(wall.face, WALL_MATERIALS.brick.face);
  assert.equal(wall.joint, WALL_MATERIALS.brick.joint);
  assert.equal(paint({ role: 'roof', joints: { surface: 'roof', kind: 'tile' } }).face, ROOF_MATERIALS.tile.face);
  assert.equal(paint({ role: 'roof' }).face, ROOF_MATERIALS.plain.face);
  assert.equal(paint({ role: 'wall' }).face, WALL_MATERIALS.plain.face);
  assert.equal(paint({ role: 'door' }).face, setColours('material').doors);
  assert.equal(paint({ role: 'frame' }).face, setColours('material').trim);
  assert.equal(paint({ role: 'buildingBase' }).face, setColours('material').base);
  // A prop keeps its role colour.
  assert.equal(paint({ role: 'body' }), null);
});

test('a colour chosen for the walls: mortar stays light round bricks, other joints are a shade of it', () => {
  const paint = buildingPaint({ ...setColours('material'), set: 'custom', walls: 0xc9a86a });
  const brick = paint({ role: 'wall', joints: { surface: 'wall', kind: 'brick' } });
  assert.equal(brick.face, 0xc9a86a);
  assert.equal(brick.joint, WALL_MATERIALS.brick.joint);
  const planks = paint({ role: 'wall', joints: { surface: 'wall', kind: 'planks' } });
  assert.equal(planks.face, 0xc9a86a);
  assert.ok(planks.joint < 0xc9a86a && planks.joint !== WALL_MATERIALS.planks.joint);
});

test('a stepped gable is built of what most walls are', () => {
  const parts = [
    { id: 'front', role: 'wall', joints: { surface: 'wall', kind: 'brick' } },
    { id: 'back', role: 'wall', joints: { surface: 'wall', kind: 'brick' } },
    { id: 'gable-front', role: 'wall' },
  ];
  assert.equal(buildingPaint(setColours('material'), parts)(parts[2]).face, WALL_MATERIALS.brick.face);
});

test('colours as kept are put right; every set gives every surface a colour', () => {
  assert.deepEqual(checkColours(null), setColours('material'));
  assert.equal(checkColours({ set: 'nonsense' }).set, 'material');
  assert.equal(checkColours({ set: 'custom', doors: 'red' }).doors, setColours('material').doors);
  assert.equal(checkColours({ trim: null }).trim, setColours('material').trim, 'only walls and roof follow their textures');
  for (const [id] of COLOUR_SETS) {
    const c = setColours(id);
    for (const key of ['trim', 'doors', 'base']) assert.ok(Number.isInteger(c[key]), id + ' ' + key);
    assert.deepEqual(checkColours(c), c);
  }
  assert.equal(hexText(0x0a0b0c), '#0a0b0c');
  assert.equal(textHex('#A4533C'), 0xa4533c);
  assert.equal(textHex('red'), null);
});

test('textured standard buildings have joints to shade in their walls', () => {
  // A few with textures: their walls have joints to shade.
  for (const id of ['hut-brick', 'timber-cottage', 'canal-house']) {
    const p = BUILDING_PRESETS.find((q) => q.id === id);
    assert.ok(marked(p.building).some((q) => q.joints?.surface === 'wall'), id);
  }
});
