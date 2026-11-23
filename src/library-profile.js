import {
  defaultTrack,
  trackParameters,
  validateTrack,
  buildTrack,
  TRACK_PROFILE_LIMITS,
  CONNECTOR_MODES,
} from './track.js';
import { importedTrackPaths } from './geometry/import-track.js';
import { JOINT_FIT_LIMITS, TAB_SIZE_LIMITS } from './geometry/joint-fit.js';
import { clipSpec, currentClipType } from './geometry/clip-types.js';
import {
  SCREW_CLIP_LABELS,
  SCREW_CLIP_LIMITS,
  SCREW_DIRECTIONS,
} from './geometry/screw-clip.js';
import { checkProject, newProject } from './project.js';
import { refreshCustomTrack } from './custom-track.js';
import { defaultPackRules } from './track-pack-rules.js';
import { defaultStartingGrid } from './geometry/starting-grid.js';

// A recipe owns its drawing, centreline, connectors' locations and print
// segments. A collection can link any subset of these physical dimensions.
const sizes = {
  ...TRACK_PROFILE_LIMITS,
  tabWidth: TAB_SIZE_LIMITS.width,
  tabLength: TAB_SIZE_LIMITS.length,
  tabThickness: TAB_SIZE_LIMITS.thickness,
  tabClearance: JOINT_FIT_LIMITS.tab,
  clipClearance: JOINT_FIT_LIMITS.tab, // Version one used the wider tab range.
};
// The Kevan Sideclip settings. A pack that never set them leaves them out.
const screwSizes = SCREW_CLIP_LIMITS;
export const SCREW_PROFILE_FIELDS = Object.freeze([...Object.keys(screwSizes), 'screwDirection']);
export const SHARED_PROFILE_FIELDS = Object.freeze([
  ...Object.keys(sizes),
  'hollow',
  'reinforcement',
  'roadCentreLine',
  'joint',
  'clipType',
  'jointFitVersion',
  ...SCREW_PROFILE_FIELDS,
]);
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateLibraryProfile(profile) {
  if (!record(profile)) throw Error('The collection needs a shared profile.');
  // A sparse collection links only the settings present in its profile.
  if (Object.hasOwn(profile, 'clipType'))
    profile = { ...profile, clipType: currentClipType(profile.clipType) };
  if (profile.jointFitVersion === 1) {
    profile = { ...profile, jointFitVersion: 2 };
    if (Number.isFinite(profile.clipClearance)) {
      profile.tabClearance = profile.clipClearance;
      profile.clipClearance = Math.min(
        profile.clipClearance,
        JOINT_FIT_LIMITS.clip[1],
      );
    }
  }
  for (const [key, value] of Object.entries(profile)) {
    if (!SHARED_PROFILE_FIELDS.includes(key))
      throw Error('Unknown collection profile setting: ' + key);
    if (key === 'tabThickness' && value === null) continue;
    if (SCREW_PROFILE_FIELDS.includes(key)) {
      if (value === null) continue;
      if (key === 'screwDirection') {
        if (!SCREW_DIRECTIONS.includes(value))
          throw Error('Choose from the top, from the bottom or per road side for the screws.');
        continue;
      }
      const [min, max] = screwSizes[key];
      if (!Number.isFinite(value) || value < min || value > max)
        throw Error(SCREW_CLIP_LABELS[key] + ' must be between ' + min + ' and ' + max + '.');
      continue;
    }
    if (key === 'hollow') {
      if (typeof value !== 'boolean')
        throw Error('Choose a hollow or solid track body.');
    } else if (key === 'reinforcement') {
      if (typeof value !== 'boolean') throw Error('Choose whether to reinforce the underside.');
    } else if (key === 'roadCentreLine') {
      if (!['none', 'solid', 'dashed'].includes(value))
        throw Error('Choose off, solid or dashed for the centre line.');
    } else if (key === 'joint') {
      if (!CONNECTOR_MODES.includes(value))
        throw Error('Choose a valid road connector mode.');
    } else if (key === 'clipType') {
      if (
        value !== null &&
        (typeof value !== 'string' || !clipSpec({ clipType: value }))
      )
        throw Error('Choose a valid collection clip type.');
    } else if (key === 'jointFitVersion') {
      if (![1, 2].includes(value))
        throw Error('Unknown connector fit version.');
    } else {
      const [min, max] =
        key === 'clipClearance' && profile.jointFitVersion === 2
          ? JOINT_FIT_LIMITS.clip
          : sizes[key];
      if (!Number.isFinite(value) || value < min || value > max)
        throw Error(`${key} must be between ${min} and ${max} mm.`);
    }
  }
  if (
    profile.slotDepth >= profile.height ||
    (profile.hollow && profile.slotDepth + profile.wall > profile.height)
  )
    throw Error(
      'Slot depth leaves insufficient material below the guide slot.',
    );
  if (profile.hollow && profile.deck >= profile.height)
    throw Error('The deck must leave space inside the hollow body.');
  if (
    profile.braidDepth > profile.slotDepth ||
    profile.braidDepth >= profile.height ||
    (profile.hollow && profile.braidDepth >= profile.deck)
  )
    throw Error(
      'The braid recess must stay within the deck and above the slot floor.',
    );
  return profile;
}

