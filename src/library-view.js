import { esc, fmt } from './ui.js';
import { nativeTrackPoint, trackParameters } from './track.js';
import { refreshCustomTrack } from './custom-track.js';
import { laneOffsetAt } from './lane-adjustment.js';
import { hasSlotPosition, lanesVary, slotTitle } from './slot-position.js';
import { specialPreview } from './special-pieces.js';
import { specialName } from './special-piece-controls.js';
import { startingGridLayout } from './geometry/starting-grid.js';

export const sharedLabels = {
  joint: 'Road joints',
  height: 'Track height',
  hollow: 'Hollow underside',
  deck: 'Deck thickness',
  wall: 'Wall and slot-floor thickness',
  reinforcement: 'Reinforce roads and borders',
  ribSpacing: 'Target rib spacing',
  roadCentreLine: 'Centre line',
  dashLength: 'Dash length',
  dashGap: 'Gap between dashes',
  slotWidth: 'Guide slot width',
  slotDepth: 'Guide slot depth',
  braidWidth: 'Braid width per side',
  braidDepth: 'Braid recess depth',
  braidGap: 'Braid offset from slot',
  tabWidth: 'Tab width',
  tabLength: 'Tab projection',
  tabThickness: 'Tab thickness',
  tabClearance: 'Tab gap per side',
  clipType: 'Clip type',
  clipClearance: 'Clip gap per side',
  jointFitVersion: 'Connector fit version',
};

function sample(line, count = 54) {
  if (line.length <= count) return line;
  return Array.from(
    { length: count },
    (_, i) => line[Math.round((i * (line.length - 1)) / (count - 1))],
  );
}

