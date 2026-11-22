import { button, field, details, choice, check, esc, fmt, icon } from './ui.js';
import { assemblyControls, assemblyTab } from './assembly-controls.js';
import {
  solidNames,
  featureNames,
  isSolidTool,
  isFeatureTool,
} from './design.js';
import { createSolidControls } from './create-solid-controls.js';
import { featureControls } from './create-feature-controls.js';
import { edgeSelectionLabel } from './wall-edge-modify-controls.js';
import { isHoleRim, holeModifyControls } from './hole-modify.js';
import { healStretchControls } from './heal-stretch.js';
import { jointFitControls } from './joint-controls.js';
import { apexPositionFor, apexWidthFor } from './geometry/border-profile.js';
import { solidToolControls } from './solid-tool-controls.js';
import {
  borderLineFolder,
  kerbFolder,
  lineSizeFolder,
  roadLineFolder,
} from './paint-controls.js';
import { borderEndControls, laneLayoutControls } from './track-shape-controls.js';
import { startingGridControls } from './starting-grid-controls.js';
import { TRACK_PROFILE_LIMITS } from './track.js';
import { specialControls, specialName } from './special-piece-controls.js';
import { specialAssemblyNotes } from './special-pieces.js';
import {
  connectionControls,
  jointCountControls,
  profileDiagram,
  braidFeedControls,
} from './connection-controls.js';
const num = (p, k, label, unit, opts) => field(k, label, p[k], unit, opts);
const full = (act, label, glyph) => button(act, label, glyph, 'secondary full');
const settingsForm = (body, label) =>
  '<form id="settings-form"><div class="property-scroll">' + body + '</div>' +
  '<div class="property-commit">' +
  '<div class="pack-apply" data-pack-apply hidden></div>' +
  '<div id="live-status" role="status" aria-live="polite" aria-atomic="true" tabindex="-1">Live view</div>' +
  '<div class="form-actions">' +
  button('restore', 'Restore', 'reset', 'secondary') +
  button('apply', label, 'check', 'primary') +
  button('apply-collection', 'Apply to collection', 'check', 'primary') +
  '</div></div></form>';

const separateAddition = (enabled) =>
  check('separate', 'Keep addition as a separate part', enabled) +
  '<p id="separate-hint" class="hint" hidden></p>';

export function syncFaceLevels(form, plan) {
  const box = form?.querySelector('[data-face-levels]');
  if (!box) return;
  const changes = plan?.changes ?? [];
  box.hidden = !changes.length;
  if (!changes.length) return;
  let markup;
  if (changes.length <= 12) {
    const rows = changes
      .map(
        ({ start, end, delta }, i) =>
          '<tr><th scope="row">' +
          (i + 1) +
          '</th><td>' +
          fmt(start) +
          '</td><td>' +
          fmt(end) +
          '</td><td>' +
          (delta > 0 ? '+' : '') +
          fmt(delta) +
          '</td></tr>',
      )
      .join('');
    markup =
      '<table><caption>Face heights (mm)</caption><thead><tr><th>Face</th><th>Start</th><th>Result</th><th>Change</th></tr></thead><tbody>' +
      rows +
      '</tbody></table>';
  } else {
    const raised = changes.filter(({ delta }) => delta > 0).length;
    const lowered = changes.filter(({ delta }) => delta < 0).length;
    const range = (key) => {
      const levels = changes.map((change) => change[key]);
      const low = Math.min(...levels),
        high = Math.max(...levels);
      return low === high ? fmt(low) : fmt(low) + '–' + fmt(high);
    };
    markup =
      '<strong>' +
      changes.length +
      ' face heights (mm)</strong><p>Start ' +
      range('start') +
      ' · Result ' +
      range('end') +
      '</p>' +
      (changes.every(({ delta }) => Number.isFinite(delta))
        ? '<p>' +
          raised +
          ' raised · ' +
          lowered +
          ' lowered · ' +
          (changes.length - raised - lowered) +
          ' at target</p>'
        : '');
  }
  // Keep screen-reader table navigation intact when only the camera changes.
  if (box.innerHTML !== markup) box.innerHTML = markup;
}

export function syncOperationControls(form, facePlan) {
  const extent = form?.elements.namedItem('extent');
  if (extent) {
    const through = extent.value === 'through';
    form.querySelector('[data-fixed-depth]').hidden = through;
    form.elements.namedItem('depth').disabled = through;
  }
  const distance = form?.elements.namedItem('faceDistance');
  const commonHeight =
    form?.elements.namedItem('faceMoveMode')?.value === 'height';
  if (distance) {
    form.querySelector('[data-offset-controls]').hidden = commonHeight;
    form.querySelector('[data-height-controls]').hidden = !commonHeight;
    distance.disabled = commonHeight;
    form.elements.faceHeight.disabled = !commonHeight;
    for (const button of form.querySelectorAll('[data-move-sign]')) {
      button.setAttribute(
        'aria-pressed',
        String(
          Math.sign(distance.valueAsNumber) === Number(button.dataset.moveSign),
        ),
      );
    }
  }
  const separate = form?.elements.namedItem('separate');
  if (!separate) return;
  const signed =
    form.elements.namedItem('faceAngle') ??
    form.elements.namedItem('faceDistance');
  const removing = commonHeight
    ? !facePlan?.valid || facePlan.changes.some(({ delta }) => delta < 0)
    : signed
      ? !(signed.valueAsNumber > 0)
      : (
          form.elements.namedItem('operation') ??
          form.elements.namedItem('textMethod')
        )?.value === 'cut';
  const hint = form.querySelector('#separate-hint');
  separate.disabled = removing;
  if (removing) {
    separate.checked = false;
    separate.setAttribute('aria-describedby', hint.id);
    hint.textContent = commonHeight
      ? 'A separate part is available when the edit only raises faces.'
      : signed?.name === 'faceDistance'
        ? 'An outward move can create a separate printable part.'
        : signed
          ? 'A positive face angle creates a wedge you can print separately.'
          : form.elements.namedItem('textMethod')
            ? 'Raised lettering can be printed as a separate part.'
            : 'Use Add profile to make a separate part.';
  } else separate.removeAttribute('aria-describedby');
  hint.hidden = !removing;
}

