import test from 'node:test';
import assert from 'node:assert/strict';
import { braidFeedControls } from '../src/connection-controls.js';
import { syncPitAssemblyNotes } from '../src/inspector.js';
import { syncSpecialControls } from '../src/special-piece-controls.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { defaultTrack } from '../src/track.js';
import { readTrackShapeFields } from '../src/track-shape-controls.js';

test('the pit junction selector appears above extra lane feeds and opens for old and new pits', () => {
  const pit = specialTrackParams('pit', defaultTrack());
  const old = structuredClone(pit);
  delete old.special.pitContactMode;
  delete old.special.pitContactLength;
  for (const params of [pit, old]) {
    const panel = braidFeedControls(params);
    assert.match(panel, /^<details open>/);
    assert.match(panel, /Pit junction openings.*?value="wire" selected>Round wire holes/);
    assert.match(panel, /data-pit-contact-slot hidden.*?name="spPitContactLength" value="1.2"/);
    assert.ok(panel.indexOf('Pit junction openings') < panel.indexOf('Extra lane openings'));
  }
  assert.doesNotMatch(braidFeedControls(defaultTrack()), /Pit junction openings|<details open>/);
  assert.doesNotMatch(braidFeedControls({ ...pit, braidWidth: 0 }), /<details open>/);
});

test('a pit slot setting round-trips without changing lengths or positions of extra lane feeds', () => {
  const track = { params: specialTrackParams('pit', defaultTrack()) };
  Object.assign(track.params, { braidFeedSide: 'right', braidFeedLength: 4.5, braidFeedStations: [0.15] });
  assert.deepEqual(readTrackShapeFields({ spPitContactMode: 'braid', spPitContactLength: 2.5 }, track), {});
  const saved = JSON.parse(JSON.stringify(track));
  const markup = braidFeedControls(saved.params);
  assert.match(markup, /value="braid" selected>Braid pass-throughs/);
  assert.match(markup, /data-pit-contact-slot>.*?name="spPitContactLength" value="2.5"/);
  assert.equal(saved.params.braidFeedSide, 'right');
  assert.equal(saved.params.braidFeedLength, 4.5);
  assert.deepEqual(saved.params.braidFeedStations, [0.15]);
  assert.ok(!('spPitContactMode' in saved.params));
  readTrackShapeFields({ spPitContactMode: 'wire', spPitContactLength: NaN }, saved);
  assert.equal(saved.params.special.pitContactMode, 'wire');
  assert.equal(saved.params.special.pitContactLength, 2.5);
});

test('pit length is available for braid slots, and a zero-width braid explains the disabled selector', () => {
  const slot = {}, hint = {};
  const form = {
    elements: {
      spPitContactMode: { value: 'wire' },
      spPitContactLength: { value: '1.2' },
      braidWidth: { valueAsNumber: 5 },
    },
    querySelector: key => ({
      '[data-pit-contact-slot]': slot,
      '[data-pit-braid-width]': hint,
    })[key],
  };
  syncSpecialControls(form);
  assert.ok(slot.hidden && form.elements.spPitContactLength.disabled);
  form.elements.spPitContactMode.value = 'braid';
  syncSpecialControls(form);
  assert.ok(!slot.hidden && !form.elements.spPitContactLength.disabled);
  form.elements.braidWidth.valueAsNumber = 0;
  syncSpecialControls(form);
  assert.ok(slot.hidden && !hint.hidden && form.elements.spPitContactMode.disabled);
});

test('Road wiring instructions follow both the draft braid and motor choices', () => {
  const pit = specialTrackParams('pit', defaultTrack());
  const notes = { innerHTML: '' };
  const form = { querySelector: () => notes };
  syncPitAssemblyNotes(form, pit);
  assert.match(notes.innerHTML, /wire through the hole/);
  Object.assign(pit.special, { pitContactMode: 'braid', motorMount: true });
  syncPitAssemblyNotes(form, pit);
  assert.match(notes.innerHTML, /Fold each tail down through its slot/);
  assert.match(notes.innerHTML, /Lay the slider in its channel between the main slot and the pit slot/);
  assert.doesNotMatch(notes.innerHTML, /pushrod/i);
  syncPitAssemblyNotes(form, { ...pit, braidWidth: 0 });
  assert.doesNotMatch(notes.innerHTML, /Fold each tail/);
});
