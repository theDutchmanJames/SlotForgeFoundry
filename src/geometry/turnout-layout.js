// A single-lane turnout: one road in, a straight road out and a branch that
// leaves on a circular arc. Everything here is plain arithmetic, so the
// preview, the validation and the solid build all read the same layout.
//
// Frame: the main road runs along +X and is p.length long, with its entry at
// x = -length/2. The branch leaves the main slot tangentially turnoutLead mm
// after the entry and turns towards +Y (left) or -Y (right).
import { measuredLane } from './import-track.js';
import { connectorEnvelopes } from './connector-counts.js';
import { activeJointMode } from './placements.js';
import { pitActuatorSpec, pitTurnoutProfile, turnoutOutline } from './pit-turnout.js';
import { TURNOUT_DRIVE, turnoutDriveLayout, validateTurnoutDrive } from './turnout-drive.js';
import {
  PIT_CONTACT_DEFAULTS,
  makeRail,
  pitBraidLandingShift,
  slottedIsland,
  wireOpening,
  xStation,
} from './pit-braids.js';

export const TURNOUT_MODES = Object.freeze([
  ['digital', 'Digital'],
  ['manual', 'Hand-set point'],
  ['analog', 'Analog'],
  ['closed', 'Closed'],
]);
export const TURNOUT_MODE_HINTS = Object.freeze({
  digital: 'A moving blade, worked by a slider and a push-pull motor under the road between the two slots.',
  manual: 'The same moving blade, set by hand. It clicks into either position.',
  analog: 'No moving parts. Both slots stay open.',
  closed: 'The branch slot is filled in. Cars can only go straight on.',
});
export const turnoutModeName = (mode) =>
  TURNOUT_MODES.find(([id]) => id === mode)?.[1] ?? '';
// The two inserts that carry a moving blade.
export const turnoutHasBlade = (mode) => mode === 'digital' || mode === 'manual';

export const TURNOUT_LIMITS = Object.freeze({
  turnoutRadius: [60, 5000],
  turnoutAngle: [5, 80],
  turnoutLead: [15, 1000],
});
export const TURNOUT_DEFAULTS = Object.freeze({
  side: 'left',
  turnoutMode: 'digital',
  turnoutRadius: 300,
  turnoutAngle: 30,
  turnoutLead: 20,
  turnoutPosition: 'main',
  motorStroke: TURNOUT_DRIVE.stroke,
  turnoutPlay: TURNOUT_DRIVE.play,
  ...PIT_CONTACT_DEFAULTS,
});

// The swappable insert. All dimensions in millimetres.
export const TURNOUT_INSERT = Object.freeze({
  fit: 0.15, // clearance to the road pocket, all round
  margin: 2, // insert wall outside the guide sleeves and the blade pocket
  front: 2, // insert in front of the blade toe, before the margin
  roof: 0.8, // fixed road left under the braid recess, above the insert
  lugTop: 2.4, // thickness of the two screw lugs
  lugRadius: 3.4,
  lugReach: 4, // screw centre outside the insert outline
  pilotDepth: 6, // longest tapped pilot above a lug
  minPilot: 2.5, // shortest pilot that still holds an M2 thread
  screwLength: 6, // the M2 countersunk screw the notes ask for
  jointWeb: 1, // road kept between the pocket and a connector pocket
});
// pit-turnout.js sets the blade toe this far in front of the tangent point.
const TOE_LEAD = 2.5;

// How far the connectors of the entry end reach into the road.
function entryConnectorReach(p) {
  const mode = activeJointMode(p, 'start');
  if (mode === 'none') return 0;
  const envelopes = connectorEnvelopes(p);
  return Math.max(
    mode === 'clips' ? 0 : envelopes.tab.socket,
    mode === 'tabs' ? 0 : envelopes.clip.socket,
  ) + 1;
}

// The insert starts behind the entry connectors, so they sit where they do
// on every other piece of the pack and the pieces still join.
export function turnoutMinLead(p) {
  const { front, margin, jointWeb } = TURNOUT_INSERT;
  const reach = entryConnectorReach(p);
  return Math.max(
    TURNOUT_LIMITS.turnoutLead[0],
    reach ? reach + jointWeb + margin + front + TOE_LEAD : 0,
  );
}

// The two exits need this much road between them, and the main road runs on
// this far past the point where the branch has left it.
const EXIT_GAP = 2;
const EXIT_RUN = 5;

