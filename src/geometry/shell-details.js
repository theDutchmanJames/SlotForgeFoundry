// Textures and framed windows for the walls of connected sections and shaped
// footprints, as ordinary buildings have them: the same joints, the same
// frames. Each wall is a straight run with its own frame { id, a, dir, inward, length }.
import { FINISH_DEFAULTS, TEXTURE_DEFAULTS, TEXTURE_LIMITS, checkFinish, finishJoints, isTextured } from './building-texture.js';

/** A frame round an opening: its width, how far it stands out, the bars between its panes. */
export const SHELL_FRAME = Object.freeze({ trim: 3, depth: 2, bar: 2, paneLeast: 4, panesMost: 6 });
/** The kit's texture size, joint width and depth. */
export const SHELL_TEXTURE_DEFAULTS = Object.freeze({ textureScale: TEXTURE_DEFAULTS.textureScale, textureJoint: TEXTURE_DEFAULTS.textureJoint, textureDepth: TEXTURE_DEFAULTS.textureDepth });
/** The finish of a section or a footprint's walls. */
export const SHELL_FINISH_DEFAULTS = FINISH_DEFAULTS;
export const SHELL_OPENING_KEYS = Object.freeze(['wall', 'type', 'at', 'width', 'height', 'sill', 'frame', 'across', 'up']);

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
    return [o.at - o.width / 2 - t, floor + o.sill - (o.type === 'window' ? t : 0), o.at + o.width / 2 + t, floor + o.sill + o.height + t];
  });
  for (const [lo, hi] of avoid) keepOut.push([lo - 1, floor - 5, hi + 1, top + 5]);
  const joints = finishJoints(wasm, own, w.id, { length: w.length, bottom: floor, top, frame: w }, keepOut, settings, finish);
  return joints ? own(solid.subtract(joints)) : solid;
}

/** The frame of an opening: a band round it on the outside, bars between its panes; open at the foot for a door. */
export function shellFrame(o, w, floor, { sweep, own, Manifold }) {
  const { trim: k, depth: fd, bar } = SHELL_FRAME;
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
