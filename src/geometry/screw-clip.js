// The Kevan Sideclip (internal id 'side-screw'): a flat plate that slides
// into a pocket from the side face of the road, across a road joint. Its
// flat edge is flush with the side face; straight parallel sides lead to a
// straight inner end with rounded inner corners. Each piece holds half of
// the pocket and one countersunk wood screw, which cuts its thread into the
// clip and on into a pilot hole beyond it.
//
// Local frame of one clip: u runs along the track from the seam (towards the
// second piece), v runs from the side face into the road, z is height above
// the underside. Everything is built straight in world coordinates.
import { connectorWarning, formatMm } from './connector-warning.js';
import { footprintHull } from './plate.js';
import { SolidWorkshop, left, move } from './solids.js';

export const SCREW_CLIP_TYPE = 'side-screw';
export const SCREW_CLIP_NAME = 'Kevan Sideclip';
export const SCREW_CLIP_PLURAL = 'Kevan Sideclips';

/** Defaults for 2.5 mm wood screws. Shared by every piece of a pack. */
export const SCREW_CLIP_DEFAULTS = Object.freeze({
  screwThread: 2.5,
  screwPilot: 2.1,
  screwClearance: 2.8,
  screwHead: 5,
  screwHeadAngle: 90,
  screwLength: 10,
  screwSeamDistance: 9,
  screwInset: 12,
  screwClipWidth: 30,
  screwClipDepth: 18,
  screwClipCorner: 6,
  screwClipThickness: 3,
  screwClipPlay: 0.3,
  screwDirection: 'top',
});

export const SCREW_CLIP_LIMITS = Object.freeze({
  screwThread: [1, 8],
  screwPilot: [0.5, 8],
  screwClearance: [1, 10],
  screwHead: [2, 16],
  screwHeadAngle: [60, 120],
  screwLength: [3, 80],
  screwSeamDistance: [2, 60],
  screwInset: [2, 150],
  screwClipWidth: [8, 120],
  screwClipDepth: [6, 200],
  screwClipCorner: [0.5, 60],
  screwClipThickness: [1, 20],
  screwClipPlay: [0.05, 1.5],
});

export const SCREW_DIRECTIONS = Object.freeze(['top', 'bottom', 'side']);

export const SCREW_CLIP_LABELS = Object.freeze({
  screwThread: 'Screw thread',
  screwPilot: 'Pilot hole',
  screwClearance: 'Clearance hole',
  screwHead: 'Screw head diameter',
  screwHeadAngle: 'Countersink angle',
  screwLength: 'Screw length',
  screwSeamDistance: 'Screw distance from seam',
  screwInset: 'Screw inset from side face',
  screwClipWidth: 'Clip width',
  screwClipDepth: 'Clip depth into road',
  screwClipCorner: 'Inner corner radius',
  screwClipThickness: 'Clip thickness',
  screwClipPlay: 'Play in pocket',
  screwDirection: 'Screw direction',
});

/** Per-piece settings: switch a road side off, choose its screw direction. */
export const SCREW_SIDE_FIELDS = Object.freeze({
  sideClipLeft: ['', 'none'],
  sideClipRight: ['', 'none'],
  screwFromLeft: ['', 'top', 'bottom'],
  screwFromRight: ['', 'top', 'bottom'],
});

// Each screw cuts its thread into the clip (its holes are pilot size) and on
// into a pilot hole in the road beyond the clip. It must reach at least this
// far into the road pilot. The pocket height does not depend on the screw
// direction, so on the default 12 mm road a 10 mm screw reaches 2.35 mm either
// way: 5.35 mm of thread in all with a 3 mm clip.
export const SCREW_MIN_BITE = 1;
// Common lengths of small countersunk wood screws. With no length set, the
// longest of these that fits the road height is used.
export const SCREW_STOCK_LENGTHS = Object.freeze([6, 8, 10, 12, 13, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80]);
// Material left beyond the screw tip, and beyond the end of the pilot hole.
export const SCREW_TIP_SKIN = 0.6;
const PILOT_SKIN = 0.4;
const PILOT_PAST_TIP = 0.5;
// Material kept between the countersink and the pocket.
const ROOF_OVER_HEAD = 1;
// Solid walls around the pocket in a hollow piece.
export const SCREW_CLIP_WALL = 2;
// Clip material kept from each clip hole to every edge of the clip.
export const SCREW_CLIP_MARGIN = 4;
const LEAD_IN = 0.5;
const NOTCH_WIDTH = 6;
const NOTCH_FLOOR = 3;
const NOTCH_DEPTH = 1.5;
const SEGMENTS = 48;
const HOLE_SEGMENTS = 32;

