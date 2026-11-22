import { bridgeSectionProfile } from '../bridge-profile.js';
import {
  independentSpans,
  sectionStations,
  sliceSection,
} from './bridge-sections.js';
import { bridgeBlocks } from './bridge-supports.js';
import { move, minus, length2, unit, left, dot } from './solids.js';
import { footprintHull } from './plate.js';
import { maxBorderWidth } from './border-profile.js';

export function prepareBridges(work, savedLayout, p) {
  const layout = independentSpans(savedLayout);
  const supports = p.bridgeSupportCount ?? 0;
  const plans = new Map(),
    phases = [];
  const lowerSections = new Set();
  for (const c of layout.crossings)
    lowerSections.add(
      c[c.upperPass === 'first' ? 'secondSection' : 'firstSection'],
    );
  for (const [crossingIndex, crossing] of layout.crossings.entries()) {
    const upper = crossing[crossing.upperPass + 'Section'];
    const lower =
      crossing[
        crossing.upperPass === 'first' ? 'secondSection' : 'firstSection'
      ];
    if (lowerSections.has(upper) || plans.has(upper))
      throw Error(
        'This section participates in several bridge spans. Split the drawing into separate passages or change which passage goes over.',
      );
    const section = layout.sections[upper],
      metric = sectionStations(section.sides);
    const lowerOutline = work.section(layout.sections[lower].outlines);
    const border = Math.max(
      ...['inner', 'outer'].map((side) =>
        p.borderSide === 'both' || p.borderSide === side ? maxBorderWidth(p, side) : 0,
      ),
    );
    const reserved = work.own(lowerOutline.offset(border + 1, 'Round'));
    function blocked(t) {
      // An actual transverse strip covers the complete width of the upper road.
      const a = metric.at(section.sides[0], t),
        b = metric.at(section.sides[1], t);
      const across = unit(minus(b, a)),
        along = left(across);
      const l = move(a, across, -border),
        r = move(b, across, border);
      const strip = new work.wasm.CrossSection(
        [
          [
            move(l, along, -0.1),
            move(r, along, -0.1),
            move(r, along, 0.1),
            move(l, along, 0.1),
          ],
        ],
        'EvenOdd',
      );
      try {
        const hit = strip.intersect(reserved);
        try {
          return !hit.isEmpty();
        } finally {
          hit.delete();
        }
      } finally {
        strip.delete();
      }
    }
    const profile = bridgeSectionProfile(section, crossing, {
      width: p.width,
      height: p.height,
      clearance: p.bridgeClearance ?? 60,
      blocked,
      landing: 18,
      approaches: supports > 0 && p.bridgeApproaches !== false,
      minApproach: 12,
    });
    profile.crossingAt = crossing[crossing.upperPass + 'Local'];
    plans.set(upper, { profile, metric, section, crossingIndex });
  }
  layout.sections.forEach((section, sectionIndex) => {
    const bridge = plans.get(sectionIndex);
    const cuts = bridge?.profile.cuts ?? [0, 1];
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1],
        b = cuts[i];
      const geometry =
        cuts.length === 2
          ? section
          : sliceSection(section, bridge.metric, a, b);
      const phase = {
        geometry,
        sectionIndex,
        routeIndex: section.routeIndex ?? sectionIndex,
        a,
        b,
      };
      if (bridge) {
        const { metric, profile } = bridge;
        const origin = metric.at(metric.center, a);
        const vector = minus(metric.at(metric.center, b), origin);
        const rise = profile.heightAt(b) - profile.heightAt(a);
        const direction = unit(vector);
        const slope = rise ? rise / length2(vector) : 0;
        if (
          slope &&
          [a, b].some((t) => {
            const across = minus(
              metric.at(section.sides[1], t),
              metric.at(section.sides[0], t),
            );
            return Math.abs(dot(across, direction) * slope) > 0.01;
          })
        )
          throw Error(
            'Crossing ' +
              (bridge.crossingIndex + 1) +
              ' has a skewed ramp end. Make the road edges square to the straight approach at the joint, or use bridge supports only.',
          );
        phase.pose = {
          origin,
          direction,
          start: profile.heightAt(a),
          end: profile.heightAt(b),
          slope,
        };
      }
      phases.push(phase);
    }
  });
  return { plans, phases };
}

// Keep the installed top flush at the toe and crest. The secant compensates
// the depth of a slot measured normal to the running surface. The installed
// end planes remain vertical, making a mitred joint once each ramp lies flat.
export function installPart(work, part, pose, height) {
  if (!pose || (!pose.start && !pose.slope)) return;
  const { slope, direction, origin } = pose;
  const sec = Math.hypot(1, slope),
    [x, y] = direction.map((v) => v * slope);
  const z = pose.start - slope * dot(origin, direction) + height * (1 - sec);
  if (part.plannerStrip) {
    const strip=part.plannerStrip;
    part.plannerStrip={...strip,basePose:pose,ports:strip.ports.map(port=>({...port,
      baseZ:pose.start+slope*dot(minus(port.xy,origin),direction)}))};
  }
  const installed = work.own(
    part.solid.transform([1, 0, x, 0, 0, 1, y, 0, 0, 0, sec, 0, 0, 0, z, 1]),
  );
  part.solid = installed;
  // Trim the small underside wedge at table level. This never affects the
  // running face; reject a grade that consumes the guide floor at the toe.
  if (slope && installed.boundingBox().min[2] < -1e-7)
    part.solid = work.own(installed.trimByPlane([0, 0, 1], 0));
  const lift = (point) => [
    point[0],
    point[1],
    point[2] * sec + x * point[0] + y * point[1] + z,
  ];
  part.jointGuides?.forEach((g) => {
    g.point = lift(g.point);
  });
  part.kerbMarkings?.forEach((m) => {
    m.points = m.points.map(lift);
  });
  if (!slope || part.role === 'clip' || part.role === 'retainer') return;
  const heading = (Math.atan2(direction[1], direction[0]) * 180) / Math.PI;
  const angle = (Math.atan(slope) * 180) / Math.PI;
  part.printPose = (callback, onPlate) => {
    if (!onPlate) return callback(part.solid);
    const aligned = part.solid.rotate([0, 0, -heading]);
    try {
      const level = aligned.rotate([0, angle, 0]);
      try {
        return callback(level);
      } finally {
        level.delete();
      }
    } finally {
      aligned.delete();
    }
  };
}

