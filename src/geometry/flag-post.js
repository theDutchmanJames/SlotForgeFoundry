// A flag waver's post: a block of steps rising from the back to a landing
// at the front, where the flag waver stands, a cheek up each side with a
// handrail following the steps, and at the front a rail with a board on it.
// The block prints on its side, its profile on the plate; the cheeks and the
// front print flat. x across, y from the front (the track at negative y) to
// the back, z up.

import { LETTERING, checkText, fitHeight, letterDepth, raisedText } from './lettering.js';
import { kitShapes } from './kit-shapes.js';

export const FLAG_POST_DEFAULTS = Object.freeze({
  kind: 'flagpost',
  width: 40, // across, between the cheeks
  height: 30, // the landing above the table
  steps: 5, // up to the landing, the landing the last
  tread: 9,
  landing: 16, // front to back
  railHeight: 18, // the handrails above the steps and the landing
  board: true, // a board on the front rail
  boardHeight: 9,
  text: '', // lettered on the board: the post's number
  textCut: false, // its letters cut into the board, not raised
});
export const FLAG_POST_LIMITS = Object.freeze({
  width: [25, 80],
  height: [10, 60],
  steps: [2, 12],
  tread: [6, 14],
  landing: [10, 40],
  railHeight: [12, 30],
  boardHeight: [5, 20],
});
export const FLAG_POST = Object.freeze({
  cheek: 2.5, // the side cheeks and the front, thick
  post: 3, // a handrail's posts and the rail itself, square
  band: 4, // the cheek above the nose of each step
  glue: 6, // the front's band down the front of the landing
});
const LABELS = { width: 'Width', height: 'Height', steps: 'Steps', tread: 'Tread', landing: 'Landing', railHeight: 'Handrail height', boardHeight: 'Board height' };

/** How high the text on the board is lettered: 1 mm clear of its edges. */
export const flagTextHeight = (f) => fitHeight(f.text, f.width - 2 * FLAG_POST.post - 2, f.boardHeight - 2);

/** The flag post as kept: known settings only, each checked. */
export function validateFlagPost(input) {
  const f = { ...FLAG_POST_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(f)) if (!Object.hasOwn(FLAG_POST_DEFAULTS, key)) throw Error("The flag waver's post has an unknown setting: " + key + '.');
  for (const [key, [min, max]] of Object.entries(FLAG_POST_LIMITS))
    if (!Number.isFinite(f[key]) || f[key] < min || f[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'steps' ? '' : ' mm') + '.');
  if (!Number.isInteger(f.steps)) throw Error('Steps are a whole number.');
  if (typeof f.board !== 'boolean') throw Error('Choose whether the front rail has a board.');
  if (f.height / f.steps > 12) throw Error('Steps of ' + Math.round((f.height / f.steps) * 10) / 10 + ' mm are too high: at most 12 mm, so at least ' + Math.ceil(f.height / 12) + ' steps.');
  if (f.board && f.boardHeight > f.railHeight - FLAG_POST.post - 3) throw Error('The board must leave room under the rail: at most ' + (f.railHeight - FLAG_POST.post - 3) + ' mm high.');
  f.text = checkText(f.text, 'The board text');
  if (typeof f.textCut !== 'boolean') throw Error('Choose raised or cut letters for the board.');
  if (f.text && !f.board) throw Error('Text goes on the board: give the front rail its board.');
  if (f.text && flagTextHeight(f) < LETTERING.height[0]) throw Error('The board is too small for “' + f.text + '”: make it wider or higher, or the text shorter.');
  return f;
}

/** How deep it is: the landing and the steps below it. */
export const flagDepth = (f) => f.landing + (f.steps - 1) * f.tread;
/** Its outline on the table, [x0, y0, x1, y1]: the cheeks beside it, the front before it. */
export function flagFootprint(f) {
  const c = FLAG_POST.cheek;
  return [-c, -c, f.width + c, flagDepth(f)];
}

/** The parts of a flag post, without geometry. */
export function flagPostLayout(input) {
  const f = validateFlagPost(input);
  const parts = [
    { id: 'steps', name: 'Steps', role: 'wall' },
    { id: 'cheek-left', name: 'Cheek, left', role: 'frame' },
    { id: 'cheek-right', name: 'Cheek, right', role: 'frame' },
    { id: 'front', name: f.board ? 'Front rail and board' : 'Front rail', role: 'frame' },
  ];
  return { building: f, parts };
}

