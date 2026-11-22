import { CLIP_TABLE_CLEARANCE } from './geometry/joint-fit.js';
import { KEEPER_SHELF, KEEPER_THICKNESS } from './geometry/keeper-dimensions.js';
import { KEEPER_TOOL } from './geometry/keeper-tool.js';

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

export const releaseRetainer =
  'To release, slide the tool in from the edge and press the slotted centre about 0.5 mm toward the road surface. Turn it a quarter turn counter-clockwise as viewed from underneath, then lower the keeper. Remove the main clip once its keepers are free.';
