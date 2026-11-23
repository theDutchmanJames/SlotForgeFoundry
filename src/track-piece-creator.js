import './custom-track.css';
import { check, choice, esc, field, fmt } from './ui.js';
import { trackParameters, validateTrack } from './track.js';
import { openCustomTrackEditor } from './custom-track-editor.js';
import {
  bindCreatorLaneControls,
  creatorLaneControls,
} from './creator-lane-controls.js';
import {
  applySlotLanes,
  applySlotMode,
  readSlotPosition,
  showSlotAdvice,
  slotFieldNames,
  slotFieldValues,
  slotPositionControls,
  slotSpacingHint,
  snapSlotField,
  syncSlotPositionControls,
} from './slot-position-controls.js';
import { slotDistances, slotTitle } from './slot-position.js';
import { matchingFamilyPreview, piecePreview } from './track-piece-preview.js';
import { defaultStartingGrid } from './geometry/starting-grid.js';
import { fitUneditedPitGrid } from './starting-grid-controls.js';
import { SPECIAL_PIECES, specialTrackParams } from './special-pieces.js';
import { SPECIAL_SHORT_NAMES } from './pack-specials.js';
import { trackThumbnail } from './library-view.js';
import {
  specialControls,
  specialName,
  specialBorderChoices,
  readSpecialFields,
  syncSpecialControls,
} from './special-piece-controls.js';

const radiusOptions = Array.from({ length: 8 }, (_, i) => [
  String(i + 1),
  'R' + (i + 1),
]);
const slotFields = slotFieldNames('pc');