const round = (value) => Number(value.toFixed(4));
const mm = (value) => String(round(value));
// "A 10", "An 8", "An 11": the article for a number of millimetres.
const a = (value) => (/^(8|11|18)(\D|$)|^8/.test(mm(value)) ? 'An ' : 'A ') + mm(value);

export function isScrewClip(p) {
  return p?.clipType === SCREW_CLIP_TYPE && p.jointFitVersion !== 1;
}

/** The pack settings with defaults for anything not set. Without a screw
 * length, the longest stock length that fits the road height is used. */
export function screwClipSettings(p = {}) {
  const s = {};
  for (const [key, value] of Object.entries(SCREW_CLIP_DEFAULTS))
    s[key] = p[key] ?? value;
  s.screwLengthAuto = p.screwLength == null;
  if (s.screwLengthAuto)
    s.screwLength = stockLengths(s, p.height ?? 12).at(-1) ?? SCREW_CLIP_DEFAULTS.screwLength;
  return s;
}

/** The screw lengths that grip in this road: [shortest, longest] in mm. */
export function screwLengthRange(s, height) {
  return [
    (height + s.screwClipThickness + s.screwClipPlay) / 2 + SCREW_MIN_BITE,
    height - SCREW_TIP_SKIN,
  ];
}

/** Stock screw lengths that grip in this road, shortest first. */
export function stockLengths(s, height) {
  const [shortest, longest] = screwLengthRange(s, height);
  return SCREW_STOCK_LENGTHS.filter((l) => l >= shortest - 1e-9 && l <= longest + 1e-9);
}

/** Sizes that follow from the settings and the road height. */
export function screwClipGeometry(s, height) {
  const gap = s.screwClipPlay / 2;
  const radius = s.screwClipWidth / 2;
  const thickness = s.screwClipThickness;
  // Centred in the road height: a screw from the top and one from the bottom
  // then bite equally far into the pilot hole beyond the clip.
  const floor = (height - thickness - s.screwClipPlay) / 2;
  const top = floor + thickness + s.screwClipPlay;
  const countersink =
    (s.screwHead - s.screwClearance) / 2 / Math.tan((s.screwHeadAngle * Math.PI) / 360);
  const bite = s.screwLength - (height + thickness + s.screwClipPlay) / 2;
  const [shortest, longest] = screwLengthRange(s, height);
  return {
    gap,
    radius,
    corner: Math.min(s.screwClipCorner, radius),
    straight: s.screwClipDepth - Math.min(s.screwClipCorner, radius),
    thickness,
    floor,
    top,
    seat: floor + gap,
    countersink,
    bite,
    // Thread in the clip and in the road pilot beyond it.
    grip: thickness + bite,
    roof: height - top,
    shortest,
    longest,
    // Across the road from the side face, and along the track either side of
    // the seam, including the solid walls of a hollow piece.
    across: s.screwClipDepth + gap + SCREW_CLIP_WALL,
    along: radius + gap + SCREW_CLIP_WALL,
  };
}

/** The clip as clipSpec() describes it. */
export function screwClipSpec(p = {}) {
  const s = screwClipSettings(p);
  const thickness = s.screwClipThickness;
  const countersink =
    (s.screwHead - s.screwClearance) / 2 / Math.tan((s.screwHeadAngle * Math.PI) / 360);
  return {
    name: SCREW_CLIP_NAME,
    clipName: SCREW_CLIP_NAME,
    screw: true,
    width: s.screwClipWidth,
    length: s.screwClipDepth,
    thickness,
    minimumHeight:
      Math.ceil((thickness + s.screwClipPlay + 2 * (countersink + ROOF_OVER_HEAD)) * 2) / 2,
    pocketHalfWidth: s.screwClipWidth / 2,
    seatHeight: 0,
    roofThickness: 0,
    keeperOffsets: [],
  };
}

