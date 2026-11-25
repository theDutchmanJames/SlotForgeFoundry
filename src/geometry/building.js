// A building as a kit: a base plate as high as the track, four walls that
// drop into a groove in it and meet at mitred corners, a flat roof whose lip
// drops between the walls, and a door insert. Every part prints flat without
// supports. Sizes are toy proportions for 1:32 by default: a one-car garage
// is about 120 × 180 mm and 75 mm high and takes practically any slot car.

export const BUILDING_DEFAULTS = Object.freeze({
  kind: 'garage',
  width: 120, // outside of the walls, across the door
  depth: 180, // outside of the walls, front to back
  height: 75, // walls, from the top of the base to the roof
  baseHeight: 10, // as high as the track, so the doorstep is level with the road
  doorWidth: 90,
  doorHeight: 55,
  door: 'roller', // 'roller' or 'open'
});
export const BUILDING_LIMITS = Object.freeze({
  width: [60, 400],
  depth: [60, 400],
  height: [30, 200],
  baseHeight: [4, 40],
  doorWidth: [20, 380],
  doorHeight: [15, 190],
});
// Fixed sizes of the kit, in mm. Nothing thinner than 2 mm.
export const KIT = Object.freeze({
  wall: 3, // wall thickness
  ledge: 3, // base beyond the walls
  groove: 2, // depth of the wall groove in the base
  play: 0.2, // clearance each side of a wall in its groove, and around the roof lip
  shell: 2, // the base's side walls, it is hollow underneath
  deck: 4, // the base's top, under the groove too
  roof: 3, // roof plate thickness
  overhang: 3, // roof beyond the walls
  lip: 2, // roof lip, its width
  lipDepth: 3, // roof lip, how far it reaches down
  frame: 6, // wall left beside the door opening, and above it
  insert: 2, // door insert plate
  rib: 1, // its ribs stand out this far
  ribPitch: 5,
  margin: 3, // door insert beyond the opening on each side and above
});
const DOOR_CHOICES = ['roller', 'open'];
const LABELS = {
  width: 'Width',
  depth: 'Depth',
  height: 'Wall height',
  baseHeight: 'Base height',
  doorWidth: 'Door width',
  doorHeight: 'Door height',
};

/** The building as it is kept: known settings only, each checked. */
export function validateBuilding(input) {
  const b = { ...BUILDING_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(b))
    if (!Object.hasOwn(BUILDING_DEFAULTS, key)) throw Error('The building has an unknown setting: ' + key + '.');
  if (b.kind !== 'garage') throw Error('Choose a building type from the list.');
  if (!DOOR_CHOICES.includes(b.door)) throw Error('Choose a door from the list.');
  for (const [key, [min, max]] of Object.entries(BUILDING_LIMITS))
    if (!Number.isFinite(b[key]) || b[key] < min || b[key] > max)
      throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + ' mm.');
  const room = b.width - 2 * KIT.wall - 2 * KIT.frame;
  if (b.doorWidth > room)
    throw Error('The door is too wide for this building: at most ' + room + ' mm at ' + b.width + ' mm wide.');
  const tall = b.height - KIT.frame;
  if (b.doorHeight > tall)
    throw Error('The door is too high for these walls: at most ' + tall + ' mm at ' + b.height + ' mm high.');
  return b;
}

/**
 * The parts of the kit as boxes and numbers, without geometry: where each
 * sits in the building, and its size as printed (x, y on the plate, z up).
 */
export function buildingLayout(input) {
  const b = validateBuilding(input);
  const { wall: t, groove: g, ledge: m, roof: rt, overhang: ov } = KIT;
  const wallHigh = b.height + g;
  const doorX = (b.width - b.doorWidth) / 2;
  const parts = [
    { id: 'base', name: 'Base plate', role: 'buildingBase', print: [b.width + 2 * m, b.depth + 2 * m, b.baseHeight] },
    { id: 'front', name: 'Front wall', role: 'wall', print: [b.width, wallHigh, t] },
    { id: 'back', name: 'Back wall', role: 'wall', print: [b.width, wallHigh, t] },
    { id: 'left', name: 'Left wall', role: 'wall', print: [wallHigh, b.depth, t] },
    { id: 'right', name: 'Right wall', role: 'wall', print: [wallHigh, b.depth, t] },
    { id: 'roof', name: 'Flat roof', role: 'roof', print: [b.width + 2 * ov, b.depth + 2 * ov, rt + KIT.lipDepth] },
  ];
  if (b.door === 'roller')
    parts.push({
      id: 'door',
      name: 'Roller door',
      role: 'door',
      print: [b.doorWidth + 2 * KIT.margin, b.doorHeight + KIT.margin, KIT.insert + KIT.rib],
    });
  return { building: b, parts, door: { x: doorX, width: b.doorWidth, height: b.doorHeight } };
}

