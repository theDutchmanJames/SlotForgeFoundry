// A building as a kit: a base plate as high as the track, four walls that
// drop into a groove in it and meet at mitred corners, a roof, a door
// insert, and windows and doors cut into any wall, with frames if wanted.
// Every part prints flat without supports. Sizes are toy proportions for
// 1:32 by default: a one-car garage is about 120 × 180 mm and 75 mm high and
// takes practically any slot car.

export const WALLS = Object.freeze(['front', 'left', 'back', 'right']);
export const WALL_NAMES = Object.freeze({ front: 'Front', back: 'Back', left: 'Left', right: 'Right' });
export const ROOFS = Object.freeze([
  ['flat', 'Flat'],
  ['slope', 'Single slope'],
  ['gable', 'Two-sided'],
]);
export const BUILDING_DEFAULTS = Object.freeze({
  kind: 'garage',
  width: 120, // outside of the walls, across the door
  depth: 180, // outside of the walls, front to back
  height: 75, // walls, from the top of the base to the eaves
  baseHeight: 10, // as high as the track, so the doorstep is level with the road
  doorWidth: 90,
  doorHeight: 55,
  door: 'roller', // 'roller' or 'open'
  roof: 'flat', // 'flat', 'slope' or 'gable'
  pitch: 30, // degrees, for a sloped or two-sided roof
  ridge: 'depth', // two-sided: the ridge runs front to back ('depth') or side to side ('width')
  rises: 'back', // single slope: the side the roof rises towards
  overhangFront: 3,
  overhangBack: 3,
  overhangLeft: 3,
  overhangRight: 3,
  openings: Object.freeze([]),
});
export const BUILDING_LIMITS = Object.freeze({
  width: [60, 400],
  depth: [60, 400],
  height: [30, 200],
  baseHeight: [4, 40],
  doorWidth: [20, 380],
  doorHeight: [15, 190],
  pitch: [10, 45],
  overhangFront: [0, 30],
  overhangBack: [0, 30],
  overhangLeft: [0, 30],
  overhangRight: [0, 30],
});
// A new window or door, in toy proportions for 1:32.
export const OPENING_DEFAULTS = Object.freeze({
  window: Object.freeze({ type: 'window', width: 40, height: 30, sill: 25, frame: false }),
  door: Object.freeze({ type: 'door', width: 28, height: 48, sill: 0, frame: false }),
});
export const MAX_OPENINGS = 16;
// Fixed sizes of the kit, in mm. Nothing thinner than 2 mm.
export const KIT = Object.freeze({
  wall: 3, // wall thickness
  ledge: 3, // base beyond the walls
  groove: 2, // depth of the wall groove in the base
  play: 0.2, // clearance each side of a wall in its groove, and around the roof lip
  shell: 2, // the base's side walls, it is hollow underneath
  deck: 4, // the base's top, under the groove too
  roof: 3, // roof thickness
  lip: 2, // flat roof lip, its width
  lipDepth: 3, // flat roof lip, how far it reaches down
  frame: 6, // wall kept beside and above an opening, and between two
  insert: 2, // door insert plate
  rib: 1, // its ribs stand out this far
  ribPitch: 5,
  margin: 3, // door insert beyond the opening on each side and above
  trim: 3, // a window or door frame: its width around the opening
  trimDepth: 2, // how far a frame stands out from the wall
  bar: 2, // the cross in a window frame
});
const LABELS = {
  width: 'Width',
  depth: 'Depth',
  height: 'Wall height',
  baseHeight: 'Base height',
  doorWidth: 'Door width',
  doorHeight: 'Door height',
  pitch: 'Roof pitch',
  overhangFront: 'Overhang at the front',
  overhangBack: 'Overhang at the back',
  overhangLeft: 'Overhang on the left',
  overhangRight: 'Overhang on the right',
};
const UNITS = { pitch: '°' };
const OPENING_KEYS = ['wall', 'type', 'at', 'width', 'height', 'sill', 'frame'];

/** The length of a wall along its outside face. */
export const wallLength = (b, wall) => (wall === 'front' || wall === 'back' ? b.width : b.depth);
const openingName = (o, i, all) => {
  const same = all.filter((x) => x.wall === o.wall && x.type === o.type);
  const n = same.indexOf(o) + 1;
  return WALL_NAMES[o.wall] + ' ' + o.type + (same.length > 1 ? ' ' + n : '');
};

