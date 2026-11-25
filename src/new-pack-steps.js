// The steps of a new track pack. Only Basics is needed; every other step
// starts from the pack chosen under Start with and can be skipped.
import { check, choice, details, esc, field, icon } from './ui.js';
import { clipChoices } from './joint-controls.js';
import { sharedLabels } from './library-view.js';
import { SCREW_PROFILE_FIELDS, SHARED_PROFILE_FIELDS } from './library-profile.js';
import { SCREW_CLIP_DEFAULTS } from './geometry/screw-clip.js';
import { centreLineStyles } from './paint-controls.js';
import { braidStyleChoices } from './connection-controls.js';
import { markingControls, markingsOf, readMarkingFields } from './markings-controls.js';
import { readTextureFields, textureFields } from './texture-controls.js';
import { readTracksideFields, tracksideControls } from './trackside-controls.js';
import { TRACKSIDE_DEFAULTS } from './geometry/trackside.js';
import { BORDER_DEFAULTS, validatePackBorders } from './track-pack-rules.js';

// Each step: its group in the column on the left, its icon, a short
// subtitle under its heading and a hint in its card.
export const NEW_PACK_STEPS = Object.freeze([
  {
    key: 'basics',
    group: 'This pack',
    icon: 'library',
    title: 'Basics',
    subtitle: 'Its name, the road width and the lanes',
    hint: 'Only this step is needed. The steps after it are optional: skip any of them, or create the pack now.',
  },
  {
    key: 'road',
    group: 'Every piece',
    icon: 'box',
    title: 'Road',
    subtitle: 'The body of every piece',
    hint: 'Its height, and a hollow underside with ribs that saves filament.',
  },
  {
    key: 'slot',
    group: 'Every piece',
    icon: 'track',
    title: 'Slot and braid',
    subtitle: 'Where the cars run',
    hint: 'The guide slot of each lane and the braid on either side of it.',
  },
  {
    key: 'connections',
    group: 'Every piece',
    icon: 'join',
    title: 'Connections',
    subtitle: 'How the pieces hold together',
    hint: 'How pieces, and the segments of a piece cut for your print plate, are joined.',
  },
  {
    key: 'borders',
    group: 'Only if you need it',
    icon: 'layers',
    title: 'Borders',
    subtitle: 'Beside the road',
    hint: 'Borders beside the road of the straights and corners. Special pieces you already have keep their own borders; for a new one you choose them when you add it.',
  },
  {
    key: 'lines',
    group: 'Only if you need it',
    icon: 'markings',
    title: 'Lines and kerbs',
    subtitle: 'Paint and kerbstones',
    hint: 'Painted lines on the road and the borders, and kerbstones. Border lines and kerbs show on pieces that have borders.',
  },
  {
    key: 'surface',
    group: 'Only if you need it',
    icon: 'pattern',
    title: 'Road surface',
    subtitle: 'A texture cut into the road',
    hint: 'A pattern of stones cut into the road of the straights and corners. Special pieces keep a plain road.',
  },
  {
    key: 'trackside',
    group: 'Only if you need it',
    icon: 'trackside',
    title: 'Trackside',
    subtitle: 'Barriers and boards',
    hint: 'Barriers, advertising boards with fences and guard rails beside the road.',
  },
]);
/** The heading of a step and the start of its card. */
export const stepHead = (s) =>
  '<h3 class="np-h">' + esc(s.title) + '</h3><p class="np-sub">' + esc(s.subtitle) + '</p>' +
  '<div class="np-card"><p class="hint">' + esc(s.hint) +
  (s.key === 'basics' ? '' : ' Skip this step to keep what the pack starts with; you can change it later under Pack rules or Shared print profile.') +
  '</p>';

