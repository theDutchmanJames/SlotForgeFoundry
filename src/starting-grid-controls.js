import { check, choice, details, field, esc } from './ui.js';
import { defaultPitGrid, defaultStartingGrid } from './geometry/starting-grid.js';

const gridFields = ['gridEnabled', 'gridWidth', 'gridThickness', 'gridLegLength', 'gridLayout', 'gridStagger', 'gridRecessed'];
const pitGridKeys = ['width', 'thickness', 'legLength', 'position', 'recessed'];
const pitField = key => 'spPitGrid' + key[0].toUpperCase() + key.slice(1);

function markSizeFields(prefix, grid) {
  return field(prefix + 'Width', 'Mark width', grid.width, 'mm', { min: 0.1 }) +
    field(prefix + 'Thickness', 'Line thickness', grid.thickness, 'mm', { min: 0.1 }) +
    field(prefix + 'LegLength', 'Leg length', grid.legLength, 'mm', { min: 0 }) +
    '<p class="hint">Width is measured across the car. Set leg length to 0 for a straight line.</p>';
}

function layoutOf(stagger) {
  if (stagger === 0) return 'aligned';
  return stagger > 0 ? 'left' : 'right';
}

function gridControlValues(p, grid = p.startingGrid ?? defaultStartingGrid(p)) {
  return {
    gridEnabled: !!p.startingGrid,
    gridWidth: grid.width,
    gridThickness: grid.thickness,
    gridLegLength: grid.legLength,
    gridLayout: layoutOf(grid.stagger),
    gridStagger: Math.abs(grid.stagger) || defaultStartingGrid({ ...p, lanes: 2 }).stagger,
    gridRecessed: grid.recessed,
  };
}

export function startingGridControls(p) {
  const grid = p.startingGrid ?? defaultStartingGrid(p);
  const controls = gridControlValues(p, grid);
  return details('Starting grid',
    check('gridEnabled', 'Show starting marks', controls.gridEnabled) +
    '<fieldset class="border-apex-fields" data-lanes="' + p.lanes + '" data-grid-marks' + (controls.gridEnabled ? '' : ' hidden disabled') + '>' +
    markSizeFields('grid', grid) +
    '<div data-grid-rows' + (p.lanes < 2 ? ' hidden' : '') + '>' +
    choice('gridLayout', 'Grid positions', controls.gridLayout, [
      ['aligned', 'Side by side'], ['left', 'Leftmost lane ahead'], ['right', 'Leftmost lane behind'],
    ]) +
    '<div data-grid-offset' + (controls.gridLayout === 'aligned' ? ' hidden' : '') + '>' +
    field('gridStagger', 'Row offset', controls.gridStagger, 'mm', { min: 0.1 }) +
    '<p class="hint" data-grid-alternating' + (p.lanes < 3 ? ' hidden' : '') + '>Lanes alternate between the front and back rows.</p></div></div>' +
    check('gridRecessed', 'Recess the mark outline', controls.gridRecessed) +
    '<p class="hint" data-grid-groove' + (controls.gridRecessed ? '' : ' hidden') + '>Set groove width and depth in Shared line and groove dimensions.</p>' +
    '</fieldset>', controls.gridEnabled, 'startingGrid');
}

export function pitGridControls(p, creating) {
  const enabled = !!p.special.pitGrid;
  const grid = p.special.pitGrid ?? defaultPitGrid(p);
  const independent = p.special.side === 'both' && grid.rightPosition !== undefined;
  const options = check('spPitGridEnabled', 'Show pit grid marker', enabled) +
    '<fieldset class="border-apex-fields" data-pit-grid' + (enabled ? '>' : ' data-pit-grid-auto hidden disabled>') +
    field('spPitGridPosition', independent ? 'Left pit position' : 'Position along pit bay', grid.position, '%', { min: 0, max: 100 }) +
    '<div class="pit-grid-position"><span>Entry</span>' +
    '<input type="range" data-pit-grid-slider aria-label="Slide marker along pit bay" min="0" max="100" step="0.1" value="' +
    esc(grid.position) + '"><span>Exit</span></div>' +
    '<div data-pit-grid-pair' + (p.special.side === 'both' ? '>' : ' hidden>') +
    check('spPitGridIndependent', 'Position right pit separately', independent) +
    '<div data-right-pit-position' + (independent ? '>' : ' hidden>') +
    field('spPitGridRightPosition', 'Right pit position', grid.rightPosition ?? grid.position, '%', { min: 0, max: 100 }) +
    '</div></div>' +
    markSizeFields('spPitGrid', grid) +
    check('spPitGridRecessed', 'Recess the mark outline', grid.recessed) +
    '<p class="hint" data-pit-grid-groove' + (grid.recessed ? '>' : ' hidden>') +
    'Set groove width and depth under Road → Shared line and groove dimensions.</p></fieldset>';
  return creating ? options : details('Pit grid marker', options, enabled, 'pitGrid');
}

