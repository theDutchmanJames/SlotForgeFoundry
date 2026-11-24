import { check, choice, esc, field, fmt } from './ui.js';
import { specialAssemblyNotes, specialPieceName } from './special-pieces.js';
import {
  TURNOUT_LIMITS,
  TURNOUT_MODE_HINTS,
  TURNOUT_MODES,
  turnoutHasBlade,
  turnoutSettings,
} from './geometry/turnout-layout.js';
import { TURNOUT_DRIVE, turnoutMotor } from './geometry/turnout-drive.js';
import { PIT_MOTOR_LIMITS, pitMotorSettings } from './geometry/pit-motor-settings.js';
import { maxPitMotorHeight, motorMountFit } from './geometry/pit-motor-mount.js';
import { pitEyeHardware } from './geometry/pit-turnout.js';
import { pitDividerControl } from './paint-controls.js';
import { pitGridControls, readPitGridFields, syncPitGridControls } from './starting-grid-controls.js';

export const specialName = (type) => specialPieceName(type);

export const specialBorderChoices = [
  ['none', 'None'],
  ['outer', 'Outside / left'],
  ['inner', 'Inside / right'],
  ['both', 'Both'],
];

const descriptions = {
  hairpin:
    'Both slots cross twice and return to their original side. Each driver keeps a separate electrical circuit.',
  duel: 'Two fixed racing lines take different apexes and rejoin the pack at its usual lane spacing.',
  chicane:
    'The road steps sideways and returns to its starting line. Use a smaller radius for a sharper turn, or give the exit more room to flow.',
  diamond:
    'Two roads cross at surface level. Each slot continues to the opposite arm, with insulating gaps in the braid at each intersection.',
  pit: 'Each pit uses its own lane’s controller. Choose Bottom in Track Set to see the crank move with the flipper.',
  timing:
    'Choose the detector you plan to fit. Optical gates keep the running braids continuous. Dead strips isolate a short sensing section in each lane.',
  turnout:
    'One lane splits in two. The area around the split is a separate insert. It goes in from below with two screws, so you can swap it without lifting the braid.',
};

const motorBodyFields = ['motorLength', 'motorWidth', 'motorHeight', 'plungerProjection', 'motorStroke'];
const motorLabels = {
  rodDiameter: 'Pushrod diameter',
  eyeDiameter: 'Crank hole diameter',
  motorLength: 'Body length',
  motorWidth: 'Body width',
  motorHeight: 'Body height',
  plungerProjection: 'Retracted plunger reach',
  motorStroke: 'Usable stroke',
};
const specialFieldName = (key) => 'sp' + key[0].toUpperCase() + key.slice(1);

function pitLinkageControls(p) {
  const s = pitMotorSettings(p.special);
  const measurement = (key) => {
    const [min, max] = PIT_MOTOR_LIMITS[key];
    return field(specialFieldName(key), motorLabels[key], s[key], 'mm', { min, max });
  };
  const [minStroke, maxStroke] = TURNOUT_DRIVE.strokeLimits,
    [minPlay, maxPlay] = TURNOUT_DRIVE.playLimits;
  const stroke = field('spMotorStroke', motorLabels.motorStroke, s.motorStroke, 'mm', { min: minStroke, max: maxStroke });
  return check('spMotorMount', 'Push-pull motor under the road', s.motorMount) +
    '<div data-manual-fields' + (s.motorMount ? ' hidden' : '') + '>' +
    '<p class="hint">Without a motor the crank has an eye for a bent pushrod, which leaves through a channel at the pit side for a lever or a motor of your own.</p>' +
    measurement('rodDiameter') +
    '</div>' +
    field(specialFieldName('eyeDiameter'), s.motorMount ? 'Plunger eye diameter' : motorLabels.eyeDiameter, s.eyeDiameter, 'mm', {
      min: PIT_MOTOR_LIMITS.eyeDiameter[0], max: PIT_MOTOR_LIMITS.eyeDiameter[1],
    }) +
    '<p class="hint" data-pushrod-play></p>' +
    '<div data-motor-fields' + (s.motorMount ? '' : ' hidden') + '>' +
    '<p class="hint">The motor lies under the road between the main slot and the pit slot, in line with a slider that works a pin on the crank. Nothing passes under a slot, and no wire has to be bent. Measure the body along its plunger, the retracted reach from the end face to the eye in the plunger, and the travel between stops.</p>' +
    motorBodyFields.filter((key) => key !== 'motorStroke').map(measurement).join('') + stroke +
    '<p class="hint">From about 5 mm of stroke the slant in the slider is shallow: the motor needs little force, and the flat ends of the slot hold the flipper in place. At 2 to 4 mm it is steep: it needs more push, and a knock on the flipper can push the slider back.</p>' +
    field('spTurnoutPlay', 'Pin play', p.special.turnoutPlay ?? TURNOUT_DRIVE.play, 'mm', { min: minPlay, max: maxPlay, step: 0.05 }) +
    '<figure class="joint-fit-diagram" data-motor-diagram data-track-height="' + esc(p.height) +
    '" data-max-height="' + esc(maxPitMotorHeight(p)) + '"></figure></div>';
}

