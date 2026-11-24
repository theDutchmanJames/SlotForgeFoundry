import { plannerStrip } from '../planner-strip.js';
import { addSlot, braidRecess, braidSections, left, makePart, move, shell, unit } from './solids.js';
import { laneTools, measuredLane } from './import-track.js';
import { buildPitTurnout } from './pit-turnout.js';
import { buildTurnout } from './turnout-piece.js';
import { addPitMotorMount, pitMotorMountLayout } from './pit-motor-mount.js';
import { checkPitBorderHardware } from './pit-border-linkage.js';
import { pitWhiteLines } from './pit-white-line.js';
import { grooveClearOfDovetails } from './paint-guides.js';
import { centreLinePaint } from './road-centre-line.js';
import { ribRun } from './reinforcement.js';
import { WHITE_LINE_COLOR } from './kerbstones.js';
import { addBorderEndJoints, addRoadJoints } from './track-joints.js';
import { attachBraidFeeds } from './braid-feeds.js';
import { activeJointMode, countedJoint } from './placements.js';
import { borderWidth } from './border-profile.js';
import {
  cutPitBraidFeeds,
  pitBraidLayout,
  pitBraidSections,
} from './pit-braids.js';
import {
  diamondLayout,
  diamondJumperSize,
  offsets,
  pitLayout,
  pitPrintPath,
  pointOnAxis,
  specialJunctionPlan,
  validateSpecialJunction,
} from './special-junction-layout.js';

export { specialJunctionPlan, validateSpecialJunction };
const between = (lo, hi, n) =>
  Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
const lerp = (a, b, t) => a.map((v, i) => v + t * (b[i] - v));
const direction = (a, b) => unit([b[0] - a[0], b[1] - a[1]]);
const closedDisc = (p, r) =>
  between(0, 2 * Math.PI, 36)
    .slice(0, -1)
    .map((a) => [p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)]);
const union2 = (work, areas) => work.own(work.wasm.CrossSection.union(areas));
function axisBox(work, axis, x0, x1, y0, y1) {
  return work.section([
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(([x, y]) => pointOnAxis(axis, x, y)),
  ]);
}
function renameHardware(list, prefix) {
  for (const item of list) {
    item.id = prefix + item.id;
    if (item.parentClipId) item.parentClipId = prefix + item.parentClipId;
  }
}

function splitPitRoads(work, p, path, pieces, loose) {
  if (p.segments === 1 || p.lanes < 2) return pieces;
  const slots = offsets(p),
    central = Math.floor((slots.length - 1) / 2);
  const median = (slots[central] + slots[central + 1]) / 2;
  const result = [];
  let segment = 0;
  for (const part of pieces) {
    if (part.role !== 'road') {
      result.push(part);
      continue;
    }
    const x0 = (path.cuts[segment] - 0.5) * p.length,
      x1 = (path.cuts[segment + 1] - 0.5) * p.length;
    const box = part.section.bounds();
    const sections = [
      axisBox(work, [1, 0], x0 - 0.05, x1 + 0.05, box.min[1] - 1, median),
      axisBox(work, [1, 0], x0 - 0.05, x1 + 0.05, median, box.max[1] + 1),
    ];
    if (p.hollow) {
      const web = axisBox(
        work,
        [1, 0],
        x0 - 0.05,
        x1 + 0.05,
        median - p.wall,
        median + p.wall,
      );
      part.additions.push(
        work.prism(work.own(web.intersect(part.section)), 0, p.height),
      );
    }
    const body = work.cut(work.union(part.additions), part.cuts);
    const halves = sections.map((section, i) => {
      const sign = i === 0 ? -1 : 1;
      const half = {
        ...part,
        id: 'road-' + (2 * segment + i + 1),
        name:
          'Pit ' + (i === 0 ? 'right' : 'left') + ' · section ' + (segment + 1),
        section: work.own(section.intersect(part.section)),
        additions: [work.own(body.trimByPlane([0, sign, 0], sign * median))],
        cuts: [...part.cuts],
        ribKeepouts: [...(part.ribKeepouts ?? [])],
        roadPocketStock: [...(part.roadPocketStock ?? [])],
        jointGuides: (part.jointGuides ?? []).filter(
          (g) => sign * (g.point[1] - median) >= 0,
        ),
      };
      return half;
    });
    // The median runs perpendicular to the road seams. Calculate its own row
    // across the available span; signed offsets from a road end do not apply.
    if (p.joint !== 'none') {
      const avg = (x1 + x0) / 2,
        span = x1 - x0;
      const counted = countedJoint({ ...p, placements: undefined }, 'seam', undefined, p.joint);
      const mode = counted ? p.joint : p.joint === 'tabs' ? 'tabs' : 'clips';
      const join = {
        ...p,
        width: span,
        segments: 2,
        kind: 'straight',
        joint: mode,
        jointStart: 'none',
        jointEnd: 'none',
        connectorOffset: 0,
        placements: !counted && mode === 'tabs' ? { seamTabs: [0] } : {},
        mutedPlacements: [],
      };
      const lateral = {
        point: (t, d) => [avg - d, median + (t - 0.5) * p.width],
        tangent: () => [0, 1],
        minLength: p.width,
        segmentLengths: [median - box.min[1], box.max[1] - median],
      };
      const hardware = [];
      addRoadJoints(work, join, lateral, [], halves, hardware, {
        skipped: new Set([0, 2]),
      });
      renameHardware(hardware, 'median-' + (segment + 1) + '-');
      loose.push(...hardware);
    }
    result.push(...halves);
    segment++;
  }
  return result;
}

