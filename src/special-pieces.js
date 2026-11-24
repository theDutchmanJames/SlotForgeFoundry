import { racingPlan, isRacingPiece } from './special-racing.js';
import { hairpinWireProfile } from './geometry/special-racing-tools.js';
import {
  diamondJumperSize,
  specialJunctionPlan,
} from './geometry/special-junction-layout.js';
import { timingPlan } from './geometry/timing-straight.js';
import { PIT_MOTOR_DEFAULTS } from './geometry/pit-motor-settings.js';
import { pitActuatorSpec } from './geometry/pit-turnout.js';
import { PIT_CONTACT_DEFAULTS } from './geometry/pit-braids.js';
import { pitGridLayout } from './geometry/starting-grid.js';
import { hasSlotPosition } from './slot-position.js';
import {
  TURNOUT_INSERT,
  turnoutDefaultShape,
  turnoutDefaults,
  turnoutHasBlade,
  turnoutModeName,
  turnoutSettings,
} from './geometry/turnout-layout.js';
import { TURNOUT_DRIVE } from './geometry/turnout-drive.js';

// The specials every pack can make, whatever its lane count allows.
export const SPECIAL_PIECES = Object.freeze([
  ['hairpin', 'Double-crossover hairpin'],
  ['pit', 'Single-lane pit'],
  ['diamond', 'Flat diamond crossing'],
  ['duel', 'Late-apex duel'],
  ['chicane', 'Bus-stop chicane'],
  ['timing', 'Timing straight'],
]);
// Specials for a road with one lane only. They are kept apart from the list
// above because they cannot be made from a multi-lane pack.
export const SINGLE_LANE_SPECIALS = Object.freeze([['turnout', 'Turnout']]);
export const ALL_SPECIAL_PIECES = Object.freeze([
  ...SPECIAL_PIECES,
  ...SINGLE_LANE_SPECIALS,
]);
export const specialPieceName = (type) =>
  ALL_SPECIAL_PIECES.find(([id]) => id === type)?.[1] ?? '';

export const specialKind = (type) =>
  type === 'hairpin' || type === 'duel' ? 'curve' : 'straight';

// rules: the pack's design rules, when the piece is made from a pack.
export function specialDefaults(type, p, rules) {
  switch (type) {
    case 'turnout':
      return turnoutDefaults(p, rules);
    case 'hairpin':
      return { type, crossingAt: 0.25, isolation: 2 };
    case 'pit':
      return {
        type,
        side: 'left',
        pitOffset: Math.max(40, p.laneSpacing),
        pitWhiteLine: false,
        pitCrossingStyle: 'solid',
        turnoutPosition: 'main',
        ...PIT_CONTACT_DEFAULTS,
        ...PIT_MOTOR_DEFAULTS,
      };
    case 'diamond':
      return { type, crossingAngle: 90, isolation: 1.5 };
    case 'duel':
      return { type, apex: 0.62 };
    case 'chicane':
      return {
        type,
        offset: 150,
        entryRadius: Math.max(280, 1.4 * p.width),
        exitRadius: Math.max(330, 1.65 * p.width),
        hand: 'left',
      };
    case 'timing':
      return { type, detector: 'optical', sensorSize: 3.2, stripLength: 38 };
    default:
      throw Error('Choose an available special track piece.');
  }
}

