import './connector-placement.css';
import { connectorLayout } from './geometry/connector-layout.js';
import { connectorMap } from './connector-placement-map.js';
import { formatConnectorPositions } from './connection-controls.js';
import { icon } from './ui.js';

const scopes = {
  start: ['Road start', 'start', 'jointStart'],
  seam: ['Between road segments', 'seam', 'joint'],
  finish: ['Road finish', 'finish', 'jointEnd'],
  outerSide: ['Road to outside border', 'side', 'borderMount', 'outer'],
  innerSide: ['Road to inside border', 'side', 'borderMount', 'inner'],
  outerEnd: ['Outside border ends', 'end', 'borderJoint', 'outer'],
  innerEnd: ['Inside border ends', 'end', 'borderJoint', 'inner'],
};
const includesKind = (mode, kind) =>
  mode === 'both' || mode === (kind === 'clip' ? 'clips' : 'tabs');
const modeWith = (mode, kind) =>
  includesKind(mode, kind)
    ? mode
    : mode === 'clips' || mode === 'tabs'
      ? 'both'
      : kind === 'clip'
        ? 'clips'
        : 'tabs';
const round = (v) => Number(v.toFixed(8));
const numericSort = (a, b) => a - b;

/** All coordinates go through the same Connections draft used by manual
 * entry, Restore, Apply, project saving and the printable geometry worker. */
