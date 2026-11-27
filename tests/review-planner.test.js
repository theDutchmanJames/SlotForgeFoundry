// What the planner knows of a building on the table, held to what its kit
// builds: everything that stands on the table lies inside its outline and
// its base, the room under what spans the track is the lowest thing over it,
// garages over pit bays keep clear of each other, and a connected building's
// parts are the ones it builds.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import polygonClipping from 'polygon-clipping';
import { KIT, STAND as LEGS, buildGarage, validateBuilding } from '../src/geometry/building.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { BAYS } from '../src/geometry/pit-bays.js';
import { STAND, standExtent } from '../src/geometry/grandstand.js';
import { walkwayFeet } from '../src/geometry/walkway.js';
import { SECTION_DEFAULTS, buildConnected, connectedLayout } from '../src/geometry/connected-building.js';
import { bayPose, bayRoom, baseParts, footprint, garageExtras, headroomOver, layoutBuilding, overlap, pitGarage, shapeOf, snapPose, spanOf, toPlan } from '../src/planner-buildings.js';

const wasm = await Module();
wasm.setup();
const preset = (id) => BUILDING_PRESETS.find((p) => p.id === id).building;
const place = (building, pose = { x: 0, y: 0, a: 0 }) => layoutBuilding({ name: 'Test', building }, pose, 'b-1');
// Placed so its own coordinates are the plan's: its middle where it turns.
const atHome = (building) => {
  const b = validateBuilding(building);
  const [x, y] = shapeOf(b).centre;
  return place(b, { x, y, a: 0 });
};
const area = (multi) =>
  multi.reduce((sum, poly) => sum + poly.reduce((s, ring, k) => {
    let twice = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
      twice += x0 * y1 - x1 * y0;
    }
    return s + (k ? -1 : 1) * Math.abs(twice / 2);
  }, 0), 0);
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const free = (parts) => parts.forEach((p) => p.solid.delete());
// A straight along x, `wide` across, its road `road` above the table, its near border along y = `edge`.
const straight = (wide, road = 8, edge = -wide / 2, length = 1200) => ({ polys: [box(-length / 2, edge, length / 2, edge + wide)], n: { h: [0, 0] }, def: { track: { params: { height: road } } } });
const roadOf = (row) => Math.max(...row.n.h) + row.def.track.params.height;

/* ---------- 1, 3, 8: what stands on the table lies inside the outline ---------- */

// The standard buildings whose outline the planner works out itself: the
// garages (on their base or a stand), the pit buildings of bays and the grandstands.
const ON_TABLE = BUILDING_PRESETS.filter((p) => ['garage', 'pitbays', 'grandstand'].includes(validateBuilding(p.building).kind));
// What a part has on the table, at most 0.5 mm up: its box, and its outline at 0.25 mm.
function atTable(part) {
  const low = part.solid.trimByPlane([0, 0, -1], -0.5);
  try {
    if (low.isEmpty()) return null;
    const { min, max } = low.boundingBox();
    const slice = part.solid.slice(0.25);
    const polys = slice.toPolygons();
    slice.delete();
    return { box: [min[0], min[1], max[0], max[1]], polys };
  } finally {
    low.delete();
  }
}

