// Buildings in a layout: a building from the Library placed beside the track.
// A layout keeps each one whole (its settings, name and place), so a layout
// file is complete on its own. Its place is the middle of its base and the
// way it faces: its front, with the garage door, looks along -y turned by a.
// Dropped near the track it snaps with its front along the outside of the
// border, so the doorstep meets the road.
import polygonClipping from 'polygon-clipping';
import { KIT, dividers, garageDoors, storeyStack, validateBuilding } from './geometry/building.js';
import { STAND, standDepth } from './geometry/grandstand.js';
import { GANTRY, gantryFeet, gantrySize } from './geometry/gantry.js';
import { marshalFootprint } from './geometry/marshal-post.js';
import { PIT } from './geometry/pit-module.js';

export const MAX_BUILDINGS = 100;
export const SNAP = 40; // a building snaps to an edge this close to its front, in mm
export const GAP = 1; // and stands this far from it
const ENTRY_KEYS = ['id', 'name', 'libraryId', 'building', 'pose', 'bay', 'over'];

/** The buildings of a layout as kept: each checked, or an error. */
export function validateBuildings(list) {
  if (list === undefined) return;
  if (!Array.isArray(list) || list.length > MAX_BUILDINGS) throw Error('Invalid buildings in the layout file.');
  const ids = new Set();
  for (const e of list) {
    if (
      !e ||
      typeof e !== 'object' ||
      Object.keys(e).some((k) => !ENTRY_KEYS.includes(k)) ||
      !/^b-[\w-]{1,100}$/.test(e.id) ||
      ids.has(e.id) ||
      typeof e.name !== 'string' ||
      e.name.length > 120 ||
      (e.libraryId !== undefined && (typeof e.libraryId !== 'string' || e.libraryId.length > 100)) ||
      (e.bay !== undefined && !/^[\w-]{1,100}$/.test(e.bay)) ||
      (e.over !== undefined && !/^[\w-]{1,100}$/.test(e.over)) ||
      ![e.pose?.x, e.pose?.y, e.pose?.a].every((v) => Number.isFinite(v) && Math.abs(v) < 1e8)
    )
      throw Error('Invalid building in the layout file.');
    try {
      validateBuilding(e.building);
    } catch (err) {
      throw Error('The building ' + e.name + ' in the layout file cannot be used: ' + err.message);
    }
    ids.add(e.id);
  }
}

/** A building ready to place, from one saved in the Library. */
export function layoutBuilding(saved, pose, id) {
  return { id, name: saved.name, ...(saved.id && { libraryId: saved.id }), building: validateBuilding(saved.building), pose };
}

const rect = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
/**
 * The shape of a building on the table, in its own coordinates (as its
 * parts are built): its outline, the box round it, and its front, the middle
 * of the side that faces the track and the way it faces. A garage's front
 * has its doors; a grandstand's, its parapet. A curved grandstand stands
 * round the middle of its curve, its front an arc.
 */
