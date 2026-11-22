import { button, check, choice, details, field } from './ui.js';
import {
  lineDimensions,
  lineGrooves,
  whiteLineLayout,
} from './geometry/paint-guides.js';

const sides = [
  ['none', 'Off'],
  ['inner', 'Inside / right'],
  ['outer', 'Outside / left'],
  ['both', 'Both sides'],
];
const onSide = (setting, side) => setting === 'both' || setting === side;
const mm = (value) => Number(value.toFixed(4)) + ' mm';
export const sharedPaintFields = ['grooveWidth', 'grooveDepth', 'kerbWidth', 'kerbLength', 'kerbGroove'];
export const centreLineStyles = [['none', 'Off'], ['solid', 'Solid'], ['dashed', 'Dashed']];

function grooveSizeFields(p) {
  const { grooveWidth, grooveDepth } = { ...lineDimensions, ...p };
  return (
    field('grooveWidth', 'Groove width', grooveWidth, 'mm', {
      min: 0.05,
      max: 20,
    }) +
    field('grooveDepth', 'Groove depth', grooveDepth, 'mm', {
      min: 0.05,
      max: 50,
    })
  );
}

export function pitDividerControl(p) {
  return check('spPitWhiteLine', 'Pit lane divider', p.special.pitWhiteLine === true) +
    '<fieldset class="border-apex-fields" data-pit-crossing-style' + (p.special.pitWhiteLine ? '>' : ' hidden disabled>') +
    choice('spPitCrossingStyle', 'Entry and exit', p.special.pitCrossingStyle ?? 'solid', centreLineStyles.slice(1)) +
    '<p class="hint">The divider follows the main road edge beside the pit box. Entry and exit markings leave room for the slots and braids.</p></fieldset>';
}

function kerbSizeFields(p) {
  return field('kerbWidth', 'Stripe width', p.kerbWidth ?? 5, 'mm', { min: 0.1, max: 2000 }) +
    field('kerbLength', 'Block length', p.kerbLength ?? 12, 'mm', { min: 0.1, max: 20000 }) +
    check('kerbGroove', 'Recess each kerbstone outline', p.kerbGroove ?? false);
}

export function syncRoadMarkingFields(form) {
  const e = form.elements;
  if (!e.roadCentreLine) return;
  const dashes = form.querySelector('[data-road-dashes]');
  dashes.hidden = dashes.disabled = e.roadCentreLine.value !== 'dashed' &&
    !(e.spPitWhiteLine?.checked && e.spPitCrossingStyle.value === 'dashed');
  // Kerb sizes are shared by road and border kerbs (one Kerbs folder).
  const kerbs = form.querySelector('[data-road-kerbs]');
  kerbs.hidden = kerbs.disabled =
    e.roadKerbSide.value === 'none' && (e.kerbEdge?.value ?? 'none') === 'none';
  const note = form.querySelector('[data-centre-slot-note]');
  const lanes = e.lanes ? Number(e.lanes.value) : Number(note.dataset.lanes);
  note.hidden = e.roadCentreLine.value === 'none' || !(lanes % 2);
}

