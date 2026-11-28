// The mouth of a road tunnel through a headland: a stone headwall, its arch
// ringed with voussoirs and a keystone, a coping along its top; a short
// tunnel behind, lined; a small house built against the headwall beside
// the arch. The headwall prints flat in two halves meeting over the middle
// of the arch; the lining in two halves, each standing on its end; the
// house upright, open on top under its roof. x across the road, y along
// it (the cars drive in along y), z up; the headwall faces negative y.

import { kitShapes } from './kit-shapes.js';
import { wallJoints } from './building-texture.js';
import { archOutline, checkKeys, checkLimits, keepParts, partLines } from './drive-through.js';

export const TUNNEL_PORTAL_DEFAULTS = Object.freeze({
  kind: 'tunnelportal',
  span: 220, // the tunnel, wide: the track and its borders
  clearance: 90, // under the top of its arch
  length: 80, // the tunnel behind the headwall
  house: 'right', // 'left', 'right' or 'none'
});
export const TUNNEL_PORTAL_LIMITS = Object.freeze({ span: [140, 300], clearance: [60, 120], length: [30, 200] });
export const TUNNEL_PORTAL = Object.freeze({
  wing: 48, // the headwall beside the arch, each side
  face: 4, // the headwall, thick
  above: 30, // above the top of the arch
  lining: 3,
  jamb: 30, // the least height of the jambs, under where the arch springs
  ring: [7, 1.4], // the voussoirs: deep, standing out
  voussoir: 7, // about this wide along the arch
  slit: 0.6, // between two
  key: [10, 4], // the keystone: wide, higher than the ring
  coping: [5, 1.6],
  house: { width: 40, depth: 34, height: 54, wall: 2, roof: 2.4, overhang: 2, door: [12, 24], window: [10, 12] },
  clear: 1.6, // the house clear of the headwall's face, in front of the voussoirs
});
const LABELS = { span: 'Width of the tunnel', clearance: 'Height under the arch', length: 'Length of the tunnel' };

const widthOf = (p) => p.span + 2 * TUNNEL_PORTAL.wing;
const riseOf = (p) => Math.min(p.span / 2, p.clearance - TUNNEL_PORTAL.jamb);
const heightOf = (p) => p.clearance + TUNNEL_PORTAL.above;
/** Where the house stands: [x0, x1], in front of the headwall beside the arch. */
const houseAt = (p) => {
  const W = widthOf(p),
    w = TUNNEL_PORTAL.house.width,
    m = (TUNNEL_PORTAL.wing - w) / 2;
  return p.house === 'left' ? [m, m + w] : [W - m - w, W - m];
};

