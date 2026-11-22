import { circularBore, contains } from './geometry/post-selection.js';

const minimumPitch = 0.001;
const placements = ['balanced', 'corner', 'custom', 'workplane'];
const validPoint = (p) =>
  Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

export function validateSketchGrid(config) {
  if (!config || !Number.isFinite(config.pitch) || config.pitch < minimumPitch)
    throw Error('Set the grid spacing to at least 0.001 mm.');
  if (
    !placements.includes(config.placement) ||
    !validPoint(config.origin) ||
    !Number.isFinite(config.angle) ||
    typeof config.snap !== 'boolean' ||
    typeof config.visible !== 'boolean'
  )
    throw Error(
      'The sketch needs a valid grid origin, orientation and visibility.',
    );
}

export function gridAxisAngle(a, b) {
  if (!validPoint(a) || !validPoint(b) || (a[0] === b[0] && a[1] === b[1]))
    return null;
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

function basis(degrees) {
  const a = ((degrees % 360) * Math.PI) / 180;
  // Avoid axis-parallel edges drifting a cell at exact right angles.
  const clean = (n) => (Math.abs(n) < 1e-15 ? 0 : n);
  const c = clean(Math.cos(a)),
    s = clean(Math.sin(a));
  return { xAxis: [c, s], yAxis: [-s, c] };
}

function outlineBounds(loops, axes) {
  const min = [Infinity, Infinity],
    max = [-Infinity, -Infinity];
  for (const loop of loops) {
    for (const p of loop) {
      const x = dot(p, axes.xAxis),
        y = dot(p, axes.yAxis);
      min[0] = Math.min(min[0], x);
      min[1] = Math.min(min[1], y);
      max[0] = Math.max(max[0], x);
      max[1] = Math.max(max[1], y);
    }
  }
  return min.every(Number.isFinite) && max.every(Number.isFinite)
    ? { min, max }
    : null;
}

// Coincident segments split by STL tessellation still contribute their entire
// length. A circle or an ambiguous outline keeps the original workplane axes.
function outlineOrientation(loops) {
  let outer,
    largestArea = 0;
  for (const loop of loops) {
    let twiceArea = 0;
    const start = loop[0];
    for (let i = 1; i + 1 < loop.length; i++) {
      const a = loop[i],
        b = loop[i + 1];
      twiceArea +=
        (a[0] - start[0]) * (b[1] - start[1]) -
        (a[1] - start[1]) * (b[0] - start[0]);
    }
    if (Math.abs(twiceArea) > largestArea) {
      largestArea = Math.abs(twiceArea);
      outer = loop;
    }
  }
  if (!outer) return 0;
  let longest = 0,
    angle = 0,
    perimeter = 0;
  let prior = outer.at(-1);
  for (const p of outer) {
    const length = Math.hypot(p[0] - prior[0], p[1] - prior[1]);
    if (length > longest) {
      longest = length;
      angle = gridAxisAngle(prior, p);
    }
    perimeter += length;
    prior = p;
  }
  const { xAxis, yAxis } = basis(angle);
  let aligned = 0;
  prior = outer.at(-1);
  for (const p of outer) {
    const delta = [p[0] - prior[0], p[1] - prior[1]];
    const length = Math.hypot(...delta);
    if (
      Math.min(Math.abs(dot(delta, xAxis)), Math.abs(dot(delta, yAxis))) <=
      length * 0.002
    )
      aligned += length;
    prior = p;
  }
  // Orient X along whichever of the two edge axes is closer to the sketch's
  // original +X. This also gives the same result for either loop winding.
  return aligned >= 0.85 * perimeter ? (((angle % 90) + 135) % 90) - 45 : 0;
}

export function defaultSketchGrid(loops = []) {
  const config = {
    pitch: 1,
    placement: 'workplane',
    angle: 0,
    origin: [0, 0],
    snap: true,
    visible: true,
  };
  if (!loops.length) return config;
  const angle = outlineOrientation(loops),
    bounds = outlineBounds(loops, basis(angle));
  if (!bounds) return config;
  const nominal =
    Math.min(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]) / 12;
  if (!(nominal > 0)) return config;
  const unit = 10 ** Math.floor(Math.log10(nominal));
  const pitch = [unit, 2 * unit, 5 * unit, 10 * unit].reduce((a, b) =>
    Math.abs(a - nominal) <= Math.abs(b - nominal) ? a : b,
  );
  return {
    ...config,
    pitch: Math.max(minimumPitch, pitch),
    placement: 'balanced',
    angle,
  };
}

