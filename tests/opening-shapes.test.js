// Arched, pointed and round openings; sills, lintels and shutters; door leaves;
// stone and half-timbered walls: on every kind of building, whole and printing
// without supports.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildGarage, buildingLayout, validateBuilding } from '../src/geometry/building.js';
import { outlineOf, riseOf } from '../src/geometry/opening-shapes.js';
import { glazingSheets } from '../src/building-glazing.js';
import { CONNECTED_DEFAULTS } from '../src/geometry/connected-building.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 220, depth: 220, margin: 0 };
const withParts = (b, fn) => {
  const parts = buildGarage(wasm, b, PLATE);
  try {
    fn(parts, (id) => parts.find((p) => p.id === id));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const win = (o) => ({ type: 'window', wall: 'left', at: 90, width: 30, height: 34, sill: 20, frame: true, across: 2, up: 2, ...o });
const door = (o) => ({ type: 'door', wall: 'back', at: 60, width: 28, height: 48, ...o });

test('an outline: square, a round arch, a pointed arch, a circle; each closed, within its width and height', () => {
  for (const shape of ['square', 'arch', 'pointed', 'round']) {
    const o = { shape, width: 30, height: shape === 'round' ? 30 : 40 };
    const pts = outlineOf(o);
    const us = pts.map((p) => p[0]),
      zs = pts.map((p) => p[1]);
    assert.ok(Math.abs(Math.min(...us) + 15) < 1e-6 && Math.abs(Math.max(...us) - 15) < 1e-6, shape + ' width');
    assert.ok(Math.abs(Math.min(...zs)) < 1e-6 && Math.abs(Math.max(...zs) - o.height) < 1e-6, shape + ' height');
    let twice = 0;
    for (let i = 0; i < pts.length; i++) twice += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    assert.ok(twice > 0, shape + ' counter-clockwise');
  }
  assert.equal(riseOf('arch', 30), 15);
});

test('shapes and extras are checked, saying why', () => {
  const ok = (o) => validateBuilding({ door: 'none', openings: [o] }).openings[0];
  assert.equal(ok(win({ shape: 'round', width: 24, height: 40, frame: false, across: 1, up: 1 })).height, 24, 'a round window is as high as wide');
  assert.throws(() => ok(win({ shape: 'arch', height: 16 })), /at least 19 mm high/);
  assert.throws(() => ok(door({ shape: 'round' })), /not round/);
  assert.throws(() => ok(door({ shutters: true })), /no sill ledge or shutters/);
  assert.throws(() => ok(win({ leaf: 'plain' })), /no door in it/);
  assert.throws(() => ok(win({ shape: 'arch', shutters: true })), /beside a square window/);
  assert.throws(() => ok(win({ shutters: true, at: 30 })), /with its shutters reaches into a corner/);
  assert.throws(() => ok(win({ ledge: true, sill: 4 })), /sill under the .* needs the window/);
  assert.throws(() => ok(win({ lintel: true, sill: 34 })), /lintel over the .* reaches too high/);
  assert.throws(() => ok(win({ counter: true, shape: 'arch' })), /square window without shutters/);
  assert.throws(() => validateBuilding({ door: 'none', openings: [win({ shutters: true, at: 60, width: 24 }), win({ shutters: true, at: 110, width: 24 })] }), /too close/);
});

test('on a plain building: arches, a round window, shutters, sills, lintels and doors, whole and printing flat', () => {
  const b = {
    door: 'none',
    wallTexture: 'brick',
    openings: [
      win({ shape: 'arch', lintel: true }),
      win({ wall: 'right', shape: 'pointed', ledge: true, lintel: true }),
      win({ wall: 'front', at: 35, shape: 'round', width: 22, frame: false, across: 1, up: 1, lintel: true }),
      win({ wall: 'front', at: 85, width: 20, shutters: true, ledge: true, lintel: true }),
      door({ shape: 'arch', frame: true, leaf: 'panels', lintel: true }),
    ],
  };
  withParts(b, (parts, part) => {
    checkKit(parts, PLATE, 'plain: ');
    // The arched frame is a part; the lintel, sill, shutters and leaf are in the walls.
    assert.ok(part('frame-1') && part('frame-5'));
  });
  // A door's leaf fills its doorway, less what its panels sink.
  withParts({ door: 'none', openings: [door({})] }, (open) =>
    withParts({ door: 'none', openings: [door({ leaf: 'plain' })] }, (plain) =>
      withParts({ door: 'none', openings: [door({ leaf: 'panels' })] }, (panels) => {
        const v = (ps) => ps.find((p) => p.id === 'back').solid.volume();
        assert.ok(Math.abs(v(plain) - v(open) - 28 * 48 * 1.2) < 1, 'a plain leaf, 1.2 mm thick');
        assert.ok(v(panels) < v(plain) - 10, 'panels sunk in it');
      }),
    ),
  );
});

test('on shaped and connected buildings too', () => {
  const fp = { kind: 'footprint', shape: 'octagon', width: 140, depth: 140, wallTexture: 'stone', openings: [{ wall: 'edge-1', type: 'door', at: 27, width: 22, height: 48, sill: 0, shape: 'arch', leaf: 'planks', lintel: true }, { wall: 'edge-3', type: 'window', at: 27, width: 20, height: 30, sill: 20, shape: 'pointed', frame: true, across: 2, up: 1, ledge: true }] };
  withParts(fp, (parts) => checkKit(parts, PLATE, 'octagon: '));
  const [hall, wing] = CONNECTED_DEFAULTS.sections;
  const sections = { kind: 'sections', sections: [{ ...hall, wallTexture: 'timber', openings: [{ wall: 'front', type: 'window', at: 60, width: 24, height: 30, sill: 25, shutters: true, ledge: true }, { wall: 'front', type: 'door', at: 140, width: 26, height: 50, sill: 0, leaf: 'glazed', frame: true }] }, wing] };
  withParts(sections, (parts) => checkKit(parts, PLATE, 'sections: '));
});

test('stone and half-timbered walls at any size', () => {
  for (const wallTexture of ['stone', 'timber'])
    for (const textureScale of [60, 140])
      withParts({ wallTexture, textureScale, door: 'none', openings: [win({ shape: 'arch' })] }, (parts) => checkKit(parts, PLATE, wallTexture + ' ' + textureScale + ': '));
});

test('glazing: an arched window gets its own shape, a half-glazed door a sheet over its glass', () => {
  const sheets = glazingSheets({ door: 'none', openings: [win({ shape: 'arch' }), door({ leaf: 'glazed' })] });
  const arch = sheets.find((s) => /Left window/.test(s.name));
  assert.ok(arch.points.length > 10, 'an arch outline');
  const glass = sheets.find((s) => /glazed door/.test(s.name));
  assert.ok(glass, 'a sheet for the door');
});

test('the kit notes say the trims and doors are part of their walls', async () => {
  const { kitNotes } = await import('../src/building-kit.js');
  const { building, parts } = buildingLayout({ door: 'none', openings: [win({ shutters: true, width: 20 }), door({ leaf: 'panels' })] });
  const notes = kitNotes('Cottage', building, parts, {});
  assert.match(notes, /sills, lintels, shutters and doors are part of their walls/i);
});
