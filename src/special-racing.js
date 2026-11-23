import { braidSpan, dot, left, minus, move, unit } from './geometry/solids.js';
import { measuredLane, vertexNormals } from './geometry/import-track.js';
import { borderEndProfile } from './geometry/border-ends.js';
import { borderPath, maxBorderWidth } from './geometry/border-profile.js';
import { laneOffsetAt, validateLaneBends } from './lane-adjustment.js';
import { hasSlotPosition } from './slot-position.js';

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sample = (steps, at) =>
  Array.from({ length: steps + 1 }, (_, i) => at(i / steps));
const smooth = (t) => t * t * t * (10 + t * (-15 + 6 * t));
const mix = (a, b, t) => move(a, minus(b, a), t);
const degrees = (angle) => (angle * Math.PI) / 180;
export const isRacingPiece = (p) =>
  ['hairpin', 'duel', 'chicane'].includes(p.special?.type);

function within(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max)
    throw Error(name + ' must be between ' + min + ' and ' + max + '.');
}

// Each shift consists of two true tangent circular arcs and a diagonal straight.
// Solve the endpoint displacement for turn angle using tan(angle / 2). Increasing
// the specified footprint length opens the line at the same requested radius.
function shiftGeometry(run, offset, radius, label) {
  const discriminant = run * run - offset * (4 * radius - offset);
  const z = offset / (run + Math.sqrt(Math.max(0, discriminant)));
  const angle = 2 * Math.atan(z);
  const diagonal =
    run * Math.cos(angle) + (offset - 2 * radius) * Math.sin(angle);
  if (discriminant < -1e-7 || angle >= Math.PI / 2 || diagonal < -1e-6)
    throw Error(
      'The ' +
        label +
        ' bend cannot fit its radius and offset. Lengthen the chicane, reduce its offset or use a smaller ' +
        label +
        ' radius.',
    );
  return { angle, diagonal: Math.max(0, diagonal) };
}

export function validateRacingPiece(p) {
  const s = p.special;
  // The racing lines are laid out about the road centre.
  if (hasSlotPosition(p))
    throw Error('Special pieces define their own lanes. Set Slot position to Centred.');
  if (s.type === 'chicane') {
    if (p.kind !== 'straight')
      throw Error('The bus-stop chicane uses a straight entry and exit.');
    if (!['left', 'right'].includes(s.hand))
      throw Error('Choose the first turn direction.');
    within(s.offset, 1, 5000, 'Chicane lateral offset (mm)');
    const shoulder =
      p.width / 2 +
      Math.max(
        ...['inner', 'outer'].map((side) =>
          p.borderSide === side || p.borderSide === 'both'
            ? maxBorderWidth(p, side)
            : 0,
        ),
      );
    for (const [label, r] of [
      ['entry', s.entryRadius],
      ['exit', s.exitRadius],
    ]) {
      within(r, 1, 20000, 'Chicane ' + label + ' radius (mm)');
      if (r <= shoulder + 0.1)
        throw Error(
          'The ' +
            label +
            ' radius must exceed ' +
            Number((shoulder + 0.1).toFixed(2)) +
            ' mm to clear the road and its borders.',
        );
      shiftGeometry(0.42 * p.length, s.offset, r, label);
    }
    return;
  }
  if (p.kind !== 'curve' || p.lanes !== 2)
    throw Error(
      'This racing corner needs a two-lane curve. Choose a two-lane pack.',
    );
  if (p.laneAdjustment)
    throw Error(
      'This corner defines its own racing lines. Set lane spacing through the piece to Uniform.',
    );
  if (s.type === 'hairpin') {
    within(p.angle, 45, 210, 'Crossover hairpin sweep (degrees)');
    within(s.crossingAt, 0.12, 0.38, 'First crossing position');
    within(s.isolation, 0.2, 12, 'Braid isolation clearance (mm)');
  } else {
    within(p.angle, 70, 145, 'Late-apex corner sweep (degrees)');
    within(s.apex, 0.52, 0.75, 'Outside lane apex position');
  }
}

const bendSteps = (angle, radius) =>
  Math.max(
    2,
    Math.ceil(angle / (2 * Math.acos(1 - 0.025 / Math.max(1, radius)))),
  );