test('every part a standard building stands on the table with lies inside its outline, and inside its base or feet', () => {
  assert.ok(ON_TABLE.length > 40, 'the garages, pit buildings and grandstands');
  for (const { id, building } of ON_TABLE) {
    const b = validateBuilding(building),
      entry = atHome(b),
      outline = footprint(entry),
      [x0, y0, x1, y1] = shapeOf(b).box;
    // What the planner says meets the table: the base, or the feet of what spans the track.
    const base = polygonClipping.union(...baseParts(entry).map((loop) => [loop]));
    const parts = buildGarage(wasm, b);
    try {
      for (const part of parts) {
        const at = atTable(part);
        if (!at) continue;
        const [l, d, r, u] = at.box;
        // A garage's outline is its base: what stands beside it is in its pieces, checked below.
        const garage = b.kind === 'garage';
        assert.ok(garage || (l >= x0 - 0.05 && d >= y0 - 0.05 && r <= x1 + 0.05 && u <= y1 + 0.05), id + ': ' + part.id + ' at the table [' + at.box.map((v) => v.toFixed(1)) + '] beyond its outline [' + [x0, y0, x1, y1] + ']');
        if (!at.polys.length) continue;
        const shadow = polygonClipping.union(...at.polys.map((ring) => [ring]));
        assert.ok(garage || area(polygonClipping.difference(shadow, [outline])) < 0.05, id + ': ' + part.id + ' outside its outline');
        assert.ok(area(polygonClipping.difference(shadow, base)) < 0.05, id + ': ' + part.id + ' stands on the table outside its ' + (spanOf(b) ? 'feet' : 'base'));
      }
    } finally {
      free(parts);
    }
  }
});

test('a building with a prop in front snaps clear of the track: the prop too, not only its base', () => {
  // The ticket office's crowd barrier stands on the table 30 mm out in front of it.
  const b = validateBuilding(preset('ticket-office'));
  const barrier = garageExtras(b).props[0];
  assert.ok(barrier[1] < -KIT.ledge - 20, 'the barrier stands out in front');
  // Its front is its own, not the barrier's: a prop does not push it back from the track.
  assert.ok(shapeOf(b).front.p[1] > barrier[1] + 20, 'its front is not the front of the barrier');
  const rows = [straight(150, 8, -150)];
  const entry = place(b, { x: 0, y: 80, a: 0 });
  const pose = snapPose(entry, rows[0].polys);
  assert.ok(pose, 'it snaps');
  const snapped = { ...entry, pose };
  assert.ok(overlap(snapped, rows[0].polys) < 0.5);
  // The barrier where it now stands: off the road.
  const loop = box(...barrier).map((p) => toPlan(snapped, p));
  assert.ok(area(polygonClipping.intersection([loop], [rows[0].polys[0]])) < 0.01, 'the barrier is off the road');
});

test('door steps and the way up stand on the table beside a garage: on the track they count', () => {
  // The race HQ's front door step: the track under it alone is on the track.
  const hq = validateBuilding(preset('race-hq'));
  const [step] = garageExtras(hq).steps;
  assert.ok(step, 'a step at its door');
  const entry = atHome(hq);
  assert.ok(overlap(entry, [box(step[0] + 1, step[1] - 50, step[2] - 1, step[1] + 2)]) > 0.5, 'the step is on the track');
  assert.ok(overlap(entry, [box(step[0] + 1, step[1] - 50, step[2] - 1, step[1] - 0.5)]) < 0.01, 'just in front of it is clear');
  // The hut on legs: its staircase on the table, beside its feet.
  const hut = validateBuilding(preset('hut-legs'));
  const [stairs] = garageExtras(hut).way;
  assert.ok(stairs && stairs[2] - stairs[0] > 20, 'a staircase beside it');
  assert.ok(spanOf(hut).feet.some((f) => f.every((v, i) => v === stairs[i])), 'the staircase is a foot of what spans the track');
  const legs = atHome(hut);
  assert.ok(overlap(legs, [box(stairs[0] + 2, stairs[1] + 2, stairs[2] - 2, stairs[3] - 2)]) > 100, 'a track under the staircase is on the track');
});

test("a pit building's pillars stand in front of its bays: it snaps with them clear of the track, where it always stood", () => {
  for (const id of ['pit-boxes', 'pit-row-modern']) {
    const b = validateBuilding(preset(id));
    assert.ok(b.pillars);
    const shape = shapeOf(b);
    assert.equal(shape.box[1], -BAYS.pillar, id + ': its outline from the front of the pillars');
    assert.equal(shape.front.p[1], -BAYS.pillar);
    // It turns round the middle of its bays, as before: a saved layout keeps it in place.
    assert.deepEqual(shape.centre, [(b.types.length * b.bayWidth + BAYS.side) / 2, b.depth / 2]);
    const track = straight(150, 8, -151);
    const pose = snapPose(place(b, { x: 0, y: 100, a: 0 }), track.polys);
    assert.ok(pose, id + ' snaps');
    // The strip the pillars and the bays' fronts stand on, as built, where it now stands.
    const front = box(0, -BAYS.pillar, b.types.length * b.bayWidth + BAYS.side, 0).map((p) => toPlan({ building: b, pose }, p));
    assert.ok(area(polygonClipping.intersection([front], [track.polys[0]])) < 0.5, id + ': its pillars clear of the track');
  }
});

