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

export const FOOTPRINT_DEFAULTS = Object.freeze({ kind: 'footprint', shape: 'L', width: 220, depth: 180, wing: 80, sides: 16, height: 75, baseHeight: 6, wall: 3, play: 0.2, roof: 3, overhang: 3, roofShape: 'flat', pitch: 30, points: null, ...SHELL_FINISH_DEFAULTS, ...SHELL_TEXTURE_DEFAULTS, openings: [], upper: [], props: [] });
export const SHAPES = Object.freeze(['rectangle', 'L', 'U', 'T', 'octagon', 'round', 'custom']);
/** A drawn outline: its walls at least this long, its corners at most this many, each turning at least `least` and at most `most` degrees. */
export const OUTLINE = Object.freeze({ shortest: 10, most: 48, size: [40, 1200], least: 3, turn: 90 });
/** A storey above: its height, its windows and doors, its finish. */
export const FOOTPRINT_UPPER = Object.freeze({ height: 60, openings: Object.freeze([]), ...SHELL_FINISH_DEFAULTS });
/** Storeys: at most so many above the ground floor; the floor between, its groove and the frame under it. */
export const FLOORS = Object.freeze({ most: 3, slab: 4, groove: 2, lip: 2, lipDepth: 3 });
/** A pitched roof's pitch. */
export const PITCH = Object.freeze([10, 45]);

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
export function footprintWalls(b) {
  const points = footprintPoints(b);
  return points.map((a, i) => {
    const end = points[(i + 1) % points.length], dx = end[0] - a[0], dy = end[1] - a[1], length = Math.hypot(dx, dy);
    return { id: 'edge-' + (i + 1), name: 'Wall ' + (i + 1), a, end, length, dir: [dx / length, dy / length], inward: [-dy / length, dx / length] };
  });
}
// Each corner moved out by `amount` (in, when negative) from both its walls,
// preserving the boundary's vertex order: a mitre.
export function footprintOffset(b, amount) {
  return offsetPoints(footprintPoints(b), amount);
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
  const n = pts.length;
  const turns = cornerTurns(pts);
  for (let i = 0; i < n; i++) {
    const q = pts[(i + 1) % n], len = Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]);
    if (len < OUTLINE.shortest - 1e-6) throw Error('Wall ' + (i + 1) + ' is ' + (Math.round(len * 10) / 10) + ' mm: each wall is at least ' + OUTLINE.shortest + ' mm long.');
    if (Math.abs(turns[i]) < OUTLINE.least) throw Error('Walls ' + (i ? i : n) + ' and ' + (i + 1) + ' run on in one line: make them one wall.');
    if (Math.abs(turns[i]) > OUTLINE.turn + 1e-6) throw Error('The corner between walls ' + (i ? i : n) + ' and ' + (i + 1) + ' is too sharp: corners turn at most ' + OUTLINE.turn + '°.');
  }
  if (area(pts) <= 0 || !simple(pts)) throw Error('The outline crosses itself.');
  const w = Math.max(...pts.map((p) => p[0])), d = Math.max(...pts.map((p) => p[1]));
  if (Math.min(w, d) < OUTLINE.size[0] || Math.max(w, d) > OUTLINE.size[1]) throw Error('A drawn building is ' + OUTLINE.size[0] + ' to ' + OUTLINE.size[1] + ' mm across.');
  // The inside of the walls: each wall still runs the same way, and nothing crosses.
  const inner = offsetPoints(pts, -wall - 1);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = inner[i], e = inner[(i + 1) % n];
    if ((b[0] - a[0]) * (e[0] - c[0]) + (b[1] - a[1]) * (e[1] - c[1]) <= 1) throw Error('Wall ' + (i + 1) + ' is too short for the walls beside it: there is no room inside.');
  }
  if (!simple(inner)) throw Error('Two walls are too close together: there is no room between them inside.');
  return { points: pts, width: w, depth: d };
}
/** The storeys of a shaped building, ground floor first: each its height, openings and finish, the height of its floor and of its top. */
export function footprintStoreys(b) {
  const out = [];
  let floor = b.baseHeight;
  [{ height: b.height, openings: b.openings, wallTexture: b.wallTexture, wallTextures: b.wallTextures, lowerTexture: b.lowerTexture, lowerHeight: b.lowerHeight }, ...b.upper].forEach((s, i) => {
    out.push({ ...s, n: i + 1, floor, top: floor + s.height, suffix: i ? '-' + (i + 1) : '', label: i ? ', storey ' + (i + 1) : '' });
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
  for (const [key, min, max] of [['width', b.shape === 'custom' ? OUTLINE.size[0] : 60, 1200], ['depth', b.shape === 'custom' ? OUTLINE.size[0] : 60, 1200], ['wing', 40, 500], ['height', 30, 180], ['baseHeight', 4, 20], ['wall', 2, 5], ['play', 0.1, 0.5], ['roof', 2, 5], ['overhang', 0, 12], ['pitch', ...PITCH]]) {
    if (!Number.isFinite(b[key]) || b[key] < min || b[key] > max) throw Error(key + ' must be between ' + min + ' and ' + max + (key === 'pitch' ? '°.' : ' mm.'));
  }
  if (['rectangle', 'L', 'U', 'T'].includes(b.shape) && Math.min(b.width, b.depth) < 100) throw Error('A rectangular, L, U or T building is at least 100 mm wide and deep.');
  if (!['rectangle', 'custom', 'octagon', 'round'].includes(b.shape) && (b.wing > b.depth - 30 || b.wing > (b.shape === 'U' ? (b.width - 30) / 2 : b.shape === 'T' ? b.width - 60 : b.width - 30))) throw Error('The wing leaves too little room for the recess. Reduce the wing width or enlarge the building.');
  // A round building's walls are drawn too: their lengths and corners are checked as any outline's.
  if (b.shape === 'round' || b.shape === 'octagon') checkOutline(footprintPoints(b), b.wall);
  if (!['flat', 'hip'].includes(b.roofShape)) throw Error('Choose a flat roof or a hip roof.');
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
    Object.assign(s, checkShellFinish(s, walls.map((w) => w.id), s.height, where));
    s.openings = checkOpenings(s.openings, walls, s.height, where);
    return s;
  });
  b.props = checkFootprintProps(b);
  return b;
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
/**
 * The props of a shaped building: each inside a storey, its footprint clear
 * of the walls all round however the outline turns, and under the floor
 * above; or outside on the table clear of the base; none on another.
 */
function checkFootprintProps(b) {
  const props = checkPropList(b.props);
  if (!props.length) return props;
  const storeys = footprintStoreys(b);
  const room = [closed(footprintOffset(b, -(b.wall + b.play + PROP_GAP)))],
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
      if (areaOf(polygonClipping.difference(square, room)) > 1e-6) throw Error(name + ' stands inside ' + where + ', ' + PROP_GAP + ' mm clear of its walls.');
      if (propOf(p.type).size[2] > s.height - FLOORS.lipDepth - 1) throw Error(name + ' is too tall for ' + where + ': ' + propOf(p.type).size[2] + ' mm under a ceiling ' + s.height + ' mm high.');
    } else {
      if (areaOf(polygonClipping.intersection(square, base)) > 1e-6) throw Error(name + ' stands on the table outside: keep it ' + PROP_GAP + ' mm clear of the base.');
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
const roofPanels = (b) => (b.roofShape === 'hip' ? footprintWalls(b).map((w, i) => ({ id: 'roof-' + (i + 1), name: 'Roof panel ' + (i + 1), wall: w })) : []);
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
  else parts.push({ id: 'roof', name: 'Shaped flat roof', role: 'roof' });
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
  const outline = footprintPoints(b), inner = footprintOffset(b, -b.wall), walls = footprintWalls(b);
  const storeys = footprintStoreys(b);
  const top = storeys.at(-1).top;
  const room = plate ? [plate.width - 2 * (plate.margin ?? 0), plate.depth - 2 * (plate.margin ?? 0)] : [Infinity, Infinity];
  if (room.some(n => n < 40)) throw Error('Use a print plate with at least 40 mm usable width and depth.');
  const trim = (s, n, off) => own(s.trimByPlane(n, off));
  // A hip roof: over each wall a plane rising inward at the pitch from the outside of the wall at the eaves.
  const t = Math.tan((b.pitch * Math.PI) / 180), lenT = Math.hypot(t, 1);
  const hip = b.roofShape === 'hip';
  const rise = hip ? t * Math.max(b.width, b.depth) : 0;
  const underRoof = (solid) => {
    if (!hip) return solid;
    for (const w of walls) solid = trim(solid, [t * w.inward[0], t * w.inward[1], -1], (t * (w.inward[0] * w.a[0] + w.inward[1] * w.a[1]) - top) / lenT);
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
  const ring = (outer, innerBy, z0, z1) => own(own(own(poly(footprintOffset(b, outer)).subtract(poly(footprintOffset(b, innerBy)))).extrude(z1 - z0)).translate([0, 0, z0]));
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
        const slab = own(own(own(poly(footprintOffset(b, 0)).extrude(FLOORS.slab)).translate([0, 0, under])).subtract(ring(b.play, -b.wall - b.play, s.floor - FLOORS.groove, s.floor + 0.01)));
        tiles(slab, { id: 'floor' + s.suffix, name: 'Floor' + s.label, role: 'floor', lie: [0, 0, 0], apart: [0, 0, lift - 8] });
        const frame = ring(-b.wall - b.play, -b.wall - b.play - FLOORS.lip, under - FLOORS.lipDepth, under);
        tiles(frame, { id: 'floor' + s.suffix + '-frame', name: 'Floor frame' + s.label, role: 'lip', lie: [0, 0, 0], apart: [0, 0, lift - 16] });
      }
      walls.forEach((w, i) => {
        const j = (i + 1) % walls.length;
        // From the bottom of its groove up to the floor above, or the roof.
        let solid = own(own(poly([outline[i], outline[j], inner[j], inner[i]]).extrude(s.height + FLOORS.groove + (last && hip ? rise + 2 : 0))).translate([0, 0, s.floor - FLOORS.groove]));
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
        const w = walls.find((x) => x.id === o.wall);
        tiles(shellFrame(o, w, s.floor, { sweep, own, Manifold, wasm }), { id: 'frame-' + (i + 1) + s.suffix, name: frameName(o, i, s), role: 'frame', ...lay(w), apart: [-w.inward[0] * 28, -w.inward[1] * 28, 8 + lift] });
      });
    }
    const roofLift = (storeys.length - 1) * 40 + 30;
    if (!hip) {
      const roof = own(poly(footprintOffset(b, b.overhang)).extrude(b.roof)).translate([0, 0, top]); own(roof);
      tiles(roof, { id: 'roof', name: 'Shaped flat roof', role: 'roof', lie: [0, 0, 0], apart: [0, 0, roofLift] });
    } else {
      // Each panel: as thick as the roof over its plane, out to the overhang, kept to its side of the hips.
      const reach = own(own(poly(footprintOffset(b, b.overhang)).extrude(rise + 200)).translate([0, 0, top - 100]));
      const planeOf = (w) => [t * w.inward[0], t * w.inward[1], top - t * (w.inward[0] * w.a[0] + w.inward[1] * w.a[1])];
      roofPanels(b).forEach(({ id, name, wall: w }) => {
        const [a, c, k] = planeOf(w);
        let panel = trim(reach, [-a, -c, 1], k / lenT);
        panel = trim(panel, [a, c, -1], -(k + b.roof * lenT) / lenT);
        for (const v of walls) {
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
      const z = p.storey < 0 ? 0 : storeys[p.storey].floor;
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
