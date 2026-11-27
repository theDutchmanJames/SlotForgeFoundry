// The sawtooth and the barrel vault: their parts whole, on the plate, clear
// of each other, and printing without supports.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { buildGarage, buildingLayout, roofAt, roofShape, validateBuilding, buildingCuts } from '../src/geometry/building.js';
import { checkKit, overAir } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const free = (parts) => parts.forEach((p) => p.solid.delete());
const PLATE = { width: 220, depth: 220, margin: 0 };
const withParts = (b, fn, plate = PLATE) => {
  const parts = buildGarage(wasm, b, plate);
  try {
    fn(parts, (id) => parts.find((p) => p.id === id));
  } finally {
    free(parts);
  }
};

const SAW = { door: 'none', width: 160, depth: 180, height: 60, roof: 'sawtooth', rises: 'back', teeth: 3, pitch: 30 };
const VAULT = { door: 'none', width: 120, depth: 160, height: 55, roof: 'vault', ridge: 'depth', rise: 40 };

test('a sawtooth: a panel for each tooth, a north light between each two', () => {
  const ids = buildingLayout(SAW).parts.map((p) => p.id);
  assert.deepEqual(ids.filter((id) => /^(roof|light)/.test(id)), ['roof-1', 'roof-2', 'roof-3', 'light-1', 'light-2']);
  // No frame under it: it sits on its gabled end walls and its north lights.
  assert.ok(!ids.some((id) => id.endsWith('-frame')));
  const shape = roofShape(validateBuilding(SAW));
  // The underside climbs each tooth and drops at the next.
  assert.ok(Math.abs(roofAt(shape, 50, 59.9) - 59.9 * Math.tan(Math.PI / 6)) < 0.01);
  assert.equal(roofAt(shape, 50, 60), 0);
});

test('a sawtooth builds whole, clear and printable, on every side', () => {
  for (const rises of ['back', 'front', 'left', 'right'])
    withParts({ ...SAW, rises, roofTexture: rises === 'left' ? 'metal' : 'plain' }, (parts, part) => {
      checkKit(parts, PLATE, 'sawtooth to the ' + rises + ': ');
      for (const p of parts.filter((q) => /^roof-\d/.test(q.id))) assert.ok(overAir(p) < 0.5, p.name + ' prints over air');
      // Each north light has its panes through it.
      assert.ok(part('light-1').solid.genus() >= 3, 'panes in the north light');
      // The end walls follow the teeth: as high as a tooth over the eaves.
      const end = ['back', 'front'].includes(rises) ? part('left') : part('front');
      const rise = (180 / 3) * Math.tan(Math.PI / 6);
      if (['back', 'front'].includes(rises)) assert.ok(Math.abs(end.solid.boundingBox().max[2] - (10 + 60 + rise)) < 0.1, 'gabled end wall');
    });
});

test('a long sawtooth is cut along its teeth to fit the plate', () => {
  const b = { ...SAW, width: 300 };
  const plan = buildingCuts(b, { width: 200, depth: 200, margin: 0 });
  assert.ok(plan.roofX.cuts.length >= 1);
  assert.equal(plan.roofY.cuts.length, 0);
  withParts(b, (parts) => {
    checkKit(parts, { width: 200, depth: 200, margin: 0 }, 'long sawtooth: ');
    assert.ok(parts.some((p) => p.id === 'light-1-2'), 'a north light in pieces');
  }, { width: 200, depth: 200, margin: 0 });
});

test('a sawtooth too fine for its north lights is refused', () => {
  assert.throws(() => validateBuilding({ ...SAW, teeth: 8 }), /only 22.5 mm wide/);
  assert.throws(() => validateBuilding({ ...SAW, pitch: 10 }), /too low for its north light/);
});

test('a barrel vault stands on its end to print, every face upright', () => {
  for (const ridge of ['depth', 'width'])
    for (const roofTexture of ['plain', 'metal'])
      withParts({ ...VAULT, ridge, roofTexture, overhangFront: 6, overhangBack: 6, overhangLeft: 4, overhangRight: 4 }, (parts, part) => {
        checkKit(parts, PLATE, 'vault along the ' + ridge + ': ');
        const roof = part('roof');
        assert.ok(overAir(roof) < 0.5, 'the vault prints over air: ' + overAir(roof));
        // The arch reaches its rise over the eaves at the crown.
        assert.ok(Math.abs(roof.solid.boundingBox().max[2] - (10 + 55 + 40 + 3)) < 0.2);
        // The end walls rise into it.
        const end = ridge === 'depth' ? part('front') : part('left');
        assert.ok(end.solid.boundingBox().max[2] > 10 + 55 + 39);
      });
});

