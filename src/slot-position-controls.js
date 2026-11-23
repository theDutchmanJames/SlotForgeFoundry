import { esc, field, fmt } from './ui.js';
import { slotAdvice } from './slot-advice.js';
import {
  hasSlotPosition,
  normaliseSlotPosition,
  slotDistances,
  slotEdgeName,
  slotEnds,
  slotForm,
  slotRoom,
  slotTitle,
} from './slot-position.js';

// The Slot position group, shared by the piece creator and the inspector.
// One field carries the choice: 'centre', or the road edge the distances are
// measured from. The Centred / Off-centre switch above it has no name of its
// own, so it never becomes a saved setting. With two or more lanes a second
// choice says whether the lanes move together (the two distances of slot 1)
// or each lane is set (a table, one row per slot, numbered from the edge).

/** Most lanes a road can have, so most rows the lane table needs. */
const MAX_LANES = 8;

/** The group's field names under a dialog's own prefix, such as 'pc' ('' for the inspector). */
export const slotFieldNames = (prefix = '') => {
  const base = prefix ? prefix + 'Slot' : 'slot';
  const lane = (end) => Object.freeze(Array.from({ length: MAX_LANES }, (_, i) => base + 'Lane' + (i + 1) + end));
  return Object.freeze({
    edge: base + 'Edge',
    start: base + 'Start',
    end: base + 'End',
    lanes: base + 'Lanes',
    laneStarts: lane('Start'),
    laneEnds: lane('End'),
  });
};
/** The inspector's field names. Warnings point at these. */
export const SLOT_FIELDS = slotFieldNames();

/** Every field name of the group, in markup order. */
export const slotFieldList = (names = SLOT_FIELDS) => [
  names.edge, names.lanes, names.start, names.end,
  ...names.laneStarts.flatMap((start, i) => [start, names.laneEnds[i]]),
];

const distanceNames = (names) => [names.start, names.end, ...names.laneStarts, ...names.laneEnds];

/** Typed distances settle on half millimetres. */
export const snapSlot = (mm) => Math.round(mm * 2) / 2;

const laneCountOf = (p) => Number(p.lanes);
const severalLanes = (lanes) => Number(lanes) >= 2 && Number(lanes) <= MAX_LANES;

/** The pieces that can carry off-centre slots: native straights and curves of 1 to 8 lanes. */
export const slotPositionAllowed = (p) => {
  const lanes = laneCountOf(p);
  return !p.special && ['straight', 'curve'].includes(p.kind) && Number.isInteger(lanes) && lanes >= 1 && lanes <= MAX_LANES;
};

/**
 * The slot position a piece gets from the controls, or null for centred
 * slots. `lanes` is 'together' or 'each'; `starts` and `ends` hold the lane
 * table, slot 1 (nearest the edge) first. A curve keeps the distances of
 * end A at both ends. Slots typed where a centred piece has them are
 * centred, and a table spaced exactly the lane spacing is stored as lanes
 * moving together (normaliseSlotPosition).
 */
export function readSlotPosition({ edge, start, end, lanes = 'together', starts = [], ends = [] }, p) {
  if (!['outer', 'inner'].includes(edge) || !slotPositionAllowed(p)) return null;
  const curve = p.kind === 'curve',
    count = laneCountOf(p);
  let slot;
  if (count >= 2 && lanes === 'each') {
    slot = {
      version: 1,
      edge,
      lanes: Array.from({ length: count }, (_, k) => {
        const startMm = snapSlot(starts[k]);
        return { startMm, endMm: curve ? startMm : snapSlot(ends[k]) };
      }),
    };
  } else {
    const startMm = snapSlot(start);
    slot = { version: 1, edge, startMm, endMm: curve ? startMm : snapSlot(end) };
  }
  return normaliseSlotPosition({ ...p, lanes: count, slotPosition: slot }) ?? null;
}

/**
 * Moves the controls' values out of `fields` and into p.slotPosition. Road
 * geometry, width, lane count and spacing edited on the same page win over p.
 */