const TURNOUT_WORDS = Object.freeze({
  pivotRoom: 'The branch stays too close to the main slot to fit the blade pivot. Use a smaller Branch radius or a longer Main road length.',
  tailRoom: 'Increase Main road length to leave room behind the blade pivot for its guide wall and return.',
  tongueRoom: 'Use a larger Branch radius. The turnout blade is too short to steer the guide.',
  waist: 'Use a larger Branch radius to leave a printable turnout blade between its guide walls.',
  returnRoom: 'Increase Main road length to fit the return behind the turnout blade.',
  rise: 'Use a larger Branch radius or a shallower braid recess to leave a smooth rise to the road at the blade pivot.',
  crankReach: 'The crank under the blade reaches a guide slot. Use a smaller Branch radius or a shorter Usable stroke, or leave more track under the guide.',
});
export const TURNOUT_PARTS = Object.freeze({
  idPrefix: 'turnout-',
  blade: ' turnout blade',
  crank: ' turnout crank',
  bearing: ' turnout pivot bearing',
  pin: ' turnout pivot pin',
});
// cam: the crank of the slider drive, from the layout's drive.
export const turnoutFlipperOptions = (linkage, cam) => ({
  linkage,
  cam,
  parts: TURNOUT_PARTS,
  words: TURNOUT_WORDS,
});

export function turnoutSettings(special) {
  return Object.fromEntries(
    Object.entries(TURNOUT_DEFAULTS).map(([key, value]) => [
      key,
      special[key] === undefined ? value : special[key],
    ]),
  );
}

const degrees = (radians) => (radians * 180) / Math.PI;
const radians = (deg) => (deg * Math.PI) / 180;
const clampCos = (value) => Math.max(-1, Math.min(1, value));
// Where the far edge of the branch road crosses the near edge of the main road.
const crossingAngle = (width, radius) =>
  Math.acos(clampCos((radius - width / 2) / (radius + width / 2)));

/** The smallest branch angle, in degrees, that leaves the two exits apart. */
export function turnoutClearAngle(width, radius) {
  return degrees(
    Math.acos(clampCos((radius - width / 2 - EXIT_GAP) / (radius + width / 2))),
  );
}

/** The shortest main road that runs on past the point where the branch leaves it. */
export function turnoutMinLength(width, radius, lead) {
  return lead + (radius + width / 2) * Math.sin(crossingAngle(width, radius)) + EXIT_RUN;
}

const smallestRadius = (width) => Math.max(TURNOUT_LIMITS.turnoutRadius[0], width / 2 + 40);

// The branch takes the pack's first curve where it can: R1 on the pack's own
// curve angle, or as many of those curves as it takes to clear the main road.
export function turnoutDefaults(p, rules) {
  const [, maxAngle] = TURNOUT_LIMITS.turnoutAngle;
  const radius = Math.max(
    smallestRadius(p.width),
    Number.isFinite(rules?.r1InnerRadius) ? rules.r1InnerRadius + p.width / 2 : TURNOUT_DEFAULTS.turnoutRadius,
  );
  const step = Number.isFinite(rules?.angle) && rules.angle >= 1 ? rules.angle : TURNOUT_DEFAULTS.turnoutAngle;
  const need = turnoutClearAngle(p.width, radius);
  let angle = Math.min(step, maxAngle);
  while (angle < need && angle + step <= maxAngle) angle += step;
  if (angle < need) angle = Math.min(maxAngle, Math.ceil(need));
  let lead = TURNOUT_DEFAULTS.turnoutLead;
  try {
    lead = Math.max(lead, Math.ceil(turnoutMinLead(p) / 5) * 5);
  } catch {
    /* Connector settings that cannot be read are refused when the piece is built. */
  }
  return {
    type: 'turnout',
    ...TURNOUT_DEFAULTS,
    turnoutRadius: Number(radius.toFixed(3)),
    turnoutAngle: Number(angle.toFixed(3)),
    turnoutLead: lead,
  };
}

// A main road long enough for the exits, the blade and the island contacts.
export function turnoutDefaultLength(p, straightLength) {
  const s = turnoutSettings(p.special);
  const start = Math.ceil(turnoutMinLength(p.width, s.turnoutRadius, s.turnoutLead) / 10) * 10;
  const fits = (length) => {
    try {
      const trial = { ...p, length };
      turnoutBraidLayout(trial, turnoutLayout(trial));
      return true;
    } catch {
      return false;
    }
  };
  if (Number.isFinite(straightLength) && straightLength >= start && fits(straightLength))
    return straightLength;
  for (let length = start; length <= start + 400; length += 10) if (fits(length)) return length;
  return null;
}

