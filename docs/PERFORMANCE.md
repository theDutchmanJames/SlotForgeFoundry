# Performance review (21 November 2026)

Measured in the dev build in the app's browser pane (hidden pane, so paint time is not included).
`node scripts/bench-planner.mjs` times the Track Planner's model steps as a layout grows.

## Track Planner: fixed

Adding one piece, layout of R1–R6 corners and full straights:

| Situation | Before | After |
| --- | --- | --- |
| Plan view, ~330 sections | 75–157 ms | ~33 ms |
| 3D view, straight, ~200 sections | ~200 ms | ~30 ms |
| 3D view, curve already in the layout, ~250 sections | 400–700 ms | 30–50 ms |
| 3D view, switching back from Plan | ~2 s | 5 ms |
| Undo, ~250 sections | — | 22–32 ms |

What was slow and what changed:

1. **Mirrored curves rebuilt on every add (3D).** A left-hand curve needs a mirrored mesh. It was stored on a
   throwaway copy of the piece entry, so the worker rebuilt it on every add, and every left-hand section of that
   piece got new meshes. It is now cached per recipe (`mirrors` in `planner-workspace.js`), and placing a piece
   already in the layout reuses its entry.
2. **Every 3D mesh rebuilt on every edit.** The view now keeps a placed copy per section while its pose is unchanged
   (`placedFor` in `planner-view.js`). `Viewport.setParts` keeps the mesh of any part it is given again as the same
   object. Edge (crease) lines are worked out once per source part instead of once per placement.
3. **Crossings checked from scratch.** Every pair of sections with overlapping boxes ran a polygon intersection on
   every edit. Pair results are now kept between edits (`crossings(rows, memo)`, keyed by `placementKey`).
4. **Plan SVG rebuilt in full.** Each section's markup is now reused while its pose, selection and name are unchanged.

### Built pieces kept on the device, prepared in the background

`src/planner-cache.js` keeps every piece the Planner builds in its own IndexedDB database
(`slotforge-planner-cache`), apart from the library and autosave. Entries are keyed by the exact recipe
(geometry settings, print plate, plate fitting, handedness) and by a generator ID, a hash of the source code and
geometry kernel stamped in at build time (`__FOUNDRY_GEOMETRY__` in `vite.config.js`). The cache is capped at
64 MB and drops the least recently used pieces first. If storage is refused, the Planner builds as before. A
piece fitted to the plate is also stored under its fitted recipe, so reopening a layout finds it. Renaming a
piece reuses it; changing its geometry builds it again.

While the Planner is open it prepares pieces one at a time: first the left-hand variants the layout uses, then
the open catalogue, then catalogue corners' left-hand variants while 3D is open. It pauses while the Planner is
hidden. A click goes ahead of everything still queued and shares a build already under way. Background jobs never
show Cancel.

Measured in the dev build (hidden pane, so timer throttling can inflate the cold cases):

| Situation | Before | After |
| --- | --- | --- |
| First R6 click after a reload, cache filled | 0.4–0.8 s and up | 33 ms |
| Reopening a layout (28 sections) | each piece built again | ready 1.85 s after page load, app start included |
| Switching a reopened 148-section layout with left-hand corners to 3D | ~2 s | 211 ms |
| First R6 click with an empty cache while warm-up runs | — | up to ~4.3 s: the background piece under way, then a fitted R6 (~1.7 s) |
| First R6 click straight after opening the app, empty cache | — | ~6 s: the engine also starts up and builds the open project |

The empty-cache clicks are the one-off cost a device pays once per recipe. A standard pack is about 2.1 MB of
built pieces.

## Elsewhere: fixed in this pass

- **Undo history** no longer copies the embedded source STL (often megabytes of base64) into each of its 30
  steps; the copies share it (`clone` in `main.js`). The source is never changed in place.
- **Library page**: switching shelf redraws from the data already loaded instead of reading the whole database
  again.
- **Pack thumbnails** on Home and the Library page are cached per recipe instead of redrawn each time.

## STL Edit: only the new step runs (fixed)

The engine keeps the state it reached after the applied steps (`fold` in `engine.js`). A preview or Apply that
adds one step after them continues from there instead of replaying every step from the source STL.
`node scripts/bench-edit.mjs` (demo enclosure, small pockets):

| Steps already applied | Live preview before | After |
| --- | --- | --- |
| 0 | 6 ms | 6 ms |
| 10 | 35 ms | 5 ms |
| 20 | 67 ms | 6 ms |
| 40 | 138 ms | 6 ms |

The full replay still runs when the change is anything else: an earlier step revised, switched off or deleted,
undo, a new source, or a repeat (Mirror & repeat) step, whose copies need the earlier steps' tools. The engine
counts both kinds (`buildStats()`); a unit test checks that a step-by-step history matches a full replay.

## Apply reuses the live preview (fixed)