// The Markings section shows these folders in this order: lines on the road,
// lines on the borders, kerbs on the road, kerbs on the borders, then the
// line and groove sizes they all share.
export function roadMarkings(p) {
  return roadLineFolder(p) + roadKerbFolder(p) + lineSizeFolder(p);
}
export function roadLineFolder(p) {
  const dimensions = { ...lineDimensions, ...p };
  const pit = p.special?.type === 'pit';
  const centre = p.roadCentreLine ?? 'none';
  const dashes = centre === 'dashed' || (pit && p.special.pitWhiteLine && p.special.pitCrossingStyle === 'dashed');
  return (
    details(
      'White lines on the road',
      choice(
        'whiteLineRoad',
        'Mark road edges',
        p.whiteLineRoad ?? 'none',
        sides,
      ) + choice('roadCentreLine', 'Centre line', centre, centreLineStyles) +
        '<p class="hint" data-lanes="' + p.lanes + '" data-centre-slot-note' + (centre !== 'none' && p.lanes % 2 ? '>' : ' hidden>') +
        'A centred guide slot occupies the marking here. Paint appears only on clear road surface.</p>' +
        (pit ? pitDividerControl(p) : '') +
        '<fieldset class="border-apex-fields" data-road-dashes' + (dashes ? '>' : ' hidden disabled>') +
        field('dashLength', 'Dash length', dimensions.dashLength, 'mm', { min: 1, max: 2000 }) +
        field('dashGap', 'Gap between dashes', dimensions.dashGap, 'mm', { min: 1, max: 2000 }) + '</fieldset>' +
        check(
          'roadLineGroove',
          'Recess road markings',
          lineGrooves(p).road,
        ) +
        '<div data-line-layout></div>',
      pit || centre !== 'none' || (!!p.whiteLineRoad && p.whiteLineRoad !== 'none'),
    )
  );
}
export function roadKerbFolder(p) {
  const kerbs = p.roadKerbSide ?? 'none';
  return (
    details(
      'Kerbs on the road',
      choice('roadKerbSide', 'Kerbstone edges', kerbs, sides) +
        '<fieldset class="border-apex-fields" data-road-kerbs' + (kerbs === 'none' ? ' hidden disabled>' : '>') +
        kerbSizeFields(p) +
        '<p class="hint">Blocks sit flush with the road. Road and border kerbstones share these dimensions and the outline setting.</p></fieldset>',
      kerbs !== 'none', 'roadKerbs',
    )
  );
}
export function lineSizeFolder(p) {
  const dimensions = { ...lineDimensions, ...p };
  return (
    details(
      'Line and groove sizes',
      '<p class="hint">Sets the assembled white line width and the size of printable paint grooves on roads and borders.</p>' +
        field('whiteLineWidth', 'Line width', dimensions.whiteLineWidth, 'mm', {
          min: 0.1,
          max: 2000,
        }) +
        grooveSizeFields(dimensions),
    )
  );
}

