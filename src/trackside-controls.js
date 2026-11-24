import { check, choice, details, field } from './ui.js';
import {
  TRACKSIDE_DEFAULTS,
  TRACKSIDE_END_CHOICES,
  TRACKSIDE_END_SHAPES,
  TRACKSIDE_LIMITS,
  TRACKSIDE_SHAPES,
  TRACKSIDE_TAB_CHOICES,
  TWO_TAB_LENGTH,
} from './geometry/trackside.js';

// The Trackside settings as a form: in Track Set for one piece, and in the
// pack rules for every piece of a pack.

// The settings of one side: '' for the piece (or the outside), 'Inner' for an
// inside that has its own.
function tracksideSet(p, draft, set, titles) {
  const name = (key) => key + set;
  const now = (key) => draft[name(key)] ?? p[name(key)];
  const shape = now('tracksideShape'),
    fence = now('tracksideFence');
  const limit = (key) => ({ min: TRACKSIDE_LIMITS[key][0], max: TRACKSIDE_LIMITS[key][1] });
  const number = (key, label, unit, opts = limit(key)) => field(name(key), label, p[name(key)], unit, opts);
  // A part of the form for one shape, or for several: 'rail rail2'.
  const only = (kind, body) =>
    '<fieldset class="border-apex-fields" data-trackside-shape="' + kind + '" data-trackside-set="' + set + '"' +
    (kind.split(' ').includes(shape) ? '>' : ' hidden disabled>') + body + '</fieldset>';
  return (
    details(
      titles[0],
      choice(name('tracksideShape'), 'Shape', p[name('tracksideShape')], TRACKSIDE_SHAPES) +
        number('tracksideRise', 'Height above the road', 'mm') +
        only(
          'barrier',
          number('tracksideFaceAngle', 'Face angle', '°') +
            '<p class="hint">The foot of a concrete barrier is as high as the track, so the sloped face starts at the road surface. Face angle is how far that face leans back from upright: 0° is a straight wall, and the measured barrier leans 17.1°.</p>',
        ) +
        only(
          'board',
          number('tracksideThickness', 'Board thickness', 'mm') +
            '<p class="hint">A flat wall for a paper sign: print your sign and glue it to the face. With a fence, the board is at least thick enough for a wall on both sides of each post.</p>',
        ) +
        only(
          'rail rail2',
          only('rail', number('tracksideRailHeight', 'Rail height', 'mm')) +
            only('rail2', number('tracksideRailGround', 'Clearance above the road', 'mm')) +
            number('tracksideRailThickness', 'Rail thickness', 'mm') +
            number('tracksidePostWidth', 'Post width', 'mm') +
            number('tracksidePostDepth', 'Post depth', 'mm') +
            number('tracksidePostDrop', 'Post top below the rail top', 'mm') +
            number('tracksidePostInset', 'Post distance from the end', 'mm') +
            number('tracksidePinch', 'Pinch on the rail', 'mm') +
            check(name('tracksideStartPost'), 'Post at the start of the row', p[name('tracksideStartPost')]) +
            '<p class="hint">Post width is along the edge and is never less than the tab width under Joints; post depth is away from the track. The pinch is how much tighter the gap under the T is than the rail: raise it for a firmer hold. Pieces in one row need the same post distance from the end, so each rail reaches the post of the piece before it.</p>' +
            '<p class="hint">Height above the road is the top of the rail; the posts end flush with it and stay hidden behind the rail. A single rail hangs under that top. A double rail fills from the top to just above the road with two rails. Each piece has a post near its finish end, and its rail comes from the post of the piece before it. Switch on the start post for the first piece of a row. Barriers per segment sets the posts per segment.</p>' +
            '<p class="hint">Two rail ends meet on a post: each drops over the stem of a T-shaped peg and is pinched under its head. A post prints on its side and a rail prints flat, both without support. On a bend the rail is still printed straight and bends to follow the posts.</p>',
        ) +
        only(
          'barrier board',
          choice(name('tracksideTabs'), 'Tabs per barrier', String(p[name('tracksideTabs')]), TRACKSIDE_TAB_CHOICES) +
            choice(name('tracksideEnds'), 'Barrier ends', p[name('tracksideEnds')], TRACKSIDE_END_CHOICES),
        ) +
        only(
          'barrier',
          choice(name('tracksideEndShape'), 'End shape', p[name('tracksideEndShape')], TRACKSIDE_END_SHAPES),
        ) +
        number('tracksideSegments', 'Barriers per segment', '', { ...limit('tracksideSegments'), step: 1 }),
      true, 'trackside' + set,
    ) +
    only(
      'board',
      details(
        titles[1],
        check(name('tracksideFence'), 'Fence on the board', p[name('tracksideFence')]) +
          '<fieldset class="border-apex-fields" data-trackside-fence="' + set + '"' + (fence ? '>' : ' hidden disabled>') +
          number('tracksideFenceHeight', 'Fence height above the board', 'mm') +
          number('tracksidePost', 'Post size', 'mm') +
          number('tracksideCable', 'Cable spacing', 'mm') +
          number('tracksideMesh', 'Mesh size', 'mm') +
          '</fieldset>',
        fence, 'fence' + set,
      ),
    )
  );
}

