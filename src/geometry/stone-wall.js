// A dry-stone wall along a stage: laid without mortar, a little wider at its
// foot than at its top, uneven stones in rough courses on both faces, a row
// of stones set on end along its top. A gap for a farm gate, between two
// square stone gateposts with a flat stone on each; the gate of five bars
// and a brace prints flat. The wall stands on the table in runs that fit the
// plate, each printing upright, its foot on the plate. x along the wall, y
// across it (the road at negative y), z up.

import { kitShapes } from './kit-shapes.js';
import { jointPolygons, tagged } from './building-texture.js';

export const STONE_WALL_DEFAULTS = Object.freeze({
  kind: 'stonewall',
  length: 240, // the whole wall, its gateposts and gate too
  height: 24, // to the top of the stones on end
  gate: 'middle', // 'middle', 'end' (the gate at the right end, a post beyond it) or 'none'
  gateWidth: 52, // the gate, between its posts
});
export const STONE_WALL_LIMITS = Object.freeze({ length: [60, 1200], height: [14, 40], gateWidth: [30, 90] });
export const STONE_WALL = Object.freeze({
  foot: 10, // thick at its foot
  top: 7.5, // and at its top, under the stones on end
  cope: 4.5, // the stones on end, high
  coping: [3, 5.2], // each this wide
  gapCope: 0.5, // between two of them
  post: 13, // a gatepost, square
  cap: [15, 2], // the flat stone on a gatepost: square, thick
  above: 6, // a gatepost stands this much higher than the wall
  scale: 85, // the stones, % of a building's
  joint: 0.6,
  depth: 0.6,
  play: 0.8, // round the gate, each side
  bar: [1.8, 2.4], // a bar of the gate high, its top bar
  stile: [3, 2.4], // its stiles wide: the hanging one, the other
  thick: 2, // the gate
});
const LABELS = { length: 'Length', height: 'Height', gateWidth: 'Gate width' };

