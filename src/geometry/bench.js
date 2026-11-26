// Benches for spectators, in a row along the track. Planked, like a wooden
// bench: the seat of planks with gaps between them, joined by cleats
// underneath, the back of planks joined by cleats behind, both on two end
// frames set in from the ends (legs, a bearer under the seat, a stretcher);
// the seat prints upside down, its planks on the plate and the cleats up,
// the back face down, the end frames flat. Or plain: a seat and back in one
// piece between two end frames, lying on the back. x along the row, y from
// the front (the track at negative y) back, z up.

import { kitShapes } from './kit-shapes.js';

export const BENCH_DEFAULTS = Object.freeze({
  kind: 'bench',
  style: 'planks', // 'planks' or 'plain'
  length: 60, // one bench
  count: 3, // benches in the row
  gap: 12, // between two benches
  seatHeight: 14,
  backrest: true,
});
export const BENCH_LIMITS = Object.freeze({
  length: [30, 150],
  count: [1, 8],
  gap: [4, 60],
  seatHeight: [8, 20],
});
export const BENCH = Object.freeze({
  depth: 13, // the seat, front to back
  seat: 2.2, // thick
  back: [2.2, 11], // the back: thick, above the seat
  end: 2.5, // an end frame, thick
  leg: 2.5, // a leg, wide
  stretcher: [2, 2.5], // up from the floor, high
  plank: [4, 0.8, 1.6], // planks: about this wide, the gap between two, thick
  cleat: [2.5, 1.5], // a cleat under the planks: wide, thick
  inset: 5, // the end frames of a planked bench in from its ends
  bearer: 2, // under the seat, on an end frame
});
const LABELS = { length: 'Length', count: 'Benches', gap: 'Gap', seatHeight: 'Seat height' };

/** The benches as kept: known settings only, each checked. */
export function validateBench(input) {
  const b = { ...BENCH_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(b)) if (!Object.hasOwn(BENCH_DEFAULTS, key)) throw Error('The bench has an unknown setting: ' + key + '.');
  if (!['planks', 'plain'].includes(b.style)) throw Error('Choose planked or plain benches.');
  for (const [key, [min, max]] of Object.entries(BENCH_LIMITS))
    if (!Number.isFinite(b[key]) || b[key] < min || b[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'count' ? '' : ' mm') + '.');
  if (!Number.isInteger(b.count)) throw Error('Benches are a whole number.');
  if (typeof b.backrest !== 'boolean') throw Error('Choose whether the benches have backs.');
  return b;
}

/** Where each bench starts along the row. */
export const benchStarts = (b) => Array.from({ length: b.count }, (_, k) => k * (b.length + b.gap));
/** The row on the table, [x0, y0, x1, y1]. */
export const benchFootprint = (b) => [0, 0, b.count * b.length + (b.count - 1) * b.gap, BENCH.depth];
/** Planks across a width: how many, each how wide, where each starts. */
export function planksAcross(width) {
  const [pw, g] = BENCH.plank;
  const n = Math.max(1, Math.round((width + g) / (pw + g)));
  const w = (width - (n - 1) * g) / n;
  return Array.from({ length: n }, (_, k) => [k * (w + g), k * (w + g) + w]);
}

/** The parts of the benches, without geometry. */
export function benchLayout(input) {
  const b = validateBench(input);
  const parts = [];
  const planked = b.style === 'planks';
  benchStarts(b).forEach((_, k) => {
    const n = b.count > 1 ? ' ' + (k + 1) : '';
    parts.push({ id: 'seat-' + (k + 1), name: (b.backrest && !planked ? 'Seat and back' : 'Seat') + n, role: 'wall' });
    if (planked && b.backrest) parts.push({ id: 'back-' + (k + 1), name: 'Back' + n, role: 'wall' });
    parts.push({ id: 'end-' + (k + 1) + '-left', name: 'End frame' + n + ', left', role: 'frame' }, { id: 'end-' + (k + 1) + '-right', name: 'End frame' + n + ', right', role: 'frame' });
  });
  return { building: b, parts };
}

