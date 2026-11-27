// A grandstand: rows of seats stepping up from the front, a parapet in
// front of the first row, a back wall, aisles with half steps, and a canopy
// roof on posts if wanted. Straight, or curved round a corner. It is a
// hollow stepped shell, 3 mm thick, cut into sections that each print
// standing on their end: the stepped side lies on the plate and the rows
// rise straight up, so nothing overhangs. The sections join end to end with
// two small tabs; the roof and its posts print flat. A straight stand can be
// raised on braced frames that print flat, have a staircase up an end and
// railings round its sides and back, glued on. Toy proportions for 1:32.

import { kitShapes } from './kit-shapes.js';
import { BENCH, plankBench } from './bench.js';

export const GRANDSTAND_DEFAULTS = Object.freeze({
  kind: 'grandstand',
  length: 240, // along the front, at the front for a curved stand
  rows: 6,
  rowDepth: 18,
  rowRise: 9,
  frontHeight: 12, // the first row above the table
  seats: true, // a bench on each row
  backrests: false, // a back to each bench
  // The benches: 'block', moulded into the rows; or 'wood', planked benches
  // standing on rows of planks, a part of their own each (a straight stand).
  benchStyle: 'block',
  parapet: true, // a wall in front of the first row, above it; or the front open
  // How it is built: 'shell', a hollow stepped shell; or 'frames', each row
  // a planked deck on X-braced frames on a base board, open underneath, an
  // aisle a few steps from one deck up to the next (a straight stand).
  build: 'shell',
  aisles: 1, // aisles with half steps, spread evenly
  backHeight: 15, // the back wall above the last row
  roof: 'none', // 'none' or 'canopy'
  roofHeight: 50, // the canopy above the last row
  curve: null, // { radius: at the front, angle: degrees, facing: 'in' | 'out' }
  sectionLength: 120, // the longest section, as it stands on the plate
  raised: 0, // the stand on braced frames this high, or 0 on the table
  stairs: 'none', // a staircase up an end: 'none', 'left', 'right' or 'both'
  railings: false, // railings round the sides and the back
  // An upper tier of this many rows behind the stand, raised on braced
  // frames so its first row is level with the top of the lower one's back
  // wall: the staircases and railings are the upper tier's (a straight
  // shell stand on the table, open to the sky).
  upperTier: 0,
});
export const GRANDSTAND_LIMITS = Object.freeze({
  length: [60, 1500],
  rows: [1, 20],
  rowDepth: [12, 40],
  rowRise: [5, 25],
  frontHeight: [6, 60],
  aisles: [0, 12],
  backHeight: [6, 60],
  roofHeight: [30, 120],
  sectionLength: [40, 300],
  raised: [0, 100],
  upperTier: [0, 12],
});
export const STAND = Object.freeze({
  shell: 3, // the stepped shell, the parapet and the back wall
  parapet: 8, // above the first row
  bench: [7, 4], // a bench: deep, high, at the back of each row
  aisle: 16, // an aisle, wide
  tab: [1.8, 8, 4], // a tab between two sections: thick, high, long
  tabPlay: 0.15,
  post: 4, // a canopy post, square
  roof: 3, // the canopy, thick
  reach: 6, // the canopy beyond the front row
  backrest: [2, 7, 5], // a bench's back: thick, above the bench at least, above the next row at least
  framed: { longest: 180, base: 2, deck: 3, frame: 2.5, member: 3, brace: 2.5, bay: 30, truss: 10, step: [7, 5] }, // a stand of frames: its pieces at most this long, the base board and the decks thick, the frames thick, their members, braces and bays, braced from this high; its steps at most this high, this deep
  wood: { depth: 9, seat: 8, back: 7, behind: 1.5, margin: 2, longest: 120, gap: 3, inset: 3, plank: [4, 0.8, 0.5] }, // a wooden bench on a row: deep, its seat above the row, its back; clear of the step up behind it and of the ends; at most this long, this far from the next; the rows' planks: wide, the groove between them wide and deep
  frame: { member: 4, brace: 3, bay: 40, play: 0.15 }, // the frames under a raised stand
  rail: { height: 14, bar: 2.5, glue: 10 }, // railings: above the walls, their bars, the back railing's band glued on
  stair: { width: 24, rise: 8, tread: [6, 10], slab: 5, post: 5, wall: [3, 12] }, // a staircase up an end
});
const LABELS = {
  length: 'Length',
  rows: 'Rows',
  rowDepth: 'Row depth',
  rowRise: 'Row rise',
  frontHeight: 'Front row height',
  aisles: 'Aisles',
  backHeight: 'Back wall height',
  roofHeight: 'Canopy height',
  sectionLength: 'Section length',
  raised: 'Raised',
  upperTier: 'Upper tier rows',
};

