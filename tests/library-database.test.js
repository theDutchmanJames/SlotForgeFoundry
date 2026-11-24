import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { newProject } from '../src/project.js';
import { starterPack, trackWithProfile } from '../src/library-profile.js';
import { defaultPackRules, rulesFromPieces } from '../src/track-pack-rules.js';
import {
  addCollection,
  applyToCollection,
  deleteCollection,
  deleteLayout,
  deletePiece,
  deleteStlPart,
  duplicateCollection,
  duplicatePiece,
  inspectLibraryBytes,
  newLibraryDatabase,
  packRuleSlotChanges,
  paramsUnderPackRules,
  readCollections,
  readLayout,
  readLayouts,
  readStlPart,
  readStlParts,
  renameCollection,
  renamePiece,
  renameStlPart,
  replaceLibrary,
  saveLayout,
  saveStlPart,
  saveRecipe,
  setCollectionProfile,
  setCollectionRules,
} from '../src/library-database.js';

const SQL = await initSqlJs();
// A real library from before version 5 has only the pack tables.
function asVersion(db, version) {
  db.run('DROP TABLE layouts; DROP TABLE stl_parts; PRAGMA user_version=' + version);
}
function dbFor(t, seed = false) {
  const db = newLibraryDatabase(SQL, seed);
  t.after(() => db.close());
  return db;
}

test('editing the shared print profile also keeps the rules usable for the next piece in an empty pack', (t) => {
  const db = dbFor(t);
  const rules = { ...defaultPackRules(), width: 100, laneSpacing: 85 };
  const id = addCollection(db, 'Narrow road', {}, [], rules);
  assert.throws(
    () => setCollectionProfile(db, id, { braidWidth: 12 }, { expectedRevision: 1 }),
    /need more room/,
  );
  assert.equal(readCollections(db)[0].revision, 1);
});

test('legacy rules recover an R1 base from a higher curve and preserve the original Basic pack geometry', () => {
  const { pieces } = starterPack();
  assert.deepEqual(rulesFromPieces(pieces,'SlotForge Basic'), defaultPackRules());
  assert.deepEqual(rulesFromPieces([pieces.at(-1)], 'Le Mans'), {
    ...defaultPackRules(), angle:30,
  });
  assert.equal(pieces.at(-1).track.params.angle, 30);
});

test('restoring an earlier SQLite collection maps its linked and individual clip settings to current hardware', (t) => {
  const old = new SQL.Database();
  t.after(() => old.close());
  old.run(`PRAGMA user_version=1; PRAGMA application_id=0x53464c42;
    CREATE TABLE collections (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, profile TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1));
    CREATE TABLE pieces (id TEXT PRIMARY KEY NOT NULL, collection_id TEXT NOT NULL REFERENCES collections(id), name TEXT NOT NULL, track TEXT NOT NULL);`);
  const track = newProject().track;
  track.params.clipType = 'slotforge';
  old.run('INSERT INTO collections VALUES (?,?,?,?)', [
    'club',
    'Club',
    JSON.stringify({ clipType: 'carrera' }),
    1,
  ]);
  old.run('INSERT INTO pieces VALUES (?,?,?,?)', [
    'bend',
    'club',
    'Bend',
    JSON.stringify(track),
  ]);
  const restored = dbFor(t);
  replaceLibrary(restored, inspectLibraryBytes(SQL, old.export()));
  const [collection] = readCollections(restored);
  assert.equal(collection.profile.clipType, 'carrera-retained');
  assert.equal(collection.pieces[0].track.params.clipType, 'draw-key');
  assert.deepEqual(collection.rules, {
    width: track.params.width,
    lanes: track.params.lanes,
    laneSpacing: track.params.laneSpacing,
    r1InnerRadius: track.params.radius - track.params.width / 2,
    angle: track.params.angle,
  });
  assert.equal(
    trackWithProfile(collection.pieces[0].track, collection.profile).params
      .clipType,
    'carrera-retained',
  );
});

test('portable SQLite backup round-trips both ten-piece packs, IDs and names', (t) => {
  const db = dbFor(t, true);
  const original = readCollections(db);
  assert.equal(original.length, 2);
  assert.equal(original[0].pieces.length, 10);
  assert.deepEqual(original[0].rules, defaultPackRules());
  assert.equal(original[0].pieces.at(-1).track.params.angle, 30);
  assert.equal(original[1].name, 'SlotForge Basic Single Lane');
  assert.equal(original[1].pieces.length, 10);
  assert.deepEqual(original[1].rules, { ...defaultPackRules(), width: 100, lanes: 1, angle: 30 });
  const bytes = db.export();
  assert.equal(
    new TextDecoder().decode(bytes.subarray(0, 16)),
    'SQLite format 3\0',
  );
  const data = inspectLibraryBytes(SQL, bytes);
  assert.deepEqual(data, original);
  const imported = dbFor(t);
  replaceLibrary(imported, data);
  assert.deepEqual(readCollections(imported), original);
  assert.equal(
    readCollections(imported)[0].pieces[0].track.params.kind,
    'straight',
  );
});

