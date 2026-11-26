// Lettering: the letters themselves, on signs, billboards and walls.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildGarage, validateBuilding } from '../src/geometry/building.js';
import { LETTERS, LETTERING, checkText, fitHeight, textShape, textStrokes, textWidth, textCarve } from '../src/geometry/lettering.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const temp = [];
const own = (s) => (temp.push(s), s);
const free = (parts) => parts.forEach((p) => p.solid.delete());
const part = (parts, id) => parts.find((p) => p.id === id);
const plain = { width: 160, depth: 120, height: 75, door: 'none', roof: 'flat' };
const line = (more) => ({ wall: 'front', text: 'PIT 3', at: 80, up: 40, height: 10, ...more });

test('the letters: capitals and figures, as wide as they say, strokes thick enough to print', () => {
  assert.equal(checkText('  Pit   lane 3 '), 'PIT LANE 3');
  assert.throws(() => checkText('Café'), /no letter for “É”/);
  assert.throws(() => checkText('x'.repeat(41)), /at most 40/);
  for (const c of LETTERS.trim()) {
    const shape = textShape(wasm, own, c, 8);
    // A full stop is a dot as wide as a stroke.
    assert.ok(shape.area() > Math.PI * (LETTERING.thinnest / 2) ** 2, c + ' has a shape');
  }
  const shape = textShape(wasm, own, 'RACE CONTROL', 8), { min, max } = shape.bounds();
  assert.ok(Math.abs(max[0] - min[0] - textWidth('RACE CONTROL', 8)) < 1e-6);
  assert.ok(Math.abs(max[1] - min[1] - 8) < 1e-6, 'as high as asked');
  assert.equal(textStrokes('A', 4).stroke, LETTERING.thinnest);
  assert.ok(Math.abs(textWidth('HQ', fitHeight('HQ', 30, 100)) - 30) < 1e-3, 'fits the width');
  assert.equal(fitHeight('HQ', 300, 12), 12, 'or the height');
  // Carved: grooves no deeper than half again their width, inside the face.
  const { solid, depth } = textCarve(wasm, own, 'HQ', 10);
  assert.ok(depth > 0 && depth < 1.2 && Math.abs(solid.boundingBox().min[2] + depth) < 1e-6);
  temp.splice(0).forEach((s) => s.delete());
});

test('a fascia sign: its text raised on its face; a roof billboard: carved in', () => {
  const fascia = { ...plain, sign: 'fascia', signWidth: 100, signHeight: 14 };
  const bare = buildGarage(wasm, fascia), lettered = buildGarage(wasm, { ...fascia, signText: 'Pit stop' });
  try {
    const a = part(bare, 'sign').solid, c = part(lettered, 'sign').solid;
    assert.ok(c.volume() > a.volume() + 5, 'letters added');
    assert.ok(Math.abs(c.boundingBox().min[1] - (a.boundingBox().min[1] - LETTERING.depth)) < 1e-6, 'standing out of the face');
  } finally {
    free(bare);
    free(lettered);
  }
  const board = { ...plain, sign: 'billboard', signWidth: 110, signHeight: 20 };
  const plainBoard = buildGarage(wasm, board), carved = buildGarage(wasm, { ...board, signText: 'Race control' });
  try {
    assert.ok(part(carved, 'sign').solid.volume() < part(plainBoard, 'sign').solid.volume() - 5, 'grooves cut');
  } finally {
    free(plainBoard);
    free(carved);
  }
  assert.throws(() => validateBuilding({ ...fascia, signWidth: 30, signText: 'Race control headquarters' }), /too small for/);
  assert.equal(validateBuilding({ ...fascia, signText: 'hq' }).signText, 'HQ');
});

test('lettering on a wall, raised or cut, the texture smooth behind it', () => {
  const bare = buildGarage(wasm, plain);
  const raised = buildGarage(wasm, { ...plain, lettering: [line()] });
  const cut = buildGarage(wasm, { ...plain, lettering: [line({ cut: true })] });
  try {
    const v = (ps) => part(ps, 'front').solid.volume();
    assert.ok(v(raised) > v(bare) + 3 && v(cut) < v(bare) - 3);
    assert.ok(part(raised, 'front').solid.boundingBox().min[1] < -LETTERING.depth + 1e-6, 'raised out of the face');
  } finally {
    [bare, raised, cut].forEach(free);
  }
  // On brick: the joints keep clear of where the letters stand.
  const brick = { ...plain, wallTexture: 'brick' };
  const a = buildGarage(wasm, brick), c = buildGarage(wasm, { ...brick, lettering: [line({ cut: true })] }), d = buildGarage(wasm, { ...plain, lettering: [line({ cut: true })] });
  try {
    // The cut letters take the same from a brick wall as from a plain one, less the joints that are not there.
    const w = textWidth('PIT 3', 10), floor = validateBuilding(plain).baseHeight;
    // Just round the letters, inside the smooth patch.
    const probe = wasm.Manifold.cube([w + 3, 6, 13]).translate([80 - w / 2 - 1.5, -3, floor + 35 - 1.5]);
    const behind = (ps) => { const hit = part(ps, 'front').solid.intersect(probe); const vol = hit.volume(); hit.delete(); return vol; };
    assert.ok(Math.abs(behind(c) - behind(d)) < 1e-3, 'smooth behind the letters: ' + behind(c) + ' and ' + behind(d));
    assert.ok(behind(a) < behind(c) + 1, 'the bare brick wall has joints there');
    probe.delete();
  } finally {
    [a, c, d].forEach(free);
  }
});

