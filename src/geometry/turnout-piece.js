// Builds the single-lane turnout: one road body with three ends, and a
// swappable insert that carries everything around the split.
//
// The insert goes into the road from below, so the braid on top never has to
// be lifted to change it. The road is the same for every kind of insert: the
// same pocket, the same fixed roof with its braid shelf above the pocket and
// the same two screw points. Only the insert differs.
import { SolidWorkshop, addSlot, makePart, shell } from './solids.js';
import { plannerStrip } from '../planner-strip.js';
import { laneTools } from './import-track.js';
import { addRoadJoints } from './track-joints.js';
import { cutPitBraidFeeds, pitBraidSections } from './pit-braids.js';
import { M2, buildPitTurnout, pitTurnoutFootprint, turnoutOutline } from './pit-turnout.js';
import { inlineMotorTray } from './pit-motor-mount.js';
import {
  TURNOUT_INSERT,
  turnoutBraidLayout,
  turnoutFlipperOptions,
  turnoutHasBlade,
  turnoutInsertSpan,
  turnoutLayout,
  turnoutModeName,
} from './turnout-layout.js';

const FAR = 1e5;
// A fixed island nose is rounded to this radius, so it prints as a wall and
// not as a knife edge.
const NOSE_RADIUS = 0.4;
// The detent of a hand-set blade stands this far above the blade's underside.
const DETENT_BITE = 0.13;
const BLADE_FLOOR_GAP = 0.22;

const union2 = (work, areas) =>
  areas.length === 1 ? areas[0] : work.own(work.wasm.CrossSection.union(areas));
