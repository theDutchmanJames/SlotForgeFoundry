// Drawing a shaped building's outline wall by wall: move a wall in or out,
// pull out a bay or push in a recess, cut a corner at 45°. Walls are named by
// their place round the outline (edge-1 the first), so when walls come in
// between, the windows and doors and the walls' own textures move with them.
import { validateBuilding } from './geometry/building.js';
import { footprintPoints, footprintWalls } from './geometry/footprint-building.js';

export const BAY = Object.freeze({ depth: 15, chamfer: 15 });

const id = (i) => 'edge-' + (i + 1);
const at = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k];
// Where two lines meet, each through a point along a direction; null if they run side by side.
function meet(p, d, q, e) {
  const det = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(det) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / det;
  return at(p, d, t);
}
/** The building as a drawn outline, its walls as they are. */
export function asOutline(b) {
  if (b.kind !== 'footprint') throw Error('Only a shaped building has an outline to draw.');
  return b.shape === 'custom' ? b : { ...b, shape: 'custom', points: footprintPoints(b) };
}
/**
 * The outline with new points, and the walls renamed: `where(i)` says where
 * the old wall i went, as a function of an opening's place along it giving
 * the new wall and its place, or null when it is gone.
 */
function renamed(b, points, where) {
  const openings = b.openings.map((o) => {
    const i = Number(o.wall.slice(5)) - 1,
      [j, u] = where(i, o.at);
    return { ...o, wall: id(j), at: Math.round(u * 1e6) / 1e6 };
  });
  const wallTextures = {};
  for (const [w, t] of Object.entries(b.wallTextures ?? {})) {
    const i = Number(w.slice(5)) - 1;
    // A wall cut in pieces: each piece keeps its texture.
    for (const j of where.pieces?.(i) ?? [where(i, 0)[0]]) wallTextures[id(j)] = t;
  }
  return validateBuilding({ ...b, points, openings, wallTextures });
}

/** Moves a wall straight out (or in, when negative), its neighbours longer or shorter; its windows stay where they are. */
export function moveWall(input, wall, by) {
  const b = asOutline(input),
    walls = footprintWalls(b),
    n = walls.length,
    i = walls.findIndex((w) => w.id === wall);
  if (i < 0) throw Error('Select a wall first.');
  if (!Number.isFinite(by)) throw Error('Give how far to move the wall.');
  const w = walls[i],
    prev = walls[(i + n - 1) % n],
    next = walls[(i + 1) % n];
  const out = w.inward.map((v) => -v),
    from = at(w.a, out, by);
  const a = meet(prev.a, prev.dir, from, w.dir),
    e = meet(from, w.dir, next.a, next.dir);
  if (!a || !e) throw Error('This wall cannot move.');
  const points = footprintPoints(b).map((p) => [...p]);
  points[i] = a;
  points[(i + 1) % n] = e;
  // The wall moves along its neighbours: its start slides along the one before it.
  const shift = (a[0] - w.a[0]) * w.dir[0] + (a[1] - w.a[1]) * w.dir[1];
  const grow = Math.hypot(next.end[0] - e[0], next.end[1] - e[1]) - next.length;
  return renamed(b, points, (j, u) => [j, j === i ? u - shift : j === (i + 1) % n ? u + grow : u]);
}

/**
 * A bay, out from the middle third of a wall (a recess, `depth` negative):
 * the wall becomes five, its middle moved out, two short walls at its sides.
 */
export function addBay(input, wall, depth = BAY.depth, [from, to] = [1 / 3, 2 / 3]) {
  const b = asOutline(input),
    walls = footprintWalls(b),
    i = walls.findIndex((w) => w.id === wall);
  if (i < 0) throw Error('Select a wall first.');
  if (!Number.isFinite(depth) || !depth) throw Error('Give how far the bay comes out, or the recess goes in.');
  const w = walls[i],
    out = w.inward.map((v) => -v),
    L = w.length,
    u0 = L * from,
    u1 = L * to;
  // A window or door where the bay starts or ends would be cut in two.
  b.openings.forEach((o, k) => {
    if (o.wall === wall && [u0, u1].some((u) => Math.abs(o.at - u) < o.width / 2 + 9))
      throw Error((o.type === 'door' ? 'Door ' : 'Window ') + (k + 1) + ' is where the ' + (depth > 0 ? 'bay' : 'recess') + ' would start or end: move it first.');
  });
  const p1 = at(w.a, w.dir, u0),
    p4 = at(w.a, w.dir, u1);
  const points = footprintPoints(b);
  points.splice(i + 1, 0, p1, at(p1, out, depth), at(p4, out, depth), p4);
  const where = (j, u) => (j < i ? [j, u] : j > i ? [j + 4, u] : u <= u0 ? [i, u] : u >= u1 ? [i + 4, u - u1] : [i + 2, u - u0]);
  where.pieces = (j) => (j === i ? [i, i + 1, i + 2, i + 3, i + 4] : [where(j, 0)[0]]);
  return renamed(b, points, where);
}

/** Cuts a square corner off at 45°, `size` along each wall: corner k is where wall k starts. */
export function chamferCorner(input, corner, size = BAY.chamfer) {
  const b = asOutline(input),
    walls = footprintWalls(b),
    n = walls.length,
    k = corner;
  if (!Number.isInteger(k) || k < 0 || k >= n) throw Error('Select a corner first.');
  if (!Number.isFinite(size) || size <= 0) throw Error('Give how much of the corner to cut off.');
  const w = walls[k],
    prev = walls[(k + n - 1) % n];
  if (Math.abs(prev.dir[0] * w.dir[0] + prev.dir[1] * w.dir[1]) > 1e-6) throw Error('Only a square corner can be cut at 45°.');
  const points = footprintPoints(b);
  points.splice(k, 1, at(w.a, prev.dir, -size), at(w.a, w.dir, size));
  // The wall before ends sooner; the wall after starts later; a new wall between.
  const where = (j, u) => (j < k ? [j, u] : j === k ? [k + 1, u - size] : [j + 1, u]);
  return renamed(b, points, where);
}
