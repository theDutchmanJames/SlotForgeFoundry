// Benches for spectators, in a row along the track: each a seat (and a
// back) between two end frames, its legs, a stretcher between them, the back
// leg rising to carry the back. The seat and back print as one piece lying
// on the back, the seat standing up; the end frames print flat and are glued
// to its ends. x along the row, y from the front (the track at negative y)
// back, z up.

import { kitShapes } from './kit-shapes.js';

export const BENCH_DEFAULTS = Object.freeze({
  kind: 'bench',
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
});
const LABELS = { length: 'Length', count: 'Benches', gap: 'Gap', seatHeight: 'Seat height' };

/** The benches as kept: known settings only, each checked. */
export function validateBench(input) {
  const b = { ...BENCH_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(b)) if (!Object.hasOwn(BENCH_DEFAULTS, key)) throw Error('The bench has an unknown setting: ' + key + '.');
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

/** The parts of the benches, without geometry. */
export function benchLayout(input) {
  const b = validateBench(input);
  const parts = [];
  benchStarts(b).forEach((_, k) => {
    const n = b.count > 1 ? ' ' + (k + 1) : '';
    parts.push({ id: 'seat-' + (k + 1), name: (b.backrest ? 'Seat and back' : 'Seat') + n, role: 'wall' }, { id: 'end-' + (k + 1) + '-left', name: 'End frame' + n + ', left', role: 'frame' }, { id: 'end-' + (k + 1) + '-right', name: 'End frame' + n + ', right', role: 'frame' });
  });
  return { building: b, parts };
}

/** The benches, built. */
export function buildBench(wasm, input) {
  const b = validateBench(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { poly, sweep } = kitShapes(wasm, own);
  const { depth: D, seat: st, end: et, leg: lw } = BENCH;
  const [bt, bh] = BENCH.back,
    [sz, sh2] = BENCH.stretcher;
  const H = b.seatHeight;
  const rect = (y0, z0, y1, z1) => poly([[y0, z0], [y1, z0], [y1, z1], [y0, z1]]);
  // The seat and back in (y, z): the seat under its top at H, the back up the back edge.
  const seatCs = own(wasm.CrossSection.union([rect(0, H - st, D, H), ...(b.backrest ? [rect(D - bt, H - 0.01, D, H + bh)] : [])]));
  // An end frame in (y, z): a leg at the front and at the back (rising with the back), a stretcher, a bearer under the seat.
  const endCs = own(
    wasm.CrossSection.union([rect(0, 0, lw, H), rect(D - lw, 0, D, b.backrest ? H + bh : H), rect(0, sz, D, sz + sh2), rect(0, H - st, D, H)]),
  );
  const parts = [];
  try {
    benchStarts(b).forEach((x0, k) => {
      const n = b.count > 1 ? ' ' + (k + 1) : '';
      const seat = sweep(seatCs, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], x0 + et, x0 + b.length - et);
      parts.push({ id: 'seat-' + (k + 1), name: (b.backrest ? 'Seat and back' : 'Seat') + n, role: 'wall', solid: seat, ...(b.backrest ? { outward: [0, -1, 0] } : { lie: [0, 0, 0] }), apart: [0, 0, 10] });
      for (const [side, a, c, out] of [['left', x0, x0 + et, [-1, 0, 0]], ['right', x0 + b.length - et, x0 + b.length, [1, 0, 0]]])
        parts.push({ id: 'end-' + (k + 1) + '-' + side, name: 'End frame' + n + ', ' + side, role: 'frame', solid: sweep(endCs, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], a, c), outward: out, apart: [out[0] * 6, 0, 0] });
    });
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}
