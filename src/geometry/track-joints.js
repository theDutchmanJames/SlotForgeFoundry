import { dot, left, minus, move, unit } from './solids.js';
import { tabPair, clipPair } from './joints.js';
import { resolveJointFit } from './joint-fit.js';
import { clipSpec } from './clip-types.js';
import { KEEPER_CHAMBER_TOP } from './keeper-dimensions.js';
import { drawKeyOutline } from './retained-clip.js';
import { timingContactFootprints } from './timing-straight.js';
import {
  configuredPositions,
  configuredPositionKey,
  countWarningSetting,
  positionKey,
  activeJointMode,
  countedJoint,
  connectorCount,
} from './placements.js';
import {
  connectorEnvelopes,
  fixedFirst,
  nearestOffset,
  planConnectorRow,
  separated,
  spread,
  usesClips as clips,
  usesTabs as tabs,
} from './connector-counts.js';
import {
  roadLengthWarning,
  roadOffsetWarning,
  sideMountWarning,
  slotPocketWarning,
  slotPositionSetting,
} from './connector-position-warnings.js';
import { connectorWarning, formatMm } from './connector-warning.js';
import {
  SCREW_CLIP_NAME,
  isScrewClip,
  screwClipGeometry,
  screwClipPart,
  screwClipSettings,
  screwClipTools,
  screwClipZones,
  screwSides,
  sideName,
  tabsOnly,
} from './screw-clip.js';
import { endObstacleText, slotEndRequest, slotEndRow } from './slot-end-row.js';
import { hasSlotPosition } from '../slot-position.js';
import { apexPositionFor, borderApexStations } from './border-profile.js';
import { borderSeam, insideBorderStock } from './border-ends.js';
import {
  borderEndLengthWarning,
  borderEndPositionWarning,
  borderEndWidthWarning,
} from './border-fit-warning.js';

export { connectorEnvelopes };
export const integralJointMode = (mode) => (tabs(mode) ? 'tabs' : 'none');
const connectorId = (base, ordinal) =>
  ordinal ? base + '-' + (ordinal + 1) : base;
const countedSpecs = (row) => [
  ...spread(row.tab, 'tab', true), ...spread(row.clip, 'clip', true),
];
const obstacle = {
  ...endObstacleText,
  laneSweep: 'The pocket would reach a guide slot wall along the lane.',
  opposite: 'The pocket would meet another connector across the segment.',
  outline: 'The pocket and its supporting walls extend outside the part.',
  finish: 'The pocket reaches the shaped end of the border.',
  angle: 'A tab cannot slide into its socket here.',
  roadEnd: 'The support is too close to a road segment end.',
  borderEnd: 'The support is too close to a border segment end.',
  width: 'This section of the border is too narrow for the socket.',
  slotSweep: 'The pocket would reach a guide slot wall where the slot moves sideways.',
  channel: 'The support would intersect a guide slot, braid recess or existing pocket.',
  feed: 'The connector support would intersect a braid pass-through.',
  detector: 'The connector support would reach the timing equipment.',
  screwClip: 'The tab support would meet a Kevan Sideclip pocket at the road edge.',
};
// The text for a blocking reason. A sweep on a piece with an off-centre slot
// is the slot moving sideways; on any other piece it keeps its old words.
const obstacleText = (reason, p) =>
  obstacle[reason === 'laneSweep' && hasSlotPosition(p) ? 'slotSweep' : reason];
const importedSlideDirections = new WeakMap();
const wrappingBorderMessage = (index, sign) =>
  (sign > 0 ? 'Outside' : 'Inside') +
  ' border attachment ' +
  (index + 1) +
  ' wraps too far to slide onto its tabs. Add matching road and border segments, or choose side clips.';

function borderExtrema(path, p, side, start, end) {
  return [...borderApexStations(path, p, side), path.borderProfileSeam].filter(
    (t) => t > start && t < end,
  );
}

function endReach(mode, envelopes, side) {
  return Math.max(
    tabs(mode) ? envelopes.tab[side] : 0,
    clips(mode) ? envelopes.clip[side] : 0,
  );
}

function minimumJointLength(envelopes, startMode, finishMode) {
  return Math.max(
    18,
    endReach(startMode, envelopes, 'socket') +
      endReach(finishMode, envelopes, 'root') +
      2,
  );
}

export function jointSampleLength(p, selected, mode) {
  const envelopes = connectorEnvelopes(p);
  if (selected === 'border')
    return Math.max(48, 2 * minimumJointLength(envelopes, mode, mode));
  if (selected !== 'side')
    return Math.max(
      48,
      2 *
        Math.max(
          minimumJointLength(envelopes, mode, 'none'),
          minimumJointLength(envelopes, 'none', mode),
        ),
    );
  // Keep the selected stations on the sample. Increasing its length gives
  // wide features room without changing the percentages the user specified.
  const sideTabs = configuredPositions(p, 'side', 'tab', p.borderSide);
  const sideClips = configuredPositions(p, 'side', 'clip', p.borderSide);
  const request = countedJoint(p, 'side', p.borderSide, mode);
  if (request) {
    const count = request.tab.count + request.clip.count;
    const half = Math.max(...['tab', 'clip'].map(type => request[type].count ? envelopes[type].half : 0));
    const length = Math.max(80, (half + 1) / 0.14, (2 * half + 1) * (count - 1) / 0.72);
    if (!sideTabs && !sideClips) return length;
    // A manually pinned station may be close to the sample's end.
    return Math.max(length, ...['tab', 'clip'].flatMap(type =>
      (request[type].fixed ?? []).map(v => (envelopes[type].half + 1) / Math.min(v, 1-v))));
  }
  const stations = [
    ...(tabs(mode)
      ? spread(sideTabs ?? [0.32, 0.68], 'tab', Boolean(sideTabs))
      : []),
    ...(clips(mode)
      ? spread(sideClips ?? [0.5], 'clip', Boolean(sideClips))
      : []),
  ].sort((a, b) => a.value - b.value);
  let length = 80;
  for (const [index, station] of stations.entries()) {
    const half = envelopes[station.type].half;
    length = Math.max(
      length,
      (half + 1) / Math.min(station.value, 1 - station.value),
    );
    const previous = stations[index - 1];
    if (previous) {
      const fixed = previous.custom && station.custom;
      const gap = station.value - previous.value;
      if (fixed && gap <= 0)
        throw new Error('Move overlapping side connector positions apart.');
      // Automatic tabs at 32/68% flank the clip at 50%. A custom mark
      // close to an automatic one can use the same clearance allowance;
      // placement will shift the automatic mark to an open position.
      const spacing = fixed ? gap : Math.max(gap, 0.18);
      length = Math.max(
        length,
        (half + envelopes[previous.type].half + 1) / spacing,
      );
    }
  }
  return length;
}

const borderName = (side) =>
  side === 'inner' ? 'Inside border' : 'Outside border';
const endName = (index, count) =>
  index === 0 ? 'start' : index === count ? 'finish' : 'seam ' + index;