// The length and the branch angle a new turnout starts with. The branch has
// to run on past the motor and the two braid contacts behind it, so it
// takes one more of the pack's curves where the first choice is too short.
export function turnoutDefaultShape(p, straightLength, rules) {
  const [, maxAngle] = TURNOUT_LIMITS.turnoutAngle;
  const step = Number.isFinite(rules?.angle) && rules.angle >= 1 ? rules.angle : TURNOUT_DEFAULTS.turnoutAngle;
  const first = turnoutSettings(p.special).turnoutAngle;
  const angles = [first];
  for (let angle = first + step; angle <= maxAngle; angle += step) angles.push(Number(angle.toFixed(3)));
  // No whole number of pack curves fits: go up in steps of 5 degrees instead.
  for (let angle = Math.ceil((first + 0.01) / 5) * 5; angle <= maxAngle; angle += 5) angles.push(angle);
  for (const turnoutAngle of angles) {
    const length = turnoutDefaultLength({ ...p, special: { ...p.special, turnoutAngle } }, straightLength);
    if (length !== null) return { length, turnoutAngle };
  }
  const s = turnoutSettings(p.special);
  return {
    length: Math.ceil(turnoutMinLength(p.width, s.turnoutRadius, s.turnoutLead) / 10) * 10,
    turnoutAngle: first,
  };
}

// Where the insert begins and ends along the main road. It reaches past the
// blade and its reliefs, and past the pin of the crank.
export function turnoutInsertSpan(fork, drive) {
  const { front, margin } = TURNOUT_INSERT;
  const clipEnd = Math.max(fork.guardEndX, drive?.pinReach ?? -Infinity);
  return {
    clipStart: fork.mainToe[0] - front,
    clipEnd,
    start: fork.mainToe[0] - front - margin,
    end: clipEnd + margin,
  };
}

export function turnoutLayout(p) {
  const s = turnoutSettings(p.special);
  const sign = s.side === 'right' ? -1 : 1;
  const L = p.length,
    w = p.width,
    R = s.turnoutRadius,
    sweep = radians(s.turnoutAngle);
  const tx = -L / 2 + s.turnoutLead;
  // A point on the branch at this angle, on the circle of radius R + r.
  const arc = (theta, r = 0) => [
    tx + (R + r) * Math.sin(theta),
    sign * (R - (R + r) * Math.cos(theta)),
  ];
  // Keep the chord sag of the widest edge below 0.004 mm, like the pit lane.
  const steps = Math.max(
    12,
    Math.ceil(sweep / (2 * Math.acos(1 - 0.004 / (R + w / 2)))),
  );
  const thetas = Array.from({ length: steps + 1 }, (_, i) => (sweep * i) / steps);
  const branch = thetas.map((theta) => arc(theta));
  const cross = crossingAngle(w, R);
  const far = [cross, ...thetas.filter((theta) => theta > cross + 1e-9)].map(
    (theta) => arc(theta, w / 2),
  );
  const near = thetas.map((theta) => arc(theta, -w / 2)).reverse();
  // One loop: the main road, then out along the branch and back.
  const outline = [
    [-L / 2, (-sign * w) / 2],
    [L / 2, (-sign * w) / 2],
    [L / 2, (sign * w) / 2],
    ...far,
    ...near,
    [-L / 2, (sign * w) / 2],
  ];
  const exitTangent = [Math.cos(sweep), sign * Math.sin(sweep)];
  const fork = pitTurnoutProfile(p, branch, 0, sign, {
    startX: -L / 2 - 0.05,
    endX: L / 2,
    words: TURNOUT_WORDS,
  });
  // d is measured to the left of the direction of travel, as on every road.
  const mainPath = {
    point: (t, d = 0) => [(t - 0.5) * L, d],
    tangent: () => [1, 0],
    minLength: L,
    segmentLengths: [L],
    laneOffsets: () => [0],
    stations: [0, 1],
  };
  const branchPath = {
    point: (t, d = 0) => arc(t * sweep, -sign * d),
    tangent: (t) => [Math.cos(t * sweep), sign * Math.sin(t * sweep)],
    minLength: (R - w / 2) * sweep,
    segmentLengths: [R * sweep],
    laneOffsets: () => [0],
    stations: thetas.map((theta) => theta / sweep),
  };
  const cutLanes = [
    [
      [-L / 2 - 0.05, 0],
      [L / 2 + 0.05, 0],
    ],
    [
      [-L / 2 - 0.05, 0],
      ...branch,
      [branch.at(-1)[0] + 0.05 * exitTangent[0], branch.at(-1)[1] + 0.05 * exitTangent[1]],
    ],
  ];
  const ends = {
    entry: { point: [-L / 2, 0], tangent: [-1, 0] },
    main: { point: [L / 2, 0], tangent: [1, 0] },
    branch: { point: branch.at(-1), tangent: exitTangent },
  };
  // The slider and its motor are part of the road whichever insert is fitted.
  const drive = turnoutDriveLayout(p, { sign, fork, cutLanes, ends });
  return {
    drive,
    settings: s,
    sign,
    radius: R,
    sweep,
    tangentPoint: [tx, 0],
    branch,
    outline,
    lanePaths: [
      [
        [-L / 2, 0],
        [L / 2, 0],
      ],
      [[-L / 2, 0], ...branch],
    ],
    // The same two lanes, run a hair past every end so cutters clear the faces.
    cutLanes,
    ends,
    fork,
    mainPath,
    branchPath,
  };
}