test('lettering is checked: its wall, its letters, clear of ends, openings, doors, the sign and each other', () => {
  const win = { wall: 'front', type: 'window', at: 120, width: 30, height: 24, sill: 30 };
  assert.throws(() => validateBuilding({ ...plain, lettering: [line({ wall: 'roof' })] }), /choose a wall/);
  assert.throws(() => validateBuilding({ ...plain, lettering: [line({ text: '' })] }), /no text/);
  assert.throws(() => validateBuilding({ ...plain, lettering: [line({ height: 2 })] }), /4 to 40 mm/);
  assert.throws(() => validateBuilding({ ...plain, lettering: [line({ at: 10 })] }), /does not fit along the front wall/);
  assert.throws(() => validateBuilding({ ...plain, lettering: [line({ up: 73 })] }), /too low or too high/);
  assert.throws(() => validateBuilding({ ...plain, openings: [win], lettering: [line({ at: 110 })] }), /runs over the front window/);
  assert.throws(() => validateBuilding({ ...plain, door: 'roller', doorHeight: 50, lettering: [line({ up: 20 })] }), /garage door/);
  assert.throws(() => validateBuilding({ ...plain, lettering: [line(), line({ at: 85 })] }), /runs over lettering 1/);
  assert.throws(() => validateBuilding({ ...plain, sign: 'fascia', signHeight: 14, lettering: [line({ up: 60 })] }), /too low or too high/);
  assert.throws(() => validateBuilding({ ...plain, lettering: [{ ...line(), colour: 'red' }] }), /unknown setting/);
  // Only on solid wall: not over the open band of an open storey, not on a lattice; not over a bay number.
  assert.throws(() => validateBuilding({ ...plain, open: true, waist: 25, lettering: [line({ up: 30 })] }), /too low or too high/);
  assert.doesNotThrow(() => validateBuilding({ ...plain, open: true, waist: 25, lettering: [line({ up: 12, height: 8 })] }));
  assert.throws(() => validateBuilding({ ...plain, wallStyle: 'lattice', lettering: [line()] }), /solid walls/);
  assert.throws(() => validateBuilding({ ...plain, door: 'roller', doorWidth: 60, doorHeight: 50, numbers: true, lettering: [line({ up: 62, height: 6 })] }), /bay number/);
  // Upstairs too.
  assert.throws(() => validateBuilding({ ...plain, upper: [{ height: 40, lettering: [line({ up: 38 })] }] }), /storey 2|Lettering 1/);
  assert.equal(validateBuilding({ ...plain, upper: [{ height: 40, lettering: [line({ up: 20, text: 'hq' })] }] }).upper[0].lettering[0].text, 'HQ');
});

test('lettered kits print: whole pieces, nothing over air (carved billboard included), nothing in another part', () => {
  const plate = { width: 200, depth: 200, margin: 0 };
  for (const b of [
    { ...plain, wallTexture: 'brick', sign: 'fascia', signWidth: 110, signHeight: 14, signText: 'Pit lane', lettering: [line({ wall: 'left', at: 60 }), line({ wall: 'back', cut: true, text: 'No 7' })] },
    { ...plain, sign: 'billboard', signWidth: 120, signHeight: 22, signText: 'Race control & timing', lettering: [line({ text: 'Office', height: 8 })] },
    { ...plain, width: 260, wallTexture: 'planks', lettering: [line({ text: 'Paddock entrance', at: 130, height: 12 })], upper: [{ height: 40, lettering: [line({ wall: 'right', at: 60, up: 20, text: 'HQ' })] }] },
  ]) {
    const parts = buildGarage(wasm, b, plate);
    try {
      checkKit(parts, plate);
    } finally {
      free(parts);
    }
  }
});

test('a billboard and a hoarding: the text raised across the face, shared by the pieces', () => {
  const board = { kind: 'billboard', length: 120, height: 40, text: 'Foundry oil' };
  const bare = buildGarage(wasm, { ...board, text: '' }), lettered = buildGarage(wasm, board);
  try {
    assert.ok(part(lettered, 'board-1').solid.volume() > part(bare, 'board-1').solid.volume() + 10);
    checkKit(lettered, { width: 200, depth: 200, margin: 0 });
  } finally {
    free(bare);
    free(lettered);
  }
  const hoarding = buildGarage(wasm, { kind: 'billboard', style: 'hoarding', length: 400, height: 30, clearance: 5, text: 'Grand prix of the dunes' });
  try {
    assert.ok(hoarding.filter((p) => p.id.startsWith('board-')).length > 1);
    checkKit(hoarding, { width: 200, depth: 200, margin: 0 });
  } finally {
    free(hoarding);
  }
  assert.throws(() => validateBuilding({ ...board, length: 30, height: 10, text: 'Much too long for this' }), /too small for/);
});
