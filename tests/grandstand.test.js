// A grandstand: a hollow stepped shell in sections that print standing on
// their end, straight or curved, with aisles, benches and a canopy.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { STAND, aisleSpans, buildGrandstand, grandstandLayout, sectionSpans, standDepth, standExtent, standHeight, standStair, validateGrandstand } from '../src/geometry/grandstand.js';
import { buildGarage, fitsPlate, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { shapeOf, snapPose, overlap } from '../src/planner-buildings.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const withParts = (settings, check) => {
  const parts = buildGrandstand(wasm, settings);
  try {
    return check(parts, (id) => parts.find((p) => p.id === id));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const VARIANTS = [
  { kind: 'grandstand' },
  { kind: 'grandstand', length: 400, rows: 9, aisles: 3, roof: 'canopy' },
  { kind: 'grandstand', seats: false, aisles: 0, rows: 3 },
  { kind: 'grandstand', rows: 5, aisles: 2, curve: { radius: 450, angle: 45, facing: 'in' } },
  { kind: 'grandstand', rows: 4, aisles: 1, roof: 'canopy', curve: { radius: 500, angle: 60, facing: 'out' } },
  // Raised on frames, a staircase at the left, railings; benches with backs, and aisles between them.
  { kind: 'grandstand', rows: 5, length: 200, aisles: 0, raised: 35, stairs: 'left', railings: true },
  { kind: 'grandstand', rows: 8, length: 320, aisles: 2, raised: 60, stairs: 'both', railings: true, backrests: true },
  { kind: 'grandstand', rows: 2, length: 120, aisles: 0, backrests: true, frontHeight: 8, rowRise: 10 },
  { kind: 'grandstand', rows: 6, raised: 40, roof: 'canopy', stairs: 'right' },
  { kind: 'grandstand', rows: 4, aisles: 1, backrests: true, curve: { radius: 450, angle: 45, facing: 'in' } },
];
// The parts that print flat or on their side, as the overhang check reads them.
const overAir = (p) => {
  const printed = printPose(p);
  const m = printed.getMesh();
  let over = 0;
  for (let i = 0; i < m.triVerts.length; i += 3) {
    const v = [0, 1, 2].map((k) => Array.from(m.vertProperties.subarray(m.triVerts[i + k] * m.numProp, m.triVerts[i + k] * m.numProp + 3)));
    const a = v[1].map((x, j) => x - v[0][j]),
      b = v[2].map((x, j) => x - v[0][j]);
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = Math.hypot(...n);
    if (len && n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
  }
  printed.delete();
  return over;
};

test('a grandstand is checked; on a curve its length follows from the radius and the angle', () => {
  const g = validateGrandstand({});
  assert.deepEqual([g.length, g.rows, standDepth(g), standHeight(g)], [240, 6, 3 + 6 * 18 + 3, 12 + 5 * 9 + 15]);
  assert.equal(validateBuilding({ kind: 'grandstand', rows: 4 }).rows, 4, 'a building can be a grandstand');
  assert.equal(validateGrandstand({ curve: { radius: 300, angle: 90, facing: 'in' } }).length, 471.2);
  assert.throws(() => validateGrandstand({ rows: 0 }), /Rows must be between 1 and 20/);
  assert.throws(() => validateGrandstand({ rows: 2.5 }), /whole numbers/);
  assert.throws(() => validateGrandstand({ aisles: 12, length: 100 }), /Too many aisles for a grandstand 100 mm long: at most 2/);
  assert.throws(() => validateGrandstand({ curve: { radius: 120, angle: 45, facing: 'out' } }), /radius must be at least 144 mm/);
  assert.throws(() => validateGrandstand({ roof: 'dome' }), /roof for the grandstand/);
  assert.throws(() => validateGrandstand({ colour: 'red' }), /unknown setting: colour/);
  // Backs, frames, staircases and railings.
  assert.throws(() => validateGrandstand({ seats: false, backrests: true }), /Backs are for benches/);
  assert.throws(() => validateGrandstand({ backrests: true, rowDepth: 14 }), /at least 16 mm deep/);
  assert.throws(() => validateGrandstand({ raised: 10 }), /Raised must be 0, on the table, or between 20 and 100 mm/);
  assert.throws(() => validateGrandstand({ raised: 120 }), /Raised must be between 0 and 100 mm/);
  assert.throws(() => validateGrandstand({ stairs: 'front' }), /staircase for the grandstand/);
  assert.throws(() => validateGrandstand({ stairs: 'left', rows: 1, frontHeight: 7 }), /more than 8 mm up/);
  assert.equal(validateGrandstand({ stairs: 'left', rows: 1, frontHeight: 9 }).stairs, 'left');
  assert.throws(() => validateGrandstand({ railings: true, roof: 'canopy' }), /open to the sky/);
  for (const more of [{ raised: 30 }, { stairs: 'left' }, { railings: true }])
    assert.throws(() => validateGrandstand({ ...more, curve: { radius: 450, angle: 45, facing: 'in' } }), /for a straight grandstand/);
  // Raised, it stands that much higher.
  assert.equal(standHeight(validateGrandstand({ raised: 40 })), 40 + 12 + 5 * 9 + 15);
});

test('benches with backs, frames, a staircase and railings print without supports', () => {
  for (const settings of VARIANTS)
    withParts(settings, (parts) => {
      for (const p of parts.filter((q) => /^(frame|stair|rail|end)/.test(q.id))) assert.ok(overAir(p) < 0.5, p.name + ' prints over air ' + JSON.stringify(settings).slice(0, 80));
    });
});

test('a raised stand stands on its frames; its staircase climbs to the last row; its railings stand round it', () => {
  const settings = { rows: 5, length: 200, aisles: 0, raised: 35, stairs: 'both', railings: true };
  const g = validateGrandstand(settings);
  const D = standDepth(g);
  assert.deepEqual(
    grandstandLayout(settings).parts.map((p) => p.id.replace(/-\d+$/, '')).filter((v, i, all) => all.indexOf(v) === i),
    ['stand', 'end', 'frame-front', 'frame-back', 'frame', 'stair-left', 'stair-right', 'rail-back'],
  );
  withParts(settings, (parts, part) => {
    const box = (id) => part(id).solid.boundingBox();
    // The shell on the frames: its bottom where their tops are.
    assert.ok(near(box('stand-1').min[2], 35) && near(box('end').min[2], 35), 'the shell raised');
    for (const p of parts.filter((q) => /^frame-(front|back)/.test(q.id))) assert.ok(near(p.solid.boundingBox().min[2], 0) && near(p.solid.boundingBox().max[2], 35), p.name + ' from the table to the shell');
    assert.ok(near(box('frame-front-1').min[1], 0) && near(box('frame-back-1').max[1], D), 'under the parapet and the back wall');
    // A cross frame reaches up into the hollow under the rows, but not through the shell (the overlap test).
    const cross = box('frame-1');
    assert.ok(cross.max[2] > 35 + g.frontHeight, 'up into the hollow');
    assert.ok(near(cross.min[1], STAND.shell) && near(cross.max[1], D - STAND.shell), 'between the front and back frames');
    // The staircase: from the table, its top step level with the last row.
    const { top } = standStair(g);
    assert.equal(top, 35 + g.frontHeight + (g.rows - 1) * g.rowRise);
    const stair = part('stair-left').solid;
    assert.ok(near(stair.boundingBox().max[0], 0) && near(stair.boundingBox().min[0], -STAND.stair.width), 'beside the left end');
    assert.ok(near(part('stair-right').solid.boundingBox().min[0], g.length + STAND.shell), 'beside the end panel');
    // Open under its slab, as the steps are: nothing near the table halfway along it, in its wall either.
    const probe = wasm.Manifold.cube([STAND.stair.width - 2, 6, 4]).translate([-STAND.stair.width + 1, D / 2, 1]);
    const under = stair.intersect(probe);
    assert.ok(under.volume() < 0.01, 'open under the staircase');
    under.delete();
    probe.delete();
    // The back railing on the back of the back wall, rising above it.
    const rail = box('rail-back-1');
    assert.ok(near(rail.min[1], D) && near(rail.max[2], standHeight(g) + STAND.rail.height), 'glued on the back, above the wall');
    // A staircase at each end: no side railing over the top of either end.
    assert.ok(near(box('end').max[2], standHeight(g)), 'no side railing where a staircase is');
  });
  // Without a staircase, the side railings rise from the ends as high as the back railing.
  withParts({ ...settings, stairs: 'none' }, (_, part) => {
    assert.ok(near(part('end').solid.boundingBox().max[2], standHeight(g) + STAND.rail.height), 'the side railing');
  });
  // On the table: the staircase and the railing in its outline.
  const [x0, y0, x1, y1] = standExtent(g);
  assert.ok(near(x0, -STAND.stair.width) && near(x1, 200 + STAND.shell + STAND.stair.width) && y0 <= 0 && near(y1, D + STAND.rail.bar));
  const s = shapeOf(g);
  assert.ok(near(s.box[0], x0) && near(s.box[3], y1), 'the planner sees it');
  // Benches with backs: the back of the first row's bench stands against the
  // step up, no gap behind it, rising above the next row; a plain bench has none.
  const [bt, , above] = STAND.backrest;
  const yBack = STAND.shell + 18;
  for (const [backrests, filled] of [[true, true], [false, false]])
    withParts({ rows: 2, length: 120, aisles: 0, backrests }, (_, part) => {
      const stand = part('stand-1').solid;
      // Above the next row (its tread at 12 + 9), in front of its step.
      const probe = wasm.Manifold.cube([10, bt - 0.4, above - 1]).translate([10, yBack - bt + 0.2, 12 + 9 + 0.5]);
      const got = stand.intersect(probe);
      assert.equal(got.volume() > 0.9 * probe.volume(), filled, backrests ? 'a back above the next row' : 'no back');
      got.delete();
      probe.delete();
      // No slot between the back and the step: solid from the back to the riser, up to the next row.
      const slot = wasm.Manifold.cube([10, bt + STAND.shell - 0.4, 9 - 1]).translate([10, yBack - bt + 0.2, 12 + 0.5]);
      const fill = stand.intersect(slot);
      if (backrests) assert.ok(fill.volume() > 0.99 * slot.volume(), 'no channel behind the back');
      fill.delete();
      slot.delete();
    });
});

test('every part is one body, no two take the same space, and every part fits the plate', () => {
  const plate = { width: 200, depth: 200, margin: 0 };
  for (const settings of VARIANTS)
    withParts(settings, (parts) => {
      const label = JSON.stringify(settings).slice(0, 70);
      for (const p of parts) {
        assert.equal(p.solid.status(), 'NoError', p.name + ' ' + label);
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), plate), p.name + ' fits: ' + printSize(p) + ' ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap by ' + both.volume() + ' ' + label);
          both.delete();
        }
    });
});

