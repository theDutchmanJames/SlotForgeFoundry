import { vertexNormals } from './import-track.js';
import { move, SolidWorkshop } from './solids.js';
import { pitMotorSettings } from './pit-motor-settings.js';

const faceRelief = 0.06;
const noseSetback = 0.34;
const noseLead = 2.5;
const throwClearance = 0.20;
const tailRadius = 10;
const shoulderReturn = 15;
const shoulderSetback = 0.50;
const externalCrankRadius = 12;
const shaftRadius = 2;
const hubRadius = 2.65;
const journalGap = 0.18;
const insertFit = 0.16;
const keyDepth = 1.25;
const armTopClearance = 0.60;
const armSideClearance = 0.60;
const guideFloorStock = 0.60;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// M2 hardware as it is printed: a tapped pilot, a clearance bore and the seat
// of a 90-degree countersunk head.
export const M2 = Object.freeze({
  pilotRadius: 0.80,
  clearanceRadius: 1.08,
  headRadius: 2.02,
  headDepth: 0.94,
});

// The wording for a pit lane. Another piece that uses the same flipper (the
// turnout) passes its own words for the same refusals.
const PIT_WORDS = Object.freeze({
  pivotRoom: 'Increase the pit offset to fit the turnout pivot between the two guide slots.',
  tailRoom: 'Lengthen the pit to leave room behind the pivot for its guide wall and return.',
  tongueRoom: 'Lengthen the pit approach to give the turnout tongue room to steer the guide.',
  waist: 'Lengthen the pit approach to leave a printable turnout tongue between its guide walls.',
  returnRoom: 'Lengthen the pit approach to fit the turnout return.',
  rise: 'Lengthen the pit approach or reduce braid depth to leave a smooth rise to the road at the pivot.',
});
const PIT_PARTS = Object.freeze({
  idPrefix: 'pit-',
  blade: ' pit turnout blade',
  crank: ' pit actuator crank',
  bearing: ' pit pivot bearing',
  pin: ' pit pivot pin',
});

export function pitEyeHardware(rodDiameter, eyeDiameter) {
  return { headDiameter: Math.max(rodDiameter + 2, eyeDiameter + 1), headProjection: 1,
    headTopClearance: 0.4, headSideClearance: 0.25 };
}

function actuatorHeights(p, rodDiameter) {
  const rodChannelHeight = rodDiameter + 0.25;
  const armBottom = Math.max(1.3, rodChannelHeight + 0.05);
  const armTop = armBottom + 1.5;
  const bayTop = armTop + armTopClearance;
  // Leave room for the blind key, 1.5 mm of thread and the closed crown.
  // Short tracks keep their original screw engagement and running clearance.
  const tallestSeat = p.height - 1 - 0.15 - 1.5 - 0.15 - keyDepth - 0.1;
  const seat = Math.max(p.height - p.slotDepth + 0.22, bayTop + 1.22,
    Math.min(bayTop + 2, tallestSeat));
  const keyTop = seat + keyDepth;
  const socketTop = keyTop + 0.15;
  const pilotTop = p.height - 1;
  return { seat, keyTop, socketTop, pilotTop, armBottom, armTop, bayTop, rodChannelHeight };
}

export function pitActuatorSpec(p, fork) {
  // The eye and the pushrod are those of a crank worked from outside the
  // piece. A motor works a pin on the crank instead: see withCam.
  const { motorMount, motorStroke, eyeDiameter, rodDiameter } = pitMotorSettings(p.special);
  const { socketTop, pilotTop, armBottom, armTop, rodChannelHeight } = actuatorHeights(p, rodDiameter);
  const hardware = pitEyeHardware(rodDiameter, eyeDiameter);
  const pinClearance = eyeDiameter - rodDiameter;
  const headPocketRadius = (hardware.headDiameter + pinClearance) / 2 + hardware.headSideClearance;
  const spec = { eyeDiameter, rodDiameter, pinClearance, motorStroke, ...hardware,
    armBottom, armTop, armTopClearance, armSideClearance, headPocketRadius,
    headPocketTop: armTop + hardware.headProjection + hardware.headTopClearance,
    rodCenterZ: rodChannelHeight / 2,
    stroke: 0,
    eyeOuterRadius: eyeDiameter / 2 + 1.15,
    minGuideFloor: rodChannelHeight + guideFloorStock,
    screwMin: Math.ceil((socketTop + 1.5 - armBottom) * 10 - 1e-8) / 10,
    screwMax: Math.floor((pilotTop - 0.15 - armBottom) * 10 + 1e-8) / 10 };
  if (fork) {
    const halfAngle = fork.swing / 2;
    const chordPerRadius = 2 * Math.sin(Math.abs(halfAngle));
    spec.crankRadius = externalCrankRadius;
    const minRadius = Math.max(2.65 + spec.eyeOuterRadius, fork.bearingRadius + headPocketRadius) + 0.5;
    if (!motorMount && spec.crankRadius < minRadius)
      throw Error('The crank eye or pushrod fastener would overlap the pivot. Reduce the crank hole diameter or the pushrod diameter.');
    spec.stroke = spec.crankRadius * chordPerRadius;
    const radial = [fork.heel[0] + spec.crankRadius, fork.heel[1]];
    spec.mainEye = radial;
    spec.midEye = rotate(radial, fork.heel, halfAngle);
    spec.pitEye = rotate(spec.mainEye, fork.heel, fork.swing);
  }
  return spec;
}

