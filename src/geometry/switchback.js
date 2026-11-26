// Switchback stairs to stand against the back of a building: a flight up
// along the wall to a landing on posts, a second flight back above it
// against the wall to a landing at the top. Each flight is steps on a slab
// with a railing wall on its open side, opened with mesh or bars, and
// prints on its side; each landing prints upside down, its posts up; the
// landings' railings print flat and push into pockets. x along the wall,
// y from the open side (0) to the wall (2 × width), z up.

import { kitShapes } from './kit-shapes.js';

export const SWITCHBACK_DEFAULTS = Object.freeze({
  kind: 'switchback',
  height: 70, // the top landing above the table
  width: 24, // each flight
  railHeight: 14,
  railingStyle: 'mesh', // 'mesh' or 'bars'
});
export const SWITCHBACK_LIMITS = Object.freeze({
  height: [30, 190],
  width: [16, 40],
  railHeight: [10, 25],
});
export const SWITCHBACK = Object.freeze({
  rise: 7, // a step at most this high
  tread: 9,
  slab: 5, // under the steps, square to them
  deck: 4, // a landing, thick
  post: 5, // under a landing
  wall: 2.5, // a flight's railing wall, thick
  rail: 2, // its rail along the top, its band over the noses
  hole: [2.5, 1.5], // mesh: a square hole, the bar between two
  slat: [2, 3], // bars: a slat, the gap between two
  landingRail: { thick: 2.5, band: 3, post: 2.5, pitch: 15, tab: 1.5, inset: 0.5 },
});
const LABELS = { height: 'Height', width: 'Flight width', railHeight: 'Railing height' };

/** The stairs as kept: known settings only, each checked. */
export function validateSwitchback(input) {
  const s = { ...SWITCHBACK_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(s)) if (!Object.hasOwn(SWITCHBACK_DEFAULTS, key)) throw Error('The stairs have an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(SWITCHBACK_LIMITS))
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + ' mm.');
  if (!['mesh', 'bars'].includes(s.railingStyle)) throw Error('Choose railings of mesh or of bars.');
  return s;
}

/**
 * Where everything is: the steps (their rise, how many up each flight), the
 * landing in the middle and at the top, along x.
 */
export function switchbackPlan(s) {
  const { tread: t } = SWITCHBACK;
  const n = Math.ceil(s.height / SWITCHBACK.rise - 1e-9);
  const r = s.height / n,
    n1 = Math.floor(n / 2),
    n2 = n - n1;
  const h1 = n1 * r;
  const x1 = (n1 - 1) * t, // where the first flight meets the landing in the middle
    x2 = x1 - (n2 - 1) * t; // where the second meets the top landing
  return { n, r, n1, n2, h1, x1, x2, mid: [x1, x1 + s.width], top: [x2 - s.width, x2] };
}
/** Its outline on the table, [x0, y0, x1, y1]: the wall it stands against along y = 2 × width. */
export function switchbackFootprint(s) {
  const p = switchbackPlan(s);
  return [Math.min(0, p.top[0]), 0, p.mid[1], 2 * s.width];
}

/** The parts of the stairs, without geometry. */
export function switchbackLayout(input) {
  const s = validateSwitchback(input);
  const parts = [
    { id: 'flight-1', name: 'Flight, lower', role: 'wall' },
    { id: 'flight-2', name: 'Flight, upper', role: 'wall' },
    { id: 'landing-mid', name: 'Landing, middle', role: 'floor' },
    { id: 'landing-top', name: 'Landing, top', role: 'floor' },
    { id: 'rail-mid-end', name: 'Railing, middle landing, end', role: 'frame' },
    { id: 'rail-mid-side', name: 'Railing, middle landing, side', role: 'frame' },
    { id: 'rail-top-end', name: 'Railing, top landing, end', role: 'frame' },
    { id: 'rail-top-side', name: 'Railing, top landing, side', role: 'frame' },
  ];
  return { building: s, parts };
}