/** Envelope of one side clip in the shape connectorEnvelopes() returns. */
export function screwClipEnvelope(p) {
  const g = screwClipGeometry(screwClipSettings(p), p.height ?? 12);
  return {
    name: SCREW_CLIP_NAME,
    half: g.across / 2,
    root: g.along,
    socket: g.along,
    checkOutline: false,
    screw: true,
  };
}

/** The label of a screw, as the shopping list and instructions name it. */
export function screwName(p) {
  const s = screwClipSettings(p);
  return mm(s.screwThread) + ' × ' + mm(s.screwLength) + ' mm countersunk wood screw';
}

/** The road sides that carry a clip: +1 left (outside of a corner), -1 right. */
export function screwSides(p) {
  const s = screwClipSettings(p);
  const sides = [];
  for (const [sign, side] of [[1, 'Left'], [-1, 'Right']]) {
    if (p['sideClip' + side] === 'none') continue;
    const chosen = p['screwFrom' + side];
    const direction =
      s.screwDirection === 'side'
        ? chosen === 'bottom' ? 'bottom' : 'top'
        : s.screwDirection;
    sides.push({ sign, side: side.toLowerCase(), direction });
  }
  return sides;
}

export const sideName = (sign) => (sign > 0 ? 'left side' : 'right side');

/** A road joint mode without its clips: the Kevan Sideclips are placed apart. */
export const tabsOnly = (mode) => (mode === 'tabs' || mode === 'both' ? 'tabs' : 'none');

/** The across-road space a clip on each enabled side keeps from other connectors. */
export function screwClipZones(p, width = p.width) {
  const g = screwClipGeometry(screwClipSettings(p), p.height);
  const half = g.across / 2;
  return screwSides(p).map(({ sign }) => ({ position: sign * (width / 2 - half), half, sign }));
}

function setting(field, label) {
  return { tab: 'joints', field, label: 'Edit ' + label.toLowerCase() };
}

function fail(reason, advice, field) {
  const error = connectorWarning(SCREW_CLIP_NAME, reason, advice, setting(field, SCREW_CLIP_LABELS[field]));
  error.code = 'SCREW_CLIP_SETTINGS';
  return error;
}

/** A stock screw length that works in this road, as advice. */
function lengthAdvice(s, height) {
  const fits = stockLengths(s, height);
  if (!fits.length)
    return 'No stock screw length (' + SCREW_STOCK_LENGTHS.slice(0, 6).join(', ') +
      ' mm …) grips in this road. Use a thinner clip or less play, or a taller road.';
  const best = fits.at(-1);
  return 'Use ' + a(best).toLowerCase() + ' mm screw' +
    (fits.length > 1 ? ' (' + fits.slice(0, -1).join(', ') + ' or ' + best + ' mm fit)' : '') +
    ', or leave Screw length empty to choose it automatically.';
}

const FAMILY_FIELDS = [
  'screwClipWidth', 'screwClipDepth', 'screwClipCorner', 'screwClipThickness', 'screwClipPlay',
  'screwSeamDistance', 'screwInset', 'screwPilot', 'screwThread',
];

/**
 * The family of a Kevan Sideclip in the Track Planner. Two ends join only
 * when everything that shapes the clip or its mating holes is the same; the
 * screw direction and length belong to each piece's own half.
 */
export function screwClipFamily(p) {
  const s = screwClipSettings(p);
  return SCREW_CLIP_TYPE + '|' + FAMILY_FIELDS.map((key) => key + '=' + round(s[key])).join('|');
}

/** The first setting two Kevan Sideclip families disagree on, as text. */
export function screwFamilyDifference(here, next) {
  if (!here?.startsWith(SCREW_CLIP_TYPE + '|') || !next?.startsWith(SCREW_CLIP_TYPE + '|')) return '';
  const values = (family) => Object.fromEntries(family.split('|').slice(1).map((pair) => pair.split('=')));
  const [x, y] = [values(here), values(next)];
  const key = FAMILY_FIELDS.find((k) => x[k] !== y[k]);
  if (!key) return '';
  return SCREW_CLIP_LABELS[key] + ' is ' + x[key] + ' mm on this piece and ' + y[key] + ' mm on the next';
}

