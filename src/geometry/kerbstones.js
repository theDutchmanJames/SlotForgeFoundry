import { connectorWarning, formatMm } from './connector-warning.js';
import { hasSlotPosition } from '../slot-position.js';

// SlotForge red and off-white, the same in both themes.
const red = '#E5484D';
const white = '#ECE9E2';
export const WHITE_LINE_COLOR = '#FFFFFF';
const maxBlocks = 4096;
const maxStations = 32768;
/**
 * The end of an advice sentence about a marking on road edge `side` that
 * reaches a slot: '.' when centred, else where to move the slot. With
 * several slots it names the one nearest that edge, numbered from the edge
 * the slots are measured from.
 */
export function slotEdgeAdvice(p, side) {
  if (!hasSlotPosition(p)) return '.';
  if (!(p.lanes > 1)) return ', or move the slot away from this edge under Slot position.';
  const slot = side === p.slotPosition.edge ? 1 : p.lanes;
  return ', or move slot ' + slot + ' away from this edge under Slot position.';
}
const sideName = (side, road = false) =>
  (side === 'inner' ? 'Inside' : 'Outside') + (road ? ' road edge' : ' border');
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const mix = (a, b, u) => [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])];
const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function signedArea(points) {
  let twiceArea = 0;
  for (let i = 2; i < points.length; i++)
    twiceArea += cross(points[0], points[i - 1], points[i]);
  return twiceArea / 2;
}

// Interpolate between the same polygon vertices used to extrude the border.
// Evaluating the ideal circular curve between these vertices can put pigment
// outside an STL chord, especially at a narrow entry or exit.
function stripeAt(row, edge, p) {
  const width = distance(row.road, row.free);
  const fraction = width
    ? Math.min(p.kerbWidth / width, p.kerbEdge === 'both' ? 0.5 : 1)
    : 0;
  const outside = edge === 'road' ? row.road : row.free;
  const opposite = edge === 'road' ? row.free : row.road;
  return [outside, mix(outside, opposite, fraction)];
}

function stripeAlongEdge(rows, stripe, p, borders, stock) {
  const first = rows[0].t, span = rows.at(-1).t - first;
  let measured = 0,
    previousBand,
    previousIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i];
    const [start, insideStart] = stripe(a);
    const [end, insideEnd] = stripe(b);
    const length = distance(start, end);
    if (!length) continue;
    const nextDistance = measured + length;
    if (nextDistance / p.kerbLength > maxBlocks + 1e-7)
      throw Error(
        'Increase kerbstone block length. Each edge supports up to ' +
          maxBlocks +
          ' blocks.',
      );
    // All physical print seams are stations in the path. Their midpoints
    // therefore identify a single border part even for imported DXF paths.
    const index = Math.min(
      borders.length - 1,
      Math.floor(((a.t + b.t) * 0.5 - first) / span * borders.length),
    );
    const part = borders[index];
    const firstBlock = Math.floor(measured / p.kerbLength);
    const lastBlock = Math.ceil(nextDistance / p.kerbLength) - 1;
    for (let block = firstBlock; block <= lastBlock; block++) {
      const from = Math.max(measured, block * p.kerbLength);
      const to = Math.min(nextDistance, (block + 1) * p.kerbLength);
      if (to <= from) continue;
      const u = (from - measured) / length,
        v = (to - measured) / length;
      if (previousBand?.block !== block || previousIndex !== index) {
        previousIndex = index;
        previousBand = {
          block,
          length: 0,
          outer: [mix(start, end, u)],
          inner: [mix(insideStart, insideEnd, u)],
        };
        (part.kerbBands ??= []).push(previousBand);
      }
      previousBand.outer.push(mix(start, end, v));
      previousBand.inner.push(mix(insideStart, insideEnd, v));
      previousBand.length += to - from;
      if (stock) {
        const middle = a.t + (b.t - a.t) * (u + v) / 2;
        if (middle < stock[0] || middle > stock[1]) previousBand.atFinish = true;
      }
    }
    measured = nextDistance;
  }
}

