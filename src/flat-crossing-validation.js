import { findPathIntersections, MAX_CROSSINGS } from './flat-crossing.js';
import { assertSimpleOutline } from './custom-track.js';

const near = (a, b) => Math.abs(a - b) <= 1e-7;
const samePoint = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-5;
const station = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
const vector = (p) =>
  Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
function requireGeometry(ok) {
  if (!ok)
    throw Error(
      'The saved crossing layout has inconsistent road sections or crossing positions. Reimport the drawing or reopen its original project.',
    );
}

function checkSection(section, parentOutline, budget, validatePaths) {
  requireGeometry(
    section &&
      station(section.start) &&
      Number.isFinite(section.end) &&
      section.end > section.start &&
      section.end <= 2 &&
      Array.isArray(section.sides) &&
      section.sides.length === 2 &&
      Array.isArray(section.lanes) &&
      section.lanes.length >= 1 &&
      section.lanes.length <= 8 &&
      Array.isArray(section.outlines) &&
      section.outlines.length === 1,
  );
  validatePaths(section.sides, 2, budget);
  validatePaths(section.lanes, 2, budget);
  validatePaths(section.outlines, 4, budget);
  const [right, left] = section.sides,
    outline = section.outlines[0],
    count = right.length;
  requireGeometry(
    count <= 4096 &&
      count * 2 === outline.length &&
      count * 2 === parentOutline.length &&
      [left, ...section.lanes].every((line) => line.length === count),
  );
  const centers = [];
  for (let j = 0; j < count; j++) {
    const r = right[j],
      l = left[j],
      nx = l[0] - r[0],
      ny = l[1] - r[1];
    const squared = nx * nx + ny * ny,
      last = outline.length - j - 1;
    requireGeometry(
      Number.isFinite(squared) &&
        squared > 1e-8 &&
        samePoint(r, outline[j]) &&
        samePoint(l, outline[last]) &&
        samePoint(r, parentOutline[j]) &&
        samePoint(l, parentOutline[last]),
    );
    const center = [(r[0] + l[0]) / 2, (r[1] + l[1]) / 2];
    // The drawing may tessellate parallel slot curves independently. Allow
    // their sub-millimetre registration tolerance along the transverse cut.
    let previous = -Infinity;
    for (const lane of section.lanes) {
      const dx = lane[j][0] - r[0],
        dy = lane[j][1] - r[1],
        f = (dx * nx + dy * ny) / squared;
      requireGeometry(
        f > 0 &&
          f < 1 &&
          f > previous &&
          Math.abs(dx * ny - dy * nx) / Math.sqrt(squared) <= 0.31,
      );
      previous = f;
    }
    if (j) {
      const dx = center[0] - centers[j - 1][0],
        dy = center[1] - centers[j - 1][1];
      const px = left[j - 1][0] - right[j - 1][0],
        py = left[j - 1][1] - right[j - 1][1];
      requireGeometry(dx * ny - dy * nx > 0 && dx * py - dy * px > 0);
      for (const path of [...section.sides, ...section.lanes])
        requireGeometry(
          Math.hypot(path[j][0] - path[j - 1][0], path[j][1] - path[j - 1][1]) >
            1e-7,
        );
    }
    centers.push(center);
  }
  assertSimpleOutline(outline);
  return centers;
}

export function validateFlatCrossing(plan, budget, validatePaths) {
  const f = plan.flatCrossing;
  requireGeometry(
    f &&
      typeof f.closed === 'boolean' &&
      (f.independentRoutes === undefined ||
        typeof f.independentRoutes === 'boolean') &&
      Array.isArray(f.sections) &&
      f.sections.length >= 2 &&
      f.sections.length <= MAX_CROSSINGS * 2 + 1 &&
      Array.isArray(f.crossings) &&
      f.crossings.length <= MAX_CROSSINGS &&
      (f.closed || f.crossings.length > 0) &&
      Array.isArray(plan.outlines) &&
      plan.outlines.length === f.sections.length,
  );
  const sections = f.sections;
  const centers = sections.map((s, i) =>
    checkSection(s, plan.outlines[i], budget, validatePaths),
  );
  requireGeometry(
    centers.reduce((count, path) => count + path.length, 0) <= 16384,
  );
  if (f.independentRoutes) {
    requireGeometry(
      !f.closed &&
        sections.length === 2 &&
        sections.every((s) => s.start === 0 && s.end === 1) &&
        plan.lanes.length ===
          sections[0].lanes.length + sections[1].lanes.length,
    );
  } else {
    requireGeometry(
      sections.every((s) => s.lanes.length === plan.lanes.length),
    );
    if (!f.closed)
      requireGeometry(
        near(sections[0].start, 0) && near(sections.at(-1).end, 1),
      );
    for (let i = f.closed ? 0 : 1; i < sections.length; i++) {
      const previous = sections.at(i - 1),
        current = sections[i];
      requireGeometry(near(previous.end, current.start + (i ? 0 : 1)));
      const before = [...previous.sides, ...previous.lanes],
        after = [...current.sides, ...current.lanes];
      requireGeometry(
        before.every((path, j) => samePoint(path.at(-1), after[j][0])),
      );
    }
  }

  // Recover actual intersections independently. Each saved pass must match
  // one physical crossing, with both local stations, tangent vectors and its
  // global route stations intact. The same XY may occur in separate roads.
  const remaining = [];
  const bounds = centers.map((line) =>
    line.reduce(
      (b, [x, y]) => [
        Math.min(b[0], x),
        Math.min(b[1], y),
        Math.max(b[2], x),
        Math.max(b[3], y),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    ),
  );
  for (let i = 0; i < centers.length; i++)
    for (let j = i + 1; j < centers.length; j++) {
      const a = bounds[i],
        b = bounds[j];
      if (a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) continue;
      for (const hit of findPathIntersections(centers[i], centers[j]))
        remaining.push({ ...hit, a: i, b: j });
      requireGeometry(remaining.length <= MAX_CROSSINGS);
    }
  requireGeometry(remaining.length === f.crossings.length);
  for (const c of f.crossings) {
    requireGeometry(
      c && ['first', 'second'].includes(c.upperPass) && vector(c.point),
    );
    for (const pass of ['first', 'second']) {
      const i = c[pass + 'Section'],
        local = c[pass + 'Local'],
        direction = c[pass + 'Direction'];
      requireGeometry(
        Number.isInteger(i) &&
          i >= 0 &&
          i < sections.length &&
          station(local) &&
          station(c[pass]) &&
          vector(direction),
      );
      const s = sections[i],
        t = s.start + (s.end - s.start) * local;
      requireGeometry(near(c[pass], t) || (f.closed && near(c[pass], t - 1)));
    }
    const index = remaining.findIndex((hit) => {
      const ordered = c.firstSection === hit.a && c.secondSection === hit.b;
      if (!ordered && !(c.firstSection === hit.b && c.secondSection === hit.a))
        return false;
      const first = ordered ? 'first' : 'second',
        second = ordered ? 'second' : 'first';
      return (
        samePoint(c.point, hit.point) &&
        near(c.firstLocal, hit[first]) &&
        near(c.secondLocal, hit[second]) &&
        samePoint(c.firstDirection, hit[first + 'Direction']) &&
        samePoint(c.secondDirection, hit[second + 'Direction'])
      );
    });
    requireGeometry(index !== -1);
    remaining.splice(index, 1);
  }
}
