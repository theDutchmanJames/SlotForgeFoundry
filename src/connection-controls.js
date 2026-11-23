import { choice, details, esc, field } from './ui.js';
import { braidSpan } from './geometry/solids.js';
import { hasSlotPosition, slotLaneOffsetAt, slotVaries } from './slot-position.js';
import { PIT_CONTACT_DEFAULTS } from './geometry/pit-braids.js';
import { SCREW_CLIP_DEFAULTS, SCREW_CLIP_TYPE } from './geometry/screw-clip.js';
import {
  placementKeys,
  positionKey,
  isFraction,
  defaultConnectorCount,
  validatePlacements,
} from './geometry/placements.js';

const jointScopes = {
  seam: ['joint', 'Between segments'],
  start: ['jointStart', 'Start of road'],
  finish: ['jointEnd', 'End of road'],
  side: ['borderMount', 'Attach to road'],
  end: ['borderJoint', 'Join border ends'],
};
const modes = [
  ['none', 'Plain'], ['tabs', 'Tabs + sockets'], ['clips', 'Removable clips'], ['both', 'Tabs + clips'],
];
const kinds = ['clip', 'tab'];
const external = (scope) => scope === 'start' || scope === 'finish';
const active = (mode, kind) => mode === 'both' || mode === kind + 's';
const positionKeysFor = (scope, kind) => {
  return ['side', 'end'].includes(scope)
    ? [undefined, 'inner', 'outer'].map(side => positionKey(scope, kind, side))
    : [positionKey(scope, kind)];
};

// Side screw clips of this piece: either road side can be switched off, and
// with Per road side each side has its own screw direction.
function screwSideControls(p) {
  const screw = p.clipType === SCREW_CLIP_TYPE;
  const perSide = (p.screwDirection ?? 'top') === 'side';
  const side = (name, label) =>
    choice('sideClip' + name, label + ' side clips', p['sideClip' + name] ?? '', [
      ['', 'Fitted'],
      ['none', 'None'],
    ]) +
    '<div data-screw-from' + (perSide ? '' : ' hidden') + '>' +
    choice('screwFrom' + name, label + ' side screws', p['screwFrom' + name] === 'bottom' ? 'bottom' : '', [
      ['', 'From the top'],
      ['bottom', 'From the bottom'],
    ]) + '</div>';
  return '<div class="joint-count-group" role="group" aria-label="Side screw clips" data-screw-sides' +
    (screw ? '' : ' hidden') + '>' +
    side('Left', 'Left') + side('Right', 'Right') +
    '<p class="hint">Side screw clips sit at both road edges of every road joint with clips. Left is the outside of a corner. Each side of the piece can have its own screw direction when the clip settings say Per road side.</p></div>';
}

export function jointCountControls(p) {
  function group(scope) {
    const [modeField, label] = jointScopes[scope];
    const options = external(scope) ? [['', 'Same as seams'], ...modes] : modes;
    const counts = kinds.map(kind => {
      const key = positionKey(scope, kind);
      const inherited = external(scope);
      const fallback = defaultConnectorCount(scope, kind);
      const stored = p.connectorCounts?.[key];
      return '<div data-count-row="' + kind + '">' +
        choice('count_' + key, kind === 'clip' ? 'Clips per joint' : 'Tabs per joint', String(stored ?? ''), [
          ['', inherited ? 'Same as seams' : 'Automatic (' + fallback + ')'],
          ...[1, 2, 3].map(n => [String(n), String(n)]),
        ]) +
        '<p class="hint" data-custom-count hidden>Using custom positions. <button type="button" class="count-reset" data-auto-count="' +
        key + '">Use automatic spacing</button></p></div>';
    }).join('');
    return '<div class="joint-count-group" role="group" aria-label="' + esc(label) +
      '" data-joint-scope="' + scope + '">' +
      choice(modeField, label, p[modeField] ?? '', options) + counts + '</div>';
  }
  return details('Road connections', group('seam') + group('start') + group('finish') + screwSideControls(p), true, 'roadJoints') +
    details('Border connections', group('side') + group('end'), false, 'borderJoints');
}

