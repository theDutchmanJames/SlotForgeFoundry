import { plannerStrip } from './planner-strip.js';
import {
  SolidWorkshop,
  addSlot,
  braidSections,
  braidSpan,
  shell,
  makePart,
  move,
  left,
} from './geometry/solids.js';
import {
  addRoadJoints,
  addSideMounts,
  addBorderEndJoints,
  jointSampleLength,
} from './geometry/track-joints.js';
import {
  activeJointMode, configuredCount, countedJoint, validateConnectorCounts, validatePlacements,
} from './geometry/placements.js';
import {
  attachBraidFeeds,
  interpolateStation,
} from './geometry/braid-feeds.js';
import { fitPlate, solidFootprint } from './geometry/plate.js';
import {
  buildImported,
  importedTrackPaths,
  laneTools,
  measuredLane,
  vertexNormals,
} from './geometry/import-track.js';
import {
  laneOffsetAt,
  laneOffsetDerivatives,
  laneProfileSteps,
  validateLaneAdjustment,
} from './lane-adjustment.js';
import {
  hasSlotPosition,
  lanesVary,
  slotDistances,
  slotForm,
  validateSlotPosition,
} from './slot-position.js';
import { finishBridges, prepareBridges } from './geometry/bridge-build.js';
import { layOutKerbstones, layOutRoadKerbs, WHITE_LINE_COLOR } from './geometry/kerbstones.js';
import { pitGridLayout, startingGridLayout } from './geometry/starting-grid.js';
import { applyRoadCentreLine, centreLinePaint } from './geometry/road-centre-line.js';
import {
  finishMarkings,
  grooveClearOfDovetails,
  lineDimensions,
  lineGrooves,
  layOutWhiteLines,
  markingStations,
  validatePaint,
  whiteLineLayout,
} from './geometry/paint-guides.js';
import { clipSpec } from './geometry/clip-types.js';
import { validateSpecialType } from './special-pieces.js';
import { addTimingHardware, splitTimingShelf, timingFraction, validateTiming } from './geometry/timing-straight.js';
import { addReinforcement, registerRibRun } from './geometry/reinforcement.js';
import { diamondLayout, validateSpecialJunction } from './geometry/special-junction-layout.js';
import { buildSpecialJunction } from './geometry/special-junctions.js';
import { borderEndProfile, borderSeam, validateBorderEnds } from './geometry/border-ends.js';
import {
  isRacingPiece,
  racingJointSamplePath,
  racingPath,
  racingTrackPoint,
  validateRacingPiece,
} from './special-racing.js';
import { insulatedHairpinShelves, hairpinFeeds } from './geometry/special-racing-tools.js';
import {
  borderPath,
  borderWidth,
  maxBorderWidth,
} from './geometry/border-profile.js';
export { borderWidth } from './geometry/border-profile.js';
import { connectorWarning, formatMm } from './geometry/connector-warning.js';
import {
  JOINT_FIT_DEFAULTS,
  JOINT_FIT_LIMITS,
  JOINT_FIT_MIN_HEIGHT,
  currentJointSettings,
  resolveJointFit,
  validateTabSize,
} from './geometry/joint-fit.js';
export { fitPlate, footprintHull, solidFootprint } from './geometry/plate.js';
export const CONNECTOR_MODES = Object.freeze(['none', 'tabs', 'clips', 'both']);

export const TRACK_PROFILE_LIMITS = Object.freeze({
  height: [1, 500],
  wall: [0.2, 100],
  deck: [0.2, 100],
  ribSpacing: [10, 500],
  dashLength: [1, 2000],
  dashGap: [1, 2000],
  slotDepth: [0.1, 499],
  slotWidth: [0.1, 100],
  braidWidth: [0, 100],
  braidDepth: [0, 100],
  braidGap: [0, 50],
});

export const RIB_DEFAULTS = Object.freeze({ reinforcement: true, ribSpacing: 50 });

export function defaultTrack() {
  return {
    kind: 'curve',
    radius: 220,
    angle: 30,
    length: 180,
    width: 140,
    lanes: 2,
    laneSpacing: 65,
    height: 12,
    hollow: true,
    deck: 2,
    wall: 2,
    ...RIB_DEFAULTS,
    slotWidth: 3,
    slotDepth: 7,
    braidWidth: 5,
    braidDepth: 0.5,
    braidGap: 0,
    braidFeedSide: 'none',
    braidFeedLane: 0,
    braidFeedStations: [0.15],
    braidFeedLength: 3,
    segments: 1,
    borderSide: 'none',
    borderSegments: 1,
    borderEntry: 22,
    borderApex: 35,
    borderExit: 22,
    kerbEdge: 'none',
    roadKerbSide: 'none',
    kerbSide: 'both',
    kerbWidth: 5,
    kerbLength: 12,
    whiteLineRoad: 'none',
    roadCentreLine: 'none',
    whiteLineBorder: 'none',
    ...lineDimensions,
    whiteLineGroove: false,
    kerbGroove: false,
    apexPosition: 0.5,
    joint: 'none',
    borderMount: 'none',
    borderJoint: 'none',
    connectorOffset: 0,
    clipType: 'draw-key',
    ...JOINT_FIT_DEFAULTS,
  };
}

export function trackParameters(params = defaultTrack()) {
  params = currentJointSettings(params);
  const { version, tabClearance, clipClearance } = resolveJointFit(params);
  return {
    ...defaultTrack(),
    ...params,
    jointFitVersion: version,
    tabClearance,
    clipClearance,
  };
}