test('a version 2 library gains the single-lane preset once and preserves edited packs with the same name', (t) => {
  const previous = dbFor(t);
  asVersion(previous, 2);
  const pack = starterPack();
  const userId = addCollection(previous, 'SlotForge Basic Single Lane', pack.profile, pack.pieces, pack.rules);
  setCollectionProfile(previous, userId, { ...pack.profile, slotDepth: 5 });
  const userPack = readCollections(previous)[0];
  const imported = inspectLibraryBytes(SQL, previous.export());
  assert.equal(imported.length, 2);
  assert.deepEqual(imported[0], userPack);
  assert.equal(imported[1].name, 'SlotForge Basic Single Lane (preset)');
  assert.equal(imported[1].rules.lanes, 1);
  assert.equal(imported[1].profile.slotDepth, 8);
  const current = dbFor(t);
  replaceLibrary(current, imported);
  assert.deepEqual(inspectLibraryBytes(SQL, current.export()), readCollections(current));
  assert.equal(readCollections(current).length, 2);
});

test('existing starter packs gain an editable starting grid once while keeping custom recipes intact', (t) => {
  const old = dbFor(t);
  asVersion(old, 3);
  const single = starterPack(1);
  const double = starterPack(2);
  const legacyPieces = pack => pack.pieces.filter(p => !p.track.params.startingGrid);
  const doubleId = addCollection(old, double.name, double.profile, legacyPieces(double), double.rules);
  addCollection(old, single.name, {}, [single.pieces[0]], single.rules);
  addCollection(old, single.name + ' (preset)', single.profile, legacyPieces(single), single.rules);
  setCollectionProfile(old, doubleId, { ...double.profile, slotDepth: 7 });
  saveRecipe(old, doubleId, { name: 'Starting grid', track: double.pieces[0].track });
  const original = readCollections(old);
  const updated = inspectLibraryBytes(SQL, old.export());
  assert.deepEqual(updated[1], original[1]);
  for (const [index, lanes] of [[0, 2], [2, 1]]) {
    const collection = updated[index];
    const grids = collection.pieces.filter(p => p.track.params.startingGrid);
    assert.equal(grids.length, 1);
    assert.equal(grids[0].name, lanes === 2 ? 'Starting grid (preset)' : 'Starting grid');
    assert.equal(grids[0].track.params.lanes, lanes);
    assert.equal(grids[0].track.params.width, 100 * lanes);
    assert.equal(collection.revision, original[index].revision + 1);
    assert.deepEqual(collection.pieces.filter(p => !p.track.params.startingGrid), original[index].pieces);
  }
  const db = dbFor(t);
  replaceLibrary(db, updated);
  const grid = updated[0].pieces.find(p => p.track.params.startingGrid);
  const settings = { width: 65, thickness: 2, legLength: 0, stagger: 0, recessed: true };
  grid.track.params.startingGrid = settings;
  saveRecipe(db, doubleId, grid, { expectedRevision: updated[0].revision });
  const reopened = inspectLibraryBytes(SQL, db.export());
  assert.deepEqual(reopened, readCollections(db));
  const track = reopened[0].pieces.find(p => p.id === grid.id).track;
  const p = trackWithProfile(track, reopened[0].profile).params;
  assert.equal(p.slotDepth, 7);
  assert.deepEqual(p.startingGrid, settings);
});

test('an old pack with no room for grid marks still opens with its custom print profile', (t) => {
  const db = dbFor(t);
  asVersion(db, 3);
  const pack = starterPack();
  const profile = { ...pack.profile, braidWidth: 47.8, joint: 'none' };
  const pieces = pack.pieces.filter(p => !p.track.params.startingGrid);
  addCollection(db, pack.name, profile, pieces, pack.rules);
  const original = readCollections(db);
  assert.deepEqual(inspectLibraryBytes(SQL, db.export()), original);
});

test('per-piece connector counts survive shared profile edits and a SQLite backup', (t) => {
  const db = dbFor(t);
  const pack = addCollection(db, 'Club road', { joint: 'both' });
  const track = newProject().track;
  track.params.connectorCounts = { seamClips: 3, seamTabs: 2, startClips: 1, outerSideTabs: 2 };
  saveRecipe(db, pack, { name: 'Five across', track });
  const other = structuredClone(track);
  other.params.connectorCounts = { seamClips: 2, seamTabs: 3 };
  saveRecipe(db, pack, { name: 'Matching tab row', track: other });
  setCollectionProfile(db, pack, { joint: 'both', tabWidth: 8 });
  const copy = dbFor(t);
  replaceLibrary(copy, inspectLibraryBytes(SQL, db.export()));
  const [collection] = readCollections(copy);
  const recipes = collection.pieces.map(piece => trackWithProfile(piece.track, collection.profile).params);
  assert.deepEqual(recipes.map(p => p.connectorCounts), [track.params.connectorCounts, other.params.connectorCounts]);
  assert.ok(recipes.every(p => p.tabWidth === 8));
});

