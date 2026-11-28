// The rally kinds: a timing caravan, a dry-stone wall with its gate, a forest
// hunting tower. Each is checked, builds in parts that print without
// supports, none sharing material with another, stands where its footprint
// says, and has the notes of its kit.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage, buildingLayout, printPose, validateBuilding } from '../src/geometry/building.js';
import { RALLY_KINDS } from '../src/geometry/rally-kinds.js';
import { jointMarks } from '../src/geometry/building-texture.js';
import { HUNTING_TOWER } from '../src/geometry/hunting-tower.js';
import { STONE_WALL, stoneWallPlan } from '../src/geometry/stone-wall.js';
import { CARAVAN } from '../src/geometry/timing-caravan.js';
import { ARCH_HOUSE } from '../src/geometry/arch-house.js';
import { TUNNEL_PORTAL } from '../src/geometry/tunnel-portal.js';
import { ROCK_GALLERY } from '../src/geometry/rock-gallery.js';
import { LEVEL_CROSSING } from '../src/geometry/level-crossing.js';
import { kitNotes } from '../src/building-kit.js';
import { footprint } from '../src/planner-buildings.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 220, depth: 220, margin: 5 };
// The parts as built, what is known of each, and the solids freed after.
// With `road` [x0, y0, x1, y1, z]: the parts that reach into that box, as built.
function built(input, plate = PLATE, road = null) {
  const parts = buildGarage(wasm, input, plate);
  try {
    const inTheWay = [];
    if (road) {
      const [x0, y0, x1, y1, z] = road;
      const room = wasm.Manifold.cube([x1 - x0, y1 - y0, z + 1]).translate([x0, y0, -1]);
      for (const p of parts) {
        const both = p.solid.intersect(room);
        if (both.volume() > 0.01) inTheWay.push(p.id);
        both.delete();
      }
      room.delete();
    }
    const pose = (p) => {
      const s = printPose(p);
      const b = s.boundingBox();
      s.delete();
      return [0, 1, 2].map((i) => b.max[i] - b.min[i]);
    };
    const overlaps = [];
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const both = parts[i].solid.intersect(parts[j].solid);
        if (both.volume() > 0.01) overlaps.push(parts[i].id + ' and ' + parts[j].id);
        both.delete();
      }
    return {
      overlaps,
      inTheWay,
      parts: parts.map((p) => ({ id: p.id, name: p.name, role: p.role, bodies: p.solid.decompose().length, box: p.solid.boundingBox(), printed: pose(p), joints: jointMarks(p.solid.getMesh()) })),
    };
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
}
const of = (r, id) => r.parts.find((p) => p.id === id);

test('each rally kind is checked: its own settings only, each within its limits', () => {
  for (const kind of Object.keys(RALLY_KINDS)) {
    assert.equal(validateBuilding({ kind }).kind, kind);
    assert.throws(() => validateBuilding({ kind, colour: 'red' }), /unknown setting/, kind);
  }
  assert.throws(() => validateBuilding({ kind: 'caravan', length: 40 }), /Length must be between 70 and 140/);
  assert.throws(() => validateBuilding({ kind: 'caravan', text: 'TIMING ~' }), /no letter/);
  assert.throws(() => validateBuilding({ kind: 'stonewall', gate: 'left' }), /gate in the middle/);
  assert.throws(() => validateBuilding({ kind: 'stonewall', length: 80, gateWidth: 60 }), /too short for its gate/);
  assert.throws(() => validateBuilding({ kind: 'huntingtower', splay: 40 }), /Spread of the legs/);
  assert.throws(() => validateBuilding({ kind: 'huntingtower', ladder: 'yes' }), /ladder/);
});

for (const [kind, inputs] of [['caravan', [{}, { length: 140, width: 64, height: 75, text: '' }]], ['stonewall', [{}, { gate: 'end', length: 500 }, { gate: 'none', length: 90, height: 40 }]], ['huntingtower', [{}, { height: 150, splay: 0, ladder: false }, { height: 50, cabinWidth: 70, cabinDepth: 30, splay: 25 }]], ['archhouse', [{}, { span: 300, storeys: 3, clearance: 70, depth: 140 }, { span: 140, storeys: 1, clearance: 60, depth: 50, balcony: false }]], ['tunnelportal', [{}, { span: 140, clearance: 120, house: 'left', length: 200 }, { span: 300, clearance: 60, house: 'none', length: 30 }]], ['rockgallery', [{}, { length: 800, arches: false }, { length: 80, span: 140, clearance: 110 }]], ['levelcrossing', [{}, { span: 300, verge: 80 }, { span: 140, verge: 40, barriers: false, cottage: false }]]])
  test(kind + ': every part one body, each fitting the plate, none sharing material, all within its footprint', () => {
    for (const input of inputs) {
      const b = validateBuilding({ kind, ...input });
      const r = built(b);
      assert.deepEqual(r.overlaps, [], JSON.stringify(input));
      for (const p of r.parts) {
        assert.equal(p.bodies, 1, p.id + ' in one piece');
        assert.ok(p.printed[0] <= 210 && p.printed[1] <= 210, p.id + ' fits: ' + p.printed.map((v) => v.toFixed(1)));
        // Nothing goes under the table.
        assert.ok(p.box.min[2] >= -1e-6, p.id + ' under the table');
      }
      // The planner's footprint holds everything on the table.
      const [x0, y0, x1, y1] = RALLY_KINDS[kind].footprint(b);
      for (const p of r.parts) assert.ok(p.box.min[0] >= x0 - 0.01 && p.box.max[0] <= x1 + 0.01 && p.box.min[1] >= y0 - 0.01 && p.box.max[1] <= y1 + 0.01, p.id + ' outside the footprint');
      // Its parts as laid out are the parts as built, but for a wall cut to fit the plate.
      const listed = buildingLayout(b).parts.map((p) => p.id);
      if (kind !== 'stonewall' && kind !== 'rockgallery') assert.deepEqual(r.parts.map((p) => p.id), listed);
    }
  });