function countWithDefault(form, scope, kind) {
  const value = form.elements.namedItem('count_' + positionKey(scope, kind)).value;
  if (value) return Number(value);
  return external(scope) ? countWithDefault(form, 'seam', kind) : defaultConnectorCount(scope, kind);
}

export function syncJointCountControls(form) {
  if (!form?.elements.joint) return;
  const screw = form.elements.clipType?.value === SCREW_CLIP_TYPE;
  for (const box of form.querySelectorAll('[data-clip-family]'))
    box.hidden = (box.dataset.clipFamily === 'screw') !== screw;
  for (const box of form.querySelectorAll('[data-screw-sides]')) box.hidden = !screw;
  const perSide = form.elements.screwDirection?.value === 'side';
  for (const box of form.querySelectorAll('[data-screw-from]')) box.hidden = !perSide;
  const mutes = new Set(form.elements.placementMutes.value.split(','));
  for (const group of form.querySelectorAll('[data-joint-scope]')) {
    const scope = group.dataset.jointScope;
    const mode = form.elements.namedItem(jointScopes[scope][0]).value;
    group.dataset.currentMode = mode;
    for (const kind of kinds) {
      const row = group.querySelector('[data-count-row="' + kind + '"]');
      const select = row.querySelector('select');
      const manual = positionKeysFor(scope, kind).some(key =>
        form.elements.namedItem('place_' + key)?.value.trim() || mutes.has(key));
      const showInherited = external(scope) && !mode && (manual || select.value);
      row.hidden = !active(mode || form.elements.joint.value, kind) || (!mode && !showInherited) ||
        // Side screw clips have no count: one sits at each road edge.
        (screw && kind === 'clip' && !['side', 'end'].includes(scope));
      row.querySelector('[data-custom-count]').hidden = !manual;
      if (external(scope))
        select.options[0].text = 'Same as seams (' + countWithDefault(form, 'seam', kind) + ')';
      else {
        select.options[0].hidden = true;
        select.options[0].disabled = true;
      }
      const other = kind === 'clip' ? 'tab' : 'clip';
      select.options[3].disabled = (mode || form.elements.joint.value) === 'both' &&
        countWithDefault(form, scope, other) === 3;
    }
  }
}

// A quantity takes ownership of the positions for that connector type. The
// opposite type's marks and unrelated joints stay in the draft as entered.
export function changeJointCount(input, store, forceAutomatic = false) {
  const group = input.closest('[data-joint-scope]');
  if (!group) return;
  const form = input.form, scope = group.dataset.jointScope;
  const set = (field, value) => {
    if (field.value !== value) {
      field.value = value;
      store(field);
    }
  };
  const clearMarks = (kind) => {
    const keys = positionKeysFor(scope, kind);
    for (const key of keys) set(form.elements.namedItem('place_' + key), '');
    const mutes = form.elements.placementMutes;
    set(mutes, mutes.value.split(',').filter(key => !keys.includes(key)).join(','));
  };
  for (const kind of kinds) {
    const select = form.elements.namedItem('count_' + positionKey(scope, kind));
    if (input === select) {
      clearMarks(kind);
      if (forceAutomatic && !input.value)
        set(input, String(countWithDefault(form, scope, kind)));
    } else if (input.name === jointScopes[scope][0]) {
      if (external(scope) && !input.value) {
        set(select, '');
      } else if (active(input.value, kind) && !select.value &&
          (!external(scope) || !form.elements.namedItem('count_' + positionKey('seam', kind)).value)) {
        set(select, String(countWithDefault(form, scope, kind)));
      }
    }
  }
  // Switching from either single type to a mix can reveal two saved threes.
  // Keep the existing three and put the newly added type in the two gaps.
  if (input.name === jointScopes[scope][0] && input.value === 'both' &&
      kinds.every(kind => countWithDefault(form, scope, kind) === 3)) {
    const added = group.dataset.currentMode === 'tabs' ? 'clip' : 'tab';
    set(form.elements.namedItem('count_' + positionKey(scope, added)), '2');
  }
}