function addConnector(
  work,
  p,
  type,
  point,
  dir,
  first,
  second,
  loose,
  id,
  label,
  externalKeeper,
  station,
) {
  try {
    if (type === 'tab') tabPair(work, p, point, dir, first, second);
    else
      clipPair(work, p, point, dir, first, second, loose, id, externalKeeper);
    if (station) {
      for (const part of [first, second]) {
        if (part) part.jointGuides.at(-1).station = station;
      }
    }
  } catch (error) {
    throw new Error(label + '. ' + error.message, { cause: error });
  }
}

// A sufficiently wide opening at the seam can still lead out through a
// curved or tapered outer wall at the far end of a long pocket.
function footprintCorners(point, dir, from, to, half) {
  const across = left(dir);
  return [
    [from, -1],
    [to, -1],
    [to, 1],
    [from, 1],
  ].map(([x, sign]) => move(move(point, dir, x), across, sign * half));
}

// Test tools already present in the mesh, including deep braid shelves and
// imported slot paths that turn soon after the seam. Cache their projections,
// and dispose temporary search footprints immediately.
function stockChecker(work, p) {
  const spec = clipSpec(p);
  const fit = resolveJointFit(p);
  const cuts = new WeakMap();
  const roofs = {
    tab: fit.tabTop + fit.tabClearance + 0.4,
    clip: (spec?.seatHeight ?? 0.3) + (spec?.thickness ?? 0) +
      (spec?.verticalClearance ?? fit.clipClearance) + (spec?.roofThickness ?? 0.4),
  };
  const timing = [];
  if (p.special?.type === 'timing') {
    for (let i = 0; i < p.lanes; i++) for (const sign of [-1,1]) {
      const lane = (i - (p.lanes - 1) / 2) * p.laneSpacing;
      timing.push(...timingContactFootprints(p, lane, sign));
    }
  }
  return (type, point, dir, first, second, env) => {
    const from = first ? -env.root : 0, to = second ? env.socket : 0;
    const loop = footprintCorners(point, dir, from, to, env.half);
    if (timing.some(rect => pocketsOverlap(loop, rect))) return 'detector';
    let area, keyArea;
    try {
      for (const part of [first, second]) for (const cut of part?.cuts ?? []) {
        let record = cuts.get(cut);
        if (!record) {
          record = {bounds: cut.boundingBox()};
          cuts.set(cut, record);
        }
        const {min, max} = record.bounds;
        if (min[2] >= roofs[type] || [0,1].some(axis =>
          loop.every(v => v[axis] <= min[axis]) || loop.every(v => v[axis] >= max[axis]))) continue;
        area ??= new work.wasm.CrossSection([loop], 'EvenOdd');
        let shape = area;
        if (type === 'clip' && spec?.type === 'draw-key' && min[2] >= KEEPER_CHAMBER_TOP + spec.roofThickness) {
          if (!keyArea) {
            const key = drawKeyOutline(0.6).filter(([x]) => x >= from && x <= to)
              .map(([x,y]) => move(move(point, dir, x), left(dir), y));
            const base = new work.wasm.CrossSection([key], 'EvenOdd');
            try { keyArea = base.offset(fit.clipClearance); } finally { base.delete(); }
          }
          shape = keyArea;
        }
        record.projection ??= work.own(cut.project());
        const collision = shape.intersect(record.projection);
        try {
          if (collision.area() > 0.00001) return part.feedCuts?.includes(cut) ? 'feed' : 'channel';
        } finally { collision.delete(); }
      }
      return null;
    } finally {
      area?.delete();
      keyArea?.delete();
    }
  };
}

function footprintConflict(work, first, second, point, dir, envelope) {
  const firstSleeves = first?.adjustedLaneSleeves;
  const secondSleeves = second?.adjustedLaneSleeves;
  if (!envelope.checkOutline && !firstSleeves && !secondSleeves) return null;
  const loop = footprintCorners(point, dir, first ? -envelope.root : 0,
    second ? envelope.socket : 0, envelope.half);
  let remainder = new work.wasm.CrossSection([loop], 'EvenOdd');
  try {
    for (const sleeves of new Set([firstSleeves, secondSleeves])) {
      if (!sleeves) continue;
      const collision = remainder.intersect(sleeves);
      try {
        if (collision.area() > 0.00001) return 'laneSweep';
      } finally {
        collision.delete();
      }
    }
    if (!envelope.checkOutline) return null;
    for (const part of [first, second]) {
      if (!part) continue;
      const next = remainder.subtract(part.section);
      remainder.delete();
      remainder = next;
    }
    return remainder.area() < 0.001 ? null : 'outline';
  } finally {
    remainder.delete();
  }
}

function fitsOutline(work, first, second, point, dir, envelope) {
  return !footprintConflict(work, first, second, point, dir, envelope);
}

function pocketsOverlap(a, b) {
  // The two axes of each rectangle suffice even when the seams are oblique.
  for (const rectangle of [a, b]) {
    for (let i = 0; i < 2; i++) {
      const axis = unit(minus(rectangle[i + 1], rectangle[i]));
      const p = a.map(v => dot(v, axis)), q = b.map(v => dot(v, axis));
      if (Math.min(Math.max(...p), Math.max(...q)) <=
          Math.max(Math.min(...p), Math.min(...q)) + 1e-6) return false;
    }
  }
  return true;
}

export function opposingRoadPockets(p, path, envelopes) {
  const pointAt = path.atOffset ?? path.point;
  const start = endDirection(p, path, 0);
  const finish = endDirection(p, path, 1);
  return stations => {
    const sockets = stations.map(({type, value}) => footprintCorners(
      pointAt(0, value), start, 0, envelopes[type].socket + 1, envelopes[type].half,
    ));
    const roots = stations.map(({type, value}) => footprintCorners(
      pointAt(1, value), finish, -envelopes[type].root - 1, 0, envelopes[type].half,
    ));
    return sockets.some(a => roots.some(b => pocketsOverlap(a, b))) ? obstacle.opposite : null;
  };
}

// Check each side in its own printed part. Equal offsets on two angled seams
// can have ample clearance at the road centre even on a very short inner arc.
function roadPocketConflict(work, first, second, point, dir, envelope, reserve) {
  for (const [part, from, to] of [
    [first, -envelope.root, 0],
    [second, 0, envelope.socket],
  ]) {
    if (!part) continue;
    // Together two extra millimetres beyond the pocket tips leave the web
    // required between opposing joints without forcing them onto one line.
    const loop = footprintCorners(point, dir, from ? from - 1 : 0, to ? to + 1 : 0, envelope.half);
    if (reserve) {
      (part.roadPocketStock ??= []).push(loop);
      continue;
    }
    const conflict = footprintConflict(work, from ? part : null, to ? part : null,
      point, dir, { ...envelope, checkOutline: true });
    if (conflict) return conflict;
    if (part.roadPocketStock?.some(other => pocketsOverlap(loop, other))) return 'opposite';
  }
  return null;
}