Apply used to build the project again right after its live preview had built it. The engine now keeps the last
preview, and Apply on the same project adopts it (`pending` in `engine.js`). If anything differs, it builds
afresh. `node scripts/bench-apply.mjs`:

| Piece | Live preview | Apply before | Apply now |
| --- | --- | --- | --- |
| Full straight | ~140 ms | ~140 ms | 1 ms |
| R1 corner | ~305 ms | ~305 ms | 1–2 ms |
| R6 corner (27 parts) | ~800–890 ms | ~800–890 ms | 5 ms |

This works in STL Edit too, where the previewed step is no longer computed twice.

## Library: reads use the open database (fixed)

Every save now also stores a small revision token next to the library file (`track-library-revision`). A read
checks only that token, and while it is unchanged it uses the database it already has open instead of loading
the whole file again. When another window has saved, the token differs and the file is loaded. Saves still read
the latest file in their own transaction, so nothing written in another window is lost, even by an older Foundry
without tokens.

Measured with a 26 MB library (12 STL parts of ~2 MB each), in a separate test database:

| Call | Before | After |
| --- | --- | --- |
| Pack list | 54 ms | 1–6 ms |
| Layouts | 38 ms | 1 ms |
| STL parts | 56 ms | 27 ms (SQLite sizing the stored models) |
| Home (open + three lists) | 168 ms | 24 ms |
| A save (rename) | 104 ms | 103 ms (still reads and writes the whole file) |
| Pack list after another tab saved | — | 38 ms, shows that tab's change |

Saves stay whole-file: sql.js has no partial writes. A save in this tab also kept the other tab's rename.

## Track Set live preview: measured, left as it is

A CPU profile of an R6 build (`node --cpu-prof scripts/prof-track.mjs`) spends about 97% of its time inside
the geometry kernel (manifold WASM) and about 3% in Foundry's own JavaScript. Every part depends on the shared
settings (width, lanes, slots, borders) and on its neighbours' joints, so parts cannot be cached one by one. The
remaining option is a larger change: build one interior segment of a curve and place rotated copies, since a
constant-radius curve's interior segments are the same shape. That changes how pieces are built, so it needs its
own decision.

**Tried and reverted (21 November 2026).** Phase timing of an R6 build (835 ms): building each part's pieces and
joints ~410 ms, underside ribs ~260 ms, final per-part Booleans ~160 ms. The attempt detected a part whose
inputs are an earlier part's inputs moved rigidly, then skipped its ribs and final Boolean (at most ~50%). It
found no copies: neighbouring interior segments are not identical at mesh level (e.g. 629 vs 642 vertices in
one addition, different rib keepouts), because the kernel triangulates each placement slightly differently. A
reliable version means building each segment once in its own local frame and placing it. That is a rewrite of
the joint, braid-feed, marking and rib code, which all work in piece coordinates today.

## Elsewhere: found, not changed yet (larger work)

Ranked by expected effect; from reading the code, not measured:

1. **Track Set: build one curve segment and copy it** (see above).
2. **Every preview replaces every 3D mesh.** Worker results are new objects each time. Fix: the worker sends a
   content key per part, and the viewport reuses meshes by that key.
3. ~~The whole project goes to the worker on every preview~~ **Measured, not worth changing.** Copying the
   embedded STL to the worker takes 1–2 ms for a 2 MB file and 4–14 ms for 20 MB (round trip, in the app's
   browser). The worker only checks its length and compares it with the last one. Sending it once would need a
   cache that survives worker restarts after a cancelled calculation, for a few milliseconds per preview.
4. ~~Every library call loads the whole database~~ **Fixed for reads.** See "Library" below.
5. ~~`render()` rewrites the history, part list and whole inspector on most actions~~ **Measured, not worth
   changing.** Timed in the dev build with temporary counters, since removed:

   | Action | `render()` calls | Time per call | Of which inspector | Extra previews |
   | --- | --- | --- | --- | --- |
   | Track Set R6 (27 parts): select a part | 1 each | ~14 ms (max 25) | ~12 ms | 0 |
   | Track Set: switch section | 0 | — | — | 0 |
   | Track Set: Apply | 1 | 14 ms | 12 ms | 0 |
   | STL Edit, 40 steps: switch tool | 0 | — | — | 0 |
   | STL Edit: switch a step off / on | 1 | 2–2.4 ms (history list 1.4 ms) | 0.6 ms | 0 |
   | STL Edit: open a step from the history | 1 | 15 ms | 13 ms | 0 |

   The worst case is about one to one and a half frames, almost all of it the settings panel's form. Tool and
   section switches don't go through `render()`, and no redraw started a preview.

Measured as fine: Track Set's live preview is ready about 280 ms after a keystroke for a straight (2–4 ms of that
on the input itself, the rest the pause plus the worker). The built app loads to DOM ready in about 100 ms from a
local server (4.5 MB single file).
