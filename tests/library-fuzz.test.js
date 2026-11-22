// Random-sequence test of Library saves. The same seeded actions run two
// ways, like the two read paths of library-store.js:
//   kept   – one open database, each action in its own transaction (the
//            cached database a window keeps while the revision token holds);
//   file   – the stored file reopened for every action and exported again
//            (what every save and every cache miss does).
// After each action both must agree, a refused action must change nothing,
// the exported file must read back the same, and a pack whose contents
// changed must have a higher revision (the cross-window conflict check
// depends on it). FUZZ_STEPS and FUZZ_SEED run longer or other sequences.
import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { newProject } from '../src/project.js';
import { starterPack } from '../src/library-profile.js';
import { defaultPackRules } from '../src/track-pack-rules.js';
import * as L from '../src/library-database.js';

const SQL = await initSqlJs();
const STEPS = Number(process.env.FUZZ_STEPS) || 500;
const SEEDS = process.env.FUZZ_SEED ? [Number(process.env.FUZZ_SEED)] : [1, 2, 3];

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ids and clocks are made the same for both runs of one action.
let idCounter = 0,
  clock = 1_700_000_000_000;
const realUUID = crypto.randomUUID.bind(crypto);
const realNow = Date.now;
function deterministic(run) {
  const ids = idCounter,
    now = clock;
  return (...args) => {
    idCounter = ids;
    crypto.randomUUID = () => '00000000-0000-4000-8000-' + String(++idCounter).padStart(12, '0');
    Date.now = () => now;
    try {
      return run(...args);
    } finally {
      crypto.randomUUID = realUUID;
      Date.now = realNow;
    }
  };
}

const layoutData = (name) => ({
  format: 'slotforge-layout',
  version: 1,
  name,
  sources: { s1: { name: 'R2 bend', track: { params: { kind: 'curve' } } } },
  nodes: [{ id: 'n1', source: 's1', index: 0, pose: { x: 0, y: 0, a: 0, flip: false }, h: [0, 0], supports: 0 }],
});
const editorProject = (name) => ({ ...newProject(), name, mode: 'editor' });

// Everything a window can read from the library.
function snapshot(db) {
  return {
    collections: L.readCollections(db),
    layouts: L.readLayouts(db).map((l) => ({ ...l, data: L.readLayout(db, l.id).data })),
    stlParts: L.readStlParts(db).map((p) => ({ ...p, project: L.readStlPart(db, p.id).project })),
  };
}
const packContent = ({ name, profile, rules, pieces }) => JSON.stringify({ name, profile, rules, pieces });

function chooseAction(rand, state, snapshots) {
  // Every random choice is drawn here, so both runs of an action get the
  // same values.
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const packs = state.collections;
  const pieces = packs.flatMap((c) => c.pieces.map((p) => ({ ...p, collection: c })));
  const name = () =>
    pick(['Club oval', 'Le Mans', '  padded  ', '', ' ', 'x'.repeat(2049), 'Pit ' + Math.floor(rand() * 99)]);
  const missing = 'no-such-id';
  const revisionFor = (c) =>
    rand() < 0.8 ? c.revision : pick([c.revision - 1, c.revision + 1, undefined]);
  const maybe = (chance, a, b) => (rand() < chance ? a : b);
  const actions = [
    () => {
      const starter = starterPack(rand() < 0.5 ? 1 : 2);
      const some = starter.pieces.slice(0, 1 + Math.floor(rand() * 3));
      const n = name();
      return ['add pack', (db) => L.addCollection(db, n, starter.profile, some, starter.rules)];
    },
    () => {
      const n = name();
      return ['add empty pack', (db) => L.addCollection(db, n, {}, [], defaultPackRules())];
    },
  ];
  if (pieces.length) {
    const p = pick(pieces);
    actions.push(
      () => {
        const n = name(), r = revisionFor(p.collection);
        return ['add piece', (db) => L.saveRecipe(db, p.collection.id, { name: n, track: p.track }, { expectedRevision: r })];
      },
      () => {
        const n = name(), r = revisionFor(p.collection);
        return ['save piece', (db) => L.saveRecipe(db, p.collection.id, { id: p.id, name: n, track: p.track }, { expectedRevision: r })];
      },
      () => {
        const other = pick(packs).id;
        return ['save piece into another pack', (db) => L.saveRecipe(db, other, { id: p.id, name: p.name, track: p.track })];
      },
      () => {
        const n = name();
        return ['rename piece', (db) => L.renamePiece(db, p.id, n)];
      },
      () => {
        const n = maybe(0.5, undefined, name());
        return ['duplicate piece', (db) => L.duplicatePiece(db, p.id, n)];
      },
      () => {
        const id = maybe(0.9, p.id, missing);
        return ['delete piece', (db) => L.deletePiece(db, id)];
      },
    );
  }
  if (packs.length) {
    const c = pick(packs);
    actions.push(
      () => {
        const n = name();
        return ['rename pack', (db) => L.renameCollection(db, c.id, n)];
      },
      () => {
        const n = maybe(0.5, undefined, name());
        return ['duplicate pack', (db) => L.duplicateCollection(db, c.id, n)];
      },
      () => {
        const id = maybe(0.9, c.id, missing);
        return ['delete pack', (db) => L.deleteCollection(db, id)];
      },
      () => {
        const rules = { ...c.rules, angle: pick([15, 30, 45]) }, r = revisionFor(c);
        return ['set rules', (db) => L.setCollectionRules(db, c.id, rules, { expectedRevision: r })];
      },
      () => {
        const profile = { ...c.profile, braidWidth: pick([3, 5, 8, 40]) }, r = revisionFor(c);
        return ['set profile', (db) => L.setCollectionProfile(db, c.id, profile, { expectedRevision: r })];
      },
      () => {
        const width = pick([c.rules.width, c.rules.width + 20, c.rules.width - 40, 30, 400]), r = revisionFor(c);
        return ['apply to collection', (db) => L.applyToCollection(db, c.id, { values: { width } }, { expectedRevision: r })];
      },
      () => {
        const n = name(), at = clock;
        return ['save layout', (db) => L.saveLayout(db, { name: n, collectionId: c.id, data: layoutData('Layout'), updated: at })];
      },
    );
  }
  if (state.layouts.length) {
    const l = pick(state.layouts);
    actions.push(
      () => {
        const n = name(), at = clock;
        return ['resave layout', (db) => L.saveLayout(db, { id: l.id, name: n, collectionId: l.collectionId, data: layoutData('Again'), updated: at })];
      },
      () => {
        const id = maybe(0.9, l.id, missing), n = name();
        return ['rename layout', (db) => L.renameLayout(db, id, n)];
      },
      () => ['delete layout', (db) => L.deleteLayout(db, l.id)],
    );
  }
  actions.push(() => {
    const n = name(), at = clock;
    const basedOn = state.stlParts.length && rand() < 0.4 ? pick(state.stlParts).id : null;
    return ['save STL part', (db) => L.saveStlPart(db, { name: n, project: editorProject('Part'), updated: at, basedOn })];
  });
  if (state.stlParts.length) {
    const s = pick(state.stlParts);
    actions.push(
      () => {
        const id = maybe(0.9, s.id, missing), n = name();
        return ['rename STL part', (db) => L.renameStlPart(db, id, n)];
      },
      () => ['delete STL part', (db) => L.deleteStlPart(db, s.id)],
      () => ['resave STL part on itself', (db) => L.saveStlPart(db, { id: s.id, name: s.name, basedOn: s.id, project: editorProject('Loop') })],
    );
  }
  if (snapshots.length)
    actions.push(() => {
      const bytes = pick(snapshots);
      return ['restore backup', (db) => L.replaceLibrary(db, L.inspectLibraryBytes(SQL, bytes), undefined, { restore: true })];
    });
  return pick(actions)();
}

