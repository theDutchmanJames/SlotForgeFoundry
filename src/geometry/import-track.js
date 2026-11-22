import {
  addSlot,
  braidSections,
  shell,
  makePart,
  minus,
  length2,
  dot,
  left,
  move,
  unit,
} from './solids.js';
import { attachBraidFeeds, interpolateStation } from './braid-feeds.js';
import { activeJointMode } from './placements.js';
import { addRoadJoints, integralJointMode } from './track-joints.js';
import { prepareBridges } from './bridge-build.js';
import { sectionStations } from './bridge-sections.js';
import { apexPositionFor } from './border-profile.js';
import { validateLaneBends } from '../lane-adjustment.js';

const distance = (a, b) => length2(minus(a, b));
const closed = (path) =>
  path.length > 2 && distance(path[0], path.at(-1)) < 1e-5;
const EPS = 1e-7;

function cleaned(path) {
  if (!Array.isArray(path) || path.length > 100000)
    throw new Error('Invalid or oversized Circuit path.');
  if (
    path.some(
      (p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite),
    )
  )
    throw new Error('Circuit paths must contain finite XY coordinates.');
  return path.filter((p, i) => !i || distance(p, path[i - 1]) > EPS);
}

function measured(path) {
  const distances = [0];
  for (let i = 1; i < path.length; ++i)
    distances.push(distances[i - 1] + distance(path[i - 1], path[i]));
  const total = distances.at(-1);
  if (!(total > EPS)) throw new Error('Circuit path has zero length.');
  const ts = distances.map((d) => d / total);
  const at = (t) => interpolateStation(ts, t, (i) => path[i]);
  return { ts, at, total };
}

export function vertexNormals(path, loop = false) {
  return path.map((p, i) => {
    const before = i ? path[i - 1] : loop ? path.at(-1) : null;
    const after = i + 1 < path.length ? path[i + 1] : loop ? path[0] : null;
    const a = left(unit(before ? minus(p, before) : minus(after, p)));
    const b = left(unit(after ? minus(after, p) : minus(p, before)));
    const bisector = unit([a[0] + b[0], a[1] + b[1]]),
      alignment = dot(a, bisector);
    if (alignment < 0.125)
      throw new Error(
        'A lane has a very sharp turn or doubles back. Repair it in Circuit.',
      );
    return bisector.map((x) => x / alignment);
  });
}

export function measuredLane(path, suppliedNormals) {
  const lane = measured(path);
  // Match the offsets used to cut the braid shelf along the lane. The miter
  // at a drawing corner can be appreciably longer than a unit normal.
  let normals = suppliedNormals;
  lane.atOffset = (t, offset) => {
    if (!normals) {
      const loop = closed(path);
      normals = vertexNormals(loop ? path.slice(0, -1) : path, loop);
    }
    return interpolateStation(lane.ts, t, (i) => {
      const vertex = i % normals.length;
      return move(path[vertex], normals[vertex], offset);
    });
  };
  return lane;
}

function openingPlane(point, previous, edge) {
  if (!edge) return null;
  const [a, b] = edge;
  const travel = unit(minus(point, previous));
  let normal = left(unit(minus(b, a)));
  if (dot(normal, travel) < 0) normal = normal.map((x) => -x);
  const alignment = dot(normal, travel);
  if (alignment < EPS) return null;
  // A small overrun normal to the physical seam survives the float precision
  // of the exported mesh. At a skew end the two sides need different lengths.
  const clearance =
    0.001 + Math.max(...a.map(Math.abs), ...b.map(Math.abs)) * 3e-7;
  // When a lane grazes a short edge, the infinite line can intersect the
  // offset arbitrarily far away. Stop at the physical extent of this edge.
  const reach =
    Math.max(0, dot(minus(a, point), travel), dot(minus(b, point), travel)) +
    clearance;
  return { a, normal, travel, alignment, clearance, reach };
}

