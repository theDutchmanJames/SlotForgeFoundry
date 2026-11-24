import { syncSlopeControls } from './slope-controls.js';
import { syncTextureControls } from './texture-controls.js';
import { choice, details, field, fmt } from './ui.js';
import { importedTrackPaths } from './geometry/import-track.js';
import { nativePath } from './track.js';
import { readSpecialFields, syncSpecialControls } from './special-piece-controls.js';
import { pitLayout } from './geometry/special-junction-layout.js';
import { readStartingGridFields, syncStartingGridControls } from './starting-grid-controls.js';
import { syncRoadMarkingFields } from './paint-controls.js';
import { consumeSlotFields, syncSlotPositionControls } from './slot-position-controls.js';
import { syncTracksideControls } from './trackside-controls.js';

export function laneLayoutControls(p) {
  const a = p.laneAdjustment;
  return (
    choice('laneMode', 'Lane spacing through piece', a?.mode ?? 'uniform', [
      ['uniform', 'Uniform'],
      ['squeeze', 'Squeeze'],
      ['spread', 'Spread'],
    ]) +
    '<fieldset class="border-apex-fields" data-lane-adjustment>' +
    field(
      'laneMiddle',
      'Spacing at the middle',
      a?.spacingMm ?? suggestedSpacing(p.laneSpacing, 'squeeze'),
      'mm',
      { min: 0.1, max: 1000 },
    ) +
    (p.kind === 'curve'
      ? choice('laneAnchor', 'Corner alignment', a?.anchor ?? 'centre', [
          ['centre', 'Move lanes around the centre'],
          ['inner', 'Keep the inside lane fixed'],
        ])
      : '') +
    '<p class="hint">The slots and braids return to normal spacing at both ends.</p></fieldset>'
  );
}

export const suggestedSpacing = (spacing, mode) =>
  Number((spacing * (mode === 'spread' ? 1.15 : 0.8)).toFixed(3));

const importedLengths = new WeakMap();
const racingLengths = new WeakMap();
export function borderRunLength(track, side) {
  const p = track.params,
    sign = side === 'inner' ? -1 : 1;
  // Diamond angles give each exposed arm a different length. Its shared tip
  // control is measured as a percentage of each arm's own edge.
  if (p.special?.type === 'diamond') return 100;
  if (p.special?.type === 'pit') return pitLayout(p).path.edgeLength(sign);
  if (['chicane','duel','hairpin'].includes(p.special?.type)) {
    if (!racingLengths.has(p)) {
      const path = nativePath(p);
      racingLengths.set(p,{ inner: path.edgeLength(-1), outer: path.edgeLength(1) });
    }
    return racingLengths.get(p)[side];
  }
  if (p.kind === 'straight') return p.length;
  if (p.kind === 'curve')
    return ((p.radius + (sign * p.width) / 2) * p.angle * Math.PI) / 180;
  if (!track.plan || track.plan.flatCrossing || track.custom?.closed) return 0;
  let cached = importedLengths.get(track.plan);
  if (cached?.width !== p.width) {
    const { path } = importedTrackPaths(p, track.plan);
    cached = {
      width: p.width,
      outer: path?.edgeLength(1) ?? 0,
      inner: path?.edgeLength(-1) ?? 0,
    };
    importedLengths.set(track.plan, cached);
  }
  return cached[side];
}

const sideTitles = { outer: 'Outside', inner: 'Inside' };
const endTitles = { start: 'Entry', finish: 'Exit' };
const shapeChoices = [
  ['continue', 'Square / continue'],
  ['rounded', 'Rounded'],
  ['tapered', 'Tapered'],
  ['s-curve', 'S-curve'],
];
export const endFieldKey = (side, end) =>
  side + (end === 'start' ? 'Start' : 'Finish');
export function borderEndControls(track, activeSide) {
  if (activeSide === 'none') return '';
  const diamond = track.params.special?.type === 'diamond';
  const active = Object.keys(sideTitles).filter(
    (s) => s === activeSide || activeSide === 'both',
  );
  const body = active
    .map((side) => {
      const total = borderRunLength(track, side);
      if (!(total > 0)) return '';
      return Object.keys(endTitles)
        .map((end) => {
          const key = endFieldKey(side, end),
            value = track.params.borderEnds?.[side]?.[end];
          const at = value?.at ?? (end === 'start' ? 0 : 1);
          return (
            '<div data-border-end="' +
            key +
            '">' +
            choice(
              key + 'Shape',
              sideTitles[side] + ' ' + endTitles[end].toLowerCase(),
              value?.shape ?? 'continue',
              shapeChoices,
            ) +
            '<fieldset class="border-apex-fields" data-end-options>' +
            choice(key + 'Length', 'Finish length', value?.length ?? 'short', [
              ['short', 'Short'],
              ['long', 'Long'],
            ]) +
            field(
              key + 'Distance',
              diamond ? 'Tip along each arm' : 'Tip from start',
              Number((at * total).toFixed(6)),
              diamond ? '%' : 'mm',
              { min: 0, max: Math.ceil(total * 1e6) / 1e6 },
            ) +
            '</fieldset></div>'
          );
        })
        .join('');
    })
    .join('');
  return body
    ? details(
        'Border ends',
        body +
          (diamond
            ? '<p class="hint">Entry arms run from the port to the crossing. Exit arms run from the crossing to the port. Each tip is measured along its own arm.</p>'
            : '<p class="hint">Measure along the road edge from the start of the piece. Set an exit tip partway along a straight to leave the rest bare.</p>'),
        Boolean(track.params.borderEnds),
      )
    : '<p class="hint">A shaped border end needs an open road with two identifiable ends.</p>';
}

