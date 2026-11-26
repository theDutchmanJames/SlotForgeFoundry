// The notes that come with a building kit: its parts, how they print and
// how they go together.
import { fmt } from './ui.js';
import { marshalLevels } from './geometry/marshal-post.js';

/**
 * How the parts of a kit are printed and put together, for the kit's notes.
 * parts: the parts as exported (a part cut to fit the plate is in pieces);
 * sizes: each part's size as it lies on the plate, by its id.
 */
const andList = (items) => items.slice(0, -1).join(', ') + ' and ' + items.at(-1);

export function kitNotes(name, b, parts, sizes) {
  if (b.kind === 'grandstand') return standNotes(name, b, parts, sizes);
  if (b.kind === 'gantry') return gantryNotes(name, b, parts, sizes);
  if (b.kind === 'pitmodule') return pitNotes(name, b, parts, sizes);
  if (b.kind === 'marshalpost') return marshalNotes(name, b, parts, sizes);
  if (b.kind === 'platform') return platformNotes(name, b, parts, sizes);
  const cut = parts.some((p) => / \d+ of \d+$/.test(p.name));
  const list = parts
    .map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : ''))
    .join('\n');
  const upper = b.upper ?? [];
  const sloped = b.roof !== 'flat';
  const framed = [b, ...upper].some((s) => s.openings.some((o) => o.frame));
  const braced = parts.some((p) => /^brace/.test(p.id));
  // The roof has a frame under it, held by tabs in pockets in its underside.
  const framed2 = parts.some((p) => /^roof.*-frame/.test(p.id));
  const divided = parts.some((p) => /^divide/.test(p.id));
  const doors = parts.filter((p) => /^door\d*$/.test(p.id)).length;
  const steps = [
    ...(cut
      ? ['Join the pieces of each cut part first (they are numbered, 1 of 2 and so on): lay them flat, push each tab into its socket or each brick into its step, glue, and let them set flat.']
      : []),
    ...(b.lane
      ? ['Stand the base over the end of its pit bay: the track runs in through the open front, its end stop inside, with the base beside it as high as the road.']
      : []),
    'Stand the four walls ' + (upper.length ? 'of the ground floor ' : '') + 'in the groove of the base.' + (b.door === 'none' ? '' : ' The front wall has the garage door opening' + (b.rooms?.along === 'width' ? 's.' : '.')),
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
        'Push the floor frame of storey ' + (i + 2) + ' onto the underside of its floor, each tab up into its slot until it is flush, with a drop of glue. Lay the floor on the walls below, the frame inside them. Stand the walls of storey ' + (i + 2) + ' in the groove on top, and glue them as you did below.',
    ),
    ...(framed ? ['Glue each frame around its window or door on the outside of the wall; a window frame has the cross.'] : []),
    ...(parts.some((p) => /^counter/.test(p.id)) ? ['Glue each counter under its window, level, its fins flat against the wall below it.'] : []),
    ...(parts.some((p) => /^flap/.test(p.id)) ? ['Glue each flap over its window, propped open: the back edge of its two fins against the wall' + (framed ? ' or the frame' : '') + ' sets its angle.'] : []),
    ...(b.sign === 'fascia' ? ['Glue the sign along the top of the front wall, under the eaves, for the name of the stall.'] : []),
    ...(b.sign === 'billboard' ? ['Stand the billboard on the roof at its front edge, its foot following the roof and its two fins resting on the roof behind it, and glue it.'] : []),
    ...(parts.some((p) => /^number/.test(p.id))
      ? [(b.upper?.[0]?.balcony ? 'Glue each bay number under the front edge of the balcony, over its door.' : 'Glue each bay number on the wall above its door.') + ' Paint the raised number, or print the plaque in two colours.']
      : []),
    ...(parts.some((p) => /^(railing|roofrail)/.test(p.id))
      ? ['Push the two tabs of each railing into their pockets along the edge of its floor or roof, the posts on the outside, with a drop of glue in each. The pieces of a long railing meet end to end.']
      : []),
    ...(framed2 ? ['Push the roof frame' + (sloped && b.roof === 'gable' ? 's' : '') + ' onto the underside of the roof, each tab into its pocket, with a drop of glue.'] : []),
    sloped
      ? b.roof === 'gable'
        ? 'Lay the two roof panels on the walls so they meet at the ridge' + (framed2 ? ', their frames inside the walls' : '') + ', and glue them along the tops of the walls and to each other.'
        : 'Lay the roof panel on the walls, its high edge on the tallest wall' + (framed2 ? ', its frame inside the walls' : '') + '. Glue it along the tops of the walls.'
      : framed2
        ? 'Drop the roof on: its frame fits inside the walls and keeps them square. Glue it, or leave it loose to look inside.'
        : 'Lay the roof on the walls and glue it along their tops, or leave it loose to look inside.',
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
    ...(parts.some((p) => /^(counter|flap)/.test(p.id)) ? ['- A counter or a flap lies on its top, its two fins standing up from it.'] : []),
    '- The base prints upside down. ' + andList([sloped ? 'The roof panels' : 'The roof', ...(upper.length ? ['the floors'] : []), ...(framed2 || upper.length ? ['their frames'] : [])]) + ' print the right way up: a roof on its underside, its texture on top, a frame flat with its tabs up.' +
      (parts.some((p) => /^brace/.test(p.id)) ? ' A corner brace lies on one leg.' : '') +
      (parts.some((p) => /^(railing|roofrail)/.test(p.id)) ? ' A railing lies flat, its tabs in its own plane.' : ''),
    '',
    'Putting it together',
    ...steps.map((s, i) => i + 1 + '. ' + s),
    '',
    'Paint the parts before you glue them, or print them in different colours.',
  ].join('\n');
}

