// Gantries and bridges over the track: a start gantry (two legs and a beam
// with start lights and an advertising board), a half gantry (one leg and a
// beam reaching out over the road) and a footbridge (a walkway between two
// parapet walls, on a staircase at each side). Each part prints without
// supports: legs stand on their feet, a beam lies on its back with its lights
// up, a walkway stands up like a channel, a staircase lies on its side. A part
// longer than the plate is cut, joining with dovetail tabs. Toy proportions
// for 1:32: x across the track, y along it, z up.

import { JOINT, seamRegion, tabPlaces } from './building-cuts.js';
import { kitShapes } from './kit-shapes.js';
import { LETTERING, checkText, fitHeight, letterDepth, raisedText, textWidth } from './lettering.js';

export const GANTRY_TYPES = Object.freeze([
  ['start', 'Start gantry'],
  ['half', 'Half gantry'],
  ['bridge', 'Footbridge'],
]);
export const GANTRY_DEFAULTS = Object.freeze({
  kind: 'gantry',
  type: 'start',
  span: 220, // clear between the legs or the staircases: the track and its borders
  clearance: 70, // clear under the beam or the walkway
  lights: 5, // start lights in the beam
  board: true, // an advertising board on top of the beam
  text: '', // lettered on the board: START, FINISH
  textCut: false, // its letters cut into the board, not raised
  boardHeight: 20,
  reach: 140, // a half gantry: how far its beam reaches from its leg
  deckWidth: 30, // a footbridge: its walkway, outside its walls
  wallHeight: 14, // and its walls, above the walkway
  // The legs, the beam and the walkway's walls: 'solid', 'lattice' (open
  // trusses, like steel) or 'timber' (the same, its members chunkier, the
  // board of planks, like wood).
  members: 'solid',
  // A half gantry: a box sign on top of its leg instead of a beam, its
  // height the board height.
  sign: false,
});
export const GANTRY_LIMITS = Object.freeze({
  span: [60, 1200],
  clearance: [40, 200],
  lights: [0, 10],
  boardHeight: [8, 60],
  reach: [40, 600],
  deckWidth: [20, 80],
  wallHeight: [8, 40],
});
export const GANTRY = Object.freeze({
  leg: 10, // a leg, square
  foot: [24, 3], // its foot plate: square, thick; a half gantry's is wider
  pin: [6, 4], // the pin on top of a leg: square, tall
  play: 0.15,
  beam: [12, 16], // the beam: deep, high
  light: [2.5, 1], // a start light: radius, depth
  board: 3, // the board: thick
  deck: 3, // the walkway, thick, and its walls
  rise: 7, // a step of a staircase at most this high
  tread: 9, // and this deep
  landing: 18, // the top of a staircase, under the end of the walkway
  // A lattice: a leg as an open box (its side, its corner posts), its bars;
  // the girders (high, thick) and the longest panel between their posts; the
  // margin round the diamonds in a footbridge's walls.
  lattice: { leg: 22, post: 3, bar: 2.4, girder: [26, 3], pitch: 26, margin: 2 },
  timber: { leg: 26, post: 4.5, bar: 3.4, girder: [30, 3.5], pitch: 32, margin: 2.5 },
  plank: [4, 0.6, 0.5], // a timber board's planks: wide, the groove between them wide and deep
  sign: { depth: 12, back: 10, panel: [3, 0.8] }, // a box sign: deep, past the leg at the back; its panels in from the edges, sunk
});
/** The open members of a gantry: a lattice or timber, or none for solid. */
const openOf = (g) => (g.members === 'solid' ? null : GANTRY[g.members]);
/** A lattice or timber gantry's board: as long as this, in the middle of the span (at the end of a half gantry's reach). */
const boardWidth = (g) => Math.min((g.type === 'half' ? g.reach : g.span) * 0.6, 160);
/** A leg's side: wider as a lattice tube. */
export const legOf = (g) => openOf(g)?.leg ?? GANTRY.leg;
/** A foot's side: round its leg. */
export const footOf = (g) => Math.max(g.type === 'half' ? GANTRY.foot[0] + 10 : GANTRY.foot[0], legOf(g) + 8);
const LABELS = {
  span: 'Span',
  clearance: 'Clearance',
  lights: 'Start lights',
  boardHeight: 'Board height',
  reach: 'Reach',
  deckWidth: 'Walkway width',
  wallHeight: 'Wall height',
};