// A cam drive replaces the eye for a wire by an upright pin on a longer arm.
// cam: { radius, phase, pinRadius, pinTop, armBottom, armTop }. phase is the
// direction of the arm halfway through its throw, measured from +X towards
// the branch. armBottom and armTop make that arm stout: it starts lower, just
// above the table, and beyond the pivot bearing it rises to armTop. waist
// ({ point, radius }, in the frame of phase) is where the arm passes between
// the two slots behind the blade: it narrows to that radius there, and its
// bay follows its real outline with sideClearance, to leave the slots a wall.
// base is where the main slot lies across the road, where that is not 0.
function withCam(spec, fork, cam) {
  if (!cam) return spec;
  const direction = fork.sign * cam.phase;
  const radial = [fork.heel[0] + cam.radius * Math.cos(direction),
    fork.heel[1] + cam.radius * Math.sin(direction)];
  const mainEye = rotate(radial, fork.heel, -fork.swing / 2);
  // The waist is given for the middle of the throw; the arm is drawn at its main end.
  const waist = cam.waist && { radius: cam.waist.radius,
    point: rotate([cam.waist.point[0], (cam.base ?? 0) + fork.sign * cam.waist.point[1]], fork.heel, -fork.swing / 2) };
  return { ...spec, cam: { ...cam, waist }, crankRadius: cam.radius,
    stroke: 2 * cam.radius * Math.sin(Math.abs(fork.swing) / 2),
    mainEye, midEye: radial, pitEye: rotate(mainEye, fork.heel, fork.swing),
    eyeOuterRadius: cam.pinRadius + 0.8,
    headPocketRadius: cam.pinRadius + 0.35, headPocketTop: cam.pinTop + 0.3 };
}

function rotate(point, pivot, radians) {
  const x = point[0] - pivot[0], y = point[1] - pivot[1];
  const c = Math.cos(radians), s = Math.sin(radians);
  return [pivot[0] + x * c - y * s, pivot[1] + x * s + y * c];
}

