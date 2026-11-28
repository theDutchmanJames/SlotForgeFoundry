// A timing caravan for the timekeepers at a rally stage's start or finish, at
// toy 1:32 proportions, on one axle: a serving hatch with a counter and a
// flap propped over it, a door on the other side, an A-frame drawbar with a
// jockey leg, corner steadies and an aerial. The body is one solid that
// prints upright on its underside, its windows, door and lettering cut in;
// the wheels print flat on their outer faces and glue into their arches.
// x along it from its front, y across it (its hatch side, towards the road,
// at y = 0), z up.

import { kitShapes } from './kit-shapes.js';
import { tagged } from './building-texture.js';
import { checkText, fitHeight, raisedText, letterDepth } from './lettering.js';

export const TIMING_CARAVAN_DEFAULTS = Object.freeze({
  kind: 'caravan',
  length: 96,
  width: 50,
  height: 56, // its roof above the table
  text: 'TIMING', // cut over the hatch
});
export const TIMING_CARAVAN_LIMITS = Object.freeze({ length: [70, 140], width: [40, 64], height: [44, 75] });
export const CARAVAN = Object.freeze({
  wheel: 9, // its radius
  tread: 6,
  under: 11, // the underside above the table
  corner: 9, // the roof rounded down to the front and the back
  steady: 2.4,
  hatch: [0.42, 14], // a share of the length wide, high
  aerial: [1.8, 24], // the mast square, tall
  recess: 0.8, // windows cut this deep
  line: [0.5, 0.4], // the door's outline: wide, deep
  play: 0.2,
});
const LABELS = { length: 'Length', width: 'Width', height: 'Height' };

