import { openTrackLibrary } from './library-store.js';
import { trackWithProfile } from './library-profile.js';
import { piecePreview } from './track-piece-preview.js';
import { packSpecialTrack, specialsFor } from './pack-specials.js';
import { openStore, cleanName } from './project.js';
import { esc, icon } from './ui.js';
import { createPlanView } from './planner-view.js';
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
  barrierOf,
  plainBarrier,
  pegSizeOf,
  totalLength,
  tally,
  sourcePartMap,
  validateLayout,
  blockedJoints,
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
export function createPlanner({ host, call, download, current, promote }) {
  host.innerHTML =
    '<aside class="pl-catalog"><h2>Piece catalogue</h2><label>Track pack<select data-pl-field="pack"></select></label>' +
    '<div class="pl-tabs" role="group" aria-label="Catalogue">' +
    btn('standard', 'Track pieces') +
    btn('special', 'Specials') +
    '</div>' +
    '<div class="pl-hand"><span>Corner direction</span><div>' +
    btn('left', 'Left') +
    btn('right', 'Right') +
    '</div></div>' +
    '<div class="pl-cards"></div>' +
    btn('current', 'Place current Track Set piece', 'plus', 'pl-current') +
    '</aside>' +
    '<section class="pl-centre"><header><input data-pl-field="name" aria-label="Layout name" maxlength="200"><div class="pl-tools">' +
    btn('undo', 'Undo', 'undo') +
    btn('redo', 'Redo', 'redo') +
    btn('new', 'New layout', 'plus') +
    btn('library-save', 'Save to Library', 'library') +
    '</div></header>' +
    '<div class="pl-toolbar"><div class="pl-tabs">' +
    btn('plan', 'Plan', 'track') +
    btn('solid', '3D', 'box') +
    '</div>' +
    '<label>Build from <select data-pl-field="end" aria-label="Build from open end"></select></label>' +
    btn('fit', 'Fit', 'fit') +
    btn('segment', 'Segment for printing', 'split') +
    '</div>' +
    '<div class="pl-stage"><svg class="planner-map" role="img" aria-label="Track layout and open ends"></svg><div class="planner-solid" hidden></div>' +
    '<div class="pl-empty"><b>Place your first track piece</b><span>Choose a piece from the catalogue to start the layout.</span></div>' +
    '<div class="pl-message" role="status" hidden></div></div><div class="pl-stats"></div></section>' +
    '<aside class="pl-inspector"><div class="pl-selection"></div><details class="pl-inventory" open><summary>Parts tally</summary><div></div></details>' +
    '<div class="pl-crossings"></div><details class="pl-bed"><summary>Print plate</summary><div><label>Width · mm<input type="number" min="10" max="5000" data-pl-field="width"></label>' +
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
    group = 'standard',
    hand = 'right',
    viewMode = 'plan',
    choice = {},
    cards = [];
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
  const view = createPlanView($('.pl-stage'), (id, end, extend) => {
    if (busy) return;
    select(id, end, extend);
  });
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
      const over = partsOverPlate();
      message(
        over
          ? [over + (over === 1 ? ' part does' : ' parts do') + ' not fit a ' + bed + ' plate and cannot be cut further.', ...warnings].join(' ')
          : 'Every part already fits a ' + bed + ' plate. Nothing was cut.',
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
      return { selected };
    }, models);
    const over = partsOverPlate();
    message(
      [
        cut + (cut === 1 ? ' piece was' : ' pieces were') + ' cut to fit a ' + bed + ' plate.',
        left ? left + (left === 1 ? ' piece on a ramp or with a section removed was' : ' pieces on a ramp or with a section removed were') + ' left as placed.' : '',
        over ? over + (over === 1 ? ' part still does' : ' parts still do') + ' not fit.' : '',
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
    '<label>Fence height · mm<input data-pl-field="' + side + 'FenceHeight" type="number" min="10" max="250" step="any" value="' + now.fenceHeight + '"></label>';
  const readBarrierFields = (side) =>
    plainBarrier({
      kind: field(side + 'Kind').value,
      ends: field(side + 'Ends').value,
      shape: field(side + 'Shape').value,
      rise: field(side + 'Rise').valueAsNumber,
      angle: field(side + 'Angle').valueAsNumber,
      fence: field(side + 'Fence').value === 'on',
      fenceHeight: field(side + 'FenceHeight').valueAsNumber,
    });
  async function setBarriers(wanted) {
    const ids = chosenIds();
    const models = new Map(defs),
      additions = {},
      swaps = new Map();
    for (const key of new Set(
      layout.nodes.filter((n) => ids.has(n.id)).map((n) => n.source),
    )) {
      const entry = layout.sources[key],
        now = barrierOf(entry);
      if (JSON.stringify(now) === JSON.stringify(wanted)) continue;
      const track = structuredClone(entry.track);
      applyBarriers(track.params, wanted);
      const def = await build(track, false);
      if (def.sections.length !== defs.get(key).sections.length)
        throw Error('The barriers change how this piece is divided. Set them in Track Set instead.');
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
    if (viewMode === 'solid') await mirrorMeshes(next, models);
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
    };
    render(fit);
  }
  async function edit(mutator, models = defs) {
    const next = structuredClone(layout),
      selectedNext = mutator(next) ?? choice;
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
  function listCards() {
    const collection = packs.find((p) => p.id === pack);
    if (!collection) return [];
    if (group === 'standard')
      return collection.pieces.map((p, i) => ({ ...p, index: i, collection }));
    return specialsFor(collection.rules.lanes).map(([type, name]) => ({
      name,
      collection,
      special: type,
      track: packSpecialTrack(collection, type),
    }));
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
    activeBtn('standard', group === 'standard');
    activeBtn('special', group === 'special');
    activeBtn('left', hand === 'left');
    activeBtn('right', hand === 'right');
    cards = listCards();
    $('.pl-cards').innerHTML =
      cards
        .map((card, i) => {
          const p = card.track.params,
            key = JSON.stringify(p);
          let image = previewCache.get(key);
          if (!image) {
            try {
              const v = p.kind === 'import' ? null : piecePreview(p);
              image = v
                ? '<svg aria-hidden="true" viewBox="' +
                  v.viewBox +
                  '">' +
                  v.marks +
                  '</svg>'
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
          const slot = esc(slotNote(p, card.name));
          return (
            '<button type="button" class="pl-card" data-place="' +
            i +
            '" title="Place ' +
            esc(card.name) +
            '"><span>' +
            image +
            '</span><b>' +
            esc(card.name) +
            '</b><small>' +
            meta +
            slot +
            '</small></button>'
          );
        })
        .join('') || '<p class="pl-note">This pack has no saved pieces.</p>';
    warmUp();
  }
  async function place(card) {
    if (!card) return;
    message('Placing ' + card.name + '…');
    const track = card.collection
      ? trackWithProfile(card.track, card.collection.profile)
      : card.track;
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
      return placeSource(next, models, key, choice.end, hand);
    }, models);
    message(
      [def.warning, fresh?.text].filter(Boolean).join(' '),
      Boolean(fresh),
    );
  }
  function render(fit = false) {
    const n = selected(),
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
    $('.pl-empty').hidden = !!layout.nodes.length;
    activeBtn('plan', viewMode === 'plan');
    activeBtn('solid', viewMode === 'solid');
    $('[data-pl="undo"]').disabled = !undo.length;
    $('[data-pl="redo"]').disabled = !redo.length;
    $('.pl-selection').innerHTML = n
      ? '<small>Selected section</small><h2>' +
        esc(def.name) +
        '</h2><p>Section ' +
        (n.index + 1) +
        ' of ' +
        def.sections.length +
        (def.track.params.kind === 'curve'
          ? ' · ' + (n.pose.flip ? 'Left' : 'Right')
          : '') +
        esc(slotNote(def.track.params, def.name)) +
        '</p><div class="pl-selection-actions">' +
        (def.track.params.kind === 'curve' ||
        def.track.params.special?.type === 'chicane'
          ? btn('reverse', 'Reverse turn', 'reset')
          : '') +
        btn('remove', 'Delete section', 'close') +
        '</div>' +
        '<details class="pl-bridge"><summary>Bridge &amp; approaches</summary><div><label>Lift at A · mm<input data-pl-field="a" type="number" min="0" max="500" value="' +
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
        '<details class="pl-bridge pl-barriers"><summary>Barriers</summary><div>' +
        barrierFields('outer', 'Outside / left', barrierOf(def).outer) +
        barrierFields('inner', 'Inside / right', barrierOf(def).inner) +
        '<small>' +
        (chosenIds().size > 1
          ? chosenIds().size + ' sections are selected. '
          : 'Only this section gets the barriers. ') +
        'Ctrl-click sections in the plan to select more than one. Each side has its own type and settings; choose None for a side without a barrier. A sloped end is for the section where a row of barriers stops. Face angle and end shape are for a concrete barrier; the fence stands on an advertising board.</small>' +
        btn('barriers', chosenIds().size > 1 ? 'Apply to ' + chosenIds().size + ' sections' : 'Apply barriers', 'check') +
        '</div></details>'
      : '<h2>Layout details</h2><p>Select a placed section to change it.</p>';
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
              : '')
          : g.name.replace(/\s+\d+$/, '');
      grouped.set(label, (grouped.get(label) ?? 0) + g.count);
    }
    if (blocks.length)
      grouped.set(
        'Bridge supports',
        (grouped.get('Bridge supports') || 0) + blocks.length,
      );
    $('.pl-inventory div').innerHTML =
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
    $('.pl-stats').textContent =
      layout.nodes.length +
      ' sections   ·   ' +
      count +
      ' printable parts   ·   ' +
      fmt(totalLength(layout, defs) / 1000) +
      ' m road   ·   ' +
      (net.open.length
        ? net.open.length + ' open ends'
        : layout.nodes.length
          ? 'Closed layout'
          : '0 open ends') +
      (misfits.length
        ? '   ·   ' +
          misfits.length +
          (misfits.length === 1 ? ' joint' : ' joints') +
          ' with slots out of line'
        : '') +
      (over ? '   ·   ' + over + ' over plate' : '');
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
      },
      fit,
    );
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
        if (source.ref.special)
          track.params.special = {
            ...track.params.special,
            ...source.track.params.special,
          };
        track.params.segments = source.track.params.segments;
        track.params.borderSegments = source.track.params.borderSegments;
        // Barriers set in the layout stay with the layout.
        for (const key of Object.keys(source.track.params))
          if (key.startsWith('trackside')) track.params[key] = source.track.params[key];
        const def = await build(track, false);
        source.track = def.track;
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
    packs = await (await openTrackLibrary()).list();
    if (!packs.some((p) => p.id === pack)) pack = packs[0]?.id;
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
        ],
        lanes: laneLengths(
          layout.nodes.map((n) => ({
            lanes: defs.get(n.source).sections[n.index].lanes,
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
  async function perform(key) {
    if (key === 'undo' || key === 'redo')
      return travel(key === 'undo' ? undo : redo, key === 'undo' ? redo : undo);
    if (key === 'save') return save();
    if (key === 'library-save') return saveToLibrary();
    if (key === 'export-menu') return exportKit();
    if (key === 'remove')
      return edit((n) => removeSection(n, defs, choice.selected));
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
      $('.pl-segment-note').textContent = over
        ? over + (over === 1 ? ' part does' : ' parts do') + ' not fit a ' + plate.width + ' × ' + plate.depth + ' mm plate now.'
        : 'Every part fits a ' + plate.width + ' × ' + plate.depth + ' mm plate now.';
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
    if (['standard', 'special'].includes(key)) {
      group = key;
      catalog();
      return;
    }
    if (['plan', 'solid'].includes(key)) {
      if (key === 'solid') await mirrorMeshes(layout, defs);
      viewMode = key;
      view.setMode(key);
      warmUp();
      activeBtn('plan', key === 'plan');
      activeBtn('solid', key === 'solid');
      return;
    }
  }
  host.addEventListener('click', (e) => {
    const card = e.target.closest('[data-place]'),
      action = e.target.closest('[data-pl]'),
      cross = e.target.closest('[data-cross]'),
      misfit = e.target.closest('[data-misfit]');
    if (card) run(() => place(cards[Number(card.dataset.place)]));
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