export function syncPitGridControls(container) {
  const group = container.querySelector('[data-pit-grid]');
  if (!group) return;
  group.hidden = group.disabled = !container.querySelector('[name="spPitGridEnabled"]').checked;
  const both = container.querySelector('[name="spSide"]').value === 'both';
  const independent = group.querySelector('[name="spPitGridIndependent"]');
  const right = group.querySelector('[name="spPitGridRightPosition"]');
  group.querySelector('[data-pit-grid-pair]').hidden = independent.disabled = !both;
  const separate = both && independent.checked;
  group.querySelector('[data-right-pit-position]').hidden = right.disabled = !separate;
  group.querySelector('[data-pit-grid-groove]').hidden = !group.querySelector('[name="spPitGridRecessed"]').checked;
  const position = group.querySelector('[name="spPitGridPosition"]');
  position.closest('label').firstElementChild.textContent = separate ? 'Left pit position' : 'Position along pit bay';
  if (!independent.checked && !independent.defaultChecked && !right.dataset.edited)
    right.value = position.value;
  right.oninput ??= () => { right.dataset.edited = 'true'; };
  const slider = group.querySelector('[data-pit-grid-slider]');
  if (Number.isFinite(position.valueAsNumber)) slider.value = position.value;
  slider.setAttribute('aria-valuetext', slider.value + '% along the flat pit bay');
  slider.oninput ??= event => {
    event.stopPropagation();
    position.value = slider.value;
    position.dispatchEvent(new Event('input', { bubbles: true }));
  };
}

// While the optional mark is off, fit its untouched dimensions to the current
// bay. Once the driver edits a dimension, keep their choice through toggles.
export function fitUneditedPitGrid(container, params) {
  if (params.special?.type !== 'pit' || params.special.pitGrid) return;
  const group = container.querySelector('[data-pit-grid-auto]:disabled');
  if (!group) return;
  const defaults = defaultPitGrid(params);
  for (const key of ['width', 'thickness', 'legLength']) {
    const input = group.querySelector('[name="' + pitField(key) + '"]');
    if (input.value !== (input.dataset.autoValue ?? input.defaultValue) || !Number.isFinite(defaults[key])) continue;
    input.value = defaults[key];
    input.dataset.autoValue = input.value;
  }
}

export function readPitGridFields(fields, p) {
  if (p.special?.type !== 'pit') return;
  const enabled = fields.spPitGridEnabled;
  if (enabled === false) delete p.special.pitGrid;
  else if (enabled || p.special.pitGrid) {
    const grid = { ...(p.special.pitGrid ?? defaultPitGrid(p)) };
    for (const key of pitGridKeys) {
      const name = pitField(key);
      if (Object.hasOwn(fields, name)) grid[key] = fields[name];
    }
    if (p.special.side !== 'both' || fields.spPitGridIndependent === false) delete grid.rightPosition;
    else if (fields.spPitGridIndependent === true || grid.rightPosition !== undefined)
      grid.rightPosition = fields.spPitGridRightPosition ?? grid.rightPosition ?? grid.position;
    p.special.pitGrid = grid;
  }
  delete fields.spPitGridEnabled;
  delete fields.spPitGridIndependent;
  delete fields.spPitGridRightPosition;
  for (const key of pitGridKeys) delete fields[pitField(key)];
}