/** Check the pack settings against each other and the road height. */
export function validateScrewClip(p) {
  const s = screwClipSettings(p);
  for (const [key, [min, max]] of Object.entries(SCREW_CLIP_LIMITS)) {
    const value = s[key];
    if (!Number.isFinite(value) || value < min || value > max)
      throw fail(
        SCREW_CLIP_LABELS[key] + ' must be between ' + min + ' and ' + max +
          (key === 'screwHeadAngle' ? '°.' : ' mm.'),
        'Enter a value in that range.',
        key,
      );
  }
  if (!SCREW_DIRECTIONS.includes(s.screwDirection))
    throw fail('Choose a screw direction.', 'Choose from the top, from the bottom or per road side.', 'screwDirection');
  if (s.screwPilot >= s.screwThread)
    throw fail(
      'The pilot hole (' + mm(s.screwPilot) + ' mm) must be smaller than the screw thread (' +
        mm(s.screwThread) + ' mm), or the screw has nothing to bite into.',
      'Make the pilot hole smaller than the thread.',
      'screwPilot',
    );
  if (s.screwClearance <= s.screwThread)
    throw fail(
      'The clearance hole (' + mm(s.screwClearance) + ' mm) must be larger than the screw thread (' +
        mm(s.screwThread) + ' mm), so that the screw passes through freely.',
      'Make the clearance hole larger than the thread.',
      'screwClearance',
    );
  if (s.screwHead <= s.screwClearance)
    throw fail(
      'The screw head (' + mm(s.screwHead) + ' mm) must be wider than the clearance hole (' +
        mm(s.screwClearance) + ' mm).',
      'Enter the head diameter of your screws.',
      'screwHead',
    );
  const g = screwClipGeometry(s, p.height);
  const half = g.radius;
  if (s.screwClipCorner > half + 1e-9)
    throw fail(
      'The inner corner radius (' + mm(s.screwClipCorner) + ' mm) can be at most half the clip width (' +
        mm(half) + ' mm).',
      'Set the inner corner radius to ' + mm(Math.min(SCREW_CLIP_DEFAULTS.screwClipCorner, half)) + ' mm.',
      'screwClipCorner',
    );
  const hole = s.screwPilot / 2;
  // Clip material each hole keeps to every edge of the clip, and road
  // material (the solid walls) the countersink keeps around the pocket.
  const need = Math.max(
    hole + SCREW_CLIP_MARGIN,
    s.screwHead / 2 + 1 - g.gap - SCREW_CLIP_WALL,
  );
  // Along the seam: clear of the road end, the side edges and the walls.
  const seamMin = s.screwHead / 2 + 1;
  const seamMax = half - need;
  if (seamMin > seamMax + 1e-9)
    throw fail(
      a(s.screwClipWidth) + ' mm wide clip leaves no room for two screws with ' +
        mm(s.screwHead) + ' mm heads and ' + mm(SCREW_CLIP_MARGIN) + ' mm of clip around each hole.',
      'Make the clip at least ' + mm(Math.ceil(2 * (seamMin + need) * 10) / 10) + ' mm wide.',
      'screwClipWidth',
    );
  if (s.screwSeamDistance < seamMin - 1e-9 || s.screwSeamDistance > seamMax + 1e-9)
    throw fail(
      'Each screw must sit between ' + mm(seamMin) + ' and ' + mm(seamMax) +
        ' mm from the seam: clear of the road end, with ' + mm(SCREW_CLIP_MARGIN) +
        ' mm of clip beside its hole and its head inside the walls around the pocket.',
      'Set the screw distance from the seam to ' +
        mm(Math.min(Math.max(s.screwSeamDistance, seamMin), seamMax)) + ' mm.',
      'screwSeamDistance',
    );
  // Across the road: the heads clear of the side face and the notch, and the
  // holes with their margin to the inner end and its rounded corners.
  const nearest = NOTCH_DEPTH + 1 + s.screwHead / 2;
  const corner = Math.min(s.screwClipCorner, half);
  const x = s.screwSeamDistance - (half - corner);
  // How far the inner end must lie beyond the screws.
  const beyond = x > 0 ? corner - Math.sqrt(Math.max(0, (corner - need) ** 2 - x * x)) : need;
  const insetMax = s.screwClipDepth - beyond;
  const depthFor = (inset) => Math.ceil((inset + beyond) * 10) / 10;
  if (s.screwInset < nearest - 1e-9)
    throw fail(
      'The screw heads must sit clear of the side face and the notch in the clip: at least ' + mm(nearest) +
        ' mm in from the side face.',
      insetMax >= nearest - 1e-9
        ? 'Set the screw inset between ' + mm(nearest) + ' and ' + mm(insetMax) + ' mm.'
        : 'Make the clip at least ' + mm(depthFor(nearest)) + ' mm deep, and the screw inset ' + mm(nearest) + ' mm.',
      insetMax >= nearest - 1e-9 ? 'screwInset' : 'screwClipDepth',
    );
  if (clipMaterial(s, s.screwSeamDistance, s.screwInset) < need - 1e-9)
    throw fail(
      'The screws sit ' + mm(s.screwInset) + ' mm in from the side face. ' +
        a(s.screwClipDepth) + ' mm deep clip then keeps only ' +
        mm(Math.max(0, Math.floor((clipMaterial(s, s.screwSeamDistance, s.screwInset) - hole) * 100) / 100)) +
        ' mm of material beyond each hole, to its inner end or corner; it needs ' + mm(need - hole) + ' mm.',
      'Make the clip at least ' + mm(depthFor(s.screwInset)) + ' mm deep' +
        (insetMax >= nearest - 1e-9 ? ', or set the screw inset to ' + mm(Math.floor(insetMax * 10) / 10) + ' mm or less.' : '.'),
      'screwClipDepth',
    );
  if (Math.min(g.floor, g.roof) < g.countersink + ROOF_OVER_HEAD - 1e-9)
    throw fail(
      a(s.screwClipThickness) + ' mm clip leaves ' + mm(Math.max(0, g.roof)) +
        ' mm of road above and below its pocket in ' + a(p.height).toLowerCase() +
        ' mm road. The countersunk head and a roof need ' + mm(g.countersink + ROOF_OVER_HEAD) + ' mm.',
      'Use a thinner clip, less play, or a taller road.',
      'screwClipThickness',
    );
  if (s.screwLengthAuto && !stockLengths(s, p.height).length)
    throw fail(
      'No stock screw length grips a ' + mm(s.screwClipThickness) + ' mm clip in ' +
        a(p.height).toLowerCase() + ' mm road: it needs a screw from ' + mm(g.shortest) +
        ' to ' + mm(g.longest) + ' mm long.',
      'Use a thinner clip or less play, or a taller road.',
      'screwClipThickness',
    );
  if (g.bite < SCREW_MIN_BITE - 1e-9)
    throw fail(
      a(s.screwLength) + ' mm screw reaches only ' + mm(Math.max(0, g.bite)) +
        ' mm into the pilot hole beyond the clip. It needs at least ' + SCREW_MIN_BITE + ' mm there, after the ' +
        mm(s.screwClipThickness) + ' mm through the clip.',
      lengthAdvice(s, p.height),
      'screwLength',
    );
  if (s.screwLength > g.longest + 1e-9)
    throw fail(
      a(s.screwLength) + ' mm screw would end less than ' + SCREW_TIP_SKIN + ' mm from the far side of ' +
        a(p.height).toLowerCase() + ' mm road, or come out of it.',
      lengthAdvice(s, p.height),
      'screwLength',
    );
  return g;
}

