import { defaultTrack } from './track.js';
import { braidSpan } from './geometry/solids.js';
import { TRACKSIDE_DEFAULTS, validateTrackside } from './geometry/trackside.js';

// The trackside accessories every piece of a pack starts with. Optional: a
// pack without them leaves each piece as it is.
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
    Object.keys(rules).some((key) => key !== 'trackside' && !Object.hasOwn(defaults, key))
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
  if (rules.trackside !== undefined)
    return { ...rules, trackside: validatePackTrackside(rules.trackside) };
  return { ...rules };
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
