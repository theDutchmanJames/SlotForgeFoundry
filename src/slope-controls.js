import { check, choice, field } from './ui.js';
import {
  SLOPE_FORMS,
  SLOPE_LIMITS,
  SLOPE_MIN_RADIUS,
  slopeDescends,
  slopeOnTable,
  slopeProfile,
  slopeSettings,
} from './geometry/slope.js';

const group = (name, shown, body) =>
  '<fieldset class="border-apex-fields" ' + name + (shown ? '>' : ' hidden disabled>') + body + '</fieldset>';
const limits = (key) => ({ min: SLOPE_LIMITS[key][0], max: SLOPE_LIMITS[key][1] });
const tidy = (value) => String(Number(value.toFixed(1)));

/** What the slope comes to: its rise, its run and how tightly the road bends. */
export function slopeHint(p) {
  if (!(p.length > 0)) return '';
  const { rise, run, radius } = slopeProfile(p);
  if (![rise, run, radius].every(Number.isFinite)) return '';
  return (
    'End B is ' + tidy(rise) + ' mm ' + (slopeDescends(p) ? 'lower' : 'higher') + ' than end A, ' + tidy(run) +
    ' mm further on. The road bends on a radius of ' +
    tidy(radius) + ' mm' +
    (radius < SLOPE_MIN_RADIUS ? ', which is too tight for a car: ' + SLOPE_MIN_RADIUS + ' mm at least.' : '.')
  );
}

/** The slope of a plain straight, under Shape. */
export function slopeControls(p) {
  const s = slopeSettings(p),
    on = s.slopeForm !== 'none';
  return (
    choice('slopeForm', 'Slope', s.slopeForm, SLOPE_FORMS) +
    group(
      'data-slope-fields',
      on,
      field('slopeAngle', 'Climb angle', s.slopeAngle, '°', { ...limits('slopeAngle'), step: 0.5 }) +
        field('slopeBend', 'Curve', s.slopeBend, '%', { ...limits('slopeBend'), step: 5 }) +
        '<p class="hint">Curve is how much of the piece the bend takes. At 100 % the road bends gently over its whole length. A smaller value bends more sharply and then runs straight at the climb angle.</p>' +
        '<p class="hint" data-slope-hint>' + (on ? slopeHint({ ...p, ...s }) : '') + '</p>' +
        group(
          'data-slope-base',
          slopeOnTable(s),
          check('slopeFill', 'Solid base down to the table', s.slopeFill) +
            field('slopeOpen', 'Open under the high end', s.slopeOpen, 'mm', limits('slopeOpen')) +
            '<p class="hint">With a base the piece stands on the table as one solid block, without a hollow underside. The base stops short of the high end, so that connectors there can be fitted from below.</p>',
        ) +
        '<p class="hint">A hill takes four pieces. Going up: Level into a climb at the foot and Climb back to level at the top, both rising from end A to end B. Going down again: Level into a descent at the top and Descent back to level at the foot, both dropping from end A to end B. The level end joins a level piece and the sloped end a straight tilted to the climb angle. Slots, braid and connectors follow the curve. A sloped piece prints on its side, so the curve of the road comes out smooth.</p>',
    )
  );
}

export function syncSlopeControls(form) {
  const e = form.elements;
  if (!e.slopeForm) return;
  const kind = e.slopeForm.value,
    on = kind !== 'none';
  const fields = form.querySelector('[data-slope-fields]'),
    base = form.querySelector('[data-slope-base]');
  fields.hidden = fields.disabled = !on;
  base.hidden = base.disabled = !slopeOnTable({ slopeForm: kind });
  const hint = form.querySelector('[data-slope-hint]');
  if (hint)
    hint.textContent = on
      ? slopeHint({
          // form.elements.length is the number of fields, not the Road length field.
          length: form.querySelector('[name="length"]')?.valueAsNumber,
          slopeForm: kind,
          slopeAngle: e.slopeAngle.valueAsNumber,
          slopeBend: e.slopeBend.valueAsNumber,
        })
      : '';
}
