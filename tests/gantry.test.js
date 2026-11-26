// Gantries and bridges over the track: a start gantry, a half gantry and a
// footbridge, each printing without supports, and spanning a straight.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { GANTRY, buildGantry, gantryLayout, stairOf, validateGantry } from '../src/geometry/gantry.js';
import { buildGarage, fitsPlate, printPose, printSize } from '../src/geometry/building.js';
import { OVER_CLEAR, overGantry, overPose, overlap, straightAcross, toPlan } from '../src/planner-buildings.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const VARIANTS = [{}, { type: 'half', reach: 180 }, { type: 'bridge' }, { span: 400, lights: 0, board: false }, { type: 'bridge', span: 300, clearance: 100 }];
const withParts = (settings, plate, check) => {
  const parts = buildGantry(wasm, { kind: 'gantry', ...settings }, plate);
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

test('a gantry is checked', () => {
  const g = validateGantry({});
  assert.deepEqual([g.type, g.span, g.clearance, g.lights], ['start', 220, 70, 5]);
  assert.throws(() => validateGantry({ type: 'arch' }), /start gantry, a half gantry or a footbridge/);
  assert.throws(() => validateGantry({ span: 30 }), /Span must be between 60 and 1200 mm/);
  assert.throws(() => validateGantry({ span: 60, lights: 10 }), /no room for 10 start lights on a beam of 60 mm: at most 7/);
  assert.throws(() => validateGantry({ lights: 2.5 }), /whole number/);
  assert.deepEqual(gantryLayout({ type: 'bridge' }).parts.map((p) => p.id), ['stair-1', 'stair-2', 'deck']);
  assert.equal(stairOf(validateGantry({ clearance: 70 })).steps, 10);
});

test('every part is one body, fits the plate, takes no space of another, and prints without supports', () => {
  for (const settings of VARIANTS)
    withParts(settings, PLATE, (parts) => {
      const label = JSON.stringify(settings);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits: ' + printSize(p) + ' ' + label);
        // Only the top of a pin socket in the beam is bridged, 6.3 mm across.
        const sockets = p.id.startsWith('beam') ? 2 * (GANTRY.pin[0] + 0.3) * (GANTRY.pin[1] + 0.2 + 1) : 0;
        assert.ok(overAir(p) <= sockets + 1, p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
    });
});

test('the beam drops onto the pins of the legs; the walkway lies on the landings', () => {
  withParts({}, null, (_, part) => {
    const leg = part('leg-1').solid.boundingBox(),
      beam = part('beam').solid.boundingBox();
    assert.ok(near(leg.max[2], 70 + GANTRY.pin[1]), 'the pin stands above the clearance: ' + leg.max[2]);
    assert.ok(near(beam.min[2], 70), 'the beam sits at the clearance');
  });
  withParts({ type: 'bridge' }, null, (_, part) => {
    const stair = part('stair-1').solid.boundingBox(),
      deck = part('deck').solid.boundingBox();
    assert.ok(near(stair.max[2], 70) && near(deck.min[2], 70));
    assert.ok(deck.min[0] < stair.max[0] - 10, 'the walkway reaches onto the landing');
  });
});

test('over a straight a gantry takes its width, its span centred on the road, its feet clear of it', () => {
  // A straight 300 long along x, 110 wide, borders included.
  const road = [[[0, -55], [300, -55], [300, 55], [0, 55]]];
  const over = straightAcross({ xy: [0, 0] }, { xy: [300, 0] }, road);
  assert.ok(near(over.width, 110) && near(over.at[0], 150) && near(over.at[1], 0));
  for (const type of ['start', 'half', 'bridge']) {
    const building = overGantry(validateGantry({ type }), over.width);
    assert.equal(building.span, 110 + 2 * OVER_CLEAR + (type === 'bridge' ? 0 : GANTRY.foot[0] - GANTRY.leg));
    const entry = { id: 'b-1', name: 'G', building, pose: overPose(building, over) };
    assert.ok(overlap(entry, road) < 0.5, type + ': its feet stand clear of the road');
  }
  // The start gantry's legs stand each side of the road, the span's middle on its middle.
  const start = overGantry(validateGantry({}), over.width);
  const entry = { id: 'b-1', name: 'G', building: start, pose: overPose(start, over) };
  const left = toPlan(entry, [GANTRY.foot[0] / 2, GANTRY.foot[0] / 2]);
  assert.ok(near(left[0], 150, 0.01) && left[1] < -55, 'a leg beside the road: ' + left);
});

test('lattice members: legs as tubes and the beam as a girder opened with diamonds, one body each, printing without supports', async () => {
  const { GANTRY, legOf } = await import('../src/geometry/gantry.js');
  const { fitsPlate, printPose, printSize } = await import('../src/geometry/building.js');
  const over = (part) => {
    const printed = printPose(part);
    const m = printed.getMesh();
    let a = 0;
    for (let i = 0; i < m.triVerts.length; i += 3) {
      const v = [0, 1, 2].map((k) => Array.from(m.vertProperties.subarray(m.triVerts[i + k] * m.numProp, m.triVerts[i + k] * m.numProp + 3)));
      const p = v[1].map((x, j) => x - v[0][j]),
        q = v[2].map((x, j) => x - v[0][j]);
      const n = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
      const len = Math.hypot(...n);
      if (n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) a += len / 2;
    }
    printed.delete();
    return a;
  };
  const plate = { width: 200, depth: 200, margin: 0 };
  for (const settings of [{ members: 'lattice' }, { members: 'lattice', type: 'half', reach: 180 }, { members: 'lattice', type: 'bridge' }, { members: 'lattice', lights: 0, span: 400 }, { members: 'timber' }, { members: 'timber', type: 'half' }, { members: 'timber', type: 'bridge' }, { members: 'timber', span: 400, clearance: 120 }]) {
    const parts = buildGantry(wasm, settings, plate);
    try {
      const label = JSON.stringify(settings);
      for (const p of parts) {
        assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
        assert.ok(fitsPlate(printSize(p), plate), p.name + ' fits ' + label);
        // Bridged: only the tops of the pin sockets in the beam.
        assert.ok(over(p) <= (p.id.startsWith('beam') ? 30 : 0.5), p.name + ' prints ' + over(p).toFixed(1) + ' mm² over air ' + label);
      }
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
          both.delete();
        }
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
  // Opened: a lattice leg is a tube with diamonds, far lighter than it would be solid.
  const parts = buildGantry(wasm, { members: 'lattice' });
  try {
    const L = legOf({ members: 'lattice' });
    assert.equal(L, GANTRY.lattice.leg);
    assert.ok(parts.find((p) => p.id === 'leg-1').solid.volume() < 0.75 * L * L * 70, 'a tube with diamonds, far lighter than a solid column');
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
  assert.throws(() => validateGantry({ members: 'wood' }), /solid, lattice or timber/);
  // Timber: the same open truss with chunkier members, the board of planks.
  assert.ok(legOf({ members: 'timber' }) > legOf({ members: 'lattice' }));
  assert.deepEqual(gantryLayout({ members: 'timber' }).parts.map((p) => p.id), gantryLayout({ members: 'lattice' }).parts.map((p) => p.id));
  {
    // A board less than its box: the grooves (and the light holes) cut from it; for timber the grooves too.
    const shortOf = (members) => {
      const kit = buildGantry(wasm, { members, lights: 0 });
      const s = kit.find((p) => p.id === 'board').solid;
      const { min, max } = s.boundingBox();
      const v = (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]) - s.volume();
      kit.forEach((p) => p.solid.delete());
      return v;
    };
    assert.ok(shortOf('lattice') < 0.01 && shortOf('timber') > 20, 'grooves between the planks');
  }
  // Laid out as open legs, two girders and a board; the girders glued to the faces of the legs.
  assert.deepEqual(gantryLayout({ members: 'lattice' }).parts.map((p) => p.id), ['leg-1', 'leg-2', 'beam-front', 'beam-back', 'beam-top', 'board']);
  assert.deepEqual(gantryLayout({ members: 'lattice', type: 'half', board: false }).parts.map((p) => p.id), ['leg-1', 'beam-front', 'beam-back', 'beam-top']);
  const kit = buildGantry(wasm, { members: 'lattice' });
  try {
    const leg = kit.find((p) => p.id === 'leg-1').solid.boundingBox(),
      front = kit.find((p) => p.id === 'beam-front').solid.boundingBox(),
      back = kit.find((p) => p.id === 'beam-back').solid.boundingBox(),
      board = kit.find((p) => p.id === 'board').solid.boundingBox();
    const near = (a, b) => Math.abs(a - b) < 0.01;
    assert.ok(near(front.max[1], leg.min[1] + (leg.max[1] - leg.min[1] - GANTRY.lattice.leg) / 2) || front.max[1] <= leg.max[1], 'the front girder against the legs');
    assert.ok(back.min[1] > front.max[1] + GANTRY.lattice.leg - 0.01, 'the back girder behind them');
    assert.ok(near(board.max[1], front.min[1]), 'the board on the front girder');
    assert.ok(near(front.min[2], 70) && near(leg.max[2], 70 + GANTRY.lattice.girder[0]), 'the girders at the top of the legs');
    // The top lies on both girders and the legs, closing the beam.
    const top = kit.find((p) => p.id === 'beam-top').solid.boundingBox();
    assert.ok(near(top.min[2], leg.max[2]) && near(top.min[1], front.min[1]) && near(top.max[1], back.max[1]), 'the top over both girders');
  } finally {
    kit.forEach((p) => p.solid.delete());
  }
});

test('a half gantry can carry a box sign on its leg instead of a beam', async () => {
  const { kitNotes } = await import('../src/building-kit.js');
  assert.throws(() => validateGantry({ type: 'start', sign: true }), /for a half gantry/);
  assert.throws(() => validateGantry({ type: 'half', sign: true, boardHeight: 12 }), /at least 20 mm high/);
  assert.throws(() => validateGantry({ type: 'half', hut: true }), /unknown setting: hut/);
  const plate = { width: 200, depth: 200, margin: 0 };
  for (const settings of [{ type: 'half', members: 'lattice', sign: true, boardHeight: 40 }, { type: 'half', sign: true, boardHeight: 30 }, { type: 'half', sign: true, reach: 400, boardHeight: 60, clearance: 140 }]) {
    const kit = buildGantry(wasm, settings, plate);
    try {
      const g = validateGantry(settings);
      for (const p of kit) {
        assert.equal(p.solid.decompose().length, 1, p.name);
        assert.ok(overAir(p) < 0.5, p.name + ' prints without supports ' + JSON.stringify(settings));
      }
      for (let i = 0; i < kit.length; i++)
        for (let j = i + 1; j < kit.length; j++) {
          const both = kit[i].solid.intersect(kit[j].solid);
          assert.ok(both.volume() < 0.01, kit[i].name + ' and ' + kit[j].name + ' overlap');
          both.delete();
        }
      const signs = kit.filter((p) => /^sign/.test(p.id)).map((p) => p.solid.boundingBox());
      assert.ok(signs.every((b) => Math.abs(b.min[2] - g.clearance) < 0.01 && Math.abs(b.max[2] - g.clearance - g.boardHeight) < 0.01), 'on top of the leg, as high as the board');
      assert.ok(!kit.some((p) => /^beam|^board/.test(p.id)), 'no beam with a box sign');
      assert.match(kitNotes('Gantry', g, gantryLayout(g, plate).parts, {}), /Glue the box sign on top of the leg/);
    } finally {
      kit.forEach((p) => p.solid.delete());
    }
  }
});

// Found 2026-11-26: the beam prints on its back, its front up, the sockets for the legs' pins across
// it; a square socket's front printed over air. The pin and its socket are pointed at 45° to the front.
test('a solid beam prints with nothing over air: its pin sockets pointed to the front', async () => {
  const { checkKit } = await import('./print-checks.js');
  for (const type of ['start', 'half']) {
    const parts = buildGarage(wasm, { kind: 'gantry', type, members: 'solid', span: 180, reach: 160 }, { width: 200, depth: 200, margin: 0 });
    try {
      checkKit(parts, { width: 200, depth: 200, margin: 0 }, type + ': ');
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
});
