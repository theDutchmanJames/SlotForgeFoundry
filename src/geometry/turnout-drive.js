// The drive of a turnout's Digital insert: a cam slider and a push-pull motor.
//
// Everything lies in the island, the wedge of road between the main slot and
// the branch slot, where no guide slot is cut and the full height under the
// deck is free. Nothing passes under a slot or under a braid.
//
//   - The crank on the blade's pivot ends in an upright PIN.
//   - The SLIDER is a bar that moves in a straight line parallel to the main
//     slot. Its head has a CAM SLOT: a flat stretch, a slanted stretch and a
//     flat stretch. The pin stands in that slot. Moving the bar by the motor's
//     stroke carries the pin sideways from one blade position to the other;
//     on the flats the bar holds the pin where it is.
//   - The MOTOR lies further along the island, in line with the bar, and
//     pushes and pulls it. The bar reaches over the plunger with a tongue that
//     carries a straight pin for the plunger's eye. No wire has to be bent.
//
// This file is plain arithmetic in a frame where the branch always turns
// towards +Y; turnout-piece.js mirrors it for a right-hand turnout.
import { braidSpan } from './solids.js';
import { measuredLane } from './import-track.js';
import { pitActuatorSpec } from './pit-turnout.js';
import { PIT_MOTOR_LIMITS, pitMotorSettings } from './pit-motor-settings.js';
import { inlineMotorTrayPlan } from './pit-motor-mount.js';
import { pitBraidLandingShift, xStation } from './pit-braids.js';

export const TURNOUT_DRIVE = Object.freeze({
  strokeLimits: [2, 12],
  playLimits: [0.05, 0.6],
  stroke: 6,
  play: 0.2,
  pinRadius: 1.5, // the crank pin
  barWidth: 4,
  sideGap: 0.3, // slider to channel, each side
  topGap: 0.4, // slider to the roof of its channel
  tableGap: 0.3, // slider to the table
  headWall: 2, // slider left beside the cam slot
  endWall: 2, // slider left beyond each end of the cam slot
  minFlat: 0.3, // shortest flat at each end of the cam slot
  maxSlant: 5.4, // the slant stops growing here; longer strokes get longer flats
  guide: 10, // shortest plain bar between the head and the motor
  neck: 4, // length of the step from the head up to the bar
  slotWall: 2.5, // road or insert left between a guide slot and the drive, where the island allows
  armBottom: 0.4, // the crank arm starts this far above the table
  armThickness: 4, // and is this thick beyond the pivot bearing, where the track allows
  waistRadius: [1.5, 2.3], // half the arm's width where it passes between the slots behind the blade
  minSlotWall: 2, // least wall beside the arm there, once the arm is at its narrowest
  armGap: 0.4, // crank arm to the wall of its bay, each side
  braidWeb: 0.5, // road left between a braid recess and the drive
  minHeight: 3, // least solid height of the slider
  minTongue: 1.5,
  maxCrank: 60,
  roof: 2, // road left above the slider and the motor
});

/** The motor of a turnout: the pit lane's fields, with the turnout's stroke and play. */
export function turnoutMotor(special) {
  return {
    ...pitMotorSettings(special),
    motorStroke: special.motorStroke ?? TURNOUT_DRIVE.stroke,
    play: special.turnoutPlay ?? TURNOUT_DRIVE.play,
  };
}

const inRange = (value, [min, max]) => Number.isFinite(value) && value >= min && value <= max;
const tidy = (value) => Number(value.toFixed(1));
const labels = {
  motorLength: 'Body length',
  motorWidth: 'Body width',
  motorHeight: 'Body height',
  plungerProjection: 'Retracted plunger reach',
  eyeDiameter: 'Plunger eye diameter',
};

export function validateTurnoutDrive(special) {
  const m = turnoutMotor(special);
  const [minStroke, maxStroke] = TURNOUT_DRIVE.strokeLimits;
  if (!inRange(m.motorStroke, TURNOUT_DRIVE.strokeLimits))
    throw Error(
      'Usable stroke must be between ' + minStroke + ' and ' + maxStroke +
        ' mm for the slider. Set it to the travel of your motor.',
    );
  if (!inRange(m.play, TURNOUT_DRIVE.playLimits))
    throw Error(
      'Pin play must be between ' + TURNOUT_DRIVE.playLimits[0] + ' and ' +
        TURNOUT_DRIVE.playLimits[1] + ' mm.',
    );
  for (const [key, name] of Object.entries(labels))
    if (!inRange(m[key], PIT_MOTOR_LIMITS[key]))
      throw Error(
        name + ' must be between ' + PIT_MOTOR_LIMITS[key][0] + ' and ' +
          PIT_MOTOR_LIMITS[key][1] + ' mm.',
      );
}