/** The gantry as kept: known settings only, each checked. */
export function validateGantry(input) {
  const g = { ...GANTRY_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(g)) if (!Object.hasOwn(GANTRY_DEFAULTS, key)) throw Error('The gantry has an unknown setting: ' + key + '.');
  if (!GANTRY_TYPES.some(([id]) => id === g.type)) throw Error('Choose a start gantry, a half gantry or a footbridge.');
  for (const [key, [min, max]] of Object.entries(GANTRY_LIMITS))
    if (!Number.isFinite(g[key]) || g[key] < min || g[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'lights' ? '' : ' mm') + '.');
  if (!Number.isInteger(g.lights)) throw Error('Start lights are a whole number.');
  if (typeof g.board !== 'boolean') throw Error('Choose whether the beam has a board.');
  if (!['solid', 'lattice', 'timber'].includes(g.members)) throw Error('Choose solid, lattice or timber members.');
  if (typeof g.sign !== 'boolean') throw Error('Choose whether the half gantry has a box sign.');
  if (g.sign && g.type !== 'half') throw Error('A box sign is for a half gantry.');
  if (g.sign && g.boardHeight < 20) throw Error('A box sign is at least 20 mm high: set the board height.');
  g.text = checkText(g.text, 'The gantry text');
  if (typeof g.textCut !== 'boolean') throw Error('Choose raised or cut letters for the gantry.');
  if (g.text) {
    if (g.type === 'bridge') throw Error('A footbridge has no board for text.');
    if (g.sign) throw Error('A box sign carries posters on its panels: text goes on the board of a beam.');
    if (!g.board) throw Error('Text goes on the board: give the gantry its board.');
    const { wide, high } = textRoom(g);
    if (fitHeight(g.text, wide, high) < LETTERING.height[0]) throw Error('The board is too small for “' + g.text + '”: make it higher, the span longer, or the text shorter.');
  }
  if (g.type === 'start' && g.lights * 8 > g.span) throw Error('There is no room for ' + g.lights + ' start lights on a beam of ' + g.span + ' mm: at most ' + Math.floor(g.span / 8) + '.');
  // A lattice or timber gantry carries its lights on the board, which is shorter than the span.
  if (g.type === 'start' && g.members !== 'solid' && g.board) {
    const w = boardWidth(g);
    if (g.lights * 8 > w) throw Error('There is no room for ' + g.lights + ' start lights on a board of ' + Math.round(w) + ' mm: at most ' + Math.floor(w / 8) + ', or a longer span.');
  }
  return g;
}

/**
 * Where the text goes on the board: how wide and high it may be, and its
 * middle above the bottom of the board. A lattice or timber board carries the
 * start lights across its middle: then the text goes above them.
 */
export function textRoom(g) {
  const open = openOf(g);
  if (!open) return { wide: (g.type === 'half' ? g.reach : g.span) - 10, high: g.boardHeight - 4, up: g.boardHeight / 2 };
  const w = boardWidth(g),
    h = Math.max(g.boardHeight, open.girder[0] - 4);
  if (g.type === 'start' && g.lights) {
    const from = h / 2 + GANTRY.light[0] + 1.5,
      to = h - 1.5;
    return { wide: w - 6, high: to - from, up: (from + to) / 2 };
  }
  return { wide: w - 6, high: h - 4, up: h / 2 };
}
// Text on a face that looks to the front (negative y), its plane at y, its middle at x, z: raised, or the letters to cut.
const frontText = (wasm, own, text, height, x, y, z, cut) => own(raisedText(wasm, own, text, height, [0, 0], ...letterDepth(cut)).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, x, y, z, 1]));
const lettered = (own, solid, letters, cut) => own(cut ? solid.subtract(letters) : solid.add(letters));

