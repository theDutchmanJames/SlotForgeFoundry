import {
  starterPack,
  trackWithProfile,
  validateLibraryProfile,
} from './library-profile.js';
import { currentJointSettings } from './geometry/joint-fit.js';
import { rulesFromPieces, validatePackRules } from './track-pack-rules.js';
import { defaultStartingGrid } from './geometry/starting-grid.js';
import { validateLayout } from './planner-model.js';
import { checkProject } from './project.js';

const applicationId = 0x53464c42; // SFLB
export const LIBRARY_VERSION = 5;
export const MAX_LIBRARY_BYTES = 128 * 1024 * 1024;
const legacyTables = {
  collections:
    'CREATE TABLE collections (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, profile TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1))',
  pieces:
    'CREATE TABLE pieces (id TEXT PRIMARY KEY NOT NULL, collection_id TEXT NOT NULL REFERENCES collections(id), name TEXT NOT NULL, track TEXT NOT NULL)',
};
const packTables = {
  ...legacyTables,
  collections:
    'CREATE TABLE collections (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, profile TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1), rules TEXT NOT NULL)',
};
// Version 5 adds the other two shelves of the Library. A layout keeps the
// pack it was planned with (it may outlive that pack: no foreign key), and an
// STL part may be based on another STL part or on a piece of a pack.
const tables = {
  ...packTables,
  layouts:
    'CREATE TABLE layouts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, collection_id TEXT, data TEXT NOT NULL, updated INTEGER NOT NULL)',
  stl_parts:
    'CREATE TABLE stl_parts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, based_on TEXT, source TEXT, project TEXT NOT NULL, updated INTEGER NOT NULL)',
};
const tablesFor = (version) =>
  version === 1 ? legacyTables : version < 5 ? packTables : tables;
const invalidFile = () =>
  Error('Choose a SlotForge track library (.sqlite) exported from Foundry.');

function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const result = [];
    while (stmt.step()) result.push(stmt.getAsObject());
    return result;
  } finally {
    stmt.free();
  }
}
function nameOf(value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 2048
  ) {
    throw Error('Enter a name between 1 and 2,048 characters.');
  }
  return value.trim();
}
function checkedId(value) {
  if (typeof value !== 'string' || !/^[\w.-]{1,128}$/.test(value))
    throw invalidFile();
  return value;
}
function checkedRevision(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value === Number.MAX_SAFE_INTEGER
  )
    throw invalidFile();
  return value;
}
function collectionRow(db, id, expectedRevision) {
  const [row] = rows(
    db,
    'SELECT revision, profile, rules FROM collections WHERE id=?',
    [checkedId(id)],
  );
  if (!row)
    throw Error('This collection no longer exists. Reopen the library.');
  if (expectedRevision !== undefined && expectedRevision !== row.revision) {
    throw Error(
      'This collection changed in another window. Reopen it to use its latest settings.',
    );
  }
  return row;
}
function validateRecipe(piece, profile) {
  try {
    trackWithProfile(piece.track, profile);
  } catch (err) {
    throw Error(nameOf(piece.name) + ': ' + err.message);
  }
}
function savedTrack(track) {
  return JSON.stringify({
    ...track,
    params: currentJointSettings(track.params),
  });
}
function insertPiece(db, collectionId, piece, profile, id) {
  const name = nameOf(piece.name);
  validateRecipe(piece, profile);
  db.run(
    'INSERT INTO pieces(id, collection_id, name, track) VALUES (?,?,?,?)',
    [id, collectionId, name, savedTrack(piece.track)],
  );
}

