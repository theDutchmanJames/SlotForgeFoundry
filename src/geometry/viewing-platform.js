// A viewing platform: a planked deck on steel frames, X-braced between
// their legs, a railing all round, a staircase up one end or both and a board for a
// sign along the front. The four frames print flat and stand on the table,
// their tabs up into pockets under the deck, which holds them square; the
// deck prints the right way up, its planks on top; the railings print flat
// and push into pockets along its edges; the staircase prints on its side.
// x along the front, y from the front (the track at negative y) to the
// back, z up.

import { kitShapes } from './kit-shapes.js';

export const PLATFORM_DEFAULTS = Object.freeze({
  kind: 'platform',
  width: 150,
  depth: 110,
  height: 65, // the top of the deck above the table
  stair: 'left', // 'left', 'right', 'both' or 'none'
  stairWidth: 30,
  railing: true,
  railingHeight: 26,
  board: true, // a board for a sign along the front, under the deck
  boardHeight: 18,
  planks: true,
});
export const PLATFORM_LIMITS = Object.freeze({
  width: [60, 190],
  depth: [50, 190],
  height: [30, 120],
  stairWidth: [20, 50],
  railingHeight: [12, 40],
  boardHeight: [8, 40],
});
export const PLATFORM = Object.freeze({
  deck: 5,
  frame: 4, // a frame: thick
  member: 6, // its legs and chords: wide
  brace: 4, // its braces: wide
  bay: 55, // a bay between two legs, at most
  inset: 5, // the frames stand in from the edge of the deck
  tab: [8, 2.5], // on top of a frame: long, high
  play: 0.15,
  plank: [8, 0.6], // planks: wide, the groove between them deep
  rise: 7, // a step at most this high
  tread: 9,
  landing: 24, // the top of the staircase, beside the deck
  slab: 6, // under the steps
  post: 6, // the post under the landing
  parapet: [3, 12], // the staircase's outer wall: thick, above the steps
  board: 5, // the board: thick, flush with the front of the deck
  rail: { thick: 3, band: 4, post: 3, pitch: 20, tab: 2, inset: 1, mid: true },
});
const LABELS = {
  width: 'Width',
  depth: 'Depth',
  height: 'Deck height',
  stairWidth: 'Staircase width',
  railingHeight: 'Railing height',
  boardHeight: 'Board height',
};

/** The viewing platform as kept: known settings only, each checked. */
export function validatePlatform(input) {
  const p = { ...PLATFORM_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(p)) if (!Object.hasOwn(PLATFORM_DEFAULTS, key)) throw Error('The viewing platform has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(PLATFORM_LIMITS))
    if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + ' mm.');
  if (!['left', 'right', 'both', 'none'].includes(p.stair)) throw Error('Put a staircase at the left, at the right or at both ends, or leave it out.');
  for (const key of ['railing', 'board', 'planks']) if (typeof p[key] !== 'boolean') throw Error('Choose whether the platform has ' + { railing: 'a railing', board: 'a board', planks: 'planks' }[key] + '.');
  const room = p.height - PLATFORM.deck - 2 * PLATFORM.member;
  if (p.board && p.boardHeight > room) throw Error('The board is too high for the frames under the deck: at most ' + room + ' mm.');
  return p;
}

/** The staircase: how many steps, how high each, and where it starts in front of the back of the deck. */
export function platformStair(p) {
  const steps = Math.max(2, Math.ceil(p.height / PLATFORM.rise));
  return { steps, rise: p.height / steps, run: (steps - 1) * PLATFORM.tread + PLATFORM.landing };
}

/** The ends with a staircase: 'left', 'right', both or none. */
export function stairEnds(p) {
  return { left: ['left'], right: ['right'], both: ['left', 'right'], none: [] }[p.stair];
}

/** The platform on the table, from its own origin: [x0, y0, x1, y1], the staircases beside it. */
export function platformFootprint(p) {
  const { run } = platformStair(p);
  const ends = stairEnds(p);
  const at = (end) => (ends.includes(end) ? p.stairWidth : 0);
  return [-at('left'), ends.length ? Math.min(0, p.depth - run) : 0, p.width + at('right'), p.depth];
}

const FRAMES = [
  ['frame-front', 'Frame, front'],
  ['frame-back', 'Frame, back'],
  ['frame-left', 'Frame, left'],
  ['frame-right', 'Frame, right'],
];
const RAILS = [
  ['rail-front', 'Railing, front'],
  ['rail-back', 'Railing, back'],
  ['rail-left', 'Railing, left'],
  ['rail-right', 'Railing, right'],
];