export function profileFromTrack(track) {
  const p = trackParameters(track.params);
  return Object.fromEntries(
    SHARED_PROFILE_FIELDS.map((key) => [key, p[key] ?? null]).filter(
      ([key, value]) => value !== null || !SCREW_PROFILE_FIELDS.includes(key),
    ),
  );
}

export function trackWithProfile(track, profile = {}) {
  if (!record(track?.params))
    throw Error('A library piece needs editable track settings.');
  profile = validateLibraryProfile(profile);
  const recipe = structuredClone(track);
  recipe.params = trackParameters({ ...recipe.params, ...profile });
  const resolved = recipe.custom ? refreshCustomTrack(recipe) : recipe;
  checkProject({ ...newProject(), track: resolved });
  const p = resolved.params;
  validateLibraryProfile(profileFromTrack(resolved));
  validateTrack(p);
  if (p.kind === 'import') importedTrackPaths(p, resolved.plan);
  return resolved;
}

// Run inside the geometry worker before committing a collection change.
// This catches collisions at the real tab positions, plus short or narrow
// pieces whose shared dimensions would make printable joints impossible.
export function validateLibraryTrack(wasm, track) {
  const recipe = trackWithProfile(track);
  const parts = buildTrack(wasm, recipe.params, recipe.plan);
  for (const part of parts) part.solid.delete();
  return true;
}

export function starterPack(lanes = 2) {
  const singleLane = lanes === 1;
  const rules = defaultPackRules();
  if (singleLane) Object.assign(rules, { width: 100, lanes: 1, angle: 30 });
  const common = {
    ...defaultTrack(),
    width: rules.width,
    lanes: rules.lanes,
    laneSpacing: rules.laneSpacing,
    height: 10,
    hollow: true,
    deck: 2,
    wall: 2,
    slotWidth: 3,
    slotDepth: 8,
    braidWidth: 5,
    braidDepth: 0.5,
    braidGap: 0.6,
    joint: 'clips',
    // A centred guide occupies the middle of the joint. Flanking clips let
    // either end mate to either end of another single-lane piece.
    ...(singleLane ? { connectorCounts: { seamClips: 2 } } : {}),
  };
  const piece = (name, shape) => ({
    name,
    track: {
      params: { ...structuredClone(common), ...shape },
      plan: null,
      sourceName: '',
    },
  });
  const pieces = [
    piece('Full straight', { kind: 'straight', length: 200 }),
    piece('Half straight', { kind: 'straight', length: 100 }),
    piece('Quarter straight', { kind: 'straight', length: 50 }),
    piece('Starting grid', {
      kind: 'straight', length: 200,
      startingGrid: defaultStartingGrid({ ...common, kind: 'straight', length: 200 }),
    }),
  ];
  // Both families start on the same inner edge and use the same angular
  // tessellation. Two nested single-lane roads span one two-lane road.
  const printSegments = singleLane ? [1, 1, 2, 2, 2, 3] : [2, 4, 5, 6, 7, 9];
  for (const [i, segments] of printSegments.entries()) {
    pieces.push(
      piece('R' + (i + 1) + ' corner', {
        kind: 'curve',
        radius: rules.r1InnerRadius + (i + 0.5) * common.width,
        angle: 30,
        segments,
        ...(singleLane ? { borderSegments: segments } : {}),
        curveGridRadius: 1400,
      }),
    );
  }
  return {
    name: singleLane ? 'SlotForge Basic Single Lane' : 'SlotForge Basic',
    rules,
    profile: profileFromTrack(pieces[0].track),
    pieces,
  };
}