function buildPit(work, p, generate) {
  const geometry = pitLayout(p);
  const { path: raw, lanePaths, forks } = geometry;
  const electrical = pitBraidLayout(p, geometry);
  const path = pitPrintPath(raw, forks, p, electrical);
  const covered = lanePaths.map((pts) => [
    [-p.length / 2 - 0.05, pts[0][1]],
    ...pts,
    [p.length / 2 + 0.05, pts.at(-1)[1]],
  ]);
  const tools = laneTools(work, p, { lanes: covered, outlines: [] });
  const { recess, cover } = pitBraidSections(work, p, electrical);
  for (const lane of tools) lane[2] = null;
  tools[0][2] = recess;
  path.measuredLanes = lanePaths
    .slice(0, p.lanes)
    .map((line) => measuredLane(line));
  const { pieces, loose } = generate(work, p, path, tools, {
    deferRoadJoints: true,
  });
  const roads = pieces.filter((part) => part.role === 'road');
  const borders = pieces.filter((part) => part.role === 'border');
  cutPitBraidFeeds(work, p, roads, electrical);
  const sleeves = union2(
    work,
    tools.map(([, sleeve]) => sleeve),
  );
  const guides = union2(work, tools.map(([guide]) => guide));
  for (const road of roads) road.adjustedLaneSleeves = sleeves;
  addRoadJoints(work, p, path, offsets(p), roads, loose);
  for (const [i, fork] of forks.entries()) {
    const station = 0.5 + fork.heel[0] / p.length;
    const index = path.cuts.slice(1).findIndex((t) => t >= station);
    const road = roads[index];
    const mount = pitMotorMountLayout(p, fork, lanePaths[p.lanes + i]);
    if (mount) loose.push(addPitMotorMount(work, p, mount, road, borders, loose));
    else checkPitBorderHardware(work, p, fork, loose);
    loose.push(...buildPitTurnout(work, p, fork, road, cover, guides, borders, mount?.rodEndY));
  }
  const segmented = splitPitRoads(work, p, path, pieces, loose);
  const stripes = pitWhiteLines(p, geometry);
  if (stripes.paint.length) {
    const paint = work.section(stripes.paint);
    const roadHalves = segmented.filter(part => part.role === 'road');
    const guards = [...new Set(roadHalves.flatMap(part => part.drawKeyGuards ?? []))];
    const groove = stripes.grooves.length ? grooveClearOfDovetails(work, guards, work.section(stripes.grooves)) : null;
    // Carry a single continuous guide across all seams, including the median.
    // The mask comes from the same enlarged or repositioned joints as the STL.
    const guide = groove && guards.length ? groove.toPolygons() : undefined;
    for (const road of roadHalves) {
      road.paintSections = [...(road.paintSections ?? []), { color: WHITE_LINE_COLOR, section: paint }];
      if (groove) road.grooveSections = [...(road.grooveSections ?? []), groove];
      road.pitGrooveGuide = guide;
    }
  }
  return { pieces: segmented, loose };
}