export function endDirection(p, path, t) {
  const tangent = path.tangent(t);
  if (p.jointFitVersion !== 2 || !path.normal) return tangent;
  // Separate pieces may approach a common imported end face at different angles.
  const normal = left(path.normal(t));
  return dot(normal, tangent) >= 0 ? normal : normal.map((v) => -v);
}

export function outwardNormal(path, t, edge, sign) {
  const across = path.normal?.(t) ?? left(path.tangent(t));
  if (!path.normal) return across.map((v) => v * sign);
  const before = path.point(Math.max(0, t - 1e-5), edge);
  const after = path.point(Math.min(1, t + 1e-5), edge);
  const normal = left(unit(minus(after, before)));
  return normal.map((v) => v * (dot(normal, across) >= 0 ? sign : -sign));
}

export function borderSlideDirection(p, path, index, edge, sign) {
  // With tabbed border ends, join the borders as a chain before sliding them
  // onto the road. A coincident road and border seam starts a new assembly.
  let start = index,
    finish = index + 1;
  if (tabs(activeJointMode(p, 'end', sign > 0 ? 'outer' : 'inner'))) {
    const onRoadSeam = (i) => {
      const u = borderSeam(path, p, i) * p.segments;
      return Math.abs(u - Math.round(u)) < 1e-9;
    };
    while (start > 0 && !onRoadSeam(start)) start--;
    while (finish < p.borderSegments && !onRoadSeam(finish)) finish++;
  }
  const a = borderSeam(path, p, start),
    b = borderSeam(path, p, finish);
  if (!path.normal) {
    if (p.kind === 'curve' && p.angle * (b - a) > 180)
      throw new Error(wrappingBorderMessage(index, sign));
    return outwardNormal(path, (a + b) / 2, edge, sign);
  }
  // Imported outlines may contain thousands of vertices. Each connected chain
  // shares one direction, so inspect that part of the polyline only once.
  let directions = importedSlideDirections.get(path);
  if (!directions) {
    directions = new Map();
    importedSlideDirections.set(path, directions);
  }
  const chain = [start, finish, sign].join('/');
  if (directions.has(chain)) return directions.get(chain);
  // Parallel tabs on one border must clear the entire mating edge on approach.
  // The smallest arc containing its face normals gives the most even approach.
  const stations = path.stations.filter((t) => t >= a && t <= b);
  const samples = [
    a,
    b,
    ...stations.slice(1).map((t, i) => (t + stations[i]) / 2),
  ];
  const turns = samples
    .map((t) => {
      const n = outwardNormal(path, t, edge, sign);
      return Math.atan2(n[1], n[0]);
    })
    .sort((x, y) => x - y);
  const wrap = 2 * Math.PI;
  let first = turns[0],
    gap = first + wrap - turns.at(-1);
  for (let i = 1; i < turns.length; ++i) {
    const distance = turns[i] - turns[i - 1];
    if (distance > gap) {
      gap = distance;
      first = turns[i];
    }
  }
  if (gap < Math.PI - 1e-7) throw new Error(wrappingBorderMessage(index, sign));
  const heading = first + (wrap - gap) / 2;
  const direction = [Math.cos(heading), Math.sin(heading)];
  directions.set(chain, direction);
  return direction;
}

const sideField = (sign) => (sign > 0 ? 'sideClipLeft' : 'sideClipRight');

function screwClipWarning(p, { location, sign, reason, detail, lanes, edge, end, minWidth, minLength }) {
  const wider = minWidth ? 'widen the road to at least ' + formatMm(minWidth) : 'widen the road';
  const label = location + ' · ' + SCREW_CLIP_NAME + ', ' + sideName(sign);
  const side = sideName(sign);
  const switchOff =
    'switch off the ' + side + ' clip under Connections → Road connections';
  const sideSetting = {
    tab: 'joints',
    field: sideField(sign),
    label: 'Edit ' + side + ' clip',
  };
  const shorter = 'use a shallower clip under Connections → Project clip type';
  let advice, setting;
  if (reason === 'narrow') {
    advice = 'Switch off one side under Connections → Road connections, ' + shorter + ', or ' + wider + ' under Road → Road width.';
    setting = { tab: 'geometry', field: 'width', label: 'Edit road width' };
  } else if (reason === 'feed') {
    advice = 'Move the braid pass-through under Cross-section → Braid pass-throughs, or ' + switchOff + '.';
    setting = { tab: 'profile', field: 'feedPercent', label: 'Edit braid pass-throughs' };
  } else if (reason === 'opposite') {
    advice = (minLength
      ? (p.kind === 'curve'
        ? 'Increase Road → Sweep angle to at least ' + minLength.angle + '°'
        : 'Increase Road → Road length to at least ' + formatMm(minLength.length))
      : 'Lengthen the piece') +
      (p.segments > 1 ? ', use fewer road segments, or ' : ', or ') + switchOff + '.';
    setting = p.segments > 1
      ? { tab: 'geometry', field: 'segments', label: 'Edit road segments' }
      : p.kind === 'curve'
        ? { tab: 'geometry', field: 'angle', label: 'Edit sweep angle' }
        : { tab: 'geometry', field: 'length', label: 'Edit road length' };
  } else if (hasSlotPosition(p) && ['lane', 'channel'].includes(reason)) {
    advice = 'Move the slot away from this edge under Road → Slot position, ' + shorter + ', or ' + switchOff + '.';
    setting = slotPositionSetting(p, lanes, edge, end);
  } else {
    advice = 'Switch off the ' + side + ' clip under Connections → Road connections, ' + shorter + ', or ' + wider + '.';
    setting = sideSetting;
  }
  const error = connectorWarning(label, detail, advice, setting);
  error.code = 'SCREW_CLIP_PLACE';
  return error;
}

/**
 * Kevan Sideclips at every road joint with clips: one at each enabled road
 * edge, centred on the seam. They never move; when the piece leaves no room
 * the build stops with a warning that says what to change.
 * Fills zones with the across-road room each joint's clips keep.
 */
