// Standard buildings for a rally stage, each of a kind of its own: the
// timekeepers' caravan, a dry-stone wall with its gate, a forest lookout.
export const RALLY_PRESETS = [
  {
    id: 'rally-timing-caravan',
    name: 'Timing caravan',
    note: 'The timekeepers’ caravan at a stage start or finish: a serving hatch with a counter and a flap propped over it, TIMING above, a drawbar, corner steadies and an aerial',
    building: { kind: 'caravan' },
  },
  {
    id: 'rally-stone-wall',
    name: 'Dry-stone wall and gate',
    note: 'A wall of stones laid without mortar along a stage, a row of stones on end along its top, a five-bar gate between two gateposts in its middle',
    building: { kind: 'stonewall', length: 300 },
  },
  {
    id: 'rally-hunting-tower',
    name: 'Forest hunting tower',
    note: 'The lookout of a forest stage: a planked cabin on four braced legs spreading to their feet, a ladder up to its door, a roof falling to the back',
    building: { kind: 'huntingtower' },
  },
  {
    id: 'rally-arch-house',
    name: 'Arch house',
    note: 'A white town house over the road, the stage running through an arch in its ground floor: stone piers, shuttered windows on two storeys, a balcony over the arch, a flat roof',
    building: { kind: 'archhouse' },
  },
  {
    id: 'rally-tunnel-portal',
    name: 'Tunnel portal',
    note: 'The mouth of a road tunnel through a headland: a stone headwall, voussoirs and a keystone round its arch, a lined tunnel behind, a small house against its side',
    building: { kind: 'tunnelportal' },
  },
  {
    id: 'rally-rock-gallery',
    name: 'Rock gallery',
    note: 'A half tunnel on a mountain stage: the rock face on one side, a row of arched pillars open to the valley on the other, a flat roof over the road',
    building: { kind: 'rockgallery' },
  },
  {
    id: 'rally-level-crossing',
    name: 'Level crossing',
    note: 'A railway across the stage: the line up to the track each side over its sleepers, cross signs, half barriers with their booms raised, the keeper’s brick cottage',
    building: { kind: 'levelcrossing' },
  },
];
/** Their group in the Start from list, with the service tent and the start ramp. */
export const RALLY_GROUP = ['Rally', ['rally-timing-caravan', 'rally-hunting-tower', 'rally-stone-wall', 'rally-arch-house', 'rally-tunnel-portal', 'rally-rock-gallery', 'rally-level-crossing', 'rally-start-ramp', 'rally-service-tent']];
export const RALLY_COLOURS = { racing: ['rally-timing-caravan'], timber: ['rally-hunting-tower'], whitewash: ['rally-arch-house'] };
