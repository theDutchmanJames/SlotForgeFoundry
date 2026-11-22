import { clipSpec, currentClipType } from './clip-types.js';

export const JOINT_FIT_DEFAULTS = Object.freeze({
  jointFitVersion: 2,
  tabClearance: 0.15,
  clipClearance: 0.15,
  tabWidth: 6,
  tabLength: 6,
});
export const TAB_SIZE_LIMITS = Object.freeze({
  width: Object.freeze([2, 24]),
  length: Object.freeze([2, 24]),
  thickness: Object.freeze([0.6, 120]),
});
export const JOINT_FIT_LIMITS = Object.freeze({
  tab: Object.freeze([0.03, 0.8]),
  clip: Object.freeze([0.03, 0.4]),
});
export const JOINT_FIT_MIN_HEIGHT = 8;
export const CLIP_TABLE_CLEARANCE = 0.3;
const TAB_SKIN = 0.4;

export function currentJointSettings(p) {
  const clipType = currentClipType(p.clipType);
  if (p.jointFitVersion == null || p.jointFitVersion === 1) {
    const gap = p.clipClearance ?? 0.25;
    return {
      ...p,
      jointFitVersion: 2,
      clipType,
      tabClearance: gap,
      clipClearance: Math.min(gap, JOINT_FIT_LIMITS.clip[1]),
    };
  }
  return clipType === p.clipType ? p : { ...p, clipType };
}

/** Resolve the saved profile before applying defaults from the current app. */
export function resolveJointFit(params = {}) {
  const version = params.jointFitVersion ?? 1;
  if (![1, 2].includes(version)) throw Error('Unknown connector fit version.');
  const clipClearance =
    params.clipClearance ??
    (version === 1 ? 0.25 : JOINT_FIT_DEFAULTS.clipClearance);
  const tabClearance =
    version === 1
      ? clipClearance
      : (params.tabClearance ?? JOINT_FIT_DEFAULTS.tabClearance);
  const height = params.height ?? 12;
  const tabWidth =
    version === 2 ? (params.tabWidth ?? JOINT_FIT_DEFAULTS.tabWidth) : 6;
  const tabLength =
    version === 2 ? (params.tabLength ?? JOINT_FIT_DEFAULTS.tabLength) : 6;
  const explicitThickness = version === 2 && params.tabThickness != null;
  const tabThickness = explicitThickness ? params.tabThickness : height * 0.23;
  // Preserve the mating centre when an automatic thickness becomes fixed.
  const tabBottom = explicitThickness
    ? height * 0.435 - tabThickness / 2
    : height * 0.32;
  const tabTop = explicitThickness ? tabBottom + tabThickness : height * 0.55;
  const tabRootLength = Math.max(4, (tabLength * 2) / 3);
  const clipWidth = (version === 2 && clipSpec(params)?.width) || 5;
  return {
    version,
    tabClearance,
    clipClearance,
    tabWidth,
    tabLength,
    tabThickness,
    tabBottom,
    tabTop,
    tabRootLength,
    tabRootSupportDepth: tabRootLength + 2,
    tabSocketSupportDepth: tabLength + 2,
    tabSupportHalfWidth: tabWidth / 2 + 2,
    tabSocketDepth: tabLength + tabClearance,
    tabSocketHeight: tabThickness + 2 * tabClearance,
    tabMaxClearance: Math.min(
      JOINT_FIT_LIMITS.tab[1],
      tabBottom - TAB_SKIN,
      height - tabTop - TAB_SKIN,
    ),
    clipWidth,
    tabSocketWidth: tabWidth + 2 * tabClearance,
    // Version one's bridge and arms have different widths and pocket sizes.
    clipSocketWidth: (version === 1 ? 5.2 : clipWidth) + 2 * clipClearance,
  };
}

/** The seat must leave a continuous floor and roof around its clearance. */
export function validateTabSize(params, checkHeight = true) {
  const fit = resolveJointFit(params);
  if (fit.version !== 2) return;
  for (const [key, limits] of Object.entries(TAB_SIZE_LIMITS)) {
    if (key === 'thickness' && params.tabThickness == null) continue;
    const name = 'tab' + key[0].toUpperCase() + key.slice(1);
    const size = fit[name];
    if (!Number.isFinite(size) || size < limits[0] || size > limits[1])
      throw new Error(
        `Tab ${key} must be between ${limits[0]} and ${limits[1]} mm.`,
      );
  }
  if (checkHeight && fit.tabClearance > fit.tabMaxClearance + 1e-9)
    throw new Error(
      'The tab socket needs at least 0.40 mm of material above and below it. Reduce tab thickness or clearance, or increase track height.',
    );
}
