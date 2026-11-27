// A building as a kit: a base plate as high as the track, four walls that
// drop into a groove in it and meet at mitred corners, a roof, a door
// insert, and windows and doors cut into any wall, with frames if wanted.
// Up to two more storeys stand on top, each a building of its own size on a
// floor slab: its own height, windows, doors and wall texture. The roof sits
// on the top storey. Every part prints flat without supports. Sizes are toy
// proportions for 1:32 by default: a one-car garage is about 120 × 180 mm
// and 75 mm high and takes practically any slot car.

import { DRAWN, FINISH_DEFAULTS, ROOF_TEXTURES, TEXTURE_DEFAULTS, TEXTURE_LIMITS, bandTop, checkFinish, finishJoints, isTextured, roofJoints, textureOf } from './building-texture.js';
import { JOINT, planCuts, plateRoom, seamRegion, tabPlaces, validateCuts } from './building-cuts.js';
import { buildGrandstand, grandstandLayout, validateGrandstand } from './grandstand.js';
import { buildGantry, gantryLayout, validateGantry } from './gantry.js';
import { buildPitModule, pitModuleLayout, validatePitModule } from './pit-module.js';
import { buildMarshalPost, marshalPostLayout, validateMarshalPost } from './marshal-post.js';
import { buildFlagPost, flagPostLayout, validateFlagPost } from './flag-post.js';
import { billboardLayout, buildBillboard, validateBillboard } from './billboard.js';
import { buildCanopy, canopyLayout, validateCanopy } from './canopy.js';
import { buildStage, stageLayout, validateStage } from './stage.js';
import { buildSwitchback, switchbackLayout, validateSwitchback } from './switchback.js';
import { benchLayout, buildBench, validateBench } from './bench.js';
import { buildTyreBridge, tyreBridgeLayout, validateTyreBridge } from './tyre-bridge.js';
import { buildPicnic, picnicLayout, validatePicnic } from './picnic.js';
import { buildPlatform, platformLayout, validatePlatform } from './viewing-platform.js';
import { buildWalkway, validateWalkway, walkwayLayout } from './walkway.js';
import { buildPitBays, pitBaysLayout, validatePitBays } from './pit-bays.js';
import { checkContainer, containerWall, containerRoof } from './container-details.js';
import { kitShapes } from './kit-shapes.js';
import { TRIM, checkOpeningShape, openingShapes, outlineOf, overOf, sideOf, underOf } from './opening-shapes.js';
import { PROP_GAP, checkPropList, placeProp, propFootprint, propOf, propPartIds } from './props.js';
export { propPartIds };
import { PROPS_DEFAULTS, buildPropsKit, propsLayout, validatePropsKit } from './props-kit.js';
import { buildFitTest, fitTestLayout, validateFitTest } from './fit-test.js';
import { LETTERING, checkText, fitHeight, letterDepth, raisedText, textShape, textWidth } from './lettering.js';
import { validateConnected, connectedLayout, buildConnected } from './connected-building.js';
import { validateFootprint, footprintLayout, buildFootprint } from './footprint-building.js';

export const WALLS = Object.freeze(['front', 'left', 'back', 'right']);
export const WALL_NAMES = Object.freeze({ front: 'Front', back: 'Back', left: 'Left', right: 'Right' });
export const ROOFS = Object.freeze([
  ['flat', 'Flat'],
  ['slope', 'Single slope'],
  ['gable', 'Two-sided'],
  ['hip', 'Hip'],
  ['gambrel', 'Gambrel'],
  ['mansard', 'Mansard'],
  ['sawtooth', 'Sawtooth'],
  ['vault', 'Barrel vault'],
]);
// Fittings: a chimney's cap reaches out this far and is this high, its size
// and height within these; a rooflight's size, its frame's width and height,
// and how close it comes to a wall, a ridge or another fitting; a gutter's
// width, height and walls; a downpipe's side.
export const FITTINGS = Object.freeze({
  cap: 1, capHigh: 2, size: [6, 40], high: [5, 60],
  light: [8, 80], lightFrame: 1.5, lightUp: 1.5, lightsMost: 6, clear: 3, apart: 2,
  gutter: 6, gutterHigh: 4, gutterWall: 1, pipe: 3,
  dormerWide: [20, 80], dormerHigh: [12, 60], dormersMost: 4, dormerPitch: 40, dormerRoof: 2, dormerSill: 2,
});
/**
 * A dormer's shape on its panel p: d along the slope from the panel's line,
 * a across it, front at df, middle at ac; its eave and ridge over the top of
 * the roof at its front, and where they meet the roof going back.
 */
export function dormerShape(shape, d, roofThick = KIT.roof) {
  const p = roofPanelAt(shape, d.x, d.y);
  if (!p) return null;
  const [dx, dy] = p.dir,
    A = [-dy, dx];
  const df = dx * d.x + dy * d.y - p.s0,
    ac = A[0] * d.x + A[1] * d.y;
  const k = Math.tan((FITTINGS.dormerPitch * Math.PI) / 180),
    hw = d.width / 2;
  // Over the top of the roof at its front: the eave, the ridge.
  const eave = d.height,
    ridge = d.height + k * hw;
  const back = df + ridge / p.t,
    valley = df + eave / p.t;
  // A box on the plan from (a0, d0) to (a1, d1) in its frame.
  const plan = (a0, d0, a1, d1) => {
    const pts = [[a0, d0], [a1, d1]].map(([a, dd]) => (dx ? [dx * (dd + p.s0), dx * a] : [-dy * a, dy * (dd + p.s0)]));
    return [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
  };
  return { p, A, df, ac, k, hw, eave, ridge, back, valley, plan, foot: plan(ac - hw, df, ac + hw, back), thick: roofThick };
}
// A sawtooth roof: each tooth at least this wide along its slope, and its
// glazed face this high, for windows in its north light.
export const SAWTOOTH = Object.freeze({ least: 30, face: 12, pane: 18, bar: 2, edge: 2 });
export const BUILDING_DEFAULTS = Object.freeze({
  kind: 'garage',
  container: 'none', // none, frame, left or right: shipping-container shell and cargo-door end
  width: 120, // outside of the walls, across the door
  depth: 180, // outside of the walls, front to back
  height: 75, // walls, from the top of the base to the eaves
  baseHeight: 10, // as high as the track, so the doorstep is level with the road
  doorWidth: 90,
  doorHeight: 55,
  door: 'roller', // 'roller', 'panel' (up and over), 'open' (an opening without a door) or 'none' (no garage door)
  roof: 'flat', // 'flat', 'slope', 'gable', 'hip' (four sides at one pitch), 'sawtooth' or 'vault'
  pitch: 30, // degrees, for a sloped or two-sided roof
  // A sawtooth roof: so many single slopes side by side, each rising towards
  // `rises`, a glazed north light standing between one and the next.
  teeth: 3,
  // A barrel vault: a half-round or flatter arch, its axis along the ridge, this high over the eaves.
  rise: 40,
  // A gambrel (two sides) or a mansard (four): steep at lowerPitch from the
  // eaves to a break breakAt in from the outside of the walls, then at pitch.
  lowerPitch: 65,
  breakAt: 25,
  // Fittings on the roof. A chimney: { x, y } its middle on the plan of the
  // top storey, from its left and front walls, its size, and how high it
  // stands over the highest point of the roof under it. Rooflights: each
  // { x, y, width, depth } on the plan, a hole through one roof panel with a
  // raised frame round it. Gutters along the eaves of a sloped, two-sided or
  // hip roof, and a downpipe from each at its 'left' or 'right' end as you
  // look at the wall under it, or 'none'.
  chimney: null,
  rooflights: Object.freeze([]),
  // Dormers: each { x, y } the middle of the foot of its front wall on the
  // plan of the top storey, its width, and the height of its front wall over
  // the roof; on a sloped panel, facing down it.
  dormers: Object.freeze([]),
  // Props: each { type, x, y } its footprint's corner nearest the left front,
  // on the plan of the ground floor, turned by `rotation`, standing on the
  // floor of `storey` (0 the ground floor), or on the table outside (-1).
  props: Object.freeze([]),
  // Parts left out of the kit: 'roof' (open to the sky, like a ruin or a
  // room box) and any of the walls, 'front', 'back', 'left' or 'right', on
  // every storey (open on that side), with their corner braces.
  leaveOut: Object.freeze([]),
  // Breaches in the walls of the top storey, the roof left out: each { wall,
  // at, width, depth } a ragged gap down from the top of the wall, `at` its
  // middle along the wall (as for a window), `depth` how far down it reaches.
  damage: Object.freeze([]),
  // Inside: partitions, each { storey, x0, y0, x1, y1, door } a thin wall standing
  // on the floor from (x0, y0) to (x1, y1), along x or y on the plan of the ground
  // floor, a doorway in it { at, width, height } or none; and stairs, each
  // { storey, x, y, rotation } a flight from the storey's floor up to the next,
  // (x, y) the corner of its footprint nearest the left front, rising to the
  // back (turned by rotation), through a stairwell cut in the floor above.
  partitions: Object.freeze([]),
  stairs: Object.freeze([]),
  // A stepped gable: a board glued on the front wall of the top storey, rising
  // above a two-sided roof whose gable faces the front in so many steps a side.
  gableFront: 'none', // 'none' or 'stepped'
  gableSteps: 3,
  gutters: false,
  downpipes: 'none',
  ridge: 'depth', // two-sided: the ridge runs front to back ('depth') or side to side ('width')
  rises: 'back', // single slope: the side the roof rises towards
  overhangFront: 3,
  overhangBack: 3,
  overhangLeft: 3,
  overhangRight: 3,
  openings: Object.freeze([]),
  ...TEXTURE_DEFAULTS,
  // A texture of its own on any wall ({ front: 'brick' }), and a band along the foot of the walls.
  wallTextures: FINISH_DEFAULTS.wallTextures,
  lowerTexture: 'none',
  lowerHeight: 20,
  // Clearance each side of a wall in its groove, and round the frame under the roof: more for a printer that prints wide.
  play: 0.2,
  upper: Object.freeze([]), // the storeys above the ground floor, at most two
  lane: null, // a garage over a pit bay: { width } of the track that runs in through its door
  braces: true, // a corner brace in each inside corner, holding the walls square
  roofLip: 'frame', // under the roof a frame held by tabs, as under every floor; or 'none'
  // A flat roof arched on top, this much higher in the middle than at its
  // edges, the crown along the ridge ('depth' or 'width'): a curved hut roof.
  // Its underside stays flat, so it prints flat and sits on its frame.
  arch: 0,
  roofRailing: false, // a railing round a flat roof, for a roof terrace
  numbers: false, // a number plaque above each garage door
  firstNumber: 1,
  // A board for a sign at the front: 'none'; 'fascia', along the top of the
  // front wall under the eaves; 'billboard', standing up on the roof at its
  // front edge. signWidth along the front, in the middle; signHeight its
  // height, a billboard's above the roof.
  sign: 'none',
  signText: '', // lettered on the sign, raised
  signCut: false, // the sign's letters cut in, not raised
  // Lettering on the walls of the ground floor: { wall, text, at (its middle along the wall), up (its middle above the floor), height, cut }.
  lettering: Object.freeze([]),
  signWidth: 80,
  signHeight: 14,
  // What the building stands on: 'none' (the table), 'legs' (one at each
  // corner), 'column' (one in the middle, square or round, wider at its foot
  // by standTaper %), 'tower' (a braced tower of four frames) or 'frames'
  // (four braced frames round the edges of the base). Legs can have knee
  // braces (standBraces) up into the base. standSize:
  // a leg, the column at its top, the tower's side. The base sits on top,
  // the supports' pins up in pockets under it.
  standType: 'none',
  standHeight: 60,
  standSize: 12,
  standShape: 'square',
  standTaper: 0,
  standBraces: false,
  // The ground floor open above a waist wall: corner posts and a beam at the
  // top, the band split into panes by mullions.
  open: false,
  waist: 25,
  panes: 1,
  // The walls of the top storey leaning out at the top, in degrees: a control-tower cab.
  lean: 0,
  // Relief on the outside of the walls: a plinth at the foot and a cornice
  // under the eaves (their heights, 0 for none), pilasters at the corners and
  // every so far along (0 for none), recessed panels between them.
  plinth: 0,
  cornice: 0,
  pilasters: 0,
  panels: false,
  // The walls of the ground floor as a steel frame: 'solid', 'braced' (an
  // X in each bay between posts) or 'lattice' (a diamond grid).
  wallStyle: 'solid',
  // The railings: 'bars' (posts between a band and a rail), 'mesh',
  // 'lattice' (an X between each two posts) or 'solid' (a parapet wall).
  railingStyle: 'bars',
  // A way up the outside: 'none', 'ladder' or 'stairs', against a wall,
  // starting accessAt along it (from its left end as you look at it); up to
  // 'base' (the top of the base, on a stand), '2', '3' or '4' (a storey's
  // floor) or 'roof' (a flat roof).
  access: 'none',
  accessWall: 'right',
  accessAt: 20,
  accessTo: 'roof',
  // Rooms side by side ('width') or front to back ('depth'), each its size
  // outside to outside, to the middle of the dividing wall: they add up to
  // the width or the depth of the building.
  rooms: null, // { along, sizes: [mm, ...] }
  cuts: Object.freeze({}), // where the parts are cut to fit the plate; left out, they are set evenly
});
export const BUILDING_LIMITS = Object.freeze({
  width: [60, 1500], // a long building, a pit row of many bays, is cut to fit the plate
  depth: [60, 1500],
  height: [30, 200],
  baseHeight: [4, 40],
  doorWidth: [20, 380],
  doorHeight: [15, 190],
  pitch: [10, 45],
  overhangFront: [0, 30],
  overhangBack: [0, 30],
  overhangLeft: [0, 30],
  overhangRight: [0, 30],
  signWidth: [20, 180],
  signHeight: [6, 60],
  standHeight: [15, 190],
  standSize: [8, 200],
  standTaper: [0, 100],
  arch: [0, 30],
  teeth: [2, 8],
  rise: [10, 150],
  lowerPitch: [45, 80],
  breakAt: [8, 100],
  play: [0.1, 0.5],
  ...TEXTURE_LIMITS,
});
// A storey above: its size, its place on the storey below (from that
// storey's left and front walls), its height, wall texture and openings.
// balcony: how far its floor reaches out in front of the storey below, over the garage front, or all round (balconyAll); railing: round the open edges of its floor.
export const UPPER_DEFAULTS = Object.freeze({ width: null, depth: null, x: 0, y: 0, height: 65, lettering: Object.freeze([]), wallTexture: 'plain', wallTextures: FINISH_DEFAULTS.wallTextures, lowerTexture: 'none', lowerHeight: 20, openings: Object.freeze([]), balcony: 0, balconyAll: false, railing: false, open: false, waist: 25, panes: 1, lean: 0, plinth: 0, cornice: 0, pilasters: 0, panels: false, wallStyle: 'solid' });
export const MAX_UPPER = 3;
/** Walls that lean out: how far out at the top, and the factor everything of the storey widens by there. */
export function leanGrow(s) {
  if (!s.lean) return { k: 0, f: 0 };
  const k = s.height * Math.tan((s.lean * Math.PI) / 180);
  return { k, f: k / ((s.width / 2 + s.depth / 2) / 2) };
}
// A new window or door, in toy proportions for 1:32.
export const OPENING_DEFAULTS = Object.freeze({
  // A framed window: its frame splits it into panes, across and up (2 × 2: a cross).
  window: Object.freeze({ type: 'window', width: 40, height: 30, sill: 25, frame: false, across: 2, up: 2, counter: false, flap: false, flapAngle: 15 }),
  // A door on the ground floor can have a step in front of it.
  door: Object.freeze({ type: 'door', width: 28, height: 48, sill: 0, frame: false, step: false }),
});
export const MAX_OPENINGS = 16;
export const MAX_ROOMS = 24;
export const MIN_ROOM = 40;
/** Where the dividing walls stand: their middles, from the left or the front wall, outside. */
export const dividers = (b) =>
  b.rooms ? b.rooms.sizes.slice(0, -1).map((_, i) => b.rooms.sizes.slice(0, i + 1).reduce((a, v) => a + v, 0)) : [];
/**
 * The garage doors in the front wall: one in the middle, or with rooms side
 * by side one in the middle of each room. from, to: the room's inside, along the front wall.
 */
export function garageDoors(b) {
  const t = KIT.wall;
  if (b.door === 'none') return [];
  if (b.rooms?.along !== 'width') return [{ x: (b.width - b.doorWidth) / 2, width: b.doorWidth, height: b.doorHeight, from: t, to: b.width - t, room: 1 }];
  const walls = dividers(b),
    edges = [0, ...walls, b.width];
  return b.rooms.sizes.map((_, i) => {
    const from = i ? edges[i] + t / 2 : t,
      to = i < walls.length ? edges[i + 1] - t / 2 : b.width - t;
    return { x: (from + to) / 2 - b.doorWidth / 2, width: b.doorWidth, height: b.doorHeight, from, to, room: i + 1 };
  });
}
// A serving hatch: the counter under a window (out, thick), the flap over
// it (thick, its angle below level), their fins (thick, how far down the
// wall for their length), the window high enough for a counter, the room a
// flap takes over a window; the sign's board, thick.
export const HATCH = Object.freeze({ counter: [10, 2.5], flap: 2, flapAngle: [0, 60], fin: 2, finDrop: 0.6, counterSill: 15, flapClear: 6, sign: 3, longest: 180, billboard: { fin: [12, 10, 3], inset: 1, dip: 0.3 } });
// The stand under a building: its types; a foot (thick, reaching out past a
// leg or the column); the pins on top (square, high) in pockets under the
// base; a tower's frames (thick, their legs and chords, braces, the longest
// bay, their tabs); how far the building lifts off it in the exploded view.
export const STAND = Object.freeze({
  types: Object.freeze([
    ['none', 'On the table'],
    ['legs', 'Four legs'],
    ['column', 'A column'],
    ['tower', 'A braced tower'],
    ['frames', 'Braced frames all round'],
  ]),
  knee: { reach: 22, angle: 55, thick: 0.7 }, // a knee brace: out along the wall, steepness, as thick as a leg × this
  foot: [3, 6],
  pin: [5, 1.5],
  frame: 4,
  member: 6,
  brace: 4,
  bay: 45,
  tab: [8, 1.5],
  play: 0.15,
  apart: 25,
});
// A hip roof's panels print whole: the roof at most this wide or deep with its overhangs.
export const HIP_ACROSS = 190;
// An open storey: its corner posts along each wall, the beam over the open band.
export const OPEN = Object.freeze({ post: 9, beam: 6, mullion: 3, panes: 8 });
// Relief: how far it stands out, a pilaster's width, a panel's recess and its margin.
export const RELIEF = Object.freeze({ depth: 1.5, pilaster: 6, recess: 0.8, margin: 3, band: [0, 20], spacing: [20, 300] });
// Frame walls: their styles; posts at the corners and between bays, a chord
// at the foot and a beam at the top, braces, the longest bay; a lattice's
// bars and their spacing. A mesh railing: its holes and bars.
export const FRAME_WALL = Object.freeze({
  styles: Object.freeze([
    ['solid', 'Solid'],
    ['braced', 'Braced frame'],
    ['lattice', 'Lattice'],
  ]),
  post: 9,
  member: 6,
  chord: 6,
  brace: 4,
  bay: 45,
  bar: 2.5,
  pitch: 12,
});
export const MESH = Object.freeze({ hole: 3, bar: 2 });
// The way up: a ladder (wide, its rails, rungs, their pitch, thick, its
// angle, how far it reaches above the top); a staircase (wide, a step at
// most so high, its tread, the landing, the slab under the steps, the post
// under the landing, the outer wall: thick and above the steps; at most
// this long, to print).
export const ACCESS = Object.freeze({
  kinds: Object.freeze([
    ['none', 'None'],
    ['ladder', 'A ladder'],
    ['stairs', 'A staircase'],
  ]),
  levels: Object.freeze([
    ['base', 'The base, on a stand'],
    ['2', 'Storey 2'],
    ['3', 'Storey 3'],
    ['4', 'Storey 4'],
    ['roof', 'The roof'],
  ]),
  ladder: { width: 16, rail: 4.5, rung: 3, pitch: 9, thick: 3, angle: 75, above: 8 },
  stairs: { width: 26, rise: 7, tread: 9, landing: 24, slab: 6, post: 6, parapet: [3, 12], longest: 180 },
});
// Walls that lean out: at most this many degrees, and only so far out over the storey below.
export const LEAN = Object.freeze({ most: 30, reach: 25 });
export const SIGNS = Object.freeze([
  ['none', 'No sign'],
  ['fascia', 'Along the top of the front wall'],
  ['billboard', 'A billboard on the roof'],
]);
// Fixed sizes of the kit, in mm. Nothing thinner than 2 mm.
export const KIT = Object.freeze({
  wall: 3, // wall thickness
  ledge: 3, // base beyond the walls
  groove: 2, // depth of the wall groove in the base and in a floor
  play: 0.2, // clearance each side of a wall in its groove, and around a lip
  shell: 2, // the base's side walls, it is hollow underneath
  deck: 4, // the base's top, under the groove too
  slab: 4, // a floor between two storeys
  roof: 3, // roof thickness
  lip: 2, // the frame under a roof or a floor, its width
  lipDepth: 3, // and how far it reaches down between the walls
  tabLength: 6, // a tab on the frame, along the wall
  tabThick: 1.8, // and across it
  tabIn: 2.4, // in from the outside of the frame, so its slot keeps clear of the groove above
  tabRoof: 1.2, // how far a tab reaches into the roof, in a pocket 0.2 mm deeper: well clear of its texture
  tabPlay: 0.15, // round a tab in its slot or pocket, each side
  frame: 6, // wall kept beside and above an opening, and between two
  insert: 2, // door insert plate
  rib: 1, // its ribs stand out this far
  ribPitch: 5,
  margin: 3, // door insert beyond the opening on each side and above
  trim: 3, // a window or door frame: its width around the opening
  trimDepth: 2, // how far a frame stands out from the wall
  bar: 2, // the cross in a window frame
  brace: 2, // a corner brace: its legs are this thick
  braceLeg: 5.5, // and reach this far along each wall, clear of a window or a door
  braceHeight: 60, // at most this tall, from the floor: the lip above holds the tops
  railHeight: 15, // a railing: its height above the deck
  railThick: 3, // and thick, as it prints flat
  railBand: 4, // a solid band along its foot
  railPost: 3, // its posts and its top rail, square
  railPitch: 20, // posts at most this far apart
  railBar: 2, // a lattice railing's bars, wide
  step: [8, 3], // a step in front of a door: out from the base, wider than the door each side
  railInset: 1, // in from the edge of the deck
  railTab: 1.2, // its two tabs, down into pockets in the deck
  plaque: [18, 10, 1.5], // a bay number plaque: wide, high, thick
  laneClear: 2, // a garage door beyond the track through it, each side
  lanePlay: 0.5, // the base beside the track through it, each side
});
// The exploded view: how far each part comes off, in mm, fully apart. A
// wall moves out and up out of its groove, a floor lifts off the walls
// below, each storey lifts above the one below, the roof comes off the top,
// the door slides in from behind its opening, and a frame comes off its wall.
export const APART = Object.freeze({ out: 20, up: 12, storey: 45, roof: 30, door: 25, frame: 15, ridge: 8, piece: 6 });
const add3 = (a, b) => a.map((v, i) => v + b[i]);
const scale3 = (a, k) => a.map((v) => v * k);
const LABELS = {
  width: 'Width',
  depth: 'Depth',
  height: 'Wall height',
  baseHeight: 'Base height',
  doorWidth: 'Door width',
  doorHeight: 'Door height',
  pitch: 'Roof pitch',
  overhangFront: 'Overhang at the front',
  overhangBack: 'Overhang at the back',
  overhangLeft: 'Overhang on the left',
  overhangRight: 'Overhang on the right',
  signWidth: 'Sign width',
  signHeight: 'Sign height',
  standHeight: 'Height of the stand',
  standSize: 'Size of the stand',
  standTaper: 'Taper',
  arch: 'Arch',
  teeth: 'Teeth',
  rise: 'Rise of the vault',
  lowerPitch: 'Lower pitch',
  breakAt: 'Break',
  play: 'Joint clearance',
  waist: 'Waist wall',
  textureScale: 'Texture size',
  textureJoint: 'Joint width',
  textureDepth: 'Joint depth',
};
const UNITS = { pitch: '°', lowerPitch: '°', textureScale: ' %', standTaper: ' %', teeth: '' };
const OPENING_KEYS = ['wall', 'type', 'at', 'width', 'height', 'sill', 'frame', 'across', 'up', 'step', 'counter', 'flap', 'flapAngle', 'shape', 'ledge', 'lintel', 'shutters', 'leaf', 'swing'];
/** A door that swings: its leaf a part of its own, as far clear of its doorway all round; its pins square and long. */
export const SWING = Object.freeze({ play: 0.3, pin: 1.2, length: 2, above: 4 });
// Panes in a framed window, at most so many each way and at least so big.
export const PANES = Object.freeze({ most: 6, least: 4 });
const UPPER_KEYS = Object.keys(UPPER_DEFAULTS);
const STOREY_SUFFIX = ['', ', ground floor', ', storey 2', ', storey 3', ', storey 4'];

/** The length of a wall along its outside face, on a storey of this size. */
export const wallLength = (dims, wall) => (wall === 'front' || wall === 'back' ? dims.width : dims.depth);
const fmtMm = (v) => String(Math.round(v * 10) / 10);
const openingName = (o, all) => {
  const same = all.filter((x) => x.wall === o.wall && x.type === o.type);
  return WALL_NAMES[o.wall] + ' ' + o.type + (same.length > 1 ? ' ' + (same.indexOf(o) + 1) : '');
};

function checkOpening(o, i, dims, where) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw Error('Opening ' + (i + 1) + where + ' is not a window or a door.');
  for (const key of Object.keys(o))
    if (!OPENING_KEYS.includes(key)) throw Error('Opening ' + (i + 1) + where + ' has an unknown setting: ' + key + '.');
  const kind = o.type === 'window' || o.type === 'door' ? o.type : null;
  if (!kind) throw Error('Opening ' + (i + 1) + where + ' must be a window or a door.');
  const full = { ...OPENING_DEFAULTS[kind], ...o, sill: kind === 'door' ? 0 : (o.sill ?? OPENING_DEFAULTS.window.sill) };
  if (!WALLS.includes(full.wall)) throw Error('Choose a wall for opening ' + (i + 1) + where + '.');
  if (typeof full.frame !== 'boolean') throw Error('Choose whether opening ' + (i + 1) + where + ' has a frame.');
  if (kind === 'door' && (o.counter || o.flap || o.flapAngle !== undefined)) throw Error('A door has no counter or flap: those are for a serving hatch, a window.');
  if (kind === 'door' && (o.across !== undefined || o.up !== undefined)) throw Error('A door has no panes: those are for a window.');
  if (kind === 'window' && o.step !== undefined) throw Error('A window has no step: that is for a door.');
  if (kind === 'door' && typeof full.step !== 'boolean') throw Error('Choose whether door ' + (i + 1) + where + ' has a step.');
  if (kind === 'window')
    for (const key of ['across', 'up'])
      if (!Number.isInteger(full[key]) || full[key] < 1 || full[key] > PANES.most) throw Error('Window ' + (i + 1) + where + ': 1 to ' + PANES.most + ' panes ' + key + '.');
  if (kind === 'window' && (typeof full.counter !== 'boolean' || typeof full.flap !== 'boolean')) throw Error('Choose whether window ' + (i + 1) + where + ' has a counter and a flap.');
  const [lo, hi] = HATCH.flapAngle;
  if (kind === 'window' && (!Number.isFinite(full.flapAngle) || full.flapAngle < lo || full.flapAngle > hi))
    throw Error('The flap of window ' + (i + 1) + where + ' leans out between ' + lo + '° (level) and ' + hi + '°.');
  const L = wallLength(dims, full.wall);
  if (full.at === undefined) full.at = L / 2;
  // Its shape and what goes round it: a round window as high as it is wide.
  Object.assign(full, checkOpeningShape(full, 'The ' + kind + ' on the ' + full.wall + ' wall' + where));
  // A door that swings on pins in the wall over it and the floor under it.
  full.swing = full.swing ?? false;
  if (typeof full.swing !== 'boolean') throw Error('Choose whether the ' + kind + ' on the ' + full.wall + ' wall' + where + ' swings.');
  if (full.swing && (full.type !== 'door' || full.leaf === 'open' || full.shape !== 'square')) throw Error('The ' + kind + ' on the ' + full.wall + ' wall' + where + ': a door that swings is a square door with a leaf in it.');
  if (full.swing && full.sill + full.height > dims.height - SWING.above) throw Error('The ' + kind + ' on the ' + full.wall + ' wall' + where + ' swings on a pin in the wall over it: keep it ' + SWING.above + ' mm under the top of the wall.');
  if ((full.counter || full.flap) && (full.shape !== 'square' || full.shutters)) throw Error('A serving hatch, with its counter or flap, is a square window without shutters.');
  for (const [key, min, max] of [
    ['width', 8, L],
    ['height', 8, dims.height],
    ['sill', 0, dims.height],
    ['at', 0, L],
  ])
    if (!Number.isFinite(full[key]) || full[key] < min || full[key] > max)
      throw Error('The ' + kind + ' on the ' + full.wall + ' wall' + where + ': ' + key + ' must be between ' + min + ' and ' + fmtMm(max) + ' mm.');
  return full;
}