export function validateTrack(p) {
  validatePlacements(p.placements, p.mutedPlacements);
  validateConnectorCounts(p.connectorCounts);
  if (p.connectorCounts) {
    for (const scope of ['start', 'finish', 'seam']) countedJoint(p, scope);
    for (const side of ['inner', 'outer']) {
      if (p.borderSide !== side && p.borderSide !== 'both') continue;
      for (const scope of ['side', 'end']) countedJoint(p, scope, side);
    }
  }
  const range = (key, min, max, integer = false) => {
    if (
      !Number.isFinite(p[key]) ||
      p[key] < min ||
      p[key] > max ||
      (integer && !Number.isInteger(p[key]))
    )
      throw new Error(
        `${key} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`,
      );
  };
  if (!['curve', 'straight', 'import'].includes(p.kind))
    throw new Error('Unknown track shape.');
  validateSpecialType(p);
  for (const key of [
    'joint',
    'borderMount',
    'borderJoint',
    'jointStart',
    'jointEnd',
  ]) {
    if (p[key] !== undefined && !CONNECTOR_MODES.includes(p[key]))
      throw new Error('Unknown connector type.');
  }
  if (!['none', 'inner', 'outer', 'both'].includes(p.borderSide))
    throw new Error('Unknown border side.');
  if (!['none', 'road', 'free', 'both'].includes(p.kerbEdge))
    throw new Error('Choose a valid edge for the kerbstone markings.');
  if (!['inner', 'outer', 'both'].includes(p.kerbSide))
    throw new Error('Choose a valid border for the kerbstone markings.');
  range('kerbWidth', 0.1, 2000);
  range('kerbLength', 0.1, 20000);
  validatePaint(p);
  if (typeof p.reinforcement !== 'boolean')
    throw new Error('Choose whether to reinforce the underside.');
  for (const [key, bounds] of Object.entries(TRACK_PROFILE_LIMITS))
    range(key, ...bounds);
  range('width', 2, 5000);
  range('lanes', 1, 8, true);
  range('braidFeedLane', 0, 256, true);
  range('braidFeedLength', 0.3, 50);
  if (!['none', 'left', 'right', 'both'].includes(p.braidFeedSide))
    throw new Error('Choose a valid braid pass-through side.');
  if (
    !Array.isArray(p.braidFeedStations) ||
    !p.braidFeedStations.length ||
    p.braidFeedStations.length > 8 ||
    p.braidFeedStations.some((n) => !Number.isFinite(n) || n <= 0 || n >= 1)
  )
    throw new Error(
      'Choose one to eight braid pass-through stations strictly between 0 and 100%.',
    );
  if (
    p.braidFeedSide !== 'none' &&
    (p.braidWidth <= 0 || (p.kind !== 'import' && p.braidFeedLane > p.lanes))
  )
    throw new Error(
      'Choose an existing lane and a positive braid width for pass-throughs.',
    );
  range('laneSpacing', 0.1, 1000);
  range('segments', 1, 32, true);
  range('borderSegments', 1, 32, true);
  validateBorderEnds(p.borderEnds);
  if (p.bridgeSupportCount !== undefined)
    range('bridgeSupportCount', 0, 32, true);
  if (p.bridgeClearance !== undefined) range('bridgeClearance', 1, 500);
  if (
    p.bridgeApproaches !== undefined &&
    typeof p.bridgeApproaches !== 'boolean'
  )
    throw Error('Choose whether to include approach blocks.');
  range('radius', 1, 20000);
  if (p.curveGridRadius != null) range('curveGridRadius', 1, 25000);
  range('angle', 0.1, 359);
  // Near a full circle the finish connector reaches the piece's own start
  // end; without this the build fails with a misleading pocket message.
  if (
    p.kind === 'curve' &&
    p.angle > 355 &&
    !p.special &&
    (activeJointMode(p, 'start') !== 'none' || activeJointMode(p, 'finish') !== 'none')
  )
    throw new Error(
      'A corner with end connectors can turn at most 355°: beyond that the finish connector runs into the start end. Reduce Sweep angle or remove the end connectors.',
    );
  range('length', 1, 20000);
  if (p.special?.type === 'timing') validateTiming(p);
  if (['diamond','pit'].includes(p.special?.type)) validateSpecialJunction(p);
  if (isRacingPiece(p)) validateRacingPiece(p);
  const clipRange =
    p.jointFitVersion === 1 ? [0.03, 0.8] : JOINT_FIT_LIMITS.clip;
  range('clipClearance', ...clipRange);
  if (p.jointFitVersion === 2) range('tabClearance', ...JOINT_FIT_LIMITS.tab);
  range('connectorOffset', 0, 2500);
  range('apexPosition', 0.01, 0.99);
  for (const side of ['inner', 'outer']) {
    const position = side + 'ApexPosition';
    const width = side + 'ApexWidth';
    if (p[position] !== undefined) range(position, 0.01, 0.99);
    if (p[width] !== undefined) range(width, 0, 2000);
  }
  for (const key of ['borderEntry', 'borderApex', 'borderExit'])
    range(key, 0, 2000);
  if (p.hollow && (p.deck >= p.height || p.wall >= p.width / 2))
    throw new Error('The deck and walls leave no space for a hollow body.');
  if (p.slotDepth >= p.height || (p.hollow && p.slotDepth + p.wall > p.height))
    throw new Error(
      'Slot depth leaves insufficient material below the guide slot.',
    );
  if (
    p.braidDepth >= (p.hollow ? p.deck : p.height) ||
    p.braidDepth > p.slotDepth
  )
    throw new Error(
      'The braid recess must stay within the deck and above the slot floor.',
    );
  validateSlotPosition(p);
  if (p.kind !== 'import') {
    validateLaneAdjustment(p);
    const laneEnvelope = p.slotWidth + 2 * braidSpan(p);
    // An off-centre slot reaches further towards one edge than its spacing
    // tells. Lanes set one by one keep their own gaps (validateSlotPosition).
    const laneReach = hasSlotPosition(p)
      ? 2 * Math.max(...[0, 1].flatMap((t) =>
          [0, p.lanes - 1].map((i) => Math.abs(laneOffsetAt(p, i, t)))))
      : (p.lanes - 1) * p.laneSpacing;
    if (
      laneReach + laneEnvelope >= p.width ||
      (p.lanes > 1 && slotForm(p) !== 'each' && laneEnvelope >= p.laneSpacing)
    )
      throw new Error(
        'The guide slots and braid recesses do not fit across this road.',
      );
    if (p.kind === 'curve') {
      const inside = ['both', 'inner'].includes(p.borderSide)
        ? maxBorderWidth(p, 'inner')
        : 0;
      if (p.radius <= p.width / 2 + inside)
        throw new Error(
          'The road or inner border crosses the centre of the bend.',
        );
    }
  }
  for (const side of ['inner', 'outer']) {
    if (
      (p.borderSide === 'both' || p.borderSide === side) &&
      maxBorderWidth(p, side) <= 0
    )
      throw new Error(
        'Give the ' +
          (side === 'outer' ? 'outside' : 'inside') +
          ' border a positive width.',
      );
  }
  const connectorModes = ['start', 'finish'].map((scope) =>
    activeJointMode(p, scope),
  );
  if (p.segments > 1) connectorModes.push(activeJointMode(p, 'seam'));
  for (const side of ['inner', 'outer'])
    if (p.borderSide === 'both' || p.borderSide === side)
      connectorModes.push(
        activeJointMode(p, 'side', side),
        activeJointMode(p, 'end', side),
      );
  if (p.jointFitVersion === 2) {
    validateTabSize(
      p,
      p.tabThickness != null ||
        connectorModes.some((j) => j === 'tabs' || j === 'both'),
    );
  }
  const clip = clipSpec(p);
  const modernClips =
    p.jointFitVersion === 2 &&
    connectorModes.some((mode) => mode === 'clips' || mode === 'both');
  const minimumHeight = modernClips
    ? (clip?.minimumHeight ?? JOINT_FIT_MIN_HEIGHT)
    : 5;
  if (
    p.height < minimumHeight &&
    connectorModes.some((mode) => mode && mode !== 'none')
  )
    throw connectorWarning(
      'Track profile',
      'Track height is ' +
        formatMm(p.height) +
        '. ' +
        (modernClips
          ? 'The ' + (clip?.clipName ?? 'compact draw-in clip')
          : 'This connector') +
        ' needs at least ' +
        formatMm(minimumHeight) +
        ' of height.',
      'Set Cross-section → Track height to ' +
        formatMm(minimumHeight) +
        ' or more.',
      { tab: 'profile', field: 'height', label: 'Edit track height' },
    );
  if (p.startingGrid !== undefined) return startingGridLayout(p);
  if (p.special?.pitGrid !== undefined) return pitGridLayout(p);
}

