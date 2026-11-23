import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTrack, validateTrack } from '../src/track.js';
import { slotShiftAt } from '../src/slot-position.js';
import {
  SLOT_FIELDS,
  applySlotLanes,
  applySlotMode,
  packApplyNotice,
  packRuleSlotNote,
  slotFieldList,
  slotFieldToFocus,
  slotFieldValues,
  slotSpacingHint,
  consumeSlotFields,
  readSlotPosition,
  showSlotAdvice,
  slotFieldNames,
  slotNotesMarkup,
  slotPositionAllowed,
  slotPositionControls,
  slotFieldDependencies,
  slotReadout,
  slotRestoreValues,
  slotSummary,
  snapSlot,
  snapSlotField,
  syncSlotPositionControls,
} from '../src/slot-position-controls.js';
import { readTrackShapeFields, syncTrackShapeControls } from '../src/track-shape-controls.js';
import { sectionForField, trackInspector } from '../src/inspector.js';
import { piecePreview } from '../src/track-piece-preview.js';
import { pieceDetail, trackThumbnail } from '../src/library-view.js';
import { syncPropertyReadouts } from '../src/property-panel.js';

const straight = (extra = {}) => ({
  ...defaultTrack(), kind: 'straight', width: 200, length: 300, lanes: 1, ...extra,
});
const curve = (extra = {}) => ({
  ...defaultTrack(), kind: 'curve', width: 200, radius: 300, angle: 45, lanes: 1, ...extra,
});
const slot = (edge, startMm, endMm = startMm) => ({ version: 1, edge, startMm, endMm });

// The few DOM members the shared group touches.
function fakeGroup(edgeValue = 'centre') {
  const el = (extra = {}) => ({ hidden: false, disabled: false, ...extra });
  const label = el();
  const parts = {
    '[data-slot-edge]': el({
      value: edgeValue,
      dataset: {},
      options: ['centre', 'outer', 'inner'].map((value) => ({ value, textContent: value })),
    }),
    '[data-slot-mode]': el({ value: 'centre', matches: (key) => key === '[data-slot-mode]' }),
    '[data-slot-unavailable]': el(),
    '[data-slot-options]': el(),
    '[data-slot-looking]': el(),
    '[data-slot-curve]': el(),
    '[data-slot-end]': el(),
    '[data-slot-end] input': el(),
    '[data-slot-readout]': el({ textContent: '' }),
    '[data-slot-notes]': el({ innerHTML: '' }),
  };
  const host = { hidden: false, querySelector: (key) => parts[key] };
  parts['[data-slot-mode]'].closest = (key) => (key === 'label' ? label : host);
  const root = { querySelector: (key) => (key === '[data-slot-position]' ? host : undefined) };
  return {
    root, host, label,
    endInput: parts['[data-slot-end] input'],
    part: (key) => parts['[data-slot-' + key + ']'],
  };
}

test('typed distances snap to half millimetres and become the stored slot position', () => {
  assert.deepEqual([35.2, 35.25, 144.74, 0.2].map(snapSlot), [35, 35.5, 144.5, 0]);
  assert.deepEqual(
    readSlotPosition({ edge: 'outer', start: 35.2, end: 144.9 }, straight()),
    slot('outer', 35, 145),
  );
  assert.deepEqual(
    readSlotPosition({ edge: 'inner', start: 40, end: 40 }, straight()),
    slot('inner', 40),
  );
  // A corner keeps the distance of end A, whatever the hidden end B field holds.
  assert.deepEqual(
    readSlotPosition({ edge: 'inner', start: 35, end: 145 }, curve()),
    slot('inner', 35),
  );
  assert.deepEqual(
    readSlotPosition({ edge: 'outer', start: 60, end: NaN }, curve()),
    slot('outer', 60),
  );
});

test('a centred slot is never stored, and only plain straights and curves can move it', () => {
  assert.equal(readSlotPosition({ edge: 'centre', start: 35, end: 145 }, straight()), null);
  // Both ends on the middle of the road: that is the centred piece.
  assert.equal(readSlotPosition({ edge: 'outer', start: 100, end: 100.2 }, straight()), null);
  assert.equal(readSlotPosition({ edge: 'inner', start: 100, end: 5 }, curve()), null);
  assert.notEqual(readSlotPosition({ edge: 'outer', start: 100, end: 60 }, straight()), null);
  for (const p of [
    straight({ lanes: 9 }),
    straight({ lanes: 1.5 }),
    straight({ special: { type: 'timing' } }),
    straight({ kind: 'import' }),
  ]) {
    assert.equal(slotPositionAllowed(p), false);
    assert.equal(readSlotPosition({ edge: 'outer', start: 35, end: 35 }, p), null);
  }
  assert.ok(slotPositionAllowed(straight()) && slotPositionAllowed(curve()));
  // Since Phase 2 roads of 2 to 8 lanes carry off-centre slots too.
  for (const lanes of [2, 8, '3']) assert.ok(slotPositionAllowed(straight({ lanes })));
  // A half-typed distance is kept for validation to name, not stored as centred.
  const typing = straight();
  typing.slotPosition = readSlotPosition({ edge: 'outer', start: NaN, end: 35 }, typing);
  assert.throws(() => validateTrack(typing), /Choose a valid slot position/);
});

