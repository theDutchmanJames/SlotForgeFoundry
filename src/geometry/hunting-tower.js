// A forest hunting tower, the lookout of a Nordic rally stage: a small
// planked cabin on four legs that spread out towards their feet, braced on
// every side, a ladder up to its door, a roof falling to the back. The front
// and the back each print as one flat frame of two legs, rails and crosses;
// the sides as frames of rails and crosses glued between the legs. The legs'
// tops go into pockets under the cabin, which prints upright, its floor on
// the plate. x across its front, y back from it (the road at negative y), z up.

import { kitShapes } from './kit-shapes.js';
import { wallJoints } from './building-texture.js';

export const HUNTING_TOWER_DEFAULTS = Object.freeze({
  kind: 'huntingtower',
  height: 92, // the underside of the cabin above the table
  cabinWidth: 44,
  cabinDepth: 40,
  cabinHeight: 30, // its walls above its floor, at the front
  splay: 12, // each leg out at its foot past its top, both ways
  ladder: true,
});
export const HUNTING_TOWER_LIMITS = Object.freeze({ height: [50, 160], cabinWidth: [30, 70], cabinDepth: [30, 70], cabinHeight: [22, 45], splay: [0, 25] });
export const HUNTING_TOWER = Object.freeze({
  leg: 3.2, // square
  rail: 2.4, // high
  brace: 2, // wide
  inset: 2, // the legs' tops in from the cabin's sides
  pocket: 2, // deep, under the cabin
  play: 0.2,
  wall: 2, // the cabin's walls
  floor: 2.5,
  fall: 12, // the roof's slope, degrees
  roof: 2,
  overhang: 4,
  door: [14, 22], // wide, high
  slit: 8, // the windows: high, their sill this far up
  sill: 14,
  rung: [1.6, 6], // the ladder's rungs: thick, apart
  stringer: 2.2,
  ladderWidth: 16,
  ladderThick: 2,
});
const LABELS = { height: 'Height', cabinWidth: 'Cabin width', cabinDepth: 'Cabin depth', cabinHeight: 'Cabin height', splay: 'Spread of the legs' };