function chicaneAxis(p) {
  const { offset, hand, entryRadius, exitRadius } = p.special;
  const sign = hand === 'left' ? 1 : -1;
  const spans = [];
  let x = -p.length / 2,
    y = 0,
    heading = 0,
    total = 0;
  function append(length, curvature) {
    if (length < 1e-8) return;
    const start = [x, y],
      a = heading,
      end = total + length;
    function frame(d) {
      const b = a + curvature * d;
      const xy = curvature
        ? [
            start[0] + (Math.sin(b) - Math.sin(a)) / curvature,
            start[1] + (Math.cos(a) - Math.cos(b)) / curvature,
          ]
        : move(start, [Math.cos(a), Math.sin(a)], d);
      return { xy, direction: [Math.cos(b), Math.sin(b)] };
    }
    spans.push({ start: total, end, frame, curvature });
    [x, y] = frame(length).xy;
    heading += curvature * length;
    total = end;
  }
  function shift(radius, turn, label) {
    const { angle, diagonal } = shiftGeometry(
      0.42 * p.length,
      offset,
      radius,
      label,
    );
    append(radius * angle, turn / radius);
    append(diagonal, 0);
    append(radius * angle, -turn / radius);
  }
  append(0.04 * p.length, 0);
  shift(entryRadius, sign, 'entry');
  append(0.08 * p.length, 0);
  shift(exitRadius, -sign, 'exit');
  append(0.04 * p.length, 0);
  const margin =
    p.width / 2 +
    Math.max(
      0,
      ...['inner', 'outer'].map((side) =>
        p.borderSide === side || p.borderSide === 'both'
          ? maxBorderWidth(p, side)
          : 0,
      ),
    );
  const knots = spans.flatMap((span) => {
    const length = span.end - span.start;
    const steps = span.curvature
      ? bendSteps(
          Math.abs(length * span.curvature),
          1 / Math.abs(span.curvature) + margin,
        )
      : 1;
    return sample(steps, (t) => (span.start + t * length) / total);
  });
  return {
    knots,
    total,
    frame(t) {
      const travel = t * total;
      const span = spans.find((item) => travel <= item.end) ?? spans.at(-1);
      return span.frame(travel - span.start);
    },
  };
}

function curveAxis(p) {
  const angle = degrees(p.angle),
    arc = p.radius * angle;
  const entry = p.special.type === 'duel' ? (p.radius * 150) / 460 : 0;
  const exit = p.special.type === 'duel' ? (p.radius * 210) / 460 : 0;
  const total = entry + arc + exit;
  const arcT = (t) => (entry + arc * t) / total;
  const radial = (t, r) => {
    const a = (t - 0.5) * angle;
    return [r * Math.sin(a), r * Math.cos(a) - p.radius];
  };
  const direction = (t) => [
    Math.cos((t - 0.5) * angle),
    -Math.sin((t - 0.5) * angle),
  ];
  const steps = bendSteps(
    angle,
    Math.max(
      p.curveGridRadius || 0,
      p.radius +
        p.width / 2 +
        (['both', 'outer'].includes(p.borderSide)
          ? maxBorderWidth(p, 'outer')
          : 0),
    ),
  );
  const knots = [0, ...sample(steps, arcT), 1];
  function frame(t) {
    const u = Math.max(0, Math.min(1, (total * t - entry) / arc)),
      dir = direction(u);
    const longitudinal = total * t - entry - arc * u;
    return { xy: move(radial(u, p.radius), dir, longitudinal), direction: dir };
  }
  function station(xy) {
    const a = Math.atan2(xy[0], xy[1] + p.radius);
    if (a < -angle / 2)
      return (
        (entry + dot(minus(xy, radial(0, p.radius)), direction(0))) / total
      );
    if (a > angle / 2)
      return (
        (entry + arc + dot(minus(xy, radial(1, p.radius)), direction(1))) /
        total
      );
    return arcT(a / angle + 0.5);
  }
  return {
    frame,
    knots,
    total,
    angle,
    radial,
    direction,
    station,
    entry,
    exit,
  };
}

function axisFor(p) {
  return p.special.type === 'chicane' ? chicaneAxis(p) : curveAxis(p);
}
const across = (frame, v) => move(frame.xy, left(frame.direction), v);

export function racingTrackPoint(p, t, v) {
  return across(axisFor(p).frame(t), v);
}