/** The benches, built. */
export function buildBench(wasm, input) {
  const b = validateBench(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { box, poly, sweep } = kitShapes(wasm, own);
  const { depth: D, seat: st, end: et, leg: lw } = BENCH;
  const [bt, bh] = BENCH.back,
    [sz, sh2] = BENCH.stretcher;
  const H = b.seatHeight;
  const rect = (y0, z0, y1, z1) => poly([[y0, z0], [y1, z0], [y1, z1], [y0, z1]]);
  const across = (x0, x1, cs) => sweep(cs, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], x0, x1);
  const parts = [];
  try {
    if (b.style === 'plain') {
      // The seat and back in (y, z): the seat under its top at H, the back up the back edge.
      const seatCs = own(wasm.CrossSection.union([rect(0, H - st, D, H), ...(b.backrest ? [rect(D - bt, H - 0.01, D, H + bh)] : [])]));
      // An end frame in (y, z): a leg at the front and at the back (rising with the back), a stretcher, a bearer under the seat.
      const endCs = own(wasm.CrossSection.union([rect(0, 0, lw, H), rect(D - lw, 0, D, b.backrest ? H + bh : H), rect(0, sz, D, sz + sh2), rect(0, H - st, D, H)]));
      benchStarts(b).forEach((x0, k) => {
        const n = b.count > 1 ? ' ' + (k + 1) : '';
        parts.push({ id: 'seat-' + (k + 1), name: (b.backrest ? 'Seat and back' : 'Seat') + n, role: 'wall', solid: across(x0 + et, x0 + b.length - et, seatCs), ...(b.backrest ? { outward: [0, -1, 0] } : { lie: [0, 0, 0] }), apart: [0, 0, 10] });
        for (const [side, a, c, out] of [['left', x0, x0 + et, [-1, 0, 0]], ['right', x0 + b.length - et, x0 + b.length, [1, 0, 0]]])
          parts.push({ id: 'end-' + (k + 1) + '-' + side, name: 'End frame' + n + ', ' + side, role: 'frame', solid: across(a, c, endCs), outward: out, apart: [out[0] * 6, 0, 0] });
      });
    } else {
      const [, , pt] = BENCH.plank,
        [cw, ct] = BENCH.cleat,
        I = BENCH.inset,
        br = BENCH.bearer;
      // The seat: planks along the row, their tops at H, cleats under them
      // just inside each end frame and in the middle of a long bench.
      const seatTop = H,
        under = H - pt;
      // The seat's planks reach back to the back legs, which rise behind them to carry the back.
      const SD = b.backrest ? D - lw : D;
      // An end frame in (y, z): a leg at the front and the back, a bearer
      // under the seat's planks, a stretcher low between the legs.
      const endCs = own(wasm.CrossSection.union([rect(0, 0, lw, under), rect(D - lw, 0, D, b.backrest ? seatTop + bh : under), rect(0, sz, D, sz + sh2), rect(0, under - br, D, under)]));
      // The back: planks along the row on the seat, against the back legs, cleats behind them beside the legs.
      const backFront = SD - pt;
      benchStarts(b).forEach((x0, k) => {
        const n = b.count > 1 ? ' ' + (k + 1) : '';
        const xs = [x0 + I + et, x0 + b.length - I - et - cw];
        if (b.length > 80) xs.push(x0 + b.length / 2 - cw / 2);
        const seatBits = planksAcross(SD).map(([y0, y1]) => box(x0, y0, under, x0 + b.length, y1, seatTop));
        for (const x of xs) seatBits.push(box(x, 0.4, under - ct, x + cw, SD - 0.4, under + 0.01));
        parts.push({ id: 'seat-' + (k + 1), name: 'Seat' + n, role: 'wall', solid: own(wasm.Manifold.union(seatBits)), flip: true, apart: [0, 0, 10] });
        if (b.backrest) {
          const backBits = planksAcross(bh).map(([z0, z1]) => box(x0, backFront, seatTop + z0, x0 + b.length, backFront + pt, seatTop + z1));
          for (const x of xs) backBits.push(box(x, backFront + pt - 0.01, seatTop, x + cw, backFront + pt + ct, seatTop + bh - 0.5));
          parts.push({ id: 'back-' + (k + 1), name: 'Back' + n, role: 'wall', solid: own(wasm.Manifold.union(backBits)), outward: [0, 1, 0], apart: [0, 8, 12] });
        }
        for (const [side, a, out] of [['left', x0 + I, [-1, 0, 0]], ['right', x0 + b.length - I - et, [1, 0, 0]]])
          parts.push({ id: 'end-' + (k + 1) + '-' + side, name: 'End frame' + n + ', ' + side, role: 'frame', solid: across(a, a + et, endCs), outward: out, apart: [out[0] * 6, 0, 0] });
      });
    }
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}
