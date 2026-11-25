// A building as a kit: a base plate as high as the track, four walls that
// drop into a groove in it and meet at mitred corners, a roof, a door
// insert, and windows and doors cut into any wall, with frames if wanted.
// Up to two more storeys stand on top, each a building of its own size on a
// floor slab: its own height, windows, doors and wall texture. The roof sits
// on the top storey. Every part prints flat without supports. Sizes are toy
// proportions for 1:32 by default: a one-car garage is about 120 × 180 mm
// and 75 mm high and takes practically any slot car.

import { DRAWN, ROOF_TEXTURES, TEXTURE_DEFAULTS, TEXTURE_LIMITS, WALL_TEXTURES, roofJoints, wallJoints } from './building-texture.js';
import { JOINT, planCuts, seamRegion, tabPlaces, validateCuts } from './building-cuts.js';

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
  ...TEXTURE_DEFAULTS,
  upper: Object.freeze([]), // the storeys above the ground floor, at most two
  lane: null, // a garage over a pit bay: { width } of the track that runs in through its door
  braces: true, // a corner brace in each inside corner, holding the walls square
  // Rooms side by side ('width') or front to back ('depth'), each its size
  // outside to outside, to the middle of the dividing wall: they add up to
  // the width or the depth of the building.
  rooms: null, // { along, sizes: [mm, ...] }
  cuts: Object.freeze({}), // where the parts are cut to fit the plate; left out, they are set evenly
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
  ...TEXTURE_LIMITS,
});
// A storey above: its size, its place on the storey below (from that
// storey's left and front walls), its height, wall texture and openings.
export const UPPER_DEFAULTS = Object.freeze({ width: null, depth: null, x: 0, y: 0, height: 65, wallTexture: 'plain', openings: Object.freeze([]) });
export const MAX_UPPER = 2;
// A new window or door, in toy proportions for 1:32.
export const OPENING_DEFAULTS = Object.freeze({
  window: Object.freeze({ type: 'window', width: 40, height: 30, sill: 25, frame: false }),
  door: Object.freeze({ type: 'door', width: 28, height: 48, sill: 0, frame: false }),
});
export const MAX_OPENINGS = 16;
export const MAX_ROOMS = 4;
export const MIN_ROOM = 40;
/** Where the dividing walls stand: their middles, from the left or the front wall, outside. */
export const dividers = (b) =>
  b.rooms ? b.rooms.sizes.slice(0, -1).map((_, i) => b.rooms.sizes.slice(0, i + 1).reduce((a, v) => a + v, 0)) : [];
/**
 * The garage doors in the front wall: one in the middle, or with rooms side
 * by side one in the middle of each room. from, to: the room's inside, along the front wall.
 */
export function garageDoors(b) {
  const t = KIT.wall;
  if (b.rooms?.along !== 'width') return [{ x: (b.width - b.doorWidth) / 2, width: b.doorWidth, height: b.doorHeight, from: t, to: b.width - t, room: 1 }];
  const walls = dividers(b),
    edges = [0, ...walls, b.width];
  return b.rooms.sizes.map((_, i) => {
    const from = i ? edges[i] + t / 2 : t,
      to = i < walls.length ? edges[i + 1] - t / 2 : b.width - t;
    return { x: (from + to) / 2 - b.doorWidth / 2, width: b.doorWidth, height: b.doorHeight, from, to, room: i + 1 };
  });
}
// Fixed sizes of the kit, in mm. Nothing thinner than 2 mm.
export const KIT = Object.freeze({
  wall: 3, // wall thickness
  ledge: 3, // base beyond the walls
  groove: 2, // depth of the wall groove in the base and in a floor
  play: 0.2, // clearance each side of a wall in its groove, and around a lip
  shell: 2, // the base's side walls, it is hollow underneath
  deck: 4, // the base's top, under the groove too
  slab: 4, // a floor between two storeys
  roof: 3, // roof thickness
  lip: 2, // a lip under a flat roof or a floor, its width
  lipDepth: 3, // and how far it reaches down between the walls
  frame: 6, // wall kept beside and above an opening, and between two
  insert: 2, // door insert plate
  rib: 1, // its ribs stand out this far
  ribPitch: 5,
  margin: 3, // door insert beyond the opening on each side and above
  trim: 3, // a window or door frame: its width around the opening
  trimDepth: 2, // how far a frame stands out from the wall
  bar: 2, // the cross in a window frame
  brace: 2, // a corner brace: its legs are this thick
  braceLeg: 5.5, // and reach this far along each wall, clear of a window or a door
  braceHeight: 60, // at most this tall, from the floor: the lip above holds the tops
  laneClear: 2, // a garage door beyond the track through it, each side
  lanePlay: 0.5, // the base beside the track through it, each side
});
// The exploded view: how far each part comes off, in mm, fully apart. A
// wall moves out and up out of its groove, a floor lifts off the walls
// below, each storey lifts above the one below, the roof comes off the top,
// the door slides in from behind its opening, and a frame comes off its wall.
export const APART = Object.freeze({ out: 20, up: 12, storey: 45, roof: 30, door: 25, frame: 15, ridge: 8, piece: 6 });
const add3 = (a, b) => a.map((v, i) => v + b[i]);
const scale3 = (a, k) => a.map((v) => v * k);
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
  textureScale: 'Texture size',
  textureJoint: 'Joint width',
  textureDepth: 'Joint depth',
};
const UNITS = { pitch: '°', textureScale: ' %' };
const OPENING_KEYS = ['wall', 'type', 'at', 'width', 'height', 'sill', 'frame'];
const UPPER_KEYS = Object.keys(UPPER_DEFAULTS);
const STOREY_SUFFIX = ['', ', ground floor', ', storey 2', ', storey 3'];

/** The length of a wall along its outside face, on a storey of this size. */
export const wallLength = (dims, wall) => (wall === 'front' || wall === 'back' ? dims.width : dims.depth);
const fmtMm = (v) => String(Math.round(v * 10) / 10);
const openingName = (o, all) => {
  const same = all.filter((x) => x.wall === o.wall && x.type === o.type);
  return WALL_NAMES[o.wall] + ' ' + o.type + (same.length > 1 ? ' ' + (same.indexOf(o) + 1) : '');
};

