import {
  WHITE_LINE_COLOR,
  finishKerbstones,
  slotEdgeAdvice,
  triangulatePaint,
} from './kerbstones.js';
import { connectorWarning, formatMm } from './connector-warning.js';
import { dot, left, minus, move, unit } from './solids.js';

const includesSide = (selection, side) =>
  selection === side || selection === 'both';
const sharedField = (field, label) => ({ tab: 'geometry', field, label });
export const lineDimensions = {
  whiteLineWidth: 3,
  dashLength: 12,
  dashGap: 8,
  grooveWidth: 0.5,
  grooveDepth: 0.3,
};

// Existing projects used one switch for every white line.
export function lineGrooves(p) {
  return {
    road: p.roadLineGroove ?? p.whiteLineGroove ?? false,
    border: p.borderLineGroove ?? p.whiteLineGroove ?? false,
  };
}

export function validatePaint(p) {
  if (!['none', 'solid', 'dashed'].includes(p.roadCentreLine ?? 'none'))
    throw Error('Choose off, solid or dashed for the centre line.');
  if (!['none', 'inner', 'outer', 'both'].includes(p.roadKerbSide ?? 'none'))
    throw Error('Choose a road edge for the kerbstones.');
  for (const key of ['whiteLineRoad', 'whiteLineBorder']) {
    if (!['none', 'inner', 'outer', 'both'].includes(p[key]))
      throw Error('Choose inside, outside, both or off for the white line.');
  }
  for (const key of ['whiteLineGroove', 'kerbGroove'])
    if (typeof p[key] !== 'boolean')
      throw Error('Choose on or off for the paint groove.');
  for (const key of ['roadLineGroove', 'borderLineGroove'])
    if (p[key] !== undefined && typeof p[key] !== 'boolean')
      throw Error('Choose on or off for the white line groove.');
  for (const [key, name, min, max] of [
    ['whiteLineWidth', 'White line width', 0.1, 2000],
    ['grooveWidth', 'Groove width', 0.05, 20],
    ['grooveDepth', 'Groove depth', 0.05, 50],
  ]) {
    if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max)
      throw Error(
        name +
          ' must be between ' +
          formatMm(min) +
          ' and ' +
          formatMm(max) +
          '.',
      );
  }
}

export function whiteLineLayout(p, side) {
  const road = includesSide(p.whiteLineRoad, side);
  const border =
    includesSide(p.whiteLineBorder, side) && includesSide(p.borderSide, side);
  const assembled = p.whiteLineWidth ?? lineDimensions.whiteLineWidth;
  const width = road && border ? assembled / 2 : assembled;
  const grooveWidth = p.grooveWidth ?? lineDimensions.grooveWidth;
  const grooves = lineGrooves(p);
  return {
    roadWidth: road ? width : 0,
    borderWidth: border ? width : 0,
    roadGroove: road && grooves.road ? grooveWidth : 0,
    borderGroove: border && !road && grooves.border ? grooveWidth : 0,
  };
}