function checkOpening(o, i, b) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw Error('Opening ' + (i + 1) + ' is not a window or a door.');
  for (const key of Object.keys(o))
    if (!OPENING_KEYS.includes(key)) throw Error('Opening ' + (i + 1) + ' has an unknown setting: ' + key + '.');
  const kind = o.type === 'window' || o.type === 'door' ? o.type : null;
  if (!kind) throw Error('Opening ' + (i + 1) + ' must be a window or a door.');
  const full = { ...OPENING_DEFAULTS[kind], ...o, sill: kind === 'door' ? 0 : (o.sill ?? OPENING_DEFAULTS.window.sill) };
  if (!WALLS.includes(full.wall)) throw Error('Choose a wall for opening ' + (i + 1) + '.');
  if (typeof full.frame !== 'boolean') throw Error('Choose whether opening ' + (i + 1) + ' has a frame.');
  const L = wallLength(b, full.wall);
  if (full.at === undefined) full.at = L / 2;
  for (const [key, min, max] of [
    ['width', 8, L],
    ['height', 8, b.height],
    ['sill', 0, b.height],
    ['at', 0, L],
  ])
    if (!Number.isFinite(full[key]) || full[key] < min || full[key] > max)
      throw Error('The ' + kind + ' on the ' + full.wall + ' wall: ' + key + ' must be between ' + min + ' and ' + fmtMm(max) + ' mm.');
  return full;
}
const fmtMm = (v) => String(Math.round(v * 10) / 10);

/** The building as it is kept: known settings only, each checked. */
export function validateBuilding(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const b = { ...BUILDING_DEFAULTS, ...raw };
  for (const key of Object.keys(b))
    if (!Object.hasOwn(BUILDING_DEFAULTS, key)) throw Error('The building has an unknown setting: ' + key + '.');
  if (b.kind !== 'garage') throw Error('Choose a building type from the list.');
  if (!['roller', 'open'].includes(b.door)) throw Error('Choose a door from the list.');
  if (!ROOFS.some(([id]) => id === b.roof)) throw Error('Choose a roof from the list.');
  if (!['depth', 'width'].includes(b.ridge)) throw Error('Choose which way the ridge runs.');
  if (!WALLS.includes(b.rises)) throw Error('Choose the side the roof rises towards.');
  for (const [key, [min, max]] of Object.entries(BUILDING_LIMITS))
    if (!Number.isFinite(b[key]) || b[key] < min || b[key] > max)
      throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (UNITS[key] ?? ' mm') + '.');
  const room = b.width - 2 * KIT.wall - 2 * KIT.frame;
  if (b.doorWidth > room)
    throw Error('The door is too wide for this building: at most ' + room + ' mm at ' + b.width + ' mm wide.');
  const tall = b.height - KIT.frame;
  if (b.doorHeight > tall)
    throw Error('The door is too high for these walls: at most ' + tall + ' mm at ' + b.height + ' mm high.');
  if (!Array.isArray(b.openings)) throw Error('The windows and doors of the building are not a list.');
  if (b.openings.length > MAX_OPENINGS) throw Error('A building has at most ' + MAX_OPENINGS + ' windows and doors.');
  const openings = b.openings.map((o, i) => checkOpening(o, i, b));
  // Each opening keeps wall beside it: at the corners, above it, and
  // between it and the next one, the garage door included.
  const named = openings.map((o, i) => ({ ...o, name: openingName(o, i, openings) }));
  for (const o of named) {
    const L = wallLength(b, o.wall);
    const lo = o.at - o.width / 2,
      hi = o.at + o.width / 2,
      edge = KIT.wall + KIT.frame;
    if (lo < edge || hi > L - edge)
      throw Error('The ' + o.name.toLowerCase() + ' reaches into a corner: keep it ' + edge + ' mm from both ends of the ' + fmtMm(L) + ' mm wall.');
    if (o.sill + o.height > b.height - KIT.frame)
      throw Error('The ' + o.name.toLowerCase() + ' reaches too high: its top can be at most ' + (b.height - KIT.frame) + ' mm above the floor.');
  }
  const garage = { wall: 'front', at: b.width / 2, width: b.doorWidth, name: 'garage door' };
  for (const [i, a] of named.entries())
    for (const c of [...named.slice(i + 1), garage]) {
      if (a.wall !== c.wall) continue;
      const gap = Math.abs(a.at - c.at) - (a.width + c.width) / 2;
      if (gap < KIT.frame)
        throw Error('The ' + a.name.toLowerCase() + ' is too close to the ' + c.name.toLowerCase() + ': keep at least ' + KIT.frame + ' mm of wall between them.');
    }
  return { ...b, openings };
}