/** The grandstand as kept: known settings only, each checked. */
export function validateGrandstand(input) {
  const g = { ...GRANDSTAND_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(g)) if (!Object.hasOwn(GRANDSTAND_DEFAULTS, key)) throw Error('The grandstand has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(GRANDSTAND_LIMITS))
    if (!Number.isFinite(g[key]) || g[key] < min || g[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (['rows', 'aisles', 'upperTier'].includes(key) ? '' : ' mm') + '.');
  if (!Number.isInteger(g.rows) || !Number.isInteger(g.aisles) || !Number.isInteger(g.upperTier)) throw Error('Rows, aisles and the rows of an upper tier are whole numbers.');
  if (typeof g.seats !== 'boolean') throw Error('Choose whether the rows have benches.');
  if (typeof g.backrests !== 'boolean' || typeof g.railings !== 'boolean') throw Error('Choose whether the benches have backs and the stand railings.');
  if (g.backrests && !g.seats) throw Error('Backs are for benches: choose benches too.');
  if (g.backrests && g.rowDepth < 16) throw Error('Benches with backs need rows at least 16 mm deep.');
  if (typeof g.parapet !== 'boolean') throw Error('Choose whether the first row has a parapet in front.');
  if (!['shell', 'frames'].includes(g.build)) throw Error('Choose a stand built as a shell or of frames.');
  if (g.build === 'frames') {
    if (g.curve !== null || g.roof !== 'none' || g.raised || g.stairs !== 'none' || g.railings) throw Error('A stand of frames is straight and open to the sky, on the table, without staircases or railings.');
    if (g.seats && g.benchStyle !== 'wood') throw Error('A stand of frames has wooden benches, or none.');
  }
  if (!['block', 'wood'].includes(g.benchStyle)) throw Error('Choose benches moulded into the rows or of wood.');
  if (g.benchStyle === 'wood') {
    if (!g.seats) throw Error('Wooden benches are benches: choose benches too.');
    if (g.curve !== null) throw Error('Wooden benches are for a straight grandstand.');
    if (g.rowDepth < STAND.wood.depth + STAND.wood.behind + 3) throw Error('Wooden benches need rows at least ' + (STAND.wood.depth + STAND.wood.behind + 3) + ' mm deep.');
  }
  if (g.raised > 0 && g.raised < 20) throw Error('Raised must be 0, on the table, or between 20 and 100 mm.');
  if (!['none', 'left', 'right', 'both'].includes(g.stairs)) throw Error('Choose a staircase for the grandstand from the list.');
  if (g.curve !== null && (g.raised > 0 || g.stairs !== 'none' || g.railings)) throw Error('A raised stand, a staircase and railings are for a straight grandstand.');
  // One step is no staircase, and its slab would not fit under it.
  if (g.stairs !== 'none' && standStair(g).steps < 2) throw Error('A staircase needs the last row more than ' + STAND.stair.rise + ' mm up.');
  if (g.railings && g.roof === 'canopy') throw Error('Railings are for a stand open to the sky: under a canopy its back wall is high.');
  if (!['none', 'canopy'].includes(g.roof)) throw Error('Choose a roof for the grandstand from the list.');
  if (g.curve !== null) {
    const c = g.curve;
    if (!c || typeof c !== 'object' || Object.keys(c).some((k) => !['radius', 'angle', 'facing'].includes(k))) throw Error('The curve of the grandstand is not readable.');
    if (!Number.isFinite(c.radius) || c.radius < 100 || c.radius > 3000) throw Error('The radius must be between 100 and 3000 mm.');
    if (!Number.isFinite(c.angle) || c.angle < 10 || c.angle > 180) throw Error('The angle must be between 10 and 180°.');
    if (!['in', 'out'].includes(c.facing)) throw Error('Choose which way the curved grandstand faces.');
    const depth = standDepth(g);
    if (c.facing === 'out' && c.radius - depth < 30) throw Error('Facing out of the curve, the radius must be at least ' + Math.ceil(depth + 30) + ' mm for these rows.');
    // Its length follows from the curve: along the front.
    g.length = Math.round(((c.radius * c.angle * Math.PI) / 180) * 10) / 10;
    g.curve = { ...c };
  }
  if (g.upperTier) {
    if (g.curve !== null || g.build !== 'shell' || g.raised || g.roof !== 'none') throw Error('An upper tier is for a straight stand of a stepped shell, on the table and open to the sky.');
    const r = upperRaise(g);
    if (r < 20 || r > GRANDSTAND_LIMITS.raised[1]) throw Error('The upper tier would stand ' + Math.round(r) + ' mm up on its frames: keep it between 20 and ' + GRANDSTAND_LIMITS.raised[1] + ' mm, with fewer or lower rows below.');
  }
  const room = (g.length - g.aisles * STAND.aisle) / (g.aisles + 1);
  if (room < 20) throw Error('Too many aisles for a grandstand ' + g.length + ' mm long: at most ' + Math.max(0, Math.floor((g.length - 20) / (STAND.aisle + 20))) + '.');
  return g;
}

/** A building's size in a line: a garage's outside, a grandstand's rows and length. */
export function sizeLine(b) {
  if (b.kind === 'sections') return `${b.sections.length} connected sections · independent heights and roofs`;
  if (b.kind === 'footprint') return `${b.shape} footprint · ${b.width} × ${b.depth} × ${b.height} mm`;
  if (b.kind === 'gantry') return { start: 'Start gantry', half: 'Half gantry', bridge: 'Footbridge' }[b.type] + ' · span ' + Math.round(b.span) + ' mm';
  if (b.kind === 'pitmodule') return b.bays + (b.bays === 1 ? ' bay' : ' bays') + ' · ' + Math.round(b.bays * b.bayWidth + 3) + ' × ' + Math.round(b.depth) + ' mm';
  if (b.kind === 'pitbays') return b.types.length + (b.types.length === 1 ? ' bay' : ' bays') + ' · ' + Math.round(b.types.length * b.bayWidth + 5) + ' × ' + Math.round(b.depth) + ' mm';
  if (b.kind === 'walkway') return 'Walkway · ' + Math.round(b.length) + ' mm, ' + Math.round(b.clearance) + ' mm up';
  if (b.kind === 'platform') return 'Viewing platform · ' + Math.round(b.width) + ' × ' + Math.round(b.depth) + ' mm';
  if (b.kind === 'picnic') return (b.count === 1 ? 'Picnic table' : b.count + ' picnic tables') + ' · ' + Math.round(b.length) + ' mm long';
  if (b.kind === 'tyrebridge') return 'Tyre bridge · ' + Math.round(b.span) + ' × ' + Math.round(b.height) + ' mm';
  if (b.kind === 'bench') return (b.count === 1 ? 'Bench' : b.count + ' benches') + ' · ' + Math.round(b.length) + ' mm each';
  if (b.kind === 'switchback') return 'Switchback stairs · ' + Math.round(b.height) + ' mm up';
  if (b.kind === 'canopy') return 'Canopy · ' + Math.round(b.width) + ' × ' + Math.round(b.depth) + ' mm, ' + Math.round(b.height) + ' mm up';
  if (b.kind === 'stage') return 'Stage · ' + Math.round(b.width) + ' × ' + Math.round(b.depth) + ' mm, ' + Math.round(b.height) + ' mm high';
  if (b.kind === 'billboard') return (b.style === 'board' ? 'Billboard' : 'Hoarding') + ' · ' + Math.round(b.length) + ' × ' + Math.round(b.height) + ' mm';
  if (b.kind === 'flagpost') return "Flag waver's post · " + Math.round(b.width) + ' wide, ' + Math.round(b.height) + ' mm up';
  if (b.kind === 'marshalpost') return (b.deckHeight > 0 ? 'Marshal post' : 'Marshal shelter') + ' · ' + Math.round(b.width) + ' × ' + Math.round(b.depth) + ' mm';
  if (b.kind !== 'grandstand') return Math.round(b.width) + ' × ' + Math.round(b.depth) + ' mm';
  return b.rows + ' rows' + (b.upperTier ? ' and ' + b.upperTier + ' on an upper tier' : '') + ' · ' + Math.round(b.length) + ' mm' + (b.curve ? ' · curved' : '');
}

/** How high the front wall stands above the bottom of the shell: up to the first row, and the parapet above it. */
const frontWall = (g) => g.frontHeight + (g.parapet ? STAND.parapet : 0);
/** How deep the stand is, from the front of the parapet to the back of its back wall. */
export const standDepth = (g) => STAND.shell + g.rows * g.rowDepth + STAND.shell;
/** How high its back wall stands above the bottom of the shell: above the last row, or up to the canopy. */
const wallTop = (g) => g.frontHeight + (g.rows - 1) * g.rowRise + (g.roof === 'canopy' ? g.roofHeight : g.backHeight);
/** How high its back wall stands above the table, raised or not; with an upper tier, the upper one's. */
export const standHeight = (g) => (g.upperTier ? standHeight(tiers(g).upper) : g.raised + wallTop(g));
/** How high the frames raise an upper tier: its first row level with the top of the lower tier's back wall. */
const upperRaise = (g) => wallTop(g) - g.frontHeight;
/**
 * A stand with an upper tier as two stands: the lower one on the table,
 * without staircases or railings; the upper one behind it, raised, with
 * them. The upper one is as built at y 0: it stands `behind` further back.
 */
export function tiers(g) {
  const lower = { ...g, upperTier: 0, stairs: 'none', railings: false };
  const upper = { ...g, upperTier: 0, rows: g.upperTier, raised: upperRaise(g) };
  return { lower, upper, behind: standDepth(lower) };
}
/** Which ends have a staircase. */
export const stairEnds = (g) => ({ none: [], left: ['left'], right: ['right'], both: ['left', 'right'] })[g.stairs];
/**
 * A staircase up an end, from the table to the last row: as many steps as
 * it takes, no higher than STAND.stair.rise, over the depth of the stand if
 * they are not too shallow, else reaching out in front of it.
 */
export function standStair(g) {
  const top = g.raised + g.frontHeight + (g.rows - 1) * g.rowRise;
  const steps = Math.ceil(top / STAND.stair.rise - 1e-9),
    [least, most] = STAND.stair.tread;
  const tread = Math.min(most, Math.max(least, standDepth(g) / steps));
  return { top, steps, rise: top / steps, tread, y0: standDepth(g) - steps * tread };
}
/** A straight stand's outline on the table, [x0, y0, x1, y1]: its staircases beside it, its back railing behind. */
export function standExtent(g) {
  if (g.upperTier) {
    const { lower, upper, behind } = tiers(g);
    const a = standExtent(lower),
      b = standExtent(upper);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1] + behind), Math.max(a[2], b[2]), b[3] + behind];
  }
  const ends = stairEnds(g),
    S = STAND.stair.width;
  const x0 = ends.includes('left') ? -S : 0,
    x1 = g.length + (ends.includes('right') ? STAND.shell + S : 0);
  const y0 = Math.min(g.roof === 'canopy' ? -STAND.reach : 0, ends.length ? standStair(g).y0 : 0);
  return [x0, y0, x1, standDepth(g) + (g.railings ? STAND.rail.bar : 0)];
}

