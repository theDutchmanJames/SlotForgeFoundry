// Textures and framed windows for the walls of connected sections and shaped
// footprints, as ordinary buildings have them: the same joints, the same
// frames. Each wall is a straight run with its own frame { id, a, dir, inward, length }.
import { TRIM, checkOpeningShape, openingShapes, outlineOf } from './opening-shapes.js';
import { FINISH_DEFAULTS, TEXTURE_DEFAULTS, TEXTURE_LIMITS, checkFinish, finishJoints, isTextured } from './building-texture.js';

/** A frame round an opening: its width, how far it stands out, the bars between its panes. */
export const SHELL_FRAME = Object.freeze({ trim: 3, depth: 2, bar: 2, paneLeast: 4, panesMost: 6 });
/** The kit's texture size, joint width and depth. */
export const SHELL_TEXTURE_DEFAULTS = Object.freeze({ textureScale: TEXTURE_DEFAULTS.textureScale, textureJoint: TEXTURE_DEFAULTS.textureJoint, textureDepth: TEXTURE_DEFAULTS.textureDepth });
/** The finish of a section or a footprint's walls. */
export const SHELL_FINISH_DEFAULTS = FINISH_DEFAULTS;
export const SHELL_OPENING_KEYS = Object.freeze(['wall', 'type', 'at', 'width', 'height', 'sill', 'frame', 'across', 'up', 'shape', 'ledge', 'lintel', 'shutters', 'leaf']);

export function checkShellTexture(b) {
  for (const [key, label] of [['textureScale', 'Texture size'], ['textureJoint', 'Joint width'], ['textureDepth', 'Joint depth']]) {
    const [lo, hi] = TEXTURE_LIMITS[key];
    if (!Number.isFinite(b[key]) || b[key] < lo || b[key] > hi) throw Error(label + ' must be between ' + lo + ' and ' + hi + (key === 'textureScale' ? ' %.' : ' mm.'));
  }
}
export const checkShellFinish = (s, walls, height, where) => checkFinish({ ...SHELL_FINISH_DEFAULTS, ...s }, walls, height, where);

/** An opening's frame and panes, checked; a door has a frame but no panes. */
export function checkShellOpening(o, where) {
  const p = { frame: false, across: 1, up: 1, ...o };
  if (typeof p.frame !== 'boolean') throw Error(where + ': choose whether the opening has a frame.');
  for (const key of ['across', 'up'])
    if (!Number.isInteger(p[key]) || p[key] < 1 || p[key] > SHELL_FRAME.panesMost) throw Error(where + ': 1 to ' + SHELL_FRAME.panesMost + ' panes ' + key + '.');
  if (p.type === 'door' && (p.across > 1 || p.up > 1)) throw Error(where + ': a door has no panes; those are for a window.');
  if (p.across * p.up > 1 && !p.frame) throw Error(where + ': panes need a frame to hold their bars.');
  if (p.frame && p.type === 'window' && (p.width / p.across < SHELL_FRAME.paneLeast + SHELL_FRAME.bar || p.height / p.up < SHELL_FRAME.paneLeast + SHELL_FRAME.bar))
    throw Error(where + ': the panes are too small, each at least ' + SHELL_FRAME.paneLeast + ' mm.');
  Object.assign(p, checkOpeningShape(p, where));
  if (p.ledge && p.sill < trimOf(p) + TRIM.ledge + 1) throw Error(where + ': the sill under the window needs it at least ' + (trimOf(p) + TRIM.ledge + 1) + ' mm up from the floor.');
  return p;
}
/** How far a frame reaches past the sides and top of its opening. */
export const trimOf = (o) => (o.frame ? SHELL_FRAME.trim : 0);

/**
 * A wall with the joints of its finish cut into its outside: clear of the
 * openings and their frames, and of `avoid`, ranges along the wall where it
 * opens into another section.
 */
export function finishShellWall(wasm, own, solid, w, { floor, top, openings, avoid = [] }, settings, finish) {
  if (!isTextured(finish)) return solid;
  const keepOut = openings.map((o) => {
    const t = trimOf(o);
    // An arch keeps its own shape clear, and its frame round it.
    if ((o.shape ?? 'square') !== 'square') return { poly: outlineOf(o).map(([a, c]) => [o.at + a, floor + o.sill + c]), grow: t };
    return [o.at - o.width / 2 - t, floor + o.sill - (o.type === 'window' ? t : 0), o.at + o.width / 2 + t, floor + o.sill + o.height + t];
  });
  for (const [lo, hi] of avoid) keepOut.push([lo - 1, floor - 5, hi + 1, top + 5]);
  const joints = finishJoints(wasm, own, w.id, { length: w.length, bottom: floor, top, frame: w }, keepOut, settings, finish);
  return joints ? own(solid.subtract(joints)) : solid;
}