export function borderMarkings(p, kerbEdge = p.kerbEdge) {
  return borderLineFolder(p) + borderKerbFolder(p, kerbEdge);
}
export function borderLineFolder(p, diagram = true) {
  return (
    details(
      'White lines on the borders',
      choice(
        'whiteLineBorder',
        'Mark border sides',
        p.whiteLineBorder ?? 'none',
        sides,
      ) +
        check(
          'borderLineGroove',
          'Recess border-only lines',
          lineGrooves(p).border,
        ) +
        (diagram ? '<div data-line-layout></div>' : ''),
      !!p.whiteLineBorder && p.whiteLineBorder !== 'none',
    )
  );
}
// Markings section: one Kerbs folder for road and border kerbs, so their
// shared sizes appear once in the form. Groove sizes live in "Line and
// groove sizes".
export function kerbFolder(p, kerbEdge = p.kerbEdge, hasBorder = p.borderSide !== 'none') {
  const road = p.roadKerbSide ?? 'none';
  const border = hasBorder ? (kerbEdge ?? 'none') : 'none';
  const any = road !== 'none' || border !== 'none';
  return (
    details(
      'Kerbs',
      choice('roadKerbSide', 'On the road', road, sides) +
        (hasBorder
          ? choice('kerbEdge', 'On the borders', p.kerbEdge ?? 'none', [
              ['none', 'Off'],
              ['road', 'Road-facing edge'],
              ['free', 'Free edge'],
              ['both', 'Both edges'],
            ]) +
            '<div data-kerb-pattern>' +
            choice('kerbSide', 'Which borders', p.kerbSide ?? 'both', [
              ['both', 'All active borders'],
              ['inner', 'Inside / right border'],
              ['outer', 'Outside / left border'],
            ]) +
            '<div data-kerb-groove-size hidden></div><div data-kerb-section></div></div>' +
            '<p data-kerb-border class="hint" hidden>Select a matching border side under Borders to place the kerbstones.</p>'
          : '') +
        '<fieldset class="border-apex-fields" data-road-kerbs' + (any ? '>' : ' hidden disabled>') +
        kerbSizeFields(p) +
        '<p class="hint">Road and border kerbs share these sizes. Their colours continue across print seams.</p></fieldset>' +
        (hasBorder ? '<div class="shared-dimensions"><p class="hint" data-shared-dimensions></p></div>' : ''),
      any,
      'roadKerbs',
    )
  );
}
export function borderKerbFolder(p, kerbEdge = p.kerbEdge) {
  return (
    details(
      'Kerbs on the borders',
      choice('kerbEdge', 'Border edge', p.kerbEdge ?? 'none', [
        ['none', 'Off'],
        ['road', 'Road-facing edge'],
        ['free', 'Free edge'],
        ['both', 'Both edges'],
      ]) +
        '<div data-kerb-pattern>' +
        choice('kerbSide', 'Apply to', p.kerbSide ?? 'both', [
          ['both', 'All active borders'],
          ['inner', 'Inside / right border'],
          ['outer', 'Outside / left border'],
        ]) +
        kerbSizeFields(p) +
        '<div data-kerb-groove-size' +
        (p.kerbGroove ? '' : ' hidden') +
        '>' +
        grooveSizeFields(p) +
        '<p class="hint">These dimensions also apply to enabled white line grooves.</p></div>' +
        '<div data-kerb-section></div></div>' +
        '<p data-kerb-border class="hint" hidden>Select a matching border side above to place the kerbstones.</p>',
      !!kerbEdge && kerbEdge !== 'none',
    ) +
    '<div class="shared-dimensions"><p class="hint" data-shared-dimensions></p></div>'
  );
}

// The active sides can differ and only a physically present border can share
// a stripe. Keep their diagrams separate when their paint layout differs.
function lineLayout(p, showPitDivider) {
  const diagrams = [];
  let missingBorder = false;
  for (const [side, name] of sides.slice(1, 3)) {
    const { roadWidth, borderWidth, roadGroove, borderGroove } =
      whiteLineLayout(p, side);
    const borderExists = onSide(p.borderSide, side);
    if (onSide(p.whiteLineBorder, side) && !borderExists) missingBorder = true;
    if (!roadWidth && !borderWidth) continue;
    const scale = 36 / (roadWidth + borderWidth);
    const gap =
      roadGroove || borderGroove
        ? Math.min(24, Math.max(2, (roadGroove || borderGroove) * scale))
        : 0;
    const x = 120 - roadWidth * scale + (borderGroove ? gap : 0);
    const gapX = x - gap;
    const paired = roadWidth && borderWidth;
    const description = paired
      ? mm(roadWidth) +
        ' on each piece. Road controls the groove on the driving side.'
      : mm(roadWidth || borderWidth) +
        ' on the ' +
        (roadWidth ? 'road' : 'border');
    diagrams.push(
      '<figure class="joint-fit-diagram"><svg viewBox="0 0 240 38" aria-hidden="true" style="height:38px">' +
        '<rect x="0" y="6" width="120" height="25" fill="var(--d-track)"/>' +
        (borderExists
          ? '<rect x="120" y="6" width="120" height="25" fill="var(--d-border)"/>'
          : '') +
        '<rect x="' +
        x +
        '" y="6" width="36" height="25" fill="white"/>' +
        (gap
          ? '<rect x="' +
            gapX +
            '" y="6" width="' +
            gap +
            '" height="25" fill="var(--d-slot)"/>'
          : '') +
        (borderExists
          ? '<path d="M120 3v31" stroke="var(--d-guide)" stroke-dasharray="3 2"/>'
          : '') +
        '<g font-size="10" fill="white" text-anchor="middle"><text x="34" y="22">Road</text>' +
        (borderExists ? '<text x="205" y="22">Border</text>' : '') +
        '</g></svg><figcaption>' +
        name +
        ' · ' +
        description +
        '</figcaption></figure>',
    );
  }
  if (showPitDivider)
    diagrams.push('<p class="hint">Pit divider · ' + mm(p.whiteLineWidth) +
      (lineGrooves(p).road ? ' wide. A groove follows both edges and closes around each painted end.' : ' wide.') + '</p>');
  if (p.roadCentreLine && p.roadCentreLine !== 'none')
    diagrams.push('<p class="hint">Centre line · ' + mm(p.whiteLineWidth) +
      (p.roadCentreLine === 'dashed' ? ' wide · ' + mm(p.dashLength) + ' dash / ' + mm(p.dashGap) + ' gap.' : ' wide.') + '</p>');
  if (!diagrams.length && !missingBorder)
    return '<p class="hint">The line is flat. Where road and border both carry it, each piece takes half its width.</p>';
  if (missingBorder)
    diagrams.push(
      '<p class="hint">Enable the matching side in Borders to put a line on that border.</p>',
    );
  return diagrams.join('');
}