export function gridToPlane(grid, [x, y]) {
  return [
    grid.origin[0] + x * grid.xAxis[0] + y * grid.yAxis[0],
    grid.origin[1] + x * grid.xAxis[1] + y * grid.yAxis[1],
  ];
}

export function planeToGrid(grid, xy) {
  const d = [xy[0] - grid.origin[0], xy[1] - grid.origin[1]];
  return [dot(d, grid.xAxis), dot(d, grid.yAxis)];
}

// Ignore only errors consistent with an STL float coordinate. Never enlarge
// this to a meaningful fraction of a cell, including on very large models.
function endpointTolerance(size, pitch) {
  return Math.min(pitch * 0.0001, Math.max(1e-9, Math.abs(size) * 1e-7));
}
function latticeExtent(low, high, pitch) {
  const tolerance = endpointTolerance(high - low, pitch);
  const first = Math.ceil((low - tolerance) / pitch),
    last = Math.floor((high + tolerance) / pitch);
  return {
    count: Math.max(0, last - first),
    leading: Math.max(0, Math.min(high - low, first * pitch - low)),
    trailing: Math.max(0, Math.min(high - low, high - last * pitch)),
  };
}
export function resolveSketchGrid(config, loops = []) {
  config ??= defaultSketchGrid(loops);
  validateSketchGrid(config);
  const axes = basis(config.angle);
  const grid = {
    ...config,
    ...axes,
    origin: config.placement === 'custom' ? [...config.origin] : [0, 0],
    bounds: null,
    width: 0,
    height: 0,
    columns: 0,
    rows: 0,
    margins: [0, 0, 0, 0],
  };
  const box = outlineBounds(loops, axes);
  if (!box) return grid;
  const [w, h] = box.max.map((v, i) => v - box.min[i]);
  if (config.placement === 'balanced' || config.placement === 'corner') {
    const at = box.min.map((low, i) => {
      if (config.placement === 'corner') return low;
      const size = box.max[i] - low;
      const count = latticeExtent(0, size, grid.pitch).count;
      return low + Math.max(0, size - count * grid.pitch) / 2;
    });
    grid.origin = gridToPlane(grid, at);
  }
  const shift = [dot(grid.origin, axes.xAxis), dot(grid.origin, axes.yAxis)];
  const min = box.min.map((v, i) => v - shift[i]),
    max = box.max.map((v, i) => v - shift[i]);
  const x = latticeExtent(min[0], max[0], grid.pitch),
    y = latticeExtent(min[1], max[1], grid.pitch);
  return {
    ...grid,
    bounds: { min, max },
    width: w,
    height: h,
    columns: x.count,
    rows: y.count,
    margins: [x.leading, y.leading, x.trailing, y.trailing],
  };
}

export function snapToGrid(grid, xy) {
  return gridToPlane(
    grid,
    planeToGrid(grid, xy).map((v) => Math.round(v / grid.pitch) * grid.pitch),
  );
}

// Largest common square at the editor's 0.001 mm input resolution. Imported
// measurements outside coordinate roundoff are never silently rounded to fit.
export function exactGridPitch(loops, angle = 0) {
  const b = outlineBounds(loops, basis(angle));
  if (!b) return null;
  const sizes = b.max.map((v, i) => v - b.min[i]);
  const units = sizes.map((v) => Math.round(v / minimumPitch));
  if (
    units.some(
      (n, i) =>
        !Number.isSafeInteger(n) ||
        n < 1 ||
        Math.abs(n * minimumPitch - sizes[i]) >
          Math.min(0.0001, Math.max(1e-9, sizes[i] * 1e-7)),
    )
  )
    return null;
  let [a, bn] = units;
  while (bn) [a, bn] = [bn, a % bn];
  const pitch = a / 1000;
  return sizes.every(
    (size, i) =>
      Math.abs(size - units[i] * minimumPitch) <=
      endpointTolerance(size, pitch),
  )
    ? pitch
    : null;
}

export function outlineCircle(points) {
  if (points.length < 8) return null;
  let loop = points;
  if (loop[0][0] === loop.at(-1)[0] && loop[0][1] === loop.at(-1)[1])
    loop = loop.slice(0, -1);
  const bore = circularBore(loop, 1e-8);
  if (!bore) return null;
  // The edge of a partial arc or self-crossing star can also have all its
  // samples at one radius. Require one continuous revolution about the centre.
  let total = 0,
    previous = loop.at(-1);
  for (const p of loop) {
    const ax = previous[0] - bore.center[0],
      ay = previous[1] - bore.center[1];
    const bx = p[0] - bore.center[0],
      by = p[1] - bore.center[1];
    const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    if (turn * total < 0) return null;
    total += turn;
    previous = p;
  }
  return Math.abs(Math.abs(total) - 2 * Math.PI) < 1e-6
    ? { point: bore.center, radius: bore.radius }
    : null;
}

