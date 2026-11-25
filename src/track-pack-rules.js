import { defaultTrack } from './track.js';
import { braidSpan } from './geometry/solids.js';
import { TRACKSIDE_DEFAULTS, validateTrackside } from './geometry/trackside.js';
import { validatePaint } from './geometry/paint-guides.js';
import { MARKING_DEFAULTS } from './markings-controls.js';
import { TEXTURE_DEFAULTS, validateRoadTexture } from './geometry/road-texture.js';

// The white lines and kerbstones every piece of a pack starts with. Optional,
// like its trackside accessories.
export function validatePackMarkings(markings) {
  if (
    !markings ||
    typeof markings !== 'object' ||
    Array.isArray(markings) ||
    Object.keys(markings).some((key) => !Object.hasOwn(MARKING_DEFAULTS, key))
  )
    throw Error('The track pack contains unknown marking settings.');
  const all = { ...MARKING_DEFAULTS, ...markings };
  validatePaint({ ...defaultTrack(), ...all });
  if (!['none', 'road', 'free', 'both'].includes(all.kerbEdge))
    throw Error('Choose a border edge for the kerbstones.');
  if (!['inner', 'outer', 'both'].includes(all.kerbSide))
    throw Error('Choose which borders carry kerbstones.');
  for (const [key, name, max] of [
    ['kerbWidth', 'Kerbstone stripe width', 2000],
    ['kerbLength', 'Kerbstone block length', 20000],
  ])
    if (!Number.isFinite(all[key]) || all[key] < 0.1 || all[key] > max)
      throw Error(name + ' must be between 0.1 and ' + max + ' mm.');
  return all;
}
// The trackside accessories every piece of a pack starts with. Optional: a
// pack without them leaves each piece as it is.
// The road surface texture of a pack. Whether its joints are too deep for a
// piece is checked on each piece, which has its own deck.
export function validatePackTexture(texture) {
  if (
    !texture ||
    typeof texture !== 'object' ||
    Array.isArray(texture) ||
    Object.keys(texture).some((key) => !Object.hasOwn(TEXTURE_DEFAULTS, key))
  )
    throw Error('The track pack contains unknown texture settings.');
  const all = { ...TEXTURE_DEFAULTS, ...texture };
  validateRoadTexture({ ...defaultTrack(), kind: 'straight', hollow: false, height: 100, ...all });
  return all;
}

// The borders of a pack: for its plain straights and corners. One width at
// the ends of every piece, so the borders of two pieces meet; a corner can
// be wider at its apex, a straight keeps the same width all along.
export const BORDER_DEFAULTS = Object.freeze({
  borderSide: 'none',
  borderWidth: 22,
  borderApexWidth: 35,
  borderMount: 'none',
  borderJoint: 'none',
});
const BORDER_SIDES = ['none', 'outer', 'inner', 'both'];
const BORDER_CONNECTIONS = ['none', 'tabs', 'clips', 'both'];
export function validatePackBorders(borders) {
  if (
    !borders ||
    typeof borders !== 'object' ||
    Array.isArray(borders) ||
    Object.keys(borders).some((key) => !Object.hasOwn(BORDER_DEFAULTS, key))
  )
    throw Error('The track pack contains unknown border settings.');
  const all = { ...BORDER_DEFAULTS, ...borders };
  if (!BORDER_SIDES.includes(all.borderSide)) throw Error('Choose a side for the borders.');
  for (const [key, name] of [
    ['borderWidth', 'Border width'],
    ['borderApexWidth', 'Apex width on corners'],
  ])
    if (!Number.isFinite(all[key]) || all[key] < 0 || all[key] > 2000)
      throw Error(name + ' must be between 0 and 2000 mm.');
  if (all.borderSide !== 'none' && !(all.borderWidth > 0))
    throw Error('Give the borders a width at the ends of the pieces.');
  for (const [key, name] of [
    ['borderMount', 'Attach to road'],
    ['borderJoint', 'Join border ends'],
  ])
    if (!BORDER_CONNECTIONS.includes(all[key])) throw Error('Choose a connection for ' + name + '.');
  return all;
}
/** Whether a piece takes the borders of its pack: plain straights and corners. */
export const takesPackBorders = (params) =>
  ['straight', 'curve'].includes(params.kind) && !params.special;
/** The piece settings for the borders of a pack, on a straight or a corner. */
export function packBorderParams(borders, kind) {
  const b = { ...BORDER_DEFAULTS, ...borders };
  return {
    borderSide: b.borderSide,
    borderEntry: b.borderWidth,
    borderExit: b.borderWidth,
    borderApex: kind === 'curve' ? b.borderApexWidth : b.borderWidth,
    // One apex for both sides, in the middle of the piece.
    apexPosition: 0.5,
    innerApexWidth: undefined,
    outerApexWidth: undefined,
    innerApexPosition: undefined,
    outerApexPosition: undefined,
    borderMount: b.borderMount,
    borderJoint: b.borderJoint,
  };
}
/** Gives a straight or a corner the borders of its pack, in place. */
export function applyPackBorders(params, borders) {
  for (const [key, value] of Object.entries(packBorderParams(borders, params.kind)))
    if (value === undefined) delete params[key];
    else params[key] = value;
  return params;
}