// Draw the fitted motor and the available height with a common scale.
function syncPitLinkage(form) {
  const group = form.querySelector('[data-motor-fields]');
  if (!group) return;
  const enabled = form.querySelector('[name="spMotorMount"]').checked;
  const rod = form.querySelector('[name="spRodDiameter"]').valueAsNumber;
  const hole = form.querySelector('[name="spEyeDiameter"]').valueAsNumber;
  const play = hole - rod;
  const hardware = pitEyeHardware(rod, hole);
  // With a motor the eye is the plunger's, for the pin under the slider.
  // Without one it is the hole in the crank, for the pushrod.
  form.querySelector('[data-pushrod-play]').textContent = enabled
    ? 'A straight pin of this diameter goes into the hole under the end of the slider, and the eye of the plunger hooks over it.'
    : Number.isFinite(play) && rod > 0 && play >= 0
      ? `Pushrod play · ${fmt(play)} mm. A pin head or retainer up to Ø${fmt(hardware.headDiameter)} mm can extend ${fmt(hardware.headProjection)} mm above the tab, with ${fmt(hardware.headTopClearance)} mm to spare.` : '';
  const eyeLabel = form.querySelector('[name="spEyeDiameter"]').labels?.[0]?.firstElementChild;
  if (eyeLabel) eyeLabel.textContent = enabled ? 'Plunger eye diameter' : motorLabels.eyeDiameter;
  const manual = form.querySelector('[data-manual-fields]');
  if (manual) {
    manual.hidden = enabled;
    for (const input of manual.querySelectorAll('input')) input.disabled = enabled;
  }
  group.hidden = !enabled;
  for (const input of group.querySelectorAll('input')) input.disabled = !enabled;
  if (!enabled) return;
  const diagram = group.querySelector('[data-motor-diagram]');
  const [length, width, height, reach, stroke] = motorBodyFields.map(
    (key) => group.querySelector('[name="' + specialFieldName(key) + '"]').valueAsNumber,
  );
  const limit = Number(diagram.dataset.maxHeight);
  const trackHeight = Number(diagram.dataset.trackHeight);
  if (![length, width, height, reach, stroke, limit, trackHeight].every(Number.isFinite) ||
      Math.min(length, width, height, stroke) <= 0 || reach < 0) {
    diagram.replaceChildren();
    return;
  }
  const table = 56, x = 24;
  const bodyZ = motorMountFit.tableClearance + motorMountFit.trayThickness;
  const scale = Math.min(148 / (length + reach + stroke), 48 / Math.max(height + bodyZ, trackHeight));
  const base = table - bodyZ * scale, body = length * scale, rise = height * scale;
  const face = x + body, axis = base - rise / 2, parked = face + reach * scale, extended = parked + stroke * scale;
  const ceilingY = base - (Math.min(height, limit) + motorMountFit.topClearance) * scale;
  const roadY = table - trackHeight * scale;
  const bodyInk = height > limit ? 'var(--d-error)' : 'var(--d-track)';
  const status = height > limit
    ? 'Body is ' + fmt(height - limit) + ' mm too tall for this deck.'
    : 'Maximum body height here · ' + fmt(limit) + ' mm.';
  const travel = `Plunger travel ${fmt(stroke)} mm, taken by the slider`;
  diagram.innerHTML =
    `<svg viewBox="0 0 202 64" role="img" aria-label="Motor side view, ${fmt(length)} mm long, ${fmt(width)} mm wide and ${fmt(height)} mm high. Plunger travel ${fmt(stroke)} mm.">
      <rect x="12" y="${roadY}" width="162" height="${ceilingY - roadY}" fill="var(--d-track)"/>
      <g font-size="6" fill="var(--d-ink)"><text x="177" y="${roadY + 4}">Road</text><text x="177" y="${table + 2}">Table</text></g>
      <rect x="${x - 2}" y="${base}" width="${body + 4}" height="${motorMountFit.trayThickness * scale}" fill="var(--d-hardware)"/>
      <rect x="${x}" y="${base - rise}" width="${body}" height="${rise}" rx="1" fill="${bodyInk}"/>
      <path d="M${face} ${axis}H${parked}" stroke="var(--d-guide)" stroke-width="3"/>
      <path d="M${parked} ${axis}H${extended} m0 -4v8 M${parked} ${axis - 4}v8" fill="none" stroke="var(--d-warn)" stroke-width="1.5"/>
      <path d="M12 ${table}H174" stroke="var(--d-guide)"/>
    </svg><figcaption>${travel}<br>${esc(status)}</figcaption>`;
}

