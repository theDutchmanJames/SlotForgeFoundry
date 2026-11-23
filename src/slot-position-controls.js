import { esc, field, fmt } from './ui.js';
import { slotAdvice } from './slot-advice.js';
import {
  hasSlotPosition,
  slotEdgeName,
  slotEnds,
  slotLabel,
  slotRoom,
} from './slot-position.js';

// The Slot position group, shared by the piece creator and the inspector.
// One field carries the choice: 'centre', or the road edge the two distances
// are measured from. The Centred / Off-centre switch above it has no name of
// its own, so it never becomes a saved setting.

/** The inspector's field names. Warnings point at these. */
export const SLOT_FIELDS = Object.freeze({
  edge: 'slotEdge',
  start: 'slotStart',
  end: 'slotEnd',
});
/** The same three fields under a dialog's own prefix, such as 'pc'. */
export const slotFieldNames = (prefix) => ({
  edge: prefix + 'SlotEdge',
  start: prefix + 'SlotStart',
  end: prefix + 'SlotEnd',
});

/** Typed distances settle on half millimetres. */
export const snapSlot = (mm) => Math.round(mm * 2) / 2;

/** The pieces that can carry an off-centre slot: single-lane straights and curves. */
export const slotPositionAllowed = (p) =>
  !p.special && ['straight', 'curve'].includes(p.kind) && Number(p.lanes) === 1;

/**
 * The slot position a piece gets from the three controls, or null for a
 * centred slot. A curve keeps the distance of end A at both ends, and a slot
 * typed onto the middle of the road is centred: it is never stored.
 */
export function readSlotPosition({ edge, start, end }, p) {
  if (!['outer', 'inner'].includes(edge) || !slotPositionAllowed(p)) return null;
  const startMm = snapSlot(start);
  const endMm = p.kind === 'curve' ? startMm : snapSlot(end);
  if (startMm === endMm && startMm === p.width / 2) return null;
  return { version: 1, edge, startMm, endMm };
}

/**
 * Moves the three controls' values out of `fields` and into p.slotPosition.
 * Road geometry, width and lane count edited on the same page win over p.
 */
export function consumeSlotFields(fields, p, names = SLOT_FIELDS) {
  if (!Object.hasOwn(fields, names.edge)) return;
  const slot = readSlotPosition(
    { edge: fields[names.edge], start: fields[names.start], end: fields[names.end] },
    {
      special: p.special,
      kind: fields.kind ?? p.kind,
      width: fields.width ?? p.width,
      lanes: fields.lanes ?? p.lanes,
    },
  );
  if (slot) p.slotPosition = slot;
  else delete p.slotPosition;
  for (const name of Object.values(names)) delete fields[name];
}

// Fields whose edit can change or remove the slot position.
const SLOT_SOURCES = ['kind', 'width', 'lanes', ...Object.values(SLOT_FIELDS)];

/**
 * What Restore needs to bring an applied slot position back. An edit such as
 * Centred or a second lane drafts only one field, so the record of that edit
 * would otherwise hold no distances. Returns {} when nothing needs adding.
 */
export function slotRestoreValues(before, after, changed) {
  const s = before.slotPosition;
  if (!s || JSON.stringify(s) === JSON.stringify(after.slotPosition ?? null)) return {};
  if (!SLOT_SOURCES.some((name) => name in changed)) return {};
  return {
    [SLOT_FIELDS.edge]: s.edge,
    [SLOT_FIELDS.start]: s.startMm,
    [SLOT_FIELDS.end]: s.endMm,
  };
}

/** Restoring one slot field brings the other two recorded with it. */
export function slotFieldDependencies(name, previous) {
  const names = Object.values(SLOT_FIELDS);
  if (!names.includes(name)) return {};
  return Object.fromEntries(
    names.filter((other) => other !== name && other in previous).map((other) => [other, previous[other]]),
  );
}

const edgeTitles = (kind) =>
  kind === 'curve'
    ? { outer: 'Outer edge', inner: 'Inner edge' }
    : { outer: 'Left edge', inner: 'Right edge' };

/** For a tile or a detail line: '' when centred, else 'slot 35-145 from left'. */
export function slotSummary(p) {
  return hasSlotPosition(p) ? 'slot ' + slotLabel(p) : '';
}

