import polygonClipping from 'polygon-clipping';
import { sectionStations } from './geometry/bridge-sections.js';
import { PEG_LIMITS, PEG_SIZE } from './geometry/bridge-supports.js';
import { TRACKSIDE_DEFAULTS } from './geometry/trackside.js';
import { hasSlotPosition, slotDistances, slotVaries } from './slot-position.js';
import { screwFamilyDifference } from './geometry/screw-clip.js';

export const newLayout = () => ({
  format: 'slotforge-layout',
  version: 1,
  name: 'Untitled layout',
  sources: {},
  nodes: [],
});
const pi = Math.PI;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const turn = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const endKey = (id, i) => id + ':' + i;
export function xyOf(pose, [x, y]) {
  if (pose.flip) y = -y;
  const c = Math.cos(pose.a),
    s = Math.sin(pose.a);
  return [pose.x + c * x - s * y, pose.y + s * x + c * y];
}
const dirOf = (pose, a) => pose.a + (pose.flip ? -a : a);
export function frameFor(node, def) {
  const s = def.sections[node.index];
  return s.ports.map((p, i) => ({
    ...p,
    id: node.id,
    i,
    key: endKey(node.id, i),
    xy: xyOf(node.pose, p.xy),
    angle: dirOf(node.pose, p.angle),
    edges: p.edges.map((q) => xyOf(node.pose, q)),
    slots: p.slots.map((q) => xyOf(node.pose, q)),
    slotAngles: p.slotAngles.map((a) => dirOf(node.pose, a)),
    flip: node.pose.flip,
    params: def.track.params,
    hardware:
      p.hardware?.map((g) => ({ ...g, xy: xyOf(node.pose, g.xy) })) ?? [],
    z: node.h[i % 2] + (p.baseZ ?? 0) + def.track.params.height,
  }));
}
export function jointMap(ends) {
  const buckets = new Map(),
    pairs = new Map();
  for (const e of ends) {
    const [x, y] = e.xy.map(Math.round);
    for (let i = -1; i <= 1 && !pairs.has(e.key); i++)
      for (let j = -1; j <= 1; j++) {
        const neighbor = (buckets.get([x + i, y + j].join()) || []).find(
          (f) =>
            !pairs.has(f.key) &&
            e.id !== f.id &&
            distance(e.xy, f.xy) < 0.05 &&
            Math.abs(turn(e.angle - f.angle - pi)) < 0.005 &&
            Math.abs(e.z - f.z) < 0.05 &&
            roadMatches(e, f) &&
            hardwareMatches(e, f),
        );
        if (neighbor) {
          pairs.set(e.key, neighbor);
          pairs.set(neighbor.key, e);
          break;
        }
      }
    const key = [x, y].join();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }
  return pairs;
}
export function endsOf(layout, defs) {
  const ends = layout.nodes.flatMap((n) => frameFor(n, defs.get(n.source))),
    joints = jointMap(ends);
  return { ends, joints, open: ends.filter((e) => !joints.has(e.key)) };
}
function uniquePoints(points) {
  return points.filter(
    (p, i) => !points.slice(0, i).some((q) => distance(p, q) < 0.18),
  );
}
// Slots that meet may be this far out of line, about one degree.
const SLOT_KINK = 0.02;
const near = (p, q) => distance(p, q) < 0.2;
const matched = (a, b) =>
  a.length === b.length && a.every((p) => b.some((q) => near(p, q)));
const edgesMatch = (a, b) => matched(a.edges, b.edges);
const slotsMeet = (a, b) =>
  matched(uniquePoints(a.slots), uniquePoints(b.slots));
// Slots that meet must also run on in the same direction: half of a piece
// whose slot moves sideways ends with the slot at an angle. Where lanes share
// a point (a pit lane leaving its main lane), one pair in line is enough.
const slotsInLine = (a, b) =>
  uniquePoints(a.slots).every((at) =>
    a.slots.some(
      (p, i) =>
        near(p, at) &&
        b.slots.some(
          (q, j) =>
            near(q, at) &&
            Math.abs(turn(a.slotAngles[i] - b.slotAngles[j] - pi)) < SLOT_KINK,
        ),
    ),
  );
const roadMatches = (a, b) =>
  edgesMatch(a, b) && slotsMeet(a, b) && slotsInLine(a, b);
const mateKind = { Tab: 'Socket', Socket: 'Tab', Clip: 'Clip' };
function hardwareMatches(target, incoming) {
  return (
    target.hardware.length === incoming.hardware.length &&
    target.hardware.every((g) =>
      incoming.hardware.some(
        (f) =>
          mateKind[g.kind] === f.kind &&
          g.family === f.family &&
          distance(g.xy, f.xy) < 0.2,
      ),
    )
  );
}
const mm = (v) => String(Number(v.toFixed(2)));
const listed = (values) =>
  values.length > 1
    ? values.slice(0, -1).map(mm).join(', ') + ' and ' + mm(values.at(-1))
    : mm(values[0]);