// The notes of a grandstand: its sections stood on end, joined, and its canopy.
function standNotes(name, g, parts, sizes) {
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  const sections = parts.filter((p) => /^stand/.test(p.id)).length;
  const canopy = parts.some((p) => /^canopy/.test(p.id));
  const steps = [
    ...(sections > 1
      ? ['Join the sections end to end in their order, 1 of ' + sections + ' first: push the two tabs at the end of each into the slots of the next, with a drop of glue, and let them set on a flat table.']
      : []),
    'Stand the grandstand on the table, its parapet towards the track.',
    ...(canopy
      ? ['Glue the canopy' + (parts.filter((p) => /^canopy/.test(p.id)).length > 1 ? ' pieces' : '') + ' on top of the back wall, reaching out over the rows, and glue the posts under its front edge, in front of the parapet.']
      : []),
  ];
  return [
    name + ' · SlotForge Foundry grandstand kit',
    '',
    g.rows + ' rows, ' + fmt(g.length) + ' mm long' + (g.curve ? ' along the front, curved on a radius of ' + fmt(g.curve.radius) + ' mm through ' + fmt(g.curve.angle) + '°' : '') + '; each row ' + fmt(g.rowDepth) + ' mm deep and ' + fmt(g.rowRise) + ' mm higher than the one before.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    '- Each section stands on its end: the stepped side lies on the plate and the rows rise straight up. It is a hollow shell, 3 mm thick.',
    ...(canopy ? ['- The canopy lies flat; each post lies on its side.'] : []),
    '',
    'Putting it together',
    ...steps.map((s, i) => i + 1 + '. ' + s),
    '',
    'Paint the benches before you put the stand together, or print the sections in a colour of their own.',
  ].join('\n');
}

