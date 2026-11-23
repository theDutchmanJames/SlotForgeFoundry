import {
  borderWidth,
  trackParameters,
  validateTrack,
  nativeBraidLane,
  nativePath,
} from '../track.js';
import {
  importedTrackPaths,
  measuredLane,
  setCrossingBorderStations,
} from './import-track.js';
import { pitLayout, pitPrintPath } from './special-junction-layout.js';
import { pitBraidLayout } from './pit-braids.js';
import { timingContactFootprints } from './timing-straight.js';
import { borderPath } from './border-profile.js';
import { borderEndProfile, borderSeam, insideBorderStock } from './border-ends.js';
import { braidFeedOutlines } from './braid-feeds.js';
import {
  activeJointMode,
  countedJoint,
  countWarningSetting,
  configuredPositions,
  jointMode,
  positionKey,
  validatePlacements,
} from './placements.js';
import { planConnectorRow, separated, usesClips } from './connector-counts.js';
import { isScrewClip, screwClipZones, tabsOnly } from './screw-clip.js';
import {
  connectorEnvelopes,
  endDirection,
  opposingRoadPockets,
  sideStationRules,
} from './track-joints.js';
import { connectorWarning } from './connector-warning.js';
import { slotPositionSetting, slotRoomAdvice, slotToMove } from './connector-position-warnings.js';
import {
  slotEndFace,
  slotEndObstacle,
  slotEndRequest,
  slotEndRow,
} from './slot-end-row.js';
import { hasSlotPosition } from '../slot-position.js';
import { clipSpec } from './clip-types.js';
import { CLIP_TABLE_CLEARANCE, resolveJointFit } from './joint-fit.js';
import { KEEPER_CHAMBER_TOP } from './keeper-dimensions.js';
import { drawKeyOutline } from './retained-clip.js';
import { dot, left, minus, move } from './solids.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const lerp = (a, b, f) => a + (b - a) * f;
const types = ['tab', 'clip'];
const drawingCache = new WeakMap();
const sideMessages = {
  angle: 'This tab cannot slide into its socket at this angle.',
  roadEnd: 'The connector is too close to a road segment end.',
  borderEnd: 'Leave room for the border end and its connectors.',
  width: 'The border is too narrow for the pocket and its supporting wall.',
  finish: 'Move the connector into the full-width section, clear of the shaped end.',
  lane: 'The connector support would reach a guide slot.',
  screwClip: 'The connector would meet a side screw clip at the road edge.',
};

function segmentDistanceSq(p, a, b) {
  const delta = minus(b, a);
  const t = clamp(dot(minus(p, a), delta) / (dot(delta, delta) || 1), 0, 1);
  const v = minus(p, move(a, delta, t));
  return dot(v, v);
}

// Index edges by a horizontal strip. Pointer checks only visit boundaries
// near the connector, including on detailed imported outlines.
function polygon(loop) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of loop) {
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], y);
  }
  const count = Math.min(256, Math.max(1, Math.ceil(loop.length / 12)));
  const rows = Array.from({ length: count }, () => []);
  const row = (y) =>
    clamp(
      Math.floor(((y - box[1]) * count) / (box[3] - box[1] || 1)),
      0,
      count - 1,
    );
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i],
      b = loop[(i + 1) % loop.length];
    const edge = { a, b, delta: minus(b, a) };
    for (let j = row(Math.min(a[1], b[1])); j <= row(Math.max(a[1], b[1])); j++)
      rows[j].push(edge);
  }
  function contains(p) {
    const [x, y] = p,
      eps = 1e-7;
    if (
      x < box[0] - eps ||
      x > box[2] + eps ||
      y < box[1] - eps ||
      y > box[3] + eps
    )
      return false;
    let inside = false;
    for (const { a, b, delta } of rows[row(y)]) {
      if (
        x >= Math.min(a[0], b[0]) - eps &&
        x <= Math.max(a[0], b[0]) + eps &&
        y >= Math.min(a[1], b[1]) - eps &&
        y <= Math.max(a[1], b[1]) + eps &&
        Math.abs(cross(delta, minus(p, a))) <=
          eps * Math.max(1, Math.hypot(...delta))
      )
        return true;
      if (
        a[1] > y !== b[1] > y &&
        x < a[0] + ((y - a[1]) * delta[0]) / delta[1]
      )
        inside = !inside;
    }
    return inside;
  }
  function crossings(a, b, result, clearance = 0) {
    const d = minus(b, a);
    const low = row(Math.min(a[1], b[1]) - clearance),
      high = row(Math.max(a[1], b[1]) + clearance);
    const seen = low === high ? null : new Set();
    for (let j = low; j <= high; j++)
      for (const edge of rows[j]) {
        if (seen?.has(edge)) continue;
        seen?.add(edge);
        if (
          clearance &&
          Math.min(
            segmentDistanceSq(a, edge.a, edge.b),
            segmentDistanceSq(b, edge.a, edge.b),
            segmentDistanceSq(edge.a, a, b),
            segmentDistanceSq(edge.b, a, b),
          ) <
            clearance * clearance
        ) {
          result.push(0);
          return;
        }
        const e = edge.delta,
          det = cross(d, e);
        if (Math.abs(det) < 1e-11) continue;
        const v = minus(edge.a, a),
          t = cross(v, e) / det,
          u = cross(v, d) / det;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) result.push(t);
      }
  }
  return { contains, crossings, point: loop[0] };
}