test('saves, inherited settings, revision checks and backup restoration operate on one collection', (t) => {
  const db = dbFor(t);
  const track = newProject().track;
  const a = addCollection(db, 'A', { slotDepth: 7 });
  const b = addCollection(db, 'B');
  const bend = saveRecipe(
    db,
    a,
    { name: 'Club bend', track },
    { expectedRevision: 1 },
  );
  saveRecipe(db, b, { name: 'Independent', track });
  const straight = structuredClone(track);
  straight.params.kind = 'straight';
  saveRecipe(db, a, { name: 'Straight', track: straight });
  const before = inspectLibraryBytes(SQL, db.export());
  assert.throws(
    () =>
      setCollectionProfile(db, a, { slotDepth: 8 }, { expectedRevision: 1 }),
    /another window/,
  );
  saveRecipe(
    db,
    a,
    { id: bend, name: "Club's bend", track },
    { profile: { slotDepth: 8 }, expectedRevision: 3 },
  );
  const [updated, independent] = readCollections(db);
  assert.equal(updated.revision, 4);
  assert.deepEqual(
    updated.pieces.map(
      (p) => trackWithProfile(p.track, updated.profile).params.slotDepth,
    ),
    [8, 8],
  );
  assert.equal(updated.pieces[0].name, "Club's bend");
  assert.equal(independent.pieces[0].track.params.slotDepth, 7);
  assert.throws(
    () => saveRecipe(db, b, { id: bend, name: 'wrong group', track }),
    /no longer belongs/,
  );
  assert.throws(
    () => setCollectionProfile(db, a, { slotDepth: 100 }),
    /slot|depth/i,
  );
  assert.deepEqual(readCollections(db), [updated, independent]);
  assert.throws(() => replaceLibrary(db, before, before), /library changed/);
  assert.deepEqual(readCollections(db), [updated, independent]);
  replaceLibrary(db, before);
  const [restored] = readCollections(db);
  assert.ok(restored.revision > updated.revision);
  assert.deepEqual(restored.pieces, before[0].pieces);
  assert.deepEqual(restored.profile, before[0].profile);
  assert.throws(
    () =>
      setCollectionProfile(db, a, {}, { expectedRevision: updated.revision }),
    /another window/,
  );
});

test('restores SQL data only after checking the file, schema, references, dimensions and data types', (t) => {
  const ok = dbFor(t, true).export();
  assert.throws(
    () => inspectLibraryBytes(SQL, new Uint8Array(64)),
    /SlotForge/,
  );
  function rejects(sql, pattern) {
    const db = new SQL.Database(ok);
    try {
      db.run(sql);
      assert.throws(() => inspectLibraryBytes(SQL, db.export()), pattern);
    } finally {
      db.close();
    }
  }
  rejects('PRAGMA application_id=1234', /SlotForge/);
  rejects('PRAGMA user_version=6', /SlotForge/);
  rejects('PRAGMA user_version=4', /SlotForge/);
  rejects('PRAGMA user_version=1', /SlotForge/);
  rejects("UPDATE collections SET rules='{}'", /Road width/);
  rejects('CREATE VIEW extra AS SELECT 1', /SlotForge/);
  rejects(
    'CREATE TRIGGER added AFTER UPDATE ON collections BEGIN SELECT 1; END',
    /SlotForge/,
  );
  rejects("UPDATE pieces SET collection_id='unknown'", /SlotForge/);
  rejects(
    'UPDATE collections SET profile=\'{"unexpected": 1}\'',
    /profile|setting|field|shared/i,
  );
  rejects("UPDATE pieces SET track='{}'", /./);
});

test('editing the design rules uses optimistic revisions and round-trips without altering existing recipes', (t) => {
  const db = dbFor(t);
  const initial = {
    ...defaultPackRules(),
    width: 180,
    laneSpacing: 90,
    angle: 60,
  };
  const piece = { name: 'Test', track: newProject().track };
  const id = addCollection(db, 'GT', {}, [piece], initial);
  const snapshot = readCollections(db)[0];
  const updated = {
    ...initial,
    width: 220,
    laneSpacing: 100,
    angle: 30,
    r1InnerRadius: 250,
  };
  setCollectionRules(db, id, updated, { expectedRevision: 1 });
  assert.throws(
    () => setCollectionRules(db, id, initial, { expectedRevision: 1 }),
    /another window/,
  );
  assert.throws(
    () => setCollectionRules(db, id, { ...updated, width: 120, lanes: 4 }),
    /more room/,
  );
  const stored = inspectLibraryBytes(SQL, db.export())[0];
  assert.equal(stored.revision, 2);
  assert.deepEqual(stored.rules, updated);
  assert.deepEqual(stored.pieces, snapshot.pieces);
  assert.deepEqual(stored.profile, snapshot.profile);
  const restored = dbFor(t);
  replaceLibrary(restored, [stored]);
  assert.deepEqual(readCollections(restored), [stored]);
});