export function editConnectorPlacement({
  getTrack,
  writeFields,
  getLive,
  previous,
}) {
  const track = getTrack();
  const initial = track.params;
  const crossing = track.plan?.flatCrossing?.crossings[0];
  const dialog = document.createElement('dialog');
  dialog.className = 'connector-placement';
  dialog.setAttribute('aria-labelledby', 'cp-title');
  dialog.innerHTML =
    '<header><h2 id="cp-title">Customize connector positions</h2><button type="button" data-cp-close aria-label="Back to 3D">' +
    icon('close') +
    '</button></header>' +
    '<div class="cp-work"><div class="cp-stage"><div class="cp-top"><span>' +
    (crossing ? 'Lower road · shared joint settings' : 'Top view') +
    '</span><label><input type="checkbox" data-cp-all> Whole piece</label></div>' +
    '<svg data-cp-map role="group" aria-label="Connector positions on selected track joint"></svg><p class="cp-hint" data-cp-hint></p></div>' +
    '<section class="cp-settings"><label>Joint<select data-cp-scope></select></label>' +
    '<label data-cp-example-label>Showing<select data-cp-example></select></label>' +
    '<div><span>Place</span><div class="cp-kinds"><button type="button" data-cp-kind="clip">Clips</button><button type="button" data-cp-kind="tab">Tabs</button></div></div>' +
    '<div class="cp-count"><label for="cp-count-input">Custom marks</label><div><button type="button" data-cp-minus aria-label="Remove one connector">−</button><input id="cp-count-input" type="number" min="0" max="8" step="1" data-cp-count><button type="button" data-cp-plus aria-label="Add one connector">+</button></div></div>' +
    '<label>Spacing<select data-cp-spacing><option value="even">Even between outer marks</option><option value="exact">Keep clicked positions</option></select></label>' +
    '<button type="button" data-cp-spread>Space across joint</button>' +
    '<label>Selected mark<select data-cp-pick></select></label>' +
    '<label class="cp-position"><span data-cp-unit>Position</span><input type="number" step="any" data-cp-value></label>' +
    '<div class="cp-mark-actions"><button type="button" data-cp-remove>Remove mark</button><button type="button" data-cp-auto>Use automatic</button></div>' +
    '<output data-cp-summary></output></section></div>' +
    '<p class="cp-status" data-cp-status role="status"></p><footer><button type="button" class="outline" data-cp-done>Back to 3D</button><button type="button" class="primary" data-cp-apply>Apply changes</button></footer>';
  document.body.append(dialog);
  const $ = (s) => dialog.querySelector(s);
  const selectScope = $('[data-cp-scope]'),
    example = $('[data-cp-example]'),
    count = $('[data-cp-count]'),
    pick = $('[data-cp-pick]');
  const spacing = $('[data-cp-spacing]'),
    field = $('[data-cp-value]'),
    status = $('[data-cp-status]');
  const hasScope = (key, p) => {
    const [, scope, , side] = scopes[key];
    if (scope === 'seam') return p.segments > 1;
    if (scope === 'end' && p.borderSegments === 1 &&
        p.borderEnds?.[side]?.start && p.borderEnds[side].finish) return false;
    return !side || p.borderSide === side || p.borderSide === 'both';
  };
  for (const [key, [label]] of Object.entries(scopes))
    if (hasScope(key, initial)) selectScope.add(new Option(label, key));
  selectScope.value = [...selectScope.options].some(
    (o) => o.value === previous.scope,
  )
    ? previous.scope
    : ['outer', 'both'].includes(initial.borderSide)
      ? 'outerSide'
      : initial.borderSide === 'inner'
        ? 'innerSide'
        : 'start';
  let kind = previous.kind === 'tab' ? 'tab' : 'clip',
    layout,
    selected = null,
    message = '',
    errorFromLayout = false;
  let tempMarks = null,
    dragError = '',
    params = initial;
  let layoutParts, activePointer = null;
  const preferences = (previous.spacing ??= {});
  const stateKey = () => selectScope.value + '-' + kind;
  const selectedUnit = () =>
    ['side', 'end'].includes(scopes[selectScope.value][1]) ? '%' : 'mm';
  const factor = () => (selectedUnit() === '%' ? 100 : 1);
  const shownValue = (v) => Number((v * factor()).toFixed(5));
  const map = connectorMap($('[data-cp-map]'), {
    select(mark) {
      kind = mark.kind;
      selected = mark.index;
      message = '';
      renderControls();
    },
    add(value) {
      perform(() => add(value));
    },
    drag(mark, value, finish) {
      move(mark, value, finish);
    },
    cancel() {
      tempMarks = null;
      dragError = '';
      renderControls();
    },
  });
  function showStatus() {
    const live = getLive();
    status.textContent =
      dragError ||
      message ||
      (live?.state === 'error'
        ? live.message
        : live?.state === 'updating'
          ? 'Checking the fit on every joint…'
          : '');
    status.hidden = !status.textContent;
    $('[data-cp-apply]').disabled =
      !live?.dirty || live.state !== 'ready' || errorFromLayout;
  }
  const liveElement = document.querySelector('#live-status');
  function syncGenerated() {
    if (!dialog.open) return;
    const built = getLive()?.parts;
    if (built && built !== layoutParts && activePointer == null &&
        ![field, count, pick].includes(document.activeElement)) {
      syncLayout(false, true);
    } else showStatus();
  }
  const svg = $('[data-cp-map]');
  svg.addEventListener('pointerdown', event => {
    if (svg.hasPointerCapture(event.pointerId)) activePointer = event.pointerId;
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    svg.addEventListener(name, event => {
      if (activePointer !== event.pointerId) return;
      activePointer = null;
      queueMicrotask(syncGenerated);
    });
  }
  dialog.addEventListener('focusout', () => queueMicrotask(syncGenerated));
  const observer = new MutationObserver(syncGenerated);
  if (liveElement)
    observer.observe(liveElement, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
    });
  function examples() {
    const [, scope, , side] = scopes[selectScope.value];
    example.replaceChildren();
    const roadSegments = params.segments ?? 1,
      borderSegments = params.borderSegments ?? 1;
    for (const [label, n] of [
      ['Road', roadSegments],
      ['Border', borderSegments],
    ]) {
      if (!Number.isInteger(n) || n < 1 || n > 32)
        throw Error(label + ' segments must be a whole number from 1 to 32.');
    }
    if (scope === 'side')
      for (let i = 0; i < borderSegments; i++)
        example.add(new Option('Border segment ' + (i + 1), i));
    if (scope === 'end')
      for (let i = 0; i <= borderSegments; i++) {
        if (i === 0 && params.borderEnds?.[side]?.start ||
            i === borderSegments && params.borderEnds?.[side]?.finish) continue;
        example.add(
          new Option(
            i === 0
              ? 'Border start'
              : i === borderSegments
                ? 'Border finish'
                : 'After border segment ' + i,
            i,
          ),
        );
      }
    if (scope === 'seam')
      for (let i = 1; i < roadSegments; i++)
        example.add(new Option('After road segment ' + i, i));
    $('[data-cp-example-label]').hidden = example.length < 2;
    if (
      previous.example?.[selectScope.value] != null &&
      [...example.options].some(
        (o) => +o.value === previous.example[selectScope.value],
      )
    )
      example.value = previous.example[selectScope.value];
  }
  function syncLayout(reset = false, fromWorker = false) {
    tempMarks = null;
    dragError = '';
    if (!fromWorker || errorFromLayout) message = '';
    errorFromLayout = false;
    try {
      const track = getTrack();
      layoutParts = getLive()?.parts;
      params = track.params;
      if (reset) examples();
      const [, scope, , side] = scopes[selectScope.value];
      layout = connectorLayout(params, track.plan, scope, {
        side: side ?? 'outer',
        index: example.value === '' ? undefined : +example.value,
        parts: layoutParts,
        editInvalid: true,
      });
      if (layout.placementWarning) {
        message = layout.placementWarning;
        errorFromLayout = true;
      }
    } catch (error) {
      layout = null;
      message = error.message;
      errorFromLayout = true;
    }
    // Clear obsolete marks before switching from percentage to signed offsets.
    map.setMarks(null, null);
    map.setLayout(layout, $('[data-cp-all]').checked);
    renderControls();
  }
  function renderControls() {
    const positions = tempMarks ?? layout?.positions ?? { clip: [], tab: [] },
      list = positions[kind];
    if (selected != null && selected >= list.length) selected = null;
    for (const b of dialog.querySelectorAll('[data-cp-kind]'))
      b.setAttribute('aria-pressed', String(b.dataset.cpKind === kind));
    const requested = preferences[stateKey()];
    const delta = list.length > 1 ? list[1] - list[0] : 0;
    const equallySpaced = list.every(
      (v, i) => i < 2 || Math.abs(v - list[i - 1] - delta) < 1e-5,
    );
    spacing.value = requested ?? (equallySpaced ? 'even' : 'exact');
    count.value = String(list.length);
    count.disabled = !layout;
    $('[data-cp-minus]').disabled = !layout || !list.length;
    $('[data-cp-plus]').disabled = !layout || list.length >= 8;
    spacing.disabled = !layout;
    $('[data-cp-spread]').disabled = !layout || !list.length;
    pick.replaceChildren(new Option('Choose a mark', ''));
    for (const [i, v] of list.entries())
      pick.add(
        new Option(
          (kind === 'clip' ? 'Clip ' : 'Tab ') +
            (i + 1) +
            ' · ' +
            shownValue(v) +
            ' ' +
            selectedUnit(),
          i,
        ),
      );
    pick.value = selected == null ? '' : String(selected);
    pick.disabled = !list.length;
    field.disabled = selected == null;
    field.value = selected == null ? '' : shownValue(list[selected]);
    $('[data-cp-unit]').textContent =
      selectedUnit() === '%'
        ? 'Position along joint (%)'
        : 'Offset from road centre (mm)';
    $('[data-cp-remove]').disabled = selected == null;
    $('[data-cp-auto]').disabled =
      !layout ||
      (params.placements?.[layout.key(kind)] == null &&
        !params.mutedPlacements?.includes(layout.key(kind)));
    const joinScope = scopes[selectScope.value][1];
    const sharedKey = joinScope + (kind === 'clip' ? 'Clips' : 'Tabs');
    $('[data-cp-auto]').textContent =
      layout && params.mutedPlacements?.includes(layout.key(kind))
        ? 'Use saved marks'
        : ['side', 'end'].includes(joinScope) &&
            params.placements?.[sharedKey] != null
          ? 'Use shared positions'
          : 'Use automatic';
    const repeated =
      joinScope === 'side'
        ? ' Positions repeat on each border segment.'
        : joinScope === 'end'
          ? ' Positions repeat at each border end.'
          : joinScope === 'seam'
            ? ' Positions repeat at each road seam.'
            : '';
    $('[data-cp-hint]').textContent =
      'Click the highlighted joint to add a ' +
      kind +
      '. Drag a mark to move it.' +
      repeated +
      (layout?.fixedRow
        ? ' This piece has an off-centre slot, so automatic marks at its ends keep fixed places and matching ends always fit.'
        : '');
    const names = (k) =>
      positions[k].length + ' ' + k + (positions[k].length === 1 ? '' : 's');
    const distance =
      layout && list.length > 1 && equallySpaced
        ? (Math.abs(delta) * layout.length) /
          (layout.domain[1] - layout.domain[0])
        : 0;
    $('[data-cp-summary]').textContent =
      names('clip') +
      ' · ' +
      names('tab') +
      (distance
        ? ' · ' + Number(distance.toFixed(2)) + ' mm between ' + kind + 's'
        : '');
    map.setMarks(
      positions,
      selected == null ? null : { kind, index: selected },
    );
    showStatus();
  }
  function perform(fn) {
    if (!layout) return;
    try {
      message = '';
      fn();
    } catch (e) {
      message = e.message;
      tempMarks = null;
      dragError = '';
      renderControls();
    }
  }
  function write(list) {
    const key = layout.key(kind),
      [, scope, modeField, side] = scopes[selectScope.value],
      fields = { ['place_' + key]: formatConnectorPositions(key, list) };
    const mutes = new Set(params.mutedPlacements ?? []);
    mutes.delete(key);
    if (list?.length && !includesKind(layout.mode, kind)) {
      fields[modeField] = modeWith(layout.mode, kind);
      if (side) {
        const opposite =
          (side === 'inner' ? 'outer' : 'inner') +
          (scope === 'side' ? 'Side' : 'End') +
          (kind === 'clip' ? 'Clips' : 'Tabs');
        if (params.placements?.[opposite]?.length) mutes.add(opposite);
        else fields['place_' + opposite] = 'none';
      }
    }
    fields.placementMutes = [...mutes].join(',');
    writeFields(fields);
    syncLayout();
  }
  function add(value) {
    const list = layout.positions[kind];
    if (list.length >= 8)
      throw Error('This joint already has eight ' + kind + 's.');
    const next = [...list, value].sort(numericSort);
    if (next.some((v, i) => i > 0 && Math.abs(v - next[i - 1]) < 1e-9))
      throw Error('A mark already occupies this position.');
    const even = spacing.value === 'even' && next.length > 1;
    if (!even) {
      const why = layout.reason(kind, value);
      if (why) throw Error(why);
    }
    const positions = even
      ? layout.even(kind, next.length, [next[0], next.at(-1)])
      : next;
    selected = next.indexOf(value);
    write(positions);
  }
  function move(mark, value, finish) {
    if (!layout) return;
    const list = layout.positions[kind],
      i = mark.index;
    const middle = i > 0 && i < list.length - 1;
    try {
      const next = [...list];
      next[i] = value;
      const exact = spacing.value === 'exact' || middle || list.length < 2;
      if (!exact && (i === 0 ? value >= list.at(-1) : value <= list[0]))
        throw Error(
          'Keep the outer marks in order, or choose Keep clicked positions.',
        );
      let positions = next;
      if (exact) {
        const why = layout.reason(kind, value, i);
        if (why) throw Error(why);
      } else positions = layout.even(kind, list.length, [next[0], next.at(-1)]);
      if (finish) {
        if (middle) preferences[stateKey()] = 'exact';
        const active = positions[i];
        positions = positions.slice().sort(numericSort);
        selected = positions.indexOf(active);
        write(positions);
      } else {
        tempMarks = { ...layout.positions, [kind]: positions };
        dragError = '';
        renderControls();
      }
    } catch (e) {
      dragError = finish ? '' : e.message;
      if (finish) {
        tempMarks = null;
        message = e.message;
      }
      renderControls();
    }
  }
  selectScope.onchange = () => {
    previous.scope = selectScope.value;
    selected = null;
    syncLayout(true);
  };
  example.onchange = () => {
    (previous.example ??= {})[selectScope.value] = +example.value;
    selected = null;
    syncLayout();
  };
  for (const b of dialog.querySelectorAll('[data-cp-kind]'))
    b.onclick = () => {
      kind = b.dataset.cpKind;
      previous.kind = kind;
      selected = null;
      message = errorFromLayout ? message : '';
      renderControls();
    };
  $('[data-cp-all]').onchange = () =>
    map.setLayout(layout, $('[data-cp-all]').checked);
  count.onchange = () =>
    perform(() => {
      const n = count.valueAsNumber;
      if (!Number.isInteger(n) || n < 0 || n > 8)
        throw Error('Choose a count from zero to eight.');
      const list = layout.positions[kind];
      if (n === list.length) return;
      selected = null;
      const span =
        spacing.value === 'even' && n > 1 && list.length > 1
          ? [list[0], list.at(-1)]
          : undefined;
      let next;
      if (spacing.value === 'exact' && n < list.length) next = list.slice(0, n);
      else if (spacing.value === 'exact' && list.length && n > list.length) {
        next = list.slice();
        while (next.length < n) {
          const [lo, hi] = layout.domain;
          const candidates = Array.from(
            { length: 257 },
            (_, i) => lo + ((hi - lo) * (i + 0.5)) / 257,
          );
          const trial = {
            ...params,
            placements: { ...params.placements, [layout.key(kind)]: next },
          };
          const [, scope, , side] = scopes[selectScope.value],
            test = connectorLayout(trial, getTrack().plan, scope, {
              side: side ?? 'outer',
              index: example.value === '' ? undefined : +example.value,
            });
          const gap = (v) =>
            Math.min(v - lo, hi - v, ...next.map((x) => Math.abs(x - v)));
          const at = candidates
            .sort((a, b) => gap(b) - gap(a))
            .find((v) => !test.reason(kind, v));
          if (at == null)
            throw Error(
              'There is no room for another ' +
                kind +
                ' between the existing marks.',
            );
          next.push(at);
        }
        next.sort(numericSort);
      } else next = layout.even(kind, n, span);
      write(next);
    });
  for (const [selector, delta] of [
    ['[data-cp-minus]', -1],
    ['[data-cp-plus]', 1],
  ]) {
    $(selector).onclick = () => {
      count.value = String(layout.positions[kind].length + delta);
      count.dispatchEvent(new Event('change'));
    };
  }
  spacing.onchange = () =>
    perform(() => {
      const choice = spacing.value,
        list = layout.positions[kind];
      if (choice === 'even' && list.length > 2) {
        const next = layout.even(kind, list.length, [
          Math.min(...list),
          Math.max(...list),
        ]);
        preferences[stateKey()] = choice;
        write(next);
      } else {
        preferences[stateKey()] = choice;
        renderControls();
      }
    });
  $('[data-cp-spread]').onclick = () =>
    perform(() => {
      const next = layout.even(kind, layout.positions[kind].length);
      preferences[stateKey()] = 'even';
      selected = null;
      write(next);
    });
  pick.onchange = () => {
    selected = pick.value === '' ? null : +pick.value;
    renderControls();
  };
  field.onchange = () =>
    perform(() => {
      const n = field.valueAsNumber;
      if (!Number.isFinite(n))
        throw Error('Enter a position in ' + selectedUnit() + '.');
      move({ kind, index: selected }, round(n / factor()), true);
    });
  $('[data-cp-remove]').onclick = () =>
    perform(() => {
      const list = layout.positions[kind].filter((_, i) => i !== selected);
      selected = null;
      write(
        spacing.value === 'even' && list.length > 2
          ? layout.even(kind, list.length, [list[0], list.at(-1)])
          : list,
      );
    });
  $('[data-cp-auto]').onclick = () =>
    perform(() => {
      selected = null;
      const key = layout.key(kind);
      write(
        params.mutedPlacements?.includes(key)
          ? params.placements?.[key]
          : undefined,
      );
    });
  $('[data-cp-done]').onclick = $('[data-cp-close]').onclick = () =>
    dialog.close();
  $('[data-cp-apply]').onclick = () => dialog.close('apply');
  const done = new Promise((resolve) =>
    dialog.addEventListener(
      'close',
      () => {
        const apply = dialog.returnValue === 'apply';
        observer.disconnect();
        map.destroy();
        dialog.remove();
        resolve(apply);
      },
      { once: true },
    ),
  );
  dialog.showModal();
  syncLayout(true);
  return done;
}