/** How many steps a footbridge staircase has, and how far it runs out from the track. */
export function stairOf(g) {
  const steps = Math.max(2, Math.ceil(g.clearance / GANTRY.rise));
  return { steps, rise: g.clearance / steps, run: steps * GANTRY.tread + GANTRY.landing };
}
/** The size of a gantry on the table: across the track (x) and along it (y). */
export function gantrySize(g) {
  const L = legOf(g);
  if (g.type === 'bridge') return [2 * stairOf(g).run + g.span, g.deckWidth];
  const foot = footOf(g);
  if (g.type === 'half') return [Math.max(foot, L + g.reach), foot];
  return [2 * L + g.span + (foot - L), foot];
}
/** Where the feet stand on the table, as rectangles [x0, y0, x1, y1]: only they meet the table beside the track. */
export function gantryFeet(g) {
  const L = legOf(g);
  if (g.type === 'bridge') {
    const { run } = stairOf(g);
    return [[0, 0, run, g.deckWidth], [run + g.span, 0, 2 * run + g.span, g.deckWidth]];
  }
  const f = footOf(g),
    o = (f - L) / 2;
  if (g.type === 'half') return [[0, 0, f, f]];
  return [[0, 0, f, f], [o + L + g.span - o, 0, o + L + g.span - o + f, f]];
}

/** The parts of a gantry, without geometry. */
export function gantryLayout(input, plate = null) {
  const g = validateGantry(input);
  const names = {
    start: [['leg-1', 'Leg, left', 'frame'], ['leg-2', 'Leg, right', 'frame'], ['beam', 'Beam', 'roof']],
    half: [['leg-1', 'Leg', 'frame'], ['beam', 'Beam', 'roof']],
    bridge: [['stair-1', 'Staircase, left', 'wall'], ['stair-2', 'Staircase, right', 'wall'], ['deck', 'Walkway', 'floor']],
  }[g.type];
  // A half gantry with a box sign: its leg, the sign on top.
  if (g.sign) return { building: g, parts: [{ id: 'leg-1', name: 'Leg', role: 'frame' }, { id: 'sign', name: 'Box sign', role: 'wall' }] };
  // A lattice gantry: open legs, two girders and a board instead of a beam.
  if (g.members !== 'solid' && g.type !== 'bridge') {
    const legs = names.filter(([id]) => id.startsWith('leg'));
    const more = [['beam-front', 'Girder, front', 'roof'], ['beam-back', 'Girder, back', 'roof'], ['beam-top', 'Girder, top', 'roof'], ...(g.board ? [['board', 'Board', 'wall']] : [])];
    return { building: g, parts: [...legs, ...more].map(([id, name, role]) => ({ id, name, role })) };
  }
  return { building: g, parts: names.map(([id, name, role]) => ({ id, name, role })) };
}

const box = (Manifold, x0, y0, z0, x1, y1, z1) => Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);

/**
 * The gantry, built. With a plate, a beam or a walkway longer than it is cut
 * into pieces that join with dovetail tabs.
 */