export function consumeSlotFields(fields, p, names = SLOT_FIELDS) {
  if (!Object.hasOwn(fields, names.edge)) return;
  const slot = readSlotPosition(
    {
      edge: fields[names.edge],
      start: fields[names.start],
      end: fields[names.end],
      lanes: fields[names.lanes],
      starts: names.laneStarts.map((name) => fields[name]),
      ends: names.laneEnds.map((name) => fields[name]),
    },
    {
      special: p.special,
      kind: fields.kind ?? p.kind,
      width: fields.width ?? p.width,
      lanes: fields.lanes ?? p.lanes,
      laneSpacing: fields.laneSpacing ?? p.laneSpacing,
    },
  );
  if (slot) p.slotPosition = slot;
  else delete p.slotPosition;
  for (const name of slotFieldList(names)) delete fields[name];
}

// Fields whose edit can change or remove the slot position.
const SLOT_SOURCES = ['kind', 'width', 'lanes', 'laneSpacing', ...slotFieldList()];

/**
 * What Restore needs to bring an applied slot position back. An edit such as
 * Centred or a new lane count drafts only one field, so the record of that
 * edit would otherwise hold no distances. Returns {} when nothing needs adding.
 */
export function slotRestoreValues(before, after, changed) {
  const s = before.slotPosition;
  if (!s || JSON.stringify(s) === JSON.stringify(after.slotPosition ?? null)) return {};
  if (!SLOT_SOURCES.some((name) => name in changed)) return {};
  const names = SLOT_FIELDS;
  if (slotForm(before) !== 'each') {
    const values = { [names.edge]: s.edge, [names.start]: s.startMm, [names.end]: s.endMm };
    return Number(before.lanes) >= 2 ? { ...values, [names.lanes]: 'together' } : values;
  }
  const values = {
    [names.edge]: s.edge,
    [names.lanes]: 'each',
    [names.start]: s.lanes[0].startMm,
    [names.end]: s.lanes[0].endMm,
  };
  for (const [k, { startMm, endMm }] of s.lanes.entries()) {
    values[names.laneStarts[k]] = startMm;
    values[names.laneEnds[k]] = endMm;
  }
  return values;
}

/**
 * Restoring one slot field brings the others recorded with it. So does
 * restoring a field that rebuilds the slots (kind, width, lane count or
 * spacing) when the same edit recorded the slots: a list set lane by lane, or
 * a slot the edit centred, comes back as it was rather than rebuilt.
 */
export function slotFieldDependencies(name, previous) {
  const names = slotFieldList();
  if (!names.includes(name) && !(SLOT_SOURCES.includes(name) && SLOT_FIELDS.edge in previous)) return {};
  return Object.fromEntries(
    names.filter((other) => other !== name && other in previous).map((other) => [other, previous[other]]),
  );
}

const pieceCount = (n, one, many) => (n === 1 ? '1 piece ' + one : n + ' pieces ' + many);

/**
 * The pack rules box line on the slots that new rules centre, from the counts
 * of packRuleSlotChanges ({ lanes, centre }). '' when none is centred.
 */
export function packRuleSlotNote({ lanes = 0, centre = 0 } = {}) {
  const total = lanes + centre;
  if (!total) return '';
  const them = total === 1 ? 'it' : 'them';
  const parts = [];
  if (lanes)
    parts.push(
      pieceCount(lanes, 'sets each lane on its own and is', 'set each lane on their own and are') +
        ' centred: ' + (lanes === 1 ? 'its' : 'their') + ' slot positions are for another lane count.',
    );
  if (centre)
    parts.push(
      pieceCount(centre, 'is', 'are') + ' centred: the new rules put ' + (centre === 1 ? 'its' : 'their') +
        ' slots where a centred piece has them.',
    );
  if (!centre)
    parts.push(
      'Setting the lane count back does not bring ' + them +
        ' back. Pieces whose lanes move together keep their slot positions.',
    );
  else parts.push('Setting the rules back does not bring ' + them + ' back.');
  return '<p>' + parts.join(' ') + '</p>';
}

/** The notice after Apply to collection, from its result. */
export function packApplyNotice({ pieces, centred = 0, together = 0 }) {
  return (
    'Applied to all ' + pieces + ' pieces of the pack.' +
    (centred ? ' ' + centred + (centred === 1 ? ' piece has' : ' pieces have') + ' a centred slot now.' : '') +
    (together
      ? ' ' + pieceCount(together, 'set lane by lane now has', 'set lane by lane now have') +
        ' lanes that move together, so a later lane spacing moves ' + (together === 1 ? 'its' : 'their') + ' slots.'
      : '')
  );
}

