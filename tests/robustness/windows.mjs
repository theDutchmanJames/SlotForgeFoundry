// Two windows, one library: random saves from either window, often with
// what that window last saw (so some are stale and must be refused). After
// every action both windows' reads (served from their kept database while
// the revision token holds) must match a fresh read of the stored file.
//   node tests/robustness/windows.mjs [steps] [seed]
import assert from 'node:assert/strict';
import { devServer, harnessPage, prng, removeDir, startBrowser, closeBrowser, tempDir } from './lib.mjs';

const STEPS = Number(process.argv[2]) || 300;
const SEED = Number(process.argv[3]) || 1;
const rand = prng(SEED);
const pick = (list) => list[Math.floor(rand() * list.length)];

const server = await devServer();
const profile = await tempDir('windows');
const session = await startBrowser(profile);
try {
  const open = async () => {
    const page = await harnessPage(session.browser, server.url);
    await page.evaluate(async () => {
      window.L = await import('/src/library-store.js');
      window.store = await window.L.openTrackLibrary();
      const { newProject } = await import('/src/project.js');
      window.starter = (await import('/src/library-profile.js')).starterPack;
      window.editorProject = (name) => ({ ...newProject(), name, mode: 'editor' });
      window.layoutData = (name) => ({
        format: 'slotforge-layout',
        version: 1,
        name,
        sources: { s1: { name: 'R2 bend', track: { params: { kind: 'curve' } } } },
        nodes: [{ id: 'n1', source: 's1', index: 0, pose: { x: 0, y: 0, a: 0, flip: false }, h: [0, 0], supports: 0 }],
      });
      window.everything = async (s = window.store) => {
        const collections = await s.list();
        const layouts = await s.layouts();
        const stlParts = await s.stlParts();
        return { collections, layouts, stlParts };
      };
      // A window that has never read the library: a new copy of the store
      // module, so nothing is kept from before.
      let n = 0;
      window.fresh = async () => {
        const M = await import('/src/library-store.js?fresh=' + ++n);
        return window.everything(await M.openTrackLibrary());
      };
    });
    return page;
  };
  const windows = [await open(), await open()];
  const seen = [null, null];
  const counts = {};
  for (let step = 0; step < STEPS; step++) {
    const w = rand() < 0.5 ? 0 : 1;
    const page = windows[w];
    // What this window last saw, maybe from several steps ago.
    if (!seen[w] || rand() < 0.6) seen[w] = await page.evaluate(() => window.everything());
    const state = seen[w];
    const packs = state.collections;
    const pieces = packs.flatMap((c) => c.pieces.map((p) => ({ ...p, cid: c.id, rev: c.revision })));
    const name = pick(['Club oval', 'Le Mans', 'Pit ' + Math.floor(rand() * 99), '', ' x ']);
    const choices = [['add pack', { name, lanes: rand() < 0.5 ? 1 : 2 }], ['add pack', { name, lanes: 2 }]];
    if (pieces.length) {
      const p = pick(pieces);
      choices.push(
        ['save piece', { cid: p.cid, piece: { id: p.id, name, track: p.track }, rev: p.rev }],
        ['add piece', { cid: p.cid, piece: { name, track: p.track }, rev: p.rev }],
        ['rename piece', { id: p.id, name }],
        ['delete piece', { id: p.id }],
      );
    }
    if (packs.length) {
      const c = pick(packs);
      choices.push(
        ['rename pack', { id: c.id, name }],
        ['duplicate pack', { id: c.id }],
        ['delete pack', { id: c.id }],
        ['set rules', { id: c.id, rules: { ...c.rules, angle: pick([15, 30, 45]) }, rev: c.revision }],
        ['save layout', { name, cid: c.id }],
      );
    }
    if (state.layouts.length) {
      const l = pick(state.layouts);
      choices.push(['rename layout', { id: l.id, name }], ['delete layout', { id: l.id }]);
    }
    choices.push(['save STL part', { name }]);
    if (state.stlParts.length) {
      const s = pick(state.stlParts);
      choices.push(['rename STL part', { id: s.id, name }], ['delete STL part', { id: s.id }]);
    }
    choices.push(['backup and restore', {}]);
    const [kind, args] = pick(choices);
    const outcome = await page.evaluate(
      async ([kind, a]) => {
        const s = window.store;
        const run = {
          'add pack': () => {
            const pack = window.starter(a.lanes);
            return s.createCollection(a.name || 'Unnamed', pack.profile, pack.pieces.slice(0, 4), pack.rules);
          },
          'save piece': () => s.savePiece(a.cid, a.piece, { expectedRevision: a.rev }),
          'add piece': () => s.savePiece(a.cid, a.piece, { expectedRevision: a.rev }),
          'rename piece': () => s.renamePiece(a.id, a.name),
          'delete piece': () => s.deletePiece(a.id),
          'rename pack': () => s.renamePack(a.id, a.name),
          'duplicate pack': () => s.duplicatePack(a.id),
          'delete pack': () => s.deletePack(a.id),
          'set rules': () => s.setRules(a.id, a.rules, { expectedRevision: a.rev }),
          'save layout': () => s.saveLayout({ name: a.name, collectionId: a.cid, data: window.layoutData('Layout') }),
          'rename layout': () => s.renameLayout(a.id, a.name),
          'delete layout': () => s.deleteLayout(a.id),
          'save STL part': () => s.saveStlPart({ name: a.name, project: window.editorProject('Part') }),
          'rename STL part': () => s.renameStlPart(a.id, a.name),
          'delete STL part': () => s.deleteStlPart(a.id),
          'backup and restore': async () => {
            const bytes = await s.exportBytes();
            await s.importBytes(bytes, { expectedCollections: await s.list() });
          },
        }[kind];
        try {
          await run();
          return 'done';
        } catch (err) {
          return 'refused: ' + err.message;
        }
      },
      [kind, args],
    );
    const label = kind + (outcome === 'done' ? '' : ' (refused)');
    counts[label] = (counts[label] ?? 0) + 1;
    assert.ok(
      outcome === 'done' || !/TypeError|undefined|null|SQLITE|constraint/i.test(outcome),
      `step ${step}, window ${w + 1}, ${kind}: refused with an internal error: ${outcome}`,
    );
    // Both windows, from whatever they keep, and a fresh reader agree.
    const [a, b] = await Promise.all(windows.map((p) => p.evaluate(() => window.everything())));
    const truth = step % 5 === 0 ? await windows[0].evaluate(() => window.fresh()) : a;
    assert.deepEqual(a, truth, `step ${step}, ${kind}: window 1 matches the stored library`);
    assert.deepEqual(b, truth, `step ${step}, ${kind}: window 2 matches the stored library`);
    const ids = truth.collections.flatMap((c) => [c.id, ...c.pieces.map((p) => p.id)]);
    assert.equal(new Set(ids).size, ids.length, `step ${step}: ids stay unique`);
  }
  for (const page of windows) assert.deepEqual(page.errors, [], 'no page errors');
  console.log('✓ ' + STEPS + ' random actions from two windows (seed ' + SEED + '): every read matched the stored library');
  console.log(JSON.stringify(counts));
} finally {
  await closeBrowser(session);
  await server.close();
  await removeDir(profile);
}
