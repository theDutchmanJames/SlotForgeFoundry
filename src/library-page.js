// The Library page: three shelves (track packs, layouts, STL parts) with
// open, rename, duplicate and delete. A pack's pieces, rules and backups are
// managed in the Track packs window, opened from here.
import './library-page.css';
import { esc, fmt, icon } from './ui.js';
import { trackThumbnail } from './library-view.js';

const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
// A small icon button with its name on hover and for screen readers.
const tool = (action, id, label, glyph, danger = false) =>
  `<button type="button" class="lp-tool${danger ? ' danger' : ''}" data-lp="${action}" data-id="${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}">${icon(glyph)}</button>`;
const when = (ms) => (ms ? new Date(ms).toLocaleDateString() : '');

function packCard(pack, layouts) {
  const used = layouts.filter((l) => l.collectionId === pack.id).length;
  const shown = pack.pieces.slice(0, 3);
  const pictures = shown
    .map((p) => {
      try {
        return '<span>' + trackThumbnail(p.track, pack.profile) + '</span>';
      } catch {
        return '';
      }
    })
    .join('');
  const r = pack.rules ?? {};
  return `<article class="lp-card">
  <div class="lp-pic">${pictures}</div>
  <div class="lp-body">
    <div class="sf-eyebrow">${esc(plural(r.lanes ?? 2, 'lane'))} · ${esc(fmt(r.width ?? 0))} mm road</div>
    <h3>${esc(pack.name)}</h3>
    <div class="lp-chips"><span>${esc(plural(pack.pieces.length, 'piece'))}</span><span>${used ? 'Used in ' + esc(plural(used, 'layout')) : 'No layouts yet'}</span></div>
  </div>
  <div class="lp-foot">
    <button type="button" class="sf-btn sm" data-lp="edit-pack" data-id="${esc(pack.id)}">Edit pieces</button>
    <button type="button" class="sf-btn sm soft" data-lp="plan-pack" data-id="${esc(pack.id)}">${icon('track')}Plan</button>
    <span class="lp-sp"></span>
    ${tool('manage-pack', pack.id, 'Pieces and rules', 'settings')}
    ${tool('rename-pack', pack.id, 'Rename', 'pencil')}
    ${tool('duplicate-pack', pack.id, 'Duplicate', 'layers')}
    ${tool('delete-pack', pack.id, 'Delete', 'close', true)}
  </div>
</article>`;
}

function layoutCard(layout, packs) {
  const pack = packs.find((p) => p.id === layout.collectionId);
  return `<article class="lp-card">
  <div class="lp-pic lp-icon">${icon('track')}</div>
  <div class="lp-body">
    <div class="sf-eyebrow">${esc(pack ? pack.name : 'Pack no longer in the library')}</div>
    <h3>${esc(layout.name)}</h3>
    <div class="lp-chips"><span>${esc(plural(layout.sections ?? 0, 'section'))}</span><span>${esc(when(layout.updated))}</span></div>
  </div>
  <div class="lp-foot">
    <button type="button" class="sf-btn sm soft" data-lp="open-layout" data-id="${esc(layout.id)}">${icon('open')}Open</button>
    <span class="lp-sp"></span>
    ${tool('rename-layout', layout.id, 'Rename', 'pencil')}
    ${tool('delete-layout', layout.id, 'Delete', 'close', true)}
  </div>
</article>`;
}

// An STL part made from a pack piece is out of date when that pack changed.
export function partStale(part, packs) {
  if (!part.source) return false;
  const pack = packs.find((p) => p.id === part.source.collectionId);
  return Boolean(pack && pack.revision > part.source.revision);
}
function partCard(part, parts, packs) {
  const base = parts.find((p) => p.id === part.basedOn);
  const stale = partStale(part, packs);
  const link = part.source?.label
    ? 'Based on ' + part.source.label
    : base
      ? 'Based on ' + base.name
      : part.basedOn
        ? 'Edited copy'
        : 'Original STL';
  return `<article class="lp-card${stale ? ' stale' : ''}">
  <div class="lp-pic lp-icon">${icon('box')}${stale ? '<span class="lp-flag">Original changed</span>' : ''}</div>
  <div class="lp-body">
    <div class="sf-eyebrow">STL part</div>
    <h3>${esc(part.name)}</h3>
    <div class="lp-chips"><span class="lp-link">${esc(link)}</span><span>${esc(Math.max(1, Math.round(part.size / 1024)) + ' KB')}</span></div>
  </div>
  <div class="lp-foot">
    ${stale ? `<button type="button" class="sf-btn sm soft" data-lp="rebuild-part" data-id="${esc(part.id)}">Rebuild with my edits</button>` : ''}
    <button type="button" class="sf-btn sm${stale ? '' : ' soft'}" data-lp="open-part" data-id="${esc(part.id)}">${icon('open')}Open</button>
    <span class="lp-sp"></span>
    ${tool('rename-part', part.id, 'Rename', 'pencil')}
    ${tool('delete-part', part.id, 'Delete', 'close', true)}
  </div>
</article>`;
}

