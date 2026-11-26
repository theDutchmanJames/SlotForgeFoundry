// Shaped building kits: a rectangle, an L, U or T, or an outline drawn wall by
// wall with square and 45° corners. Wall identities follow the boundary,
// including re-entrant corners.
// This generator is deliberately separate from the existing rectangular/storey schema.
import { kitShapes } from './kit-shapes.js';
import { SHELL_FINISH_DEFAULTS, SHELL_OPENING_KEYS, SHELL_TEXTURE_DEFAULTS, checkShellFinish, checkShellOpening, checkShellTexture, finishShellWall, shellFrame, trimOf } from './shell-details.js';

export const FOOTPRINT_DEFAULTS = Object.freeze({ kind: 'footprint', shape: 'L', width: 220, depth: 180, wing: 80, height: 75, baseHeight: 6, wall: 3, play: 0.2, roof: 3, overhang: 3, points: null, ...SHELL_FINISH_DEFAULTS, ...SHELL_TEXTURE_DEFAULTS, openings: [] });
export const SHAPES = Object.freeze(['rectangle', 'L', 'U', 'T', 'custom']);
/** A drawn outline: its walls at least this long, its corners at most this many. */
export const OUTLINE = Object.freeze({ shortest: 10, most: 32, size: [40, 1200] });
export function footprintPoints(b) {
  if (b.shape === 'custom') return b.points.map(([x, y]) => [x, y]);
  const W = b.width, D = b.depth, a = b.wing;
  if (b.shape === 'rectangle') return [[0, 0], [W, 0], [W, D], [0, D]];
  if (b.shape === 'L') return [[0, 0], [W, 0], [W, a], [a, a], [a, D], [0, D]];
  if (b.shape === 'U') return [[0, 0], [W, 0], [W, D], [W - a, D], [W - a, a], [a, a], [a, D], [0, D]];
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
// square or at 45°, preserving the boundary's vertex order: a mitre.
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
/**
 * Checks a drawn outline and moves it so its corner nearest the origin is at
 * 0, 0. Walls run square or at 45°, each at least OUTLINE.shortest long; a
 * corner turns 45° or 90°, never back on itself; the walls, `wall` thick,
 * leave room inside.
 */
export function checkOutline(points, wall) {
  if (!Array.isArray(points) || points.length < 4 || points.length > OUTLINE.most || points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))
    throw Error('A drawn outline has 4 to ' + OUTLINE.most + ' corners.');
  const x0 = Math.min(...points.map((p) => p[0])), y0 = Math.min(...points.map((p) => p[1]));
  // Clear of the arithmetic's dust, so walls that meet square stay square, and 45° stays 45°.
  const pts = points.map(([x, y]) => [Math.round((x - x0) * 1e6) / 1e6, Math.round((y - y0) * 1e6) / 1e6]);
  const n = pts.length;
  const dirs = pts.map((p, i) => { const q = pts[(i + 1) % n]; return Math.atan2(q[1] - p[1], q[0] - p[0]); });
  for (let i = 0; i < n; i++) {
    const q = pts[(i + 1) % n], len = Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]);
    if (len < OUTLINE.shortest - 1e-6) throw Error('Wall ' + (i + 1) + ' is ' + (Math.round(len * 10) / 10) + ' mm: each wall is at least ' + OUTLINE.shortest + ' mm long.');
    const eighth = dirs[i] / (Math.PI / 4);
    if (Math.abs(eighth - Math.round(eighth)) > 1e-3) throw Error('Wall ' + (i + 1) + ' runs at an angle: walls run square or at 45°.');
    const turn = Math.round(((((dirs[i] - dirs[(i + n - 1) % n]) / (Math.PI / 4)) % 8) + 12) % 8) - 4; // in eighths, -4 to 3
    if (turn === 0) throw Error('Walls ' + (i ? i : n) + ' and ' + (i + 1) + ' run on in one line: make them one wall.');
    if (Math.abs(turn) > 2) throw Error('The corner between walls ' + (i ? i : n) + ' and ' + (i + 1) + ' is too sharp: corners turn 45° or 90°.');
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
export function validateFootprint(input) {
  for (const key of Object.keys(input)) if (!Object.hasOwn(FOOTPRINT_DEFAULTS, key)) throw Error('Unknown footprint setting: ' + key);
  const b = { ...FOOTPRINT_DEFAULTS, ...input };
  if (!SHAPES.includes(b.shape)) throw Error('Choose a rectangular, L, U or T footprint, or draw one.');
  // A drawn outline sets the width and the depth; the wing is not used.
  if (b.shape === 'custom') Object.assign(b, checkOutline(b.points, b.wall));
  else b.points = null;
  for (const [key, min, max] of [['width', b.shape === 'custom' ? OUTLINE.size[0] : 100, 1200], ['depth', b.shape === 'custom' ? OUTLINE.size[0] : 100, 1200], ['wing', 40, 500], ['height', 30, 180], ['baseHeight', 4, 20], ['wall', 2, 5], ['play', 0.1, 0.5], ['roof', 2, 5], ['overhang', 0, 12]]) {
    if (!Number.isFinite(b[key]) || b[key] < min || b[key] > max) throw Error(key + ' must be between ' + min + ' and ' + max + ' mm.');
  }
  if (!['rectangle', 'custom'].includes(b.shape) && (b.wing > b.depth - 30 || b.wing > (b.shape === 'U' ? (b.width - 30) / 2 : b.shape === 'T' ? b.width - 60 : b.width - 30))) throw Error('The wing leaves too little room for the recess. Reduce the wing width or enlarge the building.');
  if (!Array.isArray(b.openings) || b.openings.length > 64) throw Error('Use at most 64 openings.');
  const walls = footprintWalls(b);
  checkShellTexture(b);
  Object.assign(b, checkShellFinish(b, walls.map((w) => w.id), b.height, ''));
  b.openings = b.openings.map((o, i) => {
    if (!o || typeof o !== 'object' || Object.keys(o).some(k => !SHELL_OPENING_KEYS.includes(k))) throw Error('Invalid opening ' + (i + 1));
    const w = walls.find(w => w.id === o.wall);
    if (!w || !['window', 'door'].includes(o.type)) throw Error('Choose a wall and an opening type.');
    const q = { ...o, sill: o.type === 'door' ? 0 : o.sill };
    if (![q.at, q.width, q.height, q.sill].every(Number.isFinite) || q.width < 8 || q.height < 8 || q.sill < 0) throw Error('Openings need positive sizes and a position above the floor.');
    const p = checkShellOpening(q, w.name);
    // A frame reaches past the sides and top of its opening: it keeps the same room.
    const t = trimOf(p);
    if (p.at - p.width / 2 - t < 9 || p.at + p.width / 2 + t > w.length - 9) throw Error(w.name + ': keep the opening' + (t ? ' and its frame' : '') + ' at least 9 mm from each corner.');
    if (p.sill + p.height + t > b.height - 6) throw Error(w.name + ': leave at least 6 mm above the opening' + (t ? ' and its frame' : '') + '.');
    return p;
  });
  b.openings.forEach((o, i) => b.openings.slice(i + 1).forEach(p => {
    if (p.wall !== o.wall) return;
    const across = Math.abs(p.at - o.at) - (p.width + o.width) / 2;
    const vertical = Math.max(p.sill - o.sill - o.height, o.sill - p.sill - p.height);
    const t = trimOf(o) + trimOf(p);
    if (across < 6 + t && vertical < 6 + t) throw Error('Keep at least 6 mm between openings' + (t ? ' and their frames' : '') + '.');
  }));
  return b;
}
export function footprintLayout(input) {
  const b = validateFootprint(input);
  return { building: b, storeys: [], doors: [], parts: [{ id: 'base', name: 'Shaped base', role: 'buildingBase' }, ...footprintWalls(b).map(w => ({ id: w.id, name: w.name, role: 'wall' })), ...b.openings.flatMap((o, i) => o.frame ? [{ id: 'frame-' + (i + 1), name: (o.type === 'door' ? 'Door ' : 'Window ') + (i + 1) + ' frame', role: 'frame' }] : []), { id: 'roof', name: 'Shaped flat roof', role: 'roof' }] };
}

