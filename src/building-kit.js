// The notes that come with a building kit: its parts, how they print and
// how they go together.
import { fmt } from './ui.js';

/** How the parts of a kit are printed and put together, for the kit's notes. */
export function kitNotes(name, layout) {
  const b = layout.building;
  const parts = layout.parts.map((p) => '- ' + p.name + ': ' + p.print.map((v) => fmt(v)).join(' × ') + ' mm').join('\n');
  return [
    name + ' · SlotForge Foundry building kit',
    '',
    'Outside ' + fmt(b.width) + ' × ' + fmt(b.depth) + ' mm, walls ' + fmt(b.height) + ' mm high on a base ' + fmt(b.baseHeight) + ' mm high.',
    '',
    'Parts, as they lie on the plate:',
    parts,
    '',
    'Printing',
    '- Every part prints flat as it is in its file, without supports.',
    '- The walls lie with their outside face up. Their mitred ends are 45° overhangs.',
    '- The base and the roof print upside down, their flat top on the plate.',
    '',
    'Putting it together',
    '1. Stand the four walls in the groove of the base. The front wall has the door opening.',
    '2. The mitred corners meet without a seam on the outside. Glue them, and glue the walls into the groove.',
    b.door === 'roller'
      ? '3. Glue the roller door behind the opening, its ribs facing out, standing on the floor of the base.\n4. Drop the roof on: its lip fits inside the walls and keeps them square. Glue it, or leave it loose to look inside.'
      : '3. Drop the roof on: its lip fits inside the walls and keeps them square. Glue it, or leave it loose to look inside.',
    '',
    'Paint the parts before you glue them, or print them in different colours.',
  ].join('\n');
}
