// The rally kinds in one place: how each is checked, laid out, built, where
// it stands on the table and the notes of its kit; and the fields of its card.
import { buildStoneWall, stoneWallFootprint, stoneWallLayout, stoneWallNotes, validateStoneWall, STONE_WALL_LIMITS } from './stone-wall.js';
import { buildHuntingTower, huntingTowerFootprint, huntingTowerLayout, huntingTowerNotes, validateHuntingTower, HUNTING_TOWER_LIMITS } from './hunting-tower.js';
import { buildCaravan, caravanFootprint, caravanLayout, caravanNotes, validateCaravan, TIMING_CARAVAN_LIMITS } from './timing-caravan.js';
import { archHouseFootprint, archHouseLayout, archHouseNotes, buildArchHouse, validateArchHouse, ARCH_HOUSE_LIMITS } from './arch-house.js';
import { buildTunnelPortal, tunnelPortalFootprint, tunnelPortalLayout, tunnelPortalNotes, validateTunnelPortal, TUNNEL_PORTAL_LIMITS } from './tunnel-portal.js';
import { buildRockGallery, rockGalleryFootprint, rockGalleryLayout, rockGalleryNotes, validateRockGallery, ROCK_GALLERY_LIMITS } from './rock-gallery.js';
import { buildLevelCrossing, levelCrossingFootprint, levelCrossingLayout, levelCrossingNotes, validateLevelCrossing, LEVEL_CROSSING_LIMITS } from './level-crossing.js';

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
  archhouse: {
    title: 'Arch house',
    validate: validateArchHouse, layout: archHouseLayout, build: buildArchHouse, footprint: archHouseFootprint, notes: archHouseNotes,
    fields: [['span', 'Width of the arch', 'number', ARCH_HOUSE_LIMITS.span], ['clearance', 'Height under the arch', 'number', ARCH_HOUSE_LIMITS.clearance], ['depth', 'Depth', 'number', ARCH_HOUSE_LIMITS.depth], ['storeys', 'Storeys above the arch', 'number', ARCH_HOUSE_LIMITS.storeys], ['balcony', 'A balcony over the arch', 'check']],
    hint: 'A town house over the road, the track running through an arch in its ground floor: stone piers, plaster above, shuttered windows, a flat roof. Its walls print flat, the front and the back each in two halves meeting over the arch.',
  },
  tunnelportal: {
    title: 'Tunnel portal',
    validate: validateTunnelPortal, layout: tunnelPortalLayout, build: buildTunnelPortal, footprint: tunnelPortalFootprint, notes: tunnelPortalNotes,
    fields: [['span', 'Width of the tunnel', 'number', TUNNEL_PORTAL_LIMITS.span], ['clearance', 'Height under the arch', 'number', TUNNEL_PORTAL_LIMITS.clearance], ['length', 'Length of the tunnel', 'number', TUNNEL_PORTAL_LIMITS.length], ['house', 'House beside the arch', [['right', 'On the right'], ['left', 'On the left'], ['none', 'No house']]]],
    hint: 'The mouth of a road tunnel: a stone headwall with voussoirs and a keystone round its arch, a lined tunnel behind it to build the hillside over, a small house against the headwall. The headwall lies flat in two halves; the lining stands on its ends.',
  },
  rockgallery: {
    title: 'Rock gallery',
    validate: validateRockGallery, layout: rockGalleryLayout, build: buildRockGallery, footprint: rockGalleryFootprint, notes: rockGalleryNotes,
    fields: [['length', 'Length', 'number', ROCK_GALLERY_LIMITS.length], ['span', 'Width of the road', 'number', ROCK_GALLERY_LIMITS.span], ['clearance', 'Height under the roof', 'number', ROCK_GALLERY_LIMITS.clearance], ['arches', 'Arches between the pillars', 'check']],
    hint: 'A half tunnel on a mountain stage: the rock face on one side of the road, a row of pillars open to the valley on the other, a flat roof over both. It stands in runs that fit the plate; every part lies flat.',
  },
  levelcrossing: {
    title: 'Level crossing',
    validate: validateLevelCrossing, layout: levelCrossingLayout, build: buildLevelCrossing, footprint: levelCrossingFootprint, notes: levelCrossingNotes,
    fields: [['span', 'Width of the road', 'number', LEVEL_CROSSING_LIMITS.span], ['verge', 'Railway each side', 'number', LEVEL_CROSSING_LIMITS.verge], ['barriers', 'Half barriers', 'check'], ['cottage', 'A keeper’s cottage', 'check']],
    hint: 'A railway crossing the stage: the line runs up to the track’s borders each side over ballast and sleepers, the slots running on between; cross signs, half barriers with their booms raised, and the crossing keeper’s brick cottage.',
  },
});
export const isRallyKind = (kind) => Object.hasOwn(RALLY_KINDS, kind ?? '');