function addScrewClips(work, p, path, lanes, roads, loose, modes, zones) {
  const sides = screwSides(p);
  if (!sides.length) return;
  const s = screwClipSettings(p);
  const g = screwClipGeometry(s, p.height);
  const pointAt = path.atOffset ?? path.point;
  const finishClips = clips(modes.at(-1));
  const timing = [];
  if (p.special?.type === 'timing') {
    for (let n = 0; n < p.lanes; n++) for (const sign of [-1, 1]) {
      const lane = (n - (p.lanes - 1) / 2) * p.laneSpacing;
      timing.push(...timingContactFootprints(p, lane, sign));
    }
  }
  let roadUnion;
  const outsideRoad = (section) => {
    roadUnion ??= work.own(work.wasm.CrossSection.union(roads.map((road) => road.section)));
    return work.own(section.subtract(roadUnion));
  };
  for (let i = 0; i < modes.length; i++) {
    if (!clips(modes[i])) continue;
    const end = i === 0 ? 'start' : i === roads.length ? 'finish' : 'seam';
    const t = i / roads.length,
      first = roads[i - 1],
      second = roads[i];
    const width = path.widthAt?.(t) ?? p.width;
    const seamLanes = path.laneOffsets?.(t) ?? lanes;
    const dir = endDirection(p, path, t);
    const location = 'Road ' + endName(i, roads.length);
    const row = screwClipZones(p, width);
    zones.set(i, row);
    // The guide slot and its wall must stay clear of the pocket.
    const reach = s.screwClipDepth + g.gap + p.slotWidth / 2 + p.wall;
    // The narrowest road that takes these clips beside these slots.
    let minWidth = row.length === 2 ? 2 * g.across + 0.2 : g.across + 1;
    for (const { sign } of sides)
      for (const lane of seamLanes) minWidth = Math.max(minWidth, 2 * (reach + sign * lane) + 0.01);
    minWidth = Math.ceil(minWidth * 2 - 1e-9) / 2;
    if (
      width < g.across + 1 ||
      (row.length === 2 && !separated([row[0]], row[1].position, row[1].half))
    )
      throw screwClipWarning(p, {
        location, sign: row[0].sign, reason: 'narrow', end, minWidth,
        detail: 'The road is ' + formatMm(width) + ' wide. ' +
          (row.length === 2 ? 'Clips on both sides' : 'The clip') +
          (seamLanes.length ? ' beside the guide ' + (seamLanes.length > 1 ? 'slots' : 'slot') : '') +
          ' need' + (row.length === 2 ? '' : 's') + ' at least ' + formatMm(minWidth) + '.',
      });
    // Clips at both ends of one road segment need this much edge between them.
    const segmentEdge = (sign) =>
      p.kind === 'curve'
        ? ((p.radius + (sign * width) / 2) * p.angle * Math.PI) / 180 / roads.length
        : (path.segmentLengths?.[Math.max(0, i - 1)] ?? p.length / roads.length);
    const endToEnd = 2 * (g.along + 1);
    for (const { sign, direction } of sides) {
      const index = sign > 0 ? 0 : 1;
      const edgeOffset = (sign * width) / 2;
      const warn = (reason, detail) =>
        screwClipWarning(p, {
          location, sign, reason, detail, lanes: seamLanes, edge: edgeOffset, end, minWidth,
          minLength: reason === 'opposite' && {
            length: Math.ceil(endToEnd * roads.length * 10) / 10,
            angle: Math.ceil(((endToEnd * roads.length) / (p.radius + (sign * width) / 2)) * (1800 / Math.PI)) / 10,
          },
        });
      const nearest = Math.min(...seamLanes.map((lane) => width / 2 - sign * lane));
      if (seamLanes.length && nearest <= reach + 1e-9)
        throw warn('lane',
          'The nearest guide slot centre is ' + formatMm(nearest) + ' from the ' + sideName(sign).replace(' side', '') +
            ' edge. The clip pocket and the slot wall need more than ' + formatMm(reach) + '.');
      const tools = screwClipTools(work, p, {
        edge: pointAt(t, edgeOffset),
        dir,
        sign,
        directions: { first: first && direction, second: second && direction },
      });
      if (timing.some((rect) => pocketsOverlap(tools.plan, rect)))
        throw warn('detector', 'The clip pocket would reach the timing equipment.');
      const halves = [
        [first, -1],
        [second, 1],
      ].filter(([part]) => part);
      const guardBox = tools.guard.boundingBox();
      for (const [part, side] of halves) {
        const stock = screwStock(tools, side);
        if (part.roadPocketStock?.some((other) => pocketsOverlap(stock, other)))
          throw warn('opposite', 'The clip pocket meets a connector from the other end of this road segment. ' +
            'Clips at both ends need at least ' + formatMm(endToEnd) + ' along the ' +
            sideName(sign).replace(' side', '') + ' edge; this segment has ' + formatMm(Math.round(segmentEdge(sign) * 100) / 100) + '.');
        for (const cut of part.cuts) {
          const box = cut.boundingBox();
          if ([0, 1, 2].some((k) => box.max[k] <= guardBox.min[k] || box.min[k] >= guardBox.max[k]))
            continue;
          if (work.and(cut, tools.guard).volume() > 0.001)
            throw part.feedCuts?.includes(cut)
              ? warn('feed', 'The clip pocket or a screw would cut into a braid pass-through.')
              : warn('channel', 'The clip pocket or a screw would cut into a guide slot, a braid recess or another pocket.');
        }
      }
      for (const [part, side] of halves) {
        (part.roadPocketStock ??= []).push(screwStock(tools, side));
        if (p.hollow) {
          const limits = work.prism(part.section, 0, p.height);
          part.additions.push(work.and(tools.support, limits));
          if (p.reinforcement) (part.ribKeepouts ??= []).push(work.own(tools.support.project()));
        }
        part.cuts.push(tools.cut, tools.screws[side < 0 ? 'first' : 'second'].holes);
        (part.jointGuides ??= []).push({ kind: 'Clip', point: [...tools.centre, 0] });
      }
      // Where the clip corners stand proud of a convex side face, a border on
      // that side is relieved to clear them.
      const proud = outsideRoad(tools.footprint);
      if (proud.area() > 1e-3)
        (roads[0].screwReliefs ??= []).push({
          sign,
          solid: work.prism(proud, g.floor, g.top),
        });
      const startOnly = i === 0 && !finishClips;
      const id = (first || startOnly) && 'road-clip-' + i + (index ? '-' + (index + 1) : '');
      if (id)
        loose.push(screwClipPart(work, p, tools, {
          id,
          plannerJoint: work.planning && { xy: tools.centre.slice(), dir: dir.slice(), side: first ? -1 : 1 },
        }));
    }
  }
}

// The plan one half of a side clip keeps from connectors at the other end.
function screwStock(tools, side) {
  const { along, across } = tools.geometry;
  const [u0, u1] = side < 0 ? [-along - 1, 0] : [0, along + 1];
  return [[u0, 0], [u1, 0], [u1, across], [u0, across]].map(([u, v]) => tools.at(u, v));
}

