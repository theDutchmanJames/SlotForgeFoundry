// A band along the foot of the walls in its own colours: found in the
// joints of each wall with how high it reaches, painted by its texture or
// a colour chosen for it, and listed for painting.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage } from '../src/geometry/building.js';
import { jointMarks } from '../src/geometry/building-texture.js';
import { COLOUR_SETS, WALL_MATERIALS, buildingPaint, checkColours, paintList, partColours, setColours } from '../src/building-colours.js';

const wasm = await Module();
wasm.setup();
const partsOf = (building) => {
  const parts = buildGarage(wasm, building, null);
  try {
    return parts.map((p) => ({ id: p.id, name: p.name, role: p.role, joints: jointMarks(p.solid.getMesh()), z: p.solid.boundingBox().min[2] }));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const BANDED = { width: 100, depth: 80, door: 'none', wallTexture: 'brick', lowerTexture: 'stone', lowerHeight: 20 };

test('a wall with a stone band under bricks: the bricks are its texture, the band reaches up 20 mm from the floor', () => {
  const parts = partsOf(BANDED);
  const front = parts.find((p) => p.id === 'front');
  assert.equal(front.joints.kind, 'brick');
  assert.equal(front.joints.band.kind, 'stone');
  // The wall stands 2 mm down in the groove of a 10 mm base: its floor at 10, the band up to 30.
  assert.equal(front.joints.band.below, 30);
  // A wall without a band has none.
  assert.equal(partsOf({ ...BANDED, lowerTexture: 'none' }).find((p) => p.id === 'front').joints.band, undefined);
  // A plain wall over a band of blocks: plain above, the blocks below.
  const plain = partsOf({ ...BANDED, wallTexture: 'plain', lowerTexture: 'block' }).find((p) => p.id === 'front');
  assert.equal(plain.joints.kind, 'plain');
  assert.equal(plain.joints.band.kind, 'block');
});

test('the band is painted by its texture, in every set, or in a colour chosen for it', () => {
  const wall = { id: 'front', role: 'wall', joints: { surface: 'wall', kind: 'brick', band: { kind: 'stone', below: 30 } } };
  const byMaterial = buildingPaint(setColours('material'))(wall);
  assert.equal(byMaterial.face, WALL_MATERIALS.brick.face);
  assert.equal(byMaterial.lower.face, WALL_MATERIALS.stone.face);
  assert.equal(byMaterial.lower.joint, WALL_MATERIALS.stone.joint);
  assert.equal(byMaterial.lower.below, 30);
  // A set colours the walls; the band keeps its texture's colour.
  const team = buildingPaint(setColours('racing'))(wall);
  assert.equal(team.face, setColours('racing').walls);
  assert.equal(team.lower.face, WALL_MATERIALS.stone.face);
  // A colour of its own: the stone's mortar stays light.
  const own = buildingPaint({ ...setColours('material'), set: 'custom', band: 0x555555 })(wall);
  assert.equal(own.lower.face, 0x555555);
  assert.equal(own.lower.joint, WALL_MATERIALS.stone.joint);
  // A wall without a band has no lower colours.
  assert.equal(buildingPaint(setColours('material'))({ ...wall, joints: { surface: 'wall', kind: 'brick' } }).lower, undefined);
});

test('every set leaves the band to its texture; colours kept before the band read the same', () => {
  for (const [id] of COLOUR_SETS) assert.equal(setColours(id).band, null, id);
  const before = { set: 'custom', walls: 0x112233, roof: null, trim: 1, doors: 2, base: 3 };
  assert.equal(checkColours(before).band, null);
  assert.equal(checkColours(before).walls, 0x112233);
  assert.equal(checkColours({ ...before, band: 0x445566 }).band, 0x445566);
});

test('the paint list names the band with the parts it runs along', () => {
  const parts = partsOf(BANDED);
  const tints = partColours(setColours('material'), parts);
  assert.equal(tints.get('front').band.name, 'Lower walls, stone');
  const list = paintList(setColours('material'), parts);
  const walls = list.findIndex((l) => l.startsWith('- Walls, bricks (4 parts)'));
  const band = list.findIndex((l) => l.startsWith('- Lower walls, stone (4 parts): paint them #A59C8B, then work #D2CCC0 into the joints'));
  assert.ok(walls > 0 && band === walls + 1, list.join('\n'));
});
