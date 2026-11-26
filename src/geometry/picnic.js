// A picnic table, as a wooden one: a top of planks and a seat of planks each
// side, the planks with gaps between them, joined by cleats underneath, on
// two A-frame ends set in from the ends of the planks (two legs splayed from
// under the top to the table, a bearer under the top and one under both
// seats). The top and the seats print upside down, their planks on the plate
// and the cleats up; the ends print flat. x along the table, y from the
// front seat (the track at negative y) to the back, z up.

import { kitShapes } from './kit-shapes.js';
import { BENCH, planksAcross } from './bench.js';

export const PICNIC_DEFAULTS = Object.freeze({
  kind: 'picnic',
  length: 60,
  count: 1, // tables in a row
  gap: 15, // between two
});
export const PICNIC_LIMITS = Object.freeze({
  length: [40, 150],
  count: [1, 6],
  gap: [5, 60],
});
export const PICNIC = Object.freeze({
  top: [23, 8, 32], // the top: its height, from y to y
  seat: [14, 9], // a seat: its height, deep
  depth: 40, // front seat to back seat, outside
  leg: 3, // a leg, wide
  foot: 3, // a leg's foot in from the outside of the seats
});
const LABELS = { length: 'Length', count: 'Tables', gap: 'Gap' };

/** The picnic table as kept: known settings only, each checked. */
export function validatePicnic(input) {
  const p = { ...PICNIC_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(p)) if (!Object.hasOwn(PICNIC_DEFAULTS, key)) throw Error('The picnic table has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(PICNIC_LIMITS))
    if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'count' ? '' : ' mm') + '.');
  if (!Number.isInteger(p.count)) throw Error('Tables are a whole number.');
  return p;
}

/** Where each table starts along the row. */
export const picnicStarts = (p) => Array.from({ length: p.count }, (_, k) => k * (p.length + p.gap));
/** The row on the table, [x0, y0, x1, y1]. */
export const picnicFootprint = (p) => [0, 0, p.count * p.length + (p.count - 1) * p.gap, PICNIC.depth];

/** The parts of the picnic tables, without geometry. */
export function picnicLayout(input) {
  const p = validatePicnic(input);
  const parts = [];
  picnicStarts(p).forEach((_, k) => {
    const n = p.count > 1 ? ' ' + (k + 1) : '';
    const id = (s) => s + (p.count > 1 ? '-' + (k + 1) : '');
    parts.push(
      { id: id('top'), name: 'Top' + n, role: 'roof' },
      { id: id('seat-front'), name: 'Seat, front' + n, role: 'wall' },
      { id: id('seat-back'), name: 'Seat, back' + n, role: 'wall' },
      { id: id('end-left'), name: 'End' + n + ', left', role: 'frame' },
      { id: id('end-right'), name: 'End' + n + ', right', role: 'frame' },
    );
  });
  return { building: p, parts };
}

/** The picnic tables, built. */
export function buildPicnic(wasm, input) {
  const p = validatePicnic(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { box, poly, sweep } = kitShapes(wasm, own);
  const [, , pt] = BENCH.plank,
    [cw, ct] = BENCH.cleat,
    I = BENCH.inset,
    et = BENCH.end,
    br = BENCH.bearer;
  const [Ht, ty0, ty1] = PICNIC.top,
    [Hs, sd] = PICNIC.seat,
    D = PICNIC.depth,
    lw = PICNIC.leg;
  const rect = (y0, z0, y1, z1) => poly([[y0, z0], [y1, z0], [y1, z1], [y0, z1]]);
  const bar = (a, c) => {
    const d = [c[0] - a[0], c[1] - a[1]],
      l = Math.hypot(...d),
      n = [(-d[1] / l) * (lw / 2), (d[0] / l) * (lw / 2)];
    return poly([[a[0] - n[0], a[1] - n[1]], [c[0] - n[0], c[1] - n[1]], [c[0] + n[0], c[1] + n[1]], [a[0] + n[0], a[1] + n[1]]]);
  };
  // An end in (y, z): a bearer under the top, one under both seats, two legs
  // splayed from under the top to the table outside the seats' inner edges.
  const topUnder = Ht - pt,
    seatUnder = Hs - pt;
  const f = PICNIC.foot;
  const legs = [bar([ty0 + 5, topUnder - br / 2], [f + lw / 2, 0]), bar([ty1 - 5, topUnder - br / 2], [D - f - lw / 2, 0])].map((b) => own(b.intersect(rect(-5, 0, D + 5, topUnder))));
  // Where a leg passes a seat, the seat's planks go through it: the leg stops there, held by the bearer under the seat.
  const seats = own(wasm.CrossSection.union([rect(-1, seatUnder, sd, Hs + 1), rect(D - sd, seatUnder, D + 1, Hs + 1)]));
  const endCs = own(own(wasm.CrossSection.union([rect(ty0 + 1, topUnder - br, ty1 - 1, topUnder), rect(0, seatUnder - br, D, seatUnder), ...legs])).subtract(seats));
  const parts = [];
  try {
    picnicStarts(p).forEach((x0, k) => {
      const n = p.count > 1 ? ' ' + (k + 1) : '';
      const id = (s) => s + (p.count > 1 ? '-' + (k + 1) : '');
      const L = p.length;
      // Cleats just inside each end, and in the middle of a long table.
      const xs = [x0 + I + et, x0 + L - I - et - cw];
      if (L > 80) xs.push(x0 + L / 2 - cw / 2);
      // Planks along the table between y0 and y1, their tops at z; cleats under them.
      const planked = (y0, y1, z) => {
        const bits = planksAcross(y1 - y0).map(([a, c]) => box(x0, y0 + a, z - pt, x0 + L, y0 + c, z));
        for (const x of xs) bits.push(box(x, y0 + 0.4, z - pt - ct, x + cw, y1 - 0.4, z - pt + 0.01));
        return own(wasm.Manifold.union(bits));
      };
      parts.push({ id: id('top'), name: 'Top' + n, role: 'roof', solid: planked(ty0, ty1, Ht), flip: true, apart: [0, 0, 15] });
      parts.push({ id: id('seat-front'), name: 'Seat, front' + n, role: 'wall', solid: planked(0, sd, Hs), flip: true, apart: [0, -8, 8] });
      parts.push({ id: id('seat-back'), name: 'Seat, back' + n, role: 'wall', solid: planked(D - sd, D, Hs), flip: true, apart: [0, 8, 8] });
      for (const [side, a, out] of [['left', x0 + I, [-1, 0, 0]], ['right', x0 + L - I - et, [1, 0, 0]]])
        parts.push({ id: id('end-' + side), name: 'End' + n + ', ' + side, role: 'frame', solid: sweep(endCs, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], a, a + et), outward: out, apart: [out[0] * 6, 0, 0] });
    });
    const keep = new Set(parts.map((q) => q.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}
