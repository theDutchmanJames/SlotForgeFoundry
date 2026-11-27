// The shape of a window or door and what goes round it, shared by every kind
// of building: square, a round arch, a pointed arch, or round (a window); a
// sill ledge under it and a lintel over it, standing out of the wall; louvred
// shutters either side; and a door's leaf set in the back of its doorway. All
// is drawn in the plane of the wall (u along it, z up) and placed by the
// caller between two depths, measured out from the wall's outside face.
// Walls print outside face up, so all that stands out prints without supports.

export const OPENING_SHAPES = Object.freeze([
  ['square', 'Square'],
  ['arch', 'Round arch'],
  ['pointed', 'Pointed arch'],
  ['round', 'Round'],
]);
export const DOOR_LEAVES = Object.freeze([
  ['open', 'Open doorway'],
  ['plain', 'Plain door'],
  ['panels', 'Panelled door'],
  ['planks', 'Planked door'],
  ['glazed', 'Half-glazed door'],
]);
// Sizes: the ledge under a window (out beyond it each side, high); the lintel
// over it (high), both standing out `out`; shutters' gap to the opening, their
// slats; a door leaf's thickness, its panels' and planks' grooves.
export const TRIM = Object.freeze({ beyond: 2, ledge: 3, lintel: 4, out: 1.5, gap: 1, slat: 2, slatGroove: 0.7, slatDeep: 0.5, shutter: 1.2, leaf: 1.2, groove: 0.6, deep: 0.4, plank: 4, border: 3 });
const SEGMENTS = 48;
/** How far an opening's top rises above where its sides end: its arch. */
export function riseOf(shape, width) {
  if (shape === 'arch') return width / 2;
  if (shape === 'pointed') return width * Math.SQRT1_2;
  return 0;
}
/** What an opening's extras add each side of it along the wall: its shutters and its ledge or lintel. */
export const sideOf = (o) => (o.shutters ? TRIM.gap + o.width / 2 : 0) + (o.ledge || o.lintel ? TRIM.beyond : 0);
/** What an opening's lintel adds over its top. */
export const overOf = (o) => (o.lintel ? TRIM.lintel : 0);
/** What an opening's ledge adds under it. */
export const underOf = (o) => (o.ledge ? TRIM.ledge : 0);

/**
 * Checks an opening's shape and extras, `name` for the messages. A round
 * window is as high as it is wide; an arch needs straight sides under it.
 * Returns them with their defaults.
 */
export function checkOpeningShape(o, name) {
  const s = { shape: o.shape ?? 'square', ledge: o.ledge ?? false, lintel: o.lintel ?? false, shutters: o.shutters ?? false, leaf: o.leaf ?? 'open' };
  if (!OPENING_SHAPES.some(([id]) => id === s.shape)) throw Error(name + ': choose a square, arched, pointed or round opening.');
  for (const key of ['ledge', 'lintel', 'shutters']) if (typeof s[key] !== 'boolean') throw Error(name + ': choose whether it has a ' + (key === 'ledge' ? 'sill' : key === 'lintel' ? 'lintel' : 'pair of shutters') + '.');
  if (!DOOR_LEAVES.some(([id]) => id === s.leaf)) throw Error(name + ': choose an open doorway or a kind of door.');
  if (o.type === 'door') {
    if (s.shape === 'round') throw Error(name + ': a door is square or arched, not round.');
    if (s.ledge || s.shutters) throw Error(name + ': a door has no sill ledge or shutters; those are for a window.');
  } else if (s.leaf !== 'open') throw Error(name + ': a window has no door in it.');
  if (s.shutters && s.shape !== 'square') throw Error(name + ': shutters go beside a square window.');
  const rise = riseOf(s.shape, o.width);
  if (s.shape === 'round') s.height = o.width;
  else if ((s.shape === 'arch' || s.shape === 'pointed') && o.height < rise + 4)
    throw Error(name + ': an arch ' + Math.round(o.width) + ' mm wide rises ' + Math.round(rise * 10) / 10 + ' mm; make the opening at least ' + Math.ceil(rise + 4) + ' mm high, or narrower.');
  if (s.leaf === 'glazed' && o.height < 30) throw Error(name + ': a half-glazed door is at least 30 mm high.');
  return s;
}

