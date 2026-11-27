// Drawing a shaped building's outline, or a courtyard's, wall by wall: move a
// wall in or out, pull out a bay or push in a recess, cut a corner, curve a
// wall. Walls are named by their place round their ring (edge-1 the first of
// the outline, court-1-1 of courtyard 1), so when walls come in between, the
// windows and doors and the walls' own textures move with them.
import { validateBuilding } from './geometry/building.js';
import { footprintPoints, footprintRings, footprintStoreys, footprintWalls, storeyWalls } from './geometry/footprint-building.js';

export const BAY = Object.freeze({ depth: 15, chamfer: 15, bulge: 15, facets: 6 });

// A wall's ring and its place round it: the outline's edge-N (ring 0), or courtyard K's court-K-N (ring K).
function ringOf(wall) {
  const m = /^(?:edge-(\d+)|court-(\d+)-(\d+))$/.exec(wall ?? '');
  if (!m) return null;
  return m[1] ? { ring: 0, i: Number(m[1]) - 1 } : { ring: Number(m[2]), i: Number(m[3]) - 1 };
}
const idOf = (ring, i) => (ring ? 'court-' + ring + '-' : 'edge-') + (i + 1);
// A ring's walls, of the ground floor or of storey `st`, moved out by its jetties.
const ringWalls = (b, ring, st = null) => (st?.out ? storeyWalls(b, st) : footprintWalls(b)).filter((w) => w.ring === ring);
const ringPoints = (b, ring) => footprintRings(b)[ring].map((p) => [...p]);
// The building ready to draw a ring of: its outline drawn as it is; a courtyard's ring as it is.
function drawable(b, ring) {
  if (!ring) return asOutline(b);
  if (b.kind !== 'footprint' || !b.courtyards?.[ring - 1]) throw Error('Select a wall first.');
  return b;
}
// The wall chosen: its ring, and the building ready to draw it.
function chosen(input, wall) {
  const r = ringOf(wall);
  if (!r) throw Error('Select a wall first.');
  const b = drawable(input, r.ring);
  return { b, ring: r.ring, walls: ringWalls(b, r.ring) };
}
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
// The outline drawn; or the courtyard drawn, its other settings following from its ring. Not yet checked, nor moved to 0, 0.
const redrawn = (b, ring, points) => ({ ...b, ...(ring ? { courtyards: b.courtyards.map((c, k) => (k === ring - 1 ? { shape: 'custom', points } : c)) } : { points }) });
/**
 * The outline with new points, and the walls renamed: `where(i)` says where
 * the old wall i went, as a function of an opening's place along it giving
 * the new wall and its place, or null when it is gone.
 */
function renamed(b, ring, points, where) {
  // Every storey's windows and doors, and its walls' own textures, on this ring.
  const mine = (wall) => ringOf(wall)?.ring === ring;
  const next = redrawn(b, ring, points);
  const storeys = footprintStoreys({ ...b, upper: b.upper ?? [] });
  const storey = (s, n) => {
    // A jettied storey's walls stand out past the ground floor's, longer at each corner: its windows
    // and doors are kept where they are on the plan, measured along its own walls, old and new.
    const before = ringWalls(b, ring, storeys[n]), after = ringWalls(next, ring, storeys[n]);
    const openings = s.openings.map((o) => {
      if (!mine(o.wall)) return o;
      const i = ringOf(o.wall).i;
      if (!storeys[n].out || !before[i]) {
        const [j, u] = where(i, o.at);
        return { ...o, wall: idOf(ring, j), at: Math.round(u * 1e6) / 1e6 };
      }
      const old = before[i], p = at(old.a, old.dir, o.at);
      // Of the walls the old one became, the one running the same way that it is along.
      const pieces = where.pieces?.(i) ?? [where(i, o.at)[0]];
      const j = pieces.find((k) => {
        const w = after[k];
        return w && w.dir[0] * old.dir[0] + w.dir[1] * old.dir[1] > 1 - 1e-6 && along(p, w) > -1e-6 && along(p, w) < w.length + 1e-6;
      }) ?? pieces[0];
      return { ...o, wall: idOf(ring, j), at: Math.round(along(p, after[j]) * 1e6) / 1e6 };
    });
    const wallTextures = {};
    for (const [w, t] of Object.entries(s.wallTextures ?? {})) {
      if (!mine(w)) {
        wallTextures[w] = t;
        continue;
      }
      const i = ringOf(w).i;
      // A wall cut in pieces: each piece keeps its texture.
      for (const j of where.pieces?.(i) ?? [where(i, 0)[0]]) wallTextures[idOf(ring, j)] = t;
    }
    return { openings, wallTextures };
  };
  return validateBuilding({ ...next, ...storey(b, 0), upper: (b.upper ?? []).map((u, n) => ({ ...u, ...storey(u, n + 1) })) });
}
// How far along a wall a point on the plan is.
const along = (p, w) => (p[0] - w.a[0]) * w.dir[0] + (p[1] - w.a[1]) * w.dir[1];
// Every storey's windows and doors on a wall: a wall about to change shape must have none.
const openingsOn = (b, wall) => [b, ...(b.upper ?? [])].flatMap((s) => s.openings.filter((o) => o.wall === wall));

