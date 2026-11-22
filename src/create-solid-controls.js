import { choice, details, field } from './ui.js';
import { sketchPaths } from './create-sketch-data.js';
import { solidNames } from './design.js';

const shapeNames = {
  box: 'Box',
  cylinder: 'Cylinder',
  sphere: 'Sphere',
  cone: 'Cone',
  tube: 'Tube',
};
const defaults = {
  shape: 'box',
  width: 40,
  length: 30,
  height: 12,
  diameter: 20,
  bore: 8,
  topDiameter: 0,
  x: 0,
  y: 0,
  z: 0,
  distance: 24,
  direction: 'auto',
  axis: 'v',
  axisOffset: 0,
  angle: 360,
};
const num = (key, label, n, opts = {}) => field(key, label, n, 'mm', opts);
const positive = (key, label, n) => num(key, label, n, { min: 0.001 });
const cachedSketches = new WeakMap();

function sketchEntries(collection) {
  return Array.from(
    collection instanceof Map ? collection.values() : (collection ?? []),
    (s) => {
      if (s.loops && s.paths) return s;
      if (!s.sketch) return { ...s, loops: [], paths: [] };
      if (!cachedSketches.has(s.sketch))
        cachedSketches.set(s.sketch, sketchPaths(s.sketch));
      return { ...s, ...cachedSketches.get(s.sketch) };
    },
  );
}
export function createSolidControls(kind, op = {}, context = {}) {
  const stored = (form, prop, fallback = defaults[prop]) =>
    op[form] ?? op[prop] ?? fallback;
  const parts = context.parts ?? [],
    resolved = sketchEntries(context.sketches);
  const result = stored('creationResult', 'result', 'new'),
    shape = stored('primitiveShape', 'shape');
  const available = resolved.filter((s) => s.loops.length);
  const requestedProfile = stored(
    'profileSketch',
    'sketchId',
    context.sketchId,
  );
  const profileId = available.some((sketch) => sketch.id === requestedProfile)
    ? requestedProfile
    : available[0]?.id;
  const paths = resolved.filter((s) => s.paths.length === 1),
    sections = available.filter((s) => s.id !== profileId);
  const requestedSection = stored('loftSketch', 'sectionId');
  const sectionId = sections.some((sketch) => sketch.id === requestedSection)
    ? requestedSection
    : sections[0]?.id;
  const optionList = (entries, empty) =>
    entries.length
      ? entries.map((s) => [s.id, s.name ?? s.label ?? s.id])
      : [['', empty]];
  let html = '';
  if (kind === 'primitive') {
    html += choice(
      'primitiveShape',
      'Shape',
      shape,
      Object.entries(shapeNames),
    );
    if (shape === 'box')
      html +=
        positive('shapeWidth', 'Width', stored('shapeWidth', 'width')) +
        positive('shapeLength', 'Length', stored('shapeLength', 'length'));
    else
      html += positive(
        'shapeDiameter',
        shape === 'tube'
          ? 'Outside diameter'
          : shape === 'cone'
            ? 'Bottom diameter'
            : 'Diameter',
        stored('shapeDiameter', 'diameter'),
      );
    if (shape === 'tube')
      html += positive(
        'boreDiameter',
        'Bore diameter',
        stored('boreDiameter', 'bore'),
      );
    if (shape === 'cone')
      html += num(
        'topDiameter',
        'Top diameter',
        stored('topDiameter', 'topDiameter'),
        { min: 0 },
      );
    if (shape !== 'sphere')
      html += positive(
        'shapeHeight',
        'Height',
        stored('shapeHeight', 'height'),
      );
    html += details(
      'Placement',
      num('shapeX', 'X · Across plane', stored('shapeX', 'x')) +
        num('shapeY', 'Y · Along plane', stored('shapeY', 'y')) +
        num('shapeZ', 'Z · From plane', stored('shapeZ', 'z')) +
        '<button type="button" class="secondary" data-undo-position disabled>Undo move</button><p class="hint">Drag an axis arrow to move the shape. Drag the centre handle to slide it across the workplane.</p>',
      true,
    );
  } else {
    html += choice(
      'profileSketch',
      kind === 'loft' ? 'First section' : 'Profile',
      profileId,
      optionList(available, 'Create a closed sketch'),
    );
    if (kind === 'extrude')
      html +=
        positive(
          'extrudeDistance',
          'Distance',
          stored('extrudeDistance', 'distance'),
        ) +
        choice(
          'extrudeDirection',
          'Direction',
          stored('extrudeDirection', 'direction'),
          [
            ['auto', 'Automatic'],
            ['forward', 'Along plane normal'],
            ['reverse', 'Against plane normal'],
            ['symmetric', 'Both sides equally'],
          ],
        );
    if (kind === 'revolve')
      html +=
        choice('revolveAxis', 'Axis in sketch', stored('revolveAxis', 'axis'), [
          ['v', 'Vertical'],
          ['u', 'Horizontal'],
        ]) +
        num(
          'revolveOffset',
          'Axis offset',
          stored('revolveOffset', 'axisOffset'),
        ) +
        field('revolveAngle', 'Angle', stored('revolveAngle', 'angle'), '°', {
          min: 0.001,
          max: 360,
        });
    if (kind === 'sweep')
      html +=
        choice(
          'pathSketch',
          'Path',
          stored('pathSketch', 'pathId', paths[0]?.id),
          optionList(paths, 'Create an open path'),
        ) +
        '<p class="hint">The centre of the profile follows the path. Its vertical sketch axis points out of the path plane.</p>';
    if (kind === 'loft') {
      const first = available.find((s) => s.id === profileId),
        last = sections.find((s) => s.id === sectionId);
      // Separate sketches on the same workplane can be lofted immediately.
      const separation =
        first?.frame && last?.frame
          ? first.frame.normal.reduce(
              (sum, n, i) =>
                sum + n * (last.frame.origin[i] - first.frame.origin[i]),
              0,
            )
          : 0;
      html +=
        choice(
          'loftSketch',
          'Second section',
          sectionId,
          optionList(sections, 'Create a second closed sketch'),
        ) +
        num(
          'loftDistance',
          'Second section offset',
          stored(
            'loftDistance',
            'sectionOffset',
            Math.abs(separation) < 1e-6 ? 20 : 0,
          ),
        ) +
        '<p class="hint">The offset moves the second outline along its workplane normal.</p>';
    }
  }
  html += choice(
    'creationResult',
    'Result',
    result,
    parts.length
      ? [
          ['new', 'New part'],
          ['join', 'Join'],
          ['cut', 'Cut'],
        ]
      : [['new', 'New part']],
  );
  if (result !== 'new' && parts.length)
    html += choice(
      'creationTarget',
      'Target part',
      stored('creationTarget', 'target', context.selectedId ?? parts[0].id),
      optionList(parts, 'Choose a part'),
    );
  return html;
}
export function createSolidOperation(kind, fields, base = {}) {
  const val = (form, key, defaultVal = defaults[key]) =>
    fields[form] ?? base[key] ?? defaultVal;
  const op = {
    ...base,
    type: 'createSolid',
    kind,
    result: val('creationResult', 'result', 'new'),
  };
  if (op.result === 'new') delete op.target;
  else op.target = val('creationTarget', 'target');
  if (kind === 'primitive') {
    op.shape = val('primitiveShape', 'shape');
    for (const [key, form] of [
      ['width', 'shapeWidth'],
      ['length', 'shapeLength'],
      ['height', 'shapeHeight'],
      ['diameter', 'shapeDiameter'],
      ['bore', 'boreDiameter'],
      ['topDiameter', 'topDiameter'],
      ['x', 'shapeX'],
      ['y', 'shapeY'],
      ['z', 'shapeZ'],
    ])
      op[key] = val(form, key);
  } else {
    op.sketchId = val('profileSketch', 'sketchId');
    if (kind === 'extrude') {
      op.distance = val('extrudeDistance', 'distance');
      op.direction = val('extrudeDirection', 'direction');
    }
    if (kind === 'revolve') {
      op.axis = val('revolveAxis', 'axis');
      op.axisOffset = val('revolveOffset', 'axisOffset');
      op.angle = val('revolveAngle', 'angle');
    }
    if (kind === 'sweep') op.pathId = val('pathSketch', 'pathId');
    if (kind === 'loft') {
      op.sectionId = val('loftSketch', 'sectionId');
      op.sectionOffset = val('loftDistance', 'sectionOffset', 0);
    }
  }
  op.label =
    (kind === 'primitive' ? shapeNames[op.shape] : solidNames[kind]) ??
    'Create solid';
  return op;
}