export function validateCaravan(input) {
  const v = { ...TIMING_CARAVAN_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(v)) if (!Object.hasOwn(TIMING_CARAVAN_DEFAULTS, key)) throw Error('The timing caravan has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(TIMING_CARAVAN_LIMITS))
    if (!Number.isFinite(v[key]) || v[key] < min || v[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + ' mm.');
  v.text = checkText(v.text ?? '', 'The lettering');
  return v;
}
const axleOf = (v) => v.length * 0.55;
/** On the table: [x0, y0, x1, y1], the drawbar out in front. */
export const caravanFootprint = (v) => [-30, -13, v.length, v.width];

export function caravanLayout(input) {
  const v = validateCaravan(input);
  const parts = [
    { id: 'body', name: 'Caravan', role: 'wall' },
    { id: 'wheel-left', name: 'Wheel, left', role: 'buildingBase' },
    { id: 'wheel-right', name: 'Wheel, right', role: 'buildingBase' },
    { id: 'flap', name: 'Hatch flap', role: 'frame' },
    { id: 'drawbar', name: 'Drawbar', role: 'frame' },
    { id: 'jockey', name: 'Jockey leg', role: 'frame' },
  ];
  for (let k = 1; k <= 4; k++) parts.push({ id: 'steady-' + k, name: 'Corner steady ' + k, role: 'frame' });
  parts.push({ id: 'aerial', name: 'Aerial', role: 'frame' });
  return { building: v, parts };
}

export function buildCaravan(wasm, input) {
  const v = validateCaravan(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { box, poly, sweep } = kitShapes(wasm, own);
  const { Manifold, CrossSection } = wasm;
  const K = CARAVAN;
  const L = v.length,
    W = v.width,
    H = v.height,
    r = K.wheel,
    z0 = K.under,
    R = K.corner;
  // An outline in (x, z), swept across y.
  const across = (pts, y0, y1) => sweep(pts, [1, 0, 0], [0, 0, 1], [0, 0, 0], [0, 1, 0], y0, y1);
  // A cylinder along y from y0 to y1, round (x, z).
  const alongY = (x, z, rad, y0, y1) => own(own(own(Manifold.cylinder(Math.abs(y1 - y0), rad, rad, 48)).translate([0, 0, Math.min(y0, y1)])).rotate([-90, 0, 0])).translate([x, 0, z]);
  // A recess in a face: an outline in (u, v), u along a and v along b from o, cut in along n.
  const recess = (pts, a, b, o, n) => sweep(pts, a, b, o, n, -1, K.recess);
  const rect = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const parts = [];
  try {
    // Its outline from the side: the roof rounded down to the front and the back, the front's foot cut back.
    const arc = (cx, cz, a0, a1) => Array.from({ length: 9 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / 8;
      return [cx + R * Math.cos(a), cz + R * Math.sin(a)];
    });
    const outline = [[6, z0], [L - 3, z0], [L, z0 + 3], ...arc(L - R, H - R, 0, Math.PI / 2), ...arc(R, H - R, Math.PI / 2, Math.PI), [0, z0 + 8]];
    const ax = axleOf(v);
    const cuts = [alongY(ax, r, r + 1.2, -1, K.play + K.tread), alongY(ax, r, r + 1.2, W - K.play - K.tread, W + 1)];
    // The serving hatch in the left side, deep; windows at the front and the back, and on the door's side.
    const [share, hh] = K.hatch;
    const hw = L * share,
      hx = L * 0.45,
      hs = z0 + 0.28 * (H - z0);
    cuts.push(box(hx - hw / 2, -1, hs, hx + hw / 2, 3, hs + hh));
    cuts.push(recess(rect(8, z0 + 16, W - 8, H - R - 2), [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0]));
    cuts.push(recess(rect(-(W - 12), z0 + 18, -12, H - R - 2), [0, -1, 0], [0, 0, 1], [L, 0, 0], [-1, 0, 0]));
    cuts.push(recess(rect(-(L * 0.82), hs, -(L * 0.62), hs + hh), [-1, 0, 0], [0, 0, 1], [0, W, 0], [0, -1, 0]));
    // A hole in the roof for the aerial.
    const [mast, tall] = K.aerial;
    const mx = L - 16;
    cuts.push(box(mx - mast / 2 - K.play, W / 2 - mast / 2 - K.play, H - 2.5, mx + mast / 2 + K.play, W / 2 + mast / 2 + K.play, H + 1));
    let body = own(across(outline, 0, W).subtract(own(Manifold.union(cuts))));
    // The counter under the hatch: its underside sloping back to the wall, so it prints without support.
    const counter = own(own(poly([[0.01, hs], [-3.5, hs], [-3.5, hs - 1.2], [0.01, hs - 4.7]]).extrude(hw + 2)).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, hx - hw / 2 - 1, 0, 0, 1]));
    body = own(body.add(counter));
    // The door's outline and the lettering, cut in and marked, so the view shows them darker.
    const [lw, ld] = K.line;
    const dx0 = L * 0.18,
      dx1 = dx0 + 20;
    const lines = [box(dx0, W - ld, z0 + 3, dx0 + lw, W + 1, z0 + 37), box(dx1 - lw, W - ld, z0 + 3, dx1, W + 1, z0 + 37), box(dx0, W - ld, z0 + 37 - lw, dx1, W + 1, z0 + 37)];
    // Over the hatch, above the flap, below where the roof curves over.
    if (v.text) {
      const above = hs + hh + 2.2;
      const h = Math.min(7, fitHeight(v.text, hw + 6, H - R - 0.5 - above));
      if (h >= 4) {
        const [w0, w1] = letterDepth(true);
        // In the side's frame: u along x, v up, w out of it towards the road.
        lines.push(own(raisedText(wasm, own, v.text, h, [0, 0], w0, w1).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, hx, 0, above + h / 2, 1])));
      }
    }
    body = own(body.subtract(tagged(own, own(Manifold.union(lines)), 'plain', 1)));
    parts.push({ id: 'body', name: 'Caravan', role: 'wall', solid: body, lie: [0, 0, 0], apart: [0, 0, 0] });
    // The wheels: a disc with a hub in its outer face, on the axle in its arch.
    for (const [side, y0, y1] of [['left', K.play, K.play + K.tread], ['right', W - K.play, W - K.play - K.tread]]) {
      const lo = Math.min(y0, y1),
        hi = Math.max(y0, y1),
        outer = y0; // the hub's face
      const hub = alongY(ax, r, r * 0.58, outer < hi ? lo - 0.01 : hi - 1, outer < hi ? lo + 1 : hi + 0.01);
      const boss = alongY(ax, r, r * 0.22, outer < hi ? lo : hi - 1, outer < hi ? lo + 1 : hi);
      const wheel = own(own(alongY(ax, r, r, lo, hi).subtract(hub)).add(boss));
      const out = side === 'left' ? [0, -1, 0] : [0, 1, 0];
      parts.push({ id: 'wheel-' + side, name: 'Wheel, ' + side, role: 'buildingBase', solid: wheel, outward: out, apart: [0, out[1] * 12, 0] });
    }
    // The flap, held out over the hatch.
    parts.push({ id: 'flap', name: 'Hatch flap', role: 'frame', solid: box(hx - hw / 2 - 1, -13, hs + hh + 0.5, hx + hw / 2 + 1, 0, hs + hh + 1.9), lie: [0, 0, 0], apart: [0, -10, 6] });
    // The drawbar: two bars from under the front to the coupling, flat on top against the underside.
    const t = 2.5;
    const barCs = own(CrossSection.union([poly([[16, 5], [16, 9], [-22, W / 2 + 1.5], [-22, W / 2 - 1.5]]), poly([[16, W - 9], [16, W - 5], [-22, W / 2 + 1.5], [-22, W / 2 - 1.5]])]));
    const bars = own(own(barCs.extrude(t)).translate([0, 0, z0 - t]));
    const head = box(-29, W / 2 - 3, z0 - 5, -20, W / 2 + 3, z0);
    parts.push({ id: 'drawbar', name: 'Drawbar', role: 'frame', solid: own(Manifold.union([bars, head])), flip: true, apart: [-10, 0, -4] });
    // The jockey leg under the coupling, and a steady at each corner, in from the front past where its foot is cut back.
    parts.push({ id: 'jockey', name: 'Jockey leg', role: 'frame', solid: box(-17, W / 2 - 1.4, 0, -14.2, W / 2 + 1.4, z0 - t - 0.01), outward: [1, 0, 0], apart: [-6, 0, 0] });
    const st = K.steady;
    [[8, 4], [L - 6 - st, 4], [8, W - 4 - st], [L - 6 - st, W - 4 - st]].forEach(([x, y], i) =>
      parts.push({ id: 'steady-' + (i + 1), name: 'Corner steady ' + (i + 1), role: 'frame', solid: box(x, y, 0, x + st, y + st, z0 - 0.01), outward: [1, 0, 0], apart: [0, 0, -4] }),
    );
    // The aerial: a mast with a bar across its top, its foot in the hole in the roof.
    const aerial = own(Manifold.union([box(mx - mast / 2, W / 2 - mast / 2, H - 2.3, mx + mast / 2, W / 2 + mast / 2, H + tall), box(mx - mast / 2, W / 2 - 6, H + tall - 1.4, mx + mast / 2, W / 2 + 6, H + tall)]));
    parts.push({ id: 'aerial', name: 'Aerial', role: 'frame', solid: aerial, outward: [1, 0, 0], apart: [0, 0, 10] });
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}

export function caravanNotes(name, v, parts, sizes, fmt) {
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((x) => fmt(x)).join(' × ') + ' mm' : '')).join('\n');
  return [
    name + ' · SlotForge Foundry timing caravan kit',
    '',
    'A timing caravan ' + fmt(v.length) + ' mm long, ' + fmt(v.width) + ' mm wide and ' + fmt(v.height) + ' mm high on one axle, a serving hatch with a counter in its left side' + (v.text ? ', ' + v.text + ' over it.' : '.'),
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports. The caravan stands on its underside, the counter’s underside sloping; the wheels lie on their outer faces, the drawbar upside down, the legs and the aerial on their sides.',
    '',
    'Putting it together',
    '1. Glue the wheels into their arches, their hubs out, and the drawbar under the front, its coupling forward, the jockey leg under the coupling.',
    '2. Glue a steady under each corner, standing on the table, and the flap over the hatch, propped out.',
    '3. Push the aerial into the hole in the roof.',
  ].join('\n');
}