// The six sections of a piece. The ids are the older tab names, kept so saved
// views, warnings and guides still find their settings.
const trackTasks = [
  ['geometry', 'Shape', 'track'],
  ['profile', 'Cross-section', 'layers'],
  ['borders', 'Borders', 'move'],
  ['markings', 'Markings', 'markings'],
  ['joints', 'Joints', 'join'],
  ['print', 'Print', 'plate'],
];
const trackNotes = {
  geometry: 'The path of the piece and its lanes.',
  profile: 'The road body, the guide slot and the braid.',
  borders: 'The borders beside the road and how they end.',
  markings: 'White lines, kerbs and grid marks, and the grooves to paint them.',
  joints: 'How pieces and borders join: keys, clips or tabs, and their fit.',
  print: 'How the piece is cut into printable parts for your plate.',
};
// Which section shows a setting (for warnings that jump to one).
const SECTION_OF_FIELD = [
  [/^(whiteLine|roadCentreLine|dash|roadKerb|kerb|groove|grid|roadLineGroove|borderLineGroove|spPitWhiteLine|spPitCrossingStyle|spPitGrid)/, 'markings'],
  [/^(segments|borderSegments)$/, 'print'],
];
export function sectionForField(field, fallback) {
  return SECTION_OF_FIELD.find(([re]) => re.test(field ?? ''))?.[1] ?? fallback;
}

export function trackNavigation(tab) {
  return (
    '<nav class="component-nav" aria-label="Track components">' +
    trackTasks
      .map(
        ([id, label, glyph]) =>
          '<button type="button" data-tab="' +
          id +
          '" aria-pressed="' +
          (id === tab) +
          '" class="' +
          (id === tab ? 'active' : '') +
          '">' +
          icon(glyph) +
          '<span>' +
          label +
          '</span></button>',
      )
      .join('') +
    '</nav>'
  );
}

const assemblyNotesMarkup = (params) =>
  specialAssemblyNotes(params).map(note => '<p class="hint">' + esc(note) + '</p>').join('');

export function syncPitAssemblyNotes(form, params) {
  const notes = form.querySelector('[data-assembly-notes="pit"]');
  if (!notes || params.special?.type !== 'pit') return;
  const markup = assemblyNotesMarkup(params);
  if (notes.innerHTML !== markup) notes.innerHTML = markup;
}

