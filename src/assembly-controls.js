import { button, choice, esc, field, fmt } from './ui.js';

export const assemblyTab = (tab) =>
  tab === 'align-parts' || tab === 'combine-parts';

export function assemblyControls(
  tab,
  { assemblyParts, assemblyFaces, pendingMate, op, assemblyDraft },
) {
  const parts = assemblyParts;
  const values = assemblyDraft;
  const align = tab === 'align-parts';
  const target = values.assemblyTarget ?? op?.target ?? parts[0]?.id;
  const peers = parts.filter((p) => p.id !== target);
  const method = values.combineMethod ?? op?.method ?? 'join';
  const mode = values.alignment ?? op?.alignment ?? 'stack';
  const select = choice(
    'assemblyTarget',
    align ? 'Move part' : method === 'subtract' ? 'Cut from' : 'Result part',
    target,
    parts.map((p) => [p.id, p.name]),
  );
  const names = peers.map((p) => esc(p.name)).join(', ');
  if (!align)
    return (
      choice('combineMethod', 'Operation', method, [
        ['join', 'Join'],
        ['subtract', 'Subtract'],
        ['intersect', 'Intersect'],
      ]) +
      select +
      '<p class="selection-note">' +
      (method === 'subtract' ? 'Cutters' : 'Other parts') +
      ' · ' +
      names +
      '</p>' +
      '<p class="hint">' +
      {
        join: 'Merge the selected solids into the result part.',
        subtract: 'Remove the cutter volumes from the result part.',
        intersect: 'Keep the volume shared by all selected parts.',
      }[method] +
      '</p>'
    );
  let html =
    select +
    '<p class="selection-note">Reference · ' +
    names +
    '</p>' +
    choice('alignment', 'Placement', mode, [
      ['stack', 'Centre on top'],
      ['centres', 'Match XYZ centres'],
      ['faces', 'Snap two faces'],
    ]);
  if (mode === 'faces') {
    html +=
      '<p class="hint">Pick a flat face on each part. The picked points meet and the faces point toward each other.</p>';
    for (const [index, id] of [target, peers[0]?.id].entries()) {
      const face = assemblyFaces.get(id);
      const name = index ? 'reference' : 'moving';
      html +=
        button(
          'pick-' + name + '-face',
          'Pick ' + name + ' face',
          'select',
          'secondary full',
        ) +
        '<small class="assembly-pick-note">' +
        (pendingMate === id
          ? 'Click the face in the viewport.'
          : face
            ? 'Point · ' + face.point.map(fmt).join(', ') + ' mm'
            : 'Choose a point on ' +
              esc(parts.find((p) => p.id === id)?.name ?? 'the part')) +
        '</small>';
    }
  }
  if (mode !== 'centres')
    html +=
      field('partGap', 'Gap', op?.gap ?? 0, 'mm') +
      '<p class="hint">A negative gap overlaps the parts.</p>';
  return html;
}