// A Circuit end cut can be skewed to its road. At an end, intersect the
// parallel offset with the end cut. Interior points are intersections of
// successive parallel edges. Both halves therefore measure in a direction
// perpendicular to the painted edge, even if their print seams differ.
export function markingStations(p, path, side) {
  if (path.stations.length > 32768)
    throw Error('Simplify the imported road edges before adding a white line.');
  const sign = side === 'outer' ? 1 : -1;
  const rows = path.stations.map((t) => ({
    t,
    edge: path.point(t, (sign * p.width) / 2),
    cross: (path.normal?.(t) ?? left(path.tangent(t))).map((x) => x * sign),
  }));
  const normals = [];
  let previous;
  for (let i = 1; i < rows.length; i++) {
    const d = minus(rows[i].edge, rows[i - 1].edge);
    if (Math.hypot(...d) > 1e-8) {
      const normal = left(unit(d));
      previous =
        dot(normal, rows[i].cross) >= 0 ? normal : normal.map((x) => -x);
    }
    normals.push(previous);
  }
  const first = normals.find(Boolean);
  if (!first)
    throw Error('The white line needs a road edge with a measurable length.');
  return rows.map(({ t, edge, cross }, i) => {
    const before = normals[Math.max(i - 1, 0)] ?? first;
    const after = normals[Math.min(i, normals.length - 1)] ?? first;
    const projection = Math.min(dot(before, cross), dot(after, cross));
    if (projection < 1e-5 || dot(before, after) < -0.9999)
      throw Error(
        'The white line reaches a folded or nearly parallel end cut. Simplify the road edge in Circuit.',
      );
    const vector =
      !i || i === rows.length - 1 || dot(before, after) > 1 - 1e-12
        ? cross.map((x) => x / projection)
        : before.map((x, k) => (x + after[k]) / (1 + dot(before, after)));
    return {
      t,
      edge,
      projection,
      offset: (distance) => move(edge, vector, distance),
    };
  });
}

export function layOutWhiteLines(
  work,
  p,
  path,
  side,
  parts,
  layout,
  onRoad,
  widthAt,
  stations,
) {
  const nominalWidth = onRoad ? layout.roadWidth : layout.borderWidth;
  const groove = onRoad ? layout.roadGroove : layout.borderGroove;
  if (!nominalWidth) return;
  const name = side === 'outer' ? 'Outside' : 'Inside';
  const direction = onRoad ? -1 : 1;
  const rows = stations.map(({ t, offset, projection }) => {
    const width = nominalWidth + (layout.sharedBorderWidth
      ? Math.max(0, layout.borderWidth - projection * layout.sharedBorderWidth(t)) : 0);
    const span =
      projection *
      (onRoad ? (path.widthAt?.(t) ?? p.width) : widthAt(p, t, side));
    const shaping = !onRoad && path.borderStock &&
      (t < path.borderStock[0] || t > path.borderStock[1]);
    if (!shaping && span + 1e-7 < width + groove) {
      const target = onRoad ? 'road' : 'border';
      throw connectorWarning(
        name + ' ' + target + ' · white line',
        'At ' +
          Number((t * 100).toFixed(2)) +
          '% along the ' +
          target +
          ', it is ' +
          formatMm(span) +
          ' wide. The marking needs ' +
          formatMm(width + groove) +
          ' on this piece.',
        'Reduce White line width under Road → Shared line and groove dimensions' +
          (groove ? ' or reduce Groove width' : '') +
          (onRoad ? '.' : ', or widen the border here.'),
        sharedField('whiteLineWidth', 'Edit white line width'),
      );
    }
    const limit = (mm) => shaping ? Math.min(mm, Math.max(0,span)) : mm;
    const a = onRoad ? 0 : groove;
    const b = onRoad ? width : 0;
    return {
      t,
      paintA: offset(direction * limit(a)),
      paintB: offset(direction * limit(a + width)),
      grooveA: offset(direction * limit(b)),
      grooveB: offset(direction * limit(b + groove)),
    };
  });
  const section = (a, b) =>
    work.section([
      [...rows.map((row) => row[a]), ...rows.map((row) => row[b]).reverse()],
    ]);
  const line = section('paintA', 'paintB');
  const channel = groove ? section('grooveA', 'grooveB') : null;
  const full = channel ? work.own(channel.add(line)) : line;
  for (const part of parts) {
    if (part.laneKeepout) {
      const local = work.own(full.intersect(part.section));
      if (work.own(local.intersect(part.laneKeepout)).area() > 1e-6)
        throw connectorWarning(
          name + ' white line · ' + part.name,
          'The white line' +
            (channel ? ' or its paint groove' : '') +
            ' reaches a guide slot or braid strip.',
          'Reduce White line width under Road → Shared line and groove dimensions' +
            (channel ? ' or reduce Groove width' : '') +
            slotEdgeAdvice(p, side),
          sharedField('whiteLineWidth', 'Edit white line width'),
        );
    }
    (part.paintSections ??= []).push({
      color: WHITE_LINE_COLOR,
      section: line,
    });
    if (channel) (part.grooveSections ??= []).push(channel);
  }
}