export function trackInspector(project, tab, draft = {}) {
  const p = project.track.params;
  let html = '';
  if (tab === 'geometry') {
    const kinds = [
      ['curve', 'Circular bend'],
      ['straight', 'Straight'],
    ];
    if (project.track.plan)
      kinds.push([
        'import',
        project.track.custom ? 'Drawn path' : 'Circuit drawing',
      ]);
    if (p.special) {
      html += '<h4 class="special-title">' + esc(specialName(p.special.type)) + '</h4>' + specialControls(p);
      html += details('Assembly and wiring', '<div data-assembly-notes="' + esc(p.special.type) + '">' +
        assemblyNotesMarkup(p) + '</div>' +
        (['hairpin','diamond'].includes(p.special.type)
          ? full('export-crossing-sample', 'Export crossing test STL', 'export') : ''));
    } else html += choice('kind', 'Road geometry', p.kind, kinds);
    if (p.kind === 'import')
      html +=
        '<p class="selection-note">' +
        esc(project.track.sourceName) +
        ' · ' +
        project.track.plan.lanes.length +
        ' lane paths</p>';
    if (p.kind === 'import' && project.track.custom)
      html += full('edit-custom', 'Edit drawn path', 'sketch');
    const crossing =
      p.kind === 'import' ? project.track.plan?.flatCrossing : undefined;
    if (crossing?.crossings.length) {
      const upper = crossing.crossings
        .map((c, i) =>
          choice(
            'crossingUpper' + i,
            'Upper road' +
              (crossing.crossings.length > 1 ? ' at crossing ' + (i + 1) : ''),
            c.upperPass,
            [
              ['first', 'Section ' + (c.firstSection + 1)],
              ['second', 'Section ' + (c.secondSection + 1)],
            ],
          ),
        )
        .join('');
      html += details(
        'Bridge and supports',
        '<div data-bridge-profile></div>' +
          upper +
          field(
            'bridgeClearance',
            'Clearance under bridge',
            p.bridgeClearance ?? 60,
            'mm',
            { min: 1, max: 500 },
          ) +
          field(
            'bridgeSupportCount',
            'Blocks per crossing',
            p.bridgeSupportCount ?? 0,
            '',
            { min: 0, max: 32, step: 1 },
          ) +
          check(
            'bridgeApproaches',
            'Include approach blocks',
            p.bridgeApproaches !== false,
          ) +
          '<p class="hint">Set the count to 0 for your own supports. With approach blocks, flat straights tilt up to the level deck. Joints at a change of slope are plain. Within a slope, use integral tabs. Removable clips fit the level pieces.</p>',
        true,
      );
    }
    if (!p.special && p.kind === 'curve')
      html +=
        num(p, 'radius', 'Centre radius') + num(p, 'angle', 'Sweep angle', '°');
    if (!p.special && p.kind === 'straight') html += num(p, 'length', 'Road length');
    if (
      p.kind !== 'import' ||
      project.track.custom ||
      !project.track.plan?.outlines?.length
    )
      html += num(p, 'width', 'Road width');
    if (p.kind !== 'import' || project.track.custom)
      html += details(
        'Lane layout',
        num(p, 'lanes', 'Lane count', '', { min: 1, step: 1 }) +
          '<p class="hint" data-centred-lane' + (p.lanes === 1 ? '' : ' hidden') +
          '>Main slot on the road centreline.</p>' +
          '<div data-lane-spacing-controls' + (p.lanes === 1 ? ' hidden' : '') + '>' +
          num(p, 'laneSpacing', 'Lane spacing', 'mm', { min: 0.1, max: 1000 }) +
          (p.special ? '' : laneLayoutControls(p)) + '</div>',
        true, 'lanes',
      );
  } else if (tab === 'print') {
    const crossing =
      p.kind === 'import' ? project.track.plan?.flatCrossing : undefined;
    html += details(
      'Road segments',
      num(
        p,
        'segments',
        crossing ? 'Segments on longest span' : 'Road segments',
        '',
        { min: 1, max: 32, step: 1 },
      ) + (p.special?.type === 'diamond'
        ? '<p class="hint">One segment keeps the diamond whole. A setting of two produces one centre block and four arms. Each additional step divides all four arms again.</p>'
        : p.special?.type === 'pit' && p.lanes > 1
          ? '<p class="hint">One segment keeps the pit whole. Higher counts split the road lengthwise between the main slots as well as across its length. Seams clear the turnout and merge.</p>'
          : ''),
      true, 'segments',
    );
    if (p.borderSide !== 'none')
      html += details(
        'Border segments',
        num(
          p,
          'borderSegments',
          p.kind === 'import' && project.track.plan?.flatCrossing
            ? 'Segments on longest border span'
            : p.special?.type === 'diamond' ? 'Segments per border arm' : 'Segments per side',
          '',
          { min: 1, max: 32, step: 1 },
        ),
        true, 'borderSegments',
      );
    html +=
      '<p class="hint">More segments make smaller parts. Check that every part fits your print plate.</p>' +
      full('plate', 'Print plate and fit…', 'plate') +
      full('view-underside', 'View the underside', 'layers') +
      full('export-menu', 'Export STLs…', 'export');
  } else if (tab === 'markings') {
    if (p.kind === 'straight' && !p.special) html += startingGridControls(p);
    html +=
      roadLineFolder(p) +
      (p.borderSide !== 'none' ? borderLineFolder(p, false) : '') +
      kerbFolder(p, draft.kerbEdge) +
      lineSizeFolder(p);
  } else if (tab === 'profile') {
    html += profileDiagram(p);
    html += details(
      'Road body',
      num(p, 'height', 'Track height') +
      check('hollow', 'Hollow underside', p.hollow) +
      num(p, 'deck', 'Deck thickness') +
      num(p, 'wall', 'Wall thickness') +
      '<fieldset class="border-apex-fields" data-underside-ribs' + (p.hollow ? '>' : ' hidden disabled>') +
        check('reinforcement', 'Reinforce roads and borders', p.reinforcement) +
        '<fieldset class="border-apex-fields" data-rib-spacing' + (p.reinforcement ? '>' : ' hidden disabled>') +
        num(p, 'ribSpacing', 'Target rib spacing', 'mm', {
          min: TRACK_PROFILE_LIMITS.ribSpacing[0], max: TRACK_PROFILE_LIMITS.ribSpacing[1],
        }) +
        '<p class="hint">Ribs use the wall thickness. Their positions adjust around connectors and moving parts.</p></fieldset></fieldset>',
      true, 'body',
    );
    html += details(
      'Guide slot',
      num(p, 'slotWidth', 'Width') + num(p, 'slotDepth', 'Depth'),
      true, 'slot',
    );
    html += details(
      'Braid recess',
      num(p, 'braidWidth', 'Width per strip') +
        num(p, 'braidDepth', 'Depth') +
        num(p, 'braidGap', 'Braid offset from slot') +
        '<p class="hint">The offset sets the width of the road-height wall between the guide slot and each braid recess. Set it to 0 mm for recesses that meet the slot.</p>',
      false, 'braid',
    );
    html += braidFeedControls(p);
  } else if (tab === 'borders') {
    html += choice('borderSide', 'Border side', p.borderSide, [
      ['none', 'None'],
      ['outer', 'Outside / left'],
      ['inner', 'Inside / right'],
      ['both', 'Both'],
    ]);
    html += p.special?.type === 'diamond'
      ? '<p class="hint">Set the widths and apex positions below. Each crossing arm uses this profile on the selected sides. Follow the outlines in the live model as you edit.</p>'
      : '<div id="border-handles"></div>';
    const activeSide = draft.borderSide ?? p.borderSide;
    const apexFields = ['outer', 'inner'].map((side) => {
      const name = side === 'outer' ? 'Outside' : 'Inside';
      const active = activeSide === 'both' || activeSide === side;
      const percent = Number((apexPositionFor(p, side) * 100).toPrecision(12));
      return (
        '<fieldset class="border-apex-fields" aria-label="' + name + ' apex"' +
        (active ? '>' : ' hidden disabled>') +
        field(side + 'ApexWidth', name + ' apex width', apexWidthFor(p, side), 'mm', {
          min: 0, max: 2000,
        }) +
        field(side + 'ApexPercent', name + ' apex position', percent, '%', {
          min: 1, max: 99,
        }) +
        '</fieldset>'
      );
    }).join('');
    html += details(
      'Border width',
      num(p, 'borderEntry', 'Entry width') +
        num(p, 'borderExit', 'Exit width') +
        (activeSide === 'both' ? '<p class="hint">Entry and exit widths apply to both borders.</p>' : '') +
        apexFields,
      true, 'borderWidths',
    );
    html += borderEndControls(project.track, activeSide);
  } else {
    html += jointCountControls(p);
    html += '<p class="hint">One sits in the centre. Two sit toward the outside. Three add a centre connector. Automatic spacing supports up to five clips and tabs combined.</p>';
    html += p.special?.type === 'diamond'
      ? '<p class="hint">Both roads share the start, seam and finish settings. Side positions repeat along each border arm.</p>'
      : full('place-connectors', 'Customize connector positions…', 'join');
    html += jointFitControls(p, draft);
    if (p.connectorOffset) html += details(
      'Tab offset',
      num(p, 'connectorOffset', 'Tab offset from centre') +
        '<p class="hint">This saved offset applies until you choose a road tab count.</p>',
      false, 'placement',
    );
    html += connectionControls(p);
    html += details(
      'Test prints',
      full('fit-samples', 'Export fit samples', 'kit') +
        (p.kind === 'import' ? '' : full('test-joint', 'Export track test joint', 'kit')),
    );
  }
  const [, title, glyph] = trackTasks.find(([id]) => id === tab);
  return (
    '<h3 class="property-title">' + icon(glyph) + title + '</h3>' +
    '<p class="property-note">' + trackNotes[tab] + '</p>' +
    settingsForm(html, 'Apply changes')
  );
}