export function validateHuntingTower(input) {
  const t = { ...HUNTING_TOWER_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(t)) if (!Object.hasOwn(HUNTING_TOWER_DEFAULTS, key)) throw Error('The hunting tower has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(HUNTING_TOWER_LIMITS))
    if (!Number.isFinite(t[key]) || t[key] < min || t[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'splay' ? ' mm.' : ' mm.'));
  if (typeof t.ladder !== 'boolean') throw Error('Choose whether the tower has a ladder.');
  return t;
}
// The ladder's foot on the table: leaning at about 70°, and out past the front legs' feet, so it stays in front of them.
const ladderFoot = (t) => Math.min(-0.38 * (t.height + HUNTING_TOWER.floor), HUNTING_TOWER.inset - t.splay - 5);
/** On the table: [x0, y0, x1, y1], out to the legs' feet and the ladder's. */
export const huntingTowerFootprint = (t) => {
  const { inset: c, overhang: o } = HUNTING_TOWER;
  return [Math.min(-o, c - t.splay), Math.min(-o, c - t.splay, t.ladder ? ladderFoot(t) - 3 : 0), Math.max(t.cabinWidth + o, t.cabinWidth - c + t.splay), Math.max(t.cabinDepth + o, t.cabinDepth - c + t.splay)];
};

export function huntingTowerLayout(input) {
  const t = validateHuntingTower(input);
  const parts = [
    { id: 'cabin', name: 'Cabin', role: 'wall' },
    { id: 'roof', name: 'Roof', role: 'roof' },
    { id: 'frame-front', name: 'Front legs', role: 'frame' },
    { id: 'frame-back', name: 'Back legs', role: 'frame' },
    { id: 'frame-left', name: 'Left braces', role: 'frame' },
    { id: 'frame-right', name: 'Right braces', role: 'frame' },
  ];
  if (t.ladder) parts.push({ id: 'ladder', name: 'Ladder', role: 'frame' });
  return { building: t, parts };
}
// The turn that lays a flat part with this normal on the plate: about x, or about y.
const lieX = (n) => [(Math.atan2(n[1], n[2]) * 180) / Math.PI, 0, 0];
const lieY = (n) => [0, (-Math.atan2(n[0], n[2]) * 180) / Math.PI, 0];

export function buildHuntingTower(wasm, input) {
  const t = validateHuntingTower(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { box, poly, sweep } = kitShapes(wasm, own);
  const { Manifold, CrossSection } = wasm;
  const T = HUNTING_TOWER;
  const { leg: M, rail: R, inset: c } = T;
  const W = t.cabinWidth,
    D = t.cabinDepth,
    H = t.height,
    s = t.splay,
    k = s / H; // the legs lean in by k for every mm up
  const top = H + T.pocket; // the legs' tops, in the pockets
  const parts = [];
  // A bar between two points in a frame's plane, as an outline.
  const bar = ([ax, ay], [bx, by], w) => {
    const l = Math.hypot(bx - ax, by - ay),
      n = [(-(by - ay) / l) * (w / 2), ((bx - ax) / l) * (w / 2)];
    return poly([[ax - n[0], ay - n[1]], [bx - n[0], by - n[1]], [bx + n[0], by + n[1]], [ax + n[0], ay + n[1]]]);
  };
  // The rails' heights, and the tiers of crosses between them.
  const rails = [8, H * 0.5 - R / 2, H - R];
  // A frame's rails and crosses between two edges that lean: lo(z) and hi(z), the inner faces of the legs.
  const between = (lo, hi) => {
    const bits = [];
    for (const z of rails) bits.push(poly([[lo(z), z], [hi(z), z], [hi(z + R), z + R], [lo(z + R), z + R]]));
    for (let i = 0; i + 1 < rails.length; i++) {
      const z0 = rails[i] + R,
        z1 = rails[i + 1];
      const field = poly([[lo(z0), z0], [hi(z0), z0], [hi(z1), z1], [lo(z1), z1]]);
      bits.push(own(own(CrossSection.union([bar([lo(z0), z0], [hi(z1), z1], T.brace), bar([lo(z1), z1], [hi(z0), z0], T.brace)])).intersect(field)));
    }
    return bits;
  };
  // Shear: a frame drawn upright and leaning by ±k as it rises, along y (front, back) or x (sides).
  const shear = (solid, axis, sign) => own(solid.transform(axis === 'y' ? [1, 0, 0, 0, 0, 1, 0, 0, 0, sign * k, 1, 0, 0, 0, 0, 1] : [1, 0, 0, 0, 0, 1, 0, 0, sign * k, 0, 1, 0, 0, 0, 0, 1]));
  try {
    // Front and back: two legs, leaning in across the frame too, the rails and crosses between them.
    const xl = (z) => c - s + k * z, // the left leg's outer face
      xr = (z) => W - c + s - k * z; // the right leg's
    for (const [id, name, y0, sign] of [['frame-front', 'Front legs', c - s, 1], ['frame-back', 'Back legs', D - c + s - M, -1]]) {
      const legs = [poly([[xl(0), 0], [xl(0) + M, 0], [xl(top) + M, top], [xl(top), top]]), poly([[xr(0) - M, 0], [xr(0), 0], [xr(top), top], [xr(top) - M, top]])];
      const cs = own(CrossSection.union([...legs, ...between((z) => xl(z) + M - 0.01, (z) => xr(z) - M + 0.01)]));
      const flat = sweep(cs, [1, 0, 0], [0, 0, 1], [0, y0, 0], [0, 1, 0], 0, M);
      // The front frame leans back as it rises, the back one forward.
      parts.push({ id, name, role: 'frame', solid: shear(flat, 'y', sign), lie: lieX([0, 1, -sign * k]), apart: [0, sign * -14, 0] });
    }
    // The sides: rails and crosses between the front legs and the back ones, in the legs' own lean.
    const yf = (z) => c - s + k * z + M, // the front legs' inner face
      yb = (z) => D - c + s - k * z - M; // the back legs'
    for (const [id, name, x0, sign] of [['frame-left', 'Left braces', c - s, 1], ['frame-right', 'Right braces', W - c + s - M, -1]]) {
      const cs = own(CrossSection.union(between(yf, yb)));
      const flat = sweep(cs, [0, 1, 0], [0, 0, 1], [x0, 0, 0], [1, 0, 0], 0, M);
      parts.push({ id, name, role: 'frame', solid: shear(flat, 'x', sign), lie: lieY([1, 0, -sign * k]), apart: [sign * -14, 0, 0] });
    }
    // The cabin: a floor and four planked walls, open on top under the roof, falling to the back.
    const fall = Math.tan((T.fall * Math.PI) / 180),
      zf = H + T.floor + t.cabinHeight; // the walls' top at the front
    let cabin = own(box(0, 0, H, W, D, zf + 1).subtract(box(T.wall, T.wall, H + T.floor, W - T.wall, D - T.wall, zf + 2)));
    cabin = own(cabin.trimByPlane([0, -fall, -1].map((v) => v / Math.hypot(1, fall)), -zf / Math.hypot(1, fall)));
    const floorZ = H + T.floor;
    const [dw, dh] = T.door,
      slit = (len) => Math.min(len * 0.55, len - 12);
    const openings = {
      front: [[W / 2 - dw / 2, floorZ, W / 2 + dw / 2, floorZ + dh]],
      right: [[D / 2 - slit(D) / 2, floorZ + T.sill, D / 2 + slit(D) / 2, floorZ + T.sill + T.slit]],
      back: [[W / 2 - slit(W) / 2, floorZ + T.sill, W / 2 + slit(W) / 2, floorZ + T.sill + T.slit]],
      left: [[D / 2 - slit(D) / 2, floorZ + T.sill, D / 2 + slit(D) / 2, floorZ + T.sill + T.slit]],
    };
    const walls = [
      ['front', [0, 0], [1, 0], [0, 1], W],
      ['right', [W, 0], [0, 1], [-1, 0], D],
      ['back', [W, D], [-1, 0], [0, -1], W],
      ['left', [0, D], [0, -1], [1, 0], D],
    ];
    const holes = [],
      joints = [];
    for (const [id, a, dir, inward, length] of walls) {
      // Each opening through the wall, from outside it to past its inner face.
      for (const [u0, z0, u1, z1] of openings[id])
        holes.push(sweep([[u0, z0], [u1, z0], [u1, z1], [u0, z1]], [dir[0], dir[1], 0], [0, 0, 1], [a[0], a[1], 0], [inward[0], inward[1], 0], -1, T.wall + 1));
      const j = wallJoints(wasm, own, id, { length, bottom: H, top: zf, frame: { a, dir, inward } }, openings[id], { textureScale: 80, textureJoint: 0.5, textureDepth: 0.4 }, 'planks');
      if (j) joints.push(j);
    }
    cabin = own(cabin.subtract(own(Manifold.union(holes))));
    if (joints.length) cabin = own(cabin.subtract(own(Manifold.union(joints))));
    // Pockets for the tops of the legs.
    const pl = T.play,
      grow = k * T.pocket;
    const pockets = [
      box(c - pl, c - pl, H - 0.01, c + M + grow + pl, c + M + grow + pl, top + pl),
      box(W - c - M - grow - pl, c - pl, H - 0.01, W - c + pl, c + M + grow + pl, top + pl),
      box(c - pl, D - c - M - grow - pl, H - 0.01, c + M + grow + pl, D - c + pl, top + pl),
      box(W - c - M - grow - pl, D - c - M - grow - pl, H - 0.01, W - c + pl, D - c + pl, top + pl),
    ];
    cabin = own(cabin.subtract(own(Manifold.union(pockets))));
    parts.unshift({ id: 'cabin', name: 'Cabin', role: 'wall', solid: cabin, lie: [0, 0, 0], apart: [0, 0, 16] });
    // The roof: a plate on the walls' tops, falling to the back, past them all round.
    const o = T.overhang,
      n = Math.hypot(1, fall);
    let roof = box(-o, -o, H, W + o, D + o, zf + 20);
    roof = own(roof.trimByPlane([0, fall / n, 1 / n], zf / n));
    roof = own(roof.trimByPlane([0, -fall / n, -1 / n], -(zf + T.roof * n) / n));
    parts.splice(1, 0, { id: 'roof', name: 'Roof', role: 'roof', solid: roof, lie: lieX([0, fall, 1]), apart: [0, 0, 32] });
    // The ladder: from the table in front up to the sill of the door, leaning on the cabin.
    if (t.ladder) {
      const zt = floorZ,
        yf0 = ladderFoot(t),
        yt = -0.3;
      const len = Math.hypot(zt + 4, yt - yf0) + 4;
      const along = [0, (yt - yf0) / Math.hypot(zt, yt - yf0), zt / Math.hypot(zt, yt - yf0)];
      const w = T.ladderWidth,
        st = T.stringer;
      const bits = [poly([[0, -3], [st, -3], [st, len], [0, len]]), poly([[w - st, -3], [w, -3], [w, len], [w - st, len]])];
      for (let v = 5; v < len - 2; v += T.rung[1]) bits.push(poly([[st - 0.01, v], [w - st + 0.01, v], [w - st + 0.01, v + T.rung[0]], [st - 0.01, v + T.rung[0]]]));
      const across = [1, 0, 0];
      const normal = [0, -along[2], along[1]]; // out of its back, towards the road
      let ladder = sweep(own(CrossSection.union(bits)), across, along, [W / 2 - w / 2, yf0, 0], normal, 0, T.ladderThick);
      ladder = own(ladder.trimByPlane([0, 0, 1], 0));
      // Its top at the sill: higher, it would reach into the wall beside the door.
      ladder = own(ladder.trimByPlane([0, 0, -1], -zt));
      parts.push({ id: 'ladder', name: 'Ladder', role: 'frame', solid: ladder, lie: lieX(normal), apart: [0, -12, 0] });
    }
    const keep = new Set(parts.map((p) => p.solid));
    for (const x of temp) if (!keep.has(x)) x.delete();
    return parts;
  } catch (e) {
    for (const x of temp) x.delete();
    throw e;
  }
}

export function huntingTowerNotes(name, t, parts, sizes, fmt) {
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  return [
    name + ' · SlotForge Foundry hunting tower kit',
    '',
    'A planked cabin ' + fmt(t.cabinWidth) + ' × ' + fmt(t.cabinDepth) + ' mm on four braced legs, its floor ' + fmt(t.height) + ' mm above the table, the legs spreading ' + fmt(t.splay) + ' mm out at their feet' + (t.ladder ? ', a ladder up to its door.' : '.'),
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports. The cabin stands on its floor, open on top; the leg frames, the side braces, the ladder and the roof lie flat.',
    '',
    'Putting it together',
    '1. Stand the front and the back legs up, leaning in towards each other, and glue the side braces between them, the rails level.',
    '2. Push the tops of the legs into the pockets under the cabin and glue them.',
    '3. Glue the roof on the walls, falling to the back' + (t.ladder ? ', and lean the ladder against the sill of the door.' : '.'),
  ].join('\n');
}
