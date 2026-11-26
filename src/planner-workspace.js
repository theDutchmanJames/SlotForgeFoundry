import { glazingSheets, glazingSvg } from './building-glazing.js';
import { KERB_EDGES, MARKING_SIDES, markingsOf } from './markings-controls.js';
import {
  TEXTURE_CHOICES,
  TEXTURE_FITS,
  TEXTURE_LIMITS,
  TEXTURE_SIZES,
  takesRoadTexture,
  textureSettings,
} from './geometry/road-texture.js';
import { openTrackLibrary } from './library-store.js';
import { trackWithProfile } from './library-profile.js';
import { piecePreview } from './track-piece-preview.js';
import { END_STOP, packSpecialTrack, shelfSpecialsFor, SPECIAL_SHORT_NAMES } from './pack-specials.js';
import { TURNOUT_MODES, turnoutModeName } from './geometry/turnout-layout.js';
import { openStore, cleanName } from './project.js';
import { esc, icon } from './ui.js';
import { createPlanView } from './planner-view.js';
import { plateDrawing } from './plate-drawing.js';
import { fitPlate } from './geometry/plate.js';
import {
  newLayout,
  endsOf,
  connectedRun,
  snapRun,
  placeSource,
  removeSection,
  reverseSection,
  setElevation,
  canRamp,
  surfaces,
  crossings,
  supportRequests,
  SUPPORT_STYLES,
  supportStyleOf,
  BARRIER_ENDS,
  BARRIER_END_SHAPES,
  BARRIER_TYPES,
  applyBarriers,
  layoutOwned,
  barrierOf,
  plainBarrier,
  isTurnout,
  turnoutChoice,
  applyTurnoutChoice,
  turnoutSideFor,
  returnCurveFor,
  addReturnCurve,
  gapAhead,
  pitLadder,
  ladderSpacing,
  pegSizeOf,
  totalLength,
  tally,
  sourcePartMap,
  validateLayout,
  blockedJoints,
  frameFor,
} from './planner-model.js';
import { slotTitle } from './slot-position.js';
import { zipSync, strToU8 } from 'fflate';
import { clipAttribution } from './geometry/clip-types.js';
import { fitScrewClip, releaseScrewClip } from './clip-instructions.js';
import { assemblyNotes, wiringDiagram } from './special-print.js';
import './planner.css';
import {
  printGroups,
  stlVolume,
  laneLengths,
  shoppingList,
  kitPieceNames,
  screwHardware,
} from './planner-kit.js';
import { loadSettings, MATERIALS } from './settings.js';
import { cacheKey, readPiece, storePiece } from './planner-cache.js';
import { SNAP, bayEnd, bayPose, bayRoom, joinOptions, joinWalkway, layoutBuilding, nearestRow, overGantry, overPose, overlap, pitGarage, placeParts, snapPose, straightAcross } from './planner-buildings.js';
import { buildingLayout, BUILDING_LIMITS, validateBuilding } from './geometry/building.js';
import { sizeLine } from './geometry/grandstand.js';
import { kitNotes } from './building-kit.js';

const fmt = (n) => Number(n.toFixed(1)).toLocaleString();
const btn = (key, label, symbol = '', style = '') =>
  '<button type="button" data-pl="' +
  key +
  '" class="' +
  style +
  '">' +
  (symbol ? icon(symbol) : '') +
  label +
  '</button>';
// The window that asks for the print bed before a layout is cut. It is made
// when it opens and removed when it closes.
const SEGMENT_DIALOG =
    '<dialog class="pl-segment" aria-labelledby="pl-segment-title"><header><h2 id="pl-segment-title">Segment for printing</h2></header>' +
    '<p>Is this your print bed? Every piece that does not fit is cut into the fewest equal segments that do.</p>' +
    '<div class="pl-segment-fields"><label>Width · mm<input type="number" min="10" max="5000" step="any" data-pl-field="bedWidth"></label>' +
    '<label>Depth · mm<input type="number" min="10" max="5000" step="any" data-pl-field="bedDepth"></label>' +
    '<label>Margin · mm<input type="number" min="0" step="any" data-pl-field="bedMargin"></label></div>' +
    '<p class="pl-segment-note" role="status"></p>' +
    '<div class="pl-segment-actions">' +
    btn('segment-cancel', 'Cancel', '', 'secondary') +
    btn('segment-confirm', 'Segment layout', 'split', 'primary') +
    '</div></dialog>';

// The window that asks how a row of pit bays is laid out.
const LADDER_DIALOG =
    '<dialog class="pl-segment pl-ladder" aria-labelledby="pl-ladder-title"><header><h2 id="pl-ladder-title">Pit ladder</h2></header>' +
    '<p>A row of pit bays from the chosen build end: a turnout for each bay, its bay on the branch with an end stop, and building carries on along the main road.</p>' +
    '<div class="pl-segment-fields"><label>Bays<input type="number" min="1" max="12" step="1" data-pl-field="ladderBays"></label>' +
    '<label>Spacing · mm<input type="number" min="1" max="20000" step="any" data-pl-field="ladderSpacing"></label>' +
    '<label>Bay length · mm<input type="number" min="0" max="20000" step="any" data-pl-field="ladderBay"></label></div>' +
    '<label class="pl-ladder-parallel"><input type="checkbox" data-pl-field="ladderParallel"> Bring the bays back parallel to the main road</label>' +
    '<label class="pl-ladder-garage">Garage over each bay<select data-pl-field="ladderGarage"></select></label>' +
    '<p class="pl-segment-note" role="status"></p>' +
    '<div class="pl-segment-actions">' +
    btn('ladder-cancel', 'Cancel', '', 'secondary') +
    btn('ladder-confirm', 'Build ladder', 'plus', 'primary') +
    '</div></dialog>';

const checkedSelect = (val, current) => (val === current ? ' selected' : '');
// ' · slot 35-145 from left' for a piece with an off-centre slot ('slots
// 35/135 from left' for several lanes), nothing otherwise, and nothing after
// a name that already says it.
const slotNote = (p, name = '') => {
  const note = slotTitle(p);
  return note && !name.includes(note) ? ' · ' + note : '';
};
const jointKey = (j) => [j.a.key, j.b.key].sort().join('|');

