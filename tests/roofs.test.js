// A hip roof: four panels at one pitch meeting along the hips and a short
// ridge, a pyramid on a square building. Each panel and its frame is one
// body, prints flat without supports, and the panels close the roof.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { HIP_ACROSS, KIT, buildGarage, buildingLayout, fitsPlate, printPose, printSize, roofShape, validateBuilding } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const withParts = (settings, check) => {
  const parts = buildGarage(wasm, settings, PLATE);
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
// The highest point of the parts over (x, y): the top of the roof there.
const topAt = (parts, x, y) => {
  let z = -Infinity;
  for (const p of parts) {
    const probe = wasm.Manifold.cube([0.4, 0.4, 1000]).translate([x - 0.2, y - 0.2, 0]);
    const hit = p.solid.intersect(probe);
    if (!hit.isEmpty()) z = Math.max(z, hit.boundingBox().max[2]);
    [probe, hit].forEach((s) => s.delete());
  }
  return z;
};

test('a hip roof is checked', () => {
  assert.equal(validateBuilding({ roof: 'hip', door: 'none' }).roof, 'hip');
  assert.throws(() => validateBuilding({ roof: 'hip', width: 200, depth: 100, door: 'none' }), new RegExp('at most ' + HIP_ACROSS + ' mm across, not 206'));
  const ids = buildingLayout({ roof: 'hip', door: 'none' }).parts.map((p) => p.id).filter((id) => /^roof/.test(id));
  assert.deepEqual(ids, ['roof-front', 'roof-back', 'roof-left', 'roof-right', 'roof-front-frame', 'roof-back-frame', 'roof-left-frame', 'roof-right-frame']);
  // It rises as far as the narrower side allows.
  assert.ok(near(roofShape(validateBuilding({ roof: 'hip', width: 150, depth: 90, pitch: 45, door: 'none' })).rise, 45));
  // A billboard stands on its front, level along it.
  assert.doesNotThrow(() => validateBuilding({ roof: 'hip', sign: 'billboard', door: 'none' }));
});

test('every hip roof: each panel and frame one body, flat to print, nothing in another part, the roof closed', () => {
  for (const b of [
    { roof: 'hip', width: 120, depth: 120, pitch: 35 },
    { roof: 'hip', width: 150, depth: 90, pitch: 30, roofTexture: 'tile' },
    { roof: 'hip', width: 90, depth: 140, pitch: 20, roofTexture: 'shingle', overhangFront: 10 },
    { roof: 'hip', width: 80, depth: 80, roofLip: 'none' },
  ])
    withParts({ door: 'none', ...b }, (parts) => {
      const label = JSON.stringify(b);
      const roof = parts.filter((p) => /^roof/.test(p.id));
      assert.equal(roof.length, b.roofLip === 'none' ? 4 : 8, label);
      for (const p of roof) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits ' + printSize(p) + ' ' + label);
        // Bridged: only the tops of the pockets for the frame's tabs, 6 × 2 mm each, as on a two-sided roof.
        const allowed = p.role === 'roof' && b.roofLip !== 'none' ? 60 : 0.5;
        assert.ok(overAir(p) <= allowed, p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
      // Closed: over every point of the walls there is roof, rising to the middle.
      const v = validateBuilding({ door: 'none', ...b });
      const panels = roof.filter((p) => p.role === 'roof');
      const eave = v.baseHeight + v.height;
      const t = Math.tan((v.pitch * Math.PI) / 180);
      for (const [x, y] of [[5, 5], [v.width / 2, 2], [v.width - 2, v.depth / 2], [v.width / 2, v.depth / 2], [v.width / 3, v.depth / 4]]) {
        const z = topAt(panels, x, y);
        const plane = eave + t * Math.min(x, y, v.width - x, v.depth - y);
        assert.ok(z > plane, 'roof over ' + x + ', ' + y + ': ' + z.toFixed(1) + ' over ' + plane.toFixed(1) + ' ' + label);
        assert.ok(z < plane + (KIT.roof + 1.5) / Math.cos(Math.atan(t)) + 0.5, 'and on it ' + label);
      }
    });
});

test('the walls stop under the hip roof, all at the eaves', () => {
  withParts({ roof: 'hip', width: 120, depth: 100, pitch: 30, door: 'none' }, (parts, part) => {
    const v = validateBuilding({ roof: 'hip', width: 120, depth: 100, pitch: 30, door: 'none' });
    for (const w of ['front', 'back', 'left', 'right']) assert.ok(part(w).solid.boundingBox().max[2] < v.baseHeight + v.height + 3, w + ' wall at the eaves');
  });
  const notes = kitNotes('Hip', validateBuilding({ roof: 'hip', door: 'none' }), buildingLayout({ roof: 'hip', door: 'none' }).parts, {});
  assert.match(notes, /Lay the four roof panels on the walls so they meet along the hips/);
});
