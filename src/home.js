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
    <button type="button" class="sf-btn primary" data-home="plan" data-pack="${esc(pack.id)}">Plan a layout</button>
  </div>
</article>`;
}

export function renderHome({ packs, layouts, stlParts, plate, error }) {
  const packName = new Map(packs.map((p) => [p.id, p.name]));
  const layoutRows = layouts.slice(0, 4).map(
    (l) => `<div class="home-row">
  <span class="home-row-ico">${icon('track')}</span>
  <div><b>${esc(l.name)}</b><small>${esc(packName.get(l.collectionId) ?? 'Pack no longer in the library')} · ${esc(when(l.updated))}</small></div>
  <button type="button" class="sf-btn sm" data-home="layout" data-id="${esc(l.id)}">Open</button>
</div>`,
  );
  const partRows = stlParts.slice(0, 3).map(
    (p) => `<div class="home-row">
  <span class="home-row-ico">${icon('box')}</span>
  <div><b>${esc(p.name)}</b><small>${partStale(p, packs) ? '<span class="home-stale">Original changed</span>' : p.source?.label ? '<span class="home-link">Based on ' + esc(p.source.label) + '</span>' : p.basedOn ? '<span class="home-link">Edited copy</span>' : 'Original STL'}</small></div>
  ${partStale(p, packs) ? '<button type="button" class="sf-btn sm primary" data-home="rebuild-part" data-id="' + esc(p.id) + '">Rebuild</button>' : ''}<button type="button" class="sf-btn sm" data-home="part" data-id="${esc(p.id)}">Open</button>
</div>`,
  );
  return `<div class="home">
<section class="home-main" aria-labelledby="home-packs">
  <div class="home-head">
    <div><div class="sf-eyebrow">Your track packs</div><h1 id="home-packs">Pick a pack</h1></div>
    <span class="home-sp"></span>
    <button type="button" class="sf-btn ghost" data-home="library">All packs in the Library</button>
    <button type="button" class="sf-btn ghost" data-home="open-file">${icon('open')}Open a file…</button>
  </div>
  ${error ? '<p class="home-error">' + esc(error) + '</p>' : ''}
  <div class="home-packs">${packs.length ? packs.map((p) => packCard(p, layouts)).join('') : '<p class="home-empty">No track packs yet. Start one below.</p>'}</div>
  <div class="sf-eyebrow home-gap">Start a new pack</div>
  <div class="home-new">
    <div class="home-tile"><span class="home-tile-ico">${icon('library')}</span><b>From a standard set</b><span>A complete, tested set of straights and bends to adjust.</span>
      <div class="home-tile-opts"><button type="button" class="sf-btn sm" data-home="starter" data-lanes="2">SlotForge Basic</button><button type="button" class="sf-btn sm" data-home="starter" data-lanes="1">Single lane</button></div></div>
    <div class="home-tile"><span class="home-tile-ico">${icon('plus')}</span><b>From scratch</b><span>Set the rules first (road width, lanes, slot, joints), then add your pieces.</span>
      <div class="home-tile-opts"><button type="button" class="sf-btn sm" data-home="scratch">Set the rules…</button></div></div>
    <div class="home-tile"><span class="home-tile-ico">${icon('import')}</span><b>From SlotForge Circuit</b><span>Import a Circuit drawing (SVG or DXF). Its sizes and heights come with it.</span>
      <div class="home-tile-opts"><button type="button" class="sf-btn sm" data-home="circuit">Choose a Circuit file…</button></div></div>
  </div>
</section>
<aside class="home-side" aria-label="Recent work">
  <h2>Recent layouts</h2>
  ${layoutRows.length ? layoutRows.join('') : '<p class="home-empty">Layouts you save in the Track Planner appear here.</p>'}
  <h2 class="home-gap">STL parts</h2>
  ${partRows.length ? partRows.join('') : '<p class="home-empty">STL parts you save in STL Edit appear here.</p>'}
  <div class="home-pair"><button type="button" class="sf-btn" data-home="open-stl">Open an STL…</button><button type="button" class="sf-btn ghost" data-home="new-design">Empty design</button></div>
  <div class="home-card home-gap"><div class="sf-eyebrow">Print plate</div>
    <div class="home-plate"><b class="sf-mono">${esc(fmt(plate.width))} × ${esc(fmt(plate.depth))} mm</b><span>${plate.margin ? esc(fmt(plate.margin)) + ' mm margin' : 'no margin'}</span><span class="home-sp"></span><button type="button" class="sf-btn ghost sm" data-home="plate">Change</button></div></div>
  <div class="home-card"><div class="sf-eyebrow">First time?</div>
    <p>Print the <b>fit samples</b> first: two racks, a key and a keeper tell you which clip clearance suits your printer.</p>
    <button type="button" class="sf-btn ghost sm" data-home="fit-samples">Download fit samples</button></div>
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