function checkOpening(o, i, dims, where) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw Error('Opening ' + (i + 1) + where + ' is not a window or a door.');
  for (const key of Object.keys(o))
    if (!OPENING_KEYS.includes(key)) throw Error('Opening ' + (i + 1) + where + ' has an unknown setting: ' + key + '.');
  const kind = o.type === 'window' || o.type === 'door' ? o.type : null;
  if (!kind) throw Error('Opening ' + (i + 1) + where + ' must be a window or a door.');
  const full = { ...OPENING_DEFAULTS[kind], ...o, sill: kind === 'door' ? 0 : (o.sill ?? OPENING_DEFAULTS.window.sill) };
  if (!WALLS.includes(full.wall)) throw Error('Choose a wall for opening ' + (i + 1) + where + '.');
  if (typeof full.frame !== 'boolean') throw Error('Choose whether opening ' + (i + 1) + where + ' has a frame.');
  const L = wallLength(dims, full.wall);
  if (full.at === undefined) full.at = L / 2;
  for (const [key, min, max] of [
    ['width', 8, L],
    ['height', 8, dims.height],
    ['sill', 0, dims.height],
    ['at', 0, L],
  ])
    if (!Number.isFinite(full[key]) || full[key] < min || full[key] > max)
      throw Error('The ' + kind + ' on the ' + full.wall + ' wall' + where + ': ' + key + ' must be between ' + min + ' and ' + fmtMm(max) + ' mm.');
  return full;
}

// The windows and doors of one storey: each keeps wall beside it, at the
// corners, above it, and between it and the next one, the garage door included.
function checkOpenings(list, dims, blocks, where) {
  if (!Array.isArray(list)) throw Error('The windows and doors' + where + ' are not a list.');
  if (list.length > MAX_OPENINGS) throw Error('A storey has at most ' + MAX_OPENINGS + ' windows and doors.');
  const openings = list.map((o, i) => checkOpening(o, i, dims, where));
  const named = openings.map((o) => ({ ...o, name: openingName(o, openings) + where }));
  for (const o of named) {
    const L = wallLength(dims, o.wall);
    const edge = KIT.wall + KIT.frame;
    if (o.at - o.width / 2 < edge || o.at + o.width / 2 > L - edge)
      throw Error('The ' + o.name.toLowerCase() + ' reaches into a corner: keep it ' + edge + ' mm from both ends of the ' + fmtMm(L) + ' mm wall.');
    if (o.sill + o.height > dims.height - KIT.frame)
      throw Error('The ' + o.name.toLowerCase() + ' reaches too high: its top can be at most ' + (dims.height - KIT.frame) + ' mm above the floor.');
  }
  for (const [i, a] of named.entries())
    for (const c of [...named.slice(i + 1), ...blocks]) {
      if (a.wall !== c.wall) continue;
      if (Math.abs(a.at - c.at) - (a.width + c.width) / 2 < KIT.frame)
        throw Error('The ' + a.name.toLowerCase() + ' is too close to the ' + c.name.toLowerCase() + ': keep at least ' + KIT.frame + ' mm of wall between them.');
    }
  return openings;
}

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
  if (!WALL_TEXTURES.some(([id]) => id === b.wallTexture)) throw Error('Choose a wall texture from the list.');
  if (typeof b.braces !== 'boolean') throw Error('Choose whether the corners get braces.');
  if (!ROOF_TEXTURES.some(([id]) => id === b.roofTexture)) throw Error('Choose a roof texture from the list.');
  // Rooms: their sizes make the width or the depth of the building.
  if (b.rooms !== null) {
    const r = b.rooms;
    if (
      !r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some((k) => !['along', 'sizes'].includes(k)) ||
      !['width', 'depth'].includes(r.along) || !Array.isArray(r.sizes) || r.sizes.length < 2 || r.sizes.length > MAX_ROOMS
    )
      throw Error('Rooms are 2 to ' + MAX_ROOMS + ' sizes, side by side or front to back.');
    r.sizes.forEach((v, i) => {
      if (!Number.isFinite(v) || v < MIN_ROOM || v > 400) throw Error('Room ' + (i + 1) + ' must be between ' + MIN_ROOM + ' and 400 mm.');
    });
    const sum = Math.round(r.sizes.reduce((a, v) => a + v, 0) * 10) / 10;
    if (sum > BUILDING_LIMITS[r.along][1]) throw Error('The rooms add up to ' + fmtMm(sum) + ' mm, more than the ' + BUILDING_LIMITS[r.along][1] + ' mm a building can be.');
    b[r.along] = sum;
    b.rooms = { along: r.along, sizes: [...r.sizes] };
  }
  for (const [key, [min, max]] of Object.entries(BUILDING_LIMITS))
    if (!Number.isFinite(b[key]) || b[key] < min || b[key] > max)
      throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (UNITS[key] ?? ' mm') + '.');
  const doors = garageDoors(b);
  for (const d of doors)
    if (d.width > d.to - d.from - 2 * KIT.frame + 1e-9)
      throw Error(
        doors.length > 1
          ? 'The door is too wide for room ' + d.room + ': at most ' + fmtMm(d.to - d.from - 2 * KIT.frame) + ' mm.'
          : 'The door is too wide for this building: at most ' + fmtMm(d.to - d.from - 2 * KIT.frame) + ' mm at ' + b.width + ' mm wide.',
      );
  const tall = b.height - KIT.frame;
  if (b.doorHeight > tall)
    throw Error('The door is too high for these walls: at most ' + tall + ' mm at ' + b.height + ' mm high.');
  // A garage over a pit bay: the track runs in through an open door, as wide as the track and more.
  if (b.lane !== null) {
    if (b.rooms) throw Error('A garage over a pit bay has one room.');
    if (!b.lane || typeof b.lane !== 'object' || Array.isArray(b.lane) || Object.keys(b.lane).some((k) => k !== 'width') || !Number.isFinite(b.lane.width) || b.lane.width < 20 || b.lane.width > 380)
      throw Error('The track through the garage must be 20 to 380 mm wide.');
    if (b.door !== 'open') throw Error('A garage over a track has an open door: a roller door would have no floor to stand on behind it.');
    const least = b.lane.width + 2 * KIT.laneClear;
    if (b.doorWidth < least - 1e-9) throw Error('The garage door is narrower than the track through it: make it at least ' + fmtMm(least) + ' mm wide.');
  }
  if (!Array.isArray(b.upper) || b.upper.length > MAX_UPPER) throw Error('A building has at most ' + MAX_UPPER + ' storeys above the ground floor.');
  const several = b.upper.length > 0;
  // Windows and doors keep wall beside the garage doors, and beside each
  // dividing wall where it meets an outside wall.
  const blocks = [
    ...doors.map((d) => ({ wall: 'front', at: d.x + d.width / 2, width: d.width, name: doors.length > 1 ? 'garage door of room ' + d.room : 'garage door' })),
    ...dividers(b).flatMap((at) =>
      (b.rooms.along === 'width'
        ? [{ wall: 'front', at }, { wall: 'back', at: b.width - at }]
        : [{ wall: 'right', at }, { wall: 'left', at: b.depth - at }]
      ).map((j) => ({ ...j, width: KIT.wall, name: 'dividing wall' })),
    ),
  ];
  const openings = checkOpenings(b.openings, b, blocks, several ? STOREY_SUFFIX[1] : '');
  // Each storey above stands on the one below, inside its walls.
  let below = { width: b.width, depth: b.depth };
  const upper = b.upper.map((u, i) => {
    const n = i + 2,
      where = STOREY_SUFFIX[n];
    if (!u || typeof u !== 'object' || Array.isArray(u)) throw Error('Storey ' + n + ' is not readable.');
    for (const key of Object.keys(u)) if (!UPPER_KEYS.includes(key)) throw Error('Storey ' + n + ' has an unknown setting: ' + key + '.');
    const s = { ...UPPER_DEFAULTS, ...u };
    s.width ??= below.width - s.x;
    s.depth ??= below.depth - s.y;
    for (const [key, name, min, max] of [
      ['x', 'its place from the left', 0, below.width],
      ['y', 'its place from the front', 0, below.depth],
      ['width', 'Width', 60, below.width],
      ['depth', 'Depth', 60, below.depth],
      ['height', 'Wall height', 30, 200],
    ])
      if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max)
        throw Error('Storey ' + n + ': ' + name + ' must be between ' + min + ' and ' + fmtMm(max) + ' mm.');
    if (s.x + s.width > below.width + 1e-9 || s.y + s.depth > below.depth + 1e-9)
      throw Error('Storey ' + n + ' reaches past the storey below: it is ' + fmtMm(s.width) + ' × ' + fmtMm(s.depth) + ' mm at ' + fmtMm(s.x) + ', ' + fmtMm(s.y) + ' mm on a storey of ' + fmtMm(below.width) + ' × ' + fmtMm(below.depth) + ' mm.');
    if (!WALL_TEXTURES.some(([id]) => id === s.wallTexture)) throw Error('Choose a wall texture from the list for storey ' + n + '.');
    s.openings = checkOpenings(s.openings, s, [], where);
    below = s;
    return s;
  });
  return { ...b, openings, upper, cuts: validateCuts(b.cuts) };
}

