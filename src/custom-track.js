// Dimensions are millimetres. The waypoints meet at tangent intersections.
// Straight sections and circular bends share a tangent at every join.
import { flatCrossingPlan, MAX_CROSSINGS } from './flat-crossing.js';
import { braidSpan } from './geometry/solids.js';
import { laneOffsetAt, laneProfileSteps, validateLaneAdjustment, validateLaneBends } from './lane-adjustment.js';
import { hasSlotPosition } from './slot-position.js';
const EPS = 1e-7;
const LIMIT = 20000;
export const MAX_PATH_POINTS = 40;
const derived = new WeakMap();
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const move = (p, u, d) => [p[0] + u[0] * d, p[1] + u[1] * d];
const normal = (u) => [-u[1], u[0]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = (v) => Math.hypot(...v);
const rotate = (v, a) => [
  v[0] * Math.cos(a) - v[1] * Math.sin(a),
  v[0] * Math.sin(a) + v[1] * Math.cos(a),
];
const bounded = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;

export const isFlowing = (recipe) => recipe?.shape === 'flowing';

// A flowing curve is one cubic: it starts at [0, 0], leaves towards its
// first handle and arrives from its second handle at the end point.
function validateFlowing(recipe) {
  const c = recipe.controlPoints;
  if (
    recipe.version !== 1 ||
    !Array.isArray(c) ||
    c.length !== 4 ||
    !c.every(
      (q) =>
        Array.isArray(q) &&
        q.length === 2 &&
        q.every((n) => bounded(n, -LIMIT, LIMIT)),
    )
  )
    throw Error(
      'A flowing curve needs a start, two handles and an end in millimetres, each within ±20,000 mm.',
    );
  if (c[0][0] !== 0 || c[0][1] !== 0)
    throw Error('A flowing curve starts at 0, 0.');
  if (
    norm(sub(c[1], c[0])) < 1 ||
    norm(sub(c[3], c[2])) < 1 ||
    norm(sub(c[3], c[0])) < 1
  )
    throw Error(
      'Move the end at least 1 mm from the start, and each round handle at least 1 mm from its end of the curve.',
    );
  if (
    ['points', 'radius', 'closed', 'crossingMode', 'upperPasses'].some(
      (key) => recipe[key] !== undefined,
    )
  )
    throw Error(
      'A flowing curve has no waypoints, corner radius, closed loop or crossing.',
    );
}

export function validateCustomTrack(recipe) {
  if (isFlowing(recipe)) return validateFlowing(recipe);
  if (
    recipe?.shape !== undefined ||
    recipe?.version !== 1 ||
    !Array.isArray(recipe.points) ||
    recipe.points.length < 2 ||
    recipe.points.length > MAX_PATH_POINTS ||
    !recipe.points.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n) => bounded(n, -LIMIT, LIMIT)),
    ) ||
    !bounded(recipe.radius, 0.1, LIMIT) ||
    (recipe.closed !== undefined && typeof recipe.closed !== 'boolean') ||
    (recipe.crossingMode !== undefined &&
      recipe.crossingMode !== 'flat-pieces') ||
    (recipe.upperPasses !== undefined &&
      (!Array.isArray(recipe.upperPasses) ||
        recipe.upperPasses.length > MAX_CROSSINGS ||
        !recipe.upperPasses.every((p) => p === 'first' || p === 'second')))
  )
    throw Error(
      'A custom path needs 2–40 points in millimetres and a positive bend radius.',
    );
}

export function assertSimpleOutline(outline) {
  const edges = outline
    .map((a, i) => {
      const b = outline[(i + 1) % outline.length];
      return {
        a,
        b,
        i,
        lo: Math.min(a[0], b[0]),
        hi: Math.max(a[0], b[0]),
        bottom: Math.min(a[1], b[1]),
        top: Math.max(a[1], b[1]),
      };
    })
    .sort((a, b) => a.lo - b.lo);
  const side = (a, b, p) => {
    const area = cross(sub(b, a), sub(p, a));
    return Math.abs(area) < EPS ? 0 : Math.sign(area);
  };
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i];
    for (let j = i + 1; j < edges.length && edges[j].lo <= a.hi + EPS; j++) {
      const b = edges[j];
      const delta = Math.abs(a.i - b.i);
      if (
        delta === 1 ||
        delta === edges.length - 1 ||
        a.top < b.bottom - EPS ||
        b.top < a.bottom - EPS
      )
        continue;
      if (
        side(a.a, a.b, b.a) * side(a.a, a.b, b.b) <= 0 &&
        side(b.a, b.b, a.a) * side(b.a, b.b, a.b) <= 0
      )
        throw Error(
          'The road overlaps itself. Move the points apart or reduce the road width.',
        );
    }
  }
}

