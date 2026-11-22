// All assembled heights are measured from the underside/table plane.
export const KEEPER_RADIUS = 8.65;
export const KEEPER_THICKNESS = 1.6;
export const KEEPER_DRIVE_SLOT = Object.freeze({ length: 4.4, width: 1.3, depth: 0.92 });
export const KEEPER_LIFT = 0.52;
export const KEEPER_SHELF = 1.3;
export const KEEPER_CHAMBER_TOP =
  KEEPER_SHELF + KEEPER_THICKNESS + KEEPER_LIFT + 0.14;
export const RETAINED_SEAT = 3.65;
export const RETAINED_ROOF = 0.65;
export const DRAW_KEY_ROOF = 2;
export const DRAW_KEY_VERTICAL_GAP = 0.15;

export function drawKeySpec(height = 12) {
  const space = height - DRAW_KEY_ROOF - RETAINED_SEAT - DRAW_KEY_VERTICAL_GAP;
  const thickness = Math.max(0, Number(space.toFixed(12)));
  return {
    ...retainedClipSpec('Double-dovetail draw key', 26, 10, thickness),
    minimumHeight: 7.5,
    roofThickness: DRAW_KEY_ROOF,
    verticalClearance: DRAW_KEY_VERTICAL_GAP,
  };
}

export function retainedClipSpec(name, length, width, thickness) {
  // Design for the widest available clearance so changing fit never changes
  // which road heights can accommodate the same physical system.
  const minimumHeight =
    Math.ceil((RETAINED_SEAT + thickness + 0.4 + RETAINED_ROOF) * 2) / 2;
  return {
    name,
    length,
    width,
    thickness,
    minimumHeight,
    retained: true,
    keeperOffsets: [0],
    seatHeight: RETAINED_SEAT,
    roofThickness: RETAINED_ROOF,
    pocketHalfWidth: KEEPER_RADIUS,
    retainerWidth: 2 * KEEPER_RADIUS,
    retainerThickness: KEEPER_THICKNESS,
  };
}