/**
 * The storeys of a building from the ground up: each with its size, where
 * it stands (ox, oy from the ground floor's left and front walls), the
 * height of its floor (the top of the base, or of the slab under it) and
 * of its eaves, its wall texture and openings, and its part ids.
 */
export function storeyStack(b) {
  const several = b.upper.length > 0;
  const out = [];
  let z = b.baseHeight;
  let ox = 0,
    oy = 0;
  const all = [{ width: b.width, depth: b.depth, x: 0, y: 0, height: b.height, wallTexture: b.wallTexture, openings: b.openings }, ...b.upper];
  all.forEach((s, i) => {
    const n = i + 1;
    if (i) z += KIT.slab;
    ox += s.x;
    oy += s.y;
    out.push({
      n,
      width: s.width,
      depth: s.depth,
      ox,
      oy,
      floor: z,
      eave: z + s.height,
      height: s.height,
      wallTexture: s.wallTexture,
      openings: s.openings,
      garage: i === 0,
      top: i === all.length - 1,
      suffix: n > 1 ? String(n) : '',
      label: several ? STOREY_SUFFIX[n] : '',
    });
    z += s.height;
  });
  return out;
}

/** How the roof stands on the top storey: the slope of each panel, and how high it rises. */
export function roofShape(b) {
  const top = storeyStack(b).at(-1);
  const W = top.width,
    D = top.depth;
  const t = Math.tan((b.pitch * Math.PI) / 180);
  if (b.roof === 'slope') {
    const dir = { back: [0, 1], front: [0, -1], right: [1, 0], left: [-1, 0] }[b.rises];
    const run = dir[1] ? D : W;
    return { t, panels: [{ dir, s0: dir[0] < 0 ? -W : dir[1] < 0 ? -D : 0, id: 'roof', name: 'Roof panel' }], rise: run * t };
  }
  if (b.roof === 'gable') {
    const half = (b.ridge === 'depth' ? W : D) / 2;
    const panels =
      b.ridge === 'depth'
        ? [
            { dir: [1, 0], s0: 0, keep: [[-1, 0, 0], -W / 2], id: 'roof-left', name: 'Roof panel, left' },
            { dir: [-1, 0], s0: -W, keep: [[1, 0, 0], W / 2], id: 'roof-right', name: 'Roof panel, right' },
          ]
        : [
            { dir: [0, 1], s0: 0, keep: [[0, -1, 0], -D / 2], id: 'roof-front', name: 'Roof panel, front' },
            { dir: [0, -1], s0: -D, keep: [[0, 1, 0], D / 2], id: 'roof-back', name: 'Roof panel, back' },
          ];
    return { t, panels, rise: half * t };
  }
  return { t: 0, panels: [], rise: 0 };
}

/**
 * The inside corners of a storey that take a corner brace: an L that stands
 * on the floor against both walls, up to just under the lip of the roof or
 * the floor above, at most braceHeight. Not where the track runs through a garage, nor where a
 * roller door stands behind its opening. x, y: where each leg reaches.
 */
export function braceCorners(b, s, doors) {
  if (!b.braces || s.height - KIT.lipDepth - 1 < 10) return [];
  const lo = KIT.wall + KIT.play,
    leg = KIT.braceLeg,
    W = s.width,
    D = s.depth;
  const corners = [
    { key: 'fl', name: 'front left', x: [lo, lo + leg], y: [lo, lo + leg], sx: 1, sy: 1 },
    { key: 'fr', name: 'front right', x: [W - lo - leg, W - lo], y: [lo, lo + leg], sx: -1, sy: 1 },
    { key: 'bl', name: 'back left', x: [lo, lo + leg], y: [D - lo - leg, D - lo], sx: 1, sy: -1 },
    { key: 'br', name: 'back right', x: [W - lo - leg, W - lo], y: [D - lo - leg, D - lo], sx: -1, sy: -1 },
  ];
  return corners.filter((q) => {
    if (s.garage && b.lane) {
      const half = b.lane.width / 2 + KIT.lanePlay;
      if (q.x[1] > W / 2 - half && q.x[0] < W / 2 + half) return false;
    }
    if (s.garage && b.door === 'roller' && q.sy > 0 && doors.some((door) => q.x[1] > door.x - KIT.margin && q.x[0] < door.x + door.width + KIT.margin)) return false;
    return true;
  });
}

