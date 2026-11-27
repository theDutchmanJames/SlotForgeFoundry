// A building placed in a layout keeps the colours it was saved with, and
// its parts carry them into the Track Planner's 3D view.
import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutBuilding, placeParts, validateBuildings } from '../src/planner-buildings.js';
import { WALL_MATERIALS, setColours } from '../src/building-colours.js';

const saved = (colours) => ({ id: 'lib-1', name: 'Hut', building: { width: 100, depth: 80, door: 'none' }, ...(colours && { colours }) });
const pose = { x: 0, y: 0, a: 0 };
const part = (id, role, joints = null) => ({ id, role, joints, positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), indices: new Uint32Array([0, 1, 2]) });

test('a building placed from the Library keeps its colours in the layout', () => {
  const colours = { ...setColours('whitewash'), doors: 0x112233, set: 'custom' };
  const entry = layoutBuilding(saved(colours), pose, 'b-1');
  assert.deepEqual(entry.colours, colours);
  validateBuildings([entry]);
  // One saved without colours has none, as before.
  const plain = layoutBuilding(saved(null), pose, 'b-2');
  assert.equal('colours' in plain, false);
  validateBuildings([plain]);
  // Colours that are not a set of colours make the layout file faulty.
  for (const bad of [null, 'red', [1, 2]]) assert.throws(() => validateBuildings([{ ...plain, colours: bad }]), /Invalid building/);
});

test('each placed part carries its colour: by material without colours of its own, or the colours chosen', () => {
  const parts = [part('front', 'wall', { surface: 'wall', kind: 'brick', marks: new Uint8Array(1) }), part('door', 'door'), part('tyre', 'body')];
  const plain = placeParts(parts, layoutBuilding(saved(null), pose, 'b-1'));
  assert.equal(plain[0].id, 'b-1/front');
  assert.equal(plain[0].tint.face, WALL_MATERIALS.brick.face);
  assert.equal(plain[0].tint.joint, WALL_MATERIALS.brick.joint);
  assert.equal(plain[1].tint.face, setColours('material').doors);
  assert.equal(plain[2].tint, null, 'a prop keeps the colour of its role');
  const chosen = placeParts(parts, layoutBuilding(saved({ ...setColours('material'), set: 'custom', walls: 0x445566, doors: 0x112233 }), pose, 'b-2'));
  assert.equal(chosen[0].tint.face, 0x445566);
  assert.equal(chosen[1].tint.face, 0x112233);
});