export function tracksideControls(p, draft = {}) {
  const side = draft.tracksideSide ?? p.tracksideSide,
    own = side === 'both' && (draft.tracksideInnerOwn ?? p.tracksideInnerOwn);
  return (
    choice('tracksideSide', 'Barrier side', p.tracksideSide, [
      ['none', 'None'],
      ['outer', 'Outside / left'],
      ['inner', 'Inside / right'],
      ['both', 'Both'],
    ]) +
    '<fieldset class="border-apex-fields" data-trackside' + (side === 'none' ? ' hidden disabled>' : '>') +
    '<fieldset class="border-apex-fields" data-trackside-both' + (side === 'both' ? '>' : ' hidden disabled>') +
    check('tracksideInnerOwn', 'Separate settings for the inside', p.tracksideInnerOwn) +
    '<p class="hint">Switch this on for another shape, height, tabs, ends or fence on the inside (right) than on the outside (left): an advertising board on one side and a concrete barrier on the other, for example.</p></fieldset>' +
    '<div data-trackside-titles>' +
    tracksideSet(p, draft, '', own ? ['Outside barrier', 'Outside catch fence'] : ['Barrier', 'Catch fence']) +
    '</div>' +
    '<fieldset class="border-apex-fields" data-trackside-inner' + (own ? '>' : ' hidden disabled>') +
    tracksideSet(p, draft, 'Inner', ['Inside barrier', 'Inside catch fence']) +
    '</fieldset>' +
    '<p class="hint">A barrier stands on the table beside each border segment, or beside each road segment on a side without a border, and is as long as that edge. Raise Barriers per segment to cut each one into shorter, equal barriers for your print plate. A sloped end is for where a row stops: a concrete barrier runs down to track height over 25 mm, sloped or sloped and rounded, and an advertising board gets a rounded top corner.</p>' +
    '<p class="hint">The tabs and their sockets use the tab size and clearance under Joints. An automatic count gives two tabs from ' +
    TWO_TAB_LENGTH + ' mm of edge. A straight barrier prints on its flat back with the tabs up. A curved one prints standing and needs support under each tab.</p>' +
    '<p class="hint">Each board can carry its own fence: diamond mesh and horizontal cables between two square posts, a quarter and three quarters of the way along. The posts drop 10 mm into sockets in the top of the board. A fence prints flat on the bed in one piece, with no support. On a bend it is still printed flat: its thin mesh bends to follow the board.</p>' +
    '</fieldset>'
  );
}


// Show the parts of the form that the chosen sides and shapes use.
export function syncTracksideControls(form) {
  const e = form.elements;
  if (!e.tracksideSide) return;
  const group = form.querySelector('[data-trackside]');
  group.hidden = group.disabled = e.tracksideSide.value === 'none';
  const both = form.querySelector('[data-trackside-both]');
  both.hidden = both.disabled = e.tracksideSide.value !== 'both';
  const own = !both.disabled && e.tracksideInnerOwn.checked;
  const inner = form.querySelector('[data-trackside-inner]');
  inner.hidden = inner.disabled = !own;
  // With two sets the first one is the outside.
  const titles = form.querySelectorAll('[data-trackside-titles] > details > summary > span, [data-trackside-titles] > fieldset > details > summary > span');
  const names = own ? ['Outside barrier', 'Outside catch fence'] : ['Barrier', 'Catch fence'];
  titles.forEach((title, i) => {
    if (names[i] && title.textContent !== names[i]) title.textContent = names[i];
  });
  for (const set of ['', 'Inner']) {
    if (set && !own) continue;
    const shape = e['tracksideShape' + set].value;
    for (const part of form.querySelectorAll('[data-trackside-shape][data-trackside-set="' + set + '"]'))
      part.hidden = part.disabled = !part.dataset.tracksideShape.split(' ').includes(shape);
    const fence = form.querySelector('[data-trackside-fence="' + set + '"]');
    fence.hidden = fence.disabled = shape !== 'board' || !e['tracksideFence' + set].checked;
  }
}

// The trackside settings as the form has them. A part of the form that is
// switched off keeps the value it had.
export function readTracksideFields(form, current = {}) {
  const result = { ...TRACKSIDE_DEFAULTS, ...current };
  for (const input of form.elements) {
    if (!input.name?.startsWith('trackside') || input.closest('fieldset:disabled')) continue;
    if (input.type === 'checkbox') result[input.name] = input.checked;
    else if (input.type === 'number') {
      if (Number.isFinite(input.valueAsNumber)) result[input.name] = input.valueAsNumber;
    } else result[input.name] = input.value;
  }
  return result;
}