// The slider and the motor of a turnout's Digital insert.
function turnoutDriveControls(special) {
  const m = turnoutMotor(special);
  const size = (key, label) => {
    const [min, max] = PIT_MOTOR_LIMITS[key];
    return field(specialFieldName(key), label, m[key], 'mm', { min, max });
  };
  const [minStroke, maxStroke] = TURNOUT_DRIVE.strokeLimits, [minPlay, maxPlay] = TURNOUT_DRIVE.playLimits;
  return '<div data-turnout-drive' + (turnoutSettings(special).turnoutMode === 'digital' ? '' : ' hidden') + '>' +
    field('spMotorStroke', 'Usable stroke', m.motorStroke, 'mm', { min: minStroke, max: maxStroke }) +
    '<p class="hint">The travel of your push-pull motor. From about 5 mm the slant is shallow: the motor needs little force, and the flat ends of the slot hold the blade in place. At 2 to 4 mm the slant is steep: it needs more push, and a knock on the blade can push the slider back.</p>' +
    field('spTurnoutPlay', 'Pin play', m.play, 'mm', { min: minPlay, max: maxPlay, step: 0.05 }) +
    '<p class="hint">Clearance between the crank pin and the slot in the slider. A little play here becomes two to three times as much at the tip of the blade.</p>' +
    '<p class="hint">The motor lies under the road between the two slots, in line with the slider. Measure its body along the plunger. Measure retracted reach from the end face to the eye in the plunger.</p>' +
    size('motorLength', 'Body length') + size('motorWidth', 'Body width') + size('motorHeight', 'Body height') +
    size('plungerProjection', 'Retracted plunger reach') + size('eyeDiameter', 'Plunger eye diameter') +
    '</div>';
}

