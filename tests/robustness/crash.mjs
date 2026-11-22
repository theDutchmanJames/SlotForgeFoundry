// Crash and interruption test. A page keeps saving (library saves with a
// large STL part, autosave, restoring a backup, the Planner cache) and logs
// each save once it has finished. The whole browser is then killed at a
// random moment, restarted on the same profile, and checked: it reopens,
// every logged save is there, and nothing is half written (a part's name and
// its model always come from the same save; a restore is all or nothing).
//   node tests/robustness/crash.mjs [rounds per scenario] [seed] [library|autosave|restore|cache]
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { devServer, harnessPage, killBrowser, prng, removeDir, startBrowser, tempDir } from './lib.mjs';

const ROUNDS = Number(process.argv[2]) || 6;
const rand = prng(Number(process.argv[3]) || 1);
const BIG = 6_000_000; // characters of "STL" per saved part

const setup = async (page) =>
  page.evaluate(async (BIG) => {
    const { newProject, autosave, recover } = await import('/src/project.js');
    window.L = await import('/src/library-store.js');
    window.cache = await import('/src/planner-cache.js');
    window.autosave = autosave;
    window.recover = recover;
    // An STL Edit project whose model text carries the save number, so a
    // part's name can be checked against the model it was saved with.
    window.modelFor = (n) => {
      const p = { ...newProject(), name: 'Part ' + n, mode: 'editor' };
      const mark = '#' + n + '#';
      p.editor = { ...p.editor, source: { label: 'crash test', data: mark + 'A'.repeat(BIG) + mark } };
      return p;
    };
  }, BIG);

// Saves forever, logging "saved <kind> <n>" after each one completes.
const loops = {
  async library(page) {
    await page.evaluate(() => {
      (async () => {
        const store = await window.L.openTrackLibrary();
        let [pack] = await store.list();
        const partId = (await store.stlParts())[0]?.id ?? (await store.saveStlPart({ name: 'Part 0', project: window.modelFor(0) }));
        let n = Number(localStorage.getItem('n') || 0);
        for (;;) {
          n++;
          await store.saveStlPart({ id: partId, name: 'Part ' + n, project: window.modelFor(n) });
          localStorage.setItem('n', n);
          console.log('saved part ' + n);
          await store.renamePack(pack.id, 'Count ' + n);
          console.log('saved pack ' + n);
        }
      })().catch((e) => console.log('loop failed ' + e.message));
    });
  },
  async autosave(page) {
    await page.evaluate(() => {
      (async () => {
        for (let n = 1; ; n++) {
          await window.autosave(window.modelFor(n));
          console.log('saved autosave ' + n);
        }
      })().catch((e) => console.log('loop failed ' + e.message));
    });
  },
  async restore(page) {
    await page.evaluate(() => {
      (async () => {
        const store = await window.L.openTrackLibrary();
        // Two backups that differ in every pack name.
        const backups = [];
        for (const mark of ['A', 'B']) {
          for (const c of await store.list()) await store.renamePack(c.id, 'Backup ' + mark + ' ' + c.id.slice(0, 4));
          await store.saveStlPart({ name: 'Model ' + mark, project: window.modelFor(mark === 'A' ? 1 : 2) });
          backups.push(await store.exportBytes());
        }
        for (let n = 0; ; n++) {
          await store.importBytes(backups[n % 2]);
          console.log('saved restore ' + (n % 2 ? 'B' : 'A'));
        }
      })().catch((e) => console.log('loop failed ' + e.message));
    });
  },
  async cache(page) {
    await page.evaluate(() => {
      (async () => {
        for (let n = 1; ; n++) {
          const mesh = new Float32Array(1_000_000).fill(n);
          await window.cache.storePiece('piece-' + n, { n, mesh });
          console.log('saved cache ' + n);
        }
      })().catch((e) => console.log('loop failed ' + e.message));
    });
  },
};

