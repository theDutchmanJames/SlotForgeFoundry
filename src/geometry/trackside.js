import { SolidWorkshop, dot, left, minus, move, unit } from './solids.js';
import { tabPair } from './joints.js';
import { resolveJointFit } from './joint-fit.js';
import { connectorWarning } from './connector-warning.js';

// Trackside accessories stand on the table beside the track and plug into
// sockets in the free edge of a border, or of the road where it has none.
export const TRACKSIDE_SHAPES = Object.freeze([
  ['barrier', 'Concrete barrier'],
  ['board', 'Advertising board'],
  ['rail', 'Single guard rail'],
  ['rail2', 'Double guard rail'],
  ['wrail', 'Single W-beam guard rail'],
  ['wrail2', 'Double W-beam guard rail'],
]);
export const TRACKSIDE_SIDES = Object.freeze(['none', 'inner', 'outer', 'both']);
export const TRACKSIDE_TAB_CHOICES = Object.freeze([
  ['auto', 'Automatic'],
  ['1', 'One tab'],
  ['2', 'Two tabs'],
]);
// The settings of one side. With barriers on both sides the inside can have
// a full set of its own: the same names with Inner behind them.
const SIDE_DEFAULTS = {
  tracksideShape: 'barrier',
  tracksideRise: 20,
  tracksideTabs: 'auto',
  tracksideSegments: 1,
  tracksideEnds: 'none',
  tracksideEndShape: 'ramp',
  tracksideFaceAngle: 17.1,
  // The advertising board: a flat wall for a paper sign, and a catch fence
  // whose posts drop into sockets in its top.
  tracksideThickness: 2,
  tracksideFence: false,
  tracksideFenceHeight: 50,
  tracksidePost: 3,
  tracksideCable: 10,
  tracksideMesh: 5,
  // Guard rails: the height of a single rail, and a post at the start of a row.
  tracksideRailHeight: 10,
  tracksideStartPost: false,
  // The rail's thickness, the post (along the edge, deep, and how far its
  // top stays under the top of the rail), where it stands from the end of a
  // piece, the clearance of a double rail above the road, and the pinch.
  tracksideRailThickness: 1.6,
  tracksidePostWidth: 6,
  tracksidePostDepth: 4,
  tracksidePostDrop: 0,
  tracksidePostInset: 12,
  tracksideRailGround: 1.5,
  tracksidePinch: 0.05,
  // The W-beam: how deep the folded profile is, the wall of its sheet, and
  // how far the hooks of the post reach over its lips.
  tracksideBeamDepth: 2.7,
  tracksideBeamWall: 0.8,
  tracksideHook: 0.4,
};
export const TRACKSIDE_SIDE_KEYS = Object.freeze(Object.keys(SIDE_DEFAULTS));
export const TRACKSIDE_DEFAULTS = Object.freeze({
  tracksideSide: 'none',
  tracksideInnerOwn: false,
  ...SIDE_DEFAULTS,
  ...Object.fromEntries(
    Object.entries(SIDE_DEFAULTS).map(([key, value]) => [key + 'Inner', value]),
  ),
});
export const TRACKSIDE_LIMITS = Object.freeze({
  tracksideRise: [5, 100],
  tracksideSegments: [1, 16],
  tracksideFaceAngle: [0, 45],
  tracksideThickness: [1.2, 15],
  tracksideFenceHeight: [10, 250],
  tracksidePost: [2, 6],
  tracksideCable: [3, 100],
  tracksideMesh: [2, 30],
  tracksideRailHeight: [4, 40],
  tracksideRailThickness: [1, 4],
  tracksidePostWidth: [3, 20],
  tracksidePostDepth: [2, 15],
  tracksidePostDrop: [0, 10],
  tracksidePostInset: [8, 60],
  tracksideRailGround: [0, 30],
  tracksidePinch: [0, 0.3],
  tracksideBeamDepth: [1.5, 8],
  tracksideBeamWall: [0.4, 2],
  tracksideHook: [0.2, 1],
});
// A board end with a rounded top corner, as on the measured board.
export const BOARD_CORNER = 25;
// The fence: how deep its posts sit in the board, the play around a post,
// the wall left on either side of a socket, and its printed strands.
export const FENCE_SOCKET = 10;
export const FENCE_PLAY = 0.15;
export const FENCE_WALL = 1.25;
export const FENCE_SKIN = 0.8;
export const FENCE_STRAND = 0.6;
export const FENCE_RAIL = 1.2;
export const FENCE_CABLE = 1;
// A board shorter than this is too short for two fence posts.
export const FENCE_MIN_LENGTH = 40;

// A board with a fence is at least thick enough for a wall on both sides of a post.
export const boardThickness = (p) =>
  p.tracksideFence
    ? Math.max(p.tracksideThickness, p.tracksidePost + 2 * (FENCE_PLAY + FENCE_WALL))
    : p.tracksideThickness;
// A barrier this long or longer takes two tabs when the count is automatic.
export const TWO_TAB_LENGTH = 150;
export const BARRIER_FOOT = 15;
export const TRACKSIDE_END_CHOICES = Object.freeze([
  ['none', 'Plain ends'],
  ['start', 'Sloped at the start'],
  ['finish', 'Sloped at the finish'],
  ['both', 'Sloped at both ends'],
]);
export const TRACKSIDE_END_SHAPES = Object.freeze([
  ['ramp', 'Sloped'],
  ['round', 'Sloped and rounded'],
]);
// The top of a sloped end runs down over this length, to just above the foot.
export const END_RAMP = 25;
export const END_HEIGHT = 0.5;
// A rounded end narrows towards the track edge to a blunt tip this wide.
export const END_TIP = 1;
// Flat top left behind the rounded corner, whatever the face angle.
const TOP_FLAT = 2;

// The face of the barrier above the road, measured on a barrier that stands
// 20 mm above an 8.3 mm track: [distance from the track edge, height above
// the road]. A small step, the sloped face, then the rounded top corner.
// The face leans 17.1 degrees from upright on that barrier; another angle
// moves the rounded corner in or out with the top of the face.
const BARRIER_STEP = 1.06;
const BARRIER_FACE = [
  [6.8, 18.68],
  [6.9, 18.92],
  [7.02, 19.12],
  [7.2, 19.35],
  [7.39, 19.53],
  [7.6, 19.69],
  [7.83, 19.81],
  [8.07, 19.91],
  [8.33, 19.97],
  [8.62, 20],
];

export const tracksideOn = (p, side) =>
  p.tracksideSide === 'both' || p.tracksideSide === side;
// Whether the inside uses its own settings: only next to an outside barrier.
export const tracksideInnerOwn = (p) =>
  p.tracksideSide === 'both' && p.tracksideInnerOwn === true;