// The later route joins one large circular exit arc, tangent at its measured
// apex and at the exit straight. The shorter lane keeps turning farther down
// the exit. Both end at the standard pack spacing and join direction.
function duelLanes(p, axis) {
  const h = p.laneSpacing / 2,
    { angle, radial, direction } = axis;
  const laneWall = Math.max(braidSpan(p), p.wall);
  const shoulderClearance =
    p.width / 2 -
    h -
    p.slotWidth / 2 -
    laneWall -
    1;
  const channel = p.slotWidth + 2 * laneWall;
  if (shoulderClearance <= 0 || p.laneSpacing <= channel + 1)
    throw Error(
      'Widen the road or reduce the slot and braid widths to leave room for the two racing lines.',
    );
  const scale = Math.min(
    p.laneSpacing / 100,
    shoulderClearance / 26,
    (p.laneSpacing - channel - 1) / 40,
  );
  const aPeak = 0.36,
    bPeak = p.special.apex,
    inner = p.radius - h,
    outer = p.radius + h;
  const insetA = 25 * scale,
    insetB = 39 * scale;
  const steps = Math.max(64, axis.knots.length);
  function approach(base, inset, peak) {
    return [
      move(radial(0, base), direction(0), -axis.entry),
      ...sample(steps, (t) => radial(t * peak, base - inset * smooth(t))),
    ];
  }
  const laneA = approach(inner, insetA, aPeak),
    laneB = approach(outer, insetB, bPeak);
  const a = laneA.at(-1),
    bRadius = outer - insetB,
    da = angle * (1 - aPeak),
    db = angle * (1 - bPeak);
  const aRadius = inner - insetA;
  const control = move(
    a,
    direction(aPeak),
    (inner - aRadius * Math.cos(da)) / Math.sin(da),
  );
  const bExit = insetB / Math.tan(db / 2);
  if (bExit >= axis.exit - 0.2)
    throw Error(
      'The late apex leaves too little exit straight. Increase the centre radius or move the apex earlier.',
    );
  const aExit = move(
    radial(1, inner),
    direction(1),
    Math.max(axis.exit * 0.77, (bExit + axis.exit) / 2),
  );
  const c1 = mix(a, control, 0.76),
    c2 = mix(aExit, control, 0.7);
  const bCurveRadius = bRadius + insetB / (1 - Math.cos(db));
  const bendCentre = radial(bPeak, bRadius - bCurveRadius);
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    laneA.push(
      mix(
        mix(mix(a, c1, u), mix(c1, c2, u), u),
        mix(mix(c1, c2, u), mix(c2, aExit, u), u),
        u,
      ),
    );
    const v = radial(bPeak + u * (1 - bPeak), bCurveRadius);
    laneB.push([bendCentre[0] + v[0], bendCentre[1] + v[1] + p.radius]);
  }
  laneA.push(move(radial(1, inner), direction(1), axis.exit));
  laneB.push(move(radial(1, outer), direction(1), axis.exit));
  return [laneA, laneB];
}

// Full lane order is restored at the far joint. Each swap uses a smooth
// transition with a nonzero crossing angle and zero slope at either end.
function hairpinOffset(p, lane, t) {
  const x = 2 * Math.min(t, 1 - t),
    c = 2 * p.special.crossingAt;
  // Remap the selected crossing to the middle of a cosine. Both approaches
  // have zero slope at the joint and the apex, with a continuous slope at c.
  const phase = (x * (1 - c)) / (c + x * (1 - 2 * c));
  return (lane - 0.5) * p.laneSpacing * Math.cos(Math.PI * phase);
}

function offsetOfLane(path, t, lane) {
  const centre = path.point(t, 0),
    dir = path.tangent(t),
    norm = left(dir);
  let best = Infinity;
  for (let i = 1; i < lane.length; i++) {
    const a = minus(lane[i - 1], centre),
      b = minus(lane[i], centre);
    const da = dot(a, dir),
      db = dot(b, dir);
    if (da > 1e-7 || db < -1e-7 || db - da <= 1e-10) continue;
    const v = dot(mix(a, b, Math.max(0, Math.min(1, -da / (db - da)))), norm);
    if (Math.abs(v) < Math.abs(best)) best = v;
  }
  return best;
}

function distanceToLane(xy, curve) {
  let closest = Infinity;
  for (let i = 1; i < curve.length; i++) {
    const origin = curve[i - 1],
      v = minus(curve[i], origin);
    const t = Math.max(0, Math.min(1, dot(minus(xy, origin), v) / dot(v, v)));
    closest = Math.min(closest, distance(xy, move(origin, v, t)));
  }
  return closest;
}