function finishBound(points, end, plane) {
  if (!plane) return;
  const { a, normal, travel, alignment, clearance, reach } = plane;
  const inside = (point) => clearance - dot(minus(point, a), normal);
  const step = end === 0 ? 1 : -1;
  let i = end === 0 ? 0 : points.length - 1;
  const gap = inside(points[i]);
  if (gap >= 0) {
    points[i] = move(points[i], travel, Math.min(reach, gap / alignment));
    return;
  }
  // An offset can already project beyond an oblique mouth. Trim its tail to
  // the same plane so it cannot run across a gap into another panel or lane.
  while (points[i + step] && inside(points[i + step]) < 0) i += step;
  const next = points[i + step];
  if (!next) return;
  const d = inside(points[i]);
  const hit = move(points[i], minus(next, points[i]), d / (d - inside(next)));
  if (end === 0) points.splice(0, i + 1, hit);
  else points.splice(i, points.length - i, hit);
}

function panelOpening(point, previous, outlines) {
  let best;
  let nearest = Infinity,
    bestAlignment = 0;
  const travel = unit(minus(point, previous));
  // Loose CAD endpoint matching is only appropriate for the two known
  // ends of a recovered piece. A blind groove in a panel ends as drawn.
  const tol = EPS + Math.max(Math.abs(point[0]), Math.abs(point[1])) * 1e-10;
  for (const loop of outlines) {
    for (let i = 0; i < loop.length; ++i) {
      const a = loop[i],
        b = loop[(i + 1) % loop.length];
      if (
        Math.max(a[0], b[0]) < point[0] - tol ||
        Math.min(a[0], b[0]) > point[0] + tol ||
        Math.max(a[1], b[1]) < point[1] - tol ||
        Math.min(a[1], b[1]) > point[1] + tol
      )
        continue;
      const distance = pointToEdge(point, a, b);
      const alignment = Math.abs(dot(left(unit(minus(b, a))), travel));
      if (
        distance <= tol &&
        alignment > EPS &&
        (distance < nearest ||
          (distance === nearest && alignment > bestAlignment))
      ) {
        best = [a, b];
        nearest = distance;
        bestAlignment = alignment;
      }
    }
  }
  return best;
}

export function laneTools(work, p, { lanes, outlines, path, p: actual }) {
  const ends =
    path &&
    [0, 1].map((t) => [
      path.point(t, -actual.width / 2),
      path.point(t, actual.width / 2),
    ]);
  return lanes.map((lane, index) => {
    const loop = closed(lane);
    const pts = loop ? lane.slice(0, -1) : lane;
    if (p.laneAdjustment && !path?.laneCurves) validateLaneBends(p, pts);
    const normals = path?.laneNormals?.[index] ?? vertexNormals(pts, loop);
    const planes = loop
      ? []
      : [0, -1].map((end) => {
          const point = lane.at(end);
          const previous = lane.at(end === 0 ? 1 : -2);
          const edge = ends
            ? ends.reduce((best, e) =>
                pointToEdge(point, ...e) < pointToEdge(point, ...best)
                  ? e
                  : best,
              )
            : panelOpening(point, previous, outlines);
          return openingPlane(point, previous, edge);
        });
    function bound(d) {
      const points = pts.map((v, i) => move(v, normals[i], d));
      planes.forEach((plane, end) => finishBound(points, end, plane));
      return points;
    }
    const half = p.slotWidth / 2;
    const band = (lo, hi) =>
      work.section(
        loop
          ? [bound(lo), bound(hi)]
          : [[...bound(lo), ...bound(hi).reverse()]],
      );
    return [
      band(-half, half),
      band(-half - p.wall, half + p.wall),
      ...braidSections(work, p, band),
    ];
  });
}

function pointToEdge(point, a, b) {
  const v = minus(b, a),
    l2 = dot(v, v);
  return distance(
    point,
    move(a, v, l2 ? Math.min(1, Math.max(0, dot(minus(point, a), v) / l2)) : 0),
  );
}