function analyticTrackPoint(p, t, v) {
  if (p.kind === 'straight') {
    const along = p.special?.type === 'timing' ? timingFraction(p,t) : t;
    return [(along - 0.5) * p.length, v];
  }
  const angle = ((p.angle * Math.PI) / 180) * (t - 0.5);
  return [
    (p.radius + v) * Math.sin(angle),
    (p.radius + v) * Math.cos(angle) - p.radius,
  ];
}

function curveSteps(p) {
  const maxRadius =
    p.radius +
    p.width / 2 +
    (p.borderSide !== 'none'
      ? Math.max(p.borderEntry, p.borderApex, p.borderExit)
      : 0);
  const r = Math.max(maxRadius, p.curveGridRadius ?? 0);
  return Math.ceil((p.angle * Math.PI) / 180 / (2 * Math.acos(1 - 0.025 / r)));
}

// Concentric printed pieces need the same chords at their shared radius.
// Extra segmentation and border stations subdivide those chords. Projecting
// such a station back onto the circle would create a lip at its neighbour.
function gridPoint(p, t, v, steps) {
  const station = t * steps;
  const i = Math.floor(station);
  const fraction = station - i;
  const a = analyticTrackPoint(p, i / steps, v);
  if (!fraction || i === steps) return a;
  const b = analyticTrackPoint(p, (i + 1) / steps, v);
  return [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])];
}

export function nativeTrackPoint(p, t, v) {
  if (isRacingPiece(p)) return racingTrackPoint(p, t, v);
  return p.kind === 'curve' && p.curveGridRadius
    ? gridPoint(p, t, v, curveSteps(p))
    : analyticTrackPoint(p, t, v);
}

export function nativePath(p, couponStation) {
  if (isRacingPiece(p)) return racingPath(p);
  const radians = (p.angle * Math.PI) / 180;
  const theta = (t) => radians * (t - 0.5);
  const arcSteps = p.kind === 'straight' ? 1 : curveSteps(p);
  const point =
    p.kind === 'curve' && p.curveGridRadius
      ? (t, v) => gridPoint(p, t, v, arcSteps)
      : (t, v) => analyticTrackPoint(p, t, v);
  const tangent = (t) =>
    p.kind === 'straight' ? [1, 0] : [Math.cos(theta(t)), -Math.sin(theta(t))];
  // Keep radial chord sag below 0.025 mm. All mating edges use the same stations.
  const steps = p.borderSide !== 'none' ? Math.max(32, arcSteps) : arcSteps;
  const stations = new Set([p.apexPosition]);
  for (const count of [steps, p.segments, p.borderSegments])
    for (let i = 0; i <= count; ++i) stations.add(i / count);
  if (p.curveGridRadius && steps !== arcSteps)
    for (let i = 0; i <= arcSteps; i++) stations.add(i / arcSteps);
  const path = {
    point,
    tangent,
    stations: [...stations].sort((a, b) => a - b),
    pointOnCircle:
      p.kind === 'curve'
        ? (t, offset) => analyticTrackPoint(p, t, offset)
        : undefined,
  };
  // Every consumer reads the lanes from here, so an off-centre slot needs no
  // second formula anywhere else.
  path.laneOffsets = (t) =>
    Array.from({ length: p.lanes }, (_, i) => laneOffsetAt(p, i, t));
  if (lanesVary(p)) {
    // A slot position beside a squeeze is refused in its own words.
    validateSlotPosition(p);
    validateLaneAdjustment(p);
    addAdjustedLanePaths(p, path, arcSteps, couponStation);
  }
  return path;
}