const layoutData = (name = 'Club night oval') => ({
  format: 'slotforge-layout',
  version: 1,
  name,
  sources: { s1: { name: 'R2 bend', track: { params: { kind: 'curve' } } } },
  nodes: [{ id: 'n1', source: 's1', index: 0, pose: { x: 0, y: 0, a: 0, flip: false }, h: [0, 0], supports: 0 }],
});
const editorProject = (name = 'Enclosure') => ({ ...newProject(), name, mode: 'editor' });

test('layouts and STL parts are kept in the library with their links', (t) => {
  const db = dbFor(t, true);
  const [pack] = readCollections(db);
  const layoutId = saveLayout(db, { name: 'Club night oval', collectionId: pack.id, data: layoutData() });
  assert.deepEqual(readLayouts(db).map((l) => [l.name, l.collectionId]), [['Club night oval', pack.id]]);
  assert.equal(readLayout(db, layoutId).data.nodes.length, 1);
  saveLayout(db, { id: layoutId, name: 'Renamed oval', collectionId: pack.id, data: layoutData('Renamed oval') });
  assert.equal(readLayouts(db).length, 1);
  assert.equal(readLayout(db, layoutId).name, 'Renamed oval');

  const original = saveStlPart(db, { name: 'Enclosure', project: editorProject() });
  const piece = pack.pieces[0];
  const edited = saveStlPart(db, {
    name: 'Enclosure, shorter posts',
    basedOn: original,
    source: { collectionId: pack.id, pieceId: piece.id, part: 'road-1', revision: pack.revision, label: 'R2 bend · Road 1' },
    project: editorProject('Shorter'),
  });
  const listed = readStlParts(db);
  assert.equal(listed.length, 2);
  const link = listed.find((p) => p.id === edited);
  assert.equal(link.basedOn, original);
  assert.equal(link.source.pieceId, piece.id);
  assert.equal(readStlPart(db, edited).project.mode, 'editor');
  assert.throws(() => saveStlPart(db, { name: 'Track', project: newProject() }), /STL Edit/);
  assert.throws(() => saveStlPart(db, { id: original, name: 'Loop', basedOn: original, project: editorProject() }), /itself/);
  renameStlPart(db, edited, 'Short posts');
  assert.equal(readStlPart(db, edited).name, 'Short posts');
  deleteStlPart(db, original);
  assert.equal(readStlPart(db, edited).basedOn, null, 'a deleted original only drops the link');
  deleteLayout(db, layoutId);
  assert.equal(readLayouts(db).length, 0);
});

test('packs and pieces can be renamed, duplicated and deleted', (t) => {
  const db = dbFor(t, true);
  const [pack] = readCollections(db);
  renameCollection(db, pack.id, 'Club pack');
  const copyId = duplicateCollection(db, pack.id);
  const copy = readCollections(db).find((c) => c.id === copyId);
  assert.equal(copy.name, 'Club pack (copy)');
  assert.equal(copy.pieces.length, pack.pieces.length);
  assert.notEqual(copy.pieces[0].id, pack.pieces[0].id);
  const piece = copy.pieces[0];
  renamePiece(db, piece.id, 'Long straight');
  const twin = duplicatePiece(db, piece.id);
  let after = readCollections(db).find((c) => c.id === copyId);
  assert.ok(after.pieces.some((p) => p.id === twin && p.name === 'Long straight (copy)'));
  assert.ok(after.revision > copy.revision);
  deletePiece(db, twin);
  after = readCollections(db).find((c) => c.id === copyId);
  assert.equal(after.pieces.length, pack.pieces.length);
  saveLayout(db, { name: 'Uses the copy', collectionId: copyId, data: layoutData() });
  deleteCollection(db, copyId);
  assert.equal(readCollections(db).some((c) => c.id === copyId), false);
  assert.equal(readLayouts(db)[0].collectionId, copyId, 'a layout outlives its pack');
});