// Thumbnails are drawn once per recipe; Home and the Library redraw often.
const thumbnails = new Map();
export function trackThumbnail(track, profile = {}) {
  // Everything the drawing reads: settings, drawn plan, freeform shape, profile.
  const key = JSON.stringify([track.params, track.plan ?? null, track.custom ?? null, profile]);
  let svg = thumbnails.get(key);
  if (svg === undefined) {
    svg = drawThumbnail(track, profile);
    if (thumbnails.size > 300) thumbnails.delete(thumbnails.keys().next().value);
    thumbnails.set(key, svg);
  }
  return svg;
}
function drawThumbnail(track, profile) {
  const p = trackParameters({ ...track.params, ...profile });
  let outlines, lanes, details = [], borders = [], markings = [], ends;
  if (p.special) {
    const preview = specialPreview(p);
    outlines = preview.outlines.map(line => sample(line));
    lanes = preview.lanes.map(line => sample(line));
    details = (preview.details ?? []).map(line => sample(line));
    borders = (preview.borders ?? []).map(line => sample(line));
    markings = [...(preview.pitWhiteLines ?? []), ...(preview.pitGrid?.paint ?? [])];
  } else if (p.kind === 'import') {
    const plan =
      track.plan ?? refreshCustomTrack({ ...track, params: p }).plan ?? {};
    outlines = (plan.outlines ?? []).slice(0, 12).map((line) => sample(line));
    lanes = (plan.lanes ?? []).slice(0, 12).map((line) => sample(line));
  } else {
    const row = (offset) =>
      Array.from({ length: p.kind === 'curve' ? 25 : 2 }, (_, i) =>
        nativeTrackPoint(p, i / (p.kind === 'curve' ? 24 : 1), offset),
      );
    outlines = [[...row(-p.width / 2), ...row(p.width / 2).reverse()]];
    const slot = (i, t) => nativeTrackPoint(p, t, laneOffsetAt(p, i, t));
    lanes = Array.from({ length: p.lanes }, (_, i) =>
      lanesVary(p)
        ? Array.from({ length: 49 }, (_, k) => slot(i, k / 48))
        : row(laneOffsetAt(p, i, 0)),
    );
    if (p.kind === 'straight' && p.startingGrid)
      markings = startingGridLayout(p).paint;
    // An off-centre slot is typed from the left or right edge, so the tile
    // names the ends and shows which way the piece runs.
    if (hasSlotPosition(p)) {
      const centre = (t) => nativeTrackPoint(p, t, 0);
      // The arrowhead sits on slot 1, the slot nearest the edge measured from.
      const first = p.slotPosition.edge === 'outer' ? p.lanes - 1 : 0;
      ends = {
        a: [centre(0), centre(0.001)],
        b: [centre(1), centre(0.999)],
        travel: [slot(first, 0.49), slot(first, 0.5), slot(first, 0.51)],
      };
    }
  }
  const points = [...outlines, ...lanes, ...borders, ...details].flat();
  if (!points.length) return '';
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.max(...ys);
  const width = Math.max(...xs) - x,
    height = y - Math.min(...ys);
  // End letters need a little more room around the piece.
  const scale = Math.min(
    (ends ? 100 : 116) / Math.max(width, 0.01),
    (ends ? 50 : 57) / Math.max(height, 0.01),
  );
  const place = ([px, py]) => [
    (px - x) * scale + (144 - width * scale) / 2,
    (y - py) * scale + (72 - height * scale) / 2,
  ];
  const path = (line) =>
    line
      .map((point, i) => {
        const [px, py] = place(point);
        return (i ? 'L' : 'M') + px.toFixed(2) + ' ' + py.toFixed(2);
      })
      .join('');
  // A letter sits `gap` beyond `from`, on the line from `inside` through it.
  const beyond = (from, inside, gap) => {
    const [fx, fy] = place(from),
      [ix, iy] = place(inside);
    const d = Math.hypot(fx - ix, fy - iy) || 1;
    return [fx + ((fx - ix) / d) * gap, fy + ((fy - iy) / d) * gap];
  };
  const letter = (text, [from, inside]) => {
    const [lx, ly] = beyond(from, inside, 7);
    return (
      '<text class="lib-end" x="' + lx.toFixed(2) + '" y="' + ly.toFixed(2) +
      '" text-anchor="middle" dominant-baseline="central">' + text + '</text>'
    );
  };
  const arrow = ([before, at, after]) => {
    const [tx, ty] = beyond(at, before, 2.5),
      [bx, by] = beyond(at, after, 2.5);
    const nx = ((ty - by) / 5) * 2.2,
      ny = ((bx - tx) / 5) * 2.2;
    return (
      '<path class="lib-travel" d="M' + (bx + nx).toFixed(2) + ' ' + (by + ny).toFixed(2) +
      'L' + tx.toFixed(2) + ' ' + ty.toFixed(2) +
      'L' + (bx - nx).toFixed(2) + ' ' + (by - ny).toFixed(2) + '"/>'
    );
  };
  return (
    '<svg class="lib-thumb" viewBox="0 0 144 72" aria-hidden="true">' +
    borders.map(o => '<path class="lib-border" d="' + path(o) + 'Z"/>').join('') +
    (p.special
      ? outlines.map(o => '<path class="lib-road" d="' + path(o) + 'Z"/>').join('')
      : '<path class="lib-road" fill-rule="evenodd" d="' + outlines.map(o => path(o) + 'Z').join('') + '"/>') +
    markings.map(loop => '<path fill="white" d="' + path(loop) + 'Z"/>').join('') +
    '<path class="lib-lanes" d="' +
    lanes.map(path).join('') +
    '"/>' + (details.length ? '<path class="lib-detail" d="' + details.map(path).join('') + '"/>' : '') +
    (ends ? arrow(ends.travel) + letter('A', ends.a) + letter('B', ends.b) : '') + '</svg>'
  );
}

export function pieceDetail(track) {
  const p = trackParameters(track.params);
  if (p.special) return specialName(p.special.type) + ' · ' + (p.kind === 'curve' ? fmt(p.angle) + '°' : fmt(p.length) + ' mm');
  const slot = slotTitle(p) && ' · ' + slotTitle(p);
  if (p.kind === 'straight')
    return fmt(p.length) + ' × ' + fmt(p.width) + ' mm' + slot;
  if (p.kind === 'curve')
    return fmt(p.angle) + '° · inner R ' + fmt(p.radius - p.width / 2) + ' mm' + slot;
  return (
    (track.custom ? 'Drawn path' : 'Imported drawing') +
    ' · ' +
    (track.plan?.lanes?.length ?? p.lanes) +
    ' lanes'
  );
}

export function card(piece, profile) {
  return (
    '<button type="button" class="lib-card" data-open-piece="' +
    esc(piece.id) +
    '">' +
    trackThumbnail(piece.track, profile) +
    '<strong>' +
    esc(piece.name) +
    '</strong><small>' +
    esc(pieceDetail(piece.track)) +
    '</small></button>'
  );
}
