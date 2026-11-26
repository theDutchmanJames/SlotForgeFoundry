// The viewing platform: a planked deck on braced frames, railings, a
// staircase and a board. Each part prints without supports, fits the plate
// and takes no space of another; the frames' tabs go up into the deck, the
// staircase reaches the deck, the railing leaves the way up open.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { PLATFORM, buildPlatform, platformLayout, platformStair, validatePlatform } from '../src/geometry/viewing-platform.js';
import { buildingCuts, buildingLayout, fitsPlate, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';
import { planShapes, shapeOf } from '../src/planner-buildings.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const VARIANTS = [
  {},
  { stair: 'right', planks: false, board: false },
  { stair: 'both' },
  { stair: 'none', railing: false, width: 60, depth: 50, height: 30, boardHeight: 10 },
  { width: 190, depth: 190, height: 120, stairWidth: 50, railingHeight: 40, boardHeight: 40 },
  { depth: 60, height: 90 }, // the staircase reaches out in front of the deck
];
const withParts = (settings, check) => {
  const parts = buildPlatform(wasm, settings);
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

test('a viewing platform is checked', () => {
  const p = validateBuilding({ kind: 'platform' });
  assert.deepEqual([p.width, p.depth, p.height, p.stair], [150, 110, 65, 'left']);
  assert.throws(() => validatePlatform({ stair: 'front' }), /at the left, at the right or at both ends, or leave it out/);
  assert.throws(() => validatePlatform({ height: 20 }), /Deck height must be between 30 and 120 mm\./);
  assert.throws(() => validatePlatform({ height: 40, boardHeight: 30 }), /board is too high for the frames under the deck: at most 23 mm/);
  assert.throws(() => validatePlatform({ planks: 'yes' }), /has planks/);
  assert.throws(() => validatePlatform({ colour: 'red' }), /unknown setting: colour/);
  assert.deepEqual(buildingLayout({ kind: 'platform' }).parts.map((q) => q.id), ['deck', 'frame-front', 'frame-back', 'frame-left', 'frame-right', 'stair-left', 'rail-front', 'rail-back', 'rail-left', 'rail-right', 'board']);
  assert.deepEqual(platformLayout({ stair: 'none', railing: false, board: false }).parts.map((q) => q.id), ['deck', 'frame-front', 'frame-back', 'frame-left', 'frame-right']);
  assert.deepEqual(buildingCuts({ kind: 'platform' }, PLATE), {});
  // Steps no higher than PLATFORM.rise, up to the deck.
  const s = platformStair(p);
  assert.ok(s.rise <= PLATFORM.rise && near(s.rise * s.steps, p.height));
});

test('every part is one body, fits the plate, takes no space of another, and prints without supports', () => {
  for (const settings of VARIANTS)
    withParts(settings, (parts) => {
      const label = JSON.stringify(settings);
      assert.deepEqual(parts.map((q) => q.id), platformLayout(settings).parts.map((q) => q.id), 'built as laid out ' + label);
      for (const q of parts) {
        assert.equal(q.solid.decompose().length, 1, q.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(q), PLATE), q.name + ' fits: ' + printSize(q) + ' ' + label);
        // Bridged: only the tops of the pockets under the deck for the frames' tabs.
        const g = 2 * PLATFORM.play;
        const allowed = q.id === 'deck' ? 8 * (PLATFORM.tab[0] + g) * (PLATFORM.frame + g) + 2 : 0.5;
        assert.ok(overAir(q) <= allowed, q.name + ' prints ' + overAir(q).toFixed(1) + ' mm² over air ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
    });
});

test('the frames hold the deck, braced; the staircase and the railings meet it', () => {
  const p = validatePlatform({});
  withParts({}, (parts, part) => {
    const deck = part('deck').solid,
      front = part('frame-front').solid,
      stair = part('stair-left').solid;
    const under = p.height - PLATFORM.deck,
      I = PLATFORM.inset,
      F = PLATFORM.frame;
    // A tab of the front frame up in its pocket under the deck.
    const u = I + 0.25 * (p.width - 2 * I);
    assert.ok(hits(front, u, I + F / 2, under + 1) && !hits(deck, u, I + F / 2, under + 1), 'a tab in its pocket');
    assert.ok(hits(deck, u + PLATFORM.tab[0], I + F / 2, under + 1), 'the deck round it');
    // The frame stands on the table, its leg at the corner, a brace across the bay.
    assert.ok(hits(front, I + 2, I + 1, 0.5) && hits(front, I + 2, I + 1, under - 1), 'a leg from the table to the deck');
    const fb = front.boundingBox();
    assert.ok(near(fb.min[2], 0) && near(fb.max[2], under + PLATFORM.tab[1]), 'frame ' + fb.min[2] + ' ' + fb.max[2]);
    assert.ok(hits(front, I + PLATFORM.member + 1.5, I + 1, PLATFORM.member + 1.5), 'a brace near the foot of the first bay');
    assert.ok(!hits(front, I + 30, I + 1, under / 2 + 12), 'open beside the X');
    // The landing at the top of the staircase, level with the deck, beside it.
    assert.ok(hits(stair, -5, p.depth - 10, p.height - 0.5) && !hits(stair, -5, p.depth - 10, p.height + 0.5), 'the landing level with the deck');
    const sb = stair.boundingBox();
    assert.ok(near(sb.max[0], 0) && near(sb.min[0], -p.stairWidth), 'beside the left end');
    assert.ok(near(sb.min[1], p.depth - platformStair(p).run) && near(sb.max[2], p.height + PLATFORM.parapet[1]), 'stair ' + sb.min[1] + ' ' + sb.max[2]);
    // Its first step, and hollow under the steps halfway up.
    const { rise, run } = platformStair(p);
    const y0 = p.depth - run;
    assert.ok(hits(stair, -10, y0 + 4, rise - 0.5) && !hits(stair, -10, y0 + 4, rise + 0.5), 'the first step');
    assert.ok(!hits(stair, -10, y0 + run / 2, 3), 'hollow under the steps');
    // The left railing stops short of the landing: the way up is open.
    const left = part('rail-left').solid.boundingBox();
    assert.ok(left.max[1] < p.depth - PLATFORM.landing, 'the way up open: ' + left.max[1]);
    assert.ok(near(part('rail-front').solid.boundingBox().max[2], p.height + p.railingHeight), 'railing height');
    // The board under the deck, flush with its front.
    const bb = part('board').solid.boundingBox();
    assert.ok(near(bb.min[1], 0) && near(bb.max[1], I) && near(bb.max[2], under, 0.02), 'the board');
  });
  // On the right, the staircase is the other way round.
  withParts({ stair: 'right' }, (parts, part) => {
    assert.ok(!part('stair-left'), 'only the right');
    const sb = part('stair-right').solid.boundingBox();
    assert.ok(near(sb.min[0], p.width) && near(sb.max[0], p.width + p.stairWidth), 'beside the right end');
    assert.ok(part('rail-right').solid.boundingBox().max[1] < p.depth - PLATFORM.landing, 'the right end open at the top');
    assert.ok(part('rail-left').solid.boundingBox().max[1] > p.depth - PLATFORM.landing, 'the left end closed');
  });
  // At both ends: a staircase up each, mirror images, both ends open at the top.
  withParts({ stair: 'both' }, (parts, part) => {
    const l = part('stair-left').solid.boundingBox(),
      r = part('stair-right').solid.boundingBox();
    assert.ok(near(l.max[0], 0) && near(r.min[0], p.width) && near(r.max[0] - r.min[0], l.max[0] - l.min[0]), 'one each end');
    assert.ok(near(part('stair-left').solid.volume(), part('stair-right').solid.volume(), 0.5), 'mirror images');
    for (const end of ['left', 'right']) assert.ok(part('rail-' + end).solid.boundingBox().max[1] < p.depth - PLATFORM.landing, 'the ' + end + ' end open at the top');
  });
  const both = validatePlatform({ stair: 'both' });
  assert.deepEqual(shapeOf(both).outline[0][0], -both.stairWidth);
  assert.deepEqual(shapeOf(both).outline[2][0], both.width + both.stairWidth);
  assert.match(kitNotes('V', both, [], {}), /a staircase up each end/);
  assert.match(kitNotes('V', validatePlatform({ stair: 'none' }), [], {}), /^(?!.*staircase)/s);
});

test('the frames, the railings and the staircase lie flat to print; the deck has planks', () => {
  withParts({}, (parts, part) => {
    assert.ok(near(printSize(part('frame-front'))[2], PLATFORM.frame, 0.05), 'frame ' + printSize(part('frame-front')));
    assert.ok(near(printSize(part('rail-left'))[2], PLATFORM.rail.thick, 0.05), 'railing ' + printSize(part('rail-left')));
    assert.ok(near(printSize(part('stair-left'))[2], 30, 0.05), 'stair ' + printSize(part('stair-left')));
    const p = validatePlatform({});
    const deck = part('deck').solid;
    assert.ok(!hits(deck, 50, PLATFORM.plank[0], p.height - 0.2, 0.1) && hits(deck, 50, PLATFORM.plank[0] + 2, p.height - 0.2, 0.1), 'a groove between planks');
  });
});

test('on the plan and in the notes', () => {
  const p = validatePlatform({});
  const { outline, front } = shapeOf(p);
  assert.deepEqual(outline[0], [-p.stairWidth, 0]);
  assert.deepEqual(outline[2], [p.width, p.depth]);
  assert.deepEqual(front, { p: [75, 0], f: [0, -1] });
  // A deep staircase reaches out in front of a shallow deck.
  assert.ok(shapeOf(validatePlatform({ depth: 60, height: 90 })).outline[0][1] < 0);
  const shapes = planShapes({ id: 'b-1', name: 'V', building: p, pose: { x: 0, y: 0, a: 0 } });
  assert.equal(shapes.storeys.length, 1);
  const notes = kitNotes('Deck', p, [{ id: 'deck', name: 'Deck' }], { deck: [150, 110, 5] });
  assert.match(notes, /A deck 150 × 110 mm, 65 mm above the table, a staircase up its left end/);
  assert.match(notes, /the tabs of the frames up into the pockets underneath/);
  assert.match(notes, /- Deck: 150 × 110 × 5 mm/);
});