test('a full backup restores layouts and STL parts; an older backup leaves them in place', (t) => {
  const db = dbFor(t, true);
  const [pack] = readCollections(db);
  saveLayout(db, { name: 'Oval', collectionId: pack.id, data: layoutData() });
  saveStlPart(db, { name: 'Enclosure', project: editorProject() });
  const backup = inspectLibraryBytes(SQL, db.export());
  assert.equal(backup.layouts.length, 1);
  assert.equal(backup.stlParts.length, 1);
  const fresh = dbFor(t);
  replaceLibrary(fresh, backup);
  assert.equal(readLayouts(fresh).length, 1);
  assert.equal(readStlParts(fresh).length, 1);

  const older = dbFor(t, true);
  asVersion(older, 4);
  const oldBackup = inspectLibraryBytes(SQL, older.export());
  assert.equal(oldBackup.layouts, undefined);
  replaceLibrary(fresh, oldBackup);
  assert.equal(readLayouts(fresh).length, 1, 'layouts on this device survive');
  assert.equal(readStlParts(fresh).length, 1);
});

test('Apply to collection updates the shared settings and every piece, or nothing', (t) => {
  const db = dbFor(t, true);
  const [pack] = readCollections(db);
  const result = applyToCollection(
    db,
    pack.id,
    { profile: { ...pack.profile, slotWidth: 3.2 }, values: { width: 210, laneSpacing: 105 } },
    { expectedRevision: pack.revision },
  );
  assert.equal(result.pieces, pack.pieces.length);
  const after = readCollections(db).find((c) => c.id === pack.id);
  assert.equal(after.revision, pack.revision + 1);
  assert.equal(after.profile.slotWidth, 3.2);
  assert.equal(after.rules.width, 210);
  assert.ok(after.pieces.every((p) => p.track.params.width === 210 && p.track.params.laneSpacing === 105));
  // A stale window cannot overwrite a newer pack.
  assert.throws(
    () => applyToCollection(db, pack.id, { values: { width: 220 } }, { expectedRevision: pack.revision }),
    /another window/,
  );
  // A rule no piece can carry changes nothing.
  assert.throws(() =>
    applyToCollection(db, pack.id, { values: { width: 50 } }, { expectedRevision: after.revision }),
  );
  const unchanged = readCollections(db).find((c) => c.id === pack.id);
  assert.equal(unchanged.revision, after.revision);
  assert.ok(unchanged.pieces.every((p) => p.track.params.width === 210));
});

test('an off-centre slot survives saving, copying and a backup, and keeps its edge distance when the pack changes width', (t) => {
  const db = dbFor(t, true);
  const pack = readCollections(db).find((c) => c.rules.lanes === 1);
  const straight = pack.pieces.find((p) => p.name === 'Full straight').track;
  const corner = pack.pieces.find((p) => p.track.params.kind === 'curve').track;
  const withSlot = (track, slotPosition) => ({
    ...track,
    params: { ...track.params, slotPosition },
  });
  const moving = { version: 1, edge: 'outer', startMm: 20, endMm: 60 };
  const constant = { version: 1, edge: 'inner', startMm: 20, endMm: 20 };
  const s = saveRecipe(db, pack.id, { name: 'Lane change', track: withSlot(straight, moving) });
  const c = saveRecipe(db, pack.id, { name: 'Inside corner', track: withSlot(corner, constant) });
  const slots = (collection) =>
    Object.fromEntries(
      collection.pieces
        .filter((p) => p.track.params.slotPosition)
        .map((p) => [p.name, p.track.params.slotPosition]),
    );
  const stored = () => readCollections(db).find((row) => row.id === pack.id);
  assert.deepEqual(slots(stored()), { 'Lane change': moving, 'Inside corner': constant });
  // Every other piece of the pack stays centred: no key at all.
  assert.equal(stored().pieces.filter((p) => 'slotPosition' in p.track.params).length, 2);

  duplicatePiece(db, s);
  assert.deepEqual(slots(stored())['Lane change (copy)'], moving);
  const twinId = duplicateCollection(db, pack.id);
  const twin = readCollections(db).find((row) => row.id === twinId);
  assert.deepEqual(slots(twin)['Inside corner'], constant);
  const copy = dbFor(t);
  replaceLibrary(copy, inspectLibraryBytes(SQL, db.export()));
  const restored = readCollections(copy).find((row) => row.id === pack.id);
  assert.deepEqual(slots(restored), slots(stored()));
  assert.deepEqual(
    trackWithProfile(restored.pieces.find((p) => p.id === c).track, restored.profile).params.slotPosition,
    constant,
  );

  // A wider road: 20 mm from the edge is still 20 mm from the edge.
  let now = stored();
  applyToCollection(db, pack.id, { values: { width: 120 } }, { expectedRevision: now.revision });
  now = stored();
  assert.ok(now.pieces.every((p) => p.track.params.width === 120));
  assert.deepEqual(slots(now)['Lane change'], moving);
  assert.deepEqual(slots(now)['Inside corner'], constant);
  // A road too narrow for a typed distance names the piece and changes nothing.
  deletePiece(db, now.pieces.find((p) => p.name === 'Starting grid').id);
  now = stored();
  assert.throws(
    () => applyToCollection(db, pack.id, { values: { width: 62 } }, { expectedRevision: now.revision }),
    /Lane change.*at end B is 60 mm from the left edge/,
  );
  assert.ok(stored().pieces.every((p) => p.track.params.width === 120));
  assert.equal(stored().revision, now.revision);
});

