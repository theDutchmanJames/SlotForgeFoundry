import { strToU8, zipSync } from 'fflate';
import { encodeSTL } from './editor.js';
import { fitRetainer, releaseRetainer } from './clip-instructions.js';
import { keeperToolSTL, KEEPER_TOOL_FILENAME } from './keeper-tool-stl.js';
import {
  JOINT_FIT_LIMITS,
  JOINT_FIT_MIN_HEIGHT,
  currentJointSettings,
  resolveJointFit,
  validateTabSize,
} from './geometry/joint-fit.js';
import {
  clipAttribution,
  clipSpec,
  clipSTLHeader,
} from './geometry/clip-types.js';
import { clipPair, tabPair, withPrintableSolid } from './geometry/joints.js';
import { makePart, shell, SolidWorkshop } from './geometry/solids.js';
import { defaultTrack } from './track.js';

function candidateValues(fit) {
  const offset = (value, delta, [min, max]) =>
    delta === 0
      ? value
      : Math.max(min, Math.min(max, Number((value + delta).toFixed(12))));
  const samples = [];
  for (const delta of [-0.05, 0, 0.05]) {
    const tabClearance = offset(fit.tabClearance, delta, [
      JOINT_FIT_LIMITS.tab[0],
      fit.tabMaxClearance,
    ]);
    const clipClearance = offset(
      fit.clipClearance,
      delta,
      JOINT_FIT_LIMITS.clip,
    );
    const previous = samples.at(-1);
    if (
      previous?.tabClearance === tabClearance &&
      previous.clipClearance === clipClearance
    ) {
      previous.current ||= delta === 0;
    } else {
      samples.push({ tabClearance, clipClearance, current: delta === 0 });
    }
  }
  return samples;
}

function block(work, p, id, x0, x1, y0, y1) {
  const section = work.section([
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
  ]);
  const part = makePart(id, id, 'body', section);
  shell(work, part, p);
  return part;
}

function markStation(work, part, x, y, count, p) {
  // Through marks identify a station from either side while inserting a clip.
  // The sleeves keep the same markings visible on the underside of a hollow rack.
  for (let i = 0; i < count; i++) {
    const cy = y + 3.2 * (i - (count - 1) / 2);
    const circle = (radius) => {
      const dot = work.own(work.wasm.CrossSection.circle(radius, 16));
      return work.own(dot.translate([x, cy]));
    };
    if (p.hollow) part.additions.push(work.prism(circle(1.5), 0, p.height));
    part.cuts.push(work.prism(circle(0.85), -1, p.height + 1));
  }
}

function keyText(p, fit, clip, samples) {
  const mm = (value) =>
    value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 15,
      useGrouping: false,
    });
  return [
    'SlotForge Foundry · Connector fit samples',
    'Track height ' + mm(p.height) + ' mm',
    'Tab width ' +
      mm(fit.tabWidth) +
      ' mm · projection ' +
      mm(fit.tabLength) +
      ' mm · thickness ' +
      mm(fit.tabThickness) +
      ' mm',
    'Current socket width × depth × height ' +
      [fit.tabSocketWidth, fit.tabSocketDepth, fit.tabSocketHeight]
        .map(mm)
        .join(' × ') +
      ' mm',
    'Clip type ' + clip.name,
    'Main clip thickness ' + mm(clip.thickness) + ' mm · ' +
      clip.keeperOffsets.length + (clip.keeperOffsets.length === 1 ? ' keeper' : ' keepers') + ' per joint',
    'Clearance per side in millimetres',
    '',
    'Dot markings (both faces) | Tab clearance | Clip clearance',
    ...samples.map(
      (s, i) =>
        [
          `${i + 1} ${i === 0 ? 'dot' : 'dots'}`,
          mm(s.tabClearance),
          mm(s.clipClearance),
        ].join(' | ') + (s.current ? '  (current)' : ''),
    ),
    '',
    'Print one of each STL at 100% with your track material, layer height and slicer settings. Print the turning tool flat in its supplied orientation. The same tool fits every keeper on both clip families.',
    'Inspect the underside of the projecting tab in your slicer. Its tip extends ' +
      mm(fit.tabLength) +
      ' mm into open space. Use removable support below the tab if needed, and use the same support settings on the finished track tabs.',
    '',
    'For tabs, slide the tab key into each socket on the outer edge of rack B. Choose the clearance that seats fully and pulls out by hand with the least side play.',
    '',
    'For clips, align matching dot groups on the two racks. ' + fitRetainer(clip) +
      ' The joined racks should sit flat with their road surfaces flush. ' +
      releaseRetainer + ' Repeat at the next dot group.',
    '',
    'Use the table to enter the best tab and clip clearances independently in Connections.',
    '',
  ].join('\n');
}