// The top of the steps in (y, z): the landing at the front, each step down towards the back.
function stepOutline(f) {
  const D = flagDepth(f),
    rise = f.height / f.steps;
  const pts = [[0, 0], [0, f.height], [f.landing, f.height]];
  for (let k = 1; k < f.steps; k++) {
    const y = f.landing + (k - 1) * f.tread,
      z = f.height - k * rise;
    pts.push([y, z], [y + f.tread, z]);
  }
  pts.push([D, 0]);
  return pts;
}

/** The flag post, built. */
export function buildFlagPost(wasm, input) {
  const { Manifold } = wasm;
  const f = validateFlagPost(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { poly, sweep } = kitShapes(wasm, own);
  const { cheek: c, post: P, band, glue } = FLAG_POST;
  const W = f.width,
    D = flagDepth(f),
    H = f.height,
    R = f.railHeight,
    rise = H / f.steps;
  const parts = [];
  try {
    // The block of steps: its profile swept across; it prints on its side.
    const outline = stepOutline(f);
    parts.push({ id: 'steps', name: 'Steps', role: 'wall', solid: sweep(outline, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], 0, W), outward: [-1, 0, 0], apart: [0, 0, 0] });

    // A cheek: the side of the steps and a band above each nose, a handrail
    // parallel to the steps over them and level over the landing, posts at
    // the front, at the top step and at the foot. In (y, z), as an outline each.
    const nose = (y) => (y <= f.landing ? H : H - Math.ceil((y - f.landing) / f.tread - 1e-9) * rise);
    // The line of the noses: from the landing's back edge down to the last step's.
    const y1 = f.landing,
      yN = f.landing + (f.steps - 2) * f.tread;
    const slope = f.steps > 2 ? (rise * (f.steps - 2)) / (yN - y1) : rise / f.tread;
    const line = (y) => (y <= y1 ? H : H - (y - y1) * slope);
    const shapes = [];
    // The cheek's solid part: under the line of the noses plus the band.
    shapes.push([[-c, 0], [-c, H + band], [y1, H + band], [D, line(D) + band], [D, 0]]);
    // The handrail: level over the landing, then down with the steps.
    const rail = (dz) => [[-c, H + R - P + dz], [y1, H + R - P + dz], [D, line(D) + R - P + dz]];
    const r0 = rail(0),
      r1 = rail(P);
    shapes.push([...r0, ...[...r1].reverse()]);
    // Posts: at the front, where the steps begin and at the foot.
    for (const y of [-c, y1 - P / 2, D - P]) {
      const top = (y <= y1 ? H : line(y + P)) + R;
      shapes.push([[y, nose(Math.max(y, 0)) + band - 0.5], [y + P, nose(Math.max(y, 0)) + band - 0.5], [y + P, top], [y, top]]);
    }
    const profile = own(wasm.CrossSection.union(shapes.map(poly)));
    for (const [side, x0, x1, out] of [['left', -c, 0, [-1, 0, 0]], ['right', W, W + c, [1, 0, 0]]])
      parts.push({ id: 'cheek-' + side, name: 'Cheek, ' + side, role: 'frame', solid: sweep(profile, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], x0, x1), outward: out, apart: [out[0] * 10, 0, 0] });

    // The front: a band glued down the front of the landing, posts at its
    // ends, the rail on top as high as the handrails, a board on it.
    const fr = [[0, H - glue], [W, H - glue], [W, H], [0, H]].map(([x, z]) => [x, z]);
    const bits = [poly(fr), poly([[0, H - 0.01], [P, H - 0.01], [P, H + R], [0, H + R]]), poly([[W - P, H - 0.01], [W, H - 0.01], [W, H + R], [W - P, H + R]]), poly([[0, H + R - P], [W, H + R - P], [W, H + R], [0, H + R]])];
    if (f.board) bits.push(poly([[P - 0.01, H + R - P - f.boardHeight], [W - P + 0.01, H + R - P - f.boardHeight], [W - P + 0.01, H + R - P + 0.01], [P - 0.01, H + R - P + 0.01]]));
    const front = own(wasm.CrossSection.union(bits));
    let frontRail = sweep(front, [1, 0, 0], [0, 0, 1], [0, -c, 0], [0, 1, 0], 0, c);
    // The text raised on the board's face, or cut into it: the face prints up.
    if (f.text) {
      const letters = own(raisedText(wasm, own, f.text, flagTextHeight(f), [0, 0], ...letterDepth(f.textCut)).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, W / 2, -c, H + R - P - f.boardHeight / 2, 1]));
      frontRail = own(f.textCut ? frontRail.subtract(letters) : frontRail.add(letters));
    }
    parts.push({ id: 'front', name: f.board ? 'Front rail and board' : 'Front rail', role: 'frame', solid: frontRail, outward: [0, -1, 0], apart: [0, -10, 0] });
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}