const edgeTitles = (kind) =>
  kind === 'curve'
    ? { outer: 'Outer edge', inner: 'Inner edge' }
    : { outer: 'Left edge', inner: 'Right edge' };

/** For a tile or a detail line: '' when centred, else 'slot 35-145 from left' or 'slots 35/135 from left'. */
export const slotSummary = (p) => slotTitle(p);

const list = (mms) => mms.map(fmt).join('/');

/** The live line under the distances: the other edge, and the room there is. */
export function slotReadout(p) {
  if (!hasSlotPosition(p)) return '';
  const s = p.slotPosition,
    other = s.edge === 'outer' ? 'inner' : 'outer';
  const { min, max } = slotRoom(p);
  const edge = ' mm from the ' + slotEdgeName(p, other) + ' edge.';
  const room = min <= max ? ' Room on this road: ' + fmt(min) + ' to ' + fmt(max) + ' mm.' : '';
  if (slotDistances(p, 0).length > 1) {
    // Slot by slot, in the order they are numbered from the chosen edge.
    const across = (t) => slotDistances(p, t).map((mm) => p.width - mm);
    const a = across(0),
      b = across(1);
    if (![...a, ...b, min, max].every(Number.isFinite)) return '';
    const same = a.every((mm, k) => mm === b[k]);
    return (same ? list(a) + edge : 'End A is ' + list(a) + ' mm and end B ' + list(b) + edge) + room;
  }
  const ends = slotEnds(p);
  const a = ends.start[other],
    b = ends.end[other];
  if (![a, b, min, max].every(Number.isFinite)) return '';
  return (a === b ? fmt(a) + edge : 'End A is ' + fmt(a) + ' mm and end B ' + fmt(b) + edge) + room;
}

/** Non-blocking remarks as hint paragraphs; warnings read a little stronger. */
export function slotNotesMarkup(p) {
  let advice = [];
  try {
    advice = slotAdvice(p);
  } catch {
    /* Advice never stands in the way of a half-typed piece. */
  }
  return advice
    .map(
      ({ level, text }) =>
        '<p class="hint slot-note' + (level === 'warning' ? ' slot-warning' : '') + '">' +
        esc(text) + '</p>',
    )
    .join('');
}

// A first distance that shows which edge is which: a quarter of the road,
// kept inside the room the slot and braids need.
function suggestedDistance(p) {
  const quarter = snapSlot(p.width / 4);
  if (!Number.isFinite(quarter)) return '';
  const { min, max } = slotRoom(p);
  if (!(min <= max)) return quarter;
  return Math.min(Math.max(quarter, min), max);
}

/** The hint under the two distances of lanes moving together. */
export const slotFollowHint = (spacing) =>
  'Slot 1 is nearest the edge you measure from. The others follow every ' +
  (Number.isFinite(Number(spacing)) && String(spacing) !== '' ? fmt(Number(spacing)) : '…') + ' mm.';

/** Shown beside Lane spacing while each lane has its own slot position. */
export const SLOT_SPACING_UNUSED = 'Lane spacing is not used for slot positions on this piece.';
/** Why a piece that squeezes or spreads its lanes offers no off-centre slots. */
export const SLOT_SQUEEZE_HINT = 'Off-centre slots and Squeeze / Spread cannot be combined.';

/** The hint for the Lane spacing field: put it right after that field. */
export const slotSpacingHint = (p) =>
  '<p class="hint" data-slot-spacing-unused' + (slotForm(p) === 'each' ? '' : ' hidden') + '>' +
  SLOT_SPACING_UNUSED + '</p>';