/**
 * The side profile of the stand, in (y from the front, z up): the hollow
 * stepped shell with its parapet and back wall, open underneath, and on
 * top of it the benches, or in an aisle the half steps.
 */
export function profile(g, aisle = false) {
  const s = STAND.shell;
  const rects = [];
  const row = (i) => ({ y0: s + i * g.rowDepth, y1: s + (i + 1) * g.rowDepth, z: g.frontHeight + i * g.rowRise });
  // The solid under the rows, the parapet and the back wall; hollowed below.
  const solid = [[0, 0, s, frontWall(g)]];
  for (let i = 0; i < g.rows; i++) {
    const r = row(i);
    solid.push([r.y0, 0, r.y1, r.z]);
  }
  const back = s + g.rows * g.rowDepth;
  solid.push([back, 0, back + s, wallTop(g)]);
  // The hollow under the rows, open to the table: under each row less the
  // shell of its tread, and of its riser, the step up from the row before;
  // under the riser, as high as the row before reaches.
  const hollow = [];
  for (let i = 0; i < g.rows; i++) {
    const r = row(i);
    const y1 = r.y1 + 0.01;
    if (r.z - s > 0.5) hollow.push([i === 0 ? s : r.y0 + s, -1, y1, r.z - s]);
    if (i > 0) {
      const below = row(i - 1).z - s;
      if (below > 0.5) hollow.push([r.y0 - 0.01, -1, r.y0 + s + 0.01, below]);
    }
  }
  // The benches, or the half steps of an aisle; with wooden benches, the rows of planks, a groove between each two.
  const grooves = [];
  for (let i = 0; i < g.rows; i++) {
    const r = row(i);
    if (g.benchStyle === 'wood') {
      const [pw, gw, gd] = STAND.wood.plank;
      for (let y = r.y0 + (i === 0 ? s : 0) + pw; y < r.y1 - 1; y += pw) grooves.push([[y - gw / 2, r.z + 0.01], [y, r.z - gd], [y + gw / 2, r.z + 0.01]]);
    }
    if (aisle) rects.push([r.y0 + g.rowDepth / 2, r.z - 0.01, r.y1, r.z + g.rowRise / 2]);
    else if (g.benchStyle === 'wood') continue;
    else if (g.seats && g.backrests) {
      // Its back stands against the step up behind it (the back wall, on the
      // last row), rising clear above the next row so it reads as a back.
      const [bt, bh, above] = STAND.backrest;
      const top = r.z + Math.max(STAND.bench[1] + bh, i < g.rows - 1 ? g.rowRise + above : 0);
      rects.push([r.y1 - bt - STAND.bench[0], r.z - 0.01, r.y1 - bt + 0.01, r.z + STAND.bench[1]], [r.y1 - bt, r.z - 0.01, r.y1 + 0.01, top]);
    } else if (g.seats) rects.push([r.y1 - STAND.bench[0], r.z - 0.01, r.y1, r.z + STAND.bench[1]]);
  }
  return { solid, hollow, top: rects, grooves };
}

/**
 * Where the wooden benches stand: on each row at its back, clear of the step
 * up behind it, from end to end between the aisles, as many on a stretch as
 * keep each no longer than STAND.wood.longest. Each { row, x0, x1, y0, z0 }.
 */