/** Optional entries override automatic placement. Signed distances run from
 * the road centre towards its outside/left side, as shown in the road view.
 */
export function connectionControls(p) {
  const positions = p.placements ?? {};
  const row = (key) => {
    const fraction = isFraction(key);
    const value = formatConnectorPositions(key, positions[key]);
    return (
      '<label class="field"><span>' +
      esc(placementKeys[key]) +
      '</span><span class="input-wrap">' +
      '<input type="text" name="place_' +
      key +
      '" value="' +
      esc(value) +
      '" maxlength="200" placeholder="Auto" autocomplete="off">' +
      '<small>' +
      (fraction ? '%' : 'mm') +
      '</small></span></label>'
    );
  };
  return (
    '<input type="hidden" name="placementMutes" value="' +
    esc((p.mutedPlacements ?? []).join(',')) +
    '">' +
    details(
      'Custom road connector positions',
      '<p class="hint">Signed offsets from the road centre. Positive points toward the outer or left edge. Enter positions separated by commas, or leave blank for automatic placement.</p>' +
        [
          'startTabs',
          'startClips',
          'seamTabs',
          'seamClips',
          'finishTabs',
          'finishClips',
        ]
          .map(row)
          .join(''),
    ) +
    details(
      'Custom border connector positions',
      '<p class="hint">Side positions run from the start to the finish of each border segment. End positions run from the road edge to the free edge. Enter percentages separated by commas.</p>' +
        ['sideTabs', 'sideClips', 'endTabs', 'endClips'].map(row).join('') +
        details(
          'Per-side overrides',
          '<p class="hint">Blank uses the shared border positions. Enter none for zero connectors on that side.</p>' +
            Object.keys(placementKeys)
              .filter((k) => /^(inner|outer)/.test(k))
              .map(row)
              .join(''),
        ),
    )
  );
}

export function formatConnectorPositions(key, positions) {
  if (positions == null) return '';
  if (!positions.length) return 'none';
  const scale = isFraction(key) ? 100 : 1;
  return positions.map((n) => Number((n * scale).toFixed(9))).join(', ');
}

/** Apply to normal form values before assigning them to track parameters. */
export function parseConnectionControls(fields, params = {}, edited = {}) {
  // The side screw clip settings are always on the Joints page. A piece that
  // never set them keeps them unset until one differs from its default.
  if (Object.keys(SCREW_CLIP_DEFAULTS).some((key) => Object.hasOwn(fields, key))) {
    fields = { ...fields };
    // An empty Screw length means automatic (main.js removes it).
    for (const [key, value] of Object.entries(SCREW_CLIP_DEFAULTS))
      if (key !== 'screwLength' && params[key] === undefined && fields[key] === value) delete fields[key];
    if (Object.hasOwn(fields, 'screwLength') && params.screwLength == null && !Number.isFinite(fields.screwLength))
      delete fields.screwLength;
  }
  if (Object.hasOwn(fields, 'feedPercent')) {
    const percent = String(fields.feedPercent ?? '')
      .trim()
      .split(',')
      .map((s) => s.trim());
    if (
      !percent.length ||
      percent.length > 8 ||
      percent.some(
        (s) => !/^\d+(?:\.\d+)?$/.test(s) || Number(s) <= 0 || Number(s) >= 100,
      )
    )
      throw new Error(
        'Enter up to eight braid feed locations between 0 and 100%, separated by commas.',
      );
    fields = {
      ...fields,
      braidFeedStations: percent.map((s) => Number(s) / 100),
    };
    delete fields.feedPercent;
  }
  if (!Object.keys(fields).some((k) => k.startsWith('place_'))) return fields;
  const result = { ...fields, placements: {} };
  if (Object.hasOwn(result, 'count_seamClips')) {
    const counts = { ...params.connectorCounts };
    for (const scope of Object.keys(jointScopes)) {
      for (const kind of kinds) {
        const key = positionKey(scope, kind), field = 'count_' + key;
        if (!Object.hasOwn(result, field)) continue;
        const value = result[field];
        delete result[field];
        if (Object.hasOwn(edited, field)) {
          for (const override of positionKeysFor(scope, kind).slice(1))
            delete counts[override];
        }
        if (value === '' || value == null) delete counts[key];
        else counts[key] = Number(value);
      }
    }
    if (Object.keys(counts).length || params.connectorCounts) result.connectorCounts = counts;
  }
  if (Object.hasOwn(result, 'placementMutes')) {
    result.mutedPlacements = result.placementMutes.split(',').filter(Boolean);
    delete result.placementMutes;
  }
  for (const key of Object.keys(placementKeys)) {
    const text = String(result['place_' + key] ?? '').trim();
    delete result['place_' + key];
    if (!text) continue;
    if (text.toLowerCase() === 'none') {
      result.placements[key] = [];
      continue;
    }
    const items = text.split(',').map((s) => s.trim());
    if (items.some((s) => !/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(s)))
      throw new Error(
        placementKeys[key] + ': separate numerical positions with commas.',
      );
    result.placements[key] = items.map(
      (s) => Number(s) / (isFraction(key) ? 100 : 1),
    );
  }
  validatePlacements(result.placements);
  return result;
}