test('a lane list survives saving, copying and a backup, and a profile-only change leaves it alone', (t) => {
  const db = dbFor(t);
  const id = addCollection(db, 'Two lanes', {}, [], { ...defaultPackRules(), width: 200, lanes: 2, laneSpacing: 65 });
  const list = { version: 1, edge: 'outer', lanes: [{ startMm: 35, endMm: 95 }, { startMm: 105, endMm: 165 }] };
  const track = newProject().track;
  Object.assign(track.params, {
    kind: 'straight', length: 300, width: 200, lanes: 2, laneSpacing: 65, borderSide: 'none', slotPosition: list,
  });
  const pieceId = saveRecipe(db, id, { name: 'Lane change', track });
  duplicatePiece(db, pieceId);
  const copy = dbFor(t);
  replaceLibrary(copy, inspectLibraryBytes(SQL, db.export()));
  for (const store of [db, copy])
    assert.deepEqual(readCollections(store)[0].pieces.map((p) => p.track.params.slotPosition), [list, list]);
  const result = applyToCollection(db, id, { values: {} }, { expectedRevision: readCollections(db)[0].revision });
  assert.equal(result.centred, 0);
  assert.deepEqual(readCollections(db)[0].pieces[0].track.params.slotPosition, list);
});

// Phase 2 changed this rule: a second lane used to centre every piece.
test('a new lane count keeps lanes that move together and centres lanes set one by one', (t) => {
  const db = dbFor(t);
  const rules = { ...defaultPackRules(), width: 160, lanes: 1 };
  const id = addCollection(db, 'One lane', {}, [], rules);
  const piece = (name, params) => {
    const track = newProject().track;
    Object.assign(track.params, {
      kind: 'straight', length: 300, width: 160, lanes: 1, laneSpacing: 80, borderSide: 'none', ...params,
    });
    return saveRecipe(db, id, { name, track });
  };
  const left = { version: 1, edge: 'outer', startMm: 40, endMm: 40 };
  piece('Left slot', { slotPosition: left });
  const revision = () => readCollections(db)[0].revision;
  const slots = () =>
    Object.fromEntries(readCollections(db)[0].pieces.map((p) => [p.name, p.track.params.slotPosition]));
  const apply = (values) => applyToCollection(db, id, { values }, { expectedRevision: revision() });
  // Spacing alone is not a lane count: the slot stays.
  apply({ laneSpacing: 70 });
  assert.deepEqual(slots()['Left slot'], left);
  // A second lane follows slot 1, 70 mm further from the left edge.
  let result = apply({ lanes: 2 });
  assert.equal(result.centred, 0);
  assert.equal(readCollections(db)[0].pieces[0].track.params.lanes, 2);
  assert.deepEqual(slots()['Left slot'], left);

  const lanes = (...mms) => ({ version: 1, edge: 'inner', lanes: mms.map((mm) => ({ startMm: mm, endMm: mm })) });
  piece('Set lanes', { lanes: 2, laneSpacing: 70, slotPosition: lanes(30, 120) });
  piece('Even lanes', { lanes: 2, laneSpacing: 70, slotPosition: lanes(30, 90) });
  // A new spacing moves the slots that follow slot 1, leaves a list alone,
  // and a list that now matches the spacing is stored as lanes moving together.
  result = apply({ laneSpacing: 60 });
  assert.equal(result.centred, 0);
  assert.deepEqual(slots()['Left slot'], left);
  assert.deepEqual(slots()['Set lanes'], lanes(30, 120));
  assert.deepEqual(slots()['Even lanes'], { version: 1, edge: 'inner', startMm: 30, endMm: 30 });

  // A third lane at 160 mm from the left edge is off this 160 mm road: the
  // whole change is refused, naming the piece.
  const before = revision();
  assert.throws(() => apply({ lanes: 3 }), /Left slot.*Slot 3 is 160 mm from the left edge/);
  assert.equal(revision(), before);
  assert.deepEqual(slots()['Set lanes'], lanes(30, 120));
  // On a wider road it fits; the list made for two lanes is centred.
  result = apply({ width: 220, lanes: 3 });
  assert.equal(result.centred, 1);
  assert.deepEqual(slots()['Left slot'], left);
  assert.deepEqual(slots()['Even lanes'], { version: 1, edge: 'inner', startMm: 30, endMm: 30 });
  assert.equal(slots()['Set lanes'], undefined);
  assert.equal('slotPosition' in readCollections(db)[0].pieces.find((p) => p.name === 'Set lanes').track.params, false);
  // Back to one lane: slot 1 keeps its distance.
  result = apply({ lanes: 1 });
  assert.equal(result.centred, 0);
  assert.deepEqual(slots()['Left slot'], left);
});

