// Textures for a building: joints cut into the outside face of its walls
// (bricks, concrete blocks, cracked concrete, corrugated metal) and into
// the top of a sloped roof (tiles, corrugated sheet). The faces print up,
// so the joints come out crisp. Sizes are as drawn for 1:32 toy proportions
// and can be scaled; the joint keeps its own width and depth.

export const WALL_TEXTURES = Object.freeze([
  ['plain', 'Plain'],
  ['brick', 'Bricks'],
  ['block', 'Concrete blocks'],
  ['crack', 'Cracked concrete'],
  ['metal', 'Corrugated metal'],
]);
export const ROOF_TEXTURES = Object.freeze([
  ['plain', 'Plain'],
  ['tile', 'Tiles'],
  ['metal', 'Corrugated'],
]);
export const TEXTURE_DEFAULTS = Object.freeze({
  wallTexture: 'plain',
  roofTexture: 'plain',
  textureScale: 100, // % of the drawn size
  textureJoint: 0.6, // mm wide
  textureDepth: 0.5, // mm deep
});
export const TEXTURE_LIMITS = Object.freeze({
  textureScale: [50, 200],
  textureJoint: [0.4, 1.5],
  textureDepth: [0.3, 1],
});
// The drawn sizes, in mm at 100 %.
export const DRAWN = {
  brick: { course: 3.4, length: 8 },
  block: { course: 8, length: 16 },
  metal: { pitch: 4 },
  tile: { course: 6, length: 8 },
  crack: { cell: [40, 30] },
};
const CLEAR = 1; // joints keep this far from an opening and from a frame

// Rectangles as polygons, in the 2D frame of a face.
const rect = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
// A thin band along a segment, as a polygon.
function band([x0, y0], [x1, y1], w) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / len) * (w / 2),
    ny = ((x1 - x0) / len) * (w / 2);
  return [
    [x0 + nx, y0 + ny],
    [x0 - nx, y0 - ny],
    [x1 - nx, y1 - ny],
    [x1 + nx, y1 + ny],
  ];
}
// A small, repeatable random number source: the same building cracks the same way.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The joints of a pattern over a region of a face, as polygons in the
 * face's 2D frame (x along, y up the face). Rows of bricks, blocks or tiles
 * start at yOrigin (the floor of a wall, the eave of a roof), whatever part
 * of the face is drawn.
 */
export function jointPolygons(kind, [x0, x1], [y0, y1], { textureScale, textureJoint: w }, seed = 1, yOrigin = y0) {
  const k = textureScale / 100;
  const out = [];
  if (kind === 'brick' || kind === 'block' || kind === 'tile') {
    const { course, length } = DRAWN[kind];
    const c = course * k,
      b = length * k;
    for (let row = Math.floor((y0 - yOrigin) / c); yOrigin + row * c < y1; row++) {
      const yb = yOrigin + row * c;
      if (yb > y0) out.push(rect(x0 - 1, yb - w / 2, x1 + 1, yb + w / 2));
      const shift = (((row % 2) + 2) % 2) * (b / 2);
      for (let x = Math.floor((x0 - shift) / b) * b + shift; x < x1 + b; x += b)
        if (x > x0 && x < x1) out.push(rect(x - w / 2, Math.max(yb, y0), x + w / 2, Math.min(yb + c, y1)));
    }
  } else if (kind === 'metal') {
    const p = DRAWN.metal.pitch * k,
      gw = Math.min(p / 2, w * 1.6);
    for (let x = Math.floor(x0 / p) * p + p / 2; x < x1; x += p) out.push(rect(x - gw / 2, y0 - 1, x + gw / 2, y1 + 1));
  } else if (kind === 'crack') {
    const [cw, ch] = DRAWN.crack.cell.map((v) => v * k);
    const random = seeded(seed);
    for (let cx = Math.floor(x0 / cw) * cw; cx < x1; cx += cw)
      for (let cy = y0; cy < y1; cy += ch) {
        if (random() < 0.35) continue;
        let p = [cx + random() * cw, cy + random() * ch];
        let angle = random() * Math.PI * 2;
        const steps = 4 + Math.floor(random() * 4);
        for (let s = 0; s < steps; s++) {
          angle += (random() - 0.5) * 1.4;
          const len = (2.5 + random() * 4.5) * k;
          const q = [p[0] + Math.cos(angle) * len, p[1] + Math.sin(angle) * len];
          out.push(band(p, q, w));
          p = q;
        }
      }
  }
  return out;
}

