// A grandstand: a hollow stepped shell in sections that print standing on
// their end, straight or curved, with aisles, benches and a canopy.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { STAND, aisleSpans, buildGrandstand, grandstandLayout, sectionSpans, standDepth, standHeight, validateGrandstand } from '../src/geometry/grandstand.js';
import { buildGarage, fitsPlate, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { shapeOf, snapPose, overlap } from '../src/planner-buildings.js';

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
];

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
