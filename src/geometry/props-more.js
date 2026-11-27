// More props, after the Scaleform library's accessories: the garage, the pit
// lane, the grid, the marshals, scrutineering, slot-car racing and the race
// weekend. Each is drawn so it prints without supports: most as a profile seen
// from the front, swept through its depth and printed lying on its back; a
// few seen from the side, swept across and printed on their side; round
// things turned, never wider going up than 45 degrees. Sizes at 1:32, in mm:
// x across the front, y back from it, z up.

/** The props, with their group and size [width, depth, height]. */
export const MORE_PROPS = Object.freeze([
  // The garage.
  { id: 'vise', name: 'Bench vise', group: 'Garage', size: [10, 8, 8] },
  { id: 'oil-drain', name: 'Oil drain', group: 'Garage', size: [12, 12, 26] },
  { id: 'engine-stand', name: 'Engine on a stand', group: 'Garage', size: [14, 10, 20] },
  { id: 'compressor', name: 'Air compressor', group: 'Garage', size: [18, 9, 16] },
  { id: 'balancer', name: 'Wheel balancer', group: 'Garage', size: [12, 12, 22] },
  { id: 'press', name: 'Hydraulic press', group: 'Garage', size: [16, 8, 30] },
  { id: 'car-lift', name: 'Two-post lift', group: 'Garage', size: [56, 6, 56] },
  // The pit lane.
  { id: 'quick-jack', name: 'Quick jack', group: 'Pit lane', size: [8, 30, 9] },
  { id: 'bottle-cart', name: 'Bottle cart', group: 'Pit lane', size: [12, 10, 30] },
  { id: 'cooling-fan', name: 'Cooling fan', group: 'Pit lane', size: [16, 8, 22] },
  { id: 'hose-reel', name: 'Hose reel', group: 'Pit lane', size: [14, 8, 16] },
  { id: 'tyre-warmer', name: 'Tyre in its warmer', group: 'Pit lane', size: [19, 19, 7] },
  { id: 'wheel-gun', name: 'Wheel gun', group: 'Pit lane', size: [6, 4, 14] },
  // The grid.
  { id: 'lollipop', name: 'Lollipop board', group: 'Grid', size: [12, 8, 40] },
  { id: 'starter-stand', name: 'Starter’s rostrum', group: 'Grid', size: [16, 12, 34] },
  { id: 'wing-stand', name: 'Spare wings on a stand', group: 'Grid', size: [24, 8, 20] },
  { id: 'helmet', name: 'Helmet on a stand', group: 'Grid', size: [8, 8, 16] },
  // The marshals.
  { id: 'light-panel', name: 'Marshal light panel', group: 'Marshals', size: [16, 8, 30] },
  { id: 'tv-camera', name: 'TV camera on a tripod', group: 'Marshals', size: [6, 14, 22] },
  { id: 'tow-dolly', name: 'Tow dolly', group: 'Marshals', size: [20, 12, 6] },
  { id: 'spill-bin', name: 'Spill kit bin', group: 'Marshals', size: [12, 10, 14] },
  // Scrutineering.
  { id: 'width-arch', name: 'Width gauge arch', group: 'Scrutineering', size: [50, 6, 30] },
  { id: 'height-sled', name: 'Ride height sled', group: 'Scrutineering', size: [20, 8, 4] },
  { id: 'pyrometer', name: 'Pyrometer case', group: 'Scrutineering', size: [10, 6, 8] },
  { id: 'sample-bench', name: 'Fuel sample bench', group: 'Scrutineering', size: [24, 10, 19] },
  { id: 'alignment', name: 'Wheel alignment stand', group: 'Scrutineering', size: [8, 8, 20] },
  // Slot-car racing.
  { id: 'controllers', name: 'Hand controllers', group: 'Slot cars', size: [12, 4, 10] },
  { id: 'power-supply', name: 'Power supply', group: 'Slot cars', size: [14, 10, 8] },
  { id: 'tyre-truer', name: 'Tyre truer', group: 'Slot cars', size: [12, 8, 10] },
  { id: 'setup-board', name: 'Setup board', group: 'Slot cars', size: [24, 14, 3] },
  { id: 'pinion-puller', name: 'Pinion puller', group: 'Slot cars', size: [6, 6, 8] },
  { id: 'pit-case', name: 'Pit box', group: 'Slot cars', size: [16, 10, 10] },
  // The circuit and the race weekend.
  { id: 'flag-rack', name: 'Flag rack', group: 'Circuit', size: [16, 6, 24] },
  { id: 'pa-speaker', name: 'PA speaker on a pole', group: 'Circuit', size: [10, 8, 34] },
  { id: 'trophy', name: 'Trophy', group: 'Paddock', size: [8, 8, 12] },
  { id: 'jerry-can', name: 'Jerry can', group: 'Paddock', size: [10, 4, 12] },
  // Inside.
  { id: 'chair', name: 'Chair', group: 'Interiors', size: [8, 8, 14] },
  { id: 'shelves', name: 'Shelves', group: 'Interiors', size: [20, 6, 30] },
  { id: 'fireplace', name: 'Fireplace', group: 'Interiors', size: [20, 8, 18] },
  { id: 'seat', name: 'Bench seat', group: 'Interiors', size: [30, 8, 8] },
  // Architecture.
  { id: 'picket-fence', name: 'Picket fence', group: 'Architecture', size: [40, 2, 14] },
  { id: 'column', name: 'Column', group: 'Architecture', size: [10, 10, 40] },
  { id: 'buttress', name: 'Stepped buttress', group: 'Architecture', size: [8, 16, 30] },
  { id: 'arch', name: 'Arch', group: 'Architecture', size: [30, 6, 30] },
  { id: 'chimney-pot', name: 'Chimney pot', group: 'Architecture', size: [6, 6, 10] },
  { id: 'battlement', name: 'Battlement', group: 'Architecture', size: [40, 4, 14] },
  { id: 'roof-vent', name: 'Roof vent', group: 'Architecture', size: [8, 8, 10] },
  { id: 'water-tank', name: 'Water tank', group: 'Architecture', size: [16, 16, 30] },
  { id: 'scifi-pillar', name: 'Sci-fi pillar', group: 'Architecture', size: [10, 10, 36] },
  // The street.
  { id: 'retaining-wall', name: 'Retaining wall', group: 'Street', size: [40, 8, 16] },
  { id: 'railing', name: 'Railing', group: 'Street', size: [40, 2, 14] },
  { id: 'gate', name: 'Gate', group: 'Street', size: [30, 2, 16] },
  { id: 'street-lamp', name: 'Street lamp', group: 'Street', size: [14, 8, 56] },
  { id: 'barrel', name: 'Barrel', group: 'Street', size: [14, 14, 18] },
  { id: 'planter', name: 'Planter', group: 'Street', size: [24, 10, 12] },
  { id: 'ruined-wall', name: 'Ruined wall', group: 'Street', size: [40, 4, 20] },
  { id: 'nameplate', name: 'Name plate', group: 'Street', size: [20, 2, 8] },
  // Shapes, to build with.
  { id: 'shape-block', name: 'Block', group: 'Shapes', size: [20, 20, 20] },
  { id: 'shape-cylinder', name: 'Cylinder', group: 'Shapes', size: [20, 20, 20] },
  { id: 'shape-cone', name: 'Cone', group: 'Shapes', size: [20, 20, 20] },
  { id: 'shape-dome', name: 'Dome', group: 'Shapes', size: [20, 20, 10] },
  { id: 'shape-vault', name: 'Vault', group: 'Shapes', size: [20, 20, 10] },
  { id: 'shape-wedge', name: 'Wedge', group: 'Shapes', size: [20, 20, 10] },
  // For scale.
  { id: 'figure', name: 'Figure, 1:32', group: 'Scale', size: [10, 5, 56] },
  { id: 'car-block', name: 'Car, 1:32', group: 'Scale', size: [58, 28, 14] },
  // The circuit.
  { id: 'trestle', name: 'Trestle', group: 'Circuit', size: [30, 10, 20] },
  { id: 'ladder', name: 'Ladder', group: 'Circuit', size: [10, 2, 50] },
  { id: 'steps', name: 'Flight of steps', group: 'Circuit', size: [10, 24, 20] },
  { id: 'circuit-clock', name: 'Circuit clock', group: 'Circuit', size: [14, 8, 40] },
  { id: 'sign-board', name: 'Sign board', group: 'Circuit', size: [30, 3, 20] },
  { id: 'pit-wall', name: 'Pit wall section', group: 'Circuit', size: [40, 8, 20] },
  { id: 'crash-barrier', name: 'Crash barrier', group: 'Circuit', size: [40, 6, 10] },
  { id: 'tyre-wall', name: 'Tyre wall', group: 'Circuit', size: [40, 10, 18] },
  { id: 'catch-fence', name: 'Catch fence', group: 'Circuit', size: [40, 4, 40] },
  { id: 'pylon', name: 'Position pylon', group: 'Circuit', size: [12, 8, 50] },
  { id: 'tyre-rack', name: 'Tyre rack', group: 'Pit lane', size: [24, 10, 20] },
  { id: 'pit-perch', name: 'Pit wall stand', group: 'Pit lane', size: [20, 14, 30] },
]);
/** The props of several parts, and what each part is called. */
export const MORE_PARTS = Object.freeze({
  lollipop: ['board', 'foot'],
  'starter-stand': ['rostrum', 'flag'],
  'light-panel': ['panel', 'foot'],
  'pa-speaker': ['speaker', 'foot'],
  'street-lamp': ['lamp', 'foot'],
  'circuit-clock': ['clock', 'foot'],
  pylon: ['pylon', 'foot'],
});