// The windows and doors of one storey: each keeps wall beside it, at the
// corners, above it, and between it and the next one, the garage door included.
function checkOpenings(list, dims, blocks, where) {
  if (!Array.isArray(list)) throw Error('The windows and doors' + where + ' are not a list.');
  if (list.length > MAX_OPENINGS) throw Error('A storey has at most ' + MAX_OPENINGS + ' windows and doors.');
  const openings = list.map((o, i) => checkOpening(o, i, dims, where));
  const named = openings.map((o) => ({ ...o, name: openingName(o, openings) + where }));
  for (const o of named) {
    const L = wallLength(dims, o.wall);
    const edge = KIT.wall + KIT.frame;
    const side = sideOf(o);
    if (o.at - o.width / 2 - side < edge || o.at + o.width / 2 + side > L - edge)
      throw Error('The ' + o.name.toLowerCase() + (side ? ' with its ' + (o.shutters ? 'shutters' : 'sill and lintel') : '') + ' reaches into a corner: keep it ' + edge + ' mm from both ends of the ' + fmtMm(L) + ' mm wall.');
    if (o.sill + o.height > dims.height - KIT.frame)
      throw Error('The ' + o.name.toLowerCase() + ' reaches too high: its top can be at most ' + (dims.height - KIT.frame) + ' mm above the floor.');
    // A lintel over it, on its frame: under the top of the wall.
    if (o.lintel && o.sill + o.height + (o.frame ? KIT.trim : 0) + TRIM.lintel > dims.height - 2)
      throw Error('The lintel over the ' + o.name.toLowerCase() + ' reaches too high: its top can be at most ' + fmtMm(dims.height - 2 - TRIM.lintel - (o.frame ? KIT.trim : 0)) + ' mm above the floor.');
    if (o.ledge && o.sill < (o.frame ? KIT.trim : 0) + TRIM.ledge + 1)
      throw Error('The sill under the ' + o.name.toLowerCase() + ' needs the window at least ' + ((o.frame ? KIT.trim : 0) + TRIM.ledge + 1) + ' mm up from the floor.');
    if (o.type === 'window' && o.frame && (o.width / o.across < PANES.least + KIT.bar || o.height / o.up < PANES.least + KIT.bar))
      throw Error('The panes of the ' + o.name.toLowerCase() + ' are too small: each at least ' + PANES.least + ' mm.');
    if ((o.counter || o.flap) && o.width > HATCH.longest)
      throw Error('The ' + o.name.toLowerCase() + ' is too wide for a counter or a flap in one piece: at most ' + HATCH.longest + ' mm.');
    if (o.counter && o.sill < HATCH.counterSill + (o.frame ? KIT.trim : 0))
      throw Error('The counter under the ' + o.name.toLowerCase() + ' needs the window at least ' + (HATCH.counterSill + (o.frame ? KIT.trim : 0)) + ' mm up from the floor.');
  }
  for (const [i, a] of named.entries())
    for (const c of [...named.slice(i + 1), ...blocks]) {
      if (a.wall !== c.wall) continue;
      // One above the other, with wall (and room for their frames) between them.
      if (Number.isFinite(a.sill) && Number.isFinite(c.sill) && a.height && c.height) {
        const [lo, hi] = a.sill < c.sill ? [a, c] : [c, a];
        if (hi.sill - (lo.sill + lo.height) >= KIT.frame + (lo.frame ? KIT.trim : 0) + (hi.frame ? KIT.trim : 0) + overOf(lo) + underOf(hi)) continue;
      }
      if (Math.abs(a.at - c.at) - (a.width + c.width) / 2 - sideOf(a) - sideOf(c) < KIT.frame)
        throw Error('The ' + a.name.toLowerCase() + ' is too close to the ' + c.name.toLowerCase() + ': keep at least ' + KIT.frame + ' mm of wall between them.');
    }
  return openings;
}

/** The building as it is kept: known settings only, each checked. */
export function validateBuilding(input) {
  if (input?.kind === 'sections') return validateConnected(input);
  if (input?.kind === 'footprint') return validateFootprint(input);
  if (input?.kind === 'grandstand') return validateGrandstand(input);
  if (input?.kind === 'gantry') return validateGantry(input);
  if (input?.kind === 'pitmodule') return validatePitModule(input);
  if (input?.kind === 'marshalpost') return validateMarshalPost(input);
  if (input?.kind === 'flagpost') return validateFlagPost(input);
  if (input?.kind === 'billboard') return validateBillboard(input);
  if (input?.kind === 'canopy') return validateCanopy(input);
  if (input?.kind === 'stage') return validateStage(input);
  if (input?.kind === 'switchback') return validateSwitchback(input);
  if (input?.kind === 'bench') return validateBench(input);
  if (input?.kind === 'tyrebridge') return validateTyreBridge(input);
  if (input?.kind === 'picnic') return validatePicnic(input);
  if (input?.kind === 'platform') return validatePlatform(input);
  if (input?.kind === 'walkway') return validateWalkway(input);
  if (input?.kind === 'pitbays') return validatePitBays(input);
  if (input?.kind === 'props') return validatePropsKit(input);
  if (input?.kind === 'fittest') return validateFitTest(input);
  const raw = input && typeof input === 'object' ? input : {};
  const b = { ...BUILDING_DEFAULTS, ...raw };
  for (const key of Object.keys(b))
    if (!Object.hasOwn(BUILDING_DEFAULTS, key)) throw Error('The building has an unknown setting: ' + key + '.');
  if (b.kind !== 'garage') throw Error('Choose a building type from the list.');
  if (!['roller', 'panel', 'open', 'none'].includes(b.door)) throw Error('Choose a door from the list.');
  if (typeof b.roofRailing !== 'boolean' || typeof b.numbers !== 'boolean') throw Error('Choose whether the roof has a railing and the doors their numbers.');
  if (!Number.isInteger(b.firstNumber) || b.firstNumber < 0 || b.firstNumber > 99 - 23) throw Error('The first bay number must be a whole number from 0 to 76.');
  if (!ROOFS.some(([id]) => id === b.roof)) throw Error('Choose a roof from the list.');
  if (!['depth', 'width'].includes(b.ridge)) throw Error('Choose which way the ridge runs.');
  if (!WALLS.includes(b.rises)) throw Error('Choose the side the roof rises towards.');
  Object.assign(b, checkFinish(b, WALLS, b.height));
  if (typeof b.braces !== 'boolean') throw Error('Choose whether the corners get braces.');
  if (!['frame', 'none'].includes(b.roofLip)) throw Error('Choose a frame under the roof, or none.');
  if (!ROOF_TEXTURES.some(([id]) => id === b.roofTexture)) throw Error('Choose a roof texture from the list.');
  // Rooms: their sizes make the width or the depth of the building.
  if (b.rooms !== null) {
    const r = b.rooms;
    if (
      !r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some((k) => !['along', 'sizes'].includes(k)) ||
      !['width', 'depth'].includes(r.along) || !Array.isArray(r.sizes) || r.sizes.length < 2 || r.sizes.length > MAX_ROOMS
    )
      throw Error('Rooms are 2 to ' + MAX_ROOMS + ' sizes, side by side or front to back.');
    r.sizes.forEach((v, i) => {
      if (!Number.isFinite(v) || v < MIN_ROOM || v > 400) throw Error('Room ' + (i + 1) + ' must be between ' + MIN_ROOM + ' and 400 mm.');
    });
    const sum = Math.round(r.sizes.reduce((a, v) => a + v, 0) * 10) / 10;
    if (sum > BUILDING_LIMITS[r.along][1]) throw Error('The rooms add up to ' + fmtMm(sum) + ' mm, more than the ' + BUILDING_LIMITS[r.along][1] + ' mm a building can be.');
    b[r.along] = sum;
    b.rooms = { along: r.along, sizes: [...r.sizes] };
  }
  for (const [key, [min, max]] of Object.entries(BUILDING_LIMITS))
    if (!Number.isFinite(b[key]) || b[key] < min || b[key] > max)
      throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (UNITS[key] ?? ' mm') + '.');
  const doors = garageDoors(b);
  for (const d of doors)
    if (d.width > d.to - d.from - 2 * KIT.frame + 1e-9)
      throw Error(
        doors.length > 1
          ? 'The door is too wide for room ' + d.room + ': at most ' + fmtMm(d.to - d.from - 2 * KIT.frame) + ' mm.'
          : 'The door is too wide for this building: at most ' + fmtMm(d.to - d.from - 2 * KIT.frame) + ' mm at ' + b.width + ' mm wide.',
      );
  const tall = b.height - KIT.frame;
  if (b.door !== 'none' && b.doorHeight > tall)
    throw Error('The door is too high for these walls: at most ' + tall + ' mm at ' + b.height + ' mm high.');
  // A garage over a pit bay: the track runs in through an open door, as wide as the track and more.
  if (b.lane !== null) {
    if (b.rooms) throw Error('A garage over a pit bay has one room.');
    if (!b.lane || typeof b.lane !== 'object' || Array.isArray(b.lane) || Object.keys(b.lane).some((k) => k !== 'width') || !Number.isFinite(b.lane.width) || b.lane.width < 20 || b.lane.width > 380)
      throw Error('The track through the garage must be 20 to 380 mm wide.');
    if (b.door !== 'open') throw Error('A garage over a track has an open door: a roller door would have no floor to stand on behind it.');
    const least = b.lane.width + 2 * KIT.laneClear;
    if (b.doorWidth < least - 1e-9) throw Error('The garage door is narrower than the track through it: make it at least ' + fmtMm(least) + ' mm wide.');
  }
  if (!Array.isArray(b.upper)) throw Error('The storeys above the ground floor are a list, empty for none.');
  if (b.upper.length > MAX_UPPER) throw Error('A building has at most ' + MAX_UPPER + ' storeys above the ground floor.');
  const several = b.upper.length > 0;
  // Windows and doors keep wall beside the garage doors, and beside each
  // dividing wall where it meets an outside wall.
  const blocks = [
    ...doors.map((d) => ({ wall: 'front', at: d.x + d.width / 2, width: d.width, name: doors.length > 1 ? 'garage door of room ' + d.room : 'garage door' })),
    ...dividers(b).flatMap((at) =>
      (b.rooms.along === 'width'
        ? [{ wall: 'front', at }, { wall: 'back', at: b.width - at }]
        : [{ wall: 'right', at }, { wall: 'left', at: b.depth - at }]
      ).map((j) => ({ ...j, width: KIT.wall, name: 'dividing wall' })),
    ),
  ];
  const openings = checkOpenings(b.openings, b, blocks, several ? STOREY_SUFFIX[1] : '');
  checkOpen(b, openings, STOREY_SUFFIX[several ? 1 : 0] || '', b.door !== 'none');
  // The stand: its supports reach up inside the hollow of the base.
  if (!STAND.types.some(([id]) => id === b.standType)) throw Error('Choose what the building stands on from the list.');
  if (!['square', 'round'].includes(b.standShape)) throw Error('Choose a square or a round column.');
  if (b.standType !== 'none') {
    if (b.lane) throw Error('A garage over a pit bay stands on the table.');
    const inner = Math.floor((standInside(b)[2] - standInside(b)[0]) * 10) / 10;
    const room = Math.min(inner, Math.floor((standInside(b)[3] - standInside(b)[1]) * 10) / 10);
    const [lo, hi] = { legs: [8, 20], column: [10, room], tower: [30, room], frames: [0, Infinity] }[b.standType];
    if (b.standSize < lo || b.standSize > hi)
      throw Error({ legs: 'A leg', column: 'The column', tower: 'The tower' }[b.standType] + ' must be ' + lo + ' to ' + fmtMm(hi) + ' mm' + (b.standType === 'legs' ? ' square.' : ' across, inside the base.'));
  }
  if (b.arch) {
    if (b.roof !== 'flat') throw Error('An arched roof is a flat roof with an arch on top: choose a flat roof.');
    if (b.roofRailing || b.sign === 'billboard' || b.accessTo === 'roof' && b.access !== 'none') throw Error('An arched roof has no railing, billboard or way up onto it.');
  }
  if (typeof b.standBraces !== 'boolean') throw Error('Choose whether the legs have knee braces.');
  if (b.standBraces && b.standType !== 'legs') throw Error('Knee braces are for legs.');
  if (b.standBraces && b.standHeight < STAND.knee.reach * Math.tan((STAND.knee.angle * Math.PI) / 180) + STAND.foot[0] + 5) throw Error('Legs with knee braces need a stand at least ' + Math.ceil(STAND.knee.reach * Math.tan((STAND.knee.angle * Math.PI) / 180) + STAND.foot[0] + 5) + ' mm high.');
  // A sign along the top of the front wall: everything in the front wall stays under it.
  if (!['bars', 'mesh', 'lattice', 'solid'].includes(b.railingStyle)) throw Error('Choose railings of bars, of mesh, a lattice or a solid parapet.');
  if (!SIGNS.some(([id]) => id === b.sign)) throw Error('Choose a sign from the list.');
  if (b.sign !== 'none' && b.signWidth > b.width) throw Error('The sign is wider than the building: at most ' + b.width + ' mm.');
  if (b.sign === 'billboard') {
    // It stands on the roof where the roof is level along the front.
    const level = ['flat', 'hip'].includes(b.roof) || (b.roof === 'slope' && ['front', 'back'].includes(b.rises)) || (b.roof === 'gable' && b.ridge === 'width');
    if (!level) throw Error('A billboard stands on a roof that is level along the front: a flat or a hip roof, a single slope rising to the front or the back, or a two-sided roof with its ridge side to side.');
    if (b.roofRailing && b.roof === 'flat') throw Error('The billboard stands where the roof railing runs along the front: choose one.');
  }
  if (b.sign === 'fascia' && b.cornice) throw Error('The sign and the cornice both run along the top of the front wall: choose one.');
  if (b.numbers && (b.cornice || b.pilasters || b.panels)) throw Error('The bay numbers sit on the wall above the doors, where the relief would be: choose one.');
  if (b.sign === 'fascia') {
    // A barrel vault with its ridge side to side comes down past the top of the front wall, where the sign would be.
    if (b.roof === 'vault' && b.ridge === 'width' && !b.upper.length) throw Error('A barrel vault with its ridge side to side comes down over the front wall, where the sign goes: turn its ridge front to back, or letter the wall instead.');
    const under = signUnder(b);
    if (b.numbers && doors.length) throw Error('The sign and the bay numbers both go above the garage doors: choose one.');
    if (b.door !== 'none' && b.doorHeight > under - 1) throw Error('The garage door reaches up under the sign: at most ' + fmtMm(under - 1) + ' mm high with a sign of ' + b.signHeight + ' mm.');
    for (const o of openings.filter((q) => q.wall === 'front')) {
      // Its frame, its lintel and the room its flap takes, all under the sign.
      const extra = (o.frame ? KIT.trim : 0) + overOf(o) + (o.flap ? HATCH.flapClear : 0);
      if (o.sill + o.height + extra > under) throw Error('The ' + openingName(o, openings).toLowerCase() + (o.lintel ? ' with its lintel' : '') + ' reaches up under the sign: its top can be at most ' + fmtMm(under - extra) + ' mm above the floor.');
    }
  }
  // Each storey above stands on the one below, inside its walls.
  let below = { width: b.width, depth: b.depth };
  const upper = b.upper.map((u, i) => {
    const n = i + 2,
      where = STOREY_SUFFIX[n];
    if (!u || typeof u !== 'object' || Array.isArray(u)) throw Error('Storey ' + n + ' is not readable.');
    for (const key of Object.keys(u)) if (!UPPER_KEYS.includes(key)) throw Error('Storey ' + n + ' has an unknown setting: ' + key + '.');
    const s = { ...UPPER_DEFAULTS, ...u };
    s.width ??= below.width - s.x;
    s.depth ??= below.depth - s.y;
    for (const [key, name, min, max] of [
      ['x', 'its place from the left', 0, below.width],
      ['y', 'its place from the front', 0, below.depth],
      ['width', 'Width', 60, below.width],
      ['depth', 'Depth', 60, below.depth],
      ['height', 'Wall height', 30, 200],
    ])
      if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max)
        throw Error('Storey ' + n + ': ' + name + ' must be between ' + min + ' and ' + fmtMm(max) + ' mm.');
    if (s.x + s.width > below.width + 1e-9 || s.y + s.depth > below.depth + 1e-9)
      throw Error('Storey ' + n + ' reaches past the storey below: it is ' + fmtMm(s.width) + ' × ' + fmtMm(s.depth) + ' mm at ' + fmtMm(s.x) + ', ' + fmtMm(s.y) + ' mm on a storey of ' + fmtMm(below.width) + ' × ' + fmtMm(below.depth) + ' mm.');
    Object.assign(s, checkFinish(s, WALLS, s.height, ' for storey ' + n));
    s.openings = checkOpenings(s.openings, s, [], where);
    checkOpen(s, s.openings, where, false);
    if (!Number.isFinite(s.balcony) || s.balcony < 0 || s.balcony > 40) throw Error('Storey ' + n + ': the balcony must reach out 0 to 40 mm.');
    if (typeof s.railing !== 'boolean') throw Error('Choose whether storey ' + n + ' has a railing.');
    if (typeof s.balconyAll !== 'boolean') throw Error('Choose whether the balcony of storey ' + n + ' runs all round.');
    below = s;
    return s;
  });
  // A hip or mansard roof prints in whole panels: the top storey, its size now known, with its overhangs.
  if (b.roof === 'hip' || b.roof === 'mansard') {
    const top = upper.at(-1) ?? b;
    const across = Math.max(top.width + b.overhangLeft + b.overhangRight, top.depth + b.overhangFront + b.overhangBack);
    if (across > HIP_ACROSS) throw Error('A ' + (b.roof === 'hip' ? 'hip' : 'mansard') + ' roof is not cut to fit the plate: the top storey with its overhangs can be at most ' + HIP_ACROSS + ' mm across, not ' + fmtMm(across) + '.');
  }
  checkAccess(b, [{ ...b, openings }, ...upper]);
  // A step in front of a door: on the ground floor, the building on the table.
  if (upper.some((s) => s.openings.some((o) => o.step))) throw Error('A step is for a door on the ground floor.');
  if (b.standType !== 'none' && openings.some((o) => o.step)) throw Error('A door on a stand has no step: the base is off the table.');
  // Leaning walls: the top storey only, under a flat roof, its walls plain of doors and hatches.
  const all = [b, ...upper];
  all.forEach((s, i) => {
    if (!s.lean) return;
    const where = several ? STOREY_SUFFIX[i + 1] : '';
    // Under a storey above: its floor as wide as the tops of the walls, no balcony on it.
    const over = all[i + 1];
    if (over && (over.balcony || over.railing)) throw Error('Over walls that lean out' + where + ', the floor has no balcony or railing.');
    if (over && b.access !== 'none' && (b.accessTo === 'roof' || Number(b.accessTo) >= i + 2))
      throw Error('A way up cannot climb past walls that lean out' + where + '.');
    if (!over && b.roof !== 'flat') throw Error('Walls that lean out carry a flat roof.');
    if (!i && (b.door !== 'none' || b.rooms)) throw Error('A ground floor with walls that lean out has no garage door and one room.');
    if ((i ? s.openings : openings).some((o) => o.counter || o.flap)) throw Error('Walls that lean out' + where + ' have no counters or flaps.');
    if (s.height * Math.tan((s.lean * Math.PI) / 180) > LEAN.reach) throw Error('The walls' + where + ' lean out too far: at most ' + LEAN.reach + ' mm at the top.');
  });
  checkContainer(b, openings);
  b.signText = checkText(b.signText, 'The sign text');
  if (typeof b.signCut !== 'boolean') throw Error('Choose raised or cut letters for the sign.');
  if (b.signText && b.sign !== 'none') {
    // As high as the board leaves room for, 2 mm clear all round; on a roof billboard, of the part above the roof.
    const h = fitHeight(b.signText, b.signWidth - 4, b.signHeight - 4);
    if (h < LETTERING.height[0]) throw Error('The sign is too small for “' + b.signText + '”: make it wider or higher, or the text shorter.');
  }
  const lettering = checkLettering(b.lettering, { ...b, openings }, doors, b.sign === 'fascia' ? signUnder(b) : Infinity, '');
  upper.forEach((u, i) => (u.lettering = checkLettering(u.lettering, u, [], Infinity, STOREY_SUFFIX[i + 2])));
  const out = { ...b, openings, lettering, upper, cuts: validateCuts(b.cuts) };
  checkRoof(out);
  out.props = checkProps(out);
  out.leaveOut = checkLeaveOut(out);
  out.damage = checkDamage(out);
  checkGableFront(out);
  out.partitions = checkPartitions(out);
  out.stairs = checkStairs(out);
  checkInsideClash(out);
  return out;
}
/** On each storey a partition, a flight of stairs and a prop keep clear of each other, on the plan. */
function checkInsideClash(b) {
  const h = INSIDE.thick / 2;
  const things = [
    ...b.partitions.map((q, i) => ({ storey: q.storey, name: 'Partition ' + (i + 1), box: [Math.min(q.x0, q.x1) - h, Math.min(q.y0, q.y1) - h, Math.max(q.x0, q.x1) + h, Math.max(q.y0, q.y1) + h] })),
    ...b.stairs.map((q, i) => ({ storey: q.storey, name: 'Stairs ' + (i + 1), box: flightOf(b, q).box })),
    ...b.props.filter((p) => p.storey >= 0).map((p, i) => {
      const [fw, fd] = propFootprint(p.type, p.rotation);
      return { storey: p.storey, name: 'prop ' + (b.props.indexOf(p) + 1), box: [p.x, p.y, p.x + fw, p.y + fd] };
    }),
  ];
  const meets = (a, c) => a[0] < c[2] && c[0] < a[2] && a[1] < c[3] && c[1] < a[3];
  const named = (t) => t.name[0].toUpperCase() + t.name.slice(1);
  for (const [i, a] of things.entries())
    for (const c of things.slice(i + 1))
      if (a.storey === c.storey && meets(a.box, c.box))
        if (!(a.name.startsWith('Partition') && c.name.startsWith('Partition'))) throw Error(a.name + ' stands on ' + c.name.toLowerCase() + ': move one of them.');
  // Each flight's stairwell, cut in the floor above as buildGarage cuts it: nothing stands over it.
  const g = INSIDE.stair.well;
  b.stairs.forEach((q, k) => {
    const [x0, y0, x1, y1] = flightOf(b, q).box,
      well = [x0 - g, y0 - g, x1 + g, y1 + g];
    for (const t of things) if (t.storey === q.storey + 1 && meets(t.box, well)) throw Error(named(t) + ' stands over the stairwell of stairs ' + (k + 1) + ': move one of them.');
  });
  // Over a pit bay the track runs through the base, as wide as the cut through it: nothing on the ground floor stands over it.
  if (b.lane) {
    const half = b.lane.width / 2 + KIT.lanePlay,
      lane = [b.width / 2 - half, -Infinity, b.width / 2 + half, b.depth - KIT.wall - b.play];
    for (const t of things)
      if (t.storey === 0 && meets(t.box, lane))
        throw Error(named(t) + ' stands over the track through the garage: keep it out of the ' + fmtMm(2 * half) + ' mm in the middle of the floor.');
  }
}

/**
 * Partitions and stairs: a partition thick, at least so long, its top this far
 * under the ceiling (clear of the frame under the floor above), its doorway at
 * least this far from its ends; a flight of stairs wide, its steps at most this
 * high and this deep, kept this far inside the walls, clear of the frames under
 * the floor above, its stairwell this much bigger all round.
 */
export const INSIDE = Object.freeze({ thick: 2.4, least: 20, under: 1, doorEdge: 4, stair: { width: 22, rise: 8, tread: 9, slab: 4, keep: 10, well: 1 } });
// The storey a partition or a flight stands on, and its room on the plan of the ground floor.
function storeyRoom(b, k, name) {
  const all = storeyStack(b);
  if (!Number.isInteger(k) || k < 0 || k >= all.length) throw Error(name + ' stands on a storey the building has not got.');
  const s = all[k];
  return { s, all, x0: s.ox + KIT.wall + b.play, y0: s.oy + KIT.wall + b.play, x1: s.ox + s.width - KIT.wall - b.play, y1: s.oy + s.depth - KIT.wall - b.play };
}
function checkPartitions(b) {
  const list = b.partitions ?? [];
  if (!Array.isArray(list) || list.length > 24) throw Error('A building has at most 24 partitions.');
  return list.map((q, i) => {
    const name = 'Partition ' + (i + 1);
    if (!q || typeof q !== 'object' || Object.keys(q).some((k) => !['storey', 'x0', 'y0', 'x1', 'y1', 'door'].includes(k))) throw Error(name + ' has a storey, two ends and a doorway or none.');
    const p = { storey: q.storey ?? 0, x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1, door: q.door ?? null };
    if (![p.x0, p.y0, p.x1, p.y1].every(Number.isFinite)) throw Error(name + ' has two ends.');
    if (Math.abs(p.x0 - p.x1) > 1e-9 && Math.abs(p.y0 - p.y1) > 1e-9) throw Error(name + ' runs along the width or the depth, not across.');
    const L = Math.hypot(p.x1 - p.x0, p.y1 - p.y0);
    if (L < INSIDE.least) throw Error(name + ' is at least ' + INSIDE.least + ' mm long.');
    const r = storeyRoom(b, p.storey, name), h = INSIDE.thick / 2;
    const along = Math.abs(p.y0 - p.y1) < 1e-9;
    const [lo, hi] = [Math.min(along ? p.x0 : p.y0, along ? p.x1 : p.y1), Math.max(along ? p.x0 : p.y0, along ? p.x1 : p.y1)];
    const ok = along ? lo >= r.x0 - 1e-6 && hi <= r.x1 + 1e-6 && p.y0 - h >= r.y0 && p.y0 + h <= r.y1 : lo >= r.y0 - 1e-6 && hi <= r.y1 + 1e-6 && p.x0 - h >= r.x0 && p.x0 + h <= r.x1;
    if (!ok) throw Error(name + ' stands inside ' + (p.storey ? 'storey ' + (p.storey + 1) : 'the ground floor') + ', between its walls.');
    if (p.door !== null) {
      const d = p.door;
      if (typeof d !== 'object' || Object.keys(d).some((k) => !['at', 'width', 'height'].includes(k)) || ![d.at, d.width, d.height].every(Number.isFinite)) throw Error(name + ': its doorway has a place, a width and a height.');
      if (d.width < 10 || d.at - d.width / 2 < INSIDE.doorEdge || d.at + d.width / 2 > L - INSIDE.doorEdge) throw Error(name + ': its doorway, at least 10 mm wide, keeps ' + INSIDE.doorEdge + ' mm from each end.');
      if (d.height < 15 || d.height > r.s.height - KIT.lipDepth - INSIDE.under - 6) throw Error(name + ': its doorway is 15 to ' + Math.floor(r.s.height - KIT.lipDepth - INSIDE.under - 6) + ' mm high, under the top of the partition.');
      p.door = { at: d.at, width: d.width, height: d.height };
    }
    return p;
  });
}
/** A flight of stairs: how many steps, how high, its run and its footprint on the plan [x0, y0, x1, y1]. */
export function flightOf(b, q) {
  const all = storeyStack(b), s = all[q.storey], next = all[q.storey + 1];
  const S = INSIDE.stair;
  const rise = next.floor - s.floor;
  const steps = Math.max(2, Math.ceil(rise / S.rise - 1e-9));
  const run = steps * S.tread;
  const [w, d] = q.rotation % 180 ? [run, S.width] : [S.width, run];
  return { steps, rise: rise / steps, run, box: [q.x, q.y, q.x + w, q.y + d], floor: s.floor, top: next.floor };
}
function checkStairs(b) {
  const list = b.stairs ?? [];
  if (!Array.isArray(list) || list.length > 8) throw Error('A building has at most 8 flights of stairs.');
  const all = storeyStack(b);
  const placed = [];
  return list.map((q, i) => {
    const name = 'Stairs ' + (i + 1);
    if (!q || typeof q !== 'object' || Object.keys(q).some((k) => !['storey', 'x', 'y', 'rotation'].includes(k))) throw Error(name + ' has a storey, a place and a turn.');
    const p = { storey: q.storey ?? 0, x: q.x, y: q.y, rotation: q.rotation ?? 0 };
    if (![p.x, p.y].every(Number.isFinite) || ![0, 90, 180, 270].includes(p.rotation)) throw Error(name + ' has a place and a turn of 0, 90, 180 or 270\u00b0.');
    if (!Number.isInteger(p.storey) || p.storey < 0 || p.storey >= all.length - 1) throw Error(name + ' climbs to a storey above: put it on a storey with one over it.');
    const { box } = flightOf(b, p);
    // Inside the storey's walls and those of the one above, clear of the frames under the floor.
    for (const st of [all[p.storey], all[p.storey + 1]]) {
      const k = INSIDE.stair.keep;
      if (box[0] < st.ox + k || box[1] < st.oy + k || box[2] > st.ox + st.width - k || box[3] > st.oy + st.depth - k)
        throw Error(name + ' stands ' + k + ' mm inside the walls of ' + (p.storey ? 'storey ' + (p.storey + 1) : 'the ground floor') + ' and of the storey above, clear of the frame under its floor.');
    }
    for (const o of placed) if (o.storey === p.storey && box[0] < o.box[2] && o.box[0] < box[2] && box[1] < o.box[3] && o.box[1] < box[3]) throw Error(name + ' stands on ' + o.name + '.');
    placed.push({ storey: p.storey, box, name: name.toLowerCase() });
    return p;
  });
}

/** The stepped gable: its board thick, glued this far down the wall, clear of the roof by this much. */
export const GABLE_FRONT = Object.freeze({ thick: 2.5, glue: 8, clear: 4, crown: 4 });
function checkGableFront(b) {
  if (!['none', 'stepped'].includes(b.gableFront)) throw Error('Choose a stepped gable, or none.');
  if (b.gableFront === 'none') return;
  if (!Number.isInteger(b.gableSteps) || b.gableSteps < 1 || b.gableSteps > 6) throw Error('A stepped gable has 1 to 6 steps a side.');
  if (b.roof !== 'gable' || b.ridge !== 'depth') throw Error('A stepped gable stands on a two-sided roof whose gable faces the front: its ridge front to back.');
  if (b.overhangFront > 0) throw Error('The stepped gable stands where the roof would overhang the front: set the overhang at the front to 0.');
  if (b.leaveOut.includes('roof') || b.leaveOut.includes('front')) throw Error('A stepped gable needs the roof and the front wall.');
  if (b.sign === 'fascia' || b.cornice) throw Error('The stepped gable covers the top of the front wall, where the sign or the cornice would be: choose one.');
  const all = storeyStack(b),
    top = all[all.length - 1];
  // Under the board: each front opening with its frame, lintel and flap, and the lettering.
  const under = top.height - GABLE_FRONT.glue - 1;
  for (const o of top.openings.filter((o) => o.wall === 'front'))
    if (o.sill + o.height + (o.frame ? KIT.trim : 0) + overOf(o) + (o.flap ? HATCH.flapClear : 0) > under)
      throw Error('The stepped gable is glued over the top ' + GABLE_FRONT.glue + ' mm of the front wall: keep the ' + openingName(o, top.openings).toLowerCase() + (o.lintel ? ', its lintel' : '') + (o.flap ? ', its flap' : '') + ' under it.');
  top.lettering.forEach((l, i) => {
    if (l.wall === 'front' && l.up + l.height / 2 > under - 1)
      throw Error('The stepped gable is glued over the top ' + GABLE_FRONT.glue + ' mm of the front wall: keep lettering ' + (i + 1) + top.label + ' under it, its middle at most ' + fmtMm(under - 1 - l.height / 2) + ' mm up.');
  });
}
/** The stepped gable's outline in the plane of the front wall: u along it, z up; each step clear of the roof over it. */
export function gableFrontOutline(b) {
  const all = storeyStack(b),
    top = all[all.length - 1],
    shape = roofShape(b);
  const W = top.width,
    n = b.gableSteps,
    sw = W / (2 * n + 1);
  const thick = KIT.roof * Math.hypot(shape.panels[0]?.t ?? 0, 1);
  const over = (u) => top.eave + roofAt(shape, u, 0) + thick;
  const tops = Array.from({ length: 2 * n + 1 }, (_, k) => Math.max(over(k * sw), over((k + 1) * sw), over(Math.min(Math.max(W / 2, k * sw), (k + 1) * sw))) + GABLE_FRONT.clear + (k === n ? GABLE_FRONT.crown : 0));
  const zb = top.eave - GABLE_FRONT.glue;
  const pts = [[0, zb], [W, zb]];
  for (let k = 2 * n; k >= 0; k--) pts.push([(k + 1) * sw, tops[k]], [k * sw, tops[k]]);
  return pts;
}