const slotCount = (values) =>
  values.length + (values.length === 1 ? ' slot' : ' slots');
// 'slot' for a single-lane piece, 'slots' for a piece with several.
const slotWord = (p) => (p.lanes > 1 ? 'slots' : 'slot');
// Where the slots of two touching ends lie, as someone driving through the
// joint sees them: mm from the left or right road edge, looking from end A to
// end B of the first piece. The edge is the one the off-centre slot was typed
// from, so the numbers read like the ones entered in Track Set.
function slotReading(target, incoming) {
  const travel = target.angle + (target.i % 2 ? 0 : pi),
    n = [-Math.sin(travel), Math.cos(travel)];
  const across = (q) =>
    (q[0] - target.xy[0]) * n[0] + (q[1] - target.xy[1]) * n[1];
  const maker = [target, incoming].find((e) => hasSlotPosition(e.params));
  // edges[1] is a piece's own outer (+offset) edge, wherever it lies as placed.
  const from =
    maker &&
    across(maker.edges[maker.params.slotPosition.edge === 'outer' ? 1 : 0]) < 0
      ? -1
      : 1;
  const read = (end) => {
    const edge = Math.max(...end.edges.map((q) => from * across(q)));
    return uniquePoints(end.slots)
      .map((q) => edge - from * across(q))
      .sort((x, y) => x - y);
  };
  return {
    side: from > 0 ? 'left' : 'right',
    here: read(target),
    next: read(incoming),
  };
}
// A corner placed as a left-hand turn is the mirrored print: its slots keep
// their distances from the outer or inner edge, which is now the other side
// of the road. Recognise that, so the message can say what to make instead:
// the same distances measured from the other edge, in either lane form.
function mirroredCorner(target, incoming) {
  for (const [corner, other, name] of [
    [incoming, target, 'This corner'],
    [target, incoming, 'The corner at this joint'],
  ]) {
    const p = corner.params;
    if (!corner.flip || p?.kind !== 'curve' || !hasSlotPosition(p)) continue;
    const [a, b] = corner.edges,
      across = uniquePoints(corner.slots).map(([x, y]) => [
        a[0] + b[0] - x,
        a[1] + b[1] - y,
      ]);
    if (!across.length || !matched(across, uniquePoints(other.slots))) continue;
    const { edge } = p.slotPosition,
      word = slotWord(p);
    return (
      name +
      ' is printed mirrored for a left-hand turn. Its ' +
      word +
      (word === 'slot' ? ' is' : ' are') +
      ' still ' +
      listed(slotDistances(p, 0)) +
      ' mm from its ' +
      edge +
      ' edge, but this turn puts that edge on the other side of the road. Make a corner with the ' +
      word +
      ' measured from the ' +
      (edge === 'outer' ? 'inner' : 'outer') +
      ' edge instead.'
    );
  }
  return '';
}
function slotText(target, incoming) {
  const lead = 'The guide slots do not line up at this joint';
  const { side, here, next } = slotReading(target, incoming);
  if (here.length !== next.length)
    return (
      lead +
      ': this piece has ' +
      slotCount(here) +
      ' and the next has ' +
      slotCount(next) +
      '.'
    );
  return (
    lead +
    ': the slot' +
    (here.length === 1 ? ' is ' : 's are ') +
    listed(here) +
    ' mm from the ' +
    side +
    ' edge on this piece and ' +
    listed(next) +
    ' mm on the next.'
  );
}
function edgeText(target, incoming) {
  const [here, next] = [target, incoming].map((e) =>
    distance(e.edges[0], e.edges.at(-1)),
  );
  return (
    'The road edges do not line up at this joint' +
    (Math.abs(here - next) < 0.2
      ? '.'
      : ': this piece is ' +
        mm(here) +
        ' mm wide and the next is ' +
        mm(next) +
        ' mm.') +
    ' Choose a matching piece or another open end.'
  );
}
// Why two ends that touch do not join, or null when they mate. The reason is
// 'edges', 'slots' (not in the same place), 'slot-angle' (in the same place
// but not in line), 'height' or 'connectors'. explained marks a text that
// already says what to do.
function mismatch(target, incoming) {
  const fault = (reason, text) => ({ reason, text });
  if (!edgesMatch(target, incoming))
    return fault('edges', edgeText(target, incoming));
  if (!slotsMeet(target, incoming)) {
    const corner = mirroredCorner(target, incoming);
    return corner
      ? {
          ...fault(
            'slots',
            'The guide slots do not line up at this joint. ' + corner,
          ),
          explained: true,
        }
      : fault('slots', slotText(target, incoming));
  }
  if (!slotsInLine(target, incoming)) {
    const moving = [target, incoming].find((e) => hasSlotPosition(e.params)) ?? target,
      word = slotWord(moving.params ?? {});
    return fault(
      'slot-angle',
      'The guide slots meet at an angle at this joint, so a guide would catch. A piece whose ' +
        word +
        (word === 'slot' ? ' moves' : ' move') +
        ' sideways only joins up with all of its own sections in place.',
    );
  }
  if (Math.abs(target.z - incoming.z) > 0.05)
    return fault('height', 'These road surfaces meet at different heights.');
  if (!hardwareMatches(target, incoming))
    return fault(
      'connectors',
      screwClipMismatch(target, incoming) ||
      mirroredRow(target, incoming) ||
        'The connector positions or clip families differ at this joint. Choose another end or match their settings in Track Set.',
    );
  return null;
}
// Kevan Sideclips that differ in a setting that shapes the clip or its holes.
function screwClipMismatch(target, incoming) {
  const family = (end) => end.hardware.find((g) => g.kind === 'Clip')?.family;
  const difference = screwFamilyDifference(family(target), family(incoming));
  return difference
    ? 'The Kevan Sideclips differ at this joint: ' + difference +
        '. Give both pieces the same Kevan Sideclip settings in Track Set.'
    : '';
}
// A piece placed mirrored carries its connectors mirrored too. Where the
// slots meet and only that mirror keeps the rows apart (an off-centre clip
// beside slots that sit symmetric about the centre), say so, and what helps.
function mirroredRow(target, incoming) {
  if (target.flip === incoming.flip) return '';
  if (![target, incoming].some((e) => hasSlotPosition(e.params))) return '';
  for (const [piece, other, name] of [
    [incoming, target, 'This '],
    [target, incoming, 'The '],
  ]) {
    if (!piece.flip) continue;
    const c = Math.cos(piece.angle),
      s = Math.sin(piece.angle);
    // Across the centre line of this end: the row as the unmirrored print has it.
    const across = piece.hardware.map((g) => {
      const x = g.xy[0] - piece.xy[0],
        y = g.xy[1] - piece.xy[1],
        along = x * c + y * s;
      return {
        ...g,
        xy: [piece.xy[0] + 2 * along * c - x, piece.xy[1] + 2 * along * s - y],
      };
    });
    if (!hardwareMatches(other, { ...piece, hardware: across })) continue;
    const kind = piece.params?.kind === 'curve' ? 'corner' : 'piece',
      clip = piece.hardware.some((g) => g.kind === 'Clip');
    return (
      'The connector positions differ at this joint. ' +
      name +
      kind +
      (name === 'The ' ? ' at this joint' : '') +
      ' is printed mirrored for a left-hand turn, which moves its off-centre ' +
      (clip ? 'clip' : 'connectors') +
      ' to the other side of the road. ' +
      (clip ? 'Use tab joints, or move' : 'Move') +
      ' one slot so that the slots are no longer symmetric about the road centre.'
    );
  }
  return '';
}
// advice (optional) adds what to do about slots that are in the wrong place.
function checkMate(target, incoming, advice) {
  const fault = mismatch(target, incoming);
  if (!fault) return;
  const more = fault.reason === 'slots' && !fault.explained ? advice?.() : '';
  throw Error(fault.text + (more ? ' ' + more : ''));
}
// Ends that touch squarely and still do not join, with the reason: the last
// joint of a loop whose slots are out of line, or a joint that came apart
// when a pack changed. a is the end travel leaves from, where that is known.
export function blockedJoints({ open }) {
  const buckets = new Map(),
    used = new Set(),
    found = [];
  for (const e of open) {
    const [x, y] = e.xy.map(Math.round);
    for (let i = -1; i <= 1 && !used.has(e.key); i++)
      for (let j = -1; j <= 1; j++) {
        const f = (buckets.get([x + i, y + j].join()) || []).find(
          (f) =>
            !used.has(f.key) &&
            e.id !== f.id &&
            distance(e.xy, f.xy) < 0.05 &&
            Math.abs(turn(e.angle - f.angle - pi)) < 0.005,
        );
        if (!f) continue;
        const [a, b] = f.i % 2 && !(e.i % 2) ? [f, e] : [e, f];
        const fault = mismatch(a, b);
        if (!fault) continue;
        used.add(e.key).add(f.key);
        found.push({ ...fault, a, b, xy: a.xy });
        break;
      }
    const key = [x, y].join();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }
  return found;
}
// Why an off-centre straight that does not fit may have been expected to.
function turnAdvice(target, def, node, far) {
  const p = def.track.params;
  if (p.kind !== 'straight' || !hasSlotPosition(p)) return '';
  const tabbed = def.sections.some((s) =>
    s.ports.some((port) => port.hardware?.some((g) => g.kind !== 'Clip')),
  );
  const farEnd = (pose) => frameFor({ ...node, pose }, def)[far.i];
  // Turned end for end, its far end would meet this joint instead.
  if (slotsMeet(target, farEnd(align(far, target, false))))
    return (
      'This piece would fit turned end for end, but ' +
      (tabbed
        ? 'it cannot be turned round with tab joints'
        : 'the planner builds every piece from end A to end B') +
      '. Make a second piece' +
      (slotVaries(p)
        ? ' for the way back, with the distances for end A and end B swapped and measured from the other edge.'
        : ' with the ' + slotWord(p) + ' measured from the other edge.')
    );
  // The slot it ends with is the one needed here: the piece for the way back.
  const end = farEnd(node.pose);
  const back = end.slots.map((q) => [
    q[0] - end.xy[0] + target.xy[0],
    q[1] - end.xy[1] + target.xy[1],
  ]);
  if (slotVaries(p) && matched(back, uniquePoints(target.slots)))
    return (
      'Turning this piece round does not bring the ' +
      slotWord(p) +
      ' back' +
      (tabbed ? ', and it cannot be turned round with tab joints' : '') +
      '. Make a second piece for the way back, with the distances for end A and end B swapped.'
    );
  return '';
}
const emptyPose = () => ({ x: 0, y: 0, a: 0, flip: false });
function align(port, target, flip) {
  const pose = { ...emptyPose(), flip };
  pose.a = target.angle + pi - dirOf(pose, port.angle);
  const q = xyOf(pose, port.xy);
  pose.x = target.xy[0] - q[0];
  pose.y = target.xy[1] - q[1];
  return pose;
}
export const SUPPORT_STYLES = Object.freeze([
  ['block', 'Full-width block'],
  ['pegs', 'Two pegs'],
]);
export const BARRIER_TYPES = [
  ['none', 'None'],
  ['barrier', 'Concrete barrier'],
  ['board', 'Advertising board'],
];
export const BARRIER_ENDS = [
  ['none', 'Plain ends'],
  ['start', 'Sloped at end A'],
  ['finish', 'Sloped at end B'],
  ['both', 'Sloped at both ends'],
];
export const BARRIER_END_SHAPES = [
  ['ramp', 'Sloped'],
  ['round', 'Sloped and rounded'],
];
// The barrier settings a layout can give one side of a section, with the
// piece settings they are kept in.
const BARRIER_FIELDS = {
  kind: 'tracksideShape',
  ends: 'tracksideEnds',
  shape: 'tracksideEndShape',
  rise: 'tracksideRise',
  angle: 'tracksideFaceAngle',
  fence: 'tracksideFence',
  fenceHeight: 'tracksideFenceHeight',
};
const readBarrier = (params, set) =>
  Object.fromEntries(
    Object.entries(BARRIER_FIELDS).map(([name, key]) => [
      name,
      params[key + set] ?? TRACKSIDE_DEFAULTS[key],
    ]),
  );