function diamondTools(work, p, model) {
  const result = [];
  const half = p.slotWidth / 2,
    end = p.length / 2 + 0.05;
  for (const { axis, laneData } of model.roads)
    for (const { d, crossings } of laneData) {
      const band = (a, b, w) => axisBox(work, axis, a, b, d - w, d + w);
      const poweredBand = (lo, hi) => {
        const spans = [];
        let start = -end;
        for (const x of crossings.concat(end + model.gap)) {
          spans.push(axisBox(work, axis, start, x - model.gap, d + lo, d + hi));
          start = x + model.gap;
        }
        return union2(work, spans);
      };
      result.push([
        band(-end, end, half),
        band(-end, end, half + p.wall),
        ...braidSections(work, p, poweredBand),
      ]);
    }
  return result;
}

function crossingFeeds(work, p, model, core) {
  if (!p.braidWidth) return;
  const { depth, width: wireChannel } = diamondJumperSize(p);
  const feedLength = Math.max(1.2, 2 * braidRecess(p) + 0.2);
  for (const { axis, laneData } of model.roads)
    for (const { d, crossings } of laneData) {
      const stations = [];
      for (const x of crossings) {
        const reach = model.gap + feedLength / 2;
        stations.push(
          0.5 + (x - reach) / p.length,
          0.5 + (x + reach) / p.length,
        );
        for (const sign of [-1, 1]) {
          const y =
            d + sign * (p.slotWidth / 2 + p.braidGap + p.braidWidth / 2);
          const footprint = axisBox(
            work,
            axis,
            x - reach,
            x + reach,
            y - wireChannel / 2,
            y + wireChannel / 2,
          );
          core.cuts.push(work.prism(footprint, -1, depth));
        }
      }
      const line = measuredLane(
        [-p.length / 2, p.length / 2].map((x) => pointOnAxis(axis, x, d)),
      );
      attachBraidFeeds(
        work,
        {
          ...p,
          braidFeedLane: 0,
          braidFeedSide: 'both',
          braidFeedStations: stations,
          braidFeedLength: feedLength,
        },
        [core],
        [line],
      );
    }
}

function diamondPath(p, road) {
  const n = Math.max(1, p.segments - 1),
    count = 2 * n + 1;
  const [lo, hi] = road.arms,
    { axis } = road;
  function point(t, d) {
    if (p.segments === 1) return pointOnAxis(axis, (t - 0.5) * p.length, d);
    const f = t * count;
    if (f <= n) return lo.path.point(f / n, d);
    if (f >= n + 1) return hi.path.point((f - n - 1) / n, d);
    return lerp(lo.path.point(1, d), hi.path.point(0, d), f - n);
  }
  const parameters = between(0, 1, p.segments === 1 ? 1 : count);
  return {
    point,
    tangent: () => axis,
    normal: (t) => direction(point(t, -1), point(t, 1)),
    minLength: p.length,
    segmentLengths: parameters.slice(1).map((t, i) => {
      const a = point(parameters[i], 0),
        b = point(t, 0);
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    }),
  };
}

function mergeRoad(work, core, arm) {
  core.section = work.own(core.section.add(arm.section));
  for (const key of [
    'cuts',
    'additions',
    'feedCuts',
    'drawKeyGuards',
    'jointGuides',
    'paintSections',
    'grooveSections',
    'kerbBands',
    'ribRuns',
    'ribKeepouts',
    'ribSleeves',
  ])
    if (arm[key]?.length) (core[key] ??= []).push(...arm[key]);
}