const TOO_SHORT =
  'The road is too short for the braid strips between the two slots and their contacts. Increase Main road length or Branch angle.';

// The braid at the split follows the pit lane's entry. The two outside strips
// run through unbroken. The two strips between the slots start where there is
// room for them, behind the insert, and are fed from below: each one is
// jumpered to the outside strip of the other slot, which has the same polarity.
// Both run on to their own exit, so each has a single contact. The strips run
// beside the slider and the motor, never over them; their contacts and the
// wires under the road sit behind the motor, clear of the slider's channel.
export function turnoutBraidLayout(p, layout = turnoutLayout(p)) {
  const conductors = [],
    jumpers = [];
  const result = { conductors, jumpers };
  if (!p.braidWidth) return result;
  const { sign, fork, cutLanes, ends, drive } = layout;
  const main = measuredLane(cutLanes[0]),
    branch = measuredLane(cutLanes[1]);
  const outer = p.slotWidth / 2 + p.braidGap + p.braidWidth,
    mid = outer - p.braidWidth / 2;
  const viaRadius = Math.min(0.9, 0.24 * p.braidWidth),
    slotted = p.special.pitContactMode === 'braid',
    feedLength = slotted
      ? p.special.pitContactLength ?? PIT_CONTACT_DEFAULTS.pitContactLength
      : Math.max(1.2, 2 * (viaRadius + 0.4));
  const shift = pitBraidLandingShift(p);
  const wireWidth = Math.min(1.8, 0.75 * p.braidWidth);
  const wireDepth = Math.min(1.5, (p.height - p.slotDepth) * 0.55);
  const mainOutside = makeRail(p, main, 1, -sign, 'main');
  const branchOutside = makeRail(p, branch, 1, sign, 'branch');
  conductors.push(mainOutside, branchOutside);
  // The first X where the two facing strips have 1 mm of road between them.
  const landingEdge = outer + shift;
  let lo = layout.tangentPoint[0],
    hi = Math.min(p.length / 2, ends.branch.point[0]);
  for (let n = 0; n < 30; n++) {
    const x = (lo + hi) / 2;
    const t = xStation(branch, -sign * landingEdge, x);
    const gap = sign * branch.atOffset(t, -sign * landingEdge)[1] - landingEdge;
    if (gap >= 1) hi = x;
    else lo = x;
  }
  const room = Math.max(hi + p.braidWidth / 2 + 1, turnoutInsertSpan(fork, drive).end + 1);
  // Stagger the two contacts so their underside wires do not cross.
  const stagger = feedLength + wireWidth + 1;
  const behindDrive = drive.end + wireWidth / 2 + 1;
  // A folded braid tail is its strip's own end, so that strip starts behind
  // the motor. A wire hole can sit anywhere along a strip that starts earlier.
  const begin = (x) => (slotted ? Math.max(x, behindDrive) : x);
  const mainStart = begin(Math.max(room, drive.mainStripStart)),
    branchStart = begin(Math.max(room, drive.stripStart));
  const mainContact = Math.max(mainStart, behindDrive),
    branchContact = Math.max(branchStart, mainContact + stagger);
  for (const [line, polarity, route, opposite, x, contactX, lineEnd] of [
    [main, sign, 'main island', branchOutside, mainStart, mainContact, p.length / 2],
    [branch, -sign, 'branch island', mainOutside, slotted ? branchContact : branchStart, branchContact, ends.branch.point[0]],
  ]) {
    const centreOffset = polarity * mid;
    const from = xStation(line, centreOffset, x);
    const half = feedLength / (2 * line.total);
    if (contactX + 2 * feedLength + 4 > lineEnd || 1 - from <= 4 * half + 1 / line.total)
      throw Error(TOO_SHORT);
    const island = makeRail(p, line, 1, polarity, route, from, 1);
    conductors.push(island);
    let contact;
    if (slotted)
      [contact] = slottedIsland(p, island, polarity, feedLength, shift, {
        startOnly: true,
        tooShort: TOO_SHORT,
      });
    else {
      const xy = line.atOffset(xStation(line, centreOffset, contactX) + half, centreOffset);
      contact = { xy, opening: wireOpening(xy, viaRadius) };
    }
    const padAt = xStation(opposite.line, opposite.mid, contact.xy[0]);
    const via = opposite.line.atOffset(padAt, opposite.mid);
    jumpers.push({
      driver: 1,
      side: island.side,
      from: contact.xy,
      to: via,
      viaRadius,
      openings: [contact.opening, wireOpening(via, viaRadius)],
      tailPocket: contact.tailPocket,
      wireWidth,
      wireDepth,
    });
  }
  return result;
}