/**
 * The cam for a stroke and the sideways travel of the pin. The slant takes
 * the stroke less a short flat at each end. From about 6 mm of stroke the
 * slant keeps its length and the flats grow, so a longer stroke still stops
 * the blade in the same two places.
 */
export function turnoutCam(stroke, travel) {
  const slant = Math.min(stroke - 2 * TURNOUT_DRIVE.minFlat, TURNOUT_DRIVE.maxSlant);
  return {
    slant,
    flat: (stroke - slant) / 2,
    // The angle between the slant and the direction the bar moves in.
    angle: (Math.atan2(travel, slant) * 180) / Math.PI,
  };
}

const NARROW =
  'The island between the two slots is too narrow for the slider and its motor. Use a shorter Usable stroke, a narrower motor or a smaller Branch radius.';

// frame.words replaces the refusals that name a turnout's own settings, and
// frame.roadHalf is how far the road reaches from the main slot towards the
// branch: a pit lane has its own of both.
export function turnoutDriveLayout(p, { sign, fork, cutLanes, ends }, frame = {}) {
  const D = TURNOUT_DRIVE;
  const words = { narrow: NARROW, ...frame.words },
    roadHalf = frame.roadHalf ?? p.width / 2;
  const m = turnoutMotor(p.special),
    S = m.motorStroke;
  const tray = inlineMotorTrayPlan(m);
  const pivot = pitActuatorSpec(p);
  const H = p.height;

  // Heights. The slider rides just above the table and is as tall as the
  // road allows. Its head is relieved below so the crank arm passes under it.
  const channelTop = Math.min(H - Math.max(D.roof, p.deck), H - p.braidDepth - 0.8);
  const zBottom = D.tableGap,
    zTop = channelTop - D.topGap;
  // The crank arm takes what is left under the slider's head, up to 4 mm.
  let armTop = Math.max(
    pivot.armTop,
    Math.min(D.armBottom + D.armThickness, zTop - D.minHeight - pivot.armTopClearance),
  );
  // Where a 3 mm arm fits wholly below the floors of the guide slots, keep it
  // there: its bay then cuts no slot wall and the arm can keep its full width.
  const underFloors = H - p.slotDepth - 0.6 - pivot.armTopClearance;
  if (underFloors - D.armBottom >= 3) armTop = Math.min(armTop, underFloors);
  const headBottom = armTop + pivot.armTopClearance;
  if (zTop - headBottom < D.minHeight)
    throw Error(
      'The track is too low for the slider. Set Track height to at least ' +
        tidy(H + D.minHeight - (zTop - headBottom)) + ' mm.',
    );
  if (tray.cavityTop > channelTop + 1e-9)
    throw Error(
      'This track takes a motor up to ' +
        Math.floor((channelTop - tray.trayTop - (tray.cavityTop - tray.bodyTop)) * 100) / 100 +
        ' mm high. Reduce Body height or increase Track height.',
    );
  const eyeRadius = m.eyeDiameter / 2;
  const tongueBottom = tray.shaftZ + Math.max(eyeRadius + 0.8, 1.2);
  if (zTop - tongueBottom < D.minTongue)
    throw Error(
      'The motor shaft sits too high for the slider to reach over the plunger. Reduce Body height or increase Track height.',
    );
  const tipWall = eyeRadius + 0.7;
  if (m.plungerProjection < tipWall + 0.3 - 1e-9)
    throw Error(
      'Retracted plunger reach must be at least ' + tidy(tipWall + 0.3) +
        ' mm, so the end of the slider clears the motor.',
    );

  // Across the island. `edge` is how close the drive may come to the centre
  // of a slot where a braid lies beside it; `wall` where there is none yet.
  const half = p.slotWidth / 2;
  const span = braidSpan(p);
  const edge = half + Math.max(D.slotWall, span ? span + pitBraidLandingShift(p) + D.braidWeb : 0);
  const wall = half + D.slotWall + 0.5; // the handoff reliefs widen the slot by 0.5
  const branch = measuredLane(cutLanes[1]);
  const lastX = ends.branch.point[0];
  // The island-side limit set by the branch slot at this X.
  const upper = (x, offset) =>
    sign * branch.atOffset(xStation(branch, -sign * offset, x), -sign * offset)[1];
  // The first X where the island is free up to this height.
  function reachX(y, offset) {
    if (upper(lastX, offset) < y) return Infinity;
    let lo = fork.mainToe[0],
      hi = lastX;
    for (let n = 0; n < 40; n++) {
      const x = (lo + hi) / 2;
      if (upper(x, offset) >= y) hi = x;
      else lo = x;
    }
    return hi;
  }

  // The crank. Its pin stands a third of the blade's length from the pivot,
  // or further where the island needs that to take the head of the slider.
  const heel = [fork.heel[0], sign * fork.heel[1]];
  const swing = Math.abs(fork.swing);
  const slotHalf = D.pinRadius + m.play / 2;
  const endReach = slotHalf + D.endWall;
  const tailEnd = fork.guardEndX - 15; // behind the tail of the blade
  // The head lies beside the main slot, in front of where the inside braids
  // start. The bar and the motor share one axis further from the slot, as
  // near to it as the motor's cavity can lie beside the braid. A short neck
  // steps from the head up to the bar.
  const yLow = wall + D.sideGap;
  const barHalf = D.barWidth / 2;
  let radius = Math.max(14, (heel[0] - fork.mainToe[0]) / 3);
  let phase = 0,
    pinY = 0,
    pinX = 0,
    axis = 0,
    slotTop = 0,
    neckTop = 0,
    travel = 0;
  for (let i = 0; i < 12; i++) {
    travel = 2 * radius * Math.sin(swing / 2);
    for (let n = 0; n < 4; n++) {
      pinY = Math.max(heel[1], yLow + D.headWall + slotHalf + (travel * Math.cos(phase)) / 2);
      if ((pinY - heel[1]) / radius > 0.7) radius = (pinY - heel[1]) / 0.7;
      phase = Math.asin(Math.max(-0.7, Math.min(0.7, (pinY - heel[1]) / radius)));
    }
    pinX = heel[0] + radius * Math.cos(phase);
    axis = Math.max(yLow + barHalf, edge + tray.chamber.half, edge + tray.slide.half);
    slotTop = pinY + (travel * Math.cos(phase)) / 2 + slotHalf + D.headWall;
    neckTop = Math.max(slotTop, axis + barHalf);
    // The head has to clear the branch slot where it starts, the neck where
    // it starts, and both have to stay behind the tail of the blade.
    const need = Math.max(
      Math.max(reachX(slotTop + D.sideGap, wall), tailEnd + 1.2) + S + endReach + D.sideGap,
      reachX(neckTop + D.sideGap, wall) + D.neck + D.sideGap - endReach,
    );
    if (pinX >= need - 1e-6) break;
    radius = (need - heel[0]) / Math.cos(phase) + 0.01;
    if (!(radius <= D.maxCrank)) break;
  }
  if (!(radius <= D.maxCrank)) throw Error(words.narrow);

  const cam = turnoutCam(S, travel);
  // Behind the tail of the blade the island is at its narrowest for the arm.
  // It passes midway between the two slots there, at its narrowest. Where the
  // slot floors lie above the arm's bay there is no wall to keep, and the arm
  // stays at its full width.
  const waistX = tailEnd + 0.6,
    waistTop = upper(waistX, half + 0.5);
  let waist;
  if (H - p.slotDepth < armTop + pivot.armTopClearance + 0.6) {
    // Half the island there, less the play of the bay and the arm's swing:
    // what is left for half the arm and the wall beside it.
    const room = (waistTop - half - 0.5) / 2 - D.armGap - ((waistX - heel[0]) * swing) / 2 - 0.12;
    // As wide as leaves each slot its full wall, and never thinner than the
    // pin. A narrow island then takes the difference out of the walls.
    const waistRadius = Math.max(D.waistRadius[0], Math.min(D.waistRadius[1], room - D.slotWall));
    if (room - waistRadius < D.minSlotWall - 1e-6)
      throw Error(
        words.waist ??
          'The island between the two slots is too narrow behind the blade for the crank arm and a ' +
            D.minSlotWall + ' mm wall beside each slot. Use a smaller Branch radius.',
      );
    waist = {
      point: [waistX, (half + 0.5 + waistTop) / 2 - 0.05],
      radius: waistRadius,
      // The wall this leaves between the arm's bay and each slot.
      wall: room - waistRadius,
    };
  }
  // The pin at u = 0 (straight on) to u = 1 (branch).
  const pinAt = (u) => {
    const a = phase + (u - 0.5) * swing;
    return [heel[0] + radius * Math.cos(a), heel[1] + radius * Math.sin(a)];
  };
  // The centre line of the cam slot, in the slider at its straight-on end.
  // Moving the slider by d puts the point for d under the pin.
  const camLine = [];
  const mark = (d, u) => {
    const q = pinAt(u);
    camLine.push([q[0] - d, q[1]]);
  };
  mark(0, 0);
  mark(cam.flat, 0);
  for (let k = 1; k < 8; k++) mark(cam.flat + (cam.slant * k) / 8, k / 8);
  mark(S - cam.flat, 1);
  mark(S, 1);

  // Along the island: head, plain bar, tongue over the plunger, motor.
  const halfMotor = Math.max(tray.chamber.half, tray.slide.half);
  const front = Math.max(
    pinX + S + endReach + D.guide + Math.max(m.plungerProjection + eyeRadius + 1.5, tray.frontReach + 0.3),
    reachX(axis + halfMotor, edge) + tray.frontReach,
  );
  if (!Number.isFinite(front)) throw Error(words.narrow);
  const centre = front + m.motorLength / 2;
  const end = centre + tray.slide.x1 + tray.rim;
  if (axis + halfMotor + tray.rim > roadHalf)
    throw Error(
      'The road is too narrow for the motor between the two slots. Use a narrower motor or a road at least ' +
        Math.ceil(2 * (axis + halfMotor + tray.rim)) + ' mm wide.',
    );
  if (end > lastX - 4)
    throw Error(
      words.branchEnds ?? 'The branch ends before the motor does. Increase Branch angle, or use a shorter motor or stroke.',
    );
  if (end > p.length / 2 - 6)
    throw Error(
      'The motor reaches the far end of the main road. Set Main road length to at least ' +
        Math.ceil(p.length + 2 * (end - (p.length / 2 - 6))) + ' mm.',
    );
  const xs = camLine.map((q) => q[0]);
  const head = {
    x0: Math.min(...xs) - endReach,
    x1: Math.max(...xs) + endReach,
    y0: yLow,
    y1: slotTop,
  };
  const neck = { x0: head.x1 - D.neck, x1: head.x1, y0: yLow, y1: neckTop };
  const pinHoleX = front - m.plungerProjection - S;
  const barEnd = Math.min(pinHoleX - eyeRadius - 1.5, front - tray.frontReach - 0.3 - S);
  const tongue = { x0: barEnd, x1: pinHoleX + tipWall, z0: tongueBottom };
  const g = D.sideGap;
  // The inside braid of the branch slot starts where the drive leaves it room.
  const stripStart = span
    ? Math.max(
        Math.min(head.x1 + S + g, reachX(neckTop + g, edge)),
        Math.min(front - tray.frontReach, reachX(axis + barHalf + g, edge)),
      )
    : -Infinity;
  // The inside braid of the main slot starts behind the head, which lies
  // closer to that slot than a braid would allow.
  const mainStripStart = span && yLow - g < edge ? head.x1 + S + g : -Infinity;
  return {
    motor: m,
    tray,
    stroke: S,
    play: m.play,
    cam,
    travel,
    crank: {
      radius, phase, pinRadius: D.pinRadius, pinTop: zTop - 0.2, armBottom: D.armBottom, armTop,
      waist,
      sideClearance: D.armGap,
    },
    pinAt,
    camLine,
    slotHalf,
    head,
    neck,
    axis,
    bar: { x0: head.x1, x1: barEnd, y0: axis - barHalf, y1: axis + barHalf },
    tongue,
    pinHole: { x: pinHoleX, y: axis, radius: eyeRadius, depth: Math.min(2, zTop - tongueBottom - 0.6) },
    z: { bottom: zBottom, top: zTop, headBottom, armBottom: D.armBottom, armTop, channelTop, cavityTop: tray.cavityTop, shaftZ: tray.shaftZ },
    motorFront: front,
    motorCentre: centre,
    // Openings in the road, as [x0, y0, x1, y1], for both ends of the stroke.
    channels: [
      [head.x0 - g, head.y0 - g, head.x1 + S + g, head.y1 + g],
      [neck.x0 - g, neck.y0 - g, neck.x1 + S + g, neck.y1 + g],
      [head.x1, axis - barHalf - g, front, axis + barHalf + g],
    ],
    chamber: [centre + tray.chamber.x0, axis - tray.chamber.half, centre + tray.chamber.x1, axis + tray.chamber.half],
    slide: [centre + tray.slide.x0, axis - tray.slide.half, centre + tray.slide.x1, axis + tray.slide.half],
    screws: tray.screws.map((x) => [centre + x, axis]),
    // How far the crank and its pin reach along the road; the insert covers them.
    pinReach: pinX + D.pinRadius + 0.8 + 0.9,
    stripStart,
    mainStripStart,
    start: head.x0 - g,
    end,
    // The narrowest island the drive needs: under the head, and under the motor.
    islandAtHead: slotTop + g + wall,
    islandAtMotor: axis + halfMotor + edge,
  };
}