/** The live line under the distances: the other edge, and the room there is. */
export function slotReadout(p) {
  if (!hasSlotPosition(p)) return '';
  const s = p.slotPosition,
    other = s.edge === 'outer' ? 'inner' : 'outer';
  const ends = slotEnds(p),
    { min, max } = slotRoom(p);
  const a = ends.start[other],
    b = ends.end[other];
  if (![a, b, min, max].every(Number.isFinite)) return '';
  const edge = ' mm from the ' + slotEdgeName(p, other) + ' edge.';
  return (
    (a === b ? fmt(a) + edge : 'End A is ' + fmt(a) + ' mm and end B ' + fmt(b) + edge) +
    (min <= max ? ' Room on this road: ' + fmt(min) + ' to ' + fmt(max) + ' mm.' : '')
  );
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

/** The group's markup for piece p. Follow it with syncSlotPositionControls. */
export function slotPositionControls(p, names = SLOT_FIELDS) {
  const s = p.slotPosition,
    first = suggestedDistance(p),
    titles = edgeTitles(p.kind);
  const option = (value, text, chosen, extra = '') =>
    '<option value="' + value + '"' + (chosen ? ' selected' : '') + extra + '>' + text + '</option>';
  const edge = s?.edge ?? 'centre';
  return (
    '<div data-slot-position>' +
    '<label class="field"><span>Slot position</span><select data-slot-mode>' +
    option('centre', 'Centred', !s) +
    option('off', 'Off-centre', Boolean(s)) +
    '</select></label>' +
    '<p class="hint" data-slot-unavailable hidden>Off-centre slots are for single-lane roads for now.</p>' +
    '<fieldset class="border-apex-fields" data-slot-options hidden disabled>' +
    '<label class="field"><span>Measure from</span><select name="' + names.edge + '" data-slot-edge' +
    // The applied edge, so Off-centre returns to it after a redraw.
    (s ? ' data-last="' + s.edge + '"' : '') + '>' +
    option('centre', 'Centred', edge === 'centre', ' hidden') +
    option('outer', titles.outer, edge === 'outer') +
    option('inner', titles.inner, edge === 'inner') +
    '</select></label>' +
    '<p class="hint" data-slot-looking>Looking from end A to end B.</p>' +
    field(names.start, 'At end A', s?.startMm ?? first, 'mm', { min: 0, max: 5000 }) +
    '<div data-slot-end>' +
    field(names.end, 'At end B', s?.endMm ?? first, 'mm', { min: 0, max: 5000 }) +
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

/** Rewrites a just-committed distance on its half millimetre. True when it changed. */
export function snapSlotField(control, names = SLOT_FIELDS) {
  if (![names.start, names.end].includes(control?.name)) return false;
  const typed = control.valueAsNumber,
    snapped = snapSlot(typed);
  if (!Number.isFinite(typed) || snapped === typed) return false;
  control.value = snapped;
  return true;
}

/** The three values as the controls hold them, for readSlotPosition. */
export function slotFieldValues(root, names = SLOT_FIELDS) {
  const control = (name) => root.querySelector('[name="' + name + '"]');
  return {
    edge: control(names.edge).value,
    start: control(names.start).valueAsNumber,
    end: control(names.end).valueAsNumber,
  };
}

/**
 * Shows the parts of the group that apply to a piece of this kind and lane
 * count. Special pieces, freeform paths and drawings have no group; a road
 * with several lanes shows why the choice is missing.
 */
export function syncSlotPositionControls(root, { kind, lanes, special }) {
  const host = root?.querySelector('[data-slot-position]');
  if (!host) return;
  const find = (key) => host.querySelector(key);
  const plain = !special && ['straight', 'curve'].includes(kind);
  const single = Number(lanes) === 1;
  const edge = find('[data-slot-edge]'),
    mode = find('[data-slot-mode]');
  const off = edge.value !== 'centre';
  if (off) edge.dataset.last = edge.value;
  host.hidden = !plain;
  mode.value = off ? 'off' : 'centre';
  mode.disabled = !plain || !single;
  mode.closest('label').hidden = !single;
  find('[data-slot-unavailable]').hidden = single;
  const options = find('[data-slot-options]');
  options.hidden = options.disabled = !(plain && single && off);
  const curve = kind === 'curve',
    titles = edgeTitles(kind);
  for (const option of edge.options)
    if (titles[option.value]) option.textContent = titles[option.value];
  find('[data-slot-looking]').hidden = curve;
  find('[data-slot-curve]').hidden = !curve;
  find('[data-slot-end]').hidden = curve;
  find('[data-slot-end] input').disabled = curve;
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
      ? 'Both ends are in the middle of the road, so the slot stays centred.'
      : '';
  if (readout.textContent !== text) readout.textContent = text;
  const notes = host.querySelector('[data-slot-notes]');
  const markup = slotNotesMarkup(p);
  // Leave unchanged notes alone, so a screen reader does not read them again.
  if (notes.innerHTML !== markup) notes.innerHTML = markup;
}