export function addRoadJoints(
  work,
  p,
  path,
  lanes,
  roads,
  loose,
  jointLimits = {},
) {
  const placements = p.placements ?? {};
  const matchedEnds = new Map();
  // Beside an off-centre slot each external end takes its row from that end
  // alone (slot-end-row.js). The piece is then checked against it, never bent
  // around it, so that two ends with the same slot always fit together.
  const fixedEndRows = hasSlotPosition(p);
  const checkStock = (p.connectorCounts || fixedEndRows) && stockChecker(work, p);
  const envelopes = connectorEnvelopes(p);
  const pathLength =
    path.minLength ??
    (p.kind === 'straight'
      ? p.length
      : ((p.radius - p.width / 2) * p.angle * Math.PI) / 180);
  const modes = Array.from({ length: roads.length + 1 }, (_, i) => {
    if (jointLimits.skipped?.has(i)) return 'none';
    const mode = activeJointMode(
      p,
      i === 0 ? 'start' : i === roads.length ? 'finish' : 'seam',
    );
    return jointLimits.integralOnly?.has(i) ? integralJointMode(mode) : mode;
  });
  for (let i = 0; i < roads.length; i++) {
    const modeA = modes[i],
      modeB = modes[i + 1];
    const available = path.segmentLengths?.[i] ?? pathLength / p.segments;
    // On a straight the individual pocket must fit between the two faces.
    // Two pockets may clear one another at different offsets across the road.
    const minimum = Math.max(
      minimumJointLength(envelopes, modeA, 'none'),
      minimumJointLength(envelopes, 'none', modeB),
    );
    if (p.kind === 'straight' && (modeA !== 'none' || modeB !== 'none') && available < minimum)
      throw roadLengthWarning(
        p,
        i,
        available,
        minimum,
        [
          modeA !== 'none' && endName(i, roads.length),
          modeB !== 'none' && endName(i + 1, roads.length),
        ]
          .filter(Boolean)
          .join(' and '),
        clips(modeA) || clips(modeB) ? envelopes.clip.name : 'tab',
      );
  }
  // Kevan Sideclips sit at the road edges, fixed by the side faces. Fit them
  // first; tabs at the same joints then keep clear of them.
  const screwZones = new Map();
  const screw = isScrewClip(p);
  if (screw) {
    addScrewClips(work, p, path, lanes, roads, loose, modes, screwZones);
    for (let i = 0; i < modes.length; i++) modes[i] = tabsOnly(modes[i]);
  }
  const screwConflict = (i, x, envelope) =>
    !separated(screwZones.get(i) ?? [], x, envelope.half);
  const startRequest = countedJoint(p, 'start', undefined, modes[0]);
  const matchExternalRows = !fixedEndRows && p.kind !== 'import' && startRequest &&
    JSON.stringify(startRequest) === JSON.stringify(countedJoint(p, 'finish', undefined, modes.at(-1)));
  const indices = Array.from(modes.keys());
  // Finish the internal seams first. Both external rows can then be tested
  // against the actual pockets already reserved in their respective parts.
  // Fixed external rows go in first instead, and the seams make room for them.
  const seamOrder = fixedEndRows
    ? [0, roads.length, ...indices.slice(1, -1)]
    : matchExternalRows ? [...indices.slice(1, -1), 0, roads.length] : indices;
  for (const i of seamOrder) {
    const end = i === 0 ? 'start' : i === roads.length ? 'finish' : 'seam';
    const mode = modes[i];
    if (mode === 'none') continue;
    const t = i / roads.length,
      first = roads[i - 1],
      second = roads[i];
    const width = path.widthAt?.(t) ?? p.width;
    const seamLanes = path.laneOffsets?.(t) ?? lanes;
    const manualTabs = placements[end + 'Tabs'],
      manualClips = placements[end + 'Clips'];
    const autoDistance = p.connectorOffset || width * 0.36;
    let specs = [
      ...(tabs(mode)
        ? spread(
            manualTabs ?? [-autoDistance, autoDistance],
            'tab',
            Boolean(manualTabs || p.connectorOffset),
          )
        : []),
      ...(clips(mode)
        ? spread(manualClips ?? [0], 'clip', Boolean(manualClips))
        : []),
    ].sort(fixedFirst);
    const occupied = [...(screwZones.get(i) ?? [])];
    const dir = endDirection(p, path, t);
    const pointAt = path.atOffset ?? path.point;
    const location = 'Road ' + endName(i, roads.length);
    const request = countedJoint(p, end, undefined, mode);
    const connect = (type, index, offset, label, station) => {
      // With two external ends, one set of loose clips usually serves
      // repeating pieces. Include extra clips if the start has more stations.
      const finishCount = clips(modes.at(-1))
        ? connectorCount(p, 'finish', 'clip')
        : 0;
      const startOnly = i === 0 && index >= finishCount;
      const stationId = connectorId('road-clip-' + i, index);
      const id = (first || startOnly) && stationId;
      const externalKeeper = !id && {
        stationId,
        parentClipId: connectorId('road-clip-' + roads.length, index),
      };
      addConnector(
        work,
        p,
        type,
        pointAt(t, offset),
        dir,
        first,
        second,
        loose,
        id,
        label,
        externalKeeper,
        station,
      );
    };
    // A fit sample joins two mating ends at its seam: path.matingSeams.
    if (fixedEndRows && (end !== 'seam' || path.matingSeams)) {
      const { specs: row } = slotEndRow(
        slotEndRequest(p, end, {
          width, lanes: seamLanes, mode, envelopes, location,
          ...(screw && { screwZones: screwZones.get(i) ?? [] }),
        }),
      );
      for (const spec of row) {
        const envelope = envelopes[spec.type],
          point = pointAt(t, spec.value);
        const reason =
          (screwConflict(i, spec.value, envelope) ? 'screwClip' : null) ??
          roadPocketConflict(work, first, second, point, dir, envelope, false) ??
          checkStock(spec.type, point, dir, first, second, envelope);
        if (reason)
          throw slotPocketWarning({
            ...spec,
            label: location + ' · ' + envelope.name,
            kind: p.kind,
            end,
            reason,
            setting: slotPositionSetting(p, seamLanes, spec.value, end),
            lanes: seamLanes.length,
          });
      }
      for (const { type, value, index } of row) {
        roadPocketConflict(work, first, second, pointAt(t, value), dir, envelopes[type], true);
        connect(type, index, value, location + ' · ' + envelopes[type].name, {
          key: positionKey(end, type),
          index: i,
          value,
        });
      }
      continue;
    }
    // Plan identical external joints together on a short bend so a repeated
    // piece always has matching sockets and both ends retain enough stock.
    const matchRow = matchExternalRows && end === 'start';
    const farPart = roads.at(-1);
    const farDir = matchRow ? endDirection(p, path, 1) : null;
    function roadObstacle(type, x, match) {
      const envelope = envelopes[type];
      if (Math.abs(x) > width / 2 - envelope.half + 1e-8) return 'edge';
      const laneSpace = p.slotWidth / 2 + p.wall + envelope.half;
      if (seamLanes.some(lane => Math.abs(lane - x) <= laneSpace)) return 'lane';
      if (screwConflict(i, x, envelope)) return 'screwClip';
      const reason = roadPocketConflict(work, first, second, pointAt(t, x), dir, envelope, false);
      const stock = reason ?? checkStock(type, pointAt(t, x), dir, first, second, envelope);
      if (stock || !match) return stock;
      const farWidth = path.widthAt?.(1) ?? p.width;
      if (Math.abs(x) > farWidth / 2 - envelope.half + 1e-8) return 'edge';
      if ((path.laneOffsets?.(1) ?? lanes).some(lane => Math.abs(lane - x) <= laneSpace)) return 'lane';
      if (screwConflict(roads.length, x, envelope)) return 'screwClip';
      return roadPocketConflict(work, farPart, null, pointAt(1, x), farDir, envelope, false) ??
        checkStock(type, pointAt(1, x), farDir, farPart, null, envelope);
    }
    if (request) {
      const matched = end === 'finish' && matchedEnds.has('row');
      const row = matched ? matchedEnds.get('row') : planConnectorRow(request, {
        domain: [-width / 2, width / 2], length: width, location,
        settingFor: type => countWarningSetting(p, end, type),
        halfAt: type => envelopes[type].half,
        blocked: (type, x) => obstacleText(roadObstacle(type, x, matchRow), p),
        checkRow: matchRow && roads.length === 1 ? opposingRoadPockets(p, path, envelopes) : undefined,
      });
      specs = countedSpecs(row);
      if (matchRow) matchedEnds.set('row', row);
    }
    for (const { value, type, custom, index } of specs) {
      const envelope = envelopes[type];
      const matchKey = type + index;
      const matchStart = matchRow || (!request && end === 'start' && !custom && roads.length === 1 &&
        p.kind !== 'import' && !configuredPositions(p, 'finish', type) &&
        !countedJoint(p, 'finish', undefined, modes[1]) &&
        (type === 'clip' ? clips(modes[1]) : tabs(modes[1])));
      const finishOffset = end === 'finish' ? matchedEnds.get(matchKey) : undefined;
      const farDirection = matchStart ? endDirection(p, path, 1) : null;
      const label = 'Road ' + endName(i, roads.length) + ' · ' + envelope.name;
      const laneSpace = p.slotWidth / 2 + p.wall + envelope.half;
      const blocking = (x) => {
        // Same tolerance as roadObstacle, so both placement paths agree.
        if (Math.abs(x) > width / 2 - envelope.half + 1e-8) return 'edge';
        if (seamLanes.some((lane) => Math.abs(lane - x) <= laneSpace))
          return 'lane';
        if (!separated(occupied, x, envelope.half))
          return screwConflict(i, x, envelope) ? 'screwClip' : 'other';
        if (matchStart && screwConflict(roads.length, x, envelope)) return 'screwClip';
        if (finishOffset !== undefined) return null; // Already checked and reserved with its mate.
        const here = pointAt(t, x);
        const reason = roadPocketConflict(work, first, second, here, dir, envelope, false);
        if (reason || !matchStart) return reason;
        const far = pointAt(1, x);
        const farReason = roadPocketConflict(work, farPart, null, far, farDirection, envelope, false);
        if (farReason || second !== farPart) return farReason;
        const nearStock = footprintCorners(here, dir, 0, envelope.socket + 1, envelope.half);
        const farStock = footprintCorners(far, farDirection, -envelope.root - 1, 0, envelope.half);
        return pocketsOverlap(nearStock, farStock) ? 'opposite' : null;
      };
      const clear = (x) => !blocking(x);
      const warning = () =>
        roadOffsetWarning({
          label,
          kind: p.kind,
          end,
          type,
          value,
          custom,
          width,
          envelope,
          laneSpace,
          lanes: seamLanes,
          fixedTabOffset:
            type === 'tab' && !manualTabs && Boolean(p.connectorOffset),
          reason: blocking(value),
          slotPosition: hasSlotPosition(p),
        });
      if (custom && !clear(value)) throw warning();
      const offset = finishOffset ?? (custom ? value : nearestOffset(value, width, clear, warning));
      occupied.push({ position: offset, half: envelope.half });
      const point = pointAt(t, offset);
      if (finishOffset === undefined) roadPocketConflict(work, first, second, point, dir, envelope, true);
      if (matchStart) {
        matchedEnds.set(matchKey, offset);
        roadPocketConflict(work, farPart, null, pointAt(1, offset), farDirection, envelope, true);
      }
      connect(type, index, offset, label,
        request && { key: positionKey(end, type), index: i, value: offset });
    }
  }
}