/** Breaches: at most so many; each at least `least` wide and deep, and `keep` of the wall left under it. */
export const DAMAGE = Object.freeze({ most: 6, least: 10, keep: 10 });
/**
 * The breaches, checked: in a wall of the top storey that is there, with the
 * roof left out, inside the wall clear of its corners, not as low as the
 * floor, clear of the windows and doors.
 */
function checkDamage(b) {
  const list = b.damage ?? [];
  if (!Array.isArray(list) || list.length > DAMAGE.most) throw Error('A building has at most ' + DAMAGE.most + ' breaches.');
  if (list.length && !b.leaveOut.includes('roof')) throw Error('A breach comes down from the top of a wall: leave the roof out first.');
  const all = storeyStack(b),
    top = all[all.length - 1];
  return list.map((d, i) => {
    const name = 'Breach ' + (i + 1);
    if (!d || typeof d !== 'object' || Object.keys(d).some((k) => !['wall', 'at', 'width', 'depth'].includes(k))) throw Error(name + ' has a wall, a place, a width and a depth.');
    if (!['front', 'back', 'left', 'right'].includes(d.wall)) throw Error(name + ': choose the front, back, left or right wall.');
    if (b.leaveOut.includes(d.wall)) throw Error(name + ' is in a wall that is left out.');
    const L = d.wall === 'front' || d.wall === 'back' ? top.width : top.depth;
    const q = { wall: d.wall, at: d.at, width: d.width, depth: d.depth };
    if (![q.at, q.width, q.depth].every(Number.isFinite)) throw Error(name + ' has a place, a width and a depth.');
    if (q.width < DAMAGE.least || q.depth < DAMAGE.least) throw Error(name + ' is at least ' + DAMAGE.least + ' mm wide and deep.');
    const edge = KIT.wall + KIT.frame;
    if (q.at - q.width / 2 < edge || q.at + q.width / 2 > L - edge) throw Error(name + ' reaches into a corner: keep it ' + edge + ' mm from both ends of the ' + fmtMm(L) + ' mm wall.');
    if (q.depth > top.height - DAMAGE.keep) throw Error(name + ' reaches too far down: at most ' + fmtMm(top.height - DAMAGE.keep) + ' mm, leaving ' + DAMAGE.keep + ' mm of wall.');
    for (const o of top.openings.filter((o) => o.wall === d.wall)) {
      const across = Math.abs(o.at - q.at) < o.width / 2 + q.width / 2 + KIT.trim + 2;
      if (across && o.sill + o.height + KIT.trim + 2 > top.height - q.depth) throw Error(name + ' reaches into the ' + openingName(o, top.openings).toLowerCase() + ' under it: make it shallower or move it along.');
    }
    return q;
  });
}
/**
 * A breach's ragged gap, in the plane of its wall: u along the wall from its
 * left end as seen from outside, z up; from above the top down, its foot
 * jagged, the same every time for the same breach.
 */
export function breachOutline(d, zTop) {
  const u0 = d.at - d.width / 2,
    u1 = d.at + d.width / 2,
    n = Math.max(3, Math.round(d.width / 7));
  // A steady, uneven run of depths: from the size and the place, no randomness.
  const jag = (k) => 0.62 + 0.38 * Math.abs(Math.sin(k * 12.9898 + d.at * 0.7 + d.width * 0.31));
  const foot = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    // Shallower at its sides, deepest in its middle, ragged all along.
    const shape = Math.sin(Math.PI * (0.15 + 0.7 * t));
    foot.push([u0 + (u1 - u0) * t, zTop - d.depth * (k === 0 || k === n ? 0.25 : shape * jag(k))]);
  }
  return [[u0, zTop + 1], ...foot, [u1, zTop + 1]].reverse();
}

const LEAVE_OUT = ['roof', 'front', 'back', 'left', 'right'];
/**
 * What is left out, checked: the roof, with nothing on it or up to it; walls,
 * at most three, with no window, door, sign, number, lettering or way up on
 * them on any storey, and on the front no garage door.
 */
function checkLeaveOut(b) {
  const list = b.leaveOut ?? [];
  if (!Array.isArray(list) || list.some((k) => !LEAVE_OUT.includes(k)) || new Set(list).size !== list.length) throw Error('Leave out the roof or a wall, each once.');
  const walls = list.filter((k) => k !== 'roof');
  if (walls.length > 3) throw Error('Keep at least one wall.');
  if (list.includes('roof')) {
    if (b.chimney || b.dormers.length || b.rooflights?.length || b.gutters || b.roofRailing || b.sign === 'billboard' || (b.access !== 'none' && b.accessTo === 'roof'))
      throw Error('With the roof left out there is nothing for a chimney, dormers, rooflights, gutters, a roof railing, a billboard or a way up onto the roof.');
  }
  for (const w of walls) {
    const name = WALL_NAMES[w].toLowerCase() + ' wall';
    const storeys = [b, ...b.upper];
    if (storeys.some((st) => st.openings.some((o) => o.wall === w))) throw Error('The ' + name + ' is left out: take its windows and doors off first.');
    if (storeys.some((st) => (st.lettering ?? []).some((l) => l.wall === w))) throw Error('The ' + name + ' is left out: take the lettering off it first.');
    if (b.access !== 'none' && b.accessWall === w) throw Error('The ' + name + ' is left out: the way up climbs another wall.');
    if (w === 'front' && (b.door !== 'none' || b.sign === 'fascia' || b.numbers)) throw Error('The front wall is left out: it has no garage door, sign or bay numbers.');
  }
  return [...list];
}
/** Whether a part of the kit is kept, or left out with the roof or its wall. */
export function keptPart(b, id) {
  const out = b.leaveOut ?? [];
  if (!out.length) return true;
  if (out.includes('roof') && /^(roof|light-)/.test(id)) return false;
  const corners = { front: ['fl', 'fr'], back: ['bl', 'br'], left: ['fl', 'bl'], right: ['fr', 'br'] };
  for (const w of out) {
    if (w === 'roof') continue;
    if (new RegExp('^' + w + '\\d?(-\\d+)?$').test(id)) return false;
    if (new RegExp('^brace\\d?-(' + corners[w].join('|') + ')$').test(id)) return false;
  }
  return true;
}

/**
 * The props of a building: each inside a storey, clear of its walls and
 * under its ceiling, or outside on the table, clear of the base; none on
 * another. Whatever else they meet inside is checked when the building is made.
 */
function checkProps(b) {
  const props = checkPropList(b.props);
  const all = storeyStack(b);
  const inner = KIT.wall + b.play + PROP_GAP;
  const outside = props.some((p) => p.storey < 0) ? tableParts(b) : [];
  const placed = [];
  props.forEach((p, i) => {
    const name = 'Prop ' + (i + 1) + ', the ' + propOf(p.type).name.toLowerCase();
    const [fw, fd] = propFootprint(p.type, p.rotation);
    const box = [p.x, p.y, p.x + fw, p.y + fd];
    if (p.storey >= all.length) throw Error(name + ' stands on a storey the building has not got.');
    if (p.storey >= 0) {
      const s = all[p.storey];
      // On the plan of the ground floor: a storey above sits at its own place on it.
      const [x0, y0] = [s.ox ?? 0, s.oy ?? 0];
      if (box[0] < x0 + inner || box[1] < y0 + inner || box[2] > x0 + s.width - inner || box[3] > y0 + s.depth - inner)
        throw Error(name + ' stands inside ' + (p.storey ? 'storey ' + (p.storey + 1) : 'the ground floor') + ', ' + PROP_GAP + ' mm clear of its walls.');
      if (propOf(p.type).size[2] > s.height - KIT.lipDepth - 1) throw Error(name + ' is too tall for ' + (p.storey ? 'storey ' + (p.storey + 1) : 'the ground floor') + ': ' + propOf(p.type).size[2] + ' mm under a ceiling ' + s.height + ' mm high.');
    } else {
      const m = KIT.ledge + PROP_GAP;
      if (box[0] < b.width + m && box[2] > -m && box[1] < b.depth + m && box[3] > -m) throw Error(name + ' stands on the table outside: keep it ' + PROP_GAP + ' mm clear of the base.');
      if (box[0] < -150 || box[1] < -150 || box[2] > b.width + 150 || box[3] > b.depth + 150) throw Error(name + ' stands at most 150 mm from the building.');
      for (const t of outside)
        if (box[0] < t.box[2] + PROP_GAP && t.box[0] < box[2] + PROP_GAP && box[1] < t.box[3] + PROP_GAP && t.box[1] < box[3] + PROP_GAP)
          throw Error(name + ' stands on the table where ' + t.name + ' is: keep it ' + PROP_GAP + ' mm clear.');
    }
    for (const q of placed)
      if (q.storey === p.storey && box[0] < q.box[2] + PROP_GAP && q.box[0] < box[2] + PROP_GAP && box[1] < q.box[3] + PROP_GAP && q.box[1] < box[3] + PROP_GAP)
        throw Error(name + ' stands on ' + q.name + ': keep them ' + PROP_GAP + ' mm apart.');
    placed.push({ storey: p.storey, box, name: q0(i, p) });
  });
  return props;
}
const q0 = (i, p) => 'prop ' + (i + 1) + ', the ' + propOf(p.type).name.toLowerCase();
/**
 * What stands on the table round the base, on the plan of the ground floor
 * as buildGarage makes it: the steps in front of doors, the feet of the
 * stand, and the way up the outside. Each { name, box: [x0, y0, x1, y1] }.
 */
function tableParts(b) {
  const W = b.width,
    D = b.depth,
    m = KIT.ledge;
  const out = [];
  // A point u along a wall, n out from its face, on a storey of W × D at (ox, oy).
  const at = (wall, u, n, w = W, d = D, ox = 0, oy = 0) =>
    ({ front: [ox + u, oy - n], back: [ox + w - u, oy + d + n], left: [ox - n, oy + d - u], right: [ox + w + n, oy + u] })[wall];
  const span = (wall, u0, u1, n0, n1, ...s) => {
    const [a, c] = [at(wall, u0, n0, ...s), at(wall, u1, n1, ...s)];
    return [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])];
  };
  const [reach, wider] = KIT.step;
  for (const o of b.openings) if (o.step) out.push({ name: 'the step of the ' + openingName(o, b.openings).toLowerCase(), box: span(o.wall, o.at - o.width / 2 - wider, o.at + o.width / 2 + wider, m, m + reach) });
  const pad = STAND.foot[1];
  if (b.standType === 'legs') standFeet(b).forEach((box, i) => out.push({ name: 'the foot of the ' + LEG_NAMES[i] + ' leg', box }));
  if (b.standType === 'frames') {
    const [x0, y0, x1, y1] = standInside(b);
    out.push({ name: 'the foot frame of the stand', box: [x0 - pad, y0 - pad, x1 + pad, y1 + pad] });
  }
  if (b.standType === 'tower' || b.standType === 'column') {
    const r = (b.standType === 'tower' ? b.standSize : b.standSize * (1 + b.standTaper / 100)) / 2 + pad;
    out.push({ name: 'the foot of the ' + b.standType, box: [W / 2 - r, D / 2 - r, W / 2 + r, D / 2 + r] });
  }
  if (b.access !== 'none') {
    const { against: s, rise, out: extra } = accessPlace(b, [b, ...b.upper]);
    const relief = s.relief && (s.relief.plinth || s.relief.cornice || s.relief.pilasters) ? RELIEF.depth : 0;
    const off = Math.max(KIT.ledge, extra, relief) + 0.2;
    const where = [s.width, s.depth, s.ox, s.oy];
    if (b.access === 'ladder') {
      // From the wall out to its foot, and the thickness of its rails beyond.
      const Q = ACCESS.ladder,
        a = (Q.angle * Math.PI) / 180;
      out.push({ name: 'the ladder', box: span(b.accessWall, b.accessAt - Q.width / 2, b.accessAt + Q.width / 2, off, off + rise / Math.tan(a) + Q.thick / Math.sin(a), ...where) });
    } else out.push({ name: 'the staircase', box: span(b.accessWall, b.accessAt, b.accessAt + stairsOf(rise).run, off, off + ACCESS.stairs.width, ...where) });
  }
  return out;
}

/**
 * The chimney, the rooflights, the gutters and the downpipes: each over the
 * top storey, a rooflight inside the walls on one panel of the roof, clear of
 * its ridge, its hips and each other; gutters along the eaves of a sloped
 * roof, the downpipes down walls that stand one above the other.
 */
function checkFittings(b) {
  const F = FITTINGS;
  const top = storeyStack(b).at(-1);
  const W = top.width,
    D = top.depth;
  const plain = b.container === 'none' && !b.arch;
  const num = (v) => Number.isFinite(v);
  const boxes = [];
  if (b.chimney !== null) {
    const c = b.chimney;
    if (!c || typeof c !== 'object' || Object.keys(c).some((k) => !['x', 'y', 'width', 'depth', 'height'].includes(k)) || !['x', 'y', 'width', 'depth', 'height'].every((k) => num(c[k])))
      throw Error('A chimney has a place, a width, a depth and a height.');
    if (!plain) throw Error('A chimney stands on a roof of its own: not on an arched roof or a container.');
    for (const k of ['width', 'depth']) if (c[k] < F.size[0] || c[k] > F.size[1]) throw Error('The chimney is ' + F.size[0] + ' to ' + F.size[1] + ' mm ' + (k === 'width' ? 'wide' : 'deep') + '.');
    if (c.height < F.high[0] || c.height > F.high[1]) throw Error('The chimney stands ' + F.high[0] + ' to ' + F.high[1] + ' mm over the roof.');
    const edge = KIT.wall + (b.roofRailing && b.roof === 'flat' ? KIT.railInset + KIT.railThick + 2 : 0);
    if (c.x - c.width / 2 < edge || c.x + c.width / 2 > W - edge || c.y - c.depth / 2 < edge || c.y + c.depth / 2 > D - edge)
      throw Error('The chimney stands over the top storey, ' + fmtMm(edge) + ' mm in from its outside' + (edge > KIT.wall ? ', inside the roof railing' : '') + '.');
    boxes.push({ name: 'the chimney', box: [c.x - c.width / 2, c.y - c.depth / 2, c.x + c.width / 2, c.y + c.depth / 2] });
  }
  if (!Array.isArray(b.rooflights) || b.rooflights.length > F.lightsMost) throw Error('A roof has at most ' + F.lightsMost + ' rooflights.');
  if (b.rooflights.length) {
    if (!plain || b.roof === 'vault') throw Error('Rooflights go in a flat, sloped, two-sided, hip or sawtooth roof, not an arched roof or a container.');
    const shape = roofShape(b);
    const inner = KIT.wall + b.play + KIT.lip + 4;
    b.rooflights = b.rooflights.map((l, i) => {
      const name = 'Rooflight ' + (i + 1);
      if (!l || typeof l !== 'object' || Object.keys(l).some((k) => !['x', 'y', 'width', 'depth'].includes(k)) || !['x', 'y', 'width', 'depth'].every((k) => num(l[k])))
        throw Error(name + ' has a place, a width and a depth.');
      for (const k of ['width', 'depth']) if (l[k] < F.light[0] || l[k] > F.light[1]) throw Error(name + ' is ' + F.light[0] + ' to ' + F.light[1] + ' mm ' + (k === 'width' ? 'wide' : 'deep') + '.');
      const box = [l.x - l.width / 2, l.y - l.depth / 2, l.x + l.width / 2, l.y + l.depth / 2];
      if (box[0] < inner || box[1] < inner || box[2] > W - inner || box[3] > D - inner) throw Error(name + ' keeps ' + fmtMm(inner) + ' mm inside the outside of the walls, clear of the frame under the roof.');
      // On one panel, clear of where it meets the next.
      const p = roofPanelAt(shape, l.x, l.y);
      if (p) {
        const corners = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]];
        const keeps = [...(p.keeps ?? [])];
        // Under a sawtooth, also clear of the north light at the top of the tooth.
        for (const [n, off] of keeps) {
          const room = F.clear + (shape.saw && n[0] * shape.saw.dir[0] + n[1] * shape.saw.dir[1] < 0 ? KIT.wall : 0);
          if (corners.some(([x, y]) => n[0] * x + n[1] * y - off < room)) throw Error(name + ' reaches over the ' + (shape.saw ? 'top of its tooth' : b.roof === 'hip' ? 'hip or the ridge' : 'ridge') + ': keep it ' + room + ' mm clear, on one side of the roof.');
        }
        // A gambrel or a mansard: on one panel, clear of its break, its hips and its ridge.
        if (shape.mitred && !onePanel(shape, p, box, F.clear)) throw Error(name + ' reaches over the break, a hip or the ridge: keep it ' + F.clear + ' mm clear, on one panel of the roof.');
      }
      for (const q of boxes)
        if (box[0] < q.box[2] + F.apart && q.box[0] < box[2] + F.apart && box[1] < q.box[3] + F.apart && q.box[1] < box[3] + F.apart) throw Error(name + ' runs into ' + q.name + ': keep them ' + F.apart + ' mm apart.');
      boxes.push({ name: name.toLowerCase(), box });
      return { x: l.x, y: l.y, width: l.width, depth: l.depth };
    });
  }
  if (!Array.isArray(b.dormers) || b.dormers.length > F.dormersMost) throw Error('A roof has at most ' + F.dormersMost + ' dormers.');
  if (b.dormers.length) {
    if (!plain || !['slope', 'gable', 'hip', 'gambrel', 'mansard'].includes(b.roof)) throw Error('Dormers stand on a sloped, two-sided, hip, gambrel or mansard roof.');
    const shape = roofShape(b);
    const inner = KIT.wall + b.play + KIT.lip + 4;
    b.dormers = b.dormers.map((d, i) => {
      const name = 'Dormer ' + (i + 1);
      if (!d || typeof d !== 'object' || Object.keys(d).some((k) => !['x', 'y', 'width', 'height'].includes(k)) || !['x', 'y', 'width', 'height'].every((k) => num(d[k])))
        throw Error(name + ' has a place, a width and a height.');
      if (d.width < F.dormerWide[0] || d.width > F.dormerWide[1]) throw Error(name + ' is ' + F.dormerWide[0] + ' to ' + F.dormerWide[1] + ' mm wide.');
      if (d.height < F.dormerHigh[0] || d.height > F.dormerHigh[1]) throw Error('The front of ' + name.toLowerCase() + ' is ' + F.dormerHigh[0] + ' to ' + F.dormerHigh[1] + ' mm high over the roof.');
      const g = dormerShape(shape, d);
      if (!g) throw Error(name + ' stands on a sloped panel of the roof.');
      // The opening under it, inside the walls and clear of the frame under the roof.
      const hole = g.plan(g.ac - g.hw + KIT.wall, g.df + KIT.wall, g.ac + g.hw - KIT.wall, Math.max(g.df + KIT.wall, g.valley - 1));
      if (hole[0] < inner || hole[1] < inner || hole[2] > W - inner || hole[3] > D - inner) throw Error(name + ' opens into the roof ' + fmtMm(inner) + ' mm inside the outside of the walls, clear of the frame under the roof: move it up the roof or in from the end.');
      if (!onePanel(shape, g.p, g.foot, F.clear)) throw Error(name + ' reaches over a ridge, a hip or a break of the roof: make it lower or narrower, or move it down the roof.');
      // A single slope has no ridge: it ends at the high wall.
      if (g.foot[0] < 0 || g.foot[1] < 0 || g.foot[2] > W || g.foot[3] > D) throw Error(name + ' reaches back past the top of the roof: make it lower, or move it down the roof.');
      for (const q of boxes)
        if (g.foot[0] < q.box[2] + F.apart && q.box[0] < g.foot[2] + F.apart && g.foot[1] < q.box[3] + F.apart && q.box[1] < g.foot[3] + F.apart) throw Error(name + ' runs into ' + q.name + ': keep them ' + F.apart + ' mm apart.');
      boxes.push({ name: name.toLowerCase(), box: g.foot });
      return { x: d.x, y: d.y, width: d.width, height: d.height };
    });
  }
  if (typeof b.gutters !== 'boolean') throw Error('Choose whether the roof has gutters.');
  if (!['none', 'left', 'right'].includes(b.downpipes)) throw Error('Choose where the downpipes go: none, at the left or at the right end.');
  if (b.gutters && !['slope', 'gable', 'hip'].includes(b.roof)) throw Error('Gutters run along the eaves of a sloped, two-sided or hip roof.');
  // Round a hip roof they meet at the corners: the eaves all at one height.
  if (b.gutters && b.roof === 'hip' && new Set([b.overhangFront, b.overhangBack, b.overhangLeft, b.overhangRight]).size > 1)
    throw Error('Gutters round a hip roof meet at its corners: give it the same overhang on every side.');
  if (b.downpipes !== 'none') {
    if (!b.gutters) throw Error('A downpipe comes down from a gutter: choose gutters too.');
    const all = storeyStack(b);
    if (all.some((s) => s.width !== W || s.depth !== D || s.x || s.y || s.lean) || b.upper.some((u) => u.balcony))
      throw Error('A downpipe runs down walls that stand one above the other: every storey as big as the one below, in line with it, without a balcony.');
    if (b.standType !== 'none') throw Error('A downpipe comes down to the base: not on a building on a stand.');
  }
}

/** Whether a box on the plan, and a margin round it, lies all on one panel p of the roof. */
function onePanel(shape, p, [x0, y0, x1, y1], margin) {
  const N = 8;
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) {
      if (i && j && i < N && j < N) continue;
      const x = x0 - margin + ((x1 - x0 + 2 * margin) * i) / N,
        y = y0 - margin + ((y1 - y0 + 2 * margin) * j) / N;
      if (roofPanelAt(shape, x, y) !== p) return false;
    }
  return true;
}


/** The eaves a gutter runs along: the wall under the low edge of a panel of a sloped, two-sided or hip roof. */
const eaveOf = (p) => ({ '1,0': 'left', '-1,0': 'right', '0,1': 'front', '0,-1': 'back' })[p.dir.join(',')];

/** The panel of a sloped roof over a point of the top storey: the lowest there, or under a sawtooth the tooth. */
function roofPanelAt(shape, x, y) {
  if (shape.saw) {
    const { dir, s0, n, w } = shape.saw;
    return shape.panels[Math.min(n - 1, Math.max(0, Math.floor((dir[0] * x + dir[1] * y - s0) / w)))];
  }
  let best = null;
  for (const p of shape.panels) {
    const z = p.t * (p.dir[0] * x + p.dir[1] * y - p.s0);
    if (!best || z < best.z) best = { p, z };
  }
  return best?.p ?? null;
}

/** The sawtooth and the vault: their teeth wide enough for a north light, the vault no higher than a half round. */
function checkRoof(b) {
  if (!Number.isInteger(b.teeth)) throw Error('The teeth must be a whole number from 2 to 8.');
  checkFittings(b);
  if (!['sawtooth', 'vault', 'gambrel', 'mansard'].includes(b.roof)) return;
  const top = storeyStack(b).at(-1);
  if (b.roof === 'gambrel' || b.roof === 'mansard') {
    if (b.pitch > b.lowerPitch - 10) throw Error('The upper pitch of a ' + b.roof + ' is at least 10° shallower than the lower: at most ' + (b.lowerPitch - 10) + '°.');
    const half = (b.roof === 'mansard' ? Math.min(top.width, top.depth) : b.ridge === 'depth' ? top.width : top.depth) / 2;
    if (b.breakAt > half - 10) throw Error('The break of the ' + b.roof + ' is at most ' + fmtMm(half - 10) + ' mm in from the walls, 10 mm short of the ridge.');
  }
  if (b.roof === 'sawtooth') {
    const run = ['front', 'back'].includes(b.rises) ? top.depth : top.width;
    const w = run / b.teeth,
      face = w * Math.tan((b.pitch * Math.PI) / 180);
    if (w < SAWTOOTH.least) throw Error('Each tooth of the sawtooth is only ' + fmtMm(w) + ' mm wide: at least ' + SAWTOOTH.least + ' mm. Choose fewer teeth.');
    if (face < SAWTOOTH.face) throw Error('Each tooth rises only ' + fmtMm(face) + ' mm, too low for its north light: at least ' + SAWTOOTH.face + ' mm. Make the pitch steeper or the teeth fewer.');
  }
  if (b.roof === 'vault') {
    const span = b.ridge === 'depth' ? top.width : top.depth;
    if (b.rise > span / 2) throw Error('The vault rises at most half its span, a half round: ' + fmtMm(span / 2) + ' mm.');
    if (!['plain', 'metal'].includes(b.roofTexture)) throw Error('A barrel vault is plain or corrugated.');
  }
}

// An open storey: no windows or doors of its own, a waist wall low enough to leave a band open.
function checkOpen(s, openings, where, door) {
  if (typeof s.open !== 'boolean') throw Error('Choose whether the storey' + where + ' is open above a waist wall.');
  if (!Number.isFinite(s.lean) || s.lean < 0 || s.lean > LEAN.most) throw Error('The walls' + where + ' lean out 0 to ' + LEAN.most + '°.');
  const [b0, b1] = RELIEF.band,
    [p0, p1] = RELIEF.spacing;
  for (const [key, name] of [['plinth', 'The plinth'], ['cornice', 'The cornice']])
    if (!Number.isFinite(s[key]) || s[key] < b0 || s[key] > b1) throw Error(name + where + ' must be ' + b0 + ' to ' + b1 + ' mm high.');
  if (s.plinth + s.cornice > s.height - 10) throw Error('The plinth and the cornice' + where + ' leave too little wall: together at most ' + fmtMm(s.height - 10) + ' mm.');
  if (!Number.isFinite(s.pilasters) || (s.pilasters !== 0 && (s.pilasters < p0 || s.pilasters > p1))) throw Error('Pilasters' + where + ' stand ' + p0 + ' to ' + p1 + ' mm apart, or 0 for none.');
  if (typeof s.panels !== 'boolean') throw Error('Choose whether the walls' + where + ' have recessed panels.');
  if (!FRAME_WALL.styles.some(([id]) => id === s.wallStyle)) throw Error('Choose solid, braced or lattice walls' + where + '.');
  if (s.wallStyle !== 'solid') {
    if (s.open) throw Error('A storey' + where + ' is open or framed, not both.');
    if (openings.length || door) throw Error('Framed walls' + where + ' have no windows or doors: they are open between their members.');
    if (s.plinth || s.cornice || s.pilasters || s.panels) throw Error('Framed walls' + where + ' have no relief.');
  }
  if (!Number.isInteger(s.panes) || s.panes < 1 || s.panes > OPEN.panes) throw Error('An open storey' + where + ' has 1 to ' + OPEN.panes + ' panes along each wall.');
  if (!s.open) return;
  if (!Number.isFinite(s.waist) || s.waist < 8 || s.waist > s.height - 20) throw Error('The waist wall' + where + ' must be 8 to ' + fmtMm(s.height - 20) + ' mm high.');
  const narrow = Math.min(s.width, s.depth) - 2 * OPEN.post;
  if ((narrow - (s.panes - 1) * OPEN.mullion) / s.panes < 8) throw Error('Too many panes' + where + ': each would be narrower than 8 mm.');
  if (openings.length || door) throw Error('An open storey' + where + ' has no windows or doors: its walls are open above the waist wall.');
}
// The open band of an open storey, as an opening in each wall: corner posts and the beam over it left.
function openBand(s) {
  const n = s.panes ?? 1;
  return WALLS.flatMap((wall) => {
    const L = wallLength(s, wall);
    const band = L - 2 * OPEN.post,
      pane = (band - (n - 1) * OPEN.mullion) / n;
    return Array.from({ length: n }, (_, k) => ({ wall, type: 'window', at: OPEN.post + pane / 2 + k * (pane + OPEN.mullion), width: pane, height: s.height - s.waist - OPEN.beam, sill: s.waist, frame: false, counter: false, flap: false, flapAngle: 0, open: true }));
  });
}
// The hollow inside the base, where the stand's supports reach up: [x0, y0, x1, y1].
function standInside(b) {
  const lo = -KIT.ledge + KIT.shell + b.play;
  return [lo, lo, b.width - lo, b.depth - lo];
}
const LEG_NAMES = ['front left', 'front right', 'back left', 'back right'];
// The middles of the four legs, in the corners of the hollow.
function standLegs(b) {
  const [x0, y0, x1, y1] = standInside(b),
    h = b.standSize / 2;
  return [[x0 + h, y0 + h], [x1 - h, y0 + h], [x0 + h, y1 - h], [x1 - h, y1 - h]];
}
// The four frames of a braced tower, square round the middle; or, braced
// frames all round, just inside the edges of the base: where each starts, along and in.
function towerFrames(b) {
  const all = b.standType === 'frames';
  const [x0, y0, x1, y1] = standInside(b);
  const Tw = all ? x1 - x0 : b.standSize,
    Td = all ? y1 - y0 : b.standSize,
    F = STAND.frame,
    cx = all ? x0 : b.width / 2 - Tw / 2,
    cy = all ? y0 : b.depth / 2 - Td / 2;
  const [key, name] = all ? ['stand', 'Frame'] : ['tower', 'Tower frame'];
  return [
    { id: key + '-front', name: name + ', front', from: [cx, cy], dir: [1, 0, 0], inward: [0, 1, 0], len: Tw },
    { id: key + '-back', name: name + ', back', from: [cx, cy + Td], dir: [1, 0, 0], inward: [0, -1, 0], len: Tw },
    { id: key + '-left', name: name + ', left', from: [cx, cy + F], dir: [0, 1, 0], inward: [1, 0, 0], len: Td - 2 * F },
    { id: key + '-right', name: name + ', right', from: [cx + Tw, cy + F], dir: [0, 1, 0], inward: [-1, 0, 0], len: Td - 2 * F },
  ];
}
/** Where a stand of legs meets the table, as [x0, y0, x1, y1]: each leg's foot. Null for any other stand. */
export function standFeet(b) {
  if (b.standType !== 'legs') return null;
  const r = b.standSize / 2 + STAND.foot[1];
  return standLegs(b).map(([x, y]) => [x - r, y - r, x + r, y + r]);
}
/** The pins on top of the stand, as [x0, y0, x1, y1]: each goes up into a pocket under the base. */
export function standPins(b) {
  const p = STAND.pin[0] / 2;
  if (b.standType === 'legs') {
    const q = Math.min(p, b.standSize / 2 - 1.5);
    return standLegs(b).map(([x, y]) => [x - q, y - q, x + q, y + q]);
  }
  if (b.standType === 'column') {
    const q = Math.min(3, b.standSize / 2 - 2);
    return [[b.width / 2 - q, b.depth / 2 - q, b.width / 2 + q, b.depth / 2 + q]];
  }
  if (b.standType === 'tower' || b.standType === 'frames') {
    const [tl] = STAND.tab,
      F = STAND.frame;
    return towerFrames(b).flatMap((f) =>
      [0.25 * f.len, 0.75 * f.len].map((u) => {
        const a = [f.from[0] + f.dir[0] * (u - tl / 2), f.from[1] + f.dir[1] * (u - tl / 2)],
          c = [f.from[0] + f.dir[0] * (u + tl / 2) + f.inward[0] * F, f.from[1] + f.dir[1] * (u + tl / 2) + f.inward[1] * F];
        return [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])];
      }),
    );
  }
  return [];
}
// The way up the outside: where it reaches, and room for it along its wall.
function checkAccess(b, all) {
  if (!ACCESS.kinds.some(([id]) => id === b.access)) throw Error('Choose a ladder, a staircase or no way up.');
  if (b.access === 'none') return;
  if (!WALLS.includes(b.accessWall)) throw Error('Choose the wall the way up stands against.');
  if (!ACCESS.levels.some(([id]) => id === b.accessTo)) throw Error('Choose where the way up goes.');
  if (b.accessTo === 'base' && b.standType === 'none') throw Error('The base is on the table: a way up to it needs a stand.');
  if (b.accessTo === 'roof' && b.roof !== 'flat') throw Error('A way up onto the roof needs a flat roof.');
  if (['2', '3', '4'].includes(b.accessTo) && Number(b.accessTo) > all.length) throw Error('There is no storey ' + b.accessTo + ' to go up to.');
  // It cannot climb through a balcony on its wall, under the level it goes to.
  const level = b.accessTo === 'roof' ? all.length + 1 : Number(b.accessTo);
  for (let k = 2; k < level; k++) {
    const u = all[k - 1];
    if (u.balcony && (b.accessWall === 'front' || u.balconyAll)) throw Error('The way up would climb through the balcony of storey ' + k + ' on the ' + b.accessWall + ' wall.');
  }
  const { against, rise } = accessPlace(b, all);
  const L = wallLength(against, b.accessWall);
  const from = b.access === 'ladder' ? b.accessAt - ACCESS.ladder.width / 2 : b.accessAt,
    to = b.access === 'ladder' ? b.accessAt + ACCESS.ladder.width / 2 : b.accessAt + stairsOf(rise).run;
  if (b.access === 'stairs' && stairsOf(rise).run > ACCESS.stairs.longest) throw Error('A staircase that high is too long to print in one piece: take a ladder.');
  // A ladder stands along the wall; a staircase may start beyond its end, its landing at the top along it.
  const least = b.access === 'ladder' ? from : to - ACCESS.stairs.landing;
  if (!Number.isFinite(b.accessAt) || least < 0 || to > L)
    throw Error((b.access === 'ladder' ? 'The ladder' : 'The staircase, ' + fmtMm(to - from) + ' mm long,') + ' does not fit along the ' + fmtMm(L) + ' mm ' + b.accessWall + ' wall at ' + fmtMm(b.accessAt) + ' mm.');
}
// Where the way up stands: the storey whose wall it is against, how high it climbs (from the table) and how far out from that wall it stands.
function accessPlace(b, all) {
  const stack = storeyStack({ ...b, openings: all[0].openings, upper: all.slice(1) });
  const H = b.standType === 'none' ? 0 : b.standHeight;
  const w = b.accessWall;
  if (b.accessTo === 'base') return { against: stack[0], rise: H + b.baseHeight, out: 0 };
  if (b.accessTo === 'roof') {
    const top = stack.at(-1);
    const over = { front: b.overhangFront, back: b.overhangBack, left: b.overhangLeft, right: b.overhangRight }[w];
    // Out past a roof railing too: the ladder's top reaches above the roof.
    return { against: top, rise: H + top.eave + KIT.roof, out: over + (b.roofRailing ? KIT.railInset + KIT.railThick + b.play : 0) };
  }
  const k = Number(b.accessTo);
  const s = stack[k - 1];
  const balcony = w === 'front' || all[k - 1].balconyAll ? all[k - 1].balcony ?? 0 : 0;
  return { against: stack[k - 2], rise: H + s.floor, out: balcony };
}
// A staircase up so far: its steps, each one's rise, its length along the wall.
function stairsOf(rise) {
  const S = ACCESS.stairs;
  const steps = Math.max(2, Math.ceil(rise / S.rise));
  return { steps, rise: rise / steps, run: (steps - 1) * S.tread + S.landing };
}

