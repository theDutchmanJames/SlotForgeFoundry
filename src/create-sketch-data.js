import { joinDrawingPaths, readSketchPaths } from './imports.js';
import {
  circleSteps,
  distance,
  ellipsePoints,
  pointLimit,
  tau,
} from './drawings/curves.js';
import {
  shapeOutline,
  validateSlotDimensions,
} from './geometry/shape-profile.js';

const finite = Number.isFinite;
const point = (p) => Array.isArray(p) && p.length === 2 && p.every(finite);
const positive = (n) => finite(n) && n > 0;
const radians = (degrees) => (degrees * Math.PI) / 180;
const addAngle = (a, b) => (((b - a) % tau) + tau) % tau;
const midway = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function arcGeometry(points) {
  const [a, b, c] = points;
  const bx = b[0] - a[0],
    by = b[1] - a[1],
    cx = c[0] - a[0],
    cy = c[1] - a[1];
  const det = 2 * (bx * cy - by * cx);
  if (Math.abs(det) <= 1e-12 * Math.max(bx * bx + by * by, cx * cx + cy * cy))
    throw Error(
      'An arc needs three distinct points away from a straight line.',
    );
  const ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / det;
  const uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / det;
  const center = [a[0] + ux, a[1] + uy],
    radius = Math.hypot(ux, uy);
  const angle = (p) => Math.atan2(p[1] - center[1], p[0] - center[0]);
  const start = angle(a),
    middle = addAngle(start, angle(b)),
    end = addAngle(start, angle(c));
  const sign = det > 0 ? 1 : -1;
  const sweepToMiddle = sign > 0 ? middle : middle - tau;
  const sweepToEnd = sign > 0 ? end : end - tau;
  return { center, radius, start, sweepToMiddle, sweepToEnd };
}

function validateEntity(e) {
  if (!e || typeof e !== 'object') throw Error('Choose a sketch element.');
  if (['line', 'arc', 'path'].includes(e.type)) {
    const n = e.points?.length ?? 0;
    if (!Array.isArray(e.points) || n > pointLimit || !e.points.every(point))
      throw Error('Use finite XY coordinates for each sketch point.');
    if (
      (e.type === 'line' && n !== 2) ||
      (e.type === 'arc' && n !== 3) ||
      (e.type === 'path' &&
        (typeof e.closed !== 'boolean' || n < (e.closed ? 3 : 2)))
    )
      throw Error('The sketch element has too few or too many points.');
    if (e.points.every((p) => distance(p, e.points[0]) < 1e-9))
      throw Error('The sketch element needs distinct points.');
    if (e.type === 'arc') {
      const a = arcGeometry(e.points);
      return (
        2 +
        circleSteps(a.radius, a.sweepToMiddle) +
        circleSteps(a.radius, a.sweepToEnd - a.sweepToMiddle)
      );
    }
    return n;
  }
  if (![e.x, e.y].every(finite))
    throw Error('Enter a finite X and Y for the sketch element.');
  if (!finite(e.angle ?? 0))
    throw Error('Enter a finite orientation for the sketch element.');
  if (e.type === 'circle' && positive(e.diameter)) return 64;
  if (e.type === 'rectangle' && positive(e.width) && positive(e.height))
    return 4;
  if (
    e.type === 'lProfile' &&
    positive(e.width) &&
    positive(e.height) &&
    positive(e.thickness) &&
    e.thickness < Math.min(e.width, e.height)
  )
    return 6;
  if (e.type === 'slot' && finite(e.angle ?? 0)) {
    validateSlotDimensions(e.length, e.width);
    return 64;
  }
  if (e.type === 'lProfile')
    throw Error(
      'Choose two positive leg lengths and a wall thinner than either leg.',
    );
  throw Error('Choose a supported sketch shape and positive dimensions.');
}

export function validateSketch(sketch) {
  if (
    !Array.isArray(sketch?.entities) ||
    !sketch.entities.length ||
    sketch.entities.length > pointLimit / 2
  )
    throw Error('Draw or import a sketch before continuing.');
  let total = 0;
  for (const e of sketch.entities) {
    total += validateEntity(e);
    if (total > pointLimit)
      throw Error('This sketch has too many points. Use a smaller drawing.');
  }
  return total;
}