function addAdjustedLanePaths(p, path, arcSteps, couponStation) {
  // Sample the lane curves independently of the mating road outline. Keep
  // the same stations on every lane so segmentation cannot restart a squeeze.
  const steps = Math.max(2 * arcSteps, laneProfileSteps(p));
  const stations = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  const indices = Array.from({ length: p.lanes }, (_, i) => i);
  const angle = p.kind === 'curve' ? (p.angle * Math.PI) / 180 : 0;
  const halfWidth =
    p.slotWidth / 2 +
    Math.max(braidSpan(p), p.hollow ? p.wall : 0);
  // An offset edge folds back when the lane radius is less than its width.
  // Evaluate the curvature before the Boolean kernel can discard a folded loop.
  for (const i of couponStation ? [] : indices) {
    for (const t of stations) {
      const [lateralSpeed, lateralAcceleration] = laneOffsetDerivatives(p, i, t);
      const advance = angle
        ? (p.radius + laneOffsetAt(p, i, t)) * angle
        : p.length;
      const curvature =
        (advance * (lateralAcceleration - advance * angle) -
          2 * lateralSpeed ** 2 * angle) / Math.hypot(advance, lateralSpeed) ** 3;
      if (Math.abs(curvature) * halfWidth >= 0.99)
        throw Error(
          'The guide slot or braid recess folds in the transition. Use a longer piece or a gentler spacing change.',
        );
    }
  }
  const offsetAt = (i, t) => laneOffsetAt(p, i, couponStation ? couponStation(t) : t);
  path.laneOffsets = (t) => indices.map((i) => offsetAt(i, t));
  path.laneCurves = indices.map((i) =>
    stations.map((t) => analyticTrackPoint(p, t, offsetAt(i, t))),
  );
  path.laneNormals = path.laneCurves.map((lane) => {
    const normals = vertexNormals(lane);
    if (!couponStation) {
      normals[0] = left(path.tangent(0));
      normals[normals.length - 1] = left(path.tangent(1));
    }
    return normals;
  });
  path.measuredLanes = path.laneCurves.map((lane, i) =>
    measuredLane(lane, path.laneNormals[i]),
  );
}

function nearestLane(p, offset) {
  let nearest = 0;
  for (let i = 1; i < p.lanes; i++)
    if (Math.abs(laneOffsetAt(p, i, 0) - offset) < Math.abs(laneOffsetAt(p, nearest, 0) - offset))
      nearest = i;
  return nearest;
}

// offset is where lane `index` leaves end A, as path.laneOffsets(0)[index]
// gives it. Without an index the lane is the one that leaves end A nearest
// the offset.
export function nativeBraidLane(p, path, offset, index) {
  if ((lanesVary(p) || isRacingPiece(p)) && path.measuredLanes) {
    index ??= hasSlotPosition(p)
      ? nearestLane(p, offset)
      : Math.round(offset / p.laneSpacing + (p.lanes - 1) / 2);
    return path.measuredLanes[Math.max(0, Math.min(p.lanes - 1, index))];
  }
  return {
    atOffset: (t, across) =>
      interpolateStation(path.stations, t, (i) =>
        path.point(path.stations[i], offset + across),
      ),
    ts: path.stations,
    total:
      p.kind === 'straight'
        ? p.length
        : ((p.radius + offset) * p.angle * Math.PI) / 180,
  };
}