export function layOutKerbstones(
  work,
  p,
  path,
  side,
  borders,
  widthAt,
  reserved,
  stations,
) {
  if (p.kerbEdge === 'none' || (p.kerbSide !== 'both' && p.kerbSide !== side))
    return;
  if (path.stations.length > maxStations)
    throw Error(
      'Simplify the imported border before adding kerbstone markings.',
    );
  const sign = side === 'outer' ? 1 : -1;
  const edge = (sign * p.width) / 2;
  const rows = [];
  const limit = (p.kerbEdge === 'both' ? 2 : 1) * p.kerbWidth;
  for (const [i, t] of path.stations.entries()) {
    const total = widthAt(p, t, side);
    const free = path.point(t, edge + sign * total);
    const road = !reserved ? path.point(t, edge)
      : path.borderStock && total * stations[i].projection <= reserved
        ? free : stations[i].offset(reserved);
    const width = distance(road, free);
    const row = {
      t,
      width,
      road,
      free,
    };
    const prev = rows.at(-1);
    // A taper can cross the requested paint width between existing vertices.
    if (prev && (prev.width - limit) * (width - limit) < 0) {
      const u = (limit - prev.width) / (width - prev.width);
      rows.push({
        t: prev.t + (t - prev.t) * u,
        width: limit,
        road: mix(prev.road, row.road, u),
        free: mix(prev.free, row.free, u),
      });
    }
    rows.push(row);
  }
  const edges = p.kerbEdge === 'both' ? ['road', 'free'] : [p.kerbEdge];
  if (!p.kerbGroove && !reserved) {
    for (const edge of edges) stripeAlongEdge(rows, row => stripeAt(row, edge, p), p, borders);
    return;
  }
  // Generate continuous stones before splitting into print pieces. Otherwise
  // offsetting the rectangles would introduce end caps at every print seam.
  const bands = edges.map(edge => {
    const continuous = {};
    stripeAlongEdge(rows, row => stripeAt(row, edge, p), p, [continuous], path.borderStock);
    return continuous.kerbBands ?? [];
  });
  applyKerbBands(work, p, side, borders, bands, reserved, false);
}

// Follow the road edge as printed, including the wider pit shoulder and the
// varying road share of a white line next to a tapered border. Mitered edge
// offsets keep the paint width perpendicular to the road on skewed ends.
export function layOutRoadKerbs(work, p, side, roads, layout, stations) {
  const rows = stations.map(({ t, projection, offset }) => {
    const shared = layout.sharedBorderWidth
      ? Math.max(0, layout.borderWidth - projection * layout.sharedBorderWidth(t)) : 0;
    const inset = layout.roadWidth + shared + layout.roadGroove;
    return { t, outer: offset(-inset), inner: offset(-inset - p.kerbWidth) };
  });
  const continuous = {};
  stripeAlongEdge(rows, row => [row.outer, row.inner], p, [continuous]);
  applyKerbBands(work, p, side, roads, [continuous.kerbBands ?? []], 0, true);
}

function applyKerbBands(work, p, side, parts, edges, reserved, road) {
  const footprint = [], interiors = [];
  for (const bands of edges) {
    for (const [index, loops] of kerbLoops(bands).entries()) {
      if (!loops.length) continue;
      const coverage = work.own(new work.wasm.CrossSection(loops, 'Positive'));
      footprint.push(coverage);
      interiors.push({
        color: index ? white : red,
        bands: bands.filter((band) => band.block % 2 === index),
        section: p.kerbGroove
          ? work.own(coverage.offset(-p.grooveWidth / 2, 'Miter'))
          : coverage,
      });
    }
  }
  if (!footprint.length && reserved)
    throw connectorWarning(
      sideName(side) + ' · kerbstones',
      'The white line and its selected groove use all the available border width. There is no room left for a kerbstone.',
      'Reduce White line width under Road → Shared line and groove dimensions or widen the border.',
      {
        tab: 'geometry',
        field: 'whiteLineWidth',
        label: 'Edit white line width',
      },
    );
  if (!footprint.length) return;
  const all = work.own(work.wasm.CrossSection.union(footprint));
  if (road) {
    for (const part of parts) {
      const local = work.own(all.intersect(part.section));
      if (part.laneKeepout && work.own(local.intersect(part.laneKeepout)).area() > 1e-6)
        throw connectorWarning(
          sideName(side, true) + ' · ' + part.name,
          'The kerbstones reach a guide slot or braid strip.',
          'Reduce the kerbstone width or the edge line width to leave room beside the lane' +
            slotEdgeAdvice(p, side),
          { tab: 'geometry', field: 'kerbWidth', label: 'Edit kerbstone width' },
        );
    }
  }
  if (!p.kerbGroove) {
    for (const part of parts) (part.paintSections ??= []).push(...interiors);
    return;
  }
  // An isolated perimeter has the whole groove on its own material. At a
  // shared colour boundary the two half-width insets make one groove.
  const rim = work.own(all.offset(-p.grooveWidth, 'Miter'));
  const omitted = [];
  const inks = interiors.map(({ color, section, bands }) => {
    const ink = work.own(section.intersect(rim));
    checkKerbInteriors(ink, bands, p, side, omitted, road);
    return { color, section: ink };
  });
  const paint = work.own(
    work.wasm.CrossSection.union(inks.map((ink) => ink.section)),
  );
  if (paint.isEmpty())
    throw connectorWarning(
      sideName(side, road) + ' · kerbstones',
      'The ' +
        formatMm(p.grooveWidth) +
        ' paint groove covers the entire kerbstone stripe.',
      'Reduce Groove width or increase the kerbstone width.',
      { tab: road ? 'geometry' : 'borders', field: 'grooveWidth', label: 'Edit groove width' },
    );
  const footprintToCut = omitted.length
    ? work.own(all.subtract(work.own(new work.wasm.CrossSection(omitted, 'Positive'))))
    : all;
  const groove = work.own(footprintToCut.subtract(paint));
  for (const part of parts) {
    (part.paintSections ??= []).push(...inks);
    (part.grooveSections ??= []).push(groove);
  }
}

