// A level crossing on a rally stage: the railway runs up to the road on
// each side over its ballast and sleepers, a half barrier on each side of
// the road (their booms raised, so the cars get by), a cross sign before
// each, and the crossing keeper's brick cottage beside the line. The rails
// stop at the track's borders: the slots run on between them. Every part
// prints flat but the cottage, which stands upright, open on top under its
// roof. x across the road (the railway runs along x), y along it, z up; the
// road between x = 0 and x = span.

import { kitShapes } from './kit-shapes.js';
import { wallJoints } from './building-texture.js';
import { checkKeys, checkLimits, keepParts, lieY, partLines } from './drive-through.js';

export const LEVEL_CROSSING_DEFAULTS = Object.freeze({
  kind: 'levelcrossing',
  span: 220, // the road between the rails' ends: the track and its borders
  verge: 50, // the railway each side of the road
  barriers: true,
  cottage: true,
});
export const LEVEL_CROSSING_LIMITS = Object.freeze({ span: [140, 300], verge: [40, 80] });
export const LEVEL_CROSSING = Object.freeze({
  gauge: 45, // between the rails, standard gauge at 1:32
  bed: [64, 56, 3], // the ballast: wide at its foot, at its top, high
  sleeper: [3.5, 58, 1.5, 8], // wide, long, high, apart
  rail: [1.6, 2.4], // wide, high
  gap: 1, // the rails clear of the road
  post: { foot: [12, 2], width: 4, height: 26, box: [10, 12], thick: 6 }, // the barrier's post
  boom: [3, 2], // wide, thick
  sign: { post: 2.5, height: 44, bar: [28, 3.4], thick: 2, foot: [10, 2] },
  cottage: { width: 42, depth: 34, eave: 28, pitch: 40, wall: 2, roof: 2.2, overhang: 3, door: [11, 22], window: [9, 11] },
  set: 14, // the cottage back from the railway's middle
});
const LABELS = { span: 'Width of the road', verge: 'Railway each side' };

