// A finish per wall, and a band of another texture along the foot of the walls.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildGarage, validateBuilding, printPose, printSize, fitsPlate } from '../src/geometry/building.js';
import { checkFinish, textureOf, isTextured, bandTop } from '../src/geometry/building-texture.js';

const wasm = await Module();
wasm.setup();
const box = (x0, y0, z0, x1, y1, z1) => wasm.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);

const plain = { width: 120, depth: 140, height: 75, door: 'none', roof: 'flat' };
const volumes = (b) => {
  const parts = buildGarage(wasm, b);
  try {
    return Object.fromEntries(parts.map((p) => [p.id, p.solid.volume()]));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
// How much of a part lies between two heights.
const between = (b, id, z0, z1) => {
  const parts = buildGarage(wasm, b);
  try {
    const cut = box(-50, -50, z0, 400, 400, z1),
      hit = parts.find((p) => p.id === id).solid.intersect(cut);
    const v = hit.volume();
    hit.delete();
    cut.delete();
    return v;
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const overAir = (part) => {
  const printed = printPose(part),
    m = printed.getMesh();
  let over = 0;
  for (let i = 0; i < m.triVerts.length; i += 3) {
    const v = [0, 1, 2].map((k) => Array.from(m.vertProperties.subarray(m.triVerts[i + k] * m.numProp, m.triVerts[i + k] * m.numProp + 3)));
    const a = v[1].map((x, j) => x - v[0][j]),
      c = v[2].map((x, j) => x - v[0][j]);
    const n = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]],
      len = Math.hypot(...n);
    if (len && n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
  }
  printed.delete();
  return over;
};

test('a finish is checked: a wall of its own, the band and its height', () => {
  const b = validateBuilding({ ...plain, wallTexture: 'planks', wallTextures: { front: 'brick', back: 'planks' }, lowerTexture: 'block', lowerHeight: 18 });
  // A wall the same as the rest keeps nothing of its own.
  assert.deepEqual(b.wallTextures, { front: 'brick' });
  assert.equal(textureOf(b, 'front'), 'brick');
  assert.equal(textureOf(b, 'left'), 'planks');
  assert.equal(bandTop(b, 6), 24);
  assert.ok(isTextured({ wallTexture: 'plain', wallTextures: {}, lowerTexture: 'brick' }));
  assert.ok(!isTextured({ wallTexture: 'plain', wallTextures: {}, lowerTexture: 'plain' }));
  assert.throws(() => validateBuilding({ ...plain, wallTextures: { front: 'velvet' } }), /texture for the front wall/);
  assert.throws(() => validateBuilding({ ...plain, wallTextures: ['brick'] }), /texture for each wall/);
  assert.throws(() => validateBuilding({ ...plain, lowerTexture: 'velvet' }), /lower walls/);
  assert.throws(() => validateBuilding({ ...plain, lowerTexture: 'brick', lowerHeight: 70 }), /lower walls reach 8 to 67 mm/);
  assert.throws(() => validateBuilding({ ...plain, lowerTexture: 'brick', lowerHeight: 4 }), /lower walls/);
  assert.throws(() => validateBuilding({ ...plain, upper: [{ height: 40, lowerTexture: 'brick', lowerHeight: 35 }] }), /lower walls for storey 2/);
  // Walls a shape no longer has keep no texture.
  assert.deepEqual(checkFinish({ wallTexture: 'plain', wallTextures: { 'edge-9': 'brick', 'edge-1': 'metal' } }, ['edge-1', 'edge-2'], 60).wallTextures, { 'edge-1': 'metal' });
});

test('a wall of its own: only that wall gets the joints', () => {
  const none = volumes(plain),
    front = volumes({ ...plain, wallTextures: { front: 'brick' } });
  assert.ok(front.front < none.front - 1, 'the front has joints');
  for (const w of ['back', 'left', 'right']) assert.ok(Math.abs(front[w] - none[w]) < 1e-6, w + ' stays plain');
});

test('a band along the foot: its joints below it, the texture above it, a smooth strip between', () => {
  const b = { ...plain, lowerTexture: 'brick', lowerHeight: 20 };
  const floor = validateBuilding(plain).baseHeight;
  const split = floor + 20;
  // Bricks below the band's top, nothing cut above it.
  assert.ok(between(b, 'front', floor, split - 0.3) < between(plain, 'front', floor, split - 0.3) - 1);
  assert.ok(Math.abs(between(b, 'front', split - 0.3, 200) - between(plain, 'front', split - 0.3, 200)) < 1e-6);
  // Planks above, bricks below: the strip between is whole.
  const both = { ...b, wallTexture: 'planks' };
  assert.ok(Math.abs(between(both, 'left', split - 0.29, split + 0.29) - between(plain, 'left', split - 0.29, split + 0.29)) < 1e-6);
  assert.ok(between(both, 'left', split + 0.3, 200) < between(plain, 'left', split + 0.3, 200) - 1);
});

test('finishes cut to fit a small plate: whole pieces, nothing over air, nothing in another part', () => {
  const plate = { width: 110, depth: 110, margin: 0 };
  for (const b of [
    { ...plain, width: 180, wallTexture: 'brick', wallTextures: { front: 'planks', left: 'metal' }, lowerTexture: 'block', lowerHeight: 24 },
    { ...plain, width: 180, wallTexture: 'planks', lowerTexture: 'brick', lowerHeight: 16, upper: [{ height: 50, wallTexture: 'boards', wallTextures: { back: 'brick' }, lowerTexture: 'crack', lowerHeight: 12 }] },
  ]) {
    const parts = buildGarage(wasm, b, plate);
    try {
      for (const p of parts) {
        const bodies = p.solid.decompose();
        assert.equal(bodies.length, 1, p.name);
        bodies.forEach((s) => s.delete());
        assert.ok(fitsPlate(printSize(p), plate), p.name + ': ' + printSize(p));
        if (!/^(base|roof|floor)/.test(p.id)) assert.ok(overAir(p) <= 0.5, p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air');
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap by ' + both.volume());
          both.delete();
        }
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
});
