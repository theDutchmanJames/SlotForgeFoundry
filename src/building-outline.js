// Drawing a shaped building's outline wall by wall: move a wall in or out,
// pull out a bay or push in a recess, cut a corner, curve a wall. Walls are named by
// their place round the outline (edge-1 the first), so when walls come in
// between, the windows and doors and the walls' own textures move with them.
import { validateBuilding } from './geometry/building.js';
import { footprintPoints, footprintWalls } from './geometry/footprint-building.js';

export const BAY = Object.freeze({ depth: 15, chamfer: 15, bulge: 15, facets: 6 });

const id = (i) => 'edge-' + (i + 1);
// The walls round the outline; a courtyard's are moved with its own settings.
const outerWalls = (b) => footprintWalls(b).filter((w) => !w.ring);
const onOutline = (wall) => /^edge-\d+$/.test(wall);
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
  // Every storey's windows and doors, and its walls' own textures.
  const storey = (s) => {
    const openings = s.openings.map((o) => {
      if (!onOutline(o.wall)) return o;
      const i = Number(o.wall.slice(5)) - 1,
        [j, u] = where(i, o.at);
      return { ...o, wall: id(j), at: Math.round(u * 1e6) / 1e6 };
    });
    const wallTextures = {};
    for (const [w, t] of Object.entries(s.wallTextures ?? {})) {
      if (!onOutline(w)) {
        wallTextures[w] = t;
        continue;
      }
      const i = Number(w.slice(5)) - 1;
      // A wall cut in pieces: each piece keeps its texture.
      for (const j of where.pieces?.(i) ?? [where(i, 0)[0]]) wallTextures[id(j)] = t;
    }
    return { openings, wallTextures };
  };
  return validateBuilding({ ...b, points, ...storey(b), upper: (b.upper ?? []).map((u) => ({ ...u, ...storey(u) })) });
}
// Every storey's windows and doors on a wall: a wall about to change shape must have none.
const openingsOn = (b, wall) => [b, ...(b.upper ?? [])].flatMap((s) => s.openings.filter((o) => o.wall === wall));

/** Moves a wall straight out (or in, when negative), its neighbours longer or shorter; its windows stay where they are. */
export function moveWall(input, wall, by) {
  const b = asOutline(input),
    walls = outerWalls(b),
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
    walls = outerWalls(b),
    i = walls.findIndex((w) => w.id === wall);
  if (i < 0) throw Error('Select a wall first.');
  if (!Number.isFinite(depth) || !depth) throw Error('Give how far the bay comes out, or the recess goes in.');
  const w = walls[i],
    out = w.inward.map((v) => -v),
    L = w.length,
    u0 = L * from,
    u1 = L * to;
  // A window or door where the bay starts or ends would be cut in two.
  [b, ...(b.upper ?? [])].forEach((st, n) =>
    st.openings.forEach((o, k) => {
      if (o.wall === wall && [u0, u1].some((u) => Math.abs(o.at - u) < o.width / 2 + 9))
        throw Error((o.type === 'door' ? 'Door ' : 'Window ') + (k + 1) + (n ? ' of storey ' + (n + 1) : '') + ' is where the ' + (depth > 0 ? 'bay' : 'recess') + ' would start or end: move it first.');
    }),
  );
  const p1 = at(w.a, w.dir, u0),
    p4 = at(w.a, w.dir, u1);
  const points = footprintPoints(b);
  points.splice(i + 1, 0, p1, at(p1, out, depth), at(p4, out, depth), p4);
  const where = (j, u) => (j < i ? [j, u] : j > i ? [j + 4, u] : u <= u0 ? [i, u] : u >= u1 ? [i + 4, u - u1] : [i + 2, u - u0]);
  where.pieces = (j) => (j === i ? [i, i + 1, i + 2, i + 3, i + 4] : [where(j, 0)[0]]);
  return renamed(b, points, where);
}

/** Cuts a corner off, `size` along each wall (at 45° on a square corner): corner k is where wall k starts. */
export function chamferCorner(input, corner, size = BAY.chamfer) {
  const b = asOutline(input),
    walls = outerWalls(b),
    n = walls.length,
    k = corner;
  if (!Number.isInteger(k) || k < 0 || k >= n) throw Error('Select a corner first.');
  if (!Number.isFinite(size) || size <= 0) throw Error('Give how much of the corner to cut off.');
  const w = walls[k],
    prev = walls[(k + n - 1) % n];
  const points = footprintPoints(b);
  points.splice(k, 1, at(w.a, prev.dir, -size), at(w.a, w.dir, size));
  // The wall before ends sooner; the wall after starts later; a new wall between.
  const where = (j, u) => (j < k ? [j, u] : j === k ? [k + 1, u - size] : [j + 1, u]);
  return renamed(b, points, where);
}

/**
 * Curves a wall: in its place `facets` walls along an arc through its ends,
 * bulging out by `bulge` at its middle (in, when negative). The wall must have
 * no windows or doors on any storey; its texture goes to every facet.
 */
export function curveWall(input, wall, bulge = BAY.bulge, facets = BAY.facets) {
  const b = asOutline(input),
    walls = outerWalls(b),
    i = walls.findIndex((w) => w.id === wall);
  if (i < 0) throw Error('Select a wall first.');
  if (!Number.isFinite(bulge) || !bulge) throw Error('Give how far the curve bulges out, or in.');
  if (!Number.isInteger(facets) || facets < 2 || facets > 16) throw Error('A curved wall has 2 to 16 facets.');
  if (openingsOn(b, wall).length) throw Error('Take the windows and doors off this wall first: a curved wall is made of new walls.');
  const w = walls[i],
    L = w.length,
    out = w.inward.map((v) => -v);
  if (Math.abs(bulge) > L / 2) throw Error('A curve bulges at most half as far as its wall is long: ' + Math.floor(L / 2) + ' mm.');
  // The arc through both ends and the bulge, its centre on the wall's middle line.
  const h = bulge,
    R = (L * L) / (8 * Math.abs(h)) + Math.abs(h) / 2;
  const mid = at(w.a, w.dir, L / 2),
    centre = at(mid, out, h - Math.sign(h) * R);
  const half = Math.asin(Math.min(1, L / (2 * R)));
  const pts = [];
  for (let k = 1; k < facets; k++) {
    const ang = -half + (2 * half * k) / facets;
    // Measured from the centre towards the bulge, turning along the wall.
    const toBulge = out.map((v) => v * Math.sign(h));
    const along = w.dir;
    pts.push([centre[0] + R * (toBulge[0] * Math.cos(ang) + along[0] * Math.sin(ang)), centre[1] + R * (toBulge[1] * Math.cos(ang) + along[1] * Math.sin(ang))]);
  }
  const points = footprintPoints(b);
  points.splice(i + 1, 0, ...pts);
  const added = facets - 1;
  const where = (j, u) => (j <= i ? [j, u] : [j + added, u]);
  where.pieces = (j) => (j === i ? Array.from({ length: facets }, (_, k) => i + k) : [where(j, 0)[0]]);
  return renamed(b, points, where);
}