test('the inspector fields are read into the piece and never leak into its settings', () => {
  const lanes = (base, end) => Array.from({ length: 8 }, (_, i) => base + 'Lane' + (i + 1) + end);
  assert.deepEqual(SLOT_FIELDS, {
    edge: 'slotEdge', start: 'slotStart', end: 'slotEnd', lanes: 'slotLanes',
    laneStarts: lanes('slot', 'Start'), laneEnds: lanes('slot', 'End'),
  });
  assert.deepEqual(slotFieldNames('pc'), {
    edge: 'pcSlotEdge', start: 'pcSlotStart', end: 'pcSlotEnd', lanes: 'pcSlotLanes',
    laneStarts: lanes('pcSlot', 'Start'), laneEnds: lanes('pcSlot', 'End'),
  });
  const params = straight();
  const page = { lanes: 1, width: 200, slotEdge: 'outer', slotStart: 35.2, slotEnd: 145 };
  const rest = readTrackShapeFields(page, { params });
  assert.deepEqual(rest, { lanes: 1, width: 200 });
  assert.deepEqual(params.slotPosition, slot('outer', 35, 145));
  assert.deepEqual(page.slotEdge, 'outer', 'the page itself is not changed');
  validateTrack({ ...params, ...rest });

  // Centred removes the key instead of storing a centred object.
  readTrackShapeFields({ ...page, slotEdge: 'centre' }, { params });
  assert.equal('slotPosition' in params, false);

  // A page without the group (another tab) leaves the slot as it is.
  params.slotPosition = slot('inner', 40);
  readTrackShapeFields({ height: 12 }, { params });
  assert.deepEqual(params.slotPosition, slot('inner', 40));

  // A second lane keeps the distance of slot 1 (Phase 2); a shape that
  // cannot carry it removes the slot position.
  readTrackShapeFields({ ...page, lanes: 2, laneSpacing: 80 }, { params });
  assert.deepEqual(params.slotPosition, slot('outer', 35, 145));
  params.slotPosition = slot('inner', 40);
  readTrackShapeFields({ ...page, kind: 'import' }, { params });
  assert.equal('slotPosition' in params, false);

  // The road width typed on the same page decides what "the middle" is.
  const wide = straight();
  consumeSlotFields({ width: 150, slotEdge: 'outer', slotStart: 75, slotEnd: 75 }, wide);
  assert.equal('slotPosition' in wide, false);
  consumeSlotFields({ width: 150, slotEdge: 'outer', slotStart: 100, slotEnd: 100 }, wide);
  assert.deepEqual(wide.slotPosition, slot('outer', 100));

  // Changing a straight into a corner keeps the position of end A.
  const bend = straight({ slotPosition: slot('outer', 35, 145) });
  consumeSlotFields({ kind: 'curve', slotEdge: 'outer', slotStart: 35, slotEnd: 145 }, bend);
  assert.deepEqual(bend.slotPosition, slot('outer', 35));

  // The creator's own names work the same way.
  const fields = { pcSlotEdge: 'inner', pcSlotStart: 20, pcSlotEnd: 30, pcWidth: 200 };
  const made = straight();
  consumeSlotFields(fields, made, slotFieldNames('pc'));
  assert.deepEqual(fields, { pcWidth: 200 });
  assert.deepEqual(made.slotPosition, slot('inner', 20, 30));
});

test('labels, the read-out and the notes describe the slot in plain words', () => {
  assert.equal(slotSummary(straight()), '');
  assert.equal(
    slotSummary(straight({ slotPosition: slot('outer', 35, 145) })),
    'slot 35-145 from left',
  );
  assert.equal(slotSummary(straight({ slotPosition: slot('inner', 40.5) })), 'slot 40.5 from right');
  assert.equal(slotSummary(curve({ slotPosition: slot('inner', 35) })), 'slot 35 from inner');

  assert.equal(slotReadout(straight()), '');
  assert.equal(
    slotReadout(straight({ slotPosition: slot('outer', 35) })),
    '165 mm from the right edge. Room on this road: 7.5 to 192.5 mm.',
  );
  assert.equal(
    slotReadout(straight({ slotPosition: slot('inner', 35, 145) })),
    'End A is 165 mm and end B 55 mm from the left edge. Room on this road: 7.5 to 192.5 mm.',
  );
  assert.equal(
    slotReadout(curve({ slotPosition: slot('outer', 50) })),
    '150 mm from the inner edge. Room on this road: 7.5 to 192.5 mm.',
  );
  assert.equal(slotReadout(straight({ slotPosition: slot('outer', NaN) })), '');
  // Too narrow for any off-centre slot: validation says so, the read-out stays short.
  assert.equal(
    slotReadout(straight({ width: 10, slotPosition: slot('outer', 4) })),
    '6 mm from the right edge.',
  );

  // A short S is a warning; the remark that the ends differ is a plain note.
  const notes = slotNotesMarkup(straight({ length: 200, slotPosition: slot('outer', 35, 145) }));
  assert.match(notes, /<p class="hint slot-note slot-warning">The tightest bend/);
  assert.match(notes, /<p class="hint slot-note">End A and end B are different/);
  assert.match(
    slotNotesMarkup(straight({ slotPosition: slot('outer', 35, 145) })),
    /^<p class="hint slot-note">The tightest bend in the slot is about 157 mm radius, which is gentle\./,
  );
  assert.equal(slotNotesMarkup(straight()), '');
});

test('the group renders the same fields for the inspector and the creator', () => {
  const centred = slotPositionControls(straight());
  assert.match(centred, /<span>Slot position<\/span><select data-slot-mode><option value="centre" selected>Centred<\/option><option value="off">Off-centre<\/option>/);
  assert.match(centred, /<span>Measure from<\/span><select name="slotEdge" data-slot-edge><option value="centre" selected hidden>/);
  assert.match(centred, /<option value="outer">Left edge<\/option><option value="inner">Right edge<\/option>/);
  assert.match(centred, /Looking from end A to end B\./);
  // Phase 2: the one reason left is Squeeze / Spread.
  assert.match(centred, /data-slot-unavailable hidden>Off-centre slots and Squeeze \/ Spread cannot be combined\./);
  assert.doesNotMatch(centred, /single-lane/);
  assert.match(centred, /Corners keep one slot position\. Change position on a straight\./);
  // A first distance that is visibly off-centre and inside the road.
  assert.match(centred, /name="slotStart" value="50"/);
  assert.match(centred, /name="slotEnd" value="50"/);
  assert.match(centred, /<span data-slot-label="start">At end A<\/span>/);
  assert.doesNotMatch(centred, /step="0\.5"/, 'snapping happens in code');
  // The switch has no name, so it never becomes a setting of the piece.
  assert.deepEqual(
    [...centred.matchAll(/\bname="([^"]+)"/g)].map((m) => m[1]),
    slotFieldList(),
  );
  assert.deepEqual(slotFieldList().slice(0, 6), [
    'slotEdge', 'slotLanes', 'slotStart', 'slotEnd', 'slotLane1Start', 'slotLane1End',
  ]);
  assert.equal(slotFieldList().length, 20);
  // One lane: no Lanes choice is shown.
  assert.match(centred, /<div data-slot-lanes-choice hidden>/);

  const set = slotPositionControls(curve({ slotPosition: slot('inner', 35) }));
  assert.match(set, /<option value="off" selected>Off-centre/);
  // The applied edge is remembered, so Off-centre returns to it after a
  // redraw that drafted Centred.
  assert.match(set, /<select name="slotEdge" data-slot-edge data-last="inner">/);
  assert.doesNotMatch(centred, /data-last/);
  assert.match(set, /<option value="outer">Outer edge<\/option><option value="inner" selected>Inner edge<\/option>/);
  assert.match(set, /name="slotStart" value="35"/);
  assert.match(set, /data-slot-readout>165 mm from the outer edge\. Room on this road: 7\.5 to 192\.5 mm\.</);

  const creator = slotPositionControls(straight({ width: 20 }), slotFieldNames('pc'));
  assert.deepEqual(
    [...creator.matchAll(/\bname="([^"]+)"/g)].map((m) => m[1]),
    slotFieldList(slotFieldNames('pc')),
  );
  assert.match(creator, /name="pcSlotLane2End"/);
  // A quarter of a narrow road would cut into its edge: start at the nearest safe place.
  assert.match(creator, /name="pcSlotStart" value="7\.5"/);
});