/** The parts of a viewing platform, without geometry. */
export function platformLayout(input) {
  const p = validatePlatform(input);
  const parts = [{ id: 'deck', name: 'Deck', role: 'floor' }, ...FRAMES.map(([id, name]) => ({ id, name, role: 'frame' }))];
  for (const end of stairEnds(p)) parts.push({ id: 'stair-' + end, name: 'Staircase, ' + end, role: 'wall' });
  if (p.railing) parts.push(...RAILS.map(([id, name]) => ({ id, name, role: 'frame' })));
  if (p.board) parts.push({ id: 'board', name: 'Board', role: 'wall' });
  return { building: p, parts };
}

/** The viewing platform, built, standing where it goes. */
export function buildPlatform(wasm, input) {
  const { Manifold, CrossSection } = wasm;
  const p = validatePlatform(input);
  const temp = [];
  const own = (x) => (temp.push(x), x);
  const { box, poly, sweep, railing } = kitShapes(wasm, own);
  const union = (list) => own(Manifold.union(list));
  const W = p.width,
    D = p.depth,
    H = p.height,
    T = PLATFORM.deck,
    F = PLATFORM.frame,
    M = PLATFORM.member,
    I = PLATFORM.inset;
  const under = H - T;
  const parts = [];
  try {
    // A frame in its own plane (u along it, v up), its tabs on top: legs at
    // its ends and between its bays, a chord at the foot and at the top, an
    // X of braces in each bay.
    const frameShape = (len) => {
      const bays = Math.max(1, Math.ceil((len - M) / PLATFORM.bay));
      const legs = Array.from({ length: bays + 1 }, (_, k) => (k * (len - M)) / bays);
      const bits = [poly([[0, 0], [len, 0], [len, M], [0, M]]), poly([[0, under - M], [len, under - M], [len, under], [0, under]])];
      for (const u of legs) bits.push(poly([[u, 0], [u + M, 0], [u + M, under], [u, under]]));
      const b = PLATFORM.brace / 2;
      const bar = (a, c) => {
        const d = [c[0] - a[0], c[1] - a[1]],
          l = Math.hypot(...d),
          n = [(-d[1] / l) * b, (d[0] / l) * b];
        return poly([[a[0] - n[0], a[1] - n[1]], [c[0] - n[0], c[1] - n[1]], [c[0] + n[0], c[1] + n[1]], [a[0] + n[0], a[1] + n[1]]]);
      };
      for (let k = 0; k < bays; k++) {
        const u0 = legs[k] + M,
          u1 = legs[k + 1],
          v0 = M,
          v1 = under - M;
        const inside = poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        bits.push(own(own(CrossSection.union([bar([u0, v0], [u1, v1]), bar([u0, v1], [u1, v0])])).intersect(inside)));
      }
      const [tl, th] = PLATFORM.tab;
      const tabs = [0.25 * len, 0.75 * len];
      for (const u of tabs) bits.push(poly([[u - tl / 2, under - 0.01], [u + tl / 2, under - 0.01], [u + tl / 2, under + th], [u - tl / 2, under + th]]));
      return { shape: own(CrossSection.union(bits)), tabs };
    };
    // Each frame: where it starts, along which way, the way in, and how long.
    const frames = [
      { id: 'frame-front', from: [I, I], dir: [1, 0, 0], inward: [0, 1, 0], len: W - 2 * I },
      { id: 'frame-back', from: [I, D - I], dir: [1, 0, 0], inward: [0, -1, 0], len: W - 2 * I },
      { id: 'frame-left', from: [I, I + F], dir: [0, 1, 0], inward: [1, 0, 0], len: D - 2 * (I + F) },
      { id: 'frame-right', from: [W - I, I + F], dir: [0, 1, 0], inward: [-1, 0, 0], len: D - 2 * (I + F) },
    ];
    const pockets = [];
    for (const f of frames) {
      const { shape, tabs } = frameShape(f.len);
      const origin = [f.from[0], f.from[1], 0];
      const solid = sweep(shape, f.dir, [0, 0, 1], origin, f.inward, 0, F);
      const [tl, th] = PLATFORM.tab,
        g = PLATFORM.play;
      // Its pockets under the deck, a little larger than its tabs.
      for (const u of tabs) {
        const at = (du, dw) => [origin[0] + f.dir[0] * (u + du) + f.inward[0] * dw, origin[1] + f.dir[1] * (u + du) + f.inward[1] * dw];
        const a = at(-tl / 2 - g, -g),
          c = at(tl / 2 + g, F + g);
        pockets.push(box(Math.min(a[0], c[0]), Math.min(a[1], c[1]), under - 1, Math.max(a[0], c[0]), Math.max(a[1], c[1]), under + th + 0.2));
      }
      const out = f.inward.map((v) => -v);
      parts.push({ id: f.id, name: FRAMES.find(([id]) => id === f.id)[1], role: 'frame', solid, outward: out, apart: [out[0] * 15, out[1] * 15, 0] });
    }

    // The deck: planks along the front, pockets under it for the frames and on top for the railings.
    let deck = box(0, 0, under, W, D, H);
    const cuts = [...pockets];
    if (p.planks) {
      const [pw, gd] = PLATFORM.plank;
      for (let y = pw; y < D - 2; y += pw) cuts.push(sweep([[y - gd, H + 0.5], [y, H - gd], [y + gd, H + 0.5]], [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], -1, W + 1));
    }
    const R = { ...PLATFORM.rail, height: p.railingHeight };
    const rails = [];
    if (p.railing) {
      const side = R.inset + R.thick + 0.2;
      const landing = PLATFORM.landing;
      // An end with a staircase stops short of its landing, leaving the way up open.
      const sideEnd = (s) => (stairEnds(p).includes(s) ? D - landing - 1 : D - side);
      const runs = [
        { id: 'rail-front', from: [0.1, 0], dir: [1, 0], len: W - 0.2, inward: [0, 1] },
        { id: 'rail-back', from: [W - 0.1, D], dir: [-1, 0], len: W - 0.2, inward: [0, -1] },
        { id: 'rail-left', from: [0, sideEnd('left')], dir: [0, -1], len: sideEnd('left') - side, inward: [1, 0] },
        { id: 'rail-right', from: [W, side], dir: [0, 1], len: sideEnd('right') - side, inward: [-1, 0] },
      ];
      for (const r of runs) {
        const { panel, pockets: pk } = railing({ ...r, z: H, inset: R.inset, spec: R });
        cuts.push(...pk);
        rails.push({ id: r.id, solid: panel, out: [-r.inward[0], -r.inward[1], 0] });
      }
    }
    deck = own(deck.subtract(union(cuts)));
    parts.unshift({ id: 'deck', name: 'Deck', role: 'floor', solid: deck, lie: [0, 0, 0], apart: [0, 0, 25] });

    // A staircase, at the left: steps on a slab, a post under the landing,
    // a wall on its outer side. Profile in (y, z), swept across its width.
    if (stairEnds(p).length) {
      const { steps, rise, run } = platformStair(p);
      const t = PLATFORM.tread,
        y0 = D - run,
        S = p.stairWidth;
      // Down the steps from the landing: each riser, then its tread.
      const outline = [[D, H], [y0 + (steps - 1) * t, H]];
      for (let k = steps - 1; k >= 1; k--) outline.push([y0 + k * t, k * rise], [y0 + (k - 1) * t, k * rise]);
      // Under the steps a slab, as thick as PLATFORM.slab square to them,
      // up to the underside of the landing; a post under the landing's end.
      const slope = rise / t,
        drop = PLATFORM.slab * Math.hypot(1, slope);
      const zLanding = H - PLATFORM.slab,
        yPost = D - PLATFORM.post;
      const foot = y0 + drop / slope,
        meet = Math.min(y0 + (zLanding + drop) / slope, yPost);
      outline.push([y0, 0], [foot, 0], [meet, zLanding], [yPost, zLanding], [yPost, 0], [D, 0]);
      const profile = poly(outline);
      const [pt, ph] = PLATFORM.parapet;
      const wall = poly([[y0, 0], [D, 0], [D, H + ph], [y0 + (steps - 1) * t, H + ph], [y0, rise + ph]]);
      const left = union([sweep(profile, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], -S + pt - 0.01, 0), sweep(wall, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], -S, -S + pt)]);
      // At the right, the same staircase the other way round.
      for (const end of stairEnds(p)) {
        const right = end === 'right';
        const solid = right ? own(own(left.mirror([1, 0, 0])).translate([W, 0, 0])) : left;
        parts.push({ id: 'stair-' + end, name: 'Staircase, ' + end, role: 'wall', solid, outward: [right ? -1 : 1, 0, 0], apart: [right ? 20 : -20, 0, 0] });
      }
    }

    for (const r of rails) parts.push({ id: r.id, name: RAILS.find(([id]) => id === r.id)[1], role: 'frame', solid: r.solid, outward: r.out, apart: [r.out[0] * 10, r.out[1] * 10, 45] });

    // The board: on the front of the front frame, under the deck, flush with its edge.
    if (p.board) {
      const z1 = under - 0.01;
      parts.push({ id: 'board', name: 'Board', role: 'wall', solid: box(0, I - PLATFORM.board, z1 - p.boardHeight, W, I, z1), outward: [0, -1, 0], apart: [0, -20, 0] });
    }
    const keep = new Set(parts.map((q) => q.solid));
    for (const x of new Set(temp)) if (!keep.has(x)) x.delete();
    return parts;
  } catch (e) {
    for (const x of new Set(temp)) x.delete();
    throw e;
  }
}