export function woodBenches(g) {
  if (g.benchStyle !== 'wood') return [];
  const W = STAND.wood,
    s = STAND.shell;
  const edges = [s, ...aisleSpans(g).flat(), g.length];
  const stretches = [];
  for (let k = 0; k < edges.length; k += 2) stretches.push([edges[k] + W.margin, edges[k + 1] - W.margin]);
  const out = [];
  for (let i = 0; i < g.rows; i++) {
    const y1 = s + (i + 1) * g.rowDepth - W.behind;
    const z0 = g.raised + g.frontHeight + i * g.rowRise;
    for (const [a, c] of stretches) {
      const n = Math.max(1, Math.ceil((c - a + W.gap) / (W.longest + W.gap) - 1e-9));
      const len = (c - a - (n - 1) * W.gap) / n;
      for (let k = 0; k < n; k++) out.push({ row: i + 1, x0: a + k * (len + W.gap), x1: a + k * (len + W.gap) + len, y0: y1 - W.depth, z0 });
    }
  }
  return out;
}
const benchKeys = (g) => ['seat', ...(g.backrests ? ['back'] : []), 'end-left', 'end-right'];
const benchName = (key, row, k) => ({ seat: 'Bench seat', back: 'Bench back', 'end-left': 'Bench end, left', 'end-right': 'Bench end, right' })[key] + ', row ' + row + ' ' + k;

/**
 * A side railing, in the plane of an end of the stand (y, z), as outlines:
 * a rail from above the parapet up to above the back wall, one halfway
 * under it, and posts up from the parapet, from each row and from the back wall.
 */
function sideRail(g) {
  const s = STAND.shell,
    D = standDepth(g),
    { height: RH, bar } = STAND.rail;
  const zf = frontWall(g) + RH,
    zb = wallTop(g) + RH;
  const at = (y) => zf + ((zb - zf) * y) / D;
  const band = (drop) => [[0, zf - drop - bar], [D, zb - drop - bar], [D, zb - drop], [0, zf - drop]];
  const outlines = [band(0), band(RH / 2)];
  const post = (y0, z0) => outlines.push([[y0, z0 - 0.01], [y0 + s, z0 - 0.01], [y0 + s, at(y0 + s)], [y0, at(y0)]]);
  post(0, frontWall(g));
  for (let i = 1; i < g.rows; i++) post(s + i * g.rowDepth, g.frontHeight + i * g.rowRise);
  post(D - s, wallTop(g));
  return outlines;
}

/** The parts of a raised stand under it: a frame along the front and the back under each section, a frame across at each end and each joint. */
function frameSpans(g) {
  const sections = sectionSpans(g),
    last = sections.length - 1;
  // The last frames along reach under the end panel too.
  const along = sections.map(([a, b], i) => [a, i === last ? b + STAND.shell : b]);
  const F = STAND.shell,
    pl = STAND.frame.play;
  // Across: just inside each end, and astride each joint.
  const across = [STAND.shell + pl, ...sections.slice(0, -1).map(([, b]) => b - F / 2), g.length - F - pl];
  return { along, across };
}

/** The parts of a grandstand, without geometry: its sections, and the canopy and its posts. */
export function grandstandLayout(input) {
  const g = validateGrandstand(input);
  if (g.build === 'frames') return framedLayout(g);
  if (g.upperTier) {
    const { lower, upper } = tiers(g);
    const below = grandstandLayout(lower);
    return { building: g, parts: [...below.parts, ...grandstandLayout(upper).parts.map(upperPart)], sections: below.sections };
  }
  const sections = sectionSpans(g);
  const parts = sections.map((_, i) => ({ id: 'stand-' + (i + 1), name: 'Grandstand section ' + (i + 1) + ' of ' + sections.length, role: 'wall' }));
  parts.push({ id: 'end', name: 'End panel', role: 'wall' });
  if (g.roof === 'canopy') {
    canopySpans(g).forEach((_, i, all) => parts.push({ id: 'canopy-' + (i + 1), name: 'Canopy' + (all.length > 1 ? ' ' + (i + 1) + ' of ' + all.length : ''), role: 'roof' }));
    postPlaces(g).forEach((_, i) => parts.push({ id: 'post-' + (i + 1), name: 'Canopy post ' + (i + 1), role: 'frame' }));
  }
  if (g.raised > 0) {
    const { along, across } = frameSpans(g);
    along.forEach((_, i) => parts.push({ id: 'frame-front-' + (i + 1), name: 'Frame, front ' + (i + 1), role: 'frame' }, { id: 'frame-back-' + (i + 1), name: 'Frame, back ' + (i + 1), role: 'frame' }));
    across.forEach((_, i) => parts.push({ id: 'frame-' + (i + 1), name: 'Cross frame ' + (i + 1), role: 'frame' }));
  }
  for (const end of stairEnds(g)) parts.push({ id: 'stair-' + end, name: 'Staircase, ' + end, role: 'wall' });
  if (g.railings) sections.forEach((_, i) => parts.push({ id: 'rail-back-' + (i + 1), name: 'Back railing ' + (i + 1), role: 'wall' }));
  // The wooden benches, row by row along it.
  const counts = {};
  for (const b of woodBenches(g)) {
    const k = (counts[b.row] = (counts[b.row] ?? 0) + 1);
    for (const key of benchKeys(g)) parts.push({ id: 'bench-' + b.row + '-' + k + '-' + key, name: benchName(key, b.row, k), role: key.startsWith('end') ? 'frame' : 'wall' });
  }
  return { building: g, parts, sections };
}

/** Where the aisles are along the front: [from, to] each, spread evenly. */
export function aisleSpans(g) {
  const out = [];
  const step = (g.length - g.aisles * STAND.aisle) / (g.aisles + 1);
  for (let k = 0; k < g.aisles; k++) {
    const from = step * (k + 1) + STAND.aisle * k;
    out.push([from, from + STAND.aisle]);
  }
  return out;
}

/**
 * The sections the stand is cut into, as [from, to] along the front: a cut
 * where each aisle begins, so every aisle starts a section and its half
 * steps stand on the plate as it prints; between them as many more as keep
 * a section no longer than sectionLength (along the back for a curve facing
 * in, where it is longest), kept out of the aisles.
 */