// The pack creator and the Road inspector edit the same recipe fields.
export function specialControls(p, { creating = false } = {}) {
  const s = p.special;
  const mm = (key, label, value, min, max = 20000) =>
    field(key, label, value, 'mm', { min, max });
  const position = (key, label, value, min, max) =>
    field(key, label, Number((value * 100).toFixed(6)), '%', { min, max });
  let body =
    p.kind === 'curve'
      ? mm('spRadius', 'Centre radius', p.radius, 1) +
        field(
          'spAngle',
          'Sweep angle',
          p.angle,
          '°',
          s.type === 'hairpin' ? { min: 45, max: 210 } : { min: 70, max: 145 },
        )
      : mm(
          'spLength',
          s.type === 'diamond' ? 'End-to-end span' : s.type === 'turnout' ? 'Main road length' : 'Overall length',
          p.length,
          1,
        );
  if (s.type === 'turnout') {
    const t = turnoutSettings(s);
    const limit = (key) => ({ min: TURNOUT_LIMITS[key][0], max: TURNOUT_LIMITS[key][1] });
    const blade = turnoutHasBlade(t.turnoutMode);
    body +=
      choice('spSide', 'Branch side', t.side, [
        ['left', 'Left'],
        ['right', 'Right'],
      ]) +
      choice('spTurnoutMode', 'Insert', t.turnoutMode, TURNOUT_MODES) +
      '<p class="hint" data-turnout-mode-hint>' + esc(TURNOUT_MODE_HINTS[t.turnoutMode] ?? '') + '</p>' +
      field('spTurnoutRadius', 'Branch radius', t.turnoutRadius, 'mm', limit('turnoutRadius')) +
      field('spTurnoutAngle', 'Branch angle', t.turnoutAngle, '°', limit('turnoutAngle')) +
      field('spTurnoutLead', 'Lead before the branch', t.turnoutLead, 'mm', limit('turnoutLead')) +
      '<div data-turnout-blade' + (blade ? '' : ' hidden') + '>' +
      choice('spTurnoutPosition', 'Blade position', t.turnoutPosition, [
        ['main', 'Straight on'],
        ['pit', 'Branch'],
      ]) + '</div>' + turnoutDriveControls(s);
  }
  if (s.type === 'chicane') {
    body +=
      choice('spHand', 'First turn', s.hand, [
        ['left', 'Left'],
        ['right', 'Right'],
      ]) +
      mm('spOffset', 'Lateral offset', s.offset, 1, 5000) +
      mm('spEntryRadius', 'Entry corner radius', s.entryRadius, 1) +
      mm('spExitRadius', 'Exit corner radius', s.exitRadius, 1);
  }
  if (s.type === 'duel')
    body += position('spApex', 'Outside lane apex', s.apex, 52, 75);
  if (s.type === 'hairpin' && s.crossingAt != null)
    body += position('spCrossingAt', 'First crossing', s.crossingAt, 12, 38);
  if (s.type === 'diamond')
    body += field('spCrossingAngle', 'Crossing angle', s.crossingAngle, '°', {
      min: 55,
      max: 125,
    });
  if (s.type === 'hairpin' || s.type === 'diamond')
    body += mm(
      'spIsolation',
      'Braid isolation clearance',
      s.isolation,
      s.type === 'diamond' ? 0.25 : 0.2,
      s.type === 'diamond' ? 40 : 12,
    );
  if (s.type === 'pit') {
    body +=
      choice('spSide', 'Pit side', s.side, [
        ['left', 'Left lane'],
        ['right', 'Right lane · mirrored'],
        ['both', 'Both · independent pits'],
      ]) +
      mm('spPitOffset', 'Pit lane offset', s.pitOffset, 1, 2000) +
      (creating ? pitDividerControl(p) : '') +
      pitGridControls(p, creating) +
      choice('spTurnoutPosition', 'Flipper position', s.turnoutPosition ?? 'main', [
        ['main', 'Main lane · pit closed'],
        ['pit', 'Pit lane · pit open'],
      ]) + pitLinkageControls(p);
  }
  if (s.type === 'timing') {
    body +=
      choice('spDetector', 'Detection', s.detector, [
        ['optical', 'Optical gate'],
        ['strip', 'Isolated dead strip'],
      ]) +
      '<div data-sensor-size>' +
      mm('spSensorSize', 'Sensor pocket width', s.sensorSize, 1.5, 10) +
      '</div>' +
      '<div data-strip-size>' +
      mm('spStripLength', 'Sensing strip length', s.stripLength, 8, 150) +
      '</div>';
  }
  return body + '<p class="hint">' + esc(descriptions[s.type]) + '</p>';
}