// A grid can disappear in one edit. Restore the settings that disappeared with it.
export function gridRestoreValues(before, after, changed) {
  const pitGrid = before.special?.pitGrid;
  if (pitGrid && !after.special?.pitGrid && 'spPitGridEnabled' in changed)
    return { spPitGridEnabled: true, spPitGridIndependent: pitGrid.rightPosition !== undefined,
      spPitGridRightPosition: pitGrid.rightPosition ?? pitGrid.position,
      ...Object.fromEntries(pitGridKeys.map(key => [pitField(key), pitGrid[key]])) };
  if (pitGrid?.rightPosition !== undefined && after.special?.pitGrid?.rightPosition === undefined &&
      ('spSide' in changed || 'spPitGridIndependent' in changed))
    return { spPitGridIndependent: true, spPitGridRightPosition: pitGrid.rightPosition };
  if (!before.startingGrid) return {};
  if (!after.startingGrid && ('gridEnabled' in changed || 'kind' in changed))
    return gridControlValues(before);
  if (before.startingGrid.stagger && after.startingGrid?.stagger === 0 &&
      ('gridLayout' in changed || 'lanes' in changed)) {
    const { gridLayout, gridStagger } = gridControlValues(before);
    return { gridLayout, gridStagger };
  }
  return {};
}

export function gridFieldDependencies(name, current, previous) {
  if (name === 'spPitGridEnabled' && !current.special?.pitGrid && previous.spPitGridEnabled)
    return { spPitGridIndependent: previous.spPitGridIndependent, spPitGridRightPosition: previous.spPitGridRightPosition,
      ...Object.fromEntries(pitGridKeys.map(key => [pitField(key), previous[pitField(key)]])) };
  if ((name === 'spPitGridIndependent' || name === 'spSide') && previous.spPitGridIndependent &&
    current.special?.pitGrid?.rightPosition === undefined)
    return { spPitGridIndependent: true, spPitGridRightPosition: previous.spPitGridRightPosition };
  if ((name === 'gridEnabled' || name === 'kind') && !current.startingGrid && previous.gridEnabled)
    return Object.fromEntries(gridFields.map(key => [key, previous[key]]));
  if ((name === 'lanes' || name === 'gridLayout') && current.startingGrid?.stagger === 0 &&
      ['left', 'right'].includes(previous.gridLayout) && previous.gridStagger != null)
    return { gridLayout: previous.gridLayout, gridStagger: previous.gridStagger };
  return {};
}

export function syncStartingGridControls(form) {
  const e = form.elements;
  if (!e.gridEnabled) return;
  const group = form.querySelector('[data-grid-marks]');
  group.hidden = group.disabled = !e.gridEnabled.checked;
  // Lanes are set under Shape; the grid carries the piece's count with it.
  const lanes = Number(e.lanes?.value ?? group.dataset.lanes ?? 2);
  form.querySelector('[data-grid-rows]').hidden = e.gridLayout.disabled = lanes < 2;
  form.querySelector('[data-grid-offset]').hidden = e.gridStagger.disabled = lanes < 2 || e.gridLayout.value === 'aligned';
  form.querySelector('[data-grid-alternating]').hidden = lanes < 3;
  form.querySelector('[data-grid-groove]').hidden = !e.gridRecessed.checked;
}

export function readStartingGridFields(fields, p) {
  if ((fields.kind ?? p.kind) !== 'straight' || p.special || fields.gridEnabled === false) {
    delete p.startingGrid;
  } else if (fields.gridEnabled) {
    const lanes = fields.lanes ?? p.lanes;
    const grid = p.startingGrid ?? defaultStartingGrid({ ...p, ...fields });
    const layout = fields.gridLayout ?? layoutOf(grid.stagger);
    const offset = fields.gridStagger ?? Math.abs(grid.stagger);
    p.startingGrid = {
      width: fields.gridWidth ?? grid.width,
      thickness: fields.gridThickness ?? grid.thickness,
      legLength: fields.gridLegLength ?? grid.legLength,
      stagger: lanes < 2 || layout === 'aligned' ? 0 : layout === 'left' ? offset : -offset,
      recessed: fields.gridRecessed ?? grid.recessed,
    };
  }
  for (const key of gridFields) delete fields[key];
}
