import clipping from 'polygon-clipping';
import { laneOffsetAt, laneProfileSteps } from '../lane-adjustment.js';
import { hasSlotPosition, lanesVary, slotEdgeName, slotVaries } from '../slot-position.js';
import { vertexNormals } from './import-track.js';
import { lineGrooves, whiteLineLayout } from './paint-guides.js';
import { pitBayStart, pitSides } from './special-junction-paths.js';
import { pitDividerOffsetAtBay } from './pit-white-line.js';
import { pitBraidLandingShift } from './pit-braids.js';
import { braidSpan, move } from './solids.js';
import { connectorWarning, formatMm } from './connector-warning.js';

export function defaultStartingGrid(p) {
  const middle = p.laneAdjustment?.spacingMm ?? p.laneSpacing;
  const rowSpacing = p.lanes > 1 ? Math.min(p.laneSpacing, middle) : p.width;
  const laneSpan = (p.lanes - 1) * Math.max(middle, p.laneSpacing);
  const edgeSpace = Math.max(roadEdgeMarkWidth(p, 'inner'), roadEdgeMarkWidth(p, 'outer'));
  const laneWidth = Math.max(0.1, Math.min(rowSpacing, p.width - laneSpan - 2 * edgeSpace));
  const stagger = p.lanes > 1 ? Math.min(45, 0.225 * p.length) : 0;
  if (!hasSlotPosition(p))
    return { ...markDefaults(laneWidth, p.length, 2 * laneShoulder(p)), stagger };
  // An off-centre slot leaves less road on one side. Centre each box on its
  // slot and size the marks to the lane with the least room: the road edge,
  // its line and kerb, and the neighbouring slots. Without a squeeze the
  // lane spacing says nothing the room does not, so only the road caps it.
  const cap = p.width - 2 * edgeSpace;
  const fitted = (legLength) => {
    const room = Math.min(...Array.from({ length: p.lanes }, (_, i) => boxRoom(p, i, legLength, stagger)));
    const mark = markDefaults(Math.max(0.1, Math.min(cap, room)), p.length, 2 * laneShoulder(p));
    // The room is rarely a round number. Keep the fields readable, and the
    // width inside the room.
    return { ...mark, width: Math.floor(mark.width * 100 + 1e-7) / 100,
      thickness: Number(mark.thickness.toFixed(2)), legLength, stagger };
  };
  const grid = fitted(defaultLegLength(p.length));
  if (!slotVaries(p)) return grid;
  // A slot that moves sideways runs at an angle under the legs. Shorten
  // them until they clear it.
  for (const legs of [1, 0.75, 0.5, 0.25, 0]) {
    const shorter = fitted(legs * grid.legLength);
    try {
      startingGridLayout({ ...p, startingGrid: shorter });
      return shorter;
    } catch { /* Try shorter legs. */ }
  }
  return grid;
}

const defaultLegLength = (length) => Math.min(35, 0.175 * length);

function markDefaults(laneWidth, length, clearWidth) {
  const thickness = Math.max(0.1, Math.min(3, 0.03 * laneWidth, 0.1 * length, (laneWidth - clearWidth) / 4));
  const width = Math.min(laneWidth, Math.max(Math.min(72, 0.72 * laneWidth), clearWidth + 2 * thickness + 0.4));
  return {
    width,
    thickness,
    legLength: defaultLegLength(length),
    recessed: false,
  };
}

// Where along the road the middle of a lane's transverse line sits, as
// startingGridLayout puts it (the station does not depend on the thickness).
function markStation(p, lane, legLength, stagger) {
  const row = (p.lanes - 1 - lane) % 2 === 0 ? 1 : -1;
  return (legLength / 2 + (p.lanes > 1 ? row * stagger / 2 : 0)) / p.length + 0.5;
}

// Width a lane's box may take at its own station: twice the clear road to
// the nearer edge, and no more than the distance to a neighbouring slot (the
// lane spacing of a centred piece).
function boxRoom(p, lane, legLength, stagger) {
  const t = markStation(p, lane, legLength, stagger), y = laneOffsetAt(p, lane, t);
  const neighbours = [lane - 1, lane + 1].filter((j) => j >= 0 && j < p.lanes)
    .map((j) => Math.abs(laneOffsetAt(p, j, t) - y));
  return Math.min(2 * laneRoom(p, lane, t), ...neighbours);
}

// Slots are numbered from the edge they are measured from: 1 is nearest it.
const slotNumber = (p, lane) => (p.slotPosition.edge === 'outer' ? p.lanes - lane : lane + 1);