// Find full-width, square braid ends on each lane. Leave the guide cutter
// continuous across the insert. Distance is taken to the entire opposing
// guide, so a change in crossing angle also changes the insulating span.
function isolationSites(p, path, axis) {
  const acrossWidth =
    2 * (p.slotWidth / 2 + braidSpan(p)) + p.special.isolation;
  const crossings = [p.special.crossingAt, 1 - p.special.crossingAt];
  const sites = path.measuredLanes.map((lane, i) => {
    const other = path.laneCurves[1 - i];
    const ts = path.laneStations;
    return crossings.map((c, j) => {
      const k = ts.findIndex((t) => Math.abs(t - c) < 1e-10);
      const cT = lane.ts[k];
      const mid = lane.ts[ts.findIndex((t) => Math.abs(t - 0.5) < 1e-10)];
      const bounds = j === 0 ? [0, mid] : [mid, 1];
      const result = bounds.map((outside) => {
        let clear = outside,
          inside = cT;
        if (distanceToLane(lane.at(clear), other) <= acrossWidth + 1)
          throw Error(
            'Braid breaks run together. Increase lane spacing, or reduce the braid width or isolation clearance.',
          );
        for (let n = 0; n < 25; n++) {
          const t = (clear + inside) / 2;
          if (distanceToLane(lane.at(t), other) < acrossWidth) inside = t;
          else clear = t;
        }
        return clear;
      });
      return result;
    });
  });
  const protectedStations = crossings.map((_, j) => {
    const starts = [],
      ends = [];
    path.measuredLanes.forEach((lane, i) => {
      const [a, b] = sites[i][j];
      const pad = (p.wall + p.braidFeedLength + 0.5) / lane.total;
      starts.push(axis.station(lane.at(a - pad)));
      ends.push(axis.station(lane.at(b + pad)));
    });
    return [Math.min(...starts), Math.max(...ends)];
  });
  return { sites, protectedStations };
}

export function racingPath(p) {
  validateRacingPiece(p);
  const axis = axisFor(p);
  const stations = new Set(axis.knots);
  for (const count of [32, p.segments, p.borderSegments])
    sample(count, (t) => stations.add(t));
  stations.add(p.apexPosition);
  const path = {
    total: axis.total,
    stations: [...stations].sort((a, b) => a - b),
    point: (t, v) => across(axis.frame(t), v),
    tangent: (t) => axis.frame(t).direction,
    normal: (t) => left(axis.frame(t).direction),
  };
  const type = p.special.type;
  if (type === 'duel') {
    path.laneCurves = duelLanes(p, axis);
    const shoulder =
      p.width / 2 -
      (p.slotWidth / 2 +
        Math.max(braidSpan(p), p.hollow ? p.wall : 0));
    for (const lane of path.laneCurves) {
      let previous = -Infinity;
      for (const xy of lane) {
        const t = axis.station(xy);
        const frame = axis.frame(t);
        if (
          t < previous - 1e-7 ||
          Math.abs(dot(minus(xy, frame.xy), left(frame.direction))) >= shoulder
        )
          throw Error(
            'The late-apex slot runs out of road. Increase the width or centre radius, or move the apex earlier.',
          );
        previous = t;
      }
    }
    path.laneOffsets = (t) =>
      path.laneCurves.map((curve) => offsetOfLane(path, t, curve));
  } else {
    path.laneOffsets = (t) =>
      Array.from({ length: p.lanes }, (_, i) =>
        type === 'hairpin' ? hairpinOffset(p, i, t) : laneOffsetAt(p, i, t),
      );
    const laneStations = new Set(type === 'hairpin' ? [] : axis.knots);
    if (type === 'hairpin') {
      const steps = Math.max(160, axis.knots.length * 2);
      sample(steps, (t) => laneStations.add(t));
      for (const t of [p.special.crossingAt, 0.5, 1 - p.special.crossingAt])
        laneStations.add(t);
    } else if (p.laneAdjustment) sample(160, (t) => laneStations.add(t));
    path.laneStations = [...laneStations]
      .sort((a, b) => a - b)
      .filter((t, i, ts) => !i || t - ts[i - 1] > 1e-10);
    path.laneCurves = Array.from({ length: p.lanes }, (_, i) =>
      path.laneStations.map((t) => path.point(t, path.laneOffsets(t)[i])),
    );
  }
  path.laneNormals = path.laneCurves.map((lane) => {
    validateLaneBends(p, lane);
    const normals = vertexNormals(lane);
    normals[0] = left(path.tangent(0));
    normals[normals.length - 1] = left(path.tangent(1));
    return normals;
  });
  path.measuredLanes = path.laneCurves.map((lane, i) =>
    measuredLane(lane, path.laneNormals[i]),
  );
  function edgeSpan(sign, a, b) {
    const ts = [a, ...path.stations.filter((t) => t > a && t < b), b];
    const xy = ts.map((t) => path.point(t, (sign * p.width) / 2));
    return xy.slice(1).reduce((len, v, i) => len + distance(xy[i], v), 0);
  }
  path.edgeLength = (sign) => edgeSpan(sign, 0, 1);
  path.segmentLengths = Array.from({ length: p.segments }, (_, i) =>
    Math.min(
      ...[-1, 1].map((sign) =>
        edgeSpan(sign, i / p.segments, (i + 1) / p.segments),
      ),
    ),
  );
  path.minLength = Math.min(path.edgeLength(-1), path.edgeLength(1));
  if (type === 'hairpin') {
    Object.assign(path, isolationSites(p, path, axis));
  }
  return path;
}

