import { dot, left, minus, move, unit } from './solids.js';
import { tabPair } from './joints.js';
import { resolveJointFit } from './joint-fit.js';
import { connectorWarning } from './connector-warning.js';

// Trackside accessories stand on the table beside the track and plug into
// sockets in the free edge of a border, or of the road where it has none.
export const TRACKSIDE_SHAPES = Object.freeze([['barrier', 'Concrete barrier']]);
export const TRACKSIDE_SIDES = Object.freeze(['none', 'inner', 'outer', 'both']);
export const TRACKSIDE_TAB_CHOICES = Object.freeze([
  ['auto', 'Automatic'],
  ['1', 'One tab'],
  ['2', 'Two tabs'],
]);
export const TRACKSIDE_DEFAULTS = Object.freeze({
  tracksideSide: 'none',
  tracksideShape: 'barrier',
  tracksideRise: 20,
  tracksideTabs: 'auto',
  tracksideSegments: 1,
  tracksideEnds: 'none',
  tracksideEndShape: 'ramp',
  tracksideFaceAngle: 17.1,
});
export const TRACKSIDE_LIMITS = Object.freeze({
  tracksideRise: [5, 100],
  tracksideSegments: [1, 16],
  tracksideFaceAngle: [0, 45],
});
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

export function validateTrackside(p) {
  if (!TRACKSIDE_SIDES.includes(p.tracksideSide))
    throw new Error('Unknown trackside side.');
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
  if (p.tracksideFaceAngle > widest + 1e-9)
    throw new Error(
      'The barrier face leans too far for its height: the top would be thinner than ' +
        TOP_FLAT + ' mm. Use at most ' + Math.floor(widest * 10) / 10 +
        ' degrees at this height, or lower the barrier.',
    );
  const [fewest, most] = TRACKSIDE_LIMITS.tracksideSegments;
  if (!Number.isInteger(p.tracksideSegments) || p.tracksideSegments < fewest || p.tracksideSegments > most)
    throw new Error(`Barrier segments must be a whole number between ${fewest} and ${most}.`);
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

function sweep(work, rings) {
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
  for (const [a, b, c] of capTriangles(count)) {
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

/**
 * Barriers beside each host (a border segment, or a road segment on a side
 * without a border). Together they are as long as that host's edge, which
 * tracksideSegments divides into equal barriers so each fits the print plate.
 * edgeAt(t) is the offset of the host's free edge from the centre line and
 * widthAt(t) the stock behind it that a socket may use.
 */
export function addTrackside(work, p, path, side, sign, hosts, spans, edgeAt, widthAt, loose) {
  const fit = resolveJointFit(p);
  const profile = barrierProfile(p.height, p.tracksideRise, p.tracksideFaceAngle);
  const round = p.tracksideEndShape === 'round';
  const label = side === 'outer' ? 'Outer' : 'Inner';
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
    const ramp = Math.min(END_RAMP, length * 0.4);
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
      for (const u of round ? [0.02, 0.06, 0.12, 0.2, 0.32, 0.48, 0.66, 0.84, 1] : [1]) {
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
      return profile.map(([d, z]) => [
        ...at(t, d * width),
        z > p.height ? p.height + (z - p.height) * scale : z,
      ]);
    });
    const edge = stations.map((t) => at(t));
    const name = label + ' barrier ' + (i + 1);
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
      additions: [sweep(work, rings)],
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
    loose.push({
      id: 'barrier-' + side + '-' + (i + 1),
      name,
      role: 'barrier',
      jointGuides: part.jointGuides,
      tabCount: places.length,
      // The Track Planner draws its parts from their outlines.
      ...(work.planning && { outline: part.section.toPolygons() }),
      solid: work.union(part.additions),
      ...(straight && { printPose: backDownPose(slide.map((v) => -v)) }),
    });
  });
}