const doorPart = (d, doors) =>
  doors.length > 1 ? { id: 'door' + d.room, name: 'Roller door, room ' + d.room, role: 'door' } : { id: 'door', name: 'Roller door', role: 'door' };
const dividerParts = (b) =>
  dividers(b).map((_, i, all) => ({ id: 'divide' + (i + 1), name: 'Dividing wall' + (all.length > 1 ? ' ' + (i + 1) : ''), role: 'divider' }));
/** How high the ceiling is over a point of a storey: the floor above or the roof, under a sloped roof its underside. */
function ceilingAt(b, s, shape, x, y) {
  if (!s.top || b.roof === 'flat') return s.eave;
  return Math.min(...shape.panels.map((p) => s.eave + shape.t * (p.dir[0] * x + p.dir[1] * y - p.s0)));
}

/** The parts of the kit, without geometry: their ids, names and roles. */
export function buildingLayout(input) {
  const b = validateBuilding(input);
  const storeys = storeyStack(b);
  const parts = [{ id: 'base', name: 'Base plate', role: 'buildingBase' }];
  const doors = garageDoors(b);
  for (const s of storeys) {
    if (s.n > 1) parts.push({ id: 'floor' + s.n, name: 'Floor of storey ' + s.n, role: 'floor' });
    for (const w of ['front', 'back', 'left', 'right']) parts.push({ id: w + s.suffix, name: WALL_NAMES[w] + ' wall' + s.label, role: 'wall' });
    if (s.garage) parts.push(...dividerParts(b));
  }
  if (b.roof === 'flat') parts.push({ id: 'roof', name: 'Flat roof', role: 'roof' });
  else for (const p of roofShape(b).panels) parts.push({ id: p.id, name: p.name, role: 'roof' });
  if (b.door === 'roller') parts.push(...doors.map((d) => doorPart(d, doors)));
  for (const s of storeys)
    for (const q of braceCorners(b, s, doors)) parts.push({ id: 'brace' + s.suffix + '-' + q.key, name: 'Corner brace, ' + q.name + s.label, role: 'brace' });
  for (const s of storeys)
    s.openings.forEach((o, i) => {
      if (o.frame) parts.push({ id: 'frame' + s.suffix + '-' + (i + 1), name: openingName(o, s.openings) + ' frame' + s.label, role: 'frame' });
    });
  return { building: b, storeys, parts, doors };
}

/** Whether a part of this print size fits the plate, turned if need be. */
export function fitsPlate([x, y], plate) {
  const w = plate.width - 2 * (plate.margin ?? 0),
    d = plate.depth - 2 * (plate.margin ?? 0);
  return (x <= w && y <= d) || (x <= d && y <= w);
}

// The openings of a storey along each wall, as [from, to], frames included;
// and across the height of the wall, measured from its foot in the groove.
function wallOpenings(s, doors) {
  const along = { front: [], back: [], left: [], right: [] },
    up = { front: [], back: [], left: [], right: [] };
  if (s.garage)
    for (const door of doors) {
      along.front.push([door.x, door.x + door.width]);
      up.front.push([KIT.groove, KIT.groove + door.height]);
    }
  for (const o of s.openings) {
    const extra = o.frame ? KIT.trim : 0;
    along[o.wall].push([o.at - o.width / 2 - extra, o.at + o.width / 2 + extra]);
    up[o.wall].push([KIT.groove + o.sill - (o.type === 'window' ? extra : 0), KIT.groove + o.sill + o.height + extra]);
  }
  return { along, up };
}

/**
 * Where a building is cut to fit a plate: for each part that is too long,
 * its cuts and the range each may move in. Without a plate, nothing is cut.
 */
export function buildingCuts(input, plate) {
  const { building: b, storeys, doors } = buildingLayout(input);
  const shape = roofShape(b);
  const rise = shape.rise;
  const walls = [];
  // A dividing wall: as long as the building is across it, as tall as the ceiling over it.
  const ground = storeys[0];
  dividers(b).forEach((at, i) => {
    const across = b.rooms.along === 'width',
      L = across ? b.depth : b.width;
    let high = 0;
    for (let k = 0; k <= 40; k++) {
      const u = (k / 40) * L;
      high = Math.max(high, ceilingAt(b, ground, shape, across ? at : u, across ? u : at) - ground.floor);
    }
    walls.push({ key: 'divide' + (i + 1), length: L, height: high + KIT.groove, keepOut: [], keepOutUp: [[-1, KIT.groove + JOINT.edge]] });
  });
  for (const s of storeys) {
    // A brick or block wall is cut along its joints: the seam steps half a brick either way.
    const step = ['brick', 'block'].includes(s.wallTexture) ? (DRAWN[s.wallTexture].length * b.textureScale) / 200 : 0;
    const aside = JOINT.aside + step;
    // Across the height a brick seam moves onto the nearest course line: up to half a course.
    const asideUp = JOINT.aside + (step ? (DRAWN[s.wallTexture].course * b.textureScale) / 200 : 0);
    const { along, up } = wallOpenings(s, doors);
    for (const w of ['front', 'back', 'left', 'right']) {
      // A wall prints as tall as it stands, its foot in the groove included.
      let high = s.height;
      if (s.top && b.roof === 'gable') high += (b.ridge === 'depth') === (w === 'front' || w === 'back') ? rise : 0;
      if (s.top && b.roof === 'slope') high += w === b.rises ? rise : (w === 'front' || w === 'back') === (b.rises === 'front' || b.rises === 'back') ? 0 : rise;
      walls.push({
        key: w + s.suffix,
        length: wallLength(s, w),
        height: high + KIT.groove,
        // A cut may run through an opening, not along its side; across the
        // height, not along its top or bottom, nor through the foot of the wall.
        keepOut: along[w].flatMap(([a, c]) => [[a - aside, a + aside], [c - aside, c + aside]]),
        keepOutUp: [[-1, KIT.groove + JOINT.edge], ...up[w].flatMap(([a, c]) => [[a - asideUp, a + asideUp], [c - asideUp, c + asideUp]])],
      });
    }
  }
  const top = storeys.at(-1);
  const ov = [b.overhangLeft + b.overhangRight, b.overhangFront + b.overhangBack];
  const slope = Math.hypot(1, shape.t);
  // A two-sided roof is cut along its ridge only; a slope prints longer than its plan.
  const roofExtent = [top.width + ov[0], top.depth + ov[1]];
  let scale = [1, 1];
  if (b.roof === 'slope') scale = b.rises === 'left' || b.rises === 'right' ? [slope, 1] : [1, slope];
  if (b.roof === 'gable') roofExtent[b.ridge === 'depth' ? 0 : 1] = 0;
  return planCuts(b, plate, {
    walls,
    flats: [
      { name: 'base', extent: [b.width + 2 * KIT.ledge, b.depth + 2 * KIT.ledge], scale: [1, 1] },
      // A floor covers the storey below it.
      ...storeys.slice(1).map((s, i) => ({ name: 'floor' + s.n, extent: [storeys[i].width, storeys[i].depth], scale: [1, 1] })),
      { name: 'roof', extent: roofExtent, scale },
    ],
  });
}