/** Check the per-piece side choices. */
export function validateScrewSides(p) {
  for (const [key, allowed] of Object.entries(SCREW_SIDE_FIELDS))
    if (p[key] !== undefined && !allowed.includes(p[key]))
      throw connectorWarning(
        'Road connections',
        'The ' + SCREW_CLIP_NAME + ' setting ' + key + ' cannot be "' + p[key] + '".',
        'Choose Fitted or None for a side, and From the top or From the bottom for its screws.',
        { tab: 'joints', field: key, label: 'Edit ' + SCREW_CLIP_PLURAL },
      );
}

// ---------------------------------------------------------------- geometry

/** Map local (u, v) to world XY. */
function framer(edge, dir, inward) {
  return (u, v) => move(move(edge, dir, u), inward, v);
}

// The clip outline grown by `grow`, from v = from: straight parallel sides
// and a straight inner end with rounded inner corners. Growing keeps it an
// exact offset: the corner radius grows with it.
function outline(s, grow, from) {
  const half = s.screwClipWidth / 2;
  const corner = Math.min(s.screwClipCorner, half);
  const centreU = half - corner;
  const centreV = s.screwClipDepth - corner;
  const r = corner + grow;
  const loop = [[-(half + grow), from], [half + grow, from]];
  const steps = Math.max(4, Math.round(SEGMENTS / 2));
  for (const [sign, a0] of [[1, 0], [-1, Math.PI / 2]])
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i * Math.PI) / 2 / steps;
      const u = sign * centreU + r * Math.cos(a);
      const v = centreV + r * Math.sin(a);
      // The two corners meet at u = 0 when the corner is half the width.
      if (sign < 0 && i === 0 && centreU === 0) continue;
      loop.push([u, v]);
    }
  return loop;
}