test('the group shows only what applies to the shape and the lane count', () => {
  const { root, host, label, part, endInput } = fakeGroup();
  syncSlotPositionControls(root, { kind: 'straight', lanes: '1' });
  assert.equal(host.hidden, false);
  assert.equal(part('mode').value, 'centre');
  assert.equal(label.hidden, false);
  assert.equal(part('unavailable').hidden, true);
  assert.ok(part('options').hidden && part('options').disabled);
  assert.deepEqual(part('edge').options.map((o) => o.textContent), ['centre', 'Left edge', 'Right edge']);

  // Off-centre on a straight: both distances, and the way to look at the piece.
  part('edge').value = 'inner';
  syncSlotPositionControls(root, { kind: 'straight', lanes: 1 });
  assert.equal(part('mode').value, 'off');
  assert.ok(!part('options').hidden && !part('options').disabled);
  assert.ok(!part('looking').hidden && part('curve').hidden);
  assert.ok(!part('end').hidden && !endInput.disabled);

  // A corner has one distance and names its edges by the bend.
  syncSlotPositionControls(root, { kind: 'curve', lanes: 1 });
  assert.deepEqual(part('edge').options.map((o) => o.textContent), ['centre', 'Outer edge', 'Inner edge']);
  assert.ok(part('looking').hidden && !part('curve').hidden);
  assert.ok(part('end').hidden && endInput.disabled);

  // Several lanes keep the choice (Phase 2).
  syncSlotPositionControls(root, { kind: 'straight', lanes: 2 });
  assert.equal(host.hidden, false);
  assert.ok(!label.hidden && !part('mode').disabled);
  assert.equal(part('unavailable').hidden, true);
  assert.ok(!part('options').hidden && !part('options').disabled);
  // Squeeze / spread: an off-centre slot keeps the switch, to set it back to
  // Centred; a centred one cannot be moved, and the hint says why.
  syncSlotPositionControls(root, { kind: 'straight', lanes: 2, squeeze: true });
  assert.ok(!part('mode').disabled && !part('unavailable').hidden);
  part('edge').value = 'centre';
  syncSlotPositionControls(root, { kind: 'straight', lanes: 2, squeeze: true });
  assert.ok(part('mode').disabled && !part('unavailable').hidden);
  assert.ok(part('options').hidden && part('options').disabled);

  // Special pieces and freeform paths have no group at all.
  syncSlotPositionControls(root, { kind: 'straight', lanes: 1, special: true });
  assert.equal(host.hidden, true);
  syncSlotPositionControls(root, { kind: 'import', lanes: 1 });
  assert.equal(host.hidden, true);
  // A form without the group is left alone.
  syncSlotPositionControls({ querySelector: () => undefined }, { kind: 'straight', lanes: 1 });
});

test('the Centred / Off-centre switch sets the edge field and remembers the last edge', () => {
  const { root, part } = fakeGroup('inner');
  syncSlotPositionControls(root, { kind: 'straight', lanes: 1 });
  const mode = part('mode'),
    edge = part('edge');
  mode.value = 'centre';
  assert.equal(applySlotMode(mode), edge);
  assert.equal(edge.value, 'centre');
  mode.value = 'off';
  assert.equal(applySlotMode(mode), edge);
  assert.equal(edge.value, 'inner', 'back to the edge chosen before');
  const fresh = fakeGroup();
  fresh.part('mode').value = 'off';
  applySlotMode(fresh.part('mode'));
  assert.equal(fresh.part('edge').value, 'outer');
  // Any other control is not the switch.
  assert.equal(applySlotMode(edge), null);
  assert.equal(applySlotMode({ matches: () => false }), null);
});

test('Restore brings back the slot that Centred or a second lane took away', () => {
  const before = straight({ slotPosition: slot('inner', 35, 145) });
  const centred = straight();
  const all = { slotEdge: 'inner', slotStart: 35, slotEnd: 145 };
  // Centred drafts only the edge field; the record still gets both distances.
  assert.deepEqual(slotRestoreValues(before, centred, { slotEdge: 'centre' }), all);
  // So does a second lane, which removes the slot without touching its fields.
  assert.deepEqual(slotRestoreValues(before, { ...centred, lanes: 2 }, { lanes: '2' }), all);
  // A moved slot records its own fields already, and nothing else is needed.
  assert.deepEqual(slotRestoreValues(before, before, { length: '400' }), {});
  assert.deepEqual(slotRestoreValues(straight(), centred, { slotEdge: 'centre' }), {});
  // An edit on another page leaves the slot alone.
  assert.deepEqual(slotRestoreValues(before, centred, { borderSide: 'both' }), {});

  // The arrow of one slot field brings the other two with it.
  assert.deepEqual(slotFieldDependencies('slotEdge', all), { slotStart: 35, slotEnd: 145 });
  assert.deepEqual(slotFieldDependencies('slotStart', all), { slotEdge: 'inner', slotEnd: 145 });
  // The arrow of Lane count brings back the slot that edit took away.
  assert.deepEqual(slotFieldDependencies('lanes', all), all);
  assert.deepEqual(slotFieldDependencies('lanes', { lanes: 1 }), {});
  assert.deepEqual(slotFieldDependencies('slotEdge', { slotEdge: 'outer' }), {});
});

test('a committed distance is rewritten on its half millimetre', () => {
  const start = { name: 'slotStart', valueAsNumber: 35.2, value: '35.2' };
  assert.equal(snapSlotField(start), true);
  assert.equal(start.value, 35);
  assert.equal(snapSlotField({ name: 'slotEnd', valueAsNumber: 145.5, value: '145.5' }), false);
  assert.equal(snapSlotField({ name: 'slotEnd', valueAsNumber: NaN, value: '' }), false);
  assert.equal(snapSlotField({ name: 'width', valueAsNumber: 35.2 }), false);
  const own = { name: 'pcSlotEnd', valueAsNumber: 0.74, value: '0.74' };
  assert.equal(snapSlotField(own), false, 'the inspector names do not match the creator');
  assert.equal(snapSlotField(own, slotFieldNames('pc')), true);
  assert.equal(own.value, 0.5);
});