export function validateLevelCrossing(input) {
  const c = { ...LEVEL_CROSSING_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  checkKeys(c, LEVEL_CROSSING_DEFAULTS, 'level crossing');
  checkLimits(c, LEVEL_CROSSING_LIMITS, LABELS);
  if (typeof c.barriers !== 'boolean') throw Error('Choose whether the crossing has barriers.');
  if (typeof c.cottage !== 'boolean') throw Error('Choose whether the crossing has a keeper’s cottage.');
  return c;
}
const K = LEVEL_CROSSING;
const boomOf = (c) => Math.min(c.span / 2 - 12, 110);
// Where the cottage stands: on the left of the road, behind the railway.
const cottageAt = (c) => {
  const w = Math.min(K.cottage.width, c.verge - 8);
  return [-c.verge + (c.verge - 4 - w), -4, K.bed[0] / 2 + K.set - 14, K.bed[0] / 2 + K.set - 14 + K.cottage.depth];
};
// The barriers: their posts' middles [x, y], each on its own side before the railway.
const postsOf = (c) => [[-8, -K.bed[0] / 2 - 10], [c.span + 8, K.bed[0] / 2 + 10]];
const signsOf = (c) => [[-18, -K.bed[0] / 2 - 22], [c.span + 18, K.bed[0] / 2 + 22]];

/** On the table: [x0, y0, x1, y1]. */
export const levelCrossingFootprint = (c) => {
  const o = K.cottage.overhang;
  const [, , , cy1] = cottageAt(c);
  const reach = Math.max(K.bed[0] / 2, K.bed[0] / 2 + 22 + K.sign.thick / 2, c.barriers ? K.bed[0] / 2 + 10 + K.post.thick / 2 : 0);
  return [-c.verge, -reach, c.span + c.verge, Math.max(reach, c.cottage ? cy1 + o : 0)];
};

export function levelCrossingLayout(input) {
  const c = validateLevelCrossing(input);
  const parts = [
    { id: 'rails-left', name: 'Railway, left', role: 'floor' },
    { id: 'rails-right', name: 'Railway, right', role: 'floor' },
    { id: 'sign-left', name: 'Cross sign, left', role: 'frame' },
    { id: 'sign-right', name: 'Cross sign, right', role: 'frame' },
  ];
  if (c.barriers) parts.push({ id: 'barrier-left', name: 'Barrier post, left', role: 'frame' }, { id: 'boom-left', name: 'Boom, left', role: 'frame' }, { id: 'barrier-right', name: 'Barrier post, right', role: 'frame' }, { id: 'boom-right', name: 'Boom, right', role: 'frame' });
  if (c.cottage) parts.push({ id: 'cottage', name: 'Keeper’s cottage', role: 'wall' }, { id: 'roof-front', name: 'Cottage roof, to the road', role: 'roof' }, { id: 'roof-back', name: 'Cottage roof, to the back', role: 'roof' });
  return { building: c, parts };
}

export function buildLevelCrossing(wasm, input) {
  const c = validateLevelCrossing(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { box, poly, sweep } = kitShapes(wasm, own);
  const { Manifold, CrossSection } = wasm;
  const rect = (u0, v0, u1, v1) => poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  const parts = [];
  try {
    // The railway each side: its ballast, the sleepers on it, the two rails on them.
    const [bw, bt, bh] = K.bed,
      [sw, sl, sh, sp] = K.sleeper,
      [rw, rh] = K.rail;
    const railway = (x0, x1) => {
      const bed = sweep([[-bw / 2, 0], [bw / 2, 0], [bt / 2, bh], [-bt / 2, bh]], [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], x0, x1);
      const bits = [bed];
      const n = Math.max(1, Math.floor((x1 - x0 - sw) / sp));
      const s0 = x0 + (x1 - x0 - sw - n * sp) / 2;
      for (let k = 0; k <= n; k++) bits.push(box(s0 + k * sp, -sl / 2, bh - 0.01, s0 + k * sp + sw, sl / 2, bh + sh));
      for (const y of [-K.gauge / 2, K.gauge / 2]) bits.push(box(x0, y - rw / 2, bh + sh - 0.01, x1, y + rw / 2, bh + sh + rh));
      return own(Manifold.union(bits));
    };
    parts.push({ id: 'rails-left', name: 'Railway, left', role: 'floor', solid: railway(-c.verge, -K.gap), lie: [0, 0, 0], apart: [-12, 0, 0] });
    parts.push({ id: 'rails-right', name: 'Railway, right', role: 'floor', solid: railway(c.span + K.gap, c.span + c.verge), lie: [0, 0, 0], apart: [12, 0, 0] });
    // A cross sign: a post, a cross of two boards at its top, a foot; flat, facing the road.
    const G = K.sign;
    const signAt = ([x, y], id, name) => {
      const [bl, bb] = G.bar;
      const bar = (deg) => {
        const r = (deg * Math.PI) / 180,
          d = [Math.cos(r) * bl / 2, Math.sin(r) * bl / 2],
          n = [-Math.sin(r) * bb / 2, Math.cos(r) * bb / 2],
          m = [0, G.height - bl * 0.32];
        return poly([[m[0] - d[0] - n[0], m[1] - d[1] - n[1]], [m[0] + d[0] - n[0], m[1] + d[1] - n[1]], [m[0] + d[0] + n[0], m[1] + d[1] + n[1]], [m[0] - d[0] + n[0], m[1] - d[1] + n[1]]]);
      };
      const cs = own(CrossSection.union([rect(-G.post / 2, 0, G.post / 2, G.height - bl * 0.32), rect(-G.foot[0] / 2, 0, G.foot[0] / 2, G.foot[1]), bar(35), bar(-35)]));
      const solid = sweep(cs, [1, 0, 0], [0, 0, 1], [x, y, 0], [0, 1, 0], -G.thick / 2, G.thick / 2);
      parts.push({ id, name, role: 'frame', solid, outward: [0, -1, 0], apart: [0, y < 0 ? -12 : 12, 0] });
    };
    const signs = signsOf(c);
    signAt(signs[0], 'sign-left', 'Cross sign, left');
    signAt(signs[1], 'sign-right', 'Cross sign, right');
    // The half barriers: a post with its box at the top, the boom raised beside it.
    if (c.barriers) {
      const B = K.post,
        [mw, mt] = K.boom;
      postsOf(c).forEach(([x, y], i) => {
        const side = i === 0 ? 'left' : 'right',
          toward = i === 0 ? 1 : -1; // towards the road
        const [bx, bz] = B.box;
        const cs = own(CrossSection.union([rect(-B.foot[0] / 2, 0, B.foot[0] / 2, B.foot[1]), rect(-B.width / 2, 0, B.width / 2, B.height), rect(-bx / 2, B.height - 6, bx / 2, B.height - 6 + bz)]));
        const post = sweep(cs, [1, 0, 0], [0, 0, 1], [x, y, 0], [0, 1, 0], -B.thick / 2, B.thick / 2);
        parts.push({ id: 'barrier-' + side, name: 'Barrier post, ' + side, role: 'frame', solid: post, outward: [0, -1, 0], apart: [0, 0, 0] });
        // The boom stands up beside the box, against its face towards the road.
        const u0 = x + toward * (bx / 2),
          pivot = B.height;
        const L = boomOf(c);
        const boomCs = rect(Math.min(u0, u0 + toward * mw), pivot - 8, Math.max(u0, u0 + toward * mw), pivot + L);
        const boom = sweep(boomCs, [1, 0, 0], [0, 0, 1], [0, y, 0], [0, 1, 0], -mt / 2, mt / 2);
        parts.push({ id: 'boom-' + side, name: 'Boom, ' + side, role: 'frame', solid: boom, outward: [0, -1, 0], apart: [toward * 10, 0, 0] });
      });
    }
    // The keeper's cottage: brick walls, gables to the railway and away from it, a door and a window to the road.
    if (c.cottage) {
      const H = K.cottage;
      const [x0, x1, y0, y1] = cottageAt(c),
        t = H.wall,
        W = x1 - x0,
        D = y1 - y0;
      const tan = Math.tan((H.pitch * Math.PI) / 180),
        ridge = H.eave + (W / 2) * tan;
      const gable = [[0, 0], [W, 0], [W, H.eave], [W / 2, ridge], [0, H.eave]];
      const walls = [
        box(x0, y0 + t, 0, x0 + t, y1 - t, H.eave), box(x1 - t, y0 + t, 0, x1, y1 - t, H.eave),
        sweep(gable, [1, 0, 0], [0, 0, 1], [x0, y0, 0], [0, 1, 0], 0, t), sweep(gable, [1, 0, 0], [0, 0, 1], [x0, y1 - t, 0], [0, 1, 0], 0, t),
      ];
      let cottage = own(Manifold.union(walls));
      const [dw, dh] = H.door,
        [ww, wh] = H.window;
      const holes = [
        box(x1 - t - 1, y0 + D / 2 - dw / 2 - 6, -1, x1 + 1, y0 + D / 2 + dw / 2 - 6, dh), // the door, to the road
        box(x1 - t - 1, y0 + D - 10 - ww, 11, x1 + 1, y0 + D - 10, 11 + wh),
        box(x0 + W / 2 - ww / 2, y0 - 1, 11, x0 + W / 2 + ww / 2, y0 + t + 1, 11 + wh), // to the railway
        box(x0 - 1, y0 + D / 2 - ww / 2, 11, x0 + t + 1, y0 + D / 2 + ww / 2, 11 + wh),
        box(x0 + W / 2 - ww / 2, y1 - t - 1, 11, x0 + W / 2 + ww / 2, y1 + 1, 11 + wh),
      ];
      cottage = own(cottage.subtract(own(Manifold.union(holes))));
      const brick = { textureScale: 100, textureJoint: 0.5, textureDepth: 0.5 };
      const keep = (u0, u1, z0, z1) => [u0, z0, u1, z1];
      const faces = [
        ['cottage-rail', { a: [x0, y0], dir: [1, 0], inward: [0, 1] }, W, [keep(W / 2 - ww / 2, W / 2 + ww / 2, 11, 11 + wh)]],
        ['cottage-road', { a: [x1, y0], dir: [0, 1], inward: [-1, 0] }, D, [keep(D / 2 - dw / 2 - 6, D / 2 + dw / 2 - 6, 0, dh), keep(D - 10 - ww, D - 10, 11, 11 + wh)]],
        ['cottage-back', { a: [x1, y1], dir: [-1, 0], inward: [0, -1] }, W, [keep(W / 2 - ww / 2, W / 2 + ww / 2, 11, 11 + wh)]],
        ['cottage-field', { a: [x0, y1], dir: [0, -1], inward: [1, 0] }, D, [keep(D / 2 - ww / 2, D / 2 + ww / 2, 11, 11 + wh)]],
      ];
      const cuts = faces.map(([id, frame, length, out]) => wallJoints(wasm, own, id, { length, bottom: 0, top: H.eave, frame, ceil: H.eave }, out, brick, 'brick')).filter(Boolean);
      if (cuts.length) cottage = own(cottage.subtract(own(Manifold.union(cuts))));
      parts.push({ id: 'cottage', name: 'Keeper’s cottage', role: 'wall', solid: cottage, lie: [0, 0, 0], apart: [0, 0, 0] });
      // Its roof: a slab on each slope, meeting at the ridge, past the walls all round.
      const o = H.overhang,
        thick = H.roof / Math.cos((H.pitch * Math.PI) / 180);
      const zAt = (x) => H.eave + (x - x0) * tan; // under the road side's slope... from the eave at x0
      const m = x0 + W / 2;
      const left = [[x0 - o, zAt(x0 - o)], [m, zAt(m)], [m, zAt(m) + thick], [x0 - o, zAt(x0 - o) + thick]];
      const right = left.map(([x, z]) => [2 * m - x, z]);
      const slab = (pts) => sweep(pts, [1, 0, 0], [0, 0, 1], [0, y0 - o, 0], [0, 1, 0], 0, D + 2 * o);
      const sn = Math.sin((H.pitch * Math.PI) / 180),
        cn = Math.cos((H.pitch * Math.PI) / 180);
      parts.push({ id: 'roof-front', name: 'Cottage roof, to the road', role: 'roof', solid: slab(right), lie: lieY([sn, 0, cn]), apart: [10, 0, 22] });
      parts.push({ id: 'roof-back', name: 'Cottage roof, to the back', role: 'roof', solid: slab(left), lie: lieY([-sn, 0, cn]), apart: [-10, 0, 22] });
    }
    return keepParts(temp, parts);
  } catch (e) {
    for (const x of temp) x.delete();
    throw e;
  }
}

export function levelCrossingNotes(name, c, parts, sizes, fmt) {
  return [
    name + ' · SlotForge Foundry level crossing kit',
    '',
    'A level crossing over a road ' + fmt(c.span) + ' mm wide: the railway ' + fmt(c.verge) + ' mm each side of it, standard gauge at 1:32, a cross sign before it each way' + (c.barriers ? ', a half barrier each side, its boom raised' : '') + (c.cottage ? ', the keeper’s brick cottage beside the line.' : '.'),
    '',
    'Parts, as they lie on the plate:',
    partLines(parts, sizes, fmt),
    '',
    'Printing',
    '- Every part prints without supports. The railway, the signs' + (c.barriers ? ', the barrier posts and the booms' : '') + ' lie flat' + (c.cottage ? '; the cottage stands upright, open on top, its two roof slabs flat.' : '.'),
    '',
    'Putting it together',
    '1. Lay the railway each side of the track, the rails’ ends at the borders, both lines straight across.',
    '2. Stand the cross signs before the railway, one each way' + (c.barriers ? ', and the barrier posts beside the road; glue each boom upright against its post’s box.' : '.'),
    ...(c.cottage ? ['3. Stand the cottage beside the line, its door to the road, and glue the two roof slabs on, meeting at the ridge.'] : []),
    'Paint the ballast grey, the sleepers brown, the rails rust; the crosses and the booms white with red bands.',
  ].join('\n');
}