export function isFaceTool(tab) {
  return [
    'hollow',
    'text',
    'hole',
    'edge-finish',
    'hole-modify',
    'wall-modify',
    'heal-feature',
    'trim-face',
    'trim-top',
    'move-face',
    'shape',
    'cut-shape',
    'tilt',
  ].includes(tab);
}
export function surfaceNote(tab, region, saved) {
  if (region?.wallGroup) return 'Flat walls facing different directions';
  if (region?.faceCount > 1)
    return region.coplanar === false
      ? 'Parallel faces at different heights'
      : 'Coplanar faces on one part';
  if (region?.feature === 'post')
    return 'Outline follows the bore and inner wall';
  if (region)
    return (
      (region.planar ? 'Flat face' : 'Curved region') +
      (tab === 'tilt' ? ' selected' : '') +
      ' · ' +
      region.triangleIndices.length +
      ' triangles selected'
    );
  if (tab === 'trim-top') return 'Top of part · vertical cut direction';
  if (tab === 'trim-face' || tab === 'tilt' || tab === 'move-face')
    return saved ? 'Saved flat face' : 'Click a flat face on the model.';
  if (tab === 'select') return 'Click a face on the model to select it.';
  return saved
    ? 'Saved placement · click a new face to move it'
    : 'Click the model where you want to add or cut.';
}
function surfaceControls(angle) {
  return details(
    'Surface selection',
    field('tolerance', 'Boundary angle', angle, '°', { min: 0, max: 85 }) +
      '<p class="hint">Increase the angle to include adjacent faces with sharper edges. The highlighted selection follows the angle.</p>',
  );
}
const editorTitles = {
  ...solidNames,
  ...featureNames,
  'align-parts': 'Align parts',
  'combine-parts': 'Combine parts',
  'trim-face': 'Trim',
  'trim-top': 'Cut off top',
  'move-face': 'Push / pull',
  shape: 'Add shape',
  'cut-shape': 'Cut shape',
  tilt: 'Tilt',
  split: 'Split into pieces',
  transform: 'Move, rotate & size',
  hollow: 'Hollow out',
  simplify: 'Reduce triangles',
  text: 'Text',
};

function command(key, label, glyph, options = {}) {
  const { action, active, disabled, description = label } = options;
  return (
    '<button type="button" data-' +
    (action ? 'action' : 'tab') +
    '="' +
    key +
    '" title="' +
    esc(description) +
    '"' +
    (active ? ' class="active" aria-current="page"' : '') +
    (disabled ? ' disabled' : '') +
    '>' +
    icon(glyph) +
    '<span>' +
    esc(label) +
    '</span></button>'
  );
}

