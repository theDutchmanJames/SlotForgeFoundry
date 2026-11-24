import { braidRecess, braidSpan, SolidWorkshop } from './geometry/solids.js';
import { lineGrooves } from './geometry/paint-guides.js';
import {
  specialAssemblyNotes,
  specialPreview,
  specialPieceName,
} from './special-pieces.js';
import { racingPath } from './special-racing.js';
import {
  diamondLayout,
  pitLayout,
  pointOnAxis,
} from './geometry/special-junction-layout.js';
import { pitActuatorSpec } from './geometry/pit-turnout.js';
import { pitMotorSettings } from './geometry/pit-motor-settings.js';
import { turnoutLayout, turnoutSettings } from './geometry/turnout-layout.js';
import { buildTrack } from './track.js';

// A test coupon uses the crossing from the actual generated mesh, including its guide,
// insulating lands and braid feeds. The crop encloses all terminals of one intersection.
export function crossingCoupon(wasm, params) {
  const p = {
    ...params,
    segments: 1,
    borderSegments: 1,
    borderSide: 'none',
    hollow: false,
    joint: 'none',
    jointStart: 'none',
    jointEnd: 'none',
    borderMount: 'none',
    borderJoint: 'none',
    kerbEdge: 'none',
    roadKerbSide: 'none',
    roadCentreLine: 'none',
    whiteLineRoad: 'none',
    whiteLineBorder: 'none',
    braidFeedSide: 'none',
  };
  const pieces = buildTrack(wasm, p);
  const work = new SolidWorkshop(wasm);
  try {
    let ends;
    if (p.special?.type === 'hairpin') {
      const path = racingPath(p);
      ends = path.measuredLanes.flatMap((lane, i) =>
        path.sites[i][0].map((t) => lane.at(t)),
      );
    } else if (p.special?.type === 'diamond') {
      const model = diamondLayout(p),
        { x, y } = model.breaks[0];
      ends = model.roads.flatMap(({ axis }) =>
        [-1, 1].map((sign) => [
          x + sign * model.gap * axis[0],
          y + sign * model.gap * axis[1],
        ]),
      );
    } else
      throw Error(
        'Choose a crossover hairpin or flat diamond to print a crossing test.',
      );
    const margin =
      8 + p.slotWidth / 2 + braidSpan(p) + p.braidFeedLength;
    const limits = [0, 1].map((i) => [
      Math.min(...ends.map((pt) => pt[i])) - margin,
      Math.max(...ends.map((pt) => pt[i])) + margin,
    ]);
    const [[x0, x1], [y0, y1]] = limits;
    const region = work.prism(
      work.section([
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ],
      ]),
      -1,
      p.height + 1,
    );
    const roads = pieces
      .filter((part) => part.role === 'road')
      .map((part) => part.solid);
    const coupon = work.and(work.union(roads), region);
    if (coupon.isEmpty() || coupon.status() !== 'NoError')
      throw Error(
        'The crossing test could not be formed with these dimensions.',
      );
    work.handles.delete(coupon);
    return coupon;
  } finally {
    work.close();
    pieces.forEach((part) => part.solid.delete());
  }
}