/** The parts of the stand, without geometry. */
function standParts(b) {
  if (b.standType === 'legs') return LEG_NAMES.map((n, i) => ({ id: 'leg-' + (i + 1), name: 'Leg, ' + n, role: 'frame' }));
  if (b.standType === 'column') return [{ id: 'column', name: b.standShape === 'round' ? 'Round column' : 'Column', role: 'frame' }];
  if (b.standType === 'tower') return [...towerFrames(b).map((f) => ({ id: f.id, name: f.name, role: 'frame' })), { id: 'tower-foot', name: 'Tower foot', role: 'buildingBase' }];
  if (b.standType === 'frames') return [...towerFrames(b).map((f) => ({ id: f.id, name: f.name, role: 'frame' })), { id: 'stand-foot', name: 'Foot frame', role: 'buildingBase' }];
  return [];
}

/**
 * The storeys of a building from the ground up: each with its size, where
 * it stands (ox, oy from the ground floor's left and front walls), the
 * height of its floor (the top of the base, or of the slab under it) and
 * of its eaves, its wall texture and openings, and its part ids.
 */
export function storeyStack(b) {
  const several = b.upper.length > 0;
  const out = [];
  let z = b.baseHeight;
  let ox = 0,
    oy = 0;
  const all = [{ width: b.width, depth: b.depth, x: 0, y: 0, height: b.height, lettering: b.lettering, wallTexture: b.wallTexture, wallTextures: b.wallTextures, lowerTexture: b.lowerTexture, lowerHeight: b.lowerHeight, openings: b.openings, open: b.open, waist: b.waist, panes: b.panes, lean: b.lean, plinth: b.plinth, cornice: b.cornice, pilasters: b.pilasters, panels: b.panels, wallStyle: b.wallStyle }, ...b.upper];
  all.forEach((s, i) => {
    const n = i + 1;
    if (i) z += KIT.slab;
    ox += s.x;
    oy += s.y;
    out.push({
      n,
      width: s.width,
      depth: s.depth,
      ox,
      oy,
      floor: z,
      eave: z + s.height,
      height: s.height,
      wallTexture: s.wallTexture,
      wallTextures: s.wallTextures ?? {},
      lowerTexture: s.lowerTexture ?? 'none',
      lowerHeight: s.lowerHeight ?? 20,
      lettering: s.lettering ?? [],
      openings: s.open ? openBand(s) : s.openings,
      open: !!s.open,
      lean: s.lean ?? 0,
      relief: { plinth: s.plinth ?? 0, cornice: s.cornice ?? 0, pilasters: s.pilasters ?? 0, panels: !!s.panels },
      wallStyle: s.wallStyle ?? 'solid',
      garage: i === 0,
      top: i === all.length - 1,
      suffix: n > 1 ? String(n) : '',
      label: several ? STOREY_SUFFIX[n] : '',
    });
    z += s.height;
  });
  return out;
}

// How high a wall reaches under the fascia sign along the top of the front wall.
function signUnder(b) {
  const dip = b.upper.length === 0 && b.roof !== 'flat' ? HATCH.sign * Math.tan((b.pitch * Math.PI) / 180) : 0;
  return Math.floor((b.height - b.signHeight - dip) * 10) / 10;
}
const LETTER_KEYS = ['wall', 'text', 'at', 'up', 'height', 'cut'];
/**
 * A storey's lettering, checked: each clear of the ends of its wall, its
 * foot and its top, the openings and their frames, the garage doors, the
 * sign, the relief bands and the container rails, and of each other.
 */
function checkLettering(list, s, doors, under, where) {
  if (!Array.isArray(list) || list.length > 8) throw Error('A storey' + where + ' has at most 8 lines of lettering.');
  const boxes = [];
  return list.map((item, i) => {
    const name = 'Lettering ' + (i + 1) + where;
    if (!item || typeof item !== 'object' || Object.keys(item).some((k) => !LETTER_KEYS.includes(k))) throw Error(name + ' has an unknown setting.');
    const l = { cut: false, ...item };
    if (!WALLS.includes(l.wall)) throw Error(name + ': choose a wall.');
    l.text = checkText(l.text, name);
    if (!l.text) throw Error(name + ' has no text.');
    if (typeof l.cut !== 'boolean') throw Error(name + ': choose raised or cut letters.');
    const [lo, hi] = LETTERING.height;
    if (!Number.isFinite(l.height) || l.height < lo || l.height > hi) throw Error(name + ': letters ' + lo + ' to ' + hi + ' mm high.');
    if (!Number.isFinite(l.at) || !Number.isFinite(l.up)) throw Error(name + ': give its place on the wall.');
    // Letters stand on a solid wall: not on a braced or lattice frame, nor in the open band of an open storey.
    if ((s.wallStyle ?? 'solid') !== 'solid') throw Error(name + ': lettering needs solid walls, not a braced or lattice frame.');
    const L = wallLength(s, l.wall), w = textWidth(l.text, l.height);
    const u0 = l.at - w / 2, u1 = l.at + w / 2, z0 = l.up - l.height / 2, z1 = l.up + l.height / 2;
    const rail = (s.container ?? 'none') !== 'none';
    const end = rail ? 8 : 4, foot = Math.max(2, s.plinth ?? 0, rail ? 6 : 0), head = Math.min(s.height - 2 - (s.cornice ?? 0) - (rail ? 5 : 0), l.wall === 'front' ? under - 1 : Infinity, s.open ? s.waist - 1 : Infinity);
    if (u0 < end || u1 > L - end) throw Error(name + ' (' + fmtMm(w) + ' mm long) does not fit along the ' + l.wall + ' wall there: keep it ' + end + ' mm from each end.');
    if (z0 < foot || z1 > head) throw Error(name + ' is too low or too high on the wall: its middle between ' + fmtMm(foot + l.height / 2) + ' and ' + fmtMm(head - l.height / 2) + ' mm up.');
    const hits = (a0, c0, a1, c1) => u0 < a1 + 1 && u1 > a0 - 1 && z0 < c1 + 1 && z1 > c0 - 1;
    for (const o of s.openings.filter((q) => q.wall === l.wall)) {
      // Its frame, and beyond it its shutters, its sill ledge and its lintel.
      const k = o.frame ? KIT.trim : 0, side = sideOf(o);
      if (hits(o.at - o.width / 2 - k - side, o.sill - (o.type === 'window' ? k : 0) - underOf(o), o.at + o.width / 2 + k + side, o.sill + o.height + k + overOf(o))) throw Error(name + ' runs over the ' + openingName(o, s.openings).toLowerCase() + '.');
    }
    if (l.wall === 'front') for (const d of doors) if (hits(d.x, 0, d.x + d.width, d.height)) throw Error(name + ' runs over a garage door.');
    // The bay numbers' plaques, on the wall above the doors (under a balcony they hang from its edge instead).
    if (l.wall === 'front' && s.numbers && doors.length && !(s.upper?.[0]?.balcony > 0)) {
      const [pw, ph] = KIT.plaque, room = s.height - doors[0].height;
      for (const d of doors) if (room >= ph + 2 && hits(d.x + d.width / 2 - pw / 2, d.height + (room - ph) / 2, d.x + d.width / 2 + pw / 2, d.height + (room + ph) / 2)) throw Error(name + ' runs over a bay number.');
    }
    for (const q of boxes) if (q.wall === l.wall && hits(...q.box)) throw Error(name + ' runs over lettering ' + (q.i + 1) + '.');
    boxes.push({ wall: l.wall, box: [u0, z0, u1, z1], i });
    return l;
  });
}

/** How the roof stands on the top storey: the slope of each panel, and how high it rises. */
export function roofShape(b) {
  const top = storeyStack(b).at(-1);
  const W = top.width,
    D = top.depth;
  const t = Math.tan((b.pitch * Math.PI) / 180);
  if (b.roof === 'slope') {
    const dir = { back: [0, 1], front: [0, -1], right: [1, 0], left: [-1, 0] }[b.rises];
    const run = dir[1] ? D : W;
    return { t, panels: [{ dir, s0: dir[0] < 0 ? -W : dir[1] < 0 ? -D : 0, t, id: 'roof', name: 'Roof panel' }], rise: run * t };
  }
  if (b.roof === 'gable') {
    const half = (b.ridge === 'depth' ? W : D) / 2;
    const panels =
      b.ridge === 'depth'
        ? [
            { dir: [1, 0], s0: 0, keeps: [[[-1, 0, 0], -W / 2]], id: 'roof-left', name: 'Roof panel, left' },
            { dir: [-1, 0], s0: -W, keeps: [[[1, 0, 0], W / 2]], id: 'roof-right', name: 'Roof panel, right' },
          ]
        : [
            { dir: [0, 1], s0: 0, keeps: [[[0, -1, 0], -D / 2]], id: 'roof-front', name: 'Roof panel, front' },
            { dir: [0, -1], s0: -D, keeps: [[[0, 1, 0], D / 2]], id: 'roof-back', name: 'Roof panel, back' },
          ];
    return { t, panels: panels.map((p) => ({ ...p, t })), rise: half * t };
  }
  if (b.roof === 'hip') {
    // Four panels at one pitch, each kept to its side of the hips (where it
    // meets the panels beside it) and of the ridge: a pyramid on a square.
    const r = Math.SQRT1_2;
    const panels = [
      { dir: [0, 1], s0: 0, keeps: [[[r, -r, 0], 0], [[-r, -r, 0], -W * r], [[0, -1, 0], -D / 2]], id: 'roof-front', name: 'Roof panel, front' },
      { dir: [0, -1], s0: -D, keeps: [[[r, r, 0], D * r], [[-r, r, 0], (D - W) * r], [[0, 1, 0], D / 2]], id: 'roof-back', name: 'Roof panel, back' },
      { dir: [1, 0], s0: 0, keeps: [[[-r, r, 0], 0], [[-r, -r, 0], -D * r], [[-1, 0, 0], -W / 2]], id: 'roof-left', name: 'Roof panel, left' },
      { dir: [-1, 0], s0: -W, keeps: [[[r, r, 0], W * r], [[r, -r, 0], (W - D) * r], [[1, 0, 0], W / 2]], id: 'roof-right', name: 'Roof panel, right' },
    ];
    return { t, panels: panels.map((p) => ({ ...p, t })), rise: (Math.min(W, D) / 2) * t };
  }
  if (b.roof === 'gambrel' || b.roof === 'mansard') {
    // On each side two panels: a steep one from the eaves up to the break,
    // breakAt in from the outside of the wall, then a shallower one; on two
    // sides about a ridge (a gambrel), or on all four (a mansard).
    const tL = Math.tan((b.lowerPitch * Math.PI) / 180),
      k = b.breakAt;
    const sides = b.roof === 'mansard' ? ['front', 'back', 'left', 'right'] : b.ridge === 'depth' ? ['left', 'right'] : ['front', 'back'];
    const DIRS = { left: [1, 0], right: [-1, 0], front: [0, 1], back: [0, -1] },
      S0 = { left: 0, right: -W, front: 0, back: -D };
    // The upper panel's plane meets the lower one's at the break.
    const sigma = k - (tL * k) / t;
    const panels = sides.flatMap((side) => [
      // Apart in the exploded view: the lower panel out, the upper one up.
      { dir: DIRS[side], s0: S0[side], t: tL, id: 'roof-' + side + '-lower', name: 'Roof panel, ' + side + ', lower', apart: [-DIRS[side][0] * APART.ridge, -DIRS[side][1] * APART.ridge, 0] },
      { dir: DIRS[side], s0: S0[side] + sigma, t, id: 'roof-' + side + '-upper', name: 'Roof panel, ' + side + ', upper', apart: [-DIRS[side][0] * APART.ridge / 2, -DIRS[side][1] * APART.ridge / 2, APART.ridge] },
    ]);
    const half = (b.roof === 'mansard' ? Math.min(W, D) : b.ridge === 'depth' ? W : D) / 2;
    return { t, panels, rise: tL * k + t * (half - k), mitred: true };
  }
  if (b.roof === 'sawtooth') {
    // Single slopes side by side along `dir`, each over a strip w wide; d
    // runs from the low wall, a tooth's plane z = eave + t (d - k w).
    const dir = { back: [0, 1], front: [0, -1], right: [1, 0], left: [-1, 0] }[b.rises];
    const s0 = dir[0] < 0 ? -W : dir[1] < 0 ? -D : 0;
    const run = dir[1] ? D : W,
      n = b.teeth,
      w = run / n;
    const panels = Array.from({ length: n }, (_, k) => ({
      dir,
      t,
      s0: s0 + k * w,
      keeps: [...(k ? [[[dir[0], dir[1], 0], s0 + k * w]] : []), ...(k < n - 1 ? [[[-dir[0], -dir[1], 0], -(s0 + (k + 1) * w)]] : [])],
      id: 'roof-' + (k + 1),
      name: 'Roof panel ' + (k + 1),
      apart: [dir[0] * k * APART.ridge, dir[1] * k * APART.ridge, 0],
    }));
    return { t, panels, rise: w * t, saw: { dir, s0, run, n, w } };
  }
  if (b.roof === 'vault') {
    // A circular arc across the span, through the tops of the outsides of
    // the side walls at the eaves, b.rise higher at the crown.
    const along = b.ridge === 'depth';
    const span = along ? W : D,
      c = span / 2,
      h = b.rise,
      R = (c * c + h * h) / (2 * h);
    return { t: 0, panels: [], rise: h, vault: { along, span, c, R, below: R - h } };
  }
  return { t: 0, panels: [], rise: 0 };
}

/**
 * How far the underside of the roof is above the eaves over a point of the
 * top storey (x from its left wall, y from its front wall): the lowest of the
 * panels, under a sawtooth the tooth over it, under a vault its arch.
 */
export function roofAt(shape, x, y) {
  if (shape.saw) {
    const { dir, s0, n, w } = shape.saw;
    const d = dir[0] * x + dir[1] * y - s0;
    const k = Math.min(n - 1, Math.max(0, Math.floor(d / w)));
    return shape.t * (d - k * w);
  }
  if (shape.vault) {
    const { along, c, R, below } = shape.vault;
    const u = (along ? x : y) - c;
    return Math.abs(u) >= R ? 0 : Math.max(0, Math.sqrt(R * R - u * u) - below);
  }
  if (!shape.panels.length) return 0;
  return Math.min(...shape.panels.map((p) => p.t * (p.dir[0] * x + p.dir[1] * y - p.s0)));
}

/**
 * The inside corners of a storey that take a corner brace: an L that stands
 * on the floor against both walls, up to just under the lip of the roof or
 * the floor above, at most braceHeight. Not where the track runs through a garage, nor where a
 * roller door stands behind its opening. x, y: where each leg reaches.
 */
export function braceCorners(b, s, doors) {
  if (!b.braces || s.open || s.lean || (s.wallStyle && s.wallStyle !== 'solid') || s.height - KIT.lipDepth - 1 < 10) return [];
  const lo = KIT.wall + b.play,
    leg = KIT.braceLeg,
    W = s.width,
    D = s.depth;
  const corners = [
    { key: 'fl', name: 'front left', x: [lo, lo + leg], y: [lo, lo + leg], sx: 1, sy: 1 },
    { key: 'fr', name: 'front right', x: [W - lo - leg, W - lo], y: [lo, lo + leg], sx: -1, sy: 1 },
    { key: 'bl', name: 'back left', x: [lo, lo + leg], y: [D - lo - leg, D - lo], sx: 1, sy: -1 },
    { key: 'br', name: 'back right', x: [W - lo - leg, W - lo], y: [D - lo - leg, D - lo], sx: -1, sy: -1 },
  ];
  return corners.filter((q) => {
    if (s.garage && b.lane) {
      const half = b.lane.width / 2 + KIT.lanePlay;
      if (q.x[1] > W / 2 - half && q.x[0] < W / 2 + half) return false;
    }
    if (s.garage && (b.door === 'roller' || b.door === 'panel') && q.sy > 0 && doors.some((door) => q.x[1] > door.x - KIT.margin && q.x[0] < door.x + door.width + KIT.margin)) return false;
    return true;
  });
}

/**
 * Where the tabs of a frame stand: two on each side, a quarter of the way
 * in from each end, or nearby where something is in the way. p: the middle
 * of the tab on the plan; d: along the wall; out: how to measure in from the
 * wall's outside face; side: which wall.
 */
export function tabSpots(W, D, avoid = () => false, play = KIT.play) {
  const centre = KIT.wall + play + KIT.tabIn + KIT.tabThick / 2;
  const sides = [
    { side: 'front', len: W, d: [1, 0], at: (u, v) => [u, v] },
    { side: 'back', len: W, d: [1, 0], at: (u, v) => [u, D - v] },
    { side: 'left', len: D, d: [0, 1], at: (u, v) => [v, u] },
    { side: 'right', len: D, d: [0, 1], at: (u, v) => [W - v, u] },
  ];
  const out = [];
  for (const sd of sides)
    for (const pair of [[0.25, 0.75], [0.2, 0.8], [0.32, 0.68], [0.15, 0.85], [0.4, 0.6]]) {
      const spots = pair.map((f) => ({ side: sd.side, d: sd.d, at: sd.at, u: sd.len * f, p: sd.at(sd.len * f, centre) }));
      if (spots.every((q) => !avoid(q))) {
        out.push(...spots);
        break;
      }
    }
  return out;
}
const frameIds = (b, storeys) => {
  const out = [];
  if (b.roofLip === 'none' || ['sawtooth', 'vault', 'gambrel', 'mansard'].includes(b.roof)) return out;
  if (b.roof === 'flat') out.push({ id: 'roof-frame', name: 'Roof frame', role: 'lip' });
  else for (const p of roofShape(b).panels) out.push({ id: p.id + '-frame', name: p.name.replace('Roof panel', 'Roof frame'), role: 'lip' });
  return out;
};
/**
 * The railings of a building, as runs along the open edges of a deck: a
 * balcony or terrace on the floor under a storey, and round a flat roof.
 * Each is { id, name, from: [x, y] in its storey's frame, d: along, out:
 * outward, length, z: the deck's top, storey }. Railings stand RAIL inset
 * from the edge; side runs start behind the front one.
 */
export function railingRuns(b, storeys) {
  const runs = [];
  const inset = KIT.railInset,
    back = inset + KIT.railThick + b.play;
  storeys.forEach((s, i) => {
    const above = storeys[i + 1];
    if (above && b.upper[above.n - 2].railing) {
      const u = b.upper[above.n - 2];
      const bal = u.balcony,
        W = s.width,
        D = s.depth,
        z = s.eave + KIT.slab;
      const label = ', storey ' + above.n;
      // A balcony all round: a railing along each edge of the floor, the sides between the front and the back.
      if (u.balconyAll) {
        const x0 = -bal,
          x1 = W + bal,
          y0 = -bal,
          y1 = D + bal;
        runs.push({ id: 'railing' + above.n + '-front', name: 'Railing' + label + ', front', from: [x0, y0], d: [1, 0], out: [0, -1], length: x1 - x0, z, storey: s });
        runs.push({ id: 'railing' + above.n + '-back', name: 'Railing' + label + ', back', from: [x0, y1], d: [1, 0], out: [0, 1], length: x1 - x0, z, storey: s });
        runs.push({ id: 'railing' + above.n + '-left', name: 'Railing' + label + ', left', from: [x0, y0 + back], d: [0, 1], out: [-1, 0], length: y1 - y0 - 2 * back, z, storey: s });
        runs.push({ id: 'railing' + above.n + '-right', name: 'Railing' + label + ', right', from: [x1, y0 + back], d: [0, 1], out: [1, 0], length: y1 - y0 - 2 * back, z, storey: s });
        return;
      }
      const ax = above.ox - s.ox,
        ay = above.oy - s.oy;
      // Along the front of the floor, and back along each side to the storey above, or all the way where it stands in from that side.
      runs.push({ id: 'railing' + above.n + '-front', name: 'Railing' + label + ', front', from: [0, -bal], d: [1, 0], out: [0, -1], length: W, z, storey: s });
      const sideTo = (inFrom) => (inFrom > 3 ? D : ay);
      const left = sideTo(ax),
        right = sideTo(W - ax - above.width);
      if (left + bal - back > 20) runs.push({ id: 'railing' + above.n + '-left', name: 'Railing' + label + ', left', from: [0, -bal + back], d: [0, 1], out: [-1, 0], length: left + bal - back, z, storey: s });
      if (right + bal - back > 20) runs.push({ id: 'railing' + above.n + '-right', name: 'Railing' + label + ', right', from: [W, -bal + back], d: [0, 1], out: [1, 0], length: right + bal - back, z, storey: s });
    }
    if (!above && b.roofRailing && b.roof === 'flat') {
      const W = s.width,
        D = s.depth,
        z = s.eave + KIT.roof;
      const x0 = -b.overhangLeft,
        x1 = W + b.overhangRight,
        y0 = -b.overhangFront,
        y1 = D + b.overhangBack;
      runs.push({ id: 'roofrail-front', name: 'Roof railing, front', from: [x0, y0], d: [1, 0], out: [0, -1], length: x1 - x0, z, storey: s });
      runs.push({ id: 'roofrail-back', name: 'Roof railing, back', from: [x0, y1], d: [1, 0], out: [0, 1], length: x1 - x0, z, storey: s });
      runs.push({ id: 'roofrail-left', name: 'Roof railing, left', from: [x0, y0 + back], d: [0, 1], out: [-1, 0], length: y1 - y0 - 2 * back, z, storey: s });
      runs.push({ id: 'roofrail-right', name: 'Roof railing, right', from: [x1, y0 + back], d: [0, 1], out: [1, 0], length: y1 - y0 - 2 * back, z, storey: s });
    }
  });
  return runs;
}
/** A run of railing in pieces no longer than the plate allows, each with its two tabs. */
export function railingPieces(run, plate) {
  const room = plate ? Math.max(plate.width, plate.depth) - 2 * (plate.margin ?? 0) - 4 : Infinity;
  const n = Math.max(1, Math.ceil(run.length / room - 1e-9));
  return Array.from({ length: n }, (_, k) => ({
    ...run,
    id: n > 1 ? run.id + '-' + (k + 1) : run.id,
    name: n > 1 ? run.name + ' ' + (k + 1) + ' of ' + n : run.name,
    a: (run.length * k) / n + (k ? 0.1 : 0),
    b: (run.length * (k + 1)) / n - (k < n - 1 ? 0.1 : 0),
  }));
}
// Seven segments, as a racing number: which of a b c d e f g each digit lights.
const SEGMENTS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
/**
 * The bay number plaques: one over each garage door. Under a balcony they
 * hang from its front edge, as pit boards do, where they are seen from
 * above; without one, on the wall above the door, where there is room.
 */
export function plaquePlaces(b, doors, s) {
  if (!b.numbers || !s.garage) return [];
  const [pw, ph, pt] = KIT.plaque;
  const balcony = b.upper[0]?.balcony ?? 0;
  const room = s.height - (doors[0]?.height ?? s.height);
  if (!balcony && room < ph + 2) return [];
  return doors.map((d, i) => ({
    id: 'number-' + (i + 1),
    name: 'Bay number ' + (b.firstNumber + i),
    number: b.firstNumber + i,
    x: d.x + d.width / 2 - pw / 2,
    z: balcony ? s.eave + KIT.slab - ph : s.floor + d.height + (room - ph) / 2,
    y: balcony ? -balcony - pt : -pt,
  }));
}
const doorPart = (d, doors, b) => {
  const kind = b?.door === 'panel' ? 'Up-and-over door' : 'Roller door';
  return doors.length > 1 ? { id: 'door' + d.room, name: kind + ', room ' + d.room, role: 'door' } : { id: 'door', name: kind, role: 'door' };
};
const dividerParts = (b) =>
  dividers(b).map((_, i, all) => ({ id: 'divide' + (i + 1), name: 'Dividing wall' + (all.length > 1 ? ' ' + (i + 1) : ''), role: 'divider' }));
/** How high the ceiling is over a point of a storey: the floor above or the roof, under a sloped roof its underside. */
function ceilingAt(b, s, shape, x, y) {
  if (!s.top || b.roof === 'flat') return s.eave;
  return s.eave + roofAt(shape, x, y);
}

