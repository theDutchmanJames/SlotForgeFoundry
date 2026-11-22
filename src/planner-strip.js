// Sample the same cross sections the track generator uses to cut print seams.
export function plannerStrip(path, p, a, b) {
  const ts = [
    ...new Set([
      a,
      ...path.stations.filter((t) => t > a && t < b),
      ...Array.from({ length: 15 }, (_, i) => a + ((b - a) * (i + 1)) / 16),
      b,
    ]),
  ].sort((x, y) => x - y);
  const sides = [-1, 1].map((sign) =>
    ts.map((t) => path.point(t, (sign * p.width) / 2)),
  );
  const slots = (t) =>
    path.laneOffsets?.(t) ??
    Array.from(
      { length: p.lanes },
      (_, i) => (i - (p.lanes - 1) / 2) * p.laneSpacing,
    );
  const point = (t, d) =>
    path.atOffset ? path.atOffset(t, d) : path.point(t, d);
  const lanes = slots(a).map((_, i) => ts.map((t) => point(t, slots(t)[i])));
  const ports = [a, b].map((t, i) => {
    const index = i ? ts.length - 1 : 0;
    const xy = path.point(t, 0),
      tangent = path.tangent(t);
    return {
      xy,
      angle: Math.atan2(tangent[1], tangent[0]) + (i ? 0 : Math.PI),
      edges: sides.map((line) => line[index]),
      slots: lanes.map((line) => line[index]),
    };
  });
  return { sides, lanes, ports };
}
