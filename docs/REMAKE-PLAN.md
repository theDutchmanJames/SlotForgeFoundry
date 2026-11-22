# Foundry remake plan (draft for approval)

November 2026. A remake, not a redesign: the flow, the names and where every tool lives change.
Nothing here is built yet. The preview is `.claude/preview/remake.html` (open it through the dev server).
Look: SlotForge Graphite (Circuit and Timing), dark and light; track pieces graphite, hardware SlotForge red.

---

## 1. Words we use (one name per thing)

| Thing | New name | Old names it replaces |
|---|---|---|
| A set of pieces that share rules | **Track pack** | Track pack, collection, Track Set (as data), library entry |
| The shared settings of a pack | **Pack rules** | Pack rules *and* Shared print profile *and* Shared profile |
| One piece in a pack | **Piece** | track piece, piece, current piece |
| A planned circuit | **Layout** | layout, .slotplan |
| One printable file | **Part** | part, print file, STL |
| An STL in the editor, saved | **STL part** | (did not exist) |
| Where packs, layouts and STL parts live | **Library** | Library, Track packs dialog |

Workspaces in the top bar: **Home · Track Set · Track Planner · STL Edit · Library**.
(Open question: rename Track Set → *Pack Editor* and STL Edit → *STL Workshop*. Kept as they are in the preview.)

---

## 2. The new flow

```
Home ─┬─ Edit a pack ──────────▶ Track Set (its pieces, Pack rules, Apply to collection)
      ├─ Plan with a pack ─────▶ Track Planner (pieces ready to place)
      ├─ New pack ─┬ from a standard set (SlotForge Basic, Basic single lane)
      │            ├ from scratch (set the rules first)
      │            └ from SlotForge Circuit (SVG / DXF import)
      ├─ Recent layouts ───────▶ Track Planner
      └─ Open an STL ──────────▶ STL Edit
```

- **Home** is new and is where the app opens. It replaces the Open dialog, the "New project" demo
  and the sidebar "Create track" box.
- **Track Set** always edits a piece *of a pack*. The pack and its pieces are in the left rail; there is no
  loose "project" any more (a `.slotfab` file still opens and can be saved into a pack).
- **Apply to collection** (the button you asked for): a setting that is a pack rule carries a small link mark.
  Change one and the commit bar offers **Apply to this piece** (the piece keeps its own value, marked
  "differs from pack") or **Apply to collection** (every piece in the pack and every layout using it is
  rebuilt; Foundry checks them all first and lists any piece that would no longer fit or print).
- **Track Planner** places pieces by **reference** (pack + piece), not by a copied recipe. When the pack
  rules change, a layout rebuilds itself next time it opens and says what changed
  ("Pack rules changed: road 200 → 210 mm. 3 crossings rechecked."). Old `.slotplan` files still open.
- **Library** becomes a page with three shelves: **Track packs**, **Layouts**, **STL parts**.

---

## 3. Track Set: where every setting goes

The sheet on the right gets six sections (icon strip), each with Folders that show their value when closed.
Pack rules are marked with the link mark.

| New section | Folders (pack rules marked ⛓) | Comes from |
|---|---|---|
| **Shape** | Piece shape (bend radius + sweep / straight length / drawn path) · Lanes ⛓ (count, spacing) · Lane squeeze / spread · *Special piece* (pit, hairpin, chicane, duel, diamond, timing) · *Pit switch* (flipper, linkage, motor mount: pit only) · *Bridge and supports* (imports with crossings) | Road tab, creator |
| **Cross-section** | Road body ⛓ (height, hollow, deck, walls, ribs) · Guide slot ⛓ · Braid ⛓ · Braid feeds (feeds, pit junction openings) | Cross-section tab |
| **Borders** | Sides and width (with the drag diagram) · Border ends | Borders tab |
| **Markings** *(new)* | White lines (road edges, border edges, centre line, pit divider) · Kerbstones (road and border) · Starting grid (any straight) · Pit grid marker · Paint grooves ⛓ (line width, groove width and depth: **one** place) | Road white lines, Road kerbstones, Shared line and groove dimensions, Border white line, Kerbstones, Starting grid, Pit grid marker |
| **Joints** | Joint type ⛓ (plain, tabs, clips, mixed; per joint) · Clip type ⛓ (Dovetail key, Carrera) and fit · Tab size ⛓ · Border joints · **Place connectors…** (the one editor for custom positions) · Test prints (fit samples, test joint, keeper tool) | Connections tab |
| **Print** | Segments (road and borders, with Suggest) · Plate check · View underside · Export this piece | Print segments (×2), plate dialog, View underside |

