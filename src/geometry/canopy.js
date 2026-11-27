// A canopy: a roof on posts, open all round or screened at its ends or its
// back, like a filling station's forecourt canopy or a rally team's service
// tent. The posts stand in sockets in a slab and push a pin up into the roof;
// the roof is a deep flat plate, or a tent of two slopes from a ridge along
// it on a rail along the front and one along the back. A sign board hangs
// along the front; props stand on the slab under it. Everything prints flat:
// the slab, the posts on their side, the plate and the rails upside down, the
// tent's slopes on their underside, the screens and the sign on their back. A
// slab, plate, rail or slope longer than the plate is cut at the middle of a
// bay, glued end to end. x along the front, y from the front (the track at
// negative y) to the back, z up.

import { kitShapes } from './kit-shapes.js';
import { LETTERING, checkText, fitHeight, letterDepth, textShape, textWidth } from './lettering.js';
import { PROP_GAP, checkPropList, placeProp, propFootprint, propOf, propPartIds } from './props.js';

export const CANOPY_DEFAULTS = Object.freeze({
  kind: 'canopy',
  width: 160, // along the front, post to post outside
  depth: 110, // front to back, outside the posts
  height: 100, // the posts: from the slab (or the table) to the underside of the roof
  bays: 1, // between the posts along the front and the back
  roof: 'flat', // 'flat': a deep plate; 'tent': two slopes from a ridge along it
  pitch: 25, // a tent's slopes
  overhang: 8, // the roof past the posts all round
  screens: 'none', // 'none'; 'ends', a screen across each end; 'back', one along the back; 'three', the ends and the back
  text: '', // lettered on a sign board hung along the front
  base: true, // a slab under it, the posts standing in its sockets; or the posts straight on the table
  props: Object.freeze([]), // on the slab, or the table: each { type, x, y, rotation }
});
export const CANOPY_LIMITS = Object.freeze({
  width: [40, 600],
  depth: [40, 180],
  height: [30, 170],
  bays: [1, 8],
  pitch: [10, 40],
  overhang: [0, 20],
});
export const CANOPY = Object.freeze({
  post: 6, // a post, square
  pin: [3, 3], // the pin on top of a post: square, high
  socket: 2, // a post's foot in the slab
  play: 0.2,
  slab: 3, // the slab, thick
  margin: 4, // the slab past the posts
  plate: 5, // a flat roof, thick
  rail: [8, 6], // a tent's rail: wide, deep
  tent: 2.5, // a tent's slope, thick
  screen: 2, // a screen, thick
  board: [3, 14], // the sign board: thick, high
  piece: 180, // a piece at most this long
});
const LABELS = { width: 'Width', depth: 'Depth', height: 'Height', bays: 'Bays', pitch: 'Pitch', overhang: 'Overhang' };
const SCREENS = ['none', 'ends', 'back', 'three'];

/** Where the posts stand: their middles along x, and the rows along y. */
export function canopyPosts(c) {
  const P = CANOPY.post,
    x0 = P / 2,
    x1 = c.width - P / 2;
  const xs = Array.from({ length: c.bays + 1 }, (_, k) => x0 + ((x1 - x0) * k) / c.bays);
  return { xs, ys: [P / 2, c.depth - P / 2] };
}
/** Where a long piece is cut: at the middle of bays, so that no piece is longer than the plate takes. */
function cutsOf(c, from, to) {
  const { xs } = canopyPosts(c);
  const mids = xs.slice(1).map((x, k) => (x + xs[k]) / 2);
  const cuts = [];
  let start = from;
  // Greedily the last middle that keeps the piece short enough.
  while (to - start > CANOPY.piece) {
    const next = mids.filter((m) => m > start + 1 && m - start <= CANOPY.piece).pop();
    if (next === undefined) return null;
    cuts.push(next);
    start = next;
  }
  return cuts;
}
/** The canopy on the table, [x0, y0, x1, y1]: out to the roof or the slab. */
export function canopyFootprint(c) {
  const m = Math.max(c.overhang, c.base ? CANOPY.margin : 0, c.text ? CANOPY.board[0] + c.overhang : 0);
  return [-m, -m, c.width + m, c.depth + m];
}
/** The sign board: along the front, as long as the posts are apart, at most a piece. */
const boardSpan = (c) => {
  const L = Math.min(c.width - 2 * CANOPY.post, CANOPY.piece);
  return [c.width / 2 - L / 2, c.width / 2 + L / 2];
};
const textHeight = (c) => {
  const [a, b] = boardSpan(c);
  return fitHeight(c.text, b - a - 4, CANOPY.board[1] - 4);
};