export function syncPaintControls(form, p) {
  const diagram = form.querySelector('[data-line-layout]');
  if (!diagram) return;
  p = { ...lineDimensions, ...p };
  diagram.innerHTML = lineLayout(p, !!form.elements?.spPitWhiteLine && p.special?.pitWhiteLine);
  const dimensions = form.querySelector('[data-shared-dimensions]');
  if (!dimensions) return;
  dimensions.textContent =
    'Shared line width ' +
    mm(p.whiteLineWidth) +
    ' · Grooves ' +
    mm(p.grooveWidth) +
    ' wide × ' +
    mm(p.grooveDepth) +
    ' deep';
  const usedSides = ['inner', 'outer'];
  const kerbs =
    p.kerbEdge &&
    p.kerbEdge !== 'none' &&
    usedSides.some(
      (side) =>
        onSide(p.borderSide, side) && onSide(p.kerbSide ?? 'both', side),
    );
  const patternOn = (p.kerbEdge ?? 'none') !== 'none';
  form.querySelector('[data-kerb-pattern]').hidden = !patternOn;
  form.querySelector('[data-kerb-border]').hidden =
    p.borderSide !== 'none' && (!patternOn || kerbs);
  const section = form.querySelector('[data-kerb-section]');
  form.querySelector('[data-kerb-groove-size]').hidden = !(p.kerbGroove && kerbs);
  if (p.kerbGroove && kerbs) {
    const half = 14,
      floor =
        14 +
        Math.min(27, Math.max(4, (2 * half * p.grooveDepth) / p.grooveWidth));
    section.innerHTML =
      '<figure class="joint-fit-diagram"><svg viewBox="0 0 240 50" aria-hidden="true" style="height:50px">' +
      '<path fill="var(--d-border)" stroke="var(--d-track-edge)" d="M4 14h102v' +
      (floor - 14) +
      'h28V14h102v32H4Z"/><path d="M4 13h102" stroke="var(--d-kerb)" stroke-width="4"/>' +
      '<path d="M134 13h102" stroke="var(--d-paint)" stroke-width="4"/></svg>' +
      '<figcaption>STL cuts around each stone · ' +
      mm(p.grooveWidth) +
      ' wide × ' +
      mm(p.grooveDepth) +
      ' deep</figcaption></figure>';
  } else
    section.innerHTML = p.kerbGroove
      ? '<p class="hint">Choose a border and a kerbstone pattern to see their paint grooves.</p>'
      : kerbs
        ? '<p class="hint">Flat paint pattern. The kerbstones sit flush with the border.</p>'
        : '';
}
