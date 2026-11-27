// A fit test: before a big kit, a small print to find the joint clearance
// your printer needs. A block with three grooves like the base's, each a
// little wider than the last, the clearance of each raised under it, and a
// strip of wall to try in them. The groove it slides into snugly gives the
// clearance to set on your buildings.

import { KIT } from './building.js';
import { raisedText } from './lettering.js';

export const FIT_DEFAULTS = Object.freeze({ kind: 'fittest', play: 0.2 });
export const FIT_LIMITS = Object.freeze({ play: [0.1, 0.5] });
// The block, the step between its grooves, and the label under each.
export const FIT = Object.freeze({ length: 66, depth: 24, height: 6, label: 6, step: 0.1, text: 4, strip: [20, 14] });

export function validateFitTest(input) {
  const b = { ...FIT_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(b)) if (!Object.hasOwn(FIT_DEFAULTS, key)) throw Error('The fit test has an unknown setting: ' + key + '.');
  const [lo, hi] = FIT_LIMITS.play;
  if (!Number.isFinite(b.play) || b.play < lo || b.play > hi) throw Error('The joint clearance is ' + lo + ' to ' + hi + ' mm.');
  b.play = Math.round(b.play * 100) / 100;
  return b;
}
/** The three clearances tried: a step less than the one set, it, a step more. */
export const fitClearances = (b) => [-FIT.step, 0, FIT.step].map((d) => Math.round(Math.max(0.05, b.play + d) * 100) / 100);
// The block and the strip of wall lying behind it, as the kit builds them.
export const fitFootprint = () => [0, 0, FIT.length, FIT.depth + 8 + KIT.wall];
export function fitTestLayout(input) {
  const b = validateFitTest(input);
  return { building: b, parts: [{ id: 'block', name: 'Groove block', role: 'buildingBase' }, { id: 'strip', name: 'Wall strip', role: 'wall' }] };
}
export function buildFitTest(wasm, input) {
  const b = validateFitTest(input);
  const { Manifold } = wasm;
  const temp = [],
    own = (s) => (temp.push(s), s);
  const box = (x0, y0, z0, x1, y1, z1) => own(Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]));
  try {
    const { length: L, depth: D, height: H, label } = FIT;
    let block = box(0, 0, 0, L, D, H);
    const cuts = [],
      labels = [];
    fitClearances(b).forEach((c, i) => {
      const x = (L * (i + 0.5)) / 3,
        w = KIT.wall + 2 * c;
      // A groove as deep as the base's, open at the back, the label in front of it.
      cuts.push(box(x - w / 2, label, H - KIT.groove, x + w / 2, D + 1, H + 1));
      labels.push(own(raisedText(wasm, own, c.toFixed(2).replace(/0$/, ''), FIT.text, [x, label / 2], -0.01, 0.6).translate([0, 0, H])));
    });
    block = own(own(block.subtract(own(Manifold.union(cuts)))).add(own(Manifold.union(labels))));
    const [sl, sh] = FIT.strip;
    const strip = box(0, D + 8, 0, sl, D + 8 + KIT.wall, sh);
    const parts = [
      { id: 'block', name: 'Groove block', role: 'buildingBase', solid: block, lie: [0, 0, 0], apart: [0, 0, 0] },
      // The strip stands as in a groove; it prints lying on its face.
      { id: 'strip', name: 'Wall strip', role: 'wall', solid: strip, outward: [0, -1, 0], apart: [0, 10, 0] },
    ];
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of new Set(temp)) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of new Set(temp)) s.delete();
    throw e;
  }
}