export function wiringDiagram(p) {
  const { outlines, lanes, details, conductors, jumpers, pitWhiteLines, pitGrid, turnouts } = specialPreview(p);
  const name = specialPieceName(p.special.type);
  // A turnout cuts and feeds its inside braids the way a pit lane does.
  const forked = ['pit', 'turnout'].includes(p.special.type);
  const maxLanes = p.lanes,
    type = p.special.type;
  const note =
    type === 'diamond'
      ? 'P and Q are independent through-roads. Trace each lane to its opposite port.'
      : type === 'pit'
        ? 'Each pit branches from and returns to its own controller lane.'
        : type === 'turnout'
          ? 'Both routes belong to the same controller lane. The braids between the slots are fed from below.'
          : 'Trace each printed slot from its marked start to the far end.';
  const coordinates = outlines.flat(),
    columns = coordinates.map((q) => q[0]),
    rows = coordinates.map((q) => -q[1]);
  const xmin = Math.min(...columns),
    ymin = Math.min(...rows),
    dx = Math.max(...columns) - xmin,
    dy = Math.max(...rows) - ymin;
  const right = 660,
    height = 385,
    scale = Math.min((right - 60) / dx, (height - 64) / dy);
  const xy = ([x, y]) => [
    (right - dx * scale) / 2 + (x - xmin) * scale,
    70 + (height - dy * scale) / 2 + (-y - ymin) * scale,
  ];
  const points = (path) =>
    path
      .map((q) =>
        xy(q)
          .map((n) => n.toFixed(2))
          .join(','),
      )
      .join(' ');
  const routeName = (i) => {
    if (type === 'diamond')
      return (i < maxLanes ? 'P' : 'Q') + ((i % maxLanes) + 1);
    if (type === 'pit' && i >= maxLanes) {
      const left =
        p.special.side === 'left' ||
        (p.special.side === 'both' && i === maxLanes);
      return (left ? maxLanes : 1) + ' pit';
    }
    if (type === 'turnout') return i ? 'Branch' : '1';
    return String(i + 1);
  };
  const header = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 521" font-family="sans-serif">',
    '<rect width="700" height="521" fill="white"/>',
    '<text x="20" y="29" font-size="21" font-weight="bold">' +
      name +
      ' · conductor map</text>',
    '<text x="20" y="53" font-size="13">Top view · numbered starts · L and R follow the direction of each route</text>',
  ];
  for (const loop of outlines)
    header.push(
      '<polygon fill="#edf1f2" stroke="#7b8589" points="' +
        points(loop) +
        '"/>',
    );
  for (const stripe of pitWhiteLines ?? [])
    header.push('<polygon fill="white" stroke="#a4a9a9" stroke-width="0.35" points="' +
      points(stripe) + '"><title>Pit divider stripe</title></polygon>');
  for (const mark of pitGrid?.paint ?? [])
    header.push('<polygon fill="white" stroke="#a4a9a9" stroke-width="0.35" points="' +
      points(mark) + '"><title>Pit grid marker</title></polygon>');
  const railColour = { L: '#076474', R: '#ad511d' };
  const railLine = (side, path, title, underneath = false) => {
    const style = underneath
      ? 'stroke-width="1.3" stroke-dasharray="3 2"'
      : 'stroke-width="2"';
    header.push(
      `<polyline fill="none" stroke="${railColour[side]}" ${style} points="${points(path)}"><title>${title}</title></polyline>`,
    );
  };
  if (type === 'diamond' && p.braidWidth > 0) {
    const { roads, gap } = diamondLayout(p);
    const offset = p.slotWidth / 2 + p.braidGap + p.braidWidth / 2;
    const reach = gap + Math.max(1.2, 2 * braidRecess(p) + 0.2) / 2;
    for (const [i, road] of roads.entries())
      for (const [j, lane] of road.laneData.entries())
        for (const sign of [-1, 1]) {
          const side = sign === 1 ? 'L' : 'R';
          const id = routeName(i * p.lanes + j) + ' · ' + side;
          const at = (x) => pointOnAxis(road.axis, x, lane.d + sign * offset);
          let start = -p.length / 2;
          for (const x of lane.crossings) {
            railLine(side, [at(start), at(x - gap)], id);
            railLine(
              side,
              [at(x - reach), at(x + reach)],
              'Underside jumper · ' + id,
              true,
            );
            start = x + gap;
          }
          railLine(side, [at(start), at(p.length / 2)], id);
        }
  }
  if (type === 'hairpin' && p.braidWidth > 0) {
    const path = racingPath(p);
    const offset = p.slotWidth / 2 + p.braidGap + p.braidWidth / 2;
    for (const [index, lane] of path.measuredLanes.entries()) {
      const insulators = path.sites[index];
      const ends = [0, ...insulators.flat(), 1];
      for (const sign of [-1, 1]) {
        const rail = sign === 1 ? 'L' : 'R';
        const id = 'Lane ' + (index + 1) + ' · ' + rail;
        const trace = (a, b) =>
          [a, ...lane.ts.filter((t) => a < t && t < b), b].map((t) =>
            lane.atOffset(t, sign * offset),
          );
        for (let i = 0; i < ends.length - 1; i += 2)
          railLine(rail, trace(ends[i], ends[i + 1]), id);
        for (const [a, b] of insulators) {
          const halfFeed = p.braidFeedLength / (2 * lane.total);
          railLine(
            rail,
            trace(a - halfFeed, b + halfFeed),
            'Underside jumper · ' + id,
            true,
          );
        }
      }
    }
  }
  if (forked) {
    for (const rail of conductors)
      header.push(
        '<polygon fill="' +
          railColour[rail.side] +
          '" points="' +
          points(rail.polygon) +
          '"><title>Lane ' +
          rail.driver +
          ' · ' +
          rail.side +
          ' · ' +
          rail.route +
          '</title></polygon>',
      );
    for (const { from, to, driver, side, openings } of jumpers) {
      railLine(
        side,
        [from, to],
        'Underside feed · Lane ' + driver + ' · ' + side,
        true,
      );
      for (const [i, opening] of openings.entries()) {
        const rail = 'Lane ' + driver + ' · ' + side;
        if (opening.kind === 'slot') {
          header.push(`<polygon points="${points(opening.outline)}" fill="white" stroke="${railColour[side]}" stroke-width="0.7"><title>Braid pass-through · ${rail}</title></polygon>`);
        } else {
          const [x, y] = xy(i === 0 ? from : to);
          header.push(`<circle cx="${x}" cy="${y}" r="1.7" fill="white" stroke="${railColour[side]}"><title>Solder access below braid · ${rail}</title></circle>`);
        }
      }
    }
  }
  const colours = ['#075c70', '#9e4615', '#713e93', '#305986'];
  for (const [i, route] of lanes.entries()) {
    const [x, y] = xy(route[0]),
      [x2, y2] = xy(route.at(-1)),
      id = routeName(i),
      ink = colours[i % colours.length];
    const label = (X, Y) =>
      '<text x="' +
      X +
      '" y="' +
      (Y - 5) +
      '" text-anchor="middle" paint-order="stroke" stroke="white" stroke-width="3" fill="' +
      ink +
      '" font-weight="bold" font-size="11">' +
      id +
      '</text>';
    header.push(
      '<polyline fill="none" stroke="' +
        ink +
        '" stroke-width="1.8" points="' +
        points(route) +
        '"/>',
      '<circle cx="' + x + '" cy="' + y + '" r="3" fill="' + ink + '"/>',
      label(x, y),
      label(x2, y2),
    );
  }
  const guideDetails =
    type === 'diamond'
      ? []
      : type === 'pit'
        ? details.slice(0, p.special.side === 'both' ? 2 : 1)
        : type === 'turnout'
          ? details.slice(0, turnouts?.length ?? 0)
          : details;
  for (const path of guideDetails)
    header.push(
      '<polyline fill="none" stroke="#47575e" stroke-width="1" points="' +
        points(path) +
        '"/>',
    );
  const pitLegend = forked
    ? '<text x="20" y="514" font-size="13">Rings · solder access' +
      (p.special.pitContactMode === 'braid' ? '   |   Outlined slots · fold the ' + (type === 'pit' ? 'island' : 'inside') + ' braid through here' : '') + '</text>'
    : '';
  header.push(
    '<text x="20" y="474" font-size="14">' + note + '</text>',
    ['pit', 'hairpin', 'diamond', 'turnout'].includes(type) && p.braidWidth > 0
      ? '<text x="20" y="496" font-size="13"><tspan fill="#076474">Teal · left braid</tspan>   |   <tspan fill="#ad511d">Copper · right braid</tspan>   |   Dashed · underside wiring</text>' + pitLegend + '</svg>'
      : '<text x="20" y="497" font-size="13">Keep the left and right conductors of each route distinct. See Assembly notes.txt.</text></svg>',
  );
  return header.join('\n');
}

