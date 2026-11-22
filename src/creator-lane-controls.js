import { check, choice, field } from './ui.js';

export function creatorLaneControls() {
  return `<div data-lane-editor>
    ${check('ctAdjustLanes', 'Squeeze / spread lanes', false)}
    <div data-lane-options hidden>
      ${choice('ctLaneMode', 'Adjustment', 'squeeze', [
        ['squeeze', 'Squeeze'],
        ['spread', 'Spread'],
      ])}
      ${field('ctLaneTarget', 'Middle spacing', 80, 'mm', { min: 0.1, max: 1000 })}
      <div data-lane-anchor>${choice('ctLaneAnchor', 'Alignment', 'inner', [
        ['inner', 'Keep inner lane fixed'],
        ['centre', 'Move around centre'],
      ])}</div>
      <p class="hint">Both ends keep their normal lane spacing.</p>
    </div>
  </div>`;
}

export function bindCreatorLaneControls(dialog, previous) {
  const host = dialog.querySelector('[data-lane-editor]');
  const get = (name) => host.querySelector('[name="' + name + '"]');
  const enable = get('ctAdjustLanes'),
    mode = get('ctLaneMode');
  const target = get('ctLaneTarget'),
    alignment = get('ctLaneAnchor');
  let customTarget = Boolean(previous);
  if (previous) {
    enable.checked = true;
    mode.value = previous.mode;
    target.value = previous.spacingMm;
    alignment.value = previous.anchor;
  }
  return function readAdjustment(params, changed) {
    if (changed === target) customTarget = true;
    if (changed === mode) customTarget = false;
    if (!customTarget && Number.isFinite(params.laneSpacing))
      target.value = Number(
        (params.laneSpacing * (mode.value === 'squeeze' ? 0.8 : 1.15)).toFixed(
          2,
        ),
      );
    const available = params.lanes >= 2;
    host.hidden = !available;
    const active = available && enable.checked;
    host.querySelector('[data-lane-options]').hidden = !active;
    host.querySelector('[data-lane-anchor]').hidden = params.kind !== 'curve';
    for (const input of [mode, target, alignment]) input.disabled = !active;
    return active
      ? {
          version: 1,
          mode: mode.value,
          spacingMm: target.valueAsNumber,
          anchor: params.kind === 'curve' ? alignment.value : 'centre',
        }
      : null;
  };
}
