// A freestanding board beside the track: a billboard raised on two posts,
// or a hoarding, a long low board along the track on posts, in pieces that
// join post to post. Each piece is one flat panel (its posts and its board,
// a raised border round the face) that prints on its back, the face up; a
// triangular strut glued behind each post stands it up. x along the board,
// y from its face (the track at negative y) back, z up.

import { kitShapes } from './kit-shapes.js';

export const BILLBOARD_DEFAULTS = Object.freeze({
  kind: 'billboard',
  style: 'board', // 'board': raised on two posts; 'hoarding': long and low, a post every so often
  length: 120,
  height: 40, // the board itself
  clearance: 45, // its bottom above the table
  border: true, // a raised border round the face
});
export const BILLBOARD_LIMITS = Object.freeze({
  length: [30, 1500],
  height: [10, 120],
  clearance: [0, 150],
});
export const BILLBOARD = Object.freeze({
  thick: 3, // the board and the posts, as they lie
  post: 6, // a post, wide
  border: [2.5, 0.8], // the raised border: wide, proud of the face
  pitch: 85, // a hoarding's posts at most this far apart: two bays to a piece
  piece: 180, // a piece at most this long
  strut: [3, 0.35, 12], // a strut: thick, its depth as a share of its height, at least this deep
  inset: 0.15, // a board's posts this share of its length in from each end
});
const LABELS = { length: 'Length', height: 'Board height', clearance: 'Height above the table' };

/** The board as kept: known settings only, each checked. */
export function validateBillboard(input) {
  const b = { ...BILLBOARD_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(b)) if (!Object.hasOwn(BILLBOARD_DEFAULTS, key)) throw Error('The billboard has an unknown setting: ' + key + '.');
  if (!['board', 'hoarding'].includes(b.style)) throw Error('Choose a billboard on two posts or a hoarding.');
  for (const [key, [min, max]] of Object.entries(BILLBOARD_LIMITS))
    if (!Number.isFinite(b[key]) || b[key] < min || b[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + ' mm.');
  if (typeof b.border !== 'boolean') throw Error('Choose whether the board has a border.');
  if (b.style === 'board' && b.length > BILLBOARD.piece) throw Error('A billboard on two posts is at most ' + BILLBOARD.piece + ' mm long: a longer one is a hoarding.');
  if (b.clearance + b.height > 190) throw Error('The billboard stands at most 190 mm high, to print: ' + (b.clearance + b.height) + ' mm now.');
  return b;
}

/** Where the posts stand along it (their middles). */
export function billboardPosts(b) {
  const P = BILLBOARD.post;
  if (b.style === 'board') return [b.length * BILLBOARD.inset, b.length * (1 - BILLBOARD.inset)];
  const n = Math.max(1, Math.ceil((b.length - P) / BILLBOARD.pitch - 1e-9));
  return Array.from({ length: n + 1 }, (_, k) => P / 2 + (k * (b.length - P)) / n);
}
/** The pieces of a hoarding, [from, to] along it, each ending at a post: as few as keep each no longer than a piece. */
export function billboardPieces(b) {
  if (b.style === 'board') return [[0, b.length]];
  const posts = billboardPosts(b),
    P = BILLBOARD.post;
  const out = [];
  let from = 0;
  for (let k = 1; k < posts.length; k++) {
    // End this piece at the post before the one that would make it too long.
    const end = k === posts.length - 1 ? b.length : posts[k] - P / 2;
    const next = k + 1 < posts.length ? posts[k + 1] - P / 2 : b.length;
    if (k === posts.length - 1 || next - from > BILLBOARD.piece) {
      out.push([from, end]);
      from = end;
    }
  }
  return out;
}
/** How deep its struts reach behind it. */
export const strutDepth = (b) => Math.max(BILLBOARD.strut[2], (b.clearance + b.height) * BILLBOARD.strut[1]);
/** Its outline on the table, [x0, y0, x1, y1]. */
export function billboardFootprint(b) {
  return [0, 0, b.length, BILLBOARD.thick + strutDepth(b)];
}

/** The parts of a billboard, without geometry. */
export function billboardLayout(input) {
  const b = validateBillboard(input);
  const pieces = billboardPieces(b);
  const parts = pieces.map((_, i) => ({ id: 'board-' + (i + 1), name: pieces.length > 1 ? 'Board ' + (i + 1) + ' of ' + pieces.length : 'Board', role: 'wall' }));
  billboardPosts(b).forEach((_, i) => parts.push({ id: 'strut-' + (i + 1), name: 'Strut ' + (i + 1), role: 'frame' }));
  return { building: b, parts };
}

/** The billboard, built. */
export function buildBillboard(wasm, input) {
  const { Manifold } = wasm;
  const b = validateBillboard(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { box, poly, sweep } = kitShapes(wasm, own);
  const { thick: T, post: P } = BILLBOARD;
  const [bw, bh] = BILLBOARD.border;
  const z0 = b.clearance,
    z1 = b.clearance + b.height;
  const posts = billboardPosts(b);
  const parts = [];
  try {
    billboardPieces(b).forEach(([a, c], i, all) => {
      // The board between a and c, its posts from the table to its top.
      const bits = [box(a, 0, z0, c, T, z1)];
      for (const u of posts) if (u - P / 2 >= a - 1e-6 && u + P / 2 <= c + 1e-6) bits.push(box(u - P / 2, 0, 0, u + P / 2, T, z1));
      // The border, proud of the face: round the whole board, so its pieces' borders meet.
      if (b.border) {
        const x0 = 0,
          x1 = b.length;
        const ring = [box(x0, -bh, z0, x1, 0.01, z0 + bw), box(x0, -bh, z1 - bw, x1, 0.01, z1), box(x0, -bh, z0, x0 + bw, 0.01, z1), box(x1 - bw, -bh, z0, x1, 0.01, z1)];
        const within = box(a, -bh - 1, z0 - 1, c, 0.02, z1 + 1);
        for (const r of ring) {
          const piece = own(r.intersect(within));
          if (!piece.isEmpty()) bits.push(piece);
        }
      }
      parts.push({ id: 'board-' + (i + 1), name: all.length > 1 ? 'Board ' + (i + 1) + ' of ' + all.length : 'Board', role: 'wall', solid: own(Manifold.union(bits)), outward: [0, -1, 0], apart: [i * 6, -10, 0] });
    });
    // A strut behind each post: a right triangle, its foot on the table, its upright against the post.
    const H = z0 + b.height * 0.6,
      d = strutDepth(b),
      st = BILLBOARD.strut[0];
    posts.forEach((u, i) => {
      const tri = poly([[T, 0], [T + d, 0], [T, H]]);
      const solid = sweep(tri, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], u - st / 2, u + st / 2);
      parts.push({ id: 'strut-' + (i + 1), name: 'Strut ' + (i + 1), role: 'frame', solid, outward: [1, 0, 0], apart: [0, 10, 0] });
    });
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}
