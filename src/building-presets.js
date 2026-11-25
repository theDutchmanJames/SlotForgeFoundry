// Standard buildings: good starting settings for what slot-racing layouts
// most often have beside the track. Each is an ordinary building, so every
// setting can be changed afterwards. Toy proportions for 1:32.

const window = (wall, at, width, height, sill, frame = true) => ({ wall, type: 'window', at, width, height, sill, frame });
const door = (wall, at, frame = true) => ({ wall, type: 'door', at, width: 28, height: 48, frame });

/** A row of pit garages side by side, one bay each, as many as wanted. */
export function pitRow(bays = 4) {
  return {
    rooms: { along: 'width', sizes: Array.from({ length: bays }, () => 110) },
    depth: 180,
    height: 75,
    doorWidth: 80,
    doorHeight: 55,
    overhangFront: 12,
  };
}

export const BUILDING_PRESETS = Object.freeze([
  {
    id: 'garage',
    name: 'Pit garage',
    note: 'One bay, roller door',
    building: { overhangFront: 10 },
  },
  {
    id: 'pitrow',
    name: 'Pit row',
    note: 'Bays side by side; add as many as you like under Rooms',
    building: pitRow(4),
  },
  {
    id: 'tower',
    name: 'Control tower',
    note: 'Three storeys, glazed on top',
    building: {
      width: 120,
      depth: 120,
      height: 70,
      door: 'none',
      wallTexture: 'block',
      openings: [door('front', 60), window('left', 60, 40, 25, 30)],
      upper: [
        { width: 110, depth: 110, x: 5, y: 5, height: 55, openings: [window('front', 55, 70, 25, 18), window('back', 55, 70, 25, 18)] },
        {
          width: 100,
          depth: 100,
          x: 5,
          y: 5,
          height: 50,
          openings: ['front', 'back', 'left', 'right'].map((w) => window(w, 50, 76, 30, 10)),
        },
      ],
      overhangFront: 10,
      overhangBack: 10,
      overhangLeft: 10,
      overhangRight: 10,
    },
  },
  {
    id: 'vip',
    name: 'VIP and hospitality',
    note: 'A pit row with a glazed lounge and a terrace on top',
    building: {
      ...pitRow(3),
      upper: [
        {
          width: 330,
          depth: 120,
          x: 0,
          y: 60,
          height: 55,
          openings: [55, 165, 275].map((at) => window('front', at, 86, 32, 12)),
        },
      ],
      overhangFront: 15,
    },
  },
  {
    id: 'marshal',
    name: 'Marshal hut',
    note: 'One room, a door and two windows',
    building: {
      width: 95,
      depth: 95,
      height: 68,
      door: 'none',
      roof: 'slope',
      rises: 'back',
      pitch: 12,
      overhangFront: 10,
      openings: [door('front', 30), window('front', 70, 30, 25, 25), window('left', 47.5, 40, 25, 25)],
    },
  },
  {
    id: 'timing',
    name: 'Timing box',
    note: 'Raised, with a wide window onto the track',
    building: {
      width: 90,
      depth: 70,
      height: 55,
      baseHeight: 30,
      door: 'none',
      openings: [window('front', 45, 66, 24, 18), door('back', 45)],
      overhangFront: 12,
      overhangLeft: 5,
      overhangRight: 5,
    },
  },
  {
    id: 'container',
    name: 'Container office',
    note: 'A 20 ft container at 1:32',
    building: {
      width: 190,
      depth: 76,
      height: 75,
      baseHeight: 6,
      door: 'none',
      wallTexture: 'metal',
      openings: [door('front', 30, false), window('front', 120, 50, 26, 26)],
      overhangFront: 0,
      overhangBack: 0,
      overhangLeft: 0,
      overhangRight: 0,
    },
  },
  {
    id: 'classic',
    name: 'Classic garage',
    note: 'Brick, a two-sided tiled roof',
    building: {
      roof: 'gable',
      ridge: 'depth',
      pitch: 35,
      wallTexture: 'brick',
      roofTexture: 'tile',
      overhangFront: 8,
      overhangBack: 8,
      overhangLeft: 6,
      overhangRight: 6,
      openings: [window('left', 60, 40, 28, 25), window('left', 125, 40, 28, 25), window('right', 90, 40, 28, 25)],
    },
  },
  {
    id: 'shed',
    name: 'Wooden shed',
    note: 'Planks and shingles',
    building: {
      width: 100,
      depth: 120,
      height: 62,
      door: 'none',
      roof: 'gable',
      ridge: 'depth',
      pitch: 32,
      wallTexture: 'planks',
      roofTexture: 'shingle',
      overhangFront: 8,
      overhangBack: 8,
      overhangLeft: 6,
      overhangRight: 6,
      openings: [door('front', 50), window('left', 60, 34, 24, 22)],
    },
  },
  {
    id: 'stand',
    name: 'Grandstand',
    note: 'Six rows of benches, an aisle, open to the sky',
    building: { kind: 'grandstand', length: 240, rows: 6, aisles: 1 },
  },
  {
    id: 'stand-covered',
    name: 'Covered grandstand',
    note: 'Eight rows under a canopy on posts',
    building: { kind: 'grandstand', length: 320, rows: 8, aisles: 2, roof: 'canopy' },
  },
  {
    id: 'stand-curved',
    name: 'Curved grandstand',
    note: 'Round the outside of a bend, facing into it',
    building: { kind: 'grandstand', rows: 5, aisles: 2, curve: { radius: 450, angle: 45, facing: 'in' } },
  },
]);
