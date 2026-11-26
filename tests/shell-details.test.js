// Textures and framed windows on connected sections and shaped footprints.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildGarage, validateBuilding, buildingLayout } from '../src/geometry/building.js';
import { CONNECTED_DEFAULTS } from '../src/geometry/connected-building.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const built = (b, plate) => buildGarage(wasm, b, plate);
const free = (parts) => parts.forEach((p) => p.solid.delete());
const volumeOf = (parts, id) => parts.filter((p) => p.id === id || p.id.startsWith(id + '-')).reduce((v, p) => v + p.solid.volume(), 0);

const [hall, wing] = CONNECTED_DEFAULTS.sections;
const connected = {
  kind: 'sections',
  sections: [
    { ...hall, wallTexture: 'brick', wallTextures: { front: 'planks' }, lowerTexture: 'block', lowerHeight: 18, openings: [
      { wall: 'front', type: 'window', at: 60, width: 40, height: 30, sill: 26, frame: true, across: 2, up: 2 },
      { wall: 'front', type: 'door', at: 120, width: 28, height: 50, sill: 0, frame: true },
      { wall: 'left', type: 'window', at: 60, width: 30, height: 24, sill: 30 },
    ] },
    { ...wing, wallTexture: 'metal', openings: [{ wall: 'right', type: 'window', at: 50, width: 30, height: 22, sill: 18, frame: true, across: 3 }] },
  ],
};
const footprint = {
  kind: 'footprint', shape: 'L', wallTexture: 'planks', wallTextures: { 'edge-1': 'brick' }, lowerTexture: 'brick', lowerHeight: 14,
  openings: [
    { wall: 'edge-1', type: 'window', at: 60, width: 40, height: 28, sill: 24, frame: true, across: 2 },
    { wall: 'edge-1', type: 'door', at: 140, width: 28, height: 50, sill: 0, frame: true },
    { wall: 'edge-6', type: 'window', at: 80, width: 30, height: 28, sill: 24, frame: true, up: 2 },
  ],
};

test('connected sections: their own textures, a band and framed windows; each frame a part', () => {
  const b = validateBuilding(connected);
  assert.deepEqual(b.sections[0].wallTextures, { front: 'planks' });
  assert.equal(b.sections[1].lowerTexture, 'none');
  const ids = buildingLayout(connected).parts.map((p) => p.id);
  for (const id of ['s1-frame-1', 's1-frame-2', 's2-frame-1']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('s1-frame-3'), 'a window without a frame has none');
  const plain = built({ kind: 'sections', sections: connected.sections.map((s) => ({ ...s, wallTexture: 'plain', wallTextures: {}, lowerTexture: 'none' })) }),
    textured = built(connected);
  try {
    for (const id of ['s1-front', 's1-back', 's1-left', 's2-right']) assert.ok(volumeOf(textured, id) < volumeOf(plain, id) - 1, id + ' has joints');
    assert.ok(textured.some((p) => p.id === 's1-frame-1' && p.role === 'frame'));
  } finally {
    free(plain);
    free(textured);
  }
});

test('connected sections with textures and frames cut to fit: whole pieces, nothing over air, nothing in another part', () => {
  for (const plate of [{ width: 200, depth: 200, margin: 0 }, { width: 110, depth: 110, margin: 0 }]) {
    const parts = built(connected, plate);
    try {
      checkKit(parts, plate, plate.width + ': ');
    } finally {
      free(parts);
    }
  }
});

test('a shaped footprint: textures by wall, a band and framed windows, cut to fit and checked', () => {
  const b = validateBuilding(footprint);
  assert.deepEqual(b.wallTextures, { 'edge-1': 'brick' });
  const plain = built({ ...footprint, wallTexture: 'plain', wallTextures: {}, lowerTexture: 'none' }),
    textured = built(footprint);
  try {
    for (const id of ['edge-1', 'edge-3', 'edge-6']) assert.ok(volumeOf(textured, id) < volumeOf(plain, id) - 1, id + ' has joints');
    assert.deepEqual(textured.filter((p) => p.role === 'frame').map((p) => p.id), ['frame-1', 'frame-2', 'frame-3']);
  } finally {
    free(plain);
    free(textured);
  }
  // Shrinking to a rectangle drops the walls it no longer has.
  assert.deepEqual(validateBuilding({ ...footprint, shape: 'rectangle', wallTextures: { 'edge-6': 'metal' }, openings: [] }).wallTextures, {});
  const plate = { width: 120, depth: 120, margin: 0 },
    parts = built(footprint, plate);
  try {
    checkKit(parts, plate);
  } finally {
    free(parts);
  }
});

test('frames and panes are checked on sections and footprints', () => {
  const at = (o) => ({ kind: 'sections', sections: [{ ...hall, openings: [o] }] });
  const win = { wall: 'front', type: 'window', at: 60, width: 40, height: 30, sill: 26 };
  assert.throws(() => validateBuilding(at({ ...win, across: 2 })), /panes need a frame/);
  assert.throws(() => validateBuilding(at({ ...win, type: 'door', frame: true, up: 2 })), /door has no panes/);
  assert.throws(() => validateBuilding(at({ ...win, frame: true, across: 7 })), /1 to 6 panes across/);
  assert.throws(() => validateBuilding(at({ ...win, width: 30, frame: true, across: 6 })), /panes are too small/);
  assert.throws(() => validateBuilding(at({ ...win, frame: 'yes' })), /frame/);
  // The frame keeps the room an opening keeps: from the corner, under the eaves, between two.
  assert.doesNotThrow(() => validateBuilding(at({ ...win, at: 29 })));
  assert.throws(() => validateBuilding(at({ ...win, at: 29, frame: true })), /and their frames 9 mm from corners/);
  assert.throws(() => validateBuilding(at({ ...win, sill: 44, frame: true })), /below the eaves/);
  assert.throws(
    () => validateBuilding({ kind: 'sections', sections: [{ ...hall, openings: [{ ...win, frame: true }, { ...win, at: 110, frame: true }] }] }),
    /and their frames at least 6 mm apart/,
  );
  assert.throws(() => validateBuilding({ kind: 'sections', textureDepth: 2, sections: [hall] }), /Joint depth/);
  assert.throws(() => validateBuilding({ ...footprint, openings: [{ wall: 'edge-1', type: 'window', at: 15, width: 10, height: 20, sill: 20, frame: true }] }), /and its frame at least 9 mm/);
});
