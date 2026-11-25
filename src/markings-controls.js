import { check, choice, details, field } from './ui.js';

// White lines and kerbstones as one set of settings: for every piece of a
// pack in the pack rules, and for the selected sections of a layout.
export const MARKING_DEFAULTS = Object.freeze({
  whiteLineRoad: 'none',
  whiteLineBorder: 'none',
  roadLineGroove: false,
  borderLineGroove: false,
  roadKerbSide: 'none',
  kerbEdge: 'none',
  kerbSide: 'both',
  kerbWidth: 5,
  kerbLength: 12,
  kerbGroove: false,
  whiteLineWidth: 3,
  grooveWidth: 0.5,
  grooveDepth: 0.3,
});
export const MARKING_KEYS = Object.freeze(Object.keys(MARKING_DEFAULTS));
export const MARKING_SIDES = Object.freeze([
  ['none', 'Off'],
  ['inner', 'Inside / right'],
  ['outer', 'Outside / left'],
  ['both', 'Both sides'],
]);
export const KERB_EDGES = Object.freeze([
  ['none', 'Off'],
  ['road', 'Road-facing edge'],
  ['free', 'Free edge'],
  ['both', 'Both edges'],
]);
export const KERB_BORDERS = Object.freeze([
  ['both', 'Both borders'],
  ['inner', 'Inside / right border'],
  ['outer', 'Outside / left border'],
]);

// The marking settings of a piece, with the standard for any it never set.
// Older pieces used one switch for every white line groove.
export function markingsOf(params = {}) {
  const groove = params.whiteLineGroove ?? false;
  return Object.fromEntries(
    MARKING_KEYS.map((key) => [
      key,
      params[key] ??
        (key === 'roadLineGroove' || key === 'borderLineGroove' ? groove : MARKING_DEFAULTS[key]),
    ]),
  );
}

// Each group is a fieldset, or with folders a folder that opens and shuts.
export function markingControls(values, { folders = false } = {}) {
  const p = { ...MARKING_DEFAULTS, ...values };
  const group = (title, body, open) =>
    folders
      ? details(title, body, open)
      : '<fieldset class="lib-pack-rules"><legend>' + title + '</legend>' + body + '</fieldset>';
  return (
    group(
      'White lines',
      choice('whiteLineRoad', 'On the road', p.whiteLineRoad, MARKING_SIDES) +
        choice('whiteLineBorder', 'On the borders', p.whiteLineBorder, MARKING_SIDES) +
        field('whiteLineWidth', 'Line width', p.whiteLineWidth, 'mm', { min: 0.1, max: 2000 }) +
        check('roadLineGroove', 'Recess road markings', p.roadLineGroove) +
        check('borderLineGroove', 'Recess border-only lines', p.borderLineGroove),
      true,
    ) +
    group(
      'Kerbstones',
      choice('roadKerbSide', 'On the road', p.roadKerbSide, MARKING_SIDES) +
        choice('kerbEdge', 'On the borders', p.kerbEdge, KERB_EDGES) +
        choice('kerbSide', 'Which borders', p.kerbSide, KERB_BORDERS) +
        field('kerbWidth', 'Stripe width', p.kerbWidth, 'mm', { min: 0.1, max: 2000 }) +
        field('kerbLength', 'Block length', p.kerbLength, 'mm', { min: 0.1, max: 20000 }) +
        check('kerbGroove', 'Recess each kerbstone outline', p.kerbGroove),
      true,
    ) +
    group(
      'Paint grooves',
      field('grooveWidth', 'Groove width', p.grooveWidth, 'mm', { min: 0.05, max: 20 }) +
        field('grooveDepth', 'Groove depth', p.grooveDepth, 'mm', { min: 0.05, max: 50 }),
      false,
    )
  );
}

// The markings as the form has them.
export function readMarkingFields(form, current = {}) {
  const result = { ...MARKING_DEFAULTS, ...current };
  for (const key of MARKING_KEYS) {
    const input = form.elements.namedItem(key);
    if (!input) continue;
    if (input.type === 'checkbox') result[key] = input.checked;
    else if (input.type === 'number') {
      if (Number.isFinite(input.valueAsNumber)) result[key] = input.valueAsNumber;
    } else result[key] = input.value;
  }
  return result;
}
