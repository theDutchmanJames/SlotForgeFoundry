import { pitActuatorSpec } from './pit-turnout.js';
import { pitMotorSettings } from './pit-motor-settings.js';
import { pitHardwareObstruction } from './pit-border-linkage.js';

export const motorMountFit = Object.freeze({
  tableClearance: 0.30, trayThickness: 1.35, topClearance: 0.20, adjustment: 1.5,
});

const trayTop = motorMountFit.tableClearance + motorMountFit.trayThickness;
const bodyGap = 0.15, lip = 1.2, travelGap = 0.2, rim = 1.1;
const earReach = 5.6, earHalfLength = 4.5;

export function maxPitMotorHeight(p) {
  return p.height - Math.max(2, p.deck) - trayTop - motorMountFit.topClearance;
}

// Get the extrema of the actual piecewise-linear branch across a footprint,
// including knots inside it. Its road edge follows the same lateral offset.
function shoulderRange(branch, sign, x, halfWidth) {
  const left = x - halfWidth, right = x + halfWidth;
  let low = Infinity, high = -Infinity, steepest = 0;
  for (let i = 1; i < branch.length; i++) {
    const [a, b] = [branch[i - 1], branch[i]];
    if (a[0] >= right || b[0] <= left) continue;
    const slope = (b[1] - a[1]) / (b[0] - a[0]);
    for (const u of [Math.max(left, a[0]), Math.min(right, b[0])]) {
      const v = sign * (a[1] + slope * (u - a[0]));
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
    steepest = Math.max(steepest, Math.abs(slope));
  }
  if (left < branch[0][0] || right > branch.at(-1)[0] || !Number.isFinite(high))
    throw Error('The motor mount extends beyond the pit approach. Reduce motor width or stroke, or lengthen the pit.');
  return { low, high, steepest };
}

export function pitMotorMountLayout(p, fork, branch) {
  const settings = pitMotorSettings(p.special);
  if (!settings.motorMount) return null;
  const { motorLength, motorWidth, motorHeight, motorStroke, plungerProjection } = settings;
  const maxHeight = maxPitMotorHeight(p);
  if (motorHeight > maxHeight + 1e-8)
    throw Error(`This track accepts a motor up to ${Math.floor(maxHeight * 100) / 100} mm high. Reduce motor height or increase track height to keep the road roof and clear the table.`);
  const drive = pitActuatorSpec(p, fork), x = drive.mainEye[0];
  const shaftWindow = motorWidth - Math.min(2.4, motorWidth / 2);
  const maxPlungerDiameter = Math.min(shaftWindow, motorHeight) - 0.2;
  if (settings.rodDiameter > maxPlungerDiameter)
    throw Error('The pushrod does not clear the centred plunger opening in this cradle. Use a thinner pushrod or a larger motor body.');
  const halfWidth = motorWidth / 2 + bodyGap + lip;
  const halfLength = motorLength / 2 + bodyGap + lip;
  const sign = fork.sign;
  const move = motorMountFit.adjustment + travelGap;
  const bodyRange = shoulderRange(branch, sign, x, halfWidth + rim + travelGap);
  const earRange = shoulderRange(branch, sign, x, halfWidth + earReach + rim + travelGap);
  const leadWidth = Math.max(settings.rodDiameter / 2 + 0.6, motorWidth / 2 - Math.min(1.2, motorWidth / 4));
  const leadRange = shoulderRange(branch, sign, x, leadWidth + rim);
  // The outer stock can join the guide sleeve. Only the cavity has to
  // preserve that sleeve, including the lateral projection on a bend.
  const guard = (range) => range.high + (p.slotWidth / 2 + p.wall + 0.12) * Math.hypot(1, range.steepest);
  // Reserve room for both ends of the stroke, the bent rod and the tray trim.
  const bendLength = Math.max(1.5, settings.rodDiameter * 1.5,
    lip + bodyGap + move + settings.rodDiameter / 2 - plungerProjection);
  const plungerRoom = plungerProjection + motorStroke + bendLength + move + settings.rodDiameter / 2;
  const centre = Math.max(
    guard(bodyRange) + halfLength + move,
    guard(earRange) + earHalfLength + move,
    guard(leadRange) + plungerRoom + motorLength / 2,
  );
  const shoulder = (p.width - (p.lanes - 1) * p.laneSpacing) / 2;
  const rearSpace = halfLength + move + rim;
  if (centre + rearSpace >= bodyRange.low + shoulder ||
      centre + earHalfLength + move + rim >= earRange.low + shoulder)
    throw Error('The motor cradle extends past the pit-side shoulder. Widen the road, reduce motor size or plunger projection, or shorten the stroke.');
  const front = centre - motorLength / 2, rear = centre + motorLength / 2;
  const bodyTop = trayTop + motorHeight;
  const shaftZ = trayTop + motorHeight / 2;
  const diverted = p.special.turnoutPosition === 'pit';
  const eye = diverted ? drive.pitEye : drive.mainEye;
  const pinY = eye[1] + sign * (diverted ? 1 : -1) * drive.pinClearance / 2;
  const tip = front - plungerProjection - (diverted ? 0 : motorStroke);
  const bendY = sign * (tip - bendLength);
  const rodPath = [
    [eye[0], pinY, drive.rodCenterZ * 2 + 1],
    [eye[0], pinY, drive.rodCenterZ],
    [x, bendY, drive.rodCenterZ],
    [x, bendY, shaftZ],
    [x, sign * tip, shaftZ],
    [x, sign * front, shaftZ],
  ];
  const yBounds = [sign * front, sign * rear].sort((a,b) => a-b);
  return {
    x, sign, centre, front, rear, rodEndY: sign * front, shaftZ, bodyTop, halfWidth,
    halfLength, leadWidth, plungerRoom, maxPlungerDiameter, side: fork.side, settings,
    caseBounds: { min: [x - motorWidth / 2, yBounds[0], trayTop], max: [x + motorWidth / 2, yBounds[1], bodyTop] },
    rodPath, drive,
  };
}

function slotTool(work, x, y, halfTravel, z, depth, lowerRadius, upperRadius) {
  const shape = work.own(work.wasm.Manifold.cylinder(depth, lowerRadius, upperRadius, 40));
  const ends = [-halfTravel, halfTravel].map(d => work.own(shape.translate([x, y + d, z])));
  return work.own(work.wasm.Manifold.hull(ends));
}

function overlaps(a, b) {
  return a.min.every((low, i) => low < b.max[i] && b.min[i] < a.max[i]);
}

function checkLooseHardware(work, p, mount, hardware, keepout, wireEnd) {
  const candidates = hardware.filter(part => part.role === 'clip' || part.role === 'retainer');
  if (!candidates.length) return;
  const { x, sign, rear, drive, rodEndY } = mount;
  // A low pushrod passes the pit guide before rising into the service pocket.
  // Use the outermost bow of the crank at half throw as well as both stops.
  const throat = drive.rodDiameter / 2, z = drive.rodCenterZ;
  const wires = [drive.mainEye, drive.midEye, drive.pitEye].map(([px, py]) => {
    const start = py - sign * drive.pinClearance / 2;
    const cylinder = work.own(work.wasm.Manifold.cylinder(Math.abs(rodEndY-start), throat, throat, 40));
    return work.own(work.own(cylinder.rotate([-sign * 90, 0, 0])).translate([px,start,z]));
  });
  const rod = work.own(work.wasm.Manifold.hull(wires));
  const cableHalf = Math.min(1.5, mount.settings.motorWidth / 3);
  const v0 = rear - motorMountFit.adjustment;
  const wireSlot = work.section([[[x-cableHalf,sign*v0],[x+cableHalf,sign*v0],
    [x+cableHalf,sign*wireEnd],[x-cableHalf,sign*wireEnd]]]);
  const leads = work.prism(wireSlot,0.15,1.10);
  for (const [volume, label] of [[keepout,'motor cradle'],[rod,'pushrod'],[leads,'motor lead exit']]) {
    const bounds = volume.boundingBox();
    for (const part of candidates) {
      if (!overlaps(bounds, part.solid.boundingBox()) || work.and(volume, part.solid).volume() <= 0.001) continue;
      if (/^(side|end)-clip-/.test(part.id)) throw pitHardwareObstruction(p, part, mount, label);
      throw Error('The ' + part.name.toLowerCase() + ' (' + part.id + ') blocks the ' + mount.side +
        ' pit ' + label + '. Move that connector under Connections or change the motor dimensions.');
    }
  }
}

export function addPitMotorMount(work, p, mount, road, borders, hardware) {
  const { x, centre, sign, settings, halfWidth: w, halfLength: l, bodyTop, leadWidth } = mount;
  const { motorWidth, motorHeight } = settings, adjust = motorMountFit.adjustment;
  const box = (x0, x1, v0, v1) => work.section([[
    [x+x0, sign*(centre+v0)], [x+x1, sign*(centre+v0)],
    [x+x1, sign*(centre+v1)], [x+x0, sign*(centre+v1)],
  ]]);
  const union = (items) => work.own(work.wasm.CrossSection.union(items));
  const base = (gap, travel) => union([
    box(-w-gap, w+gap, -l-travel-gap, l+travel+gap),
    box(-w-earReach-gap, w+earReach+gap, -earHalfLength-travel-gap, earHalfLength+travel+gap),
  ]);
  const tray = work.prism(base(0, 0), motorMountFit.tableClearance, trayTop);
  const lips = [];
  const lipTop = trayTop + Math.min(2.4, motorHeight - 0.35);
  for (const hand of [-1, 1]) {
    const outer = hand*w, inner = hand*(w-lip);
    lips.push(work.prism(box(Math.min(outer,inner), Math.max(outer,inner), -l, l), trayTop, lipTop));
    const edgeTip = hand * (motorWidth / 2 - Math.min(1.2, motorWidth / 4));
    for (const [a,b] of [[-l,-l+lip],[l-lip,l]]) {
      lips.push(work.prism(box(Math.min(outer,edgeTip), Math.max(outer,edgeTip), a,b), trayTop, lipTop));
    }
  }
  const fastenerXs = [x - w - earReach / 2, x + w + earReach / 2];
  const bores = [], pilots = [];
  for (const bx of fastenerXs) {
    bores.push(slotTool(work, bx, sign * centre, adjust, -0.01, trayTop + 0.1, 1.1, 1.1),
      slotTool(work, bx, sign * centre, adjust, motorMountFit.tableClearance, 0.95, 2.05, 1.1));
    const pilot = work.own(work.wasm.Manifold.cylinder(3.05, 0.8, 0.8, 40));
    pilots.push(work.own(pilot.translate([bx, sign * centre, trayTop - 0.01])));
  }
  const rear = mount.rear - centre;
  const wireHalfWidth = Math.min(1.5, motorWidth / 3);
  const cableNotch = box(-wireHalfWidth,wireHalfWidth,rear-0.2,l+0.1);
  const solid = work.cut(work.union([tray,...lips]),[...bores,work.prism(cableNotch,0,trayTop+0.01)]);
  const slide = base(travelGap,adjust);
  const chamber = box(-w-travelGap,w+travelGap,-l-adjust-travelGap,l+adjust+travelGap);
  const front = mount.front - centre;
  const lead = box(-leadWidth,leadWidth,front-mount.plungerRoom,front);
  const cavity = union([chamber,lead]);
  const stock = work.own(union([cavity,slide]).offset(rim,'Round',2,32));
  if (work.own(stock.subtract(road.section)).area() > 0.0001)
    throw Error('The pit motor mount crosses the road edge or a print seam. Widen the road, use fewer road segments or reduce the motor size.');
  const keepout = work.union([
    work.prism(cavity,-0.01,bodyTop + motorMountFit.topClearance + Math.max(2,p.deck) - 0.01),
    work.prism(slide,-0.01,trayTop+0.15),
    ...pilots,
  ]);
  const protectedBounds = keepout.boundingBox();
  const interferingCuts = [...road.cuts,...road.feedCuts].filter(cut => overlaps(protectedBounds, cut.boundingBox()));
  road.additions.push(work.prism(stock,0,p.height));
  road.cuts.push(work.prism(slide,-0.1,trayTop),
    work.prism(cavity,-0.1,bodyTop + motorMountFit.topClearance),...pilots);
  // Leads drop behind the rear corner lips and pass through a low open
  // groove. Carry it through the actual shoulder and attached border ribs.
  let wireEnd = mount.rear;
  for (const piece of [road,...borders]) {
    const bounds = piece.section.bounds();
    const end = (sign > 0 ? bounds.max[1] : -bounds.min[1]) - centre + 1;
    if (end <= rear || x+1.5 < bounds.min[0] || x-1.5 > bounds.max[0]) continue;
    wireEnd = Math.max(wireEnd, centre + end);
    piece.cuts.push(work.prism(box(-wireHalfWidth,wireHalfWidth,rear-adjust,end), -0.1, 1.25));
  }
  checkLooseHardware(work, p, mount, hardware, keepout, wireEnd);
  if (interferingCuts.length && work.and(keepout,work.union(interferingCuts)).volume() > 0.005)
    throw Error('The pit motor recess overlaps a slot, braid feed or connector pocket. Move the conflicting connection or change motor size, pit length or lane spacing.');
  const side = mount.side;
  return { id: 'pit-mount-'+side, name: (side === 'left' ? 'Left' : 'Right')+' pit motor cradle',
    role: 'motorMount', solid, motorGuide: {side, caseBounds:mount.caseBounds, rodPath:mount.rodPath} };
}