/** Moves a wall straight out (or in, when negative), its neighbours longer or shorter; its windows stay where they are. */
export function moveWall(input, wall, by) {
  const { b, ring, walls } = chosen(input, wall),
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
  const points = ringPoints(b, ring);
  points[i] = a;
  points[(i + 1) % n] = e;
  // The wall moves along its neighbours: its start slides along the one before it.
  const shift = (a[0] - w.a[0]) * w.dir[0] + (a[1] - w.a[1]) * w.dir[1];
  const grow = Math.hypot(next.end[0] - e[0], next.end[1] - e[1]) - next.length;
  return renamed(b, ring, points, (j, u) => [j, j === i ? u - shift : j === (i + 1) % n ? u + grow : u]);
}

/**
 * A bay, out from the middle third of a wall (a recess, `depth` negative):
 * the wall becomes five, its middle moved out, two short walls at its sides.
 */
export function addBay(input, wall, depth = BAY.depth, [from, to] = [1 / 3, 2 / 3]) {
  const { b, ring, walls } = chosen(input, wall),
    i = walls.findIndex((w) => w.id === wall);
  if (i < 0) throw Error('Select a wall first.');
  if (!Number.isFinite(depth) || !depth) throw Error('Give how far the bay comes out, or the recess goes in.');
  const w = walls[i],
    out = w.inward.map((v) => -v),
    L = w.length,
    u0 = L * from,
    u1 = L * to;
  const p1 = at(w.a, w.dir, u0),
    p4 = at(w.a, w.dir, u1);
  const points = ringPoints(b, ring);
  points.splice(i + 1, 0, p1, at(p1, out, depth), at(p4, out, depth), p4);
  // A window or door where the bay starts or ends would be cut in two: on a jettied storey, where its own walls turn.
  const storeys = footprintStoreys({ ...b, upper: b.upper ?? [] });
  [b, ...(b.upper ?? [])].forEach((st, n) => {
    let ends = [u0, u1];
    if (storeys[n].out) {
      const old = ringWalls(b, ring, storeys[n])[i], after = ringWalls(redrawn(b, ring, points), ring, storeys[n]);
      ends = [along(after[i].end, old), along(after[i + 4].a, old)];
    }
    st.openings.forEach((o, k) => {
      if (o.wall === wall && ends.some((u) => Math.abs(o.at - u) < o.width / 2 + 9))
        throw Error((o.type === 'door' ? 'Door ' : 'Window ') + (k + 1) + (n ? ' of storey ' + (n + 1) : '') + ' is where the ' + (depth > 0 ? 'bay' : 'recess') + ' would start or end: move it first.');
    });
  });
  const where = (j, u) => (j < i ? [j, u] : j > i ? [j + 4, u] : u <= u0 ? [i, u] : u >= u1 ? [i + 4, u - u1] : [i + 2, u - u0]);
  where.pieces = (j) => (j === i ? [i, i + 1, i + 2, i + 3, i + 4] : [where(j, 0)[0]]);
  return renamed(b, ring, points, where);
}

/** Cuts a corner off, `size` along each wall (at 45° on a square corner): corner k of a ring (0 the outline) is where its wall k starts. */
export function chamferCorner(input, corner, size = BAY.chamfer, ring = 0) {
  const b = drawable(input, ring),
    walls = ringWalls(b, ring),
    n = walls.length,
    k = corner;
  if (!Number.isInteger(k) || k < 0 || k >= n) throw Error('Select a corner first.');
  if (!Number.isFinite(size) || size <= 0) throw Error('Give how much of the corner to cut off.');
  const w = walls[k],
    prev = walls[(k + n - 1) % n];
  const points = ringPoints(b, ring);
  points.splice(k, 1, at(w.a, prev.dir, -size), at(w.a, w.dir, size));
  // The wall before ends sooner; the wall after starts later; a new wall between.
  const where = (j, u) => (j < k ? [j, u] : j === k ? [k + 1, u - size] : [j + 1, u]);
  return renamed(b, ring, points, where);
}

/**
 * Curves a wall: in its place `facets` walls along an arc through its ends,
 * bulging out by `bulge` at its middle (in, when negative). The wall must have
 * no windows or doors on any storey; its texture goes to every facet.
 */
export function curveWall(input, wall, bulge = BAY.bulge, facets = BAY.facets) {
  const { b, ring, walls } = chosen(input, wall),
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
  const points = ringPoints(b, ring);
  points.splice(i + 1, 0, ...pts);
  const added = facets - 1;
  const where = (j, u) => (j <= i ? [j, u] : [j + added, u]);
  where.pieces = (j) => (j === i ? Array.from({ length: facets }, (_, k) => i + k) : [where(j, 0)[0]]);
  return renamed(b, ring, points, where);
}
