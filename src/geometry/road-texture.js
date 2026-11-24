// Road surface textures: a repeatable tile of stones laid over the road, with
// the joints between the stones cut into the surface.
//
// The tile is laid in road coordinates: along the centre line and across the
// road. So it bends with a corner, and every copy of a piece is the same
// print. The stones keep their drawn shape; the joint has a width of its own,
// because a joint scaled down with small stones would be too thin to print.
import cobbles from '../textures/cobbles.js';

export const ROAD_TEXTURES = Object.freeze({ [cobbles.id]: cobbles });
export const TEXTURE_CHOICES = Object.freeze([
  ['none', 'None'],
  ...Object.values(ROAD_TEXTURES).map((texture) => [texture.id, texture.name]),
]);
// Stone sizes: as drawn, for a model scale, or a percentage of your own.
export const TEXTURE_SIZES = Object.freeze([
  ['full', 'As drawn'],
  ['24', 'Scale 1:24'],
  ['32', 'Scale 1:32'],
  ['43', 'Scale 1:43'],
  ['64', 'Scale 1:64'],
  ['custom', 'Custom'],
]);
export const TEXTURE_FITS = Object.freeze([
  ['fixed', 'Same size everywhere'],
  ['piece', 'Fit to each piece'],
]);
export const TEXTURE_DEFAULTS = Object.freeze({
  roadTexture: 'none',
  textureSize: '32',
  textureScale: 100,
  textureJoint: 0.6,
  textureDepth: 0.5,
  textureFit: 'fixed',
});
export const TEXTURE_KEYS = Object.freeze(Object.keys(TEXTURE_DEFAULTS));
export const TEXTURE_LIMITS = Object.freeze({
  textureScale: [5, 500],
  textureJoint: [0.3, 5],
  textureDepth: [0.1, 3],
});
// Material left under a joint, and road left between a joint and a slot or braid.
const ROOF = 0.2,
  SLOT_MARGIN = 0.8,
  PAINT_MARGIN = 0.3;

export function textureSettings(p) {
  return Object.fromEntries(TEXTURE_KEYS.map((key) => [key, p[key] ?? TEXTURE_DEFAULTS[key]]));
}
export const hasRoadTexture = (p) => (p.roadTexture ?? 'none') !== 'none';

/** How large the stones are, as a factor of the drawn tile. */
export function textureScale(p) {
  const s = textureSettings(p),
    texture = ROAD_TEXTURES[s.roadTexture];
  if (s.textureSize === 'full') return 1;
  if (s.textureSize === 'custom') return s.textureScale / 100;
  return texture.real / Number(s.textureSize) / texture.stone;
}
/** The size of a stone on the road, in mm, for the hints. */
export function textureStoneSize(p) {
  return ROAD_TEXTURES[textureSettings(p).roadTexture].stone * textureScale(p);
}

const fmt = (value) => String(Number(value.toFixed(2)));

export function validateRoadTexture(p) {
  const s = textureSettings(p);
  if (s.roadTexture === 'none') return;
  if (!ROAD_TEXTURES[s.roadTexture]) throw Error('Choose a road surface texture from the list.');
  if (!TEXTURE_SIZES.some(([id]) => id === s.textureSize))
    throw Error('Choose a stone size for the road surface texture.');
  if (!TEXTURE_FITS.some(([id]) => id === s.textureFit))
    throw Error('Choose Same size everywhere or Fit to each piece for the road surface texture.');
  for (const [key, name, unit] of [
    ['textureScale', 'The texture size', ' %'],
    ['textureJoint', 'The joint width', ' mm'],
    ['textureDepth', 'The joint depth', ' mm'],
  ]) {
    const [low, high] = TEXTURE_LIMITS[key];
    if (key === 'textureScale' && s.textureSize !== 'custom') continue;
    if (!Number.isFinite(s[key]) || s[key] < low || s[key] > high)
      throw Error(name + ' must be between ' + low + ' and ' + high + unit + '.');
  }
  if (p.special || p.kind === 'import')
    throw Error('A road surface texture is for plain straights and corners. Set Road surface texture to None for this piece.');
  const stone = textureStoneSize(p);
  if (s.textureJoint > 0.45 * stone)
    throw Error(
      'The stones are ' + fmt(stone) + ' mm across at this size, too small for a ' + fmt(s.textureJoint) +
        ' mm joint. Use a joint of at most ' + fmt(Math.floor(45 * stone) / 100) + ' mm, or larger stones.',
    );
  const room = (p.hollow ? p.deck : p.height) - ROOF;
  if (s.textureDepth > room + 1e-9)
    throw Error(
      'A joint ' + fmt(s.textureDepth) + ' mm deep leaves less than ' + ROOF + ' mm of road under it. Set the joint depth to ' +
        fmt(Math.floor(room * 100) / 100) + ' mm or less' + (p.hollow ? ', or use a thicker deck.' : '.'),
    );
}

