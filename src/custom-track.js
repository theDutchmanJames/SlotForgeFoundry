// Dimensions are millimetres. The waypoints meet at tangent intersections.
// Straight sections and circular bends share a tangent at every join.
import { flatCrossingPlan, MAX_CROSSINGS } from './flat-crossing.js';
import { braidSpan } from './geometry/solids.js';
import { laneOffsetAt, laneProfileSteps, validateLaneAdjustment, validateLaneBends } from './lane-adjustment.js';
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

export function validateCustomTrack(recipe) {
  if (
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

export function customTrackPlan(recipe, p) {
  validateCustomTrack(recipe);
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
  assertSimpleOutline(outline);
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