/**
 * Clip material from a point (u, v) of the clip to its nearest side edge,
 * inner end or rounded corner. Negative outside the clip.
 */
export function clipMaterial(s, u, v) {
  const half = s.screwClipWidth / 2;
  const corner = Math.min(s.screwClipCorner, half);
  const x = Math.abs(u) - (half - corner);
  const y = v - (s.screwClipDepth - corner);
  if (x > 0 && y > 0) return corner - Math.hypot(x, y);
  return Math.min(half - Math.abs(u), s.screwClipDepth - v);
}

function circle(work, centre, radius) {
  const c = work.own(work.wasm.CrossSection.circle(radius, HOLE_SEGMENTS));
  return work.own(c.translate(centre));
}

function cone(work, centre, z0, r0, z1, r1) {
  const solid = work.own(
    work.wasm.Manifold.cylinder(z1 - z0, r0, r1, HOLE_SEGMENTS),
  );
  return work.own(solid.translate([centre[0], centre[1], z0]));
}

/** Holes for one screw, from its entry face through the clip into the pilot. */
function screwHoles(work, s, g, height, at, direction) {
  const clear = s.screwClearance / 2;
  const head = s.screwHead / 2;
  const pilot = s.screwPilot / 2;
  const parts = [];
  if (direction === 'top') {
    const tip = height - s.screwLength;
    parts.push(
      cone(work, at, height - g.countersink, clear, height, head),
      cone(work, at, height, head, height + 1, head + 1),
      work.prism(circle(work, at, clear), g.floor, height),
      work.prism(circle(work, at, pilot), Math.max(PILOT_SKIN, tip - PILOT_PAST_TIP), g.floor + 0.01),
    );
  } else {
    const tip = s.screwLength;
    parts.push(
      cone(work, at, 0, head, g.countersink, clear),
      cone(work, at, -1, head + 1, 0, head),
      work.prism(circle(work, at, clear), 0, g.top),
      work.prism(circle(work, at, pilot), g.top - 0.01, Math.min(height - PILOT_SKIN, tip + PILOT_PAST_TIP)),
    );
  }
  return work.union(parts);
}

/**
 * Everything one side clip needs at one road joint.
 * edge: the point where the seam meets the side face; dir: along the track
 * towards the second piece; sign: +1 for the left (positive offset) side.
 * Returns the cutters and supports per piece and a describing record;
 * the caller checks them against the piece before applying them.
 */
