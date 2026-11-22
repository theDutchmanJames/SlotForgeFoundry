import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { customTrackPlan } from '../src/custom-track.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { printableSTL } from '../src/kit.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { buildTestJoint, buildTrack, defaultTrack, nativeTrackPoint } from '../src/track.js';

const wasm = await Module();
wasm.setup();

function straight(overrides) {
  return {
    ...defaultTrack(), kind: 'straight', width: 200, length: 200, lanes: 2,
    laneSpacing: 100, height: 10, slotDepth: 8, deck: 2, wall: 2, hollow: true,
    borderEntry: 38, borderApex: 38, borderExit: 38,
    reinforcement: true, ribSpacing: 50, ...overrides,
  };
}

function workshop(t) {
  const work = new SolidWorkshop(wasm);
  t.after(() => work.close());
  return work;
}

function build(work, p, plan) {
  const parts = buildTrack(wasm, p, plan);
  for (const part of parts) work.own(part.solid);
  return parts;
}

// Put the actual road or border STL back at its assembled coordinates.
function installedSTL(work, part, p) {
  const project = { mode: 'track', track: { params: p } };
  const stl = work.own(parseSTL(wasm, printableSTL(part, encodeSTL, undefined, project)));
  assert.equal(stl.status(), 'NoError');
  const bbox = stl.boundingBox();
  assert.ok(Math.abs(bbox.min[2]) < 0.001 && Math.abs(bbox.max[2] - p.height) < 0.001);
  const oriented = p.special ? work.own(stl.rotate([180, 0, 0])) : stl;
  const assembled = part.solid.boundingBox().min;
  const printed = oriented.boundingBox().min;
  return work.own(oriented.translate(assembled.map((v, i) => v - printed[i])));
}

function surface(mesh, xy, fromBelow = true) {
  const [a, b] = fromBelow ? [-1, 11] : [11, -1];
  return mesh.rayCast([...xy, a], [...xy, b])[0]?.position[2];
}

function near(actual, expected, description, tolerance = 0.002) {
  assert.ok(Math.abs(actual - expected) < tolerance, description + ': expected ' + expected + ', got ' + actual);
}

// Shoot along the open cavity at mid-height. Each pair of hits measures a
// rib independently of its triangles, the preview or the placement algorithm.
function straightRibs(mesh, y, x0, x1) {
  const hits = mesh.rayCast([x0, y, 4.33], [x1, y, 4.33]).map(hit => hit.position[0]);
  assert.equal(hits.length % 2, 0, 'both measurement endpoints lie inside the hollow cavity');
  const ribs = [];
  for (let i = 0; i < hits.length; i += 2)
    ribs.push({ centre: (hits[i] + hits[i + 1]) / 2, thickness: hits[i + 1] - hits[i] });
  return ribs;
}

test('printable ribs span the road cavities and reinforce both independently segmented borders', t => {
  const work = workshop(t), p = straight({ borderSide: 'both', borderSegments: 2 });
  const pieces = build(work, p);
  const road = installedSTL(work, pieces.find(part => part.role === 'road'), p);
  const rows = straightRibs(road, 12, -96, 96);
  assert.equal(rows.length, 3);
  for (const { centre, thickness } of rows) {
    near(thickness, p.wall, 'rib thickness');
    for (const y of [-97, -54, -46, 0, 46, 54, 97])
      near(surface(road, [centre, y]), 0, 'rib reaches the table across the cavity');
    for (const y of [-50, 50]) {
      near(surface(road, [centre, y], false), p.height - p.slotDepth, 'guide floor across rib');
      near(surface(road, [centre, y + 4], false), p.height - p.braidDepth, 'braid shelf across rib');
    }
    near(surface(road, [centre + 5, 12]), p.height - p.deck, 'adjacent cavity remains hollow');
  }
  for (const part of pieces.filter(part => part.role === 'border')) {
    const border = installedSTL(work, part, p), { min, max } = part.solid.boundingBox();
    const y = (min[1] + max[1]) / 2;
    const ribs = straightRibs(border, y, min[0] + 4, max[0] - 4);
    assert.equal(ribs.length, 1, 'one transverse wall in each 100 mm border segment');
    near(ribs[0].thickness, p.wall, 'border rib thickness');
    for (const shoulder of [min[1] + 3, max[1] - 3])
      near(surface(border, [ribs[0].centre, shoulder]), 0, 'attached across border');
  }
  const bare = installedSTL(work, build(work, { ...p, reinforcement: false })[0], p);
  assert.deepEqual(straightRibs(bare, 12, -96, 96), []);
  const denser = { ...p, ribSpacing: 32, wall: 2.4, slotDepth: 7.5 };
  const closer = installedSTL(work, build(work, denser)[0], denser);
  const closeRows = straightRibs(closer, 12, -96, 96);
  assert.ok(closeRows.length > rows.length, 'smaller spacing adds ribs');
  for (const row of closeRows) near(row.thickness, denser.wall, 'ribs inherit the configured wall thickness');
});

