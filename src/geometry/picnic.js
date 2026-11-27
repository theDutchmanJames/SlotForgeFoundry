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
  // A pergola over the row: a frame of posts and a beam along each side and
  // a roof of slats across on them, in bays of at most PERGOLA.longest.
  pergola: false,
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
// The pergola: beyond the row at its ends and at its sides; its posts square
// and its beam high, the top of the beam this high; the slats wide, thick,
// this far apart and this far beyond the frames; the rail over each frame and
// the batten under it inside the frame, wide and deep, and the play there; a
// bay at most this long.
export const PERGOLA = Object.freeze({ margin: [12, 20], post: 5, beam: 7, height: 84, slat: [6, 3], pitch: 14, reach: 6, batten: [3, 3], play: 0.2, longest: 180 });
const LABELS = { length: 'Length', count: 'Tables', gap: 'Gap' };

/** The picnic table as kept: known settings only, each checked. */
export function validatePicnic(input) {
  const p = { ...PICNIC_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(p)) if (!Object.hasOwn(PICNIC_DEFAULTS, key)) throw Error('The picnic table has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(PICNIC_LIMITS))
    if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'count' ? '' : ' mm') + '.');
  if (!Number.isInteger(p.count)) throw Error('Tables are a whole number.');
  if (typeof p.pergola !== 'boolean') throw Error('Choose whether a pergola stands over the tables.');
  return p;
}

/** Where each table starts along the row. */
export const picnicStarts = (p) => Array.from({ length: p.count }, (_, k) => k * (p.length + p.gap));
/** The row on the table, [x0, y0, x1, y1]: with its pergola, out to the posts. */
export function picnicFootprint(p) {
  const X = p.count * p.length + (p.count - 1) * p.gap;
  if (!p.pergola) return [0, 0, X, PICNIC.depth];
  const [mx, my] = PERGOLA.margin;
  return [-mx, -my, X + mx, PICNIC.depth + my];
}
/** The bays of the pergola along the row, [x0, x1] each, all as long. */
export function pergolaBays(p) {
  if (!p.pergola) return [];
  const [x0, , x1] = picnicFootprint(p);
  const n = Math.max(1, Math.ceil((x1 - x0) / PERGOLA.longest - 1e-9)),
    m = (x1 - x0) / n;
  return Array.from({ length: n }, (_, k) => [x0 + k * m, x0 + (k + 1) * m]);
}
const pergolaParts = (p) =>
  pergolaBays(p).flatMap((_, k, all) => {
    const n = all.length > 1 ? ' ' + (k + 1) : '',
      id = (s) => s + (all.length > 1 ? '-' + (k + 1) : '');
    return [
      { id: id('pergola-front'), name: 'Pergola frame, front' + n, role: 'frame' },
      { id: id('pergola-back'), name: 'Pergola frame, back' + n, role: 'frame' },
      { id: id('pergola-roof'), name: 'Pergola roof' + n, role: 'roof' },
    ];
  });

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
  parts.push(...pergolaParts(p));
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
    // The pergola: in each bay a frame along the front and the back, posts at
    // its ends (and its middle, a long bay) under a beam, printing flat; on
    // them a roof of slats across, joined by a rail over each frame, in one
    // layer that prints flat, a batten under each rail just inside its frame.
    if (p.pergola) {
      const P = PERGOLA,
        [, y0, , y1] = picnicFootprint(p),
        [sw, st] = P.slat,
        [bw, bh] = P.batten;
      const H = P.height,
        zb = H - P.beam;
      const bays = pergolaBays(p);
      pergolaParts(p).forEach((q, i) => {
        const [a, c] = bays[Math.floor(i / 3)];
        const kind = q.id.split('-')[1];
        if (kind === 'roof') {
          const count = Math.max(2, Math.floor((c - a - sw) / P.pitch) + 1),
            step = (c - a - sw) / (count - 1);
          const bits = Array.from({ length: count }, (_, k) => box(a + k * step, y0 - P.reach, H, a + k * step + sw, y1 + P.reach, H + st));
          const inner = P.post + P.play + bw;
          bits.push(box(a, y0, H, c, y0 + inner, H + st), box(a, y1 - inner, H, c, y1, H + st));
          bits.push(box(a + 1, y0 + P.post + P.play, H - bh, c - 1, y0 + inner, H + 0.01), box(a + 1, y1 - inner, H - bh, c - 1, y1 - P.post - P.play, H + 0.01));
          parts.push({ ...q, solid: own(wasm.Manifold.union(bits)), flip: true, apart: [0, 0, 20] });
          return;
        }
        const front = kind === 'front',
          ya = front ? y0 : y1 - P.post;
        const xs = [a, c - P.post];
        if (c - a > 100) xs.push((a + c) / 2 - P.post / 2);
        const bits = xs.map((x) => box(x, ya, 0, x + P.post, ya + P.post, zb + 0.01));
        bits.push(box(a, ya, zb, c, ya + P.post, H));
        parts.push({ ...q, solid: own(wasm.Manifold.union(bits)), outward: [0, front ? -1 : 1, 0], apart: [0, front ? -12 : 12, 0] });
      });
    }
    const keep = new Set(parts.map((q) => q.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}