// Clear road from a lane to the nearer edge, edge line or road kerb at one station.
function laneRoom(p, lane, t) {
  const y = laneOffsetAt(p, lane, t);
  const kerb = (side) => (p.roadKerbSide === 'both' || p.roadKerbSide === side ? p.kerbWidth : 0);
  return Math.min(
    p.width / 2 - roadEdgeMarkWidth(p, 'outer') - kerb('outer') - y,
    p.width / 2 - roadEdgeMarkWidth(p, 'inner') - kerb('inner') + y,
  );
}

function roadEdgeMarkWidth(p, side) {
  const line = whiteLineLayout(p, side);
  return line.roadWidth + line.roadGroove;
}

// Retain a small strip of deck between the marking and the outer braid.
function laneShoulder(p) {
  return p.slotWidth / 2 + braidSpan(p) + 0.4;
}

function gridWarning(reason, advice, field, label) {
  return connectorWarning('Starting grid', reason, advice, { tab: 'geometry', field, label });
}

// The mark stays square to the road. Where a slot moves sideways it passes
// under the mark at an angle, which the usual advice does not explain.
function slantedSlotWarning(reason, advice, field, label) {
  return gridWarning(reason, advice + ' The slot runs at an angle to the mark on this piece.', field, label);
}

function pitWarning(reason, advice, field, label) {
  return connectorWarning('Pit grid marker', reason, advice, {
    tab: 'geometry', field: 'spPitGrid' + field.slice(4), label,
  });
}

function validateMark(grid, name, warning) {
  if (!grid || typeof grid !== 'object' || Array.isArray(grid) || typeof grid.recessed !== 'boolean')
    throw Error('Choose valid ' + name + ' dimensions and a paint groove setting.');
  for (const [key, label, min] of [
    ['width', 'Mark width', 0.1], ['thickness', 'Line thickness', 0.1], ['legLength', 'Leg length', 0],
  ]) {
    if (!Number.isFinite(grid[key]) || grid[key] < min)
      throw Error(label + ' must be at least ' + formatMm(min) + '.');
  }
  if (grid.legLength && grid.width <= 2 * grid.thickness)
    throw warning('The two legs meet across the grid box.', 'Increase Mark width or reduce Line thickness.',
      'gridThickness', 'Edit line thickness');
}

function validateStartingGrid(p) {
  const grid = p.startingGrid;
  if (grid === undefined) return;
  validateMark(grid, 'starting grid', gridWarning);
  if (p.kind !== 'straight' || p.special)
    throw Error('Starting grid marks require a regular straight.');
  if (!Number.isFinite(grid.stagger)) throw Error('Grid stagger must be a finite distance.');
  const stagger = p.lanes > 1 ? Math.abs(grid.stagger) : 0;
  const span = grid.thickness + grid.legLength + stagger + (grid.recessed ? 2 * p.grooveWidth : 0);
  if (span > p.length + 1e-8)
    throw gridWarning('The marks need ' + formatMm(span) + ' along this ' + formatMm(p.length) + ' straight.',
      'Shorten the legs, reduce the stagger or lengthen the straight.', 'gridLegLength', 'Edit leg length');
}

const rect = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];

// Start with a transverse stripe and extend both tips toward the entry.
// Padding traces the entire paint perimeter, including its two inside corners.
function mark(front, y, grid, pad = 0) {
  const back = front - grid.thickness, tail = back - grid.legLength;
  const low = y - grid.width / 2, high = y + grid.width / 2;
  const left = tail - pad, right = front + pad, lo = low - pad, hi = high + pad;
  const innerLo = low + grid.thickness + pad, innerHi = high - grid.thickness - pad;
  if (!grid.legLength || innerLo >= innerHi) return rect(left, lo, right, hi);
  return [[[left, lo], [right, lo], [right, hi], [left, hi],
    [left, innerHi], [back - pad, innerHi], [back - pad, innerLo], [left, innerLo]]];
}

function laneClearance(p, lane, extra = 0) {
  const half = laneShoulder(p) + extra;
  // A squeeze, a spread and a moving slot all leave both ends square.
  const count = lanesVary(p) ? laneProfileSteps(p) : 1;
  const points = Array.from({ length: count + 1 }, (_, i) => [
    (i / count - 0.5) * p.length, laneOffsetAt(p, lane, i / count),
  ]);
  const normals = vertexNormals(points);
  normals[0] = normals[count] = [0, 1];
  const edge = d => points.map((point, i) => move(point, normals[i], d));
  return [[...edge(-half), ...edge(half).reverse()]];
}

