export const motorMountFit = Object.freeze({
  tableClearance: 0.30, trayThickness: 1.35, topClearance: 0.20, adjustment: 1.5,
});

const trayTop = motorMountFit.tableClearance + motorMountFit.trayThickness;
const bodyGap = 0.15, lip = 1.2, travelGap = 0.2, rim = 1.1;
const earHalfLength = 4.5;
// The pilot holes in the road for a cradle's screws rise this far above it.
const screwPilotHeight = 3.05;

export function maxPitMotorHeight(p) {
  return p.height - Math.max(2, p.deck) - trayTop - motorMountFit.topClearance;
}

// The cradle of a motor that lies in line with the slider it drives: its two
// screws sit one behind the other on a tab behind the motor. Local frame: the motor's
// centre at the origin, its plunger pointing towards -X, heights from the table.
export function inlineMotorTrayPlan(settings) {
  const { motorLength, motorWidth, motorHeight } = settings;
  const adjust = motorMountFit.adjustment;
  const l = motorLength / 2 + bodyGap + lip, w = motorWidth / 2 + bodyGap + lip;
  const tabHalf = Math.max(w, 3.3);
  const screws = [l + earHalfLength, l + earHalfLength + 7.5];
  const tabEnd = screws[1] + earHalfLength;
  const reach = adjust + travelGap;
  return {
    l, w, tabHalf, tabEnd, screws, lip, rim, adjust,
    trayTop,
    // How far the pilot holes for the cradle's two screws rise into the road.
    pilotHeight: screwPilotHeight,
    bodyTop: trayTop + motorHeight,
    cavityTop: trayTop + motorHeight + motorMountFit.topClearance,
    shaftZ: trayTop + motorHeight / 2,
    // The motor's front face, and how far the cradle reaches in front of it.
    front: -motorLength / 2,
    frontReach: bodyGap + lip + reach,
    // Openings in the road, with room to slide the cradle along its slots.
    chamber: { x0: -l - reach, x1: l + reach, half: w + travelGap },
    slide: { x0: -l - reach, x1: tabEnd + reach, half: tabHalf + travelGap },
  };
}

export function inlineMotorTray(work, settings) {
  const plan = inlineMotorTrayPlan(settings);
  const { l, w, tabHalf, tabEnd, screws } = plan;
  const { motorWidth, motorHeight, motorLength } = settings;
  const box = (x0, x1, y0, y1) => work.section([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);
  const base = work.own(work.wasm.CrossSection.union([box(-l, l, -w, w), box(l - 0.01, tabEnd, -tabHalf, tabHalf)]));
  const tray = work.prism(base, motorMountFit.tableClearance, trayTop);
  const lips = [];
  const lipTop = trayTop + Math.min(2.4, motorHeight - 0.35);
  for (const hand of [-1, 1]) {
    const outer = hand * w, inner = hand * (w - lip);
    lips.push(work.prism(box(-l, l, Math.min(outer, inner), Math.max(outer, inner)), trayTop, lipTop));
    const edgeTip = hand * (motorWidth / 2 - Math.min(1.2, motorWidth / 4));
    for (const [a, b] of [[-l, -l + lip], [l - lip, l]])
      lips.push(work.prism(box(a, b, Math.min(outer, edgeTip), Math.max(outer, edgeTip)), trayTop, lipTop));
  }
  const slot = (x, z, depth, lower, upper) => {
    const shape = work.own(work.wasm.Manifold.cylinder(depth, lower, upper, 40));
    return work.own(work.wasm.Manifold.hull(
      [-plan.adjust, plan.adjust].map(d => work.own(shape.translate([x + d, 0, z])))));
  };
  const bores = screws.flatMap(x => [
    slot(x, -0.01, trayTop + 0.1, 1.1, 1.1),
    slot(x, motorMountFit.tableClearance, 0.95, 2.05, 1.1),
  ]);
  // The leads drop through this notch behind the motor.
  const wireHalf = Math.min(1.5, motorWidth / 3);
  const notch = box(motorLength / 2 - 0.2, l + 0.1, -wireHalf, wireHalf);
  const solid = work.cut(work.union([tray, ...lips]), [...bores, work.prism(notch, 0, trayTop + 0.01)]);
  return { plan, solid };
}