export function sideStationRules(
  p,
  path,
  side,
  i,
  type,
  borderWidth,
  envelopes,
) {
  const sign = side === 'outer' ? 1 : -1;
  const a = borderSeam(path, p, i),
    b = borderSeam(path, p, i + 1),
    edge = (sign * p.width) / 2;
  const edgeLength =
    path.edgeLength?.(sign) ??
    (p.kind === 'straight'
      ? p.length
      : ((p.radius + edge) * p.angle * Math.PI) / 180);
  const envelope = envelopes[type];
  const screwReach =
    isScrewClip(p) && screwSides(p).some((s) => s.sign === sign)
      ? screwClipGeometry(screwClipSettings(p), p.height).along
      : 0;
  const slideDirection =
    p.jointFitVersion === 2 && type === 'tab'
      ? borderSlideDirection(p, path, i, edge, sign)
      : null;
  const fit = slideDirection && resolveJointFit(p);
  const directionAt = (t) =>
    p.jointFitVersion === 2
      ? (type === 'tab' && slideDirection) || outwardNormal(path, t, edge, sign)
      : (path.normal?.(t) ?? left(path.tangent(t))).map((v) => v * sign);
  const halfAlongEdge = (t) => {
    if ((!envelope.checkOutline && !path.borderStock) || !slideDirection) return envelope.half;
    const normal = outwardNormal(path, t, edge, sign);
    return (
      Math.abs(dot(normal, slideDirection)) * envelope.half +
      Math.abs(dot(left(normal), slideDirection)) *
        Math.max(envelope.root, envelope.socket)
    );
  };
  const canEnter = (t) => {
    if (type !== 'tab' || !slideDirection) return true;
    const normal = outwardNormal(path, t, edge, sign);
    // Both cheeks of the socket must open onto the road edge. Otherwise
    // a seated tab looks fine but catches on a sealed corner while sliding.
    const along = dot(normal, slideDirection);
    const across = Math.abs(dot(normal, left(slideDirection)));
    return (
      along * (fit.tabRootLength + fit.tabClearance) >
      across * (fit.tabWidth / 2 + fit.tabClearance + 0.3)
    );
  };
  const widthUnderSocket = (t, half = halfAlongEdge(t)) => {
    const margin = (half + 0.5) / edgeLength;
    const lo = Math.max(a, t - margin),
      hi = Math.min(b, t + margin);
    const peaks = borderExtrema(path, p, side, lo, hi);
    return Math.min(
      ...[lo, t, hi, ...peaks].map((u) => borderWidth(p, u, side)),
    );
  };
  const structuralReason = (t) => {
    const half = halfAlongEdge(t);
    const endMode = activeJointMode(p, 'end', side);
    const startDepth =
      i === 0 && path.borderTipStart ? 0 : endReach(endMode, envelopes, 'socket');
    const finishDepth =
      i + 1 === p.borderSegments && path.borderTipFinish ? 0 : endReach(endMode, envelopes, 'root');
    const width = path.widthAt?.(t) ?? p.width;
    const laneOffsets =
      path.laneOffsets?.(t) ??
      Array.from(
        { length: p.lanes },
        (_, n) => (n - (p.lanes - 1) / 2) * p.laneSpacing,
      );
    if (!canEnter(t)) return 'angle';
    if (!insideBorderStock(path, t, edgeLength, half + 0.5, half + 0.5)) return 'finish';
    const roadEndDistance =
      (Math.abs(t * p.segments - Math.round(t * p.segments)) * edgeLength) /
      p.segments;
    if (roadEndDistance <= half + 0.5) return 'roadEnd';
    if (screwReach) {
      // A Kevan Sideclip sits in this road edge at each road joint.
      const k = Math.round(t * p.segments);
      const scope = k === 0 ? 'start' : k === p.segments ? 'finish' : 'seam';
      if (clips(activeJointMode(p, scope)) && roadEndDistance <= half + 0.5 + screwReach)
        return 'screwClip';
    }
    if (
      (t - a) * edgeLength <=
        half + 0.5 + (startDepth ? Math.max(8, startDepth) + 0.5 : 0) ||
      (b - t) * edgeLength <=
        half + 0.5 + (finishDepth ? Math.max(8, finishDepth) + 0.5 : 0)
    )
      return 'borderEnd';
    if (widthUnderSocket(t, half) < envelope.socket + 1) return 'width';
    const laneSpace = p.slotWidth / 2 + p.wall + Math.max(8, envelope.root);
    if (
      laneOffsets.some(
        (lane) => Math.abs((sign * width) / 2 - lane) <= laneSpace,
      )
    )
      return 'lane';

    return null;
  };
  return { directionAt, halfAlongEdge, widthUnderSocket, structuralReason };
}