/** The column of steps, in groups, each with a line on what it holds now. */
export function stepRail() {
  let group = '';
  return (
    NEW_PACK_STEPS.map((s) => {
      const label = s.group !== group ? '<div class="np-group">' + esc((group = s.group)) + '</div>' : '';
      return (
        label +
        '<button type="button" data-np-go="' + s.key + '">' + icon(s.icon) +
        '<span class="np-item"><span>' + esc(s.title) + '</span><small data-np-sum></small></span>' +
        '<span class="np-dot" aria-hidden="true"></span></button>'
      );
    }).join('') +
    '<p class="np-legend"><span class="np-dot" aria-hidden="true"></span>Your settings</p>'
  );
}
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const SIDES = { outer: 'Outside', inner: 'Inside', both: 'Both sides' };
/** One line on what a step holds now, read from its form. */
export function stepSummary(key, form) {
  const el = (name) => form.elements.namedItem(name);
  const value = (name) => el(name)?.value ?? '';
  const text = (name) => el(name)?.selectedOptions?.[0]?.textContent ?? value(name);
  switch (key) {
    case 'basics': {
      if (value('startWith') !== 'empty') return text('startWith').split(' · ')[0];
      const lanes = Number(value('packLanes'));
      return value('packWidth') + ' mm · ' + lanes + (lanes === 1 ? ' lane' : ' lanes') + ' · R1 ' + value('packR1') + ' mm';
    }
    case 'road':
      return value('height') + ' mm high · ' + (el('hollow')?.checked ? 'hollow' : 'solid');
    case 'slot':
      return 'Slot ' + value('slotWidth') + ' × ' + value('slotDepth') + ' mm · ' + text('braidStyle').toLowerCase();
    case 'connections':
      return text('joint') + ' · ' + text('clipType');
    case 'borders':
      return value('borderSide') === 'none' ? 'None' : SIDES[value('borderSide')] + ' · ' + value('borderWidth') + ' mm';
    case 'lines': {
      const on = [];
      if (value('roadCentreLine') !== 'none') on.push('centre line');
      if (value('whiteLineRoad') !== 'none' || value('whiteLineBorder') !== 'none') on.push('white lines');
      if (value('roadKerbSide') !== 'none' || value('kerbEdge') !== 'none') on.push('kerbstones');
      return on.length ? capital(on.join(' · ')) : 'None';
    }
    case 'surface':
      return value('roadTexture') === 'none' ? 'Plain road' : text('roadTexture') + ' · ' + text('textureSize');
    case 'trackside':
      return value('tracksideSide') === 'none' ? 'None' : SIDES[value('tracksideSide')] + ' · ' + text('tracksideShape').toLowerCase();
  }
  return '';
}
/** The line under the steps: which steps are yours. */
export function footNote(changed) {
  const mine = NEW_PACK_STEPS.filter((s) => changed.has(s.key)).map((s) => s.title);
  if (!mine.length) return 'Everything after Basics keeps what the pack starts with.';
  return 'Your settings: ' + mine.join(', ') + '. Everything else keeps what the pack starts with.';
}
// The folders of the steps that set the shared print profile.
const PROFILE_FOLDERS = {
  road: [
    ['Body', ['height', 'hollow', 'deck', 'wall'], true],
    ['Ribs under the road', ['reinforcement', 'ribSpacing'], false],
  ],
  slot: [
    ['Guide slot', ['slotWidth', 'slotDepth'], true],
    ['Braid', ['braidStyle', 'braidWidth', 'braidDepth', 'braidRaise', 'braidGap'], true],
  ],
  connections: [
    ['Between segments', ['joint'], true],
    ['Tabs and clips', ['clipType', 'tabWidth', 'tabLength', 'tabThickness', 'tabClearance', 'clipClearance'], false],
    ['Kevan Sideclip', SCREW_PROFILE_FIELDS, false],
  ],
  lines: [['Centre line', ['roadCentreLine', 'dashLength', 'dashGap'], true]],
};
export const PROFILE_STEPS = Object.freeze(Object.keys(PROFILE_FOLDERS));

