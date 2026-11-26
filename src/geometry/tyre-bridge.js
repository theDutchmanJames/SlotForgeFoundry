// A tyre bridge over the track: two sidewalls shaped like half a tyre, an
// arch with tread round its rim and a recessed band on its outside, and
// between them a deck of steps climbing the arch from both feet to a flat
// top, set down inside the tyre so its sidewalls are the parapets. Where the
// lowest steps run out past the tyre, a low wall each side. The sidewalls
// and the deck are cut in two at the middle, with a dovetail, to fit the
// plate; the sidewalls and the walls print flat, the deck on its side. The
// track runs under it along y; x across the arch, z up.

import { kitShapes } from './kit-shapes.js';
import { JOINT, seamRegion, tabPlaces } from './building-cuts.js';

export const TYRE_BRIDGE_DEFAULTS = Object.freeze({
  kind: 'tyrebridge',
  span: 340, // across the arch at the table, outside the tyre
  height: 130, // the top of the tyre
  width: 53, // along the track, outside the sidewalls
  tread: true, // tread round the rim
});
export const TYRE_BRIDGE_LIMITS = Object.freeze({
  span: [240, 400],
  height: [90, 180],
  width: [30, 110],
});
export const TYRE = Object.freeze({
  wall: 3, // a sidewall, thick
  band: [0.22, 24, 40], // the tyre, from rim to inner edge: this share of the height, within these
  sunk: 10, // the deck below the rim
  rise: 7, // a step at most this high
  tread: 6, // and at least this deep
  slab: 6, // under the noses of the steps
  block: [3, 5, 11], // tread: a notch deep, wide, this far apart round the rim
  groove: [5, 0.6], // the recessed band on the outside: in from the edges, deep
  play: 0.2, // round the deck between the sidewalls
});
const LABELS = { span: 'Span', height: 'Height', width: 'Width' };

/** The arch: its circle (centre height, radius at the rim), the tyre's inner radius, the deck's. */
export function tyreArch(t) {
  const c = t.span / 2,
    h = t.height;
  const R = (c * c + h * h) / (2 * h);
  const [share, lo, hi] = TYRE.band;
  const T = Math.min(hi, Math.max(lo, h * share));
  return { R, zc: h - R, T, Ri: R - T, Rd: R - TYRE.sunk };
}
const arcX = (r, zc, z) => Math.sqrt(Math.max(0, r * r - (z - zc) ** 2));
/**
 * The steps from the top down one side: the height of each level (0 the
 * table) and how far out from the middle each reaches; each step at least
 * TYRE.tread deep, so where the arch is steeper they run out past it.
 */
export function tyreSteps(t) {
  const { zc, Rd } = tyreArch(t);
  const K = Math.floor((zc + Rd) / TYRE.rise);
  const z = Array.from({ length: K + 1 }, (_, k) => k * TYRE.rise);
  const X = new Array(K + 1);
  X[K] = arcX(Rd, zc, z[K]);
  for (let k = K - 1; k >= 1; k--) X[k] = Math.max(arcX(Rd, zc, z[k]), X[k + 1] + TYRE.tread);
  X[0] = X[1];
  return { K, z, X };
}
/** The clear opening under the arch: its width at the table and its height in the middle. */
export function tyreOpening(t) {
  const { zc, Ri } = tyreArch(t);
  return { width: 2 * arcX(Ri, zc, 0), height: zc + Ri };
}