test('the read-out and the notes follow the piece as it is edited', () => {
  const { root, part } = fakeGroup('outer');
  const p = straight({ slotPosition: slot('outer', 35, 145) });
  showSlotAdvice(root, p);
  assert.equal(
    part('readout').textContent,
    'End A is 165 mm and end B 55 mm from the right edge. Room on this road: 7.5 to 192.5 mm.',
  );
  assert.match(part('notes').innerHTML, /tightest bend/);
  // Off-centre chosen, but both distances are on the middle of the road.
  showSlotAdvice(root, straight());
  assert.equal(
    part('readout').textContent,
    'Both ends are in the middle of the road, so the slot stays centred.',
  );
  assert.equal(part('notes').innerHTML, '');
  part('edge').value = 'centre';
  showSlotAdvice(root, straight());
  assert.equal(part('readout').textContent, '');
});

test('the inspector hides the centreline hint when the slot is off-centre', () => {
  const fields = {
    lanes: { value: '1' }, laneSpacing: { value: '82.5' }, laneMode: { value: 'uniform' },
    kind: { value: 'straight' }, slotEdge: { value: 'outer' },
  };
  const slotGroup = fakeGroup('outer');
  const groups = {
    '[data-lane-spacing-controls]': {}, '[data-centred-lane]': {}, '[data-lane-adjustment]': {},
    '[data-slot-position]': slotGroup.host,
  };
  const form = { elements: fields, querySelector: (key) => groups[key], querySelectorAll: () => [] };
  syncTrackShapeControls(form);
  assert.equal(groups['[data-centred-lane]'].hidden, true);
  assert.equal(slotGroup.part('options').hidden, false);
  fields.slotEdge.value = 'centre';
  slotGroup.part('edge').value = 'centre';
  syncTrackShapeControls(form);
  assert.equal(groups['[data-centred-lane]'].hidden, false);
  assert.equal(slotGroup.part('options').hidden, true);
});

test('the inspector offers Slot position on plain pieces and warnings can jump to it', () => {
  const names = (params, extra = {}) =>
    [...trackInspector({ track: { params, plan: null, ...extra } }, 'geometry')
      .matchAll(/\bname="([^"]+)"/g)].map((m) => m[1]);
  for (const p of [straight(), curve(), straight({ lanes: 2 })])
    assert.deepEqual(
      names(p).filter((name) => name.startsWith('slot')),
      slotFieldList(),
    );
  const freeform = { plan: { lanes: [], outlines: [] }, custom: { points: [] }, sourceName: '' };
  assert.deepEqual(
    names(straight({ kind: 'import' }), freeform).filter((name) => name.startsWith('slot')),
    [],
  );
  const applied = trackInspector(
    { track: { params: straight({ slotPosition: slot('outer', 35, 145) }), plan: null } },
    'geometry',
  );
  assert.match(applied, /data-centred-lane hidden>/);
  assert.match(applied, /name="slotStart" value="35"/);
  assert.match(applied, /name="slotEnd" value="145"/);
  assert.match(trackInspector({ track: { params: straight(), plan: null } }, 'geometry'), /data-centred-lane>Main slot/);
  for (const field of slotFieldList())
    assert.equal(sectionForField(field, 'joints'), 'geometry');
  assert.equal(sectionForField('slotLane9Start', 'joints'), 'joints');
  // The slot's own width and depth stay in the cross-section.
  assert.equal(sectionForField('slotWidth', 'profile'), 'profile');
});

test('the Lane layout summary says when the single lane is off-centre', () => {
  const read = (fields) => {
    const output = { dataset: { propertyReadout: 'lanes' }, textContent: '' };
    syncPropertyReadouts({
      elements: { namedItem: (name) => (name in fields ? { value: fields[name] } : null) },
      querySelectorAll: () => [output],
    });
    return output.textContent;
  };
  assert.equal(read({ lanes: '1', slotEdge: 'centre' }), '1 lane');
  assert.equal(read({ lanes: '1' }), '1 lane');
  assert.equal(read({ lanes: '1', slotEdge: 'inner' }), '1 lane · off-centre');
  // Phase 2: several lanes can be off-centre too; set lane by lane, the
  // spacing says nothing about the slots.
  assert.equal(read({ lanes: '2', laneSpacing: '100', slotEdge: 'centre' }), '2 lanes · 100 mm');
  assert.equal(read({ lanes: '2', laneSpacing: '100', slotEdge: 'outer' }), '2 lanes · 100 mm · off-centre');
  assert.equal(
    read({ lanes: '2', laneSpacing: '100', slotEdge: 'outer', slotLanes: 'each' }),
    '2 lanes · off-centre',
  );
});

const numbers = (text) => text.trim().split(/[ ,]/).map(Number);
const lanePoints = (marks) => {
  const flat = numbers(marks.match(/class="ct-lane"[^>]*points="([^"]+)"/)[1]);
  return Array.from({ length: flat.length / 2 }, (_, i) => [flat[2 * i], flat[2 * i + 1]]);
};