/** The parts of the kit, without geometry: their ids, names and roles. */
export function buildingLayout(input) {
  if (input?.kind === 'sections') return connectedLayout(input);
  if (input?.kind === 'footprint') return footprintLayout(input);
  if (input?.kind === 'grandstand') return { ...grandstandLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'gantry') return { ...gantryLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'pitmodule') return { ...pitModuleLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'marshalpost') return { ...marshalPostLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'flagpost') return { ...flagPostLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'billboard') return { ...billboardLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'canopy') return { ...canopyLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'stage') return { ...stageLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'switchback') return { ...switchbackLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'bench') return { ...benchLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'tyrebridge') return { ...tyreBridgeLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'picnic') return { ...picnicLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'platform') return { ...platformLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'walkway') return { ...walkwayLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'pitbays') return { ...pitBaysLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'props') return { ...propsLayout(input), storeys: [], doors: [] };
  if (input?.kind === 'fittest') return { ...fitTestLayout(input), storeys: [], doors: [] };
  const b = validateBuilding(input);
  const storeys = storeyStack(b);
  const parts = [{ id: 'base', name: 'Base plate', role: 'buildingBase' }, ...standParts(b)];
  if (b.access !== 'none') parts.push({ id: 'access', name: b.access === 'ladder' ? 'Ladder' : 'Staircase', role: 'frame' });
  const doors = garageDoors(b);
  for (const s of storeys) {
    if (s.n > 1) parts.push({ id: 'floor' + s.n, name: 'Floor of storey ' + s.n, role: 'floor' }, { id: 'floor' + s.n + '-frame', name: 'Floor frame, storey ' + s.n, role: 'lip' });
    for (const w of ['front', 'back', 'left', 'right']) parts.push({ id: w + s.suffix, name: WALL_NAMES[w] + ' wall' + s.label, role: 'wall' });
    if (s.garage) parts.push(...dividerParts(b));
  }
  if (b.roof === 'flat') parts.push({ id: 'roof', name: 'Flat roof', role: 'roof' });
  else if (b.roof === 'vault') parts.push({ id: 'roof', name: 'Barrel vault', role: 'roof' });
  else for (const p of roofShape(b).panels) parts.push({ id: p.id, name: p.name, role: 'roof' });
  for (let k = 1; b.roof === 'sawtooth' && k < b.teeth; k++) parts.push({ id: 'light-' + k, name: 'North light ' + k, role: 'wall' });
  if (b.chimney) parts.push({ id: 'chimney', name: 'Chimney', role: 'frame' });
  if (b.gableFront === 'stepped') parts.push({ id: 'gable-front', name: 'Stepped gable', role: 'wall' });
  b.partitions.forEach((_, i) => parts.push({ id: 'partition-' + (i + 1), name: 'Partition ' + (i + 1), role: 'divider' }));
  b.stairs.forEach((_, i) => parts.push({ id: 'stairs-' + (i + 1), name: 'Stairs ' + (i + 1), role: 'floor' }));
  b.dormers.forEach((_, i) => parts.push({ id: 'dormer-' + (i + 1), name: 'Dormer ' + (i + 1), role: 'wall' }));
  parts.push(...propPartIds(b.props));
  if (b.gutters)
    for (const p of roofShape(b).panels) {
      const side = eaveOf(p);
      parts.push({ id: 'gutter-' + side, name: 'Gutter, ' + side, role: 'frame' });
      if (b.downpipes !== 'none') parts.push({ id: 'downpipe-' + side, name: 'Downpipe, ' + side, role: 'frame' });
    }
  parts.push(...frameIds(b, storeys));
  if (b.door === 'roller' || b.door === 'panel') parts.push(...doors.map((d) => doorPart(d, doors, b)));
  for (const run of railingRuns(b, storeys)) parts.push({ id: run.id, name: run.name, role: 'frame' });
  for (const q of plaquePlaces(b, doors, storeys[0])) parts.push({ id: q.id, name: q.name, role: 'frame' });
  for (const s of storeys)
    for (const q of braceCorners(b, s, doors)) parts.push({ id: 'brace' + s.suffix + '-' + q.key, name: 'Corner brace, ' + q.name + s.label, role: 'brace' });
  for (const s of storeys)
    s.openings.forEach((o, i) => {
      if (o.frame) parts.push({ id: 'frame' + s.suffix + '-' + (i + 1), name: openingName(o, s.openings) + ' frame' + s.label, role: 'frame' });
      if (o.swing) parts.push({ id: 'leaf' + s.suffix + '-' + (i + 1), name: openingName(o, s.openings) + ' leaf' + s.label, role: 'door' });
    });
  for (const s of storeys)
    s.openings.forEach((o, i) => {
      if (o.counter) parts.push({ id: 'counter' + s.suffix + '-' + (i + 1), name: openingName(o, s.openings) + ' counter' + s.label, role: 'frame' });
      if (o.flap) parts.push({ id: 'flap' + s.suffix + '-' + (i + 1), name: openingName(o, s.openings) + ' flap' + s.label, role: 'door' });
      if (o.step) parts.push({ id: 'step-' + (i + 1), name: openingName(o, s.openings) + ' step', role: 'buildingBase' });
    });
  if (b.sign !== 'none') parts.push({ id: 'sign', name: b.sign === 'billboard' ? 'Billboard' : 'Sign', role: 'wall' });
  if (b.sign === 'billboard') parts.push({ id: 'sign-fin-1', name: 'Billboard fin 1', role: 'frame' }, { id: 'sign-fin-2', name: 'Billboard fin 2', role: 'frame' });
  // What is left out: the roof, or a wall and its corner braces.
  for (let i = parts.length - 1; i >= 0; i--) if (!keptPart(b, parts[i].id)) parts.splice(i, 1);
  return { building: b, storeys, parts, doors };
}

/** Whether a part of this print size fits the plate, turned if need be. */
export function fitsPlate([x, y], plate) {
  const w = plate.width - 2 * (plate.margin ?? 0),
    d = plate.depth - 2 * (plate.margin ?? 0);
  return (x <= w && y <= d) || (x <= d && y <= w);
}

// The openings of a storey along each wall, as [from, to], frames included;
// and across the height of the wall, measured from its foot in the groove.
function wallOpenings(s, doors) {
  const along = { front: [], back: [], left: [], right: [] },
    up = { front: [], back: [], left: [], right: [] };
  if (s.garage)
    for (const door of doors) {
      along.front.push([door.x, door.x + door.width]);
      up.front.push([KIT.groove, KIT.groove + door.height]);
    }
  for (const o of s.openings) {
    const extra = o.frame ? KIT.trim : 0;
    along[o.wall].push([o.at - o.width / 2 - extra - sideOf(o), o.at + o.width / 2 + extra + sideOf(o)]);
    up[o.wall].push([KIT.groove + o.sill - (o.type === 'window' ? extra : 0) - underOf(o), KIT.groove + o.sill + o.height + extra + overOf(o)]);
  }
  return { along, up };
}

/**
 * Where a building is cut to fit a plate: for each part that is too long,
 * its cuts and the range each may move in. Without a plate, nothing is cut.
 */
export function buildingCuts(input, plate) {
  if (input?.kind === 'sections') return {};
  if (input?.kind === 'footprint') return {};
  // A grandstand comes in sections already, each no longer than set; a pit building in bays; a marshal post is small.
  if (['grandstand', 'gantry', 'pitmodule', 'marshalpost', 'flagpost', 'billboard', 'switchback', 'bench', 'tyrebridge', 'picnic', 'platform', 'walkway', 'pitbays', 'props', 'fittest', 'canopy', 'stage'].includes(input?.kind)) return {};
  const { building: b, storeys, doors } = buildingLayout(input);
  const shape = roofShape(b);
  const rise = shape.rise;
  const walls = [];
  // A dividing wall: as long as the building is across it, as tall as the ceiling over it.
  const ground = storeys[0];
  dividers(b).forEach((at, i) => {
    const across = b.rooms.along === 'width',
      L = across ? b.depth : b.width;
    let high = 0;
    for (let k = 0; k <= 40; k++) {
      const u = (k / 40) * L;
      high = Math.max(high, ceilingAt(b, ground, shape, across ? at : u, across ? u : at) - ground.floor);
    }
    walls.push({ key: 'divide' + (i + 1), length: L, height: high + KIT.groove, keepOut: [], keepOutUp: [[-1, KIT.groove + JOINT.edge]] });
  });
  for (const s of storeys) {
    const { along, up } = wallOpenings(s, doors);
    for (const w of ['front', 'back', 'left', 'right']) {
      // A brick or block wall is cut along its joints: the seam steps half a brick either way.
      const tex = textureOf(s, w);
      const step = ['brick', 'block'].includes(tex) ? (DRAWN[tex].length * b.textureScale) / 200 : 0;
      const aside = JOINT.aside + step;
      // Across the height a brick seam moves onto the nearest course line: up to half a course.
      const asideUp = JOINT.aside + (step ? (DRAWN[tex].course * b.textureScale) / 200 : 0);
      // A wall prints as tall as it stands, its foot in the groove included.
      // Under a sloped roof, up to where it is highest along the outside of the wall.
      let high = s.height;
      if (s.top && b.roof !== 'flat') {
        const L = w === 'front' || w === 'back' ? s.width : s.depth;
        let most = 0;
        for (let k = 0; k <= 80; k++) {
          const u = (k / 80) * L;
          const [x, y] = { front: [u, 0], back: [u, s.depth], left: [0, u], right: [s.width, u] }[w];
          most = Math.max(most, roofAt(shape, x, y));
        }
        // A sawtooth peaks just short of where the next tooth starts.
        high += b.roof === 'sawtooth' && most > 0 ? rise : Math.min(most, rise);
      }
      walls.push({
        key: w + s.suffix,
        length: wallLength(s, w),
        padding: b.container === 'none' ? 0 : 4, // corner posts extend 2 mm beyond each end
        height: high + KIT.groove,
        // A cut may run through an opening, not along its side; across the
        // height, not along its top or bottom, nor through the foot of the wall.
        keepOut: along[w].flatMap(([a, c]) => [[a - aside, a + aside], [c - aside, c + aside]]),
        keepOutUp: [[-1, KIT.groove + JOINT.edge], ...up[w].flatMap(([a, c]) => [[a - asideUp, a + asideUp], [c - asideUp, c + asideUp]])],
      });
    }
  }
  const top = storeys.at(-1);
  const ov = [b.overhangLeft + b.overhangRight, b.overhangFront + b.overhangBack];
  const slope = Math.hypot(1, shape.t);
  // A two-sided roof is cut along its ridge only; a slope prints longer than its plan.
  const roofExtent = [top.width + ov[0], top.depth + ov[1]];
  let scale = [1, 1];
  if (b.roof === 'slope') scale = b.rises === 'left' || b.rises === 'right' ? [slope, 1] : [1, slope];
  if (b.roof === 'gable' || b.roof === 'gambrel') roofExtent[b.ridge === 'depth' ? 0 : 1] = 0;
  // A hip roof's panels are not cut: the building is checked to be small enough.
  // A vault is cut across its axis by itself, each piece standing on its end.
  if (b.roof === 'hip' || b.roof === 'mansard' || b.roof === 'vault') roofExtent.fill(0);
  // A sawtooth's panels and north lights are cut along their length only.
  if (b.roof === 'sawtooth') roofExtent[['front', 'back'].includes(b.rises) ? 1 : 0] = 0;
  return planCuts(b, plate, {
    walls,
    flats: [
      { name: 'base', extent: [b.width + 2 * KIT.ledge, b.depth + 2 * KIT.ledge], scale: [1, 1] },
      // A floor covers the storey below it.
      ...storeys.slice(1).map((s, i) => {
        const u = b.upper[i],
          side = u.balconyAll ? u.balcony : 0,
          { f } = leanGrow(storeys[i]);
        return { name: 'floor' + s.n, extent: [storeys[i].width * (1 + f) + 2 * side, storeys[i].depth * (1 + f) + u.balcony + side], scale: [1, 1] };
      }),
      { name: 'roof', extent: roofExtent, scale },
    ],
  });
}

