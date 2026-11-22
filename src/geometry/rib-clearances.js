// Leave working space beside the mating joint stock, wire outlets and moving hardware.
// The same final cutters describe the clearance when connectors move or a pit is mirrored.
export function ribHardwareKeepouts(work, p, part) {
  const margin = Math.max(1, Math.min(p.wall, 3));
  const bounds = part.section.bounds();
  const footprints = [...(part.ribKeepouts ?? [])];
  for (const cut of part.cuts) {
    const { min, max } = cut.boundingBox();
    // Slot and braid tools start above the bed. Ribs should join their sleeves.
    // Recesses that open underneath include clip keepers, feeds, sensor sockets,
    // actuator travel and the cable channels passing through adjoining borders.
    if (min[2] > 0 || max[0] < bounds.min[0] - margin || min[0] > bounds.max[0] + margin ||
        max[1] < bounds.min[1] - margin || min[1] > bounds.max[1] + margin) continue;
    footprints.push(work.own(cut.project()));
  }
  if (!footprints.length) return [];
  const combined = work.own(work.wasm.CrossSection.union(footprints));
  const padded = work.own(combined.offset(margin, 'Round', 2, 16));
  const local = work.own(padded.intersect(part.section));
  return local.isEmpty() ? [] : [local];
}