export function shapeOf(b) {
  let outline, front;
  if (b.kind === 'gantry') {
    // Over the track: it has no front to stand against the track with.
    const [w, d] = gantrySize(b);
    outline = rect(0, 0, w, d);
    front = null;
  } else if (b.kind === 'pitmodule') {
    // On the table it stands on its bays and the end panel; the balcony and
    // the visor reach out over the pit lane above the cars.
    outline = rect(0, 0, b.bays * b.bayWidth + PIT.shell, b.depth);
    front = { p: [(b.bays * b.bayWidth) / 2, 0], f: [0, -1] };
  } else if (b.kind === 'marshalpost') {
    // On its base plate, or on the ground on its floor; the cabin faces the track.
    const [x0, y0, x1, y1] = marshalFootprint(b);
    outline = rect(x0, y0, x1, y1);
    front = { p: [b.width / 2, y0], f: [0, -1] };
  } else if (b.kind === 'grandstand') {
    const D = standDepth(b),
      ahead = b.roof === 'canopy' ? STAND.reach : 0;
    if (!b.curve) {
      outline = rect(0, -ahead, b.length, D);
      front = { p: [b.length / 2, -ahead], f: [0, -1] };
    } else {
      const { radius: R, angle, facing } = b.curve;
      const A = (angle * Math.PI) / 180,
        inward = facing === 'in';
      const near = inward ? R - ahead : R + ahead,
        far = inward ? R + D : R - D;
      const steps = Math.max(4, Math.ceil(angle / 3));
      const arc = (r) => Array.from({ length: steps + 1 }, (_, k) => [r * Math.cos((A * k) / steps), r * Math.sin((A * k) / steps)]);
      outline = [...arc(near), ...arc(far).reverse()];
      const mid = [Math.cos(A / 2), Math.sin(A / 2)];
      front = { p: [near * mid[0], near * mid[1]], f: inward ? [-mid[0], -mid[1]] : mid };
    }
  } else {
    const m = KIT.ledge;
    outline = rect(-m, -m, b.width + m, b.depth + m);
    front = { p: [b.width / 2, -m], f: [0, -1] };
  }
  const xs = outline.map(([x]) => x),
    ys = outline.map(([, y]) => y);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return { outline, box, centre: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], front };
}
/** A point of the building, in its own coordinates, on the plan: turned by a round its middle. */
export function toPlan({ building: b, pose }, [x, y]) {
  const [cx, cy] = b.kind !== 'garage' ? shapeOf(b).centre : [b.width / 2, b.depth / 2];
  const u = x - cx,
    v = y - cy,
    c = Math.cos(pose.a),
    s = Math.sin(pose.a);
  return [pose.x + c * u - s * v, pose.y + s * u + c * v];
}
/** The building on the table, on the plan: a garage's base with its ledge, a grandstand's outline. */
export function footprint(entry) {
  return shapeOf(entry.building).outline.map((p) => toPlan(entry, p));
}
/** What the plan draws: the base, each storey, its dividing walls, and the garage doors in the front wall. */
export function planShapes(entry) {
  const b = validateBuilding(entry.building);
  if (b.kind === 'gantry') {
    // Its feet, and the beam or the walkway across.
    const [w, d] = gantrySize(b);
    const across = [[0, d / 2], [w, d / 2]].map((p) => toPlan(entry, p));
    return { base: footprint(entry), storeys: gantryFeet(b).map(([x0, y0, x1, y1]) => rect(x0, y0, x1, y1).map((p) => toPlan(entry, p))), dividers: [across], doors: [] };
  }
  if (b.kind === 'pitmodule') {
    // Its bays, a line between each two, and the doors in their reveals.
    const joins = Array.from({ length: b.bays - 1 }, (_, i) => [[(i + 1) * b.bayWidth, 0], [(i + 1) * b.bayWidth, b.depth]].map((p) => toPlan(entry, p)));
    const doors = Array.from({ length: b.bays }, (_, i) => {
      const cx = (i + 0.5) * b.bayWidth;
      return [toPlan(entry, [cx - b.doorWidth / 2, b.recess]), toPlan(entry, [cx + b.doorWidth / 2, b.recess])];
    });
    return { base: footprint(entry), storeys: [], dividers: joins, doors };
  }
  if (b.kind === 'marshalpost') {
    // Its base, and the cabin on it.
    return { base: footprint(entry), storeys: [rect(0, 0, b.width, b.depth).map((p) => toPlan(entry, p))], dividers: [], doors: [] };
  }
  if (b.kind === 'grandstand') {
    // Its rows, as lines along it.
    const rows = Array.from({ length: b.rows - 1 }, (_, i) => STAND.shell + (i + 1) * b.rowDepth);
    const line = (y) => {
      if (!b.curve) return [[0, y], [b.length, y]];
      const { radius: R, angle, facing } = b.curve;
      const r = facing === 'in' ? R + y : R - y,
        A = (angle * Math.PI) / 180;
      return Array.from({ length: 13 }, (_, k) => [r * Math.cos((A * k) / 12), r * Math.sin((A * k) / 12)]);
    };
    return { base: footprint(entry), storeys: [], dividers: rows.map((y) => line(y).map((p) => toPlan(entry, p))), doors: [] };
  }
  return {
    base: footprint(entry),
    storeys: storeyStack(b).map((s) => rect(s.ox, s.oy, s.ox + s.width, s.oy + s.depth).map((p) => toPlan(entry, p))),
    dividers: dividers(b).map((at) =>
      (b.rooms.along === 'width' ? [[at, 0], [at, b.depth]] : [[0, at], [b.width, at]]).map((p) => toPlan(entry, p)),
    ),
    doors: garageDoors(b).map((d) => [toPlan(entry, [d.x, 0]), toPlan(entry, [d.x + d.width, 0])]),
  };
}

