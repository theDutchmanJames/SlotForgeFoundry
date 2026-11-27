// Shaped building kits: a rectangle, an L, U or T, an octagon or a round
// building of many sides, or an outline drawn wall by wall at any angle. Wall
// identities follow the boundary, including re-entrant corners. Storeys stand
// one on another, each on a floor with a groove for its walls; the roof on
// top is flat, or with no inside corners a hip roof, a cone on a round plan.
// This generator is deliberately separate from the existing rectangular/storey schema.
import { kitShapes } from './kit-shapes.js';
import { SHELL_FINISH_DEFAULTS, SHELL_OPENING_KEYS, SHELL_TEXTURE_DEFAULTS, checkShellFinish, checkShellOpening, checkShellTexture, finishShellWall, shellExtras, shellFrame, shellHole, trimOf } from './shell-details.js';
import { overOf, sideOf, underOf } from './opening-shapes.js';
import polygonClipping from 'polygon-clipping';
import { PROP_GAP, checkPropList, placeProp, propFootprint, propOf, propPartIds } from './props.js';

export const FOOTPRINT_DEFAULTS = Object.freeze({ kind: 'footprint', shape: 'L', width: 220, depth: 180, wing: 80, sides: 16, height: 75, baseHeight: 6, wall: 3, play: 0.2, roof: 3, overhang: 3, roofShape: 'flat', pitch: 30, domeRise: 40, teeth: 3, points: null, ...SHELL_FINISH_DEFAULTS, ...SHELL_TEXTURE_DEFAULTS, openings: [], upper: [], props: [], courtyards: [] });
export const SHAPES = Object.freeze(['rectangle', 'L', 'U', 'T', 'octagon', 'round', 'custom']);
/** A drawn outline: its walls at least this long, its corners at most this many, each turning at least `least` and at most `most` degrees. */
export const OUTLINE = Object.freeze({ shortest: 10, most: 48, size: [40, 1200], least: 3, turn: 90 });
/** A storey above: its height, its windows and doors, its finish. */
// jetty: how far its walls stand out past the walls below, on a floor that reaches out under them: a jettied storey.
export const FOOTPRINT_UPPER = Object.freeze({ height: 60, jetty: 0, openings: Object.freeze([]), ...SHELL_FINISH_DEFAULTS });
/** A jetty: at most this far out past the walls below. */
export const JETTY = 10;
/** Storeys: at most so many above the ground floor; the floor between, its groove and the frame under it. */
export const FLOORS = Object.freeze({ most: 3, slab: 4, groove: 2, lip: 2, lipDepth: 3 });
/** A pitched roof's pitch. */
export const PITCH = Object.freeze([10, 45]);
/** Courtyards: at most so many, each at least `least` across inside its walls, and `clear` from another wall's inside. */
export const COURTYARD = Object.freeze({ most: 4, least: 20, clear: 6 });

export function footprintPoints(b) {
  if (b.shape === 'custom') return b.points.map(([x, y]) => [x, y]);
  const W = b.width, D = b.depth, a = b.wing;
  if (b.shape === 'rectangle') return [[0, 0], [W, 0], [W, D], [0, D]];
  if (b.shape === 'L') return [[0, 0], [W, 0], [W, a], [a, a], [a, D], [0, D]];
  if (b.shape === 'U') return [[0, 0], [W, 0], [W, D], [W - a, D], [W - a, a], [a, a], [a, D], [0, D]];
  if (b.shape === 'octagon') {
    // Its corners cut at 45°, as much as makes the sides equal on a square.
    const c = Math.min(W, D) / (2 + Math.SQRT2);
    return [[c, 0], [W - c, 0], [W, c], [W, D - c], [W - c, D], [c, D], [0, D - c], [0, c]];
  }
  if (b.shape === 'round') {
    // So many sides round an ellipse W by D, one of them facing the front.
    const n = b.sides, start = -Math.PI / 2 - Math.PI / n;
    const pts = Array.from({ length: n }, (_, k) => [W / 2 + (W / 2) * Math.cos(start + (2 * Math.PI * k) / n), D / 2 + (D / 2) * Math.sin(start + (2 * Math.PI * k) / n)]);
    const x0 = Math.min(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1]));
    return pts.map(([x, y]) => [Math.round((x - x0) * 1e6) / 1e6, Math.round((y - y0) * 1e6) / 1e6]);
  }
  return [[0, 0], [W, 0], [W, a], [(W + a) / 2, a], [(W + a) / 2, D], [(W - a) / 2, D], [(W - a) / 2, a], [0, a]];
}
/** A courtyard's shapes: as an outline's, or drawn in Draw. */
export const COURTYARD_SHAPES = Object.freeze(['rectangle', 'octagon', 'round', 'custom']);
/**
 * A courtyard's ring on the plan: its corners the other way round from the
 * outline's, so its walls' inside faces the building, wall 1 running from
 * its corner nearest the left front along its left side. A drawn one keeps
 * its corners as they were drawn.
 */
export function courtyardPoints(c) {
  if (c.shape === 'custom') return c.points.map(([x, y]) => [x, y]);
  const pts = footprintPoints({ shape: c.shape ?? 'rectangle', width: c.width, depth: c.depth, sides: c.sides ?? 16 }).map(([x, y]) => [x + c.x, y + c.y]);
  return [pts[0], ...pts.slice(1).reverse()];
}
/** The rings of the plan: the outline, then each courtyard's. */
export function footprintRings(b) {
  return [footprintPoints(b), ...(b.courtyards ?? []).map(courtyardPoints)];
}
/**
 * The walls, round the outline and then round each courtyard: each with its
 * ring, where it starts and ends, its length, its direction and the way into
 * the building. A courtyard's walls face out into the courtyard.
 */