/** The tyre bridge as kept: known settings only, each checked. */
export function validateTyreBridge(input) {
  const t = { ...TYRE_BRIDGE_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(t)) if (!Object.hasOwn(TYRE_BRIDGE_DEFAULTS, key)) throw Error('The tyre bridge has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(TYRE_BRIDGE_LIMITS))
    if (!Number.isFinite(t[key]) || t[key] < min || t[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + ' mm.');
  if (typeof t.tread !== 'boolean') throw Error('Choose whether the tyre has tread.');
  if (t.height > t.span / 2) throw Error('The arch is at most a half circle: at most ' + t.span / 2 + ' mm high for a span of ' + t.span + ' mm.');
  const o = tyreOpening(t);
  if (o.height < 50) throw Error('The opening under the arch is only ' + Math.round(o.height) + ' mm high: make it higher or wider.');
  // Each half of the deck lies on the plate as it prints.
  if (tyreSteps(t).X[1] > 190) throw Error('The stairs reach ' + Math.round(tyreSteps(t).X[1]) + ' mm from the middle: too long for a half to print. Make it lower or narrower.');
  return t;
}
/** Its outline on the table, [x0, y0, x1, y1]: the stairs' feet at the ends, the sidewalls' outsides. */
export function tyreFootprint(t) {
  const reach = Math.max(t.span / 2, tyreSteps(t).X[1]);
  return [-reach, 0, reach, t.width];
}

/** The parts of a tyre bridge, without geometry. */
export function tyreBridgeLayout(input) {
  const t = validateTyreBridge(input);
  const parts = [];
  for (const [side, name] of [['front', 'front'], ['back', 'back']]) for (const k of [1, 2]) parts.push({ id: 'side-' + side + '-' + k, name: 'Sidewall, ' + name + ' ' + k + ' of 2', role: 'wall' });
  for (const k of [1, 2]) parts.push({ id: 'deck-' + k, name: 'Stairs ' + k + ' of 2', role: 'floor' });
  if (runsOut(t)) for (const end of ['left', 'right']) for (const side of ['front', 'back']) parts.push({ id: 'wall-' + end + '-' + side, name: 'Stair wall, ' + end + ', ' + side, role: 'frame' });
  return { building: t, parts };
}
// Whether the lowest steps run out past the tyre, needing walls of their own.
const runsOut = (t) => tyreSteps(t).X[1] > t.span / 2 + 3;

/** The tyre bridge, built. x from the middle of the arch, y from the front outside of it. */
export function buildTyreBridge(wasm, input) {
  const { Manifold, CrossSection } = wasm;
  const t = validateTyreBridge(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { poly, sweep } = kitShapes(wasm, own);
  const P = TYRE.wall,
    W = t.width;
  const { R, zc, Ri } = tyreArch(t);
  const { K, z, X } = tyreSteps(t);
  const S = TYRE.rise + TYRE.slab;
  const ground = poly([[-1e3, 0], [1e3, 0], [1e3, 1e3], [-1e3, 1e3]]);
  const circle = (r) => own(own(CrossSection.circle(r, 256)).translate([0, zc]));
  // The sidewall: the tyre between its rim and its inner edge, above the table; tread notched round the rim.
  let tyre = own(own(circle(R).subtract(circle(Ri))).intersect(ground));
  if (t.tread) {
    const [dep, wid, pitch] = TYRE.block;
    const a0 = Math.asin(Math.min(1, -zc / R));
    const notches = [];
    for (let a = a0 + pitch / R / 2; a < Math.PI - a0; a += pitch / R) {
      const [ux, uz] = [Math.cos(a), Math.sin(a)],
        [vx, vz] = [-uz, ux];
      const p = (r, s) => [ux * r + vx * s, zc + uz * r + vz * s];
      notches.push(poly([p(R - dep, -wid / 2), p(R - dep, wid / 2), p(R + 1, wid / 2), p(R + 1, -wid / 2)]));
    }
    tyre = own(tyre.subtract(own(CrossSection.union(notches))));
  }
  // The deck in (x, z): the steps down each side from the flat top, the slab under their noses, above the table.
  const half = (sign) => {
    const pts = [[0, z[K]]];
    for (let k = K; k >= 1; k--) pts.push([sign * X[k], z[k]], [sign * X[k], z[k - 1]]);
    for (let k = 1; k <= K; k++) pts.push([sign * X[k], z[k] - S]);
    pts.push([0, z[K] - S]);
    return own(poly(pts).intersect(ground));
  };
  const deckCs = own(half(1).add(half(-1)));
  const parts = [];
  const B = W - 2 * P;
  // Cut in two at the middle: a dovetail across what is there at x = 0.
  const halves = (solid, plane, [v0, v1], part) => {
    const at = 0;
    // The seam runs the whole height of the part; its tab only where there is material at the middle.
    const lo = -1,
      hi = t.height + 10;
    const left = own(new CrossSection(seamRegion(at, [lo, hi], tabPlaces([lo, hi], [], [[lo, v0], [v1, hi]])), 'NonZero'));
    const right = own(own(CrossSection.square([2e3, 2e3]).translate([-1e3, -1e3])).subtract(own(left.offset(JOINT.play, 'Miter', 2))));
    return [left, right].map((region, k) => {
      // The region in x and v (z), through the part along y.
      const prism = own(own(own(region.extrude(400)).translate([0, 0, -200])).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1]));
      return { ...part, id: part.id + '-' + (k + 1), name: part.name + ' ' + (k + 1) + ' of 2', solid: own(solid.intersect(prism)), apart: [(k ? 1 : -1) * 8 + part.apart[0], part.apart[1], part.apart[2]] };
    });
  };
  try {
    // The sidewalls, the recessed band on the outside of each.
    const [gin, gd] = TYRE.groove;
    const band = own(own(circle(R - (t.tread ? TYRE.block[0] : 0) - gin).subtract(circle(Ri + gin))).intersect(poly([[-1e3, gin], [1e3, gin], [1e3, 1e3], [-1e3, 1e3]])));
    const atMiddle = [zc + Ri, zc + R - (t.tread ? TYRE.block[0] : 0)];
    for (const [side, y0, out] of [['front', 0, [0, -1, 0]], ['back', W - P, [0, 1, 0]]]) {
      let wall = sweep(tyre, [1, 0, 0], [0, 0, 1], [0, y0, 0], [0, 1, 0], 0, P);
      const outer = side === 'front' ? [y0 - 1, y0 + gd] : [y0 + P - gd, y0 + P + 1];
      wall = own(wall.subtract(sweep(band, [1, 0, 0], [0, 0, 1], [0, outer[0], 0], [0, 1, 0], 0, outer[1] - outer[0])));
      parts.push(...halves(wall, 'xz', atMiddle, { id: 'side-' + side, name: 'Sidewall, ' + side, role: 'wall', outward: out, apart: [0, out[1] * 12, 0] }));
    }
    // The deck between them, a little play each side; it prints on its side.
    const pl = TYRE.play;
    const deck = sweep(deckCs, [1, 0, 0], [0, 0, 1], [0, P + pl, 0], [0, 1, 0], 0, B - 2 * pl);
    parts.push(...halves(deck, 'xz', [z[K] - S, z[K]], { id: 'deck', name: 'Stairs', role: 'floor', outward: [0, -1, 0], apart: [0, 0, 12] }));
    // Where the lowest steps run out past the tyre: a wall each side, from
    // under the steps to the rim's height over them, outside the tyre.
    if (runsOut(t)) {
      const d = TYRE.sunk;
      for (const sign of [-1, 1]) {
        const pts = [];
        for (let k = K; k >= 1; k--) pts.push([sign * X[k], z[k] + d]);
        pts.push([sign * X[1], 0]);
        for (let k = 1; k <= K; k++) pts.push([sign * X[k], z[k] - S]);
        let cs = own(own(poly(pts).intersect(ground)).subtract(circle(R + 0.5)));
        // Only what stands clear of the tyre; slivers along its rim dropped.
        const bits = cs.decompose().filter((b) => (own(b), Math.abs(b.area()) > 20));
        cs = own(CrossSection.union(bits));
        for (const [side, y0, out] of [['front', 0, [0, -1, 0]], ['back', W - P, [0, 1, 0]]]) {
          const solid = sweep(cs, [1, 0, 0], [0, 0, 1], [0, y0, 0], [0, 1, 0], 0, P);
          parts.push({ id: 'wall-' + (sign < 0 ? 'left' : 'right') + '-' + side, name: 'Stair wall, ' + (sign < 0 ? 'left' : 'right') + ', ' + side, role: 'frame', solid, outward: out, apart: [sign * 10, out[1] * 12, 0] });
        }
      }
    }
    // In the layout's order: sidewalls, stairs, walls.
    const order = tyreBridgeLayout(t).parts.map((p) => p.id);
    parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}