Removed duplicates: the two "Custom … connector positions" folders (the Place connectors editor stays),
the second "Check plate fit" button, "Edit shared dimensions" jump, the per-tab plate links.
The print plate becomes **one setting** (Settings, with printer presets) used by Track Set, Planner and STL Edit.

---

## 4. Track Planner

- Opens with the pack you chose on Home; the catalogue shows that pack's pieces *and its saved specials*.
- Layout sheet on the right: Layout (name, pack, length, open ends) · Selected section (Reverse turn, Delete,
  Heights and supports) · Crossings · Parts list · **Export print kit**.
- Save to Library (Layouts shelf) and Save as file (.slotplan) both stay.

### The print kit ZIP (de-duplicated)

One grouping across the whole layout, keyed on the real geometry (not per piece as today), and the count
in the file name:

```
Club circuit print kit/
  track/   R2-Road-1-x36.stl   R2-Road-2-x36.stl   Straight-200-Road-x12.stl …
  borders/ R2-Outer-border-1-x8.stl …
  hardware/ Dovetail-key-x148.stl   Quarter-turn-keeper-x148.stl
  supports/ Support-block-A-x2.stl …
  tools/   Keeper-turning-tool.stl
  parts.csv        (part, file, quantity, used in which pieces)
  assembly-map.svg
  layout.slotplan
```

Mirrored copies get their own file (`R2-Road-1-mirrored-x18.stl`) because they print differently.

---

## 5. STL Edit: tools regrouped and renamed

**Left rail** (always the same groups, greyed instead of hidden):

| Group | Tools (new name ← old) |
|---|---|
| **Parts** | Add STL… (one button: *Replace* or *Add to this project*; replaces Open STL, Add model, New design) · Save to Library · the parts list |
| **Create** | Shape (← Solid shape) · Sketch · Sketch from SVG / DXF (← Import outline) |
| **From a sketch** (shown under the selected sketch) | Extrude · Turn (← Revolve) · Follow a path (← Sweep) · Blend two sketches (← Loft) |
| **Change the part** | Move, rotate & size (← Transform, Move, Lay face on print plate, Calibrate scale) · Cut (← Cut off top, Trim, Split & rebuild: one tool, three ways) · Stretch (← Stretch section) · Mirror & repeat (← Mirror & pattern, Mirror across local X) · Hollow out · Combine parts (← Align + Combine) |
| **Repair** | Check & repair (← Inspect STL file…, now on the *current* part) · Smooth or patch (← Brush & lasso) · Reduce triangles (← Simplify mesh) · Split loose bodies (← Separate shells) |

**Face toolbar** (after you click the model, only what fits the pick):
Push / pull · Tilt · Add shape / Cut shape (← Add profile / Cut profile) · Text · Hole (new hole, or *change this hole*:
← Hole + Countersink) · Round or chamfer (← Finish edge) · Move walls (← Modify walls) · Remove bump or fill pocket (← Remove feature).

Other changes: the title of every tool matches its button; "Boundary angle" → *Selection reach*; the back button names
where it goes; STL Edit opens empty (no demo enclosure); Replace always asks before discarding a model.

### Saving STL work to the Library (new)

- **STL parts** shelf: an uploaded STL is saved as an *original*. An edit is saved as a **new part linked to its
  original** ("Based on: Workshop enclosure.stl" or "Based on: R2 bend · Road 1"), with its edit history, so you
  can reopen it and change any step.
- A part sent from Track Set (**Edit as STL**) stays linked to its piece. When that piece changes, the part says
  "Original changed" and offers **Rebuild with my edits** (replays the edits on the new piece, and reports any that no
  longer find their face).

---

## 6. Proposals: missing features (approve, change or drop each)