export function specialTrackParams(type, base, rules) {
  const p = {
    ...base,
    kind: specialKind(type),
    special: specialDefaults(type, base, rules),
    segments: 1,
    borderSegments: 1,
  };
  delete p.laneAdjustment;
  // The pack's plain straight may carry its slot off-centre. A special lays
  // out its own lanes about the road centre, so road connectors placed by
  // hand beside that slot do not carry over: the special gets standard rows.
  if (p.slotPosition && p.placements) {
    const placements = Object.fromEntries(
      Object.entries(p.placements).filter(([key]) => !/^(start|seam|finish)(Tabs|Clips)$/.test(key)),
    );
    if (Object.keys(placements).length) p.placements = placements;
    else delete p.placements;
  }
  delete p.slotPosition;
  delete p.startingGrid;
  delete p.curveGridRadius;
  if (type === 'hairpin' || type === 'duel') {
    p.radius = Math.max(type === 'hairpin' ? 330 : 460, 1.65 * p.width);
    p.angle = type === 'hairpin' ? 180 : 112;
  } else if (type === 'chicane') p.length = Math.max(1200, 5 * p.width);
  else if (type === 'pit') p.length = Math.max(600, 3 * p.width);
  else if (type === 'diamond') p.length = Math.max(440, 2.2 * p.width);
  else if (type === 'turnout') {
    // A turnout is a bare road for now: no borders, barriers or road markings,
    // and no extra braid openings of its own.
    Object.assign(p, {
      borderSide: 'none',
      tracksideSide: 'none',
      whiteLineRoad: 'none',
      whiteLineBorder: 'none',
      roadCentreLine: 'none',
      roadKerbSide: 'none',
      kerbEdge: 'none',
      braidFeedSide: 'none',
    });
    delete p.borderEnds;
    const shape = turnoutDefaultShape(p, base.kind === 'straight' && !base.special ? base.length : undefined, rules);
    p.length = shape.length;
    p.special = { ...p.special, turnoutAngle: shape.turnoutAngle };
  } else p.length = Math.max(200, p.width);
  return p;
}

export function validateSpecialType(p) {
  if (p.special === undefined) return;
  if (!p.special || !ALL_SPECIAL_PIECES.some(([id]) => id === p.special.type))
    throw Error('This track contains an unknown special piece.');
  if (p.kind !== specialKind(p.special.type))
    throw Error('The stored road geometry does not match this special piece.');
  if (p.special.type === 'pit' && p.special.turnoutPosition !== undefined &&
      !['main', 'pit'].includes(p.special.turnoutPosition))
    throw Error('Choose Main lane or Pit lane for the flipper position.');
  if (p.special.type === 'turnout' && p.special.turnoutPosition !== undefined &&
      !['main', 'pit'].includes(p.special.turnoutPosition))
    throw Error('Choose Straight on or Branch for the blade position.');
  if (p.laneAdjustment)
    throw Error(
      'Special pieces define their own lanes. Use the template controls to change their layout.',
    );
  if (hasSlotPosition(p))
    throw Error('Special pieces define their own lanes. Set Slot position to Centred.');
}

export function specialPreview(p) {
  if (isRacingPiece(p)) return racingPlan(p);
  if (p.special.type === 'timing') return timingPlan(p);
  const plan = specialJunctionPlan(p);
  return {
    outlines: plan.outlinePaths,
    borders: plan.borderPaths,
    lanes: plan.lanePaths,
    details: plan.detailPaths,
    conductors: plan.conductors,
    jumpers: plan.jumpers,
    turnouts: plan.turnouts,
    pitWhiteLines: plan.pitWhiteLines,
    pitWhiteLineGrooves: plan.pitWhiteLineGrooves,
    pitGrid: p.special.type === 'pit' && p.special.pitGrid ? pitGridLayout(p) : undefined,
  };
}

