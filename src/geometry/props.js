// Props: the small things in and around a race circuit's buildings, at 1:32.
// Each is one part or a few that glue together, every part printing as it
// lies without supports: round things stand on their bases, their grooves
// V-shaped; boxes with fronts lie on their backs; tables and benches come as
// flat frames and tops. A prop is drawn in its own frame, x across its width,
// y front to back, z up from the floor, the front at y = 0; each part says
// how it lies to print, [turn about z, then over about x], in that frame.

import { kitShapes } from './kit-shapes.js';
import { LETTERING, fitHeight, raisedText, textWidth } from './lettering.js';

/** The props: id, name, group, size [width, depth, height] in mm. */
export const PROPS = Object.freeze([
  { id: 'tyre-stack', name: 'Stack of tyres', group: 'Pit lane', size: [19, 19, 24] },
  { id: 'tyre', name: 'Tyre', group: 'Pit lane', size: [19, 19, 6] },
  { id: 'tool-chest', name: 'Tool chest', group: 'Pit lane', size: [20, 12, 26] },
  { id: 'workbench', name: 'Workbench', group: 'Pit lane', size: [44, 16, 27] },
  { id: 'gas-bottle', name: 'Gas bottle', group: 'Pit lane', size: [9, 9, 28] },
  { id: 'drum', name: 'Oil drum', group: 'Pit lane', size: [18, 18, 27] },
  { id: 'pit-board', name: 'Pit board', group: 'Pit lane', size: [14, 12, 40] },
  { id: 'cone', name: 'Cone', group: 'Circuit', size: [11, 11, 15] },
  { id: 'barrier', name: 'Crowd barrier', group: 'Circuit', size: [40, 10, 20] },
  { id: 'extinguisher', name: 'Fire extinguisher', group: 'Circuit', size: [5, 5, 16] },
  { id: 'podium', name: 'Podium', group: 'Circuit', size: [42, 12, 12] },
  { id: 'parasol', name: 'Parasol', group: 'Paddock', size: [28, 28, 32] },
  { id: 'crate', name: 'Crate', group: 'Paddock', size: [24, 18, 16] },
  { id: 'table', name: 'Table', group: 'Paddock', size: [30, 16, 23] },
  { id: 'counter', name: 'Counter', group: 'Paddock', size: [42, 12, 18] },
  { id: 'rubble', name: 'Rubble', group: 'Paddock', size: [28, 22, 12] },
  { id: 'fuel-pump', name: 'Fuel pump', group: 'Paddock', size: [10, 9, 24] },
  { id: 'brake-150', name: 'Braking board 150', group: 'Signs', size: [22, 10, 42] },
  { id: 'brake-100', name: 'Braking board 100', group: 'Signs', size: [22, 10, 42] },
  { id: 'brake-50', name: 'Braking board 50', group: 'Signs', size: [22, 10, 42] },
  { id: 'chevron-left', name: 'Chevrons, left', group: 'Signs', size: [30, 10, 26] },
  { id: 'chevron-right', name: 'Chevrons, right', group: 'Signs', size: [30, 10, 26] },
  { id: 'pit-in', name: 'Pit in sign', group: 'Signs', size: [36, 10, 28] },
  { id: 'pit-out', name: 'Pit out sign', group: 'Signs', size: [36, 10, 28] },
]);
/** The props of several parts, and what each part is called. */
export const PROP_PARTS = Object.freeze({
  workbench: ['top', 'end-1', 'end-2', 'shelf'],
  table: ['top', 'end-1', 'end-2'],
  'pit-board': ['board', 'foot'],
  parasol: ['canopy', 'pole', 'foot'],
  ...Object.fromEntries(['brake-150', 'brake-100', 'brake-50', 'chevron-left', 'chevron-right', 'pit-in', 'pit-out'].map((id) => [id, ['board', 'foot']])),
});
export const PROP_IDS = PROPS.map((p) => p.id);
export const propOf = (id) => PROPS.find((p) => p.id === id);
/** How much room props keep between them, and to whatever stands near. */
export const PROP_GAP = 2;
// How deep a socket's clearance is, all round.
const PLAY = 0.2;

