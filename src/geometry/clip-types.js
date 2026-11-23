import { drawKeySpec, retainedClipSpec } from './keeper-dimensions.js';
import { SCREW_CLIP_TYPE, screwClipSpec } from './screw-clip.js';

const clips = {
  'carrera-retained': {
    ...retainedClipSpec('Carrera with two keepers', 60, 14.8, 4.5),
    keeperOffsets: [-15, 15],
    clipName: 'Carrera clip',
  },
};

export function currentClipType(type) {
  if (type == null || type === '' || type === 'slotforge') return 'draw-key';
  return type === 'carrera' ? 'carrera-retained' : type;
}

export function clipSpec(p) {
  if (!p.clipType || p.jointFitVersion === 1) return null;
  const type = currentClipType(p.clipType);
  const spec =
    type === 'draw-key'
      ? drawKeySpec(p.height)
      : type === SCREW_CLIP_TYPE
        ? screwClipSpec(p)
        : Object.hasOwn(clips, type) && clips[type];
  if (!spec)
    throw Error(
      'Choose a supported connector in the project clip type settings.',
    );
  return {
    pocketHalfWidth: spec.width / 2,
    seatHeight: 0.3,
    clipName: spec.retained ? spec.name : spec.name + ' clip',
    ...spec,
    type,
    reach: spec.length / 2,
    halfWidth: spec.width / 2,
  };
}

export function clipAttribution(p) {
  // Preserve the source credit when editing a previously exported STL.
  const type = p.clipType;
  if (!['carrera', 'carrera-retained', 'slotforge'].includes(type)) return null;
  return [
    'Carrera Slotcar Track Connector Clip by URSUS (@URSUS_570437).',
    'https://www.printables.com/model/1163344-carrera-slotcar-track-connector-clip',
    'Creative Commons Attribution-ShareAlike 4.0 International',
    'https://creativecommons.org/licenses/by-sa/4.0/',
    type !== 'slotforge'
      ? 'Original clip by URSUS supplies the source geometry. The project file records any further edits made in the STL editor.'
      : 'The embedded STL is a SlotForge adaptation of the URSUS fork, licensed CC BY-SA 4.0.',
  ].join('\n');
}

function clipCredit(type) {
  if (!['carrera', 'carrera-retained', 'slotforge'].includes(type))
    return undefined;
  return (
    'URSUS printables.com/model/1163344 CC BY-SA 4.0 | ' +
    (type === 'slotforge' ? 'SlotForge adapted clip' : 'original clip')
  );
}

export function clipSTLHeader(type) {
  const credit = clipCredit(type);
  return credit && credit + ' source';
}

// Binary STL has no standard metadata field. Recognize the two headers this
// app writes so opening a previously exported clip preserves its credit.
export function clipTypeFromHeader(bytes) {
  const header = new TextDecoder().decode(bytes.subarray(0, 80));
  return ['carrera', 'slotforge'].find((type) =>
    header.startsWith(clipCredit(type)),
  );
}
