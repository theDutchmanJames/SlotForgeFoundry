// Found in review of the structures and props: each repro now gives a clear
// error or builds clean, and a valid input next to it still builds clean
// (every part one body, fitting the plate, nothing over air but the bridges
// its kind always has, nothing in another part).
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildGarage, printSize, validateBuilding } from '../src/geometry/building.js';
import { PROPS, placeProp, propFootprint } from '../src/geometry/props.js';
import { MARSHAL } from '../src/geometry/marshal-post.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
// The bridges each kind always has: a bay's tab sockets and railing pockets, a
// stand section's slots, a marshal cabin's floor sockets, a bench's cleats.
const bridges = (p) =>
  /grandstand section/i.test(p.name) ? 35
  : /^(upper-)?bench-/.test(p.id) ? 30
  : p.id.startsWith('bay') ? 200
  : p.id === 'cabin' ? 4 * (MARSHAL.peg[0] + 2 * MARSHAL.play) ** 2 + 2
  : 0.5;
const clean = (b, fn = () => {}) => {
  const parts = buildGarage(wasm, b, PLATE);
  try {
    checkKit(parts, PLATE, JSON.stringify(b).slice(0, 80) + ': ', bridges);
    fn(parts);
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const fails = (b, message) => assert.throws(() => buildGarage(wasm, b, PLATE), message);

test('a pit building’s name board stands in front of the pillars it crosses, and fits the plate', () => {
  clean({ kind: 'pitbays', types: ['box', 'box'], numbers: false, text: 'TEAM' }, (parts) => {
    const name = parts.find((p) => p.id === 'name');
    assert.ok(name.solid.boundingBox().max[1] <= -5 + 1e-6, 'in front of the pillars');
  });
  clean({ kind: 'pitbays', types: ['box', 'box', 'box'], numbers: false, text: 'TEAM RACING', doorHeight: 25 });
  // Short, between two pillars: on the wall.
  clean({ kind: 'pitbays', types: ['box', 'box', 'box'], numbers: false, text: 'AB' }, (parts) => {
    assert.ok(Math.abs(parts.find((p) => p.id === 'name').solid.boundingBox().max[1]) < 1e-6, 'on the wall');
  });
  clean({ kind: 'pitbays', types: ['single', 'podium'], numbers: false, text: 'PIT', pillars: false });
  // A modular pit building's board along the fascia is no longer than the plate either.
  clean({ kind: 'pitmodule', bays: 4, numbers: false, text: 'GRAND PRIX' });
});

test('a pit building’s bays stand on end within the plate, however tall', () => {
  fails({ kind: 'pitbays', baseHeight: 40, groundHeight: 120, upperHeight: 90, doorHeight: 100 }, /would be 266 mm high: at most 190 mm/);
  fails({ kind: 'pitmodule', baseHeight: 40, groundHeight: 120, loungeHeight: 90 }, /would be 258 mm high: at most 190 mm/);
});

test('a modular pit building’s balcony is deep enough for its railing in front of the leaning glazing', () => {
  fails({ kind: 'pitmodule', balcony: 8 }, /balcony is too short for its railing in front of the leaning glazing: at least 11 mm/);
  fails({ kind: 'pitmodule', balcony: 11, lean: 24 }, /at least 13 mm/);
  clean({ kind: 'pitmodule', balcony: 11, lean: 10, bays: 2 });
  clean({ kind: 'pitmodule', balcony: 13, lean: 24, bays: 2 });
  clean({ kind: 'pitmodule', balcony: 8, railing: false, bays: 2 });
});

test('a modular pit building’s bays are no deeper than they print on end', () => {
  fails({ kind: 'pitmodule', depth: 300 }, /would be 325 mm long: at most 190 mm/);
  clean({ kind: 'pitmodule', depth: 160, bays: 2 }, (parts) => assert.ok(printSize(parts[0]).every((v, i) => i === 2 || v <= 190)));
});

test('props under a canopy keep clear of its end screens', () => {
  fails({ kind: 'canopy', screens: 'ends', props: [{ type: 'crate', x: 0, y: 40 }] }, /Prop 1, the crate stands in a screen at the end: keep it 2 mm clear/);
  fails({ kind: 'canopy', screens: 'three', props: [{ type: 'crate', x: 160 - 24, y: 40 }] }, /in a screen at the end/);
  clean({ kind: 'canopy', screens: 'ends', props: [{ type: 'crate', x: 6, y: 40 }, { type: 'crate', x: 160 - 30, y: 40 }] });
  // Without end screens a prop may stand to the edge.
  clean({ kind: 'canopy', screens: 'back', props: [{ type: 'crate', x: 0, y: 40 }] });
});

test('a canopy is no deeper, roof or slab, than a piece that prints whole front to back', () => {
  fails({ kind: 'canopy', width: 600, depth: 180, overhang: 20, bays: 8 }, /The roof would be 220 mm from front to back, in one piece: at most 190 mm/);
  fails({ kind: 'canopy', width: 160, depth: 180, overhang: 6 }, /The roof would be 192 mm/);
  // The slab reaches 4 mm past the posts: 188 mm at the deepest.
  clean({ kind: 'canopy', width: 120, depth: 180, overhang: 0 });
  clean({ kind: 'canopy', width: 600, depth: 180, overhang: 5, bays: 8 });
  clean({ kind: 'canopy', width: 200, depth: 170, overhang: 10, bays: 2, roof: 'tent' });
  // Every standard canopy still validates.
  for (const p of BUILDING_PRESETS.filter((q) => q.building.kind === 'canopy')) validateBuilding(p.building);
});

test('a lattice or timber start gantry has no more lights than its board takes', () => {
  fails({ kind: 'gantry', members: 'lattice', span: 80, lights: 10 }, /no room for 10 start lights on a board of 48 mm: at most 6/);
  fails({ kind: 'gantry', members: 'timber', span: 100, lights: 8 }, /board of 60 mm: at most 7/);
  clean({ kind: 'gantry', members: 'lattice', span: 80, lights: 6 });
  // Without a board there are no lights to place; a solid beam carries them along the span.
  assert.doesNotThrow(() => validateBuilding({ kind: 'gantry', members: 'lattice', span: 80, lights: 10, board: false }));
  assert.doesNotThrow(() => validateBuilding({ kind: 'gantry', span: 80, lights: 10 }));
});

test('a grandstand’s sections, frames and staircases lie on the plate', () => {
  fails({ kind: 'grandstand', rows: 20 }, /A grandstand section would print 366 × 198 mm: at most 190 mm each way/);
  fails({ kind: 'grandstand', upperTier: 12 }, /The upper tier: a grandstand section would print 222/);
  fails({ kind: 'grandstand', rows: 8, raised: 100, roof: 'canopy' }, /A canopy post would print 2\d\d/);
  fails({ kind: 'grandstand', build: 'frames', rows: 12, rowDepth: 20, benchStyle: 'wood', parapet: false }, /A base board would print 243 × 180 mm/);
  clean({ kind: 'grandstand', rows: 10, length: 120 });
  clean({ kind: 'grandstand', length: 120, upperTier: 4, rows: 4, stairs: 'left', railings: true });
  // Every standard grandstand still validates.
  for (const p of BUILDING_PRESETS.filter((q) => q.building.kind === 'grandstand')) validateBuilding(p.building);
});

test('a raised marshal post’s ladder and its legs’ base lie on the plate', () => {
  fails({ kind: 'marshalpost', deckHeight: 200 }, /The ladder would be 213 mm long to print: at most 190 mm, a floor at most 177 mm up/);
  fails({ kind: 'marshalpost', width: 160, depth: 160, deckHeight: 150 }, /The legs and their base would print 172 × 2\d\d mm: at most 190 mm each way/);
  // Without the ladder the base reaches no further back than the cabin.
  clean({ kind: 'marshalpost', width: 160, depth: 160, deckHeight: 150, ladder: false, entrance: 0 });
  clean({ kind: 'marshalpost', deckHeight: 177 }, (parts) => assert.ok(printSize(parts.find((p) => p.id === 'ladder'))[1] <= 190));
  clean({ kind: 'marshalpost', width: 160, depth: 100, deckHeight: 120 });
});

test('every prop, at every turn, keeps inside its size', () => {
  for (const prop of PROPS)
    for (const rotation of [0, 90, 180, 270]) {
      const temp = [];
      const own = (s) => (temp.push(s), s);
      try {
        const [fw, fd] = propFootprint(prop.id, rotation);
        for (const q of placeProp(wasm, own, { type: prop.id, x: 0, y: 0, rotation }, 0)) {
          const { min, max } = q.solid.boundingBox();
          const label = prop.id + ' turned ' + rotation + '°' + (q.key ? ', ' + q.key : '');
          assert.ok(min[0] >= -1e-3 && min[1] >= -1e-3 && min[2] >= -1e-3, label + ' reaches out under its corner: ' + min.map((v) => v.toFixed(2)));
          assert.ok(max[0] <= fw + 1e-3 && max[1] <= fd + 1e-3, label + ' reaches past its footprint ' + fw + ' × ' + fd + ': ' + max.map((v) => v.toFixed(2)));
          assert.ok(max[2] <= prop.size[2] + 1e-3, label + ' stands taller than ' + prop.size[2] + ': ' + max[2].toFixed(2));
        }
      } finally {
        for (const s of new Set(temp)) s.delete();
      }
    }
});

test('the props redrawn to keep inside their sizes still print clean', () => {
  clean({ kind: 'props', items: ['tool-chest', 'drum', 'podium', 'tyre-wall'].map((type) => ({ type, count: 1 })) });
});
