// Marshal posts: a cabin with a waist-high wall all round and a roof on four
// corner posts, falling to the back. On the ground it is a marshal shelter;
// raised, it stands on four legs over a base plate, with a ladder up to an
// opening in its back wall: a low marshal post, or a tall one. The cabin
// prints the right way up, its floor on the plate; the legs stand on their
// base; the roof lies on its underside, the ladder and the number disc flat.
// Pegs on the legs push into sockets under the floor, pins on the posts into
// holes through the roof. x across, y from the front (the track at negative
// y) to the back, z up.

import { sevenSegments } from './pit-module.js';

export const MARSHAL_POST_DEFAULTS = Object.freeze({
  kind: 'marshalpost',
  width: 80,
  depth: 72,
  deckHeight: 40, // the top of the floor above the table: 0 on the ground
  wallHeight: 22, // the waist wall, above the floor
  roomHeight: 62, // from the floor to the underside of the roof at the front
  fall: 8, // the roof lower at the back by this much
  overhang: 10, // the roof reaching out at the front; 4 mm at the sides and the back
  walls: 'slats', // 'slats', 'boards' or 'plain'
  roof: 'tin', // 'tin' (corrugated) or 'flat'
  entrance: 24, // the opening in the back wall: 0 for none
  ladder: true,
  numbers: true,
  number: 3,
});
export const MARSHAL_POST_LIMITS = Object.freeze({
  width: [40, 160],
  depth: [40, 160],
  deckHeight: [0, 200],
  wallHeight: [10, 40],
  roomHeight: [25, 120],
  fall: [0, 30],
  overhang: [0, 30],
  entrance: [0, 60],
  number: [1, 99],
});
export const MARSHAL = Object.freeze({
  floor: 3, // on the ground: the floor is the base
  deck: 4, // raised: the floor, thick
  wall: 3,
  post: 6, // a corner post, square
  leg: [8, 10, 80], // a leg, square: thicker under a floor at least this high
  base: 3, // the base plate under the legs
  margin: 6, // the base reaching out past the legs
  peg: [4, 3], // on top of a leg: square, high
  pin: [3, 2.5], // on top of a post
  play: 0.15,
  roof: 3,
  side: 4, // the roof past the posts at the sides and the back
  rib: [5, 1], // corrugation: pitch, high
  board: [6, 0.8], // boards: pitch, groove depth
  slat: [4, 3, 4], // slats: wide, gap, the rail top and bottom
  disc: [9, 1.5], // the number disc: radius, thick
  ladder: { width: 16, rail: 4.5, rung: 3, pitch: 9, thick: 3, angle: 75, above: 8 },
});
const LABELS = {
  width: 'Width',
  depth: 'Depth',
  deckHeight: 'Floor height',
  wallHeight: 'Wall height',
  roomHeight: 'Roof height',
  fall: 'Roof fall',
  overhang: 'Roof overhang',
  entrance: 'Opening',
  number: 'Number',
};
const WALL_STYLES = ['slats', 'boards', 'plain'];

