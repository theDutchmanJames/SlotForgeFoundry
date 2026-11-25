// The notes that come with a building kit: its parts, how they print and
// how they go together.
import { fmt } from './ui.js';

/**
 * How the parts of a kit are printed and put together, for the kit's notes.
 * parts: the parts as exported (a part cut to fit the plate is in pieces);
 * sizes: each part's size as it lies on the plate, by its id.
 */
const andList = (items) => items.slice(0, -1).join(', ') + ' and ' + items.at(-1);

export function kitNotes(name, b, parts, sizes) {
  const cut = parts.some((p) => / \d+ of \d+$/.test(p.name));
  const list = parts
    .map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : ''))
    .join('\n');
  const upper = b.upper ?? [];
  const sloped = b.roof !== 'flat';
  const framed = [b, ...upper].some((s) => s.openings.some((o) => o.frame));
  const braced = parts.some((p) => /^brace/.test(p.id));
  const divided = parts.some((p) => /^divide/.test(p.id));
  const doors = parts.filter((p) => /^door\d*$/.test(p.id)).length;
  const steps = [
    ...(cut
      ? ['Join the pieces of each cut part first (they are numbered, 1 of 2 and so on): lay them flat, push each tab into its socket or each brick into its step, glue, and let them set flat.']
      : []),
    ...(b.lane
      ? ['Stand the base over the end of its pit bay: the track runs in through the open front, its end stop inside, with the base beside it as high as the road.']
      : []),
    'Stand the four walls ' + (upper.length ? 'of the ground floor ' : '') + 'in the groove of the base. The front wall has the garage door opening.',
    'The mitred corners meet without a seam on the outside. Glue them, and glue the walls into the groove.',
    ...(divided
      ? ['Stand each dividing wall in its groove in the base, between the walls, and glue its ends to them. Its notched top corners let the lip of the roof or the floor above pass over it.']
      : []),
    ...(braced
      ? ['Glue a corner brace into each inside corner, standing on the floor with a leg against each wall: it holds the corner square while the glue sets.']
      : []),
    ...(b.door === 'roller'
      ? [doors > 1 ? 'Glue each roller door behind its opening, its ribs facing out, standing on the floor of its room.' : 'Glue the roller door behind its opening, its ribs facing out, standing on the floor of the base.']
      : []),
    ...upper.map(
      (_, i) =>
        'Lay the floor of storey ' + (i + 2) + ' on the walls below: its lip drops inside them. Stand the walls of storey ' + (i + 2) + ' in the groove on top of it, and glue them as you did below.',
    ),
    ...(framed ? ['Glue each frame around its window or door on the outside of the wall; a window frame has the cross.'] : []),
    sloped
      ? b.roof === 'gable'
        ? 'Lay the two roof panels on the walls so they meet at the ridge, their lips inside the walls, and glue them along the tops of the walls and to each other.'
        : 'Lay the roof panel on the walls, its high edge on the tallest wall: its lip drops inside the walls. Glue it along the tops of the walls.'
      : 'Drop the roof on: its lip fits inside the walls and keeps them square. Glue it, or leave it loose to look inside.',
  ];
  const storeys = upper.length
    ? ' ' + (upper.length + 1) + ' storeys: ' + upper.map((u, i) => 'storey ' + (i + 2) + ' ' + fmt(u.width) + ' × ' + fmt(u.depth) + ' mm, ' + fmt(u.height) + ' mm high').join('; ') + '.'
    : '';
  return [
    name + ' · SlotForge Foundry building kit',
    '',
    'Outside ' + fmt(b.width) + ' × ' + fmt(b.depth) + ' mm, walls ' + fmt(b.height) + ' mm high to the eaves on a base ' + fmt(b.baseHeight) + ' mm high.' + storeys +
      (b.rooms ? ' ' + b.rooms.sizes.length + ' rooms ' + (b.rooms.along === 'width' ? 'side by side' : 'front to back') + ': ' + b.rooms.sizes.map((v) => fmt(v)).join(' + ') + ' mm, outside to outside.' : ''),
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints flat as it is in its file, without supports.',
    '- The walls and frames lie with their outside face up. The mitred ends of the walls are 45° overhangs.',
    '- ' + andList(['The base', sloped ? 'the roof panels' : 'the roof', ...(upper.length ? ['the floors'] : [])]) + ' print upside down, their top on the plate and their lip up.' +
      (parts.some((p) => /^brace/.test(p.id)) ? ' A corner brace lies on one leg.' : ''),
    '',
    'Putting it together',
    ...steps.map((s, i) => i + 1 + '. ' + s),
    '',
    'Paint the parts before you glue them, or print them in different colours.',
  ].join('\n');
}
