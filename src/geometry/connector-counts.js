import { connectorWarning } from './connector-warning.js';

// Keep the more numerous type on the outside for a mixed odd row. At equal
// counts the first clip consistently sits on the low-coordinate side.
function sequence(tab, clip) {
  const first = clip >= tab ? 'clip' : 'tab';
  const second = first === 'clip' ? 'tab' : 'clip';
  const total = tab + clip;
  const a = Math.max(tab, clip);
  const b = Math.min(tab, clip);
  if (!b) return Array(total).fill(first);
  const result = Array(total).fill(first);
  for (let i = 0; i < b; i++) {
    const index = a === b ? 2 * i + 1 : Math.round(((i + 1) * (total - 1)) / (b + 1));
    result[index] = second;
  }
  return result;
}

function groupedStations(stations) {
  const positions = { tab: [], clip: [] };
  for (const { type, value } of stations) positions[type].push(value);
  return positions;
}

// Search a row's spread as a unit. Individually nudging blocked stations
// would put a three-clip row off-centre and move the mating pockets apart.
export function planConnectorRow(request, { domain, length, halfAt, blocked, location, checkRow, settingFor }) {
  const order = sequence(request.tab.count, request.clip.count);
  const span = domain[1] - domain[0];
  const middle = (domain[0] + domain[1]) / 2;
  const mm = length / span;
  const fixed = {
    tab: request.tab.fixed?.slice().sort((a,b) => a - b),
    clip: request.clip.fixed?.slice().sort((a,b) => a - b),
  };
  function stations(reach) {
    const used = { tab: 0, clip: 0 };
    return order.map((type, i) => {
      const fraction = order.length === 1 ? 0 : 2 * i / (order.length - 1) - 1;
      const value = fixed[type]?.[used[type]] ?? middle + reach * fraction;
      used[type]++;
      return { type, value };
    });
  }
  const reasons = new Map();
  function reason(type, value) {
    const key = type + '/' + value;
    if (!reasons.has(key)) reasons.set(key, blocked(type, value));
    return reasons.get(key);
  }
  function problem(row) {
    const occupied = [];
    for (const {type, value} of row) {
      const obstacle = reason(type, value);
      if (obstacle) return obstacle;
      const half = halfAt(type, value);
      if (occupied.some(other => Math.abs(value - other.value) * mm < half + other.half + 0.2 - 1e-8))
        return 'The connector supports would overlap.';
      occupied.push({value, half});
    }
    return checkRow?.(row);
  }
  const preferred = 0.36;
  const initial = stations(preferred * span);
  function fail(detail, centred, type) {
    const error = connectorWarning(
      location,
      (centred ? 'The centre position is blocked. ' : 'The requested connector layout does not fit. ') + detail,
      centred ? 'Choose two outside positions or adjust the joint dimensions.' :
        'Reduce the clip or tab count, adjust the joint dimensions, or place the connectors manually.',
      settingFor?.(type) ?? {tab: 'joints', field: 'joint', label: 'Edit connections'},
    );
    error.proposedPositions = groupedStations(initial);
    return error;
  }
  if (order.length % 2) {
    const centre = initial[(order.length - 1) / 2];
    const detail = reason(centre.type, centre.value);
    if (detail && !fixed[centre.type]) throw fail(detail, true, centre.type);
  }
  const firstProblem = problem(initial);
  if (!firstProblem) return groupedStations(initial);
  if (order.length > 1) {
    // Move the outer pair together, testing spreads nearest to the preferred one first.
    const steps = Math.min(600, Math.max(80, Math.ceil(length)));
    const targets = Array.from({length: steps}, (_, i) => (i + 1) / (2 * steps));
    targets.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
    for (const fraction of targets) {
      const row = stations(fraction * span);
      if (!problem(row)) return groupedStations(row);
    }
  }
  const editable = order.filter(type => !fixed[type]);
  throw fail(firstProblem, false, editable.sort((a,b) => request[b].count - request[a].count)[0]);
}