// The piece settings as one side reads them.
export function tracksideFor(p, side) {
  if (side !== 'inner' || !tracksideInnerOwn(p)) return p;
  return {
    ...p,
    ...Object.fromEntries(TRACKSIDE_SIDE_KEYS.map((key) => [key, p[key + 'Inner']])),
  };
}

function validateSide(p) {
  if (!TRACKSIDE_SHAPES.some(([id]) => id === p.tracksideShape))
    throw new Error('Unknown trackside shape.');
  if (!TRACKSIDE_TAB_CHOICES.some(([id]) => id === String(p.tracksideTabs)))
    throw new Error('Choose one tab, two tabs or an automatic count for the barrier.');
  const [min, max] = TRACKSIDE_LIMITS.tracksideRise;
  if (!Number.isFinite(p.tracksideRise) || p.tracksideRise < min || p.tracksideRise > max)
    throw new Error(`The barrier height above the road must be between ${min} and ${max} mm.`);
  if (!TRACKSIDE_END_CHOICES.some(([id]) => id === p.tracksideEnds))
    throw new Error('Unknown barrier end.');
  if (!TRACKSIDE_END_SHAPES.some(([id]) => id === p.tracksideEndShape))
    throw new Error('Unknown barrier end shape.');
  const [upright, flattest] = TRACKSIDE_LIMITS.tracksideFaceAngle;
  if (
    !Number.isFinite(p.tracksideFaceAngle) ||
    p.tracksideFaceAngle < upright ||
    p.tracksideFaceAngle > flattest
  )
    throw new Error(`The barrier face angle must be between ${upright} and ${flattest} degrees.`);
  const widest = maxFaceAngle(p.tracksideRise);
  if (p.tracksideShape === 'barrier' && p.tracksideFaceAngle > widest + 1e-9)
    throw new Error(
      'The barrier face leans too far for its height: the top would be thinner than ' +
        TOP_FLAT + ' mm. Use at most ' + Math.floor(widest * 10) / 10 +
        ' degrees at this height, or lower the barrier.',
    );
  for (const [key, name] of [
    ['tracksideThickness', 'board thickness'],
    ['tracksideFenceHeight', 'fence height'],
    ['tracksidePost', 'fence post size'],
    ['tracksideCable', 'fence cable spacing'],
    ['tracksideMesh', 'fence mesh size'],
    ['tracksideRailThickness', 'guard rail thickness'],
    ['tracksidePostWidth', 'rail post width'],
    ['tracksidePostDepth', 'rail post depth'],
    ['tracksidePostDrop', 'distance of the post below the rail top'],
    ['tracksidePostInset', 'distance of the post from the end'],
    ['tracksideRailGround', 'clearance of a double rail above the road'],
    ['tracksidePinch', 'pinch of the T on the rail'],
    ['tracksideBeamDepth', 'W-beam depth'],
    ['tracksideBeamWall', 'W-beam wall'],
    ['tracksideHook', 'reach of the hooks'],
  ]) {
    const [low, high] = TRACKSIDE_LIMITS[key];
    if (!Number.isFinite(p[key]) || p[key] < low || p[key] > high)
      throw new Error(`The ${name} must be between ${low} and ${high} mm.`);
  }
  if (typeof p.tracksideFence !== 'boolean') throw new Error('Unknown fence setting.');
  if (typeof p.tracksideStartPost !== 'boolean') throw new Error('Unknown start post setting.');
  const [lowest, tallest] = TRACKSIDE_LIMITS.tracksideRailHeight;
  if (!Number.isFinite(p.tracksideRailHeight) || p.tracksideRailHeight < lowest || p.tracksideRailHeight > tallest)
    throw new Error(`The guard rail height must be between ${lowest} and ${tallest} mm.`);
  if (isBeamRail(p.tracksideShape)) {
    const single = p.tracksideShape === 'wrail';
    if (single && p.tracksideRailHeight > p.tracksideRise)
      throw new Error('A single guard rail cannot be taller than its height above the road. Raise the height above the road or lower the rail.');
    if (!single && p.tracksideRise < 2 * lowest + p.tracksideRailGround)
      throw new Error('A double guard rail needs at least ' + (2 * lowest + p.tracksideRailGround) + ' mm above the road for its two rails. Raise the height above the road or lower the clearance.');
    const height = single ? p.tracksideRailHeight : p.tracksideRise - p.tracksideRailGround,
      units = single ? 1 : 2;
    if (p.tracksideBeamDepth < p.tracksideBeamWall * 2)
      throw new Error('The W-beam must be at least twice as deep as its wall is thick.');
    const profile = beamProfile({ height, depth: p.tracksideBeamDepth, wall: p.tracksideBeamWall, units });
    if (p.tracksideHook > profile.lip)
      throw new Error('The hooks reach further than the lip of the rail is wide. Use at most ' + Math.floor(profile.lip * 100) / 100 + ' mm, or a taller rail.');
    if (p.tracksidePostDepth < BEAM.groove + 1.2)
      throw new Error('A post for a W-beam needs to be at least ' + Number((BEAM.groove + 1.2).toFixed(1)) + ' mm deep for the tab of the cover.');
  }
  if (p.tracksideShape === 'rail' && p.tracksideRailHeight > p.tracksideRise)
    throw new Error('A single guard rail cannot be taller than its height above the road. Raise the height above the road or lower the rail.');
  if (p.tracksideShape === 'rail2' && p.tracksideRise < 2 * lowest + p.tracksideRailGround + RAIL.gap)
    throw new Error('A double guard rail needs at least ' + (2 * lowest + p.tracksideRailGround + RAIL.gap) + ' mm above the road for its two rails. Raise the height above the road or lower the clearance.');
  const [fewest, most] = TRACKSIDE_LIMITS.tracksideSegments;
  if (!Number.isInteger(p.tracksideSegments) || p.tracksideSegments < fewest || p.tracksideSegments > most)
    throw new Error(`Barrier segments must be a whole number between ${fewest} and ${most}.`);
}

export function validateTrackside(p) {
  if (!TRACKSIDE_SIDES.includes(p.tracksideSide))
    throw new Error('Unknown trackside side.');
  if (typeof p.tracksideInnerOwn !== 'boolean')
    throw new Error('Unknown trackside setting for the inside.');
  validateSide(p);
  if (!tracksideInnerOwn(p)) return;
  try {
    validateSide(tracksideFor(p, 'inner'));
  } catch (error) {
    throw new Error('Inside barrier: ' + error.message, { cause: error });
  }
}

/** The cross-section as one ring of [distance from the track edge, height].
 * The foot is as high as the track, so the sloped face starts at the road. */