export function addSideMounts(
  work,
  p,
  path,
  side,
  sign,
  roads,
  part,
  i,
  loose,
  borderWidth,
) {
  const a = borderSeam(path, p, i),
    b = borderSeam(path, p, i + 1),
    edge = (sign * p.width) / 2;
  const edgeLength =
    path.edgeLength?.(sign) ??
    (p.kind === 'straight'
      ? p.length
      : ((p.radius + edge) * p.angle * Math.PI) / 180);
  const sideTabs = configuredPositions(p, 'side', 'tab', side);
  const sideClips = configuredPositions(p, 'side', 'clip', side);
  const mode = activeJointMode(p, 'side', side);
  if (mode === 'none') return;
  const envelopes = connectorEnvelopes(p);
  const roadAt = (t) => roads[Math.min(roads.length - 1, Math.floor(t * roads.length))];
  const rules = {};
  const rulesFor = (type) => rules[type] ??= sideStationRules(p, path, side, i, type, borderWidth, envelopes);
  function physicalObstacle(type, t) {
    const rule = rulesFor(type);
    return rule.structuralReason(t) ?? footprintConflict(
      work, roadAt(t), part, path.point(t, edge), rule.directionAt(t),
      path.borderStock ? { ...envelopes[type], checkOutline: true } : envelopes[type],
    );
  }
  const request = countedJoint(p, 'side', side, mode);
  // A slot close to this edge brings its braid recess under the pocket. Find
  // that here, where the warning can name the slot position.
  const slotStock = hasSlotPosition(p);
  const checkStock = (request || slotStock) && stockChecker(work, p);
  const tAt = v => a + (b - a) * v;
  const specs = request ? countedSpecs(planConnectorRow(request, {
    location: borderName(side) + ' attachment ' + (i + 1),
    domain: [0, 1], length: edgeLength * (b - a),
    settingFor: type => countWarningSetting(p, 'side', type),
    halfAt: (type, v) => rulesFor(type).halfAlongEdge(tAt(v)),
    blocked: (type, v) => {
      const t = tAt(v);
      return obstacleText(physicalObstacle(type, t) ?? checkStock(type, path.point(t, edge),
        rulesFor(type).directionAt(t), roadAt(t), part, envelopes[type]), p);
    },
  })) : [
    ...(tabs(mode)
      ? spread(sideTabs ?? [0.32, 0.68], 'tab', Boolean(sideTabs))
      : []),
    ...(clips(mode)
      ? spread(sideClips ?? [0.5], 'clip', Boolean(sideClips))
      : []),
  ].sort(fixedFirst);
  const used = [];
  for (const { type, value, custom, index } of specs) {
    const proposed = a + (b - a) * value;
    const envelope = envelopes[type];
    const label =
      borderName(side) + ' attachment ' + (i + 1) + ' · ' + envelope.name;
    const { directionAt, halfAlongEdge, widthUnderSocket } = rulesFor(type);
    const blocking = (t) => {
      if (!separated(used, t * edgeLength, halfAlongEdge(t))) return 'other';
      return physicalObstacle(type, t) ?? (slotStock
        ? checkStock(type, path.point(t, edge), directionAt(t), roadAt(t), part, envelope)
        : null);
    };
    let t = proposed;
    const reason = blocking(t);
    if (reason) {
      const profileT = path.borderProfileStation?.(proposed) ?? proposed;
      const apex = apexPositionFor(p, side);
      const warning = () =>
        sideMountWarning({
          label,
          type,
          key: configuredPositionKey(p, 'side', type, side),
          value,
          custom,
          reason,
          required: envelope.socket + 1,
          available: widthUnderSocket(proposed),
          // The tapered profile is monotone on either side of its apex.
          widest: Math.max(
            ...[a, b, ...borderExtrema(path, p, side, a, b)].map((u) =>
              borderWidth(p, u, side),
            ),
          ),
          side,
          widthControl:
            profileT < apex / 2
              ? 'Entry'
              : profileT > (1 + apex) / 2
                ? 'Exit'
                : 'Apex',
          nativeLaneGap:
            p.kind === 'import'
              ? undefined
              : path.laneOffsets
                ? Math.min(...path.laneOffsets(proposed).map(v => Math.abs(edge - v)))
                : (p.width - (p.lanes - 1) * p.laneSpacing) / 2,
          laneMinimum: p.slotWidth / 2 + p.wall + Math.max(8, envelope.root),
          // The slot nearest this edge is the one to move.
          slotPosition: hasSlotPosition(p) &&
            slotPositionSetting(p, path.laneOffsets?.(proposed), edge),
        });
      if (custom) throw warning();
      const alternatives = Array.from(
        { length: 49 },
        (_, j) => a + ((b - a) * (j + 1)) / 50,
      ).sort((x, y) => Math.abs(x - proposed) - Math.abs(y - proposed));
      t = alternatives.find((u) => !blocking(u));
      if (t === undefined) throw warning();
    }
    used.push({ position: t * edgeLength, half: halfAlongEdge(t) });
    const road = roadAt(t);
    const dir = directionAt(t);
    addConnector(
      work,
      p,
      type,
      path.point(t, edge),
      dir,
      road,
      part,
      loose,
      connectorId('side-clip-' + side + '-' + (i + 1), index),
      label,
      undefined,
      request && { key: positionKey('side', type, side), index: i, value: (t - a) / (b - a) },
    );
  }
}