export function specialAssemblyNotes(p) {
  switch (p.special.type) {
    case 'diamond':
    case 'hairpin':
      return [
        'Follow each guide slot through the crossing. Stop the braid at every insulating land and reconnect matching ends of the same conductor underneath with insulated wire.',
        ...(p.special.type === 'hairpin' && p.braidWidth > 0
          ? [
              'Use wire up to ' +
                hairpinWireProfile(p).maxDiameter +
                ' mm in outside diameter including insulation. Fit the lane 1 jumpers in the deep grooves first, then the lane 2 jumpers above them. Seat both below the table-facing surface.',
            ]
          : []),
        ...(p.special.type === 'diamond' && p.braidWidth > 0
          ? [
              'The underside channels accommodate two crossing leads of up to ' +
                diamondJumperSize(p).wireOD +
                ' mm outside diameter each, including insulation. Fit the P road’s leads first, then the Q road’s leads, keeping both below the table-facing surface.',
            ]
          : []),
        'With power disconnected, check continuity along each conductor and isolation between the two sides of every slot and between controller circuits. Try the test STL with your widest pickups and longest guide before printing the whole piece.',
      ];
    case 'pit': {
      const { screwMin, screwMax } = pitActuatorSpec(p);
      return [
        'Print one pivot bearing per flipper with its broad flat face on the bed and the oblong peg pointing up. From the road side, dry-fit the peg in its matching socket. The shoulder must sit flat. Apply a small amount of adhesive to the peg only, seat it and let it cure with the bore clear.',
        'Tap the blind pilot under the blade for an M2 × 0.4 screw. Lower the blade into its seat halfway between routes. From underneath, slide the crank’s integral 4 mm pivot pin through the bearing and align its D-shaped tip with the blade socket.',
        `At the keyed pivot, fit one M2 90° countersunk retaining screw, ${screwMin}–${screwMax} mm long including the head, from below. Seat the head flush with the crank. The screw, crank and blade turn together. Check that the crown sits level with the road and moves freely between both stops.`,
        ...(p.special.motorMount ? [
          'Tap the two underside cradle bosses for M2 × 0.4 screws. Seat the rectangular motor in its tray with the plunger facing the crank. Shim any end play so the case stays against the front stops through reversal. Fit the tray using two M2 × 4 mm 90° countersunk screws through its adjustment slots.',
          'Form the pushrod to meet the motor shaft on one end and the crank eye on the other. Move the motor through its usable stroke by hand. Slide the tray until the blade reaches both seats, then tighten both tray screws with their heads flush. Check both routes again with the piece on the table.',
        ] : [
          'Fit a bent pushrod into the crank eye and run it through the recessed channel towards the pit-side edge. Adjust the linkage so the nose seats at both ends of its travel without loading the stops. The print kit lists the eye and retainer dimensions, the travel between stops and the retaining screw length at the pivot.',
        ]),
        'With the track flat on the table, switch between Main lane and Pit lane. Roll a car through each route by hand and check that its guide passes the nose and heel freely.',
        ...(p.braidWidth > 0 ? [
          p.special.pitContactMode === 'braid'
            ? 'Leave a tail at both ends of each island braid. Fold each tail down through its slot and back under the island. Lay the outer braids continuously around the fork and merge. At each round hole, solder a jumper to the underside of the continuous braid and pass the wire through the hole. Follow the dashed path on the conductor map to the matching island tail and solder the connection.'
            : 'Lay the two outer braids continuously around the fork and merge. Trim each island-facing braid to its shelf. At each ring on the conductor map, solder a wire to the underside of the braid and feed the wire through the hole.',
          'Seat each connection in its underside recess, clear of the table. Connect L to L and R to R for the same driver. Each mirrored pit uses its own driver’s feed.',
          'Keep braid clear of the blade throughout its travel. With the controllers disconnected, check continuity on both routes and isolation between opposite conductors.',
        ] : []),
      ];
    }
    case 'turnout': {
      const { turnoutMode: mode, pitContactMode } = turnoutSettings(p.special);
      const { screwMin, screwMax, armBottom } = pitActuatorSpec(p);
      // The stout crank of the slider drive starts lower, so its screw is longer.
      const drop = Math.max(0, armBottom - TURNOUT_DRIVE.armBottom);
      const crankScrew = Number((screwMin + drop).toFixed(1)) + '–' + Number((screwMax + drop).toFixed(1));
      const kinds = {
        digital: 'Digital: a moving blade, worked by a slider and a push-pull motor under the road between the two slots.',
        manual: 'Hand-set point: the same moving blade, set by hand. It clicks into either position.',
        analog: 'Analog: no moving parts. Both slots stay open, with a fixed nose between them.',
        closed: 'Closed: the branch slot is filled in, level with the road. Cars can only go straight on.',
      };
      const others = Object.entries(kinds).filter(([id]) => id !== mode).map(([, text]) => text);
      return [
        `The area around the split is a separate insert. This one is ${turnoutModeName(mode)}. The road is the same for every insert, so you can print another insert later and swap it.`,
        kinds[mode] + ' The other inserts: ' + others.join(' '),
        'Print the insert with its flat underside on the bed. Tap the two pilot holes under the road for M2 × 0.4 screws.',
        `Turn the road over. Lower the insert into its pocket from below until it sits against the roof of the pocket and its two lugs are in their recesses. Fit two M2 × ${TURNOUT_INSERT.screwLength} mm 90° countersunk screws through the lugs, with their heads flush. To change the insert, take out the two screws. The braid stays where it is.`,
        ...(turnoutHasBlade(mode) ? [
          'Print the pivot bearing with its broad flat face on the bed and the oblong peg pointing up. Dry-fit the peg in its socket in the insert. The shoulder must sit flat. Put a little adhesive on the peg only, seat it and let it cure with the bore clear.',
          'Tap the blind pilot under the blade for an M2 × 0.4 screw. Fit the blade before the insert goes into the road: lower it into its seat halfway between its two positions.',
          ...(mode === 'digital' ? [
            'Print the slider upside down, with its flat face on the bed. Print the crank with its arm on the bed and its two pins pointing up. Print the motor cradle flat. None of them needs support.',
            'Screw the insert into the road first. Then lay the slider in its channel between the two slots, flat face towards the road. It goes in after the insert and comes out again without removing it.',
          ] : []),
          mode === 'digital'
            ? `From below, slide the crank’s pivot pin through the bearing and line up its D-shaped tip with the socket in the blade. Its other pin goes up into the slot of the slider, and its arm then holds the slider in. Fit one M2 90° countersunk screw, ${crankScrew} mm long including the head, with its head flush with the crank.`
            : `From below, slide the pivot pin through the bearing and line up its D-shaped tip with the socket in the blade. Fit one M2 90° countersunk screw, ${screwMin}–${screwMax} mm long including the head, with its head flush with the pin.`,
          ...(mode === 'digital' ? [
            'Push a straight pin that fits the eye of the plunger into the hole under the end of the slider, with a drop of glue. No wire has to be bent. Tap the two pilot holes behind the motor cavity for M2 × 0.4 screws.',
            'Seat the motor in its cradle with the plunger towards the slider and hook the eye of the plunger over the pin. Fit the cradle with two M2 × 4 mm 90° countersunk screws through its slots. Move the slider by hand: on the flat at each end of its slot the blade must rest against its stop. Slide the cradle until the motor reaches both ends, then tighten the screws. The leads drop through the notch behind the motor; drill a hole in the baseboard for them.',
          ] : []),
          mode === 'digital'
            ? 'With the piece on the table, move the slider between Straight on and Branch. The blade must reach both stops freely and its crown must sit level with the road.'
            : 'With the insert screwed in, push the blade across by its crown. It rides over a low ridge in the slot floor and stays on either side. Its crown must sit level with the road.',
        ] : []),
        ...(p.braidWidth > 0 ? [
          'Lay the two outside braids in one piece past the split. The two braids between the slots start behind the insert. ' +
            (pitContactMode === 'braid'
              ? 'Leave a tail on each of them, fold it down through its slot and back under the road.'
              : 'Trim each of them to its shelf.') +
            ' At each ring on the conductor map, solder a wire under the braid and pass it through the hole. Follow the dashed line to join each inside braid to the outside braid of the other slot: left to left and right to right.',
          'Seat the wires in their recesses under the road, clear of the table. With the controller disconnected, check continuity along both routes and isolation between the left and right braids.',
        ] : []),
      ];
    }
    case 'timing':
      return p.special.detector === 'strip'
        ? [
            'Fit a short metal sensing strip on each side of each guide. Fold the ends down beside the insulating lands. Connect the isolated pair to its lane’s compatible dead-strip timing input.',
            'Join the incoming and outgoing running braids of matching polarity underneath the piece, separately from the sensing pair. Route insulated wires through the recessed exits.',
          ]
        : [
            'Install a facing side-looking infrared emitter and receiver in each lane’s underside pockets. Align their optical centres with the windows in the guide slot. The running braids stay continuous.',
            'Route the leads in the recessed cable channels and connect each gate to its compatible lap timer. Sensors, wiring and timer are separate hardware.',
          ];
    default:
      return [
        'Lay continuous braid along each side of each guide slot. Match the same conductors at every print seam.',
      ];
  }
}
