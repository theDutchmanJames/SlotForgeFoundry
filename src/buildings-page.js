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
import { BUILDING_PRESETS } from './building-presets.js';
import { GRANDSTAND_LIMITS, sizeLine, standDepth } from './geometry/grandstand.js';
import { GANTRY_LIMITS, GANTRY_TYPES, gantrySize } from './geometry/gantry.js';
import { PIT_MODULE_LIMITS, pitLevels } from './geometry/pit-module.js';
import { MARSHAL_POST_LIMITS, marshalLevels } from './geometry/marshal-post.js';
import { PLATFORM_LIMITS, platformFootprint, platformStair } from './geometry/viewing-platform.js';
import { WALKWAY_LIMITS } from './geometry/walkway.js';
import { BAYS as BAY_KIT, BAY_TYPES, PIT_BAYS_LIMITS } from './geometry/pit-bays.js';
import {
  BUILDING_DEFAULTS,
  BUILDING_LIMITS,
  HATCH,
  KIT,
  SIGNS,
  STAND,
  OPEN,
  LEAN,
  RELIEF,
  FRAME_WALL,
  ACCESS,
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
  <div class="bd-card-head"><span class="bd-tile">${icon('building')}</span><span><b>Buildings</b><small>Toy proportions for 1:32</small></span></div>
  <div class="bd-group">Start from</div>
  <div class="bd-presets">${BUILDING_PRESETS.map((p) => `<button type="button" class="bd-preset" data-bd-preset="${p.id}" title="${esc(p.note)}">${esc(p.name)}</button>`).join('')}</div>
  <div class="bd-group">Parts of the kit</div>
  <div class="bd-parts" role="list"></div>
  <div class="bd-group">Your buildings</div>
  <div class="bd-saved"></div>
  <div class="bd-group">Coming later</div>
  <p class="bd-later">Grandstands, gantries and bridges over the track, billboards and a podium; clipping to the track. Place a saved building beside the track, or a row of garages over the pit bays, in the Track Planner.</p>
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
    <section class="bd-box" data-bd-card="pits" data-bd-pits hidden><h3>Pit building</h3>
      ${field('pBays', 'Bays', 3, PIT_MODULE_LIMITS.bays, '')}
      ${field('pBayWidth', 'Bay width', 110, PIT_MODULE_LIMITS.bayWidth)}
      ${field('pDepth', 'Depth', 150, PIT_MODULE_LIMITS.depth)}
      ${field('pBase', 'Base height', 10, PIT_MODULE_LIMITS.baseHeight)}
      <p class="bd-hint" data-bd-pits-size></p></section>
    <section class="bd-box" data-bd-card="pitsDoors" data-bd-pits hidden><h3>Garage doors</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Door"><button type="button" data-bd-pits-door="panel">Up-and-over</button><button type="button" data-bd-pits-door="roller">Roller</button></div>
      ${field('pDoorWidth', 'Door width', 82, PIT_MODULE_LIMITS.doorWidth)}
      ${field('pDoorHeight', 'Door height', 52, PIT_MODULE_LIMITS.doorHeight)}
      ${field('pRecess', 'Set back', 8, PIT_MODULE_LIMITS.recess)}
      <label class="bd-check"><input type="checkbox" name="pNumbers"><span>Bay numbers on the balcony</span></label>
      ${field('pFirst', 'First number', 1, PIT_MODULE_LIMITS.firstNumber, '')}
      <p class="bd-hint">Each door stands back in a reveal between two columns, its sides at 45°: wider at the front than at the door, so the bays print standing without supports.</p></section>
    <section class="bd-box" data-bd-card="pitsUpper" data-bd-pits hidden><h3>Balcony and lounge</h3>
      ${field('pGround', 'Ground floor height', 65, PIT_MODULE_LIMITS.groundHeight)}
      ${field('pBalcony', 'Balcony', 25, PIT_MODULE_LIMITS.balcony)}
      ${field('pLounge', 'Lounge height', 50, PIT_MODULE_LIMITS.loungeHeight)}
      ${field('pLean', 'Glazing lean', 15, PIT_MODULE_LIMITS.lean, '°')}
      ${field('pVisor', 'Visor', 12, PIT_MODULE_LIMITS.visor)}
      <label class="bd-check"><input type="checkbox" name="pRailing"><span>Railing along the balcony</span></label>
      <label class="bd-check"><input type="checkbox" name="pRoofRailing"><span>Railing round the roof</span></label>
      <p class="bd-hint">The balcony reaches out over the pit lane, its front an angled fascia. Above it the lounge's glazing leans out towards the roof, and the roof's visor reaches out beyond it.</p></section>
    <section class="bd-box" data-bd-card="bays" data-bd-bays hidden><h3>Pit building</h3>
      <div class="bd-bay-list"></div>
      <div class="bd-adds"><button type="button" class="bd-add" data-bd-bay-add>${icon('plus')}Bay</button></div>
      ${field('bBayWidth', 'Bay width', 110, PIT_BAYS_LIMITS.bayWidth)}
      ${field('bDepth', 'Depth', 150, PIT_BAYS_LIMITS.depth)}
      ${field('bBase', 'Base height', 10, PIT_BAYS_LIMITS.baseHeight)}
      <p class="bd-hint" data-bd-bays-size></p></section>
    <section class="bd-box" data-bd-card="baysDoors" data-bd-bays hidden><h3>Garage doors</h3>
      <label class="bd-row"><span>Door</span><select name="bDoor"><option value="panel">Up-and-over</option><option value="roller">Roller</option></select></label>
      ${field('bDoorWidth', 'Door width', 82, PIT_BAYS_LIMITS.doorWidth)}
      ${field('bDoorHeight', 'Door height', 52, PIT_BAYS_LIMITS.doorHeight)}
      ${field('bRecess', 'Set back', 4, PIT_BAYS_LIMITS.recess)}
      <label class="bd-check"><input type="checkbox" name="bNumbers"><span>Bay numbers over the doors</span></label>
      ${field('bFirst', 'First number', 1, PIT_BAYS_LIMITS.firstNumber, '')}
      </section>
    <section class="bd-box" data-bd-card="baysUpper" data-bd-bays hidden><h3>Boxes and podiums</h3>
      ${field('bGround', 'Ground floor height', 65, PIT_BAYS_LIMITS.groundHeight)}
      ${field('bUpper', 'Upper storey height', 50, PIT_BAYS_LIMITS.upperHeight)}
      ${field('bJut', 'Roof reaches out', 24, PIT_BAYS_LIMITS.jut)}
      ${field('bSetBack', 'Glazing set back', 16, PIT_BAYS_LIMITS.setBack)}
      ${field('bLean', 'Glazing leans out', 12, PIT_BAYS_LIMITS.lean, '°')}
      ${field('bBalcony', 'Balcony reaches out', 24, PIT_BAYS_LIMITS.balcony)}
      <label class="bd-check"><input type="checkbox" name="bBalconyRailing"><span>A railing along each balcony</span></label>
      <label class="bd-check"><input type="checkbox" name="bRoofRailing"><span>A truss railing round each roof</span></label>
      <label class="bd-check"><input type="checkbox" name="bPillars"><span>Pillars between the garages</span></label>
      <p class="bd-hint">A corporate box stands over its garage: its glazing leaning out at the top, set back between tapering fins under a roof that reaches out over the lane, a balcony slab in front with a railing of bars. A podium is a box whose balcony reaches out further as a platform with angled sides, the podium on it. Every roof has a solid upstand along its front and a truss railing round the rest. Each bay prints standing on its end; the closed side at its start is the wall between two garages, its pillar and the fin of a frame.</p></section>
    <section class="bd-box" data-bd-card="walkway" data-bd-walkway hidden><h3>Walkway</h3>
      ${field('wLength', 'Length', 150, WALKWAY_LIMITS.length)}
      ${field('wWidth', 'Width', 32, WALKWAY_LIMITS.width)}
      ${field('wHeight', 'Wall height', 30, WALKWAY_LIMITS.height)}
      ${field('wClearance', 'Deck above the table', 70, WALKWAY_LIMITS.clearance)}
      ${field('wWaist', 'Wall under the windows', 8, WALKWAY_LIMITS.waist)}
      ${field('wPanes', 'Panes along each side', 4, WALKWAY_LIMITS.panes, '')}
      <label class="bd-check" data-bd-walkway-legs><input type="checkbox" name="wLegs"><span>On legs at its ends</span></label>
      <label class="bd-check"><input type="checkbox" name="wTowers"><span>A tower at each end</span></label>
      <div data-bd-towers>
      ${field('wTowerWidth', 'Tower width', 60, WALKWAY_LIMITS.towerWidth)}
      ${field('wTowerDepth', 'Tower depth', 60, WALKWAY_LIMITS.towerDepth)}
      ${field('wTowerHeight', 'Tower height', 110, WALKWAY_LIMITS.towerHeight)}
      <label class="bd-row"><span>Tower roof</span><select name="wTowerRoof"><option value="hip">Pyramid</option><option value="flat">Flat</option></select></label>
      <label class="bd-check"><input type="checkbox" name="wTowerWindows"><span>Windows up each tower's front and back</span></label>
      <label class="bd-row"><span>Control cab on top</span><select name="wTowerCab"><option value="none">None</option><option value="left">On the left tower</option><option value="right">On the right tower</option><option value="both">On both towers</option></select></label>
      </div>
      <p class="bd-hint">A covered walkway between two buildings, open at its ends where it meets them. Set its length to the gap between them and the deck as high as the floors it joins: the top of a base on a stand, or a storey's floor. Each side stands in a groove along the deck, a band of windows in panes; the roof's rails hold them apart. Without legs it rests on the buildings, glued to them. With a tower at each end it is a whole piece: each tower a building of its own, a doorway in its wall where the walkway joins it at the height of its deck.</p></section>
    <section class="bd-box" data-bd-card="platform" data-bd-platform hidden><h3>Viewing platform</h3>
      ${field('vWidth', 'Width', 150, PLATFORM_LIMITS.width)}
      ${field('vDepth', 'Depth', 110, PLATFORM_LIMITS.depth)}
      ${field('vHeight', 'Deck height', 65, PLATFORM_LIMITS.height)}
      <label class="bd-check"><input type="checkbox" name="vPlanks"><span>Planks on the deck</span></label>
      <p class="bd-hint" data-bd-platform-size></p></section>
    <section class="bd-box" data-bd-card="platformStair" data-bd-platform hidden><h3>Staircase</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Staircase"><button type="button" data-bd-platform-stair="left">Left</button><button type="button" data-bd-platform-stair="right">Right</button><button type="button" data-bd-platform-stair="both">Both</button><button type="button" data-bd-platform-stair="none">None</button></div>
      ${field('vStairWidth', 'Width', 30, PLATFORM_LIMITS.stairWidth, 'mm', ' data-bd-stair-width')}
      <p class="bd-hint">A staircase runs up an end of the platform, or both ends, to a landing level with the deck at the back, a wall on its outer side. It prints lying on that wall, the steps rising straight up.</p></section>
    <section class="bd-box" data-bd-card="platformRail" data-bd-platform hidden><h3>Railing and board</h3>
      <label class="bd-check"><input type="checkbox" name="vRailing"><span>A railing round the deck</span></label>
      ${field('vRailingHeight', 'Railing height', 26, PLATFORM_LIMITS.railingHeight, 'mm', ' data-bd-railing-height')}
      <label class="bd-row"><span>Railing</span><select name="vRailingStyle"><option value="bars">Bars</option><option value="mesh">Mesh</option></select></label>
      <label class="bd-check"><input type="checkbox" name="vBoard"><span>A board for a sign along the front</span></label>
      ${field('vBoardHeight', 'Board height', 18, PLATFORM_LIMITS.boardHeight, 'mm', ' data-bd-board-height')}
      <p class="bd-hint">The railings print flat and push into pockets along the edges of the deck, open at the top of the staircase. The board is glued on the front frame under the deck, flush with its edge.</p></section>
    <section class="bd-box" data-bd-card="marshal" data-bd-marshal hidden><h3>Marshal post</h3>
      ${field('mWidth', 'Width', 80, MARSHAL_POST_LIMITS.width)}
      ${field('mDepth', 'Depth', 72, MARSHAL_POST_LIMITS.depth)}
      ${field('mDeck', 'Floor above the table', 40, MARSHAL_POST_LIMITS.deckHeight)}
      <label class="bd-check" data-bd-raised><input type="checkbox" name="mLadder"><span>A ladder up to the back</span></label>
      <p class="bd-hint" data-bd-marshal-size></p></section>
    <section class="bd-box" data-bd-card="marshalWalls" data-bd-marshal hidden><h3>Wall</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Wall"><button type="button" data-bd-marshal-walls="slats">Slats</button><button type="button" data-bd-marshal-walls="boards">Boards</button><button type="button" data-bd-marshal-walls="plain">Plain</button></div>
      ${field('mWall', 'Wall height', 22, MARSHAL_POST_LIMITS.wallHeight)}
      ${field('mEntrance', 'Opening at the back', 24, MARSHAL_POST_LIMITS.entrance)}
      <label class="bd-check"><input type="checkbox" name="mNumbers"><span>A number disc on the front</span></label>
      ${field('mNumber', 'Number', 3, MARSHAL_POST_LIMITS.number, '')}
      <p class="bd-hint">A waist-high wall all round the cabin. Slats have upright gaps that close in a point at the top, so they print; boards have V-grooves that run on round the corners; a plain wall takes a sign. An opening of 0 closes the back.</p></section>
    <section class="bd-box" data-bd-card="marshalRoof" data-bd-marshal hidden><h3>Roof</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Roof"><button type="button" data-bd-marshal-roof="tin">Tin</button><button type="button" data-bd-marshal-roof="flat">Flat</button></div>
      ${field('mRoom', 'Height at the front', 62, MARSHAL_POST_LIMITS.roomHeight)}
      ${field('mFall', 'Lower at the back by', 8, MARSHAL_POST_LIMITS.fall)}
      ${field('mOverhang', 'Overhang at the front', 10, MARSHAL_POST_LIMITS.overhang)}
      <p class="bd-hint">The roof stands on a post at each corner, its height measured from the floor, and falls to the back. A pin on top of each post goes up through a hole in the roof, which prints lying on its underside, the corrugations of a tin roof on top.</p></section>
    <section class="bd-box" data-bd-card="gantry" data-bd-gantry hidden><h3>Over the track</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Type">${GANTRY_TYPES.map(([id, label]) => `<button type="button" data-bd-gantry-type="${id}">${label}</button>`).join('')}</div>
      ${field('tSpan', 'Span', 220, GANTRY_LIMITS.span)}
      ${field('tClearance', 'Clearance', 70, GANTRY_LIMITS.clearance)}
      <label class="bd-row"><span>Members</span><select name="tMembers"><option value="solid">Solid</option><option value="lattice">Lattice, like steel</option></select></label>
      <p class="bd-hint" data-bd-gantry-size></p></section>
    <section class="bd-box" data-bd-card="gantryBeam" data-bd-gantry data-bd-beam hidden><h3>Beam</h3>
      ${field('tLights', 'Start lights', 5, GANTRY_LIMITS.lights, '', ' data-bd-lights')}
      ${field('tReach', 'Reach over the road', 140, GANTRY_LIMITS.reach, 'mm', ' data-bd-reach')}
      <label class="bd-check"><input type="checkbox" name="tBoard"><span>An advertising board on top</span></label>
      ${field('tBoardHeight', 'Board height', 20, GANTRY_LIMITS.boardHeight)}
      <p class="bd-hint">The beam drops onto a pin on top of each leg. It prints on its back: the board flat on the plate, the start lights facing up. Legs stand on their foot plates to print.</p></section>
    <section class="bd-box" data-bd-card="gantryBridge" data-bd-gantry data-bd-bridge hidden><h3>Walkway</h3>
      ${field('tDeck', 'Width', 30, GANTRY_LIMITS.deckWidth)}
      ${field('tWalls', 'Walls above the walkway', 14, GANTRY_LIMITS.wallHeight)}
      <p class="bd-hint">The walkway lies on the landings of the two staircases, between solid walls. It prints standing up like a channel; each staircase prints on its side.</p></section>
    <section class="bd-box" data-bd-card="stand" data-bd-stand hidden><h3>Grandstand</h3>
      ${field('gLength', 'Length', 240, GRANDSTAND_LIMITS.length)}
      ${field('gRows', 'Rows', 6, GRANDSTAND_LIMITS.rows, '')}
      ${field('gRowDepth', 'Row depth', 18, GRANDSTAND_LIMITS.rowDepth)}
      ${field('gRowRise', 'Row rise', 9, GRANDSTAND_LIMITS.rowRise)}
      ${field('gFront', 'Front row height', 12, GRANDSTAND_LIMITS.frontHeight)}
      ${field('gBack', 'Back wall above the last row', 15, GRANDSTAND_LIMITS.backHeight)}
      ${field('gAisles', 'Aisles', 1, GRANDSTAND_LIMITS.aisles, '')}
      <label class="bd-check"><input type="checkbox" name="gSeats"><span>A bench on each row</span></label>
      <label class="bd-check"><input type="checkbox" name="gBackrests"><span>Benches with backs</span></label>
      <p class="bd-hint" data-bd-stand-size></p></section>
    <section class="bd-box" data-bd-card="standFrame" data-bd-stand hidden><h3>Frame, stairs and railings</h3>
      <div data-bd-stand-straight>
      ${field('gRaised', 'Raised on frames', 0, GRANDSTAND_LIMITS.raised)}
      <label class="bd-row"><span>Staircase</span><select name="gStairs"><option value="none">None</option><option value="left">At the left end</option><option value="right">At the right end</option><option value="both">At both ends</option></select></label>
      <label class="bd-check"><input type="checkbox" name="gRailings"><span>Railings round the sides and the back</span></label>
      </div>
      <p class="bd-hint" data-bd-stand-frame-hint></p></section>
    <section class="bd-box" data-bd-card="standShape" data-bd-stand hidden><h3>Shape</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Shape"><button type="button" data-bd-stand-shape="straight">Straight</button><button type="button" data-bd-stand-shape="curved">Curved</button></div>
      <div data-bd-curve>
      ${field('gRadius', 'Radius at the front', 450, [100, 3000])}
      ${field('gAngle', 'Angle', 45, [10, 180], '°')}
      <label class="bd-row"><span>Faces</span><select name="gFacing"><option value="in">Into the curve</option><option value="out">Out of the curve</option></select></label>
      </div>
      <p class="bd-hint">Curved, the rows follow an arc round a corner: facing into the curve for the outside of a bend, out of it for the inside. Its length is then along the front, from the radius and the angle.</p></section>
    <section class="bd-box" data-bd-card="standRoof" data-bd-stand hidden><h3>Roof</h3>
      <label class="bd-row"><span>Roof</span><select name="gRoof"><option value="none">None, open to the sky</option><option value="canopy">A canopy on posts</option></select></label>
      ${field('gRoofHeight', 'Canopy above the last row', 50, GRANDSTAND_LIMITS.roofHeight, 'mm', ' data-bd-canopy')}
      <p class="bd-hint">The canopy rests on the back wall and on posts in front of the parapet. It and its posts print flat.</p></section>
    <section class="bd-box" data-bd-card="standPrint" data-bd-stand hidden><h3>Printing</h3>
      ${field('gSection', 'Longest section', 120, GRANDSTAND_LIMITS.sectionLength)}
      <p class="bd-hint">The grandstand is a hollow stepped shell, 3 mm thick, in sections that each print standing on their end: the stepped side lies on the plate and the rows rise straight up, so nothing overhangs. Set the longest section to what your printer can print in height. The sections join end to end with two small tabs, in the back wall and in the parapet; no cut runs through an aisle.</p></section>
    <section class="bd-box" data-bd-card="size"><h3>Size</h3>
      ${field('width', 'Width', building.width, BUILDING_LIMITS.width)}
      ${field('depth', 'Depth', building.depth, BUILDING_LIMITS.depth)}
      ${field('height', 'Wall height', building.height, BUILDING_LIMITS.height)}
      <div class="bd-sub">Rooms</div>
      <div class="bd-seg bd-wide" role="group" aria-label="Rooms"><button type="button" data-bd-rooms="">One room</button><button type="button" data-bd-rooms="width">Side by side</button><button type="button" data-bd-rooms="depth">Front to back</button></div>
      <div class="bd-rooms"></div>
      <p class="bd-hint">The ground floor, outside the walls, up to the eaves. A one-car garage of 120 × 180 mm and 75 mm high takes practically any 1:32 slot car. Rooms are measured outside to outside, each to the middle of a dividing wall, so they add up to the width or the depth: two rooms of 200 and 150 make a building 350 mm wide. Side by side, each room has its own garage door.</p></section>
    <section class="bd-box" data-bd-card="storeys"><h3>Storeys</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Storey" data-bd-storeys></div>
      <div class="bd-storey"></div>
      <div class="bd-adds"><button type="button" class="bd-add" data-bd-add-storey>${icon('plus')}Storey</button></div>
      <p class="bd-hint">Each storey stands on a floor laid on the one below, its walls in a groove of the floor. It can be smaller than the storey below and set back, leaving a terrace. Windows and doors and the wall texture are set for the storey chosen here; the roof sits on the top storey.</p></section>
    <section class="bd-box" data-bd-card="roof"><h3>Roof</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Roof">${ROOFS.map(([id, label]) => `<button type="button" data-bd-roof="${id}">${label}</button>`).join('')}</div>
      ${field('pitch', 'Pitch', building.pitch, BUILDING_LIMITS.pitch, '°', ' data-bd-for="slope gable hip"')}
      <label class="bd-row" data-bd-for="gable"><span>Ridge runs</span><select name="ridge"><option value="depth">Front to back</option><option value="width">Side to side</option></select></label>
      <label class="bd-row" data-bd-for="slope"><span>Rises towards</span><select name="rises">${WALLS.map((w) => `<option value="${w}">The ${w}</option>`).join('')}</select></label>
      <label class="bd-check" data-bd-for="flat"><input type="checkbox" name="roofRailing"><span>A railing round the roof, for a terrace</span></label>
      <label class="bd-row"><span>Railings</span><select name="railingStyle"><option value="bars">Bars</option><option value="mesh">Mesh</option><option value="lattice">Lattice, an X between posts</option></select></label>
      <label class="bd-row"><span>Under the roof</span><select name="roofLip"><option value="frame">Frame with tabs</option><option value="none">Nothing</option></select></label>
      <div class="bd-sub">Overhang</div>
      <div class="bd-sides">${SIDES.map(([k, label]) => field(k, label, building[k], BUILDING_LIMITS[k])).join('')}</div>
      <p class="bd-hint">How far the roof reaches past each wall. A sloped or two-sided roof lies on the walls, which follow it. Under the roof a frame drops inside the walls and holds them square; small tabs on it push into pockets in the roof's underside, so the roof prints the right way up with its texture on top. With nothing under it, the roof is glued along the tops of the walls.</p></section>
    <section class="bd-box" data-bd-card="surface"><h3>Surface</h3>
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
    <section class="bd-box" data-bd-card="garage"><h3>Garage door</h3>
      ${field('doorWidth', 'Width', building.doorWidth, BUILDING_LIMITS.doorWidth)}
      ${field('doorHeight', 'Height', building.doorHeight, BUILDING_LIMITS.doorHeight)}
      <label class="bd-row"><span>Door</span><select name="door"><option value="roller">Roller door</option><option value="panel">Up-and-over door</option><option value="open">Open, no door</option><option value="none">No garage door</option></select></label>
      <label class="bd-check"><input type="checkbox" name="numbers"><span>Bay numbers above the doors</span></label>
      ${field('firstNumber', 'First number', 1, [0, 76], '')}
      <p class="bd-hint">The opening starts at the top of the base, so a car rolls straight in from the road. An up-and-over door is a panel door in four parts. A bay number is a plaque with its number raised in seven segments, like on a pit wall, glued above its door; the bays count on from the first number.</p></section>
    <section class="bd-box" data-bd-card="openings"><h3>Windows and doors</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Wall">${WALLS.map((w) => `<button type="button" data-bd-wall="${w}">${WALL_NAMES[w]}</button>`).join('')}</div>
      <div class="bd-openings"></div>
      <div class="bd-adds"><button type="button" class="bd-add" data-bd-add="window">${icon('plus')}Window</button><button type="button" class="bd-add" data-bd-add="door">${icon('plus')}Door</button></div>
      <label class="bd-row"><span>Sign</span><select name="sign">${SIGNS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
      <div data-bd-sign-size>
      ${field('signWidth', 'Sign width', 80, BUILDING_LIMITS.signWidth)}
      ${field('signHeight', 'Sign height', 14, BUILDING_LIMITS.signHeight)}
      </div>
      <p class="bd-hint">Each is a hole in the wall. Place is the middle of the opening, measured from the left end of the wall as you look at it from outside. A frame is a part of its own, glued on around the opening. A window makes a serving hatch with a counter under it and a flap propped open over it: each prints flat, and two small fins on it set its angle against the wall. A sign is a board for the name of a stall, in the middle of the front: along the top of the front wall under the eaves, or a billboard standing up on the roof at its front edge, its height above the roof, held by two fins behind it.</p></section>
    <section class="bd-box" data-bd-fitting hidden><h3>Fitting the plate</h3>
      <div class="bd-cuts"></div>
      <p class="bd-hint">A part longer than your plate is cut into pieces that join like a puzzle: dovetail tabs, or along the joints of a brick or block wall so the seam is one more joint. Move a cut anywhere in its range: both pieces still fit the plate, with the tab. A cut may run through a window or a door, not along its side.</p></section>
    <section class="bd-box" data-bd-card="support"><h3>Stand</h3>
      <label class="bd-row"><span>Stands on</span><select name="standType">${STAND.types.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
      <div data-bd-stand-size>
      ${field('standHeight', 'Height', building.standHeight, BUILDING_LIMITS.standHeight)}
      ${field('standSize', 'Size', building.standSize, BUILDING_LIMITS.standSize)}
      <div data-bd-column>
      <label class="bd-row"><span>Column</span><select name="standShape"><option value="square">Square</option><option value="round">Round</option></select></label>
      ${field('standTaper', 'Wider at its foot', building.standTaper, BUILDING_LIMITS.standTaper, '%')}
      </div></div>
      <p class="bd-hint">Raise the building off the table: on four legs in the corners of its base, on one column in the middle (square or round, wider at its foot) or on a braced tower of four frames. Size is a leg's side, the column's top or the tower's side; the building may reach out past it all round. Each support has pins on top that push up into pockets under the base. Legs and the column print standing up; the tower's frames print flat and stand in its foot.</p></section>
    <section class="bd-box" data-bd-card="access"><h3>Way up</h3>
      <label class="bd-row"><span>Way up</span><select name="access">${ACCESS.kinds.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
      <div data-bd-access>
      <label class="bd-row"><span>Against</span><select name="accessWall">${WALLS.map((w) => `<option value="${w}">The ${w} wall</option>`).join('')}</select></label>
      ${field('accessAt', 'From the left end', building.accessAt, [-200, 1500])}
      <label class="bd-row"><span>Up to</span><select name="accessTo">${ACCESS.levels.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
      </div>
      <p class="bd-hint">A ladder leans on a wall from the table up to the base on a stand, the floor of a storey or a flat roof; a staircase runs along the wall to a landing there, a wall on its outer side, and may start beyond the end of the wall. From the left end is where its foot is, measured along the wall as you look at it from outside. It stands clear of the base, the relief, a balcony and the roof. A ladder prints flat on its back, a staircase on its outer wall.</p></section>
    <section class="bd-box" data-bd-card="base"><h3>Base</h3>
      ${field('baseHeight', 'Height', building.baseHeight, BUILDING_LIMITS.baseHeight)}
      <p class="bd-hint">Make it as high as your track, so the doorstep is level with the road. It stands on the table, hollow underneath.</p></section>
    <section class="bd-box" data-bd-card="walls"><h3>Walls</h3>
      <label class="bd-check"><input type="checkbox" name="braces"><span>Corner braces</span></label>
      <p class="bd-hint">Walls ${KIT.wall} mm thick, mitred at the corners so the outside has no seam, standing ${KIT.groove} mm deep in a groove of the base. A corner brace is a small L glued into each inside corner, on the floor against both walls: it holds the corner square while the glue sets. Under the roof and every floor a frame drops inside the walls and holds their tops.</p></section>
    <p class="bd-error" role="alert" hidden></p>
  </form>
</aside></div>`;

  const form = $('.bd-form');

  const isStand = () => building.kind === 'grandstand';
  const isGantry = () => building.kind === 'gantry';
  const isPits = () => building.kind === 'pitmodule';
  const isMarshal = () => building.kind === 'marshalpost';
  const isPlatform = () => building.kind === 'platform';
  const isWalkway = () => building.kind === 'walkway';
  const isBays = () => building.kind === 'pitbays';
  const isGarage = () => !isStand() && !isGantry() && !isPits() && !isMarshal() && !isPlatform() && !isWalkway() && !isBays();
  // A garage's cards, a grandstand's, a gantry's or a pit building's.
  function showKind() {
    const kind = isStand() ? 'stand' : isGantry() ? 'gantry' : isPits() ? 'pits' : isMarshal() ? 'marshal' : isPlatform() ? 'platform' : isWalkway() ? 'walkway' : isBays() ? 'bays' : 'garage';
    for (const box of form.querySelectorAll('section.bd-box')) {
      if (box.hasAttribute('data-bd-fitting')) continue;
      const own = ['stand', 'gantry', 'pits', 'marshal', 'platform', 'walkway', 'bays'].find((k) => box.hasAttribute('data-bd-' + k)) ?? 'garage';
      box.hidden = own !== kind;
    }
    if (!isGarage()) $('[data-bd-fitting]').hidden = true;
    if (isGantry()) drawGantry();
    if (isPits()) drawPits();
    if (isMarshal()) drawMarshal();
    if (isPlatform()) drawPlatform();
  }
  const BAYS_FIELDS = [['bBayWidth', 'bayWidth'], ['bDepth', 'depth'], ['bBase', 'baseHeight'], ['bDoorWidth', 'doorWidth'], ['bDoorHeight', 'doorHeight'], ['bRecess', 'recess'], ['bFirst', 'firstNumber'], ['bGround', 'groundHeight'], ['bUpper', 'upperHeight'], ['bJut', 'jut'], ['bSetBack', 'setBack'], ['bLean', 'lean'], ['bBalcony', 'balcony']];
  const BAYS_CHECKS = [['bNumbers', 'numbers'], ['bBalconyRailing', 'balconyRailing'], ['bRoofRailing', 'roofRailing'], ['bPillars', 'pillars']];
  function fillBays(m) {
    const e = form.elements;
    for (const [k, key] of BAYS_FIELDS) e[k].value = m[key];
    for (const [k, key] of BAYS_CHECKS) e[k].checked = m[key];
    e.bDoor.value = m.door;
    drawBays();
  }
  // Each bay a row: its type, and a button to take it out.
  function drawBays() {
    const m = building;
    $('.bd-bay-list').innerHTML = m.types
      .map(
        (t, i) =>
          `<label class="bd-row"><span>Bay ${i + 1}</span><select name="bType-${i}">${BAY_TYPES.map(([id, label]) => `<option value="${id}"${id === t ? ' selected' : ''}>${label}</option>`).join('')}</select>${m.types.length > 1 ? `<button type="button" class="bd-remove" data-bd-bay-remove="${i}" title="Remove" aria-label="Remove bay ${i + 1}">${icon('close')}</button>` : ''}</label>`,
      )
      .join('');
    form.elements.bFirst.closest('label').hidden = !m.numbers;
    $('[data-bd-bays-size]').textContent = m.types.length + (m.types.length === 1 ? ' bay, ' : ' bays, ') + fmt(m.types.length * m.bayWidth + BAY_KIT.side) + ' mm long and ' + fmt(m.depth) + ' mm deep on the table. Each bay prints standing on its end and joins the next with tabs in the back wall.';
  }
  function readBays() {
    const e = form.elements;
    const num = (el) => (el.value === '' ? NaN : Number(el.value));
    const m = { kind: 'pitbays', types: building.types.map((t, i) => e['bType-' + i]?.value ?? t), door: e.bDoor.value };
    for (const [k, key] of BAYS_FIELDS) m[key] = num(e[k]);
    for (const [k, key] of BAYS_CHECKS) m[key] = e[k].checked;
    return m;
  }
  const WALKWAY_FIELDS = [['wLength', 'length'], ['wWidth', 'width'], ['wHeight', 'height'], ['wClearance', 'clearance'], ['wWaist', 'waist'], ['wPanes', 'panes'], ['wTowerWidth', 'towerWidth'], ['wTowerDepth', 'towerDepth'], ['wTowerHeight', 'towerHeight']];
  function fillWalkway(w) {
    const e = form.elements;
    for (const [k, key] of WALKWAY_FIELDS) e[k].value = w[key];
    e.wLegs.checked = w.legs;
    e.wTowers.checked = w.towers;
    e.wTowerWindows.checked = w.towerWindows;
    e.wTowerRoof.value = w.towerRoof;
    e.wTowerCab.value = w.towerCab;
    $('[data-bd-towers]').hidden = !w.towers;
    $('[data-bd-walkway-legs]').hidden = w.towers;
  }
  function readWalkway() {
    const e = form.elements;
    const num = (el) => (el.value === '' ? NaN : Number(el.value));
    const w = { kind: 'walkway', legs: e.wLegs.checked, towers: e.wTowers.checked, towerWindows: e.wTowerWindows.checked, towerRoof: e.wTowerRoof.value, towerCab: e.wTowers.checked ? e.wTowerCab.value : 'none' };
    for (const [k, key] of WALKWAY_FIELDS) w[key] = num(e[k]);
    return w;
  }
  const PLATFORM_FIELDS = [['vWidth', 'width'], ['vDepth', 'depth'], ['vHeight', 'height'], ['vStairWidth', 'stairWidth'], ['vRailingHeight', 'railingHeight'], ['vBoardHeight', 'boardHeight']];
  const PLATFORM_CHECKS = [['vPlanks', 'planks'], ['vRailing', 'railing'], ['vBoard', 'board']];
  function fillPlatform(p) {
    const e = form.elements;
    for (const [k, key] of PLATFORM_FIELDS) e[k].value = p[key];
    for (const [k, key] of PLATFORM_CHECKS) e[k].checked = p[key];
    e.vRailingStyle.value = p.railingStyle;
    drawPlatform();
  }
  function drawPlatform() {
    const p = building;
    for (const b of host.querySelectorAll('[data-bd-platform-stair]')) b.setAttribute('aria-pressed', String(b.dataset.bdPlatformStair === p.stair));
    $('[data-bd-stair-width]').hidden = p.stair === 'none';
    $('[data-bd-railing-height]').hidden = !p.railing;
    $('[data-bd-board-height]').hidden = !p.board;
    const [x0, y0, x1, y1] = platformFootprint(p);
    const { steps } = platformStair(p);
    $('[data-bd-platform-size]').textContent =
      'A deck ' + fmt(p.width) + ' × ' + fmt(p.depth) + ' mm, ' + fmt(p.height) + ' mm above the table' + (p.stair === 'none' ? ', no staircase' : ', ' + steps + ' steps up' + (p.stair === 'both' ? ' at each end' : '')) + '. On the table it takes ' + fmt(x1 - x0) + ' × ' + fmt(y1 - y0) + ' mm. Four braced frames stand under it, their tabs up into pockets in its underside.';
  }
  function readPlatform() {
    const e = form.elements;
    const num = (el) => (el.value === '' ? NaN : Number(el.value));
    const p = { kind: 'platform', stair: building.stair, railingStyle: form.elements.vRailingStyle.value };
    for (const [k, key] of PLATFORM_FIELDS) p[key] = num(e[k]);
    for (const [k, key] of PLATFORM_CHECKS) p[key] = e[k].checked;
    return p;
  }
  const MARSHAL_FIELDS = [['mWidth', 'width'], ['mDepth', 'depth'], ['mDeck', 'deckHeight'], ['mWall', 'wallHeight'], ['mEntrance', 'entrance'], ['mNumber', 'number'], ['mRoom', 'roomHeight'], ['mFall', 'fall'], ['mOverhang', 'overhang']];
  const MARSHAL_CHECKS = [['mLadder', 'ladder'], ['mNumbers', 'numbers']];
  function fillMarshal(m) {
    const e = form.elements;
    for (const [k, key] of MARSHAL_FIELDS) e[k].value = m[key];
    for (const [k, key] of MARSHAL_CHECKS) e[k].checked = m[key];
    drawMarshal();
  }
  function drawMarshal() {
    const m = building;
    for (const b of host.querySelectorAll('[data-bd-marshal-walls]')) b.setAttribute('aria-pressed', String(b.dataset.bdMarshalWalls === m.walls));
    for (const b of host.querySelectorAll('[data-bd-marshal-roof]')) b.setAttribute('aria-pressed', String(b.dataset.bdMarshalRoof === m.roof));
    form.elements.mNumber.closest('label').hidden = !m.numbers;
    const L = marshalLevels(m);
    $('[data-bd-raised]').hidden = !L.raised;
    $('[data-bd-marshal-size]').textContent =
      (L.raised ? 'A cabin on four legs, its floor ' + fmt(m.deckHeight) + ' mm above the table, on a base plate' + (L.ladder ? ' that reaches back under the ladder' : '') : 'A shelter on the ground') +
      '; about ' + fmt(Math.round(L.high)) + ' mm high to the top of the roof. A floor of 0 puts it on the ground. The cabin prints the right way up, its floor on the plate.';
  }
  function readMarshal() {
    const e = form.elements;
    const num = (el) => (el.value === '' ? NaN : Number(el.value));
    const m = { kind: 'marshalpost', walls: building.walls, roof: building.roof };
    for (const [k, key] of MARSHAL_FIELDS) m[key] = num(e[k]);
    for (const [k, key] of MARSHAL_CHECKS) m[key] = e[k].checked;
    return m;
  }
  const PIT_FIELDS = [['pBays', 'bays'], ['pBayWidth', 'bayWidth'], ['pDepth', 'depth'], ['pBase', 'baseHeight'], ['pDoorWidth', 'doorWidth'], ['pDoorHeight', 'doorHeight'], ['pRecess', 'recess'], ['pFirst', 'firstNumber'], ['pGround', 'groundHeight'], ['pBalcony', 'balcony'], ['pLounge', 'loungeHeight'], ['pLean', 'lean'], ['pVisor', 'visor']];
  const PIT_CHECKS = [['pNumbers', 'numbers'], ['pRailing', 'railing'], ['pRoofRailing', 'roofRailing']];
  function fillPits(m) {
    const e = form.elements;
    for (const [k, key] of PIT_FIELDS) e[k].value = m[key];
    for (const [k, key] of PIT_CHECKS) e[k].checked = m[key];
    drawPits();
  }
  function drawPits() {
    const m = building;
    for (const b of host.querySelectorAll('[data-bd-pits-door]')) b.setAttribute('aria-pressed', String(b.dataset.bdPitsDoor === m.door));
    form.elements.pFirst.closest('label').hidden = !m.numbers;
    const L = pitLevels(m);
    $('[data-bd-pits-size]').textContent =
      m.bays + (m.bays === 1 ? ' bay, ' : ' bays, ') + fmt(m.bays * m.bayWidth + 3) + ' mm long and ' + fmt(m.depth) + ' mm deep on the table, ' + fmt(L.roof1) + ' mm high; the balcony and the visor reach ' + fmt(-L.front) + ' mm out over the pit lane. Each bay prints standing on its end and joins the next with two tabs.';
  }
  function readPits() {
    const e = form.elements;
    const num = (el) => (el.value === '' ? NaN : Number(el.value));
    const m = { kind: 'pitmodule', door: building.door };
    for (const [k, key] of PIT_FIELDS) m[key] = num(e[k]);
    for (const [k, key] of PIT_CHECKS) m[key] = e[k].checked;
    return m;
  }
  function fillGantry(g) {
    const e = form.elements;
    for (const [k, v] of [['tSpan', g.span], ['tClearance', g.clearance], ['tLights', g.lights], ['tReach', g.reach], ['tBoardHeight', g.boardHeight], ['tDeck', g.deckWidth], ['tWalls', g.wallHeight]]) e[k].value = v;
    e.tBoard.checked = g.board;
    e.tMembers.value = g.members;
    drawGantry();
  }
  function drawGantry() {
    const g = building;
    for (const b of host.querySelectorAll('[data-bd-gantry-type]')) b.setAttribute('aria-pressed', String(b.dataset.bdGantryType === g.type));
    host.querySelector('[data-bd-beam]').hidden = g.type === 'bridge';
    host.querySelector('[data-bd-bridge]').hidden = g.type !== 'bridge';
    host.querySelector('[data-bd-lights]').hidden = g.type !== 'start';
    host.querySelector('[data-bd-reach]').hidden = g.type !== 'half';
    const [w, d] = gantrySize(g);
    $('[data-bd-gantry-size]').textContent =
      (g.type === 'half' ? 'Its beam reaches ' + fmt(g.reach) + ' mm out over the road' : 'Span is the clear width between the ' + (g.type === 'bridge' ? 'staircases' : 'legs') + ': the track with its borders') +
      ', ' + fmt(g.clearance) + ' mm clear underneath. On the table it takes ' + fmt(w) + ' × ' + fmt(d) + ' mm. In the Track Planner, a gantry over a straight takes the straight\'s width as its span.' +
      (g.members === 'lattice' ? ' Lattice: each leg an open box of four corner posts with an X in every panel, printing standing; the beam two flat lattice girders glued across the legs and a lattice top over them, a board on the front for a sign, the start lights in it.' : '');
  }
  function readGantry() {
    const e = form.elements;
    const num = (el) => (el.value === '' ? NaN : Number(el.value));
    return {
      kind: 'gantry',
      type: building.type,
      members: e.tMembers.value,
      span: num(e.tSpan),
      clearance: num(e.tClearance),
      lights: num(e.tLights),
      reach: num(e.tReach),
      board: e.tBoard.checked,
      boardHeight: num(e.tBoardHeight),
      deckWidth: num(e.tDeck),
      wallHeight: num(e.tWalls),
    };
  }
  function fillStand(g) {
    const e = form.elements;
    for (const [k, v] of [['gLength', g.length], ['gRows', g.rows], ['gRowDepth', g.rowDepth], ['gRowRise', g.rowRise], ['gFront', g.frontHeight], ['gBack', g.backHeight], ['gAisles', g.aisles], ['gRoofHeight', g.roofHeight], ['gSection', g.sectionLength]])
      e[k].value = v;
    e.gSeats.checked = g.seats;
    e.gBackrests.checked = g.backrests;
    e.gRaised.value = g.raised;
    e.gStairs.value = g.stairs;
    e.gRailings.checked = g.railings;
    e.gRoof.value = g.roof;
    if (g.curve) {
      e.gRadius.value = g.curve.radius;
      e.gAngle.value = g.curve.angle;
      e.gFacing.value = g.curve.facing;
    }
    drawStand();
  }
  function drawStand() {
    const g = building;
    for (const b of host.querySelectorAll('[data-bd-stand-shape]')) b.setAttribute('aria-pressed', String(b.dataset.bdStandShape === (g.curve ? 'curved' : 'straight')));
    $('[data-bd-curve]').hidden = !g.curve;
    form.elements.gLength.disabled = !!g.curve;
    form.elements.gLength.value = g.length;
    host.querySelector('[data-bd-canopy]').hidden = g.roof !== 'canopy';
    $('[data-bd-stand-straight]').hidden = !!g.curve;
    $('[data-bd-stand-frame-hint]').textContent = g.curve
      ? 'Frames, a staircase and railings are for a straight grandstand.'
      : 'Raised, the stand stands on braced frames: one along the front and one along the back under each section, and one across at each end and each joint, its top pushed up into the hollow of the shell, which holds it square. They print flat. A staircase climbs an end from the table to the last row and prints on its side. The side railings are part of the end panels; the back railing is glued on the back of the back wall, a panel for each section, printing flat.';
    $('[data-bd-stand-size]').textContent =
      g.rows + ' rows, ' + fmt(g.length) + ' mm long and ' + fmt(standDepth(g)) + ' mm deep. The front row is ' + fmt(g.frontHeight) + ' mm up, behind a parapet; each row is ' + fmt(g.rowRise) + ' mm higher.';
  }
  function readStand() {
    const e = form.elements;
    const num = (el) => (el.value === '' ? NaN : Number(el.value));
    return {
      kind: 'grandstand',
      length: num(e.gLength),
      rows: num(e.gRows),
      rowDepth: num(e.gRowDepth),
      rowRise: num(e.gRowRise),
      frontHeight: num(e.gFront),
      backHeight: num(e.gBack),
      aisles: num(e.gAisles),
      seats: e.gSeats.checked,
      backrests: e.gSeats.checked && e.gBackrests.checked,
      raised: building.curve ? 0 : num(e.gRaised),
      stairs: building.curve ? 'none' : e.gStairs.value,
      railings: !building.curve && e.gRailings.checked,
      roof: e.gRoof.value,
      roofHeight: num(e.gRoofHeight),
      sectionLength: num(e.gSection),
      curve: building.curve ? { radius: num(e.gRadius), angle: num(e.gAngle), facing: e.gFacing.value } : null,
    };
  }
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
  ${field('upBalcony', 'Balcony in front', s.balcony, [0, 40])}
  <label class="bd-check"><input type="checkbox" name="upBalconyAll"${s.balconyAll ? ' checked' : ''}><span>The balcony runs all round</span></label>
  <label class="bd-check"><input type="checkbox" name="upRailing"${s.railing ? ' checked' : ''}><span>A railing round its floor</span></label>
  <label class="bd-check"><input type="checkbox" name="stOpen"${s.open ? ' checked' : ''}><span>Open above a waist wall</span></label>
  ${s.open ? field('stWaist', 'Waist wall', s.waist, [8, s.height - 20]) + field('stPanes', 'Panes along each wall', s.panes, [1, OPEN.panes], '') : ''}
  ${field('stLean', 'Walls lean out at the top', s.lean, [0, LEAN.most], '°')}
  <label class="bd-row"><span>Walls</span><select name="stWallStyle">${FRAME_WALL.styles.map(([id, label]) => `<option value="${id}"${s.wallStyle === id ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
  <div class="bd-sub">Relief</div>
  ${field('stPlinth', 'Plinth', s.plinth, RELIEF.band)}
  ${field('stCornice', 'Cornice', s.cornice, RELIEF.band)}
  ${field('stPilasters', 'Pilasters apart', s.pilasters, [0, RELIEF.spacing[1]])}
  <label class="bd-check"><input type="checkbox" name="stPanels"${s.panels ? ' checked' : ''}><span>Recessed panels</span></label>
  <p class="bd-hint">Its place is from the left and front walls of the storey below, outside to outside. A balcony is its floor reaching out in front, over the garage doors and the pit lane, or all round it. The railing runs along the open edges of its floor: the balcony, and a terrace where it is set back.</p></div>`
      : `<p class="bd-hint">The ground floor has the garage door; its size is set above.</p>
  <label class="bd-check"><input type="checkbox" name="stOpen"${s.open ? ' checked' : ''}><span>Open above a waist wall</span></label>
  ${s.open ? field('stWaist', 'Waist wall', s.waist, [8, s.height - 20]) + field('stPanes', 'Panes along each wall', s.panes, [1, OPEN.panes], '') : ''}
  ${field('stLean', 'Walls lean out at the top', s.lean, [0, LEAN.most], '°')}
  <label class="bd-row"><span>Walls</span><select name="stWallStyle">${FRAME_WALL.styles.map(([id, label]) => `<option value="${id}"${s.wallStyle === id ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
  <div class="bd-sub">Relief</div>
  ${field('stPlinth', 'Plinth', s.plinth, RELIEF.band)}
  ${field('stCornice', 'Cornice', s.cornice, RELIEF.band)}
  ${field('stPilasters', 'Pilasters apart', s.pilasters, [0, RELIEF.spacing[1]])}
  <label class="bd-check"><input type="checkbox" name="stPanels"${s.panels ? ' checked' : ''}><span>Recessed panels</span></label>
  <p class="bd-hint">Open, a storey has a waist wall all round and corner posts up to a beam under its ceiling, like a marshal's or a judge's box: no windows or doors. Panes split the open band with mullions. The top storey's walls can lean out at the top, like a control-tower cab, under a flat roof. Walls can be a braced steel frame or a lattice, open between their members. Relief stands out of the walls: a plinth at the foot, a cornice under the eaves, pilasters at the corners and every so far along (0 for none), and panels sunk between them; it runs round the corners and keeps clear of every opening.</p>`;
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
  ${o.type === 'window' ? `<label class="bd-check"><input type="checkbox" name="counter"${o.counter ? ' checked' : ''}><span>Counter under it</span></label>
  <label class="bd-check"><input type="checkbox" name="flap"${o.flap ? ' checked' : ''}><span>Flap propped open over it</span></label>
  ${o.flap ? field('flapAngle', 'Flap angle, down from level', o.flapAngle, HATCH.flapAngle, '°') : ''}` : ''}
</div>`,
      );
    const where = building.upper.length ? (storey ? ' of storey ' + (storey + 1) : ' of the ground floor') : '';
    $('.bd-openings').innerHTML = rows.join('') || '<p class="bd-hint">No windows or doors in the ' + wall + ' wall' + where + '.</p>';
    for (const b of host.querySelectorAll('[data-bd-wall]')) b.setAttribute('aria-pressed', String(b.dataset.bdWall === wall));
  }
  // Whether the chosen storey is open, and its waist wall.
  function openOf() {
    const e = form.elements;
    const s = storeyOf(building, storey);
    const num = (el, was) => (el ? (el.value === '' ? NaN : Number(el.value)) : was);
    return {
      open: e.stOpen ? e.stOpen.checked : s.open,
      waist: num(e.stWaist, s.waist),
      panes: num(e.stPanes, s.panes),
      lean: num(e.stLean, s.lean),
      plinth: num(e.stPlinth, s.plinth),
      cornice: num(e.stCornice, s.cornice),
      pilasters: num(e.stPilasters, s.pilasters),
      panels: e.stPanels ? e.stPanels.checked : s.panels,
      wallStyle: e.stWallStyle ? e.stWallStyle.value : s.wallStyle,
    };
  }
  function readForm() {
    if (isStand()) return readStand();
    if (isGantry()) return readGantry();
    if (isPits()) return readPits();
    if (isMarshal()) return readMarshal();
    if (isPlatform()) return readPlatform();
    if (isWalkway()) return readWalkway();
    if (isBays()) return readBays();
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
        ...(o.type === 'window' && { sill: num(get('sill')), counter: get('counter').checked, flap: get('flap').checked, ...(get('flapAngle') && { flapAngle: num(get('flapAngle')) }) }),
        frame: get('frame').checked,
      };
    });
    const upper = storey
      ? { width: num(e.upWidth), depth: num(e.upDepth), x: num(e.upX), y: num(e.upY), height: num(e.upHeight), balcony: num(e.upBalcony), balconyAll: e.upBalconyAll.checked, railing: e.upRailing.checked, openings, ...openOf() }
      : { openings, ...openOf() };
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
      roofRailing: e.roofRailing.checked,
      numbers: e.numbers.checked,
      firstNumber: num(e.firstNumber),
      sign: e.sign.value,
      railingStyle: e.railingStyle.value,
      access: e.access.value,
      accessWall: e.accessWall.value,
      accessAt: num(e.accessAt),
      accessTo: e.accessTo.value,
      standType: e.standType.value,
      standHeight: num(e.standHeight),
      standSize: num(e.standSize),
      standShape: e.standShape.value,
      standTaper: num(e.standTaper),
      signWidth: num(e.signWidth),
      signHeight: num(e.signHeight),
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
    if (isStand()) drawStand();
    else if (isGantry()) drawGantry();
    else if (isPits()) drawPits();
    else if (isMarshal()) drawMarshal();
    else if (isPlatform()) drawPlatform();
    else if (isWalkway()) fillWalkway(building);
    else if (isBays()) drawBays();
    else {
      for (const b of host.querySelectorAll('[data-bd-roof]')) b.setAttribute('aria-pressed', String(b.dataset.bdRoof === building.roof));
      $('[data-bd-sign-size]').hidden = building.sign === 'none';
      $('[data-bd-stand-size]').hidden = building.standType === 'none';
      $('[data-bd-column]').hidden = building.standType !== 'column';
      $('[data-bd-access]').hidden = building.access === 'none';
      // Open or closed, the storey's panel shows its waist wall or not.
      if (!!form.elements.stWaist !== !!storeyOf(building, storey)?.open) drawStoreys();
      for (const el of host.querySelectorAll('[data-bd-for]')) el.hidden = !el.dataset.bdFor.split(' ').includes(building.roof);
      const walls = storeyOf(building, storey);
      for (const b of host.querySelectorAll('[data-bd-wall-texture]')) b.setAttribute('aria-pressed', String(b.dataset.bdWallTexture === walls.wallTexture));
      $('[data-bd-walls-of]').textContent = building.upper.length ? 'Walls of ' + (storey ? 'storey ' + (storey + 1) : 'the ground floor') : 'Walls';
      for (const b of host.querySelectorAll('[data-bd-roof-texture]')) b.setAttribute('aria-pressed', String(b.dataset.bdRoofTexture === building.roofTexture));
      $('[data-bd-roof-texture-box]').hidden = building.roof === 'flat';
      const textured = [building, ...building.upper].some((u) => u.wallTexture !== 'plain');
      $('[data-bd-texture-size]').hidden = !textured && (building.roof === 'flat' || building.roofTexture === 'plain');
    }
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
    if (isGarage() && building.rooms) {
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
    if (selected) focusPart(selected);
    sync();
  }
  // The settings of a part, on the right: its storey and wall chosen, its card in view.
  function focusPart(id) {
    const wallOf = /^(front|back|left|right)(\d?)(?:-\d+)?$/.exec(id),
      frameOf = /^(?:frame|counter|flap)(\d?)-(\d+)$/.exec(id),
      storeyOfPart = /^(?:floor|brace|divide)(\d?)/.exec(id);
    let card = null,
      k = storey,
      w = wall,
      opening = null;
    if (isStand()) card = /^canopy|^post/.test(id) ? 'standRoof' : 'stand';
    else if (isGantry()) card = /^beam/.test(id) ? 'gantryBeam' : /^deck/.test(id) ? 'gantryBridge' : 'gantry';
    else if (isPits()) card = /^(door|number)/.test(id) ? 'pitsDoors' : /rail|roofback/.test(id) ? 'pitsUpper' : 'pits';
    else if (isMarshal()) card = id === 'roof' ? 'marshalRoof' : id === 'number' ? 'marshalWalls' : 'marshal';
    else if (isWalkway()) card = 'walkway';
    else if (isBays()) card = /^(door|number)/.test(id) ? 'baysDoors' : /rail|roof|podium/.test(id) ? 'baysUpper' : 'bays';
    else if (isPlatform()) card = /^stair/.test(id) ? 'platformStair' : /^rail|^board/.test(id) ? 'platformRail' : 'platform';
    else if (wallOf) {
      k = wallOf[2] ? Number(wallOf[2]) - 1 : 0;
      w = wallOf[1];
      card = 'openings';
    } else if (frameOf) {
      k = frameOf[1] ? Number(frameOf[1]) - 1 : 0;
      opening = Number(frameOf[2]) - 1;
      w = storeyOf(building, k)?.openings[opening]?.wall ?? wall;
      card = 'openings';
    } else if (id === 'sign') {
      k = 0;
      w = 'front';
      card = 'openings';
    } else if (/^floor/.test(id)) {
      k = Number(/^floor(\d)/.exec(id)[1]) - 1;
      card = 'storeys';
    } else if (/^roof/.test(id)) card = 'roof';
    else if (/^base/.test(id)) card = 'base';
    else if (/^(leg|column|tower)/.test(id)) card = 'support';
    else if (id === 'access') card = 'access';
    else if (/^door/.test(id)) card = 'garage';
    else if (/^divide/.test(id)) card = 'size';
    else if (/^brace/.test(id)) {
      k = storeyOfPart[1] ? Number(storeyOfPart[1]) - 1 : 0;
      card = 'walls';
    }
    if (!card) return;
    if (isGarage() && (k !== storey || w !== wall)) {
      // Keep what is typed, as the storey and wall buttons do.
      try {
        building = validateBuilding(readForm());
      } catch {
        // The last good building stays; the error stays in view.
      }
      storey = Math.min(k, building.upper.length);
      wall = w;
      drawStoreys();
      drawOpenings();
    }
    const box = host.querySelector('[data-bd-card="' + card + '"]');
    const target = (opening !== null && box.querySelector('[data-op="' + opening + '"]')) || box;
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    for (const el of host.querySelectorAll('.bd-flash')) el.classList.remove('bd-flash');
    void target.offsetWidth;
    target.classList.add('bd-flash');
  }
  async function listSaved() {
    try {
      const saved = await (await store()).buildings();
      $('.bd-saved').innerHTML = saved.length
        ? saved
            .map(
              (b) =>
                `<button type="button" class="bd-part${b.id === savedId ? ' active' : ''}" data-bd-open="${esc(b.id)}">${icon('building')}<span><b>${esc(b.name)}</b><small>${esc(sizeLine(b.building))}</small></span></button>`,
            )
            .join('')
        : '<p class="bd-later">Buildings you save appear here and in the Library.</p>';
    } catch (err) {
      $('.bd-saved').innerHTML = '<p class="bd-later">' + esc(err.message) + '</p>';
    }
  }
  function fill(b) {
    showKind();
    $('[name="buildingName"]').value = name;
    if (b.kind === 'grandstand') return fillStand(b);
    if (b.kind === 'gantry') return fillGantry(b);
    if (b.kind === 'pitmodule') return fillPits(b);
    if (b.kind === 'marshalpost') return fillMarshal(b);
    if (b.kind === 'platform') return fillPlatform(b);
    if (b.kind === 'walkway') return fillWalkway(b);
    if (b.kind === 'pitbays') return fillBays(b);
    for (const k of ['width', 'depth', 'height', 'doorWidth', 'doorHeight', 'baseHeight', 'pitch', 'overhangFront', 'overhangBack', 'overhangLeft', 'overhangRight', 'textureScale', 'textureJoint', 'textureDepth'])
      form.elements[k].value = b[k];
    for (const k of ['door', 'ridge', 'rises', 'roofLip']) form.elements[k].value = b[k];
    form.elements.braces.checked = b.braces;
    form.elements.roofRailing.checked = b.roofRailing;
    form.elements.numbers.checked = b.numbers;
    form.elements.firstNumber.value = b.firstNumber;
    form.elements.sign.value = b.sign;
    form.elements.railingStyle.value = b.railingStyle;
    for (const k of ['access', 'accessWall', 'accessAt', 'accessTo']) form.elements[k].value = b[k];
    for (const k of ['standType', 'standShape']) form.elements[k].value = b[k];
    for (const k of ['standHeight', 'standSize', 'standTaper']) form.elements[k].value = b[k];
    form.elements.signWidth.value = b.signWidth;
    form.elements.signHeight.value = b.signHeight;
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
      } else if (b.dataset.bdBayAdd !== undefined) {
        const m = readBays();
        await rebuild({ ...m, types: [...m.types, m.types.at(-1)] });
        drawBays();
      } else if (b.dataset.bdBayRemove !== undefined) {
        const m = readBays();
        await rebuild({ ...m, types: m.types.filter((_, i) => i !== Number(b.dataset.bdBayRemove)) });
        drawBays();
      } else if (b.dataset.bdPlatformStair) {
        await rebuild({ ...readPlatform(), stair: b.dataset.bdPlatformStair });
        drawPlatform();
      } else if (b.dataset.bdMarshalWalls) {
        await rebuild({ ...readMarshal(), walls: b.dataset.bdMarshalWalls });
        drawMarshal();
      } else if (b.dataset.bdMarshalRoof) {
        await rebuild({ ...readMarshal(), roof: b.dataset.bdMarshalRoof });
        drawMarshal();
      } else if (b.dataset.bdPitsDoor) {
        await rebuild({ ...readPits(), door: b.dataset.bdPitsDoor });
        drawPits();
      } else if (b.dataset.bdGantryType) {
        fitted = false;
        await rebuild({ ...readGantry(), type: b.dataset.bdGantryType });
        drawGantry();
      } else if (b.dataset.bdStandShape) {
        const next = readStand();
        next.curve = b.dataset.bdStandShape === 'curved' ? { radius: Number(form.elements.gRadius.value) || 450, angle: Number(form.elements.gAngle.value) || 45, facing: form.elements.gFacing.value || 'in' } : null;
        // Curved: no frames, staircases or railings.
        if (next.curve) Object.assign(next, { raised: 0, stairs: 'none', railings: false });
        fitted = false;
        await rebuild(next);
        drawStand();
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
      else if (b.dataset.bd === 'new' || b.dataset.bdPreset) {
        // A new building: the plain garage, or one of the standard buildings.
        const preset = BUILDING_PRESETS.find((p) => p.id === b.dataset.bdPreset);
        building = validateBuilding(preset?.building ?? {});
        name = preset?.name ?? 'Garage';
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