const rectangle = (work, x0, y0, x1, y1) =>
  work.section([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);
const disc = (work, [x, y], radius, n = 48) =>
  work.section([
    Array.from({ length: n }, (_, i) => [
      x + radius * Math.cos((2 * Math.PI * i) / n),
      y + radius * Math.sin((2 * Math.PI * i) / n),
    ]),
  ]);
const grow = (work, section, by) => work.own(section.offset(by, 'Round', 2, 48));
// Remove every part of a shape thinner than 2 × radius and round what is left.
const opened = (work, section, radius) => grow(work, grow(work, section, -radius), radius);
const signedArea = (loop) =>
  loop.reduce((sum, [x, y], i) => {
    const [nx, ny] = loop[(i + 1) % loop.length];
    return sum + x * ny - nx * y;
  }, 0) / 2;

function renameHardware(list, prefix) {
  for (const item of list) {
    item.id = prefix + item.id;
    if (item.parentClipId) item.parentClipId = prefix + item.parentClipId;
  }
}

// The outline of the insert: around the blade pocket, the handoff reliefs,
// the pivot and the crank, and around both guide slots over that length.
function insertOutline(work, p, fork, sleeves, drive) {
  const { margin } = TURNOUT_INSERT;
  const span = turnoutInsertSpan(fork, drive);
  const lanes = work.own(
    sleeves.intersect(rectangle(work, span.clipStart, -FAR, span.clipEnd, FAR)),
  );
  const content = union2(work, [pitTurnoutFootprint(work, p, fork, { cam: drive.crank }), lanes]);
  // Close narrow notches between the slots, then keep the outside loop only:
  // one pocket without islands or slivers.
  const closing = 4;
  const blob = grow(work, grow(work, content, margin + closing), -closing);
  const outer = blob
    .toPolygons()
    .filter((loop) => signedArea(loop) > 0)
    .sort((a, b) => signedArea(b) - signedArea(a))[0];
  return work.own(work.section([outer]).simplify(0.005));
}

// A screw lug on one flank of the insert, at this X.
function lugAt(work, outline, x, outward) {
  const { lugRadius, lugReach } = TURNOUT_INSERT;
  const strip = work.own(outline.intersect(rectangle(work, x - 0.05, -FAR, x + 0.05, FAR)));
  const { min, max } = strip.bounds();
  const edge = outward > 0 ? max[1] : min[1];
  const centre = [x, edge + outward * lugReach];
  const root = [x, edge - outward];
  const plan = work.own(
    work.wasm.CrossSection.hull([disc(work, centre, lugRadius), disc(work, root, lugRadius)]),
  );
  return { centre, plan };
}

// How a hand-set blade stays where it is put.
//
// Near its toe the blade is narrower than the distance it travels, so the
// places it rests in, straight on and branch, do not overlap there. A low
// ridge stands on the floor of the insert between those two places. The
// blade rests beside the ridge on either side with a little clearance. To
// change over it has to ride over the ridge, which lifts the toe by
// DETENT_BITE; the blade springs that far and has that much room under the
// fixed roof. The ridge is ramped on all sides. It stands in the slot floor,
// DETENT_BITE + BLADE_FLOOR_GAP proud, so a car's guide must clear the slot
// floor by more than that.
function bladeDetent(work, p, fork) {
  const floor = p.height - p.slotDepth;
  const rest = work.section([fork.outline]),
    thrown = work.section([turnoutOutline(fork, 1)]);
  const span = (section, x) => {
    const cut = work.own(section.intersect(rectangle(work, x - 0.02, -FAR, x + 0.02, FAR)));
    if (cut.isEmpty()) return null;
    const { min, max } = cut.bounds();
    return [min[1], max[1]];
  };
  // The free strip between the two resting places at this X.
  const between = (x) => {
    const a = span(rest, x),
      b = span(thrown, x);
    if (!a || !b) return null;
    const [low, high] = a[0] > b[0] ? [b[1], a[0]] : [a[1], b[0]];
    return high > low ? [low, high] : null;
  };
  const length = 3;
  for (let along = 5; along <= 30; along += 1) {
    const x = fork.mainToe[0] + along;
    const gaps = [x - length / 2, x, x + length / 2].map(between);
    if (gaps.some((gap) => !gap)) continue;
    const low = Math.max(...gaps.map((gap) => gap[0])),
      high = Math.min(...gaps.map((gap) => gap[1]));
    const width = Math.min(1, high - low - 0.4);
    if (width < 0.6) continue;
    const half = width / 2;
    const base = work.own(
      work.wasm.CrossSection.hull([
        disc(work, [-(length / 2 - half), 0], half, 24),
        disc(work, [length / 2 - half, 0], half, 24),
      ]),
    );
    const height = BLADE_FLOOR_GAP + DETENT_BITE;
    const ridge = work.own(base.extrude(height + 0.2, 0, 0, [0.5, 0.4]));
    return work.own(ridge.translate([x, (low + high) / 2, floor - 0.2]));
  }
  throw Error(
    'The hand-set blade has no room for its detent. Use a smaller Branch radius or choose another insert.',
  );
}

// The slider at its straight-on end: a head with the cam slot, a neck, a plain
// bar and a tongue that reaches over the motor's plunger. The head and the
// tongue are relieved from below; the top face is flat all over, so the
// slider prints upside down on that face without support.
export function sliderSolid(work, drive, sign) {
  const box = ({ x0, x1, y0, y1 }) =>
    rectangle(work, x0, Math.min(sign * y0, sign * y1), x1, Math.max(sign * y0, sign * y1));
  const { head, neck, bar, tongue, pinHole, z } = drive;
  const tongueBox = box({ ...tongue, y0: bar.y0, y1: bar.y1 });
  const headBox = union2(work, [box(head), box(neck)]);
  const line = drive.camLine.map(([x, y]) => [x, sign * y]);
  const slot = union2(
    work,
    line.slice(1).map((q, i) =>
      work.own(
        work.wasm.CrossSection.hull([
          disc(work, line[i], drive.slotHalf, 32),
          disc(work, q, drive.slotHalf, 32),
        ]),
      ),
    ),
  );
  const blank = work.prism(union2(work, [headBox, box(bar), tongueBox]), z.bottom, z.top);
  return work.cut(blank, [
    work.prism(slot, z.bottom - 1, z.top + 1),
    // The crank arm passes under the head.
    work.prism(headBox, z.bottom - 0.1, z.headBottom),
    // The plunger passes under the tongue, which carries the pin for its eye.
    work.prism(tongueBox, z.bottom - 0.1, tongue.z0),
    work.prism(
      disc(work, [pinHole.x, sign * pinHole.y], pinHole.radius, 32),
      tongue.z0 - 0.1,
      tongue.z0 + pinHole.depth,
    ),
  ]);
}

// Upside down on the bed, resting on what is its top face in the road.
// rebuild makes the part afresh where it was drawn moved along for the
// selected route, so the same part always gives the same STL.
export function printsTopDown(part, wasm, rebuild) {
  part.printPose = function printPose(callback, sideDown) {
    // Only on the bed: anything else wants the part where it sits in the road.
    if (!sideDown) return callback(this.solid);
    const shop = new SolidWorkshop(wasm);
    try {
      const turned = shop.own((rebuild ? rebuild(shop) : this.solid).rotate([180, 0, 0]));
      return callback(shop.own(turned.translate([0, 0, -turned.boundingBox().min[2]])));
    } finally {
      shop.close();
    }
  };
  return part;
}

// The turnout for the Track Planner: the main road with its two ends, and
// the end of the branch as a third. Both exits lead away from the entry.
export function turnoutStrip(p, layout = turnoutLayout(p)) {
  const main = plannerStrip(layout.mainPath, p, 0, 1),
    branch = plannerStrip(layout.branchPath, p, 0, 1);
  return {
    ...main,
    lanes: [...main.lanes, ...branch.lanes],
    // The branch is the same lane carrying on, not a second lane of the pack.
    laneOf: [0, 0],
    ports: [...main.ports, { ...branch.ports[1], out: true, branch: true }],
  };
}

export function buildTurnout(work, p) {
  const layout = turnoutLayout(p),
    { fork, sign, settings, drive } = layout;
  const electrical = turnoutBraidLayout(p, layout);
  const mode = settings.turnoutMode;
  const { fit, roof, lugTop, pilotDepth } = TURNOUT_INSERT;
  const H = p.height,
    floor = H - p.slotDepth,
    roofBottom = H - p.braidDepth - roof;

  // The road: the main straight and the branch as one printable body.
  const core = makePart('road-1', 'Turnout road', 'road', work.section([layout.outline]));
  shell(work, core, p);
  if (work.planning) core.plannerStrip = turnoutStrip(p, layout);
  const tools = laneTools(work, p, { lanes: layout.cutLanes, outlines: [] });
  const { recess, cover } = pitBraidSections(work, p, electrical);
  for (const lane of tools) lane[2] = null;
  tools[0][2] = recess;
  for (const args of tools) addSlot(work, core, p, ...args);
  cutPitBraidFeeds(work, p, [core], electrical);
  const mainGuide = tools[0][0];
  const guides = union2(work, tools.map(([guide]) => guide));
  const sleeves = union2(work, tools.map(([, sleeve]) => sleeve));

  // The pocket for the insert, with a lug on each flank for its two screws.
  // The blade and its pivot are solid parts of the insert whatever the road is.
  const flipperParams = { ...p, hollow: false };
  const pocket = insertOutline(work, flipperParams, fork, sleeves, drive);
  const insertPlan = grow(work, pocket, -fit);
  const { start, end } = turnoutInsertSpan(fork, drive);
  const lugs = [
    lugAt(work, pocket, start + 0.72 * (end - start), -sign),
    lugAt(work, pocket, start + 0.3 * (end - start), sign),
  ];
  const lugPlan = union2(work, lugs.map((lug) => lug.plan));
  const lugPocket = grow(work, lugPlan, fit);
  const housing = grow(work, union2(work, [pocket, lugPocket]), p.wall);
  if (work.own(housing.subtract(core.section)).area() > 1e-4)
    throw Error(
      'The turnout insert and its screws reach the edge of the road. Use a wider road or a longer Lead before the branch.',
    );
  core.additions.push(work.prism(housing, 0, H));
  if (p.hollow && p.reinforcement) (core.ribKeepouts ??= []).push(housing);

  // The drive of the Digital insert: the slider's channel and the motor's
  // cavity, in the island between the two slots. They are part of the road
  // whichever insert is fitted, hollow or solid.
  const box = ([x0, y0, x1, y1]) =>
    rectangle(work, x0, Math.min(sign * y0, sign * y1), x1, Math.max(sign * y0, sign * y1));
  const channel = union2(work, drive.channels.map(box));
  const chamber = box(drive.chamber),
    traySlide = box(drive.slide);
  const driveOpenings = union2(work, [channel, chamber, traySlide]);
  const driveHousing = grow(work, driveOpenings, Math.max(p.wall, drive.tray.rim));
  if (work.own(driveHousing.subtract(core.section)).area() > 1e-4)
    throw Error(
      'The slider and its motor reach the edge of the road. Use a wider road or a longer Main road length.',
    );
  core.additions.push(work.prism(driveHousing, 0, H));
  if (p.hollow && p.reinforcement) core.ribKeepouts.push(driveHousing);
  const trayPilot = work.own(
    work.wasm.Manifold.cylinder(drive.tray.pilotHeight, M2.pilotRadius, M2.pilotRadius, 40),
  );
  const driveCuts = [
    work.prism(channel, -0.1, drive.z.channelTop),
    work.prism(chamber, -0.1, drive.z.cavityTop),
    work.prism(traySlide, -0.1, drive.tray.trayTop + 0.15),
    ...drive.screws.map(([x, y]) => work.own(trayPilot.translate([x, sign * y, drive.tray.trayTop - 0.01]))),
  ];
  const slotsAndBraid = union2(work, [guides, ...(recess ? [recess] : [])]);
  if (work.own(driveOpenings.intersect(slotsAndBraid)).area() > 1e-6)
    throw Error(
      'The slider or its motor would lie under a guide slot or its braid. Use a narrower motor, a shorter Usable stroke or a smaller Branch radius.',
    );

  // The road takes its other openings from the digital insert, whichever
  // insert is fitted: the slot and the window the blade's crown rises through.
  // That keeps the road identical.
  const flipper = (host, linkage) =>
    buildPitTurnout(
      work, flipperParams, fork, host, cover, guides, [], undefined,
      turnoutFlipperOptions(linkage, drive.crank),
    );
  const host = () => ({ section: insertPlan, additions: [], cuts: [], feedCuts: [] });
  const digital = host();
  const digitalParts = flipper(digital, true);
  const roofSlab = work.prism(pocket, roofBottom - 0.02, H + 1);
  const window = work.and(work.union(digital.cuts), roofSlab);
  const pilotTop = Math.min(H - p.braidDepth - 1, lugTop + fit + pilotDepth);
  const pilot = work.own(
    work.wasm.Manifold.cylinder(pilotTop - lugTop - fit + 0.01, M2.pilotRadius, M2.pilotRadius, 40),
  );
  core.cuts.push(
    work.prism(pocket, -0.1, roofBottom),
    window,
    ...driveCuts,
    work.prism(lugPocket, -0.1, lugTop + fit),
    ...lugs.map(({ centre }) => work.own(pilot.translate([...centre, lugTop + fit - 0.01]))),
  );

  // The insert: a block from the table to the underside of the fixed roof.
  const slots = work.prism(guides, floor, H + 1);
  let block = [work.prism(insertPlan, 0, roofBottom)],
    additions = [],
    cuts = [],
    parts = [],
    detent = null;
  if (mode === 'digital') {
    ({ additions, cuts } = digital);
    // The head of the slider works inside the insert, around the crank's pin.
    cuts = [...cuts, slots, work.prism(channel, -0.1, drive.z.channelTop)];
    const travelled = settings.turnoutPosition === 'pit' ? drive.stroke : 0;
    const slider = printsTopDown({
      id: 'turnout-slider',
      name: 'Turnout slider',
      role: 'turnoutSlider',
      solid: work.own(sliderSolid(work, drive, sign).translate([travelled, 0, 0])),
    }, work.wasm, (shop) => sliderSolid(shop, drive, sign));
    const tray = inlineMotorTray(work, drive.motor);
    const cradle = {
      id: 'turnout-motor-cradle',
      name: 'Turnout motor cradle',
      role: 'motorMount',
      solid: work.own(tray.solid.translate([drive.motorCentre, sign * drive.axis, 0])),
    };
    parts = [...digitalParts, slider, cradle];
  } else if (mode === 'manual') {
    const manual = host();
    parts = flipper(manual, false);
    additions = manual.additions;
    cuts = [...manual.cuts, slots];
    detent = bladeDetent(work, p, fork);
  } else {
    // No blade. Fill the window in the fixed roof flush with the road, from
    // the narrowest outline the roof opening has, so the plug passes up
    // through it.
    const opening = work.union([
      window,
      work.prism(work.own(guides.intersect(pocket)), roofBottom - 0.02, H + 1),
    ]);
    const passage = grow(work, work.own(opening.slice(roofBottom + 0.02)), -fit);
    // Analog keeps both slots. Closed keeps the main slot only: the branch
    // slot is filled to the road surface, up through its opening in the roof.
    const open = mode === 'analog' ? guides : mainGuide;
    let plug = opened(work, work.own(passage.subtract(open)), 0.3);
    if (mode === 'analog') {
      // Build the walls beside the two slots as they are meant to print, with
      // the island nose between them rounded, and stand them on a solid base.
      const walls = opened(work, work.own(insertPlan.subtract(guides)), NOSE_RADIUS);
      plug = work.own(plug.intersect(walls));
      block = [work.prism(insertPlan, 0, floor), work.prism(walls, floor - 0.01, roofBottom)];
    } else cuts = [work.prism(open, floor, H + 1)];
    additions = [work.prism(plug, roofBottom - 0.01, H)];
  }
  const sink = work.own(
    work.wasm.Manifold.cylinder(M2.headDepth, M2.headRadius, M2.clearanceRadius, 48),
  );
  const body = work.cut(
    work.union([...block, work.prism(lugPlan, 0, lugTop), ...additions]),
    [
      ...cuts,
      ...lugs.flatMap(({ centre }) => [
        work.prism(disc(work, centre, M2.clearanceRadius), -0.1, lugTop + 0.1),
        work.own(sink.translate([...centre, 0])),
      ]),
    ],
  );
  const insert = {
    id: 'turnout-insert',
    name: 'Turnout insert · ' + turnoutModeName(mode),
    role: 'turnoutInsert',
    solid: detent ? work.union([body, detent]) : body,
    turnoutMode: mode,
    screws: lugs.map((lug) => lug.centre),
    // For checks and guides: what the drive opens in the road, and what it
    // has to keep clear of.
    driveOpenings: driveOpenings.toPolygons(),
    slotsAndBraid: slotsAndBraid.toPolygons(),
  };

  // Road joints on all three ends. Connector pockets keep clear of the insert.
  core.adjustedLaneSleeves = union2(work, [
    sleeves,
    grow(work, union2(work, [pocket, lugPocket, driveOpenings]), TURNOUT_INSERT.jointWeb),
  ]);
  const loose = [];
  const ends = { ...p, segments: 1 };
  addRoadJoints(work, ends, layout.mainPath, [0], [core], loose);
  const branchHardware = [];
  addRoadJoints(work, ends, layout.branchPath, [0], [core], branchHardware, {
    skipped: new Set([0]),
  });
  renameHardware(branchHardware, 'branch-');
  loose.push(...branchHardware, insert, ...(turnoutHasBlade(mode) ? parts : []));
  return { pieces: [core], loose };
}