// One action in a transaction on an open database; rolled back on failure.
function inTransaction(db, run) {
  db.run('PRAGMA foreign_keys=ON; BEGIN');
  try {
    const value = run(db);
    db.run('COMMIT');
    return { value };
  } catch (err) {
    db.run('ROLLBACK');
    return { error: err.message };
  }
}

for (const seed of SEEDS) {
  test('random Library actions agree on both save paths and keep the library valid · seed ' + seed, { timeout: 600_000 }, () => {
    const rand = prng(seed);
    const kept = L.newLibraryDatabase(SQL, true);
    let file = kept.export();
    const snapshots = [file];
    const counts = {};
    try {
      for (let step = 0; step < STEPS; step++) {
        clock += 1000 + Math.floor(rand() * 5000);
        const before = snapshot(kept);
        const [label, run] = chooseAction(rand, before, snapshots);
        const action = deterministic(run);
        const where = `seed ${seed}, step ${step}, ${label}`;

        const a = inTransaction(kept, action);
        const reopened = new SQL.Database(file);
        let b;
        try {
          b = inTransaction(reopened, action);
          if (!b.error) file = reopened.export();
        } finally {
          reopened.close();
        }
        counts[label + (a.error ? ' (refused)' : '')] = (counts[label + (a.error ? ' (refused)' : '')] ?? 0) + 1;
        assert.deepEqual(b, a, where + ': both paths give the same result');

        const after = snapshot(kept);
        const fromFile = new SQL.Database(file);
        try {
          assert.deepEqual(snapshot(fromFile), after, where + ': the stored file matches the open database');
        } finally {
          fromFile.close();
        }
        if (a.error) {
          assert.deepEqual(after, before, where + ': a refused action changes nothing (' + a.error + ')');
          continue;
        }
        // A backup read back gives the same packs.
        const inspected = L.inspectLibraryBytes(SQL, file);
        assert.deepEqual([...inspected], after.collections, where + ': the backup reads back the same packs');
        // Ids stay unique, names stay valid.
        const ids = after.collections.flatMap((c) => [c.id, ...c.pieces.map((p) => p.id)]);
        assert.equal(new Set(ids).size, ids.length, where + ': ids are unique');
        for (const c of after.collections) {
          assert.ok(c.name.trim() && c.name === c.name.trim(), where + ': pack names are trimmed');
          const old = before.collections.find((o) => o.id === c.id);
          if (!old) continue;
          assert.ok(c.revision >= old.revision, where + ': a pack revision never goes down');
          if (packContent(old) !== packContent(c))
            assert.ok(c.revision > old.revision, where + ': a changed pack gets a new revision');
        }
        if (step % 97 === 0) snapshots.push(file);
      }
    } finally {
      kept.close();
    }
    // Every kind of action ran, and some were refused.
    if (process.env.FUZZ_REPORT) console.log(JSON.stringify(counts, null, 1));
    assert.ok(Object.keys(counts).length > 15, JSON.stringify(counts));
  });
}
