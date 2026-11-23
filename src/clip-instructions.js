import { CLIP_TABLE_CLEARANCE } from './geometry/joint-fit.js';
import { KEEPER_SHELF, KEEPER_THICKNESS } from './geometry/keeper-dimensions.js';
import { KEEPER_TOOL } from './geometry/keeper-tool.js';
import { screwName, screwSides } from './geometry/screw-clip.js';

const emptyGap = Math.ceil(KEEPER_TOOL.shoulderHeight + KEEPER_TOOL.bladeHeight);
const loadedGap = Math.ceil(KEEPER_TOOL.shoulderHeight + KEEPER_SHELF + KEEPER_THICKNESS - CLIP_TABLE_CLEARANCE);
export const keeperToolAccess =
  `Support the track with about ${emptyGap} mm of space underneath for the tool, or ${loadedGap} mm to carry a loose keeper on its tip.`;

export const lockRetainer =
  'Engage the slot with the keeper tool and press toward the road surface. Looking from underneath, turn clockwise one quarter turn to the stop, then release pressure to seat the wings.';

export function fitRetainer(spec) {
  const offsets = spec.keeperOffsets;
  const location = offsets.length === 2
    ? 'Fit two retainers, one in each piece, ' + Math.abs(offsets[0]) + ' mm from the seam.'
    : 'Fit one retainer over the centre of the draw key.';
  return 'Align the pieces and press the main clip into its open underside pocket. ' +
    location + ' Start with the wings across the seam. ' + keeperToolAccess + ' ' + lockRetainer;
}

// The side screw clip. A border on that side covers the side face, so the
// clip and its screws go in before the border.
export function fitScrewClip(params) {
  const sides = screwSides(params);
  const directions = new Set(sides.map((side) => side.direction));
  const from = directions.size > 1
    ? 'from the top or the bottom, as each road side is set'
    : directions.has('bottom') ? 'from the underside' : 'from the road surface';
  return 'Push the two pieces together. Slide the clip into its pocket from the side face, flat edge outwards, until that edge is flush with the side of the road. ' +
    'Fit one ' + screwName(params) + ' in each piece, ' + from + ', through the countersunk hole. It cuts its thread into the hole in the clip and on into the pilot hole beyond it, and holds the clip tight. Tighten until the head sits flush. ' +
    'Fit the clip and its screws before any border on that side: the border covers the side face.';
}

export const releaseScrewClip =
  'To release, take out both screws, then lever the clip out with a small screwdriver in the notch in its flat edge. Remove a border on that side first.';

export const releaseRetainer =
  'To release, slide the tool in from the edge and press the slotted centre about 0.5 mm toward the road surface. Turn it a quarter turn counter-clockwise as viewed from underneath, then lower the keeper. Remove the main clip once its keepers are free.';