// One Cut tool with two ways to cut the whole part. Trimming at a face
// stays in the face toolbar, because it needs a picked face.
function cutModes(tab) {
  const mode = (id, label) =>
    '<button type="button" data-tab="' + id + '" aria-pressed="' + (tab === id) + '">' + label + '</button>';
  return (
    '<div class="cut-modes" role="group" aria-label="How to cut">' +
    mode('trim-top', 'Cut off the top') +
    mode('split', 'Split into pieces') +
    '</div><p class="hint">To cut along a face of the part, click the face and choose Trim.</p>'
  );
}
export function editorNavigation({
  tab,
  measuring,
  hasParts = true,
  hasSketches = false,
}) {
  const nav = (id, label, glyph) =>
    command(id, label, glyph, {
      active:
        !measuring &&
        (id === tab ||
          (id === 'trim-top' && tab === 'split') ||
          (id === 'select' && isFaceTool(tab) && tab !== 'trim-top')),
    });
  const create =
    '<div class="section-label">Create</div><nav class="component-nav" aria-label="Creation tools">' +
    nav('primitive', 'Shape', 'box') +
    command('new-sketch', 'Sketch', 'sketch', { action: true }) +
    command('import-outline', 'Sketch from SVG / DXF', 'import', { action: true }) +
    (hasSketches
      ? '<div class="sketch-solid-tools">' +
        ['extrude', 'revolve', 'sweep', 'loft']
          .map((k) => nav(k, solidNames[k], k))
          .join('') +
        '</div>'
      : '') +
    '</nav>';
  if (!hasParts) return create;
  return (
    create +
    // Fixed groups: the part as a whole, then repairs. Tools for one face
    // appear in the face toolbar when you click the model.
    ('<div class="section-label">Change the part</div><nav class="component-nav" aria-label="Part tools">' +
      nav('select', 'Face tools', 'select') +
      nav('transform', 'Move, rotate & size', 'move') +
      nav('trim-top', 'Cut', 'split') +
      nav('stretch-section', 'Stretch', 'move') +
      nav('feature-pattern', 'Mirror & repeat', 'pattern') +
      command('duplicate', 'Duplicate part', 'plus', { action: true }) +
      '</nav><div class="section-label">Repair</div><nav class="component-nav" aria-label="Repair tools">' +
      command('inspect-stl', 'Check & repair an STL…', 'fit', { action: true }) +
      command('surface-brush', 'Smooth or patch', 'markings', { action: true }) +
      nav('simplify', 'Reduce triangles', 'layers') +
      command('separate-shells', 'Split loose bodies', 'part', { action: true }) +
      '</nav>')
  );
}

export function faceActions(tab, region, edges = []) {
  const flat = region?.planar;
  const face = (id, label, glyph, description, needFlat = false) =>
    command(id, label, glyph, {
      description,
      disabled: needFlat && !flat,
      active: tab === id,
    });
  const finish = face(
    'edge-finish',
    'Round or chamfer',
    'edge',
    'Round or chamfer a corner, edge or perimeter',
  );
  const edgeActions =
    edges.length && edges.every(isHoleRim)
      ? face(
          'hole-modify',
          'Change hole',
          'hole',
          'Countersink, counterbore, resize or fill the selected holes',
        )
      : '';
  if (edges.length > 1 || (!region && edges.length))
    return edgeActions + finish;
  if (region?.wallGroup)
    return face(
      'wall-modify',
      'Move walls',
      'move',
      'Offset the selected walls or draft them about a fixed plane',
    );
  if (region?.faceCount > 1)
    return (
      face(
        'move-face',
        'Push / pull',
        'move',
        'Move each face by a distance or set one height for all faces',
        true,
      ) +
      (region.members?.every((member) => !member.feature)
        ? face(
            'wall-modify',
            'Move walls',
            'move',
            'Offset or draft the selected walls',
          )
        : '')
    );
  return (
    edgeActions +
    face(
      'trim-face',
      'Trim',
      'split',
      'Trim across the entire part from this face',
      true,
    ) +
    face(
      'move-face',
      'Push / pull',
      'move',
      'Move material inside the face outline',
      true,
    ) +
    face('tilt', 'Tilt', 'view', 'Tilt the face around an edge', true) +
    face('hollow', 'Hollow out', 'box', 'Use this face as a hollow opening', true) +
    face(
      'hole',
      'Hole',
      'hole',
      'Place a plain, counterbored or countersunk hole',
      true,
    ) +
    finish +
    face(
      'wall-modify',
      'Move walls',
      'move',
      'Offset walls or draft them from a fixed plane',
      true,
    ) +
    face(
      'heal-feature',
      'Remove bump or pocket',
      'part',
      'Heal a boss, rib or pocket from its cap or floor',
      true,
    ) +
    face('text', 'Text', 'plus', 'Place raised or engraved lettering') +
    face('shape', 'Add shape', 'plus', 'Add a shape on this surface') +
    face('cut-shape', 'Cut shape', 'split', 'Cut a shape into this surface')
  );
}
export function faceInstruction(planar, count = 1) {
  if (count > 1)
    return 'Choose Push / pull to move each face by a distance or bring them to a common height.';
  return planar
    ? 'Choose a face action above the model, or click another face.'
    : 'Place a profile on the tangent plane here. Select a flat face for trimming, pushing or tilting.';
}

export function selectionTitle(tab, region, part, saved) {
  if (region?.faceCount > 1) return region.faceCount + ' faces selected';
  if (region?.feature === 'post') return 'Screw post top';
  if (tab === 'trim-top') return 'Top of part';
  if (region?.planar && part && region.normal[2] > 0.999999) {
    if (Math.abs(part.bounds.max[2] - region.origin[2]) < 0.0001)
      return 'Top face';
    return (
      'Face ' + fmt(region.origin[2] - part.bounds.min[2]) + ' mm above base'
    );
  }
  return region || saved ? (part?.name ?? 'Selected surface') : 'Select a face';
}