export function braidFeedControls(p) {
  const locations = (p.braidFeedStations ?? [0.15])
    .map((t) => Number((t * 100).toFixed(4)))
    .join(', ');
  const pit = p.special?.type === 'pit';
  let contacts = '';
  if (pit) {
    const mode = p.special.pitContactMode ?? PIT_CONTACT_DEFAULTS.pitContactMode;
    const length = p.special.pitContactLength ?? PIT_CONTACT_DEFAULTS.pitContactLength;
    contacts = choice('spPitContactMode', 'Pit junction openings', mode, [
      ['wire', 'Round wire holes'],
      ['braid', 'Braid pass-throughs'],
    ]) +
      '<p class="hint" data-pit-braid-width' + (p.braidWidth > 0 ? ' hidden' : '') +
      '>Set Width per strip above 0 mm in Braid recess to create junction openings.</p>' +
      '<div data-pit-contact-slot' + (mode === 'braid' ? '' : ' hidden') + '>' +
      field('spPitContactLength', 'Pit slot length', length, 'mm', { min: 0.3, max: 50 }) +
      '<p class="hint">Slot length runs along the braid. Each slot is one braid strip wide and goes straight through the road.</p></div>' +
      '<p class="hint">This sets the openings at the cut braid ends at pit entry and exit. Continuous braids keep their round wire holes.</p>';
  }
  return details(
    'Braid pass-throughs',
    contacts + choice('braidFeedSide', pit ? 'Extra lane openings' : 'Feed openings', p.braidFeedSide ?? 'none', [
      ['none', 'None'],
      ['both', 'Both braid strips'],
      ['left', 'Left strip'],
      ['right', 'Right strip'],
    ]) +
      field('braidFeedLane', 'Lane · 0 for all', p.braidFeedLane ?? 0, '', {
        min: 0,
        step: 1,
      }) +
      field('braidFeedLength', 'Opening length', p.braidFeedLength ?? 3, 'mm', {
        min: 0.3,
      }) +
      '<label class="field"><span>Along each lane</span><span class="input-wrap"><input type="text" name="feedPercent" value="' +
      esc(locations) +
      '" maxlength="100" autocomplete="off"><small>%</small></span></label>' +
      '<p class="hint">Enter positions from the start of the lane. Each slit runs straight down from the braid recess. Opening length is measured along the lane.</p>',
    pit && p.braidWidth > 0, 'feed',
  );
}

