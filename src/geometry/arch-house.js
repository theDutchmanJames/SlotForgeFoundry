// A town house over the road, the stage running through an arch in its
// ground floor: stone piers up to where the arch springs, plaster above,
// a band round the arch, windows with shutters on every storey, a cornice
// and a flat roof with a low wall round it, a balcony over the arch. Its
// walls print flat, each front and back in two halves meeting over the
// middle of the arch; the walls of the passage, its ceiling and the roof
// glue in between. x across the road, y along it (the cars drive through
// along y), z up; the front faces negative y.

import { kitShapes } from './kit-shapes.js';
import { wallJoints } from './building-texture.js';
import { archOutline, checkKeys, checkLimits, keepParts, partLines } from './drive-through.js';

export const ARCH_HOUSE_DEFAULTS = Object.freeze({
  kind: 'archhouse',
  span: 220, // the arch, wide: the track and its borders
  clearance: 80, // under the top of the arch
  depth: 70, // the house, along the road
  storeys: 2, // above the arch
  balcony: true,
});
export const ARCH_HOUSE_LIMITS = Object.freeze({ span: [140, 300], clearance: [60, 110], depth: [50, 140], storeys: [1, 3] });
export const ARCH_HOUSE = Object.freeze({
  pier: 24, // beside the arch, each side
  wall: 2.4,
  rise: 30, // the arch, from where it springs to its top
  lintel: 12, // above the arch to the first floor
  storey: 36,
  roof: 2.4,
  overhang: 2,
  parapet: [2, 4], // the low wall round the roof: wide, high
  window: [15, 22], // wide, high
  door: 31, // a door out to the balcony, high
  sill: 9, // above its floor
  shutter: [6, 0.8, 0.5], // wide, thick, clear of the window
  ring: [5, 0.8], // the band round the arch: wide, standing out
  band: [2.4, 0.8], // the band along the first floor: high, standing out
  cornice: [3.5, 1.4],
  balcony: { deep: 9, slab: 2, rail: 10, bar: 0.9, pitch: 3.2 },
  print: 205, // a wall lies flat: no higher than this
});
const LABELS = { span: 'Width of the arch', clearance: 'Height under the arch', depth: 'Depth', storeys: 'Storeys' };

/** Its walls' height, to under the roof. */
const heightOf = (h) => h.clearance + ARCH_HOUSE.lintel + h.storeys * ARCH_HOUSE.storey;
const widthOf = (h) => h.span + 2 * ARCH_HOUSE.pier;
const balconyOf = (h) => {
  const W = widthOf(h),
    w = Math.min(W * 0.36, 90);
  return [W / 2 - w / 2, W / 2 + w / 2];
};