/** Print the actual joint profiles without requiring an assembled seam or a Circuit drawing. */
export function packFitSamples(wasm, rawParams) {
  rawParams = currentJointSettings(rawParams);
  const fit = resolveJointFit(rawParams);
  if (fit.version !== 2)
    throw new Error(
      'Upgrade the project to adjustable connector fits before exporting fit samples.',
    );
  const params = { ...defaultTrack(), ...rawParams };
  for (const [name, [min, max]] of Object.entries(JOINT_FIT_LIMITS)) {
    const value = fit[name + 'Clearance'];
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(
        `${name} clearance must be between ${min} and ${max} mm.`,
      );
  }
  const { height, hollow, deck, wall } = params;
  const clip = clipSpec(params);
  const minHeight = clip?.minimumHeight ?? JOINT_FIT_MIN_HEIGHT;
  if (!Number.isFinite(height) || height < minHeight || height > 500)
    throw new Error(
      `Connector fit samples require a track height between ${minHeight} and 500 mm.`,
    );
  if (
    hollow &&
    (!Number.isFinite(deck) ||
      deck < 0.2 ||
      deck >= height ||
      !Number.isFinite(wall) ||
      wall < 0.2)
  )
    throw new Error(
      'Choose valid track wall and deck thicknesses for the fit samples.',
    );
  validateTabSize(params);
  const samples = candidateValues(fit);
  const markerX = clip ? Math.ceil(clip.reach + 4) : 10;
  const rackDepth = markerX + 2;
  // Preserve material between the marks, adjacent sockets and clip pockets.
  // Compute the supporting stock using the loosest candidate for this print.
  const loosest = resolveJointFit({ ...params, ...samples.at(-1) });
  const socketEdge = Math.max(20, markerX + 2 + loosest.tabSocketSupportDepth);
  const pitch = Math.max(
    14,
    2 * loosest.tabSupportHalfWidth + 4,
    clip ? 2 * (clip.pocketHalfWidth + loosest.clipClearance) + 4 : 0,
  );
  const keyHalfWidth = Math.max(6, loosest.tabSupportHalfWidth + 1);
  const keyDepth = Math.max(10, fit.tabRootSupportDepth + 2);
  const work = new SolidWorkshop(wasm);
  try {
    const length = samples.length * pitch;
    const a = block(work, params, 'rack-A', -rackDepth, 0, 0, length);
    const b = block(work, params, 'rack-B', 0, socketEdge, 0, length);
    const key = block(
      work,
      params,
      'tab-key',
      -keyDepth,
      0,
      -keyHalfWidth,
      keyHalfWidth,
    );
    const loose = [];
    const clipId = clip.type === 'draw-key' ? 'draw-key' : 'carrera-clip';
    tabPair(work, params, [0, 0], [1, 0], key, null);
    samples.forEach((s, i) => {
      const station = (i + 0.5) * pitch;
      const p = {
        ...params,
        tabClearance: s.tabClearance,
        clipClearance: s.clipClearance,
      };
      clipPair(
        work,
        p,
        [0, station],
        [1, 0],
        a,
        b,
        loose,
        i === 0 ? clipId : null,
      );
      tabPair(work, p, [socketEdge, station], [-1, 0], null, b);
      markStation(work, a, -markerX, station, i + 1, params);
      markStation(work, b, markerX, station, i + 1, params);
    });
    const files = {};
    function save(id, solid, x, y, stlHeader) {
      if (solid.status() !== 'NoError' || solid.isEmpty())
        throw new Error(
          'Could not make printable connector fit sample ' + id + '.',
        );
      const placed = work.own(
        solid.translate([x, y, -solid.boundingBox().min[2]]),
      );
      files[id + '.stl'] = encodeSTL(placed, stlHeader);
    }
    const finish = (part) => work.cut(work.union(part.additions), part.cuts);
    let rackY = Math.max(16, 2 * keyHalfWidth + 4);
    let nextX = keyDepth + fit.tabLength + 4;
    for (const part of loose) {
      withPrintableSolid(
        part,
        (solid) => {
          const { min, max } = solid.boundingBox();
          const clipX = Math.max(27, nextX - min[0]);
          const clipY = clip ? -min[1] : 2;
          save(
            part.role === 'retainer'
              ? part.id.replace(clipId + '-retainer', 'retaining-clip')
              : part.id,
            solid,
            clipX,
            clipY,
            clipSTLHeader(part.clipType),
          );
          nextX = clipX + max[0] + 4;
          rackY = Math.max(rackY, clipY + max[1] + 4);
        },
        { sideDown: true },
      );
    }
    save(key.id, finish(key), keyDepth, keyHalfWidth);
    save(a.id, finish(a), rackDepth, rackY);
    save(b.id, finish(b), rackDepth + 4, rackY);
    files[KEEPER_TOOL_FILENAME] = keeperToolSTL(wasm, [0, rackY + length + 4]);
    files['fit-key.txt'] = strToU8(keyText(params, fit, clip, samples));
    const credit = clipAttribution(params);
    if (credit) files['clip-attribution.txt'] = strToU8(credit);
    return zipSync(files, { level: 3 });
  } finally {
    work.close();
  }
}