export function sketchElementPath(e) {
  validateEntity(e);
  if (e.type === 'path' || e.type === 'line')
    return { points: e.points, closed: e.type === 'path' && e.closed };
  if (e.type === 'arc') {
    const { center, radius, start, sweepToMiddle, sweepToEnd } = arcGeometry(
      e.points,
    );
    const first = ellipsePoints(
      center,
      radius,
      radius,
      0,
      start,
      sweepToMiddle,
    );
    const second = ellipsePoints(
      center,
      radius,
      radius,
      0,
      start + sweepToMiddle,
      sweepToEnd - sweepToMiddle,
    );
    first[0] = e.points[0];
    first[first.length - 1] = e.points[1];
    second[second.length - 1] = e.points[2];
    return { points: first.concat(second.slice(1)), closed: false };
  }
  const { x, y, width: w, height: h, thickness: t } = e;
  const angle = radians((e.angle ?? 0) % 360),
    c = Math.cos(angle),
    s = Math.sin(angle);
  let outline;
  if (e.type === 'rectangle')
    outline = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
  else if (e.type === 'lProfile')
    outline = [
      [0, 0],
      [w, 0],
      [w, t],
      [t, t],
      [t, h],
      [0, h],
    ];
  else if (e.type === 'circle') outline = shapeOutline('circle', e.diameter);
  else outline = shapeOutline('slot', e.length, e.width);
  return {
    points: outline.map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]),
    closed: true,
  };
}

export function sketchPaths(sketch) {
  validateSketch(sketch);
  const contours = joinDrawingPaths(sketch.entities.map(sketchElementPath));
  return {
    loops: contours.filter((p) => p.closed).map((p) => p.points),
    paths: contours.filter((p) => !p.closed).map((p) => p.points),
  };
}

export function importSketchDrawing(text, extension) {
  const { paths, warnings } = readSketchPaths(text, extension);
  const entities = paths.map(({ points, closed }) => ({
    type: 'path',
    points,
    closed,
  }));
  validateSketch({ entities });
  return { entities, warnings };
}

export function sketchBounds(paths) {
  let xmin = Infinity,
    ymin = Infinity,
    xmax = -Infinity,
    ymax = -Infinity;
  for (const points of paths)
    for (const [x, y] of points) {
      xmin = Math.min(xmin, x);
      ymin = Math.min(ymin, y);
      xmax = Math.max(xmax, x);
      ymax = Math.max(ymax, y);
    }
  return finite(xmin) ? { xmin, xmax, ymin, ymax } : null;
}

export function sketchAnchors(entity, path) {
  const points = path.points;
  if (entity.type === 'line')
    return [
      [points[0], 'Endpoint'],
      [points[1], 'Endpoint'],
      [midway(...points), 'Midpoint'],
    ];
  if (entity.type === 'arc')
    return [
      ...entity.points.map((p) => [p, 'Arc point']),
      [arcGeometry(entity.points).center, 'Centre'],
    ];
  const bounds = sketchBounds([points]);
  const center = [
    (bounds.xmin + bounds.xmax) / 2,
    (bounds.ymin + bounds.ymax) / 2,
  ];
  const anchors = [[center, 'Centre']];
  if (entity.type === 'circle') {
    for (let i = 0; i < 4; i++) anchors.push([points[i * 16], 'Quadrant']);
  } else if (entity.type === 'slot') {
    const a = radians(entity.angle ?? 0),
      d = (entity.length - entity.width) / 2;
    for (const sign of [-1, 1])
      anchors.push([
        [entity.x + sign * d * Math.cos(a), entity.y + sign * d * Math.sin(a)],
        'Cap centre',
      ]);
  } else {
    for (let i = 0; i < points.length; i++) {
      anchors.push([points[i], 'Endpoint']);
      if (i || path.closed)
        anchors.push([
          midway(points[(i + points.length - 1) % points.length], points[i]),
          'Midpoint',
        ]);
    }
  }
  return anchors;
}