/** A prop's footprint, turned by `rotation` (0, 90, 180 or 270): [width, depth] on the plan. */
export function propFootprint(type, rotation = 0) {
  const [w, d] = propOf(type).size;
  return rotation % 180 ? [d, w] : [w, d];
}

/**
 * The parts of a prop in its own frame: each { key, name, solid, pose }, pose
 * the [z, x] turn that lays it to print.
 */
export function propParts(wasm, own, type) {
  const { Manifold, CrossSection } = wasm;
  const { box, sweep } = kitShapes(wasm, own);
  const prop = propOf(type);
  if (!prop) throw Error('There is no prop called ' + type + '.');
  const [W, D, H] = prop.size;
  // A solid of revolution about the vertical through (cx, cy), from a profile [r, z] drawn up its side, counter-clockwise.
  const turned = (pts, cx = W / 2, cy = D / 2) => own(own(Manifold.revolve(own(new CrossSection([pts], 'Positive')), 64)).translate([cx, cy, 0]));
  const minus = (a, ...cuts) => (cuts.length ? own(a.subtract(own(Manifold.union(cuts)))) : a);
  const union = (...bits) => own(Manifold.union(bits));
  const flat = [0, 0],
    onBack = [0, -90]; // the back face down, the front up
  const parts = [];
  const add = (key, name, solid, pose = flat) => parts.push({ key, name, solid, pose });

  if (type === 'tyre-stack' || type === 'tyre') {
    // Tyres one on another, a V between each two; a bore through them all.
    const R = W / 2,
      ri = 5,
      n = type === 'tyre' ? 1 : 4,
      h = H / n;
    const pts = [[ri, 0], [R - 1, 0]];
    for (let k = 0; k < n; k++) pts.push([R, k * h + 1], [R, (k + 1) * h - 1], [R - 1, (k + 1) * h]);
    pts.push([ri, H]);
    add('', prop.name, turned(pts));
  } else if (type === 'drum') {
    // An oil drum: two V-grooves round it, two bungs on its lid.
    const R = W / 2;
    const pts = [[0, 0], [R, 0]];
    for (const z of [H / 3, (2 * H) / 3]) pts.push([R, z - 0.7], [R - 0.7, z], [R, z + 0.7]);
    pts.push([R, H], [0, H]);
    const bungs = [[W / 2 - 4, D / 2], [W / 2 + 4, D / 2 + 2]].map(([x, y]) => own(own(Manifold.cylinder(1, 1.5, 1.5, 24)).translate([x, y, H])));
    add('', prop.name, union(turned(pts), ...bungs));
  } else if (type === 'gas-bottle') {
    // A tall bottle, its shoulder at 45°, a neck and a valve.
    const R = W / 2;
    add('', prop.name, turned([[0, 0], [R, 0], [R, H - 6], [1.5, H - 6 + (R - 1.5)], [1.5, H], [0, H]]));
  } else if (type === 'extinguisher') {
    const R = W / 2;
    add('', prop.name, turned([[0, 0], [R, 0], [R, H - 3], [1, H - 3 + (R - 1)], [1, H], [0, H]]));
  } else if (type === 'cone') {
    // A square foot, a cone on it.
    const foot = box(0, 0, 0, W, D, 1.2);
    const body = own(own(Manifold.cylinder(H - 1.2, W / 2 - 1, 1.2, 48)).translate([W / 2, D / 2, 1.2]));
    add('', prop.name, union(foot, body));
  } else if (type === 'fuel-pump') {
    // On a plinth, its head standing out at the front over a 45° shoulder, so it prints standing. Seen from its side, swept across.
    const side = [[0, 0], [D, 0], [D, 2], [D - 1, 2], [D - 1, 16], [D, 17], [D, H], [0, H]].map(([y, z]) => [D - y, z]);
    add('', prop.name, sweep(side, [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], 0, W));
  } else if (type === 'rubble') {
    // A heap of broken blocks, each lying on the one under it, inside its top: nothing over air.
    const heap = [box(0, 0, 0, W, D, 4), box(2, 1.5, 3.99, W - 5, D - 3, 8), box(6, 4, 7.99, W - 11, D - 8, H)];
    // Chunks turned about the upright, each inside the top of the block under it.
    const chunk = (x, y, w, d, z0, z1, deg) => own(own(box(-w / 2, -d / 2, z0, w / 2, d / 2, z1).rotate([0, 0, deg])).translate([x, y, 0]));
    heap.push(chunk(W - 4.5, D / 2, 4, 6, 3.99, 7, 25), chunk(5, D - 4, 5, 3.5, 3.99, 6.5, -20), chunk(W / 2 + 2, D / 2 + 1, 4, 3, 7.99, 10.5, 35));
    add('', prop.name, union(...heap));
  } else if (type === 'crate') {
    // A box of upright boards: grooves down each side.
    let crate = box(0, 0, 0, W, D, H);
    const cuts = [];
    for (let x = 6; x < W - 2; x += 6) cuts.push(box(x - 0.3, -1, -1, x + 0.3, 0.4, H + 1), box(x - 0.3, D - 0.4, -1, x + 0.3, D + 1, H + 1));
    for (let y = 6; y < D - 2; y += 6) cuts.push(box(-1, y - 0.3, -1, 0.4, y + 0.3, H + 1), box(W - 0.4, y - 0.3, -1, W + 1, y + 0.3, H + 1));
    crate = minus(crate, ...cuts);
    add('', prop.name, crate);
  } else if (type === 'tool-chest') {
    // A chest of drawers on a plinth, a raised handle on each drawer; it lies on its back to print.
    let chest = union(box(0, 0, 0, W, D, H), box(-0.5, -0.5, H - 1, W + 0.5, D, H));
    const drawers = 5,
      z0 = 2,
      dh = (H - 4) / drawers;
    const cuts = [box(0.8, -1, 0, W - 0.8, 0.6, z0 - 0.4)]; // the plinth, set back
    const handles = [];
    for (let k = 0; k <= drawers; k++) cuts.push(box(-1, -1, z0 + k * dh - 0.3, W + 1, 0.4, z0 + k * dh + 0.3));
    for (let k = 0; k < drawers; k++) handles.push(box(W / 2 - 4, -0.8, z0 + k * dh + dh / 2 - 0.5, W / 2 + 4, 0.01, z0 + k * dh + dh / 2 + 0.5));
    chest = union(minus(chest, ...cuts), ...handles);
    add('', prop.name, chest, onBack);
  } else if (type === 'counter') {
    // A counter: its body, a top reaching over its front and ends; it lies on its back to print.
    const t = 1.5,
      over = 1.5;
    const body = box(over, over, 0, W - over, D, H - t);
    const top = box(0, 0, H - t, W, D, H);
    const panels = [];
    for (let x = over + 3; x + 9 < W - over - 2; x += 11) panels.push(box(x, over - 0.4, 3, x + 9, over + 0.01, H - t - 3));
    add('', prop.name, minus(union(body, top), ...panels), onBack);
  } else if (type === 'workbench' || type === 'table') {
    // A top, two end frames standing on the floor under it, each flat, and on a
    // workbench a shelf low down on ledges inside the frames.
    const t = 1.5,
      leg = 1.6,
      inset = 3;
    const shelf = type === 'workbench';
    add('top', 'top', box(0, 0, H - t, W, D, H));
    for (const side of [0, 1]) {
      const x0 = side ? W - inset - t : inset;
      const bits = [box(x0, 0, 0, x0 + t, leg, H - t), box(x0, D - leg, 0, x0 + t, D, H - t), box(x0, 0, H - t - 2.5, x0 + t, D, H - t)];
      if (shelf) {
        bits.push(box(x0, 0, 4, x0 + t, D, 5.5));
        // A ledge on its inside face for the shelf.
        bits.push(side ? box(x0 - 1.5, leg, 4, x0 + 0.01, D - leg, 5.5) : box(x0 + t - 0.01, leg, 4, x0 + t + 1.5, D - leg, 5.5));
      }
      // Flat on its outside face: the ledge stands up.
      add('end-' + (side + 1), 'end ' + (side + 1), union(...bits), side ? [-90, 90] : [90, 90]);
    }
    if (shelf) add('shelf', 'shelf', box(inset + t + PLAY, leg + PLAY, 5.5, W - inset - t - PLAY, D - leg - PLAY, 6.5));
  } else if (type === 'pit-board') {
    // A board on a pole, its number raised, lying on its back to print; the pole stands in a socket in a foot.
    const pole = 2,
      foot = 1.5;
    // The pole in the middle of the foot, the board's back flush with it.
    const px = (W - pole) / 2,
      py = (D - pole) / 2;
    const board = box(0, py, H - 12, W, py + pole, H);
    const stick = box(px, py, 0, px + pole, py + pole, H);
    let sign = union(board, stick);
    const text = 'P1',
      h = Math.max(LETTERING.height[0], Math.min(8, (W - 3) / (textWidth(text, 1) || 1)));
    const letters = own(raisedText(wasm, own, text, h, [0, 0], -0.1, 0.6).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, W / 2, py, H - 6, 1]));
    sign = union(sign, letters);
    add('board', 'board', sign, onBack);
    const base = minus(box(W / 2 - 6, D / 2 - 5, 0, W / 2 + 6, D / 2 + 5, foot), box(px - PLAY, py - PLAY, -1, px + pole + PLAY, py + pole + PLAY, foot + 1));
    add('foot', 'foot', base);
  } else if (/^(brake|chevron|pit-(in|out))/.test(type)) {
    // A sign on two posts: its board on top, its legend raised on its front;
    // it lies on its back to print, the posts' backs flush with the board's.
    // The posts stand in sockets in a foot along the bottom.
    // The board as thick as the posts, so they keep behind it.
    const post = 2,
      foot = 1.5,
      th = post,
      bh = type.startsWith('brake') ? 26 : 12;
    const py = (D - post) / 2;
    const posts = [3, W - 3 - post];
    const bits = [box(0, py + post - th, H - bh, W, py + post, H), ...posts.map((x) => box(x, py, 0, x + post, py + post, H - 0.5))];
    // The legend, in the board's frame: across it from its middle, up it from its middle.
    const face = py + post - th;
    const onFace = (solid) => own(solid.transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, W / 2, face, H - bh / 2, 1]));
    if (type.startsWith('chevron')) {
      // Three chevrons pointing the way, each a V of two bars.
      const left = type.endsWith('left'),
        h = bh - 4,
        bar = 1.6,
        step = 7;
      for (const k of [-1, 0, 1]) {
        const c = k * step,
          tip = left ? -2.5 : 2.5;
        const pts = left
          ? [[c + tip, 0], [c + tip + h / 2, h / 2], [c + tip + h / 2 + bar, h / 2], [c + tip + bar, 0], [c + tip + h / 2 + bar, -h / 2], [c + tip + h / 2, -h / 2]]
          : [[c + tip, 0], [c + tip - h / 2, -h / 2], [c + tip - h / 2 - bar, -h / 2], [c + tip - bar, 0], [c + tip - h / 2 - bar, h / 2], [c + tip - h / 2, h / 2]];
        // Counter-clockwise, as the fill wants it, whichever way it points.
        let twice = 0;
        for (let i = 0; i < pts.length; i++) twice += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
        bits.push(onFace(own(own(new CrossSection([twice < 0 ? pts.reverse() : pts], 'Positive')).extrude(0.7)).translate([0, 0, -0.1])));
      }
    } else {
      const text = { 'brake-150': '150', 'brake-100': '100', 'brake-50': '50', 'pit-in': 'PIT IN', 'pit-out': 'PIT OUT' }[type];
      const h = fitHeight(text, W - 4, bh - 4);
      bits.push(onFace(raisedText(wasm, own, text, h, [0, 0], -0.1, 0.6)));
    }
    add('board', 'board', union(...bits), onBack);
    const base = minus(box(0, 0, 0, W, D, foot), ...posts.map((x) => box(x - PLAY, py - PLAY, -1, x + post + PLAY, py + post + PLAY, foot + 1)));
    add('foot', 'foot', base);
  } else if (type === 'barrier') {
    // A crowd barrier: a frame of bars and its feet behind it; it lies on its front.
    const t = 1.5,
      bar = 0.9;
    const bits = [box(0, 0, 0, t, t, H), box(W - t, 0, 0, W, t, H), box(0, 0, H - t, W, t, H), box(0, 0, 2, W, t, 2 + t)];
    for (let x = t + 3; x < W - t - 1; x += 3.2) bits.push(box(x, 0, 2, x + bar, t, H - t));
    for (const x of [0, W - t]) bits.push(box(x, 0, 0, x + t, D, 1.2));
    add('', prop.name, union(...bits), [0, 90]);
  } else if (type === 'podium') {
    // Three steps, the winner's in the middle; their numbers raised on top.
    const w = W / 3;
    const steps = [[w, 8, '2'], [2 * w, H, '1'], [3 * w, 5, '3']];
    const bits = steps.map(([x1, h], i) => box(i * w, 0, 0, x1, D, h));
    for (const [x1, h, n] of steps) bits.push(own(raisedText(wasm, own, n, 6, [0, 0], -0.1, 0.6).translate([x1 - w / 2, D / 2, h])));
    add('', prop.name, union(...bits));
  } else if (type === 'parasol') {
    // A low eight-sided canopy, flat underneath; a square pole through it into a round foot.
    const pole = 1.6,
      high = 4,
      foot = 2;
    const cx = W / 2,
      cy = D / 2;
    const hole = (z0, z1) => box(cx - pole / 2 - PLAY, cy - pole / 2 - PLAY, z0, cx + pole / 2 + PLAY, cy + pole / 2 + PLAY, z1);
    const canopy = minus(own(own(Manifold.cylinder(high, W / 2, 0.8, 8)).translate([cx, cy, H - high])), hole(H - high - 1, H + 1));
    add('canopy', 'canopy', canopy);
    add('pole', 'pole', box(cx - pole / 2, cy - pole / 2, 0, cx + pole / 2, cy + pole / 2, H - 1.5), [0, 90]);
    // The foot on the floor, the pole standing in the hole through it.
    add('foot', 'foot', minus(own(own(Manifold.cylinder(foot, 6, 5, 48)).translate([cx, cy, 0])), hole(-1, foot + 1)));
  }
  return parts;
}

