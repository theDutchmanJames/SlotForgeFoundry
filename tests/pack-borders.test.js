// The borders of a track pack, and the steps of a new pack that run
// without a page: its starting values and the line under the steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { starterPack, trackWithProfile } from '../src/library-profile.js';
import { packSpecialTrack } from '../src/pack-specials.js';
import { addCollection, newLibraryDatabase, readCollections, setCollectionBorders } from '../src/library-database.js';
import {
  applyPackBorders,
  BORDER_DEFAULTS,
  packBorderParams,
  validatePackBorders,
  validatePackRules,
} from '../src/track-pack-rules.js';
import { bordersOf, footNote, NEW_PACK_STEPS, stepValues } from '../src/new-pack-steps.js';
import { TRACKSIDE_DEFAULTS } from '../src/geometry/trackside.js';

const SQL = await initSqlJs();

test('pack borders are checked: known settings, a side, widths and connections', () => {
  assert.deepEqual(validatePackBorders({}), BORDER_DEFAULTS);
  assert.throws(() => validatePackBorders({ moss: 1 }), /unknown border settings/);
  assert.throws(() => validatePackBorders({ borderSide: 'left' }), /Choose a side for the borders/);
  assert.throws(() => validatePackBorders({ borderWidth: 2001 }), /Border width must be between 0 and 2000/);
  assert.throws(() => validatePackBorders({ borderApexWidth: -1 }), /Apex width on corners must be/);
  assert.throws(() => validatePackBorders({ borderSide: 'both', borderWidth: 0 }), /Give the borders a width/);
  assert.throws(() => validatePackBorders({ borderMount: 'glue' }), /Choose a connection for Attach to road/);
  // A pack keeps them in its rules.
  const rules = validatePackRules({ ...starterPack().rules, borders: { borderSide: 'outer' } });
  assert.equal(rules.borders.borderSide, 'outer');
});

test('a straight keeps the border width all along, a corner widens to its apex', () => {
  const borders = { borderSide: 'both', borderWidth: 20, borderApexWidth: 40 };
  assert.deepEqual(
    [packBorderParams(borders, 'straight')].map((p) => [p.borderEntry, p.borderApex, p.borderExit]),
    [[20, 20, 20]],
  );
  assert.deepEqual(
    [packBorderParams(borders, 'curve')].map((p) => [p.borderEntry, p.borderApex, p.borderExit]),
    [[20, 40, 20]],
  );
  // A corner drawn with its own apex for one side has that taken away.
  const params = { kind: 'curve', borderSide: 'outer', outerApexWidth: 90, innerApexPosition: 0.3 };
  applyPackBorders(params, borders);
  assert.equal(params.outerApexWidth, undefined);
  assert.equal('innerApexPosition' in params, false);
  assert.equal(params.borderApex, 40);
  assert.equal(params.apexPosition, 0.5);
});

test('a pack gives its borders to its straights and corners only, and refuses faulty ones', (t) => {
  const db = newLibraryDatabase(SQL, false);
  t.after(() => db.close());
  const pack = starterPack(1);
  const turnout = { name: 'Turnout', track: packSpecialTrack(pack, 'turnout') };
  const id = addCollection(db, 'Bordered', pack.profile, [...pack.pieces, turnout], pack.rules);
  const before = readCollections(db).find((c) => c.id === id);
  const plain = before.pieces.filter((p) => !p.track.params.special).length;
  const result = setCollectionBorders(
    db,
    id,
    { borderSide: 'both', borderWidth: 18, borderApexWidth: 30, borderMount: 'tabs' },
    { expectedRevision: before.revision },
  );
  assert.deepEqual(result, { changed: plain, revision: before.revision + 1 });
  const after = readCollections(db).find((c) => c.id === id);
  assert.equal(after.rules.borders.borderWidth, 18);
  for (const [i, piece] of after.pieces.entries()) {
    const p = piece.track.params;
    if (p.special) {
      assert.deepEqual(p, before.pieces[i].track.params, piece.name);
      continue;
    }
    assert.equal(p.borderSide, 'both', piece.name);
    assert.equal(p.borderMount, 'tabs', piece.name);
    assert.deepEqual([p.borderEntry, p.borderApex, p.borderExit], [18, p.kind === 'curve' ? 30 : 18, 18], piece.name);
    trackWithProfile(piece.track, after.profile);
  }
  // Off again, for the same pieces.
  const off = setCollectionBorders(db, id, { borderSide: 'none' }, { expectedRevision: after.revision });
  assert.equal(off.changed, plain);
  const cleared = readCollections(db).find((c) => c.id === id);
  assert.ok(cleared.pieces.filter((p) => !p.track.params.special).every((p) => p.track.params.borderSide === 'none'));
  // Faulty settings leave the pack as it is.
  assert.throws(() => setCollectionBorders(db, id, { borderSide: 'up' }), /Choose a side/);
  assert.equal(readCollections(db).find((c) => c.id === id).revision, cleared.revision);
});

test('the steps of a new pack start from the chosen pack', () => {
  // An empty pack: defaults, nothing on the borders.
  const empty = stepValues({ profile: { height: 12 }, rules: {}, pieces: [] });
  assert.equal(empty.profile.height, 12);
  assert.deepEqual(empty.borders, BORDER_DEFAULTS);
  assert.equal(empty.markings.whiteLineRoad, 'none');
  assert.deepEqual(empty.texture, {});
  assert.deepEqual(empty.trackside, TRACKSIDE_DEFAULTS);
  // A pack with pieces: what its rules say, or else what its corners have.
  const pack = starterPack(2);
  const corner = pack.pieces.find((p) => p.track.params.kind === 'curve');
  Object.assign(corner.track.params, { borderSide: 'outer', borderEntry: 15, borderApex: 25 });
  assert.deepEqual(stepValues(pack).borders, {
    ...BORDER_DEFAULTS,
    borderSide: 'outer',
    borderWidth: 15,
    borderApexWidth: 25,
  });
  const ruled = stepValues({ ...pack, rules: { ...pack.rules, borders: { ...BORDER_DEFAULTS, borderSide: 'inner' } } });
  assert.equal(ruled.borders.borderSide, 'inner');
  assert.equal(bordersOf(undefined).borderSide, 'none');
});

test('the line under the steps names the steps you changed', () => {
  assert.equal(footNote(new Set()), 'Everything after Basics keeps what the pack starts with.');
  assert.equal(
    footNote(new Set(['trackside', 'borders'])),
    'Your settings: Borders, Trackside. Everything else keeps what the pack starts with.',
  );
  // Basics first, and every step has its own group, icon and words.
  assert.equal(NEW_PACK_STEPS[0].key, 'basics');
  for (const s of NEW_PACK_STEPS) assert.ok(s.group && s.icon && s.title && s.subtitle && s.hint, s.key);
});