// A piece exported with an outline and open lane paths has two identifiable
// end faces. Recover the two original side polylines between those faces so
// segmentation and borders follow the actual drawn shape, including S-bends.
function sidesOfPiece(loop, lanes) {
  const ref = lanes[0];
  if (lanes.some(closed) || loop.length < 4) return null;
  const oriented = lanes.map((lane) =>
    distance(ref[0], lane[0]) + distance(ref.at(-1), lane.at(-1)) <=
    distance(ref[0], lane.at(-1)) + distance(ref.at(-1), lane[0])
      ? lane
      : lane.slice().reverse(),
  );
  const pick = (end) => {
    let best = Infinity,
      index = -1;
    for (let i = 0; i < loop.length; ++i) {
      const maxDist = Math.max(
        ...oriented.map((line) =>
          pointToEdge(line.at(end), loop[i], loop[(i + 1) % loop.length]),
        ),
      );
      if (maxDist < best) {
        best = maxDist;
        index = i;
      }
    }
    return best <= 0.2 ? index : -1;
  };
  const start = pick(0),
    finish = pick(-1);
  if (start < 0 || finish < 0 || start === finish) return null;
  const sequence = (a, b) => {
    const points = [];
    for (let i = (a + 1) % loop.length; ; i = (i + 1) % loop.length) {
      points.push(loop[i]);
      if (i === b) return points;
    }
  };
  const a = sequence(start, finish),
    b = sequence(finish, start).reverse();
  if (a.length < 2 || b.length < 2) return null;
  const up = left(unit(minus(ref[1], ref[0])));
  const sides = dot(minus(a[0], b[0]), up) > 0 ? [b, a] : [a, b];
  return { sides, oriented };
}

function importPath(p, sides, lanes, aligned = false) {
  const lo = measured(sides[0]),
    hi = measured(sides[1]),
    measuredLanes = lanes.map((lane) => measuredLane(lane));
  // Crossing sections carry corresponding stations on both shoulders and
  // every lane. Keep each section's left/right orientation through a figure 8.
  if (aligned) {
    const center = sides[0].map((v, i) => move(v, minus(sides[1][i], v), 0.5));
    const { ts } = measured(center);
    for (const [i, edge] of [lo, hi].entries()) {
      edge.ts = ts;
      edge.at = (t) => interpolateStation(ts, t, (k) => sides[i][k]);
    }
  }
  const widthAt = (t) => distance(lo.at(t), hi.at(t));
  // Left/right are relative to travel; orient circular pieces so 'outer' is
  // the longer edge, matching generated corners even for reversed DXF paths.
  const labs = aligned || hi.total >= lo.total ? [lo, hi] : [hi, lo];
  const sidePoint = (t, v) => {
    const a = labs[0].at(t),
      b = labs[1].at(t),
      n = unit(minus(b, a)),
      w = distance(a, b);
    if (v <= -p.width / 2) return move(a, n, v + p.width / 2);
    if (v >= p.width / 2) return move(b, n, v - p.width / 2);
    return move(a, n, (0.5 + v / p.width) * w);
  };
  const tangent = (t) =>
    unit(
      minus(
        sidePoint(Math.min(1, t + 1e-5), 0),
        sidePoint(Math.max(0, t - 1e-5), 0),
      ),
    );
  const normal = (t) => unit(minus(labs[1].at(t), labs[0].at(t)));
  const stations = new Set([...lo.ts, ...hi.ts, p.apexPosition]);
  for (const n of [p.segments, p.borderSegments, 32])
    for (let i = 0; i <= n; ++i) stations.add(i / n);
  return {
    point: sidePoint,
    tangent,
    normal,
    widthAt,
    measuredLanes,
    atOffset: (t, d) => move(sidePoint(t, 0), normal(t), d),
    stations: [...stations].sort((a, b) => a - b),
    minLength: Math.min(lo.total, hi.total),
    edgeLength: (sign) => labs[sign < 0 ? 0 : 1].total,
    laneOffsets: (t) =>
      measuredLanes.map((line, i) =>
        dot(
          minus(
            aligned
              ? interpolateStation(lo.ts, t, (k) => lanes[i][k])
              : line.at(t),
            sidePoint(t, 0),
          ),
          normal(t),
        ),
      ),
  };
}