const snapshot = (layout) => {
  const live = new Set(layout.nodes.map((n) => n.source));
  return {
    ...layout,
    sources: Object.fromEntries(
      Object.entries(layout.sources).filter(([key]) => live.has(key)),
    ),
  };
};
const unopenedKey = 'planner-layout-unopened';
// Reads (value undefined), writes, or deletes (value null) a saved layout.
async function storage(value, key = 'planner-layout') {
  const db = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const reading = value === undefined;
      const tx = db.transaction('workbench', reading ? 'readonly' : 'readwrite');
      const store = tx.objectStore('workbench'),
        req = reading
          ? store.get(key)
          : value === null
            ? store.delete(key)
            : store.put(value, key);
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () =>
        reject(tx.error || Error('Could not access the saved layout.'));
    });
  } finally {
    db.close();
  }
}
// One line on what a section has: its lift, its barriers, its lines.
function liftSummary(n) {
  const [a, b] = n.h;
  if (!a && !b) return 'Level';
  return a === b ? 'Lifted ' + fmt(a) + ' mm' : fmt(a) + ' → ' + fmt(b) + ' mm';
}
const SIDE_NAMES = { outer: 'Outside', inner: 'Inside', both: 'Both sides' };
function markingSummary(params) {
  const m = markingsOf(params);
  const on = [];
  if (m.whiteLineRoad !== 'none' || m.whiteLineBorder !== 'none') on.push('Lines');
  if (m.roadKerbSide !== 'none' || m.kerbEdge !== 'none') on.push('Kerbs');
  return on.length ? on.join(' and ') : 'None';
}
function barrierSummary(def) {
  const b = barrierOf(def);
  const sides = ['outer', 'inner'].filter((side) => b[side].kind !== 'none');
  if (!sides.length) return 'None';
  return sides.length === 2 ? SIDE_NAMES.both : SIDE_NAMES[sides[0]];
}
export function createPlanner({ host, call, download, current, promote }) {
  host.innerHTML =
    '<aside class="pl-catalog">' +
    '<div class="pl-pack"><span class="pl-pack-tile" data-pl-tile></span><label><small>Track pack</small><select data-pl-field="pack"></select></label></div>' +
    '<div class="pl-hand"><span>Corners and branches turn</span><div>' +
    btn('left', 'Left') +
    btn('right', 'Right') +
    '</div></div>' +
    '<div class="pl-hand pl-turnout-as"><span>A turnout</span><div>' +
    btn('split', 'Splits the lane') +
    btn('merge', 'Joins two lanes') +
    '</div></div>' +
    '<div class="pl-cards"></div>' +
    '<div class="pl-group">From Track Set</div>' +
    btn('current', 'Place the open piece', 'plus', 'pl-chip pl-current') +
    '<div class="pl-group">Buildings</div><div class="pl-homes"></div>' +
    '</aside>' +
    '<section class="pl-centre"><header><div class="pl-title"><small class="sf-eyebrow">Track Planner</small>' +
    '<input data-pl-field="name" aria-label="Layout name" maxlength="200"></div>' +
    '<span class="pl-pill" data-pl-pill></span><div class="pl-tools">' +
    '<button type="button" data-pl="undo" class="pl-icon" title="Undo" aria-label="Undo">' + icon('undo') + '</button>' +
    '<button type="button" data-pl="redo" class="pl-icon" title="Redo" aria-label="Redo">' + icon('redo') + '</button>' +
    btn('new', 'New layout', 'plus') +
    btn('library-save', 'Save to Library', 'library', 'pl-soft') +
    '</div></header>' +
    '<div class="pl-toolbar"><div class="pl-tabs">' +
    btn('plan', 'Plan', 'track') +
    btn('solid', '3D', 'box') +
    '</div><span class="pl-sep"></span>' +
    '<label>Build from <select data-pl-field="end" aria-label="Build from open end"></select></label><span class="pl-sep"></span>' +
    btn('fill-gap', 'Fit a straight', 'join') +
    btn('ladder', 'Pit ladder', 'plus') +
    btn('fit', 'Fit view', 'fit') +
    '<span class="pl-grow"></span>' +
    btn('segment', 'Segment for printing', 'split', 'pl-soft') +
    '</div>' +
    '<div class="pl-stage"><svg class="planner-map" role="img" aria-label="Track layout and open ends"></svg><div class="planner-solid" hidden></div>' +
    '<div class="pl-empty"><b>Place your first track piece</b><span>Choose a piece from the column on the left to start the layout.</span></div>' +
    '<div class="pl-message" role="status" hidden></div></div><div class="pl-stats"></div></section>' +
    '<aside class="pl-inspector"><div class="pl-selection"></div>' +
    '<div class="pl-group">This layout</div>' +
    '<details class="pl-inventory" open><summary><span>Parts tally</span><small data-pl-sum="tally"></small></summary><div></div></details>' +
    '<div class="pl-crossings"></div><details class="pl-bed"><summary><span>Print plate</span><small data-pl-sum="plate"></small></summary><div><div class="pl-plate-art"></div>' +
    '<label>Width · mm<input type="number" min="10" max="5000" data-pl-field="width"></label>' +
    '<label>Depth · mm<input type="number" min="10" max="5000" data-pl-field="depth"></label><label>Margin · mm<input type="number" min="0" data-pl-field="margin"></label>' +
    '<small>Pieces are placed whole, with their preset cuts. Segment for printing cuts them to fit this plate.</small></div></details></aside>';
  let layout = newLayout(),
    defs = new Map(),
    cache = new Map(),
    mirrors = new WeakMap(),
    inflight = new Map(),
    pairMemo = new Map(),
    packs = [],
    pack = '',
    hand = 'right',
    turnoutAs = 'split',
    viewMode = 'plan',
    choice = {},
    cards = [],
    // Buildings saved in the Library, to place; and the parts of each building
    // in the layout for the 3D view, by its settings, made once.
    savedHomes = [],
    homeParts = new Map(),
    placedHomes = new Map();
  let rows = [],
    hits = [],
    net = { ends: [], open: [], joints: new Map() },
    misfits = [],
    blocks = [],
    undo = [],
    redo = [],
    busy = false,
    loaded = false,
    serial = 0;
  let saveChain = Promise.resolve(),
    plate = { width: 200, depth: 200, margin: 0 },
    plateSet = false;
  const previewCache = new Map();
  const plateFits = new WeakMap();
  function fitsCurrentPlate(part) {
    const previous = plateFits.get(part);
    if (previous?.plate === plate) return previous.fits;
    const { fits } = fitPlate(
      part.footprintXY,
      plate.width,
      plate.depth,
      plate.margin,
    );
    plateFits.set(part, { plate, fits });
    return fits;
  }
  const $ = (s) => host.querySelector(s),
    field = (k) => $('[data-pl-field="' + k + '"]');
  const view = createPlanView(
    $('.pl-stage'),
    (id, end, extend) => {
      if (busy) return;
      select(id, end, extend);
    },
    (id, delta) => {
      if (busy) return render();
      run(() => moveBuilding(id, delta));
    },
  );
  const homeOf = (id) => (layout.buildings ?? []).find((b) => b.id === id);
  const recipe = (n) => defs.get(n.source);
  const selected = () => layout.nodes.find((n) => n.id === choice.selected);
  const message = (s, bad = false) => {
    const el = $('.pl-message');
    el.textContent = s;
    el.hidden = !s;
    el.classList.toggle('error', bad);
  };
  const activeBtn = (key, state) =>
    $('[data-pl="' + key + '"]').setAttribute('aria-pressed', String(state));
  // Sections picked with Ctrl-click, besides the selected one. Settings that
  // can apply to several sections (barriers) use both.
  let marked = new Set();
  const chosenIds = () => {
    const live = new Set(layout.nodes.map((n) => n.id));
    return new Set([choice.selected, ...marked].filter((id) => live.has(id)));
  };
  function select(id, end, extend = false) {
    // A building is chosen on its own; the build end stays where it was.
    if (homeOf(id)) {
      marked = new Set();
      choice = { ...choice, building: id };
      render();
      return;
    }
    if (extend && choice.selected && id !== choice.selected) {
      if (marked.has(id)) marked.delete(id);
      else marked.add(id);
      render();
      return;
    }
    if (!extend) marked = new Set();
    const open = net.open.filter((e) => e.id === id);
    choice = { selected: id, end: end ?? open.at(-1)?.key ?? choice.end };
    render();
  }
  const usablePlate = (p) =>
    Object.values(p).every(Number.isFinite) &&
    Math.min(p.width, p.depth) >= 10 &&
    Math.max(p.width, p.depth) <= 5000 &&
    p.margin >= 0 &&
    2 * p.margin < Math.min(p.width, p.depth);
  // How many printable parts of the layout are too large for the plate.
  const partsOverPlate = (quantities = tally(layout, defs)) =>
    quantities.reduce(
      (sum, g) =>
        sum +
        (fitsCurrentPlate(sourcePartMap(defs.get(g.source)).get(g.id)) ? 0 : g.count),
      0,
    );
  // A piece recipe remembers the print bed it was checked against. A recipe
  // placed, changed or rebuilt since then, or another bed, needs the check again.
  const bedKey = () => [plate.width, plate.depth, plate.margin].join(' x ');
  const usedSources = (data = layout) => [...new Set(data.nodes.map((n) => n.source))];
  const uncheckedSources = () =>
    usedSources().filter((key) => layout.sources[key].bed !== bedKey());
  const markChecked = (data) => {
    for (const key of usedSources(data)) data.sources[key].bed = bedKey();
  };
  // Cut every piece that does not fit the plate. Nothing is cut when a piece
  // is placed: this runs when the user asks for it and has checked the plate.
  async function segmentLayout() {
    message('Cutting the pieces to fit the print plate…');
    const models = new Map(defs),
      additions = {},
      swaps = new Map(),
      warnings = [];
    for (const [key, entry] of Object.entries(layout.sources)) {
      if (!layout.nodes.some((n) => n.source === key)) continue;
      const def = await build(entry.track, true);
      if (def.warning) warnings.push(entry.name + ': ' + def.warning);
      // Only a piece that comes out in more parts was cut.
      const before = defs.get(key);
      if (
        JSON.stringify(def.track) === JSON.stringify(entry.track) ||
        (def.sections.length === before.sections.length &&
          def.meshes.length === before.meshes.length)
      )
        continue;
      const same = Object.entries({ ...layout.sources, ...additions }).find(
        ([, s]) =>
          s.name === entry.name &&
          JSON.stringify(s.track) === JSON.stringify(def.track),
      );
      const next = same?.[0] ?? 's' + ++serial;
      models.set(next, { ...def, name: entry.name });
      additions[next] = { ...entry, track: def.track };
      swaps.set(key, next);
    }
    const bed = plate.width + ' × ' + plate.depth + ' mm';
    if (!swaps.size) {
      // Nothing to cut, but the bed is confirmed for these pieces.
      if (uncheckedSources().length) await edit((next) => markChecked(next));
      const over = partsOverPlate();
      message(
        over
          ? [over + (over === 1 ? ' part does' : ' parts do') + ' not fit a ' + bed + ' plate and cannot be cut further.', ...warnings].join(' ')
          : 'Every part already fits a ' + bed + ' plate. Nothing was cut. The layout is ready to export.',
        Boolean(over),
      );
      return;
    }
    let cut = 0,
      left = 0;
    await edit((next) => {
      Object.assign(next.sources, additions);
      const samePose = (a, b) => a.x === b.x && a.y === b.y && a.a === b.a && a.flip === b.flip;
      const out = [],
        done = new Set();
      let selected = choice.selected;
      for (const n of next.nodes) {
        if (done.has(n)) continue;
        const to = swaps.get(n.source);
        if (!to) {
          out.push(n);
          continue;
        }
        // The sections of one placed piece share its pose.
        const group = next.nodes.filter((m) => m.source === n.source && samePose(m.pose, n.pose));
        group.forEach((m) => done.add(m));
        const whole =
          group.length === defs.get(n.source).sections.length &&
          new Set(group.map((m) => m.index)).size === group.length;
        const level = group.every((m) => m.h[0] === n.h[0] && m.h[1] === n.h[0]);
        // A piece on a ramp, or with a section removed, keeps its own cuts.
        if (!whole || !level) {
          out.push(...group);
          left++;
          continue;
        }
        const made = models.get(to).sections.map((_, index) => ({
          id: crypto.randomUUID(),
          source: to,
          index,
          pose: { ...n.pose },
          h: [...n.h],
          supports: index === 0 ? Math.max(...group.map((m) => m.supports)) : 0,
          ...(n.supportStyle && { supportStyle: n.supportStyle }),
          ...(n.peg && { peg: [...n.peg] }),
        }));
        if (group.some((m) => m.id === selected)) selected = made.at(-1).id;
        out.push(...made);
        cut++;
      }
      next.nodes = out;
      markChecked(next);
      return { selected };
    }, models);
    const over = partsOverPlate();
    message(
      [
        cut + (cut === 1 ? ' piece was' : ' pieces were') + ' cut to fit a ' + bed + ' plate.',
        left ? left + (left === 1 ? ' piece on a ramp or with a section removed was' : ' pieces on a ramp or with a section removed were') + ' left as placed.' : '',
        over ? over + (over === 1 ? ' part still does' : ' parts still do') + ' not fit.' : 'The layout is ready to export.',
        ...warnings,
      ].filter(Boolean).join(' '),
      Boolean(over),
    );
  }
  // Barriers belong to a piece recipe. A section that gets its own barriers
  // moves to a copy of its recipe with that setting; unused copies are
  // dropped when the layout is saved.
  // The fields of one side in the Barriers panel, and reading them back.
  const barrierOptions = (list, chosen) =>
    list
      .map(
        ([value, label]) =>
          '<option value="' + value + '"' + (chosen === value ? ' selected' : '') + '>' + label + '</option>',
      )
      .join('');
  const barrierFields = (side, title, now) =>
    '<h3>' + title + '</h3>' +
    '<label>Type<select data-pl-field="' + side + 'Kind">' + barrierOptions(BARRIER_TYPES, now.kind) + '</select></label>' +
    '<label>Barrier ends<select data-pl-field="' + side + 'Ends">' + barrierOptions(BARRIER_ENDS, now.ends) + '</select></label>' +
    '<label>End shape<select data-pl-field="' + side + 'Shape">' + barrierOptions(BARRIER_END_SHAPES, now.shape) + '</select></label>' +
    '<label>Height above road · mm<input data-pl-field="' + side + 'Rise" type="number" min="5" max="100" step="any" value="' + now.rise + '"></label>' +
    '<label>Face angle · °<input data-pl-field="' + side + 'Angle" type="number" min="0" max="45" step="any" value="' + now.angle + '"></label>' +
    '<label>Fence on a board<select data-pl-field="' + side + 'Fence">' +
    barrierOptions([['off', 'No fence'], ['on', 'Catch fence']], now.fence ? 'on' : 'off') + '</select></label>' +
    '<label>Fence height · mm<input data-pl-field="' + side + 'FenceHeight" type="number" min="10" max="250" step="any" value="' + now.fenceHeight + '"></label>' +
    '<label>Guard rail start post<select data-pl-field="' + side + 'StartPost">' +
    barrierOptions([['off', 'No start post'], ['on', 'Post at the start']], now.startPost ? 'on' : 'off') + '</select></label>';
  const readBarrierFields = (side) =>
    plainBarrier({
      kind: field(side + 'Kind').value,
      ends: field(side + 'Ends').value,
      shape: field(side + 'Shape').value,
      rise: field(side + 'Rise').valueAsNumber,
      angle: field(side + 'Angle').valueAsNumber,
      fence: field(side + 'Fence').value === 'on',
      fenceHeight: field(side + 'FenceHeight').valueAsNumber,
      startPost: field(side + 'StartPost').value === 'on',
    });
  // A turnout takes no barriers, lines or kerbs: a selection that includes
  // one changes the other sections and leaves it as it is.
  const notTurnout = (entry) => !isTurnout(entry.track.params);
  const chosenTurnouts = () =>
    layout.nodes.filter((n) => chosenIds().has(n.id) && isTurnout(layout.sources[n.source].track.params)).length;
  const setBarriers = (wanted) =>
    changeSections(
      (params) => applyBarriers(params, wanted),
      (entry) => JSON.stringify(barrierOf(entry)) === JSON.stringify(wanted),
      notTurnout,
    );
  // The insert of the selected turnouts. The road is the same for every
  // insert, so nothing moves in the layout.
  const setTurnoutMode = (turnoutMode) =>
    changeSections(
      (params) => applyTurnoutChoice(params, { turnoutMode }),
      (entry) => turnoutChoice(entry.track.params).turnoutMode === turnoutMode,
      (entry) => isTurnout(entry.track.params),
    );
  // White lines and kerbstones for the selected sections.
  const setMarkings = (wanted) =>
    changeSections(
      (params) => Object.assign(params, wanted),
      (entry) => Object.entries(wanted).every(([key, value]) => markingsOf(entry.track.params)[key] === value),
      notTurnout,
    );
  // The road surface texture of the selected sections: plain straights and
  // corners take it, and special pieces in the selection keep a plain road.
  const setTexture = (wanted) =>
    changeSections(
      (params) => Object.assign(params, wanted),
      (entry) => Object.entries(wanted).every(([key, value]) => textureSettings(entry.track.params)[key] === value),
      (entry) => takesRoadTexture(entry.track.params),
    );
  const chosenTextured = () =>
    layout.nodes.filter((n) => chosenIds().has(n.id) && takesRoadTexture(layout.sources[n.source].track.params)).length;
  // Give the selected sections a copy of their recipe with a change in it.
  async function changeSections(change, unchanged, applies = () => true) {
    const ids = chosenIds();
    const models = new Map(defs),
      additions = {},
      swaps = new Map();
    for (const key of new Set(
      layout.nodes.filter((n) => ids.has(n.id)).map((n) => n.source),
    )) {
      const entry = layout.sources[key];
      if (!applies(entry) || unchanged(entry)) continue;
      const track = structuredClone(entry.track);
      change(track.params);
      const def = await build(track, false);
      if (def.sections.length !== defs.get(key).sections.length)
        throw Error('This change alters how the piece is divided. Set it in Track Set instead.');
      const same = Object.entries({ ...layout.sources, ...additions }).find(
        ([, s]) =>
          s.name === entry.name &&
          JSON.stringify(s.track) === JSON.stringify(def.track),
      );
      const next = same?.[0] ?? 's' + ++serial;
      models.set(next, { ...def, name: entry.name });
      // Other parts than were checked against the print bed.
      additions[next] = { ...entry, track: def.track, bed: undefined };
      swaps.set(key, next);
    }
    if (!swaps.size) return;
    await edit((next) => {
      Object.assign(next.sources, additions);
      for (const n of next.nodes)
        if (ids.has(n.id) && swaps.has(n.source)) n.source = swaps.get(n.source);
    }, models);
  }
  // A built piece comes from memory, then from this device's cache, then from
  // the geometry worker. A request for a piece that is already being built
  // (for instance while it is prepared in the background) waits for that build.
  let urgent = 0,
    idleWaiters = [];
  const urgentIdle = () =>
    urgent ? new Promise((resolve) => idleWaiters.push(resolve)) : null;
  // In-memory pieces, least recently used first. Pieces the layout uses stay
  // in its definitions as well, so dropping one here only costs a device read.
  const MEMORY_PIECES = 80;
  function remember(key, value) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > MEMORY_PIECES) cache.delete(cache.keys().next().value);
  }
  async function build(
    track,
    autoFit,
    { mirror = false, background = false } = {},
  ) {
    // The plate can change while this awaits; the piece belongs to this one.
    const bed = plate;
    const recipe = [track, bed, autoFit, mirror];
    const key = JSON.stringify(recipe);
    if (cache.has(key)) {
      const known = cache.get(key);
      remember(key, known);
      return known;
    }
    if (!background) urgent++;
    try {
      if (!inflight.has(key)) {
        const job = (async () => {
          const id = await cacheKey(recipe).catch(() => null);
          const stored = id && (await readPiece(id));
          if (stored) return stored;
          const result = await call(
            'plannerSource',
            { track, plate: bed, autoFit, ...(mirror && { mirrorPockets: true }) },
            { background },
          );
          if (id) storePiece(id, result);
          // A fitted piece is also the result of building its fitted recipe
          // as placed in a layout, so reopening that layout finds it too.
          if (autoFit && !mirror) {
            const placed = [result.track, bed, false, false];
            const alias = await cacheKey(placed).catch(() => null);
            if (alias && alias !== id) storePiece(alias, result);
          }
          return result;
        })();
        inflight.set(key, job);
        job
          .then(
            (result) => {
              remember(key, result);
              if (autoFit && !mirror)
                remember(JSON.stringify([result.track, bed, false, false]), result);
            },
            () => {},
          )
          .finally(() => inflight.delete(key));
      } else if (!background) {
        // Someone now waits for a piece the background started: show Cancel.
        promote?.();
      }
      return await inflight.get(key);
    } finally {
      if (!background && --urgent === 0) {
        idleWaiters.forEach((resolve) => resolve());
        idleWaiters = [];
      }
    }
  }
  // Preparing pieces in the background, one at a time so a click never waits
  // for more than the piece already being built. The layout's own variants go
  // first, then the open catalogue; left-hand variants of catalogue corners
  // only while the 3D view is open.
  let warmQueue = [],
    warming = false;
  function warmUp() {
    const jobs = [];
    for (const n of layout.nodes)
      if (n.pose.flip) {
        const def = defs.get(n.source);
        if (def) jobs.push({ track: def.track, autoFit: false, mirror: true });
      }
    for (const card of cards) {
      const track = card.collection
        ? trackWithProfile(card.track, card.collection.profile)
        : card.track;
      jobs.push({
        track,
        autoFit: false,
        then:
          viewMode === 'solid' && track.params.kind === 'curve'
            ? (def) =>
                warmQueue.push({
                  track: def.track,
                  autoFit: false,
                  mirror: true,
                })
            : null,
      });
    }
    const seen = new Set();
    warmQueue = jobs.filter((job) => {
      const key = JSON.stringify([job.track, job.autoFit, job.mirror]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    pump();
  }
  async function pump() {
    if (warming) return;
    warming = true;
    try {
      // Paused while the Planner is hidden, so Track Set and STL Edit keep the
      // worker to themselves; showing the Planner again resumes it.
      while (warmQueue.length && !host.hidden) {
        await urgentIdle();
        if (host.hidden) break;
        const job = warmQueue.shift();
        try {
          const def = await build(job.track, job.autoFit, {
            mirror: job.mirror,
            background: true,
          });
          job.then?.(def);
        } catch {
          // A piece that cannot be built shows its message when it is placed.
        }
      }
    } finally {
      warming = false;
    }
  }
  function persist() {
    const data = structuredClone({ ...snapshot(layout), plate });
    saveChain = saveChain
      .catch(() => {})
      .then(() => storage(data))
      .catch(() =>
        message(
          'Device storage is unavailable. Save a layout file to keep these changes.',
          true,
        ),
      );
  }
  async function rebuildLayout(data) {
    validateLayout(data);
    const rebuilt = new Map();
    for (const [key, entry] of Object.entries(data.sources)) {
      const existing = defs.get(key);
      const result =
        existing &&
        JSON.stringify(existing.track) === JSON.stringify(entry.track)
          ? existing
          : await build(entry.track, false);
      rebuilt.set(key, { ...result, name: entry.name });
    }
    for (const n of data.nodes)
      if (!rebuilt.get(n.source)?.sections[n.index])
        throw Error('The saved layout references a missing print section.');
    return rebuilt;
  }
  async function calculate(next, models) {
    if (viewMode === 'solid') {
      await mirrorMeshes(next, models);
      await loadHomes(next);
    }
    const rows = surfaces(next, models),
      hits = crossings(rows, pairMemo),
      requests = supportRequests(rows);
    const blocks = requests.length
      ? await call('plannerSupports', { requests, plate })
      : [];
    const net = endsOf(next, models);
    // Ends that touch but stay apart because their slots are out of line.
    const misfits = blockedJoints(net).filter((j) =>
      j.reason.startsWith('slot'),
    );
    return { rows, hits, blocks, net, misfits };
  }
  // The parts of each building in a layout, whole, for the 3D view.
  async function loadHomes(data) {
    const wanted = new Set();
    for (const entry of data.buildings ?? []) {
      const key = JSON.stringify(entry.building);
      wanted.add(key);
      if (!homeParts.has(key)) homeParts.set(key, await call('buildingParts', { building: entry.building, plate, whole: true }));
    }
    for (const key of homeParts.keys()) if (!wanted.has(key)) homeParts.delete(key);
  }
  // Each building's parts where it stands; the same objects while it stays put.
  function homes() {
    const live = new Set();
    const out = (layout.buildings ?? []).flatMap((entry) => {
      const parts = homeParts.get(JSON.stringify(entry.building));
      if (!parts) return [];
      live.add(entry.id);
      const key = JSON.stringify(entry);
      const hit = placedHomes.get(entry.id);
      if (hit?.key === key && hit.parts === parts) return hit.placed;
      const placed = placeParts(parts, entry);
      placedHomes.set(entry.id, { key, parts, placed });
      return placed;
    });
    for (const id of placedHomes.keys()) if (!live.has(id)) placedHomes.delete(id);
    return out;
  }
  const trackLoops = () => rows.flatMap((r) => r.polys);
  // Puts a building from the Library in the middle of the plan in view, along
  // the track if it is near enough.
  async function addBuilding(saved) {
    const [x, y] = view.centre();
    const entry = layoutBuilding(saved, { x, y, a: 0 }, 'b-' + crypto.randomUUID());
    const snapped = snapPose(entry, trackLoops());
    if (snapped) entry.pose = snapped;
    await edit((next) => {
      (next.buildings ??= []).push(entry);
      return { ...choice, building: entry.id };
    });
    message(entry.name + ' was placed' + (snapped ? ' along the track.' : '. Drag it next to the track: dropped near the border, it stands along it.'));
  }
  async function moveBuilding(id, [dx, dy]) {
    if (homeOf(id)?.bay) {
      render();
      return message('This garage stands over a pit bay and moves with it. Delete it to place a building elsewhere.');
    }
    if (homeOf(id)?.over) {
      render();
      return message('This gantry spans a straight and moves with it. Delete it to place it elsewhere.');
    }
    let snapped = null;
    await edit((next) => {
      const entry = next.buildings.find((b) => b.id === id);
      entry.pose = { ...entry.pose, x: entry.pose.x + dx, y: entry.pose.y + dy };
      snapped = snapPose(entry, trackLoops());
      if (snapped) entry.pose = snapped;
      return { ...choice, building: id };
    });
    message(snapped ? 'Standing along the track, its front 1 mm from the border.' : '');
  }
  // A pit bay: the closed end of its end stop, the track there, and the road's height.
  function bayOf(data, models, id) {
    const n = data.nodes.find((m) => m.id === id),
      def = n && models.get(n.source);
    if (!def?.track.params.endStop) return null;
    const polys = surfaces({ nodes: [n] }, models)[0].polys;
    return { n, ...bayEnd(frameFor(n, def)[0], polys), road: Math.max(...n.h) + def.track.params.height, lifted: Math.max(...n.h) > 0 };
  }
  // A garage over a bay stands where the bay ends, wherever the track goes;
  // one whose bay was removed stays where it was.
  function followBays(data, models) {
    for (const entry of data.buildings ?? []) {
      // A gantry over a straight spans it, wherever it goes and however wide it is.
      if (entry.over) {
        const over = straightOf(data, models, entry.over);
        if (over) {
          entry.building = overGantry(entry.building, over.width);
          entry.pose = overPose(entry.building, over);
        } else delete entry.over;
        continue;
      }
      if (!entry.bay) continue;
      const bay = bayOf(data, models, entry.bay);
      if (bay) entry.pose = bayPose(entry.building, bay);
      else delete entry.bay;
    }
  }
  // A straight: the middle of its road, the way it runs, and its width.
  function straightOf(data, models, id) {
    const n = data.nodes.find((m) => m.id === id),
      def = n && models.get(n.source);
    if (!def || def.track.params.kind !== 'straight') return null;
    const ends = frameFor(n, def);
    if (ends.length < 2) return null;
    return straightAcross(ends[0], ends[1], surfaces({ nodes: [n] }, models)[0].polys);
  }
  // A gantry or a footbridge from the Library over the chosen straight.
  async function addGantry() {
    const saved = savedHomes.find((h) => h.id === field('overHome')?.value);
    if (!saved) throw Error('Choose a gantry or a footbridge.');
    const over = straightOf(layout, defs, choice.selected);
    if (!over) throw Error('Select a straight to put a gantry over.');
    const building = overGantry(saved.building, over.width);
    const entry = { ...layoutBuilding({ ...saved, building }, overPose(building, over), 'b-' + crypto.randomUUID()), over: choice.selected };
    await edit((next) => {
      (next.buildings ??= []).push(entry);
      return { ...choice, building: entry.id };
    });
    message(saved.name + ' spans the straight: ' + Math.round(building.span) + ' mm between its ' + (building.type === 'bridge' ? 'staircases' : 'legs') + ', ' + Math.round(building.clearance) + ' mm clear underneath.');
  }
  // For a straight: a gantry over it.
  function overPanel(n, def) {
    if (def.track.params.kind !== 'straight' || def.track.params.endStop) return '';
    const gantries = savedHomes.filter((h) => h.building.kind === 'gantry');
    const over = (layout.buildings ?? []).find((b) => b.over === n.id);
    return (
      '<details class="pl-bridge pl-over"><summary><span>Over the track</span><small>' + (over ? esc(over.name) : 'None') + '</small></summary><div>' +
      (gantries.length
        ? '<label>Gantry<select data-pl-field="overHome">' + gantries.map((h) => '<option value="' + esc(h.id) + '">' + esc(h.name) + '</option>').join('') + '</select></label>' +
          btn('over-one', 'Gantry over this straight', 'plus')
        : '<small>Save a start gantry, a half gantry or a footbridge to the Library on the Buildings page first.</small>') +
      '<small>It spans the straight, its borders and ' + 8 + ' mm each side, its legs or staircases beside it. It follows the straight when the track changes.</small>' +
      '</div></details>'
    );
  }
  // Garages over the pit bays, from a building in the Library: over the
  // chosen bay, or over every bay that has none yet.
  // Garages over the given bays of a layout, from a building in the Library:
  // each made to fit its bay, wider or less deep if need be. Throws, saying
  // what is in the way, when one cannot stand.
  function planGarages(data, models, saved, ids) {
    const rowsOf = surfaces(data, models),
      loops = rowsOf.flatMap((r) => r.polys);
    const stops = data.nodes.filter((n) => models.get(n.source).track.params.endStop).map((n) => n.id);
    const taken = new Set((data.buildings ?? []).map((b) => b.bay).filter(Boolean));
    const bays = ids.map((id) => bayOf(data, models, id));
    if (bays.some((bay) => bay.lifted))
      throw Error('A pit bay on a bridge cannot have a garage: its base stands on the table. Bring the bay down to the table first.');
    // The room across each bay, beside every other bay, with a garage or not.
    const others = [...taken].map((id) => bayOf(data, models, id)).filter(Boolean);
    const deep = validateBuilding(saved.building).depth;
    const rooms = bayRoom([...bays, ...others], deep);
    let shallower = false;
    const entries = bays.map((bay, i) => {
      const number = stops.indexOf(ids[i]) + 1;
      // Its base stands beside the track, so the garage reaches no further
      // back than the bay runs straight: it is made less deep if need be.
      let problem = null,
        last = null;
      for (let depth = deep; depth >= BUILDING_LIMITS.depth[0]; depth -= 5) {
        let building;
        try {
          building = pitGarage({ ...saved.building, depth }, bay.width, bay.road, rooms[i]);
        } catch (err) {
          // Too close to the next bay is final; a storey or a window that no
          // longer fits a shallower garage is not.
          if (depth === deep && /too close together/.test(err.message)) throw err;
          problem ??= err;
          continue;
        }
        const entry = { ...layoutBuilding({ ...saved, name: saved.name + ' · bay ' + number, building }, bayPose(building, bay), 'b-' + crypto.randomUUID()), bay: ids[i] };
        last = entry;
        if (overlap(entry, loops) > 0.5) continue;
        if (depth < deep) shallower = true;
        return entry;
      }
      // Even the shallowest garage stands on the track: say on what.
      const inWay = last ? [...new Set(rowsOf.filter((r) => r.polys.some((loop) => overlap(last, [loop]) > 0.5)).map((r) => r.def.name))] : [];
      throw Error(
        'There is no room for a garage over bay ' + number +
          (inWay.length
            ? ': even ' + last.building.depth + ' mm deep its base would stand on the ' + inWay.join(' and the ') + ' beside it. Space the bays further apart, or make them longer: Spacing and Bay length in the Pit ladder window.'
            : problem
              ? ': ' + problem.message
              : '.'),
      );
    });
    return { entries, shallower };
  }
  const garagesSaid = (count, shallower) =>
    (count === 1
      ? 'A garage stands over the bay: the track runs in through its open door to the end stop.'
      : count + ' garages stand over the pit bays: the track runs into each through its open door.') +
    (shallower ? ' Made less deep than the building, to stand on the straight end of the bay.' : '');
  async function addPitGarages(all) {
    const saved = savedHomes.find((h) => h.id === field('pitHome')?.value);
    if (!saved) throw Error('Choose a building for the pit garages.');
    const stops = layout.nodes.filter((n) => recipe(n).track.params.endStop).map((n) => n.id);
    const taken = new Set((layout.buildings ?? []).map((b) => b.bay).filter(Boolean));
    const ids = (all ? stops : [choice.selected]).filter((id) => !taken.has(id));
    if (!ids.length) throw Error(all ? 'Every pit bay has a garage already.' : 'This bay has a garage already.');
    const { entries, shallower } = planGarages(layout, defs, saved, ids);
    await edit((next) => {
      (next.buildings ??= []).push(...entries);
      return { ...choice, building: entries.at(-1).id };
    });
    message(garagesSaid(entries.length, shallower));
  }
  // For an end stop: a garage over its bay.
  function pitPanel(n, def) {
    if (!def.track.params.endStop) return '';
    const over = (layout.buildings ?? []).find((b) => b.bay === n.id);
    const free = layout.nodes.filter((m) => recipe(m).track.params.endStop && !(layout.buildings ?? []).some((b) => b.bay === m.id)).length;
    return (
      '<details class="pl-bridge pl-pit" open><summary><span>Pit garage</span><small>' + (over ? esc(over.name) : 'None') + '</small></summary><div>' +
      (savedHomes.length
        ? '<label>Building<select data-pl-field="pitHome">' + savedHomes.filter((h) => !h.building.kind || h.building.kind === 'garage').map((h) => '<option value="' + esc(h.id) + '">' + esc(h.name) + '</option>').join('') + '</select></label>' +
          (over ? '' : btn('pit-one', 'Garage over this bay', 'plus')) +
          (free > (over ? 0 : 1) ? btn('pit-all', 'Garages over every bay', 'plus') : '')
        : '<small>Save a building to the Library on the Buildings page first.</small>') +
      '<small>A garage stands over the end of the bay: the track runs in through its open door to the end stop, and its base stands beside the track as high as the road. The door is made wide enough for the track, and the garage no wider than the room between two bays. It moves with the bay.</small>' +
      '</div></details>'
    );
  }
  // Changes the chosen building in the layout.
  function editHome(change) {
    const id = choice.building;
    return edit((next) => {
      const entry = next.buildings.find((b) => b.id === id);
      change(entry);
      return { ...choice, building: id };
    });
  }
  // The road beside a building: how high it is, if a section is near its front.
  function roadBeside(entry) {
    const near = nearestRow(entry, rows);
    if (!near || near.d > 60) return null;
    return Math.max(...near.row.n.h) + near.row.def.track.params.height;
  }
  async function mirrorMeshes(next, models) {
    for (const key of new Set(
      next.nodes.filter((n) => n.pose.flip).map((n) => n.source),
    )) {
      const def = models.get(key);
      if (!def.mirroredParts) {
        // Kept per recipe: the layout's piece entries are copied on every
        // edit, and a fresh mirror would rebuild every left-hand mesh.
        const variant = await build(def.track, false, { mirror: true });
        if (!mirrors.has(variant))
          mirrors.set(variant, new Map(variant.meshes.map((p) => [p.id, p])));
        def.mirroredParts = mirrors.get(variant);
      }
    }
  }
  function adopt(next, models, computed, selection = {}, fit = true) {
    layout = next;
    defs = models;
    ({ rows, hits, blocks, net, misfits } = computed);
    const end =
      net.open.find((e) => e.key === selection.end) ??
      net.open.findLast((e) => e.id === selection.selected) ??
      net.open.at(-1);
    choice = {
      selected: selection.selected ?? end?.id ?? layout.nodes.at(-1)?.id,
      end: end?.key,
      ...(homeOf(selection.building) && { building: selection.building }),
    };
    render(fit);
  }
  async function edit(mutator, models = defs) {
    const next = structuredClone(layout),
      selectedNext = mutator(next) ?? choice;
    followBays(next, models);
    const computed = await calculate(next, models);
    undo.push({ data: layout, choice });
    if (undo.length > 60) undo.shift();
    redo = [];
    const known = new Set(misfits.map(jointKey));
    adopt(next, models, computed, selectedNext);
    persist();
    // An edit that leaves two ends touching with their slots out of line
    // (closing a loop, say) is not refused, so say why they stay open.
    const fresh = misfits.find((j) => !known.has(jointKey(j)));
    if (fresh) message(fresh.text, true);
    return fresh;
  }
  async function travel(from, to) {
    const prior = from.at(-1);
    if (!prior) return;
    const models = await rebuildLayout(prior.data),
      computed = await calculate(prior.data, models);
    to.push({ data: layout, choice });
    from.pop();
    adopt(prior.data, models, computed, prior.choice);
    persist();
  }
  // Every piece of the pack, then the specials it does not have yet, made
  // from its rules.
  function listCards() {
    const collection = packs.find((p) => p.id === pack);
    if (!collection) return [];
    const owned = new Set(collection.pieces.map((p) => p.track.params.special?.type).filter(Boolean));
    return [
      ...collection.pieces.map((p, i) => ({ ...p, index: i, collection })),
      ...[...shelfSpecialsFor(collection.rules.lanes), [END_STOP, 'End stop']]
        .filter(([type]) => !owned.has(type))
        .map(([type, name]) => ({
          name,
          collection,
          special: type,
          chip: true,
          track: packSpecialTrack(collection, type),
        })),
    ];
  }
  function catalog() {
    field('pack').innerHTML = packs
      .map(
        (p) =>
          '<option value="' +
          esc(p.id) +
          '"' +
          checkedSelect(p.id, pack) +
          '>' +
          esc(p.name) +
          '</option>',
      )
      .join('');
    const chosenPack = activePack();
    $('[data-pl-tile]').textContent = (chosenPack?.name ?? '')
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 3)
      .toUpperCase();
    activeBtn('left', hand === 'left');
    activeBtn('right', hand === 'right');
    activeBtn('split', turnoutAs === 'split');
    activeBtn('merge', turnoutAs === 'merge');
    $('.pl-turnout-as').hidden = activePack()?.rules.lanes !== 1;
    cards = listCards();
    const tileOf = (card, i) => {
      const p = card.track.params,
        key = JSON.stringify(p);
      let image = previewCache.get(key);
      if (!image) {
        try {
          const v = p.kind === 'import' ? null : piecePreview(p);
          image = v
            ? '<svg aria-hidden="true" viewBox="' + v.viewBox + '">' + v.marks + '</svg>'
            : icon('sketch');
        } catch {
          image = icon('track');
        }
        previewCache.set(key, image);
      }
      const meta =
        p.kind === 'curve'
          ? fmt(p.angle) + '° · R ' + fmt(p.radius) + ' mm'
          : p.kind === 'straight'
            ? fmt(p.length) + ' × ' + fmt(p.width) + ' mm'
            : 'Custom path';
      return (
        '<button type="button" class="pl-card" data-place="' + i + '" title="Place ' + esc(card.name) + '"><span>' +
        image + '</span><b>' + esc(card.name) + '</b><small>' + meta + esc(slotNote(p, card.name)) + '</small></button>'
      );
    };
    const chipOf = (card, i) =>
      '<button type="button" class="pl-chip" data-place="' + i + '" title="Place a ' + esc(card.name.toLowerCase()) +
      ' made from the pack rules">' + icon('plus') + esc(SPECIAL_SHORT_NAMES[card.special] ?? card.name) + '</button>';
    const groups = [
      ['Straights', (c) => !c.chip && !c.track.params.special && c.track.params.kind === 'straight', tileOf],
      ['Corners', (c) => !c.chip && !c.track.params.special && c.track.params.kind === 'curve', tileOf],
      ['Drawn pieces', (c) => !c.chip && !c.track.params.special && !['straight', 'curve'].includes(c.track.params.kind), tileOf],
      ['Special pieces', (c) => !c.chip && Boolean(c.track.params.special), tileOf],
      ['Add a special piece', (c) => c.chip, chipOf],
    ];
    $('.pl-cards').innerHTML =
      groups
        .map(([title, takes, draw]) => {
          const members = cards.map((card, i) => [card, i]).filter(([card]) => takes(card));
          return members.length
            ? '<div class="pl-group">' + esc(title) + '</div><div class="' + (draw === chipOf ? 'pl-chips' : 'pl-tiles') + '">' +
                members.map(([card, i]) => draw(card, i)).join('') + '</div>'
            : '';
        })
        .join('') || '<p class="pl-note">This pack has no saved pieces.</p>';
    warmUp();
  }
  async function place(card) {
    if (!card) return;
    message('Placing ' + card.name + '…');
    let track = card.collection
      ? trackWithProfile(card.track, card.collection.profile)
      : card.track;
    // A turnout has its branch on the side chosen under Corner and branch
    // direction, as travel sees it; one that joins two lanes lies the other
    // way round.
    const merge = isTurnout(track.params) && turnoutAs === 'merge';
    if (isTurnout(track.params)) {
      track = structuredClone(track);
      applyTurnoutChoice(track.params, { side: turnoutSideFor(hand, merge) });
    }
    // Placed whole, with its preset cuts: Segment for printing fits it to the plate.
    const def = await build(track, false),
      same = Object.entries(layout.sources).find(
        ([, s]) =>
          s.name === card.name &&
          JSON.stringify(s.track) === JSON.stringify(def.track),
      );
    const key = same?.[0] ?? 's' + ++serial,
      models =
        same && defs.has(same[0])
          ? defs
          : new Map(defs).set(key, { ...def, name: card.name });
    // A piece from a pack stays linked to it: when the pack's rules change,
    // the layout rebuilds this piece the next time it opens.
    const ref = !card.collection
      ? undefined
      : card.id
        ? {
            collectionId: card.collection.id,
            pieceId: card.id,
            revision: card.collection.revision,
          }
        : card.special
          ? {
              collectionId: card.collection.id,
              special: card.special,
              revision: card.collection.revision,
            }
          : undefined;
    const fresh = await edit((next) => {
      next.sources[key] = {
        name: card.name,
        track: def.track,
        ...(ref && { ref }),
      };
      return placeSource(next, models, key, choice.end, hand, { merge });
    }, models);
    message(
      [def.warning, fresh?.text].filter(Boolean).join(' '),
      Boolean(fresh),
    );
  }
  // ---- Helpers for a pit lane built from turnouts ----
  const activePack = () => packs.find((p) => p.id === pack);
  const packRef = (collection, extra) => ({
    collectionId: collection.id,
    revision: collection.revision,
    ...extra,
  });
  // The piece recipes of one edit: each is built, and shared with a recipe
  // the layout already has.
  function recipeBook() {
    const models = new Map(defs),
      additions = {};
    async function add(name, track, ref) {
      const def = await build(track, false);
      const same = Object.entries({ ...layout.sources, ...additions }).find(
        ([, s]) => s.name === name && JSON.stringify(s.track) === JSON.stringify(def.track),
      );
      const key = same?.[0] ?? 's' + ++serial;
      if (!models.has(key)) models.set(key, { ...def, name });
      if (!same) additions[key] = { name, track: def.track, ...(ref && { ref }) };
      return key;
    }
    return { models, additions, add };
  }
  // The pack's plain straight, at a length of its own.
  function packStraight(collection, length) {
    const piece = collection?.pieces.find(
      ({ track }) => track.params.kind === 'straight' && !track.params.special && !track.params.endStop,
    );
    if (!piece)
      throw Error('The chosen pack has no plain straight to make to length. Add one in Track Set.');
    const track = structuredClone(trackWithProfile(piece.track, collection.profile));
    Object.assign(track.params, { length, segments: 1, borderSegments: 1 });
    delete track.params.startingGrid;
    return { name: 'Straight ' + fmt(length) + ' mm', track };
  }
  function packReturnCurve(collection, turnout) {
    const found = collection && returnCurveFor(collection.pieces, turnout);
    if (!found)
      throw Error(
        'The chosen pack has no corner whose angle divides the branch angle of ' +
          fmt(turnout.special.turnoutAngle) +
          '°. Add one in Track Set, or change the Branch angle of the turnout.',
      );
    return found;
  }
  // A straight made to the length of the gap between the build end and the
  // open end that faces it.
  async function fillGap() {
    const gap = gapAhead(net, choice.end);
    if (!gap)
      throw Error(
        'No open end faces the chosen build end in a straight line. Choose the end to build from under Build from; the two ends must be in line and at the same height.',
      );
    const { name, track } = packStraight(activePack(), gap.length);
    const book = recipeBook();
    const key = await book.add(name, track).catch((error) => {
      throw Error(
        'The gap is ' + fmt(gap.length) + ' mm, and a straight of that length cannot be made. ' + error.message,
      );
    });
    const fresh = await edit((next) => {
      Object.assign(next.sources, book.additions);
      return placeSource(next, book.models, key, gap.from.key);
    }, book.models);
    const joined = !net.open.some((e) => e.key === gap.to.key);
    message(
      joined
        ? 'A straight of ' + fmt(gap.length) + ' mm closes the gap.'
        : 'A straight of ' + fmt(gap.length) + ' mm fills the gap, but its far end does not join. ' +
          (fresh?.text ?? 'The connectors of the two ends do not mate: both are the same end of their pieces. Use clips at these joints, or turn one run around.'),
      !joined,
    );
  }
  // The corners that bring the branch of the selected turnout back parallel.
  async function returnCurve() {
    const n = selected(),
      def = n && recipe(n);
    if (!def || !isTurnout(def.track.params)) throw Error('Select a turnout first.');
    const collection = activePack();
    const found = packReturnCurve(collection, def.track.params);
    const book = recipeBook();
    const key = await book.add(
      found.piece.name,
      trackWithProfile(found.piece.track, collection.profile),
      packRef(collection, { pieceId: found.piece.id }),
    );
    await edit((next) => {
      Object.assign(next.sources, book.additions);
      return addReturnCurve(next, book.models, n.id, key, found.count);
    }, book.models);
    message(
      found.count + ' × ' + found.piece.name + ' ' + (found.count === 1 ? 'brings' : 'bring') +
        ' the branch back parallel to the main road.',
    );
  }
  // What a row of pit bays is made of in the chosen pack, before it is built.
  function ladderParts() {
    const collection = activePack();
    if (!collection || collection.rules.lanes !== 1)
      throw Error('A pit ladder is built from turnouts, which are single-lane pieces. Choose a single-lane pack.');
    const turnout = structuredClone(
      trackWithProfile(packSpecialTrack(collection, 'turnout'), collection.profile),
    );
    applyTurnoutChoice(turnout.params, { side: hand });
    const stop = trackWithProfile(packSpecialTrack(collection, END_STOP), collection.profile);
    return { collection, turnout, stop };
  }
  // The least spacing that keeps neighbouring bays apart.
  function leastSpacing({ collection, turnout, stop }, bayLength, parallel) {
    const corner = parallel && returnCurveFor(collection.pieces, turnout.params);
    return ladderSpacing(turnout.params, {
      bayLength,
      stopLength: stop.params.length,
      cornerRadius: corner ? corner.piece.track.params.radius : 0,
    });
  }
  async function ladder({ bays, spacing, bayLength, parallel, garage = '' }) {
    const parts = ladderParts(),
      { collection, turnout, stop } = parts;
    if (![bays, spacing, bayLength].every(Number.isFinite) || bayLength < 0)
      throw Error('Enter the number of bays, their spacing and the bay length.');
    const length = turnout.params.length;
    if (spacing < length)
      throw Error('The spacing is from one turnout to the next, so it must be at least the length of a turnout: ' + fmt(length) + ' mm.');
    const found = parallel ? packReturnCurve(collection, turnout.params) : null;
    const book = recipeBook();
    const keys = {
      turnout: await book.add('Turnout', turnout, packRef(collection, { special: 'turnout' })),
      stop: await book.add('End stop', stop, packRef(collection, { special: END_STOP })),
    };
    if (found)
      keys.curve = await book.add(
        found.piece.name,
        trackWithProfile(found.piece.track, collection.profile),
        packRef(collection, { pieceId: found.piece.id }),
      );
    const made = async (millimetres, what, instead) => {
      const { name, track } = packStraight(collection, millimetres);
      return book.add(name, track).catch((error) => {
        throw Error(
          'The straight of ' + fmt(millimetres) + ' mm ' + what + ' cannot be made. ' + error.message + ' ' + instead,
        );
      });
    };
    if (bayLength > 0)
      keys.bay = await made(bayLength, 'in each bay', 'Use a longer bay, or a bay length of 0 for an end stop straight after the turnout.');
    const spaced = async (gap) => {
      delete keys.spacer;
      if (gap - length > 0.001)
        keys.spacer = await made(
          gap - length,
          'between two turnouts',
          'Use a spacing of ' + fmt(length) + ' mm, with no straight between the turnouts, or a larger one.',
        );
    };
    // The bays of a ladder: its end stops, new in the layout.
    const build = (next) => {
      const before = new Set(next.nodes.map((n) => n.id));
      Object.assign(next.sources, book.additions);
      const at = pitLadder(next, book.models, keys, { bays, end: choice.end, curves: found?.count ?? 0 });
      return { at, stops: next.nodes.filter((n) => !before.has(n.id) && book.models.get(n.source).track.params.endStop).map((n) => n.id) };
    };
    // With a garage over each bay: the spacing grows until one fits.
    const home = garage && savedHomes.find((h) => h.id === garage);
    let gap = spacing,
      shallower = false;
    if (home) {
      let fitted = false,
        problem = null;
      for (; gap <= spacing + 1500; gap += 50) {
        await spaced(gap);
        try {
          const trial = structuredClone(layout);
          planGarages(trial, book.models, home, build(trial).stops);
          fitted = true;
          break;
        } catch (error) {
          problem = error;
        }
      }
      if (!fitted)
        throw Error(
          'There is no room for a garage over each bay, even with the bays ' + fmt(spacing + 1500) + ' mm apart. ' +
            (problem.message === 'ladder-overlap' ? 'The bays run into the layout.' : problem.message),
        );
    } else await spaced(spacing);
    try {
      await edit((next) => {
        const { at, stops } = build(next);
        if (!home) return at;
        const planned = planGarages(next, book.models, home, stops);
        shallower = planned.shallower;
        (next.buildings ??= []).push(...planned.entries);
        return at;
      }, book.models);
    } catch (error) {
      if (error.message !== 'ladder-overlap') throw error;
      throw Error(
        'The bays would run into each other or into the layout. Use a spacing of at least ' +
          fmt(leastSpacing(parts, bayLength, parallel)) +
          ' mm, shorter bays, or build from an end with more room beside it.',
      );
    }
    message(
      bays + (bays === 1 ? ' pit bay was' : ' pit bays were') + ' added' +
        (home && gap > spacing ? ', ' + fmt(gap) + ' mm apart to leave room for the garages' : '') +
        '. Every piece can still be changed or removed.' +
        (home ? ' ' + garagesSaid(bays, shallower) : ''),
    );
  }
  function render(fit = false) {
    const home = homeOf(choice.building),
      n = home ? null : selected(),
      def = n && recipe(n);
    if (document.activeElement !== field('name'))
      field('name').value = layout.name;
    for (const k of ['width', 'depth', 'margin']) field(k).value = plate[k];
    const names = new Map(
      layout.nodes.map((n, i) => [n.id, i + 1 + ' · ' + recipe(n).name]),
    );
    field('end').innerHTML = net.open.length
      ? net.open
          .map(
            (e) =>
              '<option value="' +
              e.key +
              '"' +
              checkedSelect(e.key, choice.end) +
              '>' +
              esc(names.get(e.id)) +
              ' · ' +
              ['A', 'B', 'C', 'D'][e.i] +
              '</option>',
          )
          .join('')
      : '<option>' +
        (layout.nodes.length ? 'Closed layout' : 'First piece') +
        '</option>';
    field('end').disabled = !net.open.length;
    $('[data-pl="current"]').disabled = current().mode !== 'track';
    $('.pl-empty').hidden = !!layout.nodes.length || !!layout.buildings?.length;
    activeBtn('plan', viewMode === 'plan');
    activeBtn('solid', viewMode === 'solid');
    $('[data-pl="undo"]').disabled = !undo.length;
    $('[data-pl="redo"]').disabled = !redo.length;
    $('.pl-selection').innerHTML = n
      ? '<small class="sf-eyebrow">Selected section</small><h2>' +
        esc(def.name) +
        '</h2><p>Section ' +
        (n.index + 1) +
        ' of ' +
        def.sections.length +
        (def.track.params.kind === 'curve'
          ? ' · ' + (n.pose.flip ? 'Left' : 'Right')
          : '') +
        (isTurnout(def.track.params)
          ? ' · Branch to the ' + turnoutChoice(def.track.params).side +
            ' · ' + esc(turnoutModeName(turnoutChoice(def.track.params).turnoutMode))
          : '') +
        esc(slotNote(def.track.params, def.name)) +
        '</p><div class="pl-selection-actions">' +
        (def.track.params.kind === 'curve' ||
        def.track.params.special?.type === 'chicane'
          ? btn('reverse', 'Reverse turn', 'reset')
          : '') +
        btn('remove', 'Delete', 'close') +
        '</div>' +
        '<div class="pl-group">This section</div>' +
        pitPanel(n, def) +
        overPanel(n, def) +
        '<details class="pl-bridge"><summary><span>Bridge and approaches</span><small>' + esc(liftSummary(n)) + '</small></summary><div><label>Lift at A · mm<input data-pl-field="a" type="number" min="0" max="500" value="' +
        n.h[0] +
        '"></label>' +
        '<label>Lift at B · mm<input data-pl-field="b" type="number" min="0" max="500" value="' +
        n.h[1] +
        '" ' +
        (canRamp(n, def) ? '' : 'disabled') +
        '></label>' +
        '<label>Supports<input data-pl-field="supports" type="number" min="0" max="32" value="' +
        n.supports +
        '"></label><label>Support type<select data-pl-field="style">' +
        SUPPORT_STYLES.map(
          ([value, label]) =>
            '<option value="' +
            value +
            '"' +
            (supportStyleOf(n) === value ? ' selected' : '') +
            '>' +
            label +
            '</option>',
        ).join('') +
        '</select></label>' +
        '<label>Peg width · mm<input data-pl-field="pegAcross" type="number" min="5" max="100" step="any" value="' +
        pegSizeOf(n)[0] +
        '"></label>' +
        '<label>Peg length · mm<input data-pl-field="pegAlong" type="number" min="5" max="100" step="any" value="' +
        pegSizeOf(n)[1] +
        '"></label>' +
        '<small>Pegs stand in pairs, one under each road edge, so a count of 2 gives four pegs. Width is across the road and length is along it. Their tops follow the slope of the road. New pieces carry on the climb and the supports of the piece they join.</small><small>Lift is measured under the road. Connected ends follow the lift. Use a straight for a ramp.</small>' +
        btn('elevate', 'Apply heights', 'check') +
        '</div></details>' +
        (isTurnout(def.track.params)
          ? '<details class="pl-bridge pl-turnout" open><summary><span>Turnout insert</span><small>' + esc(turnoutModeName(turnoutChoice(def.track.params).turnoutMode)) + '</small></summary><div>' +
            '<label>Insert<select data-pl-field="turnoutMode">' +
            barrierOptions(TURNOUT_MODES, turnoutChoice(def.track.params).turnoutMode) +
            '</select></label>' +
            '<small>' +
            (chosenTurnouts() > 1 ? chosenTurnouts() + ' turnouts are selected. ' : 'Only this turnout gets the insert. ') +
            'Digital has a blade worked by a motor, Hand-set point a blade set by hand, Analog an open split and Closed a road straight on. The road is the same for all four, so the insert can be swapped later. End C is the branch. A turnout takes no barriers, lines or kerbs yet.</small>' +
            btn('turnout-mode', chosenTurnouts() > 1 ? 'Apply to ' + chosenTurnouts() + ' turnouts' : 'Apply insert', 'check') +
            (net.open.some((e) => e.key === n.id + ':2')
              ? '<small>The branch is open. A return curve turns it back parallel to the main road, with corners of the chosen pack.</small>' +
                btn('return-curve', 'Add return curve', 'reset')
              : '') +
            '</div></details>'
          : '') +
        '<details class="pl-bridge pl-barriers"' + (isTurnout(def.track.params) ? ' hidden' : '') + '><summary><span>Barriers</span><small>' + esc(barrierSummary(def)) + '</small></summary><div>' +
        barrierFields('outer', 'Outside / left', barrierOf(def).outer) +
        barrierFields('inner', 'Inside / right', barrierOf(def).inner) +
        '<small>' +
        (chosenIds().size > 1
          ? chosenIds().size + ' sections are selected. '
          : 'Only this section gets the barriers. ') +
        'Ctrl-click sections in the plan to select more than one. Each side has its own type and settings; choose None for a side without a barrier. A sloped end is for the section where a row of barriers stops. Face angle and end shape are for a concrete barrier; the fence stands on an advertising board. A guard rail comes from the post of the section before it: give the first section of a row a start post.</small>' +
        btn('barriers', chosenIds().size > 1 ? 'Apply to ' + chosenIds().size + ' sections' : 'Apply barriers', 'check') +
        '</div></details>' +
        '<details class="pl-bridge pl-markings"' + (isTurnout(def.track.params) ? ' hidden' : '') + '><summary><span>Lines and kerbs</span><small>' + esc(markingSummary(def.track.params)) + '</small></summary><div>' +
        '<label>White lines on the road<select data-pl-field="lineRoad">' + barrierOptions(MARKING_SIDES, markingsOf(def.track.params).whiteLineRoad) + '</select></label>' +
        '<label>White lines on the borders<select data-pl-field="lineBorder">' + barrierOptions(MARKING_SIDES, markingsOf(def.track.params).whiteLineBorder) + '</select></label>' +
        '<label>Kerbs on the road<select data-pl-field="kerbRoad">' + barrierOptions(MARKING_SIDES, markingsOf(def.track.params).roadKerbSide) + '</select></label>' +
        '<label>Kerbs on the borders<select data-pl-field="kerbBorder">' + barrierOptions(KERB_EDGES, markingsOf(def.track.params).kerbEdge) + '</select></label>' +
        '<small>' +
        (chosenIds().size > 1
          ? chosenIds().size + ' sections are selected. '
          : 'Only this section gets these markings. ') +
        'Ctrl-click or Shift-click sections in the plan to select more than one. Line and kerb sizes come from the piece: set them in Track Set or in the Pack rules. Border markings show on sections that have borders.</small>' +
        btn('markings', chosenIds().size > 1 ? 'Apply to ' + chosenIds().size + ' sections' : 'Apply markings', 'check') +
        '</div></details>' +
        (takesRoadTexture(def.track.params)
          ? '<details class="pl-bridge pl-texture"><summary><span>Road surface</span><small>' + esc(textureSettings(def.track.params).roadTexture === 'none' ? 'Plain' : 'Cobbles') + '</small></summary><div>' +
            '<label>Texture<select data-pl-field="texKind">' + barrierOptions(TEXTURE_CHOICES, textureSettings(def.track.params).roadTexture) + '</select></label>' +
            '<label>Stone size<select data-pl-field="texSize">' + barrierOptions(TEXTURE_SIZES, textureSettings(def.track.params).textureSize) + '</select></label>' +
            '<label>Custom size · %<input data-pl-field="texScale" type="number" min="' + TEXTURE_LIMITS.textureScale[0] + '" max="' + TEXTURE_LIMITS.textureScale[1] + '" step="any" value="' + textureSettings(def.track.params).textureScale + '"></label>' +
            '<label>Joint width · mm<input data-pl-field="texJoint" type="number" min="' + TEXTURE_LIMITS.textureJoint[0] + '" max="' + TEXTURE_LIMITS.textureJoint[1] + '" step="any" value="' + textureSettings(def.track.params).textureJoint + '"></label>' +
            '<label>Joint depth · mm<input data-pl-field="texDepth" type="number" min="' + TEXTURE_LIMITS.textureDepth[0] + '" max="' + TEXTURE_LIMITS.textureDepth[1] + '" step="any" value="' + textureSettings(def.track.params).textureDepth + '"></label>' +
            '<label>Along the piece<select data-pl-field="texFit">' + barrierOptions(TEXTURE_FITS, textureSettings(def.track.params).textureFit) + '</select></label>' +
            '<small>' +
            (chosenIds().size > 1
              ? chosenTextured() + ' of the ' + chosenIds().size + ' selected sections are straights or corners and take the texture. '
              : 'Only this section gets the texture. ') +
            'The joints between the stones are cut into the road. Custom size is used with the stone size Custom. Same size everywhere starts the pattern again at each track joint; Fit to each piece lines the joints up from piece to piece. Small stones take longer to build and make large files.</small>' +
            btn('texture', chosenIds().size > 1 ? 'Apply to ' + chosenTextured() + ' sections' : 'Apply texture', 'check') +
            '</div></details>'
          : '')
      : home
        ? homePanel(home)
        : '<small class="sf-eyebrow">Selected section</small><h2>None</h2><p>Click a section in the plan to change its height, barriers, lines or road surface. Click a building to move or turn it.</p>';
    const from = net.open.find((e) => e.key === choice.end),
      members = from && connectedRun(net, from.id);
    const others = members ? net.open.filter((e) => !members.has(e.id)) : [];
    if (others.length)
      $('.pl-selection').insertAdjacentHTML(
        'beforeend',
        '<details class="pl-join"><summary>Snap disconnected runs</summary><p>Move the run at the chosen build end to meet another open end.</p><select data-pl-field="mate" aria-label="Destination end">' +
          others
            .map(
              (e) =>
                '<option value="' +
                e.key +
                '">' +
                esc(names.get(e.id)) +
                ' · ' +
                ['A', 'B', 'C', 'D'][e.i] +
                '</option>',
            )
            .join('') +
          '</select>' +
          btn('join', 'Snap ends', 'join') +
          '</details>',
      );
    const quantities = tally(layout, defs),
      count = quantities.reduce((sum, g) => sum + g.count, blocks.length);
    const grouped = new Map();
    for (const g of quantities) {
      const label =
        g.role === 'road'
          ? layout.sources[g.source].name +
            slotNote(layout.sources[g.source].track.params, layout.sources[g.source].name) +
            (layout.sources[g.source].track.params.kind === 'curve'
              ? ' · ' + (g.mirror ? 'L' : 'R')
              : isTurnout(layout.sources[g.source].track.params)
                ? ' · ' + (turnoutChoice(layout.sources[g.source].track.params).side === 'left' ? 'L' : 'R')
                : '')
          : g.name.replace(/\s+\d+$/, '');
      grouped.set(label, (grouped.get(label) ?? 0) + g.count);
    }
    // A building is counted as its parts, whole: export cuts them to fit the plate.
    let homeCount = 0;
    for (const entry of layout.buildings ?? []) {
      const parts = buildingLayout(entry.building).parts.length;
      homeCount += parts;
      grouped.set(entry.name + ' · building', (grouped.get(entry.name + ' · building') ?? 0) + parts);
    }
    if (blocks.length)
      grouped.set(
        'Bridge supports',
        (grouped.get('Bridge supports') || 0) + blocks.length,
      );
    const parts = count + homeCount;
    $('[data-pl-sum="tally"]').textContent = parts ? parts + (parts === 1 ? ' part' : ' parts') : '';
    $('[data-pl-sum="plate"]').textContent = fmt(plate.width) + ' × ' + fmt(plate.depth) + ' mm';
    $('.pl-plate-art').innerHTML = plateDrawing(plate);
    $('.pl-inventory > div').innerHTML =
      [...grouped]
        .map(
          ([k, v]) => '<div><span>' + esc(k) + '</span><b>×' + v + '</b></div>',
        )
        .join('') || '<p>No parts placed</p>';
    $('.pl-crossings').innerHTML = hits.length
      ? '<h3>Crossings</h3>' +
        hits
          .map(
            (h, i) =>
              '<button type="button" data-cross="' +
              i +
              '">' +
              icon('layers') +
              '<span>' +
              esc(names.get(h.a)) +
              ' / ' +
              esc(names.get(h.b)) +
              '<small>' +
              (h.clearance > 0
                ? fmt(h.clearance) + ' mm headroom'
                : 'Roads overlap at this height') +
              '</small></span></button>',
          )
          .join('')
      : '';
    if (misfits.length)
      $('.pl-crossings').insertAdjacentHTML(
        'beforeend',
        '<h3>Slots out of line</h3>' +
          misfits
            .map(
              (j, i) =>
                '<button type="button" data-misfit="' +
                i +
                '">' +
                icon('join') +
                '<span>' +
                esc(names.get(j.a.id)) +
                ' / ' +
                esc(names.get(j.b.id)) +
                '<small>' +
                esc(j.text) +
                '</small></span></button>',
            )
            .join(''),
      );
    const over = partsOverPlate(quantities);
    const chip = (text, warn = false) => '<span' + (warn ? ' class="warn"' : '') + '>' + esc(text) + '</span>';
    const openText = net.open.length
      ? net.open.length + (net.open.length === 1 ? ' open end' : ' open ends')
      : layout.nodes.length
        ? 'Closed layout'
        : '0 open ends';
    $('.pl-stats').innerHTML = [
      chip(layout.nodes.length + ' sections'),
      chip(count + homeCount + ' printable parts'),
      layout.buildings?.length ? chip(layout.buildings.length + (layout.buildings.length === 1 ? ' building' : ' buildings')) : '',
      chip(fmt(totalLength(layout, defs) / 1000) + ' m road'),
      chip(openText, net.open.length > 0),
      misfits.length
        ? chip(misfits.length + (misfits.length === 1 ? ' joint' : ' joints') + ' with slots out of line', true)
        : '',
      over ? chip(over + ' over plate', true) : '',
    ]
      .filter(Boolean)
      .join(' ');
    // The state of the layout, beside its name.
    const pill = $('[data-pl-pill]');
    const state = !layout.nodes.length
      ? ['Empty layout', '']
      : misfits.length || hits.some((h) => !(h.clearance > 0))
        ? ['Check the joints', 'warn']
        : net.open.length
          ? [openText, 'warn']
          : ['Closed loop', 'ok'];
    pill.textContent = state[0];
    pill.className = 'pl-pill ' + state[1];
    view.draw(
      {
        rows,
        ends: net.open,
        chosen: choice.end,
        selected: n?.id,
        defs,
        blocks,
        blocked: misfits,
        marked: new Set([...marked].filter((id) => id !== n?.id)),
        buildings: layout.buildings ?? [],
        building: home?.id ?? null,
        homes: viewMode === 'solid' ? homes() : [],
      },
      fit,
    );
  }
  // The right panel for a building in the layout: where it stands, and its height.
  function homePanel(entry) {
    const b = entry.building,
      stand = ['sections', 'footprint', 'grandstand', 'gantry', 'marshalpost', 'flagpost', 'billboard', 'switchback', 'bench', 'tyrebridge', 'picnic', 'platform', 'walkway'].includes(b.kind),
      pits = b.kind === 'pitmodule' || b.kind === 'pitbays',
      storeys = stand || pits ? 0 : b.upper.length + 1;
    if (entry.over)
      return (
        '<small class="sf-eyebrow">Selected building</small><h2>' + esc(entry.name) + '</h2><p>' + esc(sizeLine(b)) + ' · over a straight</p>' +
        '<div class="pl-selection-actions">' + btn('remove', 'Delete', 'close') + '</div>' +
        '<p class="pl-note">It spans the straight, ' + fmt(b.clearance) + ' mm clear underneath, its ' + (b.type === 'bridge' ? 'staircases' : 'legs') + ' beside the track. It moves with the straight, and takes its width. Delete it to free the straight.</p>'
      );
    if (entry.bay)
      return (
        '<small class="sf-eyebrow">Selected building</small><h2>' + esc(entry.name) + '</h2><p>' +
        fmt(b.width) + ' × ' + fmt(b.depth) + ' mm · over a pit bay</p>' +
        '<div class="pl-selection-actions">' + btn('remove', 'Delete', 'close') + '</div>' +
        '<p class="pl-note">The track runs in through its open door, ' + fmt(b.doorWidth) + ' mm wide, to the end stop; its base stands beside the track, ' +
        fmt(b.baseHeight) + ' mm high like the road. It moves with the bay. Delete it to free the bay.</p>' +
        (overlap(entry, trackLoops()) > 0.5 ? '<p class="pl-note warn">Its base now stands on the track: the bay runs straight for less than the depth of the garage. Delete it, or make the bay longer.</p>' : '')
      );
    const onTrack = overlap(entry, trackLoops()) > 0.5;
    const road = roadBeside(entry);
    const level = stand || (road !== null && Math.abs(road - b.baseHeight) < 0.05);
    const [lo, hi] = BUILDING_LIMITS.baseHeight;
    const degrees = Math.round((((entry.pose.a * 180) / Math.PI) % 360 + 360) % 360 * 10) / 10;
    return (
      '<small class="sf-eyebrow">Selected building</small><h2>' + esc(entry.name) + '</h2><p>' +
      (stand || pits ? esc(sizeLine(b)) : fmt(b.width) + ' × ' + fmt(b.depth) + ' mm · ' + (storeys === 1 ? 'one storey' : storeys + ' storeys')) + '</p>' +
      '<div class="pl-selection-actions">' + btn('b-turn', 'Turn 90°', 'reset') + btn('b-snap', 'Stand along the track', 'join') + btn('remove', 'Delete', 'close') + '</div>' +
      '<div class="pl-group">This building</div>' +
      '<details class="pl-bridge pl-home-place" open><summary><span>Place</span><small' + (onTrack ? ' class="warn"' : '') + '>' + (onTrack ? 'On the track' : 'Clear of the track') + '</small></summary><div>' +
      '<label>X · mm<input data-pl-field="homeX" type="number" step="any" value="' + Math.round(entry.pose.x * 10) / 10 + '"></label>' +
      '<label>Y · mm<input data-pl-field="homeY" type="number" step="any" value="' + Math.round(entry.pose.y * 10) / 10 + '"></label>' +
      '<label>Facing · °<input data-pl-field="homeA" type="number" step="any" value="' + degrees + '"></label>' +
      '<small>Drag the building in the plan to move it. Dropped near the track, it stands with its front' + (b.kind === 'marshalpost' ? ', the front of the cabin,' : b.kind === 'flagpost' ? ', the front rail,' : b.kind === 'billboard' ? ', the face of the board,' : b.kind === 'switchback' ? ', the open side of the flights,' : b.kind === 'bench' ? ', the front of the seats,' : b.kind === 'tyrebridge' ? ', the front sidewall,' : b.kind === 'picnic' ? ', the front seat,' : b.kind === 'platform' ? ', the front of the deck,' : stand ? ', the parapet,' : ', the garage door,') + ' along the outside of the border, 1 mm from it. X and Y are the middle of its base; at 0° its front faces down the plan.</small>' +
      btn('b-place', 'Apply place', 'check') +
      '</div></details>' +
      (b.kind === 'walkway' && !b.towers ? joinPanel() : '') +
      (stand ? '' :
      '<details class="pl-bridge pl-home-height"' + (level ? '' : ' open') + '><summary><span>Height</span><small' + (road === null || level ? '' : ' class="warn"') + '>Base ' + fmt(b.baseHeight) + ' mm</small></summary><div>' +
      '<p class="pl-note">' +
      (road === null
        ? 'No track beside its front.'
        : level
          ? 'The doorstep is level with the road beside it, ' + fmt(road) + ' mm above the table.'
          : 'The road beside it is ' + fmt(road) + ' mm above the table; the base is ' + fmt(b.baseHeight) + ' mm.') +
      '</p>' +
      (road !== null && !level && road >= lo && road <= hi ? btn('b-level', 'Match the road', 'check') : '') +
      '<small>The base stands on the table: as high as the road beside it, the doorstep is level. This changes the building in this layout only, not the one in the Library.</small>' +
      '</div></details>')
    );
  }
  // A walkway between two buildings of the layout: which two, at which floor.
  function joinPanel() {
    const options = joinOptions((layout.buildings ?? []).filter((e) => e.id !== choice.building));
    return (
      '<details class="pl-bridge pl-home-join" open><summary><span>Join two buildings</span><small>' + (options.length ? options.length + (options.length === 1 ? ' way' : ' ways') : 'None') + '</small></summary><div>' +
      (options.length
        ? '<label>Between<select data-pl-field="join">' + options.map((o) => '<option value="' + esc(o.a + '|' + o.b + '|' + o.z) + '">' + esc(o.label) + '</option>').join('') + '</select></label>' + btn('b-join', 'Join them', 'join')
        : '') +
      '<small>' +
      (options.length
        ? 'The walkway runs straight from the wall of one to the wall of the other, between the middles of the storeys it joins, its deck at their floor. It rests on them, without legs. Give each building a doorway there: a door in that wall on the Buildings page.'
        : 'Place two buildings with a floor at the same height: a storey above the ground floor, or the top of a base on a stand.') +
      '</small></div></details>'
    );
  }
  // The buildings saved in the Library, to place in the layout.
  function homeList() {
    $('.pl-homes').innerHTML = savedHomes.length
      ? '<div class="pl-chips">' +
        savedHomes
          .map(
            (h) =>
              '<button type="button" class="pl-chip" data-home="' + esc(h.id) + '" title="Place ' + esc(h.name) + ' in the layout">' + icon('building') +
              esc(h.name) + '<small>' + esc(sizeLine(h.building)) + '</small></button>',
          )
          .join('') +
        '</div>'
      : '<p class="pl-note">Make a building on the Buildings page and save it to the Library to place it beside the track.</p>';
  }
  // Rebuilds the linked pieces of a layout whose pack changed since they were
  // placed. Their print segments stay as placed, so every section keeps its
  // place in the layout.
  async function followPacks(data) {
    const linked = Object.values(data.sources).filter(
      (s) => s.ref?.pieceId || s.ref?.special,
    );
    if (!linked.length) return { data, changed: 0, missing: 0 };
    const list = packs.length ? packs : await (await openTrackLibrary()).list();
    const next = structuredClone(data);
    let changed = 0,
      missing = 0,
      failed = 0;
    for (const source of Object.values(next.sources)) {
      if (!source.ref?.pieceId && !source.ref?.special) continue;
      const owner = list.find((p) => p.id === source.ref.collectionId);
      if (owner && owner.revision === source.ref.revision) continue;
      // A piece that cannot follow its pack (e.g. a two-lane hairpin after the
      // pack went to four lanes) keeps the layout's own copy; the rest follow.
      try {
        const piece = source.ref.pieceId
          ? owner?.pieces.find((p) => p.id === source.ref.pieceId)
          : owner && {
              name: source.name,
              track: packSpecialTrack(owner, source.ref.special),
            };
        if (!piece) {
          missing++;
          continue;
        }
        const track = trackWithProfile(piece.track, owner.profile);
        if (source.ref.special && track.params.special)
          track.params.special = {
            ...track.params.special,
            ...source.track.params.special,
          };
        // A saved turnout follows its pack, but keeps the side and the
        // insert it was given in this layout.
        else if (isTurnout(track.params) && isTurnout(source.track.params))
          applyTurnoutChoice(track.params, turnoutChoice(source.track.params));
        track.params.segments = source.track.params.segments;
        track.params.borderSegments = source.track.params.borderSegments;
        // Barriers and markings set in the layout stay with the layout.
        for (const key of Object.keys(source.track.params))
          if (layoutOwned(key)) track.params[key] = source.track.params[key];
        const def = await build(track, false);
        source.track = def.track;
        delete source.bed;
        source.name = piece.name;
        source.ref = { ...source.ref, revision: owner.revision };
        changed++;
      } catch {
        failed++;
      }
    }
    return { data: next, changed, missing, failed };
  }
  async function loadFile(data, remember = true, already = null) {
    validateLayout(data);
    // show() may already have followed the packs; keep its counts for the message.
    const followed = already ?? (await followPacks(data));
    data = followed.data;
    const savedPlate = plate;
    if (data.plate) {
      const { width, depth, margin } = data.plate;
      if (
        ![width, depth, margin].every(Number.isFinite) ||
        Math.min(width, depth) <= 2 * margin ||
        margin < 0 ||
        width > 5000 ||
        depth > 5000
      )
        throw Error('Invalid layout print plate.');
      plate = { width, depth, margin };
    }
    try {
      const models = await rebuildLayout(data),
        computed = await calculate(data, models);
      undo = [];
      redo = [];
      serial = Math.max(
        serial,
        0,
        ...Object.keys(data.sources).map((k) => Number(k.slice(1))),
      );
      adopt(data, models, computed);
      warmUp();
      if (remember || followed.changed) persist();
      if (followed.changed || followed.missing || followed.failed)
        message(
          [
            followed.changed
              ? 'The pack changed since this layout was planned: ' +
                followed.changed +
                (followed.changed === 1 ? ' piece was' : ' pieces were') +
                ' rebuilt with its current rules.'
              : '',
            followed.missing
              ? followed.missing +
                (followed.missing === 1 ? ' piece is' : ' pieces are') +
                ' no longer in the pack; the layout keeps its own copy.'
              : '',
            followed.failed
              ? followed.failed +
                (followed.failed === 1 ? ' piece does' : ' pieces do') +
                ' not fit the pack’s new rules; the layout keeps its own copy.'
              : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
    } catch (err) {
      plate = savedPlate;
      throw err;
    }
  }
  async function show() {
    if (!plateSet) {
      plate = { ...current().plate };
      plateSet = true;
    }
    const library = await openTrackLibrary();
    packs = await library.list();
    if (!packs.some((p) => p.id === pack)) pack = packs[0]?.id;
    try {
      savedHomes = await library.buildings();
    } catch {
      savedHomes = [];
    }
    homeList();
    // Coming back after Apply to collection: follow the pack now.
    if (loaded && layout.nodes.length) {
      const followed = await followPacks(snapshot(layout));
      if (followed.changed) await loadFile(followed.data, true, followed);
    }
    catalog();
    if (!loaded) {
      // Opening the saved layout counts as busy, so a click on a piece waits
      // instead of building on the empty layout at the same time.
      busy = true;
      host.setAttribute('aria-busy', 'true');
      try {
        const prior = await storage();
        if (prior)
          try {
            await loadFile(prior, false);
          } catch (e) {
            // Keep the layout that did not open before an edit replaces it.
            await storage(prior, unopenedKey).catch(() => {});
            message(
              e.message +
                ' A copy of the saved layout is kept; the Planner opens it again the next time it starts with an empty layout.',
              true,
            );
          }
        loaded = true;
      } finally {
        busy = false;
        host.removeAttribute('aria-busy');
      }
    } else if (!layout.nodes.length) {
      // A layout kept after it failed to open: try it while nothing would be lost.
      const kept = await storage(undefined, unopenedKey).catch(() => null);
      if (kept)
        try {
          await loadFile(kept);
          await storage(null, unopenedKey);
        } catch {
          // Still not openable; it stays kept.
        }
    }
    render(true);
  }
  const save = () =>
    download(
      cleanName(layout.name) + '.slotplan',
      JSON.stringify({ ...snapshot(layout), plate }, null, 2),
      'application/json',
    );
  async function saveToLibrary() {
    if (!layout.nodes.length)
      throw Error('Place a track piece before saving the layout.');
    const store = await openTrackLibrary();
    const data = { ...snapshot(layout), plate };
    const ref = Object.values(data.sources).find((s) => s.ref)?.ref;
    const id = await store.saveLayout({
      id: layout.libraryId,
      name: layout.name.trim() || 'Untitled layout',
      collectionId: ref?.collectionId ?? pack ?? null,
      data,
    });
    layout.libraryId = id;
    persist();
    message('Layout saved to the Library.');
  }
  async function exportKit() {
    if (!layout.nodes.length)
      throw Error('Place a track piece before exporting.');
    // No print files until the print bed is confirmed for every piece.
    if (uncheckedSources().length)
      return perform(
        'segment',
        'Confirm your print bed before exporting. Nothing is exported until the layout has been segmented for it.',
      );
    message('Preparing layout print kit…');
    const files = {},
      quantities = tally(layout, defs);
    const csv = [['Part', 'Print file', 'Quantity', 'Used in']];
    const prints = [];
    const sources = snapshot(layout).sources,
      pieceNames = kitPieceNames(sources);
    for (const [key, { track }] of Object.entries(sources)) {
      const jobs = quantities.filter((g) => g.source === key),
        data = await call('plannerPrint', { track, items: jobs });
      jobs.forEach((g, i) =>
        prints.push({
          piece: pieceNames[key],
          part: g.name,
          role: g.role,
          mirror: g.mirror,
          count: g.count,
          bytes: data[i],
        }),
      );
      if (track.params.special) {
        files['notes/' + key + '-assembly.txt'] = strToU8(
          assemblyNotes(track.params),
        );
        files['notes/' + key + '-conductors.svg'] = strToU8(
          wiringDiagram(track.params),
        );
      }
      const credit = clipAttribution(track.params);
      if (credit) files['notes/' + key + '-clip-credit.txt'] = strToU8(credit);
      if (track.params.clipType === 'side-screw' && jobs.some((g) => g.role === 'clip'))
        files['notes/' + key + '-kevan-sideclips.txt'] = strToU8(
          fitScrewClip(track.params) + '\r\n\r\n' + releaseScrewClip + '\r\n',
        );
    }
    const groups = printGroups(prints);
    for (const group of groups) {
      files[group.file] = group.bytes;
      csv.push([group.label, group.file, group.count, group.usedIn]);
    }
    // The keeper turning tool is printed once, like any other part of the kit.
    const tool = quantities.some((g) => g.role === 'retainer')
      ? await call('keeperToolSTL')
      : null;
    if (tool) {
      files['tools/keeper-turning-tool.stl'] = tool;
      csv.push(['Keeper turning tool', 'tools/keeper-turning-tool.stl', 1, '']);
    }
    // Each building in a folder of its own: its parts cut to fit the plate,
    // and its notes on printing and putting it together.
    const homeGroups = [],
      folders = new Set();
    for (const entry of layout.buildings ?? []) {
      const base = cleanName(entry.name);
      let folder = base;
      for (let k = 2; folders.has(folder); k++) folder = base + '-' + k;
      folders.add(folder);
      const kit = await call('buildingKit', { building: entry.building, plate });
      kit.forEach((f, i) => {
        const file = 'buildings/' + folder + '/' + String(i + 1).padStart(2, '0') + ' ' + cleanName(f.name) + '.stl';
        files[file] = f.bytes;
        csv.push([f.name, file, 1, entry.name]);
        homeGroups.push({ count: 1, volume: stlVolume(f.bytes) });
      });
      files['buildings/' + folder + '/README.txt'] = strToU8(kitNotes(entry.name, entry.building, kit, {}));
      const sheets = glazingSheets(entry.building);
      if (sheets.length) files['buildings/' + folder + '/glazing.svg'] = strToU8(glazingSvg(entry.name, sheets));
    }
    const settings = loadSettings();
    files['shopping-list.txt'] = strToU8(
      shoppingList({
        name: layout.name,
        groups: [
          ...groups.map((g) => ({
            count: g.count,
            volume: stlVolume(g.bytes),
          })),
          ...blocks.map((b) => ({ count: 1, volume: stlVolume(b.stl) })),
          ...(tool ? [{ count: 1, volume: stlVolume(tool) }] : []),
          ...homeGroups,
        ],
        lanes: laneLengths(
          layout.nodes.map((n) => ({
            lanes: defs.get(n.source).sections[n.index].lanes,
            laneOf: defs.get(n.source).sections[n.index].laneOf,
            flip: n.pose.flip,
          })),
        ),
        settings,
        material: MATERIALS.find((m) => m.id === settings.material),
        hardware: screwHardware(endsOf(layout, defs)),
      }),
    );
    for (const block of blocks) {
      const file = 'supports/' + cleanName(block.id) + '-x1.stl';
      files[file] = block.stl;
      csv.push([block.name, file, 1, '']);
    }
    files['parts.csv'] = strToU8(
      csv
        .map((row) =>
          row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(','),
        )
        .join('\r\n'),
    );
    files['layout.slotplan'] = strToU8(
      JSON.stringify({ ...snapshot(layout), plate }),
    );
    download(
      cleanName(layout.name) + '-print-kit.zip',
      zipSync(files, { level: 3 }),
      'application/zip',
    );
    message('');
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    host.setAttribute('aria-busy', 'true');
    try {
      message('');
      await fn();
    } catch (err) {
      message(err.message, true);
    } finally {
      busy = false;
      host.removeAttribute('aria-busy');
    }
  }
  async function perform(key, reason = '') {
    if (key === 'undo' || key === 'redo')
      return travel(key === 'undo' ? undo : redo, key === 'undo' ? redo : undo);
    if (key === 'save') return save();
    if (key === 'library-save') return saveToLibrary();
    if (key === 'export-menu') return exportKit();
    if (key === 'remove' && homeOf(choice.building))
      return edit((next) => {
        next.buildings = next.buildings.filter((b) => b.id !== choice.building);
        return { selected: choice.selected, end: choice.end };
      });
    if (key === 'remove')
      return edit((n) => removeSection(n, defs, choice.selected));
    if (key === 'pit-one' || key === 'pit-all') return addPitGarages(key === 'pit-all');
    if (key === 'over-one') return addGantry();
    if (key === 'b-turn') return editHome((entry) => (entry.pose = { ...entry.pose, a: entry.pose.a + Math.PI / 2 }));
    if (key === 'b-snap') {
      // Further than a drop snaps: to the nearest track in front of it.
      const snapped = snapPose(homeOf(choice.building), trackLoops(), SNAP * 8);
      if (!snapped) throw Error('There is no track within ' + SNAP * 8 + ' mm of the front of this building, or no room beside it. Drag it nearer, or turn it to face the track.');
      await editHome((entry) => (entry.pose = snapped));
      return message('Standing along the track, its front 1 mm from the border.');
    }
    if (key === 'b-place') {
      const pose = { x: field('homeX').valueAsNumber, y: field('homeY').valueAsNumber, a: (field('homeA').valueAsNumber * Math.PI) / 180 };
      if (![pose.x, pose.y, pose.a].every((v) => Number.isFinite(v) && Math.abs(v) < 1e7)) throw Error('Enter a place and a direction for the building.');
      return editHome((entry) => (entry.pose = pose));
    }
    if (key === 'b-join') {
      const [a, b, z] = field('join').value.split('|');
      const joined = joinWalkway(homeOf(choice.building).building, homeOf(a), homeOf(b), Number(z));
      await editHome((entry) => {
        entry.building = joined.building;
        entry.pose = joined.pose;
      });
      return message('The walkway now joins ' + homeOf(a).name + ' and ' + homeOf(b).name + ', ' + joined.building.length + ' mm long.');
    }
    if (key === 'b-level') {
      const road = roadBeside(homeOf(choice.building));
      return editHome((entry) => (entry.building = { ...entry.building, baseHeight: Math.round(road * 100) / 100 }));
    }
    if (key === 'reverse')
      return edit((n) => {
        reverseSection(n, defs, choice.selected);
      });
    if (key === 'join')
      return edit((n) => snapRun(n, defs, choice.end, field('mate').value));
    if (key === 'elevate') {
      const a = field('a').valueAsNumber,
        b = field('b').disabled ? a : field('b').valueAsNumber,
        count = field('supports').valueAsNumber;
      await edit((n) => {
        setElevation(n, defs, choice.selected, a, b, count, field('style').value, [
          field('pegAcross').valueAsNumber,
          field('pegAlong').valueAsNumber,
        ]);
      });
      $('.pl-bridge').open = true;
      return;
    }
    if (key === 'segment') {
      if (!layout.nodes.length) throw Error('Place a track piece before segmenting the layout.');
      host.insertAdjacentHTML('beforeend', SEGMENT_DIALOG);
      $('.pl-segment').addEventListener('close', (e) => e.target.remove(), { once: true });
      for (const [name, value] of [['bedWidth', plate.width], ['bedDepth', plate.depth], ['bedMargin', plate.margin]])
        field(name).value = value;
      const over = partsOverPlate();
      $('.pl-segment-note').textContent =
        (reason ? reason + ' ' : '') +
        (over
          ? over + (over === 1 ? ' part does' : ' parts do') + ' not fit a ' + plate.width + ' × ' + plate.depth + ' mm plate now.'
          : 'Every part fits a ' + plate.width + ' × ' + plate.depth + ' mm plate now.');
      $('.pl-segment').showModal();
      return;
    }
    if (key === 'segment-cancel') return $('.pl-segment').close();
    if (key === 'segment-confirm') {
      const bed = {
        width: field('bedWidth').valueAsNumber,
        depth: field('bedDepth').valueAsNumber,
        margin: field('bedMargin').valueAsNumber,
      };
      if (!usablePlate(bed)) {
        $('.pl-segment-note').textContent = 'Enter a usable print plate between 10 and 5,000 mm.';
        return;
      }
      $('.pl-segment').close();
      plate = bed;
      render();
      persist();
      return segmentLayout();
    }
    if (['split', 'merge'].includes(key)) {
      turnoutAs = key;
      catalog();
      return;
    }
    if (key === 'fill-gap') {
      message('Measuring the gap…');
      return fillGap();
    }
    if (key === 'return-curve') {
      message('Placing the return curve…');
      return returnCurve();
    }
    if (key === 'ladder') {
      const parts = ladderParts();
      host.insertAdjacentHTML('beforeend', LADDER_DIALOG);
      const dialog = $('.pl-ladder');
      dialog.addEventListener('close', (e) => e.target.remove(), { once: true });
      field('ladderBays').value = 3;
      field('ladderBay').value = 200;
      field('ladderParallel').checked = true;
      field('ladderGarage').innerHTML =
        '<option value="">None</option>' + savedHomes.filter((h) => !h.building.kind || h.building.kind === 'garage').map((h) => '<option value="' + esc(h.id) + '">' + esc(h.name) + '</option>').join('');
      field('ladderGarage').disabled = !savedHomes.length;
      const suggest = () => {
        const least = leastSpacing(parts, field('ladderBay').valueAsNumber || 0, field('ladderParallel').checked);
        field('ladderSpacing').value = least;
        dialog.querySelector('.pl-segment-note').textContent =
          'The spacing is from one turnout to the next. ' + fmt(least) + ' mm keeps these bays apart. The branches leave to the ' + hand + ', as chosen under Corner and branch direction.' +
          (field('ladderGarage').value ? ' With a garage over each bay, the bays are spaced further apart if the garage needs it.' : '');
      };
      suggest();
      field('ladderBay').addEventListener('change', suggest);
      field('ladderParallel').addEventListener('change', suggest);
      field('ladderGarage').addEventListener('change', suggest);
      dialog.showModal();
      return;
    }
    if (key === 'ladder-cancel') return $('.pl-ladder').close();
    if (key === 'ladder-confirm') {
      const wanted = {
        bays: field('ladderBays').valueAsNumber,
        spacing: field('ladderSpacing').valueAsNumber,
        bayLength: field('ladderBay').valueAsNumber,
        parallel: field('ladderParallel').checked,
        garage: field('ladderGarage').value,
      };
      $('.pl-ladder').close();
      message('Building the pit ladder…');
      return ladder(wanted);
    }
    if (key === 'turnout-mode') {
      message('Changing the insert…');
      await setTurnoutMode(field('turnoutMode').value);
      message('');
      return;
    }
    if (key === 'texture') {
      message('Laying the stones…');
      await setTexture({
        roadTexture: field('texKind').value,
        textureSize: field('texSize').value,
        textureScale: field('texScale').valueAsNumber,
        textureJoint: field('texJoint').valueAsNumber,
        textureDepth: field('texDepth').valueAsNumber,
        textureFit: field('texFit').value,
      });
      message('');
      $('.pl-texture').open = true;
      return;
    }
    if (key === 'markings') {
      message('Painting the markings…');
      await setMarkings({
        whiteLineRoad: field('lineRoad').value,
        whiteLineBorder: field('lineBorder').value,
        roadKerbSide: field('kerbRoad').value,
        kerbEdge: field('kerbBorder').value,
      });
      message('');
      $('.pl-markings').open = true;
      return;
    }
    if (key === 'barriers') {
      message('Fitting the barriers…');
      await setBarriers({
        outer: readBarrierFields('outer'),
        inner: readBarrierFields('inner'),
      });
      message('');
      $('.pl-barriers').open = true;
      return;
    }
    if (key === 'new')
      return edit((n) => {
        Object.assign(n, newLayout());
        // A new layout is not the Library layout that was open: Save to
        // Library would otherwise overwrite that layout.
        delete n.libraryId;
        return {};
      });
    if (key === 'current')
      return place({ name: current().name, track: current().track });
    if (key === 'fit') return view.fit();
    if (['left', 'right'].includes(key)) {
      hand = key;
      catalog();
      return;
    }
    if (['plan', 'solid'].includes(key)) {
      if (key === 'solid') {
        await mirrorMeshes(layout, defs);
        await loadHomes(layout);
      }
      viewMode = key;
      view.setMode(key);
      render();
      warmUp();
      activeBtn('plan', key === 'plan');
      activeBtn('solid', key === 'solid');
      return;
    }
  }
  host.addEventListener('click', (e) => {
    const card = e.target.closest('[data-place]'),
      saved = e.target.closest('[data-home]'),
      action = e.target.closest('[data-pl]'),
      cross = e.target.closest('[data-cross]'),
      misfit = e.target.closest('[data-misfit]');
    if (card) run(() => place(cards[Number(card.dataset.place)]));
    if (saved) run(() => addBuilding(savedHomes.find((h) => h.id === saved.dataset.home)));
    if (action) run(() => perform(action.dataset.pl));
    if (cross && !busy) {
      const h = hits[Number(cross.dataset.cross)];
      select(choice.selected === h.b ? h.a : h.b);
      $('.pl-bridge').open = true;
    }
    if (misfit && !busy) {
      const { a } = misfits[Number(misfit.dataset.misfit)];
      select(a.id, a.key);
    }
  });
  host.addEventListener('change', (e) => {
    if (busy) return;
    const k = e.target.dataset.plField;
    if (k === 'pack') {
      pack = e.target.value;
      catalog();
    }
    if (k === 'end') {
      const end = net.open.find((e) => e.key === field('end').value);
      if (end) select(end.id, end.key);
    }
    if (k === 'name')
      run(() =>
        edit((n) => {
          n.name = field('name').value.trim() || 'Untitled layout';
        }),
      );
    if (['width', 'depth', 'margin'].includes(k)) {
      const p = Object.fromEntries(
        ['width', 'depth', 'margin'].map((k) => [k, field(k).valueAsNumber]),
      );
      if (!usablePlate(p)) {
        render();
        message('Enter a usable print plate between 10 and 5,000 mm.', true);
        return;
      }
      plate = p;
      render();
      persist();
      message('Print plate updated. Use Segment for printing to cut the pieces to fit it.');
    }
  });
  return {
    show,
    openFile: loadFile,
    // Home opens the Planner on the pack you picked there.
    usePack(id) {
      if (!packs.some((p) => p.id === id)) return;
      pack = id;
      catalog();
    },
    action: (key) => run(() => perform(key)),
    get busy() {
      return busy;
    },
  };
}
