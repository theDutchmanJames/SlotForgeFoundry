// The notes that come with a building kit: its parts, how they print and
// how they go together.
import { fmt } from './ui.js';
import { marshalLevels } from './geometry/marshal-post.js';
import { BILLBOARD } from './geometry/billboard.js';
import { tyreOpening } from './geometry/tyre-bridge.js';

/**
 * How the parts of a kit are printed and put together, for the kit's notes.
 * parts: the parts as exported (a part cut to fit the plate is in pieces);
 * sizes: each part's size as it lies on the plate, by its id.
 */
const andList = (items) => items.slice(0, -1).join(', ') + ' and ' + items.at(-1);

export function kitNotes(name, b, parts, sizes) {
  if (b.kind === 'sections') return [
    name + ' · SlotForge Foundry connected building kit',
    ...b.sections.map(s => s.name+' ('+s.id+'): '+s.width+' × '+s.depth+' mm, eaves '+s.height+' mm, '+s.roofType+' roof'+(s.roofType === 'flat' ? '' : ', pitch '+s.pitch+' degrees')+'. '+(s.parent ? 'Attached to '+s.parent+' '+s.side+', offset '+s.offset+' mm.' : 'Main section.')),
    'All sections share one base and floor level. Connections are open; no duplicate internal walls. Upper walls close steps between roofs.',
    'Parts are supplied in print orientation. Assemble numbered tiles flat using straight glue seams, then dry-fit wall feet into the base grooves and glue. Groove clearance: '+b.play+' mm per side.',
    'Roof panels print flat on their undersides. Join panels at their mitred ridges/hips at the specified pitch, then glue along the shaped wall tops. Eaves are trimmed at attached sections; roof junctions are stepped joins, not continuous valleys. There is no locating frame or flashing.',
    'Sections and wall directions are included in part names. Keep matching pieces together. Dry-fit each section and its roof before gluing; perform a printer fit trial before a complete kit.',
    '', 'Parts:', ...parts.map(p => '- '+p.name+(sizes[p.id] ? ': '+sizes[p.id].join(' × ')+' mm' : '')),
  ].join('\n');
  if (b.kind === 'footprint') return [
    name + ' · SlotForge Foundry shaped building kit',
    `${b.shape} footprint, ${b.width} × ${b.depth} mm; walls ${b.height} mm tall, ${b.wall} mm thick.`,
    'Print the base and roof flat, and the walls on their inside face with the outside face up. Parts are supplied in print orientation.',
    'Shaped panels larger than the selected plate are tiled with straight glue seams. Align matching numbered pieces on a flat surface and glue before assembly. These seams do not have interlocking keys.',
    'Assemble the base first. Dry-fit the walls in its groove in numbered perimeter order; mitres meet at both outside and recessed corners. Glue the wall seams and feet.',
    'Assemble the roof flat, then glue it along the wall tops, or leave it loose for access. This version has no locating frame under a shaped roof.',
    'Check fit on your printer before printing the complete kit. The groove clearance is ' + b.play + ' mm per side.',
    '', 'Parts:', ...parts.map(p => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].join(' × ') + ' mm' : '')),
  ].join('\n');
  if (b.kind === 'grandstand') return standNotes(name, b, parts, sizes);
  if (b.kind === 'gantry') return gantryNotes(name, b, parts, sizes);
  if (b.kind === 'pitmodule') return pitNotes(name, b, parts, sizes);
  if (b.kind === 'marshalpost') return marshalNotes(name, b, parts, sizes);
  if (b.kind === 'flagpost') return flagNotes(name, b, parts, sizes);
  if (b.kind === 'billboard') return billboardNotes(name, b, parts, sizes);
  if (b.kind === 'switchback') return switchbackNotes(name, b, parts, sizes);
  if (b.kind === 'bench') return benchNotes(name, b, parts, sizes);
  if (b.kind === 'tyrebridge') return tyreNotes(name, b, parts, sizes);
  if (b.kind === 'picnic') return picnicNotes(name, b, parts, sizes);
  if (b.kind === 'platform') return platformNotes(name, b, parts, sizes);
  if (b.kind === 'walkway') return walkwayNotes(name, b, parts, sizes);
  if (b.kind === 'pitbays') return pitBaysNotes(name, b, parts, sizes);
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
  const stand = {
    legs: 'Stand the four legs on the table and lay the base on them, each pin up into its pocket under the base, with a drop of glue.',
    column: 'Stand the column on the table and lay the base on it, its pin up into the pocket under the middle of the base, with a drop of glue.',
    tower: 'Stand the four tower frames in the slots of the tower foot, the front and the back outside the ends, and glue the corners. Lay the base on top, the tabs of the frames up into the pockets under it.',
    frames: 'Stand the four frames in the slots of the foot frame, the front and the back outside the ends, and glue the corners. Lay the base on top, the tabs of the frames up into the pockets under it.',
  }[b.standType];
  const steps = [
    ...(cut
      ? ['Join the pieces of each cut part first (they are numbered, 1 of 2 and so on): lay them flat, push each tab into its socket or each brick into its step, glue, and let them set flat.']
      : []),
    ...(b.lane
      ? ['Stand the base over the end of its pit bay: the track runs in through the open front, its end stop inside, with the base beside it as high as the road.']
      : []),
    ...(stand ? [stand] : []),
    ...(b.access === 'ladder' ? ['Stand the ladder with its foot on the table and its top against ' + { base: 'the edge of the base', roof: 'the edge of the roof', 2: 'the floor of storey 2', 3: 'the floor of storey 3', 4: 'the floor of storey 4' }[b.accessTo] + ', on the ' + b.accessWall + ' wall, and glue it there.'] : []),
    ...(b.access === 'stairs' ? ['Stand the staircase on the table against the ' + b.accessWall + ' wall, its landing level with ' + { base: 'the top of the base', roof: 'the roof', 2: 'the floor of storey 2', 3: 'the floor of storey 3', 4: 'the floor of storey 4' }[b.accessTo] + ', its own wall on the outside, and glue it.'] : []),
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
    ...(parts.some((p) => /^step-/.test(p.id))
      ? ['Glue each step against the side of the base, in front of its door, its foot on the table.']
      : []),
    ...(framed2 ? ['Push the roof frame' + (sloped && ['gable', 'hip'].includes(b.roof) ? 's' : '') + ' onto the underside of the roof, each tab into its pocket, with a drop of glue.'] : []),
    sloped
      ? b.roof === 'hip'
        ? 'Lay the four roof panels on the walls so they meet along the hips' + (framed2 ? ', their frames inside the walls' : '') + ', and glue them along the tops of the walls and to each other.'
        : b.roof === 'gable'
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
  const framed = g.build === 'frames';
  const benches = parts.some((p) => /^bench-/.test(p.id))
    ? ['Put each wooden bench together: stand its two ends up, lay the seat on them, its cleats down just inside the ends' + (parts.some((p) => /^bench-.*-back$/.test(p.id)) ? ', and stand the back on the seat against the back legs' : '') + '. Glue each on its row, at the back, clear of the step up behind it, as the parts list numbers them by row.']
    : [];
  const steps = framed
    ? [
        ...(parts.filter((p) => /^base-/.test(p.id)).length > 1 ? ['Glue the pieces of the base board end to end on a flat table, and the pieces of each deck and frame the same way.'] : []),
        'Stand the frames of each row on the base board: one along its front and one along its back, one across each end between them; the first row at the front, each next row behind it.',
        'Lay each deck on its frames, its planks along the row.',
        ...(parts.some((p) => /^steps-/.test(p.id)) ? ['Glue the steps on each deck at an aisle, against the front of the deck above.'] : []),
        ...benches,
        'Stand it beside the track, its first row towards it.',
      ]
    : [
    ...(sections > 1
      ? ['Join the sections end to end in their order, 1 of ' + sections + ' first: push the two tabs at the end of each into the slots of the next, with a drop of glue, and let them set on a flat table.']
      : []),
    ...(parts.some((p) => /^frame/.test(p.id))
      ? [
          'Stand the frames: glue a front and a back frame for each section along the table, as far apart as the stand is deep, and the cross frames between them, at each end and at each joint between two sections.',
          'Lower the grandstand onto the frames, the top of each cross frame up into the hollow under the rows, its parapet over the front frames, towards the track.',
        ]
      : ['Stand the grandstand on the table, its parapet towards the track.']),
    ...(parts.some((p) => /^stair/.test(p.id)) ? ['Glue each staircase against its end of the stand, its top step level with the last row, its wall on the outside.'] : []),
    ...(parts.some((p) => /^rail-back/.test(p.id)) ? ['Glue the back railings on the back of the back wall, their solid band down against it, one for each section, end to end.'] : []),
    ...benches,
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
    framed
      ? '- The base board and the decks lie flat, their planks up; the frames lie flat; the steps on their side.'
      : '- Each section stands on its end: the stepped side lies on the plate and the rows rise straight up. It is a hollow shell, 3 mm thick.',
    ...(parts.some((p) => /^bench-/.test(p.id)) ? ['- Each bench seat prints upside down, its planks on the plate; each back face down; the bench ends flat.'] : []),
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
    ...(cut ? ['Join the pieces of the ' + (bridge ? 'walkway' : g.sign ? 'sign' : 'beam') + ' first: glue them end to end' + (g.sign ? ', standing on a flat table.' : ': push each tab into its socket, glue, and let it set flat.')] : []),
    ...(bridge
      ? [
          'Stand a staircase on each side of the track, ' + fmt(g.span) + ' mm apart, their landings towards it.',
          'Lay the walkway across, each end on a landing, and glue it there.',
        ]
      : [
          'Stand the leg' + (g.type === 'half' ? ' beside the track.' : 's on each side of the track, ' + fmt(g.span) + ' mm apart inside.'),
          g.sign
            ? 'Glue the box sign on top of the leg, reaching out over the road' + (g.members === 'solid' ? ', the socket under it over the pin on top of the leg.' : '.')
            : 'Drop the beam on' + (g.type === 'half' ? ': the socket at its end goes over the pin on top of the leg, and the beam reaches out over the road.' : ': the sockets at its ends go over the pins on top of the legs.') + ' Glue it.',
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
      : g.sign
        ? ['- The leg stands on its foot; the box sign stands on its bottom edge, the tops of its panels sloping so they print.']
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
// The notes of picnic tables: a top, two seats and two ends each.
function picnicNotes(name, p, parts, sizes) {
  const list = parts.map((q) => '- ' + q.name + (sizes[q.id] ? ': ' + sizes[q.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  return [
    name + ' · SlotForge Foundry picnic table kit',
    '',
    (p.count === 1 ? 'A picnic table ' : p.count + ' picnic tables, each ') + fmt(p.length) + ' mm long: a top and a seat each side of planks, on two A-frame ends.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    '- The top and the seats print upside down, their planks on the plate and the cleats up; the ends lie flat.',
    '',
    'Putting it together',
    '1. Stand the two ends up and lay the seats on the low bearers, their cleats down just inside the ends, the planks reaching past them.',
    '2. Lay the top on the high bearers the same way and glue it all.',
    '3. Stand it beside the track.',
  ].join('\n');
}

// The notes of a tyre bridge: two sidewalls and the stairs, each in halves, and the stair walls.
function tyreNotes(name, t, parts, sizes) {
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  const o = tyreOpening(t);
  const walls = parts.some((p) => /^wall-/.test(p.id));
  const steps = [
    'Join the two halves of each sidewall and of the stairs at the middle: push the dovetail into its slot, with a drop of glue, flat on the table.',
    'Glue the stairs to the inside of one sidewall, its steps level with the table at both ends, then the other sidewall to them.',
    ...(walls ? ['Glue a stair wall each side of the lowest steps at each end, outside the tyre.'] : []),
    ...(t.canopy ? ['Glue a lattice frame on the rim of each sidewall over the top, and the lattice roof across them.'] : []),
    'Stand it over the track, the road running under the arch.',
  ];
  return [
    name + ' · SlotForge Foundry tyre bridge kit',
    '',
    'A bridge like half a tyre, ' + fmt(t.span) + ' mm across and ' + fmt(t.height) + ' mm high, ' + fmt(t.width) + ' mm wide along the track; under it ' + fmt(Math.round(o.width)) + ' mm clear at the table and ' + fmt(Math.round(o.height)) + ' mm high in the middle.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    '- The sidewalls print flat, their tread and band up; the stairs on their side' + (walls ? '; the stair walls flat' : '') + (t.canopy ? '; the lattice frames and roof flat.' : '.'),
    '',
    'Putting it together',
    ...steps.map((x, i) => i + 1 + '. ' + x),
    '',
    'Paint the tyre black, the band in a colour of your own.',
  ].join('\n');
}

// The notes of benches: a seat and two end frames each.
function benchNotes(name, b, parts, sizes) {
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  return [
    name + ' · SlotForge Foundry benches kit',
    '',
    (b.count === 1 ? 'A bench ' : b.count + ' benches, each ') + fmt(b.length) + ' mm long, the seat ' + fmt(b.seatHeight) + ' mm up' + (b.backrest ? ', with a back.' : '.'),
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    ...(b.style === 'planks'
      ? ['- Each seat prints upside down, its planks on the plate and the cleats up' + (b.backrest ? '; each back face down, its cleats up' : '') + '; the end frames lie flat.']
      : ['- ' + (b.backrest ? 'Each seat and back prints lying on the back, the seat standing up' : 'Each seat prints flat') + '; the end frames lie flat.']),
    '',
    'Putting it together',
    ...(b.style === 'planks'
      ? [
          '1. Stand two end frames up and lay a seat on their bearers, its cleats down just inside them, the planks reaching past them at both ends.',
          ...(b.backrest ? ['2. Stand the back on the seat against the back legs, its cleats behind, and glue it.'] : []),
        ]
      : ['1. Glue an end frame against each end of a seat, its legs down, the seat on its bearer' + (b.backrest ? ' and the back against the back leg.' : '.')]),
    (b.style === 'planks' && b.backrest ? '3' : '2') + '. Stand the benches in a row beside the track, ' + fmt(b.gap) + ' mm apart, the seats facing the road.',
  ].join('\n');
}

// The notes of switchback stairs: two flights, two landings, their railings.
function switchbackNotes(name, s, parts, sizes) {
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  return [
    name + ' · SlotForge Foundry switchback stairs kit',
    '',
    'Two flights up to a landing ' + fmt(s.height) + ' mm above the table, ' + fmt(s.width) + ' mm wide, a landing on posts between them; railings of ' + s.railingStyle + ' ' + fmt(s.railHeight) + ' mm high.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    '- Each flight prints on its side; the landings print upside down, their posts up; the railings lie flat.',
    '',
    'Putting it together',
    '1. Push the railings into the slots of the landings, their tabs down, with a drop of glue: on each, one across its free end and one along its open side.',
    '2. Stand the lower flight against the back of the building, its railing wall away from it, and the middle landing on its posts at its top, the end of the flight against the landing.',
    '3. Glue the upper flight against the building, its foot against the middle landing, and the top landing on its posts at its top, against the building at the door.',
  ].join('\n');
}

// The notes of a billboard or a hoarding: its board pieces and the struts behind its posts.
function billboardNotes(name, b, parts, sizes) {
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  const pieces = parts.filter((p) => /^board/.test(p.id)).length;
  return [
    name + ' · SlotForge Foundry ' + (b.style === 'board' ? 'billboard' : 'hoarding') + ' kit',
    '',
    (b.style === 'board' ? 'A billboard on two posts, ' : 'A hoarding on a post every ' + fmt(BILLBOARD.pitch) + ' mm at most, ') + fmt(b.length) + ' mm long; the board ' + fmt(b.height) + ' mm high, ' + fmt(b.clearance) + ' mm above the table.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    '- Each board prints on its back, the face up' + (b.border ? ', its border raised round it' : '') + '; the struts lie flat.',
    '',
    'Putting it together',
    ...[
      ...(pieces > 1 ? ['Lay the boards face down in their order, 1 of ' + pieces + ' first, and glue each against the post at the start of the next.'] : []),
      'Stand the board up and glue a strut behind each post, its foot on the table and its upright against the post.',
      'Stand it beside the track, its face towards the road.',
    ].map((s, i) => i + 1 + '. ' + s),
    '',
    'Paint the face, or glue a printed poster on it.',
  ].join('\n');
}

// The notes of a flag waver's post: the steps, their cheeks and the front rail.
function flagNotes(name, f, parts, sizes) {
  const list = parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  return [
    name + " · SlotForge Foundry flag waver's post kit",
    '',
    f.steps + ' steps up to a landing ' + fmt(f.height) + ' mm above the table, ' + fmt(f.width) + ' mm wide, a handrail ' + fmt(f.railHeight) + ' mm high each side' + (f.board ? ' and a board on the front rail.' : '.'),
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    '- The steps print on their side, their profile on the plate; the cheeks and the front lie flat.',
    '',
    'Putting it together',
    '1. Glue a cheek against each side of the steps, its foot on the table, the handrail over the steps.',
    '2. Glue the front against the front of the landing, between the cheeks, its band down and the rail level with the handrails.',
    '3. Stand it beside the track, the front rail towards the road.',
  ].join('\n');
}

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

// The notes of a walkway between two buildings.
function walkwayNotes(name, w, parts, sizes) {
  const list = parts.map((q) => '- ' + q.name + (sizes[q.id] ? ': ' + sizes[q.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  const steps = [
    ...(w.towers ? ['Build each tower as a building: stand its walls in the groove of its base, the doorway facing the walkway, and lay its roof on.', 'Stand the two towers ' + fmt(w.length) + ' mm apart, their doorways facing each other.'] : []),
    ...(w.towers ? ['Lay the deck between the towers, in their doorways, level with their sills, and glue it.'] : w.legs ? ['Stand the legs on the table, two at each end, and lay the deck on them, each pin up into its pocket under the deck.'] : ['Lay the deck between the two buildings, level with the floors it joins, and glue its ends to them.']),
    'Stand the two sides in the grooves along the deck, the windows up from the deck, and glue them.',
    'Lay the roof on top, its two rails just inside the sides, and glue it.',
    ...(w.towers ? [] : ['Push the walkway up to the buildings it joins: its open ends meet their walls. Cut a door in each wall to walk through, or leave them closed.']),
  ];
  return [
    name + ' · SlotForge Foundry walkway kit',
    '',
    'A covered walkway ' + fmt(w.length) + ' mm long and ' + fmt(w.width) + ' mm wide, its deck ' + fmt(w.clearance) + ' mm above the table, ' + w.panes + ' windows along each side.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    '- The deck prints the right way up, its grooves on top; the roof upside down, its rails up; the sides flat, outside up; the legs stand on their feet.',
    '',
    'Putting it together',
    ...steps.map((s, i) => i + 1 + '. ' + s),
  ].join('\n');
}

// The notes of a pit building of mixed bays.
function pitBaysNotes(name, m, parts, sizes) {
  const list = parts.map((q) => '- ' + q.name + (sizes[q.id] ? ': ' + sizes[q.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');
  const kinds = { single: 'single storey', box: 'corporate box', podium: 'podium' };
  const door = m.door === 'panel' ? 'up-and-over door' : 'roller door';
  const steps = [
    ...(m.types.length > 1 ? ['Join the bays end to end in their order, bay 1 first: push the tabs at the end of each into the slots of the next, with a drop of glue, and let them set on a flat table. The closed side at the start of each bay is the wall between two garages, and the fin of a frame.'] : []),
    'Glue the end panel on the open end of the last bay.',
    'Glue ' + (m.door === 'panel' ? 'an ' : 'a ') + door + ' into each doorway, against the back of its reveal, standing on the floor.',
    ...(m.numbers ? ['Glue the bay numbers on the front wall over the doors, ' + m.firstNumber + ' at bay 1.'] : []),
    ...(m.types.includes('podium') ? ['Glue each podium on its platform, the highest step in the middle.'] : []),
    ...(m.balconyRailing || m.roofRailing ? ['Push the railings into their pockets along the balconies and round the roofs, their tabs down, and glue them.'] : []),
    'Stand the building beside the pit lane, the doors towards it.',
  ];
  return [
    name + ' · SlotForge Foundry pit building kit',
    '',
    m.types.length + (m.types.length === 1 ? ' bay, ' : ' bays, each ') + fmt(m.bayWidth) + ' mm wide, ' + fmt(m.depth) + ' mm deep: ' + m.types.map((t, i) => i + 1 + ' ' + kinds[t]).join(', ') + '.',
    '',
    'Parts, as they lie on the plate:',
    list,
    '',
    'Printing',
    '- Every part prints without supports.',
    '- Each bay stands on its end, the side of the building on the plate: the fins, the roof reaching out and the balcony rise straight up.',
    '- The end panel, the doors, the numbers and the railings lie flat; a podium stands on its foot.',
    '',
    'Putting it together',
    ...steps.map((s, i) => i + 1 + '. ' + s),
  ].join('\n');
}
