// The special pieces a track pack can offer, built from its rules. Track Set's
// specials shelf and the Planner's Specials tab both read them from here.
import { defaultTrack } from './track.js';
import { SPECIAL_PIECES, specialTrackParams } from './special-pieces.js';

// Short names for tiles; the piece itself keeps the full name.
export const SPECIAL_SHORT_NAMES = Object.freeze({
  hairpin: 'Hairpin',
  pit: 'Pit lane',
  diamond: 'Diamond',
  duel: 'Duel',
  chicane: 'Chicane',
  timing: 'Timing',
});

// The hairpin and the duel cross or race two lanes, so they need two.
const TWO_LANE_ONLY = new Set(['hairpin', 'duel']);

export function specialsFor(lanes) {
  return SPECIAL_PIECES.filter(([type]) => !TWO_LANE_ONLY.has(type) || lanes === 2);
}

// A special piece on the pack's rules, taken from its first plain straight.
export function packSpecialTrack(collection, type) {
  const base =
    collection.pieces.find(
      (p) => p.track.params.kind === 'straight' && !p.track.params.special,
    )?.track.params ??
    collection.pieces[0]?.track.params ??
    // An empty pack: its rules on the default piece, never the piece that
    // happens to be open in Track Set.
    defaultTrack().params;
  return {
    params: specialTrackParams(type, {
      ...base,
      width: collection.rules.width,
      lanes: collection.rules.lanes,
      laneSpacing: collection.rules.laneSpacing,
    }),
    plan: null,
  };
}