export function barrierProfile(height, rise, angle = TRACKSIDE_DEFAULTS.tracksideFaceAngle) {
  const scale = rise / 20;
  const [corner, straight] = BARRIER_FACE[0];
  // How far the face leans in over its straight part.
  const lean = Math.tan((angle * Math.PI) / 180) * straight * scale;
  const face = BARRIER_FACE.map(([d, z]) => [
    BARRIER_STEP + lean + d - corner,
    height + z * scale,
  ]);
  return [
    [0, 0],
    [BARRIER_FOOT, 0],
    [BARRIER_FOOT, height],
    [BARRIER_FOOT, height + rise],
    ...face.reverse(),
    [BARRIER_STEP, height],
    [0, height],
  ];
}

// The largest face angle that leaves the flat top its width at this height.
export function maxFaceAngle(rise) {
  const [corner, straight] = BARRIER_FACE[0];
  const room = BARRIER_FOOT - TOP_FLAT - BARRIER_STEP - (BARRIER_FACE.at(-1)[0] - corner);
  return (Math.atan(room / ((straight * rise) / 20)) * 180) / Math.PI;
}

// Ring indices of the end caps: the foot as a fan from its outer bottom
// corner and the convex upper part as a fan from the back at road height.
function capTriangles(count) {
  const step = count - 2,
    top = count - 1;
  const triangles = [
    [1, 2, step],
    [1, step, top],
    [1, top, 0],
  ];
  for (let j = 3; j < step; j++) triangles.push([2, j, j + 1]);
  return triangles;
}

// A convex ring: a fan from its first corner.
const fanTriangles = (count) =>
  Array.from({ length: count - 2 }, (_, j) => [0, j + 1, j + 2]);

function sweep(work, rings, caps = capTriangles) {
  const count = rings[0].length,
    vertices = rings.flat(),
    triangles = [];
  for (let k = 0; k + 1 < rings.length; k++)
    for (let j = 0; j < count; j++) {
      const a = k * count + j,
        b = k * count + ((j + 1) % count),
        c = a + count,
        d = b + count;
      triangles.push([a, b, d], [a, d, c]);
    }
  const last = (rings.length - 1) * count;
  for (const [a, b, c] of caps(count)) {
    triangles.push([a, c, b]);
    triangles.push([last + a, last + b, last + c]);
  }
  // The side of the road decides the handedness of the sweep.
  let volume = 0;
  for (const [a, b, c] of triangles) {
    const [p, q, r] = [vertices[a], vertices[b], vertices[c]];
    volume +=
      p[0] * (q[1] * r[2] - q[2] * r[1]) -
      p[1] * (q[0] * r[2] - q[2] * r[0]) +
      p[2] * (q[0] * r[1] - q[1] * r[0]);
  }
  if (volume < 0) for (const triangle of triangles) triangle.reverse();
  const mesh = new work.wasm.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(vertices.flat()),
    triVerts: Uint32Array.from(triangles.flat()),
  });
  return work.own(new work.wasm.Manifold(mesh));
}

// A point on (or beside) the free edge of the host. The host is printed as a
// polygon through its stations, so between two stations the edge is the
// straight line between them, not the smooth curve the widths come from.
function edgePoints(path, edgeAt, sign, ends) {
  const exact = (t, d) => path.point(t, edgeAt(t) + sign * d);
  const base = [...new Set([...path.stations, ...ends])].sort((x, y) => x - y);
  return (t, d = 0) => {
    const j = base.findIndex((v) => v >= t - 1e-12);
    if (j < 0) return exact(base.at(-1), d);
    if (j === 0 || Math.abs(base[j] - t) < 1e-12) return exact(base[j], d);
    const [p, q] = [exact(base[j - 1], d), exact(base[j], d)],
      part = (t - base[j - 1]) / (base[j] - base[j - 1]);
    return [p[0] + (q[0] - p[0]) * part, p[1] + (q[1] - p[1]) * part];
  };
}

function edgeLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

// Lay a straight barrier on its flat back, so the tabs point up and nothing
// overhangs. The back of a curved barrier is not flat: it prints standing.
function backDownPose(outward) {
  const turn = (-Math.atan2(outward[1], outward[0]) * 180) / Math.PI;
  return function printPose(callback, sideDown) {
    if (!sideDown) return callback(this.solid);
    const turned = this.solid.rotate([0, 0, turn]);
    const laid = turned.rotate([0, 90, 0]);
    try {
      return callback(laid);
    } finally {
      laid.delete();
      turned.delete();
    }
  };
}

// Where the two posts stand along a fence: a quarter and three quarters of
// the way, so boards in a row give an even rhythm of posts.
export const fencePosts = ({ length }) => [length / 4, (length * 3) / 4];

/**
 * The fence as it prints: flat on the bed, its length along x and its height
 * along y. Two posts with pegs below the panel, a frame, horizontal cables
 * and diamond mesh. The posts are as thick as they are wide; the rest is a
 * thin skin flush with one face.
 */