export function buildGantry(wasm, input, plate = null) {
  const { Manifold, CrossSection } = wasm;
  const g = validateGantry(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const B = (...a) => own(box(Manifold, ...a));
  const minus = (a, ...cuts) => (cuts.length ? own(a.subtract(own(Manifold.union(cuts)))) : a);
  const L = legOf(g),
    [pinW, pinH] = GANTRY.pin,
    pl = GANTRY.play;
  const lattice = g.members !== 'solid',
    LT = openOf(g) ?? GANTRY.lattice;
  // Diamonds through a member along its length (u from u0 to u1, at its middle
  // across the height v0 to v1), as prisms through it along `through`: every
  // edge at 45°, so they print wherever the member stands or lies.
  // Along a member that stands upright (a wall along its length), only the
  // diamonds: a triangle under its top chord would have a flat top over air.
  const diamonds = (u0, u1, v0, v1, place, chords = true) => {
    const h = v1 - v0 - 2 * LT.margin;
    if (h < 4) return [];
    const pitch = h + LT.bar * Math.SQRT2;
    const n = Math.floor((u1 - u0 - LT.margin * 2 + LT.bar * Math.SQRT2) / pitch);
    const start = (u0 + u1) / 2 - ((n - 1) * pitch) / 2;
    const vm = (v0 + v1) / 2,
      a = h / 2,
      b = LT.bar * Math.SQRT2;
    const shape = (pts) => place(own(new CrossSection([pts], 'Positive')));
    const out = [];
    for (let k = 0; k < n; k++) {
      const c = start + k * pitch;
      out.push(shape([[c, vm - a], [c + a, vm], [c, vm + a], [c - a, vm]]));
      // Between this diamond and the next, a triangle along each chord: what
      // is left is the chords and the diagonal bars of a truss.
      if (chords && k + 1 < n) {
        const c1 = c + pitch,
          cm = c + pitch / 2;
        out.push(shape([[c + b, vm - a], [c1 - b, vm - a], [cm, vm - b / 2]]), shape([[c + b, vm + a], [cm, vm + b / 2], [c1 - b, vm + a]]));
      }
    }
    return out;
  };
  const parts = [];
  try {
    if (g.type === 'bridge') {
      const { steps, rise, run } = stairOf(g);
      const W = g.deckWidth,
        t = GANTRY.deck,
        zTop = g.clearance;
      // A staircase: steps up from the table to its landing, under the end of the walkway.
      const stair = (left) => {
        const blocks = [];
        for (let k = 0; k < steps; k++) {
          const x0 = k * GANTRY.tread,
            z1 = (k + 1) * rise;
          blocks.push(left ? B(x0, 0, 0, run, W, z1) : B(run + g.span, 0, 0, 2 * run + g.span - x0, W, z1));
        }
        return own(Manifold.union(blocks));
      };
      parts.push({ id: 'stair-1', name: 'Staircase, left', role: 'wall', solid: stair(true), lie: [-90, 0, 0], apart: [-15, 0, 0] });
      parts.push({ id: 'stair-2', name: 'Staircase, right', role: 'wall', solid: stair(false), lie: [-90, 0, 0], apart: [15, 0, 0] });
      // The walkway: a floor between two walls, from landing to landing.
      const x0 = run - GANTRY.landing,
        x1 = run + g.span + GANTRY.landing;
      // Lattice walls: diamonds through both walls along the walkway.
      const walls = lattice ? diamonds(x0 + LT.margin, x1 - LT.margin, zTop + t, zTop + t + g.wallHeight, (cs) => own(own(cs.extrude(W + 2)).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, W + 1, 0, 1])), false) : [];
      const deck = minus(B(x0, 0, zTop, x1, W, zTop + t + g.wallHeight), B(x0 - 1, t, zTop + t, x1 + 1, W - t, zTop + t + g.wallHeight + 1), ...walls);
      parts.push(...cutLong({ id: 'deck', name: 'Walkway', role: 'floor', solid: deck, lie: [0, 0, 0], apart: [0, 0, 20] }, [x0, x1], 'xy'));
    } else if (lattice) {
      // Like a steel truss, as the kits are: each leg an open box of four
      // corner posts with an X in each panel of each side, standing on its
      // foot; the beam two flat girders, front and back, glued across the
      // faces of the legs at the top; a board for a sign on the front, the
      // start lights in it. The legs print standing (their braces steeper
      // than 45°), the girders and the board lie flat.
      const { sweep, poly } = kitShapes(wasm, own);
      const half = g.type === 'half';
      const f = footOf(g),
        ft = half ? GANTRY.foot[1] + 1 : GANTRY.foot[1];
      const o = (f - L) / 2;
      const { post: P, bar, girder: [bh, gt], pitch } = LT;
      const legX = half ? [o] : [o, o + L + g.span];
      const zBeam = g.clearance,
        zTop = g.sign ? zBeam : zBeam + bh;
      const rect = (u0, v0, u1, v1) => poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      const line = (a, c) => {
        const d = [c[0] - a[0], c[1] - a[1]],
          l = Math.hypot(...d),
          n = [(-d[1] / l) * (bar / 2), (d[0] / l) * (bar / 2)];
        return poly([[a[0] - n[0], a[1] - n[1]], [c[0] - n[0], c[1] - n[1]], [c[0] + n[0], c[1] + n[1]], [a[0] + n[0], a[1] + n[1]]]);
      };
      // An X between u0 and u1, v0 and v1, a little into what is round it so it is one with it.
      const cross = (u0, v0, u1, v1) => own(own(CrossSection.union([line([u0, v0], [u1, v1]), line([u0, v1], [u1, v0])])).intersect(rect(u0 - 0.3, v0 - 0.3, u1 + 0.3, v1 + 0.3)));
      // Legs: from the foot to the top of the beam.
      legX.forEach((x, i) => {
        const bits = [B(x - o, 0, 0, x - o + f, f, ft)];
        for (const [px, py] of [[x, o], [x + L - P, o], [x, o + L - P], [x + L - P, o + L - P]]) bits.push(B(px, py, ft - 0.01, px + P, py + P, zTop));
        // Square panels up each side, an X in each: steeper than 45°, so they print.
        const panels = Math.max(1, Math.floor((zTop - ft) / ((L - P) * 1.25)));
        const ph = (zTop - ft) / panels;
        const xs = [];
        for (let k = 0; k < panels; k++) xs.push(cross(P / 2, ft + k * ph, L - P / 2, ft + (k + 1) * ph));
        const side = own(CrossSection.union(xs));
        const sides = [
          [[1, 0, 0], [x, o, 0], [0, 1, 0]],
          [[1, 0, 0], [x, o + L - bar, 0], [0, 1, 0]],
          [[0, 1, 0], [x, o, 0], [1, 0, 0]],
          [[0, 1, 0], [x + L - bar, o, 0], [1, 0, 0]],
        ];
        for (const [a, origin, dir] of sides) bits.push(sweep(side, a, [0, 0, 1], origin, dir, 0, bar));
        // Cut level at the top of the posts, where the girders end.
        const solid = own(own(Manifold.union(bits)).trimByPlane([0, 0, -1], -zTop));
        parts.push({ id: 'leg-' + (i + 1), name: half ? 'Leg' : i ? 'Leg, right' : 'Leg, left', role: 'frame', solid, lie: [0, 0, 0], apart: [i ? 12 : -12, 0, 0] });
      });
      if (!g.sign) {
      // The girders: across the legs from the outside of one to the outside of
      // the other, or out over the road from a half gantry's leg. Chords, a
      // post at each end and over each leg's inside, and between them panels
      // with an X; solid where they are cut to fit the plate.
      const bx0 = o,
        bx1 = half ? o + L + g.reach : o + 2 * L + g.span;
      const posts = [bx0, bx1 - P];
      const solidAt = [];
      for (const x of legX) posts.push(x + L - P, x);
      if (plate) {
        const room = Math.max(plate.width, plate.depth) - 2 * (plate.margin ?? 0) - JOINT.length;
        const pieces = Math.ceil((bx1 - bx0) / room - 1e-9);
        for (let k = 1; k < pieces; k++) {
          const at = bx0 + (k * (bx1 - bx0)) / pieces;
          posts.push(at - JOINT.length - P, at + JOINT.length);
          solidAt.push([at - JOINT.length - P, at + JOINT.length + P]);
        }
      }
      // More posts between, no further apart than the pitch.
      const sorted = [...new Set(posts.map((u) => Math.round(u * 100) / 100))].sort((a, c) => a - c);
      const all = [];
      for (let k = 0; k < sorted.length; k++) {
        all.push(sorted[k]);
        const next = sorted[k + 1];
        if (next === undefined) break;
        const gap = next - sorted[k] - P;
        const extra = Math.max(0, Math.ceil(gap / pitch) - 1);
        for (let j = 1; j <= extra; j++) all.push(sorted[k] + (j * (next - sorted[k])) / (extra + 1));
      }
      // A lattice between v0 and v1 across, along the beam: a chord along each
      // edge, a bar at each post, an X in each panel between them.
      const lattice2d = (v0, v1) => {
        const web = [rect(bx0, v0, bx1, v0 + P), rect(bx0, v1 - P, bx1, v1)];
        for (const u of all) web.push(rect(u, v0, u + P, v1));
        for (const [a, c] of solidAt) web.push(rect(a, v0, c, v1));
        for (let k = 0; k + 1 < all.length; k++) {
          const u0 = all[k] + P,
            u1 = all[k + 1];
          if (u1 - u0 > 2 * bar) web.push(cross(u0, v0 + P, u1, v1 - P));
        }
        return own(CrossSection.union(web));
      };
      const girder = lattice2d(zBeam, zTop);
      for (const [id, name, y0, out] of [['beam-front', 'Girder, front', o - gt, [0, -1, 0]], ['beam-back', 'Girder, back', o + L, [0, 1, 0]]]) {
        const solid = sweep(girder, [1, 0, 0], [0, 0, 1], [0, y0, 0], [0, 1, 0], 0, gt);
        parts.push(...cutLong({ id, name, role: 'roof', solid, outward: out, apart: [0, out[1] * 8, 20] }, [bx0, bx1], 'xz'));
      }
      // The top: a flat lattice over both girders and the tops of the legs, closing the beam like a roof.
      const top = sweep(lattice2d(o - gt, o + L + gt), [1, 0, 0], [0, 1, 0], [0, 0, zTop], [0, 0, 1], 0, gt);
      parts.push(...cutLong({ id: 'beam-top', name: 'Girder, top', role: 'roof', solid: top, lie: [0, 0, 0], apart: [0, 0, 30] }, [bx0, bx1], 'xy'));
      const v0 = zBeam,
        v1 = zTop;
      // The board: on the front of the front girder, in the middle of the span (at the end of a half gantry's reach), the start lights in it.
      if (g.board) {
        const w = boardWidth(g),
          mid = half ? o + L + g.reach - w / 2 - P : o + L + g.span / 2;
        const h = Math.max(g.boardHeight, bh - 4),
          zc = (v0 + v1) / 2,
          y1 = o - gt;
        let board = B(mid - w / 2, y1 - GANTRY.board, zc - h / 2, mid + w / 2, y1, zc + h / 2);
        if (g.type === 'start' && g.lights) {
          const [r, depth] = GANTRY.light;
          const lights = [];
          for (let k = 0; k < g.lights; k++) {
            const x = mid + (k - (g.lights - 1) / 2) * 8;
            lights.push(own(own(Manifold.cylinder(depth + 1, r, r, 24)).rotate([-90, 0, 0]).translate([x, y1 - GANTRY.board - 1, zc])));
          }
          board = minus(board, ...lights);
        }
        // Timber: the board of planks, a groove along its face between each two.
        if (g.members === 'timber') {
          const [pw, gw, gd] = GANTRY.plank;
          const grooves = [];
          for (let z = zc - h / 2 + pw; z < zc + h / 2 - pw / 2; z += pw) grooves.push(B(mid - w / 2 - 1, y1 - GANTRY.board - 1, z - gw / 2, mid + w / 2 + 1, y1 - GANTRY.board + gd, z + gw / 2));
          // Behind the text the board is smooth: a letter across a groove would print over it.
          if (g.text) {
            const { wide, high, up } = textRoom(g),
              th = fitHeight(g.text, wide, high),
              half = textWidth(g.text, th) / 2 + 1;
            const behind = B(mid - half, y1 - GANTRY.board - 2, zc - h / 2 + up - th / 2 - 1, mid + half, y1 - GANTRY.board + gd + 1, zc - h / 2 + up + th / 2 + 1);
            for (let k = 0; k < grooves.length; k++) grooves[k] = minus(grooves[k], behind);
          }
          board = minus(board, ...grooves);
        }
        if (g.text) {
          const { wide, high, up } = textRoom(g);
          board = lettered(own, board, frontText(wasm, own, g.text, fitHeight(g.text, wide, high), mid, y1 - GANTRY.board, zc - h / 2 + up, g.textCut), g.textCut);
        }
        parts.push({ id: 'board', name: 'Board', role: 'wall', solid: board, outward: [0, -1, 0], apart: [0, -15, 20] });
      }
      }
    } else {
      const half = g.type === 'half';
      const f = footOf(g),
        ft = half ? GANTRY.foot[1] + 1 : GANTRY.foot[1];
      const o = (f - L) / 2;
      const [bd, bh] = GANTRY.beam;
      const legX = half ? [o] : [o, o + L + g.span];
      const zBeam = g.clearance;
      // The pin on a leg, and its socket under the beam (`play` wider): square at the back, pointed at
      // 45° to the front, because the beam prints on its back, its front up, the socket across it: a
      // square socket's front would print over air.
      const { poly } = kitShapes(wasm, own);
      const house = (cx, cy, play, z0, z1) => {
        const h = pinW / 2 + play;
        return own(own(poly([[cx - h, cy + h], [cx - h, cy], [cx, cy - h], [cx + h, cy], [cx + h, cy + h]]).extrude(z1 - z0)).translate([0, 0, z0]));
      };
      // Legs: a column on a foot plate, a pin on top that the beam drops onto.
      legX.forEach((x, i) => {
        const leg = own(Manifold.union([B(x - o, 0, 0, x - o + f, f, ft), B(x, o, 0, x + L, o + L, zBeam), house(x + L / 2, o + L / 2, 0, zBeam - 0.01, zBeam + pinH)]));
        parts.push({ id: 'leg-' + (i + 1), name: half ? 'Leg' : i ? 'Leg, right' : 'Leg, left', role: 'frame', solid: leg, lie: [0, 0, 0], apart: [i ? 12 : -12, 0, 0] });
      });
      if (!g.sign) {
      // The beam: over the legs, a socket for each pin underneath, the lights in
      // front, a board on top flush with its back.
      const bx0 = half ? o : o,
        bx1 = half ? o + L + g.reach : o + 2 * L + g.span;
      const by0 = o + L / 2 - bd / 2,
        by1 = by0 + bd;
      let beam = B(bx0, by0, zBeam, bx1, by1, zBeam + bh);
      if (g.board) beam = own(beam.add(B(bx0, by1 - GANTRY.board, zBeam + bh - 0.01, bx1, by1, zBeam + bh + g.boardHeight)));
      // The text on the board, over the middle of the road.
      if (g.board && g.text) {
        const { wide, high, up } = textRoom(g);
        beam = lettered(own, beam, frontText(wasm, own, g.text, fitHeight(g.text, wide, high), half ? o + L + g.reach / 2 : o + L + g.span / 2, by1 - GANTRY.board, zBeam + bh + up, g.textCut), g.textCut);
      }
      const sockets = legX.map((x) => house(x + L / 2, o + L / 2, pl, zBeam - 1, zBeam + pinH + 0.2));
      const lights = [];
      if (g.type === 'start' && g.lights) {
        const [r, depth] = GANTRY.light;
        const mid = (o + L + o + L + g.span) / 2,
          gap = 8;
        for (let k = 0; k < g.lights; k++) {
          const x = mid + (k - (g.lights - 1) / 2) * gap;
          lights.push(own(own(Manifold.cylinder(depth + 1, r, r, 24)).rotate([-90, 0, 0]).translate([x, by0 - 1, zBeam + bh / 2])));
        }
      }
      beam = minus(beam, ...sockets, ...lights);
      // It prints on its back: the board flat on the plate, the lights up.
      parts.push(...cutLong({ id: 'beam', name: 'Beam', role: 'roof', solid: beam, lie: [-90, 0, 0], apart: [0, 0, 20] }, [bx0, bx1], 'xz'));
      }
    }
    // A box sign on top of a half gantry's leg, reaching out over the road
    // and a little past the leg at the back; a panel sunk in each face for
    // the poster, its top edge at 45° so the sign prints standing on its
    // bottom. Over a solid leg, a socket for its pin.
    if (g.sign) {
      const f = footOf(g),
        o = (f - L) / 2;
      const { depth: sd, back, panel: [pi, pdp] } = GANTRY.sign;
      const x0 = o - back,
        x1 = o + L + g.reach,
        y0 = o + L / 2 - sd / 2,
        y1 = y0 + sd,
        z0 = g.clearance,
        z1 = z0 + g.boardHeight;
      const { poly, sweep } = kitShapes(wasm, own);
      let sign = B(x0, y0, z0, x1, y1, z1);
      // A panel's section in (y, z) on each face: sunk, its top sloping back out at 45°.
      const panels = [];
      for (const [face, dir] of [[y0, 1], [y1, -1]]) {
        const sec = poly([[face - dir, z0 + pi], [face + dir * pdp, z0 + pi], [face + dir * pdp, z1 - pi - pdp], [face, z1 - pi], [face - dir, z1 - pi]]);
        panels.push(sweep(sec, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], x0 + pi, x1 - pi));
      }
      sign = minus(sign, ...panels);
      // Over a solid leg, a socket for its pin, its top pointed so the sign prints standing.
      if (g.members === 'solid') {
        const a = o + (L - pinW) / 2 - pl,
          c = o + (L + pinW) / 2 + pl,
          top = z0 + pinH + 0.2;
        sign = minus(sign, sweep(poly([[a, z0 - 1], [c, z0 - 1], [c, top], [(a + c) / 2, top + (c - a) / 2], [a, top]]), [1, 0, 0], [0, 0, 1], [0, 0, 0], [0, 1, 0], a, c));
      }
      // Longer than the plate: cut upright, so the joints print standing too.
      parts.push(...cutLong({ id: 'sign', name: 'Box sign', role: 'wall', solid: sign, lie: [0, 0, 0], apart: [0, 0, 20] }, [x0, x1], 'xy'));
    }
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }

  // A part longer than the plate, cut across its length (x) into pieces
  // joined by dovetail tabs drawn in the plane it prints in: xy for a
  // walkway standing up, xz for a beam on its back.
  function cutLong(part, [x0, x1], plane) {
    if (!plate) return [part];
    const room = Math.max(plate.width, plate.depth) - 2 * (plate.margin ?? 0) - JOINT.length;
    const n = Math.ceil((x1 - x0) / room - 1e-9);
    if (n < 2) return [part];
    const { min, max } = part.solid.boundingBox();
    const [v0, v1] = plane === 'xy' ? [min[1], max[1]] : [min[2], max[2]];
    const far = 1e4;
    const cuts = Array.from({ length: n - 1 }, (_, i) => x0 + ((i + 1) * (x1 - x0)) / n);
    const lefts = cuts.map((at) => own(new CrossSection(seamRegion(at, [v0, v1], tabPlaces([v0, v1])), 'NonZero')));
    const regions = [...lefts, own(new CrossSection([[[-far, v0 - far], [far, v0 - far], [far, v1 + far], [-far, v1 + far]]], 'NonZero'))].map((region, k) =>
      k ? own(region.subtract(own(lefts[k - 1].offset(JOINT.play, 'Miter', 2)))) : region,
    );
    // A prism through the part for each region: extruded across the plane, turned into place.
    const depth = plane === 'xy' ? [min[2] - 2, max[2] + 2] : [min[1] - 2, max[1] + 2];
    return regions.map((region, k) => {
      let prism = own(own(region.extrude(depth[1] - depth[0])).translate([0, 0, depth[0]]));
      // Into the plane: xy as it is; xz with v up and the extrusion along y.
      if (plane === 'xz') prism = own(prism.transform([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1]));
      const solid = own(part.solid.intersect(prism));
      return { ...part, id: part.id + '-' + (k + 1), name: part.name + ' ' + (k + 1) + ' of ' + regions.length, solid, apart: [part.apart[0] + (k - (regions.length - 1) / 2) * 6, part.apart[1], part.apart[2]] };
    });
  }
}