export function screwClipTools(work, p, { edge, dir, sign, directions }) {
  const s = screwClipSettings(p);
  const g = screwClipGeometry(s, p.height);
  const inward = left(dir).map((v) => -sign * v);
  const at = framer(edge, dir, inward);
  const section = (loop) => work.section([loop.map(([u, v]) => at(u, v))]);
  const mouth = g.radius + g.gap + 2;
  const pocket = work.prism(section(outline(s, g.gap, -mouth)), g.floor, g.top);
  // A short lead-in chamfer around the mouth of the pocket.
  const wide = g.radius + g.gap + LEAD_IN;
  const narrow = g.radius + g.gap;
  const points = [];
  for (const v of [-mouth, 0]) for (const u of [-wide, wide]) for (const z of [g.floor - LEAD_IN, g.top + LEAD_IN])
    points.push([...at(u, v), z]);
  for (const u of [-narrow, narrow]) for (const z of [g.floor, g.top])
    points.push([...at(u, LEAD_IN), z]);
  const leadIn = work.own(work.wasm.Manifold.hull(points));
  const screws = {};
  for (const [key, u] of [['first', -s.screwSeamDistance], ['second', s.screwSeamDistance]]) {
    const direction = directions[key];
    if (!direction) continue;
    screws[key] = {
      point: at(u, s.screwInset),
      direction,
      holes: screwHoles(work, s, g, p.height, at(u, s.screwInset), direction),
    };
  }
  // The solid block a hollow piece needs around the pocket and screws.
  // It starts beyond the tangent line, so that on a concave side face the
  // pocket corners never open into the hollow interior.
  const support = work.prism(section(outline(s, g.gap + SCREW_CLIP_WALL, -mouth)), 0, p.height);
  // Room that nothing else may take: the pocket with 1 mm of road around it,
  // and a column around each screw from the underside to the road surface.
  const guardParts = [
    work.prism(section(outline(s, g.gap + 1, 0)), g.floor - 1, g.top + 1),
  ];
  for (const screw of Object.values(screws))
    guardParts.push(work.prism(circle(work, screw.point, s.screwHead / 2 + 0.6), -0.5, p.height + 0.5));
  return {
    settings: s,
    geometry: g,
    inward,
    at,
    cut: work.union([pocket, leadIn]),
    screws,
    support,
    guard: work.union(guardParts),
    // The plan of the pocket from the tangent line at the seam. Where a convex
    // side face bends away from that line, the clip corners stand proud of
    // it, and a border on that side is relieved to clear them.
    footprint: section(outline(s, g.gap, 0)),
    centre: at(0, s.screwClipDepth / 2),
    plan: [[-g.along, 0], [g.along, 0], [g.along, g.across], [-g.along, g.across]].map(([u, v]) => at(u, v)),
  };
}

/** The clip itself, flat on the bed: u along x, v along y, z from 0. */
export function screwClipModel(work, p) {
  const s = screwClipSettings(p);
  const plate = work.section([outline(s, 0, 0)]);
  // Pilot-size holes: each screw cuts its thread into the clip as well.
  const holes = [-1, 1].map((k) => circle(work, [k * s.screwSeamDistance, s.screwInset], s.screwPilot / 2));
  const notch = work.section([[
    [-NOTCH_WIDTH / 2, -1], [NOTCH_WIDTH / 2, -1],
    [NOTCH_FLOOR / 2, NOTCH_DEPTH], [-NOTCH_FLOOR / 2, NOTCH_DEPTH],
  ]]);
  const shape = work.own(plate.subtract(work.own(work.wasm.CrossSection.union([...holes, notch]))));
  return { solid: work.prism(shape, 0, s.screwClipThickness), contours: shape.toPolygons() };
}

/** Place the flat model in the assembled pose of tools.at(). */
function placeModel(work, solid, tools, z) {
  const u = tools.at(1, 0).map((v, i) => v - tools.at(0, 0)[i]);
  const v = tools.inward;
  const o = tools.at(0, 0);
  return work.own(
    solid.transform([u[0], u[1], 0, 0, v[0], v[1], 0, 0, 0, 0, 1, 0, o[0], o[1], z, 1]),
  );
}

/** The loose clip part for the parts list, print kit and preview. */
export function screwClipPart(work, p, tools, { id, plannerJoint }) {
  const wasm = work.wasm;
  const { solid: flat, contours } = screwClipModel(work, p);
  const z = tools.geometry.seat;
  const s = tools.settings;
  const key = [
    s.screwClipWidth, s.screwClipDepth, s.screwClipThickness, s.screwSeamDistance,
    s.screwInset, s.screwPilot,
  ].join('/');
  return {
    id,
    name: SCREW_CLIP_NAME,
    role: 'clip',
    ...(plannerJoint && { plannerJoint }),
    clipType: SCREW_CLIP_TYPE,
    fabricationKey: 'side-screw/' + key,
    printContours: contours,
    footprintXY: footprintHull(contours.flat()),
    solid: placeModel(work, flat, tools, z),
    printPose(callback, sideDown) {
      const stock = new SolidWorkshop(wasm);
      try {
        const free = screwClipModel(stock, p).solid;
        return callback(sideDown ? free : placeModel(stock, free, tools, z));
      } finally {
        stock.close();
      }
    },
  };
}