test('the creator preview draws the real slot path and names the ends', () => {
  const p = straight({ slotPosition: slot('outer', 35, 145) });
  const preview = piecePreview(p);
  const lane = lanePoints(preview.marks);
  assert.equal(lane.length, 121);
  // The picture plots -y: 35 mm from the left edge is 65 mm above the centre.
  assert.deepEqual(lane[0], [-150, -65]);
  assert.deepEqual(lane.at(-1), [150, 45]);
  assert.deepEqual(lane[60], [0, -10]);
  let exact = 0;
  for (let i = 1; i <= 6000; i++)
    exact += Math.hypot(300 / 6000, slotShiftAt(p, i / 6000) - slotShiftAt(p, (i - 1) / 6000));
  assert.ok(exact > 320 && exact < 330);
  assert.ok(Math.abs(preview.lengths[0] - exact) < 0.05, preview.lengths[0] + ' vs ' + exact);

  const label = (text) => {
    const m = preview.marks.match(
      new RegExp('<text class="ct-[a-z-]+" font-size="[\\d.]+"[^>]* x="([-\\d.]+)" y="([-\\d.]+)">' + text + '</text>'),
    );
    assert.ok(m, text + ' is drawn');
    return [Number(m[1]), Number(m[2])];
  };
  const [x, y, width, height] = preview.viewBox.split(' ').map(Number);
  const a = label('A'),
    b = label('B'),
    left = label('left'),
    right = label('right');
  assert.ok(a[0] < -150 && b[0] > 150 && a[1] === 0 && b[1] === 0);
  assert.ok(left[1] < -100 && right[1] > 100, 'the left edge is the top of the picture');
  for (const [lx, ly] of [a, b, left, right])
    assert.ok(lx > x && lx < x + width && ly > y && ly < y + height, 'labels stay in view');
  // The arrowhead points from end A towards end B.
  const arrow = numbers(preview.marks.match(/class="ct-travel"[^>]*points="([^"]+)"/)[1]);
  assert.ok(arrow[2] > arrow[0] && arrow[2] > arrow[4]);

  // A constant off-centre slot is a straight line at its own distance.
  const parallel = piecePreview(straight({ slotPosition: slot('inner', 35) }));
  assert.deepEqual(lanePoints(parallel.marks), [[-150, 65], [150, 65]]);
  assert.deepEqual(parallel.lengths, [300]);
  assert.match(parallel.marks, />A<\/text>/);

  // On a corner the slot is concentric; its length follows its own radius.
  const bend = piecePreview(curve({ slotPosition: slot('inner', 35) }));
  assert.ok(Math.abs(bend.lengths[0] - (235 * Math.PI) / 4) < 1e-9);
  assert.match(bend.marks, />B<\/text>/);
  assert.doesNotMatch(bend.marks, />left<\/text>/);

  // A centred piece is drawn exactly as before.
  const centred = piecePreview(straight());
  assert.deepEqual(lanePoints(centred.marks), [[-150, 0], [150, 0]]);
  assert.deepEqual(centred.lengths, [300]);
  assert.doesNotMatch(centred.marks, /<text|ct-travel/);
});

test('library tiles draw the moving slot, name the ends and describe the position', () => {
  const p = straight({ slotPosition: slot('outer', 35, 145) });
  const tile = trackThumbnail({ params: p, plan: null });
  const lanes = tile.match(/class="lib-lanes" d="([^"]+)"/)[1];
  assert.equal(lanes.split('L').length, 49, 'the S is sampled along the piece');
  const ends = [...tile.matchAll(/<text class="lib-end" x="([\d.]+)" y="([\d.]+)"[^>]*>([AB])<\/text>/g)];
  assert.deepEqual(ends.map((m) => m[3]), ['A', 'B']);
  assert.ok(Number(ends[0][1]) < Number(ends[1][1]));
  for (const [, x, y] of ends)
    assert.ok(x > 3 && x < 141 && y > 3 && y < 69, 'letters stay on the tile');
  // The slot starts near the top (left edge) and ends below the middle.
  const [, startY] = lanes.match(/^M([\d.]+) ([\d.]+)/).slice(1).map(Number);
  const endY = Number(lanes.match(/([\d.]+)$/)[1]);
  assert.ok(startY < 36 && endY > 36);
  assert.match(tile, /class="lib-travel"/);

  const constant = trackThumbnail({ params: straight({ slotPosition: slot('inner', 35) }), plan: null });
  assert.equal(constant.match(/class="lib-lanes" d="([^"]+)"/)[1].split('L').length, 2);
  assert.match(constant, />A<\/text>/);

  const centred = trackThumbnail({ params: straight(), plan: null });
  assert.doesNotMatch(centred, /<text|lib-travel/);
  // A centred tile keeps its size; a labelled one is a little smaller.
  assert.match(centred, /class="lib-lanes" d="M29\.25 36\.00L114\.75 36\.00"/);
  assert.match(constant, /class="lib-road"[^>]* d="M34\.50 61\.00L109\.50 61\.00L/);

  assert.equal(pieceDetail({ params: p }), '300 × 200 mm · slot 35-145 from left');
  assert.equal(
    pieceDetail({ params: curve({ slotPosition: slot('outer', 50) }) }),
    '45° · inner R 200 mm · slot 50 from outer',
  );
  assert.equal(pieceDetail({ params: straight() }), '300 × 200 mm');
});

// ---- Phase 2: off-centre slots on roads with 2 to 8 lanes.

const twoLanes = (extra = {}) => straight({ lanes: 2, laneSpacing: 65, ...extra });
const eachLane = (edge, ...rows) => ({
  version: 1, edge, lanes: rows.map(([startMm, endMm = startMm]) => ({ startMm, endMm })),
});
const sValues = (extra) => ({ edge: 'outer', start: 35, end: 95, lanes: 'together', starts: [], ends: [], ...extra });

test('with several lanes the controls store lanes moving together or a list, normalised', () => {
  // Lanes move together: slot 1's two distances, as for one lane.
  assert.deepEqual(readSlotPosition(sValues(), twoLanes()), slot('outer', 35, 95));
  // Set each lane: one entry per lane, slot 1 first, snapped to half millimetres.
  const each = sValues({ lanes: 'each', starts: [35.2, 105, 999], ends: [95, 164.8, 999] });
  assert.deepEqual(readSlotPosition(each, twoLanes()), eachLane('outer', [35, 95], [105, 165]));
  // A list spaced exactly the lane spacing at both ends is lanes moving together.
  assert.deepEqual(readSlotPosition(each, twoLanes({ laneSpacing: 70 })), slot('outer', 35, 95));
  // Every slot where a centred piece has it: centred, nothing stored.
  assert.equal(readSlotPosition(sValues({ start: 67.5, end: 67.5 }), twoLanes()), null);
  assert.equal(
    readSlotPosition(sValues({ edge: 'inner', lanes: 'each', starts: [67.5, 132.5], ends: [0, 0] }), curve({ lanes: 2, laneSpacing: 65 })),
    null,
    'a corner keeps end A, so the hidden end B column is ignored',
  );
  assert.deepEqual(
    readSlotPosition(sValues({ edge: 'inner', lanes: 'each', starts: [30, 120], ends: [0, 0] }), curve({ lanes: 2, laneSpacing: 65 })),
    eachLane('inner', [30], [120]),
  );
  // One lane ignores the Lanes choice.
  assert.deepEqual(readSlotPosition(sValues({ lanes: 'each', starts: [1, 2], ends: [3, 4] }), straight()), slot('outer', 35, 95));
  // A half-typed table is kept for validation to name.
  const typing = twoLanes();
  typing.slotPosition = readSlotPosition(sValues({ lanes: 'each', starts: [35, NaN], ends: [95, 165] }), typing);
  assert.throws(() => validateTrack(typing), /Choose a valid slot position: an edge, and a distance for every slot/);
  // The stored list is the real one: it builds.
  validateTrack(twoLanes({ slotPosition: readSlotPosition(each, twoLanes()) }));
});