function nativePieces(
  work,
  p,
  path = nativePath(p),
  importedLanes,
  { deferRoadJoints = false, borderAt = borderWidth, plainBorderEnds } = {},
) {
  const pieces = [],
    roads = [],
    loose = [];
  // Where the lanes leave end A. A slot that keeps its distance from the edge
  // is cut as a plain band below; one that moves arrives as path.laneCurves.
  const lanes = Array.from({ length: p.lanes }, (_, i) => laneOffsetAt(p, i, 0));
  let laneSleeves;
  if (path.laneCurves)
    importedLanes = laneTools(work, p, { lanes: path.laneCurves, path, p });
  if (path.sites) insulatedHairpinShelves(work, p, path, importedLanes);
  if (importedLanes && (lanesVary(p) || path.laneCurves)) {
    const channels = importedLanes.map(([slot, , , envelope]) => envelope ?? slot);
    for (let i = 1; i < channels.length; i++) {
      if (!path.sites && work.own(channels[i - 1].intersect(channels[i])).area() > 0.00001)
        throw Error(
          'Adjacent lane channels overlap in the transition. Lengthen the piece or reduce the lane adjustment.',
        );
    }
    laneSleeves = work.own(
      work.wasm.CrossSection.union(importedLanes.map(([, sleeve]) => sleeve)),
    );
  }
  function band(a, b, lo, hi, overrun = 0, samplePath = path) {
    const stations = samplePath.stations.filter((t) => t >= a && t <= b);
    const boundary = (v) => {
      const points = stations.map((t) =>
        samplePath.point(t, typeof v === 'function' ? v(t) : v),
      );
      if (overrun) {
        points.unshift(move(points[0], path.tangent(a), -overrun));
        points.push(move(points.at(-1), path.tangent(b), overrun));
      }
      return points;
    };
    return work.section([[...boundary(lo), ...boundary(hi).reverse()]]);
  }
  for (let i = 0; i < p.segments; ++i) {
    const a = i / p.segments,
      b = (i + 1) / p.segments;
    const road = makePart(
      'road-' + (i + 1),
      'Road ' + (i + 1),
      'road',
      band(a, b, -p.width / 2, p.width / 2),
    );
    shell(work, road, p);
    if (work.planning) road.plannerStrip = plannerStrip(path, p, a, b);
    registerRibRun(p, road, path, a, b, () => [-p.width / 2, p.width / 2]);
    if (laneSleeves) road.adjustedLaneSleeves = laneSleeves;
    const keepout = [];
    const makeSlot = (guide, sleeve, braidShelf, envelope) => {
      addSlot(work, road, p, guide, sleeve, splitTimingShelf(work,p,braidShelf));
      if (p.whiteLineRoad !== 'none' || p.roadKerbSide !== 'none' || p.roadCentreLine !== 'none')
        keepout.push(envelope ?? braidShelf ?? guide);
    };
    for (const args of importedLanes ?? []) makeSlot(...args);
    for (const lane of importedLanes ? [] : lanes) {
      const half = p.slotWidth / 2,
        outer = half + braidSpan(p);
      // Separately rounded polygons can leave a film where a cutter ends
      // on the seam plane. Keep the drawn profile all the way to the seam,
      // then carry only the two cutting tools through it. Near a full circle
      // the extension must fit in the gap before the other end of this road.
      const turn = p.kind === 'curve' ? (b - a) * p.angle : 0;
      const overrun =
        turn > 180
          ? Math.min(
              0.05,
              ((p.radius + lane - outer) *
                Math.tan(((360 - turn) * Math.PI) / 360)) /
                2,
            )
          : 0.05;
      makeSlot(
        band(a, b, lane - half, lane + half, overrun),
        band(a, b, lane - half - p.wall, lane + half + p.wall),
        ...braidSections(work, p, (lo, hi) => band(a, b, lane + lo, lane + hi, overrun)),
      );
    }
    if (keepout.length)
      road.laneKeepout = work.own(work.wasm.CrossSection.union(keepout));
    roads.push(road);
    pieces.push(road);
  }
  if (p.braidFeedSide !== 'none') {
    const measuredLanes =
      path.measuredLanes ??
      lanes.map((offset, i) => nativeBraidLane(p, path, offset, i));
    attachBraidFeeds(work, p, roads, measuredLanes);
  }
  if (path.sites) hairpinFeeds(work, p, path, roads);
  // The expanded shoulder is part of the pit deck, while the racing road
  // keeps its original centre. Diamonds lay out their two complete axes
  // together, after all four arms and the centre panel have been generated.
  if (p.roadCentreLine !== 'none' && p.special?.type !== 'diamond') {
    const centre = p.special?.type === 'pit'
      ? { ...path, point: t => [path.point(t, 0)[0], 0] }
      : path;
    const paint = centreLinePaint(work, p, centre, path.centreLinePhase);
    for (const road of roads) road.centreLinePaint = paint;
  }
  if (!deferRoadJoints) addRoadJoints(work, p, path, lanes, roads, loose);
  for (const [side, sign] of [
    ['outer', 1],
    ['inner', -1],
  ]) {
    const line = whiteLineLayout(p, side);
    const roadKerbs = p.roadKerbSide === side || p.roadKerbSide === 'both';
    const active = p.borderSide === side || p.borderSide === 'both';
    const profile = active
      ? borderEndProfile(borderPath(path, p, side), p, side, borderAt)
      : null;
    const sidePath = profile?.path ?? path;
    const finishedWidth = (_, t) => profile.widthAt(t);
    const stations = line.borderWidth || ((line.roadWidth || roadKerbs) && sidePath === path)
      ? markingStations(p, sidePath, side) : null;
    const sharedFinish = sidePath.borderStock && line.roadWidth && line.borderWidth;
    const roadMarkPath = sharedFinish ? {
      ...sidePath, stations: [...new Set([...path.stations, ...sidePath.stations])].sort((a, b) => a - b),
    } : path;
    const roadLayout = sharedFinish ? { ...line, sharedBorderWidth: profile.widthAt } : line;
    const roadStations = (line.roadWidth || roadKerbs) && sidePath !== path
      ? markingStations(p, roadMarkPath, side) : stations;
    layOutWhiteLines(
      work,
      p,
      roadMarkPath,
      side,
      roads,
      roadLayout,
      true,
      borderAt,
      roadStations,
    );
    if (roadKerbs) layOutRoadKerbs(work, p, side, roads, roadLayout, roadStations);
    if (!active) continue;
    const borders = [],
      edge = (sign * p.width) / 2,
      free = (t) => edge + sign * profile.widthAt(t);
    for (let i = 0; i < p.borderSegments; ++i) {
      const a = borderSeam(sidePath, p, i),
        b = borderSeam(sidePath, p, i + 1);
      const section =
        sign > 0
          ? band(a, b, edge, free, 0, sidePath)
          : band(a, b, free, edge, 0, sidePath);
      const part = makePart(
        'border-' + side + '-' + (i + 1),
        (side === 'outer' ? 'Outer' : 'Inner') + ' border ' + (i + 1),
        'border',
        section,
      );
      shell(work, part, p);
      registerRibRun(p, part, sidePath, a, b, t => [edge, free(t)]);
      pieces.push(part);
      borders.push(part);
      addSideMounts(
        work,
        p,
        sidePath,
        side,
        sign,
        roads,
        part,
        i,
        loose,
        finishedWidth,
      );
    }
    const skipped = new Set(plainBorderEnds);
    if (sidePath.borderTipStart) skipped.add(0);
    if (sidePath.borderTipFinish) skipped.add(borders.length);
    addBorderEndJoints(
      work,
      p,
      sidePath,
      side,
      sign,
      borders,
      loose,
      finishedWidth,
      skipped,
    );
    layOutWhiteLines(
      work,
      p,
      sidePath,
      side,
      borders,
      line,
      false,
      finishedWidth,
      stations,
    );
    layOutKerbstones(
      work,
      p,
      sidePath,
      side,
      borders,
      finishedWidth,
      line.borderWidth + line.borderGroove,
      stations,
    );
  }
  return { pieces, loose };
}