/**
 * Builds a prop of this module into `ctx.add`, or answers false. ctx has the
 * prop's size W, D, H and box, sweep, turned, minus, union, add, own, wasm, onBack.
 */
export function buildMoreProp(type, ctx) {
  const { W, D, H, box, sweep, turned, minus, union, add, onBack, name } = ctx;
  // A profile seen from the front [x, z], swept back from y0 to y1; and one seen from the side [y, z], swept across from x0 to x1.
  const front = (pts, y0 = 0, y1 = D) => sweep(pts, [1, 0, 0], [0, 0, 1], [0, y0, 0], [0, 1, 0], 0, y1 - y0);
  const side = (pts, x0 = 0, x1 = W) => sweep(pts, [0, 1, 0], [0, 0, 1], [x0, 0, 0], [1, 0, 0], 0, x1 - x0);
  const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  // A circle as a polygon, centre (u, v), radius r.
  const circle = (u, v, r, n = 32) => Array.from({ length: n }, (_, k) => [u + r * Math.cos((2 * Math.PI * k) / n), v + r * Math.sin((2 * Math.PI * k) / n)]);
  // Swept fronts of several outlines, joined: each lying on its back to print.
  const fronts = (outlines, y0, y1) => union(...outlines.map((o) => front(o, y0, y1)));
  // Lying on its side, the side seen from the right up.
  const onSide = [90, -90];
  // A foot for something standing in it: a block with a socket for a post w by d, centred.
  const footWith = (fw, fd, fh, pw, pd, cx = W / 2, cy = D / 2) => minus(box(cx - fw / 2, cy - fd / 2, 0, cx + fw / 2, cy + fd / 2, fh), box(cx - pw / 2 - 0.2, cy - pd / 2 - 0.2, 1, cx + pw / 2 + 0.2, cy + pd / 2 + 0.2, fh + 1));

  switch (type) {
    // ----- The garage -----
    case 'vise':
      // A base, the body, and two jaws a gap apart.
      add('', name, fronts([rect(0, 0, W, 1.5), rect(2, 1.4, 8, 5), rect(1, 4.9, 4.6, 8), rect(5.4, 4.9, 9, 8)]), onBack);
      return true;
    case 'oil-drain':
      // A can on its foot, a funnel widening up from it, never more than 45 degrees.
      add('', name, turned([[0, 0], [5.5, 0], [5.5, 14], [3, 16.5], [3, 18], [6, 25], [6, 26], [0, 26]]));
      return true;
    case 'engine-stand':
      // Legs, a post, an engine block on top with its sump and its rocker cover.
      add('', name, fronts([rect(0, 0, W, 1.5), rect(6, 1.4, 8, 12), rect(2, 11.9, 12, 18), rect(4, 17.9, 10, 20), rect(5, 9, 9, 12)]), onBack);
      return true;
    case 'compressor':
      // Seen from the side: the tank on two feet, the motor on top; swept across, on its side to print.
      add('', name, union(side([[0, 0], [2, 0], [2, 1.5], [7, 1.5], [7, 0], [9, 0], [9, 2], [0, 2]]), side(circle(4.5, 6, 4.5, 24)), side(rect(2, 10, 7, 16))), onSide);
      return true;
    case 'balancer':
      // A cabinet, the wheel's shaft and hood, a display on a post.
      add('', name, fronts([rect(0, 0, W, 14), rect(1, 13.9, 7, 18), rect(9, 13.9, 11, 22), rect(8, 19, 12, 22)]), onBack);
      return true;
    case 'press':
      // A frame round its window, the bed across it and the ram down from the top.
      add('', name, minus(front(rect(0, 0, W, H)), front([[3, 8], [13, 8], [13, 24], [10, 24], [10, 19], [6, 19], [6, 24], [3, 24]], -1, D + 1)), onBack);
      return true;
    case 'car-lift':
      // Two posts and their arms reaching in, a car's width apart: seen from the front.
      add('', name, fronts([rect(0, 0, 6, H), rect(W - 6, 0, W, H), rect(5.9, 8, 22, 11), rect(W - 22, 8, W - 5.9, 11), rect(0, 0, W, 1.5)]), onBack);
      return true;
    // ----- The pit lane -----
    case 'quick-jack':
      // Seen from the side: a low frame, the saddle at the front, the handle rising to the back.
      add('', name, union(side(rect(0, 0, 14, 2.5)), side(rect(0, 2.4, 5, 7)), side([[12, 1.5], [D, 7], [D, 9], [12, 3.5]])), onSide);
      return true;
    case 'bottle-cart':
      // A base on its wheels, two bottles with 45 degree shoulders, a handle.
      add('', name, fronts([rect(0, 0, W, 2), [[1, 1.9], [5, 1.9], [5, 24], [3.5, 25.5], [3.5, 27], [2.5, 27], [2.5, 25.5], [1, 24]], [[7, 1.9], [11, 1.9], [11, 24], [9.5, 25.5], [9.5, 27], [8.5, 27], [8.5, 25.5], [7, 24]], rect(5, 1.9, 7, 30)]), onBack);
      return true;
    case 'cooling-fan':
      // Feet, a post and the round shroud, slots through it for its grille.
      add('', name, minus(fronts([rect(1, 0, W - 1, 1.5), rect(7, 1.4, 9, 8.5), circle(8, 15, 7, 32)]), ...[-3, 0, 3].map((dz) => front(rect(3.5, 15 + dz - 0.8, 12.5, 15 + dz + 0.8), -1, D + 1))), onBack);
      return true;
    case 'hose-reel':
      // The reel on its stand, its hub through it.
      add('', name, minus(fronts([rect(1, 0, W - 1, 1.5), rect(5, 1.4, 9, 4), circle(7, 9, 7, 32)]), front(circle(7, 9, 1.5, 16), -1, D + 1)), onBack);
      return true;
    case 'tyre-warmer':
      // A tyre in its blanket: straight sides, a lip at the top, a bore.
      add('', name, turned([[4, 0], [9.5, 0], [9.5, 6], [8.5, 7], [4, 7]]));
      return true;
    case 'wheel-gun':
      // Standing on its grip: the body over it, the socket on top.
      add('', name, fronts([rect(2, 0, 4.5, 8.5), rect(0, 8, W, 12), rect(2.2, 11.9, 3.8, 14)]), onBack);
      return true;
    // ----- The grid -----
    case 'lollipop':
      // A pole with the board on top, standing in a foot.
      add('board', 'board', fronts([rect(5, 1, 7, 30), circle(6, 34, 6, 32)], 3, 5), onBack);
      add('foot', 'foot', footWith(10, 8, 3, 2, 2, 6, 4));
      return true;
    case 'starter-stand': {
      // A rostrum of two steps, its post's socket on top; a flag on a pole standing in it.
      const rostrum = minus(union(box(0, 0, 0, W, D, 8), box(4, 3, 7.99, W, D, 14)), box(W - 4 - 0.2, D / 2 - 1 - 0.2, 10, W - 2 + 0.2, D / 2 + 1 + 0.2, 15));
      add('rostrum', 'rostrum', rostrum);
      add('flag', 'flag', fronts([rect(W - 4, 10, W - 2, H), rect(W - 13, H - 7, W - 3.9, H)], D / 2 - 1, D / 2 + 1), onBack);
      return true;
    }
    case 'wing-stand':
      // Two uprights and two spare wings across them, each a thin airfoil.
      add('', name, fronts([rect(0, 0, 2, H), rect(W - 2, 0, W, H), rect(0, 0, W, 1.5), [[1.9, 6], [W - 1.9, 6], [W - 1.9, 8], [W / 2, 9.5], [1.9, 8]], [[1.9, 14], [W - 1.9, 14], [W - 1.9, 16], [W / 2, 17.5], [1.9, 16]]]), onBack);
      return true;
    case 'helmet':
      // A post, the helmet widening on it at 45 degrees, its crown rounded.
      add('', name, turned([[0, 0], [3, 0], [3, 1.2], [1, 1.2], [1, 8], [4, 11], [4, 13], [3, 15], [1.5, 16], [0, 16]]));
      return true;
    // ----- The marshals -----
    case 'light-panel':
      // A panel of three lights on a post, standing in a foot.
      add('panel', 'panel', minus(fronts([rect(7, 1, 9, 16), rect(0, 15.9, W, H)], 3, 5), ...[3.5, 8, 12.5].map((x) => front(circle(x, 23, 1.6, 16), 2, 6))), onBack);
      add('foot', 'foot', footWith(10, 8, 3, 2, 2, 8, 4));
      return true;
    case 'tv-camera':
      // Seen from the side: the tripod's legs, its head, the camera with its lens to the front.
      add('', name, side([[1, 0], [3, 0], [7, 12], [11, 0], [13, 0], [8, 15], [8, 16], [12, 16], [12, 21], [2, 21], [2, 19], [0, 19], [0, 17], [2, 17], [2, 16], [6, 16], [6, 15]]), onSide);
      return true;
    case 'tow-dolly':
      // Seen from the side: a wheel at each end of the frame; swept across.
      add('', name, union(side(rect(1, 2.5, D - 1, 4.5)), side(circle(3, 3, 3, 20)), side(circle(D - 3, 3, 3, 20))), onSide);
      return true;
    case 'spill-bin':
      // A bin, its lid sloping to the front at 45 degrees, a label band.
      add('', name, fronts([rect(0, 0, W, 11), [[0, 10.9], [W, 10.9], [W, 12], [W - 2, 14], [2, 14], [0, 12]]]), onBack);
      return true;
    // ----- Scrutineering -----
    case 'width-arch':
      // A frame as wide as a car may be: two legs and the beam over them.
      add('', name, minus(front(rect(0, 0, W, H)), front(rect(4, -1, W - 4, H - 4), -1, D + 1)), onBack);
      return true;
    case 'height-sled':
      // A low sled, its ends sloping, a step along its middle.
      add('', name, fronts([[[0, 0], [W, 0], [W - 3, 3], [3, 3]], rect(6, 2.9, W - 6, 4)]), onBack);
      return true;
    case 'pyrometer':
      // A case with a handle block on top and a lid line.
      add('', name, minus(fronts([rect(0, 0, W, 6), rect(3, 5.9, 7, 8)]), front(rect(-1, 4, W + 1, 4.5), -1, 0.4)), onBack);
      return true;
    case 'sample-bench':
      // A bench on two legs, three sample jars on it.
      add('', name, fronts([rect(0, 0, 2, 14), rect(W - 2, 0, W, 14), rect(0, 13.9, W, 16), ...[5, 11, 17].map((x) => rect(x, 15.9, x + 3, 19))]), onBack);
      return true;
    case 'alignment':
      // A foot, a post and the head with its arm out to the wheel.
      add('', name, fronts([rect(0, 0, W, 1.5), rect(3, 1.4, 5, 14), rect(1, 13.9, 7, 18), rect(5, 15, W, 16.5), rect(3, 17.9, 5, 20)]), onBack);
      return true;
    // ----- Slot-car racing -----
    case 'controllers':
      // Two hand controllers on a stand: each a grip with its trigger and a cable post.
      add('', name, fronts([rect(0, 0, W, 1.5), rect(1, 1.4, 4, 8), rect(4, 4, 5, 6), rect(7, 1.4, 10, 8), rect(10, 4, 11, 6), rect(2, 7.9, 3, 10), rect(8, 7.9, 9, 10)]), onBack);
      return true;
    case 'power-supply':
      // Seen from the side: a box, its panel sloping up to the back at 45 degrees; it stands to print.
      add('', name, side([[0, 0], [D, 0], [D, H], [3, H], [0, H - 3]]));
      return true;
    case 'tyre-truer':
      // A base, the motor, the stone and the axle post a car's wheel turns on.
      add('', name, fronts([rect(0, 0, W, 2), rect(1, 1.9, 6, 7), circle(8.5, 6, 2.5, 20), rect(9, 1.9, 11, 10)]), onBack);
      return true;
    case 'setup-board':
      // A flat board, raised lines across it for the wheels.
      add('', name, union(box(0, 0, 0, W, D, 2), ...[3, 7, 11].map((y) => box(1, y, 1.99, W - 1, y + 1, H))));
      return true;
    case 'pinion-puller':
      // A small press: a foot, the screw and its knob, no wider going up than 45 degrees.
      add('', name, turned([[0, 0], [3, 0], [3, 2], [1, 4], [1, 6], [2, 7], [2, 8], [0, 8]]));
      return true;
    case 'pit-case':
      // A carrying case, its lid a step in from its sides, a handle block on the lid.
      add('', name, union(box(0, 0, 0, W, D, 5.5), box(0.5, 0.5, 5.49, W - 0.5, D - 0.5, 8), box(5, 3, 7.99, 11, 7, H)));
      return true;
    // ----- The circuit and the race weekend -----
    case 'flag-rack':
      // Two posts, a rail and the flags hanging from it.
      add('', name, fronts([rect(0, 0, 2, H), rect(W - 2, 0, W, H), rect(0, H - 2, W, H), rect(0, 0, W, 1.5), rect(3, H - 12, 6, H - 1.9), rect(7, H - 10, 10, H - 1.9), rect(11, H - 12, 14, H - 1.9)]), onBack);
      return true;
    case 'pa-speaker':
      // A pole with a horn speaker on top, in a foot.
      add('speaker', 'speaker', fronts([rect(4, 1, 6, 26), [[2, 25.9], [8, 25.9], [10, H], [0, H]]], 3, 5), onBack);
      add('foot', 'foot', footWith(8, 8, 3, 2, 2, 5, 4));
      return true;
    case 'trophy':
      // A base, a stem, the cup widening on it at 45 degrees.
      add('', name, turned([[0, 0], [3.5, 0], [3.5, 2], [1.2, 2], [1.2, 5], [4, 7.8], [4, 12], [3, 12], [3, 8.5], [0, 8.5]]));
      return true;
    case 'jerry-can':
      // A can, its handle and spout, the hole through the handle.
      add('', name, minus(fronts([rect(0, 0, W, 10), [[0, 9.9], [W, 9.9], [W, 12], [7, 12], [6, 11], [0, 11]], rect(7.5, 11.9, 9, H)]), front(rect(1.5, 10.2, 5, 11.2), -1, D + 1)), onBack);
      return true;
    // ----- Inside -----
    case 'chair':
      // Seen from the side: a front leg, the back leg rising into the back, the seat between; on its side to print.
      add('', name, side([[0, 0], [1.5, 0], [1.5, 6], [6.5, 6], [6.5, 0], [8, 0], [8, 14], [6.5, 14], [6.5, 7.5], [0, 7.5]]), onSide);
      return true;
    case 'shelves':
      add('', name, fronts([rect(0, 0, 1.5, H), rect(W - 1.5, 0, W, H), ...[0, 9, 18, 27.5].map((z) => rect(0, z, W, z + 1.5 + (z ? 0 : 0.5)))]), onBack);
      return true;
    case 'fireplace':
      // A breast with its mantel, the hearth's opening sunk in its face, a round arch over it.
      add('', name, minus(fronts([rect(1, 0, W - 1, 14), rect(0, 13.9, W, 15.5), rect(2, 15.4, W - 2, H)]), front([[6, 0], [14, 0], [14, 7], ...Array.from({ length: 9 }, (_, k) => [10 + 4 * Math.cos((Math.PI * k) / 8), 7 + 4 * Math.sin((Math.PI * k) / 8)]), [6, 7]], -1, 4)), onBack);
      return true;
    case 'seat':
      add('', name, fronts([rect(1, 0, 3, 6), rect(W - 3, 0, W - 1, 6), rect(0, 5.9, W, H)]), onBack);
      return true;
    // ----- Architecture -----
    case 'picket-fence':
      // Two rails and pickets pointed at their tops.
      add('', name, fronts([rect(0, 3, W, 5), rect(0, 9, W, 11), ...Array.from({ length: 10 }, (_, k) => [[k * 4 + 0.5, 0], [k * 4 + 2.5, 0], [k * 4 + 2.5, 12.5], [k * 4 + 1.5, H], [k * 4 + 0.5, 12.5]])]), onBack);
      return true;
    case 'column':
      // A base, a shaft, a capital widening from it at 45 degrees, an abacus.
      add('', name, turned([[0, 0], [5, 0], [5, 2], [3.5, 3.5], [3.5, 35.5], [5, 37], [5, H], [0, H]]));
      return true;
    case 'buttress':
      // Seen from the side: steps receding up the wall it stands against; it stands to print.
      add('', name, side([[0, 0], [D, 0], [D, H], [D - 5, H], [D - 5, 20], [D - 10, 20], [D - 10, 10], [0, 10]]));
      return true;
    case 'arch': {
      // A wall with a round-arched opening through it.
      const r = 9, spring = 18;
      const opening = [[W / 2 - r, -1], [W / 2 + r, -1], [W / 2 + r, spring], ...Array.from({ length: 13 }, (_, k) => [W / 2 + r * Math.cos((Math.PI * k) / 12), spring + r * Math.sin((Math.PI * k) / 12)]), [W / 2 - r, spring]];
      add('', name, minus(front(rect(0, 0, W, H)), front(opening, -1, D + 1)), onBack);
      return true;
    }
    case 'chimney-pot':
      add('', name, turned([[0, 0], [3, 0], [3, 1], [2, 2], [2, 8], [2.8, 8.8], [2.8, H], [0, H]]));
      return true;
    case 'battlement':
      add('', name, fronts([rect(0, 0, W, 9), ...[0, 8, 16, 24, 32].map((x) => rect(x, 8.9, x + 5, H))]), onBack);
      return true;
    case 'roof-vent':
      // A square foot, a stem and a cap mushrooming over it at 45 degrees.
      add('', name, union(box(0, 0, 0, W, D, 1.5), turned([[0, 1.4], [2, 1.4], [2, 6], [4, 8], [4, 9], [3, H], [0, H]])));
      return true;
    case 'water-tank':
      // A column, a cone widening from it at 45 degrees, the tank and its cone roof.
      add('', name, turned([[0, 0], [4, 0], [4, 1.5], [2, 3.5], [2, 14], [8, 20], [8, 27], [2, H], [0, H]]));
      return true;
    case 'scifi-pillar':
      add('', name, turned([[0, 0], [5, 0], [5, 3], [3, 5], [3, 14], [4, 15], [4, 17], [3, 18], [3, 30], [4.5, 31.5], [4.5, 34], [2.5, H], [0, H]]));
      return true;
    // ----- The street -----
    case 'retaining-wall':
      // Seen from the side: battered at its face, leaning back; it stands to print.
      add('', name, side([[0, 0], [D, 0], [D, H], [2.5, H], [0, 2]]));
      return true;
    case 'railing':
      add('', name, fronts([...[0, 9.5, 19, 28.5, 38].map((x) => rect(x, 0, x + 2, H)), rect(0, 5, W, 6.5), rect(0, H - 1.5, W, H)]), onBack);
      return true;
    case 'gate':
      // A frame, its bars, a brace across it corner to corner.
      add('', name, fronts([rect(0, 0, 2, H), rect(W - 2, 0, W, H), rect(0, 0, W, 1.5), rect(0, H - 1.5, W, H), rect(0, 7.5, W, 9), ...[7, 13, 19].map((x) => rect(x, 0, x + 1.2, H)), [[2, 1.5], [4, 1.5], [W - 2, H - 3], [W - 2, H - 1.5], [W - 4, H - 1.5], [2, 3]]]), onBack);
      return true;
    case 'street-lamp':
      // A post with its arm and the lantern hanging from it, in a foot.
      add('lamp', 'lamp', fronts([rect(3, 1, 5, 52), rect(3, 50, 14, 52), rect(10, 44, 14, 50), [[10, 44], [14, 44], [13, 42], [11, 42]]], 3, 5), onBack);
      add('foot', 'foot', footWith(8, 8, 3, 2, 2, 4, 4));
      return true;
    case 'barrel':
      // Bulging gently to its middle and in again, hoops round it.
      add('', name, turned([[0, 0], [6, 0], [6.5, 3], [6.3, 3.4], [6.8, 4], [7, 9], [6.8, 14], [6.3, 14.6], [6.5, 15], [6, H], [0, H]]));
      return true;
    case 'planter':
      // A trough, its soil sunk inside the rim, shrubs standing in it.
      add('', name, union(minus(box(0, 0, 0, W, D, 8), box(1.5, 1.5, 6.5, W - 1.5, D - 1.5, 9)), ...[5, 12, 19].map((x) => turned([[0, 6.4], [3, 6.4], [3, 9], [2, 11], [1, H], [0, H]], x, D / 2))));
      return true;
    case 'ruined-wall':
      // A wall, its top broken away raggedly, a hole through it.
      add('', name, minus(front([[0, 0], [W, 0], [W, 12], [36, 15], [32, 11], [27, 18], [22, H], [17, 14], [12, 17], [7, 10], [3, 13], [0, 9]]), front(rect(14, 4, 20, 9), -1, D + 1)), onBack);
      return true;
    case 'nameplate':
      // A plate with a raised border, to letter or paint.
      add('', name, minus(front(rect(0, 0, W, H)), front(rect(1.5, 1.5, W - 1.5, H - 1.5), -1, 0.6)), onBack);
      return true;
    // ----- Shapes -----
    case 'shape-block':
      add('', name, box(0, 0, 0, W, D, H));
      return true;
    case 'shape-cylinder':
      add('', name, turned([[0, 0], [W / 2, 0], [W / 2, H], [0, H]]));
      return true;
    case 'shape-cone':
      add('', name, turned([[0, 0], [W / 2, 0], [0, H]]));
      return true;
    case 'shape-dome':
      add('', name, turned([[0, 0], ...Array.from({ length: 13 }, (_, k) => [(W / 2) * Math.cos((Math.PI / 2) * (k / 12)), H * Math.sin((Math.PI / 2) * (k / 12))])]));
      return true;
    case 'shape-vault':
      // Half a cylinder lying along y, its curve up: it stands to print.
      add('', name, front([[0, 0], ...Array.from({ length: 17 }, (_, k) => [W / 2 + (W / 2) * Math.cos(Math.PI * (k / 16)), H * Math.sin(Math.PI * (k / 16))]).reverse()]));
      return true;
    case 'shape-wedge':
      add('', name, side([[0, 0], [D, 0], [D, H]]));
      return true;
    // ----- For scale -----
    case 'figure':
      // A person 1.75 m tall at 1:32, standing: legs, body, arms at its sides, its head.
      add('', name, fronts([rect(2.2, 0, 4.6, 26), rect(5.4, 0, 7.8, 26), rect(1.8, 25.9, 8.2, 44), rect(0, 27, 1.9, 43), rect(8.1, 27, 10, 43), rect(4, 43.9, 6, 46.5), circle(5, 50.5, 4.6, 24)]), onBack);
      return true;
    case 'car-block':
      // A slot car's room, seen from its side: the body, the cabin over it, the wheels under it; lying on its side to print.
      add('', name, fronts([[[4, 3], [54, 3], [57, 5], [57, 8], [52, 9], [42, 9], [35, 14], [20, 14], [14, 9], [3, 8], [1, 5]], circle(12, 3.5, 3.5, 20), circle(46, 3.5, 3.5, 20)]), onBack);
      return true;
    // ----- The circuit -----
    case 'trestle':
      // Splayed legs under a beam: an A at each end, joined.
      add('', name, fronts([[[0, 0], [3, 0], [7, 16], [4, 16]], [[W, 0], [W - 3, 0], [W - 7, 16], [W - 4, 16]], rect(2, 15.9, W - 2, H), rect(4, 7, W - 4, 8.5)]), onBack);
      return true;
    case 'ladder':
      add('', name, fronts([rect(0, 0, 2, H), rect(W - 2, 0, W, H), ...Array.from({ length: 8 }, (_, k) => rect(1.9, 3 + k * 6, W - 1.9, 4.5 + k * 6))]), onBack);
      return true;
    case 'steps': {
      // Seen from the side: steps on a slab rising with them; on its side to print.
      const n = 5, t = D / n, r = H / n;
      const pts = [[0, 0]];
      for (let k = 1; k <= n; k++) pts.push([(k - 1) * t, k * r], [k * t, k * r]);
      pts.push([D, H - 5], [5 * (t / r), 0]);
      add('', name, side(pts), onSide);
      return true;
    }
    case 'circuit-clock':
      // A post with the clock's face on top, its hands raised, in a foot.
      add('clock', 'clock', fronts([rect(6, 1, 8, 29), circle(7, 34, 6, 32)], 2, 6), onBack);
      add('foot', 'foot', footWith(10, 8, 3, 2, 4, 7, 4));
      return true;
    case 'sign-board':
      add('', name, fronts([rect(3, 0, 5, 12), rect(W - 5, 0, W - 3, 12), rect(0, 11.9, W, H), rect(0, 0, W, 1.5)]), onBack);
      return true;
    case 'pit-wall':
      // A wall, its foot sloping out at the track's side; a debris fence panel along its top.
      add('', name, union(side([[0, 0], [D, 0], [D, 12], [3, 12], [0, 4]]), box(0, D - 3, 11.99, W, D - 1.8, H)));
      return true;
    case 'crash-barrier':
      // A low kerb, the beam on it at the front, posts behind it.
      add('', name, union(box(0, 0, 0, W, D, 3), box(0, 0, 2.99, W, 2, 9), ...[2, 14, 26, 38].map((x) => box(x - 1, 2, 2.99, x + 1, D, H))));
      return true;
    case 'tyre-wall':
      // Stacks of tyres in a row, each a V between the tyres, touching the next.
      add('', name, union(...[5, 15, 25, 35].map((x) => turned([[0, 0], [5.3, 0], [5.3, 4], [4.6, 4.7], [5.3, 5.4], [5.3, 8.6], [4.6, 9.3], [5.3, 10], [5.3, 13.2], [4.6, 13.9], [5.3, 14.6], [5.3, H], [0, H]], x, D / 2))));
      return true;
    case 'catch-fence':
      // Posts and a mesh across them, its holes through it.
      add('', name, minus(front(rect(0, 0, W, H)), ...Array.from({ length: 6 }, (_, i) => Array.from({ length: 9 }, (_, j) => front(rect(3 + i * 6, 3 + j * 4, 6.5 + i * 6, 5.5 + j * 4), -1, D + 1))).flat()), onBack);
      return true;
    case 'pylon':
      // A tall board with slots for the cars' numbers, in a foot.
      add('pylon', 'pylon', minus(front(rect(1, 1, W - 1, H), 2, 6), ...Array.from({ length: 6 }, (_, k) => front(rect(3, 8 + k * 6.5, W - 3, 12 + k * 6.5), 1, 2.6))), onBack);
      add('foot', 'foot', footWith(W, 8, 3, W - 2, 4, W / 2, 4));
      return true;
    case 'tyre-rack':
      // Two uprights, two shelves, tyres standing on them.
      add('', name, fronts([rect(0, 0, 2, H), rect(W - 2, 0, W, H), rect(0, 1, W, 2.5), rect(0, 10, W, 11.5), ...[6, 12, 18].map((x) => circle(x, 6.0, 3.6, 20)), ...[6, 12, 18].map((x) => circle(x, 15.0, 3.6, 20))]), onBack);
      return true;
    case 'pit-perch':
      // Legs, the platform, a desk on it and a roof on posts over it.
      add('', name, fronts([rect(1, 0, 3, 12), rect(W - 3, 0, W - 1, 12), rect(0, 11.9, W, 14), rect(3, 13.9, 17, 20), rect(1, 13.9, 2.5, 28), rect(W - 2.5, 13.9, W - 1, 28), rect(0, 27.9, W, H)]), onBack);
      return true;
    default:
      return false;
  }
}