export function openTrackPieceCreator({
  track,
  onApply,
  familyDefaults,
  onFamilyApplied,
  collectionName,
  packRules,
}) {
  const base = trackParameters(track.params);
  delete base.special;
  delete base.startingGrid;
  // A new piece starts with a centred slot, whatever it was started from.
  delete base.slotPosition;
  const dialog = document.createElement('dialog');
  dialog.className = 'custom-track-editor piece-creator';
  dialog.setAttribute('aria-labelledby', 'piece-creator-title');
  const r1 = packRules?.r1InnerRadius ?? familyDefaults?.r1InnerRadius ?? 200;
  const index = familyDefaults?.index ?? 1;
  const mode = familyDefaults?.matched === false ? 'independent' : 'family';
  const dimensions =
    packRules ?? (collectionName ? { ...base, ...familyDefaults } : base);
  dialog.innerHTML = `
    <header><div><h2 id="piece-creator-title">Create a track piece</h2>${collectionName ? '<p class="hint">Track pack · ' + esc(collectionName) + '</p>' : ''}</div><button type="button" data-close aria-label="Close creator">×</button></header>
    <div class="pc-shapes" role="group" aria-label="Piece shape">
      <button type="button" data-shape="straight">Straight</button>
      <button type="button" data-shape="curve" aria-pressed="true">Curve</button>
      <button type="button" data-shape="freeform">Freeform path</button>
    </div>
    <div class="pc-specials" role="group" aria-label="Special pieces">
      <span class="pc-specials-title">Special pieces</span>
      ${specialTiles(base)}
    </div>
    <div class="ct-body pc-body">
      <div class="pc-preview">
        <div class="pc-footprint"><svg data-piece-preview role="img" aria-label="Track outline and guide slots"></svg></div>
        <div class="pc-family" data-family-preview hidden><h3>Matching radius family</h3><div data-family-graphic></div></div>
      </div>
      <div class="ct-controls">
        <div hidden>${choice('pcSpecial', 'Special piece', 'hairpin', SPECIAL_PIECES)}</div>
        <label class="ct-name">Piece name<input class="text" data-piece-name maxlength="100"></label>
        <div data-for="straight">
          ${field('pcLength', 'Length', base.length, 'mm', { min: 1, max: 20000 })}
          ${check('pcStartingGrid', 'Starting grid', false)}
        </div>
        <div data-for="curve">
          ${choice('pcMode', 'Define this curve', mode, [
            ['family', 'Matching radius family'],
            ['independent', 'Independent measurements'],
          ])}
          <div data-family>
            ${choice('pcIndex', 'Radius in set', String(index), radiusOptions)}
            ${field('pcBase', 'R1 inner road edge', r1, 'mm', { min: 0.01, max: 20000 })}
          </div>
          ${field('pcInner', 'Inner road edge radius', r1, 'mm', { min: 0.01, max: 20000 })}
          ${field('pcAngle', 'Sweep angle', packRules?.angle ?? familyDefaults?.angle ?? 45, '°', { min: 0.1, max: 359 })}
        </div>
        <div data-for="special" hidden>
          <div data-special-controls></div>
          ${choice('pcBorderSide', 'Borders', base.borderSide, specialBorderChoices)}
        </div>
        ${field('pcWidth', 'Road width', dimensions.width, 'mm', { min: 2, max: 5000 })}
        ${field('pcLanes', 'Lanes', dimensions.lanes, '', { min: 1, max: 8, step: 1 })}
        ${field('pcSpacing', 'Lane spacing', dimensions.laneSpacing, 'mm', { min: 0.1, max: 1000 })}
        ${slotSpacingHint(base)}
        ${packRules ? '<p class="hint">Change road width, lanes, spacing and the R1 inner road edge in Pack rules.</p>' : ''}
        ${creatorLaneControls()}
        ${slotPositionControls({ ...base, kind: 'curve', width: dimensions.width, lanes: dimensions.lanes, laneSpacing: dimensions.laneSpacing }, slotFields)}
        <p class="hint" data-slot-lengths></p>
        <p class="hint" data-family-note></p>
      </div>
    </div>
    <footer><span role="status" data-ct-status></span><button type="button" data-close>Cancel</button><button type="button" class="primary" data-pc-apply>${collectionName ? 'Add to pack' : 'Use track piece'}</button></footer>`;
  document.body.append(dialog);
  const get = (selector) => dialog.querySelector(selector);
  const input = (name) => get('[name="' + name + '"]');
  const number = (name) => input(name).valueAsNumber;
  const name = get('[data-piece-name]');
  const commit = get('[data-pc-apply]');
  const status = get('[data-ct-status]');
  const lanes = bindCreatorLaneControls(dialog, base.laneAdjustment);
  if (packRules) {
    for (const key of ['pcWidth', 'pcLanes', 'pcSpacing', 'pcBase'])
      input(key).readOnly = true;
  }
  let shape = 'curve',
    editingName = false,
    busy = false,
    recipe;
  let activeSpecial;
  const templateDrafts = new Map();

  function readSpecial() {
    const settings = {};
    for (const el of get('[data-special-controls]').querySelectorAll(
      'input[name], select[name]',
    )) {
      if (el.type === 'checkbox') settings[el.name] = el.checked;
      else settings[el.name] = el.type === 'number' ? el.valueAsNumber : el.value;
    }
    return settings;
  }

  function refresh(changed) {
    const curve = shape === 'curve';
    const special = shape === 'special';
    const grid = shape === 'straight' && input('pcStartingGrid').checked;
    const family = curve && input('pcMode').value === 'family';
    const r1InnerRadius = number('pcBase'),
      index = Number(input('pcIndex').value);
    const width = number('pcWidth'),
      angle = number('pcAngle');
    const spacing = input('pcSpacing');
    const single = number('pcLanes') === 1;
    spacing.closest('label').hidden = single;
    if (single && !spacing.validity.valid) spacing.value = spacing.defaultValue;
    if (family) {
      const inner = r1InnerRadius + (index - 1) * width;
      input('pcInner').value = Number.isFinite(inner)
        ? Number(inner.toFixed(8))
        : '';
    }
    input('pcInner').readOnly = family;
    for (const button of dialog.querySelectorAll('[data-shape]'))
      button.setAttribute(
        'aria-pressed',
        String(
          button.dataset.shape === shape &&
            (!button.dataset.special ||
              button.dataset.special === input('pcSpecial').value),
        ),
      );
    for (const el of dialog.querySelectorAll('[data-for]'))
      el.hidden = el.dataset.for !== shape;
    get('[data-family]').hidden = !family;
    get('[data-family-preview]').hidden = !family;
    const template = input('pcSpecial').value;
    const source = {
      ...base,
      width,
      lanes: number('pcLanes'),
      laneSpacing: number('pcSpacing'),
    };
    let templateParams;
    if (special) {
      templateParams = specialTrackParams(template, source);
      if (activeSpecial !== template) {
        if (activeSpecial) templateDrafts.set(activeSpecial, readSpecial());
        const controls = get('[data-special-controls]');
        controls.innerHTML = specialControls(templateParams, { creating: true });
        for (const el of controls.querySelectorAll('input, select')) {
          const old = templateDrafts.get(template)?.[el.name];
          if (old === undefined) continue;
          if (el.type === 'checkbox') el.checked = old;
          else el.value = Number.isNaN(old) ? '' : old;
        }
        activeSpecial = template;
      }
      syncSpecialControls(dialog);
    }
    const params = special ? templateParams : { ...source, kind: shape };
    delete params.curveGridRadius;
    if (curve) {
      params.angle = angle;
      params.radius = number('pcInner') + width / 2;
      if (family)
        params.curveGridRadius =
          familyDefaults?.gridRadius &&
          r1InnerRadius + index * width <= familyDefaults.gridRadius
            ? familyDefaults.gridRadius
            : Math.min(25000, r1InnerRadius + 8 * width);
    } else if (special) {
      const fields = readSpecial();
      readSpecialFields(fields, params);
      Object.assign(params, fields, {
        borderSide: input('pcBorderSide').value,
      });
    } else params.length = number('pcLength');
    const adjustment = special ? null : lanes(params, changed);
    if (special) get('[data-lane-editor]').hidden = true;
    if (adjustment) params.laneAdjustment = adjustment;
    else delete params.laneAdjustment;
    syncSlotPositionControls(dialog, {
      kind: shape,
      lanes: params.lanes,
      special,
      squeeze: Boolean(adjustment),
      spacing: input('pcSpacing').value,
    });
    const slot = readSlotPosition(slotFieldValues(dialog, slotFields), params);
    if (slot) params.slotPosition = slot;
    else delete params.slotPosition;
    showSlotAdvice(dialog, params);
    const slotName =
      slot && [...slotDistances(params, 0), ...slotDistances(params, 1)].every(Number.isFinite)
        ? ' · ' + slotTitle(params)
        : '';
    if (!editingName)
      name.value =
        (special
          ? specialName(template)
          : curve
            ? (family ? 'R' + index + ' corner' : 'Corner') +
              (Number.isFinite(angle) ? ' · ' + angle + '°' : '')
            : (grid ? 'Starting grid' : 'Straight') +
              (Number.isFinite(number('pcLength'))
                ? ' · ' + number('pcLength') + ' mm'
                : '')) +
        slotName;
    try {
      if (
        [...dialog.querySelectorAll('input[type="number"]')].some(
          (el) => !el.disabled && !el.closest('[hidden]') && !el.validity.valid,
        )
      )
        throw Error('Enter a valid measurement in each visible field.');
      if (grid) params.startingGrid = defaultStartingGrid(params);
      validateTrack(params);
      fitUneditedPitGrid(dialog, params);
      recipe = { params, plan: null, sourceName: name.value.trim() };
      if (family) recipe.curveFamily = { index, r1InnerRadius };
      const preview = piecePreview(params);
      const svg = get('[data-piece-preview]');
      svg.setAttribute('viewBox', preview.viewBox);
      svg.innerHTML = preview.marks;
      get('[data-slot-lengths]').textContent = preview.lengths.length
        ? 'Slot lengths · ' + preview.lengths.map(fmt).join(' / ') + ' mm'
        : '';
      if (family) {
        const familyView = matchingFamilyPreview(r1InnerRadius, width, index);
        get('[data-family-graphic]').innerHTML =
          familyView.diagram + familyView.table;
        const turns = 360 / angle;
        // Slot 1 of the next radius out sits beside the last slot of this one.
        const slots = slot ? slotDistances(params, 0) : [];
        const span = slots.length
          ? slots.at(-1) - slots[0]
          : (params.lanes - 1) * params.laneSpacing;
        get('[data-family-note]').textContent =
          'Nesting shown at 90°. ' +
          (Number.isInteger(turns)
            ? turns + ' pieces make a full circle. '
            : '') +
          'Slot spacing across adjacent radii is ' +
          fmt(width - span) +
          (slot ? ' mm when every radius uses this slot position.' : ' mm.');
      } else get('[data-family-note]').textContent = '';
      status.textContent = recipe.sourceName
        ? ''
        : 'Enter a name for this piece.';
      status.classList.remove('ct-error');
    } catch (err) {
      recipe = null;
      get('[data-piece-preview]').replaceChildren();
      get('[data-family-graphic]').replaceChildren();
      get('[data-slot-lengths]').textContent = '';
      get('[data-family-note]').textContent = '';
      status.textContent = err.message;
      status.classList.add('ct-error');
    }
    commit.disabled = busy || !recipe?.sourceName;
  }

  dialog.addEventListener('input', (e) => {
    if (e.target === name) editingName = true;
    // The Centred / Off-centre switch sets the edge field it stands for, and
    // the Lanes choice carries the slot positions into the mode it opens.
    applySlotLanes(e.target, number('pcSpacing'), slotFields);
    refresh(applySlotMode(e.target) ?? e.target);
  });
  dialog.addEventListener('change', (e) => {
    if (snapSlotField(e.target, slotFields)) refresh(e.target);
  });
  dialog.addEventListener('keydown', (e) => e.stopPropagation());
  dialog.addEventListener('cancel', (e) => {
    if (busy) e.preventDefault();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('click', async (e) => {
    e.stopPropagation();
    const button = e.target.closest('button');
    if (!button || busy) return;
    if (button.hasAttribute('data-close')) return dialog.close();
    const nextShape = button.dataset.shape;
    if (nextShape === 'freeform') {
      const params = { ...base, ...(recipe?.params || {}), kind: 'import' };
      delete params.special;
      delete params.curveGridRadius;
      // A freeform path keeps its slot where it is drawn.
      delete params.slotPosition;
      if (params.laneAdjustment)
        params.laneAdjustment = { ...params.laneAdjustment, anchor: 'centre' };
      dialog.close();
      openCustomTrackEditor({
        track: {
          params,
          plan: null,
          sourceName: editingName ? name.value.trim() : '',
        },
        onApply,
        collectionName,
        packRules,
      });
    } else if (nextShape) {
      if (button.dataset.special) input('pcSpecial').value = button.dataset.special;
      shape = nextShape;
      refresh();
    } else if (button === commit && recipe?.sourceName) {
      busy = true;
      for (const control of dialog.querySelectorAll('button,input,select'))
        control.disabled = true;
      const applied = recipe;
      try {
        if ((await onApply(applied)) === false)
          throw Error(
            'Could not build this track piece with its current settings.',
          );
        if (shape === 'curve')
          onFamilyApplied?.({
            index: Number(input('pcIndex').value),
            matched: Boolean(applied.curveFamily),
            ...(!packRules && {
              r1InnerRadius: number('pcBase'),
              angle: applied.params.angle,
            }),
            ...(applied.curveFamily &&
              !packRules && {
                width: applied.params.width,
                lanes: applied.params.lanes,
                laneSpacing: applied.params.laneSpacing,
              }),
          });
        dialog.close();
      } catch (err) {
        busy = false;
        for (const control of dialog.querySelectorAll('button,input,select'))
          control.disabled = false;
        refresh();
        status.textContent = err.message;
        status.classList.add('ct-error');
      }
    }
  });
  refresh();
  dialog.showModal();
  return dialog;
}

// One picture tile per special piece, drawn on the dialog's starting rules.
function specialTiles(base) {
  return SPECIAL_PIECES.map(([type, name]) => {
    let picture = '';
    try {
      picture = trackThumbnail({ params: specialTrackParams(type, base), plan: null });
    } catch {
      /* A special this road cannot have: the tile explains when chosen. */
    }
    return (
      '<button type="button" class="pc-special" data-shape="special" data-special="' +
      type +
      '" title="' +
      esc(name) +
      '">' +
      picture +
      '<span>' +
      esc(SPECIAL_SHORT_NAMES[type] ?? name) +
      '</span></button>'
    );
  }).join('');
}