// A plate with many different bore sizes should not compare each hole to all
// larger holes. Only descend into regions that fully enclose its bounds.
function nestingTree(rings) {
  const boxes = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
  const centres = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
  let area = 0;
  for (const ring of rings) {
    area = Math.max(area, ring.area);
    for (let axis = 0; axis < 2; axis++) {
      const lo = ring.box.min[axis],
        hi = ring.box.max[axis],
        mid = lo / 2 + hi / 2;
      boxes.min[axis] = Math.min(boxes.min[axis], lo);
      boxes.max[axis] = Math.max(boxes.max[axis], hi);
      centres.min[axis] = Math.min(centres.min[axis], mid);
      centres.max[axis] = Math.max(centres.max[axis], mid);
    }
  }
  if (rings.length <= 12) return { box: boxes, area, rings };
  const axis =
    centres.max[0] - centres.min[0] >= centres.max[1] - centres.min[1] ? 0 : 1;
  const midpoint = (r) => r.box.min[axis] / 2 + r.box.max[axis] / 2;
  rings.sort((a, b) => midpoint(a) - midpoint(b));
  const middle = Math.floor(rings.length / 2);
  return {
    box: boxes,
    area,
    children: [
      nestingTree(rings.slice(0, middle)),
      nestingTree(rings.slice(middle)),
    ],
  };
}

function insideHole(tree, ring) {
  const surrounds = (candidate) =>
    candidate.area > ring.area &&
    candidate.box.min.every(
      (v, i) => v <= ring.box.min[i] && candidate.box.max[i] >= ring.box.max[i],
    );
  function count(node) {
    if (!surrounds(node)) return 0;
    if (node.children) return count(node.children[0]) + count(node.children[1]);
    let depth = 0;
    for (const outer of node.rings)
      if (surrounds(outer) && contains(outer.loop, ring.loop[0])) depth++;
    return depth;
  }
  return count(tree) % 2 === 1;
}

export function outlineHoleCentres(loops) {
  if (loops.length < 2) return [];
  const axes = basis(0);
  const rings = loops
    .map((loop, loopIndex) => ({
      loop,
      loopIndex,
      box: outlineBounds([loop], axes),
    }))
    .filter((r) => r.box);
  for (const ring of rings) {
    const { min, max } = ring.box;
    ring.area = (max[0] - min[0]) * (max[1] - min[1]);
  }
  if (rings.length < 2) return [];
  const tree = nestingTree(rings.slice());
  const found = [];
  for (const ring of rings) {
    if (ring.area >= tree.area) continue;
    const bore = outlineCircle(ring.loop);
    if (bore && insideHole(tree, ring))
      found.push({ ...bore, loopIndex: ring.loopIndex });
  }
  return found;
}

export function gridDisplayStride(required) {
  if (required <= 1) return 1;
  const unit = 10 ** Math.floor(Math.log10(required));
  for (const n of [unit, 2 * unit, 5 * unit, 10 * unit]) {
    if (n >= required) return n;
  }
  return Infinity;
}

function gridTicks(lo, hi, step) {
  const eps = endpointTolerance(hi - lo, step);
  const first = Math.ceil((lo - eps) / step),
    last = Math.floor((hi + eps) / step);
  return Array.from(
    { length: Math.max(0, last - first + 1) },
    (_, i) => (first + i) * step,
  );
}