test('each section stands on its end to print: nothing over air but the top of a tab slot, and no taller than set', () => {
  for (const settings of VARIANTS)
    withParts(settings, (parts) => {
      const g = validateGrandstand(settings);
      for (const p of parts.filter((q) => /^stand/.test(q.id))) {
        const printed = printPose(p);
        const m = printed.getMesh();
        let over = 0;
        for (let i = 0; i < m.triVerts.length; i += 3) {
          const v = [0, 1, 2].map((k) => Array.from(m.vertProperties.subarray(m.triVerts[i + k] * m.numProp, m.triVerts[i + k] * m.numProp + 3)));
          const a = v[1].map((x, j) => x - v[0][j]),
            b = v[2].map((x, j) => x - v[0][j]);
          const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
          const len = Math.hypot(...n);
          // Steeper than 45° down, off the plate: a 45° slope prints.
          if (n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
        }
        const height = printed.boundingBox().max[2];
        printed.delete();
        const slots = 2 * (STAND.tab[0] + 2 * STAND.tabPlay) * (STAND.tab[1] + 2 * STAND.tabPlay);
        assert.ok(over <= slots + 1, p.name + ' prints ' + over.toFixed(1) + ' mm² over air');
        assert.ok(height <= g.sectionLength + 0.5, p.name + ' is ' + height + ' mm tall as it prints');
      }
    });
});

test('the cuts keep out of the aisles; the sections join with tabs; both ends are closed', () => {
  const g = validateGrandstand({ length: 300, aisles: 2, sectionLength: 110 });
  const spans = sectionSpans(g);
  assert.ok(spans.length >= 3);
  // No cut runs through an aisle.
  for (const [, b] of spans.slice(0, -1)) for (const [p, q] of aisleSpans(g)) assert.ok(b <= p || b >= q, 'cut at ' + b + ' clear of the aisle ' + p + '–' + q);
  withParts({ length: 300, aisles: 2, sectionLength: 110 }, (parts, part) => {
    // The tab of section 1 fills the slot of section 2, with play: they do not overlap, and they touch.
    const a = part('stand-1').solid,
      b = part('stand-2').solid;
    const both = a.intersect(b);
    assert.ok(both.volume() < 0.01);
    both.delete();
    assert.ok(a.boundingBox().max[0] > spans[0][1] + STAND.tab[2] - 0.1, 'the tab reaches into the next section');
    // The start is closed by the first section, the far end by its panel.
    assert.ok(near(part('end').solid.boundingBox().min[0], 300) && near(part('end').solid.boundingBox().max[0], 300 + STAND.shell));
  });
  assert.deepEqual(grandstandLayout({ roof: 'canopy', length: 240 }).parts.map((p) => p.id.replace(/-\d+$/, '')).filter((v, i, all) => all.indexOf(v) === i), ['stand', 'end', 'canopy', 'post']);
  // buildGarage builds any building, a grandstand too.
  const via = buildGarage(wasm, { kind: 'grandstand', rows: 2 });
  assert.equal(via.filter((p) => /^stand/.test(p.id)).length, sectionSpans(validateGrandstand({ rows: 2 })).length);
  via.forEach((p) => p.solid.delete());
});

test('in a layout a grandstand faces the track with its parapet; a curved one stands round its curve', () => {
  const straight = validateGrandstand({});
  const s = shapeOf(straight);
  assert.ok(near(s.front.p[0], 120) && near(s.front.p[1], 0) && near(s.front.f[1], -1));
  const curved = validateGrandstand({ curve: { radius: 450, angle: 60, facing: 'in' } });
  const c = shapeOf(curved);
  // Its front, the middle of the arc at the radius, faces the centre.
  assert.ok(near(Math.hypot(...c.front.p), 450, 1e-6));
  assert.ok(near(c.front.f[0] * c.front.p[0] + c.front.f[1] * c.front.p[1], -450, 1e-6));
  // Dropped near a straight road, it stands along it, clear of it.
  const road = [[[0, 0], [600, 0], [600, 100], [0, 100]]];
  for (const building of [straight, curved]) {
    const entry = { id: 'b-1', name: 'Stand', building, pose: { x: 300, y: -90, a: Math.PI } };
    const pose = snapPose(entry, road, 200);
    assert.ok(pose, 'it snaps');
    assert.ok(overlap({ ...entry, pose }, road) < 0.5, 'clear of the road');
  }
});

test('the mini stand prints as one section and its end panel', () => {
  const mini = BUILDING_PRESETS.find((p) => p.id === 'stand-mini').building;
  assert.deepEqual(grandstandLayout(mini).parts.map((p) => p.id), ['stand-1', 'end']);
});

test('every aisle begins a section, so its half steps are square, standing on the plate as it prints', () => {
  for (const settings of [{ length: 300, aisles: 2, sectionLength: 110 }, { aisles: 1 }, { length: 600, aisles: 1, sectionLength: 120 }, { rows: 5, aisles: 2, curve: { radius: 450, angle: 45, facing: 'in' } }]) {
    const g = validateGrandstand(settings);
    const spans = sectionSpans(g);
    for (const [p] of aisleSpans(g)) assert.ok(spans.some(([a]) => near(a, p)), 'a section starts at the aisle at ' + p);
    const most = g.sectionLength - STAND.tab[2];
    if (!g.curve) for (const [a, b] of spans) assert.ok(b - a <= most + 1e-9, 'no longer than set');
  }
  // The half step of the first row, right where the aisle begins: filled, not ramped.
  const g = validateGrandstand({ aisles: 1 });
  const [p] = aisleSpans(g)[0];
  withParts({ aisles: 1 }, (parts) => {
    const section = parts.find((q) => q.id !== 'end' && near(q.solid.boundingBox().min[0], p, 0.05));
    assert.ok(section, 'the section at the aisle');
    const y = STAND.shell + g.rowDepth * 0.75,
      z = g.frontHeight + g.rowRise / 2 - 0.5;
    const probe = wasm.Manifold.cube([0.5, 0.5, 0.5]).translate([p + 0.3, y, z - 0.5]);
    const hit = section.solid.intersect(probe);
    assert.ok(hit.volume() > 0.1, 'square at its start');
    [probe, hit].forEach((s) => s.delete());
  });
});