export function buildGarage(wasm, input, plate = null) {
  const { Manifold } = wasm;
  const { building: b, storeys, doors } = buildingLayout(input);
  const { wall: t, groove: g, ledge: m, play: c, shell, deck, roof: rt } = KIT;
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const box = (x0, y0, z0, x1, y1, z1) =>
    own(Manifold.cube([Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)]).translate([Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)]));
  const minus = (a, ...cuts) => (cuts.length ? own(a.subtract(own(Manifold.union(cuts)))) : a);
  const trim = (s, n, offset) => own(s.trimByPlane(n, offset));
  const shape = roofShape(b);
  const OUTWARD = { front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
  const plan = plate ? buildingCuts(b, plate) : null;
  const parts = [];
  try {
    // Base: a hollow tray as high as the track, with the wall groove on top.
    {
      const W = b.width,
        D = b.depth,
        top = b.baseHeight;
      const outer = box(-m, -m, 0, W + m, D + m, top);
      let hollow = box(-m + shell, -m + shell, -1, W + m - shell, D + m - shell, top - deck);
      const groove = minus(box(-c, -c, top - g, W + c, D + c, top + 1), box(t + c, t + c, top - g - 1, W - t - c, D - t - c, top + 2));
      // Over a pit bay the base is open from the front to the back wall for
      // the track, and closed along the track by a shell of its own.
      const cuts = [hollow, groove];
      // A groove for each dividing wall too, joining the one round the walls.
      for (const at of dividers(b))
        cuts.push(b.rooms.along === 'width' ? box(at - t / 2 - c, t, top - g, at + t / 2 + c, D - t, top + 1) : box(t, at - t / 2 - c, top - g, W - t, at + t / 2 + c, top + 1));
      if (b.lane) {
        const half = b.lane.width / 2 + KIT.lanePlay,
          end = D - t - c;
        cuts[0] = hollow = minus(hollow, box(W / 2 - half - shell, -m - 1, -2, W / 2 + half + shell, end + shell, top + 2));
        cuts.push(box(W / 2 - half, -m - 1, -1, W / 2 + half, end, top + 1));
      }
      const base = { id: 'base', name: 'Base plate', role: 'buildingBase', solid: minus(outer, ...cuts), flip: true, apart: [0, 0, 0] };
      parts.push(...cutFlat(base, plan && [plan.baseX, plan.baseY], [-m, -m]));
    }

    // Each storey is made where it stands on the storey below, in its own
    // frame (x from its left wall, y from its front wall), and moved into place.
    for (const s of storeys) {
      const W = s.width,
        D = s.depth,
        top = s.floor,
        z1 = s.eave;
      const own2 = [];
      // How far this storey lifts in the exploded view, and its walls with it.
      const lift = (s.n - 1) * APART.storey;
      const wallApart = (w) => add3(scale3(OUTWARD[w], APART.out), [0, 0, APART.up + lift]);
      const local = (...ps) => own2.push(...ps);
      const onWall = (wall, u0, u1, n0, n1, za, zb) => {
        if (wall === 'front') return box(u0, -n0, za, u1, -n1, zb);
        if (wall === 'back') return box(W - u0, D + n0, za, W - u1, D + n1, zb);
        if (wall === 'left') return box(-n0, D - u0, za, -n1, D - u1, zb);
        return box(W + n0, u0, za, W + n1, u1, zb);
      };
      // Walls: each from the bottom of its groove up to the floor above or
      // the roof, mitred at 45° so a corner has no seam on the outside.
      // Under a sloped or two-sided roof the top storey's walls follow it.
      const z0 = top - g,
        sloped = s.top && b.roof !== 'flat',
        zTop = sloped ? z1 + shape.rise + 1 : z1;
      const r = Math.SQRT1_2;
      const underRoof = (solid) => {
        if (!sloped) return solid;
        for (const p of shape.panels) {
          const [dx, dy] = p.dir;
          const len = Math.hypot(shape.t * dx, shape.t * dy, 1);
          solid = trim(solid, [shape.t * dx, shape.t * dy, -1], -(z1 - shape.t * p.s0) / len);
        }
        return solid;
      };
      const walls = {
        front: trim(trim(box(0, 0, z0, W, t, zTop), [1, -1, 0], 0), [-1, -1, 0], -W * r),
        back: trim(trim(box(0, D - t, z0, W, D, zTop), [1, 1, 0], D * r), [-1, 1, 0], (D - W) * r),
        left: trim(trim(box(0, 0, z0, t, D, zTop), [-1, 1, 0], 0), [-1, -1, 0], -D * r),
        right: trim(trim(box(W - t, 0, z0, W, D, zTop), [1, 1, 0], W * r), [1, -1, 0], (W - D) * r),
      };
      for (const w of WALLS) walls[w] = underRoof(walls[w]);
      // The garage door on the ground floor: open from the top of the base, so the doorstep is level.
      // Over a pit bay the door reaches down through the foot of the wall, so nothing crosses the track.
      const holes = { front: s.garage ? doors.map((door) => box(door.x, -1, b.lane ? z0 - 1 : top, door.x + door.width, t + 1, top + door.height)) : [], back: [], left: [], right: [] };
      for (const o of s.openings)
        holes[o.wall].push(onWall(o.wall, o.at - o.width / 2, o.at + o.width / 2, -t - 1, 1, top + o.sill, top + o.sill + o.height));
      for (const w of WALLS) walls[w] = minus(walls[w], ...holes[w]);
      // A wall texture: joints in the outside face, clear of every opening
      // and of the frame around it, and of the wall's foot in the groove.
      if (s.wallTexture !== 'plain') {
        const keepOut = { front: s.garage ? doors.map((door) => [door.x, top, door.x + door.width, top + door.height]) : [], back: [], left: [], right: [] };
        for (const o of s.openings) {
          const extra = o.frame ? KIT.trim : 0;
          keepOut[o.wall].push([o.at - o.width / 2 - extra, top + o.sill - (o.type === 'window' ? extra : 0), o.at + o.width / 2 + extra, top + o.sill + o.height + extra]);
        }
        for (const w of WALLS) {
          const joints = wallJoints(wasm, own, w, { W, D, length: wallLength(s, w), bottom: top, top: zTop }, keepOut[w], b, s.wallTexture);
          if (joints) walls[w] = own(walls[w].subtract(joints));
        }
      }
      for (const w of ['front', 'back', 'left', 'right'])
        local(...cutWall({ id: w + s.suffix, name: WALL_NAMES[w] + ' wall' + s.label, role: 'wall', solid: walls[w], outward: OUTWARD[w], apart: wallApart(w) }, w, s, { W, D, z0, zTop, top, z1 }));
      // Dividing walls on the ground floor: each from its groove in the base up
      // to the ceiling, between the walls, notched at its ends where the lip
      // of the roof or the floor above passes over them.
      if (s.garage)
        dividers(b).forEach((at, i) => {
          const across = b.rooms.along === 'width',
            lo = t + c,
            reach = lo + KIT.lip + c,
            far = (across ? D : W) - reach;
          let wall = underRoof(across ? box(at - t / 2, lo, z0, at + t / 2, D - lo, zTop) : box(lo, at - t / 2, z0, W - lo, at + t / 2, zTop));
          // The ceiling over a point along the wall, on either face of it: under a
          // roof that slopes across the wall, the lip on its low face is lower.
          const ceiling = (u, v) => ceilingAt(b, s, shape, across ? v : u, across ? u : v);
          const notch = (u0, u1) => {
            const faces = [at - t / 2 - 1, at + t / 2 + 1];
            const z = Math.min(...[u0, u1].flatMap((u) => faces.map((v) => ceiling(u, v)))) - KIT.lipDepth - c;
            return across ? box(at - t / 2 - 1, u0, z, at + t / 2 + 1, u1, zTop + 1) : box(u0, at - t / 2 - 1, z, u1, at + t / 2 + 1, zTop + 1);
          };
          wall = minus(wall, notch(lo - 1, reach), notch(far, (across ? D : W) - lo + 1));
          const part = dividerParts(b)[i];
          local(
            ...cutWall(
              {
                ...part,
                solid: wall,
                outward: across ? [1, 0, 0] : [0, 1, 0],
                apart: [0, 0, lift + APART.up],
                length: across ? D : W,
                cutFrame: across ? [[0, 1, 0], [1, 0, 0], [at - t / 2 - 2, 0, 0]] : [[1, 0, 0], [0, 1, 0], [0, at - t / 2 - 2, 0]],
              },
              'divide',
              { ...s, wallTexture: 'plain', openings: [], garage: false },
              { W, D, z0, zTop, top, z1 },
            ),
          );
        });
      const roofApart = [0, 0, lift + APART.up + APART.roof];

      // The roof, on the top storey.
      if (s.top) {
        const ov = { front: b.overhangFront, back: b.overhangBack, left: b.overhangLeft, right: b.overhangRight };
        if (b.roof === 'flat') {
          // A plate with its overhangs, and a lip underneath that drops between
          // the walls and keeps them square.
          const roofPlate = box(-ov.left, -ov.front, z1, W + ov.right, D + ov.back, z1 + rt);
          const lip = minus(
            box(t + c, t + c, z1 - KIT.lipDepth, W - t - c, D - t - c, z1),
            box(t + c + KIT.lip, t + c + KIT.lip, z1 - KIT.lipDepth - 1, W - t - c - KIT.lip, D - t - c - KIT.lip, z1 + 1),
          );
          const roof = { id: 'roof', name: 'Flat roof', role: 'roof', solid: own(roofPlate.add(lip)), flip: true, apart: roofApart };
          local(...cutFlat(roof, plan && [plan.roofX, plan.roofY], [-ov.left, -ov.front]));
        } else {
          // Each panel lies on the walls at the pitch, as thick as the roof, and
          // reaches past the walls by the overhang of each side.
          const cosA = 1 / Math.hypot(shape.t, 1);
          for (const p of shape.panels) {
            const [dx, dy] = p.dir;
            const len = Math.hypot(shape.t * dx, shape.t * dy, 1);
            let panel = box(-ov.left, -ov.front, z1 - 60, W + ov.right, D + ov.back, z1 + shape.rise + 60);
            panel = trim(panel, [-shape.t * dx, -shape.t * dy, 1], (z1 - shape.t * p.s0) / len);
            panel = trim(panel, [shape.t * dx, shape.t * dy, -1], -(z1 - shape.t * p.s0 + rt / cosA) / len);
            if (p.keep) panel = trim(panel, p.keep[0], p.keep[1]);
            // Tiles or corrugations in its top, starting at the eave.
            if (b.roofTexture !== 'plain') {
              const joints = roofJoints(
                wasm,
                own,
                panel,
                {
                  dir: p.dir,
                  t: shape.t,
                  eave: [dx < 0 ? W : 0, dy < 0 ? D : 0],
                  topAt: (x, y) => z1 + shape.t * (dx * x + dy * y - p.s0) + rt / cosA,
                  bounds: panel.boundingBox(),
                },
                b,
                b.roofTexture,
              );
              if (joints) panel = own(panel.subtract(joints));
            }
            // A lip under it inside the walls, as under a flat roof: it drops
            // between the walls and holds them square. It reaches 0.5 mm into
            // the panel, so the two are one body.
            const under = z1 - shape.t * p.s0;
            let lip = minus(
              box(t + c, t + c, z1 - KIT.lipDepth - 1, W - t - c, D - t - c, z1 + shape.rise + 1),
              box(t + c + KIT.lip, t + c + KIT.lip, z1 - KIT.lipDepth - 2, W - t - c - KIT.lip, D - t - c - KIT.lip, z1 + shape.rise + 2),
            );
            lip = trim(lip, [shape.t * dx, shape.t * dy, -1], -(under + 0.5) / len);
            lip = trim(lip, [-shape.t * dx, -shape.t * dy, 1], (under - KIT.lipDepth) / len);
            if (p.keep) lip = trim(lip, p.keep[0], p.keep[1]);
            if (!lip.isEmpty()) panel = own(panel.add(lip));
            const deg = (Math.atan(shape.t) * 180) / Math.PI;
            // The two panels of a two-sided roof also part at the ridge.
            const ridge = p.keep ? [-dx * APART.ridge, -dy * APART.ridge, 0] : [0, 0, 0];
            // Laid flat, then turned over: it prints top down, its lip up.
            const roof = { id: p.id, name: p.name, role: 'roof', solid: panel, lie: [-deg * dy, deg * dx, 0], flip: true, apart: add3(roofApart, ridge) };
            local(...cutFlat(roof, plan && [plan.roofX, plan.roofY], [-ov.left, -ov.front]));
          }
        }
      }

      // The floor of the storey above: it covers this storey like a flat
      // roof, a lip under it inside these walls, and a groove on top where
      // the walls of the next storey stand.
      const above = storeys[s.n];
      if (above) {
        const slabTop = z1 + KIT.slab;
        const slab = box(0, 0, z1, W, D, slabTop);
        const lip = minus(
          box(t + c, t + c, z1 - KIT.lipDepth, W - t - c, D - t - c, z1),
          box(t + c + KIT.lip, t + c + KIT.lip, z1 - KIT.lipDepth - 1, W - t - c - KIT.lip, D - t - c - KIT.lip, z1 + 1),
        );
        const ax = above.ox - s.ox,
          ay = above.oy - s.oy;
        const groove = minus(
          box(ax - c, ay - c, slabTop - g, ax + above.width + c, ay + above.depth + c, slabTop + 1),
          box(ax + t + c, ay + t + c, slabTop - g - 1, ax + above.width - t - c, ay + above.depth - t - c, slabTop + 2),
        );
        // Exploded, it hangs between the walls below and the walls above.
        const floorApart = [0, 0, lift + APART.storey - APART.up];
        const floor = { id: 'floor' + above.n, name: 'Floor of storey ' + above.n, role: 'floor', solid: minus(own(slab.add(lip)), groove), flip: true, apart: floorApart };
        local(...cutFlat(floor, plan && [plan['floor' + above.n + 'X'], plan['floor' + above.n + 'Y']], [0, 0]));
      }

      // Corner braces: an L in each inside corner, on the floor against both
      // walls. Each prints lying on the leg along the front or back wall.
      for (const q of braceCorners(b, s, doors)) {
        const k = KIT.brace,
          lo = t + c;
        const alongX = q.sy > 0 ? [lo, lo + k] : [D - lo - k, D - lo],
          alongY = q.sx > 0 ? [lo, lo + k] : [W - lo - k, W - lo];
        const zb = top + Math.min(s.height - KIT.lipDepth - 1, KIT.braceHeight);
        const brace = own(Manifold.union([box(q.x[0], alongX[0], top, q.x[1], alongX[1], zb), box(alongY[0], q.y[0], top, alongY[1], q.y[1], zb)]));
        local({ id: 'brace' + s.suffix + '-' + q.key, name: 'Corner brace, ' + q.name + s.label, role: 'brace', solid: brace, lie: [q.sy > 0 ? 90 : -90, 0, 0], apart: [0, 0, lift + APART.up] });
      }

      if (s.garage && b.door === 'roller')
        for (const door of doors) {
          // A plate behind the opening, standing on the floor inside, with ribs
          // facing out through the opening like the slats of a roller door.
          const x0 = door.x - KIT.margin,
            x1 = door.x + door.width + KIT.margin;
          let insert = box(x0, t, top, x1, t + KIT.insert, top + door.height + KIT.margin);
          const ribs = [];
          for (let z = top + KIT.ribPitch / 2; z + 1 <= top + door.height; z += KIT.ribPitch)
            ribs.push(box(door.x + 0.5, t - KIT.rib, z, door.x + door.width - 0.5, t, z + 1.6));
          if (ribs.length) insert = own(insert.add(own(Manifold.union(ribs))));
          local({ ...doorPart(door, doors), solid: insert, outward: [0, -1, 0], apart: [0, APART.door, 0] });
        }
      // Frames: a band around the opening on the outside of the wall, open at
      // the bottom for a door; a window gets a cross in it.
      const { trim: k, trimDepth: fd, bar } = KIT;
      s.openings.forEach((o, i) => {
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
          frame = own(frame.add(own(Manifold.union([onWall(o.wall, um - bar / 2, um + bar / 2, 0, fd, za, zb), onWall(o.wall, u0, u1, 0, fd, zm - bar / 2, zm + bar / 2)]))));
        }
        local({ id: 'frame' + s.suffix + '-' + (i + 1), name: openingName(o, s.openings) + ' frame' + s.label, role: 'frame', solid: frame, outward: OUTWARD[o.wall], apart: add3(wallApart(o.wall), scale3(OUTWARD[o.wall], APART.frame)) });
      });
      // Into place on the storey below.
      for (const part of own2) parts.push(s.ox || s.oy ? { ...part, solid: own(part.solid.translate([s.ox, s.oy, 0])) } : part);
    }
    // Keep the parts in the order of the kit; free everything else.
    const order = buildingLayout(b).parts.map((p) => p.id);
    const rank = (id) => order.indexOf(order.includes(id) ? id : id.replace(/-\d+$/, ''));
    parts.sort((a, p) => rank(a.id) - rank(p.id));
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }

  /* ---------- Cutting to fit the plate ---------- */

  function cs(polys) {
    return own(new wasm.CrossSection(polys, 'NonZero'));
  }
  // The pieces between the seams of one part, in its own 2D frame (u along
  // it, v across): each the region on the low side of its seam, less the
  // region on the low side of the seam before it, grown by the play.
  function strips(cuts, [v0, v1], tabsOf, stepsOf = null) {
    const far = 1e4;
    const lefts = cuts.map((at) => cs(seamRegion(at, [v0, v1], tabsOf(at), stepsOf ? stepsOf(at) : null)));
    return [...lefts, cs([[[-far, v0 - far], [far, v0 - far], [far, v1 + far], [-far, v1 + far]]])].map((region, k) =>
      k ? own(region.subtract(own(lefts[k - 1].offset(JOINT.play, 'Miter', 2)))) : region,
    );
  }
  // Seams the other way: drawn with u along v, then turned.
  function turned(regions) {
    return regions.map((region) => own(region.transform([0, 1, 0, 1, 0, 0, 0, 0, 1])));
  }
  // The pieces of a cut part, numbered. Exploded, they also part at their
  // seams: each moves away from the middle of the part, so the tabs show.
  // A piece in one body or more: a base open for a pit bay, cut across its
  // arms, falls apart into a piece for each arm.
  function bodies(solid) {
    if (solid.isEmpty()) return [];
    const all = solid.decompose().map(own);
    return all.filter((body) => body.volume() > 1);
  }
  function named(part, pieces) {
    if (pieces.length < 2) return pieces.length ? [{ ...part, solid: pieces[0] }] : [part];
    const box = part.solid.boundingBox();
    const mid = box.min.map((v, i) => (v + box.max[i]) / 2);
    return pieces.map((solid, k) => {
      const { min, max } = solid.boundingBox();
      const away = min.map((v, i) => {
        const d = (v + max[i]) / 2 - mid[i];
        return Math.abs(d) > 1 ? Math.sign(d) * APART.piece : 0;
      });
      return { ...part, id: part.id + '-' + (k + 1), name: part.name + ' ' + (k + 1) + ' of ' + pieces.length, solid, apart: add3(part.apart, away) };
    });
  }
  // The base, a floor or the roof: cut both ways in the plan. origin: where
  // the cut places are counted from.
  function cutFlat(part, planned, [x0, y0]) {
    if (!planned || (!planned[0].cuts.length && !planned[1].cuts.length)) return [part];
    const xCuts = planned[0].cuts.map((v) => v + x0),
      yCuts = planned[1].cuts.map((v) => v + y0);
    const { min, max } = part.solid.boundingBox();
    // Seams across x run along y, with their tabs between the y seams; and the other way.
    const xs = strips(xCuts, [min[1], max[1]], () => tabPlaces([min[1], max[1]], yCuts));
    const ys = turned(strips(yCuts, [min[0], max[0]], () => tabPlaces([min[0], max[0]], xCuts)));
    const pieces = [];
    for (const xr of xs)
      for (const yr of ys) {
        const cell = own(xr.intersect(yr));
        if (cell.isEmpty()) continue;
        const prism = own(own(cell.extrude(max[2] - min[2] + 4)).translate([0, 0, min[2] - 2]));
        pieces.push(...bodies(own(part.solid.intersect(prism))));
      }
    return named(part, pieces);
  }
  // A wall: cut along its length, and across its height when it is taller
  // than the plate. A brick or block wall is cut along its joints: along its
  // length the seam steps from course to course, across its height it runs
  // along a course, so either seam is one more joint.
  function cutWall(part, wall, s, { W, D, z0, zTop, top, z1 }) {
    const along = plan?.[part.id]?.cuts ?? [],
      up = plan?.[part.id + 'Z']?.cuts ?? [];
    if (!along.length && !up.length) return [part];
    const stepped = ['brick', 'block'].includes(s.wallTexture);
    const k = b.textureScale / 100;
    const rowH = stepped ? DRAWN[s.wallTexture].course * k : 0,
      brick = stepped ? DRAWN[s.wallTexture].length * k : 0;
    const L = part.length ?? wallLength(s, wall);
    // Across the height: measured from the foot of the wall, on a course line for bricks.
    const ups = up.map((v) => (stepped ? top + Math.round((z0 + v - top) / rowH) * rowH : z0 + v));
    const openingsAt = (u) => [
      ...(s.garage && wall === 'front' ? doors.filter((door) => u > door.x && u < door.x + door.width).map((door) => [top, top + door.height]) : []),
      ...s.openings.filter((o) => o.wall === wall && Math.abs(u - o.at) < o.width / 2).map((o) => [top + o.sill, top + o.sill + o.height]),
    ];
    const brickSteps = (at) => {
      const rows = [];
      for (let r = -1; top + r * rowH < zTop + rowH; r++) {
        const shift = ((((r % 2) + 2) % 2) * brick) / 2;
        rows.push({ v: top + r * rowH, top: top + (r + 1) * rowH, at: Math.round((at - shift) / brick) * brick + shift });
      }
      rows[0].v = z0 - 1;
      return rows;
    };
    const lengthWise = strips(along, [z0, zTop], (at) => (stepped ? [] : tabPlaces([z0, zTop], [top, z1, ...ups], openingsAt(at), 3)), stepped ? brickSteps : null);
    // Openings the seam across the height runs through, along the wall.
    const gapsAt = (v) => [
      ...(s.garage && wall === 'front' ? doors.filter((door) => v > top && v < top + door.height).map((door) => [door.x, door.x + door.width]) : []),
      ...s.openings.filter((o) => o.wall === wall && v > top + o.sill && v < top + o.sill + o.height).map((o) => [o.at - o.width / 2, o.at + o.width / 2]),
    ];
    const heightWise = turned(strips(ups, [-1, L + 1], (v) => (stepped ? [] : tabPlaces([0, L], along, gapsAt(v), 3))));
    const frame = part.cutFrame ?? {
      // u along the wall, from 2 mm outside it through to 2 mm inside.
      front: [[1, 0, 0], [0, 1, 0], [0, -2, 0]],
      back: [[-1, 0, 0], [0, -1, 0], [W, D + 2, 0]],
      left: [[0, -1, 0], [1, 0, 0], [-2, D, 0]],
      right: [[0, 1, 0], [-1, 0, 0], [W + 2, 0, 0]],
    }[wall];
    const [U, N, O] = frame;
    const pieces = [];
    for (const a of lengthWise)
      for (const h of heightWise) {
        const cell = own(a.intersect(h));
        if (cell.isEmpty()) continue;
        const prism = own(own(cell.extrude(t + 4)).transform([...U, 0, 0, 0, 1, 0, ...N, 0, ...O, 1]));
        pieces.push(...bodies(own(part.solid.intersect(prism))));
      }
    return named(part, pieces);
  }
}

/**
 * A part turned to how it prints, on the plate at the origin: a wall, a
 * frame or the door with its outside face up, the base, a floor and the
 * flat roof upside down, a roof panel lying on its underside.
 */
export function printPose(part) {
  const s = part.solid;
  let turned;
  if (part.lie) {
    turned = s.rotate(part.lie);
    if (part.flip) {
      const over = turned.rotate([180, 0, 0]);
      turned.delete();
      turned = over;
    }
  } else if (part.flip) turned = s.rotate([180, 0, 0]);
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