export function assemblyNotes(p) {
  const notes = specialAssemblyNotes(p);
  if (p.special.type === 'pit') {
    if (p.special.pitWhiteLine)
      notes.push(`Paint the ${p.whiteLineWidth} mm white divider along the main-road edge beside the pit box. Follow the conductor map through the entry and exit, leaving the guide slots and braids clear.` +
        (p.special.pitCrossingStyle === 'dashed' ? ' Use the dash pattern through both transitions and a solid stripe along the pit box.' : '') +
        (lineGrooves(p).road ? ' A printed groove outlines both sides and ends of each painted section, stopping over dovetail pockets to preserve their roofs.' : ' The paint sits on the flat road surface.'));
    // Both hands are mirrors of the same linkage and use the same hardware.
    const spec = pitActuatorSpec(p, pitLayout(p).forks[0]);
    const motor = pitMotorSettings(p.special);
    if (motor.motorMount) {
      notes.push(
        `The motor case measures ${motor.motorLength} × ${motor.motorWidth} × ${motor.motorHeight} mm (length along the shaft × width × height). The retracted linkage point is ${motor.plungerProjection} mm beyond the end face, centred on the case.`,
        `Use a ${spec.rodDiameter} mm pushrod in the ${spec.eyeDiameter} mm crank hole. The ${motor.motorStroke} mm usable stroke includes ${spec.pinClearance.toFixed(2)} mm of free play and ${spec.stroke.toFixed(2)} mm of travel between blade stops. Changing the wire size changes this fit.`,
        'Measure the finished crank hole and the usable plunger stroke under load. If the printed hole is undersize, ream it to the specified diameter before fitting the wire.',
        'Centre the cradle in its slots. Set the motor and flipper halfway through their travel, then bend the wire to meet the linkage points. Slide the cradle to centre the throw and check both seats by hand. If total travel is short or the motor pushes against both stops, recheck the stroke and the measured hole and wire diameters.',
      );
    } else {
      notes.push(`Each crank has a ${spec.eyeDiameter} mm eye for a bent pushrod up to ${spec.rodDiameter} mm in diameter. The straight-line distance between the eye’s two seated positions is ${spec.stroke.toFixed(2)} mm. Use this to match the linkage to your actuator’s stroke.`);
    }
    notes.push(
      `At the pushrod eye, allow at most ${Number(spec.headDiameter.toFixed(2))} mm outside diameter and ${spec.headProjection} mm above the tab for the pin head or retainer. This leaves ${spec.headTopClearance} mm to the pocket ceiling throughout the throw. Seat the pushrod below the tab in its channel.`,
    );
  }
  if (p.special.type === 'turnout' && turnoutSettings(p.special).turnoutMode === 'digital') {
    const { drive } = turnoutLayout(p);
    const pinLength = Math.floor((drive.tongue.z0 + drive.pinHole.depth - drive.z.shaftZ + drive.pinHole.radius + 1) * 2) / 2;
    notes.push(
      `The slider moves ${drive.stroke} mm. Its slot has a ${drive.cam.slant.toFixed(1)} mm slant at ${Math.round(drive.cam.angle)}° to the slide, between flats of ${drive.cam.flat.toFixed(1)} mm, and moves the crank pin ${drive.travel.toFixed(2)} mm sideways. The crank is ${drive.crank.radius.toFixed(1)} mm long.` +
        (drive.cam.angle > 30 ? ' A slant this steep needs a firm push, and a knock on the blade can push the slider back. A motor with 5 mm of stroke or more gives a shallow slant.' : ''),
      `The pin for the plunger is ${drive.motor.eyeDiameter} mm in diameter and about ${pinLength} mm long. The motor body is ${drive.motor.motorLength} × ${drive.motor.motorWidth} × ${drive.motor.motorHeight} mm (length along the plunger × width × height), with its eye ${drive.motor.plungerProjection} mm in front of the end face when retracted.`,
    );
  }
  return notes.join('\n\n') + '\n';
}
