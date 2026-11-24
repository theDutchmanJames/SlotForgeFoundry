import { openStore } from './project.js';
import {
  LIBRARY_VERSION,
  MAX_LIBRARY_BYTES,
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
  readCollections,
  readLayout,
  readLayouts,
  readStlPart,
  readStlParts,
  renameCollection,
  renamePiece,
  renameStlPart,
  renameLayout,
  replaceLibrary,
  saveLayout,
  saveStlPart,
  saveRecipe,
  setCollectionProfile,
  setCollectionRules,
  resetCollectionSegments,
  setCollectionTrackside,
} from './library-database.js';

const key = 'track-library';
// Every save also stores a new revision token. Reads keep the last opened
// database and use it while the stored token is unchanged, so they skip
// loading the whole file (which can be tens of MB with STL parts). Saves still
// read the latest file in their own transaction, so a change made in another
// window, even by an older version without tokens, is never lost.
const revisionKey = 'track-library-revision';
let cached = null; // { revision, db }
const newRevision = () =>
  globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random();
let sqliteLoad;
function sqlite() {
  // Vite embeds the browser build and WASM in the standalone HTML. Only
  // create the SQLite runtime when someone actually opens their library.
  sqliteLoad ??= Promise.all([
    import('sql.js/dist/sql-wasm-browser.js'),
    import('sql.js/dist/sql-wasm-browser.wasm?url&inline'),
  ])
    .then(async ([module, wasm]) => {
      const wasmBinary = new Uint8Array(
        await (await fetch(wasm.default)).arrayBuffer(),
      );
      return module.default({ wasmBinary });
    })
    .catch((err) => {
      sqliteLoad = undefined;
      throw err;
    });
  return sqliteLoad;
}

// IndexedDB serializes read-write transactions on the store across all
// windows. Read the latest binary, run the synchronous SQL operation, and
// publish its replacement in that same transaction. Release success only
// after the transaction commits, including on quota/connection failures.
async function access(SQL, mode, operation) {
  const idb = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(
        'workbench',
        mode === 'read' ? 'readonly' : 'readwrite',
      );
      const store = tx.objectStore('workbench');
      let result, failure;
      let keep = null; // the database to cache once the transaction commits
      tx.onabort = () => {
        // A save that failed to commit leaves its prepared database unused.
        if (keep && keep.db !== cached?.db) keep.db.close();
        keep = null;
        reject(
          failure ??
            tx.error ??
            Error('The library could not be saved on this device.'),
        );
      };
      tx.oncomplete = () => {
        if (keep) {
          if (cached?.db !== keep.db) cached?.db.close();
          cached = keep;
        }
        resolve(result);
      };
      const revisionRequest = store.get(revisionKey);
      revisionRequest.onsuccess = () => {
        const revision = revisionRequest.result;
        if (
          mode !== 'write' &&
          revision !== undefined &&
          cached?.revision === revision
        ) {
          try {
            result = mode === 'read' ? operation?.(cached.db) : undefined;
          } catch (err) {
            failure = err;
            tx.abort();
          }
          return;
        }
        readFile(revision);
      };
      const readFile = (revision) => {
        const request = store.get(key);
        request.onsuccess = () => {
          let db;
          try {
            const bytes = request.result;
            if (!bytes && mode === 'read')
              throw Error('The local library was cleared. Reopen the library.');
            db = bytes
              ? new SQL.Database(bytes)
              : newLibraryDatabase(SQL, true);
            if (bytes) {
              const version = db.exec('PRAGMA user_version')[0].values[0][0];
              if (version >= 1 && version < LIBRARY_VERSION) {
                const collections = inspectLibraryBytes(SQL, bytes);
                db.close();
                db = newLibraryDatabase(SQL, false);
                replaceLibrary(db, collections);
              } else if (version !== LIBRARY_VERSION) {
                throw Error(
                  'This track library needs a different version of SlotForge Foundry.',
                );
              } else if (mode === 'initialize') {
                // An existing library from before revision tokens gets one now.
                const token = revision ?? newRevision();
                if (revision === undefined) store.put(token, revisionKey);
                keep = { revision: token, db };
                db = null;
                return;
              }
            }
            if (mode === 'write') db.run('PRAGMA foreign_keys=ON; BEGIN');
            result = operation?.(db);
            if (mode === 'write') db.run('COMMIT');
            if (mode !== 'read') {
              const updated = db.export();
              if (updated.length > MAX_LIBRARY_BYTES)
                throw Error('This library exceeds the 128 MiB file limit.');
              const token = newRevision();
              store.put(updated, key);
              store.put(token, revisionKey);
              keep = { revision: token, db };
              db = null;
            } else if (revision !== undefined) {
              keep = { revision, db };
              db = null;
            }
          } catch (err) {
            failure = err;
            keep = null;
            tx.abort();
          } finally {
            db?.close();
          }
        };
      };
    });
  } finally {
    idb.close();
  }
}

export async function openTrackLibrary() {
  const SQL = await sqlite();
  await access(SQL, 'initialize');
  const write = (run) => access(SQL, 'write', run);
  return {
    list: () => access(SQL, 'read', readCollections),
    createCollection: (name, profile = {}, pieces = [], rules) =>
      write((db) => addCollection(db, name, profile, pieces, rules)),
    savePiece: (id, piece, options) =>
      write((db) => saveRecipe(db, id, piece, options)),
    setProfile: (id, profile, options) =>
      write((db) => setCollectionProfile(db, id, profile, options)),
    setRules: (id, rules, options) =>
      write((db) => setCollectionRules(db, id, rules, options)),
    setTrackside: (id, trackside, options) =>
      write((db) => setCollectionTrackside(db, id, trackside, options)),
    resetSegments: (id, options) =>
      write((db) => resetCollectionSegments(db, id, options)),
    applyToCollection: (id, change, options) =>
      write((db) => applyToCollection(db, id, change, options)),
    renamePack: (id, name) => write((db) => renameCollection(db, id, name)),
    duplicatePack: (id, name) =>
      write((db) => duplicateCollection(db, id, name)),
    deletePack: (id) => write((db) => deleteCollection(db, id)),
    renamePiece: (id, name) => write((db) => renamePiece(db, id, name)),
    duplicatePiece: (id, name) => write((db) => duplicatePiece(db, id, name)),
    deletePiece: (id) => write((db) => deletePiece(db, id)),
    layouts: () => access(SQL, 'read', readLayouts),
    layout: (id) => access(SQL, 'read', (db) => readLayout(db, id)),
    saveLayout: (layout) => write((db) => saveLayout(db, layout)),
    deleteLayout: (id) => write((db) => deleteLayout(db, id)),
    renameLayout: (id, name) => write((db) => renameLayout(db, id, name)),
    stlParts: () => access(SQL, 'read', readStlParts),
    stlPart: (id) => access(SQL, 'read', (db) => readStlPart(db, id)),
    saveStlPart: (part) => write((db) => saveStlPart(db, part)),
    renameStlPart: (id, name) => write((db) => renameStlPart(db, id, name)),
    deleteStlPart: (id) => write((db) => deleteStlPart(db, id)),
    exportBytes: () => access(SQL, 'read', (db) => db.export()),
    inspectBytes: (bytes) => inspectLibraryBytes(SQL, bytes),
    importBytes: async (bytes, { expectedCollections } = {}) => {
      const collections = inspectLibraryBytes(SQL, bytes);
      await write((db) =>
        replaceLibrary(db, collections, expectedCollections, { restore: true }),
      );
    },
  };
}
