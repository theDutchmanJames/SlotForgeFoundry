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
];
/** Their group in the Start from list, with the service tent and the start ramp. */
export const RALLY_GROUP = ['Rally', ['rally-timing-caravan', 'rally-hunting-tower', 'rally-stone-wall', 'rally-start-ramp', 'rally-service-tent']];
export const RALLY_COLOURS = { racing: ['rally-timing-caravan'], timber: ['rally-hunting-tower'] };