test("a straight grandstand's outline takes in the panel closing its far end; it turns where it always did", () => {
  for (const id of ['stand', 'stand-covered', 'stand-raised']) {
    const b = validateBuilding(preset(id));
    const shape = shapeOf(b);
    assert.ok(shape.box[2] >= b.length + STAND.shell - 1e-9, id + ': out to the end panel');
    // The middle it turns round is the one it had without the end panel.
    const [x0, y0, x1, y1] = standExtent(b);
    assert.deepEqual(shape.centre, [(x0 + x1) / 2, (y0 + y1) / 2], id);
  }
});

/* ---------- 2: garages over neighbouring pit bays ---------- */

test('garages over every bay: their bases, ledges and all, keep apart; bays too close for them say so', () => {
  const bays = (apart) => [{ at: [0, 0], dir: [0, 1], width: 60 }, { at: [apart, 0], dir: [0, 1], width: 60 }];
  const garages = (apart) => {
    const ends = bays(apart),
      rooms = bayRoom(ends, 200);
    assert.equal(rooms[0], apart - 1 - 2 * KIT.ledge);
    return ends.map((end, i) => {
      const building = pitGarage({ ...preset('garage'), depth: 150 }, end.width, 8, rooms[i]);
      return { ...place(building), pose: bayPose(building, end) };
    });
  };
  // Its garage is 108 mm wide at least: 114 mm with its base.
  for (const apart of [115, 120, 160]) {
    const entries = garages(apart);
    assert.ok(entries[0].building.width + 2 * KIT.ledge <= apart - 1, apart + ': each base within its share');
    const [a, c] = entries.map((e) => polygonClipping.union(...baseParts(e).map((loop) => [loop])));
    assert.ok(area(polygonClipping.intersection(a, c)) < 0.01, apart + ': the two bases apart');
  }
  // 110 mm apart there is no room for two: their bases would overlap by 5 mm.
  assert.throws(() => garages(110), /too close together/);
});

/* ---------- 4, 5, 7: headroom and feet of what spans the track ---------- */

test("under a banner bridge the headroom is to the board's underside, below the girders", () => {
  const b = validateBuilding(preset('banner-bridge'));
  const entry = place(b, { x: 0, y: 0, a: Math.PI / 2 });
  const head = headroomOver(entry, [straight(150)], roadOf);
  // Built: the board's underside is 117 mm up, 4 mm below the girders at 121.
  const parts = buildGarage(wasm, b);
  try {
    const board = parts.find((p) => p.id === 'board');
    assert.equal(head.under, board.solid.boundingBox().min[2]);
    assert.equal(head.under, 117);
    assert.ok(head.under < b.clearance);
  } finally {
    free(parts);
  }
  // A solid beam's board stands on top of it: the headroom is the clearance.
  const solid = place({ kind: 'gantry', type: 'start', clearance: 90, span: 200, boardHeight: 40 }, { x: 0, y: 0, a: Math.PI / 2 });
  assert.equal(headroomOver(solid, [straight(150)], roadOf).under, 90);
});