// A side without a barrier, however its other fields were left.
export const plainBarrier = (side) =>
  side.kind === 'none' ? { ...readBarrier({}, ''), kind: 'none' } : side;
// The barriers a placed section carries come from its piece recipe: one
// answer for the outside and one for the inside.
export function barrierOf(def) {
  const p = def.track.params,
    side = p.tracksideSide ?? 'none';
  const none = plainBarrier({ kind: 'none' });
  return {
    outer: side === 'outer' || side === 'both' ? readBarrier(p, '') : none,
    inner:
      side === 'inner'
        ? readBarrier(p, '')
        : side === 'both'
          ? readBarrier(p, p.tracksideInnerOwn ? 'Inner' : '')
          : none,
  };
}
// Write that answer back into a piece recipe.
export function applyBarriers(params, { outer, inner }) {
  const write = (side, set) => {
    for (const [name, key] of Object.entries(BARRIER_FIELDS)) params[key + set] = side[name];
  };
  const out = outer.kind !== 'none',
    ins = inner.kind !== 'none';
  params.tracksideSide = out && ins ? 'both' : out ? 'outer' : ins ? 'inner' : 'none';
  params.tracksideInnerOwn = out && ins;
  if (out) write(outer, '');
  else if (ins) write(inner, '');
  if (out && ins) write(inner, 'Inner');
}
export const supportStyleOf = (n) =>
  n.supportStyle === 'pegs' ? 'pegs' : 'block';