/** How the roof stands: the slope of each panel, and how high it rises. */
export function roofShape(b) {
  const t = Math.tan((b.pitch * Math.PI) / 180);
  if (b.roof === 'slope') {
    const dir = { back: [0, 1], front: [0, -1], right: [1, 0], left: [-1, 0] }[b.rises];
    const run = dir[1] ? b.depth : b.width;
    return { t, panels: [{ dir, s0: dir[0] < 0 ? -b.width : dir[1] < 0 ? -b.depth : 0, id: 'roof', name: 'Roof panel' }], rise: run * t };
  }
  if (b.roof === 'gable') {
    const half = (b.ridge === 'depth' ? b.width : b.depth) / 2;
    const panels =
      b.ridge === 'depth'
        ? [
            { dir: [1, 0], s0: 0, keep: [[-1, 0, 0], -b.width / 2], id: 'roof-left', name: 'Roof panel, left' },
            { dir: [-1, 0], s0: -b.width, keep: [[1, 0, 0], b.width / 2], id: 'roof-right', name: 'Roof panel, right' },
          ]
        : [
            { dir: [0, 1], s0: 0, keep: [[0, -1, 0], -b.depth / 2], id: 'roof-front', name: 'Roof panel, front' },
            { dir: [0, -1], s0: -b.depth, keep: [[0, 1, 0], b.depth / 2], id: 'roof-back', name: 'Roof panel, back' },
          ];
    return { t, panels, rise: half * t };
  }
  return { t: 0, panels: [], rise: 0 };
}

/** The parts of the kit, without geometry: their ids, names and roles. */
export function buildingLayout(input) {
  const b = validateBuilding(input);
  const parts = [
    { id: 'base', name: 'Base plate', role: 'buildingBase' },
    { id: 'front', name: 'Front wall', role: 'wall' },
    { id: 'back', name: 'Back wall', role: 'wall' },
    { id: 'left', name: 'Left wall', role: 'wall' },
    { id: 'right', name: 'Right wall', role: 'wall' },
  ];
  if (b.roof === 'flat') parts.push({ id: 'roof', name: 'Flat roof', role: 'roof' });
  else for (const p of roofShape(b).panels) parts.push({ id: p.id, name: p.name, role: 'roof' });
  if (b.door === 'roller') parts.push({ id: 'door', name: 'Roller door', role: 'door' });
  b.openings.forEach((o, i) => {
    if (o.frame)
      parts.push({ id: 'frame-' + (i + 1), name: openingName(o, i, b.openings) + ' frame', role: 'frame' });
  });
  return { building: b, parts, door: { x: (b.width - b.doorWidth) / 2, width: b.doorWidth, height: b.doorHeight } };
}

/** Whether a part of this print size fits the plate, turned if need be. */
export function fitsPlate([x, y], plate) {
  const w = plate.width - 2 * (plate.margin ?? 0),
    d = plate.depth - 2 * (plate.margin ?? 0);
  return (x <= w && y <= d) || (x <= d && y <= w);
}