export function addBorderEndJoints(
  work,
  p,
  path,
  side,
  sign,
  borders,
  loose,
  borderWidth,
  skipped = new Set(),
) {
  const mode = activeJointMode(p, 'end', side);
  if (mode === 'none' || skipped.size === borders.length + 1) return;
  const envelopes = connectorEnvelopes(p);
  const endTabs = configuredPositions(p, 'end', 'tab', side);
  const endClips = configuredPositions(p, 'end', 'clip', side);
  const both = mode === 'both',
    edge = (sign * p.width) / 2;
  const request = countedJoint(p, 'end', side, mode);
  const checkStock = request && stockChecker(work, p);
  const defaultSpecs = [
    ...(tabs(mode)
      ? spread(endTabs ?? [both ? 0.28 : 0.5], 'tab', Boolean(endTabs))
      : []),
    ...(clips(mode)
      ? spread(endClips ?? [both ? 0.72 : 0.5], 'clip', Boolean(endClips))
      : []),
  ].sort(fixedFirst);
  const pathLength =
    path.edgeLength?.(sign) ??
    (p.kind === 'straight'
      ? p.length
      : ((p.radius + edge) * p.angle * Math.PI) / 180);
  if (!defaultSpecs.length) return;
  for (let i = 0; i < borders.length; i++) {
    const a = borderSeam(path, p, i),
      b = borderSeam(path, p, i + 1);
    const available = (b - a) * pathLength;
    const minLength = minimumJointLength(
      envelopes,
      skipped.has(i) ? 'none' : mode,
      skipped.has(i + 1) ? 'none' : mode,
    );
    if (available + 1e-8 < minLength)
      throw borderEndLengthWarning(
        borderName(side) + ' · end joints', available, minLength, p.borderSegments,
        both ? 'tab and ' + envelopes.clip.name : envelopes[defaultSpecs[0].type].name,
      );
  }
  const quantities = ['tab', 'clip'].map(type => ({
    type, count: request?.[type].count ?? defaultSpecs.filter(spec => spec.type === type).length,
  }));
  const totalCount = quantities.reduce((sum, q) => sum + q.count, 0);
  const requiredWidth = quantities.reduce((sum, q) => sum + q.count * 2 * envelopes[q.type].half, 0)
    + (totalCount - 1) * 0.2;
  for (let i = 0; i <= borders.length; i++) {
    if (skipped.has(i)) continue;
    const t = borderSeam(path, p, i),
      width = borderWidth(p, t, side),
      first = borders[i - 1],
      second = borders[i];
    const location = borderName(side) + ' · ' + endName(i, borders.length);
    if (path.borderStock) {
      const before = first ? endReach(mode, envelopes, 'root') : 0;
      const after = second ? endReach(mode, envelopes, 'socket') : 0;
      if (!insideBorderStock(path, t, pathLength, before, after))
        throw Error(
          location + ' reaches the shaped end. Move the tip farther along the road, choose a Short finish, or use fewer border segments so the connector fits in full-width material.',
        );
    }
    if (width < requiredWidth - 1e-8) {
      const items = quantities.flatMap(({type, count}) => {
        if (!count) return [];
        const name = envelopes[type].name;
        return [count === 1 ? name : count + ' ' + name + 's'];
      });
      const subject =
        totalCount === 1
          ? 'The ' + items[0]
          : 'The layout of ' + items.join(' and ');
      throw borderEndWidthWarning(
        location,
        p,
        path.borderProfileStation?.(t) ?? t,
        width,
        requiredWidth,
        subject,
        side,
        !!request && totalCount > 1,
      );
    }
    const occupied = [];
    const dir = endDirection(p, path, t);
    const pointAt = (offset) => path.point(t, edge + sign * offset);
    const movable = envelopes.tab.checkOutline || envelopes.clip.checkOutline;
    const autoPair = !request && both && movable && !endTabs && !endClips;
    const specs = request ? countedSpecs(planConnectorRow(request, {
      domain: [0,1], length: width, location, halfAt: type => envelopes[type].half,
      settingFor: type => countWarningSetting(p, 'end', type),
      blocked: (type, v) => {
        const env = envelopes[type];
        if (Math.min(v, 1 - v) * width < env.half - 1e-8) return obstacle.edge;
        const point = pointAt(v * width);
        return obstacleText(footprintConflict(work, first, second, point, dir,
          path.borderStock ? {...env, checkOutline: true} : env) ??
          checkStock(type, point, dir, first, second, env), p);
      },
    })) : defaultSpecs;
    for (const { type, value, custom, index } of specs) {
      const envelope = envelopes[type];
      const label =
        borderName(side) +
        ' ' +
        endName(i, borders.length) +
        ' · ' +
        (autoPair ? 'tab and ' + envelopes.clip.name : envelope.name);
      let low = envelope.half;
      let high = width - envelope.half;
      if (autoPair) {
        // The default tab is nearer the road and the clip nearer the free
        // edge. Reserve space for both before fixing the first position.
        if (type === 'tab') high -= 2 * envelopes.clip.half + 0.2;
        else
          low = occupied[0].position + occupied[0].half + envelope.half + 0.2;
      }
      const clear = (x) =>
        x >= low - 1e-8 &&
        x <= high + 1e-8 &&
        separated(occupied, x, envelope.half) &&
        fitsOutline(work, first, second, pointAt(x), dir,
          path.borderStock ? { ...envelope, checkOutline: true } : envelope);
      const target =
        custom || !movable
          ? width * value
          : Math.min(high, Math.max(low, width * value));
      if (custom && !clear(target))
        throw borderEndPositionWarning(
          location,
          type,
          envelope.name,
          value,
          width,
          envelope.half,
          occupied,
          configuredPositionKey(p, 'end', type, side),
        );
      const noPosition = () => {
        const error = connectorWarning(
          location,
          'The ' +
            envelope.name +
            ' pocket and walls have no clear position in the border outline at this end.',
          'Widen the border near this joint or change Connections → Border connections → Join border ends.',
          {
            tab: 'joints',
            field: 'borderJoint',
            label: 'Edit border end joints',
          },
        );
        error.code = 'BORDER_END_OUTLINE';
        return error;
      };
      if (low > high + 1e-8 || (!movable && !clear(target))) throw noPosition();
      const offset = clear(target)
        ? target
        : nearestOffset(target, width, clear, noPosition);
      occupied.push({
        position: offset,
        half: envelope.half,
        name: envelope.name,
      });
      const point = pointAt(offset);
      const stationId = connectorId('end-clip-' + side + '-' + i, index);
      const id = (first || skipped.has(borders.length)) && stationId;
      const externalKeeper = !id && {
        stationId,
        parentClipId: connectorId(
          'end-clip-' + side + '-' + borders.length,
          index,
        ),
      };
      addConnector(
        work,
        p,
        type,
        point,
        dir,
        first,
        second,
        loose,
        id,
        label,
        externalKeeper,
        request && { key: positionKey('end', type, side), index: i, value: offset / width },
      );
    }
  }
}