export function readCollections(db, version = LIBRARY_VERSION) {
  const collections = rows(
    db,
    'SELECT id, name, profile, revision' +
      (version === 1 ? '' : ', rules') +
      ' FROM collections ORDER BY rowid',
  ).map((row) => ({
    ...row,
    profile: validateLibraryProfile(JSON.parse(row.profile)),
    rules: version === 1 ? null : validatePackRules(JSON.parse(row.rules)),
    pieces: [],
  }));
  const byId = new Map(collections.map((c) => [c.id, c]));
  for (const row of rows(
    db,
    'SELECT id, collection_id, name, track FROM pieces ORDER BY rowid',
  )) {
    const owner = byId.get(row.collection_id);
    if (!owner) throw invalidFile();
    const track = JSON.parse(row.track);
    if (track?.params) track.params = currentJointSettings(track.params);
    owner.pieces.push({
      id: row.id,
      name: row.name,
      track,
    });
  }
  if (version === 1)
    for (const collection of collections)
      collection.rules = rulesFromPieces(collection.pieces, collection.name);
  return collections;
}
function insertCollection(db, { id, name, profile, pieces, revision, rules }) {
  profile = validateLibraryProfile(profile);
  rules = validatePackRules(rules ?? rulesFromPieces(pieces));
  db.run(
    'INSERT INTO collections(id, name, profile, revision, rules) VALUES (?,?,?,?,?)',
    [
      id,
      nameOf(name),
      JSON.stringify(profile),
      checkedRevision(revision),
      JSON.stringify(rules),
    ],
  );
  for (const p of pieces) insertPiece(db, id, p, profile, checkedId(p.id));
}
function newCollection(name, profile, pieces, rules) {
  return {
    id: crypto.randomUUID(),
    name,
    profile,
    rules:
      rules === undefined
        ? rulesFromPieces(pieces)
        : validatePackRules(rules, profile),
    revision: 1,
    pieces: pieces.map((piece) => ({ ...piece, id: crypto.randomUUID() })),
  };
}
export function addCollection(db, name, profile = {}, pieces = [], rules) {
  const collection = newCollection(name, profile, pieces, rules);
  insertCollection(db, collection);
  return collection.id;
}
function singleLanePreset(existing) {
  const pack = starterPack(1);
  // A user may already have chosen the shipped name for their own pack.
  let name = pack.name;
  for (let i = 1; existing.some(c => c.name === name); i++)
    name = pack.name + (i === 1 ? ' (preset)' : ' (preset ' + i + ')');
  return newCollection(name, pack.profile, pack.pieces, pack.rules);
}

