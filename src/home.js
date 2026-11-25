// Home: where Foundry opens. Pick a track pack to edit or to plan with,
// start a new one, or reopen a layout or an STL part from the Library.
import './home.css';
import { esc, fmt, icon } from './ui.js';
import { trackThumbnail } from './library-view.js';
import { partStale } from './library-page.js';

const when = (ms) => {
  if (!ms) return '';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 30) return days + ' days ago';
  return new Date(ms).toLocaleDateString();
};
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

function packFacts(pack, layouts) {
  const r = pack.rules ?? {};
  const used = layouts.filter((l) => l.collectionId === pack.id).length;
  const specials = pack.pieces.filter((p) => p.track.params.special).length;
  return [
    plural(pack.pieces.length, 'piece'),
    specials ? plural(specials, 'special') : '',
    pack.profile?.clipType === 'carrera-retained'
      ? 'Carrera clips'
      : pack.profile?.clipType === 'side-screw' && pack.profile?.joint !== 'none'
        ? 'Kevan Sideclips'
      : pack.profile?.joint === 'none'
        ? 'Plain joints'
        : 'Dovetail keys',
    used ? 'Used in ' + plural(used, 'layout') : 'No layouts yet',
  ].filter(Boolean);
}

function packCard(pack, layouts) {
  const r = pack.rules ?? {};
  const shown = [
    ...pack.pieces.filter((p) => p.track.params.kind === 'curve').slice(-2),
    ...pack.pieces.filter((p) => p.track.params.kind !== 'curve').slice(0, 1),
  ].slice(0, 3);
  const pictures = shown
    .map((p) => {
      try {
        return '<span>' + trackThumbnail(p.track, pack.profile) + '</span>';
      } catch {
        return '';
      }
    })
    .join('');
  return `<article class="home-pack">
  <div class="home-pack-pic">${pictures}</div>
  <div class="home-pack-body">
    <div class="sf-eyebrow">${esc(plural(r.lanes ?? 2, 'lane'))} · ${esc(fmt(r.width ?? 0))} mm road</div>
    <h3>${esc(pack.name)}</h3>
    <div class="home-chips">${packFacts(pack, layouts).map((f) => '<span>' + esc(f) + '</span>').join('')}</div>
  </div>
  <div class="home-pack-foot">
    <button type="button" class="sf-btn" data-home="edit" data-pack="${esc(pack.id)}">Edit pieces</button>
    <button type="button" class="sf-btn soft" data-home="plan" data-pack="${esc(pack.id)}">${icon('track')}Plan a layout</button>
  </div>
</article>`;
}

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