// A peg's size as [across the road, along the road].
export const pegSizeOf = (n) => n.peg ?? [...PEG_SIZE];
const validPeg = (peg) =>
  Array.isArray(peg) &&
  peg.length === 2 &&
  peg.every(
    (v) => Number.isFinite(v) && v >= PEG_LIMITS[0] && v <= PEG_LIMITS[1],
  );
// A new piece carries on from the one it joins: a straight keeps climbing or
// descending at the same rate, down to the table at most, and a lifted piece
// takes the same number of supports.
function continueClimb(layout, defs, target, nodes, def, incoming, exit) {
  const previous = layout.nodes.find((n) => n.id === target.id);
  if (!previous) return;
  const before = defs.get(previous.source),
    node = nodes[0],
    lift = node.h[incoming.i];
  if (
    nodes.length === 1 &&
    incoming.id === exit.id &&
    canRamp(previous, before) &&
    canRamp(node, def)
  ) {
    const rate = pitch(previous, before).slope * (target.i === 1 ? 1 : -1),
      [a, b] = def.sections[node.index].ports,
      end = Math.min(500, Math.max(0, lift + rate * distance(a.xy, b.xy))),
      h = [...node.h];
    h[exit.i] = Math.round(end * 100) / 100;
    const p = def.track.params;
    if (p.slotDepth * Math.hypot(1, pitch({ ...node, h }, def).slope) < p.height)
      node.h = h;
  }
  for (const n of nodes)
    if (Math.max(...n.h) > 0) {
      n.supports = previous.supports;
      n.supportStyle = supportStyleOf(previous);
      if (previous.peg) n.peg = [...previous.peg];
    }
}
export function placeSource(layout, defs, source, targetKey, hand = 'right') {
  const def = defs.get(source);
  const world = endsOf(layout, defs);
  const target =
    world.open.find((e) => e.key === targetKey) ??
    (!targetKey ? world.open.at(-1) : null);
  if (layout.nodes.length && !target)
    throw Error(
      'Choose an open end. A closed circuit needs an opening before adding track.',
    );
  if (layout.nodes.length + def.sections.length > 1500)
    throw Error('A layout can contain up to 1,500 sections.');
  const nodes = def.sections.map((_, index) => ({
    id: crypto.randomUUID(),
    source,
    index,
    pose: emptyPose(),
    h: [0, 0],
    supports: 0,
  }));
  const local = endsOf({ nodes }, defs);
  if (!local.open.length) {
    if (target) throw Error('This piece already forms a closed layout.');
    layout.nodes.push(...nodes);
    return { selected: nodes.at(-1).id, end: null };
  }
  // On a diamond the primary through-road is the unrotated X axis.
  const main =
    def.track.params.special?.type === 'diamond'
      ? local.open.filter((e) => Math.abs(Math.sin(e.angle)) < 0.0001)
      : local.open;
  const start = main.find((e) => e.i % 2 === 0) ?? main[0],
    finish = main.findLast((e) => e.i % 2 === 1) ?? main.at(-1);
  const backward = target && target.i % 2 === 0;
  const [incoming, exit] = backward ? [finish, start] : [start, finish];
  const directional =
    def.track.params.kind === 'curve' ||
    def.track.params.special?.type === 'chicane';
  const flip = directional && (backward ? hand === 'right' : hand === 'left');
  const pose = align(incoming, target ?? { xy: [0, 0], angle: 0 }, flip);
  const h = target ? target.z - incoming.z : 0;
  if (h < -0.01)
    throw Error('This road is thicker than the available height at the joint.');
  for (const node of nodes) {
    node.pose = { ...pose };
    node.h = [Math.max(0, h), Math.max(0, h)];
  }
  if (target) continueClimb(layout, defs, target, nodes, def, incoming, exit);
  if (target) {
    const nodeOf = (end) => nodes.find((n) => n.id === end.id);
    checkMate(target, frameFor(nodeOf(incoming), def)[incoming.i], () =>
      turnAdvice(target, def, nodeOf(exit), exit),
    );
  }
  layout.nodes.push(...nodes);
  return { selected: exit.id, end: exit.key };
}
export function removeSection(layout, defs, id) {
  const n = layout.nodes.find((n) => n.id === id);
  if (!n) throw Error('Select a section to remove.');
  const { joints } = endsOf(layout, defs);
  const neighbor = frameFor(n, defs.get(n.source))
    .map((e) => joints.get(e.key))
    .find(Boolean);
  layout.nodes = layout.nodes.filter((v) => v !== n);
  const next = neighbor ?? endsOf(layout, defs).open.at(-1);
  return { selected: next?.id, end: next?.key };
}
export function connectedRun(network, id) {
  const adjacency = new Map();
  for (const end of network.ends) {
    const mate = network.joints.get(end.key);
    if (!mate) continue;
    if (!adjacency.has(end.id)) adjacency.set(end.id, []);
    adjacency.get(end.id).push(mate.id);
  }
  const members = new Set(),
    pending = [id];
  while (pending.length) {
    const id = pending.pop();
    if (members.has(id)) continue;
    members.add(id);
    pending.push(...(adjacency.get(id) ?? []));
  }
  return members;
}
export function snapRun(layout, defs, from, to) {
  const network = endsOf(layout, defs);
  const a = network.open.find((e) => e.key === from),
    b = network.open.find((e) => e.key === to);
  if (!a || !b) throw Error('Choose two open ends to join.');
  const members = connectedRun(network, a.id);
  if (members.has(b.id))
    throw Error(
      'These ends already belong to the same run. Change its length or turns to close the loop.',
    );
  const motion = align(a, b, false);
  for (const n of layout.nodes.filter((n) => members.has(n.id))) {
    const [x, y] = xyOf(motion, [n.pose.x, n.pose.y]);
    n.pose = { ...n.pose, x, y, a: n.pose.a + motion.a };
  }
  const moved = layout.nodes.find((n) => n.id === a.id);
  checkMate(b, frameFor(moved, defs.get(moved.source))[a.i]);
  return { selected: a.id };
}
export function reverseSection(layout, defs, id) {
  const node = layout.nodes.find((n) => n.id === id),
    def = defs.get(node.source);
  const ports = frameFor(node, def),
    network = endsOf(layout, defs);
  if (
    ports.length !== 2 ||
    (def.track.params.kind !== 'curve' &&
      def.track.params.special?.type !== 'chicane')
  )
    throw Error('Select a corner or a chicane section to reverse.');
  const anchor = network.joints.has(ports[0].key) ? 0 : 1,
    exit = 1 - anchor;
  // Keep the entry fixed and move the connected continuation rigidly with the exit.
  const moving = new Set(),
    queue = [network.joints.get(ports[exit].key)?.id];
  while (queue.length) {
    const key = queue.pop();
    if (!key || moving.has(key)) continue;
    if (key === node.id)
      throw Error('Open the circuit before reversing a connected corner.');
    moving.add(key);
    for (const e of network.ends.filter((e) => e.id === key)) {
      const other = network.joints.get(e.key);
      if (other && other.key !== ports[exit].key) queue.push(other.id);
    }
  }
  const opposite = { xy: ports[anchor].xy, angle: ports[anchor].angle - pi };
  const pose = align(
    def.sections[node.index].ports[anchor],
    opposite,
    !node.pose.flip,
  );
  const updated = frameFor({ ...node, pose }, def);
  const mate = network.joints.get(ports[anchor].key);
  if (mate) checkMate(mate, updated[anchor]);
  const delta = updated[exit].angle - ports[exit].angle;
  const shift = { x: 0, y: 0, a: delta, flip: false },
    old = xyOf(shift, ports[exit].xy);
  shift.x = updated[exit].xy[0] - old[0];
  shift.y = updated[exit].xy[1] - old[1];
  node.pose = pose;
  for (const n of layout.nodes.filter((n) => moving.has(n.id))) {
    const [x, y] = xyOf(shift, [n.pose.x, n.pose.y]);
    n.pose = { ...n.pose, x, y, a: n.pose.a + delta };
  }
  const nextMate = network.joints.get(ports[exit].key);
  if (nextMate) {
    const next = layout.nodes.find((n) => n.id === nextMate.id);
    checkMate(frameFor(next, defs.get(next.source))[nextMate.i], updated[exit]);
  }
}
export function pitch(node, def) {
  const s = def.sections[node.index],
    [a, b] = s.ports,
    length = distance(a.xy, b.xy);
  const slope = (node.h[1] - node.h[0]) / (length || 1);
  return {
    origin: a.xy,
    direction: length
      ? [(b.xy[0] - a.xy[0]) / length, (b.xy[1] - a.xy[1]) / length]
      : [1, 0],
    slope,
    start: node.h[0],
  };
}
export function canRamp(node, def) {
  const s = def.sections[node.index],
    [a, b] = s.ports;
  if (
    s.ports.length !== 2 ||
    def.track.params.special ||
    def.track.plan?.flatCrossing
  )
    return false;
  const dx = b.xy[0] - a.xy[0],
    dy = b.xy[1] - a.xy[1],
    len = Math.hypot(dx, dy);
  return (
    len > 1 &&
    Math.abs(turn(b.angle - a.angle - pi)) < 0.001 &&
    s.sides.every((line) =>
      line.every(
        (q) =>
          Math.abs((q[0] - line[0][0]) * dy - (q[1] - line[0][1]) * dx) <
          0.02 * len,
      ),
    )
  );
}
export function setElevation(
  layout,
  defs,
  id,
  start,
  end,
  count,
  style,
  peg,
) {
  if (peg && !validPeg(peg))
    throw Error(
      'Enter a peg width and length from ' +
        PEG_LIMITS[0] +
        ' to ' +
        PEG_LIMITS[1] +
        ' mm.',
    );
  if (
    ![start, end].every((v) => Number.isFinite(v) && v >= 0 && v <= 500) ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > 32
  )
    throw Error(
      'Enter lifts from 0 to 500 mm and a support count from 0 to 32.',
    );
  const { joints } = endsOf(layout, defs),
    chosen = layout.nodes.find((n) => n.id === id);
  if (!chosen) throw Error('Select a section for the bridge.');
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n])),
    pending = new Map();
  const queue = [
    [chosen, 0, start],
    [chosen, 1, end],
  ];
  while (queue.length) {
    const [n, i, h] = queue.pop(),
      key = endKey(n.id, i),
      def = defs.get(n.source);
    if (pending.has(key)) {
      if (pending.get(key) !== h)
        throw Error(
          'Use equal lifts across a corner or crossing. Use a straight for the approach.',
        );
      continue;
    }
    pending.set(key, h);
    if (!canRamp(n, def))
      for (const [j] of def.sections[n.index].ports.entries())
        queue.push([n, j, h]);
    const mate = joints.get(key);
    if (mate) {
      const other = nodeById.get(mate.id),
        level =
          h +
          def.track.params.height -
          defs.get(other.source).track.params.height;
      if (level < 0)
        throw Error('The adjoining road would be below table level.');
      queue.push([other, mate.i, level]);
    }
  }
  for (const n of layout.nodes) {
    const h = n.h.map((v, i) => pending.get(endKey(n.id, i)) ?? v);
    const def = defs.get(n.source),
      p = def.track.params;
    if (p.slotDepth * Math.hypot(1, pitch({ ...n, h }, def).slope) >= p.height)
      throw Error(
        'The approach is too steep for the guide-slot floor. Lengthen the approach or lower the bridge.',
      );
    n.h = h;
    if (!Math.max(...h)) n.supports = 0;
  }
  chosen.supports = Math.max(start, end) > 0 ? count : 0;
  if (style) chosen.supportStyle = style === 'pegs' ? 'pegs' : 'block';
  if (peg) chosen.peg = [...peg];
}
export function sourcePartMap(def) {
  return (def.byPart ??= new Map(def.meshes.map((m) => [m.id, m])));
}
// A placed section's identity for caches: the recipe it was cut from (its
// sections array is shared by every copy of the piece entry) and its pose.
const recipeIds = new WeakMap();
let recipeSerial = 0;
export function placementKey(n, def) {
  if (!recipeIds.has(def.sections)) recipeIds.set(def.sections, ++recipeSerial);
  const p = n.pose;
  return recipeIds.get(def.sections) + ':' + n.index + ':' + p.x + ',' + p.y + ',' + p.a + ',' + p.flip + ':' + n.h.join(',');
}
export function surfaces(layout, defs) {
  return layout.nodes.map((n) => {
    const def = defs.get(n.source),
      s = def.sections[n.index];
    const polys = s.parts.flatMap((id) =>
      (sourcePartMap(def).get(id).outline || []).map((loop) =>
        loop.map((p) => xyOf(n.pose, p)),
      ),
    );
    const all = polys.flat();
    const bounds = all.reduce(
      ([l, b, r, t], [x, y]) => [
        Math.min(l, x),
        Math.min(b, y),
        Math.max(r, x),
        Math.max(t, y),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    return { n, def, polys, bounds, key: placementKey(n, def) };
  });
}
function heightAt(row, q) {
  const pose = pitch(row.n, row.def),
    a = xyOf(row.n.pose, pose.origin),
    angle = dirOf(row.n.pose, Math.atan2(pose.direction[1], pose.direction[0]));
  let z =
    pose.start +
    pose.slope *
      ((q[0] - a[0]) * Math.cos(angle) + (q[1] - a[1]) * Math.sin(angle));
  const base = row.def.sections[row.n.index].basePose;
  if (base) {
    const o = xyOf(row.n.pose, base.origin),
      d = dirOf(row.n.pose, Math.atan2(base.direction[1], base.direction[0]));
    z +=
      base.start +
      base.slope * ((q[0] - o[0]) * Math.cos(d) + (q[1] - o[1]) * Math.sin(d));
  }
  return z;
}
// memo (optional) keeps each pair's result between edits: a new piece only
// needs its own pairs worked out. It is refilled with the pairs still present.
export function crossings(rows, memo) {
  const hits = [],
    seen = memo && new Map();
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i],
        b = rows[j],
        u = a.bounds,
        v = b.bounds;
      if (
        u[0] >= v[2] - 0.025 ||
        u[2] <= v[0] + 0.025 ||
        u[1] >= v[3] - 0.025 ||
        u[3] <= v[1] + 0.025
      )
        continue;
      const pair = memo && a.key + '|' + b.key;
      if (memo?.has(pair)) {
        const known = memo.get(pair);
        seen.set(pair, known);
        if (known) hits.push({ ...known, a: a.n.id, b: b.n.id });
        continue;
      }
      const clip = polygonClipping.intersection(
        a.polys.map((p) => [p]),
        b.polys.map((p) => [p]),
      );
      const pts = clip
        .filter(
          ([ring]) =>
            Math.abs(
              ring
                .slice(1)
                .reduce(
                  (sum, q, k) => sum + ring[k][0] * q[1] - ring[k][1] * q[0],
                  0,
                ),
            ) > 2,
        )
        .flat(2);
      if (!pts.length) {
        seen?.set(pair, null);
        continue;
      }
      const gap = (upper, lower) =>
        Math.min(
          ...pts.map(
            (q) =>
              heightAt(upper, q) -
              heightAt(lower, q) -
              lower.def.track.params.height +
              upper.def.track.params.height *
                (1 - Math.hypot(1, pitch(upper.n, upper.def).slope)),
          ),
        );
      const hit = {
        a: a.n.id,
        b: b.n.id,
        clearance: Math.max(gap(a, b), gap(b, a)),
      };
      seen?.set(pair, hit);
      hits.push(hit);
    }
  if (memo) {
    memo.clear();
    for (const [k, v] of seen) memo.set(k, v);
  }
  return hits;
}
export function supportRequests(rows) {
  return rows
    .filter((r) => r.n.supports)
    .map((r) => {
      const n = r.n,
        sides = r.def.sections[n.index].sides.map((s) =>
          s.map((p) => xyOf(n.pose, p)),
        );
      return {
        node: n.id,
        count: n.supports,
        style: supportStyleOf(n),
        peg: pegSizeOf(n),
        start: n.h[0],
        end: n.h[1],
        sides,
        correction:
          r.def.track.params.height *
          (1 - Math.hypot(1, pitch(n, r.def).slope)),
        obstacles: rows
          .filter((s) => s !== r)
          .flatMap((s) => s.polys.map((poly) => [poly])),
      };
    });
}
export function tally(layout, defs) {
  const groups = new Map(),
    { joints } = endsOf(layout, defs);
  for (const n of layout.nodes) {
    const def = defs.get(n.source),
      pose = pitch(n, def);
    for (const id of def.sections[n.index].parts) {
      const end = def.sections[n.index].hardwareEnds[id];
      if (end !== undefined && !joints.has(endKey(n.id, end))) continue;
      const part = sourcePartMap(def).get(id);
      const loose = ['clip', 'retainer'].includes(part.role);
      const mirror = !loose && n.pose.flip,
        variant =
          !loose && pose.slope ? [pose.start, pose.slope].join('/') : '';
      const key = JSON.stringify([
        n.source,
        part.fabricationKey ?? id,
        mirror,
        variant,
      ]);
      if (!groups.has(key))
        groups.set(key, {
          source: n.source,
          id,
          mirror,
          pose,
          role: part.role,
          name: part.name,
          count: 0,
        });
      groups.get(key).count++;
    }
  }
  return [...groups.values()];
}
export function totalLength(layout, defs) {
  return layout.nodes.reduce(
    (sum, n) =>
      sum + sectionStations(defs.get(n.source).sections[n.index].sides).length,
    0,
  );
}
export function validateLayout(data) {
  if (
    data?.format !== 'slotforge-layout' ||
    data.version !== 1 ||
    typeof data.name !== 'string' ||
    data.name.length > 200 ||
    !data.sources ||
    Array.isArray(data.sources) ||
    typeof data.sources !== 'object' ||
    !Array.isArray(data.nodes) ||
    data.nodes.length > 1500 ||
    Object.keys(data.sources).length > 1500
  )
    throw Error('Choose a Foundry Track Planner file (.slotplan).');
  const ids = new Set();
  for (const [id, d] of Object.entries(data.sources))
    if (!/^s\d+$/.test(id) || typeof d?.name !== 'string' || !d.track?.params)
      throw Error('Invalid layout piece recipe.');
  for (const n of data.nodes) {
    if (
      !/^[\w-]{1,100}$/.test(n?.id) ||
      ids.has(n.id) ||
      !Object.hasOwn(data.sources, n.source) ||
      !Number.isSafeInteger(n.index) ||
      n.index < 0 ||
      typeof n.pose?.flip !== 'boolean' ||
      ![n.pose.x, n.pose.y, n.pose.a].every(
        (v) => Number.isFinite(v) && Math.abs(v) < 1e8,
      ) ||
      !Array.isArray(n.h) ||
      n.h.length !== 2 ||
      !n.h.every((v) => Number.isFinite(v) && v >= 0 && v <= 500) ||
      !Number.isInteger(n.supports) ||
      n.supports < 0 ||
      n.supports > 32 ||
      ![undefined, 'block', 'pegs'].includes(n.supportStyle) ||
      (n.peg !== undefined && !validPeg(n.peg))
    )
      throw Error('Invalid placed section in the layout file.');
    ids.add(n.id);
  }
  return data;
}
