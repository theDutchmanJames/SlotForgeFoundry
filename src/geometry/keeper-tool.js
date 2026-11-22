import { KEEPER_DRIVE_SLOT } from './keeper-dimensions.js';

export const KEEPER_TOOL = Object.freeze({
  reach: 178,
  handleThickness: 3.6,
  shoulderHeight: 4.8,
  bendAngle: 80,
  bladeAngle: 45,
  bladeLength: KEEPER_DRIVE_SLOT.length - 0.4,
  bladeWidth: KEEPER_DRIVE_SLOT.width - 0.3,
  bladeHeight: KEEPER_DRIVE_SLOT.depth - 0.12,
});

// Round ends and a gradual change of width from the head to the finger grip.
function handleOutline() {
  const noseRadius = 4.6, gripRadius = 9;
  const gripCentre = KEEPER_TOOL.reach - gripRadius;
  const side = [[0, noseRadius]];
  function widen(endX, endWidth) {
    const [startX, startWidth] = side.at(-1);
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      side.push([startX + (endX - startX) * t,
        startWidth + (endWidth - startWidth) * t * t * (3 - 2 * t)]);
    }
  }
  widen(24, 6);
  side.push([113, 6]);
  widen(148, gripRadius);
  side.push([gripCentre, gripRadius]);
  const endCap = (x, radius, start) => Array.from({ length: 23 }, (_, i) => {
    const angle = start - Math.PI * (i + 1) / 24;
    return [x + radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  return [...side, ...endCap(gripCentre, gripRadius, Math.PI / 2),
    ...side.slice().reverse().map(([x, y]) => [x, -y]), ...endCap(0, noseRadius, -Math.PI / 2)];
}

// The bend is confined to the head so the grip can swing parallel to the
// table. The tapered, radiused neck supports every layer from the flat base.
function angledNeck(work) {
  const { handleThickness, shoulderHeight, bendAngle } = KEEPER_TOOL;
  const lean = 1 / Math.tan(bendAngle * Math.PI / 180);
  const rise = shoulderHeight - handleThickness;
  const rootRadius = 0.4;
  const sectionRadius = z => {
    const t = Math.min(1, z / rootRadius);
    const fillet = rootRadius * (1 - Math.sqrt(t * (2 - t)));
    return 2.55 + (rise - z) * 0.22 + fillet;
  };
  const layers = [0, 0.04, 0.12, 0.24, rootRadius, rise];
  const rings = [];
  for (let i = 1; i < layers.length; i++) {
    const low = layers[i - 1], high = layers[i];
    const cone = work.own(work.wasm.Manifold.cylinder(high - low, sectionRadius(low), sectionRadius(high), 64));
    rings.push(work.own(cone.transform([
      1, 0, 0, 0, 0, 1, 0, 0, lean, 0, 1, 0,
      (low - rise) * lean, 0, handleThickness + low, 1,
    ])));
  }
  return work.union(rings);
}

// The shoulder presses on the boss while the chamfered tip clears the
// blind slot floor. Diagonal clocking keeps the grip outboard through 90°.
function driverBlade(work) {
  const { bladeLength, bladeWidth, shoulderHeight, bladeHeight, bladeAngle } = KEEPER_TOOL;
  const x = bladeLength / 2, y = bladeWidth / 2, corner = 0.1;
  const face = work.section([[[-x + corner, -y], [x - corner, -y], [x, -y + corner],
    [x, y - corner], [x - corner, y], [-x + corner, y], [-x, y - corner], [-x, -y + corner]]]);
  const lead = 0.15;
  const top = shoulderHeight + bladeHeight;
  const chamfer = work.own(face.extrude(lead, 0, 0, [(bladeLength - 0.24) / bladeLength,
    (bladeWidth - 0.18) / bladeWidth]));
  const blade = work.union([work.prism(face, shoulderHeight, top - lead),
    work.own(chamfer.translate([0, 0, top - lead]))]);
  return work.own(blade.rotate([0, 0, bladeAngle]));
}

/** Flat print pose. The drive axis is at (0, 0), and the grip points along +X. */
export function buildKeeperTool(work) {
  const handle = work.prism(work.section([handleOutline()]), 0, KEEPER_TOOL.handleThickness);
  return work.union([handle, angledNeck(work), driverBlade(work)]);
}
