import { interpolateStation } from './braid-feeds.js';
import { WHITE_LINE_COLOR } from './kerbstones.js';
import { grooveClearOfDovetails, lineDimensions, lineGrooves, markingStations } from './paint-guides.js';
import { braidSpan } from './solids.js';
import { laneOffsetAt } from '../lane-adjustment.js';
import { hasSlotPosition, lanesVary } from '../slot-position.js';

// phase is the distance already travelled on this road when a new print
// section starts. A dash crossing the join continues on the next section.
export function dashIntervals(length, dashLength, dashGap, phase = 0) {
  const period = dashLength + dashGap;
  if (!(dashLength > 0 && dashGap > 0) || !Number.isFinite(period))
    throw Error('Dash length and gap must be positive distances.');
  if (length / period > 32768)
    throw Error('Increase the dash length or gap on this long road.');
  const spans = [];
  for (let x = -(phase % period); x < length - 1e-8; x += period) {
    const end = Math.min(length, x + dashLength);
    if (end > Math.max(0, x) + 1e-8) spans.push([Math.max(0, x), end]);
  }
  return spans;
}

/**
 * How the guide slots meet a painted centre line, for the hint beside the
 * control: 'centred' when a slot runs along it, 'beside' when an off-centre
 * slot still takes part of the stripe all the way, 'crossing' when a slot
 * passes over it part of the way, 'clear' when the whole stripe is on road.
 */
export function centreLineSlots(p) {
  if (!hasSlotPosition(p)) return p.lanes % 2 ? 'centred' : 'clear';
  // The stripe gives way to the slot, its braids and a small margin.
  const reach = p.slotWidth / 2 + braidSpan(p) + 0.4 +
    (p.whiteLineWidth ?? lineDimensions.whiteLineWidth) / 2;
  const steps = lanesVary(p) ? 64 : 1;
  let result = 'clear';
  for (let i = 0; i < p.lanes; i++) {
    let covered = 0;
    for (let k = 0; k <= steps; k++)
      if (Math.abs(laneOffsetAt(p, i, k / steps)) < reach) covered++;
    if (covered > steps) return 'beside';
    if (covered) result = 'crossing';
  }
  return result;
}

export function centreLinePaint(work, p, path, phase = 0) {
  // Setting the offset to zero in the edge sampler measures the middle
  // polyline, retaining its true perpendicular width and angled end cuts.
  const rows = markingStations({ width: 0 }, path, 'outer');
  const distance = [0];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].edge, b = rows[i].edge;
    distance.push(distance[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = distance.at(-1), half = p.whiteLineWidth / 2;
  const edges = [-half, half].map(offset => rows.map(row => row.offset(offset)));
  const spans = p.roadCentreLine === 'dashed'
    ? dashIntervals(length, p.dashLength, p.dashGap, phase)
    : [[0, length]];
  const loops = [];
  let i = 1;
  for (const [start, end] of spans) {
    while (i < rows.length && distance[i] <= start) i++;
    const first = i;
    while (i < rows.length && distance[i] < end) i++;
    const [a, b] = edges.map(edge => [
      interpolateStation(distance, start, j => edge[j]),
      ...edge.slice(first, i),
      interpolateStation(distance, end, j => edge[j]),
    ]);
    loops.push([...a, ...b.reverse()]);
  }
  return work.section(loops);
}

// Keep one whole-road footprint until print seams and pit median cuts have
// been laid out. Offsetting per-part paint would engrave the split as an
// extra transverse groove halfway through a solid line or dash.
export function applyRoadCentreLine(work, p, part) {
  const line = part.centreLinePaint;
  if (!line || line.isEmpty()) return;
  const gap = lineGrooves(p).road ? p.grooveWidth : 0;
  // Give the pit divider, grid marks, and edge treatments precedence where
  // the centre stripe meets them. The new groove stays outside their paint.
  const other = [...(part.paintSections ?? []).map(ink => ink.section), ...(part.grooveSections ?? [])];
  if (part.laneKeepout) other.push(work.own(part.laneKeepout.offset(0.4, 'Round', 2, 24)));
  const reserved = other.length ? work.own(work.wasm.CrossSection.union(other)) : null;
  const paint = reserved
    ? work.own(line.subtract(gap ? work.own(reserved.offset(gap, 'Round', 2, 24)) : reserved))
    : line;
  if (paint.isEmpty()) return;
  // A segmented pit copies its inherited stripe arrays into both halves.
  // Keep each half's new groove independent of the other's connector roofs.
  part.paintSections = [...(part.paintSections ?? []), { color: WHITE_LINE_COLOR, section: paint }];
  if (gap) {
    const surround = work.own(paint.offset(gap, 'Miter'));
    const outline = work.own(surround.subtract(paint));
    const groove = grooveClearOfDovetails(work, part.drawKeyGuards, reserved ? work.own(outline.subtract(reserved)) : outline);
    part.grooveSections = [...(part.grooveSections ?? []), groove];
  }
}