export function syncTrackShapeControls(form) {
  if (!form) return;
  syncSpecialControls(form);
  syncRoadMarkingFields(form);
  syncStartingGridControls(form);
  const e = form.elements,
    mode = e.laneMode;
  if (e.reinforcement) {
    const ribs = form.querySelector('[data-underside-ribs]');
    const spacing = form.querySelector('[data-rib-spacing]');
    ribs.hidden = ribs.disabled = !e.hollow.checked;
    spacing.hidden = spacing.disabled = !e.reinforcement.checked;
  }
  if (e.endStop) {
    const stop = form.querySelector('[data-end-stop]');
    stop.hidden = stop.disabled = !e.endStop.checked;
  }
  syncTracksideControls(form);
  syncTextureControls(form);
  syncSlopeControls(form);
  if (e.braidStyle)
    for (const group of form.querySelectorAll('[data-braid-style]'))
      group.hidden = group.disabled = group.dataset.braidStyle !== e.braidStyle.value;
  if (e.slotEdge)
    syncSlotPositionControls(form, {
      kind: e.kind?.value,
      lanes: e.lanes?.value,
      squeeze: Number(e.lanes?.value) >= 2 && Boolean(mode) && mode.value !== 'uniform',
      spacing: e.laneSpacing?.value,
    });
  if (e.laneSpacing) {
    const single = Number(e.lanes.value) === 1;
    form.querySelector('[data-lane-spacing-controls]').hidden = single;
    // One lane runs down the centre unless Slot position moves it.
    form.querySelector('[data-centred-lane]').hidden =
      !single || (e.slotEdge?.value ?? 'centre') !== 'centre';
    e.laneSpacing.disabled = single;
  }
  if (mode) {
    mode.disabled = Number(e.lanes.value) < 2;
    const group = form.querySelector('[data-lane-adjustment]');
    group.hidden = group.disabled = mode.disabled || mode.value === 'uniform';
  }
  for (const row of form.querySelectorAll('[data-border-end]')) {
    const group = row.querySelector('fieldset');
    group.hidden = group.disabled =
      e[row.dataset.borderEnd + 'Shape'].value === 'continue';
  }
}

// Consume inspector-only fields before ordinary model parameters are assigned.
export function readTrackShapeFields(page, track) {
  const fields = { ...page },
    p = track.params;
  readSpecialFields(fields,p);
  // The slot comes first: a new grid mark is sized to the road beside it.
  consumeSlotFields(fields, p);
  readStartingGridFields(fields,p);
  if (Number(fields.lanes) === 1 && !(fields.laneSpacing >= 0.1 && fields.laneSpacing <= 1000))
    delete fields.laneSpacing;
  if (Object.hasOwn(fields, 'laneMode')) {
    if (Number(fields.lanes) < 2 || fields.laneMode === 'uniform')
      delete p.laneAdjustment;
    else
      p.laneAdjustment = {
        version: 1,
        mode: fields.laneMode,
        spacingMm: fields.laneMiddle,
        anchor:
          (fields.kind ?? p.kind) === 'curve'
            ? (fields.laneAnchor ?? 'centre')
            : 'centre',
      };
    delete fields.laneMode;
    delete fields.laneMiddle;
    delete fields.laneAnchor;
  }
  let ends;
  for (const side of Object.keys(sideTitles))
    for (const end of Object.keys(endTitles)) {
      const key = endFieldKey(side, end),
        shape = fields[key + 'Shape'];
      if (shape === undefined) continue;
      ends ??= structuredClone(p.borderEnds ?? {});
      if (shape === 'continue') {
        if (ends[side]) delete ends[side][end];
      } else {
        const total = borderRunLength(track, side),
          distance = fields[key + 'Distance'];
        if (!(total > 0 && distance >= 0 && distance <= total + 1e-6))
          throw Error(
            'Set the ' +
              sideTitles[side].toLowerCase() +
              ' ' +
              endTitles[end].toLowerCase() +
              ' tip between 0 and ' +
              fmt(total) +
              (p.special?.type === 'diamond' ? '%.' : ' mm.'),
          );
        const oldAt = ends[side]?.[end]?.at;
        const at =
          Number.isFinite(oldAt) &&
          Math.abs(distance - oldAt * total) < 0.000001
            ? oldAt
            : Math.min(1, distance / total);
        (ends[side] ??= {})[end] = {
          shape,
          length: fields[key + 'Length'],
          at,
        };
      }
      if (ends[side] && !Object.keys(ends[side]).length) delete ends[side];
      delete fields[key + 'Shape'];
      delete fields[key + 'Distance'];
      delete fields[key + 'Length'];
    }
  if (ends && Object.keys(ends).length) p.borderEnds = ends;
  else if (ends) delete p.borderEnds;
  return fields;
}
