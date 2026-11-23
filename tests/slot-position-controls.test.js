import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTrack, validateTrack } from '../src/track.js';
import { slotShiftAt } from '../src/slot-position.js';
import {
  SLOT_FIELDS,
  applySlotMode,
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

test('a centred slot is never stored, and only single-lane straights and curves can move it', () => {
  assert.equal(readSlotPosition({ edge: 'centre', start: 35, end: 145 }, straight()), null);
  // Both ends on the middle of the road: that is the centred piece.
  assert.equal(readSlotPosition({ edge: 'outer', start: 100, end: 100.2 }, straight()), null);
  assert.equal(readSlotPosition({ edge: 'inner', start: 100, end: 5 }, curve()), null);
  assert.notEqual(readSlotPosition({ edge: 'outer', start: 100, end: 60 }, straight()), null);
  for (const p of [
    straight({ lanes: 2 }),
    straight({ special: { type: 'timing' } }),
    straight({ kind: 'import' }),
  ]) {
    assert.equal(slotPositionAllowed(p), false);
    assert.equal(readSlotPosition({ edge: 'outer', start: 35, end: 35 }, p), null);
  }
  assert.ok(slotPositionAllowed(straight()) && slotPositionAllowed(curve()));
  // A half-typed distance is kept for validation to name, not stored as centred.
  const typing = straight();
  typing.slotPosition = readSlotPosition({ edge: 'outer', start: NaN, end: 35 }, typing);
  assert.throws(() => validateTrack(typing), /Choose a valid slot position/);
});

test('the inspector fields are read into the piece and never leak into its settings', () => {
  assert.deepEqual(SLOT_FIELDS, { edge: 'slotEdge', start: 'slotStart', end: 'slotEnd' });
  assert.deepEqual(slotFieldNames('pc'), {
    edge: 'pcSlotEdge', start: 'pcSlotStart', end: 'pcSlotEnd',
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

  // A second lane, or a shape that cannot carry it, removes the slot position.
  readTrackShapeFields({ ...page, lanes: 2 }, { params });
  assert.equal('slotPosition' in params, false);
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
  assert.match(centred, /Off-centre slots are for single-lane roads for now\./);
  assert.match(centred, /Corners keep one slot position\. Change position on a straight\./);
  // A first distance that is visibly off-centre and inside the road.
  assert.match(centred, /name="slotStart" value="50"/);
  assert.match(centred, /name="slotEnd" value="50"/);
  assert.doesNotMatch(centred, /step="0\.5"/, 'snapping happens in code');
  // The switch has no name, so it never becomes a setting of the piece.
  assert.deepEqual(
    [...centred.matchAll(/\bname="([^"]+)"/g)].map((m) => m[1]),
    ['slotEdge', 'slotStart', 'slotEnd'],
  );

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
    ['pcSlotEdge', 'pcSlotStart', 'pcSlotEnd'],
  );
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

  // Several lanes: a short reason instead of the choice.
  syncSlotPositionControls(root, { kind: 'straight', lanes: 2 });
  assert.equal(host.hidden, false);
  assert.ok(label.hidden && part('mode').disabled);
  assert.equal(part('unavailable').hidden, false);
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
  assert.deepEqual(slotFieldDependencies('lanes', all), {});
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
      ['slotEdge', 'slotStart', 'slotEnd'],
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
  for (const field of ['slotEdge', 'slotStart', 'slotEnd'])
    assert.equal(sectionForField(field, 'joints'), 'geometry');
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
  assert.equal(read({ lanes: '2', laneSpacing: '100', slotEdge: 'outer' }), '2 lanes · 100 mm');
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