test('a long vault is cut across its axis, each piece shorter than the plate', () => {
  withParts({ ...VAULT, depth: 300 }, (parts) => {
    const pieces = parts.filter((p) => p.id.startsWith('roof'));
    assert.equal(pieces.length, 2);
    checkKit(parts, PLATE, 'long vault: ');
  });
});

test('a vault no higher than a half round, plain or corrugated', () => {
  assert.throws(() => validateBuilding({ ...VAULT, rise: 61 }), /half its span/);
  assert.doesNotThrow(() => validateBuilding({ ...VAULT, rise: 60 }));
  assert.throws(() => validateBuilding({ ...VAULT, roofTexture: 'tile' }), /plain or corrugated/);
});

test('the kit notes say how the sawtooth and the vault go together and print', async () => {
  const { kitNotes } = await import('../src/building-kit.js');
  const saw = buildingLayout(SAW);
  const sawNotes = kitNotes('Works', saw.building, saw.parts, {});
  assert.match(sawNotes, /Glue each north light upright on the end walls/);
  assert.match(sawNotes, /Each north light lies flat, its glazed face up/);
  const vault = buildingLayout({ ...VAULT, roofTexture: 'metal' });
  const vaultNotes = kitNotes('Hall', vault.building, vault.parts, {});
  assert.match(vaultNotes, /Lay the vault on the walls, its flat edges on the tops of the side walls/);
  assert.match(vaultNotes, /prints standing on its end, every face upright, its corrugations V-grooves/);
  assert.doesNotMatch(vaultNotes, /roof on its underside/);
  // One thing the right way up: said of it alone.
  const flat = buildingLayout({ roofLip: 'none' });
  assert.match(kitNotes('Shed', flat.building, flat.parts, {}), /The base prints upside down\. The roof prints the right way up/);
});

test('the standard garage takes a vault and a sawtooth: every wall whole', () => {
  for (const roof of ['vault', 'sawtooth'])
    withParts({ roof }, (parts) => {
      checkKit(parts, PLATE, roof + ' on the garage: ');
      for (const p of parts) assert.ok(p.solid.volume() > 1, p.name + ' is empty');
    });
});

test('rooms under a sawtooth or a vault: the dividing wall follows the roof, without notches for a frame it has not got', () => {
  for (const roof of ['sawtooth', 'vault'])
    withParts({ door: 'none', width: 160, depth: 180, height: 60, roof, rises: 'back', rise: 40, rooms: { along: 'width', sizes: [80, 80] } }, (parts, part) => {
      checkKit(parts, PLATE, roof + ' with rooms: ');
      const divider = part('divide1').solid;
      // Not notched at its foot ends: as tall at its ends as just inside them.
      const probe = wasm.Manifold.cube([200, 2, 300]).translate([-20, 3.3, 0]);
      const end = divider.intersect(probe);
      assert.ok(end.boundingBox().max[2] > 10 + 60 - 0.5, roof + ': the end of the dividing wall reaches up under the roof');
      end.delete();
      probe.delete();
    });
});

test('a barrel vault keeps out of the tops of the walls it bears on, whichever way its ridge runs and however wide', () => {
  // A long hall cut into pieces, and a square one: the arch's many-sided circle once cut a sliver into the walls under the eaves.
  for (const b of [{ door: 'none', width: 356, depth: 175, height: 138, roof: 'vault', ridge: 'width', rise: 33 }, { door: 'none', width: 180, depth: 175, height: 138, roof: 'vault', ridge: 'width', rise: 33 }, { door: 'none', width: 175, depth: 180, height: 138, roof: 'vault', ridge: 'depth', rise: 33 }])
    withParts(b, (parts) => checkKit(parts, PLATE, JSON.stringify(b).slice(0, 60) + ' '));
});

test('a sign along the top of the front wall is refused under a vault that comes down over it', () => {
  const hall = { door: 'none', width: 180, depth: 175, height: 138, roof: 'vault', rise: 33, sign: 'fascia', signWidth: 120, signHeight: 14, signText: 'HALL' };
  assert.throws(() => validateBuilding({ ...hall, ridge: 'width' }), /comes down over the front wall, where the sign goes/);
  // Its ridge front to back, the arch's ends are over the end walls: the sign stands on the front wall.
  withParts({ ...hall, ridge: 'depth' }, (parts) => checkKit(parts, PLATE, 'vault and sign '));
});