export function buildGarage(wasm, input, plate = null) {
  if (input?.kind === 'sections') return buildConnected(wasm, input, plate);
  if (input?.kind === 'footprint') return buildFootprint(wasm, input, plate);
  if (input?.kind === 'grandstand') return buildGrandstand(wasm, input);
  if (input?.kind === 'gantry') return buildGantry(wasm, input, plate);
  if (input?.kind === 'pitmodule') return buildPitModule(wasm, input);
  if (input?.kind === 'marshalpost') return buildMarshalPost(wasm, input);
  if (input?.kind === 'flagpost') return buildFlagPost(wasm, input);
  if (input?.kind === 'billboard') return buildBillboard(wasm, input);
  if (input?.kind === 'canopy') return buildCanopy(wasm, input);
  if (input?.kind === 'stage') return buildStage(wasm, input);
  if (input?.kind === 'switchback') return buildSwitchback(wasm, input);
  if (input?.kind === 'bench') return buildBench(wasm, input);
  if (input?.kind === 'tyrebridge') return buildTyreBridge(wasm, input);
  if (input?.kind === 'picnic') return buildPicnic(wasm, input);
  if (input?.kind === 'platform') return buildPlatform(wasm, input);
  if (input?.kind === 'walkway') return buildWalkway(wasm, input);
  if (input?.kind === 'pitbays') return buildPitBays(wasm, input);
  if (input?.kind === 'props') return buildPropsKit(wasm, input, plate);
  if (input?.kind === 'fittest') return buildFitTest(wasm, input);
  const { Manifold, CrossSection } = wasm;
  const { building: b, storeys, doors } = buildingLayout(input);
  const { wall: t, groove: g, ledge: m, shell, deck, roof: rt } = KIT;
  const c = b.play;
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const box = (x0, y0, z0, x1, y1, z1) =>
    own(Manifold.cube([Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)]).translate([Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)]));
  const minus = (a, ...cuts) => (cuts.length ? own(a.subtract(own(Manifold.union(cuts)))) : a);
  const trim = (s, n, offset) => own(s.trimByPlane(n, offset));
  const { sweep } = kitShapes(wasm, own);
  // A part after its texture is cut: where a grain line meets a joint or a
  // step it can leave a speck of nothing loose. Only the part itself is kept.
  const whole = (solid) => {
    const bodies = solid.decompose();
    if (bodies.length === 1) {
      bodies[0].delete();
      return solid;
    }
    const kept = bodies.filter((body) => body.volume() > 1);
    for (const body of bodies) if (!kept.includes(body)) body.delete();
    kept.forEach(own);
    return kept.length === 1 ? kept[0] : own(Manifold.union(kept));
  };
  const shape = roofShape(b);
  // A vault's arch as a solid: a cylinder of radius r about its axis, the top storey W wide, its eaves at z1.
  const vaultDrum = ({ along, c: half, below }, W, z1, r) => {
    const drum = own(Manifold.cylinder(4000, r, r, 256));
    return along ? own(own(drum.rotate([-90, 0, 0])).translate([half, -2000, z1 - below])) : own(own(drum.rotate([0, 90, 0])).translate([-2000, half, z1 - below]));
  };
  /**
   * Where a panel is kept against the others. Between two panels of a
   * gambrel or a mansard the joint is mitred: the plane through the line
   * where their undersides meet and the line where their tops meet, so a
   * steep panel and a shallow one each end square enough to print. Others
   * keep the half-planes of their roof.
   */
  function keepsOf(p, z1) {
    if (!shape.mitred) return p.keeps ?? [];
    const plane = (q) => [q.t * q.dir[0], q.t * q.dir[1], z1 - q.t * q.s0];
    const thick = (q) => rt * Math.hypot(q.t, 1);
    const [ap, bp, cp] = plane(p),
      hp = thick(p);
    const out = [];
    for (const q of shape.panels) {
      if (q === p) continue;
      const [aq, bq, cq] = plane(q),
        hq = thick(q);
      // hq (z - plane p) - hp (z - plane q) >= 0 on p's side.
      const n = [-hq * ap + hp * aq, -hq * bp + hp * bq, hq - hp],
        len = Math.hypot(...n);
      if (len < 1e-9) continue;
      out.push([n.map((v) => v / len), (hq * cp - hp * cq) / len]);
    }
    return out;
  }
  // The part of a solid between d0 and d1 along a sawtooth's slopes (null: no end).
  const sawStrip = (solid, { dir: [dx, dy], s0 }, d0, d1) => {
    let q = solid;
    if (d0 !== null) q = trim(q, [dx, dy, 0], s0 + d0);
    if (d1 !== null) q = trim(q, [-dx, -dy, 0], -(s0 + d1));
    return q;
  };
  /**
   * A sawtooth's north lights: between one tooth and the next a glazed wall
   * as long as the building is across, standing on the walls at its ends,
   * its foot a roof's thickness under the eaves, the next tooth's low edge
   * against it and the high edge of its own tooth on top. A row of panes
   * through it above the next tooth. It prints flat, its glazed face up.
   */
  function northLights(W, D, z1, apart) {
    const { dir: [dx, dy], s0, n, w } = shape.saw,
      T = shape.t,
      len = Math.hypot(T, 1);
    const along = dx !== 0; // the slopes run along x, the lights across y
    const L = along ? D : W;
    const at = (d) => (dx || dy) * (d + s0);
    const out = [];
    for (let k = 1; k < n; k++) {
      const [p0, p1] = [at(k * w - t), at(k * w)].sort((a, e) => a - e);
      let light = along ? box(p0, 0, z1 - rt, p1, L, z1 + shape.rise + 1) : box(0, p0, z1 - rt, L, p1, z1 + shape.rise + 1);
      // Under the tooth before it.
      light = trim(light, [T * dx, T * dy, -1], -(z1 - T * (s0 + (k - 1) * w)) / len);
      // The panes: over the next tooth's edge, under the sloping top, clear of the walls at its ends.
      const { pane, bar, edge } = SAWTOOTH;
      const v0 = z1 + rt * len + edge,
        v1 = z1 + shape.rise - t * T - edge,
        u0 = t + c + edge,
        u1 = L - t - c - edge;
      const m = Math.max(1, Math.floor((u1 - u0 + bar) / (pane + bar))),
        pw = (u1 - u0 - (m - 1) * bar) / m;
      const holes = [];
      for (let i = 0; i < m; i++) {
        const a = u0 + i * (pw + bar);
        holes.push(along ? box(p0 - 1, a, v0, p1 + 1, a + pw, v1) : box(a, p0 - 1, v0, a + pw, p1 + 1, v1));
      }
      light = minus(light, ...holes);
      out.push({ id: 'light-' + k, name: 'North light ' + k, role: 'wall', solid: light, outward: [dx, dy, 0], apart: add3(apart, [dx * k * APART.ridge, dy * k * APART.ridge, -APART.roof / 2]) });
    }
    return out;
  }
  /**
   * A barrel vault: the arch as thick as a roof, its eaves past the side
   * walls, flat where it bears on their tops; the end walls rise into it. It
   * prints standing on its end, every face upright; cut across its axis where
   * it is longer than the plate is wide, the pieces glued end to end. A
   * corrugated vault has grooves round it.
   */
  function barrelVault(W, D, z1, ov, apart) {
    const { CrossSection } = wasm;
    const { along, span, c: half, R, below } = shape.vault;
    const zc = z1 - below;
    const [a0, a1] = along ? [-ov.left, W + ov.right] : [-ov.front, D + ov.back];
    const [l0, l1] = along ? [-ov.front, D + ov.back] : [-ov.left, W + ov.right];
    const circle = (r) => own(CrossSection.circle(r, 256).translate([half, zc]));
    const rect = (u0, v0, u1, v1) => own(new CrossSection([[[u0, v0], [u1, v0], [u1, v1], [u0, v1]]], 'Positive'));
    const top = z1 + shape.rise + rt + 1;
    let profile = own(own(circle(R + rt).subtract(circle(R))).intersect(rect(a0, Math.max(zc, z1 - 40), a1, top)));
    // Below the eaves the arch is only past the walls: its many-sided circle,
    // a hair inside the true one, would otherwise cut into the tops of the walls it bears on.
    profile = own(profile.subtract(rect(0, z1 - 41, span, z1)));
    const bear = own(own(rect(0, z1, t + c, top).add(rect(span - t - c, z1, span, top))).intersect(circle(R + 0.01)));
    profile = own(profile.add(bear));
    const length = l1 - l0;
    let solid = own(profile.extrude(length));
    if (b.roofTexture === 'metal') {
      const k = b.textureScale / 100,
        pitch = DRAWN.metal.pitch * k,
        depth = Math.min(b.textureDepth, rt - 1.2);
      // Each groove a V round the arch, its sides steeper than 45° as the vault stands to print.
      const r0 = R + rt - depth,
        r1 = R + rt + 1,
        reach = 1.25 * (r1 - r0);
      const vee = own(new CrossSection([[[r1, -reach], [r1, reach], [r0, 0]]], 'Positive'));
      const ring = own(Manifold.revolve(vee, 256));
      const grooves = [];
      for (let e = pitch / 2; e < length - pitch / 4; e += pitch) grooves.push(own(ring.translate([half, zc, e])));
      const cut = grooves.filter((q) => !q.isEmpty());
      if (cut.length) solid = whole(own(solid.subtract(own(Manifold.union(cut)))));
    }
    // Across the axis into pieces no longer than the plate is wide.
    const room = plate ? plateRoom(plate).short : Infinity;
    const pieces = Math.max(1, Math.ceil(length / room - 1e-9));
    const parts = [];
    for (let i = 0; i < pieces; i++) {
      let piece = solid;
      if (i) piece = trim(piece, [0, 0, 1], (i * length) / pieces);
      if (i < pieces - 1) piece = trim(piece, [0, 0, -1], -((i + 1) * length) / pieces);
      // Into place: across the span u, up v, along the axis e.
      const placed = own(piece.transform(along ? [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, l1, 0, 1] : [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, l0, 0, 0, 1]));
      const id = 'roof' + (pieces > 1 ? '-' + (i + 1) : ''),
        name = 'Barrel vault' + (pieces > 1 ? ' ' + (i + 1) + ' of ' + pieces : '');
      parts.push({ id, name, role: 'roof', solid: placed, lie: along ? [90, 0, 0] : [0, 90, 0], apart: add3(apart, along ? [0, (i - (pieces - 1) / 2) * APART.piece, 0] : [(i - (pieces - 1) / 2) * APART.piece, 0, 0]) });
    }
    return parts;
  }
  /** How high the top of the roof is over the eaves at a point of the top storey. */
  const roofTopAt = (x, y) => {
    if (b.roof === 'flat') return rt;
    if (shape.vault) {
      const { along, c: half, R, below } = shape.vault;
      const u = (along ? x : y) - half;
      return Math.abs(u) >= R + rt ? 0 : Math.sqrt((R + rt) ** 2 - u * u) - below;
    }
    if (shape.saw) return roofAt(shape, x, y) + rt * Math.hypot(shape.t, 1);
    // The lowest of the panels' tops, each as thick as the roof square to it.
    return Math.min(...shape.panels.map((p) => p.t * (p.dir[0] * x + p.dir[1] * y - p.s0) + rt * Math.hypot(p.t, 1)));
  };
  /**
   * A dormer: a front wall with a window, two cheeks and a two-sided roof
   * over them, one hollow piece standing on the roof, open underneath over
   * an opening in the panel; going back, its cheeks and roof end on the roof.
   * It prints standing on its front, so every face is upright or faces up.
   */
  function dormerPart(d, i, z1, apart) {
    const F = FITTINGS;
    const g = dormerShape(shape, d);
    const { p, A, df, ac, k, hw } = g;
    const [dx, dy] = p.dir,
      T = p.t,
      len = Math.hypot(T, 1);
    const top = (dd) => z1 + T * dd + rt * len; // the top of the roof, d along the slope
    const zf = top(df),
      ze = zf + g.eave;
    const slab = (a0, d0, a1, d1, za, zb) => {
      const r = g.plan(a0, d0, a1, d1);
      return box(r[0], r[1], za, r[2], r[3], zb);
    };
    const norm = (n, off) => {
      const l = Math.hypot(...n);
      return [n.map((v) => v / l), off / l];
    };
    // Above the top of the roof, by `by`.
    const above = (by) => norm([-T * dx, -T * dy, 1], z1 - T * p.s0 + rt * len + by);
    // Under its two-sided roof: eave at e, the planes sloping down from the middle.
    const under = (e) => [norm([-k * A[0], -k * A[1], -1], -(e + k * hw) - k * ac), norm([k * A[0], k * A[1], -1], -(e + k * hw) + k * ac)];
    const zTop = ze + k * hw + 1;
    let outer = slab(ac - hw, df, ac + hw, g.back + 2, zf - 40, zTop);
    for (const [n, off] of [above(0), ...under(ze)]) outer = trim(outer, n, off);
    const roofIn = F.dormerRoof * Math.hypot(k, 1);
    let inner = slab(ac - hw + t, df + t, ac + hw - t, g.back + 10, zf - 60, zTop);
    for (const [n, off] of [above(-5), ...under(ze - roofIn)]) inner = trim(inner, n, off);
    // The window in its front, over the roof and under the ceiling at the cheeks.
    const ww = d.width - 2 * t - 2 * F.dormerSill,
      w0 = zf + F.dormerSill + 1,
      w1 = Math.min(ze - F.dormerSill, ze - roofIn + k * t - 1);
    const pane = slab(ac - ww / 2, df - 1, ac + ww / 2, df + t + 1, w0, w1);
    const solid = whole(minus(outer, inner, ...(w1 - w0 > 2 ? [pane] : [])));
    return { id: 'dormer-' + (i + 1), name: 'Dormer ' + (i + 1), role: 'wall', solid, outward: [dx, dy, 0], apart: add3(apart, [-dx * 12, -dy * 12, 15]) };
  }
  /** Everything up to the top of the roof, for a fitting to stand on it. */
  function roofBody(W, D, z1, ov) {
    const big = () => box(-ov.left - 60, -ov.front - 60, z1 - 300, W + ov.right + 60, D + ov.back + 60, z1 + shape.rise + 300);
    if (b.roof === 'flat') return trim(big(), [0, 0, -1], -(z1 + rt));
    if (shape.vault) return own(Manifold.union([trim(big(), [0, 0, -1], -z1), vaultDrum(shape.vault, W, z1, shape.vault.R + rt)]));
    return own(
      Manifold.union(
        shape.panels.map((p) => {
          const [dx, dy] = p.dir;
          const len = Math.hypot(p.t, 1);
          let q = trim(big(), [p.t * dx, p.t * dy, -1], -(z1 - p.t * p.s0 + rt * len) / len);
          for (const [n, off] of keepsOf(p, z1)) q = trim(q, n, off);
          return q;
        }),
      ),
    );
  }
  /**
   * The rooflights on a panel (null: the flat roof): a hole square through
   * it, a frame standing round it on its top. Each is a hole in the plan,
   * through the panel at right angles to it, so its sides stand upright as
   * the panel prints.
   */
  function withRooflights(panel, p, z1) {
    const F = FITTINGS;
    const mine = b.rooflights.filter((l) => (p ? roofPanelAt(shape, l.x, l.y) === p : true));
    const dormers = p ? b.dormers.map((d) => dormerShape(shape, d)).filter((g) => g.p === p) : [];
    if (!mine.length && !dormers.length) return panel;
    const T = p ? p.t : 0,
      [dx, dy] = p ? p.dir : [0, 0],
      s0 = p ? p.s0 : 0;
    const len = Math.hypot(T, 1),
      N = [(-T * dx) / len, (-T * dy) / len, 1 / len];
    const under = (x, y) => z1 + T * (dx * x + dy * y - s0);
    const prism = ([x0, y0, x1, y1], from, to) =>
      own(Manifold.hull([[x0, y0], [x1, y0], [x0, y1], [x1, y1]].flatMap(([x, y]) => [from, to].map((k) => [x + N[0] * k, y + N[1] * k, under(x, y) + N[2] * k]))));
    const frames = [],
      holes = [];
    for (const l of mine) {
      const r = [l.x - l.width / 2, l.y - l.depth / 2, l.x + l.width / 2, l.y + l.depth / 2];
      const f = F.lightFrame;
      holes.push(prism(r, -1, rt + F.lightUp + 1));
      // Its foot down through any tiles or corrugations, filling their joints under it.
      const sink = b.roofTexture === 'plain' ? 0.2 : Math.min(rt - 0.6, 1.5 * b.textureDepth + 0.3);
      frames.push(prism([r[0] - f, r[1] - f, r[2] + f, r[3] + f], rt - sink, rt + F.lightUp));
    }
    // Under a dormer, an opening as wide as the inside of its cheeks, to where its eaves meet the roof.
    for (const g of dormers) if (g.valley - 1 > g.df + t + 0.5) holes.push(prism(g.plan(g.ac - g.hw + t + 0.5, g.df + t + 0.5, g.ac + g.hw - t - 0.5, g.valley - 1), -1, rt + 1));
    return whole(frames.length ? minus(own(Manifold.union([panel, ...frames])), ...holes) : minus(panel, ...holes));
  }
  /**
   * A chimney: a stack with a cap round its top, its foot following the roof
   * under it, a flue down into its top as a pointed pocket. It prints upside
   * down, standing on its cap, its foot up.
   */
  function chimneyPart(W, D, z1, ov, apart) {
    const F = FITTINGS;
    const { x, y, width: cw, depth: cd, height } = b.chimney;
    const [x0, y0, x1, y1] = [x - cw / 2, y - cd / 2, x + cw / 2, y + cd / 2];
    let high = 0;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) high = Math.max(high, roofTopAt(x0 + (i / 4) * cw, y0 + (j / 4) * cd));
    const zTop = z1 + high + height;
    let stack = own(Manifold.union([box(x0, y0, z1 - 20, x1, y1, zTop - F.capHigh), box(x0 - F.cap, y0 - F.cap, zTop - F.capHigh, x1 + F.cap, y1 + F.cap, zTop)]));
    stack = minus(stack, roofBody(W, D, z1, ov));
    // The flue: a rectangle 2 mm in from the sides, its sides steeper than 45°, to a ridge.
    const a = Math.min(cw, cd) - 4,
      l = Math.max(cw, cd) - 4,
      deep = 0.75 * a,
      wide = cw >= cd;
    const rim = [[-l / 2, -a / 2], [l / 2, -a / 2], [-l / 2, a / 2], [l / 2, a / 2]].map(([u, v]) => (wide ? [x + u, y + v, zTop + 1] : [x + v, y + u, zTop + 1]));
    const ridge = [-(l - a) / 2, (l - a) / 2].map((u) => (wide ? [x + u, y, zTop - deep] : [x, y + u, zTop - deep]));
    // Up past the top by 1 mm, its sides on the same slope.
    const lift = (pt) => pt.map((v, i) => (i < 2 ? v + (v - (i ? y : x)) * (1 / deep) : v));
    stack = minus(stack, own(Manifold.hull([...rim.map(lift), ...ridge])));
    return { id: 'chimney', name: 'Chimney', role: 'frame', solid: whole(stack), flip: true, apart: add3(apart, [0, 0, 20]) };
  }
  /**
   * Gutters: an open channel along each eave, against its edge, its top a
   * little under the top of the roof there; closed at its ends, or round a
   * hip roof mitred to the next at the corners. They print as they hang,
   * open side up. A downpipe from each, at the end chosen: square, its top in
   * a hole in the floor of the gutter, a swan neck in to the wall, down the
   * wall to the base. It prints on its side, the swan neck flat on the plate.
   */
  function gutterParts(W, D, z1, ov, apart) {
    const F = FITTINGS,
      G = F.gutter,
      H = F.gutterHigh,
      gw = F.gutterWall,
      P = F.pipe;
    const hip = b.roof === 'hip';
    const relief = storeys.some((s) => s.relief.plinth || s.relief.cornice || s.relief.pilasters || s.relief.panels) ? RELIEF.depth : 0;
    const out = [];
    for (const p of shape.panels) {
      const side = eaveOf(p);
      const o = ov[side];
      const zTop = z1 - p.t * o + rt * Math.hypot(p.t, 1) - 0.5,
        zBot = zTop - H;
      // In the frame of the eave: u along the wall (x for front and back, y for the sides), w out from the wall's outside.
      const alongX = side === 'front' || side === 'back';
      const [a0, a1] = alongX ? [-ov.left, W + ov.right] : [-ov.front, D + ov.back];
      const ext = hip ? o + G + 1 : 0;
      const place = (u0, w0, za, u1, w1, zb) => {
        const [p0, p1] = { front: [-w0, -w1], back: [D + w0, D + w1], left: [-w0, -w1], right: [W + w0, W + w1] }[side];
        return alongX ? box(u0, p0, za, u1, p1, zb) : box(p0, u0, za, p1, u1, zb);
      };
      let gutter = place(a0 - ext, o, zBot, a1 + ext, o + G, zTop);
      const inner = place(a0 - ext + (hip ? 0 : gw), o + gw, zBot + gw, a1 + ext - (hip ? 0 : gw), o + G - gw, zTop + 1);
      gutter = minus(gutter, inner);
      // Round a hip roof, mitred where the hips come down.
      if (hip) for (const [n, off] of p.keeps.filter(([n]) => n[0] && n[1])) gutter = trim(gutter, n, off);
      // The downpipe: where along the wall, as you look at it from outside.
      let pipe = null;
      if (b.downpipes !== 'none') {
        const L = alongX ? W : D;
        const near = 2 + P / 2;
        // Looking at it: the front's left is x = 0, the back's x = W; the left wall's left is its back, the right wall's its front.
        const leftEnd = { front: near, back: L - near, left: L - near, right: near }[side];
        const u = b.downpipes === 'left' ? leftEnd : L - leftEnd;
        const wg = o + G / 2,
          wp = relief + P / 2;
        // The hole in the floor of the gutter, the pipe's top in it.
        // Across the channel no wider than it, so its sides stay whole.
        gutter = minus(gutter, place(u - P / 2 - c, o + gw, zBot - 1, u + P / 2 + c, o + G - gw, zBot + gw + 0.01));
        const zNeck = zBot - 2,
          drop = Math.max(0, wg - wp);
        const path = [[wg, zBot + gw], [wg, zNeck], [wp, zNeck - drop], [wp, b.baseHeight]];
        const { CrossSection } = wasm;
        const bits = [];
        for (let i = 0; i + 1 < path.length; i++) {
          const [[w0, z0], [w1, z1b]] = [path[i], path[i + 1]];
          const d = [w1 - w0, z1b - z0],
            l = Math.hypot(...d);
          if (l < 1e-6) continue;
          const nrm = [(-d[1] / l) * (P / 2), (d[0] / l) * (P / 2)];
          bits.push(own(new CrossSection([[[w0 + nrm[0], z0 + nrm[1]], [w0 - nrm[0], z0 - nrm[1]], [w1 - nrm[0], z1b - nrm[1]], [w1 + nrm[0], z1b + nrm[1]]]], 'Positive')));
        }
        // Square joints at the bends, so the pipe keeps its width round them.
        for (const [w0, z0] of path.slice(1, -1)) bits.push(own(new CrossSection([[[w0 - P / 2, z0 - P / 2], [w0 + P / 2, z0 - P / 2], [w0 + P / 2, z0 + P / 2], [w0 - P / 2, z0 + P / 2]]], 'Positive')));
        // Its foot flat on the base, its top flat in the gutter.
        let profile = own(CrossSection.union(bits));
        profile = own(profile.intersect(own(new CrossSection([[[-50, b.baseHeight], [200, b.baseHeight], [200, zBot + gw], [-50, zBot + gw]]], 'Positive'))));
        const prism = own(profile.extrude(P));
        // (w, z, e) into place: w out from the wall, e along it from u - P / 2.
        const outV = OUTWARD[side],
          alongV = alongX ? [1, 0, 0] : [0, 1, 0];
        const base = { front: [u - P / 2, 0], back: [u - P / 2, D], left: [0, u - P / 2], right: [W, u - P / 2] }[side];
        // Right-handed: out × up · along must be +1, else run e the other way.
        const cross = [outV[1], -outV[0], 0];
        const sign = cross[0] * alongV[0] + cross[1] * alongV[1] > 0 ? 1 : -1;
        const e = alongV.map((v) => v * sign);
        const origin = [base[0] + (sign < 0 ? alongV[0] * P : 0), base[1] + (sign < 0 ? alongV[1] * P : 0), 0];
        pipe = own(prism.transform([...outV, 0, 0, 0, 1, 0, ...e, 0, ...origin, 1]));
      }
      // Longer than the plate: in lengths that fit it, glued end to end.
      gutter = whole(gutter);
      const { min, max } = gutter.boundingBox();
      const k = alongX ? 0 : 1,
        long = max[k] - min[k],
        room = plate ? plateRoom(plate).long : Infinity,
        n = Math.max(1, Math.ceil(long / room - 1e-9));
      const axis = alongX ? [1, 0, 0] : [0, 1, 0];
      for (let i = 0; i < n; i++) {
        let piece = gutter;
        if (i) piece = trim(piece, axis, min[k] + (i * long) / n);
        if (i < n - 1) piece = trim(piece, axis.map((v) => -v), -(min[k] + ((i + 1) * long) / n));
        out.push({ id: 'gutter-' + side + (n > 1 ? '-' + (i + 1) : ''), name: 'Gutter, ' + side + (n > 1 ? ', ' + (i + 1) + ' of ' + n : ''), role: 'frame', solid: piece, lie: [0, 0, 0], apart: add3(apart, add3(scale3(OUTWARD[side], 15), scale3(axis, (i - (n - 1) / 2) * APART.piece))) });
      }
      if (pipe) out.push({ id: 'downpipe-' + side, name: 'Downpipe, ' + side, role: 'frame', solid: pipe, lie: alongX ? [0, 90, 0] : [90, 0, 0], apart: add3(apart, add3(scale3(OUTWARD[side], 25), [0, 0, -APART.roof])) });
    }
    return out;
  }
  const OUTWARD = { front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
  const plan = plate ? buildingCuts(b, plate) : null;
  const runs = railingRuns(b, storeys);
  /**
   * A railing piece where it stands, and the pockets for its tabs: a flat
   * panel, a solid band along its foot, posts and a top rail, two tabs
   * below. u along the run, v up from the deck, w in from the edge.
   */
  function railing(piece) {
    const { railHeight: h, railThick: th, railBand: band, railPost: post, railPitch: pitch, railInset: inset, railTab: tab, play } = KIT;
    const len = piece.b - piece.a;
    const inward = [-piece.out[0], -piece.out[1], 0],
      O = [piece.from[0] + piece.d[0] * piece.a + inward[0] * inset, piece.from[1] + piece.d[1] * piece.a + inward[1] * inset, piece.z];
    const place = (solid) => own(solid.transform([piece.d[0], piece.d[1], 0, 0, 0, 0, 1, 0, ...inward, 0, ...O, 1]));
    const B = (u0, v0, w0, u1, v1, w1) => own(Manifold.cube([u1 - u0, v1 - v0, w1 - w0]).translate([u0, v0, w0]));
    const bits = [B(0, 0, 0, len, band, th), B(0, h - post, 0, len, h, th)];
    const posts = Math.max(2, Math.ceil(len / pitch) + 1);
    for (let k = 0; k < posts; k++) {
      const u = Math.min(len - post, Math.max(0, (k * (len - post)) / (posts - 1)));
      bits.push(B(u, band - 0.01, 0, u + post, h - post + 0.01, th));
    }
    // Mesh: the field between the end posts filled, square holes through it.
    if (b.railingStyle === 'mesh') bits.push(meshField(B, len, post, band, h - post, th));
    // Solid: the field between the band and the rail filled, a parapet.
    if (b.railingStyle === 'solid') bits.push(B(0, band - 0.01, 0, len, h - post + 0.01, th));
    // Lattice: an X between each two posts, a little into them, the band and the rail.
    if (b.railingStyle === 'lattice') {
      const v0 = band,
        v1 = h - post,
        r = KIT.railBar / 2;
      const bar = (a, e) => {
        const d = [e[0] - a[0], e[1] - a[1]],
          l = Math.hypot(...d),
          n = [(-d[1] / l) * r, (d[0] / l) * r];
        return new CrossSection([[[a[0] - n[0], a[1] - n[1]], [e[0] - n[0], e[1] - n[1]], [e[0] + n[0], e[1] + n[1]], [a[0] + n[0], a[1] + n[1]]]], 'Positive');
      };
      for (let k = 0; k + 1 < posts; k++) {
        const u0 = Math.min(len - post, Math.max(0, (k * (len - post)) / (posts - 1))) + post,
          u1 = Math.min(len - post, Math.max(0, ((k + 1) * (len - post)) / (posts - 1)));
        if (u1 - u0 < 2 * KIT.railBar) continue;
        const bars = [bar([u0, v0], [u1, v1]), bar([u0, v1], [u1, v0])];
        const field = new CrossSection([[[u0 - 0.3, v0 - 0.3], [u1 + 0.3, v0 - 0.3], [u1 + 0.3, v1 + 0.3], [u0 - 0.3, v1 + 0.3]]], 'Positive');
        const both = CrossSection.union(bars);
        const x = both.intersect(field);
        bits.push(own(x.extrude(th)));
        [...bars, field, both, x].forEach((q) => q.delete());
      }
    }
    const tabs = [0.2, 0.8].map((f) => len * f);
    for (const u of tabs) bits.push(B(u - 3, -tab, 0, u + 3, 0.01, th));
    const panel = place(own(Manifold.union(bits)));
    const pockets = tabs.map((u) => place(B(u - 3 - play, -tab - 0.2, -play, u + 3 + play, 0.5, th + play)));
    return { panel, pockets };
  }
  const railingsOf = (s) => runs.filter((r) => r.storey === s).flatMap((run) => railingPieces(run, plate).map(railing).map((made, i) => ({ ...made, piece: railingPieces(run, plate)[i] })));
  /**
   * The frame under a ceiling of a storey W × D: a ring just inside the
   * walls, lipDepth deep, with a block on its inside at each tab and the tabs
   * standing up from it, square to the ceiling. ceil: the plane of the
   * ceiling, z = z1 + T (dir · p - s0); keeps: for a panel of a two-sided or a hip
   * roof, the half it covers. high: how far the tabs reach up, through: the
   * holes go right through. Returns the frame and the holes for its tabs.
   */
  function lipFrame(W, D, { z1, T = 0, dir: [dx, dy] = [0, 0], s0 = 0 }, { keeps = [], avoid, high, through = false }) {
    const lo = t + c,
      li = lo + KIT.lip,
      L = KIT.tabLength,
      th = KIT.tabThick,
      pl = KIT.tabPlay;
    const N = [-T * dx, -T * dy, 1],
      len = Math.hypot(...N),
      n = N.map((v) => v / len);
    const under = z1 - T * s0;
    const at = (x, y) => z1 + T * (dx * x + dy * y - s0);
    const zs = [at(0, 0), at(W, 0), at(0, D), at(W, D)];
    const z0 = Math.min(...zs) - KIT.lipDepth - 2,
      zHigh = Math.max(...zs) + 2;
    const inside = (q) => keeps.every(([n, off]) => n[0] * q[0] + n[1] * q[1] >= off + L);
    const spots = tabSpots(W, D, avoid, c).filter((q) => inside(q.p));
    // The ring and the blocks under the tabs, then cut to between the ceiling and lipDepth below it.
    const blockAt = (q) => {
      const [a0, b0] = q.at(q.u - L / 2 - 1, lo),
        [a1, b1] = q.at(q.u + L / 2 + 1, lo + KIT.tabIn + th + 0.4);
      return box(a0, b0, z0, a1, b1, zHigh);
    };
    let ring = minus(box(lo, lo, z0, W - lo, D - lo, zHigh), box(li, li, z0 - 1, W - li, D - li, zHigh + 1));
    if (spots.length) ring = own(Manifold.union([ring, ...spots.map(blockAt)]));
    ring = trim(ring, [T * dx, T * dy, -1], -under / len);
    ring = trim(ring, [-T * dx, -T * dy, 1], (under - KIT.lipDepth) / len);
    for (const [n, off] of keeps) ring = trim(ring, n, off);
    // A box square to the ceiling, its middle on the ceiling at q.
    const square = (q, along, across, zFrom, zTo) => {
      const a0 = [q.d[0], q.d[1], T * (dx * q.d[0] + dy * q.d[1])],
        al = Math.hypot(...a0),
        a = a0.map((v) => v / al);
      const bb = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
      const C = [q.p[0], q.p[1], at(q.p[0], q.p[1])];
      return own(own(Manifold.cube([along, across, zTo - zFrom]).translate([-along / 2, -across / 2, zFrom])).transform([...a, 0, ...bb, 0, ...n, 0, ...C, 1]));
    };
    const tabs = spots.map((q) => square(q, L, th, -0.5, high));
    const frame = tabs.length ? own(Manifold.union([ring, ...tabs])) : ring;
    const holes = spots.map((q) => square(q, L + 2 * pl, th + 2 * pl, -1, high + (through ? 1 : 0.2)));
    return { frame, holes };
  }
  // A tab keeps clear of a dividing wall where it meets the frame.
  const clearOfDividers = (s) => (q) =>
    s.garage &&
    dividers(b).some((at) => {
      const across = b.rooms.along === 'width';
      const meets = across ? q.side === 'front' || q.side === 'back' : q.side === 'left' || q.side === 'right';
      return meets && Math.abs((across ? q.p[0] : q.p[1]) - at) < KIT.tabLength / 2 + 1 + t / 2 + 2;
    });
  const parts = [];
  try {
    // Base: a hollow tray as high as the track, with the wall groove on top.
    {
      const W = b.width,
        D = b.depth,
        top = b.baseHeight;
      const outer = box(-m, -m, 0, W + m, D + m, top);
      let hollow = box(-m + shell, -m + shell, -1, W + m - shell, D + m - shell, top - deck);
      const groove = minus(box(-c, -c, top - g, W + c, D + c, top + 1), box(t + c, t + c, top - g - 1, W - t - c, D - t - c, top + 2));
      // Over a pit bay the base is open from the front to the back wall for
      // the track, and closed along the track by a shell of its own.
      const cuts = [hollow, groove];
      // Pockets under the deck for the pins on top of the stand.
      for (const [x0, y0, x1, y1] of standPins(b)) cuts.push(box(x0 - STAND.play, y0 - STAND.play, top - deck - 0.01, x1 + STAND.play, y1 + STAND.play, top - deck + STAND.pin[1] + 0.2));
      // A groove for each dividing wall too, joining the one round the walls.
      for (const at of dividers(b))
        cuts.push(b.rooms.along === 'width' ? box(at - t / 2 - c, t, top - g, at + t / 2 + c, D - t, top + 1) : box(t, at - t / 2 - c, top - g, W - t, at + t / 2 + c, top + 1));
      if (b.lane) {
        const half = b.lane.width / 2 + KIT.lanePlay,
          end = D - t - c;
        cuts[0] = hollow = minus(hollow, box(W / 2 - half - shell, -m - 1, -2, W / 2 + half + shell, end + shell, top + 2));
        cuts.push(box(W / 2 - half, -m - 1, -1, W / 2 + half, end, top + 1));
      }
      const base = { id: 'base', name: 'Base plate', role: 'buildingBase', solid: minus(outer, ...cuts), flip: true, apart: [0, 0, 0] };
      parts.push(...cutFlat(base, plan && [plan.baseX, plan.baseY], [-m, -m]));
    }

    // Where the pins of the doors that swing go down through the floor or the base: cut once all is made.
    const swingHoles = [];
    // Each storey is made where it stands on the storey below, in its own
    // frame (x from its left wall, y from its front wall), and moved into place.
    for (const s of storeys) {
      const W = s.width,
        D = s.depth,
        top = s.floor,
        z1 = s.eave;
      const own2 = [];
      // Walls that lean out: everything of this storey widens with the height
      // above its floor, by one factor in x and y about its middle.
      const { f: grow } = leanGrow(s);
      const leanBy = (most) => (v) => {
        const dz = Math.min(Math.max(v[2] - top, 0), most) / s.height;
        v[0] = W / 2 + (v[0] - W / 2) * (1 + grow * dz);
        v[1] = D / 2 + (v[1] - D / 2) * (1 + grow * dz);
      };
      // Up to the tops of the walls, and no further: a roof on them is as wide as they are.
      const leanAt = leanBy(s.height);
      // A part leaning with the walls: split at the floor, under which
      // nothing moves; above it the walls lean from the floor up. The floor
      // over them, its frame and the holes for the frame's tabs lean on,
      // straight, past the tops of the walls, so the tabs meet their holes.
      const warpWith = (fn) => (solid) => {
        // The part under the floor reaches a hair over it, so the two fuse even where a texture only touches across the split.
        const lower = trim(solid, [0, 0, -1], -(top + 0.02)),
          upper = trim(solid, [0, 0, 1], top);
        if (upper.isEmpty()) return solid;
        const moved = own(upper.warp(fn));
        return lower.isEmpty() ? moved : own(Manifold.union([lower, moved]));
      };
      const warped = warpWith(leanAt),
        warpedOn = warpWith(leanBy(Infinity));
      // How far this storey lifts in the exploded view, and its walls with it.
      const lift = (s.n - 1) * APART.storey;
      const wallApart = (w) => add3(scale3(OUTWARD[w], APART.out), [0, 0, APART.up + lift]);
      const local = (...ps) => own2.push(...ps);
      // Letters on a wall of this storey: `text`, `height` high, its middle at u along the wall and z,
      // from n0 to n1 out from the face (into the wall where negative).
      const lettersOn = (wall, text, height, u, z, n0, n1) => {
        const frame = { front: [[0, 0], [1, 0, 0]], back: [[W, D], [-1, 0, 0]], left: [[0, D], [0, -1, 0]], right: [[W, 0], [0, 1, 0]] }[wall];
        const shape = own(textShape(wasm, own, text, height).translate([u - textWidth(text, height) / 2, z - height / 2]));
        return sweep(shape, frame[1], [0, 0, 1], [...frame[0], 0], OUTWARD[wall].map((v) => -v), -n1, -n0);
      };
      // A cross-section drawn in a wall's plane (u along it as seen from outside, z up), from n0 to n1 out from its face.
      const onWallShape = (wall, section, n0, n1) => {
        const frame = { front: [[0, 0], [1, 0, 0]], back: [[W, D], [-1, 0, 0]], left: [[0, D], [0, -1, 0]], right: [[W, 0], [0, 1, 0]] }[wall];
        return sweep(section, frame[1], [0, 0, 1], [...frame[0], 0], OUTWARD[wall].map((v) => -v), -n1, -n0);
      };
      // An opening's shapes: its hole, frame, trims and leaf.
      const shapesOf = (o, sink = 0.1) => openingShapes(wasm, own, o, { u: o.at, z0: top + o.sill, wall: t, k: KIT.trim, depth: KIT.trimDepth, bar: KIT.bar, sink });
      const onWall = (wall, u0, u1, n0, n1, za, zb) => {
        if (wall === 'front') return box(u0, -n0, za, u1, -n1, zb);
        if (wall === 'back') return box(W - u0, D + n0, za, W - u1, D + n1, zb);
        if (wall === 'left') return box(-n0, D - u0, za, -n1, D - u1, zb);
        return box(W + n0, u0, za, W + n1, u1, zb);
      };
      // Walls: each from the bottom of its groove up to the floor above or
      // the roof, mitred at 45° so a corner has no seam on the outside.
      // Under a sloped or two-sided roof the top storey's walls follow it.
      const z0 = top - g,
        sloped = s.top && b.roof !== 'flat',
        zTop = sloped ? z1 + shape.rise + 1 : z1;
      const r = Math.SQRT1_2;
      const underRoof = (solid) => {
        if (!sloped) return solid;
        if (shape.vault) {
          // Below the eaves, and up into the arch a clearance inside it.
          const low = trim(solid, [0, 0, -1], -z1);
          // Clear of where the vault bears flat on the tops of the side walls.
          const { along, span } = shape.vault,
            u = along ? [1, 0, 0] : [0, 1, 0];
          const high = trim(trim(own(solid.intersect(vaultDrum(shape.vault, W, z1, shape.vault.R - c))), u, t + 2 * c), u.map((v) => -v), -(span - t - 2 * c));
          // An empty part in a union can empty the lot: only what is there.
          const kept = [low, high].filter((q) => !q.isEmpty());
          return kept.length === 2 ? own(Manifold.union(kept)) : kept[0] ?? low;
        }
        if (shape.saw) {
          // Under each tooth its own plane; under a north light, up to its foot.
          const { dir: [dx, dy], s0, n, w } = shape.saw,
            len = Math.hypot(shape.t, 1);
          const pieces = [];
          for (let k = 0; k < n; k++) {
            const last = k === n - 1;
            pieces.push(trim(sawStrip(solid, shape.saw, k ? k * w : null, last ? null : (k + 1) * w - t), [shape.t * dx, shape.t * dy, -1], -(z1 - shape.t * (s0 + k * w)) / len));
            // A hair into the teeth on either side, lower than both, so the wall stays one body.
            if (!last) pieces.push(trim(sawStrip(solid, shape.saw, (k + 1) * w - t - 0.01, (k + 1) * w + 0.01), [0, 0, -1], -(z1 - rt)));
          }
          const kept = pieces.filter((q) => !q.isEmpty());
          return kept.length ? own(Manifold.union(kept)) : solid;
        }
        for (const p of shape.panels) {
          const [dx, dy] = p.dir;
          const len = Math.hypot(p.t * dx, p.t * dy, 1);
          solid = trim(solid, [p.t * dx, p.t * dy, -1], -(z1 - p.t * p.s0) / len);
        }
        return solid;
      };
      const walls = {
        front: trim(trim(box(0, 0, z0, W, t, zTop), [1, -1, 0], 0), [-1, -1, 0], -W * r),
        back: trim(trim(box(0, D - t, z0, W, D, zTop), [1, 1, 0], D * r), [-1, 1, 0], (D - W) * r),
        left: trim(trim(box(0, 0, z0, t, D, zTop), [-1, 1, 0], 0), [-1, -1, 0], -D * r),
        right: trim(trim(box(W - t, 0, z0, W, D, zTop), [1, 1, 0], W * r), [1, -1, 0], (W - D) * r),
      };
      for (const w of WALLS) walls[w] = underRoof(walls[w]);
      // The garage door on the ground floor: open from the top of the base, so the doorstep is level.
      // Over a pit bay the door reaches down through the foot of the wall, so nothing crosses the track.
      const holes = { front: s.garage ? doors.map((door) => box(door.x, -1, b.lane ? z0 - 1 : top, door.x + door.width, t + 1, top + door.height)) : [], back: [], left: [], right: [] };
      for (const o of s.openings)
        holes[o.wall].push(o.shape === 'square' ? onWall(o.wall, o.at - o.width / 2, o.at + o.width / 2, -t - 1, 1, top + o.sill, top + o.sill + o.height) : onWallShape(o.wall, shapesOf(o).hole, -t - 1, 1));
      // Frame walls: open between posts at the corners and between bays, a
      // chord at the foot and a beam under the eaves; in each bay an X of
      // braces, or a diamond lattice. Holes straight through a flat wall.
      if (s.wallStyle !== 'solid') {
        const { sweep, poly } = kitShapes(wasm, own);
        const F = FRAME_WALL;
        const ALONG3 = { front: [[0, 0], [1, 0, 0]], back: [[W, D], [-1, 0, 0]], left: [[0, D], [0, -1, 0]], right: [[W, 0], [0, 1, 0]] };
        const rect = (u0, v0, u1, v1) => poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        const bar = (a, c2, wide) => {
          const dd = [c2[0] - a[0], c2[1] - a[1]],
            l = Math.hypot(...dd),
            n = [(-dd[1] / l) * (wide / 2), (dd[0] / l) * (wide / 2)];
          return poly([[a[0] - n[0], a[1] - n[1]], [c2[0] - n[0], c2[1] - n[1]], [c2[0] + n[0], c2[1] + n[1]], [a[0] + n[0], a[1] + n[1]]]);
        };
        for (const w of WALLS) {
          const L = wallLength(s, w);
          const v0 = top + F.chord,
            v1 = z1 - F.chord;
          const span = L - 2 * F.post;
          const bays = Math.max(1, Math.ceil(span / F.bay));
          const cuts = [];
          for (let k = 0; k < bays; k++) {
            const u0 = F.post + (k * (span + F.member)) / bays,
              u1 = F.post + ((k + 1) * (span + F.member)) / bays - F.member;
            const bayOpen = rect(u0, v0, u1, v1);
            const members = [];
            if (s.wallStyle === 'braced') members.push(bar([u0, v0], [u1, v1], F.brace), bar([u0, v1], [u1, v0], F.brace));
            else {
              const reach = u1 - u0 + v1 - v0;
              for (let q = -reach; q <= reach; q += F.pitch) members.push(bar([u0 + q, v0], [u0 + q + (v1 - v0), v1], F.bar), bar([u0 + q, v1], [u0 + q + (v1 - v0), v0], F.bar));
            }
            cuts.push(own(bayOpen.subtract(own(wasm.CrossSection.union(members)))));
          }
          const [[ox, oy], dir] = ALONG3[w];
          const inward = OUTWARD[w].map((v) => -v);
          holes[w].push(sweep(own(wasm.CrossSection.union(cuts)), dir, [0, 0, 1], [ox, oy, 0], inward, -1, t + 1));
        }
      }
      for (const w of WALLS) walls[w] = minus(walls[w], ...holes[w]);
      // A wall texture: joints in the outside face, clear of every opening
      // and of the frame around it, and of the wall's foot in the groove.
      if (isTextured(s)) {
        const keepOut = { front: s.garage ? doors.map((door) => [door.x, top, door.x + door.width, top + door.height]) : [], back: [], left: [], right: [] };
        for (const o of s.openings) {
          const extra = o.frame ? KIT.trim : 0;
          // An arch keeps its own shape clear, and its frame round it.
          if (o.shape !== 'square') keepOut[o.wall].push({ poly: outlineOf(o).map(([a, c]) => [o.at + a, top + o.sill + c]), grow: extra });
          else keepOut[o.wall].push([o.at - o.width / 2 - extra, top + o.sill - (o.type === 'window' ? extra : 0), o.at + o.width / 2 + extra, top + o.sill + o.height + extra]);
        }
        // Behind lettering the wall is smooth, like a painted panel, so the letters read.
        for (const l of s.lettering) {
          const half = textWidth(l.text, l.height) / 2;
          keepOut[l.wall].push([l.at - half - 1, top + l.up - l.height / 2 - 1, l.at + half + 1, top + l.up + l.height / 2 + 1]);
        }
        for (const w of WALLS) {
          const joints = finishJoints(wasm, own, w, { W, D, length: wallLength(s, w), bottom: top, top: zTop }, keepOut[w], b, s);
          if (joints) walls[w] = whole(own(walls[w].subtract(joints)));
        }
      }
      // Relief: bands, pilasters and panels on the outside, after the texture,
      // smooth like stone trim; clear of every opening, its frame, its
      // counter and its flap. Each piece reaches past the ends of its wall and
      // is mitred like it, so a band runs on round a corner without a seam.
      const R = s.relief;
      if (R.plinth || R.cornice || R.pilasters || R.panels || b.container !== 'none') {
        const d = RELIEF.depth,
          P = RELIEF.pilaster;
        // From the bottom of the texture's joints, so the relief fills them under it.
        const sink = isTextured(s) ? b.textureDepth + 0.1 : 0.01;
        const mitre = (w, solid) => {
          const r2 = Math.SQRT1_2;
          const planes = {
            front: [[[1, -1, 0], 0], [[-1, -1, 0], -W * r2]],
            back: [[[1, 1, 0], D * r2], [[-1, 1, 0], (D - W) * r2]],
            left: [[[-1, 1, 0], 0], [[-1, -1, 0], -D * r2]],
            right: [[[1, 1, 0], W * r2], [[1, -1, 0], (W - D) * r2]],
          }[w];
          for (const [n, off] of planes) solid = trim(solid, n, off);
          return underRoof(solid);
        };
        const zWall = sloped ? zTop : z1;
        for (const w of WALLS) {
          const L = wallLength(s, w);
          // Where the relief keeps off: openings with their frames, counters and flaps; the garage doors.
          const clear = [];
          for (const o of s.openings) {
            if (o.wall !== w) continue;
            const k = o.frame ? KIT.trim : 0;
            clear.push([o.at - o.width / 2 - KIT.trim - sideOf(o), top + o.sill - (o.type === 'window' ? k : 0) - underOf(o) - (o.counter ? HATCH.counter[1] + HATCH.counter[0] : 0), o.at + o.width / 2 + KIT.trim + sideOf(o), top + o.sill + o.height + k + overOf(o) + (o.flap ? HATCH.flapClear : 0)]);
          }
          if (s.garage && w === 'front') for (const door of doors) clear.push([door.x - KIT.trim, top - 1, door.x + door.width + KIT.trim, top + door.height + KIT.trim]);
          const meets = (u0, z0b, u1, z1b) => clear.some(([a0, c0, a1, c1]) => u0 < a1 && a0 < u1 && z0b < c1 && c0 < z1b);
          const raised = [];
          if (R.plinth) raised.push(onWall(w, -d, L + d, -sink, d, top, top + R.plinth));
          if (R.cornice) raised.push(onWall(w, -d, L + d, -sink, d, z1 - R.cornice, z1));
          // Pilasters: at the corners, and between them as near the spacing as fits.
          const posts = [];
          if (R.pilasters) {
            posts.push([-d, P], [L - P, L + d]);
            const n = Math.max(1, Math.round(L / R.pilasters));
            for (let k = 1; k < n; k++) {
              const u = (k * L) / n;
              if (!meets(u - P / 2, top, u + P / 2, zWall)) posts.push([u - P / 2, u + P / 2]);
            }
            for (const [u0, u1] of posts) raised.push(onWall(w, u0, u1, -sink, d, top, zWall));
          }
          if (raised.length) {
            let relief = mitre(w, own(Manifold.union(raised)));
            if (clear.length) relief = minus(relief, ...clear.map(([a0, c0, a1, c1]) => onWall(w, a0, a1, -1, d + 1, c0, c1)));
            walls[w] = own(walls[w].add(relief));
          }
          if (b.container !== 'none') {
            const detail = containerWall({ wall: w, length: L, bottom: top, top: z1, cargo: b.container === w, sink }, { onWall, own, Manifold, minus });
            let relief = mitre(w, detail);
            if (clear.length) relief = minus(relief, ...clear.map(([a0, c0, a1, c1]) => onWall(w, a0, a1, -2, 3, c0, c1)));
            walls[w] = own(walls[w].add(relief));
          }
          // Panels: sunk between the pilasters (or the ends), above the plinth and under the cornice.
          if (R.panels) {
            const m = RELIEF.margin;
            const edges = [...(posts.length ? posts : [[-d, KIT.wall + KIT.frame - m], [L - KIT.wall - KIT.frame + m, L + d]])].sort((a, c) => a[0] - c[0]);
            const zp0 = top + R.plinth + m,
              zp1 = z1 - R.cornice - m;
            const sunk = [];
            for (let k = 0; k + 1 < edges.length; k++) {
              const u0 = edges[k][1] + m,
                u1 = edges[k + 1][0] - m;
              if (u1 - u0 >= 8 && zp1 - zp0 >= 8 && !meets(u0, zp0, u1, zp1)) sunk.push(onWall(w, u0, u1, -RELIEF.recess, 0.5, zp0, zp1));
            }
            if (sunk.length) walls[w] = minus(walls[w], ...sunk);
          }
        }
      }
      // Lettering: raised from the face, its foot in the joints of the texture, or cut into it.
      {
        const sink = isTextured(s) ? b.textureDepth + 0.1 : 0.01;
        for (const l of s.lettering) {
          const letters = l.cut ? lettersOn(l.wall, l.text, l.height, l.at, top + l.up, -LETTERING.depth, 1) : lettersOn(l.wall, l.text, l.height, l.at, top + l.up, -sink, LETTERING.depth);
          walls[l.wall] = own(l.cut ? walls[l.wall].subtract(letters) : walls[l.wall].add(letters));
        }
      }
      // Sills, lintels and shutters standing out of the face; a door's leaf in the back of its doorway.
      {
        const sink = isTextured(s) ? b.textureDepth + 0.1 : 0.01;
        for (const o of s.openings) {
          if (!o.ledge && !o.lintel && !o.shutters && (o.type !== 'door' || o.leaf === 'open')) continue;
          const shapes = shapesOf(o, sink);
          const add = shapes.relief.filter((r) => !r.cut).map((r) => onWallShape(o.wall, r.section, r.from, r.to));
          const cut = shapes.relief.filter((r) => r.cut).map((r) => onWallShape(o.wall, r.section, r.from, r.to));
          if (shapes.leaf && o.swing) {
            // A leaf of its own, clear of its doorway all round, a pin up into the wall over it and one down
            // through the floor at its hinge side; it lies flat to print, its face up.
            const L = shapes.leaf,
              { play: pl, pin, length: len } = SWING;
            const CS = wasm.CrossSection;
            const rect2 = (a0, b0, a1, b1) => own(new CS([[[a0, b0], [a1, b0], [a1, b1], [a0, b1]]], 'Positive'));
            const zb = top + o.sill,
              zt = zb + o.height,
              hinge = o.at - o.width / 2 + pl + pin / 2;
            const section = own(CS.union([own(L.section.offset(-pl, 'Miter', 2)), rect2(hinge - pin / 2, zb + pl - len, hinge + pin / 2, zb + pl + 0.1), rect2(hinge - pin / 2, zt - pl - 0.1, hinge + pin / 2, zt - pl + len)]));
            let leaf = onWallShape(o.wall, section, L.from, L.to);
            const leafCuts = L.cuts.map((c) => onWallShape(o.wall, c, L.to - TRIM.deep, L.to + 0.5));
            if (L.glass) leafCuts.push(onWallShape(o.wall, L.glass, L.from - 0.5, L.to + 0.5));
            if (leafCuts.length) leaf = minus(leaf, ...leafCuts);
            const k = s.openings.indexOf(o) + 1;
            local({ id: 'leaf' + s.suffix + '-' + k, name: openingName(o, s.openings) + ' leaf' + s.label, role: 'door', solid: leaf, outward: OUTWARD[o.wall], apart: wallApart(o.wall) });
            // Its slot over the doorway, through the wall so it prints with nothing over air (under the
            // door's frame, if it has one); its hole through the floor.
            cut.push(onWallShape(o.wall, rect2(hinge - pin / 2 - pl, zt - 0.5, hinge + pin / 2 + pl, zt - pl + len + pl), -t - 1, 1));
            // The wall's foot carries on under the doorway down into the groove: notched there for the pin, through it.
            cut.push(onWallShape(o.wall, rect2(hinge - pin / 2 - pl, zb - len - pl - 2, hinge + pin / 2 + pl, zb + 0.5), -t - 1, 1));
            swingHoles.push({ n: s.n, ox: s.ox, oy: s.oy, solid: onWallShape(o.wall, rect2(hinge - pin / 2 - pl, zb - len - pl - 2, hinge + pin / 2 + pl, zb + 0.5), L.from - pl, L.to + pl) });
          } else if (shapes.leaf) {
            const L = shapes.leaf;
            add.push(onWallShape(o.wall, L.section, L.from, L.to));
            // Panels and planks sunk into its front; glass through its top.
            for (const c of L.cuts) cut.push(onWallShape(o.wall, c, L.to - TRIM.deep, L.to + 0.5));
            if (L.glass) cut.push(onWallShape(o.wall, L.glass, L.from - 0.5, L.to + 0.5));
          }
          if (add.length) walls[o.wall] = own(walls[o.wall].add(own(Manifold.union(add))));
          if (cut.length) walls[o.wall] = minus(walls[o.wall], ...cut);
        }
      }
      for (const w of ['front', 'back', 'left', 'right'])
        local(...cutWall({ id: w + s.suffix, name: WALL_NAMES[w] + ' wall' + s.label, role: 'wall', solid: walls[w], outward: OUTWARD[w], apart: wallApart(w) }, w, s, { W, D, z0, zTop, top, z1 }));
      // Dividing walls on the ground floor: each from its groove in the base up
      // to the ceiling, between the walls, notched at its ends where the lip
      // of the roof or the floor above passes over them.
      if (s.garage)
        dividers(b).forEach((at, i) => {
          const across = b.rooms.along === 'width',
            lo = t + c,
            reach = lo + KIT.lip + c,
            far = (across ? D : W) - reach;
          let wall = underRoof(across ? box(at - t / 2, lo, z0, at + t / 2, D - lo, zTop) : box(lo, at - t / 2, z0, W - lo, at + t / 2, zTop));
          // The ceiling over a point along the wall, on either face of it: under a
          // roof that slopes across the wall, the lip on its low face is lower.
          const ceiling = (u, v) => ceilingAt(b, s, shape, across ? v : u, across ? u : v);
          const notch = (u0, u1) => {
            const faces = [at - t / 2 - 1, at + t / 2 + 1];
            const z = Math.min(...[u0, u1].flatMap((u) => faces.map((v) => ceiling(u, v)))) - KIT.lipDepth - c;
            return across ? box(at - t / 2 - 1, u0, z, at + t / 2 + 1, u1, zTop + 1) : box(u0, at - t / 2 - 1, z, u1, at + t / 2 + 1, zTop + 1);
          };
          if (storeys[s.n] || frameIds(b, storeys).length) wall = minus(wall, notch(lo - 1, reach), notch(far, (across ? D : W) - lo + 1));
          const part = dividerParts(b)[i];
          local(
            ...cutWall(
              {
                ...part,
                solid: wall,
                outward: across ? [1, 0, 0] : [0, 1, 0],
                apart: [0, 0, lift + APART.up],
                length: across ? D : W,
                cutFrame: across ? [[0, 1, 0], [1, 0, 0], [at - t / 2 - 2, 0, 0]] : [[1, 0, 0], [0, 1, 0], [0, at - t / 2 - 2, 0]],
              },
              'divide',
              { ...s, wallTexture: 'plain', wallTextures: {}, lowerTexture: 'none', openings: [], garage: false },
              { W, D, z0, zTop, top, z1 },
            ),
          );
        });
      const roofApart = [0, 0, lift + APART.up + APART.roof];

      // The roof, on the top storey.
      if (s.top) {
        const ov = { front: b.overhangFront, back: b.overhangBack, left: b.overhangLeft, right: b.overhangRight };
        if (b.roof === 'flat') {
          // A plate with its overhangs. Under it a frame drops between the
          // walls and keeps them square; its tabs go into pockets in the
          // underside of the roof, so nothing shows on top.
          let roofPlate = box(-ov.left, -ov.front, z1, W + ov.right, D + ov.back, z1 + rt);
          if (b.container !== 'none') roofPlate = own(roofPlate.add(containerRoof(W, D, z1 + rt, b.sign, { box, own, Manifold })));
          // Arched: the top a circular arc across it, the crown along the ridge, as thick as a flat roof at its edges.
          if (b.arch) {
            const along = b.ridge === 'depth';
            const [a0, a1] = along ? [-ov.left, W + ov.right] : [-ov.front, D + ov.back];
            const [l0, l1] = along ? [-ov.front - 1, D + ov.back + 1] : [-ov.left - 1, W + ov.right + 1];
            const c = (a1 - a0) / 2,
              h = b.arch,
              R = (c * c + h * h) / (2 * h);
            const mid = (a0 + a1) / 2,
              zc = z1 + rt + h - R;
            let drum = own(Manifold.cylinder(l1 - l0, R, R, 256));
            // The cylinder's axis along the ridge, its top at the crown.
            drum = along ? own(own(drum.rotate([-90, 0, 0])).translate([mid, l0, zc])) : own(own(drum.rotate([0, 90, 0])).translate([l0, mid, zc]));
            roofPlate = own(box(-ov.left, -ov.front, z1, W + ov.right, D + ov.back, z1 + rt + h).intersect(drum));
          }
          // A roof terrace: its railing in pockets in the top of the roof.
          for (const { panel, pockets, piece } of railingsOf(s).filter((r) => r.piece.id.startsWith('roofrail'))) {
            roofPlate = minus(roofPlate, ...pockets);
            local({ id: piece.id, name: piece.name, role: 'frame', solid: panel, outward: [...piece.out, 0], apart: [piece.out[0] * 10, piece.out[1] * 10, lift + APART.up + APART.roof + 15] });
          }
          if (b.roofLip !== 'none') {
            const { frame, holes } = lipFrame(W, D, { z1 }, { avoid: clearOfDividers(s), high: KIT.tabRoof });
            roofPlate = minus(roofPlate, ...holes);
            const part = { id: 'roof-frame', name: 'Roof frame', role: 'lip', solid: frame, lie: [0, 0, 0], apart: [0, 0, lift + APART.up + APART.roof / 2] };
            local(...cutFlat(part, plan && [plan.roofX, plan.roofY], [-ov.left, -ov.front]));
          }
          // It prints the right way up, its top on the plate side up.
          roofPlate = withRooflights(roofPlate, null, z1);
          const roof = { id: 'roof', name: 'Flat roof', role: 'roof', solid: roofPlate, lie: [0, 0, 0], apart: roofApart };
          local(...cutFlat(roof, plan && [plan.roofX, plan.roofY], [-ov.left, -ov.front]));
        } else if (shape.vault) {
          local(...barrelVault(W, D, z1, ov, roofApart));
        } else {
          // Each panel lies on the walls at the pitch, as thick as the roof, and
          // reaches past the walls by the overhang of each side.
          for (const p of shape.panels) {
            const [dx, dy] = p.dir;
            const T = p.t,
              cosA = 1 / Math.hypot(T, 1);
            const len = Math.hypot(T * dx, T * dy, 1);
            // Low enough for a steep panel's overhang.
            let panel = box(-ov.left, -ov.front, z1 - 60 - 6 * BUILDING_LIMITS.overhangFront[1], W + ov.right, D + ov.back, z1 + shape.rise + 60);
            panel = trim(panel, [-T * dx, -T * dy, 1], (z1 - T * p.s0) / len);
            panel = trim(panel, [T * dx, T * dy, -1], -(z1 - T * p.s0 + rt / cosA) / len);
            for (const [n, off] of keepsOf(p, z1)) panel = trim(panel, n, off);
            // Tiles or corrugations in its top, starting at the eave.
            if (b.roofTexture !== 'plain') {
              const joints = roofJoints(
                wasm,
                own,
                panel,
                {
                  dir: p.dir,
                  t: T,
                  eave: [dx * p.s0, dy * p.s0],
                  topAt: (x, y) => z1 + T * (dx * x + dy * y - p.s0) + rt / cosA,
                  bounds: panel.boundingBox(),
                },
                b,
                b.roofTexture,
              );
              if (joints) panel = whole(own(panel.subtract(joints)));
            }
            const deg = (Math.atan(T) * 180) / Math.PI;
            // The two panels of a two-sided roof also part at the ridge.
            const ridge = p.apart ?? (p.keeps ? [-dx * APART.ridge, -dy * APART.ridge, 0] : [0, 0, 0]);
            const lie = [-deg * dy, deg * dx, 0];
            // Under it a frame, as under a flat roof, following the pitch: its
            // tabs stand square to the panel, in pockets in its underside.
            if (b.roofLip !== 'none' && !shape.saw && !shape.mitred) {
              const { frame, holes } = lipFrame(W, D, { z1, T, dir: p.dir, s0: p.s0 }, { keeps: p.keeps, avoid: clearOfDividers(s), high: KIT.tabRoof });
              panel = minus(panel, ...holes);
              const part = { id: p.id + '-frame', name: p.name.replace('Roof panel', 'Roof frame'), role: 'lip', solid: frame, lie, apart: add3([0, 0, lift + APART.up + APART.roof / 2], ridge) };
              local(...cutFlat(part, plan && [plan.roofX, plan.roofY], [-ov.left, -ov.front]));
            }
            panel = withRooflights(panel, p, z1);
            // Laid flat on its underside: it prints top up, the texture crisp.
            const roof = { id: p.id, name: p.name, role: 'roof', solid: panel, lie, apart: add3(roofApart, ridge) };
            local(...cutFlat(roof, plan && [plan.roofX, plan.roofY], [-ov.left, -ov.front]));
          }
          if (shape.saw) for (const light of northLights(W, D, z1, roofApart)) local(...cutFlat(light, plan && [plan.roofX, plan.roofY], [-ov.left, -ov.front]));
        }
        if (b.chimney) local(chimneyPart(W, D, z1, ov, roofApart));
        b.dormers.forEach((d, i) => local(dormerPart(d, i, z1, roofApart)));
        if (b.gutters) local(...gutterParts(W, D, z1, ov, roofApart));
      }

      // The floor of the storey above: it covers this storey like a flat
      // roof, a lip under it inside these walls, and a groove on top where
      // the walls of the next storey stand.
      const above = storeys[s.n];
      if (above) {
        const slabTop = z1 + KIT.slab;
        // A balcony: the floor reaches out in front, over the garage front; or all round.
        const bal = b.upper[above.n - 2].balcony,
          side = b.upper[above.n - 2].balconyAll ? bal : 0;
        let slab = box(-side, -bal, z1, W + side, D + side, slabTop);
        if (grow) slab = warpedOn(slab);
        for (const { panel, pockets, piece } of railingsOf(s).filter((r) => r.piece.id.startsWith('railing'))) {
          slab = minus(slab, ...pockets);
          local({ id: piece.id, name: piece.name, role: 'frame', solid: panel, outward: [...piece.out, 0], apart: [piece.out[0] * 10, piece.out[1] * 10, lift + APART.storey + 10] });
        }
        const ax = above.ox - s.ox,
          ay = above.oy - s.oy;
        // The frame under the floor: its tabs go through slots in the floor,
        // flush with its top, clear of the groove for the walls above.
        const groovedAt = (q) => {
          const r = KIT.tabLength / 2 + KIT.tabPlay + 1,
            w = KIT.tabThick / 2 + KIT.tabPlay + 1;
          const [hx, hy] = q.d[0] ? [r, w] : [w, r];
          const [x0, y0, x1, y1] = [q.p[0] - hx, q.p[1] - hy, q.p[0] + hx, q.p[1] + hy];
          const out = [ax - c, ay - c, ax + above.width + c, ay + above.depth + c],
            inn = [ax + t + c, ay + t + c, ax + above.width - t - c, ay + above.depth - t - c];
          const meets = x0 < out[2] && x1 > out[0] && y0 < out[3] && y1 > out[1];
          const within = x0 >= inn[0] && x1 <= inn[2] && y0 >= inn[1] && y1 <= inn[3];
          return meets && !within;
        };
        const lipped = lipFrame(W, D, { z1 }, { avoid: (q) => groovedAt(q) || clearOfDividers(s)(q), high: KIT.slab, through: true });
        const frame = lipped.frame,
          holes = grow ? lipped.holes.map(warpedOn) : lipped.holes;
        const groove = minus(
          box(ax - c, ay - c, slabTop - g, ax + above.width + c, ay + above.depth + c, slabTop + 1),
          box(ax + t + c, ay + t + c, slabTop - g - 1, ax + above.width - t - c, ay + above.depth - t - c, slabTop + 2),
        );
        // Exploded, it hangs between the walls below and the walls above.
        const floorApart = [0, 0, lift + APART.storey - APART.up];
        // It prints the right way up, the groove open on top, the slots straight through.
        // Over walls that lean out it is made in its shape: it does not lean with them.
        const floor = { id: 'floor' + above.n, name: 'Floor of storey ' + above.n, role: 'floor', solid: minus(slab, groove, ...holes), lie: [0, 0, 0], apart: floorApart, ...(grow && { shaped: true }) };
        const floorPlan = plan && [plan['floor' + above.n + 'X'], plan['floor' + above.n + 'Y']];
        local(...cutFlat(floor, floorPlan, [-side - (W / 2) * grow, -bal - (D / 2) * grow]));
        local(...cutFlat({ id: 'floor' + above.n + '-frame', name: 'Floor frame, storey ' + above.n, role: 'lip', solid: grow ? warpedOn(frame) : frame, lie: [0, 0, 0], apart: [0, 0, lift + APART.storey - APART.up - 10], ...(grow && { shaped: true }) }, floorPlan, [0, 0]));
      }

      // Corner braces: an L in each inside corner, on the floor against both
      // walls. Each prints lying on the leg along the front or back wall.
      for (const q of braceCorners(b, s, doors)) {
        const k = KIT.brace,
          lo = t + c;
        const alongX = q.sy > 0 ? [lo, lo + k] : [D - lo - k, D - lo],
          alongY = q.sx > 0 ? [lo, lo + k] : [W - lo - k, W - lo];
        const zb = top + Math.min(s.height - KIT.lipDepth - 1, KIT.braceHeight);
        const brace = own(Manifold.union([box(q.x[0], alongX[0], top, q.x[1], alongX[1], zb), box(alongY[0], q.y[0], top, alongY[1], q.y[1], zb)]));
        local({ id: 'brace' + s.suffix + '-' + q.key, name: 'Corner brace, ' + q.name + s.label, role: 'brace', solid: brace, lie: [q.sy > 0 ? 90 : -90, 0, 0], apart: [0, 0, lift + APART.up] });
      }

      if (s.garage && (b.door === 'roller' || b.door === 'panel'))
        for (const door of doors) {
          // A plate behind the opening, standing on the floor inside: with ribs
          // facing out through the opening like the slats of a roller door, or
          // in panels with shallow grooves between them, as an up-and-over door.
          const x0 = door.x - KIT.margin,
            x1 = door.x + door.width + KIT.margin;
          let insert = box(x0, t, top, x1, t + KIT.insert, top + door.height + KIT.margin);
          if (b.door === 'roller') {
            const ribs = [];
            for (let z = top + KIT.ribPitch / 2; z + 1 <= top + door.height; z += KIT.ribPitch)
              ribs.push(box(door.x + 0.5, t - KIT.rib, z, door.x + door.width - 0.5, t, z + 1.6));
            if (ribs.length) insert = own(insert.add(own(Manifold.union(ribs))));
          } else {
            // A face proud of the plate through the opening, four panels high.
            let face = box(door.x + 0.5, t - KIT.rib, top, door.x + door.width - 0.5, t + 0.01, top + door.height - 0.5);
            const grooves = [1, 2, 3].map((k) => box(door.x - 1, t - KIT.rib - 1, top + (k * door.height) / 4 - 0.5, door.x + door.width + 1, t - KIT.rib + 0.6, top + (k * door.height) / 4 + 0.5));
            face = minus(face, ...grooves);
            insert = own(insert.add(face));
          }
          local({ ...doorPart(door, doors, b), solid: insert, outward: [0, -1, 0], apart: [0, APART.door, 0] });
        }
      // Bay numbers: a plaque above each garage door, its number raised in
      // seven segments like the numbers on a pit wall. Glued to the wall.
      for (const q of plaquePlaces(b, doors, s)) {
        const [pw, ph, pt] = KIT.plaque;
        let plaque = box(q.x, q.y, q.z, q.x + pw, q.y + pt, q.z + ph);
        const digits = String(q.number).split('');
        const dw = 5,
          dh = 7,
          st = 1,
          gap = 1.6,
          raise = 0.8;
        const total = digits.length * dw + (digits.length - 1) * gap;
        const segs = [];
        digits.forEach((ch, k) => {
          const x = q.x + pw / 2 - total / 2 + k * (dw + gap),
            z = q.z + (ph - dh) / 2;
          const seg = {
            a: [x, z + dh - st, x + dw, z + dh],
            g: [x, z + dh / 2 - st / 2, x + dw, z + dh / 2 + st / 2],
            d: [x, z, x + dw, z + st],
            f: [x, z + dh / 2, x + st, z + dh],
            b: [x + dw - st, z + dh / 2, x + dw, z + dh],
            e: [x, z, x + st, z + dh / 2],
            c: [x + dw - st, z, x + dw, z + dh / 2],
          };
          for (const name of SEGMENTS[Number(ch)]) {
            const [u0, v0, u1, v1] = seg[name];
            segs.push(box(u0, q.y - raise, v0, u1, q.y + 0.01, v1));
          }
        });
        if (segs.length) plaque = own(plaque.add(own(Manifold.union(segs))));
        local({ id: q.id, name: q.name, role: 'frame', solid: plaque, outward: [0, -1, 0], apart: [0, -APART.out - 10, 0] });
      }
      // Frames: a band around the opening on the outside of the wall, open at
      // the bottom for a door; a window gets bars between its panes, a cross
      // for 2 × 2.
      const { trim: k, trimDepth: fd, bar } = KIT;
      s.openings.forEach((o, i) => {
        if (!o.frame) return;
        const u0 = o.at - o.width / 2,
          u1 = o.at + o.width / 2,
          za = top + o.sill,
          zb = za + o.height;
        const bottom = o.type === 'window' ? za - k : za;
        let frame = o.shape === 'square' ? minus(onWall(o.wall, u0 - k, u1 + k, 0, fd, bottom, zb + k), onWall(o.wall, u0, u1, -1, fd + 1, za, zb)) : onWallShape(o.wall, shapesOf(o).frame.section, 0, fd);
        if (o.shape === 'square' && o.type === 'window' && o.across * o.up > 1) {
          const bars = [];
          for (let j = 1; j < o.across; j++) {
            const u = u0 + (j * (u1 - u0)) / o.across;
            bars.push(onWall(o.wall, u - bar / 2, u + bar / 2, 0, fd, za, zb));
          }
          for (let j = 1; j < o.up; j++) {
            const z = za + (j * (zb - za)) / o.up;
            bars.push(onWall(o.wall, u0, u1, 0, fd, z - bar / 2, z + bar / 2));
          }
          frame = own(frame.add(own(Manifold.union(bars))));
        }
        local({ id: 'frame' + s.suffix + '-' + (i + 1), name: openingName(o, s.openings) + ' frame' + s.label, role: 'frame', solid: frame, outward: OUTWARD[o.wall], apart: add3(wallApart(o.wall), scale3(OUTWARD[o.wall], APART.frame)) });
      });
      // A step in front of a door: a block against the side of the base, half
      // as high, a little wider than the door. It prints as it stands.
      if (s.n === 1)
        s.openings.forEach((o, i) => {
          if (!o.step) return;
          const [reach, wider] = KIT.step;
          const solid = onWall(o.wall, o.at - o.width / 2 - wider, o.at + o.width / 2 + wider, m + reach, m, 0, top / 2);
          local({ id: 'step-' + (i + 1), name: openingName(o, s.openings) + ' step', role: 'buildingBase', solid, lie: [0, 0, 0], apart: scale3(OUTWARD[o.wall], APART.out) });
        });
      // A serving hatch: a counter under the window, a flap propped open over
      // it. Each is a plate on small fins: the fins' back edge lies on the
      // wall (or the window's frame) and sets the plate's angle, so it is
      // glued on square. Each prints flat, its top on the plate, the fins up.
      const ALONG = { front: [[0, 0], [1, 0]], back: [[W, D], [-1, 0]], left: [[0, D], [0, -1]], right: [[W, 0], [0, 1]] };
      const TURN = { front: 0, back: 180, left: 90, right: -90 };
      const hatchPlate = (o, { at, n0, deg, length, thick, fins: fl }) => {
        const [[ox, oy], [dx, dy]] = ALONG[o.wall];
        const out = OUTWARD[o.wall];
        const a = (deg * Math.PI) / 180,
          ca = Math.cos(a),
          sa = Math.sin(a);
        // In the wall's section: n out from the wall, z up. The plate's underside from the hinge out and down.
        const tip = [n0 + length * ca, at - length * sa];
        const plate = [[n0, at], tip, [tip[0] + thick * sa, tip[1] + thick * ca], [n0, at + thick / ca]];
        // Each fin reaches a little up into the plate, so the two are one body.
        const into = 0.4;
        const fin = [[n0, at + into], [n0 + fl * length * ca, at - fl * length * sa + into], [n0, at - HATCH.finDrop * fl * length]];
        const u0 = o.at - o.width / 2 - KIT.trim,
          u1 = o.at + o.width / 2 + KIT.trim;
        const origin = [ox, oy, 0],
          dir = [dx, dy, 0];
        const bits = [sweep(plate, out, [0, 0, 1], origin, dir, u0, u1)];
        // The fins beside the opening: on the frame's sides, or on the wall.
        const f = HATCH.fin;
        for (const [v0, v1] of [[u0 + 0.5, u0 + 0.5 + f], [u1 - 0.5 - f, u1 - 0.5]]) bits.push(sweep(fin, out, [0, 0, 1], origin, dir, v0, v1));
        return { solid: own(Manifold.union(bits)), turn: [TURN[o.wall], 180 - deg] };
      };
      s.openings.forEach((o, i) => {
        const za = top + o.sill,
          zb = za + o.height;
        const where = openingName(o, s.openings);
        const apart = add3(wallApart(o.wall), scale3(OUTWARD[o.wall], APART.frame + 8));
        if (o.counter) {
          const { solid, turn } = hatchPlate(o, { at: (o.frame ? za - k : za) - HATCH.counter[1], n0: 0, deg: 0, length: HATCH.counter[0], thick: HATCH.counter[1], fins: 0.9 });
          local({ id: 'counter' + s.suffix + '-' + (i + 1), name: where + ' counter' + s.label, role: 'frame', solid, turn, apart });
        }
        if (o.flap) {
          const { solid, turn } = hatchPlate(o, { at: o.frame ? zb + k : zb + 1, n0: o.frame ? fd : 0, deg: o.flapAngle, length: o.height + 2 * (o.frame ? k : 1), thick: HATCH.flap, fins: 0.8 });
          local({ id: 'flap' + s.suffix + '-' + (i + 1), name: where + ' flap' + s.label, role: 'door', solid, turn, apart: add3(apart, [0, 0, 8]) });
        }
      });
      // The sign: a board along the top of the front wall of the ground floor, under the eaves, in the middle.
      if (s.n === 1 && b.sign === 'fascia') {
        const sx0 = (W - b.signWidth) / 2,
          sx1 = (W + b.signWidth) / 2;
        // Under a sloped roof that reaches down past the wall, the sign stops under its underside.
        const cap = Math.min(z1, ...[sx0, sx1].flatMap((x) => [0, -HATCH.sign].map((y) => ceilingAt(b, s, shape, x, y)))) - 0.01;
        let sign = onWall('front', sx0, sx1, 0, HATCH.sign, cap - b.signHeight, cap);
        // Its text raised on its face, or cut into it: the face prints up.
        if (b.signText) {
          const h = fitHeight(b.signText, b.signWidth - 4, b.signHeight - 4), z = cap - b.signHeight / 2;
          sign = own(b.signCut ? sign.subtract(lettersOn('front', b.signText, h, W / 2, z, HATCH.sign - LETTERING.depth, HATCH.sign + 1)) : sign.add(lettersOn('front', b.signText, h, W / 2, z, HATCH.sign - 0.01, HATCH.sign + LETTERING.depth)));
        }
        local({ id: 'sign', name: 'Sign', role: 'wall', solid: sign, outward: [0, -1, 0], apart: add3(wallApart('front'), [0, -APART.frame, 0]) });
      }
      // Walls that lean out: everything of this storey widens with the height
      // above its floor, the same way for every part, so they still meet;
      // its roof and frame above the eaves as wide as the tops of the walls.
      if (s.lean) {
        // Widening by one factor in x and y keeps every flat face flat, so the
        // parts still meet; a wall leans out as far as it is from the middle.
        const cx = W / 2,
          cy = D / 2,
          f = grow,
          lean = leanAt;
        // Its outside leans out by (its distance from the middle) × f over
        // the height, its inside a little less. A wall lies on its inside, a
        // frame or a sign on its back against the wall's outside.
        const angle = (w, inset) => (Math.atan(((w === 'front' || w === 'back' ? cy : cx) - inset) * f / s.height) * 180) / Math.PI;
        const LIE = { front: (a) => [-90 - a, 0, 0], back: (a) => [90 + a, 0, 0], left: (a) => [0, 90 + a, 0], right: (a) => [0, -90 - a, 0] };
        const wallOf = (out) => WALLS.find((w) => OUTWARD[w].every((v, i) => v === out[i]));
        for (let i = 0; i < own2.length; i++) {
          const part = own2[i];
          if (part.shaped) continue;
          const w = part.outward && !part.lie && !part.turn ? wallOf(part.outward) : null;
          own2[i] = { ...part, solid: warped(part.solid), ...(w && { lie: LIE[w](angle(w, part.role === 'wall' ? t : 0)) }) };
        }
      }
      // Into place on the storey below.
      for (const part of own2) parts.push(s.ox || s.oy ? { ...part, solid: own(part.solid.translate([s.ox, s.oy, 0])) } : part);
    }
    // A billboard: a board standing on the roof just inside its front edge,
    // over the middle of the top storey, its foot following the roof; two
    // fins behind it rest on the roof and hold it upright. The board prints on
    // its back, its face up; the fins are parts of their own, lying on their
    // side, each glued flat against the back of the board, 3 mm in from its end
    // (a groove there would open onto the plate and print over air).
    if (b.sign === 'billboard') {
      const tops = storeys.at(-1);
      const roofs = own(Manifold.union(parts.filter((p) => p.role === 'roof').map((p) => p.solid)));
      const { fin: [fl, fh, fw], inset, dip } = HATCH.billboard;
      const x0 = tops.ox + (tops.width - b.signWidth) / 2,
        x1 = x0 + b.signWidth;
      // The top of the roof across the board at y: the roof is level along the front.
      const topAt = (y) => {
        const probe = box(x0, y - 0.05, 0, x1, y + 0.05, 1e4);
        const hit = own(roofs.intersect(probe));
        return hit.isEmpty() ? null : hit.boundingBox().max[2];
      };
      const yf = tops.oy - b.overhangFront + inset,
        yb = yf + HATCH.sign;
      const zf = topAt(yf),
        zb = topAt(yb),
        zc = topAt(yb + fl);
      if (zf === null || zb === null || zc === null) throw Error('There is no roof under the billboard.');
      // The roof's surface there, a plane through its top at the front of the
      // board and behind the fins (a texture is only cut into it): the
      // board and the fins stand on that plane.
      const k = (zc - zf) / (yb + fl - yf),
        n = Math.hypot(k, 1);
      const foot = Math.min(zf, zb, zc) - dip;
      const top = Math.max(zf, zb) + b.signHeight;
      let board = box(x0, yf, foot, x1, yb, top);
      // The fins: against the back of the board, no higher than it.
      const finTop = Math.min(zb + fh, top - 1.5);
      const finAt = [x0 + 3, x1 - 3 - fw];
      // Its text, raised on its face or cut into it: the face prints up. The text's frame: x along, y up, z out of the face.
      if (b.signText) {
        const h = fitHeight(b.signText, b.signWidth - 4, b.signHeight - 4);
        const letters = own(raisedText(wasm, own, b.signText, h, [0, 0], ...letterDepth(b.signCut)).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, (x0 + x1) / 2, yf, Math.max(zf, zb) + b.signHeight / 2, 1]));
        board = own(b.signCut ? board.subtract(letters) : board.add(letters));
      }
      // The board and the fins stand on the roof's plane.
      const onRoof = (solid) => trim(solid, [0, -k / n, 1 / n], (zf - k * yf) / n);
      parts.push({ id: 'sign', name: 'Billboard', role: 'wall', solid: onRoof(board), outward: [0, -1, 0], apart: [0, 0, APART.roof + 25] });
      finAt.forEach((fx, i) => {
        const fin = sweep([[yb, zb - dip], [yb, finTop], [yb + fl, zc - dip]], [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], fx, fx + fw);
        parts.push({ id: 'sign-fin-' + (i + 1), name: 'Billboard fin ' + (i + 1), role: 'frame', solid: onRoof(fin), outward: [1, 0, 0], apart: [i ? 8 : -8, 12, APART.roof + 25] });
      });
    }
    // Props: inside on a storey's floor, or on the table outside.
    const propParts = (where) =>
      b.props.flatMap((p, i) => {
        if ((p.storey < 0) !== (where === 'table')) return [];
        const z = p.storey < 0 ? 0 : storeys[p.storey].floor;
        const ids = propPartIds([p]).map((q) => ({ ...q, id: q.id.replace(/^prop-1/, 'prop-' + (i + 1)), name: q.name.replace(/^Prop 1/, 'Prop ' + (i + 1)) }));
        return placeProp(wasm, own, p, z).map((q, k) => ({ ...ids[k], solid: q.solid, turn: q.pose, apart: [0, 0, p.storey < 0 ? 0 : (p.storey) * APART.storey + 6] }));
      });
    parts.push(...propParts('inside'));
    // A fitting or a prop runs into nothing: it says what it meets.
    for (const f of parts.filter((q) => /^(chimney|gutter|downpipe|dormer|prop)/.test(q.id)))
      for (const q of parts) {
        if (q === f || /^(chimney|gutter|downpipe|dormer|prop)/.test(q.id) && q.id <= f.id) continue;
        const both = f.solid.intersect(q.solid);
        const v = both.volume();
        both.delete();
        if (v > 0.01) throw Error('The ' + f.name.toLowerCase() + ' runs into the ' + q.name.toLowerCase() + (f.id.startsWith('downpipe') ? ': put the downpipes at the other end, or move what is in the way.' : f.id.startsWith('prop') ? ': move it.' : '.'));
      }
    if (b.standType !== 'none') {
      const H = b.standHeight;
      for (let i = 0; i < parts.length; i++) parts[i] = { ...parts[i], solid: own(parts[i].solid.translate([0, 0, H])), apart: add3(parts[i].apart ?? [0, 0, 0], [0, 0, STAND.apart]) };
      parts.push(...buildStand(H + b.baseHeight - deck));
    }
    if (b.access !== 'none') parts.push(buildAccess());
    // Props on the table stay on it, whatever the building stands on.
    parts.push(...propParts('table'));
    // What is left out goes: the roof, or a wall and its corner braces.
    for (let i = parts.length - 1; i >= 0; i--) if (!keptPart(b, parts[i].id)) parts.splice(i, 1);
    // The stepped gable: a board on the front wall of the top storey, rising over the roof in steps; it prints on its back.
    if (b.gableFront === 'stepped') {
      const top = storeys[storeys.length - 1],
        lift = b.standType === 'none' ? 0 : b.standHeight;
      const pts = gableFrontOutline(b).map(([u, z]) => [u, z + lift]);
      parts.push({ id: 'gable-front', name: 'Stepped gable', role: 'wall', solid: sweep(pts, [1, 0, 0], [0, 0, 1], [top.ox, top.oy, 0], [0, 1, 0], -GABLE_FRONT.thick, 0), outward: [0, -1, 0], apart: [0, -20, 10] });
    }
    // Inside: the partitions and the stairs, standing on their floors; each stairwell cut in the floor above.
    if (b.partitions.length || b.stairs.length) {
      const lift = b.standType === 'none' ? 0 : b.standHeight;
      const all = storeyStack(b),
        inside = [];
      b.partitions.forEach((q, i) => {
        const s = all[q.storey],
          h = INSIDE.thick / 2,
          zt = s.floor + s.height - KIT.lipDepth - INSIDE.under;
        const along = Math.abs(q.y0 - q.y1) < 1e-9;
        const [u0, u1] = along ? [Math.min(q.x0, q.x1), Math.max(q.x0, q.x1)] : [Math.min(q.y0, q.y1), Math.max(q.y0, q.y1)];
        let wall = along ? box(u0, q.y0 - h, s.floor + lift, u1, q.y0 + h, zt + lift) : box(q.x0 - h, u0, s.floor + lift, q.x0 + h, u1, zt + lift);
        if (q.door) {
          const a = u0 + q.door.at - q.door.width / 2, c = a + q.door.width, z1 = s.floor + q.door.height + lift;
          wall = minus(wall, along ? box(a, q.y0 - h - 1, s.floor + lift - 1, c, q.y0 + h + 1, z1) : box(q.x0 - h - 1, a, s.floor + lift - 1, q.x0 + h + 1, c, z1));
        }
        inside.push({ id: 'partition-' + (i + 1), name: 'Partition ' + (i + 1), role: 'divider', solid: wall, outward: along ? [0, -1, 0] : [-1, 0, 0], apart: [0, 0, APART.up] });
      });
      b.stairs.forEach((q, i) => {
        const f = flightOf(b, q),
          S = INSIDE.stair;
        // The flight in its own frame, seen from its side (v along its run, z up): its steps up from
        // the floor, the top one level with the floor above, on a slab parallel to them; printed on its side.
        const T = S.tread, r = f.rise, n = f.steps;
        const slope = r / T, drop = S.slab * Math.hypot(1, slope);
        const shape = [[0, 0]];
        for (let k = 1; k <= n; k++) shape.push([(k - 1) * T, k * r], [k * T, k * r]);
        shape.push([n * T, n * r - drop], [drop / slope, 0]);
        const flight = sweep(shape, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], 0, S.width);
        // Turned about its middle, then its footprint's corner to (x, y), on its floor.
        const W0 = S.width, D0 = f.run;
        const turned = own(own(own(flight.translate([-W0 / 2, -D0 / 2, 0])).rotate([0, 0, q.rotation])).translate([(f.box[0] + f.box[2]) / 2, (f.box[1] + f.box[3]) / 2, f.floor + lift]));
        const out = { 0: [-1, 0, 0], 90: [0, -1, 0], 180: [1, 0, 0], 270: [0, 1, 0] }[q.rotation];
        inside.push({ id: 'stairs-' + (i + 1), name: 'Stairs ' + (i + 1), role: 'floor', solid: turned, outward: out, apart: [0, 0, APART.up] });
        // The stairwell: through the floor above, over the flight.
        const g = S.well,
          next = q.storey + 2;
        const well = box(f.box[0] - g, f.box[1] - g, f.top - KIT.slab - 1 + lift, f.box[2] + g, f.box[3] + g, f.top + 1 + lift);
        const mine = new RegExp('^floor' + next + '(-\\d+)?$');
        for (const [k, p] of parts.entries()) if (mine.test(p.id)) parts[k] = { ...p, solid: own(p.solid.subtract(well)) };
      });
      // Each runs into nothing else.
      for (const q of inside)
        for (const p of [...parts, ...inside]) {
          if (p === q || (inside.includes(p) && inside.indexOf(p) < inside.indexOf(q))) continue;
          const both = q.solid.intersect(p.solid), v = both.volume();
          both.delete();
          if (v > 0.01) throw Error(q.name + ' runs into the ' + p.name.toLowerCase() + ': move it.');
        }
      parts.push(...inside);
    }
    // The holes for the pins of the doors that swing, through the base or the floor under them.
    if (swingHoles.length) {
      const lift = b.standType === 'none' ? 0 : b.standHeight;
      for (const h of swingHoles) {
        const hole = own(h.solid.translate([h.ox, h.oy, lift]));
        const under = new RegExp((h.n === 1 ? '^base' : '^floor' + h.n) + String.raw`(-\d+)?$`);
        for (const [k, p] of parts.entries()) if (under.test(p.id)) parts[k] = { ...p, solid: own(p.solid.subtract(hole)) };
      }
    }
    // The breaches: each a ragged gap cut down from the top of its wall on the top storey.
    if (b.damage.length) {
      const top = storeys[storeys.length - 1],
        lift = b.standType === 'none' ? 0 : b.standHeight;
      const t = KIT.wall,
        Wt = top.width,
        Dt = top.depth;
      const ALONG = { front: [[0, 0], [1, 0]], back: [[Wt, Dt], [-1, 0]], left: [[0, Dt], [0, -1]], right: [[Wt, 0], [0, 1]] };
      for (const d of b.damage) {
        const [[x0, y0], dir] = ALONG[d.wall],
          inward = OUTWARD[d.wall].map((v) => -v);
        const cutter = sweep(breachOutline(d, top.eave + lift), [...dir, 0], [0, 0, 1], [x0 + top.ox, y0 + top.oy, 0], [inward[0], inward[1], 0], -1, t + 1);
        const mine = new RegExp('^' + d.wall + (top.n > 1 ? top.n : '') + '(-\\d+)?$');
        for (const [i, q] of parts.entries()) {
          if (!mine.test(q.id)) continue;
          let solid = own(q.solid.subtract(cutter));
          // Crumbs left where a breach meets a cut between two pieces are broken away with it; a piece broken in two is not kept.
          const bodies = solid.decompose().map(own);
          if (bodies.length > 1) {
            const biggest = Math.max(...bodies.map((x) => x.volume()));
            const kept = bodies.filter((x) => x.volume() > 0.05 * biggest);
            if (kept.length > 1) throw Error('A breach in the ' + d.wall + ' wall breaks ' + q.name.toLowerCase() + ' in two: move it along the wall, or make it shallower.');
            solid = kept[0];
          }
          parts[i] = { ...q, solid };
        }
      }
    }
    // Keep the parts in the order of the kit; free everything else.
    const order = buildingLayout(b).parts.map((p) => p.id);
    const rank = (id) => order.indexOf(order.includes(id) ? id : id.replace(/-\d+$/, ''));
    parts.sort((a, p) => rank(a.id) - rank(p.id));
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of new Set(temp)) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of new Set(temp)) s.delete();
    throw e;
  }

  // A mesh between u = edge and len - edge, v0 and v1: a plate with square holes through it.
  function meshField(B, len, edge, v0, v1, th) {
    const { hole, bar } = MESH;
    const pitch = hole + bar;
    const nu = Math.max(1, Math.floor((len - 2 * edge - bar) / pitch)),
      nv = Math.max(1, Math.floor((v1 - v0 - bar) / pitch));
    const su = (len - 2 * edge - nu * pitch + bar) / 2,
      sv = (v1 - v0 - nv * pitch + bar) / 2;
    const holesIn = [];
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const u = edge + su + i * pitch,
          v = v0 + sv + j * pitch;
        holesIn.push(B(u, v, -1, u + hole, v + hole, th + 1));
      }
    return own(B(edge - 0.01, v0 - 0.01, 0, len - edge + 0.01, v1 + 0.01, th).subtract(own(Manifold.union(holesIn))));
  }

  /* ---------- The way up ---------- */

  // A ladder leaning on the wall, or a staircase along it with a wall on its
  // outer side, from the table up to the level it goes to. It stands clear
  // of the base's ledge, the relief, a balcony or the roof's overhang.
  function buildAccess() {
    const { sweep, poly } = kitShapes(wasm, own);
    const all = [b, ...b.upper];
    const { against: s, rise, out: extra } = accessPlace(b, all);
    const w = b.accessWall;
    const W = s.width,
      D = s.depth;
    const ALONG = { front: [[0, 0], [1, 0, 0]], back: [[W, D], [-1, 0, 0]], left: [[0, D], [0, -1, 0]], right: [[W, 0], [0, 1, 0]] };
    const [[fx, fy], a] = ALONG[w];
    const outward = OUTWARD[w];
    const relief = s.relief && (s.relief.plinth || s.relief.cornice || s.relief.pilasters) ? RELIEF.depth : 0;
    // Against the base, the relief, a balcony or the roof's overhang; where
    // the stand's feet reach out past the walls on the table, the way up is
    // notched round them, so it still stands against the building.
    const off = Math.max(KIT.ledge, extra, relief) + 0.2;
    const [ft, pad] = STAND.foot,
      g = 0.3;
    const feet = [];
    if (b.standType === 'legs') for (const [cx, cy] of standLegs(b)) feet.push(box(cx - b.standSize / 2 - pad - g, cy - b.standSize / 2 - pad - g, -1, cx + b.standSize / 2 + pad + g, cy + b.standSize / 2 + pad + g, ft + g));
    if (b.standType === 'frames') {
      const [x0, y0, x1, y1] = standInside(b);
      feet.push(box(x0 - pad - g, y0 - pad - g, -1, x1 + pad + g, y1 + pad + g, ft + g));
    }
    if (b.standType === 'tower' || b.standType === 'column') {
      const r = (b.standType === 'tower' ? b.standSize : b.standSize * (1 + b.standTaper / 100)) / 2 + pad + g;
      feet.push(box(b.width / 2 - r, b.depth / 2 - r, -1, b.width / 2 + r, b.depth / 2 + r, ft + g));
    }
    const clearOfFeet = (solid) => (feet.length ? minus(solid, ...feet) : solid);
    // A point u along the wall, n out from its face, at height z.
    const P = (u, n, z) => [s.ox + fx + a[0] * u + outward[0] * n, s.oy + fy + a[1] * u + outward[1] * n, z];
    if (b.access === 'ladder') {
      const Q = ACCESS.ladder;
      const run = rise / Math.tan((Q.angle * Math.PI) / 180),
        ll = Math.hypot(rise, run);
      // Up the ladder, out of its face, across it.
      const t = [-outward[0] * (run / ll), -outward[1] * (run / ll), rise / ll],
        nrm = [outward[0] * (rise / ll), outward[1] * (rise / ll), run / ll];
      const across = [t[1] * nrm[2] - t[2] * nrm[1], t[2] * nrm[0] - t[0] * nrm[2], t[0] * nrm[1] - t[1] * nrm[0]];
      const total = ll + Q.above / t[2] + 4;
      const B = (u0, v0, w0, u1, v1, w1) => own(Manifold.cube([u1 - u0, v1 - v0, w1 - w0]).translate([u0, v0, w0]));
      const bits = [B(0, -4, 0, Q.rail, total, Q.thick), B(Q.width - Q.rail, -4, 0, Q.width, total, Q.thick)];
      for (let v = Q.pitch; v <= ll - 2; v += Q.pitch) bits.push(B(Q.rail - 0.01, v - Q.rung / 2, 0, Q.width - Q.rail + 0.01, v + Q.rung / 2, Q.thick));
      // Its foot on the table, its inside face against the level at the top.
      const foot = P(b.accessAt, off + run, 0);
      // Across it from one rail to the other, centred on accessAt.
      const origin = foot.map((v, i) => v - across[i] * (Q.width / 2));
      let ladder = own(own(Manifold.union(bits)).transform([...across, 0, ...t, 0, ...nrm, 0, ...origin, 1]));
      ladder = clearOfFeet(trim(trim(ladder, [0, 0, 1], 0), [0, 0, -1], -(rise + Q.above)));
      const lie = outward[0] ? [0, (-Math.atan2(nrm[0], nrm[2]) * 180) / Math.PI, 0] : [(Math.atan2(nrm[1], nrm[2]) * 180) / Math.PI, 0, 0];
      return { id: 'access', name: 'Ladder', role: 'frame', solid: ladder, lie, apart: [outward[0] * 20, outward[1] * 20, 0] };
    }
    // A staircase along the wall, rising with u: steps on a slab, a post
    // under the landing at the top, a wall on its outer side.
    const S = ACCESS.stairs;
    const { steps, rise: r, run } = stairsOf(rise);
    const tr = S.tread;
    const outline = [[run, rise], [(steps - 1) * tr, rise]];
    for (let k = steps - 1; k >= 1; k--) outline.push([k * tr, k * r], [(k - 1) * tr, k * r]);
    const slope = r / tr,
      drop = S.slab * Math.hypot(1, slope);
    const zLanding = rise - S.slab,
      sPost = run - S.post;
    const meet = Math.min((zLanding + drop) / slope, sPost);
    outline.push([0, 0], [drop / slope, 0], [meet, zLanding], [sPost, zLanding], [sPost, 0], [run, 0]);
    const [pt, ph] = S.parapet;
    const wallOut = poly([[0, 0], [run, 0], [run, rise + ph], [(steps - 1) * tr, rise + ph], [0, r + ph]]);
    const origin = P(b.accessAt, 0, 0);
    const steps3 = sweep(poly(outline), a, [0, 0, 1], origin, outward, off, off + S.width - pt + 0.01);
    const side = sweep(wallOut, a, [0, 0, 1], origin, outward, off + S.width - pt, off + S.width);
    const solid = clearOfFeet(own(Manifold.union([steps3, side])));
    // It prints lying on its outer wall.
    return { id: 'access', name: 'Staircase', role: 'frame', solid, outward: outward.map((v) => -v), apart: [outward[0] * 20, outward[1] * 20, 0] };
  }

  /* ---------- The stand ---------- */

  // The supports, from the table up to the underside of the base's deck at zTop.
  function buildStand(zTop) {
    const { sweep, truss } = kitShapes(wasm, own);
    const [ft, pad] = STAND.foot,
      ph = STAND.pin[1];
    const pins = standPins(b).map(([x0, y0, x1, y1]) => box(x0, y0, zTop - 0.01, x1, y1, zTop + ph));
    const S = b.standSize;
    const out = [];
    if (b.standType === 'legs') {
      standLegs(b).forEach(([cx, cy], i) => {
        const bits = [box(cx - S / 2 - pad, cy - S / 2 - pad, 0, cx + S / 2 + pad, cy + S / 2 + pad, ft), box(cx - S / 2, cy - S / 2, ft - 0.01, cx + S / 2, cy + S / 2, zTop), pins[i]];
        // Knee braces: from the leg up and out along each wall towards the
        // middle, ending under the deck; steeper than 45°, so they print.
        if (b.standBraces) {
          const { reach, angle, thick } = STAND.knee;
          const rise = reach * Math.tan((angle * Math.PI) / 180),
            k = (S * thick) / 2;
          const sx = cx < b.width / 2 ? 1 : -1,
            sy = cy < b.depth / 2 ? 1 : -1;
          // In the plane along x (or y) through the leg: a bar from the leg's
          // inner face, its bottom end square to the leg, its top level under the deck.
          const tan = Math.tan((angle * Math.PI) / 180),
            d = k / Math.cos((angle * Math.PI) / 180),
            s0 = S / 2 - 0.3,
            zA = zTop - rise;
          const outline = [[s0, zA - d], [s0 + (rise + d) / tan, zTop], [s0 + (rise - d) / tan, zTop], [s0, zA + d]];
          const strut = (along) => {
            const sg = along === 'x' ? sx : sy;
            const pts = outline.map(([u, z]) => [u * sg, z]);
            return along === 'x' ? sweep(pts, [1, 0, 0], [0, 0, 1], [cx, cy, 0], [0, 1, 0], -k, k) : sweep(pts, [0, 1, 0], [0, 0, 1], [cx, cy, 0], [1, 0, 0], -k, k);
          };
          bits.push(strut('x'), strut('y'));
        }
        const solid = own(Manifold.union(bits));
        out.push({ id: 'leg-' + (i + 1), name: 'Leg, ' + LEG_NAMES[i], role: 'frame', solid, lie: [0, 0, 0], apart: [0, 0, 0] });
      });
    } else if (b.standType === 'column') {
      const [cx, cy] = [b.width / 2, b.depth / 2];
      const foot = S * (1 + b.standTaper / 100);
      const h = zTop - ft + 0.01;
      const round = b.standShape === 'round';
      const column = round
        ? own(Manifold.cylinder(h, foot / 2, S / 2, 64)).translate([cx, cy, ft - 0.01])
        : own(own(wasm.CrossSection.square([foot, foot], true)).extrude(h, 0, 0, [S / foot, S / foot])).translate([cx, cy, ft - 0.01]);
      const plate = round ? own(own(Manifold.cylinder(ft, foot / 2 + pad, foot / 2 + pad, 64)).translate([cx, cy, 0])) : box(cx - foot / 2 - pad, cy - foot / 2 - pad, 0, cx + foot / 2 + pad, cy + foot / 2 + pad, ft);
      out.push({ id: 'column', name: round ? 'Round column' : 'Column', role: 'frame', solid: own(Manifold.union([own(column), plate, ...pins])), lie: [0, 0, 0], apart: [0, 0, 0] });
    } else {
      // Four braced frames on a foot plate, the front and the back outside the ends.
      const F = STAND.frame,
        [tl, th] = STAND.tab,
        g = STAND.play;
      const high = zTop - ft;
      const pockets = [];
      for (const f of towerFrames(b)) {
        const { shape } = truss(f.len, high, { member: STAND.member, brace: STAND.brace, bay: STAND.bay, tab: STAND.tab, foot: true });
        const solid = sweep(shape, f.dir, [0, 0, 1], [f.from[0], f.from[1], ft], f.inward, 0, F);
        for (const u of [0.25 * f.len, 0.75 * f.len]) {
          const a = [f.from[0] + f.dir[0] * (u - tl / 2 - g) - f.inward[0] * g, f.from[1] + f.dir[1] * (u - tl / 2 - g) - f.inward[1] * g],
            c = [f.from[0] + f.dir[0] * (u + tl / 2 + g) + f.inward[0] * (F + g), f.from[1] + f.dir[1] * (u + tl / 2 + g) + f.inward[1] * (F + g)];
          pockets.push(box(Math.min(a[0], c[0]), Math.min(a[1], c[1]), ft - th - 0.2, Math.max(a[0], c[0]), Math.max(a[1], c[1]), ft + 1));
        }
        const out3 = f.inward.map((v) => -v);
        out.push({ id: f.id, name: f.name, role: 'frame', solid, outward: out3, apart: [out3[0] * 10, out3[1] * 10, 0] });
      }
      if (b.standType === 'frames') {
        // A ring under the frames, as wide as their feet reach.
        const [x0, y0, x1, y1] = standInside(b),
          w = F + 2 * pad;
        const ring = minus(box(x0 - pad, y0 - pad, 0, x1 + pad, y1 + pad, ft), box(x0 - pad + w, y0 - pad + w, -1, x1 + pad - w, y1 + pad - w, ft + 1));
        out.push({ id: 'stand-foot', name: 'Foot frame', role: 'buildingBase', solid: minus(ring, ...pockets), lie: [0, 0, 0], apart: [0, 0, -10] });
      } else {
        const [cx, cy] = [b.width / 2, b.depth / 2];
        const r = S / 2 + pad;
        out.push({ id: 'tower-foot', name: 'Tower foot', role: 'buildingBase', solid: minus(box(cx - r, cy - r, 0, cx + r, cy + r, ft), ...pockets), lie: [0, 0, 0], apart: [0, 0, -10] });
      }
    }
    return out;
  }

  /* ---------- Cutting to fit the plate ---------- */

  function cs(polys) {
    return own(new wasm.CrossSection(polys, 'NonZero'));
  }
  // The pieces between the seams of one part, in its own 2D frame (u along
  // it, v across): each the region on the low side of its seam, less the
  // region on the low side of the seam before it, grown by the play.
  function strips(cuts, [v0, v1], tabsOf, stepsOf = null) {
    const far = 1e4;
    const lefts = cuts.map((at) => cs(seamRegion(at, [v0, v1], tabsOf(at), stepsOf ? stepsOf(at) : null)));
    return [...lefts, cs([[[-far, v0 - far], [far, v0 - far], [far, v1 + far], [-far, v1 + far]]])].map((region, k) =>
      k ? own(region.subtract(own(lefts[k - 1].offset(JOINT.play, 'Miter', 2)))) : region,
    );
  }
  // Seams the other way: drawn with u along v, then turned.
  function turned(regions) {
    return regions.map((region) => own(region.transform([0, 1, 0, 1, 0, 0, 0, 0, 1])));
  }
  // The pieces of a cut part, numbered. Exploded, they also part at their
  // seams: each moves away from the middle of the part, so the tabs show.
  // A piece in one body or more: a base open for a pit bay, cut across its
  // arms, falls apart into a piece for each arm.
  function bodies(solid) {
    if (solid.isEmpty()) return [];
    const all = solid.decompose().map(own);
    return all.filter((body) => body.volume() > 1);
  }
  function named(part, pieces) {
    if (pieces.length < 2) return pieces.length ? [{ ...part, solid: pieces[0] }] : [part];
    const box = part.solid.boundingBox();
    const mid = box.min.map((v, i) => (v + box.max[i]) / 2);
    return pieces.map((solid, k) => {
      const { min, max } = solid.boundingBox();
      const away = min.map((v, i) => {
        const d = (v + max[i]) / 2 - mid[i];
        return Math.abs(d) > 1 ? Math.sign(d) * APART.piece : 0;
      });
      return { ...part, id: part.id + '-' + (k + 1), name: part.name + ' ' + (k + 1) + ' of ' + pieces.length, solid, apart: add3(part.apart, away) };
    });
  }
  // The base, a floor or the roof: cut both ways in the plan. origin: where
  // the cut places are counted from.
  function cutFlat(part, planned, [x0, y0]) {
    if (!planned || (!planned[0].cuts.length && !planned[1].cuts.length)) return [part];
    const xCuts = planned[0].cuts.map((v) => v + x0),
      yCuts = planned[1].cuts.map((v) => v + y0);
    const { min, max } = part.solid.boundingBox();
    // Seams across x run along y, with their tabs between the y seams; and the other way.
    const xs = strips(xCuts, [min[1], max[1]], () => tabPlaces([min[1], max[1]], yCuts));
    const ys = turned(strips(yCuts, [min[0], max[0]], () => tabPlaces([min[0], max[0]], xCuts)));
    const pieces = [];
    for (const xr of xs)
      for (const yr of ys) {
        const cell = own(xr.intersect(yr));
        if (cell.isEmpty()) continue;
        const prism = own(own(cell.extrude(max[2] - min[2] + 4)).translate([0, 0, min[2] - 2]));
        pieces.push(...bodies(own(part.solid.intersect(prism))));
      }
    return named(part, pieces);
  }
  // A wall: cut along its length, and across its height when it is taller
  // than the plate. A brick or block wall is cut along its joints: along its
  // length the seam steps from course to course, across its height it runs
  // along a course, so either seam is one more joint.
  function cutWall(part, wall, s, { W, D, z0, zTop, top, z1 }) {
    const along = plan?.[part.id]?.cuts ?? [],
      up = plan?.[part.id + 'Z']?.cuts ?? [];
    if (!along.length && !up.length) return [part];
    const tex = textureOf(s, wall);
    const stepped = ['brick', 'block'].includes(tex);
    const k = b.textureScale / 100;
    const rowH = stepped ? DRAWN[tex].course * k : 0,
      brick = stepped ? DRAWN[tex].length * k : 0;
    // The rows of bricks start above a band along the foot of the wall.
    const rows0 = bandTop(s, top);
    const L = part.length ?? wallLength(s, wall);
    // Across the height: measured from the foot of the wall, on a course line for bricks.
    const ups = up.map((v) => (stepped ? rows0 + Math.round((z0 + v - rows0) / rowH) * rowH : z0 + v));
    const openingsAt = (u) => [
      ...(s.garage && wall === 'front' ? doors.filter((door) => u > door.x && u < door.x + door.width).map((door) => [top, top + door.height]) : []),
      ...s.openings.filter((o) => o.wall === wall && Math.abs(u - o.at) < o.width / 2).map((o) => [top + o.sill, top + o.sill + o.height]),
    ];
    const brickSteps = (at) => {
      const rows = [];
      for (let r = -1; rows0 + r * rowH < zTop + rowH; r++) {
        const shift = ((((r % 2) + 2) % 2) * brick) / 2;
        rows.push({ v: rows0 + r * rowH, top: rows0 + (r + 1) * rowH, at: Math.round((at - shift) / brick) * brick + shift });
      }
      rows[0].v = z0 - 1;
      return rows;
    };
    const lengthWise = strips(along, [z0, zTop], (at) => (stepped ? [] : tabPlaces([z0, zTop], [top, z1, ...ups], openingsAt(at), 3)), stepped ? brickSteps : null);
    // Openings the seam across the height runs through, along the wall.
    const gapsAt = (v) => [
      ...(s.garage && wall === 'front' ? doors.filter((door) => v > top && v < top + door.height).map((door) => [door.x, door.x + door.width]) : []),
      ...s.openings.filter((o) => o.wall === wall && v > top + o.sill && v < top + o.sill + o.height).map((o) => [o.at - o.width / 2, o.at + o.width / 2]),
    ];
    const heightWise = turned(strips(ups, [-1, L + 1], (v) => (stepped ? [] : tabPlaces([0, L], along, gapsAt(v), 3))));
    const frame = part.cutFrame ?? {
      // u along the wall, from 2 mm outside it through to 2 mm inside.
      front: [[1, 0, 0], [0, 1, 0], [0, -2, 0]],
      back: [[-1, 0, 0], [0, -1, 0], [W, D + 2, 0]],
      left: [[0, -1, 0], [1, 0, 0], [-2, D, 0]],
      right: [[0, 1, 0], [-1, 0, 0], [W + 2, 0, 0]],
    }[wall];
    const [U, N, O] = frame;
    const pieces = [];
    for (const a of lengthWise)
      for (const h of heightWise) {
        const cell = own(a.intersect(h));
        if (cell.isEmpty()) continue;
        const prism = own(own(cell.extrude(t + 4)).transform([...U, 0, 0, 0, 1, 0, ...N, 0, ...O, 1]));
        pieces.push(...bodies(own(part.solid.intersect(prism))));
      }
    return named(part, pieces);
  }
}

