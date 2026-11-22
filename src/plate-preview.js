import { fitPlate, footprintHull } from './geometry/plate.js';

// The positively projected triangles cover the exact XY footprint. Cancelling
// their shared edges keeps the SVG compact, including on curved or hollow parts.
function projectedContours(positions, indices) {
  const n = positions.length / 3;
  const pending = new Set();
  const add = (from, to) => {
    if (!pending.delete(to * n + from)) pending.add(from * n + to);
  };
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i],
      b = indices[i + 1],
      c = indices[i + 2];
    const ax = positions[3 * a],
      ay = positions[3 * a + 1];
    const area =
      (positions[3 * b] - ax) * (positions[3 * c + 1] - ay) -
      (positions[3 * b + 1] - ay) * (positions[3 * c] - ax);
    if (area <= 0) continue;
    add(a, b);
    add(b, c);
    add(c, a);
  }
  const arrows = new Map();
  for (const edge of pending) {
    const from = Math.floor(edge / n),
      to = edge % n;
    if (!arrows.has(from)) arrows.set(from, []);
    arrows.get(from).push(to);
  }
  const contours = [];
  while (arrows.size) {
    const first = arrows.keys().next().value;
    let id = first;
    const line = [];
    do {
      line.push([positions[id * 3], positions[id * 3 + 1]]);
      const choices = arrows.get(id);
      if (!choices?.length) break;
      const previous = id;
      id = choices.pop();
      if (!choices.length) arrows.delete(previous);
    } while (id !== first);
    if (line.length >= 3) contours.push(line);
  }
  return contours;
}

let serial = 0;
const shapeCache = new WeakMap();

/** Draw the selected part's real top-down outline at its best plate rotation. */
export function plateDiagram(part, plate) {
  if (!part || !plate) return '';
  let shape = shapeCache.get(part);
  if (!shape) {
    const contours =
      part.printContours ??
      (part.positions &&
      part.indices &&
      (!part.footprintXY || part.indices.length <= 225000)
        ? projectedContours(part.positions, part.indices)
        : []);
    shape = {
      contours,
      hull: part.footprintXY ?? footprintHull(contours.flat()),
    };
    shapeCache.set(part, shape);
  }
  const { contours, hull } = shape;
  if (!hull.length) return '';
  const outline = contours.length ? contours : [hull];
  const fit = fitPlate(hull, plate.width, plate.depth, plate.margin ?? 0);
  const rad = (fit.angle * Math.PI) / 180,
    cos = Math.cos(rad),
    sin = Math.sin(rad);
  const rotate = ([x, y]) => [cos * x - sin * y, sin * x + cos * y];
  let xmin = Infinity,
    xmax = -Infinity,
    ymin = Infinity,
    ymax = -Infinity;
  for (const p of hull) {
    const [x, y] = rotate(p);
    xmin = Math.min(xmin, x);
    xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y);
    ymax = Math.max(ymax, y);
  }
  const cx = (xmax + xmin) / 2,
    cy = (ymax + ymin) / 2;
  const scale = Math.min(
    284 / Math.max(plate.width, fit.width),
    176 / Math.max(plate.depth, fit.depth),
  );
  const f = (x) => Number(x.toFixed(2));
  const point = (p) => {
    const [x, y] = rotate(p);
    return f(160 + (x - cx) * scale) + ' ' + f(98 - (y - cy) * scale);
  };
  const path = outline
    .map((loop) => 'M' + loop.map(point).join('L') + 'Z')
    .join('');
  const rect = (w, h) =>
    `x="${f(160 - (w * scale) / 2)}" y="${f(98 - (h * scale) / 2)}" width="${f(w * scale)}" height="${f(h * scale)}"`;
  const bed = rect(plate.width, plate.depth);
  const usable = rect(
    plate.width - 2 * (plate.margin ?? 0),
    plate.depth - 2 * (plate.margin ?? 0),
  );
  const id = 'sf-bed-' + ++serial;
  return (
    `<svg class="plate-diagram" width="100%" viewBox="0 0 320 200" role="img" aria-label="Top view on print plate: ${fit.fits ? 'fits' : 'part exceeds usable area'}">
    <defs><pattern id="${id}-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
    <rect width="7" height="7" fill="var(--d-warn)"/><rect width="2" height="7" fill="var(--d-hardware-edge)"/></pattern>
    <mask id="${id}-overflow" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="200">
    <rect width="320" height="200" fill="white"/><rect ${usable} fill="black"/></mask></defs>
    <rect ${bed} fill="var(--d-paper)" stroke="var(--d-guide)" stroke-width="1.4"/>
    <path d="${path}" fill="var(--d-track)" fill-rule="nonzero"/>
    ${plate.margin ? `<rect ${usable} fill="none" stroke="var(--d-guide)" stroke-width="1" stroke-dasharray="3 3"/>` : ''}
    ${fit.fits ? '' : `<path d="${path}" fill="url(#${id}-hatch)" mask="url(#${id}-overflow)"/>`}
  </svg>` +
    (!contours.length && part.indices?.length > 225000
      ? '<small class="hint">Outer footprint of the high-resolution mesh</small>'
      : '')
  );
}