// The notes of a gantry or a footbridge over the track.
function gantryNotes(name, g, parts, sizes) {
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  const cut = parts.some((p) => / \d+ of \d+$/.test(p.name));
  const bridge = g.type === 'bridge';
  const steps = [
    ...(cut ? ['Join the pieces of the ' + (bridge ? 'walkway' : 'beam') + ' first: push each tab into its socket, glue, and let it set flat.'] : []),
    ...(bridge
      ? [
          'Stand a staircase on each side of the track, ' + fmt(g.span) + ' mm apart, their landings towards it.',
          'Lay the walkway across, each end on a landing, and glue it there.',
        ]
      : [
          'Stand the leg' + (g.type === 'half' ? ' beside the track.' : 's on each side of the track, ' + fmt(g.span) + ' mm apart inside.'),
          'Drop the beam on' + (g.type === 'half' ? ': the socket at its end goes over the pin on top of the leg, and the beam reaches out over the road.' : ': the sockets at its ends go over the pins on top of the legs.') + ' Glue it.',
        ]),
  ];
  return [
    name + ' · SlotForge Foundry ' + (bridge ? 'footbridge' : 'gantry') + ' kit',
    '',
    (bridge ? 'A footbridge' : g.type === 'half' ? 'A half gantry' : 'A start gantry') + ' over ' + fmt(g.span) + ' mm of track, ' + fmt(g.clearance) + ' mm clear underneath.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    ...(bridge
      ? ['- A staircase lies on its side; the walkway stands upright, its walls up.']
      : ['- A leg stands on its foot. The beam lies on its back' + (g.board ? ', the board flat on the plate,' : '') + ' its front' + (g.type === 'start' && g.lights ? ' with the start lights' : '') + ' up.']),
    '',
    'Putting it together',
    ...steps.map((s, i) => i + 1 + '. ' + s),
    '',
    'Paint the start lights red, or put a sticker on the board.',
  ].join('\n');
}

// The notes of a pit building made of bays.
function pitNotes(name, m, parts, sizes) {
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  const door = m.door === 'panel' ? 'up-and-over door' : 'roller door';
  const rails = [m.railing && 'the balcony', m.roofRailing && 'the front and the back of the roof'].filter(Boolean);
  const steps = [
    ...(m.bays > 1 ? ['Join the bays end to end in their order, bay 1 first: push the two tabs at the end of each into the slots of the next, with a drop of glue, and let them set on a flat table.'] : []),
    'Glue the end panel on the open end of the last bay.',
    'Glue ' + (m.door === 'panel' ? 'an ' : 'a ') + door + ' into each doorway, against the wall at the back of its reveal, standing on the floor.',
    ...(m.numbers ? ['Glue the bay numbers on the angled front of the balcony, one over each door, ' + m.firstNumber + ' at bay 1.'] : []),
    ...(rails.length ? ['Push the railings into the pockets along ' + rails.join(' and ') + ', their tabs down, and glue them.'] : []),
    'Stand the building beside the pit lane, the doors towards it; the balcony and the visor reach out over the lane.',
  ];
  return [
    name + ' · SlotForge Foundry pit building kit',
    '',
    m.bays + (m.bays === 1 ? ' bay, ' : ' bays, each ') + fmt(m.bayWidth) + ' mm wide; ' + fmt(m.depth) + ' mm deep. The ' + door + 's are ' + fmt(m.doorWidth) + ' × ' + fmt(m.doorHeight) + ' mm, set back ' + fmt(m.recess) + ' mm; the glazing leans out ' + fmt(m.lean) + '°.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    '- Each bay stands on its end: the side of the building lies on the plate, the angled fascia, the leaning glazing and the visor rise straight up. It is a hollow shell, 3 mm thick, open underneath.',
    '- The end panel, the doors, the numbers and the railings lie flat.',
    '',
    'Putting it together',
    ...steps.map((s, i) => i + 1 + '. ' + s),
    '',
    'Paint the panes of the glazing dark before you put it together, or print the bays in two colours.',
  ].join('\n');
}

