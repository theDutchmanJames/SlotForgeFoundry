// A building's colours beyond the view: kept with it in the Library, given
// to each part in the kit's 3MF, and written out as a paint list.
import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import Module from 'manifold-3d';
import { unzipSync, strFromU8 } from 'fflate';
import { newLibraryDatabase, readBuilding, readBuildings, saveBuilding } from '../src/library-database.js';
import { kit3mf } from '../src/kit-extras.js';
import { buildGarage } from '../src/geometry/building.js';
import { jointMarks } from '../src/geometry/building-texture.js';
import { WALL_MATERIALS, paintList, partColours, setColours } from '../src/building-colours.js';

const SQL = await initSqlJs();
const wasm = await Module();
wasm.setup();
const dbFor = (t) => {
  const db = newLibraryDatabase(SQL, false);
  t.after(() => db.close());
  return db;
};
const partsOf = (building) => {
  const parts = buildGarage(wasm, building, null);
  try {
    return parts.map((p) => ({ id: p.id, name: p.name, role: p.role, joints: jointMarks(p.solid.getMesh()) }));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const BRICK_HUT = { width: 100, depth: 80, door: 'none', wallTexture: 'brick', roof: 'gable', roofTexture: 'tile' };

test('a building is kept in the Library with its colours, and one saved before colours reads as before', (t) => {
  const db = dbFor(t);
  const colours = { ...setColours('yellowbrick'), doors: 0x123456, set: 'custom' };
  const id = saveBuilding(db, { name: 'Hut', building: { width: 120 }, colours, updated: 1 });
  const kept = readBuilding(db, id);
  assert.equal(kept.building.width, 120);
  assert.equal(kept.building.colours, undefined, 'the colours are not a setting of the building');
  assert.deepEqual(kept.colours, colours);
  assert.deepEqual(readBuildings(db)[0].colours, colours);
  // Saved without: no colours, the building as it was.
  const plain = saveBuilding(db, { name: 'Plain', building: {}, updated: 2 });
  assert.equal(readBuilding(db, plain).colours, undefined);
  // Colours gone wrong are put right, not refused.
  const odd = saveBuilding(db, { name: 'Odd', building: {}, colours: { set: 'nope', walls: 'red' }, updated: 3 });
  assert.equal(readBuilding(db, odd).colours.set, 'material');
});

test('each part of a brick hut has its colour and a name for it; the paint list tells how to bring out the mortar', () => {
  const parts = partsOf(BRICK_HUT);
  const tints = partColours(setColours('material'), parts);
  const front = tints.get('front');
  assert.equal(front.name, 'Walls, bricks');
  assert.equal(front.face, WALL_MATERIALS.brick.face);
  assert.equal(front.joint, WALL_MATERIALS.brick.joint);
  assert.equal(tints.get(parts.find((p) => p.role === 'roof').id).name, 'Roof, tiles');
  assert.equal(tints.get(parts.find((p) => p.role === 'buildingBase').id).name, 'Base and floors');
  const list = paintList(setColours('material'), parts);
  assert.equal(list[0], 'Colours (By material)');
  const walls = list.find((l) => l.startsWith('- Walls, bricks'));
  assert.match(walls, /\(4 parts\): paint them #A4533C, then work #CDC6B8 into the joints/);
  assert.ok(list.some((l) => l.startsWith('- Roof, tiles')));
  assert.ok(list.findIndex((l) => l.startsWith('- Walls')) < list.findIndex((l) => l.startsWith('- Roof')), 'walls first, as the panel lists them');
});

test('the kit 3MF gives each coloured part its material; parts without a colour have none', () => {
  const tri = { verts: [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]], tris: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] };
  const parts = [
    { name: 'Front wall', mesh: tri, colour: { name: 'Walls, bricks', face: 0xa4533c } },
    { name: 'Back wall', mesh: tri, colour: { name: 'Walls, bricks', face: 0xa4533c } },
    { name: 'Roof', mesh: tri, colour: { name: 'Roof, tiles', face: 0xa3553b } },
    { name: 'Tyre', mesh: tri },
  ];
  const model = strFromU8(unzipSync(kit3mf('Hut', parts, { width: 200, depth: 200, margin: 0 }).bytes)['3D/3dmodel.model']);
  const bases = [...model.matchAll(/<base name="([^"]+)" displaycolor="([^"]+)"\/>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(bases, [['Walls, bricks', '#A4533CFF'], ['Roof, tiles', '#A3553BFF']]);
  const id = model.match(/<basematerials id="(\d+)">/)[1];
  // No object shares the materials' id.
  assert.ok(!new RegExp(`<object id="${id}"`).test(model));
  const objects = [...model.matchAll(/<object id="\d+" name="([^"]+)" type="model"( pid="(\d+)" pindex="(\d+)")?>/g)].map((m) => [m[1], m[3] ?? null, m[4] ?? null]);
  const by = Object.fromEntries(objects.map(([n, pid, k]) => [n, [pid, k]]));
  assert.deepEqual(by['Front wall'], [id, '0']);
  assert.deepEqual(by['Back wall'], [id, '0']);
  assert.deepEqual(by.Roof, [id, '1']);
  assert.deepEqual(by.Tyre, [null, null]);
  // A kit with no colours has no materials at all, as before.
  const bare = strFromU8(unzipSync(kit3mf('Hut', [{ name: 'Wall', mesh: tri }], { width: 200, depth: 200, margin: 0 }).bytes)['3D/3dmodel.model']);
  assert.ok(!bare.includes('basematerials') && !bare.includes('pid='));
});