/** The stairs, built. */
export function buildSwitchback(wasm, input) {
  const { Manifold } = wasm;
  const s = validateSwitchback(input);
  const temp = [];
  const own = (m) => (temp.push(m), m);
  const { box, poly, sweep, railing } = kitShapes(wasm, own);
  const { tread: t, slab, deck, post: P, wall: pw, rail: rb } = SWITCHBACK;
  const W = s.width,
    RH = s.railHeight;
  const p = switchbackPlan(s);
  const { r } = p;
  const Sd = slab * Math.hypot(1, r / t);
  const parts = [];
  try {
    // A flight in (u, z): u from its foot along the way it rises, m steps
    // from z0 (the m-th the landing it meets at u = (m - 1) t). Its foot on
    // the table, or against the side of the landing below. Returns the
    // steps' outline and its railing wall's outline with holes.
    const flight = (m, z0, onTable) => {
      const ue = (m - 1) * t;
      const nose = (u) => z0 + r + (r / t) * u;
      const under = (u) => nose(u) - Sd;
      // Its end flush with the top of the landing it meets, glued along its side.
      const zEnd = z0 + m * r;
      const bottom = onTable ? [[0, 0], [Math.max(0.5, Math.min(ue - 1, (-under(0) / (r / t)))), 0], [ue, under(ue)]] : [[0, z0 - deck], [ue, under(ue)]];
      // Up the end against the landing, then down the steps to the foot.
      const top = [[ue, zEnd], [ue - 2, zEnd], [ue - 2, z0 + (m - 1) * r]];
      for (let k = m - 1; k >= 1; k--) top.push([(k - 1) * t, z0 + k * r], ...(k > 1 ? [[(k - 1) * t, z0 + (k - 1) * r]] : []));
      const steps = [...bottom, ...top];
      // The railing wall: from the slab up to the rail, over the noses.
      const rail = (u) => nose(u) + RH;
      const wallOutline = [...bottom, [ue, rail(ue)], [0, rail(0)]];
      // Its holes, between the band over the noses and the rail, their tops
      // and bottoms along the slope: rows of a mesh, or the gaps between bars.
      const holes = [];
      const hole = (u0, u1, v0, v1) => [[u0, nose(u0) + v0], [u1, nose(u1) + v0], [u1, nose(u1) + v1], [u0, nose(u0) + v1]];
      if (s.railingStyle === 'mesh') {
        const [h, bar] = SWITCHBACK.hole,
          pitch = h + bar;
        const rows = Math.floor((RH - 2 * rb + bar) / pitch),
          v0 = rb + (RH - 2 * rb - (rows * pitch - bar)) / 2;
        for (let u = 1.5; u + h < ue - 1; u += pitch) for (let j = 0; j < rows; j++) holes.push(hole(u, u + h, v0 + j * pitch, v0 + j * pitch + h));
      } else {
        const [sw, gap] = SWITCHBACK.slat;
        for (let u = 1.5; u + gap < ue - 1; u += sw + gap) holes.push(hole(u, u + gap, rb, RH - rb));
      }
      let wallCs = poly(wallOutline);
      if (holes.length) wallCs = own(wallCs.subtract(own(wasm.CrossSection.union(holes.map(poly)))));
      return { steps: poly(steps), wall: wallCs };
    };
    // The lower flight: along +x from x = 0, its railing wall on the open side.
    {
      const f = flight(p.n1, 0, true);
      const solid = own(Manifold.union([sweep(f.steps, [1, 0, 0], [0, 0, 1], [0, 0, 0], [0, 1, 0], pw - 0.01, W), sweep(f.wall, [1, 0, 0], [0, 0, 1], [0, 0, 0], [0, 1, 0], 0, pw)]));
      parts.push({ id: 'flight-1', name: 'Flight, lower', role: 'wall', solid, outward: [0, 1, 0], apart: [0, -10, 0] });
    }
    // The upper flight: back along -x from the landing in the middle, against the wall.
    {
      const f = flight(p.n2, p.h1, false);
      const solid = own(Manifold.union([sweep(f.steps, [-1, 0, 0], [0, 0, 1], [p.x1, 0, 0], [0, 1, 0], W + pw - 0.01, 2 * W), sweep(f.wall, [-1, 0, 0], [0, 0, 1], [p.x1, 0, 0], [0, 1, 0], W, W + pw)]));
      parts.push({ id: 'flight-2', name: 'Flight, upper', role: 'wall', solid, outward: [0, 1, 0], apart: [0, 0, 10] });
    }
    // The landings: a deck on two posts at its free end, pockets on top for
    // its railings, the end across it and the side along the open side.
    const R = { ...SWITCHBACK.landingRail, height: RH, ...(s.railingStyle === 'mesh' ? { mesh: [2.5, 1.5] } : { mid: true }) };
    const side = R.inset + R.thick + 0.2;
    const landing = (id, name, [xa, xb], [ya, yb], z, endAt, dirEnd) => {
      const xEnd = endAt === 'max' ? xb : xa;
      // The posts set in from the edges past the railings, so the railings' tabs go through the deck beside them.
      const i = R.inset + R.thick + 0.5;
      const xp = endAt === 'max' ? [xb - i - P, xb - i] : [xa + i, xa + i + P];
      let solid = own(Manifold.union([box(xa, ya, z - deck, xb, yb, z), box(xp[0], ya + i, 0, xp[1], ya + i + P, z - deck + 0.01), box(xp[0], yb - i - P, 0, xp[1], yb - i, z - deck + 0.01)]));
      const inward = endAt === 'max' ? [-1, 0] : [1, 0];
      const end = railing({ from: [xEnd, endAt === 'max' ? ya + 0.1 : yb - 0.1], dir: endAt === 'max' ? [0, 1] : [0, -1], len: yb - ya - 0.2, inward, z, inset: R.inset, spec: R });
      // The side along the open edge, from where the flight's wall ends to the end railing.
      const sx0 = endAt === 'max' ? xa : xb,
        sx1 = endAt === 'max' ? xb - side : xa + side;
      const sideRail = railing({ from: [Math.min(sx0, sx1), ya], dir: [1, 0], len: Math.abs(sx1 - sx0), inward: [0, 1], z, inset: R.inset, spec: R });
      // The pockets for the railings' tabs go right through the deck: it prints upside down, so nothing hangs over them.
      const through = [...end.pockets, ...sideRail.pockets].map((pk) => {
        const { min, max } = pk.boundingBox();
        return box(min[0], min[1], z - deck - 1, max[0], max[1], z + 1);
      });
      solid = own(solid.subtract(own(Manifold.union(through))));
      parts.push({ id, name, role: 'floor', solid, flip: true, apart: [0, 0, 15] });
      return [end.panel, sideRail.panel, dirEnd];
    };
    const [midEnd, midSide] = landing('landing-mid', 'Landing, middle', p.mid, [0, 2 * W], p.h1, 'max');
    const [topEnd, topSide] = landing('landing-top', 'Landing, top', p.top, [W, 2 * W], s.height, 'min');
    for (const [id, name, solid, out] of [
      ['rail-mid-end', 'Railing, middle landing, end', midEnd, [1, 0, 0]],
      ['rail-mid-side', 'Railing, middle landing, side', midSide, [0, -1, 0]],
      ['rail-top-end', 'Railing, top landing, end', topEnd, [-1, 0, 0]],
      ['rail-top-side', 'Railing, top landing, side', topSide, [0, -1, 0]],
    ])
      parts.push({ id, name, role: 'frame', solid, outward: out, apart: [out[0] * 10, out[1] * 10, 10] });
    const keep = new Set(parts.map((q) => q.solid));
    for (const m of temp) if (!keep.has(m)) m.delete();
    return parts;
  } catch (e) {
    for (const m of temp) m.delete();
    throw e;
  }
}