function plateOutline(part) {
  const read = (solid) => {
    const projection = solid.project();
    try {
      return projection
        .toPolygons()
        .map((loop) => loop.map(([x, y]) => [x, -y]));
    } finally {
      projection.delete();
    }
  };
  part.printContours = part.printPose
    ? part.printPose(read, true)
    : read(part.solid);
  part.footprintXY = footprintHull(part.printContours.flat());
}

function checkApproachCollisions(parts, phases) {
  const roads = parts
    .filter((p) => p.role === 'road' || p.role === 'border')
    .map((part) => ({
      part,
      box: part.solid.boundingBox(),
      slope: phases[part.bridgePhase]?.pose?.slope,
    }))
    .sort((a, b) => a.box.min[0] - b.box.min[0]);
  for (let i = 0; i < roads.length; i++) {
    const a = roads[i];
    for (
      let j = i + 1;
      j < roads.length && roads[j].box.min[0] < a.box.max[0] - 1e-5;
      j++
    ) {
      const b = roads[j];
      if (
        (!a.slope && !b.slope) ||
        a.part.crossingSection === b.part.crossingSection ||
        [1, 2].some(
          (axis) =>
            Math.min(a.box.max[axis], b.box.max[axis]) -
              Math.max(a.box.min[axis], b.box.min[axis]) <
            1e-5,
        )
      )
        continue;
      const overlap = a.part.solid.intersect(b.part.solid);
      try {
        if (overlap.volume() > 0.001)
          throw Error(
            a.part.name +
              ' intersects ' +
              b.part.name +
              ' on the bridge approach. Move the nearby road or lengthen the approach.',
          );
      } finally {
        overlap.delete();
      }
    }
  }
}

export function finishBridges(work, assembly, parts, p) {
  const count = p.bridgeSupportCount ?? 0;
  const occupied = [],
    blocks = [];
  const silhouettes = count
    ? parts.map((part) => work.own(part.solid.project()))
    : [];
  for (const [sectionIndex, bridge] of assembly.plans) {
    const { profile } = bridge;
    const deck = parts.find(
      (part) => part.role === 'road' && part.crossingSection === sectionIndex,
    );
    const diagram = {
      crossing: bridge.crossingIndex + 1,
      at: profile.crossingAt,
      clearance: p.bridgeClearance ?? 60,
      height: p.height,
      rise: profile.level.z,
      path: profile.cuts.map((t) => [t, profile.heightAt(t)]),
      grade: Math.max(0, ...profile.approaches.map((a) => a.grade)),
      blocks: [],
    };
    deck.bridgeDiagram = diagram;
    if (!count) continue;
    const others = silhouettes.filter(
      (_, i) => parts[i].crossingSection !== sectionIndex,
    );
    const obstacles = work.own(
      work.own(work.wasm.CrossSection.union(others)).offset(1, 'Round'),
    );
    // Height of the actual underside below the continuous running face.
    const actual = profile.approaches.map((a) => {
      const correction = p.height * (1 - Math.hypot(1, a.grade));
      const verticalSlot = p.slotDepth * Math.hypot(1, a.grade);
      if (verticalSlot >= p.height)
        throw Error(
          'The approach is too steep to leave a guide-slot floor at table level. Lengthen the straight approach or reduce the bridge clearance.',
        );
      return { ...a, zStart: a.zStart + correction, zEnd: a.zEnd + correction };
    });
    const bearing = {
      ...profile,
      approaches: actual,
      heightAt(t) {
        const ramp = actual.find((a) => t > a.start && t < a.end);
        return ramp
          ? ramp.zStart +
              ((ramp.zEnd - ramp.zStart) * (t - ramp.start)) /
                (ramp.end - ramp.start)
          : profile.heightAt(t);
      },
    };
    const supports = bridgeBlocks(work, p, bridge.section, bearing, {
      sectionIndex,
      crossingIndex: bridge.crossingIndex,
      obstacles,
      occupied,
    });
    diagram.blocks = supports.map((part) => [
      part.station,
      part.solid.boundingBox().max[2],
    ]);
    blocks.push(...supports);
  }
  for (const part of parts) {
    installPart(work, part, assembly.phases[part.bridgePhase]?.pose, p.height);
    if (assembly.plans.size && (part.role === 'road' || part.role === 'border'))
      plateOutline(part);
  }
  if (count && p.bridgeApproaches !== false)
    checkApproachCollisions(parts, assembly.phases);
  parts.push(...blocks);
}
