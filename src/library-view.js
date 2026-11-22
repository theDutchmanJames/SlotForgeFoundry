import { esc, fmt } from './ui.js';
import { nativeTrackPoint, trackParameters } from './track.js';
import { refreshCustomTrack } from './custom-track.js';
import { laneOffsetAt } from './lane-adjustment.js';
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
  let outlines, lanes, details = [], borders = [], markings = [];
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
    lanes = Array.from({ length: p.lanes }, (_, i) =>
      p.laneAdjustment
        ? Array.from({ length: 49 }, (_, k) =>
            nativeTrackPoint(p, k / 48, laneOffsetAt(p, i, k / 48)),
          )
        : row(laneOffsetAt(p, i, 0)),
    );
    if (p.kind === 'straight' && p.startingGrid)
      markings = startingGridLayout(p).paint;
  }
  const points = [...outlines, ...lanes, ...borders, ...details].flat();
  if (!points.length) return '';
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.max(...ys);
  const width = Math.max(...xs) - x,
    height = y - Math.min(...ys);
  const scale = Math.min(
    116 / Math.max(width, 0.01),
    57 / Math.max(height, 0.01),
  );
  const path = (line) =>
    line
      .map(
        ([px, py], i) =>
          (i ? 'L' : 'M') +
          ((px - x) * scale + (144 - width * scale) / 2).toFixed(2) +
          ' ' +
          ((y - py) * scale + (72 - height * scale) / 2).toFixed(2),
      )
      .join('');
  return (
    '<svg class="lib-thumb" viewBox="0 0 144 72" aria-hidden="true">' +
    borders.map(o => '<path class="lib-border" d="' + path(o) + 'Z"/>').join('') +
    (p.special
      ? outlines.map(o => '<path class="lib-road" d="' + path(o) + 'Z"/>').join('')
      : '<path class="lib-road" fill-rule="evenodd" d="' + outlines.map(o => path(o) + 'Z').join('') + '"/>') +
    markings.map(loop => '<path fill="white" d="' + path(loop) + 'Z"/>').join('') +
    '<path class="lib-lanes" d="' +
    lanes.map(path).join('') +
    '"/>' + (details.length ? '<path class="lib-detail" d="' + details.map(path).join('') + '"/>' : '') + '</svg>'
  );
}

export function pieceDetail(track) {
  const p = trackParameters(track.params);
  if (p.special) return specialName(p.special.type) + ' · ' + (p.kind === 'curve' ? fmt(p.angle) + '°' : fmt(p.length) + ' mm');
  if (p.kind === 'straight')
    return fmt(p.length) + ' × ' + fmt(p.width) + ' mm';
  if (p.kind === 'curve')
    return fmt(p.angle) + '° · inner R ' + fmt(p.radius - p.width / 2) + ' mm';
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
