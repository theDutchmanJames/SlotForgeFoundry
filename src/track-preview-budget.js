export const PREVIEW_FACES = 18000;

// Share the triangle budget among parts. Small clips keep all their faces.
export function faceBudgets(counts, limit) {
  const budgets = new Array(counts.length);
  const order = counts.map((_, i) => i).sort((a, b) => counts[a] - counts[b]);
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    budgets[i] = Math.min(counts[i], Math.floor(limit / (order.length - k)));
    limit -= budgets[i];
  }
  return budgets;
}