/** Only the joints between the rows of bricks or blocks, from the floor up. */
export function courseJoints(kind, [x0, x1], [y0, y1], { textureScale, textureJoint: w }) {
  const c = DRAWN[kind].course * (textureScale / 100);
  const out = [];
  for (let yb = y0 + c; yb < y1; yb += c) out.push(rect(x0 - 1, yb - w / 2, x1 + 1, yb + w / 2));
  return out;
}

const DIRS = {
  front: { U: [1, 0, 0], N: [0, 1, 0], origin: (W, D) => [0, -1, 0] },
  back: { U: [-1, 0, 0], N: [0, -1, 0], origin: (W, D) => [W, D + 1, 0] },
  left: { U: [0, -1, 0], N: [1, 0, 0], origin: (W, D) => [-1, D, 0] },
  right: { U: [0, 1, 0], N: [-1, 0, 0], origin: (W, D) => [W + 1, 0, 0] },
};
const matrix = (X, Y, Z, O) => [...X, 0, ...Y, 0, ...Z, 0, ...O, 1];

/**
 * The joints of a wall as a solid to cut from it: from just outside its
 * face to the depth set, kept clear of the openings in it (keepOut, as
 * rectangles [u0, z0, u1, z1] in the wall's frame) and of the part of the
 * wall that stands in the groove of the base.
 */
export function wallJoints(wasm, own, wall, { W, D, length, bottom, top: zTop }, keepOut, settings, kind) {
  const polys = jointPolygons(kind, [0, length], [bottom, zTop], settings, WALLS_SEED[wall]);
  if (!polys.length) return null;
  // The mitred end of a wall thins to nothing at its outside edge: a joint
  // near it would cut a sliver loose. Joints keep away from the ends; only
  // the rows of bricks or blocks run on to the corner, to meet the next wall.
  const end = settings.textureDepth + 0.5;
  let section = own(new wasm.CrossSection(polys, 'Positive'));
  section = own(section.intersect(own(new wasm.CrossSection([rect(end, bottom + 0.3, length - end, zTop + 1)], 'Positive'))));
  if (kind === 'brick' || kind === 'block') {
    const rows = courseJoints(kind, [0, length], [bottom, zTop], settings);
    if (rows.length)
      section = own(section.add(own(own(new wasm.CrossSection(rows, 'Positive')).intersect(
        own(new wasm.CrossSection([rect(-1, bottom + 0.3, length + 1, zTop + 1)], 'Positive')),
      ))));
  }
  if (keepOut.length)
    section = own(section.subtract(own(new wasm.CrossSection(keepOut.map(([a, b, c, d]) => rect(a - CLEAR, b - CLEAR, c + CLEAR, d + CLEAR)), 'Positive'))));
  if (section.isEmpty()) return null;
  const { U, N, origin } = DIRS[wall];
  const solid = own(section.extrude(settings.textureDepth + 1));
  return own(solid.transform(matrix(U, [0, 0, 1], N, origin(W, D))));
}
const WALLS_SEED = { front: 11, back: 23, left: 37, right: 53 };

/**
 * The joints of a sloped roof panel, cut into its top: the panel rises
 * along dir at slope t, its top face lies on z = topAt(x, y). The pattern
 * starts at the eave line (x0, y0) and runs up the slope.
 */
export function roofJoints(wasm, own, panel, { dir: [dx, dy], t, eave: [ex, ey], topAt, bounds }, settings, kind) {
  const cos = 1 / Math.hypot(1, t);
  const S = [dx * cos, dy * cos, t * cos],
    A = [-dy, dx, 0],
    Nin = [dx * t * cos, dy * t * cos, -cos];
  const O = [ex - Nin[0], ey - Nin[1], topAt(ex, ey) - Nin[2]];
  // The panel's corners in the pattern's frame, to know how far to draw it.
  const along = [],
    up = [];
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const d = [x - O[0], y - O[1], z - O[2]];
        along.push(d[0] * A[0] + d[1] * A[1] + d[2] * A[2]);
        up.push(d[0] * S[0] + d[1] * S[1] + d[2] * S[2]);
      }
  // Corrugations run down the slope, tiles across it.
  const polys = jointPolygons(
    kind,
    [Math.min(...along) - 2, Math.max(...along) + 2],
    [Math.min(...up) - 2, Math.max(...up) + 2],
    settings,
    1,
    0,
  );
  if (!polys.length) return null;
  const section = own(new wasm.CrossSection(polys, 'Positive'));
  const solid = own(section.extrude(settings.textureDepth + 1));
  return own(solid.transform(matrix(A, S, Nin, O)));
}