// A drawn path keeps its lanes about the road centre. Refuse the key before a
// squeeze could carry its shift into the lane paths.
function refuseSlotPosition(p) {
  if (hasSlotPosition(p))
    throw Error('Slot position works on plain straights and curves only. Freeform pieces and imported drawings keep the slot where it is drawn.');
}

// Centre stations of a path through waypoints: straights joined by circular
// bends of one radius.
function waypointStations(recipe, p) {
  const { width } = p;
  const radius = recipe.radius;
  let points = recipe.points;
  if (recipe.closed) {
    let ring = points.slice();
    if (norm(sub(ring[0], ring.at(-1))) < EPS) ring.pop();
    if (ring.length < 3)
      throw Error('Choose at least three distinct points to close a loop.');
    if (ring.some((q, i) => norm(sub(q, ring[(i + 1) % ring.length])) < 0.1))
      throw Error('Consecutive loop points must be at least 0.1 mm apart.');
    // Collinear points are handles, not bends. Removing them from a ring
    // lets its final span share the same tangent and trim rules as the rest.
    ring = ring.filter((q, i) => {
      const u = sub(q, ring.at(i - 1)),
        v = sub(ring[(i + 1) % ring.length], q);
      return dot(u, v) <= 0 || Math.abs(cross(u, v)) > EPS * norm(u) * norm(v);
    });
    if (ring.length < 3)
      throw Error('The loop needs three points that enclose an area.');
    points = [ring.at(-1), ...ring, ring[0]];
  }
  const lengths = [],
    directions = [],
    turns = Array(points.length).fill(0),
    trims = Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    const v = sub(points[i], points[i - 1]),
      d = norm(v);
    if (d < 0.1)
      throw Error(
        'Points ' +
          i +
          ' and ' +
          (i + 1) +
          ' need to be at least 0.1 mm apart.',
      );
    lengths.push(d);
    directions.push(v.map((n) => n / d));
  }
  for (let i = 1; i < points.length - 1; i++) {
    const a = directions[i - 1],
      b = directions[i];
    const turn = Math.atan2(cross(a, b), dot(a, b));
    if (Math.abs(turn) < EPS) continue;
    if (radius <= width / 2)
      throw Error(
        'The centre radius must exceed half the road width (' +
          width / 2 +
          ' mm) to keep the inside edge open.',
      );
    turns[i] = turn;
    trims[i] = radius * Math.tan(Math.abs(turn) / 2);
  }
  let runStart = 0,
    straightLength = 0;
  for (let i = 0; i < lengths.length; i++) {
    straightLength += lengths[i];
    // An extra handle on a straight span does not shorten that span.
    if (i + 1 < lengths.length && !turns[i + 1]) continue;
    if (trims[runStart] + trims[i + 1] > straightLength + EPS)
      throw Error(
        'The bend will not fit between points ' +
          (runStart + 1) +
          ' and ' +
          (i + 2) +
          '. Move them apart or reduce the radius.',
      );
    runStart = i + 1;
    straightLength = 0;
  }
  if (recipe.closed && trims[1] + trims.at(-2) > lengths[0] + EPS)
    throw Error(
      'The bend will not fit across the loop closure. Move its points apart or reduce the radius.',
    );
  const centers = [],
    normals = [];
  function station(point, tangent) {
    if (centers.length && norm(sub(point, centers.at(-1))) < EPS) return;
    centers.push(point);
    normals.push(normal(tangent));
  }
  if (!recipe.closed) station(points[0], directions[0]);
  // Bound chord sag on the outside road edge, where facets are longest.
  const step = 2 * Math.acos(1 - 0.035 / (radius + width / 2));
  for (let i = 1; i < points.length - 1; i++) {
    const angle = turns[i];
    if (!angle) continue;
    const u = directions[i - 1];
    const start = move(points[i], u, -trims[i]);
    const center = move(start, normal(u), Math.sign(angle) * radius);
    const radial = sub(start, center);
    const n = Math.max(1, Math.ceil(Math.abs(angle) / step));
    if (centers.length + n > 1800)
      throw Error(
        'This piece has too many bends for a live preview. Split the path into two pieces.',
      );
    station(start, u);
    for (let j = 1; j <= n; j++) {
      const a = (angle * j) / n;
      station(move(center, rotate(radial, a), 1), rotate(u, a));
    }
  }
  if (recipe.closed) {
    if (norm(sub(centers[0], centers.at(-1))) < EPS) {
      centers[centers.length - 1] = centers[0];
      normals[normals.length - 1] = normals[0];
    } else {
      centers.push(centers[0]);
      normals.push(normals[0]);
    }
  } else station(points.at(-1), directions.at(-1));
  // Both sides, the lane paths and the bridge splitter use corresponding
  // stations. Insert points on the existing chords, including long straights.
  let fractions;
  if (p.laneAdjustment) {
    const distances = [0];
    for (let i = 1; i < centers.length; ++i)
      distances.push(distances[i - 1] + norm(sub(centers[i], centers[i - 1])));
    const original = distances.map((d) => d / distances.at(-1));
    const count = laneProfileSteps(p);
    fractions = [
      ...new Set([
        ...original,
        ...Array.from({ length: count + 1 }, (_, i) => i / count),
      ]),
    ]
      .sort((a, b) => a - b)
      .filter((v, i, all) => !i || v - all[i - 1] > 1e-12 || v === 1);
    let j = 1;
    const frames = fractions.map((t) => {
      while (j < original.length - 1 && original[j] < t) j++;
      const u = (t - original[j - 1]) / (original[j] - original[j - 1]);
      return [centers, normals].map((arr) =>
        move(arr[j - 1], sub(arr[j], arr[j - 1]), u),
      );
    });
    centers.splice(0, centers.length, ...frames.map((f) => f[0]));
    normals.splice(0, normals.length, ...frames.map((f) => f[1]));
  }
  return { centers, normals, fractions };
}