// Road dividers can run directly over centred draw keys. Keep the flat
// marking there and resume its engraved outline beyond the 2 mm roof.
export function grooveClearOfDovetails(work, guards, groove) {
  if (!guards?.length) return groove;
  const roofs = guards.map(stock => work.own(stock.project()));
  return work.own(groove.subtract(work.own(work.wasm.CrossSection.union(roofs))));
}

export function finishMarkings(work, part, result, p) {
  if (part.grooveSections?.length) {
    const { height, grooveDepth } = p;
    const roof = 0.2;
    if (height - grooveDepth < roof - 1e-7)
      throw connectorWarning(
        part.name + ' · paint groove',
        'A ' +
          formatMm(grooveDepth) +
          ' groove in the ' +
          formatMm(height) +
          ' part leaves less than ' +
          formatMm(roof) +
          ' below the groove.',
        'Set Groove depth under Road → Shared line and groove dimensions to ' +
          formatMm(height - roof) +
          ' or less.',
        sharedField('grooveDepth', 'Edit groove depth'),
      );
    const all = work.own(work.wasm.CrossSection.union(part.grooveSections));
    const top = work.own(result.solid.slice(height - 0.0001));
    const withinPart = work.own(all.intersect(part.section));
    const mask = work.own(withinPart.intersect(top));
    if (!mask.isEmpty()) {
      // The entire groove and its remaining roof must be backed by existing
      // solid. This also catches enclosed tab sockets beneath a solid deck.
      const bottom = height - grooveDepth;
      const groove = work.prism(mask, bottom, height + 1);
      if (
        part.drawKeyGuards?.some(
          (guard) => work.and(guard, groove).volume() > 1e-6,
        )
      ) {
        throw connectorWarning(
          part.name + ' · dovetail pocket',
          'This paint groove cuts into the 2 mm roof above a dovetail pocket.',
          'Move the connector clear of the groove or turn off the paint recess on this edge.',
          { tab: 'joints', field: 'clipType', label: 'Open connections' },
        );
      }
      const stock = work.prism(mask, bottom - roof, height);
      const missing = work.own(stock.subtract(result.solid)).volume();
      if (missing > Math.max(1e-6, stock.volume() * 1e-8))
        throw connectorWarning(
          part.name + ' · paint groove',
          'At ' +
            formatMm(grooveDepth) +
            ' deep the groove leaves less than ' +
            formatMm(roof) +
            ' of material over an opening in this part.',
          p.hollow && grooveDepth + roof > p.deck
            ? 'Reduce Groove depth under Road → Shared line and groove dimensions. The deck is ' +
                formatMm(p.deck) +
                ' thick above the hollow interior.'
            : 'Reduce Groove depth under Road → Shared line and groove dimensions, or move the connector beneath the groove.',
          sharedField('grooveDepth', 'Edit groove depth'),
        );
      result.solid = work.cut(result.solid, [groove]);
    }
  }
  const kerbs = finishKerbstones(
    work.wasm,
    result.solid,
    p.height,
    part.kerbBands,
  );
  if (part.paintSections?.length) {
    // Trim a continuous kerb to this physical segment before intersecting its
    // top. Projecting joint stock belongs to a different marking footprint.
    const inks = part.paintSections.map(({ color, section }) => ({
      color,
      section: work.own(section.intersect(part.section)),
    }));
    result.kerbMarkings = (kerbs ?? []).concat(
      triangulatePaint(work.wasm, result.solid, p.height, inks),
    );
  } else if (kerbs) result.kerbMarkings = kerbs;
}