/** The parts of a building (as the Buildings page gets them) where it stands in the layout. */
export function placeParts(parts, entry) {
  return parts.map((p) => {
    const positions = new Float32Array(p.positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y] = toPlan(entry, [p.positions[i], p.positions[i + 1]]);
      positions[i] = x;
      positions[i + 1] = y;
      positions[i + 2] = p.positions[i + 2];
    }
    return { ...p, id: entry.id + '/' + p.id, positions, bounds: undefined };
  });
}

const boxOf = (loop) =>
  loop.reduce(([l, b, r, t], [x, y]) => [Math.min(l, x), Math.min(b, y), Math.max(r, x), Math.max(t, y)], [Infinity, Infinity, -Infinity, -Infinity]);
const meets = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const area = (multi) =>
  multi.reduce(
    (sum, poly) =>
      sum +
      poly.reduce((s, ring, k) => {
        let twice = 0;
        for (let i = 0; i < ring.length; i++) {
          const [x0, y0] = ring[i],
            [x1, y1] = ring[(i + 1) % ring.length];
          twice += x0 * y1 - x1 * y0;
        }
        return s + (k ? -1 : 1) * Math.abs(twice / 2);
      }, 0),
    0,
  );
/**
 * The base on the plan as it stands on the table: one plate, or over a pit
 * bay the arms beside the track and the strip under the back wall.
 */
export function baseParts(entry) {
  const b = entry.building,
    m = KIT.ledge;
  // A gantry meets the table only where its feet stand: its beam spans the track.
  if (b.kind === 'gantry') return gantryFeet(b).map(([x0, y0, x1, y1]) => rect(x0, y0, x1, y1).map((p) => toPlan(entry, p)));
  if (!b.lane) return [footprint(entry)];
  const half = b.lane.width / 2 + KIT.lanePlay,
    end = b.depth - KIT.wall - KIT.play;
  return [rect(-m, -m, b.width / 2 - half, b.depth + m), rect(b.width / 2 + half, -m, b.width + m, b.depth + m), rect(b.width / 2 - half, end, b.width / 2 + half, b.depth + m)].map(
    (loop) => loop.map((p) => toPlan(entry, p)),
  );
}
/** How much of the track (its outlines) lies under the building's base, in mm². */
export function overlap(entry, loops) {
  let total = 0;
  for (const piece of baseParts(entry)) {
    const box = boxOf(piece);
    for (const loop of loops) {
      if (loop.length < 3 || !meets(box, boxOf(loop))) continue;
      total += area(polygonClipping.intersection([piece], [loop]));
    }
  }
  return total;
}
function inside([x, y], loop) {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i],
      [xj, yj] = loop[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Where a building snaps to the track: the edge of an outline nearest the
 * middle of its front, within SNAP, that it can stand along without lying
 * on the track; its front along that edge, GAP from it, facing the track.
 * A building beside a corner moves out until it is clear. Null when there
 * is no such edge.
 */
export function snapPose(entry, loops, radius = SNAP) {
  const b = entry.building;
  // A gantry is put over a straight, not against the track.
  if (b.kind === 'gantry') return null;
  const shape = shapeOf(b),
    { p: fp, f } = shape.front;
  const front = toPlan(entry, fp);
  const near = [];
  for (const loop of loops)
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i],
        q = loop[(i + 1) % loop.length];
      const dx = q[0] - p[0],
        dy = q[1] - p[1],
        len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((front[0] - p[0]) * dx + (front[1] - p[1]) * dy) / (len * len)));
      const at = [p[0] + t * dx, p[1] + t * dy];
      const d = Math.hypot(front[0] - at[0], front[1] - at[1]);
      if (d > radius) continue;
      // The side of the edge away from the inside of its outline.
      let n = [-dy / len, dx / len];
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (inside([mid[0] + n[0] * 0.05, mid[1] + n[1] * 0.05], loop)) n = [-n[0], -n[1]];
      near.push({ d, at, n });
    }
  near.sort((a, c) => a.d - c.d);
  for (const { at, n } of near) {
    // Turned so its front faces the track: f, turned by a, points along -n.
    const a = Math.atan2(-n[1], -n[0]) - Math.atan2(f[1], f[0]);
    const c = Math.cos(a),
      s = Math.sin(a);
    const [ux, uy] = [fp[0] - shape.centre[0], fp[1] - shape.centre[1]];
    // A curved grandstand's ends reach forward of the middle of its front: it may have to stand back that far.
    const sag = b.kind === 'grandstand' && b.curve ? b.curve.radius * (1 - Math.cos((b.curve.angle * Math.PI) / 360)) : 0;
    for (let out = 0; out <= 30 + sag; out += 1) {
      // The middle of its front GAP (and more) from the edge; the rest follows.
      const target = [at[0] + n[0] * (GAP + out), at[1] + n[1] * (GAP + out)];
      const pose = { x: target[0] - (c * ux - s * uy), y: target[1] - (s * ux + c * uy), a };
      if (overlap({ ...entry, pose }, loops) < 0.5) return pose;
    }
  }
  return null;
}