const inRange = (value, [min, max]) => Number.isFinite(value) && value >= min && value <= max;
const tidy = (value) => Number(value.toFixed(1));

export function validateTurnout(p) {
  const raw = p.special,
    s = turnoutSettings(raw);
  if (p.lanes !== 1)
    throw Error('A turnout is a single-lane piece. This road has ' + p.lanes + ' lanes. Set Lanes to 1.');
  if (p.segments !== 1)
    throw Error('A turnout prints as one road piece. Set the road Segments to 1.');
  if (p.borderSide !== 'none')
    throw Error('A turnout cannot have borders yet. Set Borders to None for this piece.');
  // Nothing draws these on a turnout, so a setting that asks for them is
  // refused instead of kept and ignored.
  if ((p.tracksideSide ?? 'none') !== 'none')
    throw Error('A turnout cannot have trackside accessories yet. Set Trackside → Barrier side to None for this piece.');
  if ([p.whiteLineRoad, p.roadCentreLine, p.roadKerbSide].some((value) => (value ?? 'none') !== 'none'))
    throw Error('A turnout cannot have white lines or kerbstones yet. Switch them off under Markings for this piece.');
  if (!['left', 'right'].includes(s.side))
    throw Error('Choose Left or Right for the side the branch leaves on.');
  if (!TURNOUT_MODES.some(([id]) => id === s.turnoutMode))
    throw Error('Choose Digital, Hand-set point, Analog or Closed for the turnout insert.');
  if (p.braidFeedSide !== undefined && p.braidFeedSide !== 'none')
    throw Error('A turnout has no extra braid openings yet. Set Feed openings to None for this piece.');
  validateTurnoutDrive(raw);
  if (!['wire', 'braid'].includes(s.pitContactMode))
    throw Error('Choose round wire holes or braid pass-throughs for the turnout contacts.');
  if (s.pitContactMode === 'braid' && !inRange(s.pitContactLength, [0.3, 50]))
    throw Error('Set the braid opening length between 0.3 and 50 mm.');
  for (const [key, name, unit] of [
    ['turnoutRadius', 'Branch radius', ' mm'],
    ['turnoutAngle', 'Branch angle', '°'],
    ['turnoutLead', 'Lead before the branch', ' mm'],
  ]) {
    const [min, max] = TURNOUT_LIMITS[key];
    if (!inRange(s[key], [min, max]))
      throw Error(name + ' must be between ' + min + ' and ' + max + unit + '.');
  }
  const R = s.turnoutRadius,
    w = p.width;
  if (R < smallestRadius(w))
    throw Error(
      'The branch is too tight for this road width. Set Branch radius to at least ' +
        Math.ceil(smallestRadius(w)) + ' mm.',
    );
  // The insert, its two screw lugs and their wall have to fit beside the slot.
  const { margin, lugRadius, lugReach, fit } = TURNOUT_INSERT;
  const flank = p.slotWidth / 2 + p.wall + margin + lugReach + lugRadius + fit + p.wall;
  if (flank > w / 2)
    throw Error(
      'The road is too narrow for the turnout insert and its screws. Set Road width to at least ' +
        Math.ceil(2 * flank) + ' mm.',
    );
  const need = turnoutClearAngle(w, R);
  if (s.turnoutAngle < need - 1e-9)
    throw Error(
      need > TURNOUT_LIMITS.turnoutAngle[1]
        ? 'The branch exit overlaps the main road. Use a larger Branch radius or a narrower road.'
        : 'The branch exit overlaps the main road. Set Branch angle to at least ' +
            Math.ceil(need * 10) / 10 + '°, or use a larger Branch radius.',
    );
  const minLength = turnoutMinLength(w, R, s.turnoutLead);
  if (p.length < minLength - 1e-9)
    throw Error(
      'The main road ends before the branch has left it. Set Main road length to at least ' +
        Math.ceil(minLength) + ' mm.',
    );
  const drive = pitActuatorSpec(p);
  if (
    p.slotWidth < 2 ||
    p.slotDepth < 3.2 ||
    p.height - p.slotDepth < drive.minGuideFloor - 1e-9 ||
    p.slotDepth - p.braidDepth < 2.8
  )
    throw Error(
      'The turnout needs a guide at least 2 mm wide and 3.2 mm deep, with 2.8 mm below the braid shelf. Leave at least ' +
        tidy(drive.minGuideFloor) + ' mm under the guide.',
    );
  if (drive.screwMin > drive.screwMax)
    throw Error('Increase track height and guide depth to leave room for the blade pivot and its screw below the road surface.');
  const pilot = p.height - p.braidDepth - 1 - TURNOUT_INSERT.lugTop - fit;
  if (pilot < TURNOUT_INSERT.minPilot)
    throw Error(
      'The track is too low for the two insert screws. Set Track height to at least ' +
        tidy(p.height + TURNOUT_INSERT.minPilot - pilot) + ' mm.',
    );
  const layout = turnoutLayout(p);
  const span = turnoutInsertSpan(layout.fork, layout.drive);
  const reach = entryConnectorReach(p);
  const clearStart = -p.length / 2 + Math.max(6, reach + TURNOUT_INSERT.jointWeb);
  if (span.start < clearStart - 1e-9)
    throw Error(
      (reach
        ? 'The insert starts under the connectors of the entry end.'
        : 'The insert starts too close to the entry of the piece.') +
        ' Set Lead before the branch to at least ' +
        Math.ceil(s.turnoutLead + clearStart - span.start - 1e-9) + ' mm.',
    );
  if (span.end > p.length / 2 - 6)
    throw Error(
      'The insert reaches the far end of the main road. Set Main road length to at least ' +
        Math.ceil(p.length + 2 * (span.end - (p.length / 2 - 6))) + ' mm.',
    );
  turnoutBraidLayout(p, layout);
}

// The shapes the piece preview, the guides and the conductor map draw.
export function turnoutPlan(p) {
  const layout = turnoutLayout(p),
    { fork, settings } = layout;
  const electrical = turnoutBraidLayout(p, layout);
  const open = settings.turnoutPosition === 'pit';
  const turnouts = [];
  if (turnoutHasBlade(settings.turnoutMode)) {
    const outline = turnoutOutline(fork, open ? 1 : 0);
    turnouts.push({
      side: fork.side,
      outline: [...outline, outline[0]],
      guide: open ? fork.pitGuide : fork.mainGuide,
    });
  }
  return {
    outlinePaths: [layout.outline],
    lanePaths: layout.lanePaths,
    borderPaths: [],
    breaks: [],
    detailPaths: [
      ...turnouts.map((f) => f.outline),
      ...electrical.conductors.map((c) => c.points),
    ],
    jumpers: electrical.jumpers,
    conductors: electrical.conductors.map(({ driver, side, route, points, polygon }) => ({
      driver,
      side,
      route,
      points,
      polygon,
    })),
    turnouts,
  };
}