/**
 * A part turned to how it prints, on the plate at the origin: a wall, a
 * frame or the door with its outside face up, the base, a floor and the
 * flat roof upside down, a roof panel lying on its underside.
 */
export function printPose(part) {
  const s = part.solid;
  let turned;
  if (part.turn) {
    // Round z first, then over on its side: a curved grandstand section stood on its end.
    const round = s.rotate([0, 0, part.turn[0]]);
    turned = round.rotate([part.turn[1], 0, 0]);
    round.delete();
  } else if (part.lie) {
    turned = s.rotate(part.lie);
    if (part.flip) {
      const over = turned.rotate([180, 0, 0]);
      turned.delete();
      turned = over;
    }
  } else if (part.flip) turned = s.rotate([180, 0, 0]);
  else {
    const [x, y] = part.outward;
    turned = y < 0 ? s.rotate([-90, 0, 0]) : y > 0 ? s.rotate([90, 0, 0]) : x < 0 ? s.rotate([0, 90, 0]) : s.rotate([0, -90, 0]);
  }
  const { min } = turned.boundingBox();
  const placed = turned.translate([-min[0], -min[1], -min[2]]);
  turned.delete();
  return placed;
}

/** The size of a part as it lies on the plate. */
export function printSize(part) {
  const printed = printPose(part);
  try {
    return printed.boundingBox().max.map((v) => Math.round(v * 10) / 10);
  } finally {
    printed.delete();
  }
}
