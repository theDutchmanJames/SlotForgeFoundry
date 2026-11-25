// The Buildings page: a building as a kit of parts, made from a few sizes.
// The parts are listed on the left, the model is in the middle (or every
// part on its plate), and the settings are cards on the right. Every change
// rebuilds the model; Save keeps the building in the Library and Export kit
// downloads its STL files with notes on printing and putting it together.
import './buildings.css';
import { zipSync, strToU8 } from 'fflate';
import { esc, fmt, icon } from './ui.js';
import { Viewport } from './viewport.js';
import { kitNotes } from './building-kit.js';
import {
  BUILDING_DEFAULTS,
  BUILDING_LIMITS,
  KIT,
  MAX_ROOMS,
  MAX_UPPER,
  MIN_ROOM,
  OPENING_DEFAULTS,
  UPPER_DEFAULTS,
  ROOFS,
  WALLS,
  WALL_NAMES,
  buildingCuts,
  buildingLayout,
  fitsPlate,
  validateBuilding,
  wallLength,
} from './geometry/building.js';
import { ROOF_TEXTURES, WALL_TEXTURES } from './geometry/building-texture.js';
import { CUT_KEYS, cutLabel } from './geometry/building-cuts.js';

const KEY = 'foundry.building';
const PART_ICONS = { base: 'plate', front: 'box', back: 'box', left: 'box', right: 'box', door: 'layers' };
const field = (name, label, value, [min, max], unit = 'mm', extra = '') =>
  `<label class="bd-row"${extra}><span>${esc(label)}</span><span class="bd-input"><input type="number" name="${name}" value="${esc(String(value))}" min="${min}" max="${max}" step="1"><small>${unit}</small></span></label>`;
// A small picture of each texture for its swatch.
const SWATCH_LINES = {
  plain: '',
  brick: 'M0 7H60M0 14H60M0 21H60M8 0V7M24 0V7M40 0V7M56 0V7M16 7V14M32 7V14M48 7V14M8 14V21M24 14V21M40 14V21M56 14V21M16 21V28M32 21V28M48 21V28',
  block: 'M0 10H60M0 20H60M15 0V10M45 0V10M30 10V20M15 20V28M45 20V28',
  crack: 'M6 4l5 5 2 7 6 3M34 3l-3 6 4 5-2 7 5 3M46 16l5 3 1 7',
  metal: 'M3 0V28M9 0V28M15 0V28M21 0V28M27 0V28M33 0V28M39 0V28M45 0V28M51 0V28M57 0V28',
  tile: 'M0 7H60M0 14H60M0 21H60M5 0V7M15 0V7M25 0V7M35 0V7M45 0V7M55 0V7M10 7V14M20 7V14M30 7V14M40 7V14M50 7V14M5 14V21M15 14V21M25 14V21M35 14V21M45 14V21M55 14V21',
  planks: 'M0 6H60M0 12H60M0 18H60M0 24H60M23 0V6M47 6V12M12 12V18M38 18V24M54 24V28M6 3H14M30 9H40M44 15H52M8 21H18M22 26H32',
  boards: 'M7 0V28M15 0V28M23 0V28M31 0V28M39 0V28M47 0V28M55 0V28M3 4V12M11 14V24M19 2V9M27 16V26M35 5V13M43 18V25M51 3V11',
  shingle: 'M0 7H60M0 14H60M0 21H60M6 0V7M11 0V7M19 0V7M26 0V7M32 0V7M41 0V7M47 0V7M55 0V7M3 7V14M10 7V14M16 7V14M24 7V14M30 7V14M37 7V14M45 7V14M52 7V14M7 14V21M13 14V21M22 14V21M28 14V21M35 14V21M42 14V21M50 14V21M57 14V21',
};
const swatches = (list, attr) =>
  `<div class="bd-swatches">${list
    .map(
      ([id, label]) =>
        `<button type="button" ${attr}="${id}"><svg viewBox="0 0 60 28" aria-hidden="true"><rect width="60" height="28" rx="3"/><path d="${SWATCH_LINES[id]}"/></svg><span>${esc(label)}</span></button>`,
    )
    .join('')}</div>`;
const SIDES = [
  ['overhangFront', 'Front'],
  ['overhangBack', 'Back'],
  ['overhangLeft', 'Left'],
  ['overhangRight', 'Right'],
];

/** A storey of a building: 0 is the ground floor, its settings at the top level. */
export const storeyOf = (b, k) => (k ? b.upper[k - 1] : b);
/** The building with a storey's settings changed. */
export function withStorey(b, k, patch) {
  if (!k) return { ...b, ...patch };
  return { ...b, upper: b.upper.map((u, i) => (i === k - 1 ? { ...u, ...patch } : u)) };
}

/** A place on a wall of a storey where a new window or door fits, or null. */
export function freePlace(building, wall, opening, k = 0) {
  const s = storeyOf(building, k);
  const L = wallLength(s, wall);
  for (let at = opening.width / 2; at <= L - opening.width / 2; at += 1) {
    try {
      validateBuilding(withStorey(building, k, { openings: [...s.openings, { ...opening, wall, at }] }));
      return at;
    } catch {
      // Not here: try further along.
    }
  }
  return null;
}

