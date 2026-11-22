import { esc, field } from './ui.js';

function roadMap(plan) {
  let x = Infinity,
    y = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const paths = plan.sections.map(({ outlines: [loop] }) => {
    for (const [px, py] of loop) {
      x = Math.min(x, px);
      x1 = Math.max(x1, px);
      y = Math.min(y, py);
      y1 = Math.max(y1, py);
    }
    const d = loop
      .map(([px, py]) => `${px.toFixed(3)},${(-py).toFixed(3)}`)
      .join(' ');
    return `<polygon points="${d}" fill="var(--d-track)" stroke="var(--d-track-edge)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  });
  const mark = Math.max(x1 - x, y1 - y) * 0.035,
    pad = mark * 1.5;
  const bridges = plan.crossings.map((c) => {
    const [px, py] = c.point,
      [dx, dy] = c[c.upperPass + 'Direction'];
    return `<circle cx="${px}" cy="${-py}" r="${mark}" fill="var(--panel)"/><path d="M ${px - dx * mark} ${-py + dy * mark} l ${2 * dx * mark} ${-2 * dy * mark}" stroke="var(--d-focus)" stroke-width="${mark * 0.65}" stroke-linecap="round"/>`;
  });
  return `<svg width="100%" height="180" role="img" aria-label="Flat road passages with the upper route marked at each crossing" viewBox="${x - pad} ${-y1 - pad} ${x1 - x + 2 * pad} ${y1 - y + 2 * pad}">${paths.join('')}${bridges.join('')}</svg>`;
}

export function showFlatImport({
  showDialog,
  closeDialog,
  width,
  initial,
  inspect,
  apply,
  original,
  hasDeck,
  onError,
}) {
  showDialog(
    'Crossings in the Circuit drawing',
    `<div id="flat-import"><div data-flat-result aria-live="polite"></div>
    ${field('passageWidth', 'Road width per passage', width, 'mm', { min: 2, max: 5000 })}
    <p class="hint">Each road follows its slot paths at the width above. Highlighted passages go over on separate supports.</p>
    <div class="dialog-actions">${hasDeck ? '<button type="button" data-flat-original>Use original deck</button>' : ''}
    <button type="button" class="primary" data-flat-install>Flat pieces on supports</button></div></div>`,
  );
  const form = document.querySelector('#flat-import'),
    input = form.querySelector('input');
  const result = form.querySelector('[data-flat-result]'),
    applyButton = form.querySelector('[data-flat-install]');
  let version = 0,
    current,
    timer;
  function draw(data) {
    current = data?.flatCrossing;
    applyButton.disabled = !current;
    const count = current?.crossings.length;
    result.innerHTML = current
      ? `<p>${count} ${count === 1 ? 'crossing' : 'crossings'} · ${current.sections.length} separate flat passages</p>${data.heightNote ? `<p class="hint">${esc(data.heightNote)}</p>` : ''}${roadMap(current)}`
      : `<p class="selection-note">${esc(data?.warning ?? 'No crossing was identified.')}</p>`;
  }
  draw(initial);
  input.addEventListener('input', () => {
    const token = ++version;
    clearTimeout(timer);
    current = null;
    applyButton.disabled = true;
    result.textContent = input.validity.valid
      ? 'Checking road width…'
      : 'Enter a road width between 2 and 5000 mm.';
    if (!input.validity.valid) return;
    timer = setTimeout(async () => {
      if (!form.isConnected || !form.closest('dialog')?.open) return;
      try {
        const data = await inspect(input.valueAsNumber);
        if (token === version) draw(data);
      } catch (error) {
        if (token === version) draw({ warning: error.message });
      }
    }, 160);
  });
  applyButton.onclick = () => {
    if (!current || !input.reportValidity()) return;
    closeDialog();
    apply(current, input.valueAsNumber).catch(onError);
  };
  const deck = form.querySelector('[data-flat-original]');
  if (deck)
    deck.onclick = () => {
      closeDialog();
      original().catch(onError);
    };
}