// Cut the front bar into two islands beside its guide. Reserve one extra
// groove width around the braid so that the groove caps stay on deck.
function markAroundGuide(grid, front, y, gap, channel, paintChannel, warning) {
  const footprint = mark(front, y, grid);
  const surround = gap ? mark(front, y, grid, gap) : footprint;
  if (grid.legLength) {
    for (const sign of [-1, 1]) {
      const outer = y + sign * grid.width / 2;
      const inner = outer - sign * grid.thickness;
      const leg = rect(front - grid.thickness - grid.legLength - gap, Math.min(inner, outer) - gap,
        front + gap, Math.max(inner, outer) + gap);
      if (clipping.intersection(leg, channel).length)
        throw warning('A grid leg reaches its lane’s guide slot or braid shelf.',
          'Widen the mark, shorten its legs or reduce Line thickness.', 'gridWidth', 'Edit mark width');
    }
  }
  const halves = clipping.difference(footprint, paintChannel);
  if (halves.length !== 2)
    throw warning('The transverse line needs room on both sides of the braid shoulders.',
      'Increase Mark width.', 'gridWidth', 'Edit mark width');
  const borders = gap ? clipping.difference(surround, channel, halves) : [];
  return {
    surround,
    paint: halves.map(([ring]) => ring.slice(0, -1)),
    grooves: borders.flatMap(polygon => polygon.map(ring => ring.slice(0, -1))),
  };
}

/** Painted footprints and optional outline grooves, in the straight's native XY coordinates. */
export function startingGridLayout(p) {
  const paint = [], grooves = [];
  if (p.startingGrid === undefined) return { paint, grooves };
  validateStartingGrid(p);
  const grid = p.startingGrid, gap = grid.recessed ? p.grooveWidth : 0;
  const channels = Array.from({ length: p.lanes }, (_, i) => laneClearance(p, i));
  const low = -p.width / 2 + roadEdgeMarkWidth(p, 'inner');
  const high = p.width / 2 - roadEdgeMarkWidth(p, 'outer');
  const occupied = [];
  for (let i = 0; i < p.lanes; i++) {
    const row = (p.lanes - 1 - i) % 2 === 0 ? 1 : -1;
    const stagger = p.lanes > 1 ? row * grid.stagger / 2 : 0;
    const front = (grid.legLength + grid.thickness) / 2 + stagger;
    const station = (front - grid.thickness / 2) / p.length + 0.5;
    const y = laneOffsetAt(p, i, station);
    const inner = y - grid.width / 2 - gap < low - 1e-8, outer = y + grid.width / 2 + gap > high + 1e-8;
    if (inner || outer) {
      if (!hasSlotPosition(p))
        throw gridWarning('Lane ' + (i + 1) + ' reaches the road edge or its white line.',
          'Reduce Mark width or widen the road.', 'gridWidth', 'Edit mark width');
      // The mark is centred on the slot, so the nearer edge decides.
      const edge = slotEdgeName(p, inner && outer ? (y > 0 ? 'outer' : 'inner') : outer ? 'outer' : 'inner');
      const slot = p.lanes > 1 ? 'slot ' + slotNumber(p, i) : 'the slot';
      throw gridWarning('The mark' + (p.lanes > 1 ? ' on ' + slot : '') + ' reaches the ' + edge +
        ' edge of the road or its white line.',
        'Reduce Mark width to ' + formatMm(Math.max(0, 2 * (laneRoom(p, i, station) - gap))) +
        ' or less, or move ' + slot + ' away from the ' + edge + ' edge under Slot position.',
        'gridWidth', 'Edit mark width');
    }
    const channel = channels[i], paintChannel = gap ? laneClearance(p, i, gap) : channel;
    const stroke = markAroundGuide(grid, front, y, gap, channel, paintChannel,
      slotVaries(p) ? slantedSlotWarning : gridWarning);
    const { surround } = stroke;
    const marks = occupied.findIndex(other => clipping.intersection(other, surround).length);
    const slots = channels.findIndex((channel, j) => j !== i && clipping.intersection(channel, surround).length);
    if (marks >= 0 || slots >= 0) {
      if (!hasSlotPosition(p))
        throw gridWarning('Adjacent starting marks or lane channels overlap.',
          'Reduce Mark width or increase the lane spacing.', 'gridWidth', 'Edit mark width');
      // Name the two slots, numbered from the edge they are measured from.
      const [a, b] = [slotNumber(p, i), slotNumber(p, marks >= 0 ? marks : slots)].sort((x, y) => x - y);
      throw gridWarning(
        (marks >= 0 ? 'The marks on slots ' + a + ' and ' + b + ' overlap.'
          : 'The mark on slot ' + slotNumber(p, i) + ' reaches slot ' + slotNumber(p, slots) + ' or its braids.'),
        'Reduce Mark width, or move slots ' + a + ' and ' + b + ' further apart under Slot position.',
        'gridWidth', 'Edit mark width');
    }
    occupied.push(surround);
    paint.push(...stroke.paint);
    grooves.push(...stroke.grooves);
  }
  return { paint, grooves };
}