// The notes of a marshal post or a marshal shelter.
function marshalNotes(name, m, parts, sizes) {
  const L = marshalLevels(m);
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  const what = !L.raised ? 'A marshal shelter' : m.deckHeight >= 80 ? 'A tall marshal post' : 'A low marshal post';
  const walls = { slats: 'slatted', boards: 'boarded', plain: 'plain' }[m.walls];
  const steps = [
    ...(L.raised ? ['Push the cabin onto the pegs on top of the legs, each into its socket under the floor, with a drop of glue in each.'] : []),
    'Lay the roof on the corner posts, the pin on top of each post up through its hole, ' + (m.fall > 0 ? 'the low edge at the back' : 'level') + ', and glue it.',
    ...(L.ladder ? ['Glue the ladder with its foot on the base behind the cabin and its top against the floor in the opening of the back wall.'] : []),
    ...(m.numbers ? ['Glue the number disc in the middle of the front wall.'] : []),
    'Stand it beside the track, its front towards the road.',
  ];
  return [
    name + ' · SlotForge Foundry marshal post kit',
    '',
    what + ': a cabin ' + fmt(m.width) + ' × ' + fmt(m.depth) + ' mm with a ' + walls + ' wall ' + fmt(m.wallHeight) + ' mm high' + (L.raised ? ', its floor ' + fmt(m.deckHeight) + ' mm above the table' : ', on the ground') + '; about ' + fmt(Math.round(L.high)) + ' mm high to the top of the roof.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    '- The cabin prints the right way up, its floor on the plate; ' + (m.walls === 'slats' ? 'each gap between the slats closes in a point, so it prints.' : 'its walls rise straight up.'),
    ...(L.raised ? ['- The legs stand on their base plate.'] : []),
    '- The roof lies on its underside' + (m.roof === 'tin' ? ', its corrugations on top' : '') + (L.ladder ? '; the ladder' : '') + (m.numbers ? (L.ladder ? ' and' : ';') + ' the number disc' : '') + (L.ladder || m.numbers ? ' lie flat.' : '.'),
    '',
    'Putting it together',
    ...steps.map((s, i) => i + 1 + '. ' + s),
    '',
    'Paint the number before you glue the disc on, or print it in two colours.',
  ].join('\n');
}

// The notes of a viewing platform.
function platformNotes(name, p, parts, sizes) {
  const list = parts.map((q) => '- ' + q.name + (sizes[q.id] ? ': ' + sizes[q.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  const steps = [
    'Stand the four frames on a flat table, the front and the back outside the two ends, and glue the corners.',
    'Lay the deck on top, the tabs of the frames up into the pockets underneath: it holds them square. Glue it.',
    ...(p.stair !== 'none' ? [(p.stair === 'both' ? 'Glue a staircase against each end' : 'Glue the staircase against the ' + p.stair + ' end') + ', its landing level with the deck at the back, its post and its foot on the table.'] : []),
    ...(p.railing ? ['Push the railings into the pockets along the edges of the deck, the front and the back first, then the ends between them, and glue them.' + (p.stair === 'both' ? ' Both ends are open at the top of their staircases.' : p.stair !== 'none' ? ' The ' + p.stair + ' end is open at the top of the staircase.' : '')] : []),
    ...(p.board ? ['Glue the board on the front frame, under the deck, flush with its front edge, for a sign.'] : []),
    'Stand the platform beside the track, its front towards the road.',
  ];
  return [
    name + ' · SlotForge Foundry viewing platform kit',
    '',
    'A deck ' + fmt(p.width) + ' × ' + fmt(p.depth) + ' mm, ' + fmt(p.height) + ' mm above the table' + (p.stair === 'both' ? ', a staircase up each end' : p.stair !== 'none' ? ', a staircase up its ' + p.stair + ' end' : '') + '.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    '- The frames, the railings and the board lie flat; the deck prints the right way up, its planks on top.',
    ...(p.stair !== 'none' ? ['- ' + (p.stair === 'both' ? 'Each staircase' : 'The staircase') + ' lies on its outer wall, the steps rising straight up.'] : []),
    '',
    'Putting it together',
    ...steps.map((s, i) => i + 1 + '. ' + s),
    '',
    'Paint the frames before you put the deck on.',
  ].join('\n');
}