function selectionCard(tab, s) {
  const { region, op } = s;
  return (
    '<div class="editor-selection' +
    (region || op?.frame || op?.faces?.length ? ' has-face' : '') +
    '">' +
    icon('select') +
    '<div><strong id="selection-count" data-count="' +
    (s.selectionCount ?? 0) +
    '" aria-live="polite">' +
    esc(
      !region && s.selectionCount > 1
        ? s.selectionCount + ' faces selected'
        : selectionTitle(
            tab,
            region,
            s.part,
            !s.selectionReplaced && (op?.frame || op?.faces?.length),
          ),
    ) +
    '</strong><p id="surface-note">' +
    esc(
      !region && s.selectionCount > 1
        ? 'Saved face outlines'
        : surfaceNote(
            tab,
            region,
            !s.selectionReplaced && (op?.frame || op?.faces?.length),
          ),
    ) +
    '</p></div></div>'
  );
}

function faceSelectionControls(s) {
  const count = s.selectionCount ?? 0;
  return (
    '<div class="multi-selection">' +
    '<button type="button" class="secondary" data-action="multi-pick" aria-pressed="' +
    Boolean(s.extendPicks) +
    '">' +
    icon('plus') +
    'Add to selection</button>' +
    '<p class="hint">Shift-click to add or remove a face, edge or hole rim.</p>' +
    (s.region?.feature === 'post' && count === 1
      ? button('whole-face', 'Select whole face', 'select', 'secondary')
      : '') +
    '</div>'
  );
}

function editorHome(s) {
  const { region, part } = s;
  const edges = s.features?.edges ?? [];
  if (edges.length) {
    const holes = edges.every(isHoleRim);
    const label = holes
      ? edges.length + (edges.length === 1 ? ' hole rim' : ' hole rims')
      : edgeSelectionLabel(edges);
    return (
      '<div class="editor-home"><h3 id="edge-selection-count" data-count="' +
      edges.length +
      '">' +
      label +
      ' selected</h3><form id="settings-form"><p class="editor-instruction">' +
      (holes
        ? 'Choose Countersink to edit these bores, or Finish edge to round or chamfer their rims.'
        : 'Choose Finish edge to round or chamfer the selection.') +
      '</p>' +
      faceSelectionControls(s) +
      (region
        ? button(
            'use-adjacent-face',
            'Use adjoining face',
            'select',
            'secondary full',
          )
        : '') +
      '</form></div>'
    );
  }
  if (s.activeSketch && !region)
    return (
      '<div class="editor-home"><h3>' +
      esc(s.activeSketch.name) +
      '</h3><p class="selection-note">Sketch · ' +
      esc(s.activeSketch.planeLabel) +
      '</p><div class="editor-profiles">' +
      command('edit-active-sketch', 'Edit sketch', 'sketch', { action: true }) +
      '</div><p class="hint">Choose Extrude or Revolve for a closed profile. Sweep and Loft use a second sketch.</p></div>'
    );
  if (!part && !region)
    return '<div class="editor-home"><h3>Start a design</h3><p class="editor-instruction">Choose Solid shape for a dimensioned part. Choose Sketch to draw on a workplane, or Import outline to start from an SVG or DXF.</p></div>';
  const heading = region
    ? s.selectionCount > 1
      ? 'Face editing'
      : 'Selected face'
    : 'Select a face';
  return (
    '<div class="editor-home"><h3' +
    (region ? '' : ' id="selection-count" data-count="0"') +
    '>' +
    heading +
    '</h3><form id="settings-form">' +
    (region
      ? selectionCard('select', s) +
        '<p class="editor-instruction">' +
        (region.wallGroup
          ? 'Choose Modify walls to offset or draft these walls together.'
          : faceInstruction(region.planar, s.selectionCount)) +
        '</p>' +
        faceSelectionControls(s) +
        (region.wallGroup ? '' : surfaceControls(s.tolerance)) +
        (s.selectionCount > 1
          ? ''
          : '<div class="editor-profiles">' +
            command('lay-flat', 'Lay face on print plate', 'plate', {
              action: true,
              disabled: !region.planar,
            }) +
            '</div>')
      : '<p id="surface-note" class="editor-instruction">Click a face, edge or hole rim to see its tools. Shift-click to add more on the same part.</p>' +
        faceSelectionControls(s) +
        '<div class="editor-object"><span>Selected part</span><strong>' +
        esc(part?.name) +
        '</strong></div>' +
        '<div class="editor-tool-group"><h4>Place a profile</h4><div class="editor-profiles">' +
        command('shape', 'Add shape', 'plus') +
        command('cut-shape', 'Cut shape', 'split') +
        '</div></div>') +
    '</form></div>'
  );
}