export function validateStoneWall(input) {
  const w = { ...STONE_WALL_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(w)) if (!Object.hasOwn(STONE_WALL_DEFAULTS, key)) throw Error('The stone wall has an unknown setting: ' + key + '.');
  if (!['middle', 'end', 'none'].includes(w.gate)) throw Error('Choose a gate in the middle, at the end, or none.');
  for (const [key, [min, max]] of Object.entries(STONE_WALL_LIMITS))
    if (!Number.isFinite(w[key]) || w[key] < min || w[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + ' mm.');
  if (w.gate !== 'none' && w.length < w.gateWidth + 2 * STONE_WALL.post + 20) throw Error('The wall is too short for its gate: at least ' + (w.gateWidth + 2 * STONE_WALL.post + 20) + ' mm.');
  return w;
}

/**
 * Where everything stands along the wall: the runs of wall [x0, x1], each
 * with the gateposts at its ends (`posts`: 'start', 'end'), a post standing
 * on its own, and the gate [x0, x1] between the posts.
 */
export function stoneWallPlan(w) {
  const P = STONE_WALL.post;
  if (w.gate === 'none') return { runs: [{ x0: 0, x1: w.length, posts: [] }], lone: null, gate: null };
  if (w.gate === 'middle') {
    const g0 = w.length / 2 - w.gateWidth / 2;
    return { runs: [{ x0: 0, x1: g0, posts: ['end'] }, { x0: g0 + w.gateWidth, x1: w.length, posts: ['start'] }], lone: null, gate: [g0, g0 + w.gateWidth] };
  }
  const g0 = w.length - P - w.gateWidth;
  return { runs: [{ x0: 0, x1: g0, posts: ['end'] }], lone: [w.length - P, w.length], gate: [g0, g0 + w.gateWidth] };
}
/** On the table: [x0, y0, x1, y1]. */
// Out to the flat stones on the gateposts, which stand out past them; at the end, past the last post.
export const stoneWallFootprint = (w) => [0, -STONE_WALL.cap[0] / 2, w.length + (w.gate === 'end' ? (STONE_WALL.cap[0] - STONE_WALL.post) / 2 : 0), STONE_WALL.cap[0] / 2];

/** The runs as they are cut to fit the plate: [x0, x1, posts] for each piece. */
function pieces(w, room) {
  const out = [];
  for (const run of stoneWallPlan(w).runs) {
    const n = Math.max(1, Math.ceil((run.x1 - run.x0) / room));
    for (let k = 0; k < n; k++) {
      const a = run.x0 + ((run.x1 - run.x0) * k) / n,
        b = run.x0 + ((run.x1 - run.x0) * (k + 1)) / n;
      out.push({ x0: a, x1: b, posts: run.posts.filter((p) => (p === 'start' ? k === 0 : k === n - 1)) });
    }
  }
  return out;
}
// A run as long as the plate is wide or deep, whichever is longer, less a little.
const roomOf = (plate) => (plate ? Math.max(40, Math.max(plate.width, plate.depth) - 2 * (plate.margin ?? 0) - 4) : Infinity);

export function stoneWallLayout(input, plate = null) {
  const w = validateStoneWall(input);
  const list = pieces(w, roomOf(plate));
  const parts = list.map((_, i) => ({ id: 'wall-' + (i + 1), name: 'Wall' + (list.length > 1 ? ' ' + (i + 1) + ' of ' + list.length : ''), role: 'wall' }));
  const plan = stoneWallPlan(w);
  if (plan.lone) parts.push({ id: 'post', name: 'Gatepost', role: 'wall' });
  if (plan.gate) parts.push({ id: 'gate', name: 'Five-bar gate', role: 'door' });
  return { building: w, parts };
}

export function buildStoneWall(wasm, input, plate = null) {
  const w = validateStoneWall(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { box, poly, sweep } = kitShapes(wasm, own);
  const { Manifold, CrossSection } = wasm;
  const S = STONE_WALL;
  const hw = w.height - S.cope; // the wall, under its stones on end
  const settings = { textureScale: S.scale, textureJoint: S.joint };
  // Its section across: wider at the foot, the faces leaning in.
  const section = [[-S.foot / 2, 0], [S.foot / 2, 0], [S.top / 2, hw], [-S.top / 2, hw]];
  const run = (x0, x1) => sweep(section, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], x0, x1);
  // The joints of one face, cut in from it: the stones in rough courses from the foot up.
  const lean = (S.foot - S.top) / 2,
    slant = Math.hypot(lean, hw);
  // On the road's side (side -1) u runs along x, on the field's side against it, so
  // each face is drawn as seen from in front of it; v runs up the face from its foot.
  const faceJoints = (x0, x1, side, seed) => {
    const [u0, u1] = side < 0 ? [x0, x1] : [-x1, -x0];
    const polys = jointPolygons('stone', [u0, u1], [0, slant], settings, seed, 0);
    if (!polys.length) return null;
    // Clear of the ends of the run and of the stones on end along its top.
    const cs = own(own(new CrossSection(polys, 'Positive')).intersect(poly([[u0 + 0.6, 0.4], [u1 - 0.6, 0.4], [u1 - 0.6, slant - 0.3], [u0 + 0.6, slant - 0.3]])));
    if (cs.isEmpty()) return null;
    const up = [0, (-side * lean) / slant, hw / slant],
      inward = [0, (-side * hw) / slant, -lean / slant];
    return sweep(cs, side < 0 ? [1, 0, 0] : [-1, 0, 0], up, [0, (side * S.foot) / 2, 0], inward, -1, S.depth);
  };
  // The stones on end along the top, at random widths, the same every time.
  const coping = (x0, x1, seed) => {
    let a = seed >>> 0;
    const random = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    const bits = [];
    for (let x = x0; x < x1 - 0.5; ) {
      const wd = Math.min(x1 - x, S.coping[0] + random() * (S.coping[1] - S.coping[0]));
      const h = S.cope * (0.82 + random() * 0.18);
      if (wd > 1) bits.push(box(x, -S.top / 2 - 0.3, hw - 0.01, x + wd, S.top / 2 + 0.3, hw + h));
      x += wd + S.gapCope;
    }
    return bits;
  };
  const post = (x0) => {
    const c = (S.cap[0] - S.post) / 2;
    return own(Manifold.union([box(x0, -S.post / 2, 0, x0 + S.post, S.post / 2, w.height + S.above - S.cap[1]), box(x0 - c, -S.cap[0] / 2, w.height + S.above - S.cap[1] - 0.01, x0 + S.post + c, S.cap[0] / 2, w.height + S.above)]));
  };
  const parts = [];
  try {
    const list = pieces(w, roomOf(plate));
    const P = S.post;
    list.forEach((p, i) => {
      // The run of wall, clear of its posts, with its faces' stones cut and its stones on end.
      const a = p.posts.includes('start') ? p.x0 + P : p.x0,
        b = p.posts.includes('end') ? p.x1 - P : p.x1;
      const seed = 101 + i * 37;
      let solid = own(Manifold.union([run(a - (p.posts.includes('start') ? 0.5 : 0), b + (p.posts.includes('end') ? 0.5 : 0)), ...coping(a, b, seed)]));
      const cuts = [faceJoints(a, b, -1, seed), faceJoints(a, b, 1, seed + 1)].filter(Boolean);
      if (cuts.length) solid = own(solid.subtract(tagged(own, own(Manifold.union(cuts)), 'drystone', 1)));
      const ends = [];
      if (p.posts.includes('start')) ends.push(post(p.x0));
      if (p.posts.includes('end')) ends.push(post(p.x1 - P));
      if (ends.length) solid = own(Manifold.union([solid, ...ends]));
      parts.push({ id: 'wall-' + (i + 1), name: 'Wall' + (list.length > 1 ? ' ' + (i + 1) + ' of ' + list.length : ''), role: 'wall', solid, lie: [0, 0, 0], apart: [0, 0, 0] });
    });
    const plan = stoneWallPlan(w);
    if (plan.lone) parts.push({ id: 'post', name: 'Gatepost', role: 'wall', solid: post(plan.lone[0]), lie: [0, 0, 0], apart: [8, 0, 0] });
    if (plan.gate) {
      // The gate in its plane (u along it, v up), standing in the gap clear of the posts and the table.
      const [g0, g1] = plan.gate;
      const u0 = g0 + S.play,
        u1 = g1 - S.play,
        v0 = 2,
        v1 = hw - 1;
      const [hs, ss] = S.stile;
      const rect = (a, c, d, e) => poly([[a, c], [d, c], [d, e], [a, e]]);
      const bits = [rect(u0, v0, u0 + hs, v1), rect(u1 - ss, v0, u1, v1)];
      const bars = 5;
      for (let k = 0; k < bars; k++) {
        const top = k === bars - 1;
        const hb = top ? S.bar[1] : S.bar[0];
        const v = v0 + ((v1 - v0 - hb) * k) / (bars - 1);
        bits.push(rect(u0, v, u1, v + hb));
      }
      // The brace, from the foot of the hanging stile up to the top of the other.
      const d = [u1 - ss - (u0 + hs), v1 - v0],
        l = Math.hypot(...d),
        n = [(-d[1] / l) * (S.bar[0] / 2), (d[0] / l) * (S.bar[0] / 2)];
      const A = [u0 + hs, v0 + 1],
        B = [u1 - ss, v1 - 1];
      bits.push(own(poly([[A[0] - n[0], A[1] - n[1]], [B[0] - n[0], B[1] - n[1]], [B[0] + n[0], B[1] + n[1]], [A[0] + n[0], A[1] + n[1]]]).intersect(rect(u0, v0, u1, v1))));
      const gate = sweep(own(CrossSection.union(bits)), [1, 0, 0], [0, 0, 1], [0, 0, 0], [0, 1, 0], -S.thick / 2, S.thick / 2);
      parts.push({ id: 'gate', name: 'Five-bar gate', role: 'door', solid: gate, outward: [0, -1, 0], apart: [0, -14, 0] });
    }
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}

export function stoneWallNotes(name, w, parts, sizes, fmt) {
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  const plan = stoneWallPlan(w);
  return [
    name + ' · SlotForge Foundry dry-stone wall kit',
    '',
    'A dry-stone wall ' + fmt(w.length) + ' mm long and ' + fmt(w.height) + ' mm high, ' + fmt(STONE_WALL.foot) + ' mm thick at its foot and ' + fmt(STONE_WALL.top) + ' mm at its top, a row of stones on end along it' + (plan.gate ? ', a five-bar gate ' + fmt(w.gateWidth) + ' mm wide between two gateposts' + (w.gate === 'end' ? ' at its right end.' : ' in its middle.') : '.'),
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports. Each run of wall stands on its foot, its stones on end up; the gate lies flat.',
    '',
    'Putting it together',
    '1. Stand the runs end to end along the stage and glue them where they meet.',
    ...(plan.gate ? ['2. Glue the gate to the post on its left by its thicker stile, shut or swung open, its foot clear of the table.'] : []),
    'Paint the stones grey and wash the joints darker; dry brush the tops lighter.',
  ].join('\n');
}
