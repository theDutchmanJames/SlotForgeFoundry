// Floor textures: joints cut into the top of the base inside the walls and
// into each floor between storeys, the floor's top kept apart so the view
// colours it in its texture's colours, and named in the paint list.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage, validateBuilding } from '../src/geometry/building.js';
import { buildFootprint, validateFootprint } from '../src/geometry/footprint-building.js';
import { buildConnected, validateConnected } from '../src/geometry/connected-building.js';
import { FLOOR_TEXTURES, checkFloor, floorPolygons, jointMarks } from '../src/geometry/building-texture.js';
import { FLOOR_MATERIALS, buildingPaint, checkColours, paintList, partColours, setColours } from '../src/building-colours.js';
import { floorCreases } from '../src/viewport.js';

const wasm = await Module();
wasm.setup();
// Each base or floor part: its marks, its triangles' corners, how much of it there is, and whether it is in one piece.
const floorsOf = (parts) => {
  try {
    return parts
      .filter((p) => ['buildingBase', 'floor'].includes(p.role))
      .map((p) => {
        const mesh = p.solid.getMesh();
        const tri = (t) => [0, 1, 2].map((k) => { const v = mesh.triVerts[t * 3 + k] * mesh.numProp; return [mesh.vertProperties[v], mesh.vertProperties[v + 1], mesh.vertProperties[v + 2]]; });
        return { id: p.id, role: p.role, joints: jointMarks(mesh), tri, volume: p.solid.volume(), pieces: p.solid.decompose().length, top: p.solid.boundingBox().max[2] };
      });
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const count = (marks, m) => marks.reduce((n, x) => n + (x === m), 0);
const GARAGE = { width: 120, depth: 100, upper: [{ height: 50 }] };

test('a floor texture is one of the list; buildings without one are plain', () => {
  assert.deepEqual(FLOOR_TEXTURES.map(([id]) => id), ['plain', 'tiles', 'boards', 'flags', 'slabs', 'brick']);
  assert.equal(checkFloor(), 'plain');
  assert.throws(() => checkFloor('marble'), /floor texture/);
  assert.equal(validateBuilding({}).floorTexture, 'plain');
  assert.equal(validateFootprint({}).floorTexture, 'plain');
  assert.throws(() => validateBuilding({ floorTexture: 'marble' }), /floor texture/);
  assert.throws(() => validateFootprint({ floorTexture: 'marble' }), /floor texture/);
  // Every texture draws joints over a region.
  for (const [id] of FLOOR_TEXTURES.slice(1)) assert.ok(floorPolygons(id, [0, 60], [0, 40], { textureScale: 100, textureJoint: 0.6 }).length > 4, id);
});

test('a plain floor is left as it was', () => {
  for (const f of floorsOf(buildGarage(wasm, GARAGE, null))) assert.equal(f.joints, null, f.id);
});

test('tiles in a garage: cut into the base inside the walls and into the floor above, the top of each kept apart', () => {
  const plain = floorsOf(buildGarage(wasm, GARAGE, null));
  const tiled = floorsOf(buildGarage(wasm, { ...GARAGE, floorTexture: 'tiles' }, null));
  for (const f of tiled) {
    assert.equal(f.joints.surface, 'floor', f.id);
    assert.equal(f.joints.kind, 'tiles', f.id);
    assert.ok(count(f.joints.marks, 3) > 0, f.id + ': the floor top');
    assert.ok(count(f.joints.marks, 4) > 0, f.id + ': its joints');
    assert.equal(f.pieces, 1, f.id + ': in one piece');
    // Only the joints are taken out: no more than their 0.6 mm by 0.5 mm along the grid.
    const lost = plain.find((p) => p.id === f.id).volume - f.volume;
    assert.ok(lost > 100 && lost < 1500, f.id + ' lost ' + lost);
  }
  // The joints of the base keep inside the walls' groove, and go no deeper than the joint depth.
  const base = tiled.find((f) => f.id === 'base');
  const t = 3, c = 0.2;
  base.joints.marks.forEach((m, i) => {
    if (m !== 4) return;
    for (const [x, y, z] of base.tri(i)) {
      assert.ok(x > t + c && x < 120 - t - c && y > t + c && y < 100 - t - c, 'inside the walls: ' + [x, y]);
      assert.ok(z >= base.top - 0.5 - 1e-6, 'no deeper than the joints: ' + z);
    }
  });
});

test('floorboards have a grain; the dividing walls of rooms keep their grooves clear', () => {
  const rooms = floorsOf(buildGarage(wasm, { width: 160, depth: 100, door: 'none', rooms: { along: 'width', sizes: [80, 80] }, floorTexture: 'boards' }, null));
  const base = rooms.find((f) => f.id === 'base');
  assert.ok(count(base.joints.marks, 5) > 0, 'the grain');
  // The divider stands at x = 80 in a groove 3 mm wide with 0.2 mm each side: no joint within 1.5 mm of it.
  base.joints.marks.forEach((m, i) => {
    if (m !== 4 && m !== 5) return;
    for (const [x] of base.tri(i)) assert.ok(Math.abs(x - 80) > 1.5 + 0.2, 'clear of the divider: ' + x);
  });
});

test('a shaped building: its base and each floor between storeys, round a courtyard', () => {
  const parts = floorsOf(buildFootprint(wasm, { shape: 'rectangle', width: 200, depth: 160, courtyards: [{ x: 70, y: 50, width: 60, depth: 60 }], floorTexture: 'flags', upper: [{ height: 50 }] }, null));
  assert.deepEqual(parts.map((p) => p.id).sort(), ['base', 'floor-2']);
  for (const f of parts) {
    assert.equal(f.joints.kind, 'flags', f.id);
    // No joint in the courtyard, nor in the walls round it.
    f.joints.marks.forEach((m, i) => {
      if (m !== 4) return;
      for (const [x, y] of f.tri(i)) assert.ok(!(x > 70 - 3 && x < 130 + 3 && y > 50 - 3 && y < 110 + 3), f.id + ' in the courtyard: ' + [x, y]);
    });
  }
});

test('halls and wings: one floor over all the sections, through the open join between them', () => {
  assert.equal(validateConnected({}).floorTexture, 'plain');
  assert.throws(() => validateConnected({ floorTexture: 'marble' }), /floor texture/);
  assert.equal(floorsOf(buildConnected(wasm, {}, null))[0].joints, null, 'plain as it was');
  // The main hall 220 × 120, the wing 100 × 100 on its back from its left corner: the join runs along y = 120 from x 0 to 100.
  const built = buildConnected(wasm, { floorTexture: 'tiles' }, null);
  // The feet of the walls as they stand in the base, and 1.6 mm round them (the groove's 0.2 mm and the 1.5 mm kept clear, less a hair).
  const near = built.filter((p) => p.role === 'wall').map((p) => p.solid.slice(6 - 1).offset(1.6, 'Miter').toPolygons()).flat();
  const inside = ([x, y], ring) => ring.reduce((odd, [x0, y0], k) => { const [x1, y1] = ring[(k + 1) % ring.length]; return (y0 > y) !== (y1 > y) && x < x0 + ((y - y0) * (x1 - x0)) / (y1 - y0) ? !odd : odd; }, false);
  assert.ok(near.length >= 7, 'every wall standing: ' + near.length);
  const [base] = floorsOf(built);
  assert.equal(base.joints.kind, 'tiles');
  assert.equal(base.pieces, 1);
  let across = false;
  base.joints.marks.forEach((m, i) => {
    if (m !== 4) return;
    for (const [x, y] of base.tri(i)) {
      // Clear of every wall's groove, within the sections.
      assert.ok(!near.some((ring) => inside([x, y], ring)), 'by a wall: ' + [x, y]);
      assert.ok((x > 0 && x < 220 && y > 0 && y < 120) || (x > 0 && x < 100 && y >= 120 && y < 220), 'within the sections: ' + [x, y]);
      if (Math.abs(y - 120) < 1 && x > 10 && x < 90) across = true;
    }
  });
  assert.ok(across, 'the tiles run on through the join');
});

test('the floor is coloured by its texture or a colour of its own, the base round it in its own colour', () => {
  const base = { id: 'base', role: 'buildingBase', joints: { surface: 'floor', kind: 'boards' } };
  const byMaterial = buildingPaint(setColours('material'))(base);
  assert.equal(byMaterial.face, setColours('material').base);
  assert.equal(byMaterial.floor.face, FLOOR_MATERIALS.boards.face);
  assert.equal(byMaterial.floor.joint, FLOOR_MATERIALS.boards.joint);
  // Every set leaves it to its texture.
  assert.equal(buildingPaint(setColours('racing'))(base).floor.face, FLOOR_MATERIALS.boards.face);
  const own = buildingPaint({ ...setColours('material'), set: 'custom', floor: 0x335577 })(base);
  assert.equal(own.floor.face, 0x335577);
  // Brick paving keeps its light mortar in a colour of its own.
  assert.equal(buildingPaint({ ...setColours('material'), set: 'custom', floor: 0x335577 })({ ...base, joints: { surface: 'floor', kind: 'brick' } }).floor.joint, FLOOR_MATERIALS.brick.joint);
  // A plain base has no floor colours; colours kept before floors read as by texture.
  assert.equal(buildingPaint(setColours('material'))({ id: 'base', role: 'buildingBase' }).floor, undefined);
  assert.equal(checkColours({ set: 'custom', walls: 1, roof: 2, trim: 3, doors: 4, base: 5 }).floor, null);
  assert.equal(checkColours({ set: 'custom', floor: 0x123456 }).floor, 0x123456);
});

test('the paint list names the floors with the parts they are on', () => {
  const parts = buildGarage(wasm, { ...GARAGE, floorTexture: 'tiles' }, null);
  const described = parts.map((p) => ({ id: p.id, name: p.name, role: p.role, joints: jointMarks(p.solid.getMesh()) }));
  parts.forEach((p) => p.solid.delete());
  const tints = partColours(setColours('material'), described);
  assert.equal(tints.get('base').surface, 'base');
  assert.equal(tints.get('base').floor.name, 'Floors, square tiles');
  const list = paintList(setColours('material'), described);
  const base = list.findIndex((l) => l.startsWith('- Base and floors'));
  const floors = list.findIndex((l) => l.startsWith('- Floors, square tiles (2 parts): paint them #D8D2C4, then a thin wash of #8C877D'));
  assert.ok(base > 0 && floors > base, list.join('\n'));
});

test('the view draws no edges along a floor’s joints, and keeps the rest', () => {
  // Four corners: triangle 0 is the floor's top (3), triangle 1 a joint (4).
  const part = { positions: new Float32Array(12), indices: [0, 1, 2, 1, 3, 2], joints: { surface: 'floor', marks: Uint8Array.from([3, 4]) } };
  // 1-3 and 3-2 are on the joint only; 0-1 has an end off it.
  assert.deepEqual([...floorCreases(part, Uint16Array.from([0, 1, 1, 3, 3, 2]))], [0, 1]);
  // A wall's joints keep their edges.
  const wall = { ...part, joints: { surface: 'wall', marks: Uint8Array.from([0, 1]) } };
  assert.deepEqual([...floorCreases(wall, Uint16Array.from([1, 3]))], [1, 3]);
});