export function createBuildingsPage({ host, call, store, download, notice, plate, density }) {
  let building = load(),
    name = building.name ?? 'Garage',
    savedId = building.savedId ?? null,
    parts = [],
    sizes = {},
    view = 'model',
    wall = 'left',
    storey = 0,
    selected = null,
    viewport = null,
    serial = 0,
    timer = 0,
    apart = 0,
    fitted = false;
  delete building.name;
  delete building.savedId;
  building = safe(building);

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) ?? {};
    } catch {
      return {};
    }
  }
  function safe(b) {
    try {
      return validateBuilding(b);
    } catch {
      return validateBuilding({});
    }
  }
  function remember() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...building, name, savedId }));
    } catch {
      // Storage can be off; the building is still on the page.
    }
  }
  const $ = (s) => host.querySelector(s);

  host.innerHTML = `<div class="bd">
<aside class="bd-col" aria-label="The building and its parts">
  <div class="bd-card-head"><span class="bd-tile">${icon('building')}</span><span><b>One-car garage</b><small>Toy proportions for 1:32</small></span></div>
  <div class="bd-group">Parts of the kit</div>
  <div class="bd-parts" role="list"></div>
  <div class="bd-group">Your buildings</div>
  <div class="bd-saved"></div>
  <div class="bd-group">Coming later</div>
  <p class="bd-later">Clipping to the track. Place a saved building beside the track, or a row of garages over the pit bays, in the Track Planner.</p>
</aside>
<section class="bd-centre">
  <header><div class="bd-title"><small class="sf-eyebrow">Buildings</small><input name="buildingName" aria-label="Building name" maxlength="120"></div>
    <span class="bd-pill" data-bd-fit></span>
    <label class="bd-apart" title="Pull the parts apart to see how they fit together"><span>Exploded</span><input type="range" name="apart" min="0" max="100" step="1" value="0" aria-label="Exploded view: how far apart the parts are"></label>
    <div class="bd-seg" role="group" aria-label="View"><button type="button" data-bd-view="model">Model</button><button type="button" data-bd-view="plate">Parts on the plate</button></div>
  </header>
  <div class="bd-stage"><div class="bd-model"></div><div class="bd-plates" hidden></div><div class="bd-message" role="status" hidden></div></div>
  <footer><div class="bd-chips" data-bd-chips></div><span class="bd-grow"></span>
    <button type="button" class="sf-btn ghost" data-bd="new">${icon('plus')}New building</button>
    <button type="button" class="sf-btn soft" data-bd="save">${icon('library')}Save to Library</button>
    <button type="button" class="sf-btn primary" data-bd="export">${icon('export')}Export kit</button></footer>
</section>
<aside class="bd-panel" aria-label="Settings">
  <div class="sf-eyebrow">Building</div><h2 data-bd-name></h2>
  <form class="bd-form" autocomplete="off">
    <section class="bd-box"><h3>Size</h3>
      ${field('width', 'Width', building.width, BUILDING_LIMITS.width)}
      ${field('depth', 'Depth', building.depth, BUILDING_LIMITS.depth)}
      ${field('height', 'Wall height', building.height, BUILDING_LIMITS.height)}
      <div class="bd-sub">Rooms</div>
      <div class="bd-seg bd-wide" role="group" aria-label="Rooms"><button type="button" data-bd-rooms="">One room</button><button type="button" data-bd-rooms="width">Side by side</button><button type="button" data-bd-rooms="depth">Front to back</button></div>
      <div class="bd-rooms"></div>
      <p class="bd-hint">The ground floor, outside the walls, up to the eaves. A one-car garage of 120 × 180 mm and 75 mm high takes practically any 1:32 slot car. Rooms are measured outside to outside, each to the middle of a dividing wall, so they add up to the width or the depth: two rooms of 200 and 150 make a building 350 mm wide. Side by side, each room has its own garage door.</p></section>
    <section class="bd-box"><h3>Storeys</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Storey" data-bd-storeys></div>
      <div class="bd-storey"></div>
      <div class="bd-adds"><button type="button" class="bd-add" data-bd-add-storey>${icon('plus')}Storey</button></div>
      <p class="bd-hint">Each storey stands on a floor laid on the one below, its walls in a groove of the floor. It can be smaller than the storey below and set back, leaving a terrace. Windows and doors and the wall texture are set for the storey chosen here; the roof sits on the top storey.</p></section>
    <section class="bd-box"><h3>Roof</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Roof">${ROOFS.map(([id, label]) => `<button type="button" data-bd-roof="${id}">${label}</button>`).join('')}</div>
      ${field('pitch', 'Pitch', building.pitch, BUILDING_LIMITS.pitch, '°', ' data-bd-for="slope gable"')}
      <label class="bd-row" data-bd-for="gable"><span>Ridge runs</span><select name="ridge"><option value="depth">Front to back</option><option value="width">Side to side</option></select></label>
      <label class="bd-row" data-bd-for="slope"><span>Rises towards</span><select name="rises">${WALLS.map((w) => `<option value="${w}">The ${w}</option>`).join('')}</select></label>
      <label class="bd-row"><span>Under the roof</span><select name="roofLip"><option value="frame">Frame with tabs</option><option value="none">Nothing</option></select></label>
      <div class="bd-sub">Overhang</div>
      <div class="bd-sides">${SIDES.map(([k, label]) => field(k, label, building[k], BUILDING_LIMITS[k])).join('')}</div>
      <p class="bd-hint">How far the roof reaches past each wall. A sloped or two-sided roof lies on the walls, which follow it. Under the roof a frame drops inside the walls and holds them square; small tabs on it push into pockets in the roof's underside, so the roof prints the right way up with its texture on top. With nothing under it, the roof is glued along the tops of the walls.</p></section>
    <section class="bd-box"><h3>Surface</h3>
      <div class="bd-sub" data-bd-walls-of>Walls</div>
      ${swatches(WALL_TEXTURES, 'data-bd-wall-texture')}
      <div data-bd-roof-texture-box><div class="bd-sub">Roof</div>
      ${swatches(ROOF_TEXTURES, 'data-bd-roof-texture')}</div>
      <div data-bd-texture-size>
      ${field('textureScale', 'Size', building.textureScale, BUILDING_LIMITS.textureScale, '%')}
      <label class="bd-row"><span>Joint width</span><span class="bd-input"><input type="number" name="textureJoint" value="${building.textureJoint}" min="${BUILDING_LIMITS.textureJoint[0]}" max="${BUILDING_LIMITS.textureJoint[1]}" step="0.05"><small>mm</small></span></label>
      <label class="bd-row"><span>Joint depth</span><span class="bd-input"><input type="number" name="textureDepth" value="${building.textureDepth}" min="${BUILDING_LIMITS.textureDepth[0]}" max="${BUILDING_LIMITS.textureDepth[1]}" step="0.05"><small>mm</small></span></label>
      </div>
      <p class="bd-hint">Joints cut into the outside of the walls and the top of a sloped roof, which print face up. They keep clear of windows, doors and frames; the rows of bricks run on round the corners. A flat roof stays plain.</p></section>
    <section class="bd-box"><h3>Garage door</h3>
      ${field('doorWidth', 'Width', building.doorWidth, BUILDING_LIMITS.doorWidth)}
      ${field('doorHeight', 'Height', building.doorHeight, BUILDING_LIMITS.doorHeight)}
      <label class="bd-row"><span>Door</span><select name="door"><option value="roller">Roller door</option><option value="open">Open, no door</option></select></label>
      <p class="bd-hint">The opening starts at the top of the base, so a car rolls straight in from the road.</p></section>
    <section class="bd-box"><h3>Windows and doors</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Wall">${WALLS.map((w) => `<button type="button" data-bd-wall="${w}">${WALL_NAMES[w]}</button>`).join('')}</div>
      <div class="bd-openings"></div>
      <div class="bd-adds"><button type="button" class="bd-add" data-bd-add="window">${icon('plus')}Window</button><button type="button" class="bd-add" data-bd-add="door">${icon('plus')}Door</button></div>
      <p class="bd-hint">Each is a hole in the wall. Place is the middle of the opening, measured from the left end of the wall as you look at it from outside. A frame is a part of its own, glued on around the opening.</p></section>
    <section class="bd-box" data-bd-fitting hidden><h3>Fitting the plate</h3>
      <div class="bd-cuts"></div>
      <p class="bd-hint">A part longer than your plate is cut into pieces that join like a puzzle: dovetail tabs, or along the joints of a brick or block wall so the seam is one more joint. Move a cut anywhere in its range: both pieces still fit the plate, with the tab. A cut may run through a window or a door, not along its side.</p></section>
    <section class="bd-box"><h3>Base</h3>
      ${field('baseHeight', 'Height', building.baseHeight, BUILDING_LIMITS.baseHeight)}
      <p class="bd-hint">Make it as high as your track, so the doorstep is level with the road. It stands on the table, hollow underneath.</p></section>
    <section class="bd-box"><h3>Walls</h3>
      <label class="bd-check"><input type="checkbox" name="braces"><span>Corner braces</span></label>
      <p class="bd-hint">Walls ${KIT.wall} mm thick, mitred at the corners so the outside has no seam, standing ${KIT.groove} mm deep in a groove of the base. A corner brace is a small L glued into each inside corner, on the floor against both walls: it holds the corner square while the glue sets. Under the roof and every floor a frame drops inside the walls and holds their tops.</p></section>
    <p class="bd-error" role="alert" hidden></p>
  </form>
</aside></div>`;

  const form = $('.bd-form');

  // The rooms: their sizes, and the width or depth they make.
  function drawRooms() {
    const r = building.rooms;
    for (const b of host.querySelectorAll('[data-bd-rooms]')) b.setAttribute('aria-pressed', String(b.dataset.bdRooms === (r?.along ?? '')));
    for (const k of ['width', 'depth']) {
      const el = form.elements[k];
      el.disabled = r?.along === k;
      el.title = r?.along === k ? 'Set by the rooms' : '';
    }
    $('.bd-rooms').innerHTML = r
      ? r.sizes
          .map(
            (v, i) =>
              `<div class="bd-room">${field('room-' + i, 'Room ' + (i + 1), v, [MIN_ROOM, 400])}${r.sizes.length > 2 ? `<button type="button" class="bd-remove" data-bd-remove-room="${i}" title="Remove" aria-label="Remove room ${i + 1}">${icon('close')}</button>` : ''}</div>`,
          )
          .join('') +
        (r.sizes.length < MAX_ROOMS ? `<div class="bd-adds"><button type="button" class="bd-add" data-bd-add-room>${icon('plus')}Room</button></div>` : '') +
        `<p class="bd-hint">${r.sizes.map((v) => fmt(v)).join(' + ')} = ${fmt(building[r.along])} mm ${r.along === 'width' ? 'wide' : 'deep'}.</p>`
      : '';
  }
  // Rooms of these sizes, with the garage doors narrowed to fit if need be.
  function withRooms(b, rooms) {
    const next = { ...b, rooms };
    if (rooms?.along === 'width') {
      const t = KIT.wall,
        n = rooms.sizes.length;
      const inside = Math.min(...rooms.sizes.map((v, i) => v - (i === 0 || i === n - 1 ? t + t / 2 : t)));
      next.doorWidth = Math.max(BUILDING_LIMITS.doorWidth[0], Math.min(b.doorWidth, Math.floor(inside - 2 * KIT.frame)));
    }
    return next;
  }
  // The storeys, and the size and place of the one chosen.
  function drawStoreys() {
    const count = building.upper.length + 1;
    storey = Math.min(storey, count - 1);
    $('[data-bd-storeys]').innerHTML = Array.from(
      { length: count },
      (_, k) => `<button type="button" data-bd-storey="${k}" aria-pressed="${k === storey}">${k ? 'Storey ' + (k + 1) : 'Ground floor'}</button>`,
    ).join('');
    $('[data-bd-add-storey]').hidden = building.upper.length >= MAX_UPPER;
    const s = storeyOf(building, storey);
    const below = storeyOf(building, storey - 1);
    $('.bd-storey').innerHTML = storey
      ? `<div class="bd-opening"><div class="bd-op-head">${icon('building')}<b>Storey ${storey + 1}</b><span class="bd-grow"></span>
    <button type="button" class="bd-remove" data-bd-remove-storey title="Remove" aria-label="Remove storey ${storey + 1}">${icon('close')}</button></div>
  ${field('upWidth', 'Width', s.width, [60, below.width])}
  ${field('upDepth', 'Depth', s.depth, [60, below.depth])}
  ${field('upX', 'From the left', s.x, [0, below.width])}
  ${field('upY', 'From the front', s.y, [0, below.depth])}
  ${field('upHeight', 'Wall height', s.height, BUILDING_LIMITS.height)}
  <p class="bd-hint">Its place is from the left and front walls of the storey below, outside to outside.</p></div>`
      : '<p class="bd-hint">The ground floor has the garage door; its size is set above.</p>';
  }
  // The windows and doors of the chosen wall on the chosen storey, each a small card.
  function drawOpenings() {
    const s = storeyOf(building, storey);
    const rows = s.openings
      .map((o, i) => [o, i])
      .filter(([o]) => o.wall === wall)
      .map(
        ([o, i]) => `<div class="bd-opening" data-op="${i}">
  <div class="bd-op-head">${icon(o.type === 'door' ? 'open' : 'view')}<b>${o.type === 'door' ? 'Door' : 'Window'}</b><span class="bd-grow"></span>
    <button type="button" class="bd-remove" data-bd-remove="${i}" title="Remove" aria-label="Remove this ${o.type}">${icon('close')}</button></div>
  ${field('at', 'Place', o.at, [0, wallLength(s, o.wall)])}
  ${field('opWidth', 'Width', o.width, [8, wallLength(s, o.wall)])}
  ${field('opHeight', 'Height', o.height, [8, s.height])}
  ${o.type === 'window' ? field('sill', 'Up from the floor', o.sill, [0, s.height]) : ''}
  <label class="bd-check"><input type="checkbox" name="frame"${o.frame ? ' checked' : ''}><span>Frame</span></label>
</div>`,
      );
    const where = building.upper.length ? (storey ? ' of storey ' + (storey + 1) : ' of the ground floor') : '';
    $('.bd-openings').innerHTML = rows.join('') || '<p class="bd-hint">No windows or doors in the ' + wall + ' wall' + where + '.</p>';
    for (const b of host.querySelectorAll('[data-bd-wall]')) b.setAttribute('aria-pressed', String(b.dataset.bdWall === wall));
  }
  function readForm() {
    const e = form.elements;
    const num = (el) => (el.value === '' ? NaN : Number(el.value));
    const openings = storeyOf(building, storey).openings.map((o, i) => {
      const row = form.querySelector('[data-op="' + i + '"]');
      if (!row) return o;
      const get = (n) => row.querySelector('[name="' + n + '"]');
      return {
        ...o,
        at: num(get('at')),
        width: num(get('opWidth')),
        height: num(get('opHeight')),
        ...(o.type === 'window' && { sill: num(get('sill')) }),
        frame: get('frame').checked,
      };
    });
    const upper = storey
      ? { width: num(e.upWidth), depth: num(e.upDepth), x: num(e.upX), y: num(e.upY), height: num(e.upHeight), openings }
      : { openings };
    const rooms = building.rooms && { along: building.rooms.along, sizes: building.rooms.sizes.map((_, i) => num(e['room-' + i])) };
    return {
      ...withStorey(building, storey, upper),
      rooms,
      width: num(e.width),
      depth: num(e.depth),
      height: num(e.height),
      doorWidth: num(e.doorWidth),
      doorHeight: num(e.doorHeight),
      baseHeight: num(e.baseHeight),
      pitch: num(e.pitch),
      overhangFront: num(e.overhangFront),
      overhangBack: num(e.overhangBack),
      overhangLeft: num(e.overhangLeft),
      overhangRight: num(e.overhangRight),
      textureScale: num(e.textureScale),
      textureJoint: num(e.textureJoint),
      textureDepth: num(e.textureDepth),
      door: e.door.value,
      ridge: e.ridge.value,
      rises: e.rises.value,
      braces: e.braces.checked,
      roofLip: e.roofLip.value,
      cuts: readCuts(building),
    };
  }
  function message(text) {
    const box = $('.bd-message');
    box.textContent = text ?? '';
    box.hidden = !text;
  }
  function showError(text) {
    const box = $('.bd-error');
    box.textContent = text ?? '';
    box.hidden = !text;
  }
  function sync() {
    $('[data-bd-name]').textContent = name || 'Building';
    for (const b of host.querySelectorAll('[data-bd-view]')) b.setAttribute('aria-pressed', String(b.dataset.bdView === view));
    for (const b of host.querySelectorAll('[data-bd-roof]')) b.setAttribute('aria-pressed', String(b.dataset.bdRoof === building.roof));
    for (const el of host.querySelectorAll('[data-bd-for]')) el.hidden = !el.dataset.bdFor.split(' ').includes(building.roof);
    const walls = storeyOf(building, storey);
    for (const b of host.querySelectorAll('[data-bd-wall-texture]')) b.setAttribute('aria-pressed', String(b.dataset.bdWallTexture === walls.wallTexture));
    $('[data-bd-walls-of]').textContent = building.upper.length ? 'Walls of ' + (storey ? 'storey ' + (storey + 1) : 'the ground floor') : 'Walls';
    for (const b of host.querySelectorAll('[data-bd-roof-texture]')) b.setAttribute('aria-pressed', String(b.dataset.bdRoofTexture === building.roofTexture));
    $('[data-bd-roof-texture-box]').hidden = building.roof === 'flat';
    const textured = [building, ...building.upper].some((u) => u.wallTexture !== 'plain');
    $('[data-bd-texture-size]').hidden = !textured && (building.roof === 'flat' || building.roofTexture === 'plain');
    $('.bd-model').hidden = view !== 'model';
    $('.bd-apart').hidden = view !== 'model';
    $('.bd-plates').hidden = view !== 'plate';
    // The parts as built (a part cut to fit the plate is in pieces), or as
    // planned while the first build is under way.
    const list = parts.length ? parts.map(({ id, name, role }) => ({ id, name, role })) : buildingLayout(building).parts;
    const bed = plate();
    const fits = (p) => !sizes[p.id] || fitsPlate(sizes[p.id], bed);
    const big = list.filter((p) => !fits(p));
    const pill = $('[data-bd-fit]');
    pill.textContent = big.length
      ? big.length + (big.length === 1 ? ' part is' : ' parts are') + ' larger than the plate'
      : 'Fits a ' + fmt(bed.width) + ' × ' + fmt(bed.depth) + ' plate';
    pill.classList.toggle('warn', big.length > 0);
    $('.bd-parts').innerHTML = list
      .map(
        (p) =>
          `<button type="button" class="bd-part${p.id === selected ? ' active' : ''}${fits(p) ? '' : ' big'}" data-bd-part="${p.id}">${icon(PART_ICONS[p.id.split('-')[0]] ?? { roof: 'building', frame: 'view', floor: 'plate' }[p.role] ?? 'box')}<span><b>${esc(p.name)}</b><small>${sizes[p.id] ? sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '…'}</small></span></button>`,
      )
      .join('');
    const grams = (parts.reduce((sum, p) => sum + p.volume, 0) / 1000) * density();
    $('[data-bd-chips]').innerHTML =
      '<span>' + list.length + ' parts</span>' +
      (parts.length ? '<span>≈ ' + Math.round(grams) + ' g filament</span>' : '') +
      '<span>No supports</span>';
    drawPlates(list, bed);
  }
  // Every part on a plate of its own, as it lies when printed.
  function drawPlates(list, bed) {
    const s = 0.9;
    $('.bd-plates').innerHTML = list
      .filter((p) => sizes[p.id])
      .map((p) => {
        const size = sizes[p.id];
        const [x, y] = size[0] <= bed.width - 2 * (bed.margin ?? 0) ? size : [size[1], size[0]];
        const fits = fitsPlate(size, bed);
        return (
          '<figure class="bd-plate' + (fits ? '' : ' big') + '"><svg viewBox="0 0 ' + bed.width * s + ' ' + bed.depth * s +
          '" role="img" aria-label="' + esc(p.name) + ' on the plate"><rect class="bd-bed" width="' + bed.width * s + '" height="' + bed.depth * s + '" rx="6"/>' +
          '<rect class="bd-piece" x="' + ((bed.width - Math.min(x, bed.width)) / 2) * s + '" y="' + ((bed.depth - Math.min(y, bed.depth)) / 2) * s +
          '" width="' + Math.min(x, bed.width) * s + '" height="' + Math.min(y, bed.depth) * s + '" rx="2"/></svg><figcaption><b>' + esc(p.name) +
          '</b><small>' + size.map((v) => fmt(v)).join(' × ') + ' mm' + (fits ? '' : ' · larger than the plate') + '</small></figcaption></figure>'
        );
      })
      .join('');
  }
  // The cuts that fit the parts to the plate, each with its range.
  function drawCuts() {
    let plan;
    try {
      plan = buildingCuts(building, plate());
    } catch (err) {
      return err;
    }
    const rows = CUT_KEYS.filter((k) => plan[k]?.cuts.length).map((k) => {
      const part = plan[k];
      return `<div class="bd-cut" data-cut-key="${k}"><div class="bd-op-head"><b>${esc(cutLabel(k))}</b><small>${part.cuts.length + 1} pieces</small><span class="bd-grow"></span>${
        building.cuts?.[k] ? `<button type="button" class="bd-link" data-bd-even="${k}">Spread evenly</button>` : ''
      }</div>${part.cuts
        .map(
          (c, i) =>
            `<label class="bd-row"><span>Cut ${i + 1}<small> ${part.ranges[i][0]}–${part.ranges[i][1]} mm</small></span><span class="bd-input"><input type="number" name="cut-${k}-${i}" value="${Math.round(c * 10) / 10}" min="${part.ranges[i][0]}" max="${part.ranges[i][1]}" step="0.5"><small>mm</small></span></label>`,
        )
        .join('')}</div>`;
    });
    $('[data-bd-fitting]').hidden = !rows.length;
    // The same parts with the same number of cuts: set the fields in place,
    // so the one being typed in keeps its cursor.
    const shape = CUT_KEYS.filter((k) => plan[k]?.cuts.length).map((k) => k + plan[k].cuts.length).join();
    const box = $('.bd-cuts');
    if (box.dataset.shape !== shape) {
      box.dataset.shape = shape;
      box.innerHTML = rows.join('');
      return null;
    }
    for (const k of CUT_KEYS)
      plan[k]?.cuts.forEach((c, i) => {
        const el = box.querySelector('[name="cut-' + k + '-' + i + '"]');
        const value = String(Math.round(c * 10) / 10);
        el.defaultValue = value;
        if (document.activeElement !== el) el.value = value;
        el.min = plan[k].ranges[i][0];
        el.max = plan[k].ranges[i][1];
        el.closest('label').querySelector('span small').textContent = ' ' + plan[k].ranges[i][0] + '–' + plan[k].ranges[i][1] + ' mm';
      });
    for (const k of CUT_KEYS) {
      const head = box.querySelector('[data-cut-key="' + k + '"] .bd-op-head');
      if (!head) continue;
      const even = head.querySelector('[data-bd-even]');
      if (building.cuts?.[k] && !even) head.insertAdjacentHTML('beforeend', `<button type="button" class="bd-link" data-bd-even="${k}">Spread evenly</button>`);
      if (!building.cuts?.[k] && even) even.remove();
    }
    return null;
  }
  // The cuts as the form has them: only the parts whose cuts were moved are kept.
  function readCuts(next) {
    const cuts = { ...(next.cuts ?? {}) };
    for (const box of form.querySelectorAll('[data-cut-key]')) {
      const key = box.dataset.cutKey;
      const values = [...box.querySelectorAll('input')].map((el) => (el.value === '' ? NaN : Number(el.value)));
      const moved = values.some((v, i) => Math.abs(v - Number(box.querySelectorAll('input')[i].defaultValue)) > 1e-9);
      if (moved || cuts[key]) cuts[key] = values;
    }
    return cuts;
  }
  // Takes a building as the page now has it, and builds it.
  async function rebuild(next = readForm()) {
    const mine = ++serial;
    try {
      next = validateBuilding(next);
    } catch (err) {
      showError(err.message);
      return;
    }
    const before = building;
    building = next;
    const problem = drawCuts();
    if (problem) {
      building = before;
      showError(problem.message);
      return;
    }
    showError('');
    // The width or depth the rooms make, without redrawing the room fields.
    if (building.rooms) {
      const along = building.rooms.along;
      form.elements[along].value = building[along];
      const sum = $('.bd-rooms .bd-hint');
      if (sum) sum.textContent = building.rooms.sizes.map((v) => fmt(v)).join(' + ') + ' = ' + fmt(building[along]) + ' mm ' + (along === 'width' ? 'wide' : 'deep') + '.';
    }
    remember();
    sync();
    message('Building the parts…');
    try {
      const made = await call('buildingParts', { building, plate: plate() });
      if (mine !== serial) return;
      parts = made;
      sizes = Object.fromEntries(made.map((p) => [p.id, p.print]));
      message('');
      if (view === 'model') show();
      sync();
    } catch (err) {
      if (mine === serial) message(err.message);
    }
  }
  function show() {
    viewport ??= new Viewport($('.bd-model'), (id) => choose(id));
    viewport.resize();
    viewport.setParts(parts, !fitted);
    fitted = true;
    viewport.setApart(apart);
    viewport.select(selected ?? undefined, new Set());
  }
  function choose(id) {
    selected = selected === id ? null : id;
    viewport?.select(selected ?? undefined, new Set());
    sync();
  }
  async function listSaved() {
    try {
      const saved = await (await store()).buildings();
      $('.bd-saved').innerHTML = saved.length
        ? saved
            .map(
              (b) =>
                `<button type="button" class="bd-part${b.id === savedId ? ' active' : ''}" data-bd-open="${esc(b.id)}">${icon('building')}<span><b>${esc(b.name)}</b><small>${fmt(b.building.width)} × ${fmt(b.building.depth)} mm</small></span></button>`,
            )
            .join('')
        : '<p class="bd-later">Buildings you save appear here and in the Library.</p>';
    } catch (err) {
      $('.bd-saved').innerHTML = '<p class="bd-later">' + esc(err.message) + '</p>';
    }
  }
  function fill(b) {
    for (const k of ['width', 'depth', 'height', 'doorWidth', 'doorHeight', 'baseHeight', 'pitch', 'overhangFront', 'overhangBack', 'overhangLeft', 'overhangRight', 'textureScale', 'textureJoint', 'textureDepth'])
      form.elements[k].value = b[k];
    for (const k of ['door', 'ridge', 'rises', 'roofLip']) form.elements[k].value = b[k];
    form.elements.braces.checked = b.braces;
    $('[name="buildingName"]').value = name;
    drawRooms();
    drawStoreys();
    drawOpenings();
  }
  async function exportKit() {
    const files = await call('buildingKit', { building, plate: plate() });
    const zip = { 'README.txt': strToU8(kitNotes(name, building, files, sizes)) };
    files.forEach((f, i) => (zip[String(i + 1).padStart(2, '0') + ' ' + f.name + '.stl'] = f.bytes));
    download((name || 'Building').replace(/[\\/:*?"<>|]+/g, '-') + ' kit.zip', zipSync(zip, { level: 6 }), 'application/zip');
    notice('Kit downloaded: ' + files.length + ' STL files and the notes for printing and putting it together.');
  }
  async function save() {
    const s = await store();
    savedId = await s.saveBuilding({ id: savedId ?? undefined, name: name || 'Building', building, updated: Date.now() });
    remember();
    await listSaved();
    notice('Saved in the Library: ' + (name || 'Building') + '.');
  }
  async function addOpening(type) {
    const current = readForm();
    const opening = { ...OPENING_DEFAULTS[type] };
    let base;
    try {
      base = validateBuilding(current);
    } catch (err) {
      showError(err.message);
      return;
    }
    const s = storeyOf(base, storey);
    // A storey above has lower walls: a window starts lower in them.
    if (type === 'window' && opening.sill + opening.height > s.height - KIT.frame) opening.sill = Math.max(0, s.height - KIT.frame - opening.height - 10);
    const at = freePlace(base, wall, opening, storey);
    if (at === null) {
      showError('There is no room for a ' + type + ' of ' + opening.width + ' mm in the ' + wall + ' wall. Make the wall longer, or the other openings smaller.');
      return;
    }
    building = withStorey(base, storey, { openings: [...s.openings, { ...opening, wall, at }] });
    drawOpenings();
    await rebuild(building);
  }

  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => rebuild(), 250);
  });
  form.addEventListener('change', () => {
    clearTimeout(timer);
    rebuild();
  });
  $('[name="apart"]').addEventListener('input', (e) => {
    apart = Number(e.target.value) / 100;
    viewport?.setApart(apart);
  });
  $('[name="buildingName"]').addEventListener('input', (e) => {
    name = e.target.value.trim();
    remember();
    $('[data-bd-name]').textContent = name || 'Building';
  });
  host.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.bdView) {
        view = b.dataset.bdView;
        sync();
        if (view === 'model' && parts.length) show();
      } else if (b.dataset.bdRoof) {
        const next = { ...readForm(), roof: b.dataset.bdRoof };
        fitted = false;
        await rebuild(next);
      } else if (b.dataset.bdEven) {
        const cuts = { ...building.cuts };
        delete cuts[b.dataset.bdEven];
        await rebuild({ ...readForm(), cuts });
      } else if (b.dataset.bdWallTexture) await rebuild(withStorey(readForm(), storey, { wallTexture: b.dataset.bdWallTexture }));
      else if (b.dataset.bdRoofTexture) await rebuild({ ...readForm(), roofTexture: b.dataset.bdRoofTexture });
      else if (b.dataset.bdStorey !== undefined) {
        const next = readForm();
        try {
          building = validateBuilding(next);
        } catch {
          // Keep the last good building; the error stays in view.
        }
        storey = Number(b.dataset.bdStorey);
        drawStoreys();
        drawOpenings();
        sync();
      } else if (b.dataset.bdRooms !== undefined) {
        // One room, or two of half the width or depth each.
        const base = readForm();
        const along = b.dataset.bdRooms;
        const half = along && Math.round(base[along] / 2);
        const next = withRooms(base, along ? { along, sizes: base.rooms?.along === along ? base.rooms.sizes : [half, base[along] - half] } : null);
        fitted = false;
        await rebuild(next);
        drawRooms();
        form.elements.doorWidth.value = building.doorWidth;
      } else if (b.dataset.bdAddRoom !== undefined) {
        const base = readForm();
        const sizes = [...base.rooms.sizes, base.rooms.sizes.at(-1)];
        fitted = false;
        await rebuild(withRooms(base, { ...base.rooms, sizes }));
        drawRooms();
        form.elements.doorWidth.value = building.doorWidth;
      } else if (b.dataset.bdRemoveRoom !== undefined) {
        const base = readForm();
        const sizes = base.rooms.sizes.filter((_, i) => i !== Number(b.dataset.bdRemoveRoom));
        fitted = false;
        await rebuild({ ...base, rooms: { ...base.rooms, sizes } });
        drawRooms();
      } else if (b.dataset.bdAddStorey !== undefined) {
        const base = validateBuilding(readForm());
        const top = storeyOf(base, base.upper.length);
        const next = { ...base, upper: [...base.upper, { ...UPPER_DEFAULTS, width: top.width, depth: top.depth, openings: [] }] };
        fitted = false;
        storey = next.upper.length;
        building = validateBuilding(next);
        drawStoreys();
        drawOpenings();
        await rebuild(building);
      } else if (b.dataset.bdRemoveStorey !== undefined) {
        const base = readForm();
        // A storey above the one removed goes with it: it stood on it.
        const next = { ...base, upper: base.upper.slice(0, storey - 1) };
        fitted = false;
        storey -= 1;
        building = { ...building, upper: next.upper };
        drawStoreys();
        drawOpenings();
        await rebuild(next);
      } else if (b.dataset.bdWall) {
        const next = readForm();
        wall = b.dataset.bdWall;
        try {
          building = validateBuilding(next);
        } catch {
          // Keep the last good building; the error stays in view.
        }
        drawOpenings();
      } else if (b.dataset.bdAdd) await addOpening(b.dataset.bdAdd);
      else if (b.dataset.bdRemove !== undefined) {
        const next = readForm();
        const openings = storeyOf(next, storey).openings.filter((_, i) => i !== Number(b.dataset.bdRemove));
        building = withStorey(building, storey, { openings });
        drawOpenings();
        await rebuild(withStorey(next, storey, { openings }));
      } else if (b.dataset.bdPart) choose(b.dataset.bdPart);
      else if (b.dataset.bdOpen) await open(b.dataset.bdOpen);
      else if (b.dataset.bd === 'export') await exportKit();
      else if (b.dataset.bd === 'save') await save();
      else if (b.dataset.bd === 'new') {
        building = validateBuilding({});
        name = 'Garage';
        savedId = null;
        storey = 0;
        fitted = false;
        fill(building);
        await rebuild(building);
        await listSaved();
      }
    } catch (err) {
      notice(err.message);
    }
  });
  async function open(id) {
    const saved = await (await store()).building(id);
    building = saved.building;
    name = saved.name;
    savedId = saved.id;
    storey = 0;
    fitted = false;
    fill(building);
    await rebuild(building);
    await listSaved();
  }

  return {
    async show() {
      fill(building);
      await Promise.all([rebuild(building), listSaved()]);
    },
    open,
    resize: () => viewport?.resize(),
  };
}