// Position, unit tangent and signed curvature of the cubic at t. A left-hand
// bend has positive curvature, and the normal points to its inside.
function cubicAt(c, t) {
  const u = 1 - t;
  const v = [0, 1].map(
    (i) =>
      3 * u * u * (c[1][i] - c[0][i]) +
      6 * u * t * (c[2][i] - c[1][i]) +
      3 * t * t * (c[3][i] - c[2][i]),
  );
  const a = [0, 1].map(
    (i) =>
      6 * u * (c[2][i] - 2 * c[1][i] + c[0][i]) +
      6 * t * (c[3][i] - 2 * c[2][i] + c[1][i]),
  );
  const speed = norm(v);
  if (speed < 0.001)
    throw Error(
      'The curve stops and turns back on itself. Move the two round handles apart.',
    );
  const tangent = [v[0] / speed, v[1] / speed];
  return {
    t,
    // The ends are the handle points themselves, free of rounding.
    point:
      t === 0
        ? c[0].slice()
        : t === 1
          ? c[3].slice()
          : [0, 1].map(
              (i) =>
                u * u * u * c[0][i] +
                3 * u * u * t * c[1][i] +
                3 * u * t * t * c[2][i] +
                t * t * t * c[3][i],
            ),
    tangent,
    normal: normal(tangent),
    curvature: cross(v, a) / speed ** 3,
  };
}