function addMissingStarterGrid(collections, lanes) {
  const pack = starterPack(lanes);
  // Old seeds have random IDs. Recognize the stock road family as well as
  // its name so a same-named custom collection keeps its own members.
  const stockCurves = pack.pieces.filter(piece => piece.track.params.kind === 'curve');
  const stockRadii = new Map(stockCurves.map(piece => [piece.name, piece.track.params.radius]));
  const isStockCurve = ({ name, track: { params } }) =>
    params.kind === 'curve' && params.lanes === lanes && params.width === pack.rules.width &&
    (params.curveGridRadius === stockCurves[0].track.params.curveGridRadius || params.radius === stockRadii.get(name));
  const candidates = collections.filter(c => c.pieces.some(isStockCurve));
  // The single-lane seed was given a suffix if the name already existed.
  const preset = lanes === 1 && candidates.find(c => /^SlotForge Basic Single Lane \(preset(?: \d+)?\)$/.test(c.name));
  const collection = preset || candidates.find(c => c.name === pack.name);
  if (!collection || collection.pieces.some(piece => piece.track.params.startingGrid)) return;
  const grid = pack.pieces.find(piece => piece.track.params.startingGrid);
  grid.track.params.startingGrid = defaultStartingGrid({ ...grid.track.params, ...collection.profile });
  try {
    trackWithProfile(grid.track, collection.profile);
  } catch {
    // Existing recipes were checked before migration. A custom profile
    // may leave no room for the new marks or their stock connectors.
    return;
  }
  const defaultName = grid.name;
  for (let i = 1; collection.pieces.some(piece => piece.name === grid.name); i++)
    grid.name = defaultName + (i === 1 ? ' (preset)' : ' (preset ' + i + ')');
  const firstCurve = collection.pieces.findIndex(piece => piece.track.params.kind === 'curve');
  collection.pieces.splice(firstCurve, 0, { ...grid, id: crypto.randomUUID() });
  collection.revision = checkedRevision(collection.revision + 1);
}
export function newLibraryDatabase(SQL, seed) {
  const db = new SQL.Database();
  try {
    db.run(
      `PRAGMA application_id=${applicationId}; PRAGMA user_version=${LIBRARY_VERSION}; PRAGMA foreign_keys=ON;`,
    );
    for (const sql of Object.values(tables)) db.run(sql);
    if (seed) {
      const pack = starterPack();
      addCollection(db, pack.name, pack.profile, pack.pieces, pack.rules);
      insertCollection(db, singleLanePreset([]));
    }
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

export function saveRecipe(
  db,
  collectionId,
  piece,
  { profile, expectedRevision } = {},
) {
  const row = collectionRow(db, collectionId, expectedRevision);
  const chosenProfile = validateLibraryProfile(
    profile === undefined ? JSON.parse(row.profile) : profile,
  );
  const id = piece.id === undefined ? crypto.randomUUID() : checkedId(piece.id);
  if (profile !== undefined) {
    validateMembers(db, collectionId, chosenProfile, id);
    validatePackRules(JSON.parse(row.rules), chosenProfile);
  }
  if (piece.id === undefined) {
    insertPiece(db, collectionId, piece, chosenProfile, id);
  } else {
    validateRecipe(piece, chosenProfile);
    db.run('UPDATE pieces SET name=?, track=? WHERE id=? AND collection_id=?', [
      nameOf(piece.name),
      savedTrack(piece.track),
      id,
      collectionId,
    ]);
    if (db.getRowsModified() !== 1)
      throw Error('This piece no longer belongs to this collection.');
  }
  updateRevision(db, collectionId, chosenProfile, row.revision);
  return id;
}
function validateMembers(db, id, profile, exceptId = '') {
  const members = rows(
    db,
    'SELECT name, track FROM pieces WHERE collection_id=? AND id<>?',
    [id, exceptId],
  );
  for (const row of members)
    validateRecipe({ name: row.name, track: JSON.parse(row.track) }, profile);
}
function updateRevision(db, id, profile, previous) {
  db.run('UPDATE collections SET profile=?, revision=? WHERE id=?', [
    JSON.stringify(profile),
    checkedRevision(previous + 1),
    id,
  ]);
}
export function setCollectionProfile(
  db,
  id,
  profile,
  { expectedRevision } = {},
) {
  const row = collectionRow(db, id, expectedRevision);
  profile = validateLibraryProfile(profile);
  validateMembers(db, id, profile);
  validatePackRules(JSON.parse(row.rules), profile);
  updateRevision(db, id, profile, row.revision);
}

export function setCollectionRules(db, id, rules, { expectedRevision } = {}) {
  const row = collectionRow(db, id, expectedRevision);
  const checked = validatePackRules(
    rules,
    validateLibraryProfile(JSON.parse(row.profile)),
  );
  db.run('UPDATE collections SET rules=?, revision=? WHERE id=?', [
    JSON.stringify(checked),
    checkedRevision(row.revision + 1),
    id,
  ]);
}

// Only data from the two known ordinary tables may reach the local library.
// Opening a backup never installs its schema, indexes, triggers or views.
export function inspectLibraryBytes(SQL, bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > MAX_LIBRARY_BYTES ||
    new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0'
  )
    throw invalidFile();
  const db = new SQL.Database(bytes);
  try {
    db.run('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
    const [app] = rows(db, 'PRAGMA application_id');
    const [version] = rows(db, 'PRAGMA user_version');
    if (
      app.application_id !== applicationId ||
      !(Number.isInteger(version.user_version) && version.user_version >= 1 && version.user_version <= LIBRARY_VERSION)
    )
      throw invalidFile();
    const expectedTables = tablesFor(version.user_version);
    const schema = rows(
      db,
      'SELECT name, type, tbl_name, sql FROM sqlite_schema',
    );
    const definitions = schema.filter((s) => s.type === 'table');
    if (
      definitions.length !== Object.keys(expectedTables).length ||
      !definitions.every(
        (s) =>
          Object.hasOwn(expectedTables, s.name) &&
          expectedTables[s.name] === s.sql,
      ) ||
      !schema.every(
        (s) =>
          s.type === 'table' ||
          (s.type === 'index' &&
            Object.hasOwn(tables, s.tbl_name) &&
            s.sql === null &&
            s.name === 'sqlite_autoindex_' + s.tbl_name + '_1'),
      )
    )
      throw invalidFile();
    if (
      rows(db, 'PRAGMA quick_check(1)')[0]?.quick_check !== 'ok' ||
      rows(db, 'PRAGMA foreign_key_check').length
    )
      throw invalidFile();
    const collections = readCollections(db, version.user_version);
    for (const c of collections) {
      checkedId(c.id);
      nameOf(c.name);
      checkedRevision(c.revision);
      validateLibraryProfile(c.profile);
      for (const p of c.pieces) {
        checkedId(p.id);
        nameOf(p.name);
        validateRecipe(p, c.profile);
      }
    }
    if (version.user_version < LIBRARY_VERSION) {
      addMissingStarterGrid(collections, 2);
      if (version.user_version === 3) addMissingStarterGrid(collections, 1);
    }
    if (version.user_version < 3)
      collections.push(singleLanePreset(collections));
    // The other shelves ride along without changing the familiar array of
    // packs. A backup from before version 5 has none: restoring it keeps the
    // layouts and STL parts already on this device.
    if (version.user_version >= 5) {
      const layouts = readLayouts(db).map((l) => readLayout(db, l.id));
      const stlParts = readStlParts(db).map((p) => readStlPart(db, p.id));
      Object.defineProperty(collections, 'layouts', { value: layouts });
      Object.defineProperty(collections, 'stlParts', { value: stlParts });
    }
    return collections;
  } finally {
    db.close();
  }
}
export function replaceLibrary(db, collections, expectedCollections, { restore = false } = {}) {
  const old = new Map(
    rows(db, 'SELECT id, revision FROM collections').map((c) => [
      c.id,
      c.revision,
    ]),
  );
  if (
    expectedCollections &&
    (expectedCollections.length !== old.size ||
      expectedCollections.some((c) => old.get(c.id) !== c.revision))
  ) {
    throw Error(
      'The local library changed while this backup was open. Reopen the library and review the restore again.',
    );
  }
  db.run('DELETE FROM pieces; DELETE FROM collections');
  // Restored packs get a revision no window can still hold, including for a
  // pack deleted since: a window keeping the backup's revision of it must not
  // save over the restored pack. Saves count up by one from small numbers,
  // so the restore time in seconds stays above any revision reached that way.
  const floor = restore ? Math.floor(Date.now() / 1000) : 1;
  for (const c of collections) {
    const revision = Math.max(
      c.revision,
      old.has(c.id) ? old.get(c.id) + 1 : 1,
      floor,
    );
    insertCollection(db, { ...c, revision });
  }
  if (collections.layouts) {
    db.run('DELETE FROM layouts');
    for (const l of collections.layouts) saveLayout(db, l);
  }
  if (collections.stlParts) {
    db.run('DELETE FROM stl_parts');
    for (const p of collections.stlParts) saveStlPart(db, p);
  }
}

/* ---------- Apply to collection ---------- */

// Road width, lanes and lane spacing are pack rules too: Apply to
// collection writes them into every piece, as the shared profile overlays
// the rest. Each piece is checked first; one that no longer works stops the
// whole change, so a pack is never left half updated.
export const COLLECTION_RULE_FIELDS = Object.freeze(['width', 'lanes', 'laneSpacing']);
export function applyToCollection(
  db,
  id,
  { profile, values = {}, piece },
  { expectedRevision } = {},
) {
  const row = collectionRow(db, id, expectedRevision);
  const chosen = validateLibraryProfile(profile ?? JSON.parse(row.profile));
  const ruleValues = Object.fromEntries(
    COLLECTION_RULE_FIELDS.filter((k) => values[k] !== undefined).map((k) => [
      k,
      values[k],
    ]),
  );
  const members = rows(
    db,
    'SELECT id, name, track FROM pieces WHERE collection_id=?',
    [id],
  );
  // Pieces whose off-centre slot this change takes away, for the notice.
  let centred = 0;
  const updated = members.map((r) => {
    const stored = JSON.parse(r.track);
    const hadSlot = Boolean(stored.params.slotPosition);
    // The piece open in the editor is checked as edited, not as last saved:
    // its new values and the new rules arrive together.
    const track = piece && r.id === piece.id ? structuredClone(piece.track) : stored;
    // A single-lane piece of a two-lane pack (a pit lane, say) keeps its own
    // lane count; the road width and spacing still follow the pack.
    const own = { ...ruleValues };
    if (own.lanes !== undefined && track.params.special) delete own.lanes;
    track.params = { ...track.params, ...own };
    // An off-centre slot is a single-lane setting: with more lanes the piece
    // is centred again. A new road width keeps the typed edge distance.
    if (own.lanes !== undefined && own.lanes !== 1) delete track.params.slotPosition;
    // A distance that the new width puts on the road centre is a centred
    // slot, and a centred slot is never stored.
    const slot = track.params.slotPosition;
    if (slot && slot.startMm === slot.endMm && slot.startMm === track.params.width / 2)
      delete track.params.slotPosition;
    if (hadSlot && !track.params.slotPosition) centred++;
    validateRecipe({ name: r.name, track }, chosen);
    return [r.id, track];
  });
  const rules = validatePackRules(
    { ...JSON.parse(row.rules), ...ruleValues },
    chosen,
  );
  for (const [pieceId, track] of updated)
    db.run('UPDATE pieces SET track=? WHERE id=?', [savedTrack(track), pieceId]);
  const revision = checkedRevision(row.revision + 1);
  db.run('UPDATE collections SET profile=?, rules=?, revision=? WHERE id=?', [
    JSON.stringify(chosen),
    JSON.stringify(rules),
    revision,
    id,
  ]);
  return { revision, pieces: updated.length, centred };
}

/* ---------- Managing packs and pieces ---------- */

export function renameCollection(db, id, name) {
  const row = collectionRow(db, id);
  db.run('UPDATE collections SET name=?, revision=? WHERE id=?', [
    nameOf(name),
    checkedRevision(row.revision + 1),
    id,
  ]);
}
export function duplicateCollection(db, id, name) {
  const source = readCollections(db).find((c) => c.id === checkedId(id));
  if (!source) throw Error('This pack no longer exists. Reopen the library.');
  return addCollection(
    db,
    name ?? source.name + ' (copy)',
    source.profile,
    source.pieces.map(({ name, track }) => ({ name, track })),
    source.rules,
  );
}
// Layouts planned with a deleted pack keep their own copy of every piece.
export function deleteCollection(db, id) {
  collectionRow(db, id);
  db.run('DELETE FROM pieces WHERE collection_id=?', [id]);
  db.run('DELETE FROM collections WHERE id=?', [id]);
}
function pieceRow(db, id) {
  const [row] = rows(
    db,
    'SELECT id, collection_id, name, track FROM pieces WHERE id=?',
    [checkedId(id)],
  );
  if (!row) throw Error('This piece no longer exists. Reopen the library.');
  return row;
}
export function renamePiece(db, id, name) {
  const row = pieceRow(db, id);
  const owner = collectionRow(db, row.collection_id);
  db.run('UPDATE pieces SET name=? WHERE id=?', [nameOf(name), id]);
  db.run('UPDATE collections SET revision=? WHERE id=?', [
    checkedRevision(owner.revision + 1),
    row.collection_id,
  ]);
}
export function duplicatePiece(db, id, name) {
  const row = pieceRow(db, id);
  return saveRecipe(db, row.collection_id, {
    name: name ?? row.name + ' (copy)',
    track: JSON.parse(row.track),
  });
}
export function deletePiece(db, id) {
  const row = pieceRow(db, id);
  const owner = collectionRow(db, row.collection_id);
  db.run('DELETE FROM pieces WHERE id=?', [id]);
  db.run('UPDATE collections SET revision=? WHERE id=?', [
    checkedRevision(owner.revision + 1),
    row.collection_id,
  ]);
}

/* ---------- Layouts ---------- */

const MAX_ITEM_CHARS = 64 * 1024 * 1024;
function storedJson(value, what) {
  const text = JSON.stringify(value);
  if (text.length > MAX_ITEM_CHARS)
    throw Error('This ' + what + ' is too large to keep in the library.');
  return text;
}
function stamp(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : Date.now();
}
// Each layout also lists the pack pieces it uses (for "Used in").
export function readLayouts(db) {
  return rows(
    db,
    'SELECT id, name, collection_id, updated, data FROM layouts ORDER BY updated DESC, rowid',
  ).map((r) => {
    let pieceIds = [],
      sections = 0;
    try {
      const data = JSON.parse(r.data);
      pieceIds = [
        ...new Set(
          Object.values(data.sources ?? {})
            .map((s) => s.ref?.pieceId)
            .filter(Boolean),
        ),
      ];
      sections = data.nodes?.length ?? 0;
    } catch {
      /* A damaged record still lists; opening it reports the problem. */
    }
    return {
      id: r.id,
      name: r.name,
      collectionId: r.collection_id ?? null,
      updated: r.updated,
      size: r.data.length,
      pieceIds,
      sections,
    };
  });
}
export function readLayout(db, id) {
  const [row] = rows(
    db,
    'SELECT id, name, collection_id, data, updated FROM layouts WHERE id=?',
    [checkedId(id)],
  );
  if (!row) throw Error('This layout no longer exists. Reopen the library.');
  return {
    id: row.id,
    name: row.name,
    collectionId: row.collection_id ?? null,
    updated: row.updated,
    data: validateLayout(JSON.parse(row.data)),
  };
}
export function saveLayout(db, { id, name, collectionId = null, data, updated }) {
  const layoutId = id === undefined ? crypto.randomUUID() : checkedId(id);
  const text = storedJson(validateLayout(data), 'layout');
  const pack = collectionId === null ? null : checkedId(collectionId);
  db.run(
    'INSERT INTO layouts(id, name, collection_id, data, updated) VALUES (?,?,?,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET name=excluded.name, collection_id=excluded.collection_id, data=excluded.data, updated=excluded.updated',
    [layoutId, nameOf(name), pack, text, stamp(updated)],
  );
  return layoutId;
}
// Renames in place: the layout itself is read inside the same write, so a
// planner save made meanwhile is kept.
export function renameLayout(db, id, name) {
  const layout = readLayout(db, checkedId(id));
  const data = { ...layout.data, name: nameOf(name) };
  db.run('UPDATE layouts SET name=?, data=? WHERE id=?', [
    nameOf(name),
    storedJson(validateLayout(data), 'layout'),
    layout.id,
  ]);
}
export function deleteLayout(db, id) {
  db.run('DELETE FROM layouts WHERE id=?', [checkedId(id)]);
}

/* ---------- STL parts ---------- */

// A link to the pack piece a part was made from (Edit as STL). The revision
// tells whether that piece changed since.
function checkedSource(source) {
  if (source == null) return null;
  if (
    typeof source !== 'object' ||
    Array.isArray(source) ||
    typeof source.part !== 'string' ||
    source.part.length > 200 ||
    (source.label !== undefined &&
      (typeof source.label !== 'string' || source.label.length > 400))
  )
    throw invalidFile();
  return {
    collectionId: checkedId(source.collectionId),
    pieceId: checkedId(source.pieceId),
    part: source.part,
    revision: checkedRevision(source.revision),
    ...(source.label === undefined ? {} : { label: source.label }),
  };
}
export function readStlParts(db) {
  return rows(
    db,
    'SELECT id, name, based_on, source, updated, length(project) AS size FROM stl_parts ORDER BY updated DESC, rowid',
  ).map((r) => ({
    id: r.id,
    name: r.name,
    basedOn: r.based_on ?? null,
    source: r.source ? checkedSource(JSON.parse(r.source)) : null,
    updated: r.updated,
    size: r.size,
  }));
}
export function readStlPart(db, id) {
  const [row] = rows(
    db,
    'SELECT id, name, based_on, source, project, updated FROM stl_parts WHERE id=?',
    [checkedId(id)],
  );
  if (!row) throw Error('This STL part no longer exists. Reopen the library.');
  return {
    id: row.id,
    name: row.name,
    basedOn: row.based_on ?? null,
    source: row.source ? checkedSource(JSON.parse(row.source)) : null,
    updated: row.updated,
    project: checkProject(JSON.parse(row.project)),
  };
}
export function saveStlPart(
  db,
  { id, name, basedOn = null, source = null, project, updated },
) {
  const partId = id === undefined ? crypto.randomUUID() : checkedId(id);
  const checked = checkProject(project);
  if (checked.mode !== 'editor')
    throw Error('Only STL Edit models can be kept as STL parts.');
  const base = basedOn === null ? null : checkedId(basedOn);
  if (base === partId) throw Error('An STL part cannot be based on itself.');
  db.run(
    'INSERT INTO stl_parts(id, name, based_on, source, project, updated) VALUES (?,?,?,?,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET name=excluded.name, based_on=excluded.based_on, source=excluded.source, project=excluded.project, updated=excluded.updated',
    [
      partId,
      nameOf(name),
      base,
      source === null ? null : JSON.stringify(checkedSource(source)),
      storedJson(checked, 'STL part'),
      stamp(updated),
    ],
  );
  return partId;
}
export function renameStlPart(db, id, name) {
  db.run('UPDATE stl_parts SET name=? WHERE id=?', [nameOf(name), checkedId(id)]);
  if (db.getRowsModified() !== 1)
    throw Error('This STL part no longer exists. Reopen the library.');
}
// Parts based on a deleted part keep their own model; only the link goes.
export function deleteStlPart(db, id) {
  checkedId(id);
  db.run('UPDATE stl_parts SET based_on=NULL WHERE based_on=?', [id]);
  db.run('DELETE FROM stl_parts WHERE id=?', [id]);
}