export function validateArchHouse(input) {
  const h = { ...ARCH_HOUSE_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  checkKeys(h, ARCH_HOUSE_DEFAULTS, 'arch house');
  checkLimits(h, ARCH_HOUSE_LIMITS, LABELS, { storeys: '' });
  if (!Number.isInteger(h.storeys)) throw Error('Storeys must be a whole number.');
  if (typeof h.balcony !== 'boolean') throw Error('Choose whether the house has a balcony.');
  if (heightOf(h) > ARCH_HOUSE.print) throw Error('The house is too high for its walls to lie flat on the plate: at most ' + ARCH_HOUSE.print + ' mm, and it is ' + heightOf(h) + ' mm. Make it a storey lower or the arch lower.');
  return h;
}
/** On the table: [x0, y0, x1, y1], out to the roof's overhang and the balcony. */
export const archHouseFootprint = (h) => {
  const { overhang: o, balcony: B, shutter } = ARCH_HOUSE;
  return [-o, h.balcony ? -(shutter[1] + B.deep) : -o, widthOf(h) + o, h.depth + o];
};

const PARTS = [
  ['front-left', 'Front, left half', 'wall'], ['front-right', 'Front, right half', 'wall'],
  ['back-left', 'Back, left half', 'wall'], ['back-right', 'Back, right half', 'wall'],
  ['side-left', 'Left side', 'wall'], ['side-right', 'Right side', 'wall'],
  ['passage-left', 'Passage wall, left', 'wall'], ['passage-right', 'Passage wall, right', 'wall'],
  ['ceiling-left', 'Passage ceiling, left', 'floor'], ['ceiling-right', 'Passage ceiling, right', 'floor'],
  ['roof-left', 'Roof, left', 'roof'], ['roof-right', 'Roof, right', 'roof'],
];
export function archHouseLayout(input) {
  const h = validateArchHouse(input);
  const parts = PARTS.map(([id, name, role]) => ({ id, name, role }));
  if (h.balcony) parts.push({ id: 'balcony', name: 'Balcony', role: 'frame' });
  return { building: h, parts };
}

export function buildArchHouse(wasm, input) {
  const h = validateArchHouse(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { box, poly, sweep } = kitShapes(wasm, own);
  const { Manifold, CrossSection } = wasm;
  const A = ARCH_HOUSE;
  const t = A.wall,
    W = widthOf(h),
    D = h.depth,
    H = heightOf(h);
  const x0 = A.pier,
    x1 = A.pier + h.span,
    spring = h.clearance - A.rise,
    first = h.clearance + A.lintel; // the first floor
  const stone = { textureScale: 100, textureJoint: 0.6, textureDepth: 0.6 };
  const rect = (a, b, c, d) => poly([[a, b], [c, b], [c, d], [a, d]]);
  const [b0, b1] = balconyOf(h);
  // The windows across the front and the back: an even number, none on the join in the middle.
  const n = Math.max(2, 2 * Math.floor(W / 110));
  const windows = (door) => {
    const out = [];
    for (let k = 0; k < h.storeys; k++)
      for (let i = 0; i < n; i++) {
        const c = ((i + 0.5) * W) / n,
          floor = first + k * A.storey;
        const out2 = door && k === 0 && c > b0 && c < b1; // out onto the balcony
        const z0 = out2 ? floor + A.balcony.slab : floor + A.sill;
        out.push([c - A.window[0] / 2, z0, c + A.window[0] / 2, out2 ? floor + A.door : floor + A.sill + A.window[1]]);
      }
    return out;
  };
  const opening = archOutline(x0, x1, spring, A.rise);
  const parts = [];
  try {
    // A front or a back, whole: its outline, the stones of its piers, its bands and shutters standing out.
    const facade = (back) => {
      const wins = windows(!back && h.balcony);
      const cs = own(rect(0, 0, W, H).subtract(own(CrossSection.union([poly(opening), ...wins.map(([a, b, c, d]) => rect(a, b, c, d))]))));
      const y = back ? D - t : 0;
      let solid = sweep(cs, [1, 0, 0], [0, 0, 1], [0, y, 0], [0, 1, 0], 0, t);
      // u along the wall as seen from in front of it.
      const frame = back ? { a: [W, D], dir: [-1, 0], inward: [0, -1] } : { a: [0, 0], dir: [1, 0], inward: [0, 1] };
      const flipU = (u) => (back ? W - u : u);
      const keep = [{ poly: opening.map(([u, v]) => [flipU(u), v]), grow: A.ring[0] }];
      const joints = wallJoints(wasm, own, back ? 'arch-back' : 'arch-front', { length: W, bottom: 0, top: spring, frame, ceil: spring }, keep, stone, 'stone');
      if (joints) solid = own(solid.subtract(joints));
      // Standing out of its face: the band round the arch and its imposts, the first floor's band, the shutters; the cornice further.
      const rw = A.ring[0];
      const ring = own(poly(archOutline(x0 - rw, x1 + rw, spring, A.rise + rw, spring)).subtract(poly(opening)));
      const imposts = [rect(x0 - rw - 1.5, spring - 2.5, x0, spring + 0.01), rect(x1, spring - 2.5, x1 + rw + 1.5, spring + 0.01)];
      const shutters = [];
      for (const [a, b, c, d] of wins) {
        const [sw, , gap] = A.shutter;
        shutters.push(rect(a - gap - sw, b, a - gap, d), rect(c + gap, b, c + gap + sw, d));
      }
      const low = own(CrossSection.union([ring, ...imposts, rect(0, first - A.band[0] / 2, W, first + A.band[0] / 2), ...shutters]));
      const out = back ? [0, 1, 0] : [0, -1, 0];
      const face = back ? D : 0;
      const raise = (cs2, d) => sweep(cs2, [1, 0, 0], [0, 0, 1], [0, face, 0], out, -0.01, d);
      solid = own(Manifold.union([solid, raise(low, A.band[1]), raise(rect(0, H - A.cornice[0], W, H), A.cornice[1])]));
      return solid;
    };
    const halves = (solid, ids, back) => {
      const left = own(solid.intersect(box(-10, -10, -1, W / 2, D + 10, H + 10))),
        right = own(solid.intersect(box(W / 2, -10, -1, W + 10, D + 10, H + 10)));
      const out = back ? [0, 1, 0] : [0, -1, 0];
      parts.push({ id: ids[0], name: back ? 'Back, left half' : 'Front, left half', role: 'wall', solid: left, outward: out, apart: [-8, out[1] * 22, 0] });
      parts.push({ id: ids[1], name: back ? 'Back, right half' : 'Front, right half', role: 'wall', solid: right, outward: out, apart: [8, out[1] * 22, 0] });
    };
    halves(facade(false), ['front-left', 'front-right'], false);
    halves(facade(true), ['back-left', 'back-right'], true);
    // The sides, between the front and the back: a window on each storey, the stones up to the arch's spring.
    for (const [id, name, xw, sign] of [['side-left', 'Left side', 0, -1], ['side-right', 'Right side', W - t, 1]]) {
      const L = D - 2 * t;
      const wins = [];
      for (let k = 0; k < h.storeys; k++) wins.push(rect(L / 2 - A.window[0] / 2, first + k * A.storey + A.sill, L / 2 + A.window[0] / 2, first + k * A.storey + A.sill + A.window[1]));
      const cs = own(rect(0, 0, L, H).subtract(own(CrossSection.union(wins))));
      let solid = sweep(cs, [0, 1, 0], [0, 0, 1], [xw, t, 0], [1, 0, 0], 0, t);
      const frame = sign < 0 ? { a: [0, D - t], dir: [0, -1], inward: [1, 0] } : { a: [W, t], dir: [0, 1], inward: [-1, 0] };
      const joints = wallJoints(wasm, own, id, { length: L, bottom: 0, top: spring, frame, ceil: spring }, [], stone, 'stone');
      if (joints) solid = own(solid.subtract(joints));
      const band = sweep(rect(0, first - A.band[0] / 2, L, first + A.band[0] / 2), [0, 1, 0], [0, 0, 1], [sign < 0 ? 0 : W, t, 0], [sign, 0, 0], -0.01, A.band[1]);
      const cornice = sweep(rect(0, H - A.cornice[0], L, H), [0, 1, 0], [0, 0, 1], [sign < 0 ? 0 : W, t, 0], [sign, 0, 0], -0.01, A.cornice[1]);
      solid = own(Manifold.union([solid, band, cornice]));
      parts.push({ id, name, role: 'wall', solid, outward: [sign, 0, 0], apart: [sign * 22, 0, 0] });
    }
    // The walls of the passage, their faces flush with the arch's jambs, the stones up to its spring; the ceiling on them.
    for (const [id, name, xf, sign] of [['passage-left', 'Passage wall, left', x0, 1], ['passage-right', 'Passage wall, right', x1, -1]]) {
      const L = D - 2 * t;
      let solid = sweep(rect(0, 0, L, h.clearance), [0, 1, 0], [0, 0, 1], [xf, t, 0], [-sign, 0, 0], 0, t);
      const frame = sign > 0 ? { a: [xf, t], dir: [0, 1], inward: [-1, 0] } : { a: [xf, D - t], dir: [0, -1], inward: [1, 0] };
      const joints = wallJoints(wasm, own, id, { length: L, bottom: 0, top: spring, frame, ceil: spring }, [], stone, 'stone');
      if (joints) solid = own(solid.subtract(joints));
      parts.push({ id, name, role: 'wall', solid, outward: [sign, 0, 0], apart: [sign * 10, 0, 0] });
    }
    // The ceiling and the roof each in two, their joins either side of the middle, not over the fronts' join.
    const split = (room, reach, off) => (W / 2 + off + reach <= room ? off : 0);
    const cOff = split(205, A.wall, 12);
    const cm = W / 2 + cOff;
    parts.push({ id: 'ceiling-left', name: 'Passage ceiling, left', role: 'floor', solid: box(x0 - t, t, h.clearance, cm, D - t, h.clearance + t), lie: [0, 0, 0], apart: [-8, 0, 12] });
    parts.push({ id: 'ceiling-right', name: 'Passage ceiling, right', role: 'floor', solid: box(cm, t, h.clearance, x1 + t, D - t, h.clearance + t), lie: [0, 0, 0], apart: [8, 0, 12] });
    const o = A.overhang,
      [pw, ph] = A.parapet;
    const rm = W / 2 - split(205, o, 12);
    const roof = (a, b, ends) => {
      const bits = [box(a, -o, H, b, D + o, H + A.roof), box(a, -o, H + A.roof - 0.01, b, -o + pw, H + A.roof + ph), box(a, D + o - pw, H + A.roof - 0.01, b, D + o, H + A.roof + ph)];
      for (const x of ends) bits.push(box(x, -o, H + A.roof - 0.01, x + pw, D + o, H + A.roof + ph));
      return own(Manifold.union(bits));
    };
    parts.push({ id: 'roof-left', name: 'Roof, left', role: 'roof', solid: roof(-o, rm, [-o]), lie: [0, 0, 0], apart: [-8, 0, 34] });
    parts.push({ id: 'roof-right', name: 'Roof, right', role: 'roof', solid: roof(rm, W + o, [W + o - pw]), lie: [0, 0, 0], apart: [8, 0, 34] });
    // The balcony: a slab on the band along the first floor, its railing round it, glued to the front.
    if (h.balcony) {
      const B = A.balcony,
        yb = -A.shutter[1];
      const y0 = yb - B.deep,
        zt = first;
      const bits = [box(b0, y0, zt - B.slab, b1, yb, zt)];
      const top = zt + B.rail;
      bits.push(box(b0, y0, top - 1, b1, y0 + 1, top), box(b0, y0, top - 1, b0 + 1, yb, top), box(b1 - 1, y0, top - 1, b1, yb, top));
      for (let x = b0; x <= b1 - B.bar + 1e-6; x += (b1 - b0 - B.bar) / Math.round((b1 - b0) / B.pitch)) bits.push(box(x, y0, zt - 0.01, x + B.bar, y0 + B.bar, top - 0.99));
      for (const x of [b0, b1 - B.bar]) for (let y = y0 + B.pitch; y < yb - 1; y += B.pitch) bits.push(box(x, y, zt - 0.01, x + B.bar, y + B.bar, top - 0.99));
      parts.push({ id: 'balcony', name: 'Balcony', role: 'frame', solid: own(Manifold.union(bits)), lie: [0, 0, 0], apart: [0, -34, 0] });
    }
    // In the order of the layout.
    const order = [...PARTS.map(([id]) => id), 'balcony'];
    parts.sort((p, q) => order.indexOf(p.id) - order.indexOf(q.id));
    return keepParts(temp, parts);
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}

export function archHouseNotes(name, h, parts, sizes, fmt) {
  return [
    name + ' · SlotForge Foundry arch house kit',
    '',
    'A house ' + fmt(widthOf(h)) + ' mm wide and ' + fmt(h.depth) + ' mm deep over the road, the track running through an arch ' + fmt(h.span) + ' mm wide and ' + fmt(h.clearance) + ' mm high in its ground floor, ' + h.storeys + (h.storeys > 1 ? ' storeys' : ' storey') + ' above it' + (h.balcony ? ', a balcony over the arch.' : '.'),
    '',
    'Parts, as they lie on the plate:',
    partLines(parts, sizes, fmt),
    '',
    'Printing',
    '- Every part prints without supports. The walls lie flat, their outsides up; the ceiling, the roof' + (h.balcony ? ' and the balcony' : '') + ' lie flat too.',
    '',
    'Putting it together',
    '1. Glue the two halves of the front together over the middle of the arch, and the two halves of the back.',
    '2. Stand the front and the back up either side of the track, and glue the sides and the walls of the passage between them, the passage walls’ faces flush with the arch.',
    '3. Lay the two halves of the ceiling on the passage walls, then the roof on top, its low wall up.',
    ...(h.balcony ? ['4. Glue the balcony to the front on the band along the first floor, over the middle of the arch.'] : []),
    'Paint the walls white, the shutters green, and wash the stones of the piers grey.',
  ].join('\n');
}
