import { esc, icon, field, check, choice } from './ui.js';
import { clipChoices } from './joint-controls.js';
import { card, sharedLabels } from './library-view.js';
import { MAX_LIBRARY_BYTES } from './library-database.js';
import {
  profileFromTrack,
  starterPack,
  SCREW_PROFILE_FIELDS,
  SHARED_PROFILE_FIELDS,
  trackWithProfile,
} from './library-profile.js';
import { SCREW_CLIP_DEFAULTS } from './geometry/screw-clip.js';
import './library.css';
import { defaultPackRules, validatePackRules } from './track-pack-rules.js';
import { centreLineStyles } from './paint-controls.js';

const ruleFields = [
  ['packWidth', 'width', 'Road width', 'mm', { min: 2, max: 5000 }],
  ['packLanes', 'lanes', 'Lane count', '', { min: 1, max: 8, step: 1 }],
  [
    'packLaneSpacing',
    'laneSpacing',
    'Normal slot spacing',
    'mm',
    { min: 0.1, max: 1000 },
  ],
  [
    'packR1',
    'r1InnerRadius',
    'R1 inner road edge',
    'mm',
    { min: 0.1, max: 20000 },
  ],
  ['packAngle', 'angle', 'Default curve angle', '°', { min: 0.1, max: 359 }],
];
function ruleInputs(rules) {
  return (
    '<fieldset class="lib-pack-rules"><legend>Track pack rules</legend>' +
    '<div class="lib-rule-fields">' +
    ruleFields
      .map(([key, prop, label, unit, limits]) =>
        field(key, label, rules[prop], unit, limits),
      )
      .join('') +
    '</div>' +
    '<p class="hint">Each successive radius adds one road width. A single lane runs down the centre unless a piece sets its own Slot position. With multiple lanes, normal slot spacing applies at both ends.</p></fieldset>'
  );
}

const count = (n) => n + (n === 1 ? ' piece' : ' pieces');
const btn = (id, label, cls = 'outline', glyph = '') =>
  '<button type="button" data-lib="' +
  id +
  '" class="' +
  cls +
  '">' +
  (glyph ? icon(glyph) : '') +
  esc(label) +
  '</button>';
const nameField = (label, value) =>
  '<label class="lib-name">' +
  esc(label) +
  '<input class="text" name="itemName" required maxlength="120" value="' +
  esc(value) +
  '"></label>';
const different = (a, b) =>
  SHARED_PROFILE_FIELDS.filter((k) => (a[k] ?? null) !== (b[k] ?? null));
const groups = [
  ['Road', ['height', 'hollow', 'deck', 'wall', 'reinforcement', 'ribSpacing']],
  ['Road markings', ['roadCentreLine', 'dashLength', 'dashGap']],
  [
    'Guide slot and braid',
    ['slotWidth', 'slotDepth', 'braidWidth', 'braidDepth', 'braidGap'],
  ],
  [
    'Tabs and clips',
    [
      'joint',
      'tabWidth',
      'tabLength',
      'tabThickness',
      'tabClearance',
      'clipType',
      'clipClearance',
    ],
  ],
  ['Side screw clip', SCREW_PROFILE_FIELDS],
];

