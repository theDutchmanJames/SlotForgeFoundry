import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTrack } from '../src/track.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { specialControls, syncSpecialControls } from '../src/special-piece-controls.js';
import { readTrackShapeFields } from '../src/track-shape-controls.js';
import { PIT_MOTOR_DEFAULTS } from '../src/geometry/pit-motor-settings.js';

test('pit creator and Road inspector store motor dimensions and pin fit in the same editable recipe', () => {
  const track = { params: specialTrackParams('pit', defaultTrack()) };
  const motor = { motorMount: true, motorLength: 18, motorWidth: 9, motorHeight: 4.8,
    motorStroke: 2.3, plungerProjection: 3.5, eyeDiameter: 1.4, rodDiameter: 0.9 };
  const uiValues = Object.fromEntries(Object.entries(motor).map(([key, value]) =>
    ['sp' + key[0].toUpperCase() + key.slice(1), value]));
  assert.deepEqual(readTrackShapeFields(uiValues, track), {});
  const reopened = JSON.parse(JSON.stringify(track)).params;
  for (const [key, value] of Object.entries(motor)) assert.equal(reopened.special[key], value);
  const markup = specialControls(reopened);
  for (const [name, value] of Object.entries(uiValues)) {
    if (name === 'spMotorMount') assert.match(markup, /name="spMotorMount" checked/);
    else assert.ok(markup.includes(`name="${name}" value="${value}"`));
  }
  readTrackShapeFields({ spMotorMount: false, spMotorWidth: NaN, spMotorLength: 19 }, track);
  assert.equal(track.params.special.motorWidth, 9);
  assert.equal(track.params.special.motorLength, 19);
  assert.equal(track.params.special.motorMount, false);
});

test('pits saved before motor mounts show the external crank as their default', () => {
  const p = { ...defaultTrack(), kind: 'straight',
    special: { type: 'pit', side: 'left', pitOffset: 90 } };
  const markup = specialControls(p);
  assert.match(markup, /name="spMotorMount" >/);
  assert.ok(markup.includes(`name="spEyeDiameter" value="${PIT_MOTOR_DEFAULTS.eyeDiameter}"`));
  assert.ok(markup.includes(`name="spRodDiameter" value="${PIT_MOTOR_DEFAULTS.rodDiameter}"`));
});

test('the eye hardware limit follows the chosen pushrod with an external actuator', () => {
  const wire = { valueAsNumber: 1 }, eye = { valueAsNumber: 1.6 }, hint = {};
  const nodes = {
    '[data-motor-fields]': { querySelectorAll: () => [] },
    '[name="spMotorMount"]': { checked: false },
    '[name="spRodDiameter"]': wire,
    '[name="spEyeDiameter"]': eye,
    '[data-pushrod-play]': hint,
  };
  const form = { querySelector: key => nodes[key] };
  syncSpecialControls(form);
  assert.match(hint.textContent, /0.6 mm.*Ø3 mm.*1 mm above the tab.*0.4 mm/);
  wire.valueAsNumber = 1.2;
  syncSpecialControls(form);
  assert.match(hint.textContent, /0.4 mm.*Ø3.2 mm/);
  eye.valueAsNumber = 2.8;
  syncSpecialControls(form);
  assert.match(hint.textContent, /1.6 mm.*Ø3.8 mm/);
  wire.valueAsNumber = NaN;
  syncSpecialControls(form);
  assert.equal(hint.textContent, '');
});