// Starting values of the lane table: the applied list, or the slots of lanes
// moving together, every lane spacing from slot 1.
function tableValues(p, first) {
  const s = p.slotPosition,
    spacing = Number(p.laneSpacing);
  const steps = (start, end) =>
    Array.from({ length: MAX_LANES }, (_, k) => {
      const at = (mm) => (Number.isFinite(mm + k * spacing) ? snapSlot(mm + k * spacing) : '');
      return [at(start), at(end)];
    });
  if (slotForm(p) !== 'each') return steps(s?.startMm ?? first, s?.endMm ?? first);
  const rows = s.lanes.map((e) => [e.startMm, e.endMm]);
  const last = rows.at(-1);
  return Array.from({ length: MAX_LANES }, (_, k) => {
    if (rows[k]) return rows[k];
    const step = (k - rows.length + 1) * spacing;
    const at = (mm) => (Number.isFinite(mm + step) ? snapSlot(mm + step) : '');
    return [at(last[0]), at(last[1])];
  });
}

// One number box of the lane table. The hidden span names it for screen
// readers, validation messages and the restore arrow.
const cell = (name, label, value) =>
  '<label class="slot-lane-cell"><span class="slot-lane-name">' + esc(label) +
  '</span><span class="input-wrap"><input type="number" name="' + name + '" value="' + esc(value) +
  '" step="any" min="0" max="5000" required><small>mm</small></span></label>';

/** The group's markup for piece p. Follow it with syncSlotPositionControls. */
export function slotPositionControls(p, names = SLOT_FIELDS) {
  const s = p.slotPosition,
    first = suggestedDistance(p),
    titles = edgeTitles(p.kind);
  const option = (value, text, chosen, extra = '') =>
    '<option value="' + value + '"' + (chosen ? ' selected' : '') + extra + '>' + text + '</option>';
  const edge = s?.edge ?? 'centre',
    each = slotForm(p) === 'each',
    many = severalLanes(p.lanes);
  const together = each ? s.lanes[0] : s;
  const labelled = (html, key) => html.replace('<span>', '<span data-slot-label="' + key + '">');
  const rows = tableValues(p, first);
  return (
    '<div data-slot-position>' +
    '<label class="field"><span>Slot position</span><select data-slot-mode>' +
    option('centre', 'Centred', !s) +
    option('off', 'Off-centre', Boolean(s)) +
    '</select></label>' +
    '<p class="hint" data-slot-unavailable hidden>' + SLOT_SQUEEZE_HINT + '</p>' +
    '<fieldset class="border-apex-fields" data-slot-options hidden disabled>' +
    '<label class="field"><span>Measure from</span><select name="' + names.edge + '" data-slot-edge' +
    // The applied edge, so Off-centre returns to it after a redraw.
    (s ? ' data-last="' + s.edge + '"' : '') + '>' +
    option('centre', 'Centred', edge === 'centre', ' hidden') +
    option('outer', titles.outer, edge === 'outer') +
    option('inner', titles.inner, edge === 'inner') +
    '</select></label>' +
    '<p class="hint" data-slot-looking>Looking from end A to end B.</p>' +
    '<div data-slot-lanes-choice' + (many ? '' : ' hidden') + '>' +
    '<label class="field"><span>Lanes</span><select name="' + names.lanes + '" data-slot-lanes>' +
    option('together', 'Lanes move together', !each) +
    option('each', 'Set each lane', each) +
    '</select></label></div>' +
    '<div data-slot-together>' +
    labelled(field(names.start, many ? 'Slot 1 at end A' : 'At end A', together?.startMm ?? first, 'mm', { min: 0, max: 5000 }), 'start') +
    '<div data-slot-end>' +
    labelled(field(names.end, many ? 'Slot 1 at end B' : 'At end B', together?.endMm ?? first, 'mm', { min: 0, max: 5000 }), 'end') +
    '</div>' +
    '<p class="hint" data-slot-follow' + (many ? '' : ' hidden') + '>' + esc(slotFollowHint(p.laneSpacing)) + '</p>' +
    '</div>' +
    '<div class="slot-lane-table" data-slot-each hidden>' +
    '<div class="slot-lane-row slot-lane-head" aria-hidden="true"><span></span>' +
    '<span data-slot-head-start>End A</span><span data-slot-col-end>End B</span></div>' +
    rows
      .map(
        ([a, b], k) =>
          '<div class="slot-lane-row" data-slot-row="' + (k + 1) + '"><span>Slot ' + (k + 1) + '</span>' +
          cell(names.laneStarts[k], 'Slot ' + (k + 1) + ' at end A', a) +
          '<div data-slot-col-end>' + cell(names.laneEnds[k], 'Slot ' + (k + 1) + ' at end B', b) + '</div></div>',
      )
      .join('') +
    '<p class="hint">Slot 1 is nearest the edge you measure from.</p>' +
    '</div>' +
    '<p class="hint" data-slot-curve hidden>Corners keep one slot position. Change position on a straight.</p>' +
    '<p class="hint" data-slot-readout>' + esc(slotReadout(p)) + '</p>' +
    '<div data-slot-notes>' + slotNotesMarkup(p) + '</div>' +
    '</fieldset></div>'
  );
}

