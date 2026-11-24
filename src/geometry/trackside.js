import { SolidWorkshop, dot, left, minus, move, unit } from './solids.js';
import { tabPair } from './joints.js';
import { resolveJointFit } from './joint-fit.js';
import { connectorWarning } from './connector-warning.js';

// Trackside accessories stand on the table beside the track and plug into
// sockets in the free edge of a border, or of the road where it has none.
export const TRACKSIDE_SHAPES = Object.freeze([
  ['barrier', 'Concrete barrier'],
  ['board', 'Advertising board'],
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
  ]) {
    const [low, high] = TRACKSIDE_LIMITS[key];
    if (!Number.isFinite(p[key]) || p[key] < low || p[key] > high)
      throw new Error(`The ${name} must be between ${low} and ${high} mm.`);
  }
  if (typeof p.tracksideFence !== 'boolean') throw new Error('Unknown fence setting.');
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
  runs.forEach(([host, a, b], i) => {
    let stations = [
      ...new Set([a, ...path.stations.filter((t) => t > a && t < b), b]),
    ];
    const at = (t, d = 0) => path.point(t, edgeAt(t) + sign * d);
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