/** Caller owns each returned solid. All other WASM handles are released here. */
export function buildTrack(wasm, params, plan, couponStation, samplePath, {planning = false, mirrorPockets = false} = {}) {
  const p = trackParameters(params);
  const grid = validateTrack(p);
  const work = new SolidWorkshop(wasm);
  work.planning = planning;
  work.mirrorPockets = mirrorPockets;
  try {
    let assembly;
    if (['diamond','pit'].includes(p.special?.type))
      assembly = buildSpecialJunction(work,p,nativePieces,borderWidth);
    else if (p.kind === 'import') assembly = buildImported(work,p,plan,nativePieces,borderWidth);
    else assembly = nativePieces(work,p,samplePath ?? nativePath(p,couponStation));
    const { pieces, loose, bridges } = assembly;
    if (grid) {
      const pit = p.special?.type === 'pit';
      const roads = pieces.filter(part => part.role === 'road');
      const paint = work.section(grid.paint);
      let groove = grid.grooves.length ? work.section(grid.grooves) : null;
      let pitGridGrooveGuide;
      if (pit && groove) {
        const guards = [...new Set(roads.flatMap(road => road.drawKeyGuards ?? []))];
        if (guards.length) {
          groove = grooveClearOfDovetails(work, guards, groove);
          pitGridGrooveGuide = groove.toPolygons();
        }
      }
      const footprint = groove ? work.own(paint.add(groove)) : paint;
      for (const road of roads) {
        // A shared edge stripe widens onto the road as a detachable border
        // tapers away. Use its actual local footprint for this final fit check.
        if (pit || p.borderEnds || p.roadKerbSide !== 'none') {
          const existing = [...(road.paintSections ?? []).map(ink => ink.section), ...(road.grooveSections ?? [])];
          const local = work.own(footprint.intersect(road.section));
          if (existing.some(section => work.own(local.intersect(section)).area() > 1e-6)) {
            if (pit) throw connectorWarning('Pit grid marker', 'The mark overlaps a pit divider or road edge marking.',
              'Reduce Mark width or move the marker along the bay.',
              { tab: 'geometry', field: 'spPitGridWidth', label: 'Edit mark width' });
            throw connectorWarning('Starting grid', p.roadKerbSide === 'none'
              ? 'A mark overlaps the road white line at the border end.' : 'A mark overlaps a road edge marking.',
              'Reduce Mark width or narrow the edge markings.', { tab: 'geometry', field: 'gridWidth', label: 'Edit mark width' });
          }
        }
        road.paintSections = [...(road.paintSections ?? []), { color: WHITE_LINE_COLOR, section: paint }];
        if (groove) road.grooveSections = [...(road.grooveSections ?? []), groove];
        if (pitGridGrooveGuide) road.pitGridGrooveGuide = pitGridGrooveGuide;
      }
    }
    if (p.special?.type === 'timing') addTimingHardware(work,p,pieces);
    for (const part of pieces) {
      applyRoadCentreLine(work, p, part);
      addReinforcement(work, p, part);
    }
    const results = pieces
      .map(
        ({
          id,
          name,
          role,
          additions,
          cuts,
          jointGuides,
          pitGrooveGuide,
          pitGridGrooveGuide,
          crossingSection,
          bridgePhase,
        }) => ({
          id,
          name,
          role,
          jointGuides,
          pitGrooveGuide,
          pitGridGrooveGuide,
          crossingSection,
          bridgePhase,
          solid: work.cut(work.union(additions), cuts),
        }),
      )
      .concat(loose);
    pieces.forEach((part, i) => finishMarkings(work, part, results[i], p));
    if (planning) pieces.forEach((part, i) => {
      results[i].plannerStrip = part.plannerStrip;
      results[i].outline = part.section.toPolygons();
    });
    if (bridges) finishBridges(work, bridges, results, p);
    for (const result of results) {
      if (
        result.solid.status() !== 'NoError' ||
        result.solid.isEmpty() ||
        result.solid.volume() <= 0
      )
        throw new Error(
          'The geometry for ' +
            result.name +
            ' could not form a printable solid.',
        );
      result.footprintXY ??= solidFootprint(result.solid);
    }
    for (const result of results) work.handles.delete(result.solid);
    return results;
  } finally {
    work.close();
  }
}

export function jointSampleChoices(p) {
  const choices = [
    ['seam', 'Road seam'],
    ['start', 'Start end'],
    ['finish', 'Finish end'],
  ].map(([scope, label]) => [scope, activeJointMode(p, scope), label]);
  for (const [key, scope, label] of [
    ['side', 'side', 'to road'],
    ['border', 'end', 'end joint'],
  ])
    for (const side of ['outer', 'inner']) {
      if (p.borderSide !== side && p.borderSide !== 'both') continue;
      const name =
        (side === 'inner' ? 'Inside border ' : 'Outside border ') + label;
      choices.push([
        p.borderSide === 'both' ? key + '-' + side : key,
        activeJointMode(p, scope, side),
        name,
      ]);
    }
  return choices.filter(([, mode]) => mode !== 'none');
}

/** Sample the actual joint profile in a short pair of mating ends. Exterior
 * ends on a road coupon remain plain so only the centre joint is being tested.
 */