export function sectionSpans(g) {
  const longest = g.curve ? (g.curve.facing === 'in' ? (g.curve.radius + standDepth(g)) / g.curve.radius : 1) : 1;
  // Its tab reaches into the next section: that counts too.
  const most = g.sectionLength / longest - STAND.tab[2];
  const aisles = aisleSpans(g);
  const marks = [0, ...aisles.map(([a]) => a), g.length];
  const spans = [];
  for (let k = 0; k + 1 < marks.length; k++) {
    const [p, q] = [marks[k], marks[k + 1]];
    // A stretch beginning with an aisle: further cuts only after it.
    const after = aisles.find(([a]) => a === p)?.[1] ?? p;
    for (let n = Math.max(1, Math.ceil((q - p) / most - 1e-9)); ; n++) {
      const edges = [p];
      for (let i = 1; i < n; i++) edges.push(Math.max(after + 1, p + (i * (q - p)) / n));
      edges.push(q);
      const pieces = edges.slice(0, -1).map((v, i) => [v, edges[i + 1]]);
      if ((pieces.every(([a, b]) => b - a <= most + 1e-9 && b - a > STAND.tab[2] + 1)) || n > 200) {
        spans.push(...pieces);
        break;
      }
    }
  }
  return spans;
}

/** The canopy in pieces no longer than a section. */
export const canopySpans = (g) => sectionSpans(g);
/** Where the canopy posts stand, along the front: at both ends and at every section joint. */
export function postPlaces(g) {
  const spans = sectionSpans(g);
  return [0, ...spans.map(([, b]) => b)].map((at, i, all) => (i === 0 ? at + STAND.post : i === all.length - 1 ? at - STAND.post : at));
}

/**
 * The grandstand, built: each section in its place, x along the front from
 * its left end (for a curve, the arc unrolled onto the curve), y from the
 * front back, z up. Parts as the building kit has them.
 */
/**
 * A stand of frames: the rows as decks, each from its front to its back, its
 * top at the row's height; under each a frame along its front and its back
 * and one across each end, standing on the base board; at an aisle, steps on
 * each deck up to the next. All along x in the sections' pieces.
 */
function framedRows(g) {
  const s = STAND.shell;
  return Array.from({ length: g.rows }, (_, i) => ({ i, y0: i === 0 ? 0 : s + i * g.rowDepth, y1: s + (i + 1) * g.rowDepth, z: g.frontHeight + i * g.rowRise }));
}
/** A stand of frames in pieces along it: its decks and frames print flat, so only as many as the plate needs. */
const framedSpans = (g) => {
  const n = Math.max(1, Math.ceil(g.length / STAND.framed.longest - 1e-9));
  return Array.from({ length: n }, (_, i) => [(i * g.length) / n, ((i + 1) * g.length) / n]);
};
function framedLayout(g) {
  const sections = framedSpans(g);
  const n = sections.length;
  const k = (i) => (n > 1 ? ' ' + (i + 1) + ' of ' + n : '');
  const parts = sections.map((_, i) => ({ id: 'base-' + (i + 1), name: 'Base board' + k(i), role: 'buildingBase' }));
  for (const r of framedRows(g)) {
    sections.forEach((_, i) => parts.push({ id: 'deck-' + (r.i + 1) + '-' + (i + 1), name: 'Deck, row ' + (r.i + 1) + k(i), role: 'floor' }));
    for (const side of ['front', 'back']) sections.forEach((_, i) => parts.push({ id: 'frame-' + (r.i + 1) + '-' + side + '-' + (i + 1), name: 'Frame, row ' + (r.i + 1) + ', ' + side + k(i), role: 'frame' }));
    for (const end of ['left', 'right']) parts.push({ id: 'frame-' + (r.i + 1) + '-' + end, name: 'Frame, row ' + (r.i + 1) + ', ' + end, role: 'frame' });
  }
  aisleSpans(g).forEach((_, a) => {
    for (let i = 0; i + 1 < g.rows; i++) parts.push({ id: 'steps-' + (a + 1) + '-' + (i + 1), name: 'Steps, aisle ' + (a + 1) + ', row ' + (i + 1) + ' to ' + (i + 2), role: 'wall' });
  });
  const counts = {};
  for (const b of woodBenches(g)) {
    const c = (counts[b.row] = (counts[b.row] ?? 0) + 1);
    for (const key of benchKeys(g)) parts.push({ id: 'bench-' + b.row + '-' + c + '-' + key, name: benchName(key, b.row, c), role: key.startsWith('end') ? 'frame' : 'wall' });
  }
  return { building: g, parts, sections };
}
function buildFramed(wasm, g) {
  const { Manifold, CrossSection } = wasm;
  const temp = [];
  const own = (m) => (temp.push(m), m);
  const { box, poly, sweep, truss } = kitShapes(wasm, own);
  const F = STAND.framed,
    W = STAND.wood;
  const sections = framedSpans(g);
  const L = g.length,
    D = standDepth(g) - STAND.shell; // the back of the last row
  const parts = [];
  try {
    const zb = F.base;
    // The base board under it all.
    sections.forEach(([a, c], i) => parts.push({ id: 'base-' + (i + 1), name: 'Base board' + (sections.length > 1 ? ' ' + (i + 1) + ' of ' + sections.length : ''), role: 'buildingBase', solid: box(a, 0, 0, c, D, zb), lie: [0, 0, 0], apart: [0, 0, -10] }));
    const k = (i) => (sections.length > 1 ? ' ' + (i + 1) + ' of ' + sections.length : '');
    // A frame between u0 and u1 (along it), from the base board to under a deck: braced if it is high enough, a board if not.
    const frameCs = (len, high) => (high >= F.truss ? truss(len, high, { member: F.member, brace: F.brace, bay: F.bay, tab: [2, 0] }).shape : poly([[0, 0], [len, 0], [len, high], [0, high]]));
    const [pw, gw, gd] = W.plank;
    for (const r of framedRows(g)) {
      const under = r.z - F.deck,
        high = under - zb;
      // The deck: planks along the row, a groove between each two; it prints the right way up.
      sections.forEach(([a, c], i) => {
        let deck = box(a, r.y0, under, c, r.y1, r.z);
        const grooves = [];
        for (let y = r.y0 + pw; y < r.y1 - 1; y += pw) grooves.push(box(a - 1, y - gw / 2, r.z - gd, c + 1, y + gw / 2, r.z + 1));
        if (grooves.length) deck = own(deck.subtract(own(Manifold.union(grooves))));
        parts.push({ id: 'deck-' + (r.i + 1) + '-' + (i + 1), name: 'Deck, row ' + (r.i + 1) + k(i), role: 'floor', solid: deck, lie: [0, 0, 0], apart: [0, 0, 12 + r.i * 6] });
        // Along its front and its back, inside its ends.
        for (const [side, y0, out] of [['front', r.y0, [0, -1, 0]], ['back', r.y1 - F.frame, [0, 1, 0]]]) {
          const a0 = i === 0 ? a + F.frame : a,
            c0 = i === sections.length - 1 ? c - F.frame : c;
          const solid = sweep(frameCs(c0 - a0, high), [1, 0, 0], [0, 0, 1], [a0, y0, zb], [0, 1, 0], 0, F.frame);
          parts.push({ id: 'frame-' + (r.i + 1) + '-' + side + '-' + (i + 1), name: 'Frame, row ' + (r.i + 1) + ', ' + side + k(i), role: 'frame', solid, outward: out, apart: [0, out[1] * 6, 0] });
        }
      });
      // Across each end, from front to back of the deck.
      for (const [end, x0, out] of [['left', 0, [-1, 0, 0]], ['right', L - F.frame, [1, 0, 0]]]) {
        const solid = sweep(frameCs(r.y1 - r.y0, high), [0, 1, 0], [0, 0, 1], [x0, r.y0, zb], [1, 0, 0], 0, F.frame);
        parts.push({ id: 'frame-' + (r.i + 1) + '-' + end, name: 'Frame, row ' + (r.i + 1) + ', ' + end, role: 'frame', solid, outward: out, apart: [out[0] * 6, 0, 0] });
      }
    }
    // At an aisle, steps on each deck at its back, up to the next deck; each prints on its side.
    const rows = framedRows(g),
      [rise, tread] = F.step;
    aisleSpans(g).forEach(([p, q], a) => {
      for (let i = 0; i + 1 < rows.length; i++) {
        const lo = rows[i],
          hi = rows[i + 1];
        const n = Math.max(1, Math.ceil((hi.z - lo.z) / rise - 1e-9)),
          h = (hi.z - lo.z) / n;
        // The steps in (y, z): n - 1 steps up towards the next deck, against its front frame; the next deck is the last step.
        const yb = hi.y0;
        const outline = [[yb - (n - 1) * tread, lo.z]];
        for (let j = 1; j < n; j++) outline.push([yb - (n - j) * tread, lo.z + j * h], [yb - (n - j - 1) * tread, lo.z + j * h]);
        outline.push([yb, lo.z]);
        if (n < 2) continue;
        const solid = sweep(poly(outline), [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], p + 1, q - 1);
        parts.push({ id: 'steps-' + (a + 1) + '-' + (i + 1), name: 'Steps, aisle ' + (a + 1) + ', row ' + (i + 1) + ' to ' + (i + 2), role: 'wall', solid, outward: [-1, 0, 0], apart: [0, -6, 6] });
      }
    });
    // The wooden benches on the decks.
    const counts = {};
    for (const b of woodBenches(g)) {
      const c = (counts[b.row] = (counts[b.row] ?? 0) + 1);
      for (const q of plankBench(wasm, own, { x0: b.x0, x1: b.x1, y0: b.y0, z0: b.z0, depth: W.depth, seat: W.seat, back: g.backrests ? W.back : 0, inset: W.inset }))
        parts.push({ id: 'bench-' + b.row + '-' + c + '-' + q.key, name: benchName(q.key, b.row, c), role: q.key.startsWith('end') ? 'frame' : 'wall', solid: q.solid, ...q.pose });
    }
    const order = framedLayout(g).parts.map((p) => p.id);
    parts.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
    const keep = new Set(parts.map((p) => p.solid));
    for (const m of temp) if (!keep.has(m)) m.delete();
    return parts;
  } catch (e) {
    for (const m of temp) m.delete();
    throw e;
  }
}

