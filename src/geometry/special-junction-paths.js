import { braidSpan, dot, left, move } from './solids.js';
import { pitTurnoutProfile } from './pit-turnout.js';

export const offsets = (p) =>
  Array.from(
    { length: p.lanes },
    (_, i) => (i - (p.lanes - 1) / 2) * p.laneSpacing,
  );
const fractions = (n) => Array.from({ length: n + 1 }, (_, i) => i / n);
const mix = (a, b, t) => a + (b - a) * t;

const stations = (p, n, extra = []) =>
  [
    ...new Set([
      ...fractions(n),
      ...fractions(p.segments),
      ...fractions(p.borderSegments),
      ...extra,
    ]),
  ].sort((a, b) => a - b);
export const pointOnAxis = (axis, x, d) =>
  move(move([0, 0], axis, x), left(axis), d);
const pitApproachStart = 0.085;
export const pitBayStart = 0.355;
export const pitSides = side => side === 'both' ? [1, -1] : [side === 'left' ? 1 : -1];
export function pitLayout(p) {
  const { length: L, width: W } = p,
    s = p.special,
    O = s.pitOffset;
  const laneOffsets = offsets(p);
  const branches = pitSides(s.side);
  const x = (t) => (t - 0.5) * L;
  const ease = (t) => t * t * (3 - 2 * t);
  const rise = (t) =>
    O * ease(Math.max(0, Math.min(1, (Math.min(t, 1 - t) - pitApproachStart) / (pitBayStart - pitApproachStart))));
  const half = W / 2;
  const bounds = (t) => [
    -half - (branches.includes(-1) ? rise(t) : 0),
    half + (branches.includes(1) ? rise(t) : 0),
  ];
  function point(t, d) {
    const [lo, hi] = bounds(t);
    const y =
      d < -half
        ? lo + d + half
        : d > half
          ? hi + d - half
          : mix(lo, hi, (d + half) / W);
    return [x(t), y];
  }
  const template = stations(
    p,
    Math.max(100, Math.min(256, Math.ceil(Math.sqrt(O / 0.004)))),
    [pitApproachStart, pitBayStart, 1 - pitBayStart, 1 - pitApproachStart],
  );
  const widthAt = (t) => {
    const [lo, hi] = bounds(t);
    return hi - lo;
  };
  const outerLane = (sign) => (sign > 0 ? laneOffsets.at(-1) : laneOffsets[0]);
  const path = {
    stations: template,
    point,
    tangent: () => [1, 0],
    normal: () => [0, 1],
    minLength: L,
    widthAt,
    atOffset(t, d) {
      const [lo, hi] = bounds(t);
      return [x(t), d + (hi + lo) / 2];
    },
    laneOffsets(t) {
      const r = rise(t),
        b = bounds(t),
        mid = (b[0] + b[1]) / 2;
      return [
        ...laneOffsets,
        ...branches.map((sign) => outerLane(sign) + sign * r),
      ].map((y) => y - mid);
    },
    edgeLength(sign) {
      let sum = 0,
        previous = point(0, sign * half);
      for (const t of template.slice(1)) {
        const next = point(t, sign * half);
        sum += Math.hypot(next[0] - previous[0], next[1] - previous[1]);
        previous = next;
      }
      return sum;
    },
  };
  const lanePaths = laneOffsets.map((y) => [
    [x(0), y],
    [x(1), y],
  ]);
  const branchTs = template.filter((t) => t >= pitApproachStart && t <= 1 - pitApproachStart);
  const forks = branches.map((sign) => {
    const y = outerLane(sign);
    const branch = branchTs.map((t) => [x(t), y + sign * rise(t)]);
    lanePaths.push(branch);
    return pitTurnoutProfile(p, branch, y, sign);
  });
  return { path, lanePaths, forks, branches };
}