export function buildTestJoint(wasm, params, which = 'auto') {
  const p = trackParameters(params);
  if (!['straight', 'curve'].includes(p.kind))
    throw new Error('Choose a generated straight or bend for a joint sample.');
  validateTrack(p);
  const choices = jointSampleChoices(p);
  const choice =
    which === 'auto'
      ? choices[0]
      : choices.find(([key]) => key === which || key.startsWith(which + '-'));
  if (!choice)
    throw new Error(
      'Choose tabs or clips on a road or border before exporting a test joint.',
    );
  const [selected, side] = choice[0].split('-'),
    mode = choice[1];
  const road = ['seam', 'start', 'finish'].includes(selected),
    source = p.placements ?? {};
  const coupon = {
    ...p,
    roadCentreLine: 'none',
    roadKerbSide: 'none',
    reinforcement: false,
    special: undefined,
    startingGrid: undefined,
    borderEnds: undefined,
    placements: { ...source },
    connectorCounts: { ...p.connectorCounts },
    joint: road ? mode : 'none',
    jointStart: 'none',
    jointEnd: 'none',
    borderSide: road ? 'none' : (side ?? p.borderSide),
    segments: road ? 2 : 1,
    borderSegments: selected === 'border' ? 2 : 1,
    borderMount: selected === 'side' ? p.borderMount : 'none',
    borderJoint: selected === 'border' ? p.borderJoint : 'none',
    braidFeedSide: 'none',
  };
  if (road)
    for (const type of ['Tabs', 'Clips']) {
      if (source[selected + type])
        coupon.placements['seam' + type] = source[selected + type];
      else delete coupon.placements['seam' + type];
      const count = configuredCount(p, selected, type === 'Tabs' ? 'tab' : 'clip');
      if (count !== undefined) coupon.connectorCounts['seam' + type] = count;
      else delete coupon.connectorCounts['seam' + type];
    }
  // A sample is far too short to carry a sideways move of the slot. Give it
  // the slot of its own joint, where the two mating ends agree. A piece in
  // one segment has no seam of its own: its joint sample shows end A.
  let matingEnds = false;
  if (hasSlotPosition(p)) {
    const internal = selected === 'seam' && p.segments > 1;
    const station = selected === 'finish' ? 1
      : internal ? Math.floor(p.segments / 2) / p.segments
      : road ? 0 : 0.5;
    // Every slot keeps the place it has at that station, all along the sample.
    const at = slotDistances(p, station);
    coupon.slotPosition = slotForm(p) === 'each'
      ? { version: 1, edge: p.slotPosition.edge, lanes: at.map((mm) => ({ startMm: mm, endMm: mm })) }
      : { ...p.slotPosition, startMm: at[0], endMm: at[0] };
    // The seam of this sample stands for two mating ends, so its connectors
    // take the row of a real end: slot-end-row.js.
    matingEnds = road && !internal;
  }
  const length = jointSampleLength(coupon, selected, mode);
  const racingSample = road && isRacingPiece(p)
    ? racingJointSamplePath(racingPath(p), p, selected, length)
    : undefined;
  coupon.length = length;
  if (p.kind === 'curve') {
    // For an inside border the shortest usable arc is its free edge, not
    // the edge of the road. Its two long fork pockets still need web between.
    const inset =
      selected === 'border' && coupon.borderSide === 'inner'
        ? maxBorderWidth(p, 'inner')
        : 0;
    const inner = p.radius - p.width / 2 - inset;
    coupon.angle = Math.min(180, ((length / inner) * 180) / Math.PI);
    if ((inner * coupon.angle * Math.PI) / 180 < 36)
      throw new Error(
        'The inner radius leaves too little length for a compact joint sample.',
      );
  }
  // Shortening a sample compresses its taper. A pocket that clears the full
  // border can then run through the free edge before reaching its full depth.
  // Keep the selected stations and use more length only when that happens.
  const dimension = p.kind === 'curve' ? 'angle' : 'length';
  const limit = dimension === 'angle' ? Math.min(p.angle, 180) : p.length;
  // A fit sample crops the original adjustment around its selected joint.
  // At an external mating joint it contains the tail and head of two pieces.
  function couponStation(t) {
    const delta = (t - 0.5) * coupon[dimension] / p[dimension];
    const middle = selected === 'seam' && p.segments > 1
      ? Math.floor(p.segments / 2) / p.segments : 0.5;
    const origin = selected === 'start' || selected === 'finish'
      ? (t < 0.5 ? 1 : 0) : middle;
    return Math.max(0, Math.min(1, origin + delta));
  }
  let parts;
  while (!parts) {
    try {
      const samplePath = matingEnds
        ? Object.assign(nativePath(coupon), { matingSeams: true })
        : racingSample;
      parts = buildTrack(wasm, coupon, undefined, p.laneAdjustment ? couponStation : undefined, samplePath);
    } catch (e) {
      if (
        selected !== 'border' ||
        e.code !== 'BORDER_END_OUTLINE' ||
        coupon[dimension] >= limit
      )
        throw e;
      coupon[dimension] = Math.min(limit, 2 * coupon[dimension]);
    }
  }
  if (selected !== 'border') return parts;
  return parts.filter((part) => {
    const keep =
      part.role === 'border' ||
      part.id === 'end-clip-' + coupon.borderSide + '-1' ||
      part.id.startsWith('end-clip-' + coupon.borderSide + '-1-');
    if (!keep) part.solid.delete();
    return keep;
  });
}

// Reject counts with a road shoulder or border edge that already exceeds the
// plate. Sample in the print plane: an inclined straight is longer when laid
// flat. A candidate passing these inexpensive checks still needs a complete
// build to include connector protrusions, outlines and physical grooves.
function crossingFitCandidates(wasm, p, layout, plate, role) {
  const work = new SolidWorkshop(wasm);
  try {
    const { phases } = prepareBridges(work, layout, p);
    const previews = phases.map(({ geometry, pose }) => {
      const { path, p: actual } = importedTrackPaths(p, geometry, true);
      const sides =
        role === 'road' || p.borderSide === 'both'
          ? [-1, 1]
          : [p.borderSide === 'outer' ? 1 : -1];
      const along = (point) => {
        if (!pose?.slope) return point;
        const [x, y] = point,
          [dx, dy] = pose.direction;
        return [(x * dx + y * dy) * Math.hypot(1, pose.slope), y * dx - x * dy];
      };
      return {
        sides,
        point: (t, sign) => along(path.point(t, (sign * actual.width) / 2)),
      };
    });
    return (count) =>
      previews.every(({ sides, point }) => {
        for (let i = 0; i < count; i++) {
          const ts = [i / count, (i + 0.5) / count, (i + 1) / count];
          const edges = sides.map((side) => ts.map((t) => point(t, side)));
          // The two borders are different printable parts; the two shoulders
          // of a road belong to the same print.
          const silhouettes = role === 'road' ? [edges.flat()] : edges;
          if (
            silhouettes.some(
              (points) =>
                !fitPlate(points, plate.width, plate.depth, plate.margin).fits,
            )
          )
            return false;
        }
        return true;
      });
  } finally {
    work.close();
  }
}