test('under a building on legs with knee braces, the braces near a leg leave less room than the base', () => {
  const b = validateBuilding(preset('hut-legs'));
  assert.ok(b.standBraces);
  const entry = atHome(b);
  const [foot] = spanOf(b).feet;
  const cx = (foot[0] + foot[2]) / 2;
  // A track along y just beside the left legs' feet, under their braces.
  const strip = [foot[2] + 0.5, foot[2] + 10.5];
  const rows = [{ polys: [box(strip[0], -400, strip[1], 400)], n: { h: [0, 0] }, def: { track: { params: { height: 0 } } } }];
  assert.ok(overlap(entry, rows[0].polys) < 0.5, 'its feet clear of the track');
  const head = headroomOver(entry, rows, roadOf);
  assert.ok(head.under < b.standHeight - 10, 'lower than the base, ' + head.under);
  // The braces as built: their lowest over the track.
  const parts = buildGarage(wasm, b);
  const prism = wasm.Manifold.cube([strip[1] - strip[0], 800, 400]).translate([strip[0], -400, LEGS.foot[0] + 0.5]);
  try {
    let lowest = Infinity;
    for (const p of parts) {
      const hit = p.solid.intersect(prism);
      if (!hit.isEmpty()) lowest = Math.min(lowest, hit.boundingBox().min[2]);
      hit.delete();
    }
    assert.ok(Math.abs(head.under - lowest) < 0.5, 'the planner ' + head.under.toFixed(2) + ', the braces ' + lowest.toFixed(2));
  } finally {
    prism.delete();
    free(parts);
  }
  // Away from the legs the room is the base's.
  const middle = [{ ...rows[0], polys: [box(cx + 30, -400, cx + 40, 400)] }];
  assert.equal(headroomOver(entry, middle, roadOf).under, b.standHeight);
});

test("a walkway's towers meet the table at their base plates, out past their walls", () => {
  const b = validateBuilding(preset('walkway-towers'));
  const towers = walkwayFeet(b);
  const feet = spanOf(b).feet;
  feet.forEach((f, i) => assert.deepEqual(f, [towers[i][0] - KIT.ledge, towers[i][1] - KIT.ledge, towers[i][2] + KIT.ledge, towers[i][3] + KIT.ledge]));
  // A border within the rim of the left tower's plate is on the track.
  const entry = atHome(b);
  const [x0, y0, , y1] = towers[0];
  assert.ok(overlap(entry, [box(x0 - 2.5, y0 - 50, x0 - 1, y1 + 50)]) > 0.5, 'on the track');
  assert.ok(overlap(entry, [box(x0 - 20, y0 - 50, x0 - 3.5, y1 + 50)]) < 0.01, 'beyond the plate it is clear');
});

/* ---------- 6: a connected building's parts, laid out and built ---------- */

test("every connected standard building's parts are the ones it builds", () => {
  const sections = BUILDING_PRESETS.filter((p) => p.building.kind === 'sections');
  assert.ok(sections.length >= 2);
  for (const { id, building } of sections) {
    const parts = buildConnected(wasm, building);
    try {
      assert.deepEqual(connectedLayout(building).parts.map((p) => p.id).sort(), parts.map((p) => p.id).sort(), id);
    } finally {
      free(parts);
    }
  }
});

test('a wall all along a section as high is left out of the layout; one that stands above the roof beside it is not', () => {
  const flat = { ...SECTION_DEFAULTS, width: 120, depth: 120, roofType: 'flat' };
  const level = { kind: 'sections', sections: [flat, { ...flat, id: 's2', name: 'Wing', parent: 's1' }] };
  const stepped = { kind: 'sections', sections: [{ ...flat, height: 120 }, { ...flat, id: 's2', name: 'Low wing', parent: 's1', height: 60 }] };
  for (const [b, gone, kept] of [[level, ['s1-back', 's2-front'], []], [stepped, ['s2-front'], ['s1-back']]]) {
    const laid = connectedLayout(b).parts.map((p) => p.id);
    const parts = buildConnected(wasm, b);
    try {
      for (const w of gone) assert.ok(!laid.includes(w) && !parts.some((p) => p.id === w), w + ' left out');
      for (const w of kept) assert.ok(laid.includes(w) && parts.some((p) => p.id === w), w + ' kept');
      assert.deepEqual(laid.sort(), parts.map((p) => p.id).sort());
    } finally {
      free(parts);
    }
  }
});