/** Profile schematic with true relative X dimensions. Z has a separate
 * paper scale so shallow braid seats remain visible inside a narrow inspector.
 */
export function profileDiagram(p) {
  const imported = p.kind === 'import';
  const lanes = imported ? 1 : p.lanes;
  const featureWidth = p.slotWidth + 2 * braidSpan(p);
  const width = imported
    ? Math.max(featureWidth + 2 * p.wall + 6, 36)
    : p.width;
  const height = p.height,
    deck = p.deck,
    wall = p.wall;
  if (
    ![
      width,
      height,
      deck,
      wall,
      p.slotWidth,
      p.slotDepth,
      p.braidDepth,
      p.braidWidth,
      p.braidGap,
    ].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(lanes) ||
    lanes < 1 ||
    lanes > 8
  )
    return '';
  // The section is cut at end A, where an off-centre slot starts.
  const laneX = Array.from({ length: lanes }, (_, i) => {
    const nominal = (i - (lanes - 1) / 2) * p.laneSpacing;
    if (imported || !hasSlotPosition(p)) return nominal;
    const x = slotLaneOffsetAt(p, i, 0);
    return Number.isFinite(x) && Math.abs(x) < width / 2 ? x : nominal;
  });
  const xScale = 280 / width,
    zScale = 64 / height;
  const f = (n) => Number(n.toFixed(2));
  const xy = ([x, z]) => f(154 + x * xScale) + ' ' + f(78 - z * zScale);
  const edgeLine = (x1, x2, z) =>
    '<path d="M' +
    xy([x1, z]) +
    'L' +
    xy([x2, z]) +
    '" stroke="var(--d-warn)" stroke-width="2"/>';
  const path = [[-width / 2, height]],
    seats = [];
  const half = p.slotWidth / 2,
    low = p.braidWidth > 0 ? height - p.braidDepth : height,
    base = height - p.slotDepth;
  for (const x of laneX) {
    const a = x - half - p.braidGap - p.braidWidth,
      b = x - half - p.braidGap,
      c = x + half + p.braidGap,
      d = c + p.braidWidth;
    if (low < height) {
      path.push([a, height], [a, low]);
      if (p.braidGap > 0) path.push([b, low], [b, height]);
    }
    const lip = p.braidGap > 0 ? height : low;
    path.push(
      [x - half, lip],
      [x - half, base],
      [x + half, base],
      [x + half, lip],
    );
    if (low < height) {
      if (p.braidGap > 0) path.push([c, height], [c, low]);
      path.push([d, low], [d, height]);
    }
    if (p.braidWidth > 0) seats.push(edgeLine(a, b, low), edgeLine(c, d, low));
  }
  path.push([width / 2, height], [width / 2, 0]);
  if (p.hollow) {
    const roof = height - deck,
      sleeve = Math.min(roof, base - wall);
    path.push([width / 2 - wall, 0], [width / 2 - wall, roof]);
    for (const x of [...laneX].reverse())
      path.push(
        [x + half + wall, roof],
        [x + half + wall, sleeve],
        [x - half - wall, sleeve],
        [x - half - wall, roof],
      );
    path.push([-width / 2 + wall, roof], [-width / 2 + wall, 0]);
  }
  path.push([-width / 2, 0]);
  return (
    '<figure class="property-section-diagram"><svg width="100%" viewBox="0 0 308 88" role="img" aria-label="' +
    (imported
      ? 'Schematic of one imported lane'
      : 'Cross-section of the track profile') +
    '">' +
    '<path d="M' +
    path.map(xy).join('L') +
    'Z" fill="var(--d-track)" stroke="var(--d-track-edge)" stroke-width="1.2"/>' +
    seats.join('') +
    '</svg><figcaption>' +
    (imported ? 'One-lane profile detail · ' : slotVaries(p) ? 'Seen at end A · ' : '') +
    'Height enlarged <span class="braid-legend">Braid</span></figcaption></figure>'
  );
}