export function renderLibraryPage({ shelf, packs, layouts, parts, error }) {
  const counts = { packs: packs.length, layouts: layouts.length, parts: parts.length };
  const tab = (id, label) =>
    `<button type="button" data-lp-shelf="${id}" aria-pressed="${shelf === id}">${label} <b>${counts[id]}</b></button>`;
  const body =
    shelf === 'layouts'
      ? layouts.map((l) => layoutCard(l, packs)).join('') ||
        '<p class="lp-empty">No layouts yet. In the Track Planner, choose Save to Library.</p>'
      : shelf === 'parts'
        ? parts.map((p) => partCard(p, parts, packs)).join('') ||
          '<p class="lp-empty">No STL parts yet. In STL Edit, choose Save to Library.</p>'
        : packs.map((p) => packCard(p, layouts)).join('') ||
          '<p class="lp-empty">No track packs yet. Start one from Home.</p>';
  return `<div class="lp">
  <div class="lp-head">
    <div><div class="sf-eyebrow">On this device</div><h1>Library</h1></div>
    <span class="lp-sp"></span>
    <div class="lp-shelves" role="group" aria-label="Shelf">${tab('packs', 'Track packs')}${tab('layouts', 'Layouts')}${tab('parts', 'STL parts')}</div>
    <button type="button" class="sf-btn soft" data-action="packs-dialog">${icon('save')}Backup and restore…</button>
  </div>
  ${error ? '<p class="lp-error">' + esc(error) + '</p>' : ''}
  <div class="lp-cards">${body}</div>
</div>`;
}

// A small themed window asking for a name or a confirmation. Plain buttons
// (no form submission: the workbench cancels those page-wide); it answers
// exactly once and removes itself.
// eyebrow: the action in small capitals above the title, which then names
// the thing it acts on.
export function askUser({ eyebrow, title, text, value, confirm, danger }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'lp-dialog';
    dialog.innerHTML =
      '<div><header class="lp-dialog-head"><span class="lp-dialog-tile' + (danger ? ' danger' : '') + '">' +
      icon(danger ? 'close' : value !== undefined ? 'pencil' : 'check') +
      '</span><div>' +
      (eyebrow ? '<div class="sf-eyebrow">' + esc(eyebrow) + '</div>' : '') +
      '<h3>' +
      esc(title) +
      '</h3></div></header>' +
      (text ? '<p>' + esc(text) + '</p>' : '') +
      (value !== undefined
        ? '<input name="value" maxlength="200" value="' + esc(value) + '">'
        : '') +
      '<div class="lp-dialog-row"><button type="button" class="sf-btn ' +
      'primary' +
      '" data-answer="ok">' +
      esc(confirm) +
      '</button><button type="button" class="sf-btn ghost" data-answer="cancel">Cancel</button></div></div>';
    document.body.append(dialog);
    const input = dialog.querySelector('input');
    let done = false;
    const finish = (ok) => {
      if (done) return;
      if (ok && input && !input.value.trim()) {
        input.focus();
        return;
      }
      done = true;
      resolve(ok ? (input ? input.value.trim() : true) : null);
      dialog.close();
      dialog.remove();
    };
    dialog.addEventListener('click', (e) => {
      const b = e.target.closest('[data-answer]');
      if (!b) return;
      e.stopPropagation();
      finish(b.dataset.answer === 'ok');
    });
    dialog.addEventListener('keydown', (e) => {
      // Enter in the name field confirms. On a button, the focused button acts
      // (Enter on Cancel must cancel, never delete).
      if (e.key === 'Enter' && e.target === input) {
        e.preventDefault();
        finish(true);
      }
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(false);
    });
    dialog.showModal();
    input?.select();
  });
}

export function createLibraryPage({ host, store, handlers, onError }) {
  let shelf = 'packs';
  let data = { packs: [], layouts: [], parts: [] };
  async function show(next) {
    if (next) shelf = next;
    try {
      const s = await store();
      const [packs, layouts, parts] = await Promise.all([s.list(), s.layouts(), s.stlParts()]);
      data = { packs, layouts, parts };
      host.innerHTML = renderLibraryPage({ shelf, ...data });
    } catch (err) {
      host.innerHTML = renderLibraryPage({ shelf, packs: [], layouts: [], parts: [], error: 'The Library could not be opened: ' + err.message });
    }
  }
  let busy = false;
  host.addEventListener('click', async (event) => {
    const shelfButton = event.target.closest('[data-lp-shelf]');
    if (shelfButton) {
      // Switching shelf redraws from what is already loaded.
      shelf = shelfButton.dataset.lpShelf;
      host.innerHTML = renderLibraryPage({ shelf, ...data });
      return;
    }
    const b = event.target.closest('[data-lp]');
    if (!b || busy) return;
    busy = true;
    try {
      const changed = await handlers[b.dataset.lp]?.(b.dataset.id, data);
      if (changed) await show();
    } catch (err) {
      onError?.(err);
    } finally {
      busy = false;
    }
  });
  return { show };
}