test('the inspector reads the lane table and none of its fields leak into the settings', () => {
  const params = twoLanes();
  const table = Object.fromEntries(
    SLOT_FIELDS.laneStarts.flatMap((name, i) => [[name, 35 + 70 * i], [SLOT_FIELDS.laneEnds[i], 95 + 70 * i]]),
  );
  const page = {
    lanes: 2, laneSpacing: 65, width: 200,
    slotEdge: 'outer', slotLanes: 'each', slotStart: 35, slotEnd: 95, ...table,
  };
  const rest = readTrackShapeFields(page, { params });
  assert.deepEqual(rest, { lanes: 2, laneSpacing: 65, width: 200 });
  assert.deepEqual(params.slotPosition, eachLane('outer', [35, 95], [105, 165]));
  // The spacing typed on the same page decides whether the list is "together".
  readTrackShapeFields({ ...page, laneSpacing: 70 }, { params });
  assert.deepEqual(params.slotPosition, slot('outer', 35, 95));
  // Three lanes read three rows.
  readTrackShapeFields({ ...page, lanes: 3, width: 300 }, { params });
  assert.deepEqual(params.slotPosition, eachLane('outer', [35, 95], [105, 165], [175, 235]));
  // Together reads slot 1 only.
  readTrackShapeFields({ ...page, slotLanes: 'together', slotStart: 40, slotEnd: 40 }, { params });
  assert.deepEqual(params.slotPosition, slot('outer', 40));
  // The creator's prefixed names work the same way.
  const names = slotFieldNames('pc');
  const fields = { pcWidth: 200, pcSlotEdge: 'inner', pcSlotLanes: 'each', pcSlotStart: 1, pcSlotEnd: 1,
    pcSlotLane1Start: 30, pcSlotLane1End: 30, pcSlotLane2Start: 120, pcSlotLane2End: 120 };
  const made = twoLanes();
  consumeSlotFields(fields, made, names);
  assert.deepEqual(fields, { pcWidth: 200 });
  assert.deepEqual(made.slotPosition, eachLane('inner', [30], [120]));
});

test('Restore brings back a lane list, and every slot field travels together', () => {
  const list = eachLane('outer', [35, 95], [105, 165]);
  const before = twoLanes({ slotPosition: list });
  assert.deepEqual(slotRestoreValues(before, twoLanes(), { slotEdge: 'centre' }), {
    slotEdge: 'outer', slotLanes: 'each', slotStart: 35, slotEnd: 95,
    slotLane1Start: 35, slotLane1End: 95, slotLane2Start: 105, slotLane2End: 165,
  });
  // A lane count that turns the list away, or a new spacing that normalises it.
  assert.ok('slotLane2End' in slotRestoreValues(before, { ...before, slotPosition: undefined }, { lanes: 3 }));
  assert.ok('slotLanes' in slotRestoreValues(before, { ...before, slotPosition: slot('outer', 35, 95) }, { laneSpacing: 70 }));
  // Lanes moving together on a two-lane road record the mode as well.
  assert.deepEqual(
    slotRestoreValues(twoLanes({ slotPosition: slot('inner', 40) }), twoLanes(), { slotLanes: 'each' }),
    { slotEdge: 'inner', slotStart: 40, slotEnd: 40, slotLanes: 'together' },
  );
  const all = slotRestoreValues(before, twoLanes(), { slotEdge: 'centre' });
  assert.deepEqual(slotFieldDependencies('slotLane2End', all), Object.fromEntries(
    Object.entries(all).filter(([name]) => name !== 'slotLane2End'),
  ));
  assert.deepEqual(Object.keys(slotFieldDependencies('slotLanes', all)).length, 7);
  // A field that rebuilds the slots brings every recorded slot field with it.
  assert.deepEqual(slotFieldDependencies('laneSpacing', all), all);
  assert.deepEqual(slotFieldDependencies('laneSpacing', { laneSpacing: 70 }), {});
  assert.deepEqual(slotFieldDependencies('length', all), {});
});

test('restoring only Lane spacing or Lane count brings a lane-by-lane table back as it was', () => {
  const list = eachLane('outer', [30], [90], [150]);
  const applied = straight({ width: 200, lanes: 3, laneSpacing: 70, slotPosition: list });
  const page = {
    width: 200, lanes: 3, laneSpacing: 70, slotEdge: 'outer', slotLanes: 'each', slotStart: 30, slotEnd: 30,
    slotLane1Start: 30, slotLane1End: 30, slotLane2Start: 90, slotLane2End: 90, slotLane3Start: 150, slotLane3End: 150,
  };
  const apply = (from, fields) => {
    const params = { ...from };
    Object.assign(params, readTrackShapeFields({ ...fields }, { params }));
    return params;
  };
  for (const [name, edited] of [['laneSpacing', 60], ['lanes', 2]]) {
    // The edit drafts one field; the table it changes is recorded with it.
    const next = apply(applied, { ...page, [name]: edited });
    assert.notDeepEqual(next.slotPosition, list);
    const previous = { [name]: page[name], ...slotRestoreValues(applied, next, { [name]: edited }) };
    // The page redrawn after the edit, then the arrow of that one field.
    const redrawn = { ...page, slotLanes: 'together', slotStart: 30, slotEnd: 30 };
    const restored = apply(next, { ...redrawn, [name]: page[name], ...slotFieldDependencies(name, previous) });
    assert.deepEqual(restored.slotPosition, list, name);
  }
});

test('labels, the read-out and the spacing hint describe several slots', () => {
  const list = twoLanes({ slotPosition: eachLane('outer', [35, 95], [105, 165]) });
  assert.equal(slotSummary(list), 'slots 35/105-95/165 from left');
  assert.equal(pieceDetail({ params: list }), '300 × 200 mm · slots 35/105-95/165 from left');
  assert.equal(
    slotReadout(list),
    'End A is 165/95 mm and end B 105/35 mm from the right edge. Room on this road: 7.5 to 192.5 mm.',
  );
  const together = twoLanes({ laneSpacing: 70, slotPosition: slot('outer', 35, 95) });
  assert.equal(slotSummary(together), 'slots 35/105-95/165 from left');
  const corner = curve({ lanes: 2, laneSpacing: 65, slotPosition: eachLane('inner', [30], [120]) });
  assert.equal(slotReadout(corner), '170/80 mm from the outer edge. Room on this road: 7.5 to 192.5 mm.');
  assert.equal(pieceDetail({ params: corner }), '45° · inner R 200 mm · slots 30/120 from inner');
  assert.match(slotNotesMarkup(list), /tightest bend in the slots/);
  assert.equal(slotSpacingHint(list), '<p class="hint" data-slot-spacing-unused>Lane spacing is not used for slot positions on this piece.</p>');
  assert.match(slotSpacingHint(together), /data-slot-spacing-unused hidden>/);
  // Off-centre chosen, but every slot is where a centred piece has it.
  const { root, part } = fakeGroup('outer');
  showSlotAdvice(root, twoLanes());
  assert.equal(part('readout').textContent, 'Every slot is where a centred piece has it, so the slots stay centred.');
});