export function importedTrackPaths(p, plan, alignedSection = false) {
  if (!plan || !Array.isArray(plan.lanes) || !plan.lanes.length)
    throw new Error(
      'The drawing has no slot centrelines. Include SLOT_CENTRES in the Circuit export.',
    );
  if (plan.lanes.length > 256 || (plan.outlines?.length ?? 0) > 1024)
    throw new Error('Choose a smaller set of Circuit pieces.');
  const lanes = plan.lanes.map(cleaned).filter((l) => l.length >= 2);
  if (!lanes.length) throw new Error('The drawing has no usable lane paths.');
  if (p.braidFeedSide !== 'none' && p.braidFeedLane > lanes.length)
    throw new Error('The selected braid lane does not exist in this drawing.');
  if (alignedSection) {
    const width = distance(plan.sides[0][0], plan.sides[1][0]);
    const actual = { ...p, width, lanes: lanes.length };
    return {
      p: actual,
      path: importPath(actual, plan.sides, lanes, true),
      lanes,
      outlines: plan.outlines,
    };
  }
  let outlines = (plan.outlines ?? [])
    .map(cleaned)
    .filter((l) => l.length >= 3);
  outlines = outlines.map((line) => (closed(line) ? line.slice(0, -1) : line));
  let recovered;
  if (outlines.length === 1) recovered = sidesOfPiece(outlines[0], lanes);
  if (!outlines.length) {
    if (lanes.length !== 1 || closed(lanes[0]))
      throw new Error(
        'Export a road surface outline from Circuit, or select one open centreline.',
      );
    // A lone lane is the road centre for this fallback.
    const normals = vertexNormals(lanes[0]);
    const edge = (d) => lanes[0].map((v, i) => move(v, normals[i], d));
    recovered = {
      sides: [edge(-p.width / 2), edge(p.width / 2)],
      oriented: lanes,
    };
  }
  if (recovered) {
    const width = distance(recovered.sides[0][0], recovered.sides[1][0]);
    const actual = { ...p, width, lanes: Math.min(8, lanes.length) };
    return {
      p: actual,
      path: importPath(actual, recovered.sides, recovered.oriented),
      lanes,
      outlines,
    };
  }
  return { p, path: null, lanes, outlines };
}

// Each printable section occupies an interval of the original route. An apex
// belongs to that route even when it falls inside an approach or past the
// start line of a closed circuit's final section.
export function setCrossingBorderStations(path, section, layout, p) {
  const { start, end } = section;
  const span = end - start;
  const local = (station) => (station - start) / span;
  path.borderProfileStation = (t) => {
    const station = start + t * span;
    return layout.closed ? station % 1 : station;
  };
  path.borderApexStations = (side) => {
    const apex = apexPositionFor(p, side);
    return (layout.closed ? [apex, apex + 1] : [apex])
      .filter((station) => station >= start && station <= end)
      .map(local);
  };
  if (layout.closed && start < 1 && end > 1) {
    const seam = local(1);
    path.borderProfileSeam = seam;
    if (!path.stations.some((t) => Math.abs(seam - t) < 1e-10))
      path.stations = [...path.stations, seam].sort((a, b) => a - b);
  }
}