// The building stands with its front (the garage door) at y = 0, from x = 0
// to its width and y = 0 to its depth; the table is z = 0.
export function buildGarage(wasm, input) {
  const { Manifold } = wasm;
  const { building: b, door } = buildingLayout(input);
  const { wall: t, groove: g, ledge: m, play: c, shell, deck, roof: rt } = KIT;
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const box = (x0, y0, z0, x1, y1, z1) =>
    own(Manifold.cube([Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)]).translate([Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)]));
  const minus = (a, ...cuts) => (cuts.length ? own(a.subtract(own(Manifold.union(cuts)))) : a);
  const trim = (s, n, offset) => own(s.trimByPlane(n, offset));
  const W = b.width,
    D = b.depth,
    top = b.baseHeight,
    z1 = top + b.height;
  const shape = roofShape(b);
  // A box given along a wall: u along its outside face from its left end as
  // seen from outside, n outward from that face, z up.
  const onWall = (wall, u0, u1, n0, n1, za, zb) => {
    if (wall === 'front') return box(u0, -n0, za, u1, -n1, zb);
    if (wall === 'back') return box(W - u0, D + n0, za, W - u1, D + n1, zb);
    if (wall === 'left') return box(-n0, D - u0, za, -n1, D - u1, zb);
    return box(W + n0, u0, za, W + n1, u1, zb);
  };
  const OUTWARD = { front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
  try {
    // Base: a hollow tray as high as the track, with the wall groove on top.
    const outer = box(-m, -m, 0, W + m, D + m, top);
    const hollow = box(-m + shell, -m + shell, -1, W + m - shell, D + m - shell, top - deck);
    const groove = minus(
      box(-c, -c, top - g, W + c, D + c, top + 1),
      box(t + c, t + c, top - g - 1, W - t - c, D - t - c, top + 2),
    );
    const base = minus(outer, hollow, groove);

    // Walls: each from the bottom of the groove up to the roof, mitred at 45°
    // so the outside of a corner has no seam. Under a sloped or two-sided
    // roof a wall follows the underside of the roof: a gable gets its point.
    const z0 = top - g,
      zTop = z1 + shape.rise + 1;
    const r = Math.SQRT1_2;
    const underRoof = (s) => {
      for (const p of shape.panels) {
        const [dx, dy] = p.dir;
        const len = Math.hypot(shape.t * dx, shape.t * dy, 1);
        s = trim(s, [shape.t * dx, shape.t * dy, -1], -(z1 - shape.t * p.s0) / len);
      }
      return s;
    };
    const wallTop = b.roof === 'flat' ? z1 : zTop;
    const walls = {
      front: trim(trim(box(0, 0, z0, W, t, wallTop), [1, -1, 0], 0), [-1, -1, 0], -W * r),
      back: trim(trim(box(0, D - t, z0, W, D, wallTop), [1, 1, 0], D * r), [-1, 1, 0], (D - W) * r),
      left: trim(trim(box(0, 0, z0, t, D, wallTop), [-1, 1, 0], 0), [-1, -1, 0], -D * r),
      right: trim(trim(box(W - t, 0, z0, W, D, wallTop), [1, 1, 0], W * r), [1, -1, 0], (W - D) * r),
    };
    for (const w of WALLS) walls[w] = underRoof(walls[w]);
    // The garage door: open from the top of the base, so the doorstep is level.
    const holes = { front: [box(door.x, -1, top, door.x + door.width, t + 1, top + door.height)], back: [], left: [], right: [] };
    for (const o of b.openings)
      holes[o.wall].push(onWall(o.wall, o.at - o.width / 2, o.at + o.width / 2, -t - 1, 1, top + o.sill, top + o.sill + o.height));
    for (const w of WALLS) walls[w] = minus(walls[w], ...holes[w]);

    // Roof.
    const ov = { front: b.overhangFront, back: b.overhangBack, left: b.overhangLeft, right: b.overhangRight };
    const roofParts = [];
    if (b.roof === 'flat') {
      // A plate with its overhangs, and a lip underneath that drops between
      // the walls and keeps them square.
      const plate = box(-ov.left, -ov.front, z1, W + ov.right, D + ov.back, z1 + rt);
      const lip = minus(
        box(t + c, t + c, z1 - KIT.lipDepth, W - t - c, D - t - c, z1),
        box(t + c + KIT.lip, t + c + KIT.lip, z1 - KIT.lipDepth - 1, W - t - c - KIT.lip, D - t - c - KIT.lip, z1 + 1),
      );
      roofParts.push({ id: 'roof', name: 'Flat roof', role: 'roof', solid: own(plate.add(lip)), flip: true });
    } else {
      // Each panel lies on the walls at the pitch, as thick as the roof, and
      // reaches past the walls by the overhang of each side.
      const cosA = 1 / Math.hypot(shape.t, 1);
      for (const p of shape.panels) {
        const [dx, dy] = p.dir;
        const len = Math.hypot(shape.t * dx, shape.t * dy, 1);
        let s = box(-ov.left, -ov.front, z1 - 60, W + ov.right, D + ov.back, z1 + shape.rise + 60);
        s = trim(s, [-shape.t * dx, -shape.t * dy, 1], (z1 - shape.t * p.s0) / len);
        s = trim(s, [shape.t * dx, shape.t * dy, -1], -(z1 - shape.t * p.s0 + rt / cosA) / len);
        if (p.keep) s = trim(s, p.keep[0], p.keep[1]);
        const deg = (Math.atan(shape.t) * 180) / Math.PI;
        roofParts.push({ id: p.id, name: p.name, role: 'roof', solid: s, lie: [-deg * dy, deg * dx, 0] });
      }
    }

    const parts = [
      { id: 'base', name: 'Base plate', role: 'buildingBase', solid: base, flip: true },
      ...['front', 'back', 'left', 'right'].map((w) => ({
        id: w,
        name: WALL_NAMES[w] + ' wall',
        role: 'wall',
        solid: walls[w],
        outward: OUTWARD[w],
      })),
      ...roofParts,
    ];
    if (b.door === 'roller') {
      // A plate behind the opening, standing on the floor inside, with ribs
      // facing out through the opening like the slats of a roller door.
      const x0 = door.x - KIT.margin,
        x1 = door.x + door.width + KIT.margin;
      let insert = box(x0, t, top, x1, t + KIT.insert, top + door.height + KIT.margin);
      const ribs = [];
      for (let z = top + KIT.ribPitch / 2; z + 1 <= top + door.height; z += KIT.ribPitch)
        ribs.push(box(door.x + 0.5, t - KIT.rib, z, door.x + door.width - 0.5, t, z + 1.6));
      if (ribs.length) insert = own(insert.add(own(Manifold.union(ribs))));
      parts.push({ id: 'door', name: 'Roller door', role: 'door', solid: insert, outward: [0, -1, 0] });
    }
    // Frames: a band around the opening on the outside of the wall, open at
    // the bottom for a door; a window gets a cross in it.
    const { trim: k, trimDepth: fd, bar } = KIT;
    b.openings.forEach((o, i) => {
      if (!o.frame) return;
      const u0 = o.at - o.width / 2,
        u1 = o.at + o.width / 2,
        za = top + o.sill,
        zb = za + o.height;
      const bottom = o.type === 'window' ? za - k : za;
      let frame = minus(onWall(o.wall, u0 - k, u1 + k, 0, fd, bottom, zb + k), onWall(o.wall, u0, u1, -1, fd + 1, za, zb));
      if (o.type === 'window') {
        const um = (u0 + u1) / 2,
          zm = (za + zb) / 2;
        frame = own(frame.add(own(Manifold.union([
          onWall(o.wall, um - bar / 2, um + bar / 2, 0, fd, za, zb),
          onWall(o.wall, u0, u1, 0, fd, zm - bar / 2, zm + bar / 2),
        ]))));
      }
      parts.push({ id: 'frame-' + (i + 1), name: openingName(o, i, b.openings) + ' frame', role: 'frame', solid: frame, outward: OUTWARD[o.wall] });
    });
    // Keep the parts; free everything else.
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}

/**
 * A part turned to how it prints, on the plate at the origin: a wall, a
 * frame or the door with its outside face up, the base and the flat roof
 * upside down, a roof panel lying on its underside.
 */
export function printPose(part) {
  const s = part.solid;
  let turned;
  if (part.flip) turned = s.rotate([180, 0, 0]);
  else if (part.lie) turned = s.rotate(part.lie);
  else {
    const [x, y] = part.outward;
    turned = y < 0 ? s.rotate([-90, 0, 0]) : y > 0 ? s.rotate([90, 0, 0]) : x < 0 ? s.rotate([0, 90, 0]) : s.rotate([0, -90, 0]);
  }
  const { min } = turned.boundingBox();
  const placed = turned.translate([-min[0], -min[1], -min[2]]);
  turned.delete();
  return placed;
}

/** The size of a part as it lies on the plate. */
export function printSize(part) {
  const printed = printPose(part);
  try {
    return printed.boundingBox().max.map((v) => Math.round(v * 10) / 10);
  } finally {
    printed.delete();
  }
}
