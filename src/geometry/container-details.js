// Shipping-container relief, fused into the existing printable wall and roof panels.
// Sizes are model details in mm, intentionally robust rather than ISO hardware.
export function checkContainer(b, openings) {
  if (!['none', 'frame', 'left', 'right'].includes(b.container)) throw Error('Choose container details from the list.');
  if (b.container === 'none') return;
  if (b.upper.length || b.roof !== 'flat' || b.arch || b.lean || b.open || b.wallStyle !== 'solid' || b.rooms || b.door !== 'none')
    throw Error('Container details need one enclosed storey, a flat roof, no garage door and no dividing walls.');
  if (b.plinth || b.cornice || b.pilasters || b.panels || b.sign === 'fascia' || b.roofRailing || b.access !== 'none')
    throw Error('Container rails replace wall relief and fascia signs. Use a roof billboard; remove roof railings and external stairs or ladders.');
  if (['overhangFront', 'overhangBack', 'overhangLeft', 'overhangRight'].some(k => b[k] < 2))
    throw Error('A container roof needs at least 2 mm overhang on each side to cover its corner posts.');
  for (const o of openings) {
    if (o.wall === b.container) throw Error('The ' + o.wall + ' cargo-door end must stay free of openings. Choose frame only or move the cargo doors.');
    const length = ['front', 'back'].includes(o.wall) ? b.width : b.depth;
    const trim = o.frame ? 3 : 0;
    if (o.at - o.width / 2 - trim < 7 || o.at + o.width / 2 + trim > length - 7)
      throw Error('Keep openings and their frames at least 7 mm from a container corner.');
    if (o.sill + o.height + trim + (o.flap ? 6 : 0) > b.height - 5)
      throw Error('Keep openings and awning hinges below the container top rail (5 mm below the roof).');
  }
}

export function containerWall({ wall, length: L, bottom: z0, top: z1, cargo, sink }, { onWall, own, Manifold, minus }) {
  const bits = [];
  const add = (a, b, c, d, out = 2) => bits.push(onWall(wall, a, b, -sink, out, c, d));
  // Mitred by the caller so the posts and rails meet without overlapping adjacent panels.
  add(-2, L + 2, z0, z0 + 5);
  add(-2, L + 2, z1 - 5, z1);
  add(-2, 6, z0, z1);
  add(L - 6, L + 2, z0, z1);
  // Each cargo leaf has a narrow steel perimeter and two locking rods.
  if (cargo) {
    for (const [a, b] of [[7, L / 2 - 0.5], [L / 2 + 0.5, L - 7]]) {
      add(a, b, z0 + 6, z0 + 8, 0.9);
      add(a, b, z1 - 8, z1 - 6, 0.9);
      add(a, a + 1.5, z0 + 6, z1 - 6, 0.9);
      add(b - 1.5, b, z0 + 6, z1 - 6, 0.9);
      for (const fraction of [0.25, 0.75]) {
        const u = a + (b - a) * fraction;
        add(u - 0.7, u + 0.7, z0 + 9, z1 - 9, 1.4);
        for (const z of [z0 + 10, (z0 + z1) / 2, z1 - 12]) add(u - 1.5, u + 1.5, z, z + 2, 1.8);
        add(u - 0.7, u + 4, z0 + (z1 - z0) * 0.42, z0 + (z1 - z0) * 0.42 + 1.4, 1.8);
      }
    }
    for (const [a, b] of [[5, 11], [L - 11, L - 5]])
      for (const fraction of [0.2, 0.5, 0.8]) {
        const z = z0 + (z1 - z0) * fraction;
        add(a, b, z - 1.2, z + 1.2, 1.7);
      }
  }
  let solid = own(Manifold.union(bits));
  // Recesses in the corner castings; leave solid material underneath for reliable printing.
  const pockets = [];
  for (const u of [2.3, L - 2.3]) for (const z of [z0 + 2.5, z1 - 2.5])
    pockets.push(onWall(wall, u - 1.2, u + 1.2, 1.15, 2.1, z - 0.85, z + 0.85));
  return minus(solid, ...pockets);
}

export function containerRoof(W, D, z, sign, { box, own, Manifold }) {
  const ribs = [];
  // Leave the front 18 mm flat for the billboard and its support fins.
  for (let x = 10; x < W - 7; x += 8) ribs.push(box(x - 1, sign === 'billboard' ? 18 : 7, z - 0.1, x + 1, D - 7, z + 1));
  return own(Manifold.union(ribs));
}