function buildCrossingSections(work, p, layout, generate, borderWidth) {
  const pieces = [],
    loose = [],
    groups = new Map();
  const bridges = prepareBridges(work, layout, p);
  const lengths = bridges.phases.map(
    (phase) => sectionStations(phase.geometry.sides).length,
  );
  const longest = Math.max(...lengths);
  let roadOffset = 0,
    borderOffset = 0;
  const connected = !layout.independentRoutes;
  const closedProfile = layout.closed ? { ...p, borderExit: p.borderEntry } : p;
  function differentGrade(a, b) {
    if (!a || !b) return Boolean(a?.pose?.slope || b?.pose?.slope);
    if (Math.abs((a.pose?.slope ?? 0) - (b.pose?.slope ?? 0)) > 1e-7)
      return true;
    return (
      a.sectionIndex !== b.sectionIndex &&
      Math.abs((a.pose?.end ?? 0) - (b.pose?.start ?? 0)) > 1e-6
    );
  }
  for (const [index, phase] of bridges.phases.entries()) {
    const section = phase.geometry;
    const countFor = (target) =>
      Math.max(1, Math.ceil((target * lengths[index]) / longest - 1e-9));
    const segments = countFor(p.segments),
      borderSegments = countFor(p.borderSegments);
    const source = importedTrackPaths(
      { ...p, segments, borderSegments },
      section,
      true,
    );
    setCrossingBorderStations(source.path, section, layout, p);
    const borderAt = (_, t, side) =>
      borderWidth(closedProfile, source.path.borderProfileStation(t), side);
    const key = connected ? 0 : phase.routeIndex;
    if (!groups.has(key))
      groups.set(key, {
        stations: [],
        roads: [],
        skip: new Set(),
        integralOnly: new Set(),
      });
    const chain = groups.get(key);
    source.path.centreLinePhase = chain.centreLineLength ?? 0;
    chain.centreLineLength = source.path.centreLinePhase + lengths[index];
    const neighbor = (i) => {
      const v =
        bridges.phases[i] ??
        (layout.closed
          ? i < 0
            ? bridges.phases.at(-1)
            : bridges.phases[0]
          : null);
      return connected || v?.routeIndex === phase.routeIndex ? v : null;
    };
    const plainBorderEnds = new Set();
    if (differentGrade(neighbor(index - 1), phase)) {
      chain.skip.add(chain.roads.length);
      plainBorderEnds.add(0);
    }
    if (differentGrade(phase, neighbor(index + 1))) {
      chain.skip.add(chain.roads.length + segments);
      plainBorderEnds.add(borderSegments);
    }
    // A rigid clip cannot change length with its two inclined pockets.
    // Integral tabs and their paired sockets share the same transformation.
    let hardware = source.p;
    if (phase.pose?.slope) {
      for (
        let seam = chain.roads.length;
        seam <= chain.roads.length + segments;
        seam++
      )
        chain.integralOnly.add(seam);
      hardware = {
        ...source.p,
        borderMount: integralJointMode(p.borderMount),
        borderJoint: integralJointMode(p.borderJoint),
      };
    }
    const group = generate(
      work,
      hardware,
      source.path,
      laneTools(work, source.p, source),
      {
        deferRoadJoints: true,
        borderAt,
        plainBorderEnds,
      },
    );
    for (let i = 0; i < segments; i++)
      chain.stations.push({
        path: source.path,
        local: i / segments,
        length: source.path.minLength / segments,
      });
    chain.roads.push(...group.pieces.filter((part) => part.role === 'road'));
    for (const part of [...group.pieces, ...group.loose]) {
      part.crossingSection = phase.sectionIndex;
      part.bridgePhase = index;
      const match = /^(road-|border-(?:outer|inner)-)(\d+)$/.exec(part.id);
      if (part.parentClipId)
        part.parentClipId = 'section-' + (index + 1) + '-' + part.parentClipId;
      part.id = match
        ? match[1] +
          ((part.role === 'road' ? roadOffset : borderOffset) +
            Number(match[2]))
        : 'section-' + (index + 1) + '-' + part.id;
      const slope = phase.pose?.slope;
      const label = slope
        ? slope > 0
          ? 'Entry ramp'
          : 'Exit ramp'
        : phase.pose?.start
          ? 'Bridge deck'
          : 'Section ' + (phase.routeIndex + 1);
      part.name = label + ' · ' + part.name;
    }
    pieces.push(...group.pieces);
    loose.push(...group.loose);
    roadOffset += segments;
    borderOffset += borderSegments;
  }
  // Make both sides of each connector in one operation. Grade breaks get
  // plain, mitred ends; a rigid tab could otherwise bind at that joint.
  for (const [groupId, { roads, stations, skip, integralOnly }] of groups) {
    const chain = layout.closed ? [...roads, roads[0]] : roads;
    const count = chain.length;
    function station(t) {
      return (
        stations[Math.round(t * count)] ?? {
          path: stations.at(-1).path,
          local: 1,
        }
      );
    }
    const along =
      (key) =>
      (t, ...args) => {
        const { path, local } = station(t);
        return path[key](local, ...args);
      };
    const path = Object.fromEntries(
      ['widthAt', 'laneOffsets', 'normal', 'tangent', 'point', 'atOffset'].map(
        (k) => [k, along(k)],
      ),
    );
    path.segmentLengths = chain.map(
      (_, i) => stations[i % stations.length].length,
    );
    const jointParams = { ...p, segments: count };
    if (layout.closed) jointParams.jointStart = jointParams.jointEnd = 'none';
    const roadClips = [];
    if (layout.closed && skip.has(0)) skip.add(roads.length);
    addRoadJoints(work, jointParams, path, [], chain, roadClips, {
      skipped: skip,
      integralOnly,
    });
    for (const part of roadClips) {
      const seam = Number(part.id.split('-')[2]);
      const road = roads[Math.max(0, Math.min(roads.length - 1, seam - 1))];
      part.crossingSection = road.crossingSection;
      part.bridgePhase = road.bridgePhase;
      part.id = 'run-' + (groupId + 1) + '-' + part.id;
      if (part.parentClipId)
        part.parentClipId = 'run-' + (groupId + 1) + '-' + part.parentClipId;
      loose.push(part);
    }
  }
  return { pieces, loose, bridges };
}

