// Builds the single-lane turnout: one road body with three ends, and a
// swappable insert that carries everything around the split.
//
// The insert goes into the road from below, so the braid on top never has to
// be lifted to change it. The road is the same for every kind of insert: the
// same pocket, the same fixed roof with its braid shelf above the pocket and
// the same two screw points. Only the insert differs.
import { addSlot, makePart, shell } from './solids.js';
import { laneTools } from './import-track.js';
import { addRoadJoints } from './track-joints.js';
import { cutPitBraidFeeds, pitBraidSections } from './pit-braids.js';
import { M2, buildPitTurnout, pitTurnoutFootprint, turnoutOutline } from './pit-turnout.js';
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
function insertOutline(work, p, fork, sleeves) {
  const { margin } = TURNOUT_INSERT;
  const span = turnoutInsertSpan(fork);
  const lanes = work.own(
    sleeves.intersect(rectangle(work, span.clipStart, -FAR, span.clipEnd, FAR)),
  );
  const content = union2(work, [pitTurnoutFootprint(work, p, fork), lanes]);
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

export function buildTurnout(work, p) {
  const layout = turnoutLayout(p),
    { fork, sign, settings } = layout;
  const electrical = turnoutBraidLayout(p, layout);
  const mode = settings.turnoutMode;
  const { fit, roof, lugTop, pilotDepth } = TURNOUT_INSERT;
  const H = p.height,
    floor = H - p.slotDepth,
    roofBottom = H - p.braidDepth - roof;

  // The road: the main straight and the branch as one printable body.
  const core = makePart('road-1', 'Turnout road', 'road', work.section([layout.outline]));
  shell(work, core, p);
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
  const pocket = insertOutline(work, flipperParams, fork, sleeves);
  const insertPlan = grow(work, pocket, -fit);
  const { start, end } = turnoutInsertSpan(fork);
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

  // The road takes its openings from the digital insert, whichever insert is
  // fitted: the slot, the window the blade's crown rises through and the
  // pushrod channel to the branch-side edge. That keeps the road identical.
  const flipper = (host, linkage, others) =>
    buildPitTurnout(
      work, flipperParams, fork, host, cover, guides, others, undefined,
      turnoutFlipperOptions(linkage),
    );
  const host = () => ({ section: insertPlan, additions: [], cuts: [], feedCuts: [] });
  const digital = host();
  // LINKAGE: the crank and the wire-rod channel come from pit-turnout.js as
  // they are for a pit lane. Replace this call, and `rodChannel`, to change it.
  const rodChannel = { section: core.section, cuts: [] };
  const digitalParts = flipper(digital, true, [rodChannel]);
  const roofSlab = work.prism(pocket, roofBottom - 0.02, H + 1);
  const window = work.and(work.union(digital.cuts), roofSlab);
  const pilotTop = Math.min(H - p.braidDepth - 1, lugTop + fit + pilotDepth);
  const pilot = work.own(
    work.wasm.Manifold.cylinder(pilotTop - lugTop - fit + 0.01, M2.pilotRadius, M2.pilotRadius, 40),
  );
  core.cuts.push(
    work.prism(pocket, -0.1, roofBottom),
    window,
    ...rodChannel.cuts,
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
    cuts = [...cuts, slots];
    parts = digitalParts;
  } else if (mode === 'manual') {
    const manual = host();
    parts = flipper(manual, false, []);
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
  };

  // Road joints on all three ends. Connector pockets keep clear of the insert.
  core.adjustedLaneSleeves = union2(work, [
    sleeves,
    grow(work, union2(work, [pocket, lugPocket]), TURNOUT_INSERT.jointWeb),
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
