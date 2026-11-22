import { check, choice, esc, field, fmt } from './ui.js';
import { specialAssemblyNotes, SPECIAL_PIECES } from './special-pieces.js';
import { PIT_MOTOR_LIMITS, pitMotorSettings } from './geometry/pit-motor-settings.js';
import { maxPitMotorHeight, motorMountFit } from './geometry/pit-motor-mount.js';
import { pitEyeHardware } from './geometry/pit-turnout.js';
import { pitDividerControl } from './paint-controls.js';
import { pitGridControls, readPitGridFields, syncPitGridControls } from './starting-grid-controls.js';

export const specialName = (type) =>
  SPECIAL_PIECES.find(([id]) => id === type)?.[1] ?? '';

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
  pit: 'Each pit uses its own lane’s controller. Choose Bottom in Track Set to see the pushrod crank move with the flipper.',
  timing:
    'Choose the detector you plan to fit. Optical gates keep the running braids continuous. Dead strips isolate a short sensing section in each lane.',
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
  return measurement('rodDiameter') + measurement('eyeDiameter') +
    '<p class="hint" data-pushrod-play></p>' +
    check('spMotorMount', 'Adjustable motor mount', s.motorMount) +
    '<div data-motor-fields' + (s.motorMount ? '' : ' hidden') + '>' +
    '<p class="hint">Measure the rectangular body along its centred plunger. Measure retracted reach from the end face to the pushrod attachment, then measure the travel between stops.</p>' +
    motorBodyFields.map(measurement).join('') +
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
  form.querySelector('[data-pushrod-play]').textContent = Number.isFinite(play) && rod > 0 && play >= 0
    ? `Pushrod play · ${fmt(play)} mm. A pin head or retainer up to Ø${fmt(hardware.headDiameter)} mm can extend ${fmt(hardware.headProjection)} mm above the tab, with ${fmt(hardware.headTopClearance)} mm to spare.` : '';
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
  const travel = Number.isFinite(play) && play >= 0 && stroke > play
    ? `Plunger travel ${fmt(stroke)} mm · Crank travel ${fmt(stroke - play)} mm`
    : `Plunger travel ${fmt(stroke)} mm`;
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
          s.type === 'diamond' ? 'End-to-end span' : 'Overall length',
          p.length,
          1,
        );
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