/**
 * How the tile is laid along a road of this length: how many times it
 * repeats, and how long one repeat is. Fitted, a whole number of repeats
 * takes up the length, so the joints line up from piece to piece.
 */
export function textureRepeat(p, length) {
  const texture = ROAD_TEXTURES[textureSettings(p).roadTexture];
  const period = texture.size * textureScale(p);
  if (textureSettings(p).textureFit !== 'piece') return { period, along: period, stretch: 1 };
  const count = Math.max(1, Math.round(length / period));
  return { period, along: length / count, stretch: length / count / period, count };
}

/**
 * The stones over a whole road, as one cross-section in the frame of the
 * piece. path.point(t, v) places a point at t along the centre line and v
 * across; length is the length of that centre line and width the road width.
 */
export function roadStones(work, p, path, length, width) {
  const s = textureSettings(p),
    texture = ROAD_TEXTURES[s.roadTexture];
  const scale = textureScale(p),
    { period, along, stretch } = textureRepeat(p, length);
  const half = width / 2,
    reach = texture.stone * scale * 2;
  const loops = [];
  const first = -1,
    last = Math.ceil(length / along);
  const rows = Math.ceil((half + reach) / period);
  for (const stone of texture.stones) {
    // The stone in tile coordinates, scaled; its box decides where it is needed.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < stone.length; k += 2) {
      x0 = Math.min(x0, stone[k]); x1 = Math.max(x1, stone[k]);
      y0 = Math.min(y0, stone[k + 1]); y1 = Math.max(y1, stone[k + 1]);
    }
    for (let i = first; i <= last; i++) {
      const u0 = (i * texture.size + x0) * scale * stretch,
        u1 = (i * texture.size + x1) * scale * stretch;
      if (u1 < -0.5 || u0 > length + 0.5) continue;
      for (let j = -rows; j < rows; j++) {
        const v0 = (j * texture.size + y0) * scale,
          v1 = (j * texture.size + y1) * scale;
        if (v1 < -half - 0.5 || v0 > half + 0.5) continue;
        const loop = [];
        for (let k = 0; k < stone.length; k += 2) {
          const u = (i * texture.size + stone[k]) * scale * stretch,
            v = (j * texture.size + stone[k + 1]) * scale;
          loop.push(path.point(u / length, v));
        }
        // Laid on the road a stone may come out mirrored: wind it one way.
        let area = 0;
        for (let k = 0; k < loop.length; k++) {
          const a = loop[k], b = loop[(k + 1) % loop.length];
          area += a[0] * b[1] - b[0] * a[1];
        }
        loops.push(area < 0 ? loop.reverse() : loop);
      }
    }
  }
  if (!loops.length) return null;
  const drawn = work.own(new work.wasm.CrossSection(loops, 'Positive'));
  // The stones are drawn a joint apart at their own scale. Grow or shrink
  // them so that the joint between two stones is the width that was set.
  const grow = (texture.joint * scale - s.textureJoint) / 2;
  return Math.abs(grow) < 1e-6 ? drawn : work.own(drawn.offset(grow, 'Miter', 2));
}

/**
 * Cut the joints of a texture into one finished part. Joints keep clear of
 * the guide slots and braid, of painted lines and their grooves, and of
 * everything that lies under the surface: over a connector pocket the road
 * stays plain rather than being cut through.
 */
export function cutRoadTexture(work, part, result, p) {
  if (!part.textureStones) return;
  const { textureDepth: depth } = textureSettings(p);
  const top = p.height;
  const surface = work.own(result.solid.slice(top - 0.0001));
  // Solid all the way down to the roof under the joint.
  const backed = work.own(result.solid.slice(top - depth - ROOF + 0.0005));
  let open = work.own(work.own(part.section.intersect(surface)).intersect(backed));
  const keep = [];
  if (part.laneKeepout) keep.push(work.own(part.laneKeepout.offset(SLOT_MARGIN, 'Round', 2, 24)));
  for (const { section } of part.paintSections ?? []) keep.push(work.own(section.offset(PAINT_MARGIN, 'Miter', 2)));
  for (const section of part.grooveSections ?? []) keep.push(work.own(section.offset(PAINT_MARGIN, 'Miter', 2)));
  for (const guard of part.drawKeyGuards ?? []) keep.push(work.own(guard.project()));
  if (keep.length) open = work.own(open.subtract(work.own(work.wasm.CrossSection.union(keep))));
  const joints = work.own(open.subtract(part.textureStones));
  if (joints.isEmpty()) return;
  result.solid = work.cut(result.solid, [work.prism(joints, top - depth, top + 1)]);
  result.textureJoints = joints.area();
}
