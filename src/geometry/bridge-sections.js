import { interpolateStation } from './braid-feeds.js';
import { length2, minus, move } from './solids.js';

export function sectionStations(sides) {
  const center = sides[0].map((p, i) => move(p, minus(sides[1][i], p), 0.5));
  const distances = [0];
  for (let i = 1; i < center.length; i++)
    distances.push(distances.at(-1) + length2(minus(center[i], center[i - 1])));
  const length = distances.at(-1);
  const stations = distances.map((d) => d / length);
  const at = (line, t) => interpolateStation(stations, t, (i) => line[i]);
  return { center, stations, length, at };
}

export function sliceSection(source, metric, a, b) {
  const interior = [];
  metric.stations.forEach((t, i) => {
    if (t > a + 1e-9 && t < b - 1e-9) interior.push(i);
  });
  const slice = (line) => [
    metric.at(line, a),
    ...interior.map((i) => line[i]),
    metric.at(line, b),
  ];
  const sides = source.sides.map(slice);
  return {
    sides,
    outlines: [[...sides[0], ...sides[1].slice().reverse()]],
    lanes: source.lanes.map(slice),
    start: source.start + a * (source.end - source.start),
    end: source.start + b * (source.end - source.start),
  };
}

// One road can pass over a second road several times, or alternate passages.
// Keep the saved section identities for user choices. Create one printable
// span per passage, with coincident seam planes, for the bridge generator.
export function independentSpans(layout) {
  if (!layout.independentRoutes || layout.crossings.length < 2) return layout;
  const crossings = layout.crossings.map((c) => ({ ...c })),
    sections = [];
  for (const [routeIndex, original] of layout.sections.entries()) {
    const visits = crossings
      .map((c, i) => {
        const pass =
          layout.crossings[i].firstSection === routeIndex ? 'first' : 'second';
        return { c, pass, at: c[pass + 'Local'] };
      })
      .sort((a, b) => a.at - b.at);
    const metric = sectionStations(original.sides);
    let start = 0;
    for (const [i, { c, pass, at }] of visits.entries()) {
      const end = i + 1 === visits.length ? 1 : (at + visits[i + 1].at) / 2;
      c[pass + 'Section'] = sections.length;
      c[pass + 'Local'] = (at - start) / (end - start);
      sections.push({
        ...sliceSection(original, metric, start, end),
        routeIndex,
      });
      start = end;
    }
  }
  return { ...layout, crossings, sections };
}