/**
 * A prop placed: its parts turned by `rotation` about z and moved so its
 * footprint's corner nearest the origin is at (x, y), standing on z. Each
 * part's print turn follows the rotation, so it still lies as it should.
 */
export function placeProp(wasm, own, { type, x, y, rotation = 0 }, z) {
  const [W, D] = propOf(type).size;
  const parts = propParts(wasm, own, type);
  // Turned about its middle, then its footprint's corner to (x, y).
  const [fw, fd] = propFootprint(type, rotation);
  return parts.map((p) => {
    const turned = own(own(p.solid.translate([-W / 2, -D / 2, 0])).rotate([0, 0, rotation]));
    return { ...p, solid: own(turned.translate([x + fw / 2, y + fd / 2, z])), pose: [p.pose[0] - rotation, p.pose[1]] };
  });
}

/** Checks a list of props on a plan: known, turned square, each where it is meant to be. */
/** The parts of a list of props: one each, or for a prop of several parts each of them. */
export function propPartIds(props) {
  return props.flatMap((p, i) => {
    const name = 'Prop ' + (i + 1) + ', ' + propOf(p.type).name.toLowerCase();
    return (PROP_PARTS[p.type] ?? ['']).map((key) => ({ id: 'prop-' + (i + 1) + (key ? '-' + key : ''), name: name + (key ? ', ' + key.replace('-', ' ') : ''), role: 'frame' }));
  });
}
export function checkPropList(list, where = '') {
  if (!Array.isArray(list) || list.length > 40) throw Error('At most 40 props' + where + '.');
  return list.map((p, i) => {
    const name = 'Prop ' + (i + 1) + where;
    if (!p || typeof p !== 'object' || Object.keys(p).some((k) => !['type', 'x', 'y', 'rotation', 'storey'].includes(k))) throw Error(name + ' has a type, a place, a turn and a storey.');
    if (!propOf(p.type)) throw Error(name + ': choose a prop from the list.');
    const q = { type: p.type, x: p.x ?? 0, y: p.y ?? 0, rotation: p.rotation ?? 0, storey: p.storey ?? 0 };
    if (![q.x, q.y].every(Number.isFinite)) throw Error(name + ' needs a place.');
    if (![0, 90, 180, 270].includes(q.rotation)) throw Error(name + ' turns 0, 90, 180 or 270°.');
    if (!Number.isInteger(q.storey) || q.storey < -1) throw Error(name + ' stands on a storey, or on the table outside.');
    return q;
  });
}