/** One setting of the shared print profile, as Pack rules and this dialog show it. */
export function profileControl(k, v) {
  if (k === 'hollow' || k === 'reinforcement') return check(k, sharedLabels[k], v[k]);
  if (k === 'roadCentreLine') return choice(k, sharedLabels[k], v[k] ?? 'none', centreLineStyles);
  if (k === 'braidStyle') return choice(k, sharedLabels[k], v[k] ?? 'recessed', braidStyleChoices);
  if (k === 'joint')
    return choice(k, sharedLabels[k], v[k] ?? 'none', [
      ['none', 'Plain'],
      ['tabs', 'Tabs and sockets'],
      ['clips', 'Removable clips'],
      ['both', 'Tabs and clips'],
    ]);
  if (k === 'clipType') return choice(k, sharedLabels[k], v[k] ?? '', clipChoices(v[k]));
  if (k === 'screwDirection')
    return choice(k, sharedLabels[k], v[k] ?? SCREW_CLIP_DEFAULTS[k], [
      ['top', 'All from the top'],
      ['bottom', 'All from the bottom'],
      ['side', 'Per road side'],
    ]);
  if (k === 'screwLength')
    return field(k, sharedLabels[k], v[k] ?? '', 'mm', { optional: true, placeholder: 'Auto' });
  if (Object.hasOwn(SCREW_CLIP_DEFAULTS, k))
    return field(k, sharedLabels[k], v[k] ?? SCREW_CLIP_DEFAULTS[k], k === 'screwHeadAngle' ? '°' : 'mm');
  return field(k, sharedLabels[k], v[k] ?? '', 'mm', {
    optional: k === 'tabThickness',
    placeholder: 'Auto',
  });
}

const TAB_FIT_FIELDS = ['tabWidth', 'tabLength', 'tabClearance', 'tabThickness', 'clipType'];
/**
 * The shared print profile with the settings of these forms. A Kevan
 * Sideclip setting the pack never set stays unset while it is at its
 * default; an empty screw length is automatic.
 */
export function readProfileFields(forms, previous) {
  const next = { ...previous };
  for (const form of forms)
    for (const control of form.elements) {
      if (!SHARED_PROFILE_FIELDS.includes(control.name)) continue;
      if (control.type === 'checkbox') next[control.name] = control.checked;
      else if (control.type === 'number') {
        if (control.value === '') {
          if (control.name !== 'tabThickness' && control.name !== 'screwLength')
            throw Error('Enter ' + sharedLabels[control.name] + '.');
          next[control.name] = null;
        } else next[control.name] = control.valueAsNumber;
      } else if (control.value) next[control.name] = control.value;
      else next[control.name] = null;
      if (
        Object.hasOwn(SCREW_CLIP_DEFAULTS, control.name) &&
        previous[control.name] == null &&
        (control.name === 'screwLength'
          ? next[control.name] == null
          : next[control.name] === SCREW_CLIP_DEFAULTS[control.name])
      )
        delete next[control.name];
    }
  if (TAB_FIT_FIELDS.some((k) => (next[k] ?? null) !== (previous[k] ?? null))) next.jointFitVersion = 2;
  return next;
}