function kerbLoops(bands = []) {
  const groups = [[], []];
  for (const band of bands) {
    const loop = band.outer.concat(band.inner.slice().reverse());
    const area = signedArea(loop);
    if (Math.abs(area) > 1e-12)
      groups[band.block % 2].push(area > 0 ? loop : loop.reverse());
  }
  return groups;
}

function containsPoint(loop, [x, y]) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i],
      b = loop[j];
    if (
      a[1] > y !== b[1] > y &&
      x < a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1])
    )
      inside = !inside;
  }
  return inside;
}

function checkKerbInteriors(ink, bands, p, side, omitted, road) {
  // Every surviving inset island lies strictly inside exactly one source block.
  // Sort one point per island to avoid intersecting thousands of block solids.
  const probes = ink
    .toPolygons()
    .filter((loop) => signedArea(loop) > 0)
    .map((loop) => loop[0]);
  const { min, max } = ink.bounds();
  const axis = max[0] - min[0] > max[1] - min[1] ? 0 : 1;
  probes.sort((a, b) => a[axis] - b[axis]);
  for (const band of bands) {
    if (!band.atFinish && band.length < p.kerbLength - 1e-7) continue;
    const loop = band.outer.concat(band.inner.slice().reverse());
    let start = Infinity,
      end = -Infinity;
    for (const v of loop) {
      start = Math.min(start, v[axis]);
      end = Math.max(end, v[axis]);
    }
    let low = 0,
      high = probes.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (probes[mid][axis] < start) low = mid + 1;
      else high = mid;
    }
    let found = false;
    for (let i = low; i < probes.length && probes[i][axis] <= end; i++) {
      if (containsPoint(loop, probes[i])) {
        found = true;
        break;
      }
    }
    // A shaped tip deliberately runs down to zero width. Finish the paint
    // at its last usable stone, and keep the remaining nose solid.
    if (!found && band.atFinish) {
      if (Math.abs(signedArea(loop)) > 1e-12)
        omitted.push(signedArea(loop) > 0 ? loop : loop.reverse());
      continue;
    }
    if (!found)
      throw connectorWarning(
        sideName(side, road) + ' · kerbstone ' + (band.block + 1),
        'The ' +
          formatMm(p.grooveWidth) +
          ' paint groove leaves no paintable area on this ' +
          formatMm(band.length) +
          ' block.',
        road
          ? 'Reduce Groove width or increase the kerbstone width and block length under Road.'
          : p.kerbEdge !== 'both' && p.grooveWidth * 2 >= p.kerbWidth
          ? 'For a ' +
              formatMm(p.kerbWidth) +
              ' stripe, set Groove width under Borders → Kerbstones below ' +
              formatMm(p.kerbWidth / 2) +
              '. A tapered border can require a narrower groove.'
          : 'Reduce Groove width under Borders → Kerbstones or widen the border near this block.',
        { tab: road ? 'geometry' : 'borders', field: 'grooveWidth', label: 'Edit groove width' },
      );
  }
}

// Clip the paint to the actual top, including holes and any recessed edges.
export function triangulatePaint(wasm, solid, height, inks) {
  const result = [];
  // slice() at exactly the upper bound is empty by definition. The deck
  // walls are vertical here and the slice is well inside the top skin.
  const top = solid.slice(height - Math.min(0.0001, height * 1e-5));
  try {
    for (const { color, section } of inks) {
      const clipped = section.intersect(top);
      try {
        const polygons = clipped.toPolygons();
        if (!polygons.length) continue;
        const points = polygons.flat();
        for (const tri of wasm.triangulate(polygons)) {
          const vertices = tri.map((i) => points[i]);
          const winding = cross(...vertices);
          if (Math.abs(winding) <= 1e-12) continue;
          if (winding < 0) vertices.reverse();
          result.push({
            color,
            points: vertices.map(([x, y]) => [x, y, height]),
          });
        }
      } finally {
        clipped.delete();
      }
    }
  } finally {
    top.delete();
  }
  return result;
}

export function finishKerbstones(wasm, solid, height, bands) {
  if (!bands?.length) return undefined;
  const inks = [];
  try {
    for (const [index, loops] of kerbLoops(bands).entries()) {
      if (loops.length)
        inks.push({
          color: index ? white : red,
          section: new wasm.CrossSection(loops, 'Positive'),
        });
    }
    return triangulatePaint(wasm, solid, height, inks);
  } finally {
    inks.forEach((ink) => ink.section.delete());
  }
}
