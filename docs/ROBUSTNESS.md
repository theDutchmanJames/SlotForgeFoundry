# Robustness testing, 22 November 2026

Four kinds of extra tests, after the ones suggested for Paddock, adapted to
Foundry. Foundry has no network sync, so the "cut the network" part does not
apply; everything else does.

| Run | Command | What it checks |
| --- | --- | --- |
| Coverage map | `npm run test:coverage` | Which lines and branches the unit tests never run |
| Random saves (Node) | part of `npm test` (`tests/library-fuzz.test.js`) | Thousands of random Library actions on both save paths |
| Random saves (two windows) | `npm run test:windows -- [steps] [seed]` | The same across two windows, with stale reads |
| Crash tests | `npm run test:crash -- [rounds] [seed] [scenario]` | Kill the browser mid-save, reopen, check nothing is lost |
| Random-click run | `npm run test:monkey -- [minutes] [seed]` | Clicks, typing and keys at random on the built app |

## 1. Coverage map

The unit tests run 87 % of the lines of the files they load (88 % of
branches). What they do not reach:

- **Files only the browser suite reaches** (never loaded by a unit test):
  `main.js`, `library-store.js`, `library-dialog.js`, `planner-workspace.js`,
  `mesh-workbench.js`, the dialogs and handles. The browser suite (60 stages)
  covers their main paths; the new browser runs below cover the store.
- **Saving and imports, before this work:** `import-profile.js` 72 %,
  `project.js` 87 % (Library and STL part links, the embedded model checks,
  autosave), `planner-cache.js` 49 % (its IndexedDB half).

Added `tests/save-gaps.test.js` for these: `import-profile.js` is now
100 %, `project.js` 91 % (what is left is the IndexedDB code, which the crash
test runs in a real browser), `library-database.js` 99 %.

## 2. Random-sequence testing of saves

The Library has two ways to read: a window keeps its open database while the
stored revision token is unchanged (the fast path, used for every list and
open), and otherwise reads the whole file. Every save reads the whole file.

- **Node** (`tests/library-fuzz.test.js`): seeded random actions (add, save,
  rename, duplicate and delete packs and pieces; pack rules and profile;
  Apply to collection; layouts; STL parts; restoring an earlier backup), with
  stale revisions, missing ids and invalid names mixed in. Each action runs
  on an open database and on the file reopened, and both must give the same
  result. After each action: the stored file reads back the same, a refused
  action changed nothing, ids are unique, and a pack whose contents changed
  has a higher revision (the "changed in another window" check relies on
  that). `npm test` runs 3 × 500 actions; 6 × 4,000 more were run once
  (`FUZZ_STEPS=4000 FUZZ_SEED=11`). No differences found.
- **Two windows** (`tests/robustness/windows.mjs`): two pages on one
  library make random saves through the real store, often from what they saw
  several steps earlier. After every action both windows' reads, from their
  kept databases, must match a fresh read. 800 actions over two seeds, no
  differences.

## 3. Crash and interruption tests

`tests/robustness/crash.mjs` starts Edge or Chrome itself, so it can kill
every browser process at once at a random moment, then restarts it on the
same profile. Four scenarios, each saving in a loop and logging each save
only once it has finished:

- **Library saves** with a 6 MB STL part and a pack rename;
- **Autosave** of a 6 MB project;
- **Restoring a backup** (alternating between two backups);
- **The Planner cache** (4 MB pieces, with eviction).

After each restart: the store opens, every logged save is there, a part's
name and its model come from the same save, a restore is all or nothing, and
the cache's pieces and index agree. 3–6 crashes per scenario, all reopened
clean.

## 4. Random-click run

`tests/robustness/monkey.mjs` drives the built app in a throwaway profile
(it starts with the starter Library, the stand-in for a copy of yours). It
records page errors, console errors, failed requests, browser dialogs,
dialogs that stay open on Escape, calculations stuck for over 90 s and an
unresponsive page, each with the last 40 actions and a screenshot, in
`test-results/monkey-<seed>.json`.

One hour (seed 2): 9,624 actions across every page, 3 distinct problems,
all the same kind (below). No page errors, failed requests, stuck
calculations or dialogs that would not close.

## Found and fixed

- **A setting with a bad value, out of sight, blocked leaving the piece
  without showing where it was.** Opening another piece applies an
  unfinished edit first. When the bad value sat in a collapsed group (Lane
  layout, say), or in a form behind the Library page or Settings, the browser
  could not point at it ("An invalid form control … is not focusable"). The
  notice named the setting but its group stayed closed. Now the group opens
  so the browser points at the field, and a form behind another page or an
  open dialog (the Library dialog from Add piece) only shows the notice; the
  Library dialog shows it inside itself (`validateForm` in `main.js`). Found by the random-click
  run three times: lane spacing 99999, print segments 12.5, and an empty
  depth before "Use this plate in the open project".

- **Library links in project files used the wrong id check.** A project file
  could carry a pack, piece or STL part link with `/` or `:` in its id. It
  opened, but the next Library save failed with "Choose a SlotForge track
  library". Project files now check links the way the Library does
  (`libraryId` in `project.js`).