export function validateTunnelPortal(input) {
  const p = { ...TUNNEL_PORTAL_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  checkKeys(p, TUNNEL_PORTAL_DEFAULTS, 'tunnel portal');
  if (!['left', 'right', 'none'].includes(p.house)) throw Error('Choose a house on the left, on the right, or none.');
  checkLimits(p, TUNNEL_PORTAL_LIMITS, LABELS);
  return p;
}
/** On the table: [x0, y0, x1, y1], from the front of the house to the end of the tunnel. */
export const tunnelPortalFootprint = (p) => {
  const T = TUNNEL_PORTAL;
  return [0, p.house === 'none' ? -(T.ring[1] + 0.6) : -(T.clear + T.house.depth + T.house.overhang), widthOf(p), T.face + p.length];
};

export function tunnelPortalLayout(input) {
  const p = validateTunnelPortal(input);
  const parts = [
    { id: 'head-left', name: 'Headwall, left half', role: 'wall' },
    { id: 'head-right', name: 'Headwall, right half', role: 'wall' },
    { id: 'lining-left', name: 'Tunnel lining, left half', role: 'wall' },
    { id: 'lining-right', name: 'Tunnel lining, right half', role: 'wall' },
  ];
  if (p.house !== 'none') parts.push({ id: 'house', name: 'House', role: 'wall' }, { id: 'house-roof', name: 'Roof of the house', role: 'roof' });
  return { building: p, parts };
}

export function buildTunnelPortal(wasm, input) {
  const p = validateTunnelPortal(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { box, poly, sweep } = kitShapes(wasm, own);
  const { Manifold, CrossSection } = wasm;
  const T = TUNNEL_PORTAL;
  const W = widthOf(p),
    H = heightOf(p),
    rise = riseOf(p),
    spring = p.clearance - rise;
  const x0 = T.wing,
    x1 = T.wing + p.span,
    c = W / 2,
    a = p.span / 2;
  const rect = (u0, v0, u1, v1) => poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  const opening = archOutline(x0, x1, spring, rise);
  const parts = [];
  try {
    // The headwall: its face of stones, the arch through it.
    let wall = sweep(own(rect(0, 0, W, H).subtract(poly(opening))), [1, 0, 0], [0, 0, 1], [0, 0, 0], [0, 1, 0], 0, T.face);
    const joints = wallJoints(wasm, own, 'tunnel-head', { length: W, bottom: 0, top: H - T.coping[0], frame: { a: [0, 0], dir: [1, 0], inward: [0, 1] }, ceil: H - T.coping[0] }, [{ poly: opening, grow: T.ring[0] }], { textureScale: 130, textureJoint: 0.7, textureDepth: 0.7 }, 'stone');
    if (joints) wall = own(wall.subtract(joints));
    // The voussoirs round the arch and down its jambs, slits between them, a keystone at the top; the coping along the top.
    const [rd, rh] = T.ring;
    const outer = archOutline(x0 - rd, x1 + rd, spring, rise + rd, 0);
    let ring = own(poly(outer).subtract(poly(opening)));
    const arc = Math.PI * (a + rise) / 2 + Math.PI * rd / 2; // about half round the arch
    const m = Math.max(5, 2 * Math.round(arc / T.voussoir / 2) + 1); // an odd number: one at the top
    const slits = [];
    for (let i = 1; i < m; i++) {
      const th = (Math.PI * i) / m;
      const ci = [c + a * Math.cos(th), spring + rise * Math.sin(th)],
        co = [c + (a + rd + 2) * Math.cos(th), spring + (rise + rd + 2) * Math.sin(th)];
      const d = [co[0] - ci[0], co[1] - ci[1]],
        l = Math.hypot(...d),
        n = [(-d[1] / l) * (T.slit / 2), (d[0] / l) * (T.slit / 2)];
      const back = [ci[0] - (d[0] / l) * 2, ci[1] - (d[1] / l) * 2];
      slits.push(poly([[back[0] - n[0], back[1] - n[1]], [co[0] - n[0], co[1] - n[1]], [co[0] + n[0], co[1] + n[1]], [back[0] + n[0], back[1] + n[1]]]));
    }
    // The jambs' stones, in courses.
    for (let z = 10; z < spring - 3; z += 10) for (const [u0, u1] of [[x0 - rd - 1, x0], [x1, x1 + rd + 1]]) slits.push(rect(u0, z - T.slit / 2, u1, z + T.slit / 2));
    ring = own(ring.subtract(own(CrossSection.union(slits))));
    const [kw, kh] = T.key,
      top = p.clearance;
    const key = own(rect(c - kw / 2, top - 1, c + kw / 2, top + rd + kh).subtract(poly(opening)));
    const raise = (cs, d) => sweep(cs, [1, 0, 0], [0, 0, 1], [0, 0, 0], [0, -1, 0], -0.01, d);
    wall = own(Manifold.union([wall, raise(ring, rh), raise(key, rh + 0.6), raise(rect(0, H - T.coping[0], W, H), T.coping[1])]));
    const half = (solid, left) => own(solid.intersect(left ? box(-10, -10, -1, c, T.face + 10, H + 10) : box(c, -10, -1, W + 10, T.face + 10, H + 10)));
    parts.push({ id: 'head-left', name: 'Headwall, left half', role: 'wall', solid: half(wall, true), outward: [0, -1, 0], apart: [-8, -22, 0] });
    parts.push({ id: 'head-right', name: 'Headwall, right half', role: 'wall', solid: half(wall, false), outward: [0, -1, 0], apart: [8, -22, 0] });
    // The lining: the arch's shape, as thick as the lining, from the back of the headwall to the tunnel's end.
    const L = T.lining;
    const lining = own(poly(archOutline(x0 - L, x1 + L, spring, rise + L, 0)).subtract(poly(opening)));
    const tube = sweep(lining, [1, 0, 0], [0, 0, 1], [0, T.face, 0], [0, 1, 0], 0, p.length);
    parts.push({ id: 'lining-left', name: 'Tunnel lining, left half', role: 'wall', solid: half2(tube, true), lie: [90, 0, 0], apart: [-8, 20, 0] });
    parts.push({ id: 'lining-right', name: 'Tunnel lining, right half', role: 'wall', solid: half2(tube, false), lie: [90, 0, 0], apart: [8, 20, 0] });
    function half2(solid, left) {
      return own(solid.intersect(left ? box(-10, -10, -1, c, T.face + p.length + 10, H + 10) : box(c, -10, -1, W + 10, T.face + p.length + 10, H + 10)));
    }
    // The house against the headwall: four walls, open on top; a door and a window at its front, a window on the side to the road.
    if (p.house !== 'none') {
      const S = T.house;
      const [hx0, hx1] = houseAt(p);
      const y1 = -T.clear,
        y0 = y1 - S.depth,
        t = S.wall;
      let house = own(box(hx0, y0, 0, hx1, y1, S.height).subtract(box(hx0 + t, y0 + t, -1, hx1 - t, y1 - t, S.height + 1)));
      const [dw, dh] = S.door,
        [ww, wh] = S.window;
      const toRoad = p.house === 'right' ? hx0 : hx1 - t; // the side towards the arch
      const doorAt = p.house === 'right' ? hx0 + 6 : hx1 - 6 - dw;
      const winAt = p.house === 'right' ? hx1 - 6 - ww : hx0 + 6;
      const holes = [
        box(doorAt, y0 - 1, -1, doorAt + dw, y0 + t + 1, dh),
        box(winAt, y0 - 1, 22, winAt + ww, y0 + t + 1, 22 + wh),
        box(toRoad - 1, y0 + S.depth / 2 - ww / 2, 22, toRoad + t + 1, y0 + S.depth / 2 + ww / 2, 22 + wh),
        box(winAt, y0 - 1, 38, winAt + ww, y0 + t + 1, 38 + wh),
      ];
      house = own(house.subtract(own(Manifold.union(holes))));
      parts.push({ id: 'house', name: 'House', role: 'wall', solid: house, lie: [0, 0, 0], apart: [0, -30, 0] });
      const o = S.overhang;
      const roof = own(Manifold.union([box(hx0 - o, y0 - o, S.height, hx1 + o, y1, S.height + S.roof), box(hx0 - o, y0 - o, S.height + S.roof - 0.01, hx1 + o, y0 - o + 1.6, S.height + S.roof + 3)]));
      parts.push({ id: 'house-roof', name: 'Roof of the house', role: 'roof', solid: roof, lie: [0, 0, 0], apart: [0, -30, 24] });
    }
    return keepParts(temp, parts);
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}

export function tunnelPortalNotes(name, p, parts, sizes, fmt) {
  return [
    name + ' · SlotForge Foundry tunnel portal kit',
    '',
    'The mouth of a tunnel ' + fmt(p.span) + ' mm wide and ' + fmt(p.clearance) + ' mm high under its arch: a stone headwall ' + fmt(widthOf(p)) + ' mm wide, a lined tunnel ' + fmt(p.length) + ' mm long behind it' + (p.house !== 'none' ? ', a small house against the headwall on the ' + p.house + '.' : '.'),
    '',
    'Parts, as they lie on the plate:',
    partLines(parts, sizes, fmt),
    '',
    'Printing',
    '- Every part prints without supports. The headwall’s halves lie flat, their stones up; the lining’s halves stand on their ends' + (p.house !== 'none' ? '; the house stands upright, open on top, its roof flat.' : '.'),
    '',
    'Putting it together',
    '1. Glue the two halves of the headwall together over the top of the arch, and the two halves of the lining.',
    '2. Stand the lining over the track and glue the headwall to its front, the arches lined up.',
    ...(p.house !== 'none' ? ['3. Glue the house against the headwall beside the arch, and its roof on top, its lip to the front.'] : []),
    'Build the hillside up over the lining and round the headwall’s ends. Paint the stones grey, the voussoirs a little lighter.',
  ].join('\n');
}