export function fenceFlat(work, { length, height, post, cable, mesh }) {
  const peg = FENCE_SOCKET - 0.5,
    low = peg + 0.2,
    high = peg + height,
    from = 0.3,
    to = length - 0.3;
  const box = (x0, y0, x1, y1) => work.section([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);
  const union = (sections) => work.own(work.wasm.CrossSection.union(sections));
  const posts = union(
    fencePosts({ length }).map((s) => box(s - post / 2, 0, s + post / 2, high)),
  );
  const rails = [
    box(from, low, to, low + FENCE_RAIL),
    box(from, high - FENCE_RAIL, to, high),
    box(from, low, from + FENCE_RAIL, high),
    box(to - FENCE_RAIL, low, to, high),
  ];
  for (let y = low + cable; y < high - FENCE_RAIL - FENCE_CABLE; y += cable)
    rails.push(box(from, y - FENCE_CABLE / 2, to, y + FENCE_CABLE / 2));
  // Diamond mesh: strands at 45 degrees both ways, `mesh` apart.
  const strands = [],
    step = mesh * Math.SQRT2,
    tall = high - low,
    half = (FENCE_STRAND / 2) * Math.SQRT2;
  for (let x = from - tall; x < to + tall; x += step) {
    strands.push(
      work.section([[[x - half, low], [x + half, low], [x + half + tall, high], [x - half + tall, high]]]),
      work.section([[[x - half + tall, low], [x + half + tall, low], [x + half, high], [x - half, high]]]),
    );
  }
  const panel = box(from, low, to, high);
  const skin = work.own(union([...rails, work.own(union(strands).intersect(panel))]));
  return work.own(
    work.prism(skin, 0, FENCE_SKIN).add(work.prism(posts, 0, post)),
  );
}

/**
 * Barriers beside each host (a border segment, or a road segment on a side
 * without a border). Together they are as long as that host's edge, which
 * tracksideSegments divides into equal barriers so each fits the print plate.
 * edgeAt(t) is the offset of the host's free edge from the centre line and
 * widthAt(t) the stock behind it that a socket may use.
 */
export function addTrackside(work, p, path, side, sign, hosts, spans, edgeAt, widthAt, loose) {
  const fit = resolveJointFit(p);
  // The inside may have settings of its own.
  p = tracksideFor(p, side);
  const board = p.tracksideShape === 'board';
  const thick = boardThickness(p),
    top = p.height + p.tracksideRise;
  const profile = board
    ? [[0, 0], [thick, 0], [thick, top], [0, top]]
    : barrierProfile(p.height, p.tracksideRise, p.tracksideFaceAngle);
  const round = !board && p.tracksideEndShape === 'round';
  const label = (side === 'outer' ? 'Outer' : 'Inner') + (board ? ' board ' : ' barrier ');
  const half = fit.tabSupportHalfWidth;
  const count = p.tracksideSegments;
  const runs = hosts.flatMap((host, n) =>
    Array.from({ length: count }, (_, k) => {
      const [start, finish] = spans[n];
      return [
        host,
        start + ((finish - start) * k) / count,
        k + 1 === count ? finish : start + ((finish - start) * (k + 1)) / count,
      ];
    }),
  );
  const at = edgePoints(path, edgeAt, sign, spans.flat());
  if (isGuardRail(p.tracksideShape) || isBeamRail(p.tracksideShape))
    return addGuardRails(work, p, path, side, sign, runs, at, widthAt, loose, fit);
  runs.forEach(([host, a, b], i) => {
    let stations = [
      ...new Set([a, ...path.stations.filter((t) => t > a && t < b), b]),
    ];
    const length = edgeLength(stations.map((t) => at(t)));
    // A sloped end: the top runs down to the foot over the last stretch of
    // the first or last barrier on this side.
    // A board end has a rounded top corner instead.
    const ramp = board
      ? Math.min(BOARD_CORNER, length * 0.2, top - 3)
      : Math.min(END_RAMP, length * 0.4);
    const sloped = [
      i === 0 && ['start', 'both'].includes(p.tracksideEnds),
      i === runs.length - 1 && ['finish', 'both'].includes(p.tracksideEnds),
    ];
    const along = () => {
      const distances = [0];
      for (let k = 1; k < stations.length; k++)
        distances.push(
          distances[k - 1] +
            Math.hypot(...minus(at(stations[k]), at(stations[k - 1]))),
        );
      return distances;
    };
    for (const [end, on] of sloped.entries()) {
      if (!on) continue;
      // The slope starts at a station of its own. A rounded end needs more
      // of them, closest together at the tip where the outline turns most.
      for (const u of round || board ? [0.02, 0.06, 0.12, 0.2, 0.32, 0.48, 0.66, 0.84, 1] : [1]) {
        const distances = along(),
          target = end ? length - ramp * u : ramp * u;
        const k = distances.findIndex((d) => d > target + 1e-6);
        if (k > 0 && target - distances[k - 1] > 1e-6) {
          const part = (target - distances[k - 1]) / (distances[k] - distances[k - 1]);
          stations.splice(k, 0, stations[k - 1] + (stations[k] - stations[k - 1]) * part);
        }
      }
    }
    const distances = along();
    const lowest = END_HEIGHT / p.tracksideRise;
    const rings = stations.map((t, k) => {
      const scale = Math.min(
        1,
        sloped[0] ? lowest + ((1 - lowest) * distances[k]) / ramp : 1,
        sloped[1] ? lowest + ((1 - lowest) * (length - distances[k])) / ramp : 1,
      );
      // From the end: 0 at the tip, 1 where the full barrier starts.
      const u = Math.max(0, Math.min(
        1,
        sloped[0] ? distances[k] / ramp : 1,
        sloped[1] ? (length - distances[k]) / ramp : 1,
      ));
      // A quarter-round outline in plan, narrowing towards the track edge.
      const tip = END_TIP / BARRIER_FOOT;
      const width = round ? tip + (1 - tip) * Math.sqrt(1 - (1 - u) ** 2) : 1;
      // The quarter-round top corner of a board end.
      const corner = top - ramp + ramp * Math.sqrt(1 - (1 - u) ** 2);
      return profile.map(([d, z]) => [
        ...at(t, d * width),
        board
          ? z > 0 ? corner : 0
          : z > p.height ? p.height + (z - p.height) * scale : z,
      ]);
    });
    const edge = stations.map((t) => at(t));
    const name = label + (i + 1);
    const warn = (reason, advice) =>
      connectorWarning(name, reason, advice, {
        tab: 'trackside',
        field: 'tracksideTabs',
        label: 'Edit trackside',
      });
    if (
      rings.some((ring, k) =>
        k > 0 &&
        dot(minus(ring[1], rings[k - 1][1]), minus(ring[0], rings[k - 1][0])) <= 0,
      )
    )
      throw warn(
        'The bend is too tight for a barrier on its inside.',
        'Switch the barrier off on this side or use a wider bend.',
      );
    const part = {
      section: work.section([
        [...edge, ...rings.map((ring) => ring[1].slice(0, 2)).reverse()],
      ]),
      additions: [sweep(work, rings, board ? fanTriangles : capTriangles)],
      cuts: [],
      feedCuts: [],
    };
    // Towards the host, square to its edge.
    const inward = (t) => {
      const d = 1e-4;
      const along = unit(minus(at(Math.min(b, t + d)), at(Math.max(a, t - d))));
      const normal = left(along);
      return dot(normal, minus(at(t, -1), at(t))) >= 0
        ? normal
        : normal.map((v) => -v);
    };
    const tAt = (v) => a + (b - a) * v;
    // Every tab of one barrier slides in along the same line.
    const slide = inward(tAt(0.5));
    const ends = (half + 6) / length;
    const blocked = (v, used) => {
      if (v < ends || v > 1 - ends) return 'end';
      if (used.some((u) => Math.abs(u - v) * length < 2 * half + 4)) return 'other';
      const t = tAt(v),
        normal = inward(t);
      const along = dot(normal, slide),
        across = Math.abs(dot(left(normal), slide));
      if (
        along * (fit.tabRootLength + fit.tabClearance) <=
        across * (fit.tabWidth / 2 + fit.tabClearance + 0.3)
      )
        return 'angle';
      if (widthAt(t) < fit.tabSocketSupportDepth + 1) return 'width';
      const origin = at(t),
        sideways = left(slide);
      const corner = (x, y) => move(move(origin, slide, x), sideways, y);
      const pad = work.prism(
        work.section([
          [
            corner(-0.5, -half),
            corner(fit.tabSocketSupportDepth, -half),
            corner(fit.tabSocketSupportDepth, half),
            corner(-0.5, half),
          ],
        ]),
        Math.max(0, fit.tabBottom - fit.tabClearance - Math.max(0.4, p.wall)),
        Math.min(p.height, fit.tabTop + fit.tabClearance + 0.4),
      );
      for (const cut of [...host.cuts, ...(host.feedCuts ?? [])])
        if (work.and(cut, pad).volume() > 0.001) return 'stock';
      return null;
    };
    const wanted =
      p.tracksideTabs === 'auto'
        ? length >= TWO_TAB_LENGTH
          ? 2
          : 1
        : Number(p.tracksideTabs);
    const choose = (count) => {
      const used = [];
      for (const target of count === 1 ? [0.5] : [0.25, 0.75]) {
        const candidates = [target];
        for (let step = 1; step <= 12; step++)
          candidates.push(target - step * 0.02, target + step * 0.02);
        const v = candidates.find((u) => !blocked(u, used));
        if (v === undefined) return null;
        used.push(v);
      }
      return used;
    };
    // A barrier too short or too curved for two tabs still holds on one.
    const places =
      choose(wanted) ?? (wanted === 2 && p.tracksideTabs === 'auto' ? choose(1) : null);
    if (!places)
      throw warn(
        'There is no room for ' +
          (wanted === 1 ? 'a tab socket' : wanted + ' tab sockets') +
          ' in this edge.',
        'Choose fewer tabs, a wider border or a smaller tab, or move the connectors on this edge.',
      );
    for (const v of places) tabPair(work, p, at(tAt(v)), slide, part, host);
    const straight = edge.every(
      (q) => Math.abs(dot(minus(q, edge[0]), left(unit(minus(edge.at(-1), edge[0]))))) < 1e-6,
    );
    let solid = work.union(part.additions);
    if (board) {
      // The root of a tab is longer than a thin board is thick: trim it flush
      // with the back of the board.
      const reach = fit.tabLength + fit.tabRootLength + 4;
      const keep = work.section([
        [
          ...stations.map((t) => at(t, -reach)),
          ...rings.map((ring) => ring[1].slice(0, 2)).reverse(),
        ],
      ]);
      solid = work.and(solid, work.prism(keep, 0, top + 1));
    }
    const fenced = board && p.tracksideFence && length >= FENCE_MIN_LENGTH;
    let fence, fenceSpec;
    if (fenced) {
      // Distance along the edge to a point on (or beside) it.
      const base = [...new Set([a, ...path.stations.filter((t) => t > a && t < b), b])];
      const run = [0];
      for (let k = 1; k < base.length; k++)
        run.push(run[k - 1] + Math.hypot(...minus(at(base[k]), at(base[k - 1]))));
      const tOf = (s) => {
        const found = run.findIndex((d) => d >= s - 1e-9);
        const j = found < 0 ? run.length - 1 : Math.max(1, found);
        const span = run[j] - run[j - 1] || 1;
        return base[j - 1] + ((base[j] - base[j - 1]) * (s - run[j - 1])) / span;
      };
      // The fence is as long as the line its posts stand on, which on a bend
      // is a little longer or shorter than the track edge.
      const middle = thick / 2;
      const postLine = edgeLength(base.map((t) => at(t, middle))),
        ratio = length / postLine;
      fenceSpec = {
        length: postLine,
        height: p.tracksideFenceHeight,
        post: p.tracksidePost,
        cable: p.tracksideCable,
        mesh: p.tracksideMesh,
      };
      const spec = fenceSpec;
      const posts = fencePosts(spec);
      const
        hole = p.tracksidePost / 2 + FENCE_PLAY;
      for (const s of posts) {
        // Laid out along the edge exactly as the fence is stood on it.
        const corner = (x, y) => at(tOf((s + x) * ratio), middle + y);
        solid = work.own(
          solid.subtract(
            work.prism(
              work.section([[corner(-hole, -hole), corner(hole, -hole), corner(hole, hole), corner(-hole, hole)]]),
              top - FENCE_SOCKET,
              top + 1,
            ),
          ),
        );
      }
      // The flat panel lies with its length along x, its height along y and
      // its thickness along z. Stand it on the board: the mesh on the track
      // side of the posts. A turn that would mirror it runs the other way.
      const flat = fenceFlat(work, spec);
      const outward = unit(minus(at(tOf(length / 2), 1), at(tOf(length / 2))));
      const forward = unit(minus(at(tOf(length / 2 + 0.5)), at(tOf(length / 2 - 0.5))));
      const reversed = forward[1] * outward[0] - forward[0] * outward[1] < 0;
      const bottom = top - FENCE_SOCKET + 0.5;
      const source = straight ? flat : work.own(flat.refineToLength(8));
      fence = work.own(
        source.warp((v) => {
          const s = Math.max(0, Math.min(length, (reversed ? postLine - v[0] : v[0]) * ratio));
          const [x, y] = at(tOf(s), middle - p.tracksidePost / 2 + v[2]);
          v[2] = bottom + v[1];
          v[0] = x;
          v[1] = y;
        }),
      );
    }
    const number = i + 1;
    loose.push({
      id: (board ? 'board-' : 'barrier-') + side + '-' + number,
      name,
      role: 'barrier',
      jointGuides: part.jointGuides,
      tabCount: places.length,
      // The Track Planner draws its parts from their outlines.
      ...(work.planning && { outline: part.section.toPolygons() }),
      solid,
      ...(straight && { printPose: backDownPose(slide.map((v) => -v)) }),
    });
    if (fence) {
      const wasm = work.wasm,
        spec = fenceSpec;
      loose.push({
        id: 'fence-' + side + '-' + number,
        name: (side === 'outer' ? 'Outer' : 'Inner') + ' fence ' + number,
        role: 'fence',
        ...(work.planning && { outline: part.section.toPolygons() }),
        solid: fence,
        // A fence prints flat on the bed, whatever the bend it stands on.
        printPose(callback, sideDown) {
          if (!sideDown) return callback(this.solid);
          const stock = new SolidWorkshop(wasm);
          try {
            return callback(fenceFlat(stock, spec));
          } finally {
            stock.close();
          }
        },
      });
    }
  });
}

// ---- Guard rails ----
// A post on a tab carries a T-shaped peg for each rail. Two rail ends butt
// at the stem of the T and are pinched between its head and the post.
export const RAIL = Object.freeze({
  // The T: its head and its stem.
  head: 1.2,
  stem: 2,
  // The play between the two rails of a double rail, and around a stem.
  gap: 0.4,
  play: 0.15,
});
export const isGuardRail = (shape) => shape === 'rail' || shape === 'rail2';
// The rails of one post as [bottom, top] above the table. A single rail hangs
// under the top; a double rail fills from the top to just above the road.
export function railRows(p) {
  const top = p.height + p.tracksideRise;
  if (p.tracksideShape === 'rail') return [[top - p.tracksideRailHeight, top]];
  const each = (p.tracksideRise - p.tracksideRailGround - RAIL.gap) / 2,
    low = p.height + p.tracksideRailGround;
  return [
    [low, low + each],
    [top - each, top],
  ];
}

/**
 * A rail as it prints: flat on its back, its length along x and its height
 * along y, ridges up: a flat back of half the thickness with two raised
 * ridges on it. Each end has a corner notch that drops over the stem of the
 * T on its post.
 */
export function railFlat(work, { length, height, thickness }) {
  const end = 0.1,
    notch = RAIL.stem / 2 + RAIL.play,
    reach = height * 0.7 + RAIL.play;
  const box = (x0, y0, x1, y1) => work.section([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);
  const notches = work.own(
    box(-1, -1, notch, reach).add(box(length - notch, -1, length + 1, reach)),
  );
  const plate = work.own(box(end, 0, length - end, height).subtract(notches));
  const ridges = work.own(
    box(end, height * 0.14, length - end, height * 0.4)
      .add(box(end, height * 0.6, length - end, height * 0.86))
      .subtract(notches),
  );
  return work.own(
    work.prism(plate, 0, thickness / 2).add(work.prism(ridges, thickness / 2, thickness)),
  );
}

// Lay a post on its side: the T, the post, its foot and its tab then all lie
// flat on the bed, and the layers run through the stem into the head.
function sideDownPose(along) {
  const turn = (-Math.atan2(along[1], along[0]) * 180) / Math.PI;
  return function printPose(callback, sideDown) {
    if (!sideDown) return callback(this.solid);
    const turned = this.solid.rotate([0, 0, turn]);
    const laid = turned.rotate([0, -90, 0]);
    try {
      return callback(laid);
    } finally {
      laid.delete();
      turned.delete();
    }
  };
}

// ---- W-beam guard rails ----
// The rail is a thin sheet folded into a W, as a real guard rail is. It snaps
// between two hooks on the post, and a cover over the joint holds two rail
// ends in line with a tab that passes through their valley into the post.
export const BEAM = Object.freeze({
  // Across one W: lip, sloped side, crest, sloped side, then half the valley.
  lip: 0.06,
  side: 0.11,
  crest: 0.14,
  valley: 0.16,
  // The hooks: how thick they are and their play around the lip of the rail.
  hook: 0.8,
  play: 0.1,
  // The cover: its wall, its play over the rail, and how deep its tab goes.
  wall: 0.8,
  groove: 2.4,
});
export const isBeamRail = (shape) => shape === 'wrail' || shape === 'wrail2';
// The W-beam as [bottom, top] above the table, and how many Ws it has. A
// double rail is one sheet with four crests.
export function beamSpan(p) {
  const top = p.height + p.tracksideRise;
  return p.tracksideShape === 'wrail'
    ? { low: top - p.tracksideRailHeight, top, units: 1 }
    : { low: p.height + p.tracksideRailGround, top, units: 2 };
}

/**
 * The folded section as two outlines of [height, depth]: the face towards
 * the track, and the back that lies against the post at depth 0. Each W has
 * a lip, a crest, a valley, a crest and a lip.
 */
export function beamProfile({ height, depth, wall, units }) {
  const one = height / units;
  const run = BEAM.side * one,
    rise = depth - wall,
    slope = Math.hypot(run, rise);
  // The back of a sloped side runs parallel to its face, one wall behind it.
  const shift = (wall * rise) / slope,
    drop = (wall * run) / slope;
  const foot = (wall - drop) * (run / rise),
    head = (depth - wall - (wall - drop)) * (run / rise);
  const face = [],
    back = [];
  for (let n = 0; n < units; n++) {
    const y0 = n * one;
    let y = y0 + BEAM.lip * one;
    for (const [flat, last] of [[BEAM.valley, false], [BEAM.lip, true]]) {
      // Up a sloped side, along the crest, down the other side.
      const up = y,
        crest = up + run,
        over = crest + BEAM.crest * one,
        down = over + run;
      face.push([up, wall], [crest, depth], [over, depth], [down, wall]);
      back.push(
        [up + shift - foot, 0],
        [up + shift + head, depth - wall],
        [down - shift - head, depth - wall],
        [down - shift + foot, 0],
      );
      y = down + (last ? 0 : flat * one);
    }
  }
  if (back.some(([y], i) => i > 0 && y <= back[i - 1][0] + 1e-6))
    throw new Error('The guard rail wall is too thick for its height and depth. Use a thinner wall, a taller rail or a deeper profile.');
  return {
    face: [[0, wall], ...face, [height, wall]],
    back: [[0, 0], ...back, [height, 0]],
    // The middle of each valley, for the tab of the cover.
    valleys: Array.from({ length: units }, (_, n) => n * one + one / 2),
    tab: BEAM.valley * one - 0.4,
    lip: BEAM.lip * one,
  };
}

// A section in [height, depth], pulled out along x: length along x, height
// along y and depth along z, as the flat rails are.
function pulled(work, section, from, to) {
  return work.own(
    work.prism(section, from, to).warp((v) => {
      const [y, z, x] = v;
      v[0] = x;
      v[1] = y;
      v[2] = z;
    }),
  );
}

/** A W-beam rail as it prints: on its lips and valleys, crests up. Each end
 * has a notch in every valley for the tab of the cover. */
export function beamFlat(work, { length, height, depth, wall, units, notch }) {
  const { face, back, valleys, tab } = beamProfile({ height, depth, wall, units });
  const sheet = work.section([[...back, ...face.slice().reverse()]]);
  let solid = pulled(work, sheet, 0.05, length - 0.05);
  const slot = (x0, x1, y) =>
    work.prism(
      work.section([[[x0, y - tab / 2 - 0.15], [x1, y - tab / 2 - 0.15], [x1, y + tab / 2 + 0.15], [x0, y + tab / 2 + 0.15]]]),
      -1,
      depth + 1,
    );
  for (const y of valleys)
    solid = work.own(solid.subtract(slot(-1, notch, y)).subtract(slot(length - notch, length + 1, y)));
  return solid;
}

/** The cover of a joint as it prints: on its side, its W and its tabs one
 * flat outline. Laid out it is `width` along x, with the back of the rail at
 * depth 0 and its tabs reaching behind it. */
export function beamCover(work, { height, depth, wall, units, width, fit }, laid = false) {
  const { face, valleys, tab, lip } = beamProfile({ height, depth, wall, units });
  // Everything in front of the rail between its two lips, a play away from
  // it and one cover wall thick.
  const front = work.section([[[0, -1], ...face, [height, -1]]]);
  const band = work.own(
    work
      .own(front.offset(BEAM.play + BEAM.wall, 'Miter'))
      .subtract(work.own(front.offset(BEAM.play, 'Miter'))),
  );
  const box = (y0, z0, y1, z1) => work.section([[[y0, z0], [y1, z0], [y1, z1], [y0, z1]]]);
  let outline = work.own(band.intersect(box(lip + 0.2, wall + BEAM.play, height - lip - 0.2, depth + 5)));
  for (const y of valleys)
    outline = work.own(
      outline.add(box(y - tab / 2 + fit / 2, -(BEAM.groove - 0.3), y + tab / 2 - fit / 2, wall + BEAM.play + 0.01)),
    );
  if (laid) return work.prism(outline, 0, width);
  return pulled(work, outline, -width / 2, width / 2);
}

function addGuardRails(work, p, path, side, sign, runs, at, widthAt, loose, fit) {
  const label = side === 'outer' ? 'Outer' : 'Inner';
  // A W-beam is one folded sheet, single or double; a flat rail has a row for each rail.
  const beam = isBeamRail(p.tracksideShape) ? beamSpan(p) : null;
  const rows = beam ? [[beam.low, beam.top]] : railRows(p),
    top = p.height + p.tracksideRise;
  // On its side the post lies on the bed with its tab: never narrower than the tab.
  const width = Math.max(p.tracksidePostWidth, fit.tabWidth),
    half = width / 2;
  const thickness = p.tracksideRailThickness,
    inset = p.tracksidePostInset;
  // The post stands off the track edge, so the rail and the head of the T in
  // front of it stay clear of the road.
  const standoff =
      (beam ? p.tracksideBeamDepth + BEAM.play + BEAM.wall : thickness + RAIL.head) + 0.4,
    back = standoff + p.tracksidePostDepth;
  const sheet = beam && {
    height: beam.top - beam.low,
    depth: p.tracksideBeamDepth,
    wall: p.tracksideBeamWall,
    units: beam.units,
  };
  const warn = (name, reason, advice) =>
    connectorWarning(name, reason, advice, {
      tab: 'trackside',
      field: 'tracksideSegments',
      label: 'Edit trackside',
    });
  // One line along this side of the piece, measured from its start.
  const first = runs[0][1],
    last = runs.at(-1)[2];
  const base = [
    ...new Set([
      first,
      ...path.stations.filter((t) => t > first && t < last),
      ...runs.flatMap(([, a, b]) => [a, b]),
    ]),
  ].sort((x, y) => x - y);
  const run = [0];
  for (let k = 1; k < base.length; k++)
    run.push(run[k - 1] + Math.hypot(...minus(at(base[k]), at(base[k - 1]))));
  const total = run.at(-1);
  const tOf = (s) => {
    const found = run.findIndex((d) => d >= s - 1e-9);
    const j = found < 0 ? run.length - 1 : Math.max(1, found);
    const span = run[j] - run[j - 1] || 1;
    return base[j - 1] + ((base[j] - base[j - 1]) * (s - run[j - 1])) / span;
  };
  const sOf = (t) => run[base.indexOf(t)];
  // Before the start of the piece the line carries straight on: the first
  // rail comes from the post of the piece before this one.
  const lead = unit(minus(at(base[1]), at(base[0])));
  const edge = (s) =>
    s >= 0 ? at(tOf(Math.min(total, s))) : move(at(base[0]), lead, s);
  // Away from the track, square to the edge. The posts and the rails both
  // measure from the edge this way, so a rail sits true in its post on a
  // bend and beside a tapered border.
  const outwardAt = (s) => {
    const normal = left(unit(minus(edge(s + 0.5), edge(s - 0.5))));
    const t = tOf(Math.max(0, Math.min(total, s)));
    return dot(normal, minus(at(t, 1), at(t))) < 0 ? normal.map((v) => -v) : normal;
  };
  const pos = (s, d = 0) => (d ? move(edge(s), outwardAt(s), d) : edge(s));
  const name = (what, n) => label + ' ' + what + ' ' + n;
  const posts = [];
  if (p.tracksideStartPost) posts.push({ s: inset, host: runs[0][0] });
  for (const [host, a, b] of runs) {
    const from = posts.length ? posts.at(-1).s : sOf(a) - inset,
      s = sOf(b) - inset;
    if (s - from < 2 * width + 4 || sOf(b) - sOf(a) < inset + width)
      throw warn(
        name('rail post', posts.length + 1),
        'This edge is too short for a guard rail between its posts.',
        'Use fewer posts per segment, a smaller distance from the end, or leave the start post off.',
      );
    posts.push({ s, host });
  }
  posts.forEach(({ s, host }, i) => {
    const title = name('rail post', i + 1);
    const origin = pos(s),
      along = unit(minus(pos(s + 0.5), pos(s - 0.5)));
    const t = tOf(s);
    let inward = left(along);
    if (dot(inward, minus(at(t, -1), at(t))) < 0) inward = inward.map((v) => -v);
    const outward = inward.map((v) => -v);
    const corner = (d, y) => move(move(origin, outward, d), along, y);
    const box = (d0, d1, y0, y1, z0, z1) =>
      work.prism(
        work.section([[corner(d0, y0), corner(d1, y0), corner(d1, y1), corner(d0, y1)]]),
        z0,
        z1,
      );
    // Room in the host for the socket of the tab, as for a barrier.
    if (widthAt(t) < fit.tabSocketSupportDepth + 1)
      throw warn(title, 'The border is too narrow here for the socket of its tab.', 'Use a wider border, or change the posts per segment.');
    const reachIn = fit.tabSocketSupportDepth,
      pad = work.prism(
        work.section([
          [corner(0.5, -fit.tabSupportHalfWidth), corner(-reachIn, -fit.tabSupportHalfWidth), corner(-reachIn, fit.tabSupportHalfWidth), corner(0.5, fit.tabSupportHalfWidth)],
        ]),
        Math.max(0, fit.tabBottom - fit.tabClearance - Math.max(0.4, p.wall)),
        Math.min(p.height, fit.tabTop + fit.tabClearance + 0.4),
      );
    for (const cut of [...host.cuts, ...(host.feedCuts ?? [])])
      if (work.and(cut, pad).volume() > 0.001)
        throw warn(title, 'A connector, slot or pocket is in the way of the socket of its tab.', 'Change the posts per segment, or move the connectors on this edge.');
    // The front of the foot follows the edge of the host, bend or taper included.
    const front = [s - half, ...run.filter((d) => d > s - half && d < s + half), s + half].map((d) => pos(d));
    const foot = work.section([[...front, corner(back, half), corner(back, -half)]]);
    const part = {
      section: foot,
      additions: [
        // The foot, as high as the track, and the post behind the rail. The
        // post ends flush with the top of the rail.
        work.prism(foot, 0, p.height),
        // A W-beam post carries a hook over the rail instead.
        box(standoff, back, -half, half, 0, beam ? top + BEAM.play + BEAM.hook : top - p.tracksidePostDrop),
      ],
      cuts: [],
      feedCuts: [],
    };
    if (beam) {
      // A hook over the top lip and one under the bottom lip, and a groove
      // behind every valley for the tab of the cover.
      const channel = p.tracksideBeamWall + BEAM.play,
        reach = p.tracksideHook;
      part.additions.push(
        box(standoff - channel - BEAM.hook, standoff, -half, half, beam.top + BEAM.play, beam.top + BEAM.play + BEAM.hook),
        box(standoff - channel - BEAM.hook, standoff - channel, -half, half, beam.top - reach, beam.top + BEAM.play),
        box(standoff - channel - BEAM.hook, standoff, -half, half, beam.low - BEAM.play - BEAM.hook, beam.low - BEAM.play),
        box(standoff - channel - BEAM.hook, standoff - channel, -half, half, beam.low - BEAM.play, beam.low + reach),
      );
      const { valleys, tab } = beamProfile(sheet);
      for (const y of valleys)
        part.cuts.push(
          box(standoff - 0.01, standoff + BEAM.groove, -half - 1, half + 1, beam.low + y - tab / 2, beam.low + y + tab / 2),
        );
    }
    const grip = standoff - (thickness - p.tracksidePinch);
    for (const [low, high] of beam ? [] : rows) {
      const tall = high - low,
        centre = (low + high) / 2;
      part.additions.push(
        box(grip - 0.01, standoff, -RAIL.stem / 2, RAIL.stem / 2, centre - tall * 0.2, centre + tall * 0.2),
        box(grip - RAIL.head, grip, -half, half, centre - tall * 0.35, centre + tall * 0.35),
      );
    }
    tabPair(work, p, origin, inward, part, host);
    loose.push({
      id: 'post-' + side + '-' + (i + 1),
      name: title,
      role: 'barrier',
      jointGuides: part.jointGuides,
      tabCount: 1,
      ...(work.planning && { outline: part.section.toPolygons() }),
      solid: work.cut(work.union(part.additions), part.cuts),
      printPose: sideDownPose(along),
    });
  });
  // A rail from each post back to the one before it.
  const wasm = work.wasm;
  posts.forEach(({ s: s1 }, i) => {
    const s0 = i ? posts[i - 1].s : p.tracksideStartPost ? null : -inset;
    if (s0 === null) return;
    const marks = [s0, ...run.filter((d) => d > s0 && d < s1), s1];
    const line = marks.map((s) => pos(s, standoff));
    const length = edgeLength(line);
    const straight = line.every(
      (q) => Math.abs(dot(minus(q, line[0]), left(unit(minus(line.at(-1), line[0]))))) < 1e-6,
    );
    const middle = (s0 + s1) / 2;
    const forward = unit(minus(pos(middle + 0.5), pos(middle - 0.5))),
      outward = unit(minus(pos(middle, 1), pos(middle)));
    // The ridges face the track. A turn that would mirror the rail runs the other way.
    const reversed = forward[1] * outward[0] - forward[0] * outward[1] > 0;
    rows.forEach(([low, high], k) => {
      const spec = beam
        ? { ...sheet, length, notch: half + RAIL.play }
        : { length, height: high - low, thickness };
      const laid = beam ? beamFlat : railFlat;
      const flat = laid(work, spec);
      const source = straight ? flat : work.own(flat.refineToLength(8));
      const solid = work.own(
        source.warp((v) => {
          const x = Math.max(0, Math.min(length, reversed ? length - v[0] : v[0]));
          const [px, py] = pos(s0 + ((s1 - s0) * x) / length, standoff - v[2]);
          v[2] = low + v[1];
          v[0] = px;
          v[1] = py;
        }),
      );
      const number = i + (p.tracksideStartPost ? 0 : 1);
      loose.push({
        id: 'rail-' + side + '-' + number + (rows.length > 1 ? '-' + 'ab'[k] : ''),
        name: name('guard rail', number) + (rows.length > 1 ? (k ? ' upper' : ' lower') : ''),
        role: 'barrier',
        ...(work.planning && {
          outline: work
            .section([[...marks.map((s) => pos(s, standoff - (beam ? p.tracksideBeamDepth : thickness))), ...line.slice().reverse()]])
            .toPolygons(),
        }),
        solid,
        // A rail prints flat and straight, whatever the bend it follows.
        printPose(callback, sideDown) {
          if (!sideDown) return callback(this.solid);
          const stock = new SolidWorkshop(wasm);
          try {
            return callback(laid(stock, spec));
          } finally {
            stock.close();
          }
        },
      });
    });
  });
  if (!beam) return;
  // A cover over every joint: its tabs pass through the valleys of both rail
  // ends into the grooves of the post.
  posts.forEach(({ s }, i) => {
    const spec = { ...sheet, width, fit: Math.max(0, 0.05 - p.tracksidePinch) };
    const forward = unit(minus(pos(s + 0.5), pos(s - 0.5))),
      outward = unit(minus(pos(s, 1), pos(s)));
    const reversed = forward[1] * outward[0] - forward[0] * outward[1] > 0;
    const solid = work.own(
      beamCover(work, spec).warp((v) => {
        const [px, py] = pos(s + (reversed ? -v[0] : v[0]), standoff - v[2]);
        v[2] = beam.low + v[1];
        v[0] = px;
        v[1] = py;
      }),
    );
    loose.push({
      id: 'cover-' + side + '-' + (i + 1),
      name: name('rail cover', i + 1),
      role: 'barrier',
      solid,
      // A cover prints on its side: its W and its tabs are one flat outline.
      printPose(callback, sideDown) {
        if (!sideDown) return callback(this.solid);
        const stock = new SolidWorkshop(wasm);
        try {
          return callback(beamCover(stock, spec, true));
        } finally {
          stock.close();
        }
      },
    });
  });
}