test('the group renders the Lanes choice, slot 1 fields and the lane table', () => {
  const together = slotPositionControls(twoLanes({ slotPosition: slot('outer', 35, 95) }));
  assert.match(together, /<div data-slot-lanes-choice><label class="field"><span>Lanes<\/span><select name="slotLanes" data-slot-lanes><option value="together" selected>Lanes move together<\/option><option value="each">Set each lane<\/option>/);
  assert.match(together, /<span data-slot-label="start">Slot 1 at end A<\/span>/);
  assert.match(together, /<span data-slot-label="end">Slot 1 at end B<\/span>/);
  assert.match(together, /data-slot-follow>Slot 1 is nearest the edge you measure from\. The others follow every 65 mm\.</);
  // The table starts from the slots of lanes moving together.
  assert.match(together, /name="slotLane1Start" value="35"/);
  assert.match(together, /name="slotLane2Start" value="100"/);
  assert.match(together, /name="slotLane2End" value="160"/);
  assert.match(together, /<span class="slot-lane-name">Slot 2 at end B<\/span>/);
  assert.match(together, /data-slot-each hidden>/);
  const each = slotPositionControls(twoLanes({ slotPosition: eachLane('outer', [35, 95], [105, 165]) }));
  assert.match(each, /<option value="each" selected>Set each lane/);
  assert.match(each, /name="slotStart" value="35"/);
  assert.match(each, /name="slotLane2End" value="165"/);
  // Rows beyond the lane count continue every lane spacing, for a new lane.
  assert.match(each, /name="slotLane3Start" value="170"/);
});

test('switching the Lanes choice carries the slot positions across', () => {
  const inputs = {};
  const box = (name, value) => (inputs[name] = {
    name, value: String(value),
    get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); },
  });
  box('slotStart', 35);
  box('slotEnd', 95);
  for (let i = 1; i <= 8; i++) box('slotLane' + i + 'Start', 0), box('slotLane' + i + 'End', 0);
  const host = { querySelector: (key) => inputs[key.match(/name="([^"]+)"/)[1]] };
  const lanes = { name: 'slotLanes', value: 'each', closest: () => host };
  const changed = applySlotLanes(lanes, 65);
  assert.equal(changed.length, 16);
  assert.deepEqual(
    [1, 2, 3].map((i) => [inputs['slotLane' + i + 'Start'].value, inputs['slotLane' + i + 'End'].value]),
    [['35', '95'], ['100', '160'], ['165', '225']],
  );
  // Nothing to rewrite the second time.
  assert.deepEqual(applySlotLanes(lanes, 65), []);
  // Back to together: slot 1 of the table.
  inputs.slotLane1Start.value = '40';
  lanes.value = 'together';
  assert.deepEqual(applySlotLanes(lanes, 65), [inputs.slotStart]);
  assert.equal(inputs.slotStart.value, '40');
  assert.equal(inputs.slotEnd.value, '95');
  // Any other control, or an unknown spacing, changes nothing.
  assert.deepEqual(applySlotLanes({ name: 'slotStart' }, 65), []);
  assert.deepEqual(applySlotLanes({ ...lanes, value: 'each' }, NaN), []);
  // The table values are read with the rest, and snap like slot 1's.
  const root = { querySelector: (key) => (key.includes('slotEdge') ? { value: 'outer' } : key.includes('slotLanes') ? { value: 'each' } : host.querySelector(key)) };
  const read = slotFieldValues(root);
  assert.equal(read.lanes, 'each');
  assert.deepEqual(read.starts.slice(0, 2), [40, 100]);
  const cell = { name: 'pcSlotLane3End', valueAsNumber: 12.3, value: '12.3' };
  assert.equal(snapSlotField(cell), false);
  assert.equal(snapSlotField(cell, slotFieldNames('pc')), true);
  assert.equal(cell.value, 12.5);
});

test('a slot warning focuses slot 1 of the lane mode that is shown', () => {
  const state = { slotStart: true, slotEnd: true, slotLane1Start: false, slotLane1End: false, width: false };
  const form = { elements: { namedItem: (name) => (name in state ? { disabled: state[name] } : null) } };
  assert.equal(slotFieldToFocus(form, 'slotStart'), 'slotLane1Start');
  assert.equal(slotFieldToFocus(form, 'slotEnd'), 'slotLane1End');
  assert.equal(slotFieldToFocus(form, 'slotLane1Start'), 'slotLane1Start');
  assert.equal(slotFieldToFocus(form, 'width'), 'width');
  Object.assign(state, { slotStart: false, slotLane1Start: true, slotLane2Start: true });
  assert.equal(slotFieldToFocus(form, 'slotLane2Start'), 'slotStart');
  assert.equal(slotFieldToFocus(form, 'slotStart'), 'slotStart');
  // On a corner both end B fields are disabled: keep the one named.
  Object.assign(state, { slotEnd: true, slotLane1End: true });
  assert.equal(slotFieldToFocus(form, 'slotEnd'), 'slotEnd');
  assert.equal(slotFieldToFocus(undefined, 'slotStart'), 'slotStart');
});