function supported(corners, polygons) {
  const inside = (p) => polygons.some((region) => region.contains(p));
  for (let i = 0; i < 4; i++) {
    const a = corners[i],
      b = corners[(i + 1) % 4];
    if (!inside(a)) return false;
    const cuts = [0, 1];
    for (const shape of polygons) shape.crossings(a, b, cuts);
    cuts.sort((u, v) => u - v);
    for (let j = 1; j < cuts.length; j++) {
      if (cuts[j] - cuts[j - 1] < 1e-8) continue;
      const mid = (cuts[j] + cuts[j - 1]) / 2;
      if (!inside([lerp(a[0], b[0], mid), lerp(a[1], b[1], mid)])) return false;
    }
  }
  return true;
}

function overlaps(corners, obstacle, clearance = 0) {
  if (corners.some(obstacle.contains)) return true;
  const cuts = [];
  for (let i = 0; i < corners.length; i++)
    obstacle.crossings(
      corners[i],
      corners[(i + 1) % corners.length],
      cuts,
      clearance,
    );
  if (cuts.length) return true;
  // A small braid feed can be entirely enclosed by the support envelope.
  const p = obstacle.point;
  if (corners.length !== 4) return polygon(corners).contains(p);
  const signs = corners.map((a, i) =>
    cross(minus(corners[(i + 1) % 4], a), minus(p, a)),
  );
  return signs.every((s) => s >= 0) || signs.every((s) => s <= 0);
}

function nearestValue(edge, values, point) {
  let dist = Infinity,
    value = values[0];
  for (let i = 1; i < edge.length; i++) {
    const a = edge[i - 1],
      d = minus(edge[i], a);
    const t = clamp(dot(minus(point, a), d) / (dot(d, d) || 1), 0, 1);
    const v = minus(point, move(a, d, t)),
      dsq = dot(v, v);
    if (dsq < dist) {
      dist = dsq;
      value = lerp(values[i - 1], values[i], t);
    }
  }
  return value;
}

// Retain a bend within each display bucket as well as its endpoint. The map
// draws a bounded number of SVG vertices; picks and solids use the source path.
function displayLine(line, budget) {
  if (line.length <= budget) return line;
  const groups = Math.max(1, Math.floor((budget - 1) / 2)),
    points = [line[0]];
  for (let j = 0; j < groups; j++) {
    const start = Math.floor(((line.length - 1) * j) / groups);
    const end = Math.floor(((line.length - 1) * (j + 1)) / groups);
    const a = line[start],
      d = minus(line[end], a);
    let furthest = start,
      distance = 0;
    for (let i = start + 1; i < end; i++) {
      const offset = Math.abs(cross(d, minus(line[i], a)));
      if (offset > distance) {
        furthest = i;
        distance = offset;
      }
    }
    if (furthest > start) points.push(line[furthest]);
    points.push(line[end]);
  }
  return points;
}

function band(path, a, b, lo, hi) {
  const ts = [a, ...path.stations.filter((t) => t > a && t < b), b];
  return [
    ...ts.map((t) => path.point(t, lo(t))),
    ...ts.reverse().map((t) => path.point(t, hi(t))),
  ];
}

function footprint(point, dir, from, to, half) {
  const across = left(dir);
  return [
    [from, -half],
    [to, -half],
    [to, half],
    [from, half],
  ].map(([x, y]) => move(move(point, dir, x), across, y));
}

// A neighbouring seam may already occupy some of the stock in this part.
// When the worker has built the current draft, use the accepted stations
// recorded on its mating faces. While editing, the map can plan a draft row.
function rowFromParts(parts, request, key, index, pointAt) {
  if (!parts) return null;
  const rows = stationsInParts(parts, key, index, pointAt);
  if (types.some(type => rows[type].size !== request[type].count)) return null;
  return { tab: [...rows.tab], clip: [...rows.clip] };
}

