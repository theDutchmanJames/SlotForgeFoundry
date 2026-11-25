// The notes that come with a building kit: its parts, how they print and
// how they go together.
import { fmt } from './ui.js';

/**
 * How the parts of a kit are printed and put together, for the kit's notes.
 * sizes: each part's size as it lies on the plate, by its id.
 */
export function kitNotes(name, layout, sizes) {
  const b = layout.building;
  const list = layout.parts
    .map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : ''))
    .join('\n');
  const sloped = b.roof !== 'flat';
  const framed = b.openings.some((o) => o.frame);
  const steps = [
    'Stand the four walls in the groove of the base. The front wall has the garage door opening.',
    'The mitred corners meet without a seam on the outside. Glue them, and glue the walls into the groove.',
    ...(b.door === 'roller' ? ['Glue the roller door behind its opening, its ribs facing out, standing on the floor of the base.'] : []),
    ...(framed ? ['Glue each frame around its window or door on the outside of the wall; a window frame has the cross.'] : []),
    sloped
      ? b.roof === 'gable'
        ? 'Lay the two roof panels on the walls so they meet at the ridge, and glue them along the tops of the walls and to each other.'
        : 'Lay the roof panel on the walls, its high edge on the tallest wall, and glue it along the tops of the walls.'
      : 'Drop the roof on: its lip fits inside the walls and keeps them square. Glue it, or leave it loose to look inside.',
  ];
  return [
    name + ' · SlotForge Foundry building kit',
    '',
    'Outside ' + fmt(b.width) + ' × ' + fmt(b.depth) + ' mm, walls ' + fmt(b.height) + ' mm high to the eaves on a base ' + fmt(b.baseHeight) + ' mm high.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints flat as it is in its file, without supports.',
    '- The walls and frames lie with their outside face up. The mitred ends of the walls are 45° overhangs.',
    sloped
      ? '- The base prints upside down; each roof panel lies on its underside.'
      : '- The base and the roof print upside down, their flat top on the plate.',
    '',
    'Putting it together',
    ...steps.map((s, i) => i + 1 + '. ' + s),
    '',
    'Paint the parts before you glue them, or print them in different colours.',
  ].join('\n');
}
