// Textures for a building: joints cut into the outside face of its walls
// (bricks, concrete blocks, cracked concrete, corrugated metal, wooden
// planks or boards) and into the top of a sloped roof (tiles, corrugated
// sheet, wooden shingles). Planks and shingles also slope a little from
// row to row, so the lower edge of each stands proud of the one below it,
// as wood laid in overlapping rows does. The faces print up,
// so the joints come out crisp. Sizes are as drawn for 1:32 toy proportions
// and can be scaled; the joint keeps its own width and depth.

export const WALL_TEXTURES = Object.freeze([
  ['plain', 'Plain'],
  ['brick', 'Bricks'],
  ['block', 'Concrete blocks'],
  ['crack', 'Cracked concrete'],
  ['metal', 'Corrugated metal'],
  ['planks', 'Wooden planks'],
  ['boards', 'Upright boards'],
  ['stone', 'Stone'],
  ['timber', 'Half-timbered'],
]);
export const ROOF_TEXTURES = Object.freeze([
  ['plain', 'Plain'],
  ['tile', 'Tiles'],
  ['metal', 'Corrugated'],
  ['shingle', 'Wooden shingles'],
  ['seam', 'Standing seams'],
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
  planks: { course: 4, length: [28, 64] }, // a plank shows 4 mm; its ends are 28 to 64 mm apart
  boards: { width: 6 },
  stone: { course: [4, 6, 8], length: [7, 15] }, // rows of these heights, stones of these lengths
  timber: { bay: 16, beam: 2.4, rail: 22 }, // posts this far apart, beams this wide, a rail this far up from each
  shingle: { course: 5, length: [4, 8] },
  seam: { pitch: 14, ridge: 1.4 }, // sheets between raised seams running down the roof
};
// Rows of wood that overlap, each sloping from its lower edge to its top.
export const LAPPED = Object.freeze(['planks', 'shingle']);
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
  } else if (kind === 'planks' || kind === 'shingle') {
    // The ends of each plank or shingle, at random lengths, row by row; the
    // rows themselves are the steps of lappedRows.
    const { course, length: [lo, hi] } = DRAWN[kind];
    const c = course * k;
    for (let row = Math.floor((y0 - yOrigin) / c); yOrigin + row * c < y1; row++) {
      const yb = yOrigin + row * c;
      const random = seeded(seed * 7919 + row * 104729 + 17);
      for (let x = x0 - random() * hi * k; x < x1; x += (lo + random() * (hi - lo)) * k)
        if (x > x0) out.push(rect(x - w / 2, Math.max(yb, y0), x + w / 2, Math.min(yb + c, y1)));
    }
  } else if (kind === 'seam') {
    // The sheets cut down between the seams, so each seam stands proud.
    const { pitch, ridge } = DRAWN.seam;
    const p = pitch * k,
      r = ridge * k;
    for (let x = Math.floor(x0 / p) * p; x < x1; x += p) out.push(rect(x + r / 2, y0 - 1, x + p - r / 2, y1 + 1));
  } else if (kind === 'boards') {
    const bw = DRAWN.boards.width * k;
    for (let x = Math.floor(x0 / bw) * bw; x < x1; x += bw) if (x > x0) out.push(rect(x - w / 2, y0 - 1, x + w / 2, y1 + 1));
  } else if (kind === 'stone') {
    // Coursed stone: rows of differing heights, the stones in each of differing lengths, the joints staggered.
    const { course, length: [lo, hi] } = DRAWN.stone;
    let yb = yOrigin,
      row = 0;
    while (yb < y1) {
      const random = seeded(seed * 6151 + row * 92821 + 3);
      const c = course[Math.floor(random() * course.length)] * k;
      if (yb + c > y0) {
        if (yb > y0) out.push(rect(x0 - 1, yb - w / 2, x1 + 1, yb + w / 2));
        for (let x = x0 - random() * hi * k; x < x1; x += (lo + random() * (hi - lo)) * k)
          if (x > x0) out.push(rect(x - w / 2, Math.max(yb, y0), x + w / 2, Math.min(yb + c, y1)));
      }
      yb += c;
      row++;
    }
  } else if (kind === 'timber') {
    // Half-timbering: the panels between the posts and rails sunk, the timbers standing proud;
    // in every other panel a brace from corner to corner stays proud too.
    const { bay, beam, rail } = DRAWN.timber;
    const p = bay * k,
      bw = beam * k,
      r = rail * k;
    const rows = [];
    for (let yb = yOrigin; yb < y1; yb += r) rows.push([yb + bw / 2, Math.min(yb + r, y1) - bw / 2]);
    let col = 0;
    for (let x = Math.floor(x0 / p) * p; x < x1; x += p, col++) {
      const a0 = x + bw / 2,
        a1 = x + p - bw / 2;
      rows.forEach(([b0, b1], j) => {
        if (b1 - b0 < 2 * bw || a1 - a0 < 2 * bw) return;
        if ((col + j) % 2) {
          out.push(rect(a0, b0, a1, b1));
          return;
        }
        // Two triangles, one each side of the brace.
        const d = bw * Math.hypot(a1 - a0, b1 - b0) / Math.min(a1 - a0, b1 - b0) / 2;
        out.push([[a0 + d, b0], [a1, b0], [a1, b1 - d]], [[a0, b0 + d], [a1 - d, b1], [a0, b1]]);
      });
    }
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

/**
 * The grain of wood: a few long, fine lines along each plank, board or
 * shingle, a third as wide as a joint. Cut a third as deep.
 */
export function grainPolygons(kind, [x0, x1], [y0, y1], { textureScale, textureJoint: w }, seed = 1) {
  if (!['planks', 'boards', 'shingle'].includes(kind)) return [];
  const k = textureScale / 100,
    random = seeded(seed * 31 + 5),
    out = [];
  const across = kind === 'boards';
  const area = (x1 - x0) * (y1 - y0);
  // A few long, fine lines: grain, not scratches.
  const count = Math.min(1500, Math.round(area / (260 * k * k)));
  for (let i = 0; i < count; i++) {
    const x = x0 + random() * (x1 - x0),
      y = y0 + random() * (y1 - y0),
      len = (8 + random() * 14) * k;
    out.push(across ? band([x, y], [x + (random() - 0.5) * 0.3, y + len], w / 3) : band([x, y], [x + len, y + (random() - 0.5) * 0.3], w / 3));
  }
  return out;
}

/**
 * The rows of overlapping wood, as cross sections across them (v up the
 * face from yOrigin, w into it, the face at w = 1): each row cut from
 * nothing at its lower edge to the depth set at its top, so the next row
 * stands proud of it.
 */
export function lappedRows(kind, [y0, y1], { textureScale, textureDepth: d }, yOrigin = y0) {
  const c = DRAWN[kind].course * (textureScale / 100);
  const out = [];
  for (let row = Math.floor((y0 - yOrigin) / c); yOrigin + row * c < y1; row++) {
    const yb = yOrigin + row * c;
    out.push([
      [yb, 0],
      [yb + c, 0],
      [yb + c, 1 + d],
      [yb, 1],
    ]);
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
export function wallJoints(wasm, own, wall, { W, D, length, bottom, top: zTop, frame = null, ceil = zTop + 1 }, keepOut, settings, kind) {
  const seed = wallSeed(wall);
  const polys = jointPolygons(kind, [0, length], [bottom, zTop], settings, seed);
  if (!polys.length) return null;
  // The mitred end of a wall thins to nothing at its outside edge: a joint
  // near it would cut a sliver loose. Joints keep away from the ends; only
  // the rows of bricks or blocks run on to the corner, to meet the next wall.
  const end = settings.textureDepth + 0.5;
  let section = own(new wasm.CrossSection(polys, 'Positive'));
  section = own(section.intersect(own(new wasm.CrossSection([rect(end, bottom + 0.3, length - end, ceil)], 'Positive'))));
  if (kind === 'brick' || kind === 'block') {
    const rows = courseJoints(kind, [0, length], [bottom, zTop], settings);
    if (rows.length)
      section = own(section.add(own(own(new wasm.CrossSection(rows, 'Positive')).intersect(
        own(new wasm.CrossSection([rect(-1, bottom + 0.3, length + 1, ceil)], 'Positive')),
      ))));
  }
  // Each kept clear: a rectangle [u0, z0, u1, z1], or an outline { poly, grow } (an arch and its frame).
  const clearOf = (e) =>
    Array.isArray(e)
      ? own(new wasm.CrossSection([rect(e[0] - CLEAR, e[1] - CLEAR, e[2] + CLEAR, e[3] + CLEAR)], 'Positive'))
      : own(own(new wasm.CrossSection([e.poly], 'Positive')).offset(CLEAR + (e.grow ?? 0), 'Round', 2, 64));
  const clear = keepOut.length ? own(wasm.CrossSection.union(keepOut.map(clearOf))) : null;
  if (clear) section = own(section.subtract(clear));
  // A wall of a rectangular storey, or any straight wall: its start, its
  // direction along it and inward, and the face 1 mm outside it.
  const { U, N, O } = frame
    ? { U: [frame.dir[0], frame.dir[1], 0], N: [frame.inward[0], frame.inward[1], 0], O: [frame.a[0] - frame.inward[0], frame.a[1] - frame.inward[1], 0] }
    : { ...DIRS[wall], O: DIRS[wall].origin(W, D) };
  const place = (solid) => own(solid.transform(matrix(U, [0, 0, 1], N, O)));
  const cuts = [];
  if (!section.isEmpty()) cuts.push(place(own(section.extrude(settings.textureDepth + 1))));
  // The grain, a third as deep, clear of the ends and the openings like the joints.
  const grain = grainPolygons(kind, [0, length], [bottom, zTop], settings, seed);
  if (grain.length) {
    let g = own(own(new wasm.CrossSection(grain, 'NonZero')).intersect(own(new wasm.CrossSection([rect(end, bottom + 0.3, length - end, ceil)], 'Positive'))));
    if (clear) g = own(g.subtract(clear));
    if (!g.isEmpty()) cuts.push(place(own(g.extrude(1 + settings.textureDepth / 3))));
  }
  // Planks: each row slopes into the wall, the rows running on round the corner.
  if (LAPPED.includes(kind)) {
    const rows = lappedRows(kind, [bottom, ceil], settings, bottom);
    // Across the rows (v, w), run along the wall (u): turned into the wall's frame.
    const run = own(own(own(new wasm.CrossSection(rows, 'Positive')).extrude(length + 2)).translate([0, 0, -1]));
    const across = own(run.transform(matrix([0, 0, 1], N, U, O)));
    let allowed = own(new wasm.CrossSection([rect(-1, bottom + 0.3, length + 1, ceil)], 'Positive'));
    if (clear) allowed = own(allowed.subtract(clear));
    const within = place(own(allowed.extrude(settings.textureDepth + 1)));
    cuts.push(own(across.intersect(within)));
  }
  if (!cuts.length) return null;
  return cuts.length > 1 ? own(wasm.Manifold.union(cuts)) : cuts[0];
}
const WALLS_SEED = { front: 11, back: 23, left: 37, right: 53 };
// Any other wall (a section's, a footprint edge): a seed from its name, the same every time.
const wallSeed = (wall) => WALLS_SEED[wall] ?? [...String(wall)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

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
  const alongR = [Math.min(...along) - 2, Math.max(...along) + 2],
    upR = [Math.min(...up) - 2, Math.max(...up) + 2];
  const cuts = [];
  if (polys.length) cuts.push(own(own(own(new wasm.CrossSection(polys, 'Positive')).extrude(settings.textureDepth + 1)).transform(matrix(A, S, Nin, O))));
  const grain = grainPolygons(kind === 'shingle' ? 'boards' : kind, alongR, upR, settings, 3);
  if (grain.length) cuts.push(own(own(own(new wasm.CrossSection(grain, 'NonZero')).extrude(1 + settings.textureDepth / 3)).transform(matrix(A, S, Nin, O))));
  // Shingles: each row slopes into the roof from its lower edge, so the row
  // above lies proud of it, its lower edge facing down the slope.
  if (LAPPED.includes(kind)) {
    const rows = lappedRows(kind, upR, settings, 0);
    const run = own(own(own(new wasm.CrossSection(rows, 'Positive')).extrude(alongR[1] - alongR[0])).translate([0, 0, alongR[0]]));
    cuts.push(own(run.transform(matrix(S, Nin, A, O))));
  }
  if (!cuts.length) return null;
  return cuts.length > 1 ? own(wasm.Manifold.union(cuts)) : cuts[0];
}

/**
 * A wall finish: the storey's texture, a different one on any wall, and a
 * band of another texture along the foot of the walls (brick below, boards
 * above). Shared by ordinary storeys, connected sections and shaped
 * footprints; walls are named by their own ids.
 */
export const FINISH_DEFAULTS = Object.freeze({ wallTexture: 'plain', wallTextures: Object.freeze({}), lowerTexture: 'none', lowerHeight: 20 });
export const LOWER = Object.freeze({ least: 8, above: 8 }); // the band's height, and wall kept above it
/** The texture of one wall. */
export const textureOf = (s, wall) => s.wallTextures?.[wall] ?? s.wallTexture;
/** Whether any wall of it has joints cut. */
export const isTextured = (s) => [s.wallTexture, ...Object.values(s.wallTextures ?? {}), s.lowerTexture ?? 'none'].some((t) => t !== 'plain' && t !== 'none');
/** Where the upper texture's rows begin, above the band. */
export const bandTop = (s, floor) => floor + ((s.lowerTexture ?? 'none') === 'none' ? 0 : s.lowerHeight);
const isTexture = (t) => WALL_TEXTURES.some(([id]) => id === t);
/** Checks a finish; walls are the ids its walls go by. Returns it with only the walls it has. */
export function checkFinish(s, walls, height, where = '') {
  if (!isTexture(s.wallTexture)) throw Error('Choose a wall texture from the list' + where + '.');
  const per = s.wallTextures ?? {};
  if (!per || typeof per !== 'object' || Array.isArray(per)) throw Error('Choose a texture for each wall' + where + ' from the list.');
  const own = {};
  for (const [w, t] of Object.entries(per)) {
    if (!isTexture(t)) throw Error('Choose a texture for the ' + w + ' wall' + where + ' from the list.');
    // A wall that is gone (a shape with fewer sides) keeps no texture of its own.
    if (walls.includes(w) && t !== s.wallTexture) own[w] = t;
  }
  const lower = s.lowerTexture ?? 'none';
  if (lower !== 'none' && !isTexture(lower)) throw Error('Choose a texture for the lower walls' + where + ' from the list.');
  const h = s.lowerHeight ?? FINISH_DEFAULTS.lowerHeight;
  if (lower !== 'none' && (!Number.isFinite(h) || h < LOWER.least || h > height - LOWER.above))
    throw Error('The lower walls' + where + ' reach ' + LOWER.least + ' to ' + Math.max(LOWER.least, height - LOWER.above) + ' mm up.');
  return { wallTexture: s.wallTexture, wallTextures: own, lowerTexture: lower, lowerHeight: h };
}
/**
 * The joints of one wall with its finish, as one solid to cut, or null.
 * Between the band and the texture above it a strip 0.6 mm high stays smooth.
 */
export function finishJoints(wasm, own, wall, geom, keepOut, settings, s) {
  const main = textureOf(s, wall),
    lower = s.lowerTexture ?? 'none',
    cuts = [];
  const add = (g, kind) => {
    if (kind === 'plain' || kind === 'none') return;
    const j = wallJoints(wasm, own, wall, g, keepOut, settings, kind);
    if (j) cuts.push(j);
  };
  if (lower === 'none') add(geom, main);
  else {
    const split = geom.bottom + s.lowerHeight;
    add({ ...geom, top: split, ceil: split - 0.3 }, lower);
    add({ ...geom, bottom: split }, main);
  }
  if (!cuts.length) return null;
  return cuts.length > 1 ? own(wasm.Manifold.union(cuts)) : cuts[0];
}