/** The frame of an opening: a band round it on the outside, bars between its panes; open at the foot for a door. */
export function shellFrame(o, w, floor, { sweep, own, Manifold, wasm }) {
  const { trim: k, depth: fd, bar } = SHELL_FRAME;
  if ((o.shape ?? 'square') !== 'square') return onShellWall(w, sweep, shellShapes(wasm, own, o, w, floor).frame.section, 0, fd);
  const u0 = o.at - o.width / 2,
    u1 = o.at + o.width / 2,
    za = floor + o.sill,
    zb = za + o.height;
  const on = (a0, c0, a1, c1, from = -fd, to = 0) => sweep([[a0, c0], [a1, c0], [a1, c1], [a0, c1]], [...w.dir, 0], [0, 0, 1], [...w.a, 0], [...w.inward, 0], from, to);
  let frame = own(on(u0 - k, o.type === 'window' ? za - k : za, u1 + k, zb + k).subtract(on(u0, za, u1, zb, -fd - 1, 1)));
  const bars = [];
  for (let j = 1; j < o.across; j++) {
    const u = u0 + (j * (u1 - u0)) / o.across;
    bars.push(on(u - bar / 2, za, u + bar / 2, zb));
  }
  for (let j = 1; j < o.up; j++) {
    const z = za + (j * (zb - za)) / o.up;
    bars.push(on(u0, z - bar / 2, u1, z + bar / 2));
  }
  if (bars.length) frame = own(frame.add(own(Manifold.union(bars))));
  return frame;
}

/** A cross-section in a shell wall's plane (u along it, z up), from n0 to n1 out from its face. */
export const onShellWall = (w, sweep, section, n0, n1) => sweep(section, [...w.dir, 0], [0, 0, 1], [...w.a, 0], [...w.inward, 0], -n1, -n0);
/** An opening's shapes on a shell wall: hole, frame, trims, leaf. */
export const shellShapes = (wasm, own, o, w, floor, wall = 3, sink = 0.1) =>
  openingShapes(wasm, own, { shape: 'square', ledge: false, lintel: false, shutters: false, leaf: 'open', ...o }, { u: o.at, z0: floor + o.sill, wall, k: SHELL_FRAME.trim, depth: SHELL_FRAME.depth, bar: SHELL_FRAME.bar, sink });
/** The hole of an opening through a shell wall `wall` thick. */
export const shellHole = (wasm, own, o, w, floor, wall, sweep) => onShellWall(w, sweep, shellShapes(wasm, own, o, w, floor, wall).hole, -wall - 1, 1);
/**
 * A shell wall with its openings' sills, lintels and shutters standing out of
 * its face, and its doors' leaves in the backs of their doorways.
 */
export function shellExtras(wasm, own, solid, w, { floor, wall, openings }, settings, finish, sweep) {
  const sink = isTextured(finish) ? settings.textureDepth + 0.1 : 0.01;
  const add = [],
    cut = [];
  for (const o of openings) {
    if (!o.ledge && !o.lintel && !o.shutters && (o.type !== 'door' || (o.leaf ?? 'open') === 'open')) continue;
    const shapes = shellShapes(wasm, own, o, w, floor, wall, sink);
    for (const r of shapes.relief) (r.cut ? cut : add).push(onShellWall(w, sweep, r.section, r.from, r.to));
    if (shapes.leaf) {
      const L = shapes.leaf;
      add.push(onShellWall(w, sweep, L.section, L.from, L.to));
      for (const c of L.cuts) cut.push(onShellWall(w, sweep, c, L.to - TRIM.deep, L.to + 0.5));
      if (L.glass) cut.push(onShellWall(w, sweep, L.glass, L.from - 0.5, L.to + 0.5));
    }
  }
  if (add.length) solid = own(solid.add(own(wasm.Manifold.union(add))));
  if (cut.length) solid = own(solid.subtract(own(wasm.Manifold.union(cut))));
  return solid;
}