function stationsInParts(parts, key, index, pointAt) {
  const rows = { tab: new Set(), clip: new Set() };
  for (const part of parts) {
    for (const { station, kind, point } of part.jointGuides ?? []) {
      const type = kind === 'Clip' ? 'clip' : 'tab';
      if (station?.index !== index || station.key !== key(type)) continue;
      // A diamond or split pit can repeat a joint index on a second axis.
      const [x, y] = pointAt(station.value);
      if (Math.hypot(x - point[0], y - point[1]) < 1e-4) rows[type].add(station.value);
    }
  }
  return rows;
}

/** Prepare the selected physical joint and the reusable placement fields it
 * controls. Road coordinates are millimetres, borders are edge fractions. */
export function connectorLayout(params, plan, scope, options = {}) {
  let p = trackParameters(params),
    path,
    cache = {};
  let equipment = [];
  validatePlacements(p.placements, p.mutedPlacements);
  // Validate dimensions before sampling. Joint settings themselves remain
  // editable even while the existing combination does not fit.
  validateTrack({
    ...p,
    joint: 'none',
    jointStart: 'none',
    jointEnd: 'none',
    borderMount: 'none',
    borderJoint: 'none',
    placements: undefined,
  });
  if (p.kind === 'import') {
    if (!plan || typeof plan !== 'object')
      throw Error('Import a Circuit drawing with two open ends.');
    // The drawing is immutable across form edits. Varying connector marks
    // needs only new placement checks, not another traversal of every lane.
    const {
      placements,
      mutedPlacements,
      connectorCounts,
      joint,
      jointStart,
      jointEnd,
      borderMount,
      borderJoint,
      connectorOffset,
      ...shape
    } = p;
    const signature = JSON.stringify(shape);
    const crossing = plan.flatCrossing?.crossings[0];
    const section =
      crossing &&
      plan.flatCrossing.sections[
        crossing[
          crossing.upperPass === 'first' ? 'secondSection' : 'firstSection'
        ]
      ];
    const drawing = section ?? plan;
    cache = drawingCache.get(drawing);
    if (cache?.signature !== signature) {
      cache = { signature };
      drawingCache.set(drawing, cache);
    }
    const source = (cache.source ??= importedTrackPaths(
      p,
      drawing,
      Boolean(section),
    ));
    if (!source.path)
      throw Error(
        'This Circuit panel needs two identifiable open ends for connector placement.',
      );
    p = { ...p, width: source.p.width, lanes: source.p.lanes };
    path = source.path;
    if (section && !path.borderProfileStation)
      setCrossingBorderStations(path, section, plan.flatCrossing, p);
  } else if (p.special?.type === 'pit') {
    const pit = pitLayout(p);
    path = pitPrintPath(pit.path, pit.forks, p, pitBraidLayout(p, pit));
    path.measuredLanes = pit.lanePaths.map(line => measuredLane(line));
    equipment = pit.forks.map(fork => [fork.mainToe, fork.heel, fork.pitToe]);
  } else path = nativePath(p);
  const sideMount = scope === 'side',
    border = sideMount || scope === 'end';
  if (!border && !['start', 'seam', 'finish'].includes(scope))
    throw Error('Choose a road or border joint.');
  const side = options.side ?? (p.borderSide === 'inner' ? 'inner' : 'outer'),
    sign = side === 'outer' ? 1 : -1;
  if (border && side !== 'inner' && side !== 'outer')
    throw Error('Choose the inside or outside border.');
  if (border && p.borderSide !== side && p.borderSide !== 'both')
    throw Error('Add the selected border before placing its connectors.');
  const index =
    scope === 'start'
      ? 0
      : scope === 'finish'
        ? p.segments
        : (options.index ?? (scope === 'seam' ? 1 : 0));
  const count = border ? p.borderSegments : p.segments;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > count ||
    (scope === 'seam' && (index === 0 || index === count)) ||
    (sideMount && index === count)
  )
    throw Error(
      scope === 'seam'
        ? 'Add a second road segment to place connectors on an internal seam.'
        : 'Choose an existing joint.',
    );
  const halfRoad = p.width / 2;
  const attached = sign * halfRoad,
    profile =
      plan?.flatCrossing?.closed && path.borderProfileStation
        ? { ...p, borderExit: p.borderEntry }
        : p;
  const originalWidth = (_, u, side) =>
    borderWidth(profile, path.borderProfileStation?.(u) ?? u, side);
  const shapeFor = (s) => borderEndProfile(borderPath(path, p, s), p, s, originalWidth);
  const selected = border ? shapeFor(side) : null;
  const selectedPath = selected?.path ?? path;
  const station = (i) => border ? borderSeam(selectedPath, p, i) : i / count;
  const t = station(index), w = path.widthAt?.(t) ?? p.width;
  if (scope === 'end' && ((index === 0 && selectedPath.borderTipStart) ||
      (index === count && selectedPath.borderTipFinish)))
    throw Error('The exposed border tip has no connector. Choose a square end or an internal seam.');
  const widthAt = (_, u) => selected?.widthAt(u) ?? originalWidth(p, u, side);
  const free = (u) => attached + sign * widthAt(p, u, side);
  const endWidth = widthAt(p, t, side);
  const domain = border ? [0, 1] : [-w / 2, w / 2];
  const atRoad = path.atOffset ?? path.point;
  const tAt = (v) => t + (station(index + 1) - t) * v;
  const pointAt = sideMount
    ? (v) => selectedPath.point(tAt(v), attached)
    : border
      ? (v) => selectedPath.point(t, attached + sign * endWidth * v)
      : (v) => atRoad(t, v);
  const values = sideMount
    ? [
        0,
        ...selectedPath.stations
          .filter((u) => u > t && u < station(index + 1))
          .map((u) => (u - t) / (station(index + 1) - t)),
        1,
      ]
    : domain;
  const physicalEdge = values.map(pointAt);
  const valueAt = (point) => nearestValue(physicalEdge, values, point);
  const edgeLength =
    path.edgeLength?.(sign) ??
    (p.kind === 'straight'
      ? p.length
      : ((p.radius + attached) * p.angle * Math.PI) / 180);
  const length = sideMount ? edgeLength * (station(index + 1) - t) : border ? endWidth : w;
  if (
    !Number.isFinite(length) ||
    !domain.every(Number.isFinite) ||
    !physicalEdge.every((pt) => pt.every(Number.isFinite))
  )
    throw Error(
      'The selected edge needs finite drawing coordinates and a measurable length.',
    );
  if (length < 1e-8)
    throw Error('This border has zero width at the selected end.');
  const mm = length / (domain[1] - domain[0]);
  const roadLo = () => -halfRoad,
    roadHi = () => halfRoad;
  const outlines = cache.outlines ?? [];
  if (!cache.outlines) {
    outlines.push(displayLine(band(path, 0, 1, roadLo, roadHi), 1200));
    for (const s of [1, -1])
      if (
        p.borderSide === 'both' ||
        p.borderSide === (s > 0 ? 'outer' : 'inner')
      ) {
        const shape = shapeFor(s > 0 ? 'outer' : 'inner');
        outlines.push(
          displayLine(
            band(
              shape.path,
              shape.start,
              shape.finish,
              () => s * halfRoad,
              (u) => s * (halfRoad + shape.widthAt(u)),
            ),
            1200,
          ),
        );
      }
    cache.outlines = outlines;
  }
  // An off-centre slot leaves end A where the path says it does.
  const nativeLanes = hasSlotPosition(p)
    ? path.laneOffsets(0)
    : Array.from(
        { length: p.lanes },
        (_, i) => (i - (p.lanes - 1) / 2) * p.laneSpacing,
      );
  const timingKeepouts = [];
  if (p.special?.type === 'timing') {
    for (const y of nativeLanes) for (const sign of [-1, 1]) {
      for (const footprint of timingContactFootprints(p, y, sign)) {
        timingKeepouts.push(polygon(footprint));
        equipment.push([...footprint, footprint[0]]);
      }
    }
  }
  const measured =
    path.measuredLanes ?? nativeLanes.map((n, i) => nativeBraidLane(p, path, n, i));
  const laneBudget = Math.max(
    16,
    Math.min(800, Math.floor(4096 / measured.length)),
  );
  const lanes = (cache.lanes ??= measured.map((l) =>
    displayLine(
      l.ts.map((u) => (l.at ? l.at(u) : l.atOffset(u, 0))),
      laneBudget,
    ),
  ));
  const feedLanes = p.special?.type === 'pit' ? measured.slice(0, p.lanes) : measured;
  const feeds = (cache.feeds ??= feedLanes
    .flatMap((l, i) => braidFeedOutlines(p, l, i))
    .map(polygon));
  const laneOffsets = path.laneOffsets?.(t) ?? nativeLanes;
  const env = connectorEnvelopes(p),
    spec = clipSpec(p),
    fit = resolveJointFit(p);
  // Side screw clips sit at the road edges, centred on each road joint. They
  // are shown on the joint but never placed by hand.
  const screw = isScrewClip(p);
  const screwRow =
    screw && !border && usesClips(activeJointMode(p, scope)) ? screwClipZones(p, w) : [];
  const screwLock = border
    ? 'Side screw clips join road ends only. Use tabs on borders.'
    : 'Side screw clips sit at the road edges, centred on the joint. Switch a side off under Connections → Road connections.';
  // Beside an off-centre slot an external end is laid out by the same rule as
  // the build, from that end alone (slot-end-row.js).
  const slotFace =
    hasSlotPosition(p) && !border && scope !== 'seam'
      ? slotEndFace({
          width: w,
          lanes: laneOffsets,
          envelopes: env,
          slotWidth: p.slotWidth,
          wall: p.wall,
          screwZones: screwRow,
        })
      : null;
  // The walls of a slot that moves sideways, which no pocket may reach.
  const sleeveHalf = p.slotWidth / 2 + p.wall;
  const sleeves =
    hasSlotPosition(p) && path.laneCurves
      ? path.measuredLanes.map((l) =>
          polygon([
            ...l.ts.map((u) => l.atOffset(u, -sleeveHalf)),
            ...l.ts.map((u) => l.atOffset(u, sleeveHalf)).reverse(),
          ]),
        )
      : [];
  // Test the actual slot and braid footprints when their floor is low enough
  // to intersect the pocket roof (e.g. a skew imported lane near the end).
  const roofs = {
    tab: fit.tabTop + fit.tabClearance + 0.4,
    clip:
      (spec?.seatHeight ?? CLIP_TABLE_CLEARANCE) +
      (spec?.thickness ?? 0) +
      (spec?.verticalClearance ?? fit.clipClearance) +
      (spec?.roofThickness ?? 0.4),
  };
  const channels = cache.channels ?? [];
  function channel(lo, hi, z) {
    if (z >= Math.max(roofs.tab, roofs.clip)) return;
    for (const l of measured)
      channels.push({
        z,
        shape: polygon([
          ...l.ts.map((u) => l.atOffset(u, lo)),
          ...l.ts.map((u) => l.atOffset(u, hi)).reverse(),
        ]),
      });
  }
  const slot = p.slotWidth / 2;
  if (!cache.channels) {
    channel(-slot, slot, p.height - p.slotDepth);
    if (p.braidDepth > 0 && p.braidWidth > 0) {
      const inner = slot + p.braidGap;
      const outer = inner + p.braidWidth;
      channel(-outer, -inner, p.height - p.braidDepth);
      channel(inner, outer, p.height - p.braidDepth);
    }
    cache.channels = channels;
  }
  const roadShapes = (cache.roadShapes ??= new Map());
  function road(i) {
    if (!roadShapes.has(i))
      roadShapes.set(
        i,
        polygon(
          band(path, i / p.segments, (i + 1) / p.segments, roadLo, roadHi),
        ),
      );
    return roadShapes.get(i);
  }
  const regionKey = [scope, side, index].join('/');
  let fixedRegion = cache.regionKey === regionKey ? cache.fixedRegion : null;
  if (!fixedRegion && sideMount)
    fixedRegion = polygon(
      band(selectedPath, t, station(index + 1), () => attached, free),
    );
  else if (!fixedRegion) {
    const from = station(Math.max(0, index - 1)),
      to = station(Math.min(index + 1, count));
    fixedRegion = polygon(
      band(
        selectedPath,
        from,
        to,
        border ? () => attached : roadLo,
        border ? free : roadHi,
      ),
    );
  }
  cache.regionKey = regionKey;
  cache.fixedRegion = fixedRegion;
  const mode = jointMode(p, scope),
    positions = { tab: [], clip: [] };
  const rules = {};
  if (sideMount)
    for (const type of types) {
      try {
        rules[type] = sideStationRules(
          p,
          selectedPath,
          side,
          index,
          type,
          widthAt,
          env,
        );
      } catch (error) {
        rules[type] = {
          structuralReason: () => error.message,
          halfAlongEdge: () => env[type].half,
        };
      }
    }
  const halfAt = (type, value) =>
    sideMount ? rules[type].halfAlongEdge(tAt(value)) : env[type].half;
  function structural(type, value) {
    if (!Number.isFinite(value) || value < domain[0] || value > domain[1])
      return 'Place the connector on the selected joint.';
    if (screw && type === 'clip') return screwLock;
    const descriptor = env[type],
      half = halfAt(type, value);
    if (type === 'clip' && spec && p.height < spec.minimumHeight)
      return (
        spec.clipName +
        ' needs at least ' +
        spec.minimumHeight +
        ' mm of track height.'
      );
    if (sideMount) {
      const reason = rules[type].structuralReason(tAt(value));
      if (reason) return sideMessages[reason] ?? reason;
    } else if (slotFace) {
      const blocked = slotEndObstacle(slotFace, type, value, true);
      if (blocked === 'edge')
        return 'Leave more material between the connector and the edge.';
      if (blocked) return sideMessages[blocked === 'screwClip' ? 'screwClip' : 'lane'];
    } else {
      if (Math.min(value - domain[0], domain[1] - value) * mm < half - 1e-8)
        return 'Leave more material between the connector and the edge.';
      if (
        !border &&
        laneOffsets.some((n) => Math.abs(n - value) <= slot + p.wall + half)
      )
        return sideMessages.lane;
      if (screwRow.length && !separated(screwRow, value, half))
        return sideMessages.screwClip;
    }
    const point = pointAt(value),
      dir = sideMount
        ? rules[type].directionAt(tAt(value))
        : endDirection(p, path, t);
    const first = sideMount || index > 0,
      second = sideMount || index < count;
    if (scope === 'end' &&
        !insideBorderStock(selectedPath, t, edgeLength, first ? descriptor.root : 0,
          second ? descriptor.socket : 0))
      return 'The connector would enter the shaped end. Move the tip farther from this joint or use a Short finish.';
    const corners = footprint(
      point,
      dir,
      first ? -descriptor.root : 0,
      second ? descriptor.socket : 0,
      descriptor.half,
    );
    if (descriptor.checkOutline || selectedPath.borderStock) {
      const regions = sideMount
        ? [
            road(Math.min(p.segments - 1, Math.floor(tAt(value) * p.segments))),
            fixedRegion,
          ]
        : [fixedRegion];
      if (!supported(corners, regions))
        return 'The pocket or its supporting wall would break through the outline.';
    }
    if (!border && sleeves.some((shape) => overlaps(corners, shape)))
      return 'The slot moves sideways into the room this pocket needs.';
    if (feeds.some((shape) => overlaps(corners, shape)))
      return 'The connector support would intersect a braid pass-through.';
    if (timingKeepouts.some(shape => overlaps(corners, shape)))
      return 'The connector support would reach the timing equipment. Move it clear of the detector.';
    let keyOpening;
    if (
      channels.some(({ z, shape }) => {
        if (z >= roofs[type] || !overlaps(corners, shape)) return false;
        if (
          type !== 'clip' ||
          spec?.type !== 'draw-key' ||
          z < KEEPER_CHAMBER_TOP + spec.roofThickness
        )
          return true;
        // Only the tall dovetail reaches these shallow channels. The stock
        // reserved for the keeper can sit beneath them with room to spare.
        keyOpening ??= drawKeyOutline(0.6)
          .filter(([x]) => (first || x >= 0) && (second || x <= 0))
          .map(([x, y]) => move(move(point, dir, x), left(dir), y));
        return overlaps(keyOpening, shape, fit.clipClearance);
      })
    )
      return 'The pocket would intersect a guide slot or braid recess.';
    return null;
  }
  function collisions(type, value, ignoreIndex = -1, onlyOther = false) {
    const half = halfAt(type, value);
    for (const group of types)
      for (const [i, v] of positions[group].entries()) {
        if (group === type && (onlyOther || i === ignoreIndex)) continue;
        if (Math.abs(v - value) * mm < half + halfAt(group, v) + 0.2 - 1e-8)
          return (
            'This position overlaps another ' +
            group +
            ' or its supporting wall.'
          );
      }
    return null;
  }
  const reason = (type, v, index = -1) =>
    structural(type, v) ?? collisions(type, v, index);
  const key = (type) => positionKey(scope, type, border ? side : undefined);
  const configured = (type) =>
    configuredPositions(p, scope, type, border ? side : undefined);
  // The row the user can arrange: without the side screw clips.
  const rowMode = screw ? tabsOnly(mode) : mode;
  const enabled = (type) =>
    (rowMode === 'both' || rowMode === type + 's') && configured(type)?.length !== 0;
  const screwMarks = () => {
    if (screwRow.length) positions.clip = screwRow.map((zone) => zone.position);
  };
  screwMarks();
  const both = types.every(enabled);
  const order = types
    .filter(enabled)
    .sort((a, b) => Number(!!configured(b)) - Number(!!configured(a)));
  const autoRoad = p.connectorOffset || w * 0.36;
  function placeLegacyMarks(type) {
    const custom = configured(type);
    const targets =
      custom ??
      (sideMount
        ? type === 'clip'
          ? [0.5]
          : [0.32, 0.68]
        : border
          ? [both ? (type === 'tab' ? 0.28 : 0.72) : 0.5]
          : type === 'clip'
            ? [0]
            : [-autoRoad, autoRoad]);
    for (let target of targets) {
      if (!custom && border && !sideMount) {
        const delta = env[type].half / length;
        let lo = delta,
          hi = 1 - delta;
        if (both && types.every((k) => !configured(k))) {
          if (type === 'tab') hi -= (2 * env.clip.half + 0.2) / length;
          else
            lo =
              positions.tab[0] + (env.tab.half + env.clip.half + 0.2) / length;
        }
        target = clamp(target, lo, hi);
      }
      if (
        !custom &&
        !(type === 'tab' && !border && p.connectorOffset) &&
        reason(type, target)
      ) {
        const step = sideMount ? 0.02 : 1 / mm;
        const xs = sideMount
          ? Array.from({ length: 49 }, (_, i) => (i + 1) / 50).sort(
              (a, b) => Math.abs(a - target) - Math.abs(b - target),
            )
          : null;
        if (xs) target = xs.find((v) => !reason(type, v)) ?? target;
        else
          for (let d = step; d <= domain[1] - domain[0]; d += step) {
            if (!reason(type, target + d)) {
              target += d;
              break;
            }
            if (!reason(type, target - d)) {
              target -= d;
              break;
            }
          }
      }
      positions[type].push(target);
    }
  }
  let placementWarning;
  const request = countedJoint(p, scope, border ? side : undefined, rowMode);
  if (slotFace) {
    const location = 'Road ' + scope;
    try {
      const row = slotEndRow(
        slotEndRequest(p, scope, { width: w, lanes: laneOffsets, envelopes: env, location }),
      );
      Object.assign(positions, row.positions);
      // The row never gives way to the rest of the piece. A finished build
      // has accepted it; until then, look for what would refuse it.
      const built = options.parts && stationsInParts(options.parts, key, index, pointAt);
      for (const { type, value, custom } of row.specs) {
        if (built?.[type].has(value)) continue;
        const why = structural(type, value);
        if (!why) continue;
        const setting = slotPositionSetting(p, laneOffsets, value, scope);
        const move = 'move ' + slotToMove(setting, laneOffsets.length);
        const error = connectorWarning(
          location + ' · ' + env[type].name,
          why,
          custom
            ? 'Move this connector, ' + slotRoomAdvice(p.kind).toLowerCase() + ', or ' + move + '.'
            : slotRoomAdvice(p.kind) + ', ' + move + ', or place the connectors by hand.',
          setting,
        );
        error.proposedPositions = row.positions;
        throw error;
      }
    } catch (error) {
      if (!options.editInvalid || !error.proposedPositions) throw error;
      Object.assign(positions, error.proposedPositions);
      placementWarning = error.message;
    }
  } else if (request) {
    const borderName = side === 'inner' ? 'Inside border' : 'Outside border';
    const jointName = index === 0 ? 'start' : index === count ? 'finish' : 'seam ' + index;
    const location = sideMount
      ? borderName + ' attachment ' + (index + 1)
      : (border ? borderName : 'Road') + ' ' + jointName;
    const matchEnds = !border && p.kind !== 'import' && p.segments === 1 &&
      JSON.stringify(request) === JSON.stringify(countedJoint(p, scope === 'finish' ? 'start' : 'finish'));
    const built = rowFromParts(options.parts, request, key, index, pointAt);
    try {
      Object.assign(positions, built ?? planConnectorRow(request, {
        domain, length, halfAt, blocked: structural, location,
        settingFor: type => countWarningSetting(p, scope, type),
        checkRow: matchEnds ? opposingRoadPockets(p, path, env) : undefined,
      }));
    } catch (error) {
      if (!options.editInvalid || !error.proposedPositions) throw error;
      Object.assign(positions, error.proposedPositions);
      placementWarning = error.message;
    }
  } else {
    order.forEach(placeLegacyMarks);
  }
  screwMarks();
  const even = (type, n, span) =>
    evenlySpaced(
      domain,
      mm,
      n,
      span,
      (v) => structural(type, v) ?? collisions(type, v, -1, true),
      (v) => halfAt(type, v),
    );
  for (const list of Object.values(positions)) list.sort((a, b) => a - b);
  return {
    mode,
    scope,
    side,
    index,
    domain,
    length,
    outlines,
    lanes,
    equipment,
    edge: displayLine(physicalEdge, 800),
    pointAt,
    valueAt,
    key,
    positions,
    placementWarning,
    // Automatic marks at this end are set by the off-centre slot alone.
    fixedRow: Boolean(slotFace),
    // Side screw clips are shown but not placed by hand.
    ...(screw && { lockedClips: screwLock }),
    reason,
    even,
  };
}

