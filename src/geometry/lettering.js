// Lettering for signs, billboards and walls: plain block capitals, figures
// and a few marks, drawn as strokes on a grid six units high and thickened to
// a printable width, rounded at their ends and corners like a signwriter's
// letters. Pure geometry, the same in the browser, a worker and the tests.

// Each glyph: its width in units and its strokes, as polylines (x right, y up from the baseline).
const O = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
const P = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]];
const DOT = (x, y) => [[x, y], [x, y + 0.001]];
const GLYPHS = {
  A: [4, [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 2.5], [4, 2.5]]]],
  B: [4, [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]]],
  C: [4, [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]]],
  D: [4, [[[0, 0], [0, 6], [2.5, 6], [4, 4.5], [4, 1.5], [2.5, 0], [0, 0]]]],
  E: [3.5, [[[3.5, 6], [0, 6], [0, 0], [3.5, 0]], [[0, 3], [3, 3]]]],
  F: [3.5, [[[3.5, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]]],
  G: [4, [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2.2, 3]]]],
  H: [4, [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]]],
  I: [0, [[[0, 0], [0, 6]]]],
  J: [3.5, [[[3.5, 6], [3.5, 1], [2.5, 0], [1, 0], [0, 1]]]],
  K: [4, [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1.6, 3.6], [4, 0]]]],
  L: [3.5, [[[0, 6], [0, 0], [3.5, 0]]]],
  M: [5, [[[0, 0], [0, 6], [2.5, 2.5], [5, 6], [5, 0]]]],
  N: [4, [[[0, 0], [0, 6], [4, 0], [4, 6]]]],
  O: [4, [O]],
  P: [4, [P]],
  Q: [4, [O, [[2.4, 1.6], [4.2, -0.2]]]],
  R: [4, [P, [[2, 3], [4, 0]]]],
  S: [4, [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]]],
  T: [4, [[[0, 6], [4, 6]], [[2, 6], [2, 0]]]],
  U: [4, [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]]],
  V: [4, [[[0, 6], [2, 0], [4, 6]]]],
  W: [5.5, [[[0, 6], [1.3, 0], [2.75, 4], [4.2, 0], [5.5, 6]]]],
  X: [4, [[[0, 6], [4, 0]], [[0, 0], [4, 6]]]],
  Y: [4, [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]]],
  Z: [4, [[[0, 6], [4, 6], [0, 0], [4, 0]]]],
  0: [3.5, [[[1, 0], [0, 1], [0, 5], [1, 6], [2.5, 6], [3.5, 5], [3.5, 1], [2.5, 0], [1, 0]]]],
  1: [2, [[[0, 4.5], [1.5, 6], [1.5, 0]]]],
  2: [4, [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]]],
  3: [4, [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1.5, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]]],
  4: [4, [[[3, 0], [3, 6], [0, 2], [4, 2]]]],
  5: [4, [[[4, 6], [0, 6], [0, 3.5], [3, 3.5], [4, 2.5], [4, 1], [3, 0], [1, 0], [0, 1]]]],
  6: [4, [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2.5], [3, 3.5], [0, 3.5]]]],
  7: [4, [[[0, 6], [4, 6], [1.5, 0]]]],
  8: [4, [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]]],
  9: [4, [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 3.5], [1, 2.5], [4, 2.5]]]],
  '-': [2.5, [[[0, 3], [2.5, 3]]]],
  '+': [3, [[[0, 3], [3, 3]], [[1.5, 1.5], [1.5, 4.5]]]],
  '.': [0, [DOT(0, 0)]],
  ',': [0.6, [[[0.6, 0.4], [0, -1]]]],
  "'": [0, [[[0, 6], [0, 4.5]]]],
  '!': [0, [[[0, 6], [0, 2]], DOT(0, 0)]],
  ':': [0, [DOT(0, 4), DOT(0, 1)]],
  '/': [3, [[[0, 0], [3, 6]]]],
  '&': [4.5, [[[4.5, 0], [1, 4], [1, 5], [2, 6], [3, 5], [3, 4.4], [0, 2], [0, 1], [1, 0], [2.5, 0], [4.5, 2.5]]]],
  '#': [4, [[[1, 0], [1.5, 6]], [[2.5, 0], [3, 6]], [[0, 2], [4, 2]], [[0, 4], [4, 4]]]],
};
const SPACE = 2.5; // a space, in units
const GAP = 1.5; // between letters, in units, as well as the stroke

/** The settings: a letter's stroke a share of its height, never thinner than a nozzle lays well; raised or cut this deep. */
export const LETTERING = Object.freeze({ stroke: 0.14, thinnest: 0.8, depth: 0.6, height: [4, 40], longest: 40 });
export const LETTERS = Object.freeze(Object.keys(GLYPHS).join('') + ' ');

