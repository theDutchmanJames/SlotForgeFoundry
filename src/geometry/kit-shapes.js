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
    // Crosses: an X between each two posts, its bars as wide as a post
    // (spec.cross); or a truss, one diagonal between each two posts, the next
    // the other way, so they make triangles (spec.truss).
    if (R.cross || R.truss) {
      const v0 = R.band,
        v1 = R.height - R.post,
        b = R.post / 2;
      const bar = (a, c) => {
        const d = [c[0] - a[0], c[1] - a[1]],
          l = Math.hypot(...d),
          nn = [(-d[1] / l) * b, (d[0] / l) * b];
        return poly([[a[0] - nn[0], a[1] - nn[1]], [c[0] - nn[0], c[1] - nn[1]], [c[0] + nn[0], c[1] + nn[1]], [a[0] + nn[0], a[1] + nn[1]]]);
      };
      for (let k = 0; k + 1 < posts; k++) {
        const u0 = (k * (len - R.post)) / (posts - 1) + R.post,
          u1 = ((k + 1) * (len - R.post)) / (posts - 1);
        // A little into the posts, the band and the rail round it, so the X is one with them.
        const field = poly([[u0 - 0.3, v0 - 0.3], [u1 + 0.3, v0 - 0.3], [u1 + 0.3, v1 + 0.3], [u0 - 0.3, v1 + 0.3]]);
        const bars = R.cross ? [bar([u0, v0], [u1, v1]), bar([u0, v1], [u1, v0])] : [k % 2 ? bar([u0, v1], [u1, v0]) : bar([u0, v0], [u1, v1])];
        const x = own(own(CrossSection.union(bars)).intersect(field));
        bits.push(own(x.extrude(R.thick)));
      }
    }
    // Mesh: the field between the end posts filled, square holes through it (spec.mesh: [hole, bar]).
    if (R.mesh) {
      const [hole, bar] = R.mesh,
        pitch = hole + bar,
        v0 = R.band,
        v1 = R.height - R.post;
      const nu = Math.max(1, Math.floor((len - 2 * R.post - bar) / pitch)),
        nv = Math.max(1, Math.floor((v1 - v0 - bar) / pitch));
      const su = (len - 2 * R.post - nu * pitch + bar) / 2,
        sv = (v1 - v0 - nv * pitch + bar) / 2;
      const holes = [];
      for (let i = 0; i < nu; i++)
        for (let j = 0; j < nv; j++) holes.push(B(R.post + su + i * pitch, v0 + sv + j * pitch, -1, R.post + su + i * pitch + hole, v0 + sv + j * pitch + hole, R.thick + 1));
      bits.push(own(B(R.post - 0.01, v0 - 0.01, 0, len - R.post + 0.01, v1 + 0.01, R.thick).subtract(own(Manifold.union(holes)))));
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
  /**
   * A braced frame in its own plane (u along it, v up), as an outline: legs
   * at its ends and between its bays, a chord at the foot and at the top, an
   * X of braces in each bay; tabs on top (and under it, if `foot`), a
   * quarter of the way in from each end. Returns the outline and where the tabs are.
   */
  const truss = (len, high, { member: M, brace, bay, tab: [tl, th], foot = false }) => {
    const bays = Math.max(1, Math.ceil((len - M) / bay));
    const legs = Array.from({ length: bays + 1 }, (_, k) => (k * (len - M)) / bays);
    const bits = [poly([[0, 0], [len, 0], [len, M], [0, M]]), poly([[0, high - M], [len, high - M], [len, high], [0, high]])];
    for (const u of legs) bits.push(poly([[u, 0], [u + M, 0], [u + M, high], [u, high]]));
    const b = brace / 2;
    const bar = (a, c) => {
      const d = [c[0] - a[0], c[1] - a[1]],
        l = Math.hypot(...d),
        n = [(-d[1] / l) * b, (d[0] / l) * b];
      return poly([[a[0] - n[0], a[1] - n[1]], [c[0] - n[0], c[1] - n[1]], [c[0] + n[0], c[1] + n[1]], [a[0] + n[0], a[1] + n[1]]]);
    };
    for (let k = 0; k < bays; k++) {
      const u0 = legs[k] + M,
        u1 = legs[k + 1],
        v0 = M,
        v1 = high - M;
      const inside = poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      bits.push(own(own(CrossSection.union([bar([u0, v0], [u1, v1]), bar([u0, v1], [u1, v0])])).intersect(inside)));
    }
    const tabs = [0.25 * len, 0.75 * len];
    for (const u of tabs) {
      bits.push(poly([[u - tl / 2, high - 0.01], [u + tl / 2, high - 0.01], [u + tl / 2, high + th], [u - tl / 2, high + th]]));
      if (foot) bits.push(poly([[u - tl / 2, -th], [u + tl / 2, -th], [u + tl / 2, 0.01], [u - tl / 2, 0.01]]));
    }
    return { shape: own(CrossSection.union(bits)), tabs };
  };
  return { box, poly, sweep, railing, truss };
}