export function syncSpecialControls(form) {
  if (!form) return;
  syncPitGridControls(form);
  const crossingStyle = form.querySelector('[data-pit-crossing-style]');
  if (crossingStyle) {
    const off = !form.querySelector('[name="spPitWhiteLine"]').checked;
    crossingStyle.hidden = crossingStyle.disabled = off;
  }
  const pitSlot = form.querySelector('[data-pit-contact-slot]');
  if (pitSlot) {
    const hasBraid = form.elements.braidWidth.valueAsNumber > 0;
    form.querySelector('[data-pit-braid-width]').hidden = hasBraid;
    form.elements.spPitContactMode.disabled = !hasBraid;
    const braidSlot = hasBraid && form.elements.spPitContactMode.value === 'braid';
    pitSlot.hidden = !braidSlot;
    form.elements.spPitContactLength.disabled = !braidSlot;
  }
  syncPitLinkage(form);
  const modeHint = form.querySelector('[data-turnout-mode-hint]');
  if (modeHint) {
    const mode = form.querySelector('[name="spTurnoutMode"]').value;
    modeHint.textContent = TURNOUT_MODE_HINTS[mode] ?? '';
    const blade = form.querySelector('[data-turnout-blade]');
    blade.hidden = !turnoutHasBlade(mode);
    blade.querySelector('select').disabled = blade.hidden;
    const drive = form.querySelector('[data-turnout-drive]');
    drive.hidden = mode !== 'digital';
    for (const input of drive.querySelectorAll('input')) input.disabled = drive.hidden;
  }
  const row = form.querySelector('[data-strip-size]');
  if (!row) return;
  const strip = form.querySelector('[name="spDetector"]').value === 'strip';
  row.hidden = !strip;
  row.querySelector('input').disabled = !strip;
  const sensor = form.querySelector('[data-sensor-size]');
  sensor.hidden = strip;
  sensor.querySelector('input').disabled = strip;
  const notes = form.querySelector('[data-assembly-notes="timing"]');
  const detector = strip ? 'strip' : 'optical';
  if (notes && notes.dataset.detector !== detector) {
    notes.innerHTML = specialAssemblyNotes({
      special: { type: 'timing', detector },
    })
      .map((note) => '<p class="hint">' + esc(note) + '</p>')
      .join('');
    notes.dataset.detector = detector;
  }
}

// Prefix input names so ordinary fields on adjacent pages cannot accidentally
// overwrite a special's nested options when a user applies multiple pages.
export function readSpecialFields(fields, p) {
  if (!p.special) return;
  const s = { ...p.special };
  for (const k of ['length', 'radius', 'angle']) {
    const name = specialFieldName(k);
    if (Object.hasOwn(fields, name)) {
      fields[k] = fields[name];
      delete fields[name];
    }
  }
  for (const k of [
    'detector',
    'hand',
    'side',
    'turnoutPosition',
    'turnoutMode',
    'turnoutRadius',
    'turnoutAngle',
    'turnoutLead',
    'turnoutPlay',
    'motorMount',
    'rodDiameter',
    'eyeDiameter',
    ...motorBodyFields,
    'offset',
    'entryRadius',
    'exitRadius',
    'pitOffset',
    'pitWhiteLine',
    'pitCrossingStyle',
    'pitContactMode',
    'pitContactLength',
    'isolation',
    'crossingAngle',
    'apex',
    'crossingAt',
    'stripLength',
    'sensorSize',
  ]) {
    const name = specialFieldName(k);
    if (!Object.hasOwn(fields, name)) continue;
    const value = fields[name];
    delete fields[name];
    // A user can switch a motor off halfway through editing a measurement.
    // Keep its last usable settings so it can be mounted again later.
    if (motorBodyFields.includes(k) && !s.motorMount) {
      const [min, max] = PIT_MOTOR_LIMITS[k];
      if (!Number.isFinite(value) || value < min || value > max) continue;
    }
    if (k === 'pitContactLength' && (s.pitContactMode !== 'braid' || fields.braidWidth === 0) &&
        (!Number.isFinite(value) || value < 0.3 || value > 50)) continue;
    if (
      (k !== 'stripLength' || s.detector === 'strip') &&
      (k !== 'sensorSize' || s.detector === 'optical')
    )
      s[k] = k === 'apex' || k === 'crossingAt' ? value / 100 : value;
  }
  p.special = s;
  readPitGridFields(fields, p);
}