// Each legal centre interval is shifted back by i*pitch. Where all shifted
// intervals intersect, the complete equally spaced row fits. This keeps the
// gap exact when a centre has to move away from a lane or an existing tab.
function intersectIntervals(a, b) {
  let i = 0,
    j = 0;
  const out = [];
  while (i < a.length && j < b.length) {
    const left = Math.max(a[i][0], b[j][0]),
      right = Math.min(a[i][1], b[j][1]);
    if (left <= right + 1e-10) out.push([left, Math.max(left, right)]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

function evenlySpaced(domain, mm, count, span, whyBlocked, half) {
  if (!Number.isInteger(count) || count < 0 || count > 8)
    throw Error('Choose a connector count from 0 to 8.');
  if (!count) return [];
  if (
    span &&
    (!Array.isArray(span) || span.length !== 2 || !span.every(Number.isFinite))
  )
    throw Error('Choose two outer marks to set the spacing span.');
  const [lo, hi] = span ? [Math.min(...span), Math.max(...span)] : domain;
  if (lo < domain[0] || hi > domain[1])
    throw Error('The spacing marks must lie on the selected joint.');
  function invalid(row) {
    for (const [i, v] of row.entries()) {
      const reason = whyBlocked(v);
      if (reason) return reason;
      if (i && (v - row[i - 1]) * mm + 1e-7 < half(v) + half(row[i - 1]) + 0.2)
        return 'Adjacent connectors need more room for their supporting walls.';
    }
    return null;
  }
  const midpoint = (lo + hi) / 2;
  const rowAt = (start, pitch) =>
    Array.from({ length: count }, (_, i) => start + i * pitch);
  let pitch = span
    ? (hi - lo) / Math.max(1, count - 1)
    : (hi - lo) / (count + 1);
  const ideal = rowAt(count === 1 ? midpoint : span ? lo : lo + pitch, pitch);
  const initialReason = invalid(ideal);
  if (!initialReason) return ideal;
  if (span)
    throw Error(initialReason + ' Move the outer marks or reduce the count.');
  const steps = clamp(Math.ceil(((hi - lo) * mm) / 0.5), 96, 640);
  const ranges = [];
  let last = lo,
    previous = !whyBlocked(last),
    start = previous ? lo : null;
  for (let i = 1; i <= steps; i++) {
    const v = lerp(lo, hi, i / steps),
      valid = !whyBlocked(v);
    if (valid !== previous) {
      let inside = valid ? v : last,
        outside = valid ? last : v;
      for (let j = 0; j < 16; j++) {
        const mid = (inside + outside) / 2;
        if (whyBlocked(mid)) outside = mid;
        else inside = mid;
      }
      if (valid) start = inside;
      else ranges.push([start, inside]);
    }
    if (valid && i === steps) ranges.push([start, v]);
    previous = valid;
    last = v;
  }
  const pitches = new Set([pitch]);
  if (count > 1) {
    // At either limit of a feasible pitch range, two of the marks meet a
    // legal interval endpoint. Include intermediate pitches for angled tabs,
    // whose clearance along a curved joint varies with position.
    // Highly segmented borders can have hundreds of disjoint openings.
    // Bound candidate pitches while continuing to test each against all
    // openings. Keep the widest and the ones closest to the requested row.
    const promising = new Set();
    if (ranges.length > 24) {
      for (const range of [...ranges]
        .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
        .slice(0, 16))
        promising.add(range);
      for (const target of ideal) {
        const distance = (r) => Math.abs(target - clamp(target, r[0], r[1]));
        promising.add(
          ranges.reduce((best, r) => (distance(r) < distance(best) ? r : best)),
        );
      }
    }
    const ends = (promising.size ? [...promising] : ranges)
      .flat()
      .sort((a, b) => a - b);
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++)
        for (let n = 1; n < count; n++) pitches.add((ends[j] - ends[i]) / n);
    for (let i = 1; i <= 64; i++)
      pitches.add(((hi - lo) * i) / (64 * (count - 1)));
  }
  for (const step of [...pitches].sort(
    (a, b) => Math.abs(a - pitch) - Math.abs(b - pitch),
  )) {
    let options = ranges;
    for (let i = 1; i < count && options.length; i++)
      options = intersectIntervals(
        options,
        ranges.map(([a, b]) => [a - i * step, b - i * step]),
      );
    const idealStart = midpoint - ((count - 1) * step) / 2;
    const starts = options
      .flatMap(([a, b]) => [clamp(idealStart, a, b), (a + b) / 2, a, b])
      .sort((a, b) => Math.abs(a - idealStart) - Math.abs(b - idealStart));
    for (const first of starts) {
      const row = rowAt(first, step);
      if (!invalid(row)) return row;
    }
  }
  throw Error(
    'Could not fit ' +
      count +
      ' evenly spaced connectors. ' +
      initialReason +
      ' Try fewer connectors or a wider joint.',
  );
}