// Cut a small two-ended window from the actual racing geometry. Translate and
// rotate its ends into their assembled position so both clip pockets and their
// neighbouring slots occupy the same relative positions as the full piece.
export function racingJointSamplePath(source, p, joint, length) {
  const internal = joint === 'seam';
  const middle = p.segments > 1 ? Math.floor(p.segments / 2) / p.segments : 0.5;
  const start = internal ? middle : 1;
  const finish = internal ? middle : 0;
  let before = Math.min(length / (2 * source.total), start);
  let after = Math.min(length / (2 * source.total), 1 - finish);
  for (const [lo, hi] of source.protectedStations ?? []) {
    if (internal && lo <= middle && middle <= hi)
      throw Error(
        'The selected road seam passes through the crossover. Change the segment count before exporting its test joint.',
      );
    if (hi < start) before = Math.min(before, start - hi);
    if (lo > finish) after = Math.min(after, lo - finish);
  }
  const station = (t) =>
    t < 0.5 ? start + (2 * t - 1) * before : finish + (2 * t - 1) * after;
  const origin = (t) => (t < 0.5 ? start : finish);
  function local(t, v) {
    const longitudinal = source.tangent(origin(t));
    return [dot(v, longitudinal), dot(v, left(longitudinal))];
  }
  const path = {
    point(t, v) {
      return local(
        t,
        minus(source.point(station(t), v), source.point(origin(t), 0)),
      );
    },
    tangent(t) {
      return local(t, source.tangent(station(t)));
    },
    laneOffsets(t) {
      return source.laneOffsets(station(t));
    },
  };
  const ts = new Set(sample(80, (t) => t));
  for (const t of source.stations) {
    if (t > start - before && t < start)
      ts.add(0.5 + (0.5 * (t - start)) / before);
    if (t > finish && t < finish + after)
      ts.add(0.5 + (0.5 * (t - finish)) / after);
  }
  const exact = [...ts].map((t) =>
    Math.abs(2 * t - Math.round(2 * t)) < 2e-10 ? Math.round(2 * t) / 2 : t,
  );
  path.stations = exact
    .sort((a, b) => a - b)
    .filter((t, i, all) => !i || t - all[i - 1] > 1e-10);
  path.laneCurves = source.laneCurves.map((_, i) =>
    path.stations.map((t) => path.point(t, path.laneOffsets(t)[i])),
  );
  path.laneNormals = path.laneCurves.map((lane) => vertexNormals(lane));
  path.normal = (t) => left(path.tangent(t));
  path.segmentLengths = [
    [0, 0.5],
    [0.5, 1],
  ].map(([a, b]) =>
    Math.min(
      ...[-1, 1].map((sign) => {
        const line = path.stations
          .filter((t) => t >= a && t <= b)
          .map((t) => path.point(t, (sign * p.width) / 2));
        return line
          .slice(1)
          .reduce((sum, xy, i) => sum + distance(xy, line[i]), 0);
      }),
    ),
  );
  return path;
}

export function racingPlan(p) {
  const path = racingPath(p),
    edge = p.width / 2;
  const bound = (ts, fn) => ts.map((t) => path.point(t, fn(t)));
  const outline = [
    ...bound(path.stations, () => -edge),
    ...bound(path.stations, () => edge).reverse(),
  ];
  const borders = [];
  for (const [side, sign] of [
    ['inner', -1],
    ['outer', 1],
  ]) {
    if (p.borderSide !== side && p.borderSide !== 'both') continue;
    const b = borderEndProfile(borderPath(path, p, side), p, side);
    const rim = b.stations.map((t) => b.path.point(t, sign * edge));
    const free = b.stations.map((t) =>
      b.path.point(t, sign * (edge + b.widthAt(t))),
    );
    borders.push([...rim, ...free.reverse()]);
  }
  const details = [];
  if (path.sites && p.braidWidth)
    for (const [i, sites] of path.sites.entries()) {
      const lane = path.measuredLanes[i],
        lo = p.slotWidth / 2 + p.braidGap;
      for (const t of sites.flat())
        for (const sign of [-1, 1])
          details.push([
            lane.atOffset(t, sign * lo),
            lane.atOffset(t, sign * (lo + p.braidWidth)),
          ]);
    }
  return { outlines: [outline], lanes: path.laneCurves, borders, details };
}