// Bin contour crossings by lattice coordinate rather than visiting every
// triangle for each guide. Pair crossings by even/odd fill to skip holes.
function clippedGrid(grid, bounds, ticks, loops, limits) {
  const cuts = ticks.map((axis) => axis.map(() => []));
  let crossings = 0;
  for (const loop of loops) {
    if (!loop.length) continue;
    let a = planeToGrid(grid, loop.at(-1));
    for (const p of loop) {
      const b = planeToGrid(grid, p);
      for (const axis of [0, 1]) {
        const values = ticks[axis],
          other = 1 - axis;
        const lower = Math.min(a[axis], b[axis]),
          upper = Math.max(a[axis], b[axis]);
        if (!values.length || lower === upper) continue;
        // Include one extra candidate at each end to account for Float32
        // imported vertices lying just to one side of a nominal grid line.
        const first = Math.max(
          0,
          Math.floor((lower - values[0]) / limits.step) - 1,
        );
        const end = Math.min(
          values.length,
          Math.ceil((upper - values[0]) / limits.step) + 2,
        );
        for (let j = first; j < end; j++) {
          let at = values[j];
          const faceBounds = grid.bounds;
          if (faceBounds) {
            const extent = faceBounds.max[axis] - faceBounds.min[axis];
            const eps = endpointTolerance(extent, grid.pitch);
            // The scanline convention excludes the high end of an interval.
            // Sample just inside the exterior face extrema to draw both edges.
            if (Math.abs(at - faceBounds.max[axis]) <= eps)
              at = faceBounds.max[axis] - eps;
            else if (Math.abs(at - faceBounds.min[axis]) <= eps)
              at = faceBounds.min[axis] + eps;
          }
          if (at < lower || at >= upper) continue;
          if (++crossings > limits.maxSegments * 3) return null;
          const t = (at - a[axis]) / (b[axis] - a[axis]);
          cuts[axis][j].push(a[other] + t * (b[other] - a[other]));
        }
      }
      a = b;
    }
  }
  const lines = [];
  for (const axis of [0, 1]) {
    const other = 1 - axis;
    for (let j = 0; j < ticks[axis].length; j++) {
      const v = ticks[axis][j],
        intersect = cuts[axis][j].sort((a, b) => a - b);
      for (let k = 1; k < intersect.length; k += 2) {
        const lo = Math.max(bounds.min[other], intersect[k - 1]);
        const hi = Math.min(bounds.max[other], intersect[k]);
        if (hi <= lo) continue;
        if (lines.length >= limits.maxSegments) return null;
        const a = axis === 0 ? [v, lo] : [lo, v],
          b = axis === 0 ? [v, hi] : [hi, v];
        lines.push([gridToPlane(grid, a), gridToPlane(grid, b)]);
      }
    }
  }
  return lines;
}

/** Display-only decimation. Bounds are in grid coordinates. Returned endpoints
 * are in the sketch's canonical face plane; apply its world frame once in 3D. */
export function gridSegments(grid, bounds = grid.bounds, options = {}) {
  const { pixelsPerMm = 1, minPixels = 8, clipLoops } = options;
  if (
    !grid.visible ||
    !validPoint(bounds?.min) ||
    !validPoint(bounds?.max) ||
    !Number.isFinite(pixelsPerMm) ||
    pixelsPerMm <= 0
  )
    return { lines: [], stride: 1 };
  const [w, h] = bounds.max.map((v, i) => v - bounds.min[i]);
  if (!(w > 0 && h > 0)) return { lines: [], stride: 1 };
  const maxLines = Math.max(
    4,
    Math.min(1024, Math.floor(options.maxLines ?? 160)),
  );
  if (!Number.isFinite(maxLines) || !Number.isFinite(minPixels))
    return { lines: [], stride: 1 };
  const maxCoordinate = Math.max(
    ...bounds.min.map(Math.abs),
    ...bounds.max.map(Math.abs),
  );
  let stride = gridDisplayStride(
    Math.max(
      1,
      minPixels / (grid.pitch * pixelsPerMm),
      (w + h) / ((maxLines - 2) * grid.pitch),
      maxCoordinate / (grid.pitch * Number.MAX_SAFE_INTEGER),
    ),
  );
  // Highly perforated faces can turn one guide line into thousands of little
  // segments. Retry with fewer visible lines, leaving the snap lattice intact.
  for (let attempt = 0; attempt < 4; attempt++) {
    const step = grid.pitch * stride;
    if (!Number.isFinite(step)) break;
    const ticks = [0, 1].map((i) =>
      gridTicks(bounds.min[i], bounds.max[i], step),
    );
    if (!clipLoops?.length) {
      const lines = [];
      for (const x of ticks[0])
        lines.push([
          gridToPlane(grid, [x, bounds.min[1]]),
          gridToPlane(grid, [x, bounds.max[1]]),
        ]);
      for (const y of ticks[1])
        lines.push([
          gridToPlane(grid, [bounds.min[0], y]),
          gridToPlane(grid, [bounds.max[0], y]),
        ]);
      return { lines, stride };
    }
    const lines = clippedGrid(grid, bounds, ticks, clipLoops, {
      step,
      maxSegments: Math.min(2048, 8 * maxLines),
    });
    if (lines) return { lines, stride };
    stride *= 4;
  }
  return { lines: [], stride };
}
