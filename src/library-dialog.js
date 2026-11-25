import { esc, icon, field, choice } from './ui.js';
import { card, sharedLabels } from './library-view.js';
import { MAX_LIBRARY_BYTES } from './library-database.js';
import {
  profileFromTrack,
  starterPack,
  SHARED_PROFILE_FIELDS,
  trackWithProfile,
} from './library-profile.js';
import './library.css';
import { defaultPackRules, validatePackRules, withPackSections } from './track-pack-rules.js';
import { syncTracksideControls } from './trackside-controls.js';
import { syncPropertyReadouts } from './property-panel.js';
import { syncTextureControls } from './texture-controls.js';
import {
  NEW_PACK_STEPS,
  RULES_STEPS,
  optionalStepForms,
  readOptionalSteps,
  footNote,
  stepHead,
  stepRail,
  stepSummary,
  stepValues,
} from './new-pack-steps.js';

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
// The pieces of a pack that are cut into more than one road or border segment.
const cutPieces = (c) =>
  c.pieces.filter(
    ({ track }) => (track.params.segments ?? 1) > 1 || (track.params.borderSegments ?? 1) > 1,
  ).length;
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

export async function showTrackLibrary({
  store,
  current,
  prepare,
  validateTrack,
  openPiece,
  createPiece,
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
  // The steps of a new pack: the one shown, the ones changed, and the
  // values the optional steps started with.
  let npStep = 0,
    npChanged = new Set(),
    npValues = null,
    npSteps = null,
    npReturn = null;
  // The window of steps: a new pack, or the rules of the open one.
  function stepWindow(mode, c) {
    const rules = mode === 'rules';
    npSteps = rules ? RULES_STEPS : NEW_PACK_STEPS;
    npStep = 0;
    npChanged = new Set();
    npValues = rules
      ? { ...stepValues(c), baseProfile: c.profile, source: c }
      : startValues('empty');
    const basics = rules
      ? ruleInputs(c.rules)
      : nameField('Pack name', '') +
        choice('startWith', 'Start with', 'empty', [
          ['empty', 'Empty track pack'],
          ...(c ? [['copy', 'Copy of ' + c.name + ' · ' + count(c.pieces.length)]] : []),
          ['starter', 'Two-lane starter pack · 200 mm wide'],
          ['single-starter', 'Single-lane starter pack · 100 mm wide'],
        ]) +
        '<div data-new-pack-rules>' + ruleInputs(defaultPackRules()) + '</div>';
    const cut = rules ? cutPieces(c) : 0;
    const segments = rules
      ? '<div class="np-step" data-step="segments" data-summary="' +
        (cut ? count(cut) + ' cut' : 'Every piece whole') + '" hidden>' +
        stepHead(RULES_STEPS.at(-1)) +
        '<p>' + (cut
          ? count(cut) + ' of this pack ' + (cut === 1 ? 'is' : 'are') + ' cut into more than one segment. Resetting makes every piece whole again, with one road segment and one border segment.'
          : 'Every piece of this pack is whole: one road segment and one border segment.') + '</p>' +
        (cut ? btn('reset-segments', 'Reset every piece to one segment', 'outline', 'reset') : '') +
        '</div></div>'
      : '';
    return (
      '<div class="np">' +
      '<nav class="np-rail" aria-label="' + (rules ? 'Pack rules' : 'Steps of the new pack') + '">' +
      stepRail(npSteps, rules ? 'Changed, not applied yet' : 'Your settings') + '</nav>' +
      '<div class="np-panel">' +
      '<form data-lib-form class="np-step" data-step="basics">' + stepHead(npSteps[0]) + basics + '</div></form>' +
      '<div data-np-optional>' + optionalStepForms(npValues) + '</div>' +
      segments +
      '</div></div>' +
      '<div class="lib-footer np-footer">' +
      '<p class="np-note" data-np-note></p>' +
      '<span data-np-first>' + back() + '</span>' +
      btn('np-back', 'Back') +
      (rules ? '' : btn('np-skip', 'Skip this step')) +
      (rules
        ? btn('commit-rules', c.pieces.length ? 'Apply to all ' + count(c.pieces.length) : 'Save pack rules', 'primary', 'check')
        : btn('commit-new', 'Create track pack', 'outline', 'plus')) +
      btn('np-next', 'Next', rules ? 'outline' : 'primary') +
      '</div>'
    );
  }
  // The profile, pieces and rules a new pack starts with.
  function startSource(from) {
    if (from === 'copy') return active();
    if (from === 'starter' || from === 'single-starter') return starterPack(from === 'single-starter' ? 1 : 2);
    return {
      profile: canSavePiece ? profileFromTrack(current().track) : starterPack().profile,
      pieces: [],
      rules: {},
    };
  }
  function startValues(from) {
    const source = startSource(from);
    return { ...stepValues(source), baseProfile: source.profile, source };
  }
  // Each step says what it holds now, and has a dot once you changed it.
  // The header shows the name of the pack, and whether it can be made.
  function syncRail() {
    for (const b of dialog.querySelectorAll('.np-rail [data-np-go]')) {
      const key = b.dataset.npGo;
      b.classList.toggle('np-done', npChanged.has(key));
      const form = dialog.querySelector('.np-step[data-step="' + key + '"]');
      const line = form ? stepSummary(key, form) : '';
      const sum = b.querySelector('[data-np-sum]');
      if (sum.textContent !== line) sum.textContent = line;
    }
    const pill = $('[data-np-ready]');
    if (screen === 'rules') {
      pill.classList.add('np-ready-ok');
      pill.lastChild.textContent = count(active().pieces.length);
    } else {
      const name = $('[name="itemName"]').value.trim();
      $('[data-np-title]').textContent = name || 'Untitled pack';
      const ready = name !== '' && $('form[data-step="basics"]').checkValidity();
      pill.classList.toggle('np-ready-ok', ready);
      pill.lastChild.textContent = ready ? 'Ready to create' : name ? 'Check the basics' : 'Give it a name';
    }
    $('[data-np-note]').textContent = footNote(npChanged, npSteps);
  }
  function showStep(i) {
    npStep = i;
    const key = npSteps[i].key;
    for (const step of dialog.querySelectorAll('.np-step')) step.hidden = step.dataset.step !== key;
    for (const b of dialog.querySelectorAll('.np-rail [data-np-go]')) {
      if (b.dataset.npGo === key) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    }
    syncRail();
    const last = i === npSteps.length - 1;
    $('[data-lib="np-back"]').hidden = i === 0;
    const skip = $('[data-lib="np-skip"]');
    if (skip) skip.hidden = i === 0 || last;
    $('[data-lib="np-next"]').hidden = last;
    const create = $('[data-lib="commit-new"]');
    if (create) create.className = last ? 'primary' : 'outline';
    $('.np-panel').scrollTop = 0;
    syncTrackside();
    syncTexture();
  }
  // The first step whose form is not valid is shown, with its message.
  function validSteps(upTo = npSteps.length) {
    for (const form of dialog.querySelectorAll('form.np-step')) {
      const i = npSteps.findIndex((s) => s.key === form.dataset.step);
      if (i >= upTo || form.checkValidity()) continue;
      showStep(i);
      form.reportValidity();
      return false;
    }
    return true;
  }
  function readRules() {
    return validatePackRules(
      Object.fromEntries(ruleFields.map(([key, prop]) => [prop, $('[name="' + key + '"]').valueAsNumber])),
    );
  }
  const PACK_SETTERS = [
    ['borders', 'setBorders', 'the borders'],
    ['markings', 'setMarkings', 'the lines and kerbs'],
    ['texture', 'setTexture', 'the road surface'],
    ['trackside', 'setTrackside', 'the trackside accessories'],
  ];
  async function commitNew() {
    const name = $('[name="itemName"]').value.trim();
    if (!name) {
      showStep(0);
      throw Error('Enter a pack name.');
    }
    const from = $('[name="startWith"]').value;
    // The pack the steps were filled from: its profile is the one they change.
    const { source } = npValues;
    const chosen = readOptionalSteps(dialog, npChanged, npValues);
    const rules = from === 'empty' ? readRules() : (source.rules ?? defaultPackRules());
    if (source.pieces.length && chosen.profile !== source.profile) await verify(source.pieces, chosen.profile);
    const setters = PACK_SETTERS.filter(([key]) => chosen[key]);
    // An empty pack keeps them in its rules for new pieces; a pack with
    // pieces gives them to its pieces as well, as Pack rules does.
    const id = await store.createCollection(
      name,
      chosen.profile,
      source.pieces,
      source.pieces.length ? rules : { ...rules, ...Object.fromEntries(setters.map(([key]) => [key, chosen[key]])) },
    );
    if (source.pieces.length)
      try {
        for (const [key, setter, what] of setters) {
          note('Applying ' + what + ' to ' + count(source.pieces.length) + '…');
          await store[setter](id, chosen[key]);
        }
      } catch (e) {
        // Nothing is left half made: the pack goes, and the dialog stays open.
        await store.deletePack(id);
        throw e;
      }
    activeId = id;
    await reload();
    page = 0;
    copying = false;
    screen = 'browse';
    message = 'Track pack ' + name + ' created.';
    render();
  }
  // Pack rules: every changed step, checked on every piece first, so a
  // setting a piece cannot take leaves the pack as it was.
  async function commitRules() {
    const c = active();
    if (!npChanged.size) {
      screen = 'browse';
      message = 'Nothing changed in the pack rules.';
      render();
      return;
    }
    const chosen = readOptionalSteps(dialog, npChanged, npValues);
    const dimensions = npChanged.has('basics') ? readRules() : null;
    const setters = PACK_SETTERS.filter(([key]) => chosen[key]);
    const extras = Object.fromEntries(setters.map(([key]) => [key, chosen[key]]));
    const sections = setters.map(([key]) => key);
    const trial = (piece) => ({
      name: piece.name,
      track: { ...piece.track, params: withPackSections(piece.track.params, extras, sections) },
    });
    const work = current();
    const open = work.link?.collectionId === c.id;
    // Every piece is checked before anything is saved, the open one as it is
    // in Track Set, so a refused setting leaves the pack as it was.
    if (chosen.profile !== npValues.baseProfile || sections.length) {
      await verify(c.pieces.map(trial), chosen.profile);
      if (open) await verify([trial({ name: work.name, track: work.track })], chosen.profile);
    }
    // Save the piece that is open before its pack changes under it.
    if (open) await prepare();
    let fresh = open ? (await reload(), active()) : c;
    const step = async (run) => {
      await run(fresh);
      await reload();
      fresh = active();
    };
    if (dimensions) await step((f) => store.setRules(f.id, dimensions, { expectedRevision: f.revision }));
    if (chosen.profile !== npValues.baseProfile)
      await step((f) => store.setProfile(f.id, chosen.profile, { expectedRevision: f.revision }));
    for (const [key, setter, what] of setters) {
      note('Applying ' + what + ' to ' + count(fresh.pieces.length) + '…');
      await step((f) => store[setter](f.id, chosen[key], { expectedRevision: f.revision }));
    }
    // The open piece is one of them: open it again as the pack has it now.
    const again = open && fresh.pieces.find((p) => p.id === work.link.pieceId);
    if (again) await openPiece(fresh, again);
    screen = 'browse';
    message = fresh.pieces.length
      ? 'Pack rules applied to ' + count(fresh.pieces.length) + '. New pieces start with them.'
      : 'Pack rules saved for new pieces.';
    render();
  }
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
  // The pieces of a page in groups, as in Track Set.
  function pieceGroups(pieces, profile) {
    const plain = (p) => !p.track.params.special;
    return [
      ['Straights', (p) => plain(p) && p.track.params.kind === 'straight'],
      ['Corners', (p) => plain(p) && p.track.params.kind === 'curve'],
      ['Drawn pieces', (p) => plain(p) && !['straight', 'curve'].includes(p.track.params.kind)],
      ['Special pieces', (p) => !plain(p)],
    ]
      .map(([title, takes]) => {
        const members = pieces.filter(takes);
        return members.length
          ? '<div class="lib-group">' + esc(title) + '</div><div class="lib-cards">' +
              members.map((piece) => card(piece, profile)).join('') + '</div>'
          : '';
      })
      .join('');
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
      (createPiece ? btn('create-piece', 'Add track piece', 'soft', 'plus') : '') +
      btn('rules', 'Pack rules', 'primary', 'settings') +
      '</div>' +
      (c.pieces.length
        ? pieceGroups(c.pieces.slice(start, start + perPage), c.profile)
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
  function render() {
    queueMicrotask(syncTrackside);
    npSteps = null;
    const c = active();
    let title = 'Track packs',
      body;
    if (screen === 'save' && c) {
      title = 'Save to library';
      body = saveView();
    } else if ((screen === 'rules' && c) || screen === 'new') {
      title = screen === 'new' ? 'New track pack' : c.name + ' · Pack rules';
      body = stepWindow(screen, c);
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
      (npSteps
        ? '<header class="np-head"><span class="np-badge">' + icon(screen === 'new' ? 'library' : 'settings') + '</span>' +
          '<div><div class="sf-eyebrow">' + (screen === 'new' ? 'New track pack' : 'Pack rules') + '</div>' +
          '<h2 id="lib-title" data-np-title>' + esc(screen === 'new' ? 'Untitled pack' : c.name) + '</h2></div>' +
          '<span class="np-ready" data-np-ready><span class="np-dot" aria-hidden="true"></span><span></span></span>'
        : '<header class="np-head lib-head"><span class="np-badge">' +
          icon(screen === 'restore' ? 'import' : screen === 'save' ? 'save' : 'library') +
          '</span><div><div class="sf-eyebrow">' +
          esc(screen === 'browse' && c ? 'Track pack' : 'Library') +
          '</div><h2 id="lib-title">' + esc(screen === 'browse' && c ? c.name : title) + '</h2></div>') +
      '<button type="button" class="icon-button" aria-label="Close library" data-lib="close">' +
      icon('close') +
      '</button></header>' +
      body +
      '<p class="lib-status" role="status"></p>';
    dialog.classList.toggle('lib-wide', Boolean(npSteps));
    if (npSteps) showStep(Math.max(0, npSteps.findIndex((s) => s.key === npReturn)));
    npReturn = null;
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
  dialog.addEventListener('cancel', (e) => {
    if (locked) e.preventDefault();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  // The pack's trackside form shows the parts its choices use.
  function syncTrackside() {
    const form = $('[data-lib-trackside]');
    if (!form) return;
    syncTracksideControls(form);
    syncPropertyReadouts(form);
  }
  dialog.addEventListener('input', syncTrackside);
  dialog.addEventListener('change', syncTrackside);
  // So does the pack's texture form.
  function syncTexture() {
    const form = $('[data-lib-texture]');
    if (form) syncTextureControls(form);
  }
  dialog.addEventListener('input', syncTexture);
  dialog.addEventListener('change', syncTexture);
  // A step the user changed sets the pack; a step left alone keeps what
  // the pack starts with.
  const markStep = (e) => {
    const step = e.target.closest?.('form.np-step')?.dataset.step;
    if (step && (step !== 'basics' || screen === 'rules')) npChanged.add(step);
    if (step) syncRail();
  };
  dialog.addEventListener('input', markStep);
  dialog.addEventListener('change', markStep);
  dialog.addEventListener('input', (e) => {
    if (e.target.name === 'packLanes') syncRuleSpacing();
  });
  dialog.addEventListener('change', (e) => {
    if (e.target.name === 'startWith') {
      const group = $('[data-new-pack-rules]');
      group.hidden = group.querySelector('fieldset').disabled = e.target.value !== 'empty';
      // The optional steps start again from the chosen pack.
      npValues = startValues(e.target.value);
      npChanged = new Set();
      $('[data-np-optional]').innerHTML = optionalStepForms(npValues);
      showStep(0);
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
    if (npSteps && npStep < npSteps.length - 1) {
      $('[data-lib="np-next"]').click();
      return;
    }
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
    if (b.dataset.npGo) {
      const i = npSteps.findIndex((s) => s.key === b.dataset.npGo);
      // Basics first: the steps after it need a valid start.
      if (i > 0 && !validSteps(1)) return;
      showStep(i);
      return;
    }
    if (id === 'np-next' || id === 'np-skip') {
      const form = $('.np-step:not([hidden])');
      if (id === 'np-next' && form?.matches('form') && !form.reportValidity()) return;
      showStep(Math.min(npStep + 1, npSteps.length - 1));
      return;
    }
    if (id === 'np-back') {
      showStep(Math.max(npStep - 1, 0));
      return;
    }
    if (id === 'commit-new' || id === 'commit-rules') {
      if (!validSteps()) return;
      void perform(id === 'commit-new' ? commitNew : commitRules);
      return;
    }
    if (id === 'reset-segments') {
      void perform(async () => {
        const work = current();
        const open = work.link?.collectionId === c.id;
        // Save the piece that is open before its pack changes under it.
        if (open) await prepare();
        const fresh = open ? (await reload(), active()) : c;
        const { changed } = await store.resetSegments(fresh.id, {
          expectedRevision: fresh.revision,
        });
        await reload();
        // The open piece is one of them: open it again as the pack has it now.
        const again = open && active().pieces.find((p) => p.id === work.link.pieceId);
        if (again) await openPiece(active(), again);
        message = changed
          ? count(changed) + (changed === 1 ? ' is' : ' are') + ' whole again: one segment each.'
          : 'Every piece was already whole.';
        npReturn = 'segments';
        render();
      });
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
    if (id === 'commit-piece') {
      if (!$('[data-lib-form]').reportValidity()) return;
      void perform(commitPiece);
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
