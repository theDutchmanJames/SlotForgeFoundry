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

export const SPECIAL_PIECES = Object.freeze([
  ['hairpin', 'Double-crossover hairpin'],
  ['pit', 'Single-lane pit'],
  ['diamond', 'Flat diamond crossing'],
  ['duel', 'Late-apex duel'],
  ['chicane', 'Bus-stop chicane'],
  ['timing', 'Timing straight'],
]);

export const specialKind = (type) =>
  type === 'hairpin' || type === 'duel' ? 'curve' : 'straight';

export function specialDefaults(type, p) {
  switch (type) {
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

export function specialTrackParams(type, base) {
  const p = {
    ...base,
    kind: specialKind(type),
    special: specialDefaults(type, base),
    segments: 1,
    borderSegments: 1,
  };
  delete p.laneAdjustment;
  delete p.startingGrid;
  delete p.curveGridRadius;
  if (type === 'hairpin' || type === 'duel') {
    p.radius = Math.max(type === 'hairpin' ? 330 : 460, 1.65 * p.width);
    p.angle = type === 'hairpin' ? 180 : 112;
  } else if (type === 'chicane') p.length = Math.max(1200, 5 * p.width);
  else if (type === 'pit') p.length = Math.max(600, 3 * p.width);
  else if (type === 'diamond') p.length = Math.max(440, 2.2 * p.width);
  else p.length = Math.max(200, p.width);
  return p;
}

export function validateSpecialType(p) {
  if (p.special === undefined) return;
  if (!p.special || !SPECIAL_PIECES.some(([id]) => id === p.special.type))
    throw Error('This track contains an unknown special piece.');
  if (p.kind !== specialKind(p.special.type))
    throw Error('The stored road geometry does not match this special piece.');
  if (p.special.type === 'pit' && p.special.turnoutPosition !== undefined &&
      !['main', 'pit'].includes(p.special.turnoutPosition))
    throw Error('Choose Main lane or Pit lane for the flipper position.');
  if (p.laneAdjustment)
    throw Error(
      'Special pieces define their own lanes. Use the template controls to change their layout.',
    );
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