/** The outline of an opening: points [u, z] round it, u from its middle, z from its foot, counter-clockwise. */
export function outlineOf({ shape = 'square', width: w, height: h }) {
  if (shape === 'round') {
    const r = w / 2;
    return Array.from({ length: SEGMENTS }, (_, k) => [r * Math.cos((2 * Math.PI * k) / SEGMENTS), r + r * Math.sin((2 * Math.PI * k) / SEGMENTS)]);
  }
  if (shape === 'arch') {
    const r = w / 2,
      spring = h - r;
    const top = Array.from({ length: SEGMENTS / 2 + 1 }, (_, k) => [r * Math.cos((Math.PI * k) / (SEGMENTS / 2)), spring + r * Math.sin((Math.PI * k) / (SEGMENTS / 2))]);
    return [[-r, 0], [r, 0], ...top];
  }
  if (shape === 'pointed') {
    // Two arcs of radius 3/4 of the width, each centred a quarter of the width over on the far side.
    const r = 0.75 * w,
      c = r - w / 2,
      spring = h - riseOf('pointed', w),
      end = Math.acos(c / r);
    const n = SEGMENTS / 2;
    // Up the right arc from its side to the apex, then down the left arc to its side.
    const right = Array.from({ length: n + 1 }, (_, k) => [-c + r * Math.cos((end * k) / n), spring + r * Math.sin((end * k) / n)]);
    const left = Array.from({ length: n }, (_, k) => {
      const a = Math.PI - end + (end * (k + 1)) / n;
      return [c + r * Math.cos(a), spring + r * Math.sin(a)];
    });
    return [[-w / 2, 0], [w / 2, 0], ...right, ...left];
  }
  return [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
}

/**
 * An opening drawn in the wall's plane, its middle at u and its foot at z0:
 * the hole; its frame (k wide, bars between its panes); its ledge, lintel and
 * shutters standing out of the face; a door's leaf. Each is a cross-section
 * with the depths it spans, out from the face (negative: into the wall).
 * `sink` is how far what stands out reaches into the face, to fill the joints
 * of a texture under it.
 */
export function openingShapes(wasm, own, o, { u, z0, wall: t, k, depth: fd, bar, sink = 0.1 }) {
  const { CrossSection } = wasm;
  const at = (pts) => pts.map(([a, b]) => [u + a, z0 + b]);
  const poly = (pts) => own(new CrossSection([at(pts)], 'Positive'));
  const rect = (a0, b0, a1, b1) => poly([[a0, b0], [a1, b0], [a1, b1], [a0, b1]]);
  const w = o.width,
    h = o.height;
  const shape = poly(outlineOf(o));
  const out = { hole: shape, frame: null, relief: [], leaf: null };
  const kf = o.frame ? k : 0;
  if (o.frame) {
    // A band round it, open at the foot of a door; bars between a window's panes, within it.
    let band = own(own(shape.offset(k, o.shape === 'square' ? 'Miter' : 'Round', 2, 64)).subtract(shape));
    if (o.type === 'door') band = own(band.intersect(rect(-w, 0, w, h + 2 * k + 1)));
    const bars = [];
    if (o.type === 'window') {
      for (let j = 1; j < o.across; j++) {
        const a = -w / 2 + (j * w) / o.across;
        bars.push(rect(a - bar / 2, -0.01, a + bar / 2, h + 0.01));
      }
      for (let j = 1; j < o.up; j++) {
        const b = (j * h) / o.up;
        bars.push(rect(-w / 2 - 0.01, b - bar / 2, w / 2 + 0.01, b + bar / 2));
      }
    }
    if (bars.length) band = own(band.add(own(own(CrossSection.union(bars)).intersect(own(shape.offset(0.01, 'Miter', 2, 64))))));
    out.frame = { section: band, from: 0, to: fd };
  }
  const B = TRIM.beyond;
  // A sill ledge under a window, out beyond it each side.
  if (o.ledge) out.relief.push({ section: rect(-w / 2 - kf - B, -kf - TRIM.ledge, w / 2 + kf + B, -kf), from: -sink, to: TRIM.out });
  // A lintel: a block over a square opening; over an arch, a ring of stones round it.
  if (o.lintel) {
    if (o.shape === 'square') out.relief.push({ section: rect(-w / 2 - kf - B, h + kf, w / 2 + kf + B, h + kf + TRIM.lintel), from: -sink, to: TRIM.out });
    else {
      const spring = o.shape === 'round' ? h / 2 : h - riseOf(o.shape, w);
      const ring = own(own(own(shape.offset(kf + TRIM.lintel, 'Round', 2, 64)).subtract(own(shape.offset(kf, 'Round', 2, 64)))).intersect(rect(-w, spring, w, h + w)));
      out.relief.push({ section: ring, from: -sink, to: TRIM.out });
    }
  }
  // Shutters: a louvred panel each side, half as wide as the window, as high, standing out.
  if (o.shutters) {
    const g = TRIM.gap,
      sw = w / 2;
    for (const side of [-1, 1]) {
      const a0 = side < 0 ? -w / 2 - kf - g - sw : w / 2 + kf + g,
        a1 = a0 + sw;
      const panel = rect(a0, 0, a1, h);
      const slats = [];
      for (let b = TRIM.border; b + TRIM.slatGroove <= h - TRIM.border; b += TRIM.slat) slats.push(rect(a0 + 1, b, a1 - 1, b + TRIM.slatGroove));
      out.relief.push({ section: panel, from: -sink, to: TRIM.shutter });
      if (slats.length) out.relief.push({ section: own(CrossSection.union(slats)), from: TRIM.shutter - TRIM.slatDeep, to: TRIM.shutter + 0.01, cut: true });
    }
  }
  // A door's leaf: in the back of the doorway, as thick as TRIM.leaf, its back on the inside face of the wall.
  if (o.type === 'door' && o.leaf !== 'open') {
    const leaf = { section: shape, from: -t, to: -t + TRIM.leaf, cuts: [] };
    const inset = TRIM.border;
    if (o.leaf === 'panels') {
      // Four panels, two by two, each a shallow recess.
      const spring = h - riseOf(o.shape, w);
      const pw = (w - 3 * inset) / 2,
        ph = (Math.min(spring, h) - 3 * inset) / 2;
      if (pw > 2 && ph > 2) for (const i of [0, 1]) for (const j of [0, 1]) leaf.cuts.push(rect(-w / 2 + inset + i * (pw + inset), inset + j * (ph + inset), -w / 2 + inset + i * (pw + inset) + pw, inset + j * (ph + inset) + ph));
    }
    if (o.leaf === 'planks') for (let a = -w / 2 + TRIM.plank; a < w / 2 - 1; a += TRIM.plank) leaf.cuts.push(rect(a - TRIM.groove / 2, -0.01, a + TRIM.groove / 2, h + 0.01));
    if (o.leaf === 'glazed') {
      // Glazed above the middle rail, a panel below it.
      leaf.glass = own(rect(-w / 2 + inset, h / 2, w / 2 - inset, h + 1).intersect(own(shape.offset(-inset, 'Round', 2, 64))));
      leaf.cuts.push(rect(-w / 2 + inset, inset, w / 2 - inset, h / 2 - inset));
    }
    leaf.cuts = leaf.cuts.map((c) => own(c.intersect(shape)));
    out.leaf = leaf;
  }
  return out;
}