1. **Rename, duplicate and delete** packs, pieces and layouts (none of this exists today).
2. **Used in**: a piece shows which layouts use it; a pack shows its layouts (Timing's *Used by*).
3. **Shopping list** in the print kit: filament per part and in total (grams, metres), braid length per lane,
   screws for pit switches.
4. **Printer presets** for the plate (Prusa MK4/Core One, Bambu A1/X1/P1, Creality K1/Ender 3, custom).
5. **Settings page**: theme (Dark/Light), printer and plate, units, what Home shows.
6. **Edit history you can manage**: delete or switch off a step in STL Edit, and keep Undo after a reload.
7. **Pack card picture**: Home and Library draw each pack's pieces in graphite so packs are recognisable.

## 7. Order of work (after approval)

1. Theme and shell (Graphite tokens, fonts, top bar, Light/Dark), 3D colours.
2. Library storage: layouts and STL parts tables, references instead of copies (with migration of old files).
3. Home.
4. Track Set: sections and folders, pack rules + Apply to collection.
5. Track Planner: references, rebuild on rule change, the new print kit export.
6. STL Edit: rail, face toolbar, renames, save to Library with links.
7. Proposals that were approved.

---

## Status (21 November 2026, first build)

Built and covered by tests (546 unit tests, 60 browser stages):

- **Theme**: SlotForge Graphite tokens (`src/theme.css`), Barlow Condensed / Roboto Mono, Light and Dark switch
  in the top bar (dark by default, remembered on this device), Pit Buttons (`.sf-btn`).
- **3D colours**: road and borders graphite, clips / keys / keepers SlotForge red, pit switch parts deeper reds,
  supports steel grey, kerbs SlotForge red and off-white; the selected part and the guides in focus blue.
- **Library storage**: version 5 adds `layouts` and `stl_parts`; packs and pieces can be renamed, duplicated and
  deleted; older backups restore and keep the layouts and STL parts already on the device.
- **Home**: opens first; packs with Edit pieces / Plan a layout, new pack from a standard set, from scratch or from
  Circuit, recent layouts, STL parts, print plate, fit samples. `#track`, `#editor`, `#planner` open a workspace directly.
- **Track Set**: six sections (Shape, Cross-section, Borders, Markings, Joints, Print); the pack rail (pack,
  Pack rules, its pieces, Add piece); **Apply to collection** for pack rules (all checked first, nothing changes if
  one piece fails); Apply on a pack piece saves it into its pack.
- **Track Planner**: placed pieces stay linked to their pack and rebuild when the pack changes (the layout says how
  many); Save to Library; the print kit holds every different part once, grouped by real geometry across the whole
  layout, with the count in the file name (`track/R2-corner-Road-1-x24.stl`, `hardware/Dovetail-key-x112.stl`).
- **STL Edit**: tools regrouped (Create, Change the part, Repair) and renamed to match their windows; Save to Library;
  a part sent from Track Set stays linked to its piece; an uploaded original is never overwritten (its edits become
  a new part based on it).

Different from the preview:

- **Apply to this piece** for a pack rule is not offered: the shared profile of a pack overlays every piece, so a
  piece cannot keep its own value for those settings. Pack rules go to the whole pack; everything else is per piece.

## Status (21 November 2026, second build: the remaining items)

- **Library page**: a full page with three shelves (Track packs, Layouts, STL parts); open, rename, duplicate and
  delete; "Used in N layouts" on each pack; the Track packs window (pieces, rules, backup and restore) opens from it.
- **Specials linked**: specials placed from the Planner's Specials tab are linked to the pack like other pieces and
  rebuild when the pack rules change.
- **STL Edit**:
  - one **Cut** tool with its modes (cut off the top, trim, split);
  - each history step can be **switched off** (kept but not replayed, shown struck through) or **deleted**. When a
    later step depends on it, the change is refused and the model stays as it was;
  - a part made from a pack piece shows **Original changed → Rebuild with my edits** when its pack changes.
- **Settings page** (top bar): Light / Dark; printer presets (Prusa MK4 / CORE One / MINI+, Bambu Lab A1 / A1 mini /
  X1–P1, Creality K1 / K1 Max / Ender 3, Voron 2.4 350, custom) that set the print plate new projects start with;
  "Use this plate in the open project"; filament, fill, spool price and spare braid for the shopping list. Kept on
  this device (`foundry.settings`).
- **Shopping list** in the print kit (`shopping-list.txt`): printed volume, estimated weight and 1 kg spools for the
  chosen filament, an optional cost line, and braid per lane (two strips per slot plus the spare). Mirrored pieces
  count their lanes from the other side, so lane 1 stays the same lane.