test('the group shows the lane table rows and columns that apply', () => {
  const node = (extra = {}) => ({ hidden: false, disabled: false, ...extra });
  const rows = Array.from({ length: 8 }, (_, k) => {
    const start = node(), end = node();
    return {
      ...node(), dataset: { slotRow: String(k + 1) }, start, end,
      querySelectorAll: () => [start, end],
      querySelector: () => end,
    };
  });
  const labels = ['start', 'end'].map((key) => ({ dataset: { slotLabel: key }, textContent: '' }));
  const togetherInputs = [node(), node()];
  const columns = [node(), node()];
  const lanesSelect = node({ value: 'together' });
  const { root, host, part, endInput } = fakeGroup('outer');
  const extra = {
    '[data-slot-lanes-choice]': node(), '[data-slot-lanes]': lanesSelect, '[data-slot-together]': node(),
    '[data-slot-follow]': node({ textContent: '' }), '[data-slot-each]': node(),
    '[data-slot-head-start]': { textContent: '' },
  };
  const lists = {
    '[data-slot-row]': rows, '[data-slot-label]': labels,
    '[data-slot-together] input': togetherInputs, '[data-slot-col-end]': columns,
  };
  const own = host.querySelector;
  host.querySelector = (key) => extra[key] ?? own(key);
  host.querySelectorAll = (key) => lists[key] ?? [];
  const unused = node();
  const outer = root.querySelector;
  root.querySelector = (key) => (key === '[data-slot-spacing-unused]' ? unused : outer(key));

  syncSlotPositionControls(root, { kind: 'straight', lanes: '1', spacing: '65' });
  assert.ok(extra['[data-slot-lanes-choice]'].hidden && lanesSelect.disabled);
  assert.deepEqual(labels.map((l) => l.textContent), ['At end A', 'At end B']);
  assert.ok(extra['[data-slot-follow]'].hidden && extra['[data-slot-each]'].hidden && unused.hidden);

  syncSlotPositionControls(root, { kind: 'straight', lanes: '3', spacing: '70' });
  assert.ok(!extra['[data-slot-lanes-choice]'].hidden && !lanesSelect.disabled);
  assert.deepEqual(labels.map((l) => l.textContent), ['Slot 1 at end A', 'Slot 1 at end B']);
  assert.equal(extra['[data-slot-follow]'].hidden, false);
  assert.equal(extra['[data-slot-follow]'].textContent, 'Slot 1 is nearest the edge you measure from. The others follow every 70 mm.');
  assert.ok(rows.every((row) => row.hidden && row.start.disabled));

  lanesSelect.value = 'each';
  syncSlotPositionControls(root, { kind: 'straight', lanes: '3', spacing: '70' });
  assert.ok(extra['[data-slot-together]'].hidden && togetherInputs.every((i) => i.disabled) && endInput.disabled);
  assert.ok(!extra['[data-slot-each]'].hidden && !unused.hidden && extra['[data-slot-follow]'].hidden);
  assert.deepEqual(rows.map((row) => row.hidden), [false, false, false, true, true, true, true, true]);
  assert.ok(!rows[2].start.disabled && !rows[2].end.disabled && rows[3].start.disabled);
  assert.equal(extra['[data-slot-head-start]'].textContent, 'End A');

  // A corner has one column.
  syncSlotPositionControls(root, { kind: 'curve', lanes: '2', spacing: '70' });
  assert.ok(columns.every((c) => c.hidden) && rows[0].end.disabled && !rows[0].start.disabled);
  assert.equal(extra['[data-slot-head-start]'].textContent, 'Distance');
  // Centred again: the spacing hint goes.
  part('edge').value = 'centre';
  syncSlotPositionControls(root, { kind: 'straight', lanes: '2', spacing: '70' });
  assert.equal(unused.hidden, true);
});

test('previews and tiles draw every slot and put the arrow on slot 1', () => {
  const p = twoLanes({ slotPosition: eachLane('outer', [35, 95], [105, 165]) });
  const preview = piecePreview(p);
  const lanes = [...preview.marks.matchAll(/class="ct-lane"[^>]*points="([^"]+)"/g)].map((m) =>
    m[1].split(' ').map((pair) => pair.split(',').map(Number)));
  assert.equal(lanes.length, 2);
  assert.ok(lanes.every((lane) => lane.length === 121), 'both slots are sampled along the S');
  // Lane index 1 is slot 1 when measured from the left (outer) edge: 35 mm
  // from the left is 65 mm above the centre in the picture.
  assert.deepEqual(lanes[1][0], [-150, -65]);
  assert.deepEqual(lanes[0][0], [-150, 5]);
  assert.deepEqual(lanes[0].at(-1), [150, 65]);
  const arrow = numbers(preview.marks.match(/class="ct-travel"[^>]*points="([^"]+)"/)[1]);
  // The arrowhead is on slot 1, 65 mm from the left edge mid-way: 35 mm
  // above the centre in the picture. Slot 2 is 35 mm below it.
  assert.ok(Math.abs(arrow[3] - -35) < 5, 'arrow on slot 1: ' + arrow.join(','));
  assert.equal(preview.lengths.length, 2);

  const tile = trackThumbnail({ params: p, plan: null });
  const paths = tile.match(/class="lib-lanes" d="([^"]+)"/)[1].split('M').filter(Boolean);
  assert.equal(paths.length, 2);
  assert.ok(paths.every((path) => path.split('L').length === 49));
  assert.match(tile, /class="lib-travel"/);
});

test('the pack rules box names every piece the new rules centre, and the notice agrees', () => {
  assert.equal(packRuleSlotNote({ lanes: 0, centre: 0, together: 2 }), '');
  // Lists for another lane count only: the text as before.
  assert.equal(
    packRuleSlotNote({ lanes: 1, centre: 0 }),
    '<p>1 piece sets each lane on its own and is centred: its slot positions are for another lane count.' +
      ' Setting the lane count back does not bring it back. Pieces whose lanes move together keep their slot positions.</p>',
  );
  // Lanes moving together that the rules put on the centred positions.
  assert.equal(
    packRuleSlotNote({ lanes: 0, centre: 1 }),
    '<p>1 piece is centred: the new rules put its slots where a centred piece has them.' +
      ' Setting the rules back does not bring it back.</p>',
  );
  assert.equal(
    packRuleSlotNote({ lanes: 2, centre: 3 }),
    '<p>2 pieces set each lane on their own and are centred: their slot positions are for another lane count.' +
      ' 3 pieces are centred: the new rules put their slots where a centred piece has them.' +
      ' Setting the rules back does not bring them back.</p>',
  );
  // The notice keeps its text, and names lists that now move together.
  assert.equal(packApplyNotice({ pieces: 4, centred: 0 }), 'Applied to all 4 pieces of the pack.');
  assert.equal(
    packApplyNotice({ pieces: 4, centred: 2, together: 0 }),
    'Applied to all 4 pieces of the pack. 2 pieces have a centred slot now.',
  );
  assert.equal(
    packApplyNotice({ pieces: 4, centred: 1, together: 1 }),
    'Applied to all 4 pieces of the pack. 1 piece has a centred slot now.' +
      ' 1 piece set lane by lane now has lanes that move together, so a later lane spacing moves its slots.',
  );
});
