import { esc, fmt } from './ui.js';

// The print plate as a small bed seen from the front and above, to the
// proportions of the plate set, with the margin dashed and its two sizes.
export function plateDrawing(plate) {
  const w = Math.max(1, plate.width),
    d = Math.max(1, plate.depth);
  const skew = 0.42,
    rise = 0.62;
  const s = Math.min(120 / (w + skew * d), 64 / (rise * d));
  const ox = 6,
    top = 6,
    thick = 6;
  const at = (x, y) => [ox + (x + skew * y) * s, top + rise * (d - y) * s];
  const poly = (pts) => pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  const corners = [at(0, 0), at(w, 0), at(w, d), at(0, d)];
  const step = w > 400 || d > 400 ? 50 : 20;
  let grid = '';
  for (let x = step; x < w; x += step) grid += '<polyline points="' + poly([at(x, 0), at(x, d)]) + '"/>';
  for (let y = step; y < d; y += step) grid += '<polyline points="' + poly([at(0, y), at(w, y)]) + '"/>';
  const m = Math.min(plate.margin ?? 0, w / 2 - 1, d / 2 - 1);
  const margin =
    m > 0 ? '<polygon class="plate-margin" points="' + poly([at(m, m), at(w - m, m), at(w - m, d - m), at(m, d - m)]) + '"/>' : '';
  const [fl, fr] = [at(0, 0), at(w, 0)];
  const front =
    '<polygon class="plate-edge" points="' +
    poly([fl, fr, [fr[0], fr[1] + thick], [fl[0], fl[1] + thick]]) +
    '"/>' +
    '<polygon class="plate-edge plate-side" points="' +
    poly([fr, at(w, d), [at(w, d)[0], at(w, d)[1] + thick], [fr[0], fr[1] + thick]]) +
    '"/>';
  const width = 6 + (w + skew * d) * s + 22;
  const height = top + rise * d * s + thick + 16;
  // The four levelling screws, just inside the corners.
  const inset = Math.min(w, d) * 0.06;
  const screws = [at(inset, inset), at(w - inset, inset), at(w - inset, d - inset), at(inset, d - inset)]
    .map(([x, y]) => '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="1.8"/>')
    .join('');
  const label = (x, y, text, anchor) =>
    '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="' + anchor + '">' + esc(text) + '</text>';
  return (
    '<svg class="home-plate-art" viewBox="0 0 ' + width.toFixed(1) + ' ' + height.toFixed(1) + '" role="img" aria-label="Print plate ' +
    esc(fmt(w)) + ' by ' + esc(fmt(d)) + ' mm">' +
    front +
    '<polygon class="plate-bed" points="' + poly(corners) + '"/>' +
    '<g class="plate-grid">' + grid + '</g>' +
    margin +
    '<g class="plate-screws">' + screws + '</g>' +
    label((fl[0] + fr[0]) / 2, fl[1] + thick + 11, fmt(w), 'middle') +
    label(Math.min(width - 2, (fr[0] + at(w, d)[0]) / 2 + 4), (fr[1] + at(w, d)[1]) / 2 + 2, fmt(d), 'start') +
    '</svg>'
  );
}