export async function showTrackLibrary({
  store,
  current,
  prepare,
  validateTrack,
  openPiece,
  createPiece,
  updateProfile,
  download,
  canSavePiece = true,
  collectionId,
  screen: initialScreen = 'browse',
}) {
  let collections = await store.list();
  const dialog = document.createElement('dialog');
  dialog.className = 'track-library';
  dialog.setAttribute('aria-labelledby', 'lib-title');
  document.body.append(dialog);
  let activeId = collectionId ?? current().link?.collectionId ?? collections[0]?.id;
  let screen = initialScreen;
  let page = 0,
    locked = false,
    backup = null,
    replaceId = null;
  let copying = false,
    message = '';
  const active = () =>
    collections.find((c) => c.id === activeId) ?? collections[0];
  const $ = (selector) => dialog.querySelector(selector);
  const back = () => btn('browse', 'Back to pieces');
  const pieceCount = () => collections.reduce((n, c) => n + c.pieces.length, 0);
  const selectCollection = () =>
    '<label class="lib-collection">Track pack<select name="collection">' +
    collections
      .map(
        (c) =>
          '<option value="' +
          esc(c.id) +
          '" ' +
          (c.id === active()?.id ? 'selected' : '') +
          '>' +
          esc(c.name) +
          '</option>',
      )
      .join('') +
    '</select></label>';
  function syncRuleSpacing() {
    const lanes = $('[name="packLanes"]');
    if (!lanes) return;
    const spacing = $('[name="packLaneSpacing"]');
    const single = lanes.valueAsNumber === 1;
    spacing.closest('label').hidden = single;
    if (single && !spacing.validity.valid) spacing.value = spacing.defaultValue;
  }
  function saveSettings() {
    const c = active(),
      work = current();
    const source =
      c?.id === work.link?.collectionId &&
      c.pieces.find((p) => p.id === work.link.pieceId);
    const target = copying ? null : source;
    const changes = different(c.profile, profileFromTrack(work.track));
    return { c, work, target, changes };
  }
  function browse(c) {
    if (!c)
      return (
        '<p>Create a track pack to set the road width, lane spacing and matching corner radii.</p>' +
        btn('new', 'New track pack', 'primary', 'plus') +
        btn('restore', 'Restore backup…')
      );
    const perPage = 24,
      start = page * perPage;
    // "Centred" stays true only while no piece moves its slots.
    const offCentre = c.pieces.some((piece) => piece.track.params.slotPosition);
    const singleLane = offCentre ? '1 lane · some slots off-centre' : '1 centred lane';
    return (
      '<div class="lib-controls">' +
      selectCollection() +
      btn('new', 'New track pack', 'outline', 'plus') +
      '</div>' +
      '<div class="lib-section-head"><div><h3>' +
      count(c.pieces.length) +
      '</h3><small>' +
      esc(c.rules.width) + ' mm wide · ' +
      (c.rules.lanes === 1
        ? singleLane
        : esc(c.rules.lanes) + ' lanes · ' + esc(c.rules.laneSpacing) + ' mm spacing' +
          (offCentre ? ' · some slots off-centre' : '')) +
      '</small></div>' +
      (createPiece ? btn('create-piece', 'Add track piece', 'primary', 'plus') : '') +
      btn('rules', 'Pack rules', 'outline', 'settings') +
      btn('profile', 'Shared print profile', 'outline', 'settings') +
      '</div>' +
      (c.pieces.length
        ? '<div class="lib-cards">' +
          c.pieces
            .slice(start, start + perPage)
            .map(piece => card(piece, c.profile))
            .join('') +
          '</div>'
          : '<p>Add a straight, corner or special piece, or draw a path of your own.</p>') +
      (c.pieces.length > perPage
        ? '<div class="lib-controls">' +
          (start ? btn('previous', 'Previous') : '') +
          '<span>Page ' +
          (page + 1) +
          ' of ' +
          Math.ceil(c.pieces.length / perPage) +
          '</span>' +
          (start + perPage < c.pieces.length ? btn('next', 'Next') : '') +
          '</div>'
        : '') +
      '<div class="lib-footer">' +
      (canSavePiece ? btn('save', 'Save current piece…', 'outline', 'save') : '') +
      '<div>' +
      btn('backup', 'Back up SQLite') +
      btn('restore', 'Restore backup…') +
      '</div></div>'
    );
  }
  function saveView() {
    const { c, work, target, changes } = saveSettings();
    replaceId = target?.id;
    return (
      '<div class="lib-controls">' +
      selectCollection() +
      '</div><form data-lib-form>' +
      nameField('Piece name', target?.name ?? work.name) +
      (target
        ? '<div class="lib-controls">' +
          btn('copy', 'Save as a new piece') +
          '</div>'
        : '') +
      (changes.length
        ? '<fieldset><legend>Shared settings differ</legend><p>' +
          esc(changes.map((k) => sharedLabels[k]).join(', ')) +
          '</p><label class="lib-radio"><input type="radio" name="policy" value="inherit" ' +
          (!target ? 'checked' : '') +
          '>Use ' +
          esc(c.name) +
          ' settings on this piece</label>' +
          '<label class="lib-radio"><input type="radio" name="policy" value="share" ' +
          (target ? 'checked' : '') +
          '>Apply this piece’s settings to the whole collection (' +
          count(c.pieces.length + (target ? 0 : 1)) +
          ')</label></fieldset>'
        : '<p class="hint">This piece uses the collection’s shared track and connector dimensions.</p>') +
      '<div class="lib-footer">' +
      back() +
      btn(
        'commit-piece',
        target ? 'Update saved piece' : 'Save piece',
        'primary',
        'save',
      ) +
      '</div></form>'
    );
  }
  function profileView(c) {
    const v = {
      ...profileFromTrack(c.pieces[0]?.track ?? current().track),
      ...c.profile,
    };
    const control = (k) =>
      k === 'hollow' || k === 'reinforcement'
        ? check(k, sharedLabels[k], v[k])
        : k === 'roadCentreLine'
          ? choice(k, sharedLabels[k], v[k] ?? 'none', centreLineStyles)
        : k === 'joint'
          ? choice(k, sharedLabels[k], v[k] ?? 'none', [
              ['none', 'Plain'],
              ['tabs', 'Tabs and sockets'],
              ['clips', 'Removable clips'],
              ['both', 'Tabs and clips'],
            ])
          : k === 'clipType'
            ? choice(k, sharedLabels[k], v[k] ?? '', clipChoices(v[k]))
          : k === 'screwDirection'
            ? choice(k, sharedLabels[k], v[k] ?? SCREW_CLIP_DEFAULTS[k], [
                ['top', 'All from the top'],
                ['bottom', 'All from the bottom'],
                ['side', 'Per road side'],
              ])
          : k === 'screwLength'
            ? field(k, sharedLabels[k], v[k] ?? '', 'mm', { optional: true, placeholder: 'Auto' })
          : Object.hasOwn(SCREW_CLIP_DEFAULTS, k)
            ? field(k, sharedLabels[k], v[k] ?? SCREW_CLIP_DEFAULTS[k], k === 'screwHeadAngle' ? '°' : 'mm')
            : field(k, sharedLabels[k], v[k] ?? '', 'mm', {
                optional: k === 'tabThickness',
                placeholder: 'Auto',
              });
    return (
      '<h3>' +
      esc(c.name) +
      '</h3><p>Changes apply to ' +
      count(c.pieces.length) +
      '. Each piece keeps its own shape and connector positions.</p>' +
      '<form data-lib-form><div class="lib-fields">' +
      groups
        .map(
          ([title, keys]) =>
            '<fieldset><legend>' +
            title +
            '</legend>' +
            keys.map(control).join('') +
            '</fieldset>',
        )
        .join('') +
      '</div>' +
      '<div class="lib-footer">' +
      back() +
      btn(
        'commit-profile',
        'Apply to ' + count(c.pieces.length),
        'primary',
        'check',
      ) +
      '</div></form>'
    );
  }
  function render() {
    const c = active();
    let title = 'Track packs',
      body;
    if (screen === 'save' && c) {
      title = 'Save to library';
      body = saveView();
    } else if (screen === 'profile' && c) {
      title = 'Shared profile';
      body = profileView(c);
    } else if (screen === 'rules' && c) {
      title = c.name + ' · Pack rules';
      body = '<form data-lib-form>'+ruleInputs(c.rules)+
        '<p class="hint">These dimensions apply when adding a piece. Existing pieces keep their designed dimensions.</p>'+
        '<div class="lib-footer">'+back()+btn('commit-rules','Save pack rules','primary','save')+'</div></form>';
    } else if (screen === 'new') {
      title = 'New track pack';
      body =
        '<form data-lib-form>' +
        nameField('Pack name', '') +
        choice('startWith', 'Start with', 'empty', [
          ['empty', 'Empty track pack'],
          ...(c
            ? [['copy', 'Copy ' + c.name + ' (' + count(c.pieces.length) + ')']]
            : []),
          ['starter', 'Two-lane starter pack · 200 mm wide'],
          ['single-starter', 'Single-lane starter pack · 100 mm wide'],
        ]) + '<div data-new-pack-rules>' + ruleInputs(defaultPackRules()) + '</div>' +
        '<div class="lib-footer">' +
        back() +
        btn('commit-new', 'Create track pack', 'primary', 'plus') +
        '</div></form>';
    } else if (screen === 'restore') {
      title = 'Restore SQLite backup';
      body =
        '<p>Choose a SlotForge library backup to replace the library on this device.</p><input type="file" name="backupFile" accept=".sqlite,.sqlite3,.db">' +
        (backup
          ? '<p><strong>' +
            esc(backup.name) +
            '</strong> contains ' +
            count(backup.n) +
            ' in ' +
            backup.collections.length +
            ' collections. Restoring replaces the current ' +
            count(pieceCount()) +
            '.' +
            // A backup from this version also carries layouts and STL parts,
            // and replaces the ones on this device.
            (backup.collections.layouts
              ? ' It also replaces every saved layout and STL part with its own ' +
                backup.collections.layouts.length +
                (backup.collections.layouts.length === 1 ? ' layout' : ' layouts') +
                ' and ' +
                (backup.collections.stlParts?.length ?? 0) +
                ((backup.collections.stlParts?.length ?? 0) === 1 ? ' STL part' : ' STL parts') +
                '.'
              : ' Saved layouts and STL parts stay as they are.') +
            '</p>'
          : '') +
        '<div class="lib-footer">' +
        back() +
        (backup ? btn('commit-restore', 'Replace library', 'primary') : '') +
        '</div>';
    } else {
      screen = 'browse';
      body = browse(c);
    }
    dialog.innerHTML =
      '<header><h2 id="lib-title">' +
      esc(title) +
      '</h2><button type="button" class="icon-button" aria-label="Close library" data-lib="close">' +
      icon('close') +
      '</button></header>' +
      body +
      '<p class="lib-status" role="status"></p>';
    syncRuleSpacing();
    note(message);
  }
  function note(text, error = false) {
    const out = $('.lib-status');
    if (out) {
      out.textContent = text;
      out.classList.toggle('lib-error', error);
    }
  }
  async function reload() {
    collections = await store.list();
  }
  async function verify(pieces, profile) {
    for (const [i, piece] of pieces.entries()) {
      note('Checking ' + piece.name + ' · ' + (i + 1) + ' of ' + pieces.length);
      try {
        await validateTrack(trackWithProfile(piece.track, profile));
      } catch (e) {
        throw Error(piece.name + ' — ' + e.message);
      }
    }
  }
  async function perform(fn) {
    if (locked) return;
    locked = true;
    dialog.setAttribute('aria-busy', 'true');
    dialog.querySelectorAll('button, select, input').forEach((el) => {
      el.disabled = true;
    });
    try {
      await fn();
    } catch (e) {
      note(e.message ?? String(e), true);
    } finally {
      locked = false;
      dialog.removeAttribute('aria-busy');
      dialog.querySelectorAll('button, select, input').forEach((el) => {
        el.disabled = false;
      });
    }
  }
  async function commitPiece() {
    const { c, work, target } = saveSettings();
    const name = $('[name="itemName"]').value.trim();
    if (!name) throw Error('Enter a piece name.');
    if (target && work.link.revision !== c.revision)
      throw Error(
        'This collection changed since you opened the piece. Reopen the saved piece, or choose Save as a new piece to keep your edits.',
      );
    const share = $('[name="policy"]:checked')?.value === 'share';
    const profile = share ? profileFromTrack(work.track) : c.profile;
    const track = trackWithProfile(work.track, profile);
    await verify(
      [
        ...(share ? c.pieces.filter((p) => p.id !== replaceId) : []),
        { name, track },
      ],
      profile,
    );
    const id = await store.savePiece(
      c.id,
      { id: replaceId ?? undefined, name, track },
      { expectedRevision: c.revision, ...(share ? { profile } : {}) },
    );
    await reload();
    const saved = active();
    await openPiece(
      saved,
      saved.pieces.find((p) => p.id === id),
    );
    dialog.close();
  }
  async function commitProfile() {
    const c = active(),
      next = { ...c.profile };
    for (const control of $('[data-lib-form]').elements) {
      if (!SHARED_PROFILE_FIELDS.includes(control.name)) continue;
      if (control.type === 'checkbox') next[control.name] = control.checked;
      else if (control.type === 'number') {
        if (control.value === '') {
          if (control.name !== 'tabThickness' && control.name !== 'screwLength')
            throw Error('Enter ' + sharedLabels[control.name] + '.');
          next[control.name] = null;
        } else next[control.name] = control.valueAsNumber;
      } else if (control.value) next[control.name] = control.value;
      else next[control.name] = null;
      // A screw clip setting the pack never set stays unset at its default.
      // An empty screw length is automatic.
      if (
        Object.hasOwn(SCREW_CLIP_DEFAULTS, control.name) &&
        c.profile[control.name] == null &&
        (control.name === 'screwLength'
          ? next[control.name] == null
          : next[control.name] === SCREW_CLIP_DEFAULTS[control.name])
      )
        delete next[control.name];
    }
    if (
      different(next, c.profile).some((k) =>
        [
          'tabWidth',
          'tabLength',
          'tabClearance',
          'tabThickness',
          'clipType',
        ].includes(k),
      )
    )
      next.jointFitVersion = 2;
    await verify(c.pieces, next);
    if (current().link?.collectionId === c.id) await prepare();
    const work = current();
    if (work.link?.collectionId === c.id && work.link.revision === c.revision)
      await verify([{ name: work.name, track: work.track }], next);
    await store.setProfile(c.id, next, { expectedRevision: c.revision });
    await reload();
    await updateProfile(active(), c.revision);
    message = 'Shared profile saved for ' + count(c.pieces.length) + '.';
    screen = 'browse';
    render();
  }
  dialog.addEventListener('cancel', (e) => {
    if (locked) e.preventDefault();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('input', (e) => {
    if (e.target.name === 'packLanes') syncRuleSpacing();
  });
  dialog.addEventListener('change', (e) => {
    if (e.target.name === 'startWith') {
      const group = $('[data-new-pack-rules]');
      group.hidden = group.querySelector('fieldset').disabled = e.target.value !== 'empty';
    }
    if (e.target.name === 'collection') {
      activeId = e.target.value;
      page = 0;
      copying = false;
      message = '';
      render();
    }
    if (e.target.name === 'backupFile') {
      const file = e.target.files[0];
      backup = null;
      message = '';
      render();
      if (file)
        void perform(async () => {
          if (file.size > MAX_LIBRARY_BYTES)
            throw Error(
              'Choose a library backup no larger than ' +
                MAX_LIBRARY_BYTES / 1024 / 1024 +
                ' MiB.',
            );
          const bytes = new Uint8Array(await file.arrayBuffer());
          const incoming = await store.inspectBytes(bytes);
          backup = {
            name: file.name,
            bytes,
            collections: incoming,
            n: incoming.reduce((n, c) => n + c.pieces.length, 0),
          };
          render();
        });
    }
  });
  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    dialog.querySelector('[data-lib^="commit-"]')?.click();
  });
  dialog.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || locked) return;
    const id = b.dataset.lib,
      c = active();
    if (b.dataset.openPiece) {
      void perform(async () => {
        await openPiece(
          c,
          c.pieces.find((p) => p.id === b.dataset.openPiece),
        );
        dialog.close();
      });
      return;
    }
    if (id === 'close') {
      dialog.close();
      return;
    }
    if (id === 'create-piece') {
      void perform(async () => {
        let savedId;
        let revision = c.revision;
        await createPiece(c, async (recipe) => {
          const track = trackWithProfile(recipe, c.profile);
          await validateTrack(track);
          await prepare();
          savedId = await store.savePiece(
            c.id,
            { id: savedId, name: track.sourceName, track },
            { expectedRevision: revision },
          );
          await reload();
          const saved = collections.find((row) => row.id === c.id);
          revision = saved.revision;
          await openPiece(
            saved,
            saved.pieces.find((piece) => piece.id === savedId),
          );
          dialog.close();
          return true;
        });
      });
      return;
    }
    if (
      id === 'commit-piece' ||
      id === 'commit-profile' ||
      id === 'commit-new' || id === 'commit-rules'
    ) {
      if (!$('[data-lib-form]').reportValidity()) return;
      void perform(async () => {
        if (id === 'commit-piece') return commitPiece();
        if (id === 'commit-profile') return commitProfile();
        const readRules = () =>
          validatePackRules(
            Object.fromEntries(
              ruleFields.map(([key, prop]) => [
                prop,
                $('[name="' + key + '"]').valueAsNumber,
              ]),
            ),
          );
        if (id === 'commit-rules') {
          const work = current();
          if (work.link?.collectionId === c.id) await prepare();
          await store.setRules(c.id, readRules(), {
            expectedRevision: c.revision,
          });
          await reload();
          if (
            work.link?.collectionId === c.id &&
            work.link.revision === c.revision
          )
            await updateProfile(active(), c.revision);
          screen = 'browse';
          message = 'Pack rules saved for new pieces.';
          render();
          return;
        }
        const from = $('[name="startWith"]').value;
        const initial =
          from === 'copy'
            ? c
            : from === 'starter' || from === 'single-starter'
              ? starterPack(from === 'single-starter' ? 1 : 2)
              : { profile: canSavePiece ? profileFromTrack(current().track) : starterPack().profile, pieces: [] };
        activeId = await store.createCollection(
          $('[name="itemName"]').value.trim(),
          initial.profile,
          initial.pieces,
          from === 'empty' ? readRules() : initial.rules ?? defaultPackRules(),
        );
        await reload();
        page = 0;
        copying = false;
        screen = 'browse';
        message = '';
        render();
      });
      return;
    }
    if (id === 'backup') {
      void perform(async () => {
        download(
          'SlotForge-track-library.sqlite',
          await store.exportBytes(),
          'application/vnd.sqlite3',
        );
        note('SQLite backup downloaded.');
      });
      return;
    }
    if (id === 'commit-restore' && backup) {
      void perform(async () => {
        for (const col of backup.collections)
          await verify(col.pieces, col.profile);
        await store.importBytes(backup.bytes, {
          expectedCollections: collections,
        });
        backup = null;
        await reload();
        activeId = collections[0]?.id;
        page = 0;
        screen = 'browse';
        message = 'Library restored.';
        render();
      });
      return;
    }
    if (id === 'copy') {
      copying = true;
      screen = 'save';
    } else if (id === 'save') {
      void perform(async () => {
        await prepare();
        copying = false;
        screen = 'save';
        message = '';
        render();
      });
      return;
    } else if (id === 'next') page++;
    else if (id === 'previous') page--;
    else {
      screen = id;
      copying = false;
    }
    message = '';
    backup = null;
    render();
  });
  render();
  dialog.showModal();
}