// Both faces belong to ONE rigid tongue. Specify the straight face in the
// main pose, then rotate the actual mitered pit slot wall back into that pose.
// Position the pivot between the straight and curved slot with equal room for its bearing.
// frame places the fork on another piece: startX is where the main slot
// enters, endX is the X the fork must stay in front of, and words replaces the
// pit-lane wording of the refusals. A pit lane passes no frame.
export function pitTurnoutProfile(p, branch, base, sign, frame = {}) {
  const startX = frame.startX ?? -p.length / 2 - 0.05, endX = frame.endX ?? 0;
  const words = { ...PIT_WORDS, ...frame.words };
  const h = p.slotWidth / 2 + faceRelief;
  // A deep guide runs beside the drive instead of above it. Move its pivot
  // farther into the island so the eye and tab clear both guide walls.
  const shallowFloor = p.height - p.slotDepth < pitActuatorSpec(p).headPocketTop + guideFloorStock;
  const heelRadius = shallowFloor ? 3.85 : 3.2;
  const toeX = branch[0][0] - noseLead;
  const entry = [[startX, 0],
    ...branch.filter(([x]) => x < endX).map(([x, y]) => [x, sign * (y - base)])];
  const normals = vertexNormals(entry);
  const offset = (d) => entry.map((q, i) => move(q, normals[i], -d));
  const centers = offset(h + heelRadius);
  const heelY = h + heelRadius;
  const end = centers.findIndex((q) => q[1] >= heelY);
  if (end < 1)
    throw Error(words.pivotRoom);
  const t = (heelY - centers[end - 1][1]) / (centers[end][1] - centers[end - 1][1]);
  const heel = mix(centers[end - 1], centers[end], t);
  const pitWall = offset(h);
  // Carry the guiding flanks through the pivot and out the other side. A
  // broadside circular rim would leave an upstream-facing ledge at its exit.
  const pastTail = pitWall.findIndex(([x, y]) =>
    x > heel[0] && Math.hypot(x - heel[0], y - heelY) > tailRadius);
  if (pastTail < 1 || heel[0] + tailRadius + shoulderReturn > endX - 1)
    throw Error(words.tailRoom);
  const a = pitWall[pastTail - 1], b = pitWall[pastTail];
  let from = 0, to = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (from + to) / 2, q = mix(a, b, mid);
    if (Math.hypot(q[0] - heel[0], q[1] - heelY) < tailRadius) from = mid;
    else to = mid;
  }
  const wall = [...pitWall.slice(1, pastTail), mix(a, b, to)];
  // The selected guide meets a gently scarfed face at the toe. The entire
  // blunt printable tip sits behind the incoming fixed wall in either pose.
  const mainTip = [toeX, h + noseSetback];
  const length = heel[0] - toeX;
  if (length < 9)
    throw Error(words.tongueRoom);
  function pitFace(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const tipY = heelY + (-h - noseSetback - heelY - s * (toeX - heel[0])) / c;
    const tip = [toeX, tipY];
    const openTip = rotate(tip, heel, angle);
    // Intersect the incoming segment of the measured pit wall so the short
    // lead-in blends into the same wall used to cut the road.
    const endX = Math.min(openTip[0] + noseLead, wall[0][0]);
    const u = (endX - pitWall[0][0]) / (pitWall[1][0] - pitWall[0][0]);
    const lead = mix(pitWall[0], pitWall[1], u);
    return [tip, ...[lead, ...wall.filter((point) => point[0] > endX + 1e-6)]
      .map((q) => rotate(q, heel, -angle))];
  }
  // Very shallow forks need a little more throw for a printable waist where
  // their curved wall is still almost parallel to the straight wall.
  const faceWidth = (q) => q[1] - h - noseSetback *
    Math.max(0, 1 - (q[0] - toeX) / noseLead);
  let low = 0, high = Math.PI / 4;
  for (let i = 0; i < 30; i++) {
    const angle = (low + high) / 2;
    if (Math.min(...pitFace(angle).map(faceWidth)) < 0.80) low = angle;
    else high = angle;
  }
  const angle = high;
  const pitFaceClosed = pitFace(angle);
  if (Math.min(...pitFaceClosed.map(faceWidth)) < 0.79)
    throw Error(words.waist);
  const endOfArc = pitFaceClosed.at(-1);
  const endAngle = Math.atan2(endOfArc[1] - heelY, endOfArc[0] - heel[0]);
  const startAngle = -Math.asin(heelRadius / tailRadius);
  const heelArc = Array.from({ length: 25 }, (_, i) => {
    const a = startAngle + (endAngle - startAngle) * i / 24;
    return [heel[0] + tailRadius * Math.cos(a), heelY + tailRadius * Math.sin(a)];
  });
  const profile = [mainTip, [toeX + noseLead, h], ...heelArc.slice(0, -1),
    ...pitFaceClosed.slice().reverse()];
  const world = ([x, y]) => [x, base + sign * y];
  // Place both ends of the bearing foot between the actual slot walls. A
  // steeper branch can narrow the island substantially within these 7 mm.
  function bearingPad(distance, radius) {
    const inset = h + radius + 0.30;
    const boundary = offset(inset);
    const first = boundary.findIndex(q => q[1] >= inset);
    const a = boundary[first - 1], b = boundary[first];
    const startX = mix(a, b, (inset - a[1]) / (b[1] - a[1]))[0];
    const x = Math.max(heel[0] - distance, startX + 0.05);
    const end = boundary.findIndex(q => q[0] >= x);
    const lo = boundary[end - 1], hi = boundary[end];
    const upper = mix(lo, hi, (x - lo[0]) / (hi[0] - lo[0]))[1];
    return { point: world([x, (inset + upper) / 2]), radius };
  }
  const outline = profile.map(world);
  const pivot = world(heel);
  const mainToe = world(mix(mainTip, pitFaceClosed[0], 0.5));
  const swing = sign * angle;
  const returnStart = heel[0] + tailRadius, routeEndX = returnStart + shoulderReturn;
  // Set the receiving wall back from both selected blade faces, giving an
  // outward handoff even at the edge of the pivot's running clearance. Fade
  // the extra width with zero endpoint slope along the actual faceted road.
  const byX = (x) => {
    const i = entry.findIndex(([px]) => px >= x);
    if (i < 1) throw Error(words.returnRoom);
    const u = (x - entry[i - 1][0]) / (entry[i][0] - entry[i - 1][0]);
    return [mix(entry[i - 1], entry[i], u), mix(normals[i - 1], normals[i], u)];
  };
  const returnXs = [...new Set([heel[0], ...entry.map(([x]) => x).filter(x => x > heel[0] && x < routeEndX),
    ...Array.from({length: 25}, (_, i) => returnStart + shoulderReturn * i / 24)])].sort((a,b) => a-b);
  const mainCheek = [], pitCheek = [], mainSlot = [], pitSlot = [];
  for (const x of returnXs) {
    const u = Math.max(0, (x - returnStart) / shoulderReturn);
    const extra = shoulderSetback * (1 - u*u*(3 - 2*u));
    const [center, normal] = byX(x);
    mainCheek.push(world([x, p.slotWidth / 2 + extra]));
    pitCheek.push(world(move(center, normal, -p.slotWidth / 2 - extra)));
    mainSlot.push(world([x, 0]));
    pitSlot.push(world(center));
  }
  const pitGuide = [[toeX - 3, base], ...branch.filter(([x]) => x < routeEndX)];
  const stop = branch.findIndex(([x]) => x >= routeEndX);
  if (stop > 0) pitGuide.push(mix(branch[stop - 1], branch[stop],
    (routeEndX - branch[stop - 1][0]) / (branch[stop][0] - branch[stop - 1][0])));
  return {
    side: sign === 1 ? 'left' : 'right', sign, heel: pivot, mainToe,
    bearingRadius: Math.min(3.43, heelRadius - insertFit),
    bearingPads: [bearingPad(4.95, 1.72), bearingPad(7, 1.5)],
    pitToe: rotate(mainToe, pivot, swing), swing, outline,
    mainGuide: [[toeX - 3, base], [routeEndX, base]], pitGuide,
    socketLipEndX: branch[0][0],
    guardEndX: routeEndX,
    reliefs: [[...mainSlot, ...mainCheek.reverse()], [...pitSlot, ...pitCheek.reverse()]],
  };
}