// Centre stations of a flowing curve, with the checks that keep its offsets
// printable. An offset d along the normal has 1 - d * curvature of the centre
// line's length: at zero it pinches to a point, below zero it folds over.
const DENSE = 2048;
const SAG = 0.035;
function flowingStations(c, p) {
  const { width, lanes, laneSpacing } = p;
  const cache = new Map();
  const at = (t) => {
    let q = cache.get(t);
    if (!q) cache.set(t, (q = cubicAt(c, t)));
    return q;
  };
  const lengths = [0],
    curvatures = [];
  let tightest = at(0);
  for (let i = 0; i <= DENSE; i++) {
    const q = at(i / DENSE);
    curvatures.push(q.curvature);
    if (Math.abs(q.curvature) > Math.abs(tightest.curvature)) tightest = q;
    if (i)
      lengths.push(
        lengths[i - 1] + norm(sub(q.point, at((i - 1) / DENSE).point)),
      );
  }
  const tightRadius = 1 / Math.abs(tightest.curvature);
  if (1 - (width / 2) / tightRadius <= 0.002) {
    // Lanes count from the right of the direction of travel.
    const lane = tightest.curvature > 0 ? lanes : 1;
    if (1 - (((lanes - 1) / 2) * laneSpacing) / tightRadius <= 0.002)
      throw Error(
        'Lane ' +
          lane +
          ' folds on the inside of the bend. Drag the round handles further out or move the end away to open the bend, or reduce the lane spacing.',
      );
    throw Error(
      'The inside road edge folds: the tightest part of the curve has a ' +
        Number(tightRadius.toFixed(1)) +
        ' mm centre radius and needs more than half the road width (' +
        width / 2 +
        ' mm). Drag the round handles further out or move the end away to open the bend.',
    );
  }
  // Bound chord sag on the centre line and on both road edges.
  const edge = (q, d) => move(q.point, q.normal, d);
  const stations = [at(0)];
  function split(a, b, depth) {
    let sag = 0;
    for (const d of [-width / 2, 0, width / 2]) {
      const start = edge(a, d),
        chord = sub(edge(b, d), start),
        length = norm(chord);
      for (const f of [0.25, 0.5, 0.75]) {
        const q = sub(edge(at(a.t + (b.t - a.t) * f), d), start);
        sag = Math.max(
          sag,
          length < EPS ? norm(q) : Math.abs(cross(chord, q)) / length,
        );
      }
    }
    if (b.t - a.t > 1 / 16 || sag > SAG) {
      const middle = at((a.t + b.t) / 2);
      if (!depth || stations.length > 1800)
        throw Error(
          'This curve is too long or too tight for a live preview. Shorten it or open the bend.',
        );
      split(a, middle, depth - 1);
      split(middle, b, depth - 1);
    } else stations.push(b);
  }
  split(at(0), at(1), 14);
  const total = lengths[DENSE];
  const fractionAt = (t) => {
    const x = t * DENSE,
      i = Math.min(DENSE - 1, Math.floor(x));
    return (lengths[i] + (lengths[i + 1] - lengths[i]) * (x - i)) / total;
  };
  let rows = stations.map((q) => [q.t, fractionAt(q.t)]);
  if (p.laneAdjustment) {
    // The lane profile runs on distance along the centre line. Add stations
    // at even distances so a squeeze or spread keeps its own chord error.
    const parameterAt = (fraction) => {
      const target = fraction * total;
      let lo = 0,
        hi = DENSE;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (lengths[mid] <= target) lo = mid;
        else hi = mid;
      }
      return (lo + (target - lengths[lo]) / (lengths[hi] - lengths[lo])) / DENSE;
    };
    const count = laneProfileSteps(p);
    rows = [
      ...rows,
      ...Array.from({ length: count - 1 }, (_, i) => [
        parameterAt((i + 1) / count),
        (i + 1) / count,
      ]),
    ]
      .sort((a, b) => a[0] - b[0])
      .filter((row, i, all) => !i || row[0] - all[i - 1][0] > 1e-9);
  }
  // A drawn piece takes its end directions from the first and last facet.
  // Start and finish on a short straight lead, so both end faces, the joints
  // and the Track Planner ports are square to the curve's own directions. The
  // lead leaves the curve by far less than the sampling tolerance.
  const lead = Math.min(Math.max(0.25, total * 2e-5), total / 8);
  const frames = rows
    .filter(
      ([t, fraction]) =>
        t === 0 ||
        t === 1 ||
        (fraction * total > 2 * lead && (1 - fraction) * total > 2 * lead),
    )
    .map(([t, fraction]) => ({ ...at(t), fraction }));
  const start = frames[0],
    finish = frames.at(-1);
  frames.splice(1, 0, {
    ...start,
    point: move(start.point, start.tangent, lead),
    fraction: lead / total,
  });
  frames.splice(-1, 0, {
    ...finish,
    point: move(finish.point, finish.tangent, -lead),
    fraction: 1 - lead / total,
  });
  return {
    centers: frames.map((q) => q.point),
    normals: frames.map((q) => q.normal),
    fractions: p.laneAdjustment ? frames.map((q) => q.fraction) : undefined,
    stationCurvatures: frames.map((q) => q.curvature),
    curvatures,
  };
}

/**
 * What a flowing curve asks of a car: for each lane its slot length, the
 * radius at every station of the lane path and the smallest radius along it
 * (null for a straight lane).
 */
