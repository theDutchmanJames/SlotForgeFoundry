// A stage for the cars: a low deck with a ramp up to each end, like a rally's
// ceremonial start ramp or a Victory Lane podium. A portal can stand over it
// (two piers and a header lettered along its front) and a backdrop behind it
// (three panels of raised checks, the middle one lettered, each standing in a
// foot). The deck is a hollow shell that prints upside down; the ramps are
// wedges on their side; the piers, the header and the panels lie flat, the
// letters and the checks up; the feet stand as they are. x along the front,
// y from the front (the track at negative y) to the back, z up.

import { kitShapes } from './kit-shapes.js';
import { LETTERING, checkText, fitHeight, letterDepth, textShape, textWidth } from './lettering.js';

export const STAGE_DEFAULTS = Object.freeze({
  kind: 'stage',
  width: 150, // along the front, the deck
  depth: 100, // front to back, the deck
  height: 14, // the deck's top above the table
  ramps: 'ends', // 'ends': a ramp up to each end; 'none'
  rampLength: 70, // each ramp, along x
  portal: false, // two piers at the ends of the deck and a header across over it
  portalHeight: 100, // the header's top above the deck
  text: '', // along the header's front
  backdrop: false, // three panels standing behind the deck
  backdropHeight: 60,
  backdropText: '', // on the middle panel
});
export const STAGE_LIMITS = Object.freeze({
  width: [40, 180],
  depth: [40, 180],
  height: [6, 40],
  rampLength: [20, 180],
  portalHeight: [40, 150],
  backdropHeight: [20, 120],
});
export const STAGE = Object.freeze({
  shell: 2.5, // the deck's sides
  top: 3, // the deck's top
  rib: 60, // ribs under the deck at most this far apart
  pier: [10, 12], // a pier: wide (x), deep (y)
  header: [8, 16], // the header: deep (y), high
  panel: 3, // a backdrop panel, thick
  gap: 4, // the backdrop behind the deck
  foot: [12, 6, 3], // a panel's foot: deep, high, the slot this deep
  check: [8, 1], // the checks: square, proud of the face
  play: 0.2,
});
const LABELS = { width: 'Width', depth: 'Depth', height: 'Deck height', rampLength: 'Ramp length', portalHeight: 'Portal height', backdropHeight: 'Backdrop height' };

const headerHeight = (s) => fitHeight(s.text, s.width - 2 * STAGE.pier[0] - 6, STAGE.header[1] - 4);
// The panels behind: three, side by side across the deck, [x0, x1] each.
const panelSpans = (s) => [0, 1, 2].map((k) => [(s.width * k) / 3 + 1, (s.width * (k + 1)) / 3 - 1]);
const panelTextHeight = (s) => {
  const [a, b] = panelSpans(s)[1];
  return fitHeight(s.backdropText, b - a - 6, Math.min(16, s.backdropHeight / 3));
};

/** The stage as kept: known settings only, each checked. */
export function validateStage(input) {
  const s = { ...STAGE_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(s)) if (!Object.hasOwn(STAGE_DEFAULTS, key)) throw Error('The stage has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(STAGE_LIMITS))
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + ' mm.');
  if (!['ends', 'none'].includes(s.ramps)) throw Error('Choose a ramp up to each end, or none.');
  if (typeof s.portal !== 'boolean' || typeof s.backdrop !== 'boolean') throw Error('Choose whether the stage has a portal and a backdrop.');
  s.text = checkText(s.text, 'The portal text');
  s.backdropText = checkText(s.backdropText, 'The backdrop text');
  if (s.text && !s.portal) throw Error('The portal text goes on the portal: choose a portal too.');
  if (s.backdropText && !s.backdrop) throw Error('The backdrop text goes on the backdrop: choose a backdrop too.');
  if (s.text && headerHeight(s) < LETTERING.height[0]) throw Error('The portal is too short for “' + s.text + '”: make the stage wider, or the text shorter.');
  if (s.backdropText && panelTextHeight(s) < LETTERING.height[0]) throw Error('The backdrop panel is too small for “' + s.backdropText + '”: make the stage wider, or the text shorter.');
  // A ramp at most a 1 in 3, so a car runs up it.
  if (s.ramps === 'ends' && s.rampLength < 3 * s.height) throw Error('A ramp is at least three times as long as the deck is high: at least ' + 3 * s.height + ' mm.');
  if (s.portal && s.width < 2 * STAGE.pier[0] + 30) throw Error('A portal needs the deck at least ' + (2 * STAGE.pier[0] + 30) + ' mm wide.');
  return s;
}