// What must hold after the restart.
const checks = {
  async library(page, last) {
    return page.evaluate(async (last) => {
      const store = await window.L.openTrackLibrary();
      const packs = await store.list();
      const parts = await store.stlParts();
      if (parts.length !== 1) return 'expected one STL part, found ' + parts.length;
      const part = await store.stlPart(parts[0].id);
      const n = Number(part.name.split(' ')[1]);
      const data = part.project.editor.source.data;
      if (!data.startsWith('#' + n + '#') || !data.endsWith('#' + n + '#')) return 'part ' + n + ' holds another save’s model';
      if (n < (last.part ?? 0)) return 'part saved as ' + last.part + ' came back as ' + n;
      const counts = packs.map((c) => c.name).filter((name) => name.startsWith('Count ')).map((name) => Number(name.slice(6)));
      if ((last.pack ?? 0) > (counts[0] ?? 0)) return 'pack saved as ' + last.pack + ' came back as ' + counts[0];
      return 'ok';
    }, last);
  },
  async autosave(page, last) {
    return page.evaluate(async (last) => {
      const p = await window.recover();
      if (!p) return last.autosave ? 'the autosave is gone' : 'ok';
      const n = Number(p.name.split(' ')[1]);
      const data = p.editor.source.data;
      if (!data.startsWith('#' + n + '#') || !data.endsWith('#' + n + '#')) return 'autosave ' + n + ' is half written';
      if (n < (last.autosave ?? 0)) return 'autosave ' + last.autosave + ' came back as ' + n;
      return 'ok';
    }, last);
  },
  async restore(page, last) {
    return page.evaluate(async (last) => {
      const store = await window.L.openTrackLibrary();
      const marks = new Set((await store.list()).map((c) => c.name.split(' ')[1]));
      const models = (await store.stlParts()).map((p) => p.name);
      if (marks.size !== 1) return 'a restore was half applied: packs from ' + [...marks].join(' and ');
      const [mark] = marks;
      if (!models.includes('Model ' + mark)) return 'packs from backup ' + mark + ' but STL parts ' + models.join(', ');
      if (last.restore && mark !== last.restore && mark !== { A: 'B', B: 'A' }[last.restore]) return 'unexpected backup ' + mark;
      return 'ok';
    }, last);
  },
  async cache(page, last) {
    return page.evaluate(async (last) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('slotforge-planner-cache', 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const all = (store, what) =>
        new Promise((resolve) => {
          const r = db.transaction(store).objectStore(store)[what]();
          r.onsuccess = () => resolve(r.result);
        });
      const pieceKeys = (await all('pieces', 'getAllKeys')).sort();
      const indexKeys = (await all('index', 'getAllKeys')).sort();
      db.close();
      if (JSON.stringify(pieceKeys) !== JSON.stringify(indexKeys)) return 'cache pieces and index disagree';
      for (const key of pieceKeys) {
        const value = await window.cache.readPiece(key);
        if (!value || value.mesh.length !== 1_000_000 || value.mesh.some((v) => v !== value.n) || key !== 'piece-' + value.n)
          return key + ' is damaged';
      }
      if (last.cache && !pieceKeys.includes('piece-' + last.cache)) return 'the newest cached piece ' + last.cache + ' is gone';
      return 'ok';
    }, last);
  },
};

const results = [];
const only = process.argv[4];
for (const scenario of Object.keys(loops).filter((s) => !only || s === only)) {
  const server = await devServer({ cache: scenario === 'cache' });
  const profile = await tempDir('crash-' + scenario);
  const last = {};
  try {
    for (let round = 1; round <= ROUNDS; round++) {
      const session = await startBrowser(profile);
      const page = await harnessPage(session.browser, server.url);
      let saves = 0,
        loopError = null;
      page.on('console', (m) => {
        const text = m.text();
        const saved = /^saved (\w+) (\w+)$/.exec(text);
        if (saved) {
          last[saved[1]] = /^\d+$/.test(saved[2]) ? Number(saved[2]) : saved[2];
          saves++;
        } else if (text.startsWith('loop failed')) loopError = text;
      });
      await setup(page);
      await loops[scenario](page);
      // Let a few saves land, then pull the plug mid-way through another.
      const started = Date.now();
      while (saves < 2 && !loopError && Date.now() - started < 60_000) await sleep(20);
      assert.equal(loopError, null, scenario + ' round ' + round + ': ' + loopError);
      assert.ok(saves >= 2, scenario + ': the save loop did not get going');
      await sleep(Math.floor(rand() * 900));
      await killBrowser(session);
      // Every save logged before the browser died has finished: the page
      // logs only after a save completes.
      const before = { ...last };

      const again = await startBrowser(profile);
      try {
        const check = await harnessPage(again.browser, server.url);
        await setup(check);
        const verdict = await checks[scenario](check, before);
        assert.equal(verdict, 'ok', scenario + ' round ' + round + ' (after ' + saves + ' saves)');
        assert.deepEqual(check.errors, [], scenario + ' round ' + round + ': errors after the restart');
        results.push(scenario + ' ' + round + ': killed after ' + saves + ' saves, reopened clean');
        console.log('  ' + results.at(-1));
      } finally {
        await killBrowser(again);
      }
    }
  } finally {
    await server.close();
    await removeDir(profile);
  }
  console.log('✓ ' + scenario + ': ' + ROUNDS + ' crashes mid-save, every one reopened with nothing lost or half written');
}
console.log(results.join('\n'));