export function flowingLaneReport(recipe, p, plan = customTrackPlan(recipe, p)) {
  const { stationCurvatures, curvatures } = flowingStations(
    recipe.controlPoints,
    p,
  );
  return plan.lanes.map((points, i) => {
    let length = 0;
    for (let j = 1; j < points.length; j++)
      length += norm(sub(points[j], points[j - 1]));
    let radii, smallest;
    if (p.laneAdjustment) {
      // A squeezed lane leaves its offset curve: measure the sampled path.
      radii = points.map((q, j) => {
        if (!j || j === points.length - 1) return Infinity;
        const a = sub(q, points[j - 1]),
          b = sub(points[j + 1], q);
        const area = Math.abs(cross(a, b));
        return area < 1e-12
          ? Infinity
          : (norm(a) * norm(b) * norm(sub(points[j + 1], points[j - 1]))) /
              (2 * area);
      });
      radii[0] = radii[1] ?? Infinity;
      radii[radii.length - 1] = radii.at(-2) ?? Infinity;
      smallest = Math.min(...radii);
    } else {
      const d = (i - (p.lanes - 1) / 2) * p.laneSpacing;
      const radius = (k) => (k ? Math.abs((1 - d * k) / k) : Infinity);
      radii = stationCurvatures.map(radius);
      smallest = Math.min(...curvatures.map(radius));
    }
    return { length, radii, minRadius: smallest > 1e6 ? null : smallest };
  });
}

export function customTrackPlan(recipe, p) {
  validateCustomTrack(recipe);
  refuseSlotPosition(p);
  validateLaneAdjustment(p);
  const { width, lanes, laneSpacing } = p;
  if (
    !bounded(width, 2, 5000) ||
    !Number.isInteger(lanes) ||
    !bounded(lanes, 1, 8) ||
    !bounded(laneSpacing, 0.1, 1000)
  )
    throw Error(
      'Set a road width of 2–5000 mm, 1–8 lanes and a spacing of 0.1–1000 mm.',
    );
  const laneWidth = p.slotWidth + 2 * braidSpan(p);
  if (
    !Number.isFinite(laneWidth) ||
    (lanes - 1) * laneSpacing + laneWidth >= width ||
    (lanes > 1 && laneWidth >= laneSpacing)
  )
    throw Error(
      'The lane slots and braid recesses need more space. Increase road width or adjust the lane spacing.',
    );
  const flowing = isFlowing(recipe);
  const { centers, normals, fractions } = flowing
    ? flowingStations(recipe.controlPoints, p)
    : waypointStations(recipe, p);
  const offset = (d) => centers.map((c, i) => move(c, normals[i], d));
  const left = offset(width / 2),
    right = offset(-width / 2);
  const slotPaths = Array.from({ length: lanes }, (_, i) =>
    fractions
      ? centers.map((c, j) =>
          move(c, normals[j], laneOffsetAt(p, i, fractions[j])),
        )
      : offset((i - (lanes - 1) / 2) * laneSpacing),
  );
  if (p.laneAdjustment)
    slotPaths.forEach((points) => validateLaneBends(p, points));
  if (recipe.crossingMode === 'flat-pieces' || recipe.closed) {
    const flatCrossing = flatCrossingPlan(centers, left, right, slotPaths, {
      closed: recipe.closed,
      splitClosed: true,
      upperPasses: recipe.upperPasses,
    });
    if (flatCrossing) {
      if (flatCrossing.crossings.length && !recipe.crossingMode)
        throw Error(
          'The road overlaps itself. Choose Flat pieces on supports to keep both passages.',
        );
      for (const section of flatCrossing.sections)
        assertSimpleOutline(section.outlines[0]);
      return {
        outlines: flatCrossing.sections.map((s) => s.outlines[0]),
        lanes: slotPaths,
        flatCrossing,
      };
    }
  }
  const outline = [...right, ...left.slice().reverse()];
  try {
    assertSimpleOutline(outline);
  } catch (err) {
    if (!flowing) throw err;
    throw Error(
      'The road overlaps itself. Move the end or the round handles apart, or reduce the road width.',
    );
  }
  return {
    outlines: [outline],
    lanes: slotPaths,
  };
}

// Derived outlines can be discarded and regenerated on any machine. Never
// trust a saved plan to describe the current recipe or collection profile.
export function refreshCustomTrack(track) {
  if (!track.custom || track.params.kind !== 'import') return track;
  const p = track.params;
  // The key below has no slot position: a plan cached for the centred piece
  // must not answer for one that carries the key.
  refuseSlotPosition(p);
  const key = JSON.stringify([
    track.custom,
    p.width,
    p.lanes,
    p.laneSpacing,
    p.laneAdjustment,
    p.slotWidth,
    p.braidWidth,
    p.braidGap,
  ]);
  let cached = derived.get(track.custom);
  if (!cached || cached.key !== key) {
    cached = { key, plan: customTrackPlan(track.custom, p) };
    derived.set(track.custom, cached);
  }
  return track.plan === cached.plan ? track : { ...track, plan: cached.plan };
}