/** Whether a part of this print size fits the plate, turned if need be. */
export function fitsPlate([x, y], plate) {
  const w = plate.width - 2 * (plate.margin ?? 0),
    d = plate.depth - 2 * (plate.margin ?? 0);
  return (x <= w && y <= d) || (x <= d && y <= w);
}

// The building stands with its front (the door) at y = 0, from x = 0 to its
// width and y = 0 to its depth; the table is z = 0.
export function buildGarage(wasm, input) {
  const { Manifold } = wasm;
  const { building: b, door } = buildingLayout(input);
  const { wall: t, groove: g, ledge: m, play: c, shell, deck, roof: rt, overhang: ov } = KIT;
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const box = (x0, y0, z0, x1, y1, z1) => own(Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]));
  const minus = (a, ...cuts) => own(a.subtract(own(Manifold.union(cuts))));
  const W = b.width,
    D = b.depth,
    top = b.baseHeight;
  try {
    // Base: a hollow tray as high as the track, with the wall groove on top.
    const outer = box(-m, -m, 0, W + m, D + m, top);
    const hollow = box(-m + shell, -m + shell, -1, W + m - shell, D + m - shell, top - deck);
    const groove = minus(
      box(-c, -c, top - g, W + c, D + c, top + 1),
      box(t + c, t + c, top - g - 1, W - t - c, D - t - c, top + 2),
    );
    const base = minus(outer, hollow, groove);

    // Walls: each from the bottom of the groove to the roof, mitred at 45°
    // so the outside of a corner has no seam.
    const z0 = top - g,
      z1 = top + b.height;
    const r = Math.SQRT1_2;
    const trim = (s, n, offset) => own(s.trimByPlane(n, offset));
    let front = box(0, 0, z0, W, t, z1);
    front = trim(trim(front, [1, -1, 0], 0), [-1, -1, 0], -W * r);
    // The garage door: open from the top of the base, so the doorstep is level.
    front = minus(front, box(door.x, -1, top, door.x + door.width, t + 1, top + door.height));
    let back = box(0, D - t, z0, W, D, z1);
    back = trim(trim(back, [1, 1, 0], D * r), [-1, 1, 0], (D - W) * r);
    let left = box(0, 0, z0, t, D, z1);
    left = trim(trim(left, [-1, 1, 0], 0), [-1, -1, 0], -D * r);
    let right = box(W - t, 0, z0, W, D, z1);
    right = trim(trim(right, [1, 1, 0], W * r), [1, -1, 0], (W - D) * r);

    // Roof: a plate with an overhang, and a lip underneath that drops between
    // the walls and keeps them square.
    const roofPlate = box(-ov, -ov, z1, W + ov, D + ov, z1 + rt);
    const lip = minus(
      box(t + c, t + c, z1 - KIT.lipDepth, W - t - c, D - t - c, z1),
      box(t + c + KIT.lip, t + c + KIT.lip, z1 - KIT.lipDepth - 1, W - t - c - KIT.lip, D - t - c - KIT.lip, z1 + 1),
    );
    const roof = own(roofPlate.add(lip));

    const parts = [
      { id: 'base', name: 'Base plate', role: 'buildingBase', solid: base, flip: true },
      { id: 'front', name: 'Front wall', role: 'wall', solid: front, outward: [0, -1, 0] },
      { id: 'back', name: 'Back wall', role: 'wall', solid: back, outward: [0, 1, 0] },
      { id: 'left', name: 'Left wall', role: 'wall', solid: left, outward: [-1, 0, 0] },
      { id: 'right', name: 'Right wall', role: 'wall', solid: right, outward: [1, 0, 0] },
      { id: 'roof', name: 'Flat roof', role: 'roof', solid: roof, flip: true },
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
 * A part turned to how it prints, on the plate at the origin: a wall or the
 * door with its outside face up, the base and the roof upside down.
 */
export function printPose(part) {
  const s = part.solid;
  let turned;
  if (part.flip) turned = s.rotate([180, 0, 0]);
  else {
    const [x, y] = part.outward;
    // Turn the outward side up.
    turned = y < 0 ? s.rotate([-90, 0, 0]) : y > 0 ? s.rotate([90, 0, 0]) : x < 0 ? s.rotate([0, 90, 0]) : s.rotate([0, -90, 0]);
  }
  const { min } = turned.boundingBox();
  const placed = turned.translate([-min[0], -min[1], -min[2]]);
  turned.delete();
  return placed;
}