function racingRoadFitCandidates(p, plate) {
  // These stations from the unsplit road belong to every candidate mesh. A
  // new segment adds its two end stations on the very same analytical path.
  const path = racingPath({ ...p, segments: 1 });
  const half = p.width / 2;
  const shoulders = t => [path.point(t, -half), path.point(t, half)];
  const samples = path.stations.map(t => ({ t, points: shoulders(t) }));
  const protectedStations = path.protectedStations ?? [];
  return count => {
    let first = 0;
    for (let i = 0; i < count; i++) {
      const start = i / count, finish = (i + 1) / count;
      if (i && protectedStations.some(([lo, hi]) => start >= lo && start <= hi))
        return false;
      const points = [...shoulders(start), ...shoulders(finish)];
      while (first < samples.length && samples[first].t < finish) {
        if (samples[first].t > start) points.push(...samples[first].points);
        first++;
      }
      // Permit rounding at float mesh precision during this inexpensive
      // prefilter. The finished connector-inclusive print must fit exactly.
      if (!fitPlate(points, plate.width + .0002, plate.depth + .0002, plate.margin ?? 0).fits)
        return false;
    }
    return true;
  };
}

/** Trial complete assemblies so that mating pockets, tabs and required wall
 * stock are included. Counts are checked in order, including both borders
 * when their segment setting is shared. Keep the interactive search bounded.
 */
export function chooseSegmentation(wasm, params, plan, plate, partId) {
  const role = /^road-\d+$/.test(partId)
    ? 'road'
    : /^border-(?:outer|inner)-\d+$/.test(partId)
      ? 'border'
      : null;
  if (!role)
    return {
      fits: false,
      reason: /^support-/.test(partId)
        ? 'Each bridge support prints as one block. Choose a larger usable plate or reduce the road width.'
        : 'Choose a generated road or border. Loose clips cannot be segmented.',
    };
  const p = trackParameters(params);
  const key = role === 'road' ? 'segments' : 'borderSegments';
  const current = p[key];
  const special = p.special?.type;
  const diagonal = Math.hypot(
    plate.width - 2 * (plate.margin ?? 0),
    plate.depth - 2 * (plate.margin ?? 0),
  );
  if (role === 'road' && p.kind !== 'import' && !(special === 'pit' && p.lanes > 1) && p.width > diagonal + 1e-6)
    return {
      fits: false,
      reason:
        'The road width exceeds the usable plate diagonal. Extra lengthwise segments cannot fix its width.',
    };
  let first = current;
  // A straight section longer than the plate diagonal cannot fit at any angle.
  // Each complete through-road still spans length on X, even when it
  // meanders, widens into a pit, or moves a seam away from a timing gate.
  // The diamond has four independently split arms around a shared core.
  if (p.kind === 'straight' && special !== 'diamond' &&
      (role === 'road' || !special && !p.borderEnds) && diagonal > 0)
    first = Math.max(first, Math.ceil(p.length / diagonal));
  if (p.kind === 'curve' && role === 'road' && (!special || special === 'hairpin') && diagonal > 0) {
    // Even the chord across the outer road edge has to fit the diagonal.
    // Allow for the maximum sag at each end on a subdivided print segment.
    const ratio = (diagonal + 0.05 + 1e-6) / (2 * p.radius + p.width);
    if (ratio < 1)
      first = Math.max(
        first,
        Math.ceil((p.angle * Math.PI) / 180 / (2 * Math.asin(ratio))),
      );
  }
  if (first > 32)
    return {
      fits: false,
      reason: 'This piece would require more than 32 segments on this plate.',
    };
  const crossing = p.kind === 'import' && plan?.flatCrossing;
  const racingRoad = role === 'road' && isRacingPiece(p);
  const limit = crossing || racingRoad ? 32 : Math.min(32, first + 7);
  let candidateFits;
  const diamondCore = special === 'diamond' && role === 'road' ? diamondLayout(p).coreLoop : null;
  const coreFits = !diamondCore || fitPlate(diamondCore, plate.width, plate.depth, plate.margin ?? 0).fits;
  if (racingRoad || crossing) {
    try {
      candidateFits = racingRoad ? racingRoadFitCandidates(p, plate) :
        crossingFitCandidates(wasm, p, crossing, plate, role);
    } catch (error) {
      return { fits: false, reason: error.message };
    }
  }
  let lastError;
  for (let count = first; count <= limit; count++) {
    if (count > 1 && !coreFits)
      return { fits: false, reason: 'The centre of the diamond must print as one block. Its footprint exceeds the usable plate. Increase plate size, reduce the road width or adjust the crossing angle.' };
    if (candidateFits && !candidateFits(count)) continue;
    let parts = [];
    try {
      // A physical groove can expose a socket as segmentation changes.
      // Retain all markings when checking printable candidate arrangements.
      const grooves = lineGrooves(p);
      const flat = !grooves.road && !grooves.border && !p.kerbGroove && !p.startingGrid?.recessed && !p.special?.pitGrid;
      parts = buildTrack(
        wasm,
        {
          ...p,
          [key]: count,
          ...(flat && {
            whiteLineRoad: 'none',
            roadCentreLine: 'none',
            roadKerbSide: 'none',
            whiteLineBorder: 'none',
            kerbEdge: 'none',
          }),
        },
        plan,
      );
      const family = parts.filter((part) => part.role === role);
      if (!family.length)
        return {
          fits: false,
          reason: 'The selected part is no longer present in this assembly.',
        };
      const trials = family.map((part) =>
        fitPlate(part.footprintXY, plate.width, plate.depth, plate.margin ?? 0),
      );
      if (trials.every((result) => result.fits))
        return { fits: true, key, count };
      lastError = '';
    } catch (error) {
      lastError = error.message;
    } finally {
      parts.forEach((part) => part.solid.delete());
    }
  }
  const suggestion =
    limit < 32
      ? ' Try a larger manual segment count or another plate.'
      : ' Change the profile or plate size.';
  return {
    fits: false,
    reason:
      `No fitting ${role} arrangement through ${limit} segments.` +
      (lastError ? ' ' + lastError : '') +
      suggestion,
  };
}
