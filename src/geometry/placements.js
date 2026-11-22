// Road positions are signed millimetres across a seam. Border positions are
// fractions of segment length (side) or border width (end).
export const placementKeys = {
  startTabs: 'Start tabs',
  startClips: 'Start clips',
  seamTabs: 'Seam tabs',
  seamClips: 'Seam clips',
  finishTabs: 'Finish tabs',
  finishClips: 'Finish clips',
  sideTabs: 'Side tabs',
  sideClips: 'Side clips',
  endTabs: 'Border end tabs',
  endClips: 'Border end clips',
};
for (const side of ['inner', 'outer'])
  for (const scope of ['side', 'end'])
    for (const kind of ['Tabs', 'Clips']) {
      const shared = scope + kind;
      placementKeys[side + shared[0].toUpperCase() + shared.slice(1)] =
        (side === 'inner' ? 'Inside' : 'Outside') +
        ' border ' +
        scope +
        ' ' +
        kind.toLowerCase();
    }
export const isFraction = (key) => /^(?:side|end|inner|outer)/.test(key);

export function positionKey(scope, type, side) {
  const shared = scope + (type === 'tab' ? 'Tabs' : 'Clips');
  return side && isFraction(shared)
    ? side + shared[0].toUpperCase() + shared.slice(1)
    : shared;
}
export function configuredPositions(p, scope, type, side) {
  const key = positionKey(scope, type, side);
  if (p.mutedPlacements?.includes(key)) return [];
  if (p.placements?.[key] !== undefined) return p.placements[key];
  if (p.connectorCounts?.[key] !== undefined) return undefined;
  return p.placements?.[positionKey(scope, type)];
}

export function configuredCount(p, scope, type, side) {
  const counts = p.connectorCounts;
  return counts?.[positionKey(scope, type, side)] ??
    counts?.[positionKey(scope, type)] ??
    ((scope === 'start' || scope === 'finish') ? counts?.[positionKey('seam', type)] : undefined);
}

export function defaultConnectorCount(scope, type) {
  return scope !== 'end' && type === 'tab' ? 2 : 1;
}

export function connectorCount(p, scope, type, side) {
  return configuredPositions(p, scope, type, side)?.length ??
    configuredCount(p, scope, type, side) ?? defaultConnectorCount(scope, type);
}

export function countWarningSetting(p, scope, type) {
  const override = scope === 'start' ? 'jointStart' : scope === 'finish' ? 'jointEnd' : null;
  if (override && !p[override] && !p.connectorCounts?.[positionKey(scope, type)]) scope = 'seam';
  return {
    tab: 'joints', field: 'count_' + positionKey(scope, type),
    label: 'Edit ' + (type === 'tab' ? 'tab' : 'clip') + ' count',
  };
}

// A count is an instruction to regenerate a layout as the part changes. A
// manually marked connector keeps its coordinate when its neighbour changes.
export function countedJoint(p, scope, side, mode = activeJointMode(p, scope, side)) {
  const result = {};
  let counted = false;
  for (const type of ['tab', 'clip']) {
    const enabled = mode === 'both' || mode === type + 's';
    const fixed = enabled ? configuredPositions(p, scope, type, side) : undefined;
    const count = enabled ? connectorCount(p, scope, type, side) : 0;
    result[type] = { count, fixed };
    if (enabled && !fixed && configuredCount(p, scope, type, side) !== undefined) counted = true;
  }
  if (!counted) return null;
  if (result.tab.count + result.clip.count > 5)
    throw Error('Choose up to five connectors per joint. For three clips, choose at most two tabs, or reverse the counts.');
  return result;
}

export function validateConnectorCounts(counts) {
  if (counts == null) return;
  if (typeof counts !== 'object' || Array.isArray(counts))
    throw Error('Connector counts must be a set of named quantities.');
  for (const [key, value] of Object.entries(counts)) {
    if (!Object.hasOwn(placementKeys, key) || !Number.isInteger(value) || value < 1 || value > 3)
      throw Error('Choose 1, 2 or 3 for each clip or tab count.');
  }
}

export function configuredPositionKey(p, scope, type, side) {
  const local = positionKey(scope, type, side);
  return p.placements?.[local] !== undefined ? local : positionKey(scope, type);
}
export function jointMode(p, scope) {
  if (scope === 'side') return p.borderMount;
  if (scope === 'end') return p.borderJoint;
  if (scope === 'start') return p.jointStart ?? p.joint;
  if (scope === 'finish') return p.jointEnd ?? p.joint;
  return p.joint;
}

// An omitted list selects the automatic layout; an empty list deliberately
// disables a connector at this joint, even when its shared mode is enabled.
export function activeJointMode(p, scope, side) {
  const mode = jointMode(p, scope);
  const active = (type) =>
    (mode === 'both' || mode === type + 's') &&
    configuredPositions(p, scope, type, side)?.length !== 0;
  return active('clip')
    ? active('tab')
      ? 'both'
      : 'clips'
    : active('tab')
      ? 'tabs'
      : 'none';
}

export function validatePlacements(placements, muted) {
  if (
    muted != null &&
    (!Array.isArray(muted) ||
      muted.length > 8 ||
      new Set(muted).size !== muted.length ||
      muted.some(
        (key) =>
          typeof key !== 'string' ||
          !Object.hasOwn(placementKeys, key) ||
          !/^(inner|outer)(Side|End)(Tabs|Clips)$/.test(key),
      ))
  ) {
    throw Error(
      'Muted placements must be unique inside or outside border connector settings.',
    );
  }
  if (placements == null) return;
  if (typeof placements !== 'object' || Array.isArray(placements))
    throw new Error('Connector positions must be a set of named offsets.');
  for (const [key, positions] of Object.entries(placements)) {
    if (!Object.hasOwn(placementKeys, key))
      throw new Error('Unknown connector position setting.');
    if (!Array.isArray(positions) || positions.length > 8)
      throw new Error(placementKeys[key] + ' accepts up to eight positions.');
    const fraction = isFraction(key);
    for (const x of positions)
      if (
        !Number.isFinite(x) ||
        (fraction ? x <= 0 || x >= 1 : Math.abs(x) > 2500)
      )
        throw new Error(
          placementKeys[key] +
            (fraction
              ? ': enter percentages strictly between 0 and 100.'
              : ': enter valid millimetre offsets.'),
        );
    if (new Set(positions).size !== positions.length)
      throw new Error(placementKeys[key] + ' contains duplicate positions.');
  }
}