export function footprintWalls(b) {
  return wallsOf(footprintRings(b));
}
/** The walls of a storey: round the outline and the courtyards moved out by its jetties. */
export function storeyWalls(b, s) {
  return wallsOf(ringsOffset(b, s?.out ?? 0));
}
function wallsOf(rings) {
  return rings.flatMap((points, r) =>
    points.map((a, i) => {
      const end = points[(i + 1) % points.length], dx = end[0] - a[0], dy = end[1] - a[1], length = Math.hypot(dx, dy);
      const id = r ? 'court-' + r + '-' + (i + 1) : 'edge-' + (i + 1), name = r ? 'Courtyard ' + r + ', wall ' + (i + 1) : 'Wall ' + (i + 1);
      return { id, name, ring: r, index: i, a, end, length, dir: [dx / length, dy / length], inward: [-dy / length, dx / length] };
    }),
  );
}
// Each corner moved out by `amount` (in, when negative) from both its walls,
// preserving the boundary's vertex order: a mitre. The outline only.
export function footprintOffset(b, amount) {
  return offsetPoints(footprintPoints(b), amount);
}
/** Every ring moved out by `amount`, away from the building: the outline outward, a courtyard's into it. */
export function ringsOffset(b, amount) {
  return footprintRings(b).map((r) => offsetPoints(r, amount));
}
export function offsetPoints(points, amount) {
  const n = points.length;
  return points.map((a, i) => {
    const inward = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); return [-dy / l, dx / l]; };
    const m = inward(points[(i + n - 1) % n], a), w = inward(a, points[(i + 1) % n]);
    const k = amount / (1 + m[0] * w[0] + m[1] * w[1]);
    return [a[0] - k * (m[0] + w[0]), a[1] - k * (m[1] + w[1])];
  });
}
const area = (pts) => pts.reduce((sum, p, i) => { const q = pts[(i + 1) % pts.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
// Whether two segments cross or touch, apart from a shared end.
function crosses(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const on = (p, q, r) => Math.min(p[0], q[0]) - 1e-9 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-9 && Math.min(p[1], q[1]) - 1e-9 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-9;
  const [o1, o2, o3, o4] = [o(a, b, c), o(a, b, d), o(c, d, a), o(c, d, b)];
  if (o1 !== o2 && o3 !== o4) return true;
  return (!o1 && on(a, b, c)) || (!o2 && on(a, b, d)) || (!o3 && on(c, d, a)) || (!o4 && on(c, d, b));
}
const simple = (pts) => pts.every((a, i) => pts.every((c, j) => {
  const n = pts.length;
  if (j <= i || j === i + 1 || (i === 0 && j === n - 1)) return true;
  return !crosses(a, pts[(i + 1) % n], c, pts[(j + 1) % n]);
}));
/** How far each corner turns, in degrees: left (outward) positive, an inside corner negative. */
export function cornerTurns(points) {
  const n = points.length;
  const dirs = points.map((p, i) => { const q = points[(i + 1) % n]; return Math.atan2(q[1] - p[1], q[0] - p[0]); });
  return dirs.map((d, i) => {
    let turn = ((d - dirs[(i + n - 1) % n]) * 180) / Math.PI;
    while (turn > 180) turn -= 360;
    while (turn <= -180) turn += 360;
    return turn;
  });
}
/**
 * Checks a drawn outline and moves it so its corner nearest the origin is at
 * 0, 0. Walls run any way, each at least OUTLINE.shortest long; a corner
 * turns at least a few degrees and at most 90°, so a wall's mitred end prints
 * without supports; the walls, `wall` thick, leave room inside.
 */
export function checkOutline(points, wall) {
  if (!Array.isArray(points) || points.length < 3 || points.length > OUTLINE.most || points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))
    throw Error('A drawn outline has 3 to ' + OUTLINE.most + ' corners.');
  const x0 = Math.min(...points.map((p) => p[0])), y0 = Math.min(...points.map((p) => p[1]));
  // Clear of the arithmetic's dust, so walls that meet square stay square, and 45° stays 45°.
  const pts = points.map(([x, y]) => [Math.round((x - x0) * 1e6) / 1e6, Math.round((y - y0) * 1e6) / 1e6]);
  checkRing(pts, wall, '', 'The outline');
  const w = Math.max(...pts.map((p) => p[0])), d = Math.max(...pts.map((p) => p[1]));
  if (Math.min(w, d) < OUTLINE.size[0] || Math.max(w, d) > OUTLINE.size[1]) throw Error('A drawn building is ' + OUTLINE.size[0] + ' to ' + OUTLINE.size[1] + ' mm across.');
  return { points: pts, width: w, depth: d };
}
/**
 * A ring of walls, wound so its inside is the building's: each wall at least
 * OUTLINE.shortest long, each corner turning at least a few degrees and at
 * most 90° so a wall's mitred end prints without supports, nothing crossing,
 * and room inside the walls, `wall` thick. `where` names whose walls they are.
 */
function checkRing(pts, wall, where, what) {
  const n = pts.length;
  const turns = cornerTurns(pts);
  for (let i = 0; i < n; i++) {
    const q = pts[(i + 1) % n], len = Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]);
    if (len < OUTLINE.shortest - 1e-6) throw Error(where + 'Wall ' + (i + 1) + ' is ' + (Math.round(len * 10) / 10) + ' mm: each wall is at least ' + OUTLINE.shortest + ' mm long.');
    if (Math.abs(turns[i]) < OUTLINE.least) throw Error(where + 'Walls ' + (i ? i : n) + ' and ' + (i + 1) + ' run on in one line: make them one wall.');
    if (Math.abs(turns[i]) > OUTLINE.turn + 1e-6) throw Error(where + 'The corner between walls ' + (i ? i : n) + ' and ' + (i + 1) + ' is too sharp: corners turn at most ' + OUTLINE.turn + '°.');
  }
  if (area(pts) <= 0 || !simple(pts)) throw Error(what + ' crosses itself.');
  // The inside of the walls: each wall still runs the same way, and nothing crosses.
  const inner = offsetPoints(pts, -wall - 1);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = inner[i], e = inner[(i + 1) % n];
    if ((b[0] - a[0]) * (e[0] - c[0]) + (b[1] - a[1]) * (e[1] - c[1]) <= 1) throw Error(where + 'Wall ' + (i + 1) + ' is too short for the walls beside it: there is no room inside.');
  }
  if (!simple(inner)) throw Error(where + 'Two walls are too close together: there is no room between them inside.');
}
/** The storeys of a shaped building, ground floor first: each its height, openings and finish, the height of its floor and of its top. */
export function footprintStoreys(b) {
  const out = [];
  let floor = b.baseHeight;
  let reach = 0;
  [{ height: b.height, openings: b.openings, wallTexture: b.wallTexture, wallTextures: b.wallTextures, lowerTexture: b.lowerTexture, lowerHeight: b.lowerHeight }, ...b.upper].forEach((s, i) => {
    // How far its walls stand out past the ground floor's: its jetty and those below it.
    reach += i ? s.jetty ?? 0 : 0;
    out.push({ ...s, n: i + 1, floor, top: floor + s.height, out: reach, suffix: i ? '-' + (i + 1) : '', label: i ? ', storey ' + (i + 1) : '' });
    floor += s.height + FLOORS.slab;
  });
  return out;
}
// A storey's windows and doors, checked against its walls and height.
function checkOpenings(openings, walls, height, where) {
  if (!Array.isArray(openings) || openings.length > 64) throw Error('Use at most 64 openings' + where + '.');
  const out = openings.map((o, i) => {
    if (!o || typeof o !== 'object' || Object.keys(o).some(k => !SHELL_OPENING_KEYS.includes(k))) throw Error('Invalid opening ' + (i + 1) + where);
    const w = walls.find(w => w.id === o.wall);
    if (!w || !['window', 'door'].includes(o.type)) throw Error('Choose a wall and an opening type.');
    const q = { ...o, sill: o.type === 'door' ? 0 : o.sill };
    if (![q.at, q.width, q.height, q.sill].every(Number.isFinite) || q.width < 8 || q.height < 8 || q.sill < 0) throw Error('Openings need positive sizes and a position above the floor.');
    const p = checkShellOpening(q, w.name);
    // A frame reaches past the sides and top of its opening: it keeps the same room.
    const t = trimOf(p);
    const side = sideOf(p);
    if (p.at - p.width / 2 - t - side < 9 || p.at + p.width / 2 + t + side > w.length - 9) throw Error(w.name + where + ': keep the opening' + (t ? ' and its frame' : '') + (side ? (p.shutters ? ' and its shutters' : ' and its sill and lintel') : '') + ' at least 9 mm from each corner.');
    if (p.sill + p.height + t + overOf(p) > height - 6 + (p.lintel ? 4 : 0)) throw Error(w.name + where + ': leave at least 6 mm above the opening' + (t ? ' and its frame' : '') + (p.lintel ? ', 2 mm above its lintel' : '') + '.');
    return p;
  });
  out.forEach((o, i) => out.slice(i + 1).forEach(p => {
    if (p.wall !== o.wall) return;
    const across = Math.abs(p.at - o.at) - (p.width + o.width) / 2 - sideOf(p) - sideOf(o);
    const vertical = Math.max(p.sill - o.sill - o.height - overOf(o) - underOf(p), o.sill - p.sill - p.height - overOf(p) - underOf(o));
    const t = trimOf(o) + trimOf(p);
    if (across < 6 + t && vertical < 6 + t) throw Error('Keep at least 6 mm between openings' + (t ? ' and their frames' : '') + where + '.');
  }));
  return out;
}
export function validateFootprint(input) {
  for (const key of Object.keys(input)) if (!Object.hasOwn(FOOTPRINT_DEFAULTS, key)) throw Error('Unknown footprint setting: ' + key);
  const b = { ...FOOTPRINT_DEFAULTS, ...input };
  if (!SHAPES.includes(b.shape)) throw Error('Choose a rectangular, L, U, T, octagonal or round footprint, or draw one.');
  if (!Number.isInteger(b.sides) || b.sides < 6 || b.sides > 32) throw Error('A round building has 6 to 32 sides.');
  // A drawn outline sets the width and the depth; the wing is not used.
  if (b.shape === 'custom') Object.assign(b, checkOutline(b.points, b.wall));
  else b.points = null;
  for (const [key, min, max] of [['width', b.shape === 'custom' ? OUTLINE.size[0] : 60, 1200], ['depth', b.shape === 'custom' ? OUTLINE.size[0] : 60, 1200], ['wing', 40, 500], ['height', 30, 180], ['baseHeight', 4, 20], ['wall', 2, 5], ['play', 0.1, 0.5], ['roof', 2, 5], ['overhang', 0, 12], ['pitch', ...PITCH], ['domeRise', 10, 300]]) {
    if (!Number.isFinite(b[key]) || b[key] < min || b[key] > max) throw Error(key + ' must be between ' + min + ' and ' + max + (key === 'pitch' ? '°.' : ' mm.'));
  }
  if (['rectangle', 'L', 'U', 'T'].includes(b.shape) && Math.min(b.width, b.depth) < 100) throw Error('A rectangular, L, U or T building is at least 100 mm wide and deep.');
  if (!['rectangle', 'custom', 'octagon', 'round'].includes(b.shape) && (b.wing > b.depth - 30 || b.wing > (b.shape === 'U' ? (b.width - 30) / 2 : b.shape === 'T' ? b.width - 60 : b.width - 30))) throw Error('The wing leaves too little room for the recess. Reduce the wing width or enlarge the building.');
  // A round building's walls are drawn too: their lengths and corners are checked as any outline's.
  if (b.shape === 'round' || b.shape === 'octagon') checkOutline(footprintPoints(b), b.wall);
  if (!['flat', 'hip', 'dome', 'sawtooth'].includes(b.roofShape)) throw Error('Choose a flat roof, a hip roof, a dome or a sawtooth.');
  if (b.roofShape === 'sawtooth') {
    if (!Number.isInteger(b.teeth) || b.teeth < 1 || b.teeth > 8) throw Error('A sawtooth roof has 1 to 8 teeth.');
    if (b.pitch > SAW.most) throw Error('A sawtooth\u2019s slopes are at most ' + SAW.most + '\u00b0, so its north lights stay low enough.');
    const { wd, h } = sawOf(b);
    if (wd < SAW.least) throw Error('The teeth are only ' + Math.round(wd * 10) / 10 + ' mm deep: at least ' + SAW.least + ' mm each, so fewer teeth.');
    if (h < SAW.light + 4) throw Error('The teeth are too low for their north lights: a steeper pitch, or fewer teeth.');
  }
  if (b.roofShape === 'dome') {
    if (cornerTurns(footprintPoints(b)).some((t) => t < 0)) throw Error('A dome goes on an outline without inside corners: an L, U or T, or a drawn outline with one, takes a flat roof.');
    if (b.domeRise > domeOf(b).a) throw Error('A dome rises at most as high as half its span, a half round: ' + Math.floor(domeOf(b).a) + ' mm.');
  }
  b.courtyards = checkCourtyards(b);
  if (b.courtyards.length && b.roofShape !== 'flat') throw Error('A building round a courtyard takes a flat roof.');
  if (b.roofShape === 'hip' && cornerTurns(footprintPoints(b)).some((t) => t < 0)) throw Error('A hip roof goes on an outline without inside corners: an L, U or T, or a drawn outline with one, takes a flat roof.');
  const walls = footprintWalls(b);
  checkShellTexture(b);
  Object.assign(b, checkShellFinish(b, walls.map((w) => w.id), b.height, ''));
  b.openings = checkOpenings(b.openings, walls, b.height, '');
  if (!Array.isArray(b.upper) || b.upper.length > FLOORS.most) throw Error('A shaped building has at most ' + FLOORS.most + ' storeys above the ground floor.');
  b.upper = b.upper.map((u, i) => {
    const where = ', storey ' + (i + 2);
    if (!u || typeof u !== 'object' || Object.keys(u).some((k) => !Object.hasOwn(FOOTPRINT_UPPER, k))) throw Error('Invalid storey ' + (i + 2) + '.');
    const s = { ...FOOTPRINT_UPPER, ...u };
    if (!Number.isFinite(s.height) || s.height < 30 || s.height > 180) throw Error('Storey ' + (i + 2) + ' is 30 to 180 mm high.');
    if (!Number.isFinite(s.jetty) || s.jetty < 0 || s.jetty > JETTY) throw Error('Storey ' + (i + 2) + ' stands out 0 to ' + JETTY + ' mm past the walls below.');
    return s;
  });
  // Each storey's windows and doors along its own walls, moved out by its jetties.
  if (b.upper.some((u) => u.jetty) && b.roofShape === 'dome') throw Error('A dome goes on walls that stand one above the other: no jetties under it.');
  footprintStoreys(b).slice(1).forEach((st, i) => {
    const s = b.upper[i], where = ', storey ' + (i + 2), mine = storeyWalls(b, st);
    if (st.out) {
      // Moved out, the outline and each courtyard keep their shape.
      try {
        ringsOffset(b, st.out).forEach((r, k) => checkRing(k ? [...r].reverse() : r, b.wall, '', k ? 'Courtyard ' + k : 'The outline'));
      } catch (e) {
        throw Error('Storey ' + (i + 2) + ' stands out too far: ' + e.message);
      }
    }
    Object.assign(s, checkShellFinish(s, mine.map((w) => w.id), s.height, where));
    s.openings = checkOpenings(s.openings, mine, s.height, where);
  });
  b.props = checkFootprintProps(b);
  return b;
}
/** A sawtooth: each tooth at least so deep; its north light's frame wide, its panes' bars this far apart; the slopes at most this steep. */
export const SAW = Object.freeze({ least: 25, light: 6, frame: 2, bar: 22, thick: 2, most: 35 });
/** The teeth across the outline from front to back: where they start, how deep each is, how high it rises. */
export function sawOf(b) {
  const jet = footprintStoreys(b).at(-1).out ?? 0;
  const pts = footprintOffset(b, jet + b.overhang);
  const ys = pts.map((p) => p[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const wd = (y1 - y0) / b.teeth;
  return { y0, y1, wd, h: wd * Math.tan((b.pitch * Math.PI) / 180) };
}
/** A dome: a cap of a sphere over the outline, its middle, the radius of its foot out past the corners, and its sphere. */
export const DOME = Object.freeze({ cone: 50, shell: 3 });
export function domeOf(b) {
  const pts = footprintOffset(b, b.overhang + (footprintStoreys(b).at(-1).out ?? 0));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const a = Math.max(...pts.map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
  const h = b.domeRise;
  return { c, a, h, R: (a * a + h * h) / (2 * h) };
}
/**
 * The courtyards on the plan: each a rectangle, an octagon or a round one of
 * so many sides, { shape, x, y, width, depth, sides }, or drawn, { shape:
 * 'custom', points } (its ring, its place and size following from it). Each
 * at least COURTYARD.least across, its walls as an outline's, inside the
 * building's walls with room for its own and COURTYARD.clear more, and as far
 * from every other courtyard.
 */
function checkCourtyards(b) {
  const list = b.courtyards ?? [];
  if (!Array.isArray(list) || list.length > COURTYARD.most) throw Error('A building has at most ' + COURTYARD.most + ' courtyards.');
  const inside = [closed(footprintOffset(b, -(2 * b.wall + COURTYARD.clear)))];
  const grown = [];
  return list.map((c, k) => {
    const name = 'Courtyard ' + (k + 1);
    if (!c || typeof c !== 'object' || Object.keys(c).some((key) => !['shape', 'x', 'y', 'width', 'depth', 'sides', 'points'].includes(key))) throw Error(name + ' has a shape, a place and a size.');
    const shape = c.shape ?? 'rectangle';
    if (!COURTYARD_SHAPES.includes(shape)) throw Error(name + ': choose a rectangular, octagonal or round courtyard, or draw one.');
    let q;
    if (shape === 'custom') {
      if (!Array.isArray(c.points) || c.points.length < 3 || c.points.length > OUTLINE.most || c.points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) throw Error(name + ' is drawn with 3 to ' + OUTLINE.most + ' corners.');
      const points = c.points.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
      const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
      q = { shape, x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys), points };
    } else {
      if (!['x', 'y', 'width', 'depth'].every((key) => Number.isFinite(c[key]))) throw Error(name + ' has a place and a size.');
      q = { shape, x: c.x, y: c.y, width: c.width, depth: c.depth, ...(shape === 'round' && { sides: c.sides ?? 16 }) };
      if (shape === 'round' && (!Number.isInteger(q.sides) || q.sides < 6 || q.sides > 32)) throw Error(name + ': a round courtyard has 6 to 32 sides.');
    }
    if (q.width < COURTYARD.least || q.depth < COURTYARD.least) throw Error(name + ' is at least ' + COURTYARD.least + ' mm across each way.');
    // Its walls as an outline's: its ring wound back the outline's way to check.
    const ring = courtyardPoints(q);
    checkRing([...ring].reverse(), b.wall, name + ': ', name);
    if (areaOf(polygonClipping.difference([closed(ring)], inside)) > 1e-6) throw Error(name + ' is too near a wall: keep it ' + COURTYARD.clear + ' mm inside the walls round it, with room for its own.');
    // Out to the outside of its walls and half the clearance more: none of these may meet.
    const mine = [closed(offsetPoints(ring, -(b.wall + COURTYARD.clear / 2)))];
    for (const [j, other] of grown.entries()) if (areaOf(polygonClipping.intersection(mine, other)) > 1e-6) throw Error(name + ' is too near courtyard ' + (j + 1) + ': keep their walls ' + COURTYARD.clear + ' mm apart.');
    grown.push(mine);
    return q;
  });
}
/** Whether a square on the plan lies in a courtyard, clear of the walls round it: on its paving. */
function inCourtyard(b, square) {
  return (b.courtyards ?? []).some((c) => areaOf(polygonClipping.difference(square, [closed(offsetPoints(courtyardPoints(c), PROP_GAP))])) < 1e-6);
}
/** The base's outline, out past the walls. */
const BASE_OUT = 3;
// The area of a polygon-clipping result.
const areaOf = (multi) => multi.reduce((sum, poly) => sum + poly.reduce((t, ring, k) => {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) twice += ring[i][0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * ring[i][1];
  return t + (k ? -1 : 1) * Math.abs(twice / 2);
}, 0), 0);
const closed = (points) => [...points, points[0]];
// A ring wound anticlockwise, or clockwise.
const twiceArea = (pts) => pts.reduce((sum, p, i) => sum + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0);
const ccw = (pts) => (twiceArea(pts) < 0 ? [...pts].reverse() : pts);
const cw = (pts) => (twiceArea(pts) > 0 ? [...pts].reverse() : pts);
/**
 * The props of a shaped building: each inside a storey, its footprint clear
 * of the walls all round however the outline turns, and under the floor
 * above; or outside on the table clear of the base; none on another.
 */
function checkFootprintProps(b) {
  const props = checkPropList(b.props);
  if (!props.length) return props;
  const storeys = footprintStoreys(b);
  const roomOf = (s) => ringsOffset(b, s.out - (b.wall + b.play + PROP_GAP)).map(closed),
    base = [closed(footprintOffset(b, BASE_OUT + PROP_GAP))];
  const placed = [];
  props.forEach((p, i) => {
    const name = 'Prop ' + (i + 1) + ', the ' + propOf(p.type).name.toLowerCase();
    const [fw, fd] = propFootprint(p.type, p.rotation);
    const box = [p.x, p.y, p.x + fw, p.y + fd];
    const square = [closed([[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]])];
    if (p.storey >= storeys.length) throw Error(name + ' stands on a storey the building has not got.');
    if (p.storey >= 0) {
      const s = storeys[p.storey], where = p.storey ? 'storey ' + (p.storey + 1) : 'the ground floor';
      if (areaOf(polygonClipping.difference(square, roomOf(s))) > 1e-6) throw Error(name + ' stands inside ' + where + ', ' + PROP_GAP + ' mm clear of its walls.');
      if (propOf(p.type).size[2] > s.height - FLOORS.lipDepth - 1) throw Error(name + ' is too tall for ' + where + ': ' + propOf(p.type).size[2] + ' mm under a ceiling ' + s.height + ' mm high.');
    } else if (inCourtyard(b, square)) {
      // Outside, in a courtyard: on its paving, the base, clear of the walls round it.
    } else {
      if (areaOf(polygonClipping.intersection(square, base)) > 1e-6) throw Error(name + ' stands on the table outside, or in a courtyard: keep it ' + PROP_GAP + ' mm clear of the base and the walls.');
      if (box[0] < -150 || box[1] < -150 || box[2] > b.width + 150 || box[3] > b.depth + 150) throw Error(name + ' stands at most 150 mm from the building.');
    }
    for (const q of placed)
      if (q.storey === p.storey && box[0] < q.box[2] + PROP_GAP && q.box[0] < box[2] + PROP_GAP && box[1] < q.box[3] + PROP_GAP && q.box[1] < box[3] + PROP_GAP)
        throw Error(name + ' stands on ' + q.name + ': keep them ' + PROP_GAP + ' mm apart.');
    placed.push({ storey: p.storey, box, name: 'prop ' + (i + 1) });
  });
  return props;
}
const frameName = (o, i, s) => (o.type === 'door' ? 'Door ' : 'Window ') + (i + 1) + ' frame' + s.label;
// The panels of a hip roof: one over each wall.
const roofPanels = (b) => (b.roofShape === 'hip' ? storeyWalls(b, footprintStoreys(b).at(-1)).filter((w) => !w.ring).map((w, i) => ({ id: 'roof-' + (i + 1), name: 'Roof panel ' + (i + 1), wall: w })) : []);
export function footprintLayout(input) {
  const b = validateFootprint(input);
  const walls = footprintWalls(b), storeys = footprintStoreys(b);
  const parts = [{ id: 'base', name: 'Shaped base', role: 'buildingBase' }];
  for (const s of storeys) {
    if (s.n > 1) parts.push({ id: 'floor' + s.suffix, name: 'Floor' + s.label, role: 'floor' }, { id: 'floor' + s.suffix + '-frame', name: 'Floor frame' + s.label, role: 'lip' });
    parts.push(...walls.map((w) => ({ id: w.id + s.suffix, name: w.name + s.label, role: 'wall' })));
    parts.push(...s.openings.flatMap((o, i) => (o.frame ? [{ id: 'frame-' + (i + 1) + s.suffix, name: frameName(o, i, s), role: 'frame' }] : [])));
  }
  if (b.roofShape === 'hip') parts.push(...roofPanels(b).map((p) => ({ id: p.id, name: p.name, role: 'roof' })));
  else if (b.roofShape === 'sawtooth')
    for (let k = 0; k < b.teeth; k++) {
      parts.push({ id: 'roof-' + (k + 1), name: 'Roof tooth ' + (k + 1), role: 'roof' });
      if (k < b.teeth - 1) parts.push({ id: 'light-' + (k + 1), name: 'North light ' + (k + 1), role: 'wall' });
    }
  else parts.push({ id: 'roof', name: b.roofShape === 'dome' ? 'Dome' : 'Shaped flat roof', role: 'roof' });
  parts.push(...propPartIds(b.props));
  return { building: b, storeys: [], doors: [], parts };
}

// A wall prints lying on its inside face: one at an angle is first turned square to the front.
const lay = (w) => {
  const out = w.inward.map((n) => -n);
  if (Math.abs(out[0]) < 1e-9 || Math.abs(out[1]) < 1e-9) return { outward: out };
  return { turn: [-90 - (Math.atan2(out[1], out[0]) * 180) / Math.PI, -90] };
};
export function buildFootprint(wasm, input, plate = null) {
  const b = validateFootprint(input), temp = [], result = [];
  const own = s => (temp.push(s), s);
  const { poly, box, sweep } = kitShapes(wasm, own);
  const { Manifold } = wasm;
  const walls = footprintWalls(b);
  // The plan out to an offset of every ring, the courtyards open: the outline wound one way, each courtyard the other.
  const region = (amount) => own(new wasm.CrossSection(ringsOffset(b, amount).map((r, k) => (k ? cw(r) : ccw(r))), 'Positive'));
  const storeys = footprintStoreys(b);
  const top = storeys.at(-1).top, jet = storeys.at(-1).out;
  // The top storey's walls, the roof's eaves over them.
  const topWalls = storeyWalls(b, storeys.at(-1));
  const room = plate ? [plate.width - 2 * (plate.margin ?? 0), plate.depth - 2 * (plate.margin ?? 0)] : [Infinity, Infinity];
  if (room.some(n => n < 40)) throw Error('Use a print plate with at least 40 mm usable width and depth.');
  const trim = (s, n, off) => own(s.trimByPlane(n, off));
  // A hip roof: over each wall a plane rising inward at the pitch from the outside of the wall at the eaves.
  const t = Math.tan((b.pitch * Math.PI) / 180), lenT = Math.hypot(t, 1);
  const hip = b.roofShape === 'hip', saw = b.roofShape === 'sawtooth';
  const teeth = saw ? sawOf(b) : null;
  const rise = hip ? t * Math.max(b.width, b.depth) : saw ? teeth.h + b.roof * lenT : 0;
  // Under a sawtooth each tooth's underside: rising from its front edge at the eaves; under a north light, up to its foot.
  const sawUnder = (k, y) => top + (y - teeth.y0 - k * teeth.wd) * t;
  const underRoof = (solid) => {
    if (saw) {
      const pieces = [];
      for (let k = 0; k < b.teeth; k++) {
        const a = teeth.y0 + k * teeth.wd, c = a + teeth.wd;
        const zone = sweep([[a, -1000], [c, -1000], [c, sawUnder(k, c)], [a, sawUnder(k, a)]], [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], -1000, 3000);
        const piece = own(solid.intersect(zone));
        if (!piece.isEmpty()) pieces.push(piece);
      }
      return pieces.length ? own(Manifold.union(pieces)) : solid;
    }
    if (!hip) return solid;
    for (const w of topWalls) solid = trim(solid, [t * w.inward[0], t * w.inward[1], -1], (t * (w.inward[0] * w.a[0] + w.inward[1] * w.a[1]) - top) / lenT);
    return solid;
  };
  // Flat panels split into labelled butt-jointed tiles. No overlap or internal duplicate walls.
  function tiles(solid, part, wall = null, [zLow, zHigh] = [b.baseHeight - 2, top]) {
    const bb = solid.boundingBox();
    const long = Math.max(...room), short = Math.min(...room);
    let segments;
    if (wall) {
      // Plane cuts along the wall and its height keep every panel printable, even on small beds; the top piece reaches up under the roof.
      const nx = plate ? Math.ceil((wall.length + 2 * b.wall) / long) : 1;
      const nz = plate ? Math.ceil((zHigh - zLow) / short) : 1;
      segments = [];
      for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) {
        const lo = -b.wall + x * (wall.length + 2 * b.wall) / nx, hi = -b.wall + (x + 1) * (wall.length + 2 * b.wall) / nx;
        const z0 = zLow + z * (zHigh - zLow) / nz, z1 = z === nz - 1 ? zHigh + rise + 10 : zLow + (z + 1) * (zHigh - zLow) / nz;
        const cutter = sweep([[lo, z0 - 0.00001], [hi, z0 - 0.00001], [hi, z1 + 0.00001], [lo, z1 + 0.00001]], [...wall.dir, 0], [0, 0, 1], [...wall.a, 0], [...wall.inward, 0], -b.wall - 1, 2 * b.wall + 1);
        segments.push(own(solid.intersect(cutter)));
      }
    } else {
      const dx = bb.max[0] - bb.min[0], dy = bb.max[1] - bb.min[1];
      const nx = plate ? Math.ceil(dx / room[0]) : 1, ny = plate ? Math.ceil(dy / room[1]) : 1;
      segments = [];
      for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) segments.push(own(solid.intersect(box(bb.min[0] + x * dx / nx, bb.min[1] + y * dy / ny, bb.min[2] - 1, bb.min[0] + (x + 1) * dx / nx, bb.min[1] + (y + 1) * dy / ny, bb.max[2] + 1))));
    }
    const pieces = [];
    for (const segment of segments) for (const piece of segment.decompose()) {
      if (piece.volume() > 0.001) pieces.push(piece); else piece.delete();
    }
    pieces.forEach((solid, i) => result.push({ ...part, solid, id: part.id + (pieces.length > 1 ? '-' + (i + 1) : ''), name: part.name + (pieces.length > 1 ? ' ' + (i + 1) + ' of ' + pieces.length : '') }));
  }
  // A ring between two offsets of the outline, from z0 up to z1.
  const ring = (outer, innerBy, z0, z1) => own(own(own(region(outer).subtract(region(innerBy))).extrude(z1 - z0)).translate([0, 0, z0]));
  try {
    const outer = poly(footprintOffset(b, BASE_OUT));
    const groove = ring(b.play, -b.wall - b.play, b.baseHeight - FLOORS.groove, b.baseHeight + 0.01);
    const base = own(own(outer.extrude(b.baseHeight)).subtract(groove));
    tiles(base, { id: 'base', name: 'Shaped base', role: 'buildingBase', lie: [0, 0, 0], apart: [0, 0, -12] });
    for (const s of storeys) {
      const lift = (s.n - 1) * 40;
      const last = s.n === storeys.length;
      // The floor under an upper storey: on the walls below, a groove on top for its walls, a frame under it inside the walls below.
      if (s.n > 1) {
        const under = s.floor - FLOORS.slab;
        // Out to its own walls, which stand out past those below by its jetty; its frame inside the walls below.
        const below = storeys[s.n - 2].out;
        const slab = own(own(own(region(s.out).extrude(FLOORS.slab)).translate([0, 0, under])).subtract(ring(s.out + b.play, s.out - b.wall - b.play, s.floor - FLOORS.groove, s.floor + 0.01)));
        tiles(slab, { id: 'floor' + s.suffix, name: 'Floor' + s.label, role: 'floor', lie: [0, 0, 0], apart: [0, 0, lift - 8] });
        const frame = ring(below - b.wall - b.play, below - b.wall - b.play - FLOORS.lip, under - FLOORS.lipDepth, under);
        tiles(frame, { id: 'floor' + s.suffix + '-frame', name: 'Floor frame' + s.label, role: 'lip', lie: [0, 0, 0], apart: [0, 0, lift - 16] });
      }
      const rings = ringsOffset(b, s.out), inners = ringsOffset(b, s.out - b.wall), mineWalls = storeyWalls(b, s);
      mineWalls.forEach((w) => {
        const outline = rings[w.ring], inner = inners[w.ring], i = w.index, j = (i + 1) % outline.length;
        // From the bottom of its groove up to the floor above, or the roof.
        let solid = own(own(poly([outline[i], outline[j], inner[j], inner[i]]).extrude(s.height + FLOORS.groove + (last && (hip || saw) ? rise + 2 : 0))).translate([0, 0, s.floor - FLOORS.groove]));
        if (last) solid = underRoof(solid);
        const mine = s.openings.filter(o => o.wall === w.id);
        for (const o of mine) {
          const z0 = o.type === 'door' ? s.floor - FLOORS.groove - 0.01 : s.floor + o.sill;
          const hole = o.shape && o.shape !== 'square' ? shellHole(wasm, own, o, w, s.floor, b.wall, sweep) : sweep([[o.at - o.width / 2, z0], [o.at + o.width / 2, z0], [o.at + o.width / 2, s.floor + o.sill + o.height], [o.at - o.width / 2, s.floor + o.sill + o.height]], [...w.dir, 0], [0, 0, 1], [...w.a, 0], [...w.inward, 0], -1, b.wall + 1);
          solid = own(solid.subtract(hole));
        }
        solid = finishShellWall(wasm, own, solid, w, { floor: s.floor, top: s.top, openings: mine }, b, s);
        solid = shellExtras(wasm, own, solid, w, { floor: s.floor, wall: b.wall, openings: mine }, b, s, sweep);
        tiles(solid, { id: w.id + s.suffix, name: w.name + s.label, role: 'wall', ...lay(w), apart: [-w.inward[0] * 20, -w.inward[1] * 20, 8 + lift] }, w, [s.floor - FLOORS.groove, s.top]);
      });
      // A frame prints face up, glued on round its opening.
      s.openings.forEach((o, i) => {
        if (!o.frame) return;
        const w = mineWalls.find((x) => x.id === o.wall);
        tiles(shellFrame(o, w, s.floor, { sweep, own, Manifold, wasm }), { id: 'frame-' + (i + 1) + s.suffix, name: frameName(o, i, s), role: 'frame', ...lay(w), apart: [-w.inward[0] * 28, -w.inward[1] * 28, 8 + lift] });
      });
    }
    const roofLift = (storeys.length - 1) * 40 + 30;
    if (saw) {
      // Each tooth a slope over its strip of the plan, out to the overhang, a north light between it and the
      // next, standing on the next tooth's low edge, framed round panes; each slope prints on its underside.
      const T = b.roof * lenT, lt = SAW.thick;
      const plan = own(own(poly(footprintOffset(b, jet + b.overhang)).extrude(rise + 400)).translate([0, 0, top - 200]));
      const inside = own(own(poly(footprintOffset(b, jet - b.wall - b.play)).extrude(rise + 400)).translate([0, 0, top - 200]));
      for (let k = 0; k < b.teeth; k++) {
        const a = teeth.y0 + k * teeth.wd, c = a + teeth.wd, last = k === b.teeth - 1;
        const end = last ? c : c - lt;
        const slope = sweep([[a, sawUnder(k, a)], [end, sawUnder(k, end)], [end, sawUnder(k, end) + T], [a, sawUnder(k, a) + T]], [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], -1000, 3000);
        const panel = own(slope.intersect(plan));
        // Longer than the plate, in pieces end to end.
        if (!panel.isEmpty()) tiles(panel, { id: 'roof-' + (k + 1), name: 'Roof tooth ' + (k + 1), role: 'roof', lie: [-b.pitch, 0, 0], apart: [0, 0, roofLift + k * 6] });
        if (last) continue;
        // The north light: from the next tooth's low edge up to this one's high edge, over the inside of the walls.
        const z1 = sawUnder(k, end) + T;
        let light = own(box(-1000, c - lt, top, 3000, c, z1).intersect(inside));
        if (light.isEmpty()) continue;
        const { min, max } = light.boundingBox();
        const panes = [];
        const n = Math.max(1, Math.round((max[0] - min[0] - SAW.frame) / SAW.bar));
        const step = (max[0] - min[0] - SAW.frame) / n;
        for (let q = 0; q < n; q++) panes.push(box(min[0] + SAW.frame + q * step, c - lt - 1, top + SAW.frame, min[0] + (q + 1) * step, c + 1, z1 - SAW.frame));
        light = own(light.subtract(own(Manifold.union(panes))));
        // Longer than the plate, cut in the middle of a bar: as few pieces as fit.
        const long = Math.max(...room), bars = Array.from({ length: n - 1 }, (_, q) => min[0] + SAW.frame / 2 + (q + 1) * step);
        const cuts = [];
        let from = min[0];
        while (max[0] - from > long) {
          const next = bars.filter((x) => x > from + 1 && x - from <= long).pop();
          if (next === undefined) throw Error('North light ' + (k + 1) + ' cannot be cut to fit the plate between its panes: a bigger plate, or another number of teeth.');
          cuts.push(next);
          from = next;
        }
        const edges = [min[0] - 1, ...cuts, max[0] + 1];
        const pieces = edges.slice(1).map((e, q) => own(light.intersect(box(edges[q], -1000, -1000, e, 3000, 3000)))).flatMap((piece) => piece.decompose().map(own));
        // Where the plan narrows it may come apart too: each piece its own.
        pieces.forEach((piece, i, all) => result.push({ id: 'light-' + (k + 1) + (all.length > 1 ? '-' + (i + 1) : ''), name: 'North light ' + (k + 1) + (all.length > 1 ? ', ' + (i + 1) + ' of ' + all.length : ''), role: 'wall', solid: piece, outward: [0, 1, 0], apart: [0, 0, roofLift + k * 6 + 3] }));
      }
    } else if (b.roofShape === 'dome') {
      // A cap of a sphere on the walls, trimmed to the outline and its overhang; hollowed by a cone
      // steeper than 45 degrees under it, all inside the shell, so it prints the right way up.
      const { c, a, h, R } = domeOf(b);
      const zc = top + h - R;
      const sphere = (r) => own(own(Manifold.sphere(r, 256)).translate([c[0], c[1], zc]));
      let dome = own(sphere(R).intersect(own(own(poly(footprintOffset(b, jet + b.overhang)).extrude(h + 2)).translate([0, 0, top]))));
      // The hollow: the widest cone steeper than 45 degrees that stays inside the shell, on the tops of
      // the walls, inside their inner faces; the solid round it is left to the slicer's infill.
      const inner = footprintOffset(b, -b.wall - b.play);
      const rIn = Math.min(...inner.map((p, i) => {
        const q = inner[(i + 1) % inner.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
        return Math.abs((c[0] - p[0]) * dy - (c[1] - p[1]) * dx) / l;
      }));
      const t = Math.tan((DOME.cone * Math.PI) / 180), Ri = R - DOME.shell;
      const fits = (rc) => {
        for (let k = 0; k <= 60; k++) {
          const r = (rc * k) / 60;
          if (top + (rc - r) * t > zc + Math.sqrt(Math.max(0, Ri * Ri - r * r))) return false;
        }
        return true;
      };
      let lo = 0, hi = rIn;
      for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      if (lo > 2) dome = own(dome.subtract(own(own(Manifold.cylinder(lo * t, lo, 0, 128)).translate([c[0], c[1], top - 0.01]))));
      const { min, max } = dome.boundingBox();
      const [x, y] = [max[0] - min[0], max[1] - min[1]];
      if (plate && !((x <= room[0] && y <= room[1]) || (x <= room[1] && y <= room[0]))) throw Error('The dome is ' + Math.round(x) + ' × ' + Math.round(y) + ' mm: too big for the plate. A dome prints whole: make the building smaller, or the roof flat.');
      result.push({ id: 'roof', name: 'Dome', role: 'roof', solid: dome, lie: [0, 0, 0], apart: [0, 0, roofLift] });
    } else if (!hip) {
      const roof = own(region(jet + b.overhang).extrude(b.roof)).translate([0, 0, top]); own(roof);
      tiles(roof, { id: 'roof', name: 'Shaped flat roof', role: 'roof', lie: [0, 0, 0], apart: [0, 0, roofLift] });
    } else {
      // Each panel: as thick as the roof over its plane, out to the overhang, kept to its side of the hips.
      const reach = own(own(poly(footprintOffset(b, jet + b.overhang)).extrude(rise + 200)).translate([0, 0, top - 100]));
      const planeOf = (w) => [t * w.inward[0], t * w.inward[1], top - t * (w.inward[0] * w.a[0] + w.inward[1] * w.a[1])];
      roofPanels(b).forEach(({ id, name, wall: w }) => {
        const [a, c, k] = planeOf(w);
        let panel = trim(reach, [-a, -c, 1], k / lenT);
        panel = trim(panel, [a, c, -1], -(k + b.roof * lenT) / lenT);
        for (const v of topWalls) {
          if (v === w) continue;
          // Where this plane is lower than the other's: the hip between them, square to the plan.
          const n = [v.inward[0] - w.inward[0], v.inward[1] - w.inward[1]], l = Math.hypot(...n);
          if (l < 1e-9) continue;
          panel = trim(panel, [n[0] / l, n[1] / l, 0], (v.inward[0] * v.a[0] + v.inward[1] * v.a[1] - (w.inward[0] * w.a[0] + w.inward[1] * w.a[1])) / l);
        }
        const bodies = panel.decompose();
        const kept = bodies.filter((q) => q.volume() > 0.5);
        bodies.filter((q) => !kept.includes(q)).forEach((q) => q.delete());
        kept.forEach(own);
        if (!kept.length) return;
        const solid = kept.length === 1 ? kept[0] : own(Manifold.union(kept));
        // Laid flat on its underside: turned so it rises along y, then down by its pitch.
        const part = { id, name, role: 'roof', solid, turn: [90 - (Math.atan2(w.inward[1], w.inward[0]) * 180) / Math.PI, -b.pitch], apart: [-w.inward[0] * 10, -w.inward[1] * 10, roofLift] };
        if (plate) {
          const printed = solid.rotate([0, 0, part.turn[0]]), flat = printed.rotate([part.turn[1], 0, 0]);
          const { min, max } = flat.boundingBox();
          printed.delete();
          flat.delete();
          const [x, y] = [max[0] - min[0], max[1] - min[1]];
          if (!((x <= room[0] && y <= room[1]) || (x <= room[1] && y <= room[0]))) throw Error(name + ' is ' + Math.round(x) + ' × ' + Math.round(y) + ' mm: too big for the plate. A hip roof prints whole: make the building smaller, or the roof flat.');
        }
        result.push({ ...part, solid: own(solid.translate([0, 0, 0])) });
      });
    }
    // Props: on a storey's floor, or on the table outside; each runs into nothing.
    const ids = propPartIds(b.props);
    let k = 0;
    b.props.forEach((p) => {
      const [fw, fd] = propFootprint(p.type, p.rotation);
      const square = [closed([[p.x, p.y], [p.x + fw, p.y], [p.x + fw, p.y + fd], [p.x, p.y + fd]])];
      // In a courtyard it stands on the base, its paving; outside, on the table.
      const z = p.storey >= 0 ? storeys[p.storey].floor : inCourtyard(b, square) ? b.baseHeight : 0;
      for (const q of placeProp(wasm, own, p, z)) {
        const id = ids[k++];
        for (const other of result) {
          if (/^prop-/.test(other.id)) continue;
          const both = q.solid.intersect(other.solid);
          const v = both.volume();
          both.delete();
          if (v > 0.01) throw Error(id.name + ' runs into the ' + other.name.toLowerCase() + ': move it.');
        }
        result.push({ ...id, solid: q.solid, turn: q.pose, apart: [0, 0, p.storey < 0 ? 0 : p.storey * 40 + 6] });
      }
    });
    // Every solid kept in a part is the part's own: nothing freed under it.
    for (const p of result) { const i = temp.indexOf(p.solid); if (i >= 0) temp.splice(i, 1); }
    return result;
  } catch (err) {
    result.forEach(p => { const i = temp.indexOf(p.solid); if (i >= 0) temp.splice(i, 1); p.solid.delete(); });
    throw err;
  } finally { temp.forEach(s => s.delete()); }
}
