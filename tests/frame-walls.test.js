// Frame walls (braced or lattice, open between their members) and mesh
// railings: each wall stays one body, prints flat over no air, and the
// open fields go straight through it.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { FRAME_WALL, buildGarage, buildingLayout, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { buildPlatform } from '../src/geometry/viewing-platform.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const withParts = (build, check) => {
  const parts = build();
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
// How much of the wall's outline is solid: its volume against a plain slab.
const solidShare = (part, L, H) => part.solid.volume() / (L * H * 3);

test('frame walls and mesh railings are checked', () => {
  assert.throws(() => validateBuilding({ door: 'none', wallStyle: 'wicker' }), /solid, braced or lattice/);
  assert.throws(() => validateBuilding({ wallStyle: 'braced' }), /Framed walls have no windows or doors/);
  assert.throws(() => validateBuilding({ door: 'none', wallStyle: 'braced', open: true }), /open or framed, not both/);
  assert.throws(() => validateBuilding({ door: 'none', wallStyle: 'lattice', cornice: 4 }), /Framed walls have no relief/);
  assert.throws(() => validateBuilding({ railingStyle: 'chain' }), /bars, of mesh or a lattice/);
  assert.ok(!buildingLayout({ door: 'none', wallStyle: 'braced' }).parts.some((p) => /^brace/.test(p.id)), 'no corner braces in a frame');
});

test('braced and lattice walls: one body each, open, flat to print over no air, nothing in another part', () => {
  for (const b of [
    { door: 'none', width: 100, depth: 80, height: 70, wallStyle: 'braced', standType: 'legs' },
    { door: 'none', width: 90, depth: 90, height: 60, wallStyle: 'lattice', roof: 'gable' },
    { door: 'none', width: 120, depth: 120, height: 60, upper: [{ width: 100, depth: 100, x: 10, y: 10, height: 50, wallStyle: 'braced', lean: 8 }] },
  ])
    withParts(
      () => buildGarage(wasm, b, PLATE),
      (parts) => {
        const label = JSON.stringify(b).slice(0, 80);
        const framed = parts.filter((p) => /^(front|back|left|right)\d?$/.test(p.id) && (b.wallStyle ? !/\d/.test(p.id) : /2$/.test(p.id)));
        assert.equal(framed.length, 4, label);
        for (const p of framed) {
          assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
          assert.ok(printSize(p)[2] < 4.5, p.name + ' lies flat ' + label);
          assert.ok(overAir(p) <= 0.5, p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air ' + label);
        }
        // Open between the members: much less than a solid wall.
        const v = validateBuilding(b);
        const s = b.wallStyle ? v : v.upper[0];
        const side = framed.find((p) => /^left/.test(p.id));
        assert.ok(solidShare(side, s.depth, s.height) < 0.75, 'open between its members: ' + solidShare(side, s.depth, s.height).toFixed(2) + ' ' + label);
        for (let i = 0; i < parts.length; i++)
          for (let j = i + 1; j < parts.length; j++) {
            const both = parts[i].solid.intersect(parts[j].solid);
            assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
            both.delete();
          }
      },
    );
  assert.ok(FRAME_WALL.styles.length === 3);
});

test('mesh railings: a field of square holes between the posts, flat to print', () => {
  const b = { door: 'none', width: 100, depth: 80, roofRailing: true };
  const volume = (style) => withParts(() => buildGarage(wasm, { ...b, railingStyle: style }, PLATE), (parts, part) => {
    const r = part('roofrail-front');
    assert.equal(r.solid.decompose().length, 1, 'one body ' + style);
    assert.ok(overAir(r) <= 0.5, 'flat to print ' + style);
    return r.solid.volume();
  });
  assert.ok(volume('mesh') > volume('bars') * 1.2, 'a mesh fills more of the railing than bars');
  withParts(() => buildPlatform(wasm, { railingStyle: 'mesh' }), (parts, part) => {
    const r = part('rail-front');
    assert.equal(r.solid.decompose().length, 1);
    assert.ok(overAir(r) <= 0.5);
  });
});
