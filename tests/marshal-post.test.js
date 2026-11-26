// Marshal posts: a cabin with a waist wall and a roof on corner posts, on
// the ground or raised on legs with a ladder. Each part prints without
// supports, fits the plate and takes no space of another; the pegs, pins and
// the ladder meet what they go into.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { MARSHAL, buildMarshalPost, legOf, marshalLevels, marshalPostLayout, validateMarshalPost } from '../src/geometry/marshal-post.js';
import { buildingCuts, buildingLayout, fitsPlate, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';
import { planShapes, shapeOf } from '../src/planner-buildings.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const PRESETS = BUILDING_PRESETS.filter((p) => p.building.kind === 'marshalpost');
const VARIANTS = [
  {},
  ...PRESETS.map((p) => p.building),
  { walls: 'boards', roof: 'flat', number: 12, fall: 0 },
  { walls: 'plain', ladder: false, entrance: 0, numbers: false, deckHeight: 20, overhang: 0 },
  { width: 160, depth: 40, wallHeight: 10, roomHeight: 25, fall: 5, entrance: 60, number: 88 },
];
const withParts = (settings, check) => {
  const parts = buildMarshalPost(wasm, settings);
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

test('a marshal post is checked', () => {
  const m = validateBuilding({ kind: 'marshalpost' });
  assert.deepEqual([m.width, m.depth, m.deckHeight, m.walls, m.roof], [80, 72, 40, 'slats', 'tin']);
  assert.throws(() => validateMarshalPost({ walls: 'glass' }), /slats, boards or plain/);
  assert.throws(() => validateMarshalPost({ roof: 'gable' }), /tin or a flat roof/);
  assert.throws(() => validateMarshalPost({ deckHeight: 10 }), /at least 20 mm above the table; 0 puts it on the ground/);
  assert.throws(() => validateMarshalPost({ width: 30 }), /Width must be between 40 and 160 mm\./);
  assert.throws(() => validateMarshalPost({ width: 60, entrance: 50 }), /too wide for a cabin of 60 mm: at most 44 mm/);
  assert.throws(() => validateMarshalPost({ roomHeight: 35 }), /at least 8 mm above the wall at the back/);
  assert.throws(() => validateMarshalPost({ entrance: 12 }), /ladder needs an opening of at least 20 mm/);
  assert.throws(() => validateMarshalPost({ number: 2.5 }), /whole number/);
  assert.throws(() => validateMarshalPost({ colour: 'red' }), /unknown setting: colour/);
  // On the ground a ladder is not needed, whatever the opening.
  assert.doesNotThrow(() => validateMarshalPost({ deckHeight: 0, entrance: 0 }));
  assert.deepEqual(buildingLayout({ kind: 'marshalpost' }).parts.map((p) => p.id), ['cabin', 'stand', 'roof', 'ladder', 'number']);
  assert.deepEqual(buildingLayout({ kind: 'marshalpost', deckHeight: 0 }).parts.map((p) => p.id), ['cabin', 'roof', 'number']);
  assert.deepEqual(buildingCuts({ kind: 'marshalpost' }, PLATE), {});
  // Three standards: a low post, a shelter on the ground, a tall post.
  assert.deepEqual(PRESETS.map((p) => p.id), ['marshal-low', 'marshal-shelter', 'marshal-tall']);
  for (const p of PRESETS) assert.doesNotThrow(() => validateBuilding(p.building), p.id);
});

test('every part is one body, fits the plate, takes no space of another, and prints without supports', () => {
  for (const settings of VARIANTS)
    withParts(settings, (parts) => {
      const label = JSON.stringify(settings);
      assert.deepEqual(parts.map((p) => p.id), marshalPostLayout(settings).parts.map((p) => p.id), 'built as laid out ' + label);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(p.solid.volume() > 20, p.name + ' has substance ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits: ' + printSize(p) + ' ' + label);
        // Bridged: only the tops of the sockets under a raised floor.
        const allowed = p.id === 'cabin' ? 4 * (MARSHAL.peg[0] + 2 * MARSHAL.play) ** 2 + 2 : 0.5;
        assert.ok(overAir(p) <= allowed, p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
    });
});

test('the roof and the ladder lie flat to print', () => {
  withParts({ fall: 20, deckHeight: 120, roomHeight: 50 }, (parts, part) => {
    // The roof lies on its underside: only its thickness and the ribs high.
    assert.ok(near(printSize(part('roof'))[2], MARSHAL.roof + MARSHAL.rib[1], 0.05), 'roof ' + printSize(part('roof')));
    assert.ok(near(printSize(part('ladder'))[2], MARSHAL.ladder.thick, 0.05), 'ladder ' + printSize(part('ladder')));
    assert.ok(near(printSize(part('number'))[2], MARSHAL.disc[1] + 0.8, 0.05), 'number ' + printSize(part('number')));
  });
});

test('the legs, the posts and the ladder meet what they go into', () => {
  const m = validateMarshalPost({});
  const L = marshalLevels(m);
  withParts({}, (parts, part) => {
    const cabin = part('cabin').solid,
      stand = part('stand').solid,
      roof = part('roof').solid,
      ladder = part('ladder').solid;
    // A leg stands under the floor, its peg up in a socket.
    const g = legOf(m) / 2 + 1;
    assert.ok(hits(stand, g, g, L.floor - 1) && hits(stand, g, g, L.floor + 1), 'a leg and its peg');
    assert.ok(!hits(cabin, g, g, L.floor + 1) && hits(cabin, g + 3.5, g, L.floor + 1), 'its socket in the floor');
    // A post reaches the roof: just under its underside, the post; just over, the roof round its pin.
    const P = MARSHAL.post,
      under = (y) => L.roof - L.slope * y;
    assert.ok(hits(cabin, P / 2 + 2.5, P / 2, under(P / 2) - 0.3) && hits(roof, P / 2 + 2.5, P / 2, under(P / 2) + 0.3), 'front post under the roof');
    assert.ok(hits(cabin, m.width - P / 2, m.depth - P / 2, under(m.depth - P / 2) + 1), 'the pin up into the roof');
    assert.ok(!hits(roof, m.width - P / 2, m.depth - P / 2, under(m.depth - P / 2) + 1, 0.1), 'the hole for the pin');
    // The roof falls to the back, reaching out at the front.
    const rb = roof.boundingBox();
    assert.ok(near(rb.min[1], -m.overhang, 0.01) && near(rb.max[1], m.depth + MARSHAL.side, 0.6), 'roof ' + rb.min[1] + ' ' + rb.max[1]);
    assert.ok(hits(roof, 20, 0, under(0) + 1) && !hits(roof, 20, m.depth, under(0) + 1), 'falls to the back');
    // The ladder: from the base up to the opening in the back wall.
    const lb = ladder.boundingBox();
    assert.ok(near(lb.min[2], MARSHAL.base) && near(lb.max[2], L.top + MARSHAL.ladder.above), 'ladder ' + lb.min[2] + ' ' + lb.max[2]);
    assert.ok(lb.max[1] <= L.back - MARSHAL.margin + 0.01, 'its foot on the base');
    assert.ok(!hits(cabin, m.width / 2, m.depth - 1.5, L.top + 5), 'the opening in the back wall');
    assert.ok(hits(cabin, m.width / 2, 1.5, L.top + 2), 'the front wall closed at its foot');
  });
});

test('a tall post stands on thicker legs', () => {
  withParts({ deckHeight: 120 }, (parts, part) => {
    const g = MARSHAL.leg[1] / 2 + 1,
      stand = part('stand').solid;
    // A leg 10 mm square: solid 4.8 mm either side of its middle, halfway up.
    assert.ok(hits(stand, g - 4.8, g, 60) && hits(stand, g + 4.8, g, 60), 'a leg of ' + MARSHAL.leg[1] + ' mm');
  });
  assert.equal(legOf(validateMarshalPost({})), MARSHAL.leg[0]);
});

test('slats and boards are cut into the wall', () => {
  const m = validateMarshalPost({});
  const L = marshalLevels(m);
  const z = (L.top + L.wall) / 2;
  // Count the gaps along the front wall, through its middle.
  const gaps = (parts) => {
    const cabin = parts.find((p) => p.id === 'cabin').solid;
    let n = 0,
      was = true;
    for (let x = 0; x <= m.width; x += 0.5) {
      const solid = hits(cabin, x, 1.5, z, 0.1);
      if (!solid && was) n++;
      was = solid;
    }
    return n;
  };
  withParts({ numbers: false }, (parts) => assert.ok(gaps(parts) >= 6, 'slats: ' + gaps(parts)));
  withParts({ walls: 'plain', numbers: false }, (parts) => assert.equal(gaps(parts), 0));
  withParts({ walls: 'boards' }, (parts, part) => {
    const cabin = part('cabin').solid;
    const z0 = L.top + MARSHAL.board[0];
    assert.ok(!hits(cabin, 20, 0.2, z0, 0.1) && hits(cabin, 20, 0.2, z0 + 2, 0.1) && hits(cabin, 20, MARSHAL.board[1] + 0.3, z0, 0.1), 'a V-groove in the front');
    assert.ok(!hits(cabin, 0.2, 30, z0, 0.1), 'and round the side');
  });
});

test('on the plan and in the notes', () => {
  const m = validateMarshalPost({});
  const L = marshalLevels(m);
  const { outline, front } = shapeOf(m);
  assert.deepEqual(outline[0], [-MARSHAL.margin, -MARSHAL.margin]);
  assert.ok(near(outline[2][1], L.back));
  assert.deepEqual(front, { p: [m.width / 2, -MARSHAL.margin], f: [0, -1] });
  const ground = shapeOf(validateMarshalPost({ deckHeight: 0 }));
  assert.deepEqual(ground.outline[2], [80, 72]);
  const shapes = planShapes({ id: 'b-1', name: 'M', building: m, pose: { x: 0, y: 0, a: 0 } });
  assert.equal(shapes.storeys.length, 1);
  const notes = kitNotes('Post', m, [{ id: 'cabin', name: 'Cabin' }], { cabin: [80, 72, 70] });
  assert.match(notes, /A low marshal post: a cabin 80 × 72 mm/);
  assert.match(notes, /pegs on top of the legs/);
  assert.match(notes, /- Cabin: 80 × 72 × 70 mm/);
  assert.match(kitNotes('S', validateMarshalPost({ deckHeight: 0 }), [], {}), /A marshal shelter/);
});
