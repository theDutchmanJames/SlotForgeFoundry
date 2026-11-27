// A pergola over a row of picnic tables: a frame of posts under a beam along
// each side and a roof of slats across them, in bays no longer than
// PERGOLA.longest; each part one body, flat, nothing over air, clear of the
// tables and of each other.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { PERGOLA, PICNIC, pergolaBays, picnicFootprint, validatePicnic } from '../src/geometry/picnic.js';
import { buildGarage, buildingLayout, fitsPlate, printSize } from '../src/geometry/building.js';
import { kitNotes } from '../src/building-kit.js';
import { shapeOf } from '../src/planner-buildings.js';
import { checkKit, overAir } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
// The cleats under a top or a seat bridge the gaps between its planks, as in every picnic table.
const bridges = (p) => (/^(top|seat)/.test(p.id) ? 30 : 0.5);

test('a pergola is checked, and its bays and footprint follow the row', () => {
  assert.throws(() => validatePicnic({ pergola: 'yes' }), /pergola/);
  const one = validatePicnic({ count: 2, length: 60, gap: 30, pergola: true });
  const [mx, my] = PERGOLA.margin;
  assert.deepEqual(picnicFootprint(one), [-mx, -my, 150 + mx, PICNIC.depth + my]);
  assert.deepEqual(pergolaBays(one), [[-mx, 150 + mx]]);
  const long = validatePicnic({ count: 4, length: 70, gap: 20, pergola: true });
  const bays = pergolaBays(long);
  assert.equal(bays.length, 3);
  assert.ok(bays.every(([a, b]) => b - a <= PERGOLA.longest + 1e-9));
  assert.ok(Math.abs(bays[0][0] + mx) < 1e-9 && Math.abs(bays[2][1] - (340 + mx)) < 1e-9, 'end to end over the row');
  assert.deepEqual(pergolaBays(validatePicnic({ count: 2 })), [], 'none without a pergola');
  // In the layout the row and its posts stand where the footprint says.
  const box = shapeOf(one).box;
  assert.deepEqual(box, [-mx, -my, 150 + mx, PICNIC.depth + my]);
});

test('a pergola prints: flat frames and a flat roof, clear of the tables, the layout naming every part', () => {
  for (const settings of [{ kind: 'picnic', count: 2, length: 60, gap: 30, pergola: true }, { kind: 'picnic', count: 4, length: 70, gap: 20, pergola: true }, { kind: 'picnic', count: 1, length: 40, pergola: true }]) {
    const parts = buildGarage(wasm, settings, PLATE);
    try {
      assert.deepEqual(parts.map((p) => p.id), buildingLayout(settings).parts.map((p) => p.id));
      checkKit(parts, PLATE, JSON.stringify(settings) + ' ', bridges);
      const pergola = parts.filter((p) => /^pergola/.test(p.id));
      assert.equal(pergola.length, 3 * pergolaBays(validatePicnic(settings)).length);
      for (const p of pergola) {
        assert.ok(overAir(p) < 0.5, p.name + ' prints flat');
        assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits the plate');
      }
      // The roof sits on the beams; the posts stand on the table.
      const roof = parts.find((p) => /^pergola-roof/.test(p.id)).solid.boundingBox();
      assert.ok(Math.abs(roof.max[2] - (PERGOLA.height + PERGOLA.slat[1])) < 1e-6);
      const frame = parts.find((p) => /^pergola-front/.test(p.id)).solid.boundingBox();
      assert.ok(Math.abs(frame.min[2]) < 1e-6 && Math.abs(frame.max[2] - PERGOLA.height) < 1e-6);
      // Each frame is a post thick, outside the seats.
      assert.ok(frame.max[1] <= 0 && frame.max[1] - frame.min[1] - PERGOLA.post < 1e-6);
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
});

test('the kit notes tell how the pergola goes together', () => {
  const p = validatePicnic({ count: 4, length: 70, gap: 20, pergola: true });
  const notes = kitNotes('Pergola', p, buildingLayout(p).parts, {});
  assert.match(notes, /a pergola: posts under a beam along each side/);
  assert.match(notes, /bay after bay, end to end/);
  assert.match(notes, /5\. Stand it beside the track\./);
  const plain = kitNotes('Tables', validatePicnic({ count: 1 }), buildingLayout({ kind: 'picnic' }).parts, {});
  assert.doesNotMatch(plain, /pergola/i);
  assert.match(plain, /3\. Stand it beside the track\./);
});