/**
 * The Centred / Off-centre switch drives the edge field. Given the control an
 * input event came from, returns the edge field it changed, or null when the
 * control is not that switch.
 */
export function applySlotMode(control) {
  if (!control?.matches?.('[data-slot-mode]')) return null;
  const edge = control.closest('[data-slot-position]').querySelector('[data-slot-edge]');
  edge.value = control.value === 'centre' ? 'centre' : edge.dataset.last || 'outer';
  return edge;
}

/**
 * The Lanes choice carries the positions across: Set each lane fills the
 * table from the slots of lanes moving together (slot 1, then every
 * `spacing` mm), and Lanes move together keeps slot 1. Given the control an
 * input event came from, returns the fields it rewrote ([] for any other
 * control), so the caller can record them.
 */
export function applySlotLanes(control, spacing, names = SLOT_FIELDS) {
  if (control?.name !== names.lanes) return [];
  const host = control.closest('[data-slot-position]');
  const input = (name) => host.querySelector('[name="' + name + '"]');
  const changed = [];
  const put = (el, mm) => {
    if (!el || !Number.isFinite(mm) || el.valueAsNumber === mm) return;
    el.value = String(mm);
    changed.push(el);
  };
  const start = input(names.start),
    end = input(names.end);
  if (control.value === 'each') {
    if (!Number.isFinite(Number(spacing))) return [];
    for (let k = 0; k < MAX_LANES; k++) {
      put(input(names.laneStarts[k]), snapSlot(start.valueAsNumber + k * spacing));
      put(input(names.laneEnds[k]), snapSlot(end.valueAsNumber + k * spacing));
    }
  } else {
    put(start, input(names.laneStarts[0])?.valueAsNumber);
    put(end, input(names.laneEnds[0])?.valueAsNumber);
  }
  return changed;
}

/** Rewrites a just-committed distance on its half millimetre. True when it changed. */
export function snapSlotField(control, names = SLOT_FIELDS) {
  if (!distanceNames(names).includes(control?.name)) return false;
  const typed = control.valueAsNumber,
    snapped = snapSlot(typed);
  if (!Number.isFinite(typed) || snapped === typed) return false;
  control.value = snapped;
  return true;
}

/** The values as the controls hold them, for readSlotPosition. */
export function slotFieldValues(root, names = SLOT_FIELDS) {
  const control = (name) => root.querySelector('[name="' + name + '"]');
  const number = (name) => control(name)?.valueAsNumber ?? NaN;
  return {
    edge: control(names.edge).value,
    start: number(names.start),
    end: number(names.end),
    lanes: control(names.lanes)?.value ?? 'together',
    starts: names.laneStarts.map(number),
    ends: names.laneEnds.map(number),
  };
}

/**
 * The field a warning should focus. A warning names 'slotStart' or a lane
 * row; while the other lane mode is shown, the field it names is disabled,
 * so slot 1 of the shown mode is focused instead.
 */
export function slotFieldToFocus(form, name, names = SLOT_FIELDS) {
  const el = form?.elements?.namedItem?.(name);
  if (!el?.disabled) return name;
  const end = [names.end, ...names.laneEnds].includes(name);
  const start = [names.start, ...names.laneStarts].includes(name);
  if (!end && !start) return name;
  const together = [names.start, names.end].includes(name);
  const other = together ? (end ? names.laneEnds[0] : names.laneStarts[0]) : end ? names.end : names.start;
  return form.elements.namedItem(other)?.disabled === false ? other : name;
}