export function editorInspector(tab, s) {
  const { region, art, op, part } = s;
  const p = op ?? {};
  if (s.measuring)
    return (
      '<div class="editor-inspector"><button type="button" class="editor-back" data-action="pick">‹ Face editing</button><h3>Measure</h3>' +
      '<p class="selection-note" id="measurement-note">' +
      (s.distance != null
        ? fmt(s.distance) + ' mm · point to point'
        : 'Click two points on the same part.') +
      '</p>' +
      (s.distance > 0
        ? full('calibrate', 'Calibrate to known distance', 'measure')
        : '') +
      '</div>'
    );
  if (tab === 'select') return editorHome(s);
  let html = '';
  if (
    isFaceTool(tab) &&
    !['hole-modify', 'edge-finish', 'wall-modify'].includes(tab)
  )
    html += selectionCard(tab, s);
  if (isSolidTool(tab)) {
    const layout = Object.fromEntries(
      ['primitiveShape', 'creationResult', 'profileSketch', 'loftSketch']
        .filter((k) => k in s.creation.draft)
        .map((k) => [k, s.creation.draft[k]]),
    );
    html += createSolidControls(tab, { ...p, ...layout }, s.creation);
  } else if (tab === 'hole-modify') {
    html += holeModifyControls(s.features) + faceSelectionControls(s);
  } else if (tab === 'heal-feature' || tab === 'stretch-section') {
    html += healStretchControls(tab, s.features);
  } else if (isFeatureTool(tab)) {
    html += featureControls(tab, s.features);
    if (tab === 'edge-finish' || tab === 'wall-modify')
      html += faceSelectionControls(s);
  } else if (['text', 'hollow', 'simplify'].includes(tab)) {
    html += solidToolControls(tab, p, part);
    if (tab === 'text') html += separateAddition(p.separate ?? false);
  } else if (assemblyTab(tab)) {
    html += assemblyControls(tab, s);
  } else if (tab === 'trim-face' || tab === 'trim-top') {
    if (tab === 'trim-top') html += cutModes(tab);
    const mode = p.trimMode ?? 'remove';
    const finished = s.trimDimension ?? 'Finished height';
    html +=
      choice('trimMode', 'Set cut by', mode, [
        ['remove', 'Remove amount'],
        ['remaining', finished],
      ]) +
      field(
        'trimAmount',
        mode === 'remove' ? 'Remove amount' : finished,
        p.amount ?? s.defaultTrimAmount,
        'mm',
        { min: 0 },
      ) +
      '<output id="trim-size" class="face-size-change"></output>' +
      '<p class="hint">The cut passes through the entire part, parallel to the reference face. Material beyond the cut plane is removed.</p>';
  } else if (tab === 'move-face') {
    const mode = p.moveMode ?? 'offset';
    const distance =
      p.moveMode === 'offset'
        ? p.value
        : p.depth
          ? p.type === 'cut'
            ? -p.depth
            : p.depth
          : 0;
    html +=
      faceSelectionControls(s) +
      choice('faceMoveMode', 'Adjustment', mode, [
        ['offset', 'Move each by'],
        ['height', 'Set common height'],
      ]) +
      '<div data-offset-controls>' +
      '<div class="move-directions" role="group" aria-label="Move direction">' +
      '<button type="button" data-move-sign="-1" aria-pressed="false">− Inward</button>' +
      '<button type="button" data-move-sign="1" aria-pressed="false">+ Outward</button></div>' +
      field('faceDistance', 'Signed distance', distance) +
      '<p class="hint">Each face starts at its own height. A negative distance moves it inward.</p></div>' +
      '<div data-height-controls>' +
      field(
        'faceHeight',
        'Height above base',
        mode === 'height' ? p.value : s.defaultFaceHeight,
        'mm',
        { min: 0 },
      ) +
      '<p class="hint">Measured from the base of this part along the selected face normal.</p></div>' +
      '<div data-face-levels hidden></div>' +
      '<output id="face-size-change" class="face-size-change" hidden></output>' +
      separateAddition(p.separate ?? false);
  } else if (tab === 'shape' || tab === 'cut-shape') {
    html +=
      '<input type="hidden" name="operation" value="' +
      (tab === 'shape' ? 'add' : 'cut') +
      '">';
    const shapes = [
      ['rectangle', 'Rectangle'],
      ['circle', 'Circle'],
      ['slot', 'Round-ended slot'],
    ];
    if (region?.planar || p.profileKind === 'face')
      shapes.push(['face', 'Selected face outline']);
    if (art || p.profileKind === 'drawing')
      shapes.push(['drawing', art?.name ?? p.artName ?? 'Imported drawing']);
    const kind = s.profileKind ?? p.profileKind ?? 'rectangle';
    html += choice('profileKind', 'Profile', kind, shapes);
    if (['rectangle', 'circle', 'slot'].includes(kind))
      html += field(
        'shapeWidth',
        { circle: 'Diameter', rectangle: 'Width', slot: 'Overall length' }[
          kind
        ],
        p.shapeWidth ?? 12,
      );
    if (kind === 'rectangle')
      html += field('shapeHeight', 'Height', p.shapeHeight ?? 8);
    if (kind === 'slot')
      html += field('shapeHeight', 'Width', p.shapeHeight ?? 4);
    if (kind === 'drawing')
      html += field('drawingScale', 'Artwork scale', p.drawingScale ?? 1, '×');
    html += full('import-shape', 'Import SVG / DXF', 'import');
    const depth = field('depth', 'Depth', p.depth ?? 2);
    html +=
      tab === 'cut-shape'
        ? choice('extent', 'Cut extent', p.extent ?? 'distance', [
            ['distance', 'Fixed distance'],
            ['through', 'Through part'],
          ]) +
          '<div data-fixed-depth>' +
          depth +
          '</div>'
        : depth;
    html += details(
      'Angle and placement',
      field('tilt', 'Extrusion tilt', p.tilt ?? 0, '°') +
        field('azimuth', 'Tilt direction', p.tiltAzimuth ?? 0, '°') +
        field('rotation', 'Profile rotation', p.rotation ?? 0, '°') +
        field('dx', 'Horizontal offset', p.userOffset?.[0] ?? 0) +
        field('dy', 'Vertical offset', p.userOffset?.[1] ?? 0),
      true,
    );
    if (tab === 'shape') html += separateAddition(p.separate ?? false);
  } else if (tab === 'split') {
    html += cutModes(tab);
    const split = s.splitKind ?? p.type ?? 'split';
    html += choice('splitKind', 'Method', split, [
      ['split', 'Straight plane'],
      ['radialSplit', 'Radial angle'],
    ]);
    if (split === 'split') {
      const axis = s.axis ?? p.axis ?? 'x',
        i = ['x', 'y', 'z'].indexOf(axis);
      const mid = part ? (part.bounds.min[i] + part.bounds.max[i]) / 2 : 0;
      html +=
        choice('axis', 'Cut axis', axis, [
          ['x', 'X'],
          ['y', 'Y'],
          ['z', 'Z'],
        ]) + field('position', 'Plane position', p.position ?? +mid.toFixed(3));
    } else {
      html +=
        field('cx', 'Arc centre X', p.center?.[0] ?? s.arc?.center?.[0] ?? 0) +
        field('cy', 'Arc centre Y', p.center?.[1] ?? s.arc?.center?.[1] ?? 0) +
        field('start', 'Start angle', p.startAngle ?? s.arc?.start ?? 0, '°') +
        field('end', 'End angle', p.endAngle ?? s.arc?.end ?? 30, '°') +
        field(
          'splitAngle',
          'Split angle',
          p.splitAngle ?? s.arc?.mid ?? 15,
          '°',
        );
    }
    html +=
      choice('keep', 'Keep', p.keep ?? 'both', [
        ['both', 'Both pieces'],
        ['low', 'First side'],
        ['high', 'Second side'],
      ]) + check('rebuild', 'Rebuild ends from original', p.rebuild ?? true);
    html +=
      split === 'split'
        ? field('band', 'Copied end depth', p.band ?? 11)
        : field('bandAngle', 'Copied end angle', p.bandAngle ?? 3, '°');
    html +=
      '<p class="hint">Include the entire end detail in the copied band. Matching cross-sections preserve the finished length.</p>';
  } else if (tab === 'tilt') {
    html += details(
      'Angle and placement',
      field('faceAngle', 'Face angle', p.angle ?? 10, '°') +
        choice('pivot', 'Starting edge', p.pivot ?? 'u-min', [
          ['u-min', 'Local X minimum'],
          ['u-max', 'Local X maximum'],
          ['v-min', 'Local Y minimum'],
          ['v-max', 'Local Y maximum'],
        ]) +
        field('hingeRotation', 'Hinge rotation', p.hingeRotation ?? 0, '°') +
        field('pivotOffset', 'Hinge offset', p.pivotOffset ?? 0) +
        '<p class="hint">Positive offset moves the hinge into the face. The area beyond the hinge rises with a positive angle and recedes with a negative angle.</p>',
      true,
    );
    html += separateAddition(p.separate ?? false);
  } else {
    html +=
      field('scale', 'Scale', p.scale ?? 1, '×') +
      (p.layFlat
        ? ''
        : details(
            'Size by dimension',
            '<label class="field"><span>Match dimension</span><select data-size-axis><option value="0">X · width</option><option value="1">Y · length</option><option value="2">Z · height</option></select></label>' +
              '<label class="field"><span>Target size</span><span class="input-wrap"><input data-size-target type="number" step="any" min="0"><small>mm</small></span></label>' +
              '<p class="hint">All three dimensions scale together. The size uses the rotation entered here.</p>',
          )) +
      field('rx', 'Rotate X', p.rotate?.[0] ?? 0, '°') +
      field('ry', 'Rotate Y', p.rotate?.[1] ?? 0, '°') +
      field('rz', 'Rotate Z', p.rotate?.[2] ?? 0, '°') +
      details(
        'Move and mirror',
        field('mx', 'Move X', p.move?.[0] ?? 0) +
          field('my', 'Move Y', p.move?.[1] ?? 0) +
          field('mz', 'Move Z', p.move?.[2] ?? 0) +
          check('mirror', 'Mirror across local X', p.mirror) +
          (!p.layFlat
            ? '<button type="button" class="secondary" data-undo-position disabled>Undo move</button><p class="hint">Drag the part or its centre handle to move in XY. Each arrow moves along one world axis.</p>'
            : ''),
        true,
      );
  }
  if (
    isFaceTool(tab) &&
    ![
      'trim-top',
      'edge-finish',
      'hole-modify',
      'wall-modify',
      'heal-feature',
    ].includes(tab)
  )
    html += surfaceControls(s.tolerance);
  const title =
    tab === 'move-face' && s.selectionCount > 1
      ? 'Push / pull faces'
      : editorTitles[tab];
  const applyLabel = op
    ? 'Update edit'
    : isSolidTool(tab) || isFeatureTool(tab)
      ? 'Apply'
      : {
          'align-parts': 'Apply alignment',
          'combine-parts': 'Apply combination',
          'trim-top': 'Apply trim',
          'trim-face': 'Apply trim',
          'move-face': 'Apply move',
          shape: 'Apply addition',
          'cut-shape': 'Apply cut',
          split: 'Split part',
          tilt: 'Tilt',
          transform: 'Apply transform',
          text: 'Apply text',
          simplify: 'Apply simplification',
          hollow: 'Hollow out',
        }[tab];
  return (
    '<div class="editor-inspector"><button type="button" class="editor-back" ' +
    (op ? 'data-action="cancel-op"' : 'data-return-tab="select"') +
    '>‹ Face editing</button>' +
    '<h3 class="property-title">' + icon('settings') + title + '</h3>' +
    settingsForm(html, applyLabel) + '</div>'
  );
}