export function validatePackTrackside(trackside) {
  if (
    !trackside ||
    typeof trackside !== 'object' ||
    Array.isArray(trackside) ||
    Object.keys(trackside).some((key) => !Object.hasOwn(TRACKSIDE_DEFAULTS, key))
  )
    throw Error('The track pack contains unknown trackside settings.');
  const all = { ...TRACKSIDE_DEFAULTS, ...trackside };
  validateTrackside(all);
  return all;
}

export function defaultPackRules() {
  return {
    width: 200,
    lanes: 2,
    laneSpacing: 100,
    r1InnerRadius: 200,
    angle: 45,
  };
}

export function validatePackRules(rules, profile) {
  const defaults = defaultPackRules();
  if (
    !rules ||
    typeof rules !== 'object' ||
    Array.isArray(rules) ||
    Object.keys(rules).some((key) => !['trackside', 'markings', 'texture', 'borders'].includes(key) && !Object.hasOwn(defaults, key))
  )
    throw Error('The track pack contains unknown design rules.');
  for (const [key, name, min, max] of [
    ['width', 'Road width', 2, 5000],
    ['lanes', 'Lane count', 1, 8],
    ['laneSpacing', 'Slot spacing', 0.1, 1000],
    ['r1InnerRadius', 'R1 inner road edge radius', 0.1, 20000],
    ['angle', 'Curve angle', 0.1, 359],
  ]) {
    if (!Number.isFinite(rules[key]) || rules[key] < min || rules[key] > max)
      throw Error(name + ' must be between ' + min + ' and ' + max + '.');
  }
  if (!Number.isInteger(rules.lanes))
    throw Error('Lane count must be a whole number.');
  if (rules.r1InnerRadius + rules.width / 2 > 20000)
    throw Error('The centre radius of R1 must be at most 20,000 mm.');
  const p = profile ? { ...defaultTrack(), ...profile } : null;
  const channel = p ? p.slotWidth + 2 * braidSpan(p) : 0;
  if (!Number.isFinite(channel))
    throw Error('Set a valid guide width, braid width and braid offset for the pack.');
  if (
    (rules.lanes - 1) * rules.laneSpacing + channel >= rules.width ||
    (rules.lanes > 1 && channel >= rules.laneSpacing)
  )
    throw Error(
      'The pack lanes and braid recesses need more room. Increase the road width or change the slot spacing.',
    );
  return {
    ...rules,
    ...(rules.trackside !== undefined && { trackside: validatePackTrackside(rules.trackside) }),
    ...(rules.markings !== undefined && { markings: validatePackMarkings(rules.markings) }),
    ...(rules.texture !== undefined && { texture: validatePackTexture(rules.texture) }),
    ...(rules.borders !== undefined && { borders: validatePackBorders(rules.borders) }),
  };
}

// Old libraries store physical recipes but lack design rules. Interpret names
// such as R4 using the same nested width formula as the piece designer.
export function rulesFromPieces(pieces, name) {
  const defaults = defaultPackRules();
  const native = pieces.filter(({ track }) =>
    ['straight', 'curve'].includes(track?.params?.kind),
  );
  const base = (native[0] ?? pieces[0])?.track?.params;
  if (!base) return defaults;
  const curves = native.filter(
    ({ track }) =>
      track.params.kind === 'curve' && track.params.width === base.width,
  );
  let minimum = Infinity;
  for (const { track, name } of curves) {
    const index =
      track.curveFamily?.index ?? Number(/^R([1-8])\b/i.exec(name)?.[1] ?? 1);
    const inner =
      track.curveFamily?.r1InnerRadius ??
      track.params.radius - (index - 0.5) * base.width;
    if (Number.isFinite(inner) && inner >= 0.1)
      minimum = Math.min(minimum, inner);
  }
  const derived = {
    width: base.width,
    lanes: base.lanes,
    laneSpacing: base.laneSpacing,
    r1InnerRadius: Number.isFinite(minimum) ? minimum : defaults.r1InnerRadius,
    angle: curves[0]?.track.params.angle ?? defaults.angle,
  };
  const originalStarter =
    name === 'SlotForge Basic' &&
    derived.angle === 30 &&
    ['width', 'lanes', 'laneSpacing', 'r1InnerRadius'].every(
      (key) => derived[key] === defaults[key],
    ) &&
    curves.some((piece) => piece.name === 'R1 corner') &&
    curves.some((piece) => piece.name === 'R6 corner');
  if (originalStarter) derived.angle = defaults.angle;
  try {
    return validatePackRules(derived);
  } catch {
    return defaults;
  }
}