/** The text as it is lettered: capitals, single spaces, nothing it has no letter for. */
export function checkText(text, what = 'The lettering') {
  if (typeof text !== 'string') throw Error(what + ' must be text.');
  const t = text.toUpperCase().replace(/\s+/g, ' ').trim();
  if (t.length > LETTERING.longest) throw Error(what + ' is at most ' + LETTERING.longest + ' letters.');
  const odd = [...new Set([...t].filter((c) => c !== ' ' && !GLYPHS[c]))];
  if (odd.length) throw Error(what + ' has no letter for ' + odd.map((c) => '“' + c + '”').join(', ') + ': use A to Z, 0 to 9 and - + . , \' ! : / & #.');
  return t;
}
const strokeOf = (height) => Math.max(LETTERING.thinnest, height * LETTERING.stroke);
/** How wide the text is, lettered this high (mm). */
export function textWidth(text, height) {
  const t = strokeOf(height), k = (height - t) / 6;
  let w = 0;
  [...text].forEach((c, i) => { w += c === ' ' ? SPACE * k : GLYPHS[c][0] * k; if (i < text.length - 1) w += GAP * k + t; });
  return w + t;
}
/** The height text can be lettered to fit a box: as high as the box allows, no wider than it. */
export function fitHeight(text, width, height) {
  if (!text) return 0;
  // The width grows with the height: halve the step until it fits.
  let lo = 0, hi = height;
  if (textWidth(text, hi) <= width) return hi;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (textWidth(text, mid) <= width) lo = mid; else hi = mid; }
  return lo;
}
/** The strokes of the text in mm, from its bottom left corner, and how thick they are. */
export function textStrokes(text, height) {
  const t = strokeOf(height), k = (height - t) / 6, lines = [];
  let x = t / 2;
  for (const c of text) {
    if (c === ' ') { x += SPACE * k + GAP * k + t; continue; }
    const [w, strokes] = GLYPHS[c];
    for (const s of strokes) lines.push(s.map(([u, v]) => [x + u * k, t / 2 + v * k]));
    x += w * k + GAP * k + t;
  }
  return { lines, stroke: t, width: textWidth(text, height) };
}
/** The text as a cross-section in mm, its bottom left corner at 0, 0, its letters `height` high. */
export function textShape(wasm, own, text, height) {
  const { CrossSection } = wasm;
  const { lines, stroke } = textStrokes(text, height), r = stroke / 2, bits = [];
  for (const line of lines) {
    for (const [x, y] of line) bits.push(own(CrossSection.circle(r, 16).translate([x, y])));
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1], [x1, y1] = line[i], len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) continue;
      const nx = (-(y1 - y0) / len) * r, ny = ((x1 - x0) / len) * r;
      bits.push(own(new CrossSection([[[x0 + nx, y0 + ny], [x0 - nx, y0 - ny], [x1 - nx, y1 - ny], [x1 + nx, y1 + ny]]], 'NonZero')));
    }
  }
  return own(CrossSection.union(bits));
}

/**
 * The text carved in V-grooves, for a face that prints face down: each
 * stroke a groove whose sides are steeper than 45°, so no part of it prints
 * over air. In the text's own frame: x along, y up the face, z out of it:
 * from just outside the face down to -depth. The strokes keep their places, thinner.
 */
export function textCarve(wasm, own, text, height) {
  const { Manifold } = wasm;
  const { lines } = textStrokes(text, height);
  const w = Math.min(1.6, Math.max(LETTERING.thinnest, height * 0.1)),
    r = w / 2,
    deep = r * 1.1;
  const ring = (x, y, z, rr) => Array.from({ length: 12 }, (_, k) => [x + rr * Math.cos((k * Math.PI) / 6), y + rr * Math.sin((k * Math.PI) / 6), z]);
  const bits = [];
  for (const line of lines) {
    for (const [x, y] of line) bits.push(own(Manifold.hull([...ring(x, y, 0.05, r), ...ring(x, y, 0, r), [x, y, -deep]])));
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1], [x1, y1] = line[i], len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) continue;
      const nx = (-(y1 - y0) / len) * r, ny = ((x1 - x0) / len) * r;
      const face = (z) => [[x0 + nx, y0 + ny, z], [x0 - nx, y0 - ny, z], [x1 - nx, y1 - ny, z], [x1 + nx, y1 + ny, z]];
      bits.push(own(Manifold.hull([...face(0.05), ...face(0), [x0, y0, -deep], [x1, y1, -deep]])));
    }
  }
  return { solid: own(Manifold.union(bits)), depth: deep };
}

/**
 * Raised text on a face, as a solid to add to it: in the face's frame, u
 * along it, v up it, w out of it. Its middle at (u, v); from w0 (a little into
 * the face) out to the face plus the letters' depth.
 */
export function raisedText(wasm, own, text, height, [u, v], w0 = -0.01, w1 = LETTERING.depth) {
  const shape = own(textShape(wasm, own, text, height).translate([u - textWidth(text, height) / 2, v - height / 2]));
  return own(own(shape.extrude(w1 - w0)).translate([0, 0, w0]));
}
/** A name board: a flat plate with the text raised on it, its letters this high. In its frame: u along it from its middle, v up it from its foot, w out of it from its back. */
export const NAME_BOARD = Object.freeze({ pad: 2.5, thick: 1.5 });
export function nameBoard(wasm, own, text, height) {
  const width = textWidth(text, height) + 2 * NAME_BOARD.pad,
    high = height + 2 * NAME_BOARD.pad;
  const plate = own(wasm.Manifold.cube([width, high, NAME_BOARD.thick]).translate([-width / 2, 0, 0]));
  const letters = raisedText(wasm, own, text, height, [0, high / 2], NAME_BOARD.thick - 0.01, NAME_BOARD.thick + LETTERING.depth);
  return { solid: own(plate.add(letters)), width, height: high };
}
/** The text height a name board takes to be at most `high` high and `wide` wide. */
export const nameBoardText = (text, wide, high) => fitHeight(text, wide - 2 * NAME_BOARD.pad, high - 2 * NAME_BOARD.pad);