/** The marshal post as kept: known settings only, each checked. */
export function validateMarshalPost(input) {
  const m = { ...MARSHAL_POST_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(m)) if (!Object.hasOwn(MARSHAL_POST_DEFAULTS, key)) throw Error('The marshal post has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(MARSHAL_POST_LIMITS))
    if (!Number.isFinite(m[key]) || m[key] < min || m[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'number' ? '' : ' mm') + '.');
  if (!Number.isInteger(m.number)) throw Error('The number is a whole number.');
  if (!WALL_STYLES.includes(m.walls)) throw Error('Choose slats, boards or plain walls.');
  if (!['tin', 'flat'].includes(m.roof)) throw Error('Choose a tin or a flat roof.');
  for (const key of ['ladder', 'numbers']) if (typeof m[key] !== 'boolean') throw Error('Choose whether the marshal post has ' + (key === 'ladder' ? 'a ladder' : 'a number') + '.');
  if (m.deckHeight > 0 && m.deckHeight < 20) throw Error('A raised floor stands at least 20 mm above the table; 0 puts it on the ground.');
  const room = m.width - 2 * MARSHAL.post - 4;
  if (m.entrance > room) throw Error('The opening is too wide for a cabin of ' + m.width + ' mm: at most ' + room + ' mm.');
  if (m.roomHeight - m.fall < m.wallHeight + 8) throw Error('The roof must stand at least 8 mm above the wall at the back: make it higher, or the wall lower.');
  if (m.ladder && m.deckHeight > 0 && m.entrance < MARSHAL.ladder.width + 4)
    throw Error('The ladder needs an opening of at least ' + (MARSHAL.ladder.width + 4) + ' mm in the back wall.');
  return m;
}

/** Heights, the roof's slope and the ladder's run, from the settings. */
export function marshalLevels(m) {
  const raised = m.deckHeight > 0;
  const top = raised ? m.deckHeight : MARSHAL.floor;
  const L = MARSHAL.ladder;
  const rise = top - MARSHAL.base;
  const ladder = raised && m.ladder;
  const run = ladder ? rise / Math.tan((L.angle * Math.PI) / 180) : 0;
  // The base reaches back under the ladder's foot.
  const back = m.depth + (ladder ? run + L.thick / Math.sin((L.angle * Math.PI) / 180) : 0) + MARSHAL.margin;
  const roof = top + m.roomHeight;
  return { raised, ladder, floor: top - (raised ? MARSHAL.deck : MARSHAL.floor), top, wall: top + m.wallHeight, roof, slope: m.fall / m.depth, rise, run, back, high: roof + MARSHAL.roof + (m.roof === 'tin' ? MARSHAL.rib[1] : 0) + m.overhang * (m.fall / m.depth) };
}

/** The size of a marshal post on the table: across (x) and from front to back (y), from its own origin. */
export function marshalFootprint(m) {
  const L = marshalLevels(m);
  return L.raised ? [-MARSHAL.margin, -MARSHAL.margin, m.width + MARSHAL.margin, L.back] : [0, 0, m.width, m.depth];
}

/** The parts of a marshal post, without geometry. */
export function marshalPostLayout(input) {
  const m = validateMarshalPost(input);
  const L = marshalLevels(m);
  const parts = [{ id: 'cabin', name: L.raised ? 'Cabin' : 'Shelter', role: 'wall' }];
  if (L.raised) parts.push({ id: 'stand', name: 'Legs and base', role: 'buildingBase' });
  parts.push({ id: 'roof', name: m.roof === 'tin' ? 'Tin roof' : 'Roof', role: 'roof' });
  if (L.ladder) parts.push({ id: 'ladder', name: 'Ladder', role: 'frame' });
  if (m.numbers) parts.push({ id: 'number', name: 'Number ' + m.number, role: 'frame' });
  return { building: m, parts };
}

/** The marshal post, built, standing where it goes. */
export function buildMarshalPost(wasm, input) {
  const { Manifold, CrossSection } = wasm;
  const m = validateMarshalPost(input);
  const L = marshalLevels(m);
  const W = m.width,
    D = m.depth,
    s = MARSHAL.wall,
    P = MARSHAL.post;
  const temp = [];
  const own = (x) => (temp.push(x), x);
  const box = (x0, y0, z0, x1, y1, z1) => own(Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]));
  const union = (list) => own(Manifold.union(list));
  // An outline in the plane of a and b (from `origin`), swept along `dir`
  // from `from` to `to`: whichever way round a and b make it turn.
  const sweep = (pts, a, b, origin, dir, from, to) => {
    let twice = 0;
    for (let i = 0; i < pts.length; i++) twice += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    const cs = own(new CrossSection([twice < 0 ? [...pts].reverse() : pts], 'Positive'));
    const c = cross(a, b),
      ahead = c[0] * dir[0] + c[1] * dir[1] + c[2] * dir[2] > 0;
    const o = origin.map((v, i) => v + dir[i] * (ahead ? from : to));
    return own(own(cs.extrude(to - from)).transform([...a, 0, ...b, 0, ...c, 0, ...o, 1]));
  };
  // The four walls: front and back along x, the sides along y; o is the
  // left end of the outside face as you look at it, a along it.
  const UP = [0, 0, 1];
  const WALLS = [
    { id: 'front', a: [1, 0, 0], in: [0, 1, 0], o: [0, 0, 0], len: W },
    { id: 'back', a: [-1, 0, 0], in: [0, -1, 0], o: [W, D, 0], len: W },
    { id: 'left', a: [0, -1, 0], in: [1, 0, 0], o: [0, D, 0], len: D },
    { id: 'right', a: [0, 1, 0], in: [-1, 0, 0], o: [W, 0, 0], len: D },
  ];
  // A cut through a wall: an outline in (along, up), from outside to `deep` in.
  const intoWall = (w, pts, deep) => sweep(pts, w.a, UP, w.o, w.in, -0.5, deep);
  const parts = [];
  try {
    // The cabin: its floor, the waist wall, the corner posts up to the roof.
    let walls = union([box(0, 0, L.top - 0.01, W, s, L.wall), box(0, D - s, L.top - 0.01, W, D, L.wall), box(0, 0, L.top - 0.01, s, D, L.wall), box(W - s, 0, L.top - 0.01, W, D, L.wall)]);
    const cuts = [];
    if (m.walls === 'boards') {
      // Boards: V-grooves round the outside, every board, running on round the corners.
      const [pitch, v] = MARSHAL.board;
      // The groove's profile across the wall (in, up), swept along it.
      for (let z = L.top + pitch; z < L.wall - 2; z += pitch)
        for (const w of WALLS) cuts.push(sweep([[-0.5, z - v - 0.5], [v, z], [-0.5, z + v + 0.5]], w.in, UP, w.o, w.a, -1, w.len + 1));
    } else if (m.walls === 'slats') {
      // Slats: upright gaps through the wall between a rail at the bottom and the top, each closing in a point so it prints.
      const [wide, gap, rail] = MARSHAL.slat;
      const z0 = L.top + rail,
        z1 = L.wall - rail - gap / 2;
      if (z1 - z0 >= 4)
        for (const w of WALLS) {
          const from = P + 2,
            to = w.len - P - 2;
          const n = Math.floor((to - from + wide) / (wide + gap));
          const start = from + (to - from - (n * (wide + gap) - wide)) / 2;
          for (let k = 0; k < n - 1; k++) {
            const u0 = start + k * (wide + gap) + wide,
              u1 = u0 + gap;
            if (w.id === 'back' && m.entrance > 0 && Math.abs((u0 + u1) / 2 - w.len / 2) < m.entrance / 2 + gap) continue;
            cuts.push(intoWall(w, [[u0, z0], [u1, z0], [u1, z1], [(u0 + u1) / 2, z1 + gap / 2], [u0, z1]], s + 1));
          }
        }
    }
    if (m.entrance > 0) cuts.push(box(W / 2 - m.entrance / 2, D - s - 1, L.top, W / 2 + m.entrance / 2, D + 1, L.wall + 1));
    if (cuts.length) walls = own(walls.subtract(union(cuts)));
    // The posts at the corners, up to the roof's underside, a pin on each.
    const norm = Math.hypot(L.slope, 1);
    const under = (y) => L.roof - L.slope * y;
    const corners = [
      [P / 2, P / 2],
      [W - P / 2, P / 2],
      [P / 2, D - P / 2],
      [W - P / 2, D - P / 2],
    ];
    const [pin, pinHigh] = MARSHAL.pin;
    const posts = corners.map(([x, y]) => {
      const post = own(box(x - P / 2, y - P / 2, L.top - 0.01, x + P / 2, y + P / 2, L.roof + 5).trimByPlane([0, -L.slope / norm, -1 / norm], -L.roof / norm));
      return own(post.add(box(x - pin / 2, y - pin / 2, under(y) - 2, x + pin / 2, y + pin / 2, under(y) + pinHigh)));
    });
    let cabin = union([box(0, 0, L.floor, W, D, L.top), walls, ...posts]);
    if (L.raised) {
      // Sockets under the floor for the pegs on the legs.
      const [peg, pegHigh] = MARSHAL.peg,
        g = peg / 2 + MARSHAL.play;
      cabin = own(cabin.subtract(union(legsAt(m).map(([x, y]) => box(x - g, y - g, L.floor - 1, x + g, y + g, L.floor + pegHigh + 0.2)))));
    }
    parts.push({ id: 'cabin', name: L.raised ? 'Cabin' : 'Shelter', role: 'wall', solid: cabin, lie: [0, 0, 0], apart: [0, 0, L.raised ? 15 : 0] });

    // The legs on their base plate, a peg on top of each.
    if (L.raised) {
      const [peg, pegHigh] = MARSHAL.peg,
        g = legOf(m) / 2,
        M = MARSHAL.margin;
      const bits = [box(-M, -M, 0, W + M, L.back, MARSHAL.base)];
      for (const [x, y] of legsAt(m)) bits.push(box(x - g, y - g, MARSHAL.base - 0.01, x + g, y + g, L.floor), box(x - peg / 2, y - peg / 2, L.floor - 0.01, x + peg / 2, y + peg / 2, L.floor + pegHigh));
      parts.push({ id: 'stand', name: 'Legs and base', role: 'buildingBase', solid: union(bits), lie: [0, 0, 0], apart: [0, 0, 0] });
    }

    // The roof: a plate on the posts, falling to the back, holes for their
    // pins; corrugated on top. Built flat, then tipped to the roof's slope.
    const T = MARSHAL.roof,
      S = MARSHAL.side;
    const beta = Math.atan(L.slope),
      c = Math.cos(beta),
      sn = Math.sin(beta);
    const y0 = -m.overhang,
      len = (D + S - y0) / c;
    const flat = [box(-S, 0, 0, W + S, len, T)];
    if (m.roof === 'tin') {
      const [pitch, high] = MARSHAL.rib;
      for (let x = -S + pitch / 2; x <= W + S - pitch / 2 + 1e-6; x += pitch)
        flat.push(sweep([[x - high * 1.2, T - 0.01], [x + high * 1.2, T - 0.01], [x, T + high]], [1, 0, 0], UP, [0, 0, 0], [0, 1, 0], 0, len));
    }
    let roof = own(union(flat).transform([1, 0, 0, 0, 0, c, -sn, 0, 0, sn, c, 0, 0, y0, under(y0), 1]));
    const h = pin / 2 + MARSHAL.play;
    roof = own(roof.subtract(union(corners.map(([x, y]) => box(x - h, y - h, under(y) - 1, x + h, y + h, under(y) + T / c + 3)))));
    parts.push({ id: 'roof', name: m.roof === 'tin' ? 'Tin roof' : 'Roof', role: 'roof', solid: roof, lie: [(beta * 180) / Math.PI, 0, 0], apart: [0, 0, 40] });

    // The ladder: two rails and rungs, leaning from the base up to the opening in the back wall.
    if (L.ladder) {
      const Q = MARSHAL.ladder;
      const ll = Math.hypot(L.rise, L.run);
      const t = [0, -L.run / ll, L.rise / ll],
        out = [0, L.rise / ll, L.run / ll];
      const total = ll + Q.above / t[2] + 4;
      const bits = [box(0, -4, 0, Q.rail, total, Q.thick), box(Q.width - Q.rail, -4, 0, Q.width, total, Q.thick)];
      for (let v = Q.pitch; v <= ll - 2; v += Q.pitch) bits.push(box(Q.rail - 0.01, v - Q.rung / 2, 0, Q.width - Q.rail + 0.01, v + Q.rung / 2, Q.thick));
      // u across (towards -x, so its face is outward), v up the ladder, w out of it.
      let ladder = own(union(bits).transform([-1, 0, 0, 0, ...t, 0, ...out, 0, W / 2 + Q.width / 2, D + L.run, MARSHAL.base, 1]));
      ladder = own(own(ladder.trimByPlane([0, 0, 1], MARSHAL.base)).trimByPlane([0, 0, -1], -(L.top + Q.above)));
      parts.push({ id: 'ladder', name: 'Ladder', role: 'frame', solid: ladder, lie: [(Math.atan2(out[1], out[2]) * 180) / Math.PI, 0, 0], apart: [0, 15, 0] });
    }

    // The number: a disc on the front wall, its number raised in seven segments.
    if (m.numbers) {
      const [r0, dt] = MARSHAL.disc;
      const r = Math.min(r0, m.wallHeight / 2 - 1);
      const B = (u0, v0, w0, u1, v1, w1) => box(u0, v0, w0, u1, v1, w1);
      const text = String(m.number);
      const dh = r * 0.9,
        dw = Math.min(dh * 0.6, (1.3 * r - 1.2 * (text.length - 1)) / text.length);
      const disc = own(Manifold.cylinder(dt, r, r, 48));
      const local = union([disc, ...sevenSegments(text, B, { cv: 0, dw, dh, st: Math.max(0.8, dh / 7), gap: 1.2, w0: dt - 0.01, w1: dt + 0.8 })]);
      // u along x, v up, w out of the front wall.
      const placed = own(local.transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, W / 2, 0, (L.top + L.wall) / 2, 1]));
      parts.push({ id: 'number', name: 'Number ' + text, role: 'frame', solid: placed, outward: [0, -1, 0], apart: [0, -12, 0] });
    }
    const keep = new Set(parts.map((p) => p.solid));
    for (const x of new Set(temp)) if (!keep.has(x)) x.delete();
    return parts;
  } catch (e) {
    for (const x of new Set(temp)) x.delete();
    throw e;
  }
}

/** A leg, square: thicker under a tall post. */
export function legOf(m) {
  const [low, tall, from] = MARSHAL.leg;
  return m.deckHeight >= from ? tall : low;
}

/** Where the legs stand under the floor: a little in from each corner. */
function legsAt(m) {
  const g = legOf(m) / 2 + 1;
  return [
    [g, g],
    [m.width - g, g],
    [g, m.depth - g],
    [m.width - g, m.depth - g],
  ];
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
