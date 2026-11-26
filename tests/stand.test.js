// What a building stands on, and open storeys. A building can stand on
// four legs, a column (square or round, tapered) or a braced tower; the
// supports' pins go up into pockets under its base. A storey can be open
// above a waist wall, between corner posts, under a beam.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { KIT, OPEN, STAND, buildGarage, buildingLayout, fitsPlate, printPose, printSize, standPins, storeyStack, validateBuilding } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const BOX = { door: 'none', width: 80, depth: 80, height: 50 };
const STANDS = [
  { standType: 'legs', standHeight: 60 },
  { standType: 'legs', standHeight: 150, standSize: 20 },
  { standType: 'column', standHeight: 100, standSize: 20, standTaper: 60 },
  { standType: 'column', standShape: 'round', standHeight: 80, standSize: 30, standTaper: 25 },
  { standType: 'tower', standHeight: 120, standSize: 60 },
  { standType: 'tower', standHeight: 40, standSize: 30 },
];
const withParts = (settings, check, plate = null) => {
  const parts = buildGarage(wasm, settings, plate);
  try {
    return check(parts, (id) => parts.find((p) => p.id === id));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const overAir = (part) => {
  const printed = printPose(part);
  const m = printed.getMesh();
  let over = 0;
  for (let i = 0; i < m.triVerts.length; i += 3) {
    const v = [0, 1, 2].map((k) => Array.from(m.vertProperties.subarray(m.triVerts[i + k] * m.numProp, m.triVerts[i + k] * m.numProp + 3)));
    const a = v[1].map((x, j) => x - v[0][j]),
      b = v[2].map((x, j) => x - v[0][j]);
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = Math.hypot(...n);
    if (n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
  }
  printed.delete();
  return over;
};
const hits = (solid, x, y, z, size = 0.2) => {
  const p = wasm.Manifold.cube([size, size, size]).translate([x - size / 2, y - size / 2, z - size / 2]);
  const hit = solid.intersect(p),
    v = hit.volume();
  [p, hit].forEach((s) => s.delete());
  return v > 0;
};

test('a stand and an open storey are checked', () => {
  const b = validateBuilding({ ...BOX, standType: 'column' });
  assert.equal(b.standShape, 'square');
  assert.throws(() => validateBuilding({ standType: 'stilts' }), /what the building stands on/);
  assert.throws(() => validateBuilding({ ...BOX, standType: 'column', standShape: 'oval' }), /square or a round column/);
  assert.throws(() => validateBuilding({ ...BOX, standType: 'legs', standSize: 30 }), /A leg must be 8 to 20 mm square/);
  assert.throws(() => validateBuilding({ ...BOX, standType: 'tower', standSize: 20 }), /The tower must be 30 to 81.6 mm across, inside the base/);
  assert.throws(() => validateBuilding({ ...BOX, standType: 'column', standSize: 90 }), /The column must be 10 to 81.6 mm/);
  assert.throws(() => validateBuilding({ ...BOX, standHeight: 200 }), /Height of the stand must be between 15 and 190 mm/);
  assert.throws(() => validateBuilding({ door: 'open', lane: { width: 80 }, standType: 'legs' }), /pit bay stands on the table/);
  assert.throws(() => validateBuilding({ ...BOX, open: true, waist: 40 }), /waist wall must be 8 to 30 mm high/);
  assert.throws(() => validateBuilding({ ...BOX, open: true, openings: [{ wall: 'front', type: 'window', at: 40, height: 15, sill: 10 }] }), /open storey has no windows or doors/);
  assert.throws(() => validateBuilding({ width: 120, depth: 120, open: true }), /open storey has no windows or doors/);
  assert.throws(() => validateBuilding({ ...BOX, upper: [{ open: true, waist: 50 }] }), /waist wall, storey 2 must be 8 to 45 mm/);
  // The stand's parts come after the base.
  const ids = (s) => buildingLayout({ ...BOX, ...s }).parts.map((p) => p.id).slice(0, 6);
  assert.deepEqual(ids({ standType: 'legs' }).slice(0, 5), ['base', 'leg-1', 'leg-2', 'leg-3', 'leg-4']);
  assert.deepEqual(ids({ standType: 'column', standSize: 20 }).slice(0, 2), ['base', 'column']);
  assert.deepEqual(ids({ standType: 'tower', standSize: 60 }), ['base', 'tower-front', 'tower-back', 'tower-left', 'tower-right', 'tower-foot']);
  // An open storey has its band as an opening in each wall, and no braces.
  const s = storeyStack(validateBuilding({ ...BOX, open: true }))[0];
  assert.equal(s.openings.length, 4);
  assert.ok(!buildingLayout({ ...BOX, open: true }).parts.some((p) => /^brace/.test(p.id)));
});

test('every stand: one body a part, fitting the plate, without supports, nothing in another part, the building on top', () => {
  for (const stand of STANDS)
    withParts({ ...BOX, ...stand }, (parts, part) => {
      const label = JSON.stringify(stand);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits ' + printSize(p) + ' ' + label);
      }
      for (const p of parts.filter((q) => /^(leg|column|tower)/.test(q.id))) assert.ok(overAir(p) <= 0.5, p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air ' + label);
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
      // The base stands at the top of the stand, the supports from the table up to it.
      assert.ok(near(part('base').solid.boundingBox().min[2], stand.standHeight), 'the base on the stand ' + label);
      const supports = parts.filter((q) => /^(leg|column|tower)/.test(q.id));
      assert.ok(supports.every((q) => q.solid.boundingBox().min[2] > -0.01), 'on the table ' + label);
      // Each pin up in its pocket under the base: the pin there, the base round it.
      const deck = stand.standHeight + 10 - KIT.deck;
      for (const [x0, y0, x1, y1] of standPins(validateBuilding({ ...BOX, ...stand }))) {
        const [x, y] = [(x0 + x1) / 2, (y0 + y1) / 2];
        assert.ok(supports.some((q) => hits(q.solid, x, y, deck + 1)), 'a pin at ' + x + ', ' + y + ' ' + label);
        assert.ok(!hits(part('base').solid, x, y, deck + 1) && hits(part('base').solid, x1 + 1, y, deck + 1), 'its pocket ' + label);
      }
    });
});

test('a column tapers up to its top; a tower stands on braced frames on its foot', () => {
  withParts({ ...BOX, standType: 'column', standHeight: 100, standSize: 20, standTaper: 50 }, (parts, part) => {
    const c = part('column').solid;
    assert.ok(hits(c, 40 + 14.5, 40, STAND.foot[0] + 0.5) && !hits(c, 40 + 14.5, 40, 100), 'wider at its foot');
    assert.ok(hits(c, 40 + 9.5, 40, 100) && !hits(c, 40 + 10.5, 40, 100), 'its top 20 mm across');
  });
  withParts({ ...BOX, standType: 'tower', standHeight: 120, standSize: 60 }, (parts, part) => {
    const front = part('tower-front');
    assert.ok(near(printSize(front)[2], STAND.frame), 'a frame prints flat');
    const fb = front.solid.boundingBox();
    assert.ok(near(fb.min[2], STAND.foot[0] - STAND.tab[1]), 'its tabs down into the foot');
    assert.ok(hits(front.solid, 10 + 1, 10 + 1, 60) && !hits(front.solid, 19, 10 + 1, 60), 'a leg at its end; open in the bay beside the X');
  });
});

test('an open storey: a waist wall, posts at the corners, a beam over the open band', () => {
  const b = validateBuilding({ ...BOX, open: true, waist: 22 });
  withParts(b, (parts, part) => {
    const front = part('front').solid;
    const top = b.baseHeight;
    assert.ok(hits(front, 40, 1.5, top + 10), 'the waist wall');
    assert.ok(!hits(front, 40, 1.5, top + 22 + 5), 'open above it');
    assert.ok(hits(front, 40, 1.5, top + b.height - OPEN.beam / 2), 'the beam at the top');
    assert.ok(hits(front, OPEN.post - 1, 1.5, top + 35), 'a corner post');
  });
  const notes = kitNotes('Post', validateBuilding({ ...BOX, standType: 'tower', standSize: 60 }), buildingLayout({ ...BOX, standType: 'tower', standSize: 60 }).parts, {});
  assert.match(notes, /Stand the four tower frames in the slots of the tower foot/);
  assert.match(kitNotes('L', validateBuilding({ ...BOX, standType: 'legs' }), buildingLayout({ ...BOX, standType: 'legs' }).parts, {}), /Stand the four legs on the table/);
  assert.match(kitNotes('C', validateBuilding({ ...BOX, standType: 'column' }), buildingLayout({ ...BOX, standType: 'column' }).parts, {}), /Stand the column on the table/);
});
