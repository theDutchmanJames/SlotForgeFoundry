// Where a wing joins a hall, the walls of the building make one ring round its
// outline: no wall end is left cut at 45° for a corner the join took away, so
// no notch is left between two walls, and no two walls share material.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildConnected, connectedOutline, validateConnected } from '../src/geometry/connected-building.js';

const wasm = await Module();
wasm.setup();
const { CrossSection } = wasm;
const BUILDINGS = {
  'a wing on the back, flush with the hall’s left side': {},
  'a wing as wide as the hall, and taller': {
    sections: [{ id: 's1', name: 'Hall', width: 120, depth: 100, height: 60, roofType: 'flat' }, { id: 's2', name: 'Wing', parent: 's1', side: 'back', offset: 0, width: 120, depth: 90, height: 70, roofType: 'gable' }],
  },
  'a wing in the middle of the hall’s back': {
    sections: [{ id: 's1', name: 'Hall', width: 220, depth: 120, height: 80 }, { id: 's2', name: 'Wing', parent: 's1', side: 'back', offset: 60, width: 100, depth: 80, height: 60, roofType: 'slope', rises: 'front' }],
  },
  'a low wing on the side and a tall one in front': {
    sections: [
      { id: 's1', name: 'Hall', width: 220, depth: 120, height: 80 },
      { id: 's2', name: 'Wing', parent: 's1', side: 'right', offset: 20, width: 90, depth: 70, height: 50, roofType: 'flat' },
      { id: 's3', name: 'Front', parent: 's1', side: 'front', offset: 60, width: 100, depth: 60, height: 90, roofType: 'gable', ridge: 'depth' },
    ],
  },
};

for (const [name, input] of Object.entries(BUILDINGS)) {
  test(name + ': the walls close the outline and meet face to face', () => {
    const parts = buildConnected(wasm, input, null);
    const temp = [];
    const own = (s) => (temp.push(s), s);
    try {
      const walls = parts.filter((p) => p.role === 'wall');
      for (const w of walls) assert.equal(w.solid.decompose().length, 1, w.id + ' in one piece');
      // Just above the base: the walls' feet against the ring between the outline and 3 mm inside it.
      const feet = own(CrossSection.union(walls.map((w) => own(w.solid.slice(6.5)))));
      const outline = own(new CrossSection([connectedOutline(validateConnected(input))], 'Positive'));
      const ring = own(outline.subtract(own(outline.offset(-3, 'Miter', 2))));
      const missing = own(ring.subtract(feet)).area();
      assert.ok(missing < 0.05, 'a gap in the walls of ' + missing.toFixed(3) + ' mm²');
      // Nothing of the walls stands outside the ring.
      assert.ok(own(feet.subtract(ring)).area() < 0.05, 'a wall outside the ring');
      // No two walls share material, below the roofs or above them.
      for (let i = 0; i < walls.length; i++)
        for (let j = i + 1; j < walls.length; j++) {
          const v = own(walls[i].solid.intersect(walls[j].solid)).volume();
          assert.ok(v < 0.01, walls[i].id + ' and ' + walls[j].id + ' overlap by ' + v.toFixed(3) + ' mm³');
        }
    } finally {
      parts.forEach((p) => p.solid.delete());
      temp.forEach((s) => s.delete());
    }
  });
}
