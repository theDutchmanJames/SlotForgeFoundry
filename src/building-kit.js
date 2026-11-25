// The notes that come with a building kit: its parts, how they print and
// how they go together.
import { fmt } from './ui.js';

/**
 * How the parts of a kit are printed and put together, for the kit's notes.
 * parts: the parts as exported (a part cut to fit the plate is in pieces);
 * sizes: each part's size as it lies on the plate, by its id.
 */
export function kitNotes(name, b, parts, sizes) {
  const cut = parts.some((p) => / \d+ of \d+$/.test(p.name));
  const list = parts
    .map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : ''))
    .join('\n');
  const upper = b.upper ?? [];
  const sloped = b.roof !== 'flat';
  const framed = [b, ...upper].some((s) => s.openings.some((o) => o.frame));
  const steps = [
    ...(cut
      ? ['Join the pieces of each cut part first (they are numbered, 1 of 2 and so on): lay them flat, push each tab into its socket or each brick into its step, glue, and let them set flat.']
      : []),
    ...(b.lane
      ? ['Stand the base over the end of its pit bay: the track runs in through the open front, its end stop inside, with the base beside it as high as the road.']
      : []),
    'Stand the four walls ' + (upper.length ? 'of the ground floor ' : '') + 'in the groove of the base. The front wall has the garage door opening.',
    'The mitred corners meet without a seam on the outside. Glue them, and glue the walls into the groove.',
    ...(b.door === 'roller' ? ['Glue the roller door behind its opening, its ribs facing out, standing on the floor of the base.'] : []),
    ...upper.map(
      (_, i) =>
        'Lay the floor of storey ' + (i + 2) + ' on the walls below: its lip drops inside them. Stand the walls of storey ' + (i + 2) + ' in the groove on top of it, and glue them as you did below.',
    ),
    ...(framed ? ['Glue each frame around its window or door on the outside of the wall; a window frame has the cross.'] : []),
    sloped
      ? b.roof === 'gable'
        ? 'Lay the two roof panels on the walls so they meet at the ridge, and glue them along the tops of the walls and to each other.'
        : 'Lay the roof panel on the walls, its high edge on the tallest wall, and glue it along the tops of the walls.'
      : 'Drop the roof on: its lip fits inside the walls and keeps them square. Glue it, or leave it loose to look inside.',
  ];
  const storeys = upper.length
    ? ' ' + (upper.length + 1) + ' storeys: ' + upper.map((u, i) => 'storey ' + (i + 2) + ' ' + fmt(u.width) + ' × ' + fmt(u.depth) + ' mm, ' + fmt(u.height) + ' mm high').join('; ') + '.'
    : '';
  return [
    name + ' · SlotForge Foundry building kit',
    '',
    'Outside ' + fmt(b.width) + ' × ' + fmt(b.depth) + ' mm, walls ' + fmt(b.height) + ' mm high to the eaves on a base ' + fmt(b.baseHeight) + ' mm high.' + storeys,
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints flat as it is in its file, without supports.',
    '- The walls and frames lie with their outside face up. The mitred ends of the walls are 45° overhangs.',
    (sloped ? '- The base' : '- The base and the roof') + (upper.length ? ' and the floors' : '') + (sloped && !upper.length ? ' prints' : ' print') + ' upside down' + (sloped ? '; each roof panel lies on its underside.' : ', their flat top on the plate.'),
    '',
    'Putting it together',
    ...steps.map((s, i) => i + 1 + '. ' + s),
    '',
    'Paint the parts before you glue them, or print them in different colours.',
  ].join('\n');
}