test('the open piece is checked as edited, so a narrower road and a moved slot apply together', (t) => {
  const db = dbFor(t);
  const rules = { ...defaultPackRules(), width: 200, lanes: 1 };
  const id = addCollection(db, 'One lane', {}, [], rules);
  const track = newProject().track;
  Object.assign(track.params, {
    kind: 'straight', length: 300, width: 200, lanes: 1, laneSpacing: 100, borderSide: 'none',
    slotPosition: { version: 1, edge: 'outer', startMm: 150, endMm: 150 },
  });
  const pieceId = saveRecipe(db, id, { name: 'Right slot', track });
  const edited = structuredClone(track);
  Object.assign(edited.params, {
    width: 100,
    slotPosition: { version: 1, edge: 'outer', startMm: 40, endMm: 40 },
  });
  const revision = readCollections(db)[0].revision;
  // As stored, 150 mm does not fit a 100 mm road.
  assert.throws(
    () => applyToCollection(db, id, { values: { width: 100 } }, { expectedRevision: revision }),
    /150 mm from the left edge/,
  );
  const result = applyToCollection(
    db, id,
    { values: { width: 100 }, piece: { id: pieceId, track: edited } },
    { expectedRevision: revision },
  );
  assert.equal(result.centred, 0);
  const [after] = readCollections(db);
  assert.equal(after.pieces[0].track.params.width, 100);
  assert.deepEqual(after.pieces[0].track.params.slotPosition, edited.params.slotPosition);
  // The edited track was copied, not kept.
  edited.params.slotPosition.startMm = 45;
  assert.equal(readCollections(db)[0].pieces[0].track.params.slotPosition.startMm, 40);
});

test('a pack width that puts a typed slot on the road centre stores a centred piece', (t) => {
  const db = dbFor(t);
  const rules = { ...defaultPackRules(), width: 160, lanes: 1 };
  const id = addCollection(db, 'One lane', {}, [], rules);
  const piece = (name, startMm, endMm) => {
    const track = newProject().track;
    Object.assign(track.params, {
      kind: 'straight', length: 300, width: 160, lanes: 1, laneSpacing: 80, borderSide: 'none',
      slotPosition: { version: 1, edge: 'outer', startMm, endMm },
    });
    saveRecipe(db, id, { name, track });
  };
  piece('Left slot', 40, 40);
  piece('Lane change', 40, 60);
  applyToCollection(db, id, { values: { width: 80 } }, { expectedRevision: readCollections(db)[0].revision });
  const slots = Object.fromEntries(
    readCollections(db)[0].pieces.map((p) => [p.name, p.track.params.slotPosition]),
  );
  assert.equal(slots['Left slot'], undefined);
  assert.deepEqual(slots['Lane change'], { version: 1, edge: 'outer', startMm: 40, endMm: 60 });
});

test('the pack rules box counts exactly the pieces Apply to collection centres', (t) => {
  const db = dbFor(t);
  const id = addCollection(db, 'Two', {}, [], { ...defaultPackRules(), width: 200, lanes: 2, laneSpacing: 70 });
  const piece = (name, slotPosition) => {
    const track = newProject().track;
    Object.assign(track.params, {
      kind: 'straight', length: 300, width: 200, lanes: 2, laneSpacing: 70, borderSide: 'none', slotPosition,
    });
    saveRecipe(db, id, { name, track });
  };
  // Lanes moving together 30 mm from the left: with three lanes at 70 mm
  // they are where a centred piece has them (30/100/170).
  piece('Left pair', { version: 1, edge: 'outer', startMm: 30, endMm: 30 });
  piece('Set lanes', { version: 1, edge: 'outer', lanes: [{ startMm: 30, endMm: 30 }, { startMm: 120, endMm: 120 }] });
  piece('Right pair', { version: 1, edge: 'inner', startMm: 20, endMm: 20 });
  const pack = () => readCollections(db)[0];
  const box = (values) => packRuleSlotChanges(pack().pieces.map((p) => p.track.params), values);
  const values = { width: 200, lanes: 3, laneSpacing: 70 };
  assert.deepEqual(box(values), { lanes: 1, centre: 1, together: 0 });
  // The box's own test, piece by piece.
  assert.deepEqual(
    pack().pieces.map((p) => paramsUnderPackRules(p.track.params, values).change),
    ['centre', 'lanes', null],
  );
  const result = applyToCollection(db, id, { values }, { expectedRevision: pack().revision });
  assert.equal(result.centred, 2);
  assert.equal(result.together, 0);
  const slots = Object.fromEntries(pack().pieces.map((p) => [p.name, p.track.params.slotPosition]));
  assert.equal(slots['Left pair'], undefined);
  assert.equal(slots['Set lanes'], undefined);
  assert.deepEqual(slots['Right pair'], { version: 1, edge: 'inner', startMm: 20, endMm: 20 });
  // Unchanged rules change nothing.
  assert.deepEqual(box(values), { lanes: 0, centre: 0, together: 0 });
});

