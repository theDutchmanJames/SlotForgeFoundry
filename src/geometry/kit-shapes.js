// Shapes the building kits share: boxes, outlines swept along an axis, and
// railing panels that print flat and push into pockets along an edge. Each
// solid made is handed to `own`, which keeps it for cleaning up.

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function kitShapes(wasm, own) {
  const { Manifold, CrossSection } = wasm;
  const box = (x0, y0, z0, x1, y1, z1) => own(Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]));
  /** An outline, whichever way round it is written: counter-clockwise, or it would be empty. */
  const poly = (pts) => {
    let twice = 0;
    for (let i = 0; i < pts.length; i++) twice += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    return own(new CrossSection([twice < 0 ? [...pts].reverse() : pts], 'Positive'));
  };
  /** An outline (or a cross-section) in the plane of a and b from `origin`, swept along `dir` from `from` to `to`. */
  const sweep = (shape, a, b, origin, dir, from, to) => {
    const cs = Array.isArray(shape) ? poly(shape) : shape;
    const c = cross(a, b),
      ahead = c[0] * dir[0] + c[1] * dir[1] + c[2] * dir[2] > 0;
    const o = origin.map((v, i) => v + dir[i] * (ahead ? from : to));
    return own(own(cs.extrude(to - from)).transform([...a, 0, ...b, 0, ...c, 0, ...o, 1]));
  };
  /**
   * A railing panel standing along an edge: a solid band at the foot, posts,
   * a rail on top (and one halfway if `spec.mid`), two tabs down into pockets.
   * It runs from `from` along `dir` for `len`, `inset` in from the edge
   * towards `inward`, standing on `z`. Returns the panel and its pockets.
   */
  const railing = ({ from, dir, len, inward, z, inset, spec: R }) => {
    const B = (u0, v0, w0, u1, v1, w1) => own(Manifold.cube([u1 - u0, v1 - v0, w1 - w0]).translate([u0, v0, w0]));
    const bits = [B(0, 0, 0, len, R.band, R.thick), B(0, R.height - R.post, 0, len, R.height, R.thick)];
    if (R.mid) bits.push(B(0, (R.band + R.height - R.post) / 2 - R.post / 2, 0, len, (R.band + R.height - R.post) / 2 + R.post / 2, R.thick));
    const posts = Math.max(2, Math.ceil(len / R.pitch) + 1);
    for (let k = 0; k < posts; k++) {
      const u = (k * (len - R.post)) / (posts - 1);
      bits.push(B(u, R.band - 0.01, 0, u + R.post, R.height - R.post + 0.01, R.thick));
    }
    const at = [0.2 * len, 0.8 * len];
    for (const u of at) bits.push(B(u - 3, -R.tab, 0, u + 3, 0.01, R.thick));
    // u along the edge, v up, w in from it.
    const frame = [dir[0], dir[1], 0, 0, 0, 0, 1, 0, inward[0], inward[1], 0, 0, from[0] + inward[0] * inset, from[1] + inward[1] * inset, z, 1];
    const place = (solid) => own(solid.transform(frame));
    const panel = place(own(Manifold.union(bits)));
    const pockets = at.map((u) => place(B(u - 3 - 0.2, -R.tab - 0.2, -0.2, u + 3 + 0.2, 0.5, R.thick + 0.2)));
    return { panel, pockets };
  };
  return { box, poly, sweep, railing };
}