/** A part of the upper tier: its id and name marked so. */
const upperPart = (p) => ({ ...p, id: 'upper-' + p.id, name: 'Upper tier, ' + p.name[0].toLowerCase() + p.name.slice(1) });

export function buildGrandstand(wasm, input) {
  const { Manifold, CrossSection } = wasm;
  const { building: g, sections } = grandstandLayout(input);
  if (g.build === 'frames') return buildFramed(wasm, g);
  if (g.upperTier) {
    const { lower, upper, behind } = tiers(g);
    const below = buildGrandstand(wasm, lower);
    let above;
    try {
      above = buildGrandstand(wasm, upper);
    } catch (e) {
      for (const p of below) p.solid.delete();
      throw e;
    }
    // The upper tier behind the lower one, set apart further back when the parts are spread.
    return [
      ...below,
      ...above.map((p) => {
        const solid = p.solid.translate([0, behind, 0]);
        p.solid.delete();
        return { ...upperPart(p), solid, apart: [p.apart?.[0] ?? 0, (p.apart?.[1] ?? 0) + 30, p.apart?.[2] ?? 0] };
      }),
    ];
  }
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const cs = (rects) => own(new CrossSection(rects.map(([a, b, c, d]) => [[a, b], [c, b], [c, d], [a, d]]), 'Positive'));
  const parts = [];
  try {
    // The shell with its benches; or, for an aisle, bare: its half steps are added each on its own.
    // The grooves between the planks of the rows, cut from the top of each.
    const grooved = (section, p) => (p.grooves.length ? own(section.subtract(own(new CrossSection(p.grooves.map((t) => [t[0], t[1], t[2]]), 'NonZero')))) : section);
    const shape = (aisle, withTop = true) => {
      const p = profile(g, aisle);
      let section = p.hollow.length ? own(cs(p.solid).subtract(cs(p.hollow))) : cs(p.solid);
      section = grooved(section, p);
      if (withTop && p.top.length) section = own(section.add(cs(p.top)));
      return section;
    };
    const halfSteps = profile(g, true).top;
    const plain = shape(false),
      bare = shape(true, false);
    // The profile closed, for the ends: the shell without its hollow; with
    // its side railing, where there is no staircase at that end.
    const { poly, sweep, truss, railing } = kitShapes(wasm, own);
    const closedFor = (end) => {
      const p = profile(g, false);
      let c = grooved(cs(p.solid), p);
      if (p.top.length) c = own(c.add(cs(p.top)));
      if (g.railings && !stairEnds(g).includes(end)) c = own(c.add(own(CrossSection.union(sideRail(g).map(poly)))));
      return c;
    };
    const closedStart = closedFor('left'),
      closedEnd = closedFor('right');
    // Raised: the shell and all on it stand on the frames.
    const up = (m) => (g.raised ? own(m.translate([0, 0, g.raised])) : m);
    const aisles = aisleSpans(g);
    const D = standDepth(g),
      H = wallTop(g);
    // The stretches of one section: seats and aisles, each its own profile.
    const stretches = ([a, b]) => {
      const out = [];
      let at = a;
      for (const [p, q] of aisles) {
        if (q <= a || p >= b) continue;
        if (p > at) out.push([at, p, false]);
        out.push([Math.max(p, a), Math.min(q, b), true]);
        at = Math.min(q, b);
      }
      if (at < b) out.push([at, b, false]);
      return out;
    };
    // A straight run of the profile from x0 to x1: the profile in (y, z), along x.
    const straightRun = (section, x0, x1) =>
      own(own(section.extrude(x1 - x0)).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, x0, 0, 0, 1]));
    // On a curve: the profile in (r, z) turned round the centre through the
    // angle of the stretch. Facing in, the front is at the radius; facing
    // out, the back is, and the profile is mirrored.
    const R = g.curve?.radius ?? 0;
    const radial = (section) => {
      if (g.curve.facing === 'in') return own(section.translate([R, 0]));
      return own(own(section.mirror([1, 0])).translate([R, 0]));
    };
    const curvedRun = (section, x0, x1) => {
      const deg = ((x1 - x0) / R) * (180 / Math.PI);
      const swept = own(Manifold.revolve(radial(section), Math.max(3, Math.ceil(deg / 2)), deg));
      return own(swept.rotate([0, 0, (x0 / R) * (180 / Math.PI)]));
    };
    const run = g.curve ? curvedRun : straightRun;
    // The tabs that join one section to the next: in the back wall and in
    // the parapet, reaching from the end of a section into the next.
    const [tt, th, tl] = STAND.tab,
      pl = STAND.tabPlay;
    // A low front wall takes a shorter tab, or none.
    const fw = frontWall(g),
      fth = Math.min(th, fw - 3);
    const tabProfile = (grow) =>
      cs([
        ...(fth >= 3 ? [[STAND.shell / 2 - tt / 2 - grow, fw / 2 - fth / 2 - grow, STAND.shell / 2 + tt / 2 + grow, fw / 2 + fth / 2 + grow]] : []),
        [D - STAND.shell / 2 - tt / 2 - grow, H / 2 - th / 2 - grow, D - STAND.shell / 2 + tt / 2 + grow, H / 2 + th / 2 + grow],
      ]);
    const tabs = tabProfile(0),
      sockets = tabProfile(pl);
    sections.forEach(([a, b], i) => {
      // An aisle: the bare rows, and on each a half step. A section prints
      // standing on its start, and every aisle begins a section, so its half
      // steps stand on the plate. Benches with backs beginning again after an
      // aisle would stand out over it: each begins with a 45° slope.
      const slopedRun = (tops) => (p, q, from = p) => {
        const pieces = [run(bare, p, q)];
        for (const [y0, z0, y1, z1] of tops) {
          let step = run(cs([[y0, z0, y1, z1]]), p, q);
          if (g.curve) {
            const th = from / R;
            step = own(step.trimByPlane([-Math.sin(th), Math.cos(th), -1], -z0 / Math.SQRT2));
          } else step = own(step.trimByPlane([1, 0, -1], (from - z0) / Math.SQRT2));
          if (!step.isEmpty()) pieces.push(step);
        }
        return own(Manifold.union(pieces));
      };
      const aisleRun = (p, q) => own(Manifold.union([run(bare, p, q), ...halfSteps.map(([y0, z0, y1, z1]) => run(cs([[y0, z0, y1, z1]]), p, q))])),
        benchRun = slopedRun(profile(g, false).top);
      // Each stretch overlaps the next a hair, so on a curve two never meet face to face.
      const eps = 0.02;
      let body = own(
        Manifold.union(stretches([a, b]).map(([p, q, aisle]) => {
          const p0 = p > a ? p - eps : p,
            q0 = q < b ? q + eps : q;
          if (aisle) return aisleRun(p0, q0);
          // After an aisle (a stretch that does not begin the section), backs would stand out over it.
          return g.backrests && g.benchStyle === 'block' && p > a ? benchRun(p0, q0, p) : run(plain, p0, q0);
        })),
      );
      if (i < sections.length - 1) body = own(body.add(run(tabs, b - 0.01, b + tl)));
      if (i > 0) body = own(body.subtract(run(sockets, a - 0.01, a + tl + 0.2)));
      // The first section is closed at its start, the end it prints on.
      if (i === 0) body = own(body.add(run(closedStart, a, a + STAND.shell)));
      // Where a slope meets a facet of a curve it can leave a speck of nothing: only the section is kept.
      const bodies = body.decompose();
      if (bodies.length > 1) {
        const kept = bodies.filter((piece) => piece.volume() > 1);
        for (const piece of bodies) if (!kept.includes(piece)) piece.delete();
        kept.forEach(own);
        body = kept.length === 1 ? kept[0] : own(Manifold.union(kept));
      } else bodies[0].delete();
      // It prints standing on its end: on a curve, its start turned to lie on the plate.
      const startDeg = g.curve ? (a / R) * (180 / Math.PI) : 0;
      parts.push({
        id: 'stand-' + (i + 1),
        name: 'Grandstand section ' + (i + 1) + ' of ' + sections.length,
        role: 'wall',
        solid: up(body),
        // Straight: its start face down. Curved: turned so its start lies along x, then stood up on it.
        ...(g.curve ? { turn: [-startDeg, 90] } : { lie: [0, -90, 0] }),
        apart: g.curve ? [0, 0, 0] : [i * 8, 0, 0],
      });
    });
    // The far end closed by a panel of its own, glued on: printed on the
    // section it would have to bridge the hollow, so it prints flat.
    {
      const end = up(run(closedEnd, g.length, g.length + STAND.shell));
      const endDeg = g.curve ? (g.length / R) * (180 / Math.PI) : 0;
      parts.push({ id: 'end', name: 'End panel', role: 'wall', solid: end, ...(g.curve ? { turn: [-endDeg, 90] } : { lie: [0, -90, 0] }), apart: g.curve ? [0, 0, 0] : [16, 0, 0] });
    }
    // The canopy: a plate over the rows on posts at the back, held by the back wall.
    if (g.roof === 'canopy') {
      const zTop = standHeight(g),
        front = -STAND.reach;
      const roofCs = cs([[front, zTop, D, zTop + STAND.roof]]);
      canopySpans(g).forEach(([a, b], i, all) => {
        const plate = run(roofCs, a, b);
        parts.push({ id: 'canopy-' + (i + 1), name: 'Canopy' + (all.length > 1 ? ' ' + (i + 1) + ' of ' + all.length : ''), role: 'roof', solid: plate, lie: [0, 0, 0], apart: [0, 0, 30] });
      });
      // Posts under the front edge of the canopy, standing on the table in front of the parapet.
      const postCs = cs([[front + 1, 0, front + 1 + STAND.post, zTop]]);
      postPlaces(g).forEach((at, i) => {
        const post = run(postCs, at - STAND.post / 2, at + STAND.post / 2);
        parts.push({ id: 'post-' + (i + 1), name: 'Canopy post ' + (i + 1), role: 'frame', solid: post, lie: [0, 90, 0], apart: [0, -20, 15] });
      });
    }
    const s = STAND.shell;
    // The frames of a raised stand: braced, printing flat. Along the front
    // and the back under the parapet and the back wall; across, standing
    // between them, each with its top in the hollow of the shell, which holds it square.
    if (g.raised > 0) {
      const { member, brace, bay, play } = STAND.frame;
      const frame = (len) => truss(len, g.raised, { member, brace, bay, tab: [2, 0] }).shape;
      const { along, across } = frameSpans(g);
      along.forEach(([a, b], i) => {
        const shape = frame(b - a);
        parts.push({ id: 'frame-front-' + (i + 1), name: 'Frame, front ' + (i + 1), role: 'frame', solid: sweep(shape, [1, 0, 0], [0, 0, 1], [a, 0, 0], [0, 1, 0], 0, s), outward: [0, -1, 0], apart: [0, -15, 0] });
        parts.push({ id: 'frame-back-' + (i + 1), name: 'Frame, back ' + (i + 1), role: 'frame', solid: sweep(shape, [1, 0, 0], [0, 0, 1], [a, D - s, 0], [0, 1, 0], 0, s), outward: [0, 1, 0], apart: [0, 15, 0] });
      });
      const hollow = profile(g, false).hollow.map(([y0, z0, y1, z1]) => [y0, Math.max(z0, -1) + g.raised, y1, z1 + g.raised]);
      const plug = own(cs(hollow).offset(-play, 'Miter'));
      const cross = own(CrossSection.union([own(frame(D - 2 * s).translate([s, 0])), plug]));
      across.forEach((x, i) => {
        parts.push({ id: 'frame-' + (i + 1), name: 'Cross frame ' + (i + 1), role: 'frame', solid: sweep(cross, [0, 1, 0], [0, 0, 1], [x, 0, 0], [1, 0, 0], 0, s), outward: [-1, 0, 0], apart: [0, 0, -10] });
      });
    }
    // A staircase up an end, from the table to the last row: steps on a
    // slab, a post under the top, a wall on its outer side. Its profile in
    // (y, z), swept across its width; it prints on its side.
    if (stairEnds(g).length) {
      const { top, steps, rise, tread: t, y0 } = standStair(g);
      const { width: S, slab, post, wall: [pt, ph] } = STAND.stair;
      const outline = [[D, top], [y0 + (steps - 1) * t, top]];
      for (let k = steps - 1; k >= 1; k--) outline.push([y0 + k * t, k * rise], [y0 + (k - 1) * t, k * rise]);
      // Under the steps a slab, as thick as `slab` square to them, up to the post under the top.
      const slope = rise / t,
        drop = slab * Math.hypot(1, slope);
      const zUnder = top - slab,
        yPost = D - post;
      const foot = y0 + drop / slope,
        meet = Math.min(y0 + (zUnder + drop) / slope, yPost);
      outline.push([y0, 0], [foot, 0], [meet, zUnder], [yPost, zUnder], [yPost, 0], [D, 0]);
      const steps2d = poly(outline);
      // Its wall follows the slab under the steps, open below it as they are.
      const side = poly([[y0, 0], [foot, 0], [meet, zUnder], [yPost, zUnder], [yPost, 0], [D, 0], [D, top + ph], [y0 + (steps - 1) * t, top + ph], [y0, rise + ph]]);
      const left = own(Manifold.union([sweep(steps2d, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], -S + pt - 0.01, 0), sweep(side, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], -S, -S + pt)]));
      for (const end of stairEnds(g)) {
        const right = end === 'right';
        const solid = right ? own(own(left.mirror([1, 0, 0])).translate([g.length + s, 0, 0])) : left;
        parts.push({ id: 'stair-' + end, name: 'Staircase, ' + end, role: 'wall', solid, outward: [right ? -1 : 1, 0, 0], apart: [right ? 20 : -20, 0, 0] });
      }
    }
    // The back railing: a panel per section glued on the back of the back
    // wall, its band down the wall, rising above it as high as the side railings.
    if (g.railings) {
      const { height: RH, bar, glue } = STAND.rail;
      const spec = { thick: bar, band: glue, post: 3, height: glue + RH, pitch: 20, tab: 0.01, mid: true };
      const last = sections.length - 1;
      sections.forEach(([a, b], i) => {
        const len = (i === last ? b + s : b) - a;
        const { panel } = railing({ from: [a, D], dir: [1, 0], len, inward: [0, 1], z: standHeight(g) - glue, inset: 0, spec });
        parts.push({ id: 'rail-back-' + (i + 1), name: 'Back railing ' + (i + 1), role: 'wall', solid: panel, outward: [0, 1, 0], apart: [0, 15, 10] });
      });
    }
    // The wooden benches: planked seat and back on two end frames each, standing on the rows.
    {
      const counts = {};
      const W = STAND.wood;
      for (const b of woodBenches(g)) {
        const k = (counts[b.row] = (counts[b.row] ?? 0) + 1);
        for (const q of plankBench(wasm, own, { x0: b.x0, x1: b.x1, y0: b.y0, z0: b.z0, depth: W.depth, seat: W.seat, back: g.backrests ? W.back : 0, inset: W.inset }))
          parts.push({ id: 'bench-' + b.row + '-' + k + '-' + q.key, name: benchName(q.key, b.row, k), role: q.key.startsWith('end') ? 'frame' : 'wall', solid: q.solid, ...q.pose });
      }
    }
    const keep = new Set(parts.map((p) => p.solid));
    for (const x of temp) if (!keep.has(x)) x.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}