test('webs turn radially on a bend and follow a rotated imported straight', t => {
  const work = workshop(t);
  const curve = straight({ kind: 'curve', radius: 300, angle: 75 });
  const arc = installedSTL(work, build(work, curve)[0], curve);
  const imported = straight({ kind: 'import' });
  const plan = customTrackPlan({ version: 1, radius: 150, points: [[0, 0], [120, 160]] }, imported);
  const rotated = installedSTL(work, build(work, imported, plan)[0], imported);
  const alongImport = (t, d) => [120 * t - 0.8 * d, 160 * t + 0.6 * d];
  for (const [mesh, point] of [[arc, (t, d) => nativeTrackPoint(curve, t, d)], [rotated, alongImport]]) {
    const samples = [];
    for (let i = 100; i <= 460; i++)
      if (surface(mesh, point(i / 1000, 10)) < 0.01) samples.push(i);
    assert.ok(samples.length >= 3, 'a transverse web away from the midpoint and end walls');
    // Centre in the first web so even a faceted circular path measures on the web.
    const first = samples[0], gap = samples.findIndex((v, i) => v !== first + i);
    const last = samples[gap < 0 ? samples.length - 1 : gap - 1];
    for (const across of [-88, -25, 33, 88])
      near(surface(mesh, point((first + last) / 2000, across)), 0, 'one rib follows the local normal');
  }
});

test('a routed panel clips its ribs to the material around an internal opening', t => {
  const work = workshop(t), p = straight({ kind: 'import' });
  const plan = {
    outlines: [
      [[-100, -60], [100, -60], [100, 60], [-100, 60]],
      [[-32, -15], [-32, 15], [32, 15], [32, -15]],
    ],
    lanes: [[[-75, 38], [75, 38]]],
  };
  const mesh = installedSTL(work, build(work, p, plan)[0], p);
  const rows = straightRibs(mesh, -25, -96, 96);
  assert.equal(rows.length, 3);
  for (const { centre } of rows) {
    near(surface(mesh, [centre, 26]), 0, 'rib reaches both sides of the routed panel');
    if (Math.abs(centre) < 30) assert.equal(surface(mesh, [centre, 0]), undefined, 'through opening');
    else near(surface(mesh, [centre, 0]), 0, 'rib outside the opening');
  }
});

test('moving a Carrera border connection leaves its keepers accessible and redistributes the nearby ribs', t => {
  const work = workshop(t);
  const layouts = [0.5, 0.63].map(station => {
    const p = straight({ borderSide: 'outer', borderMount: 'clips', clipType: 'carrera-retained',
      jointFitVersion: 2, placements: { sideClips: [station] } });
    const parts = build(work, p);
    const road = installedSTL(work, parts[0], p);
    const border = installedSTL(work, parts.find(part => part.role === 'border'), p);
    const alongside = work.own(road.add(border));
    const hardware = parts.filter(part => part.role === 'clip' || part.role === 'retainer');
    assert.equal(hardware.length, 3);
    for (const part of hardware) {
      near(work.and(alongside, part.solid).volume(), 0, 'seated ' + part.name + ' fits');
      if (part.role === 'retainer') {
        const {min, max} = part.solid.boundingBox(), x = (min[0] + max[0]) / 2, y = (min[1] + max[1]) / 2;
        assert.equal(alongside.rayCast([x, y, -1], [x, y, max[2] - 0.1]).length, 0,
          'the underside keeper centre remains accessible');
      }
    }
    return straightRibs(road, 7.4, -96, 96).map(rib => rib.centre);
  });
  assert.notDeepEqual(layouts[0], layouts[1], 'the row location responds to the connector position');
});

test('the pit gains printable ribs between its three slots while its adjustable motor stays clear', t => {
  const work = workshop(t), p = specialTrackParams('pit', straight());
  p.special.motorMount = true;
  const parts = build(work, p);
  const road = installedSTL(work, parts.find(part => part.role === 'road'), p);
  const rows = straightRibs(road, 21, -87, 87);
  assert.ok(rows.length >= 2, 'pit box has intermediate webs');
  for (const { centre } of rows) for (const y of [-75, 0, 100, 175])
    near(surface(road, [centre, y]), 0, 'pit web spans all four cavities');
  const tray = parts.find(part => part.role === 'motorMount');
  for (const travel of [-1.5, 0, 1.5]) {
    const adjusted = work.own(tray.solid.translate([0, travel, 0]));
    near(work.and(road, adjusted).volume(), 0, 'full motor cradle adjustment');
  }
});

test('solid construction and short joint fit coupons keep their original shape', t => {
  const work = workshop(t);
  for (const coupon of [false, true]) {
    const p = straight({ hollow: coupon, joint: 'clips', ribSpacing: 12 });
    const make = flag => {
      const parameters = { ...p, reinforcement: flag };
      if (!coupon) return build(work, parameters);
      const parts = buildTestJoint(wasm, parameters, 'start');
      for (const part of parts) work.own(part.solid);
      return parts;
    };
    const before = make(false), after = make(true);
    assert.deepEqual(after.map(part => part.id), before.map(part => part.id));
    for (const [i, part] of after.entries())
      assert.deepEqual(encodeSTL(part.solid), encodeSTL(before[i].solid));
  }
});