/**
 * Shows the parts of the group that apply to a piece of this kind, lane
 * count and lane layout. Special pieces, freeform paths and drawings have no
 * group; a piece that squeezes or spreads its lanes shows why Off-centre is
 * missing. `spacing` is the lane spacing as typed, for the hint.
 */
export function syncSlotPositionControls(root, { kind, lanes, special, squeeze = false, spacing }) {
  const host = root?.querySelector('[data-slot-position]');
  if (!host) return;
  const find = (key) => host.querySelector(key);
  const all = (key) => [...(host.querySelectorAll?.(key) ?? [])];
  const plain = !special && ['straight', 'curve'].includes(kind);
  const count = Number(lanes),
    many = severalLanes(count);
  const edge = find('[data-slot-edge]'),
    mode = find('[data-slot-mode]');
  const off = edge.value !== 'centre';
  if (off) edge.dataset.last = edge.value;
  host.hidden = !plain;
  mode.value = off ? 'off' : 'centre';
  // Squeeze / spread and off-centre slots exclude each other. A slot already
  // off-centre keeps the switch, so it can be set back to Centred.
  mode.disabled = !plain || (squeeze && !off);
  mode.closest('label').hidden = false;
  find('[data-slot-unavailable]').hidden = !(plain && squeeze);
  const options = find('[data-slot-options]');
  options.hidden = options.disabled = !(plain && off);
  const curve = kind === 'curve',
    titles = edgeTitles(kind);
  for (const option of edge.options)
    if (titles[option.value]) option.textContent = titles[option.value];
  find('[data-slot-looking]').hidden = curve;
  find('[data-slot-curve]').hidden = !curve;

  const choice = find('[data-slot-lanes-choice]');
  const lanesSelect = find('[data-slot-lanes]');
  if (choice) choice.hidden = !many;
  if (lanesSelect) lanesSelect.disabled = !many;
  const each = many && lanesSelect?.value === 'each';
  const together = find('[data-slot-together]');
  if (together) together.hidden = each;
  find('[data-slot-end]').hidden = curve;
  for (const input of all('[data-slot-together] input')) input.disabled = each;
  find('[data-slot-end] input').disabled = curve || each;
  for (const label of all('[data-slot-label]'))
    label.textContent = (many ? 'Slot 1 at ' : 'At ') + (label.dataset.slotLabel === 'end' ? 'end B' : 'end A');
  const follow = find('[data-slot-follow]');
  if (follow) {
    follow.hidden = !many || each;
    const text = slotFollowHint(spacing);
    if (follow.textContent !== text) follow.textContent = text;
  }
  const table = find('[data-slot-each]');
  if (table) table.hidden = !each;
  for (const row of all('[data-slot-row]')) {
    const used = each && Number(row.dataset.slotRow) <= count;
    row.hidden = !used;
    for (const input of row.querySelectorAll('input')) input.disabled = !used;
    const later = row.querySelector('[data-slot-col-end] input');
    if (later) later.disabled = !used || curve;
  }
  for (const column of all('[data-slot-col-end]')) column.hidden = curve;
  const head = find('[data-slot-head-start]');
  if (head) head.textContent = curve ? 'Distance' : 'End A';
  const unused = root.querySelector('[data-slot-spacing-unused]');
  if (unused) unused.hidden = !(plain && off && each);
}

/** Fills the read-out line and the notes for the piece as it now stands. */
export function showSlotAdvice(root, p) {
  const host = root?.querySelector('[data-slot-position]');
  if (!host) return;
  const off = host.querySelector('[data-slot-edge]').value !== 'centre';
  const readout = host.querySelector('[data-slot-readout]');
  const text = hasSlotPosition(p)
    ? slotReadout(p)
    : off && slotPositionAllowed(p)
      ? Number(p.lanes) >= 2
        ? 'Every slot is where a centred piece has it, so the slots stay centred.'
        : 'Both ends are in the middle of the road, so the slot stays centred.'
      : '';
  if (readout.textContent !== text) readout.textContent = text;
  const notes = host.querySelector('[data-slot-notes]');
  const markup = slotNotesMarkup(p);
  // Leave unchanged notes alone, so a screen reader does not read them again.
  if (notes.innerHTML !== markup) notes.innerHTML = markup;
}