export function renderHome({ packs, layouts, stlParts, plate, error }) {
  const packName = new Map(packs.map((p) => [p.id, p.name]));
  const layoutRows = layouts.slice(0, 4).map(
    (l) => `<div class="home-row">
  <span class="home-row-ico">${icon('track')}</span>
  <div><b>${esc(l.name)}</b><small>${esc(packName.get(l.collectionId) ?? 'Pack no longer in the library')} · ${esc(when(l.updated))}</small></div>
  <button type="button" class="sf-btn ghost sm" data-home="layout" data-id="${esc(l.id)}">Open</button>
</div>`,
  );
  const partRows = stlParts.slice(0, 3).map(
    (p) => `<div class="home-row">
  <span class="home-row-ico">${icon('box')}</span>
  <div><b>${esc(p.name)}</b><small>${partStale(p, packs) ? '<span class="home-stale">Original changed</span>' : p.source?.label ? '<span class="home-link">Based on ' + esc(p.source.label) + '</span>' : p.basedOn ? '<span class="home-link">Edited copy</span>' : 'Original STL'}</small></div>
  ${partStale(p, packs) ? '<button type="button" class="sf-btn sm soft" data-home="rebuild-part" data-id="' + esc(p.id) + '">Rebuild</button>' : ''}<button type="button" class="sf-btn ghost sm" data-home="part" data-id="${esc(p.id)}">Open</button>
</div>`,
  );
  const tile = (glyph, title, line, options) =>
    `<div class="home-tile"><span class="home-tile-ico">${icon(glyph)}</span><div><b>${title}</b><span>${line}</span>
      <div class="home-tile-opts">${options}</div></div></div>`;
  return `<div class="home">
<section class="home-main" aria-labelledby="home-packs">
  <div class="sf-eyebrow">Start a new pack</div>
  <div class="home-new">
    ${tile('library', 'From a standard set', 'A tested set of straights and bends to adjust.',
      '<button type="button" class="sf-btn sm" data-home="starter" data-lanes="2">SlotForge Basic</button><button type="button" class="sf-btn sm" data-home="starter" data-lanes="1">Single lane</button>')}
    ${tile('plus', 'From scratch', 'Your own rules, step by step: road, slot, borders, lines.',
      '<button type="button" class="sf-btn sm" data-home="scratch">New track pack…</button>')}
    ${tile('import', 'From SlotForge Circuit', 'An SVG or DXF drawing, with its sizes and heights.',
      '<button type="button" class="sf-btn sm" data-home="circuit">Choose a Circuit file…</button>')}
  </div>
  <div class="home-head home-gap">
    <div><div class="sf-eyebrow">Your track packs</div><h1 id="home-packs">Pick a pack</h1></div>
    <span class="home-sp"></span>
    <button type="button" class="sf-btn ghost sm" data-home="library">All packs in the Library</button>
    <button type="button" class="sf-btn ghost sm" data-home="open-file">${icon('open')}Open a file…</button>
  </div>
  ${error ? '<p class="home-error">' + esc(error) + '</p>' : ''}
  <div class="home-packs">${packs.length ? packs.map((p) => packCard(p, layouts)).join('') : '<p class="home-empty">No track packs yet. Start one above.</p>'}</div>
</section>
<aside class="home-side" aria-label="Recent work">
  <section class="home-card">
    <h2 class="sf-eyebrow plain">Recent layouts</h2>
    ${layoutRows.length ? layoutRows.join('') : '<p class="home-empty">Layouts you save in the Track Planner appear here.</p>'}
  </section>
  <section class="home-card">
    <h2 class="sf-eyebrow plain">STL parts</h2>
    ${partRows.length ? partRows.join('') : '<p class="home-empty">STL parts you save in STL Edit appear here.</p>'}
    <div class="home-pair"><button type="button" class="sf-btn" data-home="open-stl">${icon('open')}Open an STL…</button><button type="button" class="sf-btn ghost" data-home="new-design">${icon('plus')}Empty design</button></div>
  </section>
  <section class="home-card home-printer">
    <h2 class="sf-eyebrow plain">This printer</h2>
    <div class="home-plate">${plateDrawing(plate)}
      <div><b class="sf-mono">${esc(fmt(plate.width))} × ${esc(fmt(plate.depth))} mm</b><span>Print plate · ${plate.margin ? esc(fmt(plate.margin)) + ' mm margin' : 'no margin'}</span>
      <button type="button" class="sf-btn ghost sm" data-home="plate">Change</button></div></div>
  </section>
  <section class="home-tip">
    <h2 class="sf-eyebrow plain">First time?</h2>
    <p>Print the <b>fit samples</b> first: two racks, a key and a keeper tell you which clip clearance suits your printer.</p>
    <button type="button" class="sf-btn soft sm" data-home="fit-samples">${icon('kit')}Download fit samples</button>
  </section>
</aside>
</div>`;
}

export function createHome({ host, load, handlers, onError }) {
  let busy = false;
  host.addEventListener('click', async (event) => {
    const b = event.target.closest('[data-home]');
    if (!b || busy) return;
    busy = true;
    try {
      await handlers[b.dataset.home]?.(b.dataset);
    } catch (err) {
      onError?.(err);
    } finally {
      busy = false;
    }
  });
  return {
    async show() {
      let data;
      try {
        data = await load();
      } catch (err) {
        data = { packs: [], layouts: [], stlParts: [], plate: { width: 200, depth: 200, margin: 0 }, error: 'The Library could not be opened: ' + err.message };
      }
      host.innerHTML = renderHome(data);
    },
  };
}