/** The borders of a pack that has none in its rules, read from one of its corners. */
export function bordersOf(params) {
  if (!params || params.borderSide === undefined) return { ...BORDER_DEFAULTS };
  return {
    borderSide: params.borderSide,
    borderWidth: params.borderEntry ?? BORDER_DEFAULTS.borderWidth,
    borderApexWidth: params.outerApexWidth ?? params.innerApexWidth ?? params.borderApex ?? BORDER_DEFAULTS.borderApexWidth,
    borderMount: params.borderMount ?? 'none',
    borderJoint: params.borderJoint ?? 'none',
  };
}
const CONNECTIONS = [
  ['none', 'Plain'],
  ['tabs', 'Tabs + sockets'],
  ['clips', 'Removable clips'],
  ['both', 'Tabs + clips'],
];
export function borderControls(b) {
  return (
    details(
      'Which borders',
      choice('borderSide', 'Border side', b.borderSide, [
        ['none', 'None'],
        ['outer', 'Outside / left'],
        ['inner', 'Inside / right'],
        ['both', 'Both'],
      ]),
      true,
    ) +
    details(
      'Width',
      field('borderWidth', 'Width at the ends', b.borderWidth, 'mm', { min: 0, max: 2000 }) +
        field('borderApexWidth', 'Width at the apex of a corner', b.borderApexWidth, 'mm', { min: 0, max: 2000 }) +
        '<p class="hint">Every piece has the same width at its ends, so the borders of two pieces meet. A straight keeps that width all along; a corner widens to its apex in the middle.</p>',
      true,
    ) +
    details(
      'Fixing',
      choice('borderMount', 'Attach to road', b.borderMount, CONNECTIONS) +
        choice('borderJoint', 'Join border ends', b.borderJoint, CONNECTIONS) +
        '<p class="hint">Kevan Sideclips join road ends only. Tabs use the tab size of Connections.</p>',
      false,
    )
  );
}
/** The borders as the form has them. */
export function readBorderFields(form) {
  const e = form.elements;
  return validatePackBorders({
    borderSide: e.borderSide.value,
    borderWidth: e.borderWidth.valueAsNumber,
    borderApexWidth: e.borderApexWidth.valueAsNumber,
    borderMount: e.borderMount.value,
    borderJoint: e.borderJoint.value,
  });
}

/**
 * The starting values of the optional steps: the pack chosen under Start
 * with, its rules, and one of its pieces for what the rules leave out.
 */
export function stepValues({ profile, rules = {}, pieces = [] }, fallbackParams = {}) {
  const sample = (kind) => pieces.find((p) => p.track.params.kind === kind && !p.track.params.special)?.track.params;
  const params = sample('curve') ?? sample('straight') ?? pieces[0]?.track.params ?? fallbackParams;
  return {
    profile: { ...fallbackParams, ...params, ...profile },
    borders: rules.borders ?? bordersOf(sample('curve')),
    markings: rules.markings ?? markingsOf(params),
    texture: rules.texture ?? {},
    trackside: { ...TRACKSIDE_DEFAULTS, ...rules.trackside },
  };
}

const folders = (step, v) =>
  PROFILE_FOLDERS[step]
    .map(([title, keys, open]) => details(title, keys.map((k) => profileControl(k, v)).join(''), open))
    .join('');
/** The forms of the optional steps, one per step, each hidden until shown. */
export function optionalStepForms(values) {
  const body = {
    road: folders('road', values.profile),
    slot: folders('slot', values.profile),
    connections: folders('connections', values.profile),
    borders: borderControls(values.borders),
    lines: folders('lines', values.profile) + markingControls(values.markings, { folders: true }),
    surface: details('Road surface texture', textureFields(values.texture), true),
    trackside: tracksideControls(values.trackside),
  };
  const data = { surface: ' data-lib-texture', trackside: ' data-lib-trackside' };
  return NEW_PACK_STEPS.filter((s) => body[s.key])
    .map(
      (s) =>
        '<form class="np-step" data-step="' + s.key + '"' + (data[s.key] ?? '') + ' hidden>' +
        stepHead(s) + body[s.key] + '</div></form>',
    )
    .join('');
}

/**
 * What the changed steps set. Steps left alone set nothing: the pack keeps
 * what it starts with.
 */
export function readOptionalSteps(dialog, changed, values) {
  const form = (key) => dialog.querySelector('form[data-step="' + key + '"]');
  const profileForms = PROFILE_STEPS.filter((k) => changed.has(k)).map(form);
  return {
    profile: profileForms.length ? readProfileFields(profileForms, values.baseProfile) : values.baseProfile,
    ...(changed.has('borders') && { borders: readBorderFields(form('borders')) }),
    ...(changed.has('lines') && { markings: readMarkingFields(form('lines'), values.markings) }),
    ...(changed.has('surface') && { texture: readTextureFields(form('surface')) }),
    ...(changed.has('trackside') && { trackside: readTracksideFields(form('trackside'), values.trackside) }),
  };
}