/** The outline loops of the track nearest the building, and how far its front is from them. */
export function nearestRow(entry, rows) {
  const shape = shapeOf(entry.building);
  if (!shape.front) return null;
  const front = toPlan(entry, shape.front.p);
  let best = null;
  for (const row of rows)
    for (const loop of row.polys)
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i],
          q = loop[(i + 1) % loop.length];
        const dx = q[0] - p[0],
          dy = q[1] - p[1],
          len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((front[0] - p[0]) * dx + (front[1] - p[1]) * dy) / len2));
        const d = Math.hypot(front[0] - p[0] - t * dx, front[1] - p[1] - t * dy);
        if (!best || d < best.d) best = { row, d };
      }
  return best;
}

/* ---------- Garages over the pit bays ---------- */

/**
 * The closed end of a pit bay, from the open end of its end stop (end A,
 * the only end it joins by, as the plan has it, facing out of the piece):
 * the far end of its outlines along the piece, the middle of the track
 * across it there, which way the bay runs into it, and how wide the track
 * is, borders included.
 */
export function bayEnd(end, polys) {
  const d = [-Math.cos(end.angle), -Math.sin(end.angle)],
    across = [-d[1], d[0]];
  let lo = Infinity,
    hi = -Infinity,
    far = -Infinity;
  for (const loop of polys)
    for (const [x, y] of loop) {
      const u = (x - end.xy[0]) * d[0] + (y - end.xy[1]) * d[1],
        v = (x - end.xy[0]) * across[0] + (y - end.xy[1]) * across[1];
      far = Math.max(far, u);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const mid = (lo + hi) / 2;
  return { at: [end.xy[0] + d[0] * far + across[0] * mid, end.xy[1] + d[1] * far + across[1] * mid], dir: d, width: hi - lo };
}

/**
 * A garage for a pit bay, from a building: the track through it as wide as
 * the bay, an open door wide enough, the building wider if it has to be, at
 * most as wide as the room beside the next bay, and its base as high as the
 * road. Its other settings stay as they were.
 */
export function pitGarage(building, width, roadHeight, most = Infinity) {
  const b = validateBuilding(building);
  const lane = { width: Math.round(width * 10) / 10 };
  const doorWidth = Math.max(b.doorWidth, Math.ceil(lane.width + 2 * KIT.laneClear));
  const least = doorWidth + 2 * (KIT.wall + KIT.frame);
  if (least > most)
    throw Error('The pit bays are too close together for a garage over each: a garage needs ' + Math.ceil(least) + ' mm and there is ' + Math.floor(most) + ' mm between two bays. Space the bays further apart.');
  return validateBuilding({
    ...b,
    lane,
    rooms: null,
    door: 'open',
    doorWidth,
    width: Math.min(Math.max(b.width, least), Math.floor(most)),
    baseHeight: Math.round(roadHeight * 100) / 100,
    cuts: {},
  });
}

/** Where a garage stands over a bay: the track along its middle, its back wall just beyond the end stop. */
export function bayPose(building, { at, dir }) {
  const reach = building.depth / 2 - KIT.wall - GAP;
  return { x: at[0] - dir[0] * reach, y: at[1] - dir[1] * reach, a: Math.atan2(-dir[0], dir[1]) };
}

/** How much room each bay has across for a garage: the distance to the nearest bay beside it, less GAP. */
export function bayRoom(ends, depth) {
  return ends.map((e, i) => {
    let room = Infinity;
    const across = [-e.dir[1], e.dir[0]];
    ends.forEach((o, j) => {
      if (i === j) return;
      const dx = o.at[0] - e.at[0],
        dy = o.at[1] - e.at[1];
      // Beside it, not far ahead or behind.
      if (Math.abs(dx * e.dir[0] + dy * e.dir[1]) > depth) return;
      room = Math.min(room, Math.abs(dx * across[0] + dy * across[1]) - GAP);
    });
    return room;
  });
}

/* ---------- Gantries over a straight ---------- */

/**
 * A straight on the plan: the middle of its road, the way it runs, and how
 * wide it is across, borders included, from its two ends and its outlines.
 */
export function straightAcross(a, b, polys) {
  const len = Math.hypot(b.xy[0] - a.xy[0], b.xy[1] - a.xy[1]) || 1;
  const d = [(b.xy[0] - a.xy[0]) / len, (b.xy[1] - a.xy[1]) / len],
    across = [-d[1], d[0]];
  const mid = [(a.xy[0] + b.xy[0]) / 2, (a.xy[1] + b.xy[1]) / 2];
  let lo = Infinity,
    hi = -Infinity;
  for (const loop of polys)
    for (const [x, y] of loop) {
      const v = (x - mid[0]) * across[0] + (y - mid[1]) * across[1];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const c = (lo + hi) / 2;
  return { at: [mid[0] + across[0] * c, mid[1] + across[1] * c], dir: d, across, width: hi - lo };
}
/** Clear of the track each side, between a gantry's legs and the border. */
export const OVER_CLEAR = 8;
/**
 * A gantry made to span a straight of this width: OVER_CLEAR from the
 * road's edge to its feet, which reach in beyond its legs.
 */
export function overGantry(building, width) {
  const feet = building.type === 'bridge' ? 0 : GANTRY.foot[0] - GANTRY.leg;
  return validateBuilding({ ...building, span: Math.round((width + 2 * OVER_CLEAR + feet) * 10) / 10 });
}
/**
 * Where a gantry stands over a straight: across it, the middle of its span
 * on the middle of the road; a half gantry with its leg beside the road and
 * its beam reaching out over it.
 */
export function overPose(building, { at, across }) {
  const shape = shapeOf(building);
  const [w] = gantrySize(building);
  let mid = w / 2;
  if (building.type === 'half') {
    // Its foot OVER_CLEAR from the road's edge: the middle of the road half a span on.
    const f = GANTRY.foot[0] + 10;
    mid = f + (building.span - (GANTRY.foot[0] - GANTRY.leg)) / 2;
  }
  const u = mid - shape.centre[0];
  const a = Math.atan2(across[1], across[0]);
  return { x: at[0] - across[0] * u, y: at[1] - across[1] * u, a };
}