/** The stage on the table, [x0, y0, x1, y1]: its ramps and its backdrop. */
export function stageFootprint(s) {
  const r = s.ramps === 'ends' ? s.rampLength : 0;
  return [-r, 0, s.width + r, s.depth + (s.backdrop ? STAGE.gap + STAGE.foot[0] : 0)];
}

/** The parts of a stage, without geometry. */
export function stageLayout(input) {
  const s = validateStage(input);
  const parts = [{ id: 'deck', name: 'Deck', role: 'buildingBase' }];
  if (s.ramps === 'ends') parts.push({ id: 'ramp-left', name: 'Ramp, left', role: 'floor' }, { id: 'ramp-right', name: 'Ramp, right', role: 'floor' });
  if (s.portal) parts.push({ id: 'pier-left', name: 'Pier, left', role: 'frame' }, { id: 'pier-right', name: 'Pier, right', role: 'frame' }, { id: 'header', name: 'Header', role: 'wall' });
  if (s.backdrop) for (const k of [1, 2, 3]) parts.push({ id: 'backdrop-' + k, name: 'Backdrop panel ' + k, role: 'wall' }, { id: 'foot-' + k, name: 'Foot ' + k, role: 'frame' });
  return { building: s, parts };
}

/** The stage, built where it stands. */
export function buildStage(wasm, input) {
  const { Manifold } = wasm;
  const s = validateStage(input);
  const temp = [];
  const own = (x) => (temp.push(x), x);
  const { box, sweep } = kitShapes(wasm, own);
  const union = (bits) => own(Manifold.union(bits));
  const minus = (a, cuts) => (cuts.length ? own(a.subtract(union(cuts))) : a);
  const W = s.width,
    D = s.depth,
    H = s.height;
  const { shell: t, top: T } = STAGE;
  const parts = [];
  // Letters raised on a face looking to -y at y, their middle at (x, z).
  const lettered = (text, h, x, z, y) => {
    const shape = own(textShape(wasm, own, text, h).translate([x - textWidth(text, h) / 2, z - h / 2]));
    const [w0, w1] = letterDepth(false);
    return sweep(shape, [1, 0, 0], [0, 0, 1], [0, y, 0], [0, 1, 0], -w1, -w0);
  };
  try {
    // The deck: a shell open underneath, ribs across it at most STAGE.rib apart; upside down to print.
    const n = Math.max(0, Math.ceil(W / STAGE.rib) - 1);
    const ribs = Array.from({ length: n }, (_, k) => box((W * (k + 1)) / (n + 1) - t / 2, t - 0.01, 0, (W * (k + 1)) / (n + 1) + t / 2, D - t + 0.01, H - T + 0.01));
    const deck = union([minus(box(0, 0, 0, W, D, H), [box(t, t, -1, W - t, D - t, H - T)]), ...ribs]);
    parts.push({ id: 'deck', name: 'Deck', role: 'buildingBase', solid: deck, flip: true, apart: [0, 0, 0] });
    // The ramps: wedges from the table up to the deck's top at each end, as deep as the deck; each on its side.
    if (s.ramps === 'ends') {
      const L = s.rampLength;
      for (const [side, pts] of [['left', [[-L, 0], [0, 0], [0, H]]], ['right', [[W, 0], [W + L, 0], [W, H]]]]) {
        const ramp = sweep(pts, [1, 0, 0], [0, 0, 1], [0, 0, 0], [0, 1, 0], 0, D);
        parts.push({ id: 'ramp-' + side, name: 'Ramp, ' + side, role: 'floor', solid: ramp, outward: [0, -1, 0], apart: [side === 'left' ? -12 : 12, 0, 0] });
      }
    }
    // The portal: a pier at each end of the deck, a header across on them, lettered along its front.
    if (s.portal) {
      const [pw, pd] = STAGE.pier,
        [hd, hh] = STAGE.header;
      const ym = D / 2,
        zh = H + s.portalHeight;
      for (const [side, x0] of [['left', 0], ['right', W - pw]])
        parts.push({ id: 'pier-' + side, name: 'Pier, ' + side, role: 'frame', solid: box(x0, ym - pd / 2, H, x0 + pw, ym + pd / 2, zh - hh), outward: [0, -1, 0], apart: [side === 'left' ? -10 : 10, 0, 10] });
      const bits = [box(0, ym - hd / 2, zh - hh, W, ym + hd / 2, zh)];
      if (s.text) bits.push(lettered(s.text, headerHeight(s), W / 2, zh - hh / 2, ym - hd / 2));
      parts.push({ id: 'header', name: 'Header', role: 'wall', solid: union(bits), outward: [0, -1, 0], apart: [0, 0, 30] });
    }
    // The backdrop: three panels behind the deck, raised checks on their faces, the middle one lettered; each in a foot.
    if (s.backdrop) {
      const [fd, fh, slot] = STAGE.foot,
        [cs, cp] = STAGE.check,
        P = STAGE.panel,
        play = STAGE.play;
      const y0 = D + STAGE.gap + (fd - P) / 2;
      const zp = fh - slot,
        zt = zp + s.backdropHeight;
      const th = s.backdropText ? panelTextHeight(s) : 0;
      panelSpans(s).forEach(([a, b], k) => {
        const bits = [box(a, y0, zp, b, y0 + P, zt)];
        // The checks, a square raised in every other place above the foot, clear of the edges; on the middle one round its text.
        const zc = fh + 2,
          rows = Math.floor((zt - 2 - zc) / cs),
          cols = Math.floor((b - a - 4) / cs);
        const x0 = (a + b) / 2 - (cols * cs) / 2;
        const textBand = k === 1 && th ? [(zc + zt) / 2 - th / 2 - 2, (zc + zt) / 2 + th / 2 + 2] : null;
        for (let r = 0; r < rows; r++)
          for (let q = 0; q < cols; q++) {
            if ((r + q) % 2) continue;
            const z = zc + r * cs;
            if (textBand && z + cs > textBand[0] && z < textBand[1]) continue;
            bits.push(box(x0 + q * cs, y0 - cp, z, x0 + (q + 1) * cs, y0 + 0.01, z + cs));
          }
        if (k === 1 && th) bits.push(lettered(s.backdropText, th, (a + b) / 2, (zc + zt) / 2, y0));
        parts.push({ id: 'backdrop-' + (k + 1), name: 'Backdrop panel ' + (k + 1), role: 'wall', solid: union(bits), outward: [0, -1, 0], apart: [0, 20, 10] });
        // Its foot: a block along it with a slot the panel stands in.
        const foot = minus(box(a, D + STAGE.gap, 0, b, D + STAGE.gap + fd, fh), [box(a - 1, y0 - play, zp, b + 1, y0 + P + play, fh + 1)]);
        parts.push({ id: 'foot-' + (k + 1), name: 'Foot ' + (k + 1), role: 'frame', solid: foot, lie: [0, 0, 0], apart: [0, 20, 0] });
      });
    }
    const keep = new Set(parts.map((p) => p.solid));
    for (const x of temp) if (!keep.has(x)) x.delete();
    return parts;
  } catch (e) {
    for (const x of temp) x.delete();
    throw e;
  }
}
