// A freestanding billboard on two posts, or a hoarding in pieces along the
// track: each board one flat piece with its posts, a strut behind each post.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { BILLBOARD, billboardFootprint, billboardPieces, billboardPosts, validateBillboard } from '../src/geometry/billboard.js';
import { buildGarage, buildingLayout, fitsPlate, printPose, printSize } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';
import { shapeOf } from '../src/planner-buildings.js';
import { sizeLine } from '../src/geometry/grandstand.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
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
    if (len && n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
  }
  printed.delete();
  return over;
};
const VARIANTS = [
  { kind: 'billboard' },
  { kind: 'billboard', style: 'hoarding', length: 400, height: 18, clearance: 3 },
  { kind: 'billboard', style: 'hoarding', length: 1000, height: 30, clearance: 0, border: false },
  { kind: 'billboard', length: 60, height: 100, clearance: 80 },
];

test('a billboard is checked', () => {
  assert.throws(() => validateBillboard({ style: 'banner' }), /two posts or a hoarding/);
  assert.throws(() => validateBillboard({ length: 300 }), /at most 180 mm long: a longer one is a hoarding/);
  assert.throws(() => validateBillboard({ clearance: 120, height: 100 }), /at most 190 mm high/);
  assert.throws(() => validateBillboard({ height: 5 }), /Board height must be between 10 and 120 mm/);
  assert.equal(sizeLine(validateBillboard({ style: 'hoarding', length: 400 })), 'Hoarding · 400 × 40 mm');
});

test('a hoarding has a post at least every pitch, in pieces no longer than a plate allows, each ending at a post', () => {
  for (const length of [120, 400, 1000, 1500]) {
    const b = validateBillboard({ style: 'hoarding', length });
    const posts = billboardPosts(b);
    assert.ok(near(posts[0], BILLBOARD.post / 2) && near(posts.at(-1), length - BILLBOARD.post / 2), 'posts at both ends');
    for (let k = 1; k < posts.length; k++) assert.ok(posts[k] - posts[k - 1] <= BILLBOARD.pitch + 1e-9);
    const pieces = billboardPieces(b);
    assert.ok(near(pieces[0][0], 0) && near(pieces.at(-1)[1], length));
    for (let k = 0; k < pieces.length; k++) {
      assert.ok(pieces[k][1] - pieces[k][0] <= BILLBOARD.piece + 1e-9, 'a piece fits ' + length);
      if (k) assert.ok(near(pieces[k][0], pieces[k - 1][1]), 'end to end');
    }
  }
});

test('every part is one body, flat to print, fitting the plate, nothing in another; a strut behind each post', () => {
  for (const settings of VARIANTS) {
    const label = JSON.stringify(settings);
    const parts = buildGarage(wasm, settings);
    try {
      assert.deepEqual(parts.map((p) => p.id), buildingLayout(settings).parts.map((p) => p.id), 'built as laid out ' + label);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' one body ' + label);
        assert.ok(overAir(p) < 0.5, p.name + ' prints flat ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
      const b = validateBillboard(settings);
      assert.equal(parts.filter((p) => /^strut/.test(p.id)).length, billboardPosts(b).length);
      // The board as high as set; each strut against the back of a post.
      const board = parts.find((p) => p.id === 'board-1').solid.boundingBox();
      assert.ok(near(board.max[2], b.clearance + b.height) && near(board.min[2], 0), 'posts from the table to the top');
      assert.ok(near(parts.find((p) => p.id === 'strut-1').solid.boundingBox().min[1], BILLBOARD.thick), 'the strut behind the post');
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
});

test('on the plan it faces the track; the notes put it together', () => {
  const b = validateBillboard({ style: 'hoarding', length: 400 });
  const s = shapeOf(b);
  assert.deepEqual(billboardFootprint(b).slice(0, 3), [0, 0, 400]);
  assert.ok(near(s.front.f[1], -1));
  assert.match(kitNotes('Hoarding', b, buildingLayout(b).parts, {}), /glue each against the post at the start of the next/);
  assert.match(kitNotes('Hoarding', b, buildingLayout(b).parts, {}), new RegExp('a post every ' + BILLBOARD.pitch + ' mm'));
});