// Keep both points and merge off every printed road seam. Allocate candidate seams
// in the remaining length, then sample the unchanged outer shoulders at those cuts.
export function pitPrintPath(path, forks, p, electrical) {
  const shift = (x) => 0.5 + x / p.length;
  const fork = forks[0];
  let protectedStart = fork.mainToe[0] - 5;
  let protectedEnd = Math.max(fork.guardEndX + 2, electrical?.protectedEndX ?? -Infinity);
  // The slider and the motor of a driven flipper lie in one road segment.
  if (electrical?.driveSpan) {
    protectedStart = Math.min(protectedStart, electrical.driveSpan.min - 1);
    protectedEnd = Math.max(protectedEnd, electrical.driveSpan.max + 1);
  }
  const lo = Math.max(0, shift(protectedStart));
  const hi = Math.min(1, shift(protectedEnd));
  const stock = [
    [0, lo],
    [hi, 1 - hi],
    [1 - lo, 1],
  ].filter(([a, b]) => b > a);
  if (!stock.length && p.segments > 1)
    throw Error(
      'The turnout and merge occupy every possible seam. Lengthen the pit or use one road segment.',
    );
  const free = stock.reduce((sum, [a, b]) => sum + b - a, 0);
  const cuts = fractions(p.segments).map((n) => {
    let d = n * free;
    for (const [a, b] of stock) {
      if (d <= b - a) return a + d;
      d -= b - a;
    }
    return 1;
  });
  cuts[0] = 0;
  cuts[cuts.length - 1] = 1;
  const actual = (t) => {
    const idx = Math.min(cuts.length - 2, Math.floor(t * p.segments));
    return cuts[idx] + (cuts[idx + 1] - cuts[idx]) * (t * p.segments - idx);
  };
  const inverse = (u) => {
    let idx = 0;
    while (idx < cuts.length - 2 && u > cuts[idx + 1]) idx++;
    return (idx + (u - cuts[idx]) / (cuts[idx + 1] - cuts[idx])) / p.segments;
  };
  const stations = [
    ...new Set([
      ...path.stations.map(inverse),
      ...fractions(p.segments),
      ...fractions(p.borderSegments),
    ]),
  ].sort((a, b) => a - b);
  return {
    ...path,
    stations,
    cuts,
    point: (t, d) => path.point(actual(t), d),
    atOffset: (t, d) => path.atOffset(actual(t), d),
    laneOffsets: (t) => path.laneOffsets(actual(t)),
    widthAt: (t) => path.widthAt(actual(t)),
    segmentLengths: cuts.slice(1).map((cut, i) => (cut - cuts[i]) * p.length),
  };
}

export function diamondLayout(p) {
  const angle = (p.special.crossingAngle * Math.PI) / 180;
  const dirs = [
      [1, 0],
      [Math.cos(angle), Math.sin(angle)],
    ],
    laneOffsets = offsets(p);
  const h = p.width / 2,
    end = p.length / 2;
  const bigShelf = p.slotWidth / 2 + braidSpan(p);
  const gap =
    (bigShelf * (1 + Math.abs(Math.cos(angle))) + p.special.isolation) /
    Math.sin(angle);
  const roads = dirs.map((axis, i) => {
    const normal = left(axis),
      otherNormal = left(dirs[1 - i]);
    const factor = dot(otherNormal, axis),
      along = dot(otherNormal, normal);
    const laneData = laneOffsets.map((d) => {
      const crossings = laneOffsets
        .map((q) => (q - along * d) / factor)
        .sort((a, b) => a - b);
      return { d, crossings };
    });
    const arms = [-1, 1].map((sign) => {
      const direction = sign * Math.sign(factor);
      const seam = (d) =>
        (direction * Math.max(h, Math.abs(d)) - along * d) / factor;
      const reach = (d) => sign * (sign * end - seam(d));
      const num = Math.max(1, p.segments - 1);
      let borderEnds;
      if (p.borderEnds) {
        borderEnds = {};
        for (const side of ['inner', 'outer']) {
          const key = sign === 1 ? 'finish' : 'start';
          if (p.borderEnds[side]?.[key])
            borderEnds[side] = { [key]: p.borderEnds[side][key] };
        }
      }
      const config = {
        ...p,
        kind: 'straight',
        length: reach(0),
        segments: num,
        borderEnds,
      };
      const path = {
        point(t, d = 0) {
          return pointOnAxis(
            axis,
            sign === 1 ? mix(seam(d), end, t) : mix(-end, seam(d), t),
            d,
          );
        },
        tangent: () => axis,
        normal: () => normal,
        minLength: Math.min(reach(h), reach(-h)),
        edgeLength: (s) => reach(s * h),
        stations: stations(config, 32),
        laneOffsets: () => laneOffsets,
      };
      return { sign, config, path, seam, axis, reach };
    });
    return { axis, normal, laneData, arms };
  });
  const breaks = roads[0].laneData.flatMap(({ d, crossings }) =>
    crossings.map((x) => ({ x, y: d, radius: gap })),
  );
  const lanePaths = roads.flatMap(({ axis, laneData }) =>
    laneData.map(({ d }) => [-end, end].map(x => pointOnAxis(axis, x, d))));
  const core = roads[0].arms;
  const coreLoop = [
    core[0].path.point(1, -h),
    core[1].path.point(0, -h),
    core[1].path.point(0, h),
    core[0].path.point(1, h),
  ];
  return { roads, breaks, coreLoop, gap, lanePaths };
}