function buildDiamond(work, p, generate) {
  const model = diamondLayout(p),
    tools = diamondTools(work, p, model);
  const core = makePart(
    'road-1',
    'Diamond crossing',
    'road',
    work.section([model.coreLoop]),
  );
  shell(work, core, p);
  if (work.planning) {
    const count = 2 * Math.max(1, p.segments - 1) + 1;
    const a = p.segments === 1 ? 0 : (count - 1) / (2 * count);
    const strips = model.roads.map(road => plannerStrip({
      ...diamondPath(p, road), stations: [a, 1-a],
    }, p, a, 1-a));
    core.plannerStrip = { ...strips[0], lanes: strips.flatMap(s => s.lanes), ports: strips.flatMap(s => s.ports) };
  }
  if (p.hollow && p.reinforcement) {
    const [a, b, c, d] = model.coreLoop;
    core.ribRuns = [ribRun(core.section, [[a, d], [b, c]])];
  }
  for (const args of tools) addSlot(work, core, p, ...args);
  crossingFeeds(work, p, model, core);
  const sleeves = union2(
    work,
    tools.map(([, sleeve]) => sleeve),
  );
  core.adjustedLaneSleeves = sleeves;
  const pieces = [core],
    loose = [],
    armGroups = [];
  let roadCount = 1;
  const borderCount = { inner: 0, outer: 0 };
  // Each arm ends on the bisector of its adjoining border; a second arm never
  // lays a shoulder over the through road or on top of this arm's border.
  const junctionBorders = new Map();
  for (const [axisIndex, road] of model.roads.entries()) {
    const group = [];
    for (const [i, arm] of road.arms.entries()) {
      const { config, path, sign } = arm,
        id = 'arm-' + axisIndex + '-' + i + '-';
      const atCore = sign === 1 ? 0 : 1,
        endIndex = atCore * config.borderSegments;
      const source = { ...config, braidFeedSide: 'none' };
      const armTools = tools.slice(
        axisIndex * p.lanes,
        (axisIndex + 1) * p.lanes,
      );
      const generated = generate(work, source, path, armTools, {
        deferRoadJoints: true,
        plainBorderEnds: [endIndex],
      });
      renameHardware(generated.loose, id);
      loose.push(...generated.loose);
      const roads = generated.pieces.filter((part) => part.role === 'road');
      for (const r of roads) {
        r.adjustedLaneSleeves = sleeves;
        if (p.segments === 1) mergeRoad(work, core, r);
        else {
          r.id = 'road-' + ++roadCount;
          r.name = 'Diamond arm ' + (axisIndex * 2 + i + 1) + ' · ' + r.name;
          pieces.push(r);
        }
      }
      for (const part of generated.pieces.filter(
        (part) => part.role === 'border',
      )) {
        const [, side, n] = part.id.split('-');
        if (Number(n) === (atCore ? config.borderSegments : 1)) {
          const across = side === 'outer' ? 1 : -1;
          const corner = path.point(atCore, (across * p.width) / 2);
          const cornerKey = corner.map((v) => Math.round(v * 10000)).join('/');
          const w = borderWidth(config, atCore, side);
          const edge = path.point(atCore, across * (p.width / 2 + w));
          const ends = junctionBorders.get(cornerKey) ?? [];
          ends.push({
            part,
            corner,
            edge,
            side,
            w,
            length: path.edgeLength(across) / config.borderSegments,
          });
          junctionBorders.set(cornerKey, ends);
        }
        part.id = 'border-' + side + '-' + ++borderCount[side];
        part.name =
          'Diamond arm ' + (axisIndex * 2 + i + 1) + ' · ' + part.name;
        pieces.push(part);
      }
      group.push(roads);
    }
    armGroups.push(group);
  }
  if (p.braidFeedSide !== 'none') {
    const segments = pieces.filter((part) => part.role === 'road');
    for (const road of model.roads) {
      const lines = road.laneData.map(({ d }) =>
        measuredLane(
          [-p.length / 2, p.length / 2].map((x) =>
            pointOnAxis(road.axis, x, d),
          ),
        ),
      );
      const half = p.braidFeedLength / 2;
      for (const [index, lane] of road.laneData.entries()) {
        if (p.braidFeedLane && p.braidFeedLane !== index + 1) continue;
        if (
          p.braidFeedStations.some((t) =>
            lane.crossings.some(
              (x) => Math.abs((t - 0.5) * p.length - x) < model.gap + half,
            ),
          )
        )
          throw Error(
            'The braid feed enters a diamond isolation gap. Move its station along the road.',
          );
      }
      attachBraidFeeds(work, p, segments, lines);
    }
  }
  for (const [i, road] of model.roads.entries()) {
    const roadParts =
      p.segments === 1
        ? [core]
        : [...armGroups[i][0], core, ...armGroups[i][1]];
    const additions = [];
    addRoadJoints(
      work,
      { ...p, segments: roadParts.length },
      diamondPath(p, road),
      offsets(p),
      roadParts,
      additions,
    );
    renameHardware(additions, 'axis-' + (i + 1) + '-');
    loose.push(...additions);
  }
  if (p.roadCentreLine !== 'none') {
    const stripe = union2(work, model.roads.map(({ axis }) => centreLinePaint(work, p, {
      stations: [0, 1], tangent: () => axis,
      point: (t, d) => pointOnAxis(axis, (t - 0.5) * p.length, d),
    })));
    const channels = union2(work, tools.flatMap(([guide, , , envelope]) => envelope ? [guide, envelope] : [guide]));
    for (const part of pieces.filter(part => part.role === 'road')) {
      part.centreLinePaint = stripe;
      part.laneKeepout = channels;
    }
  }
  let junction = 0;
  for (const ends of junctionBorders.values()) {
    if (ends.length !== 2) continue;
    const [a, b] = ends;
    // A removable mount seats from below, so two perpendicular shoulders can
    // print as a single elbow. End hardware then lives on its straight cuts.
    // Integral side tabs need independent slide directions on the two arms.
    if (
      !ends.some((e) =>
        ['tabs', 'both'].includes(activeJointMode(p, 'side', e.side)),
      )
    ) {
      mergeRoad(work, a.part, b.part);
      a.part.name = a.part.name.replace(' · ', ' elbow · ');
      pieces.splice(pieces.indexOf(b.part), 1);
      continue;
    }
    const modes = [a, b].map((item) => activeJointMode(p, 'end', item.side));
    const mode = modes[0];
    if (mode === 'none' || mode !== modes[1]) continue;
    const line = direction(a.corner, a.edge),
      reach = Math.min(a.w, b.w) / a.w;
    const away = left(line);
    const containsAfter = work.section([
      closedDisc(move(lerp(a.corner, a.edge, 0.5 * reach), away, 1), 0.15),
    ]);
    const dir =
      work.own(b.part.section.intersect(containsAfter)).area() > 0
        ? away
        : away.map((v) => -v);
    const across = a.side === 'outer' ? 1 : -1;
    const span =
      Math.hypot(a.edge[0] - a.corner[0], a.edge[1] - a.corner[1]) * reach;
    const path = {
      point: (_, d) => move(a.corner, line, across * d - p.width / 2),
      tangent: () => dir,
      edgeLength: () => 2 * Math.min(a.length, b.length),
      borderStock: [0, 1],
    };
    const cornerHardware = [];
    addBorderEndJoints(
      work,
      { ...p, borderSegments: 2 },
      path,
      a.side,
      across,
      [a.part, b.part],
      cornerHardware,
      () => span,
      new Set([0, 2]),
    );
    renameHardware(cornerHardware, 'miter-' + ++junction + '-');
    loose.push(...cornerHardware);
  }
  return { pieces, loose };
}

export function buildSpecialJunction(work, p, generate) {
  validateSpecialJunction(p);
  if (p.special.type === 'turnout') return buildTurnout(work, p);
  return p.special.type === 'pit'
    ? buildPit(work, p, generate)
    : buildDiamond(work, p, generate);
}
