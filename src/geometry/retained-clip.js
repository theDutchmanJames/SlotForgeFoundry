import {
  KEEPER_LIFT,
  KEEPER_DRIVE_SLOT,
  KEEPER_RADIUS,
  KEEPER_SHELF,
  KEEPER_THICKNESS,
  KEEPER_CHAMBER_TOP,
  RETAINED_SEAT,
} from './keeper-dimensions.js';
import { CLIP_TABLE_CLEARANCE } from './joint-fit.js';

const bladeHalfWidth = 1.8;
const hubRadius = 3.2;
const bladeTop = KEEPER_SHELF + KEEPER_THICKNESS;
const keeperSegments = 64;
const shoulderStart = [4.6, 2.15];
const shoulderEnd = [6.8, 4.75];

function circle(work, radius) {
  return work.own(work.wasm.CrossSection.circle(radius, keeperSegments));
}

function capsule(work, clearance = 0) {
  const hub = circle(work, bladeHalfWidth + clearance);
  const offset = KEEPER_RADIUS - bladeHalfWidth;
  return work.own(
    work.wasm.CrossSection.hull([
      work.own(hub.translate([-offset, 0])),
      work.own(hub.translate([offset, 0])),
    ]),
  );
}

// The locked keeper spans the seam tangentially. Its slotted boss faces the
// table, while its broad upper face offers a continuous print-bed footprint.
export function keeperModel(work) {
  const blade = work.prism(
    work.own(capsule(work).rotate(90)),
    KEEPER_SHELF,
    bladeTop,
  );
  const boss = work.prism(
    circle(work, hubRadius),
    CLIP_TABLE_CLEARANCE,
    bladeTop,
  );
  const halfLength = KEEPER_DRIVE_SLOT.length / 2;
  const halfWidth = KEEPER_DRIVE_SLOT.width / 2;
  const driver = work.section([[[-halfLength, -halfWidth], [halfLength, -halfWidth],
    [halfLength, halfWidth], [-halfLength, halfWidth]]]);
  return work.cut(work.union([blade, boss]), [
    work.prism(driver, 0, CLIP_TABLE_CLEARANCE + KEEPER_DRIVE_SLOT.depth),
  ]);
}

export function keeperPrint(work, keeper) {
  return work.own(
    work.own(keeper.rotate([180, 0, 0])).translate([0, 0, bladeTop]),
  );
}

function turnChamber(work, clearance) {
  // Sweep both rounded blade tips from the entry angle to the lock angle.
  // The unswept quadrants supply end stops at full lift. A little additional
  // radial clearance covers the chord error of the polygonal arc.
  const radius = KEEPER_RADIUS - bladeHalfWidth;
  const sector = [[0, 0]];
  for (let i = 0; i <= 32; i++) {
    const angle = (i * Math.PI) / 64;
    sector.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  const inner = work.section([sector]);
  const rounded = work.own(
    inner.offset(
      bladeHalfWidth + clearance + 0.004,
      'Round',
      2,
      keeperSegments,
    ),
  );
  return work.own(rounded.add(work.own(rounded.rotate(180))));
}

function keeperPocket(work, clearance) {
  const entry = capsule(work, clearance);
  const stop = work.own(entry.rotate(90));
  const chamber = turnChamber(work, clearance);
  const turnFloor = KEEPER_SHELF + KEEPER_LIFT - 0.12;
  const turnRoof = KEEPER_CHAMBER_TOP;
  return work.union([
    work.prism(entry, -1, turnRoof),
    work.prism(circle(work, hubRadius + clearance), -1, turnRoof),
    work.prism(stop, KEEPER_SHELF, turnRoof),
    work.prism(chamber, turnFloor, turnRoof),
  ]);
}

// An original solid draw key. Its four inclined shoulders move outwards by
// 0.6 mm towards the leading face. On insertion the bearing lands first clear
// this narrow leading section and then pull the two halves to the seam.
export function drawKeyOutline(leadAllowance = 0) {
  const quadrant = [
    [0, 2.15],
    shoulderStart,
    shoulderEnd,
    [7.45, 5],
    [11.9, 5],
    [13, 3.9],
  ].map(([x, y]) => [
    x >= shoulderStart[0] && x <= 7.45 ? x - leadAllowance : x,
    y,
  ]);
  const side = [
    ...quadrant
      .slice(1)
      .reverse()
      .map(([x, y]) => [-x, y]),
    ...quadrant,
  ];
  return [...side, ...side.map(([x, y]) => [x, -y]).reverse()];
}

export function drawKeyModel(work, thickness) {
  const blank = work.prism(work.section([drawKeyOutline()]), 0, thickness);
  return work.own(
    blank.warp((point) => {
      const x = Math.abs(point[0]);
      if (x >= shoulderStart[0] - 0.01 && x <= 7.46)
        point[0] += (Math.sign(point[0]) * 0.6 * point[2]) / thickness;
    }),
  );
}

export function retainedPocket(work, spec, fit, envelope) {
  const c = fit.clipClearance;
  const drawKey = spec.type === 'draw-key';
  // Relieve the undersides of the shoulder entries so a small seam gap is
  // taken up by the four bearing lands during the final insertion stroke.
  const entry = drawKey ? work.section([drawKeyOutline(0.6)]) : envelope;
  const clear = work.own(entry.offset(c, 'Round', 2, 32));
  const roof = RETAINED_SEAT + spec.thickness + (spec.verticalClearance ?? c);
  const approach = work.prism(clear, -1, roof);
  const [y0, y1] = drawKey ? [3.0, 4.35] : [6.25, 7.0];
  const boundary = (y) =>
    drawKey
      ? shoulderStart[0] +
        ((y - shoulderStart[1]) * (shoulderEnd[0] - shoulderStart[0])) /
          (shoulderEnd[1] - shoulderStart[1])
      : 20;
  // Even these load-bearing faces need an adjustable running fit, especially
  // for a rigid key. Its four long shoulders bound the remaining seam play.
  const bearingGap = Math.max(0.06, Math.min(0.18, c * 0.65));
  const lands = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const loop = [
        [boundary(y0) - 1.1, y0],
        [boundary(y0) - bearingGap, y0],
        [boundary(y1) - bearingGap, y1],
        [boundary(y1) - 1.1, y1],
      ];
      const bearing = work.section([loop.map(([x, y]) => [sx * x, sy * y])]);
      lands.push(work.prism(bearing, RETAINED_SEAT, roof));
    }
  }
  const turn = keeperPocket(work, c);
  const chambers = spec.keeperOffsets.map((offset) =>
    offset ? work.own(turn.translate([offset, 0, 0])) : turn,
  );
  return work.union([work.cut(approach, lands), ...chambers]);
}