test('a lane-by-lane list the new spacing matches becomes lanes moving together, and the notice counts it', (t) => {
  const db = dbFor(t);
  const id = addCollection(db, 'Two', {}, [], { ...defaultPackRules(), width: 200, lanes: 2, laneSpacing: 70 });
  const track = newProject().track;
  Object.assign(track.params, {
    kind: 'straight', length: 300, width: 200, lanes: 2, laneSpacing: 70, borderSide: 'none',
    slotPosition: { version: 1, edge: 'outer', lanes: [{ startMm: 30, endMm: 30 }, { startMm: 90, endMm: 90 }] },
  });
  saveRecipe(db, id, { name: 'Each', track });
  const pack = () => readCollections(db)[0];
  const slot = () => pack().pieces[0].track.params.slotPosition;
  assert.deepEqual(packRuleSlotChanges(pack().pieces.map((p) => p.track.params), { laneSpacing: 60 }), {
    lanes: 0, centre: 0, together: 1,
  });
  let result = applyToCollection(db, id, { values: { laneSpacing: 60 } }, { expectedRevision: pack().revision });
  assert.equal(result.together, 1);
  assert.equal(result.centred, 0);
  assert.deepEqual(slot(), { version: 1, edge: 'outer', startMm: 30, endMm: 30 });
  // As lanes moving together, a later spacing moves slot 2.
  result = applyToCollection(db, id, { values: { laneSpacing: 75 } }, { expectedRevision: pack().revision });
  assert.equal(result.together, 0);
  assert.deepEqual(slot(), { version: 1, edge: 'outer', startMm: 30, endMm: 30 });
});

test('a restored pack gets a revision no window can still hold, even after it was deleted', () => {
  const db = newLibraryDatabase(SQL, true);
  const [pack] = readCollections(db);
  const backup = inspectLibraryBytes(SQL, db.export());
  deleteCollection(db, pack.id);
  replaceLibrary(db, backup, undefined, { restore: true });
  const restored = readCollections(db).find((c) => c.id === pack.id);
  assert.ok(restored.revision > pack.revision);
  // A window still holding the backup's revision is refused.
  assert.throws(
    () => saveRecipe(db, pack.id, { ...pack.pieces[0] }, { expectedRevision: pack.revision }),
    /changed/,
  );
});

test('resetting a pack makes every cut piece whole again, in one revision', async (t) => {
  const { resetCollectionSegments } = await import('../src/library-database.js');
  const db = dbFor(t);
  const pack = starterPack();
  // A pack as made before every piece started whole: its corners pre-cut.
  const cuts = [1, 1, 1, 1, 2, 4, 5, 6, 7, 9];
  const pieces = pack.pieces.map((piece, i) => {
    const copy = structuredClone(piece);
    copy.track.params.segments = cuts[i];
    if (i === 9) copy.track.params.borderSegments = 3;
    return copy;
  });
  const id = addCollection(db, 'Old Basic', pack.profile, pieces, pack.rules);
  const before = readCollections(db).find((c) => c.id === id);
  assert.deepEqual(before.pieces.map((p) => p.track.params.segments), cuts);
  const result = resetCollectionSegments(db, id, { expectedRevision: before.revision });
  assert.deepEqual(result, { changed: 6, revision: before.revision + 1 });
  const after = readCollections(db).find((c) => c.id === id);
  assert.equal(after.revision, before.revision + 1);
  for (const piece of after.pieces) {
    assert.equal(piece.track.params.segments, 1, piece.name);
    assert.equal(piece.track.params.borderSegments, 1, piece.name);
  }
  // Nothing else of a piece changes.
  assert.deepEqual(
    after.pieces.map((p) => ({ ...p.track.params, segments: 0, borderSegments: 0 })),
    before.pieces.map((p) => ({ ...p.track.params, segments: 0, borderSegments: 0 })),
  );
  // A pack that is already whole stays at its revision.
  assert.deepEqual(resetCollectionSegments(db, id), { changed: 0, revision: after.revision });
  assert.equal(readCollections(db).find((c) => c.id === id).revision, after.revision);
  // A window that still holds the older revision is refused.
  assert.throws(() => resetCollectionSegments(db, id, { expectedRevision: before.revision }));
});