test('the hunting tower: its frames, ladder and roof lie flat, its legs stand on the table and go into the pockets under the cabin', () => {
  const t = validateBuilding({ kind: 'huntingtower' });
  const r = built(t);
  // Flat as thick as they are: the legs and braces, the ladder, the roof.
  for (const id of ['frame-front', 'frame-back', 'frame-left', 'frame-right']) assert.ok(Math.abs(of(r, id).printed[2] - HUNTING_TOWER.leg) < 0.05, id + ' lies flat: ' + of(r, id).printed[2]);
  assert.ok(Math.abs(of(r, 'ladder').printed[2] - HUNTING_TOWER.ladderThick) < 0.05);
  assert.ok(Math.abs(of(r, 'roof').printed[2] - HUNTING_TOWER.roof) < 0.05);
  // The legs from the table up into the pockets; the cabin's floor at its height.
  for (const id of ['frame-front', 'frame-back']) {
    assert.ok(Math.abs(of(r, id).box.min[2]) < 1e-6);
    assert.ok(Math.abs(of(r, id).box.max[2] - (t.height + HUNTING_TOWER.pocket)) < 1e-6);
  }
  assert.ok(Math.abs(of(r, 'cabin').box.min[2] - t.height) < 1e-6);
  // Its legs spread out at their feet.
  assert.ok(Math.abs(of(r, 'frame-front').box.min[0] - (HUNTING_TOWER.inset - t.splay)) < 1e-6);
  // The cabin's planks are its texture.
  assert.equal(of(r, 'cabin').joints.kind, 'planks');
  // The ladder reaches from the table to the door's sill.
  assert.ok(Math.abs(of(r, 'ladder').box.max[2] - (t.height + HUNTING_TOWER.floor)) < 1e-6);
});

test('the dry-stone wall: runs that fit the plate, its stones on end along the top, a gate between two posts', () => {
  const w = validateBuilding({ kind: 'stonewall', length: 600 });
  const plan = stoneWallPlan(w);
  assert.deepEqual(plan.gate, [300 - w.gateWidth / 2, 300 + w.gateWidth / 2]);
  const r = built(w);
  const walls = r.parts.filter((p) => p.role === 'wall');
  assert.ok(walls.length >= 3, 'cut to fit the plate: ' + walls.length);
  for (const p of walls) assert.equal(p.joints.kind, 'drystone', p.id + ': its stones');
  // The stones on end reach its height; the gateposts stand higher.
  assert.ok(walls.every((p) => p.box.max[2] <= w.height + STONE_WALL.above + 1e-6));
  assert.ok(walls.some((p) => Math.abs(p.box.max[2] - (w.height + STONE_WALL.above)) < 1e-6), 'the gateposts');
  const gate = of(r, 'gate');
  assert.equal(gate.role, 'door');
  assert.ok(Math.abs(gate.printed[2] - STONE_WALL.thick) < 0.05, 'the gate lies flat');
  // Clear of the posts and of the table.
  assert.ok(gate.box.min[0] >= plan.gate[0] + STONE_WALL.play - 1e-6 && gate.box.max[0] <= plan.gate[1] - STONE_WALL.play + 1e-6 && gate.box.min[2] > 1);
  // Without a gate, a run and no gate; at the end, a post on its own beyond it.
  assert.equal(built({ kind: 'stonewall', gate: 'none', length: 120 }).parts.length, 1);
  assert.ok(of(built({ kind: 'stonewall', gate: 'end', length: 200 }), 'post'));
});

test('the timing caravan: wheels on the table in their arches, its hatch lettered, its small parts lying on their sides', () => {
  const v = validateBuilding({ kind: 'caravan' });
  const r = built(v);
  for (const id of ['wheel-left', 'wheel-right']) {
    assert.ok(Math.abs(of(r, id).box.min[2]) < 1e-6, id + ' on the table');
    assert.ok(Math.abs(of(r, id).printed[2] - CARAVAN.tread) < 0.05, id + ' lies on its face');
  }
  // The body above the table on its wheels; its lettering cut in and marked.
  assert.ok(Math.abs(of(r, 'body').box.min[2] - CARAVAN.under) < 1e-6);
  assert.ok(of(r, 'body').joints.marks.some((m) => m === 1), 'the lettering and the door are cut');
  for (const id of ['jockey', 'steady-1', 'aerial']) assert.ok(of(r, id).printed[2] < 3, id + ' on its side');
  // Without lettering, still a door cut in.
  assert.ok(built({ kind: 'caravan', text: '' }).parts.find((p) => p.id === 'body').joints);
});

