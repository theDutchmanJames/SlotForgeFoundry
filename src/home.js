// Home: where Foundry opens. Pick a track pack to edit or to plan with,
// start a new one, or reopen a layout or an STL part from the Library.
import './home.css';
import { esc, fmt, icon } from './ui.js';
import { trackThumbnail } from './library-view.js';
import { partStale } from './library-page.js';
import { plateDrawing } from './plate-drawing.js';
import { BUILDING_PRESETS } from './building-presets.js';
import { presetThumb } from './preset-thumbs.js';

// A standard building to start from, as its picture.
function buildingPick([id, label]) {
  const p = BUILDING_PRESETS.find((q) => q.id === id);
  const src = presetThumb(id);
  return `<button type="button" class="home-build" data-home="building" data-preset="${esc(id)}" title="${esc(p.name + ': ' + p.note)}">${src ? `<img src="${src}" alt="" loading="lazy">` : ''}<span>${esc(label)}</span></button>`;
}

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

export function renderHome({ packs, layouts, stlParts, buildings = [], plate, error }) {
  const buildingRows = buildings.slice(0, 4).map(
    (b) => `<div class="home-row">
  <span class="home-row-ico">${icon('building')}</span>
  <div><b>${esc(b.name)}</b><small>${esc(when(b.updated))}</small></div>
  <button type="button" class="sf-btn ghost sm" data-home="open-building" data-id="${esc(b.id)}">Open</button>
</div>`,
  );
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
  <div class="sf-eyebrow home-gap">Start a new building</div>
  <div class="home-new">
    ${tile('building', 'From a standard building', 'Ready to print, or to change: every setting stays open.',
      '<div class="home-builds">' + [['garage', 'Pit garage'], ['race-control', 'Tower'], ['marshal', 'Marshal hut']].map(buildingPick).join('') + '</div><button type="button" class="sf-btn sm" data-home="buildings">All standard buildings…</button>')}
    ${tile('plus', 'From scratch', 'A plain garage to build up, a shape to draw wall by wall, or halls and wings.',
      '<button type="button" class="sf-btn sm" data-home="building" data-preset="garage">Plain garage</button><button type="button" class="sf-btn sm" data-home="building" data-preset="footprint-l">Draw a shape</button><button type="button" class="sf-btn sm" data-home="building" data-preset="connected">Halls and wings</button>')}
    ${tile('trackside', 'Trackside', 'Stands, gantries over the track and boards beside it.',
      '<div class="home-builds">' + [['stand', 'Grandstand'], ['gantry-lattice', 'Gantry'], ['billboard', 'Billboard']].map(buildingPick).join('') + '</div>')}
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
  <section class="home-card">
    <h2 class="sf-eyebrow plain">Your buildings</h2>
    ${buildingRows.length ? buildingRows.join('') : '<p class="home-empty">Buildings you save on the Buildings page appear here.</p>'}
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