export function turnoutOutline(fork, amount) {
  return amount ? fork.outline.map((q) => rotate(q, fork.heel, fork.swing * amount)) : fork.outline;
}

function disc(work, center, radius) {
  return work.section([Array.from({ length: 48 }, (_, i) => {
    const a = i * Math.PI / 24;
    return [center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)];
  })]);
}

// The installed seam runs diagonally through the guide depth. At any one
// longitudinal station a car flag overlaps a moving or a fixed wall above
// or below the seam. The conical end is concentric with the pivot at every
// height and has a printable underside slope.
function scarfEnd(work, solid, fork, bottom, top, low, high, clearance) {
  const lap = Math.min(3, (top - bottom) * 0.6);
  const radius = (z) => tailRadius + clearance - lap * (top - z) / (top - bottom);
  const cone = work.own(work.wasm.Manifold.cylinder(high - low, radius(low), radius(high), 128));
  const limit = work.own(cone.translate([...fork.heel, low]));
  const front = work.own(solid.trimByPlane([-1, 0, 0], -fork.heel[0]));
  return work.union([front, work.and(solid, limit)]);
}

function rectangle(work, x0, y0, x1, y1) {
  return work.section([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);
}

function bladeSolid(work, fork, bottom, lowTop, highTop, riseAt, drive, heights, riseWords = PIT_WORDS.rise) {
  const face = work.section([fork.outline]);
  const { min, max } = face.bounds();
  const height = highTop - lowTop;
  const run = Math.min(Math.max(5, 4 * height), fork.heel[0] - riseAt);
  if (run < 2 * height)
    throw Error(riseWords);
  // A sampled quintic has zero slope and curvature at both ends. Build the
  // profile in X/Z and sweep it sideways through the unchanged guiding faces.
  const ramp = Array.from({ length: 33 }, (_, i) => {
    const t = i / 32, ease = t*t*t*(10 + t*(-15 + 6*t));
    return [riseAt + t * run, lowTop + height * ease];
  });
  const section = work.section([[[min[0] - 1, bottom], [min[0] - 1, lowTop],
    ...ramp, [max[0] + 1, highTop], [max[0] + 1, bottom]]]);
  const sweep = work.prism(section, 0, max[1] - min[1] + 2);
  const side = work.own(sweep.rotate([90, 0, 0]));
  const envelope = work.own(side.translate([0, max[1] + 1, 0]));
  const body = work.and(work.prism(face, bottom, highTop), envelope);
  const rim = scarfEnd(work, body, fork, bottom, highTop,
    bottom - 0.01, highTop + 0.01, 0);
  const keySocket = work.own(drive.key.offset(0.13, 'Round', 2, 40));
  return work.cut(rim, [
    work.prism(drive.webClearance, 0, heights.seat),
    work.prism(drive.bay, 0, heights.bayTop),
    ...(drive.ribBay ? [work.prism(drive.ribBay, 0, drive.ribBayTop)] : []),
    work.prism(drive.headPocket, 0, drive.headPocketTop),
    work.prism(keySocket, 0, heights.socketTop),
    work.prism(disc(work, fork.heel, M2.pilotRadius), 0, heights.pilotTop),
  ]);
}

// pinOnly leaves the arm and its eye off: the keyed pivot pin of a blade that
// is set by hand. The clearances returned are always those of the full crank.
function driveGeometry(work, fork, heights, spec, pinOnly = false) {
  const [x, y] = fork.heel, eye = spec.mainEye;
  const { armBottom, armTop } = heights;
  const hub = disc(work, fork.heel, hubRadius), end = disc(work, eye, spec.eyeOuterRadius);
  const waist = pinOnly ? null : spec.cam?.waist;
  const through = waist && disc(work, waist.point, waist.radius);
  const arm = pinOnly ? hub : through
    ? work.own(work.wasm.CrossSection.union([work.own(work.wasm.CrossSection.hull([hub, through])),
      work.own(work.wasm.CrossSection.hull([through, end]))]))
    : work.own(work.wasm.CrossSection.hull([hub, end]));
  const shaft = disc(work, fork.heel, shaftRadius);
  const key = work.own(shaft.intersect(rectangle(work, x - 3, y - 3, x + 1.30, y + 3)));
  const root = work.own(work.wasm.Manifold.cylinder(0.45, shaftRadius + 0.5, shaftRadius, 48));
  const cam = pinOnly ? null : spec.cam;
  const low = cam?.armBottom ?? armBottom;
  const crank = work.union([work.prism(arm, low, armTop), work.own(root.translate([x, y, armTop])),
    work.prism(shaft, armTop, heights.seat), work.prism(key, heights.seat, heights.keyTop),
    ...(cam ? [work.prism(disc(work, eye, cam.pinRadius), armTop - 0.01, cam.pinTop)] : [])]);
  const sink = work.own(work.wasm.Manifold.cylinder(M2.headDepth, M2.headRadius, M2.clearanceRadius, 48));
  let solid = work.cut(crank, [
    work.own(sink.translate([x, y, low])),
    work.prism(disc(work, fork.heel, M2.clearanceRadius), low - 0.1, heights.keyTop + 0.1),
    ...(pinOnly || cam ? [] : [work.prism(disc(work, eye, spec.eyeDiameter / 2), armBottom - 0.1, armTop + 0.1)]),
  ]);
  // Hull sampled eye positions and the concentric hub. The convex envelope
  // contains the rigid arm throughout its throw, with room to insert it below.
  const swept = [hub], eyeKeepouts = [];
  const steps = 8;
  // The pin bears on alternating walls of an oversized eye. Reserve room
  // for the off-centre head as well as the bow between sampled poses.
  const bow = spec.crankRadius * (1 - Math.cos(fork.swing / (2 * steps)));
  const cutterRadius = (spec.headPocketRadius + bow) / Math.cos(Math.PI / 48);
  for (let i = 0; i <= steps; i++) {
    const position = rotate(eye, fork.heel, fork.swing * i / steps);
    swept.push(disc(work, position, spec.eyeOuterRadius));
    eyeKeepouts.push(disc(work, position, cutterRadius));
  }
  const sweep = work.own(work.wasm.CrossSection.hull(swept));
  const turn = (plan, i) => work.own(work.own(work.own(plan.translate([-x, -y]))
    .rotate(fork.swing * i / steps * 180 / Math.PI)).translate([x, y]));
  const sweptPlan = plan => work.own(work.wasm.CrossSection.union(
    Array.from({ length: steps + 1 }, (_, i) => turn(plan, i))));
  const sideClearance = (waist && spec.cam.sideClearance) || spec.armSideClearance;
  const bay = work.own((waist ? sweptPlan(arm) : sweep).offset(sideClearance + bow, 'Round', 2, 48));
  const headPocket = work.own(work.wasm.CrossSection.hull(eyeKeepouts));
  // The oblong tenon indexes the fixed bearing upstream of the crank.
  // Its shoulder bears on the floor, even before the adhesive cures.
  const bearing = disc(work, fork.heel, fork.bearingRadius);
  const hull = sections => work.own(work.wasm.CrossSection.hull(sections));
  const tenon = hull(fork.bearingPads.map(({ point, radius }) => disc(work, point, radius - 0.6)));
  const shoulder = hull(fork.bearingPads.map(({ point, radius }) => disc(work, point, radius)));
  const support = hull([bearing, shoulder]);
  const webSweep = [bearing];
  for (let i = 0; i <= steps; i++)
    for (const { point, radius } of fork.bearingPads)
      webSweep.push(disc(work, rotate(point, fork.heel, -fork.swing * i / steps), radius));
  const webClearance = work.own(hull(webSweep).offset(0.18, 'Round', 2, 36));
  let ribBay = null, ribBayTop = 0;
  if (cam && cam.armTop > armTop + 0.05) {
    // Beyond the bearing nothing lies above the arm, so it carries a rib up to
    // cam.armTop there. The pin stands on the rib, on a foot that widens to it.
    const keepOff = work.own(work.wasm.CrossSection.union([
      work.own(support.offset(0.6, 'Round', 2, 36)), disc(work, fork.heel, fork.bearingRadius + 0.8)]));
    // Near the pivot the rib is narrower than the arm, so that it stays clear
    // of the slot walls on either side through the whole throw.
    const slim = work.own(work.wasm.CrossSection.union([
      work.own(arm.offset(-0.9, 'Round', 2, 36)), work.own(arm.subtract(disc(work, fork.heel, waist ? 8 : 12)))]));
    const ribPlan = work.own(slim.subtract(keepOff));
    const foot = work.own(work.wasm.Manifold.cylinder(0.5, cam.pinRadius + 0.6, cam.pinRadius, 48));
    solid = work.union([solid, work.prism(ribPlan, armTop - 0.01, cam.armTop),
      work.own(foot.translate([...eye, cam.armTop - 0.01]))]);
    ribBay = work.own(sweptPlan(ribPlan).offset(sideClearance + bow, 'Round', 2, 48));
    ribBayTop = cam.armTop + spec.armTopClearance;
  }
  return { solid, key, sweep, bay, eye, headPocket, headPocketTop: spec.headPocketTop,
    support, shoulder, tenon, webClearance, ribBay, ribBayTop };
}

function bearingInsert(work, fork, drive, heights, floor, road) {
  const plateBottom = Math.max(heights.bayTop, heights.seat - 2);
  const bed = Math.min(floor, plateBottom);
  const pegBottom = Math.max(0.25, bed - 3);
  const clearance = section => work.own(section.offset(insertFit, 'Round', 2, 48));
  const bore = disc(work, fork.heel, shaftRadius + journalGap);
  const material = [work.prism(drive.support, plateBottom, heights.seat),
    work.prism(drive.tenon, pegBottom, bed)];
  if (bed < plateBottom) material.push(work.prism(drive.shoulder, bed, plateBottom));
  const insert = work.cut(work.union(material), [work.prism(bore, 0, heights.seat + 1),
    work.prism(drive.bay, -0.1, heights.bayTop)]);

  // The road carries the load through a socket in the floor. Its centre
  // stays open to the underside for the shaft and for printing face-down.
  const boss = work.own(drive.shoulder.offset(0.65, 'Round', 2, 48));
  road.additions.push(work.prism(boss, 0, floor));
  const socket = clearance(drive.support);
  const { min, max } = socket.bounds();
  // Carry the window all the way down under the journal. Only the keyed
  // end needs a ledge. This also avoids leaving a thin ceiling above the crank.
  const frontPad = fork.bearingPads[0];
  const windowStart = Math.min(fork.heel[0] - fork.bearingRadius, frontPad.point[0] + frontPad.radius - 0.25);
  const window = work.own(socket.intersect(rectangle(work, windowStart, min[1] - 1, max[0] + 1, max[1] + 1)));
  road.cuts.push(work.prism(clearance(drive.tenon), -0.1, floor + 0.01),
    work.prism(window, -0.1, floor + 0.01));
  if (bed < floor)
    road.cuts.push(work.prism(socket, bed, floor + 0.01));
  return insert;
}

// Union the swept edges, including the reentrant guiding flank. A convex hull
// of the complete throw cuts away the curved seat and widens the entrance.
function sweptSocket(work, fork) {
  let previous = fork.outline;
  const patches = [work.section([previous])];
  const radius = Math.hypot(...fork.mainToe.map((v, i) => v - fork.heel[i])) + 2;
  const steps = Math.max(4, Math.ceil(Math.abs(fork.swing) * Math.sqrt(radius / 0.025)));
  for (let j = 1; j <= steps; j++) {
    const next = turnoutOutline(fork, j / steps);
    for (let i = 0; i < next.length; i++) {
      const k = (i + 1) % next.length;
      patches.push(work.section([[previous[i], previous[k], next[k], next[i]]]));
    }
    previous = next;
  }
  const sweep = work.own(work.wasm.CrossSection.union(patches));
  return work.own(sweep.offset(throwClearance + 0.005, 'Round', 2, 40));
}

// Find the last point on the rigid tongue that goes underneath a fixed lip,
// checking its entire throw. Include the space between angular samples in
// the clearance so that the raised flank cannot catch the lip mid-throw.
function lastCoveredX(work, fork, pocket, roof, guides) {
  const fixed = work.own(work.own(roof.intersect(pocket)).subtract(guides));
  const blade = work.section([fork.outline]);
  const reach = fork.heel[0] - fork.mainToe[0] + 4;
  const arcLength = Math.abs(fork.swing) * reach;
  const steps = Math.max(2, Math.ceil(arcLength / 0.45));
  const clearance = work.own(fixed.offset(throwClearance + arcLength / (2 * steps), 'Round', 2, 32));
  const barriers = clearance.toPolygons();
  let last = fork.mainToe[0];
  for (let i = 0; i <= steps; i++) {
    const angle = -fork.swing * i / steps;
    const local = work.section(barriers.map((loop) => loop.map((p) => rotate(p, fork.heel, angle))));
    const covered = work.own(blade.intersect(local));
    if (!covered.isEmpty()) last = Math.max(last, covered.bounds().max[0]);
  }
  return last + 0.25;
}

// Everything the flipper needs in plan: the pocket the blade sweeps, the
// handoff reliefs, the bearing socket with its boss and the room of the crank.
// A piece that carries the flipper in a removable insert outlines it with this.
export function pitTurnoutFootprint(work, p, fork, options = {}) {
  const spec = withCam(pitActuatorSpec(p, fork), fork, options.cam);
  const drive = driveGeometry(work, fork, actuatorHeights(p, spec.rodDiameter), spec);
  return work.own(work.wasm.CrossSection.union([
    sweptSocket(work, fork),
    ...fork.reliefs.map(wall => work.section([wall])),
    work.own(drive.shoulder.offset(0.65, 'Round', 2, 48)),
    work.own(drive.support.offset(insertFit, 'Round', 2, 48)),
    drive.bay,
    drive.headPocket,
    ...(drive.ribBay ? [drive.ribBay] : []),
  ]));
}

// options (all optional; a pit lane passes none):
//   linkage: false  leaves out the crank, its bay and the pushrod channel, and
//                   returns a plain keyed pivot pin in place of the crank.
//   parts           the id prefix and the names of the returned parts.
//   words           the wording of the refusals, as for pitTurnoutProfile.
//   cam             drive the crank by an upright pin in a cam slot instead of
//                   a wire: see withCam. There is then no pushrod channel.
export function buildPitTurnout(work, p, fork, road, braidCover, guides, borders = [], rodEndY, options = {}) {
  const linkage = options.linkage !== false;
  const names = { ...PIT_PARTS, ...options.parts };
  const riseWords = options.words?.rise ?? PIT_WORDS.rise;
  const floor = p.height - p.slotDepth;
  const pocketTop = p.height - p.braidDepth - 0.80;
  const lowTop = pocketTop - 0.20, bottom = floor + 0.22;
  const highTop = p.height;
  const spec = withCam(pitActuatorSpec(p, fork), fork, options.cam);
  const heights = actuatorHeights(p, spec.rodDiameter);
  const drive = driveGeometry(work, fork, heights, spec);
  // The deep guide can run alongside the bay. A wider hole or longer throw
  // must never cut through its floor, even outside the original fork pocket.
  if (spec.headPocketTop + guideFloorStock > floor + 1e-8) {
    const walls = work.own(work.wasm.CrossSection.union([
      guides, ...fork.reliefs.map(wall => work.section([wall])),
    ]));
    if (!work.own(drive.headPocket.intersect(walls)).isEmpty()) {
      const minFloor = Number((spec.headPocketTop + guideFloorStock).toFixed(2));
      throw Error(options.words?.crankReach ?? `The crank sweep reaches the guide slot at the pushrod fastener. Reduce crank hole diameter or motor stroke, or leave at least ${minFloor} mm under the guide.`);
    }
    if (drive.ribBay && !work.own(drive.ribBay.intersect(walls)).isEmpty())
      throw Error(options.words?.crankReach ?? 'The crank sweep reaches the guide slot.');
    if (heights.bayTop + guideFloorStock > floor + 1e-8 && !work.own(drive.bay.intersect(walls)).isEmpty()) {
      const minFloor = Number((heights.bayTop + guideFloorStock).toFixed(2));
      throw Error(options.words?.crankReach ?? `The crank sweep reaches the guide slot. Reduce the hole diameter or motor stroke, or leave at least ${minFloor} mm under the guide.`);
    }
  }
  const pocket = sweptSocket(work, fork);
  const bounds = pocket.bounds();
  const lip = work.section([[
    [bounds.min[0] - 1, bounds.min[1] - 1], [fork.socketLipEndX, bounds.min[1] - 1],
    [fork.socketLipEndX, bounds.max[1] + 1], [bounds.min[0] - 1, bounds.max[1] + 1],
  ]]);
  // The turned tip tucks under a fixed lip. Both states have hard pocket
  // stops. Mount/unmount the tongue in mid-throw, through the open guide.
  const roof = braidCover ? work.own(lip.add(braidCover)) : lip;
  const access = work.own(pocket.subtract(roof));
  if (p.hollow) {
    const housing = work.own(pocket.offset(1.2, 'Round', 2, 40));
    road.additions.push(work.prism(housing, Math.max(0, floor - p.wall), p.height));
    if (p.reinforcement) (road.ribKeepouts ??= []).push(housing);
  }
  const bearing = bearingInsert(work, fork, drive, heights, floor, road);
  const fullPocket = work.union([work.prism(pocket, floor, pocketTop),
    work.prism(access, pocketTop - 0.01, p.height + 1)]);
  const receiver = scarfEnd(work, fullPocket, fork, bottom, highTop, floor - 0.01, p.height + 1.01, 0.30);
  road.cuts.push(receiver);
  for (const wall of fork.reliefs) {
    const relief = work.section([wall]);
    if (p.hollow) {
      // Preserve the chosen wall thickness behind the widened guide, even
      // after its shoulder leaves the switch housing at the end of the tail.
      const sleeve = work.own(relief.offset(p.wall, 'Round', 2, 32));
      road.additions.push(work.prism(work.own(sleeve.intersect(road.section)),
        Math.max(0, floor - p.wall), p.height));
    }
    road.cuts.push(work.prism(relief, floor, p.height + 1));
  }
  if (linkage)
    road.cuts.push(work.prism(drive.bay, -0.1, heights.bayTop),
      work.prism(drive.headPocket, -0.1, spec.headPocketTop),
      ...(drive.ribBay ? [work.prism(drive.ribBay, -0.1, drive.ribBayTop)] : []));
  // Without a crank only the flange of the pivot pin turns below the bearing.
  else road.cuts.push(work.prism(disc(work, fork.heel, hubRadius + armSideClearance), -0.1, heights.bayTop));
  // The rod lies below the flag, with its bent end pointing up into the eye.
  // Open a shallow channel out through the pit shoulder and any attached
  // border, including hollow ribs. A solid underbody also gets an exit.
  const xs = [spec.mainEye[0], spec.midEye[0], spec.pitEye[0]];
  const rodMargin = spec.rodDiameter / 2 + 0.5;
  const x0 = Math.min(...xs) - rodMargin, x1 = Math.max(...xs) + rodMargin;
  for (const part of linkage && !spec.cam ? [road, ...borders] : []) {
    const span = part.section.bounds();
    const outside = rodEndY ?? (fork.sign > 0 ? span.max[1] + 1 : span.min[1] - 1);
    if (fork.sign * (outside - drive.eye[1]) <= 0 ||
      span.max[0] < x0 || span.min[0] > x1) continue;
    const inside = drive.eye[1] - fork.sign;
    const channel = rectangle(work, x0, Math.min(inside, outside), x1, Math.max(inside, outside));
    part.cuts.push(work.prism(channel, -0.1, heights.rodChannelHeight));
  }
  const riseAt = lastCoveredX(work, fork, pocket, roof, guides);
  const blade = bladeSolid(work, fork, bottom, lowTop, highTop, riseAt, drive, heights, riseWords);
  const angle = p.special.turnoutPosition === 'pit' ? fork.swing * 180 / Math.PI : 0;
  function pose(shop, solid, degrees) {
    if (!degrees) return solid;
    const centered = shop.own(solid.translate([-fork.heel[0], -fork.heel[1], 0]));
    const turned = shop.own(centered.rotate([0, 0, degrees]));
    return shop.own(turned.translate([...fork.heel, 0]));
  }
  const wasm = work.wasm, hand = fork.side === 'left' ? 'Left' : 'Right';
  function part(id, name, role, canonical, rebuild) {
    return { id: id + fork.side, name: hand + name, role, solid: pose(work, canonical, angle),
      printPose(callback, sideDown) {
        if (!sideDown) return callback(this.solid);
        const printing = new SolidWorkshop(wasm);
        try {
          // Reversing the installed rotation can reorder mesh facets and give
          // identical manufactured parts different STL fingerprints in a kit.
          const flat = angle ? rebuild(printing) : this.solid;
          return callback(printing.own(flat.translate([0, 0, -flat.boundingBox().min[2]])));
        } finally { printing.close(); }
      } };
  }
  let crank;
  if (linkage) {
    crank = part(names.idPrefix + 'crank-', names.crank, 'turnoutArm', drive.solid, shop =>
      driveGeometry(shop, fork, heights, spec).solid);
    if (!spec.cam) crank.crankGuide = { side: fork.side, eye: angle ? spec.pitEye : spec.mainEye,
      armTop: heights.armTop, headPocketTop: spec.headPocketTop, headDiameter: spec.headDiameter,
      headProjection: spec.headProjection, pinClearance: spec.pinClearance, pocketOutline: drive.headPocket.toPolygons()[0] };
  } else {
    // The pin is the crank without its arm. It prints flange down, as drawn.
    crank = part(names.idPrefix + 'pin-', names.pin, 'turnoutBearing',
      driveGeometry(work, fork, heights, spec, true).solid,
      shop => driveGeometry(shop, fork, heights, spec, true).solid);
    crank.printsUpright = true;
  }
  return [part(names.idPrefix + 'blade-', names.blade, 'turnout', blade, shop =>
    bladeSolid(shop, fork, bottom, lowTop, highTop, riseAt, driveGeometry(shop, fork, heights, spec), heights, riseWords)), crank,
    { id: names.idPrefix + 'bearing-' + fork.side, name: hand + names.bearing, role: 'turnoutBearing', solid: bearing }];
}