export function buildImported(work, p, plan, generate, borderWidth) {
  if (plan?.flatCrossing && ['inner', 'outer'].some(side =>
      (p.borderSide === side || p.borderSide === 'both') &&
      (p.borderEnds?.[side]?.start || p.borderEnds?.[side]?.finish)))
    throw Error('Border ends need one open road piece. Use Continue at both ends of this crossing or closed loop.');
  if (plan?.flatCrossing)
    return buildCrossingSections(
      work,
      p,
      plan.flatCrossing,
      generate,
      borderWidth,
    );
  const source = importedTrackPaths(p, plan);
  const { lanes, outlines } = source;
  const tools = laneTools(work, p, source);
  if (source.path) return generate(work, source.p, source.path, tools);
  if (p.roadCentreLine !== 'none')
    throw new Error('This panel has no identifiable road centre. Turn off the centre line under Road, or import a piece with two open ends.');
  if (p.roadKerbSide && p.roadKerbSide !== 'none')
    throw Error('Road kerbstones need identifiable inside and outside edges. Turn off road kerbstones or import a piece with two open ends.');
  if (p.whiteLineRoad !== 'none')
    throw new Error(
      'This Circuit panel has no identifiable inside and outside road edges for a white line. Turn off the white line under Road or import a piece with two open ends.',
    );
  if (
    p.segments !== 1 ||
    p.borderSide !== 'none' ||
    ['start', 'finish'].some((scope) => activeJointMode(p, scope) !== 'none')
  )
    throw new Error(
      'This drawing has no single pair of open road ends. For whole panels, use one segment with no borders or end connectors.',
    );
  const road = makePart(
    'road-1',
    'Imported road',
    'road',
    work.section(outlines),
  );
  shell(work, road, p);
  for (const args of tools) addSlot(work, road, p, ...args);
  if (p.braidFeedSide !== 'none')
    attachBraidFeeds(work, p, [road], lanes.map((lane) => measuredLane(lane)));
  return { pieces: [road], loose: [] };
}