/** The canopy as kept: known settings only, each checked. */
export function validateCanopy(input) {
  const c = { ...CANOPY_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(c)) if (!Object.hasOwn(CANOPY_DEFAULTS, key)) throw Error('The canopy has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(CANOPY_LIMITS))
    if (!Number.isFinite(c[key]) || c[key] < min || c[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'bays' ? '' : key === 'pitch' ? '°' : ' mm') + '.');
  if (!Number.isInteger(c.bays)) throw Error('Bays are a whole number.');
  if (!['flat', 'tent'].includes(c.roof)) throw Error('Choose a flat roof or a tent.');
  if (!SCREENS.includes(c.screens)) throw Error('Choose screens at the ends, along the back, both, or none.');
  if (typeof c.base !== 'boolean') throw Error('Choose whether the posts stand in a slab.');
  c.text = checkText(c.text, 'The sign text');
  if (c.text && textHeight(c) < LETTERING.height[0]) throw Error('The sign is too small for “' + c.text + '”: make the canopy wider, or the text shorter.');
  // Long pieces are cut at the middle of a bay: there must be bays to cut at.
  const reach = c.width + 2 * Math.max(c.overhang, CANOPY.margin);
  if (cutsOf(c, -reach / 2 + c.width / 2, reach / 2 + c.width / 2) === null) throw Error('A canopy ' + Math.round(c.width) + ' mm wide is cut into pieces at the middle of its bays: give it more bays.');
  const bay = (c.width - CANOPY.post) / c.bays;
  if (bay < CANOPY.post + 10) throw Error('Too many bays for a canopy ' + c.width + ' mm wide.');
  c.props = checkCanopyProps(c);
  return c;
}
// The props under it: on its slab or the table, inside the posts' rows, clear of the posts and of each other, under the roof.
function checkCanopyProps(c) {
  const props = checkPropList(c.props);
  const { xs, ys } = canopyPosts(c);
  const P = CANOPY.post / 2 + PROP_GAP;
  const placed = [];
  props.forEach((p, i) => {
    const name = 'Prop ' + (i + 1) + ', the ' + propOf(p.type).name.toLowerCase();
    if (p.storey !== 0) throw Error(name + ' stands under the canopy.');
    const [fw, fd] = propFootprint(p.type, p.rotation);
    const box = [p.x, p.y, p.x + fw, p.y + fd];
    if (box[0] < 0 || box[1] < 0 || box[2] > c.width || box[3] > c.depth) throw Error(name + ' stands under the canopy, inside its posts.');
    for (const x of xs) for (const y of ys) if (box[0] < x + P && box[2] > x - P && box[1] < y + P && box[3] > y - P) throw Error(name + ' stands on a post: keep it ' + PROP_GAP + ' mm clear.');
    if (propOf(p.type).size[2] > c.height - 2) throw Error(name + ' is too tall for the canopy.');
    for (const q of placed)
      if (box[0] < q.box[2] + PROP_GAP && q.box[0] < box[2] + PROP_GAP && box[1] < q.box[3] + PROP_GAP && q.box[1] < box[3] + PROP_GAP) throw Error(name + ' stands on ' + q.name + ': keep them ' + PROP_GAP + ' mm apart.');
    placed.push({ box, name: 'prop ' + (i + 1) });
  });
  return props;
}

// The pieces of a run from a to b, cut at the bays' middles: [from, to] each.
function spans(c, a, b) {
  const cuts = cutsOf(c, a, b) ?? [];
  const edges = [a, ...cuts, b];
  return edges.slice(1).map((e, k) => [edges[k], e]);
}
const named = (base, all, i) => base + (all.length > 1 ? ' ' + (i + 1) + ' of ' + all.length : '');
const ided = (base, all, i) => base + (all.length > 1 ? '-' + (i + 1) : '');

/** The parts of a canopy, without geometry. */
export function canopyLayout(input) {
  const c = validateCanopy(input);
  const parts = [];
  const m = CANOPY.margin,
    ov = c.overhang;
  if (c.base) spans(c, -m, c.width + m).forEach((_, i, all) => parts.push({ id: ided('slab', all, i), name: named('Slab', all, i), role: 'buildingBase' }));
  const { xs, ys } = canopyPosts(c);
  ys.forEach((_, r) => xs.forEach((_, k) => parts.push({ id: 'post-' + (r ? 'back' : 'front') + '-' + (k + 1), name: 'Post, ' + (r ? 'back' : 'front') + ' ' + (k + 1), role: 'frame' })));
  const roofSpans = spans(c, -ov, c.width + ov);
  if (c.roof === 'flat') roofSpans.forEach((_, i, all) => parts.push({ id: ided('roof', all, i), name: named('Roof', all, i), role: 'roof' }));
  else {
    for (const side of ['front', 'back']) roofSpans.forEach((_, i, all) => parts.push({ id: ided('rail-' + side, all, i), name: named('Rail, ' + side, all, i), role: 'frame' }));
    for (const side of ['front', 'back']) roofSpans.forEach((_, i, all) => parts.push({ id: ided('roof-' + side, all, i), name: named('Tent, ' + side, all, i), role: 'roof' }));
  }
  if (c.screens === 'ends' || c.screens === 'three') parts.push({ id: 'screen-left', name: 'Screen, left', role: 'wall' }, { id: 'screen-right', name: 'Screen, right', role: 'wall' });
  if (c.screens === 'back' || c.screens === 'three') spans(c, 0, c.width).forEach((_, i, all) => parts.push({ id: ided('screen-back', all, i), name: named('Screen, back', all, i), role: 'wall' }));
  if (c.text) parts.push({ id: 'sign', name: 'Sign', role: 'wall' });
  parts.push(...propPartIds(c.props));
  return { building: c, parts };
}

/** The canopy, built where it stands. */
export function buildCanopy(wasm, input) {
  const { Manifold } = wasm;
  const c = validateCanopy(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { box, sweep } = kitShapes(wasm, own);
  const { post: P, play, socket, slab: S, margin: m } = CANOPY;
  const [pin, pinHigh] = CANOPY.pin;
  const ov = c.overhang;
  const z0 = c.base ? S : 0,
    zr = z0 + c.height;
  const { xs, ys } = canopyPosts(c);
  const parts = [];
  const minus = (a, cuts) => (cuts.length ? own(a.subtract(own(Manifold.union(cuts)))) : a);
  // The sockets for the pins, or the posts' feet, at every post.
  const at = (fn) => xs.flatMap((x) => ys.map((y) => fn(x, y)));
  // A long solid cut along x into its pieces.
  const cut = (solid, [a, b]) => own(solid.intersect(box(a, -1000, -1000, b, 1000, 1000)));
  try {
    if (c.base) {
      let slab = box(-m, -m, 0, c.width + m, c.depth + m, S);
      slab = minus(slab, at((x, y) => box(x - P / 2 - play, y - P / 2 - play, S - socket, x + P / 2 + play, y + P / 2 + play, S + 1)));
      spans(c, -m, c.width + m).forEach((span, i, all) => parts.push({ id: ided('slab', all, i), name: named('Slab', all, i), role: 'buildingBase', solid: cut(slab, span), lie: [0, 0, 0], apart: [(i - (all.length - 1) / 2) * 6, 0, -10] }));
    }
    // The posts: from the foot of their socket up to the roof, a pin on top flush with the back face, the face
    // each prints lying on, so the pin lies on the plate too.
    const pinY = (y) => y + P / 2 - pin / 2;
    ys.forEach((y, r) =>
      xs.forEach((x, k) => {
        const post = own(Manifold.union([box(x - P / 2, y - P / 2, z0 - (c.base ? socket : 0), x + P / 2, y + P / 2, zr), box(x - pin / 2, pinY(y) - pin / 2, zr - 0.01, x + pin / 2, pinY(y) + pin / 2, zr + pinHigh)]));
        parts.push({ id: 'post-' + (r ? 'back' : 'front') + '-' + (k + 1), name: 'Post, ' + (r ? 'back' : 'front') + ' ' + (k + 1), role: 'frame', solid: post, outward: [0, -1, 0], apart: [0, r ? 10 : -10, 0] });
      }),
    );
    const sockets = (z) => at((x, y) => box(x - pin / 2 - play, pinY(y) - pin / 2 - play, z - 0.01, x + pin / 2 + play, pinY(y) + pin / 2 + play, z + pinHigh + play));
    const roofSpans = spans(c, -ov, c.width + ov);
    if (c.roof === 'flat') {
      // A deep plate on the posts' pins; it prints upside down, its sockets open.
      const plate = minus(box(-ov, -ov, zr, c.width + ov, c.depth + ov, zr + CANOPY.plate), sockets(zr));
      roofSpans.forEach((span, i, all) => parts.push({ id: ided('roof', all, i), name: named('Roof', all, i), role: 'roof', solid: cut(plate, span), flip: true, apart: [(i - (all.length - 1) / 2) * 6, 0, 25] }));
    } else {
      // A rail along the front and one along the back on the posts' pins, upside down to print;
      // on them the two slopes, each on its underside, meeting at the ridge over the middle.
      const [rw, rd] = CANOPY.rail;
      const t = Math.tan((c.pitch * Math.PI) / 180),
        T = CANOPY.tent / Math.cos((c.pitch * Math.PI) / 180);
      const top = zr + rd;
      for (const [side, y] of [['front', ys[0]], ['back', ys[1]]]) {
        const rail = minus(box(-ov, y - rw / 2, zr, c.width + ov, y + rw / 2, top), sockets(zr));
        roofSpans.forEach((span, i, all) => parts.push({ id: ided('rail-' + side, all, i), name: named('Rail, ' + side, all, i), role: 'frame', solid: cut(rail, span), flip: true, apart: [(i - (all.length - 1) / 2) * 6, side === 'front' ? -12 : 12, 15] }));
      }
      const mid = c.depth / 2;
      // A slope's underside rests on its rail's outer top edge, rising from it to the ridge and falling past it to the eaves.
      const under = (y, side) => (side === 'front' ? top + (y - (ys[0] - rw / 2)) * t : top + (ys[1] + rw / 2 - y) * t);
      for (const [side, lo, hi] of [['front', -ov, mid], ['back', mid, c.depth + ov]]) {
        const pts = [[lo, under(lo, side)], [hi, under(hi, side)], [hi, under(hi, side) + T], [lo, under(lo, side) + T]];
        const slope = sweep(pts, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], -ov, c.width + ov);
        roofSpans.forEach((span, i, all) =>
          parts.push({ id: ided('roof-' + side, all, i), name: named('Tent, ' + side, all, i), role: 'roof', solid: cut(slope, span), lie: [side === 'front' ? -c.pitch : c.pitch, 0, 0], apart: [(i - (all.length - 1) / 2) * 6, side === 'front' ? -20 : 20, 35] }),
        );
      }
    }
    // The screens: in the line of the posts, between them, from the slab up to the roof or the rails.
    const sc = CANOPY.screen;
    if (c.screens === 'ends' || c.screens === 'three')
      for (const [side, x] of [['left', xs[0]], ['right', xs[xs.length - 1]]])
        parts.push({ id: 'screen-' + side, name: 'Screen, ' + side, role: 'wall', solid: box(x - sc / 2, ys[0] + P / 2, z0, x + sc / 2, ys[1] - P / 2, zr), outward: [side === 'left' ? -1 : 1, 0, 0], apart: [side === 'left' ? -15 : 15, 0, 0] });
    if (c.screens === 'back' || c.screens === 'three') {
      const y = ys[1];
      // One board behind the back posts, glued against them, end post to end post.
      const screen = box(xs[0] - P / 2, y + P / 2, z0, xs[xs.length - 1] + P / 2, y + P / 2 + sc, zr);
      spans(c, 0, c.width).forEach((span, i, all) => parts.push({ id: ided('screen-back', all, i), name: named('Screen, back', all, i), role: 'wall', solid: cut(screen, span), outward: [0, 1, 0], apart: [(i - (all.length - 1) / 2) * 6, 15, 0] }));
    }
    // The sign: a board along the front of the roof, or hung from the front rail, its letters raised; it prints on its back.
    if (c.text) {
      const [a, b] = boardSpan(c);
      const [bt, bh] = CANOPY.board;
      const yf = c.roof === 'flat' ? -ov : ys[0] - P / 2;
      const zt = c.roof === 'flat' ? zr + CANOPY.plate : zr;
      const h = textHeight(c);
      const shape = own(textShape(wasm, own, c.text, h).translate([(a + b) / 2 - textWidth(c.text, h) / 2, zt - bh / 2 - h / 2]));
      const [w0, w1] = letterDepth(false);
      const letters = sweep(shape, [1, 0, 0], [0, 0, 1], [0, yf - bt, 0], [0, 1, 0], -w1, -w0);
      parts.push({ id: 'sign', name: 'Sign', role: 'wall', solid: own(Manifold.union([box(a, yf - bt, zt - bh, b, yf, zt), letters])), outward: [0, -1, 0], apart: [0, -25, 10] });
    }
    // The props on the slab, or the table.
    const ids = propPartIds(c.props);
    let k = 0;
    for (const p of c.props) for (const q of placeProp(wasm, own, p, z0)) parts.push({ ...ids[k++], solid: q.solid, turn: q.pose, apart: [0, 0, 6] });
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}
