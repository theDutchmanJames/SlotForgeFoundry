// The special pieces a track pack can offer, built from its rules. Track Set's
// specials shelf and the Planner's Specials tab both read them from here.
import { defaultTrack } from './track.js';
import { SINGLE_LANE_SPECIALS, SPECIAL_PIECES, specialTrackParams } from './special-pieces.js';

// Short names for tiles; the piece itself keeps the full name.
export const SPECIAL_SHORT_NAMES = Object.freeze({
  hairpin: 'Hairpin',
  pit: 'Pit lane',
  diamond: 'Diamond',
  duel: 'Duel',
  chicane: 'Chicane',
  timing: 'Timing',
  turnout: 'Turnout',
});

// The hairpin and the duel cross or race two lanes, so they need two.
const TWO_LANE_ONLY = new Set(['hairpin', 'duel']);

export function specialsFor(lanes) {
  return SPECIAL_PIECES.filter(([type]) => !TWO_LANE_ONLY.has(type) || lanes === 2);
}

// The shelf of a single-lane pack, in Track Set and in the Planner, also
// offers the pieces made for one lane.
export function shelfSpecialsFor(lanes) {
  return [...specialsFor(lanes), ...(lanes === 1 ? SINGLE_LANE_SPECIALS : [])];
}

// The Planner also offers an end stop with the specials: the pack's
// shortest plain straight with its slots stopped short of end B.
export const END_STOP = 'endstop';
export function packEndStopTrack(collection) {
  const straights = collection.pieces
    .map((p) => p.track)
    .filter((track) => track.params.kind === 'straight' && !track.params.special && !track.params.endStop);
  const base = straights.sort((a, b) => a.params.length - b.params.length)[0] ?? {
    params: {
      ...defaultTrack(),
      kind: 'straight',
      width: collection.rules.width,
      lanes: collection.rules.lanes,
      laneSpacing: collection.rules.laneSpacing,
    },
    plan: null,
  };
  const track = structuredClone(base);
  Object.assign(track.params, { endStop: true, segments: 1, borderSegments: 1 });
  delete track.params.startingGrid;
  return track;
}

// A special piece on the pack's rules, taken from its first plain straight.
export function packSpecialTrack(collection, type) {
  if (type === END_STOP) return packEndStopTrack(collection);
  const base =
    collection.pieces.find(
      (p) => p.track.params.kind === 'straight' && !p.track.params.special,
    )?.track.params ??
    collection.pieces[0]?.track.params ??
    // An empty pack: its rules on the default piece, never the piece that
    // happens to be open in Track Set.
    defaultTrack();
  return {
    params: specialTrackParams(type, {
      ...base,
      ...collection.rules.trackside,
      ...collection.rules.markings,
      width: collection.rules.width,
      lanes: collection.rules.lanes,
      laneSpacing: collection.rules.laneSpacing,
    }, collection.rules),
    plan: null,
  };
}