// A wall prints lying on its inside face: one at 45° is first turned square to the front.
const lay = (w) => {
  const out = w.inward.map((n) => -n);
  if (Math.abs(out[0]) < 1e-9 || Math.abs(out[1]) < 1e-9) return { outward: out };
  return { turn: [-90 - (Math.atan2(out[1], out[0]) * 180) / Math.PI, -90] };
};
export function buildFootprint(wasm, input, plate = null) {
  const b = validateFootprint(input), temp = [], result = [];
  const own = s => (temp.push(s), s);
  const { poly, box, sweep } = kitShapes(wasm, own);
  const outline = footprintPoints(b), inner = footprintOffset(b, -b.wall), walls = footprintWalls(b);
  const top = b.baseHeight + b.height;
  const room = plate ? [plate.width - 2 * (plate.margin ?? 0), plate.depth - 2 * (plate.margin ?? 0)] : [Infinity, Infinity];
  if (room.some(n => n < 40)) throw Error('Use a print plate with at least 40 mm usable width and depth.');
  // Flat panels split into labelled butt-jointed tiles. No overlap or internal duplicate walls.
  function tiles(solid, part, wall = null) {
    const bb = solid.boundingBox();
    const long = Math.max(...room), short = Math.min(...room);
    let segments;
    if (wall) {
      // Plane cuts along the wall and its height keep every panel printable, even on small beds.
      const nx = plate ? Math.ceil((wall.length + 2 * b.wall) / long) : 1;
      const nz = plate ? Math.ceil((b.height + 2) / short) : 1;
      segments = [];
      for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) {
        const lo = -b.wall + x * (wall.length + 2 * b.wall) / nx, hi = -b.wall + (x + 1) * (wall.length + 2 * b.wall) / nx;
        const z0 = b.baseHeight - 2 + z * (b.height + 2) / nz, z1 = b.baseHeight - 2 + (z + 1) * (b.height + 2) / nz;
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
  try {
    const outer = poly(footprintOffset(b, 3)), grooveOuter = poly(footprintOffset(b, b.play)), grooveInner = poly(footprintOffset(b, -b.wall - b.play));
    const groove = own(own(grooveOuter.subtract(grooveInner)).extrude(2.01)).translate([0, 0, b.baseHeight - 2]); own(groove);
    const base = own(own(outer.extrude(b.baseHeight)).subtract(groove));
    tiles(base, { id: 'base', name: 'Shaped base', role: 'buildingBase', lie: [0, 0, 0], apart: [0, 0, -12] });
    walls.forEach((w, i) => {
      const j = (i + 1) % walls.length;
      let solid = own(poly([outline[i], outline[j], inner[j], inner[i]]).extrude(b.height + 2)).translate([0, 0, b.baseHeight - 2]); own(solid);
      for (const o of b.openings.filter(o => o.wall === w.id)) {
        const z0 = o.type === 'door' ? b.baseHeight - 2.01 : b.baseHeight + o.sill;
        const hole = sweep([[o.at - o.width / 2, z0], [o.at + o.width / 2, z0], [o.at + o.width / 2, b.baseHeight + o.sill + o.height], [o.at - o.width / 2, b.baseHeight + o.sill + o.height]], [...w.dir, 0], [0, 0, 1], [...w.a, 0], [...w.inward, 0], -1, b.wall + 1);
        solid = own(solid.subtract(hole));
      }
      solid = finishShellWall(wasm, own, solid, w, { floor: b.baseHeight, top, openings: b.openings.filter((o) => o.wall === w.id) }, b, b);
      tiles(solid, { id: w.id, name: w.name, role: 'wall', ...lay(w), apart: [-w.inward[0] * 20, -w.inward[1] * 20, 8] }, w);
    });
    // A frame prints face up, glued on round its opening.
    b.openings.forEach((o, i) => {
      if (!o.frame) return;
      const w = walls.find((x) => x.id === o.wall);
      tiles(shellFrame(o, w, b.baseHeight, { sweep, own, Manifold: wasm.Manifold }), { id: 'frame-' + (i + 1), name: (o.type === 'door' ? 'Door ' : 'Window ') + (i + 1) + ' frame', role: 'frame', ...lay(w), apart: [-w.inward[0] * 28, -w.inward[1] * 28, 8] });
    });
    const roof = own(poly(footprintOffset(b, b.overhang)).extrude(b.roof)).translate([0, 0, top]); own(roof);
    tiles(roof, { id: 'roof', name: 'Shaped flat roof', role: 'roof', lie: [0, 0, 0], apart: [0, 0, 30] });
    return result;
  } catch (err) {
    result.forEach(p => p.solid.delete());
    throw err;
  } finally { temp.forEach(s => s.delete()); }
}