function pitGridHalfWidth(p, sign) {
  const side = sign > 0 ? 'outer' : 'inner';
  const outerLane = (p.lanes - 1) * p.laneSpacing / 2;
  const kerb = p.roadKerbSide === 'both' || p.roadKerbSide === side ? p.kerbWidth : 0;
  const outside = p.width / 2 - outerLane - roadEdgeMarkWidth(p, side) - kerb;
  const inside = p.special.pitWhiteLine
    ? pitDividerOffsetAtBay(p, sign) + p.whiteLineWidth / 2 + (lineGrooves(p).road ? p.grooveWidth : 0)
    : laneShoulder(p) + pitBraidLandingShift(p);
  return Math.min(outside, p.special.pitOffset - inside);
}

export function defaultPitGrid(p) {
  const halfWidth = Math.min(...pitSides(p.special.side).map(sign => pitGridHalfWidth(p, sign)));
  const length = (1 - 2 * pitBayStart) * p.length;
  const dimensions = markDefaults(Math.max(0.1, 2 * halfWidth), length, 2 * (laneShoulder(p) + pitBraidLandingShift(p)));
  return { ...dimensions, legLength: Number(dimensions.legLength.toFixed(3)),
    position: 50 };
}

/** Position the complete mark, including its paint groove, in the level bay. */
export function pitGridLayout(p) {
  const paint = [], grooves = [];
  const grid = p.special?.pitGrid;
  if (grid === undefined) return { paint, grooves };
  if (p.special.type !== 'pit') throw Error('A pit grid marker requires a pit lane.');
  validateMark(grid, 'pit grid marker', pitWarning);
  if (!Number.isFinite(grid.position) || grid.position < 0 || grid.position > 100)
    throw pitWarning('Position must be between 0 and 100%.', 'Choose a position from pit entry to exit.',
      'gridPosition', 'Edit marker position');
  const paired = p.special.side === 'both' && grid.rightPosition !== undefined;
  if (paired && (!Number.isFinite(grid.rightPosition) || grid.rightPosition < 0 || grid.rightPosition > 100))
    throw pitWarning('Right pit position must be between 0 and 100%.', 'Choose a position from pit entry to exit.',
      'gridRightPosition', 'Edit right marker position');
  const gap = grid.recessed ? p.grooveWidth : 0;
  const bayHalfLength = (0.5 - pitBayStart) * p.length;
  const span = grid.thickness + grid.legLength + 2 * gap;
  const travel = 2 * bayHalfLength - span;
  if (travel < -1e-8)
    throw pitWarning('The mark needs ' + formatMm(span) + ' along a flat pit bay of ' + formatMm(2 * bayHalfLength) + '.',
      'Shorten the legs or lengthen the pit.', 'gridLegLength', 'Edit leg length');
  const guideHalfWidth = laneShoulder(p) + pitBraidLandingShift(p);
  const laneOffset = p.special.pitOffset + (p.lanes - 1) * p.laneSpacing / 2;
  for (const sign of pitSides(p.special.side)) {
    const position = paired && sign < 0 ? grid.rightPosition : grid.position;
    const front = -bayHalfLength + span - gap + Math.max(0, travel) * position / 100;
    if (grid.width / 2 + gap > pitGridHalfWidth(p, sign) + 1e-8)
      throw pitWarning('The grid marker reaches the road edge, main lane or another marking.',
        'Reduce Mark width or make more room beside the pit lane.', 'gridWidth', 'Edit mark width');
    const y = sign * laneOffset;
    const channel = extra => rect(-p.length / 2, y - guideHalfWidth - extra, p.length / 2, y + guideHalfWidth + extra);
    const guide = channel(0);
    const stroke = markAroundGuide(grid, front, y, gap, guide, gap ? channel(gap) : guide, pitWarning);
    paint.push(...stroke.paint);
    grooves.push(...stroke.grooves);
  }
  return { paint, grooves };
}