test('the drive-through pieces: the road under them clear the whole way through', () => {
  // Under an arch only its middle is clear to the top: the road is checked up to where the arch springs.
  for (const input of [{}, { span: 300, clearance: 70, storeys: 3 }]) {
    const h = validateBuilding({ kind: 'archhouse', ...input });
    const x0 = ARCH_HOUSE.pier;
    const r = built(h, PLATE, [x0, -50, x0 + h.span, h.depth + 50, h.clearance - ARCH_HOUSE.rise]);
    assert.deepEqual(r.inTheWay, [], 'under the arch');
    // The ceiling at the top of the arch, the house above it.
    assert.ok(Math.abs(of(r, 'ceiling-left').box.min[2] - h.clearance) < 1e-6);
  }
  for (const input of [{}, { span: 140, clearance: 120, house: 'left' }]) {
    const p = validateBuilding({ kind: 'tunnelportal', ...input });
    const w = TUNNEL_PORTAL.wing;
    const spring = p.clearance - Math.min(p.span / 2, p.clearance - TUNNEL_PORTAL.jamb);
    const r = built(p, PLATE, [w, -100, w + p.span, 400, spring]);
    assert.deepEqual(r.inTheWay, [], 'through the tunnel');
    // The house in front of the headwall, beside the arch.
    const house = of(r, 'house').box;
    assert.ok(house.max[1] < 0 && (house.max[0] <= w || house.min[0] >= w + p.span));
  }
  for (const input of [{}, { length: 500, arches: false }]) {
    const g = validateBuilding({ kind: 'rockgallery', ...input });
    // Up to the ledge under the roof's edge along the rock.
    const r = built(g, PLATE, [-10, 0, g.length + 10, g.span, g.clearance - ROCK_GALLERY.ledge[1]]);
    assert.deepEqual(r.inTheWay, [], 'along the gallery');
    // Its runs end to end, the whole length.
    const pillars = r.parts.filter((p) => p.id.startsWith('pillars'));
    assert.ok(Math.abs(pillars.reduce((s, p) => s + p.box.max[0] - p.box.min[0], 0) - g.length) < 1e-6);
  }
  // The level crossing: nothing on the road at all, the rails up to it.
  for (const input of [{}, { span: 300, verge: 40 }]) {
    const c = validateBuilding({ kind: 'levelcrossing', ...input });
    const r = built(c, PLATE, [0, -500, c.span, 500, 500]);
    assert.deepEqual(r.inTheWay, [], 'the road');
    assert.ok(Math.abs(of(r, 'rails-left').box.max[0] + LEVEL_CROSSING.gap) < 1e-6 && Math.abs(of(r, 'rails-right').box.min[0] - c.span - LEVEL_CROSSING.gap) < 1e-6);
    // The booms stand up beside their posts.
    for (const side of ['left', 'right']) assert.ok(of(r, 'boom-' + side).box.max[2] > 100, side);
  }
});

test('the drive-through pieces each say what is wrong with their settings', () => {
  assert.throws(() => validateBuilding({ kind: 'archhouse', storeys: 3, clearance: 100 }), /too high for its walls to lie flat/);
  assert.throws(() => validateBuilding({ kind: 'archhouse', storeys: 1.5 }), /whole number/);
  assert.throws(() => validateBuilding({ kind: 'archhouse', span: 100 }), /Width of the arch must be between 140 and 300/);
  assert.throws(() => validateBuilding({ kind: 'tunnelportal', house: 'both' }), /house on the left/);
  assert.throws(() => validateBuilding({ kind: 'rockgallery', arches: 1 }), /arched or square/);
  assert.throws(() => validateBuilding({ kind: 'levelcrossing', verge: 20 }), /Railway each side must be between 40 and 80/);
  assert.throws(() => validateBuilding({ kind: 'levelcrossing', cottage: 'no' }), /keeper/);
});

test('each rally kind has the notes of its kit, and its place in the planner', () => {
  for (const [kind, words] of [['caravan', /timing caravan kit/], ['stonewall', /dry-stone wall kit/], ['huntingtower', /hunting tower kit/], ['archhouse', /arch house kit/], ['tunnelportal', /tunnel portal kit/], ['rockgallery', /rock gallery kit/], ['levelcrossing', /level crossing kit/]]) {
    const b = validateBuilding({ kind });
    const parts = buildingLayout(b).parts;
    const notes = kitNotes('Test', b, parts, {});
    assert.match(notes, words);
    assert.match(notes, /without supports/);
    // On the layout: its footprint, turned and placed.
    const plan = footprint({ building: b, pose: { x: 100, y: 50, a: 0 } });
    assert.ok(plan.length >= 4, kind);
  }
});
