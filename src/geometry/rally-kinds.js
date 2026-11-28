// The rally kinds in one place: how each is checked, laid out, built, where
// it stands on the table and the notes of its kit; and the fields of its card.
import { buildStoneWall, stoneWallFootprint, stoneWallLayout, stoneWallNotes, validateStoneWall, STONE_WALL_LIMITS } from './stone-wall.js';
import { buildHuntingTower, huntingTowerFootprint, huntingTowerLayout, huntingTowerNotes, validateHuntingTower, HUNTING_TOWER_LIMITS } from './hunting-tower.js';
import { buildCaravan, caravanFootprint, caravanLayout, caravanNotes, validateCaravan, TIMING_CARAVAN_LIMITS } from './timing-caravan.js';

// A field: [key, label, 'number' | 'check' | 'text' | options, limits or unit].
export const RALLY_KINDS = Object.freeze({
  caravan: {
    title: 'Timing caravan',
    validate: validateCaravan, layout: caravanLayout, build: buildCaravan, footprint: caravanFootprint, notes: caravanNotes,
    fields: [['length', 'Length', 'number', TIMING_CARAVAN_LIMITS.length], ['width', 'Width', 'number', TIMING_CARAVAN_LIMITS.width], ['height', 'Height', 'number', TIMING_CARAVAN_LIMITS.height], ['text', 'Lettering', 'text']],
    hint: 'A caravan for the timekeepers at a stage start or finish, on one axle: a serving hatch with a counter in its left side and a flap propped over it, a door on the right, an A-frame drawbar with a jockey leg, a steady at each corner and an aerial on the roof.',
  },
  stonewall: {
    title: 'Dry-stone wall',
    validate: validateStoneWall, layout: stoneWallLayout, build: buildStoneWall, footprint: stoneWallFootprint, notes: stoneWallNotes,
    fields: [['length', 'Length', 'number', STONE_WALL_LIMITS.length], ['height', 'Height', 'number', STONE_WALL_LIMITS.height], ['gate', 'Gate', [['middle', 'In the middle'], ['end', 'At the right end'], ['none', 'No gate']]], ['gateWidth', 'Gate width', 'number', STONE_WALL_LIMITS.gateWidth]],
    hint: 'A wall of stones laid without mortar along a stage, wider at its foot than at its top, a row of stones on end along it; a five-bar gate between two square gateposts. It stands in runs that fit the plate, each printing upright; the gate lies flat.',
  },
  huntingtower: {
    title: 'Hunting tower',
    validate: validateHuntingTower, layout: huntingTowerLayout, build: buildHuntingTower, footprint: huntingTowerFootprint, notes: huntingTowerNotes,
    fields: [['height', 'Height of the cabin', 'number', HUNTING_TOWER_LIMITS.height], ['cabinWidth', 'Cabin width', 'number', HUNTING_TOWER_LIMITS.cabinWidth], ['cabinDepth', 'Cabin depth', 'number', HUNTING_TOWER_LIMITS.cabinDepth], ['cabinHeight', 'Cabin walls', 'number', HUNTING_TOWER_LIMITS.cabinHeight], ['splay', 'Legs spread at their feet', 'number', HUNTING_TOWER_LIMITS.splay], ['ladder', 'A ladder up to the door', 'check']],
    hint: 'A forest lookout on a Nordic stage: a planked cabin on four legs spreading towards their feet, braced on every side, a ladder up to its door, a roof falling to the back. The front and the back legs print as flat frames, the sides as frames of braces glued between them; the cabin stands on its floor.',
  },
});
export const isRallyKind = (kind) => Object.hasOwn(RALLY_KINDS, kind ?? '');
